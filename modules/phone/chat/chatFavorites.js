// modules/phone/chat/chatFavorites.js — Message bookmark/favorite layer
// Two independent boolean flags on the message itself, no extra metadata key:
//   - favoritedByUser : the user long-pressed and tapped "收藏"
//   - favoritedByChar : the LLM returned a `favorites` entry pointing at it
// Both can coexist. The user-facing favorites page renders ONLY
// favoritedByUser entries — char favorites are a back-end channel reserved
// for the upcoming "ta 的手机" app, intentionally invisible here so the
// user's bookmark list stays a personal record uncrowded by ta's picks.

import { openAppInViewport } from '../phoneController.js';
import { openChatApp, escHtml } from './chatApp.js';
import {
    loadChatHistory,
    saveChatHistory,
    getCharacterDisplayName,
    getCharacterInfo,
    ensureChatHistoryReady,
} from './chatStorage.js';
import { openChatSettingsPage } from './chatSettings.js';

const LOG = '[ChatFavorites]';

// ═══════════════════════════════════════════════════════════════════════
// User-side toggle (long-press → "收藏" / "取消收藏")
// ═══════════════════════════════════════════════════════════════════════

/**
 * Toggle `favoritedByUser` on the message at the given index, persist, and
 * surface a brief toast so the user knows it worked (the bubble itself
 * stays unchanged — favorites are visible only in the dedicated page).
 *
 * Does NOT clear `favoritedAt` on untoggle — keeping the last-toggled
 * timestamp is cheap and useful when debugging "why is this still in my
 * favorites" questions. The favorites page reads only the boolean.
 *
 * @param {number} msgIndex
 */
export function toggleUserFavorite(msgIndex) {
    const history = loadChatHistory();
    if (msgIndex < 0 || msgIndex >= history.length) return;

    const msg = history[msgIndex];
    if (!msg) return;

    const wasFavorited = !!msg.favoritedByUser;
    if (wasFavorited) {
        delete msg.favoritedByUser;
    } else {
        msg.favoritedByUser = true;
        msg.favoritedAt = new Date().toISOString();
    }

    saveChatHistory(history).catch(e =>
        console.warn(`${LOG} favorite flush failed:`, e));

    if (typeof toastr !== 'undefined') {
        toastr.success(wasFavorited ? '已取消收藏' : '已收藏', '', { timeOut: 1500 });
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Query helpers
// ═══════════════════════════════════════════════════════════════════════

/**
 * Return all messages the user has bookmarked, newest-first (by favoritedAt,
 * falling back to msgIndex when the stamp is missing on older entries).
 *
 * @returns {Array<{msgIndex:number, content:string, timestamp:string, role:string, favoritedAt?:string, special?:string}>}
 */
export function getUserFavorites() {
    const history = loadChatHistory();
    const out = [];
    for (let i = 0; i < history.length; i++) {
        const msg = history[i];
        if (!msg?.favoritedByUser) continue;
        out.push({
            msgIndex: i,
            content: msg.content || '',
            timestamp: msg.timestamp || '',
            role: msg.role,
            favoritedAt: msg.favoritedAt || '',
            special: msg.special || '',
        });
    }
    out.sort((a, b) => {
        if (a.favoritedAt && b.favoritedAt) {
            return a.favoritedAt < b.favoritedAt ? 1 : a.favoritedAt > b.favoritedAt ? -1 : 0;
        }
        return b.msgIndex - a.msgIndex;
    });
    return out;
}

/**
 * All user messages the char has bookmarked (via the LLM `favorites` channel),
 * newest-first by favoritedAt with msgIndex fallback. Mirrors getUserFavorites'
 * shape so "ta 的手机" can render them with the same row template.
 *
 * @returns {Array<{msgIndex:number, content:string, timestamp:string, role:string, favoritedAt?:string, special?:string}>}
 */
export function getCharFavorites() {
    const history = loadChatHistory();
    const out = [];
    for (let i = 0; i < history.length; i++) {
        const msg = history[i];
        if (!msg?.favoritedByChar) continue;
        // Char favorites are scoped to user messages by protocol; defensively
        // skip any char-on-char that snuck through (e.g. a future migration
        // mistake), so external callers never see a self-bookmark.
        if (msg.role !== 'user') continue;
        out.push({
            msgIndex: i,
            content: msg.content || '',
            timestamp: msg.timestamp || '',
            role: msg.role,
            favoritedAt: msg.favoritedAt || '',
            special: msg.special || '',
        });
    }
    out.sort((a, b) => {
        if (a.favoritedAt && b.favoritedAt) {
            return a.favoritedAt < b.favoritedAt ? 1 : a.favoritedAt > b.favoritedAt ? -1 : 0;
        }
        return b.msgIndex - a.msgIndex;
    });
    return out;
}

// ═══════════════════════════════════════════════════════════════════════
// LLM-side apply (Phase 2)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Mark messages bookmarked via the LLM `favorites` channel. Mutates `history`
 * in place; the caller (renderResponseToDom) saves once at the end of its
 * pipeline so this stays a pure marker step.
 *
 * targetIndex semantics mirror reactions: counts ONLY user messages from the
 * tail (-1 = newest user message, -2 = the one before that, ...). Positive
 * or zero values are rejected so a hallucinated index can't accidentally
 * bookmark the char's own line.
 *
 * @param {Array<{targetIndex:number}>|null|undefined} aiFavorites
 * @param {Array} history
 * @returns {number} count of newly-applied bookmarks
 */
export function applyAIFavorites(aiFavorites, history) {
    if (!Array.isArray(aiFavorites) || aiFavorites.length === 0) return 0;
    if (!Array.isArray(history) || history.length === 0) return 0;

    // Stack of user-message indexes, newest at position 0.
    const userIdxStack = [];
    for (let i = history.length - 1; i >= 0; i--) {
        if (history[i]?.role === 'user') userIdxStack.push(i);
    }
    if (userIdxStack.length === 0) return 0;

    let applied = 0;
    const now = new Date().toISOString();
    for (const f of aiFavorites) {
        const t = f?.targetIndex;
        if (typeof t !== 'number' || !Number.isFinite(t) || t > -1) continue;
        const stackPos = -t - 1;
        if (stackPos < 0 || stackPos >= userIdxStack.length) {
            console.warn(`${LOG} aiFavorite targetIndex out of range:`, t);
            continue;
        }
        const idx = userIdxStack[stackPos];
        const msg = history[idx];
        if (!msg) continue;
        if (msg.favoritedByChar) continue;  // idempotent
        msg.favoritedByChar = true;
        msg.favoritedAt = now;
        applied++;
    }
    return applied;
}

// ═══════════════════════════════════════════════════════════════════════
// Favorites page (mirrors chatSearch's panel + jump-to-message UX)
// ═══════════════════════════════════════════════════════════════════════

let _backHandler = null;

export function openChatFavoritesPage() {
    const titleHtml = `<span class="chat-search-nav-title">我的收藏</span>`;
    const html = _buildPage();

    openAppInViewport(titleHtml, html, async () => {
        _registerBackHandler();
        _bindEvents();
        try { await ensureChatHistoryReady(); } catch (_) { /* render with stale */ }
        _renderList();
    });
}

function _buildPage() {
    return `
    <div class="chat-favorites-page" id="chat_favorites_root">
        <div class="chat-search-status" id="chat_favorites_status">加载中…</div>
        <div class="chat-search-results" id="chat_favorites_results"></div>
    </div>`;
}

function _bindEvents() {
    const results = document.getElementById('chat_favorites_results');
    if (!results) return;
    results.addEventListener('click', (e) => {
        const row = e.target.closest('.chat-search-result[data-msg-index]');
        if (!row) return;
        const idx = parseInt(row.dataset.msgIndex, 10);
        if (!Number.isInteger(idx) || idx < 0) return;
        _jumpToMessage(idx);
    });
}

function _renderList() {
    const items = getUserFavorites();
    const status = document.getElementById('chat_favorites_status');
    const results = document.getElementById('chat_favorites_results');
    if (!status || !results) return;

    if (items.length === 0) {
        status.textContent = '';
        results.innerHTML = `
            <div class="chat-favorites-empty">
                <i class="ph ph-bookmark-simple chat-favorites-empty-icon"></i>
                <div class="chat-favorites-empty-title">还没有收藏的消息</div>
                <div class="chat-favorites-empty-hint">长按任一条聊天 → 选择"收藏"</div>
            </div>`;
        return;
    }

    status.textContent = `共 ${items.length} 条收藏`;
    let html = '';
    for (const it of items) html += _buildResultHtml(it);
    results.innerHTML = html;
}

function _buildResultHtml(item) {
    const speakerLabel = item.role === 'user'
        ? '我'
        : (getCharacterDisplayName() || getCharacterInfo()?.name || '角色');
    const timeLabel = _formatTimestamp(item.timestamp);
    const snippet = _previewSnippet(item);

    return `
        <div class="chat-search-result" data-msg-index="${item.msgIndex}">
            <div class="chat-search-result-header">
                <span class="chat-search-result-source ${item.role || ''}">${escHtml(speakerLabel)}</span>
                <span class="chat-search-result-time">${escHtml(timeLabel)}</span>
            </div>
            <div class="chat-search-result-snippet">${snippet}</div>
        </div>`;
}

const PREVIEW_MAX_CHARS = 160;

function _previewSnippet(item) {
    if (item.special === 'image') return escHtml('[图片]');
    if (item.special === 'voice') return escHtml('[语音]');
    if (item.special === 'call')  return escHtml('[通话]');

    const raw = item.content || '';
    const cps = [...raw];
    if (cps.length <= PREVIEW_MAX_CHARS) return escHtml(raw);
    return escHtml(cps.slice(0, PREVIEW_MAX_CHARS).join('') + '…');
}

function _formatTimestamp(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const now = new Date();
    const sameYear = d.getFullYear() === now.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return sameYear
        ? `${m}月${day}日 ${hh}:${mm}`
        : `${d.getFullYear()}年${m}月${day}日`;
}

// ─── Jump to message in chat app (mirrors chatSearch._jumpToMessage) ───

function _jumpToMessage(msgIndex) {
    _unregisterBackHandler();
    openChatApp({ scrollToMsgIdx: msgIndex }).catch((e) => {
        console.warn(`${LOG} openChatApp jump failed:`, e);
    });
}

// ─── Back navigation: returns to ChatSettings, same as chatSearch ───

function _registerBackHandler() {
    _unregisterBackHandler();
    _backHandler = (e) => {
        e.preventDefault();
        _exitToSettings();
    };
    window.addEventListener('phone-app-back', _backHandler);
}

function _unregisterBackHandler() {
    if (_backHandler) {
        window.removeEventListener('phone-app-back', _backHandler);
        _backHandler = null;
    }
}

function _exitToSettings() {
    _unregisterBackHandler();
    openChatSettingsPage();
}

// ═══════════════════════════════════════════════════════════════════════
// Debug / external integration handle
// ═══════════════════════════════════════════════════════════════════════
// Exposed on window so the upcoming "ta 的手机" app can read favorites
// without importing this module directly, and so we can spot-check from
// DevTools. Reads are stateless — both helpers re-read chat history each
// call, so a console snapshot always reflects current disk state.
if (typeof window !== 'undefined') {
    window.gfChatFavorites = { getUserFavorites, getCharFavorites };
}
