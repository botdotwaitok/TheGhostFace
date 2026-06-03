// modules/phone/chat/chatSearch.js — Phase 4 search panel.
// Single-chat scope: grep over the active ST chat's in-memory history only.
// No index reads, no cross-session scanning — click a hit and the chat app
// jumps straight to that message (auto-expanding load-more if it sits above
// the initial 40-message window) with a brief highlight.

import { openChatApp, escHtml } from './chatApp.js';
import { openAppInViewport } from '../phoneController.js';
import { loadHistory, ensureReady } from '../../storage/chatHistoryStore.js';
import { getCharacterDisplayName, getCharacterInfo } from './chatStorage.js';
import { openChatSettingsPage } from './chatSettings.js';

const LOG = '[ChatSearch]';
const DEBOUNCE_MS = 300;
const SNIPPET_RADIUS = 60;     // chars on either side of the match in the preview
const MAX_RESULTS = 200;       // cap visible hits; "..." marker when exceeded

// Module-level state — search panel is a singleton viewport page.
let _backHandler = null;
let _debounceTimer = null;
let _searchToken = 0;          // bumped per fresh run to cancel stale ones

// ───────────────────────────────────────────────────────────────────────
// Entry point
// ───────────────────────────────────────────────────────────────────────

export function openChatSearchPage() {
    const titleHtml = `<span class="chat-search-nav-title">搜索聊天记录</span>`;
    const html = _buildPage();

    openAppInViewport(titleHtml, html, () => {
        _bindEvents();
        _registerBackHandler();
        const input = document.getElementById('chat_search_input');
        if (input) input.focus();
    });
}

function _buildPage() {
    const charName = escHtml(getCharacterDisplayName() || '当前角色');
    return `
    <div class="chat-search-page" id="chat_search_root">
        <div class="chat-search-input-row">
            <i class="ph ph-magnifying-glass chat-search-input-icon"></i>
            <input
                type="text"
                id="chat_search_input"
                class="chat-search-input"
                placeholder="在与 ${charName} 的当前会话中搜索"
                autocomplete="off"
                spellcheck="false"
            />
            <button class="chat-search-clear-btn" id="chat_search_clear_btn" title="清空" hidden>
                <i class="ph ph-x"></i>
            </button>
        </div>

        <div class="chat-search-status" id="chat_search_status">
            输入屎尿屁我爱你开始搜索
        </div>

        <div class="chat-search-results" id="chat_search_results"></div>
    </div>`;
}

function _bindEvents() {
    const input = document.getElementById('chat_search_input');
    const clearBtn = document.getElementById('chat_search_clear_btn');
    const results = document.getElementById('chat_search_results');

    if (input) {
        input.addEventListener('input', () => {
            const value = input.value;
            if (clearBtn) clearBtn.hidden = value.length === 0;
            _scheduleSearch(value);
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                if (input.value) {
                    input.value = '';
                    if (clearBtn) clearBtn.hidden = true;
                    _scheduleSearch('');
                } else {
                    _exitToSettings();
                }
            }
        });
    }

    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            if (!input) return;
            input.value = '';
            clearBtn.hidden = true;
            _scheduleSearch('');
            input.focus();
        });
    }

    // Result row click → jump to that message in the chat app.
    if (results) {
        results.addEventListener('click', (e) => {
            const row = e.target.closest('.chat-search-result[data-msg-index]');
            if (!row) return;
            const idx = parseInt(row.dataset.msgIndex, 10);
            if (!Number.isInteger(idx) || idx < 0) return;
            _jumpToMessage(idx);
        });
    }
}

// ───────────────────────────────────────────────────────────────────────
// Debounce + search dispatch
// ───────────────────────────────────────────────────────────────────────

function _scheduleSearch(query) {
    if (_debounceTimer) clearTimeout(_debounceTimer);
    const trimmed = query.trim();

    // Cancel any in-flight run immediately so partial appends stop, then debounce
    // the next invocation. Bumping the token here (not just inside _runSearch)
    // means a fast typist's intermediate states never paint.
    _searchToken++;

    if (!trimmed) {
        _renderIdle();
        return;
    }
    _debounceTimer = setTimeout(() => _runSearch(trimmed), DEBOUNCE_MS);
}

async function _runSearch(query) {
    const myToken = ++_searchToken;
    _renderStatus('搜索中…');
    const resultsEl = document.getElementById('chat_search_results');
    if (resultsEl) resultsEl.innerHTML = '';

    let messages;
    try {
        await ensureReady();
        messages = loadHistory();
    } catch (e) {
        console.warn(`${LOG} loadHistory failed:`, e);
        _renderStatus('读取当前会话失败');
        return;
    }
    if (myToken !== _searchToken) return;

    if (!Array.isArray(messages) || messages.length === 0) {
        _renderStatus('当前会话还没有任何消息');
        return;
    }

    const hits = _grepMessages(messages, query);
    if (myToken !== _searchToken) return;

    if (hits.length === 0) {
        _renderStatus(`未找到包含「${query}」的消息`);
        return;
    }

    // Newer messages first — matches how a chat app typically surfaces history.
    hits.sort((a, b) => b.msgIndex - a.msgIndex);

    const capped = hits.length > MAX_RESULTS;
    const visible = capped ? hits.slice(0, MAX_RESULTS) : hits;

    let html = '';
    for (const hit of visible) {
        html += _buildResultHtml({ query, messages, hit });
    }
    if (resultsEl) resultsEl.innerHTML = html;

    _renderStatus(_summaryLine(hits.length, visible.length, capped));
}

function _summaryLine(total, shown, capped) {
    if (capped) {
        return `共 ${total} 条结果，已显示前 ${shown} 条（请进一步细化关键词）`;
    }
    return `找到 ${total} 条结果`;
}

// ───────────────────────────────────────────────────────────────────────
// Grep + render helpers
// ───────────────────────────────────────────────────────────────────────

function _grepMessages(messages, query) {
    const lowered = query.toLowerCase();
    const out = [];
    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        if (!msg) continue;
        const content = msg.content;
        if (typeof content !== 'string' || content.length === 0) continue;
        if (msg.special === 'retract') continue;
        if (content.toLowerCase().includes(lowered)) {
            out.push({ msgIndex: i, content });
        }
    }
    return out;
}

function _buildResultHtml({ query, messages, hit }) {
    const msg = messages[hit.msgIndex];
    const speakerLabel = msg?.role === 'user'
        ? '我'
        : (getCharacterDisplayName() || getCharacterInfo()?.name || '角色');
    const timeLabel = _formatTimestamp(msg?.timestamp);
    const snippet = _buildSnippet(hit.content, query);

    return `
        <div class="chat-search-result" data-msg-index="${hit.msgIndex}">
            <div class="chat-search-result-header">
                <span class="chat-search-result-source ${msg?.role || ''}">${escHtml(speakerLabel)}</span>
                <span class="chat-search-result-time">${escHtml(timeLabel)}</span>
            </div>
            <div class="chat-search-result-snippet">${snippet}</div>
        </div>`;
}

function _buildSnippet(content, query) {
    // Find the first match; show a window of SNIPPET_RADIUS chars on either side.
    const lowered = content.toLowerCase();
    const at = lowered.indexOf(query.toLowerCase());
    if (at < 0) return _highlight(content.slice(0, SNIPPET_RADIUS * 2), query);

    const start = Math.max(0, at - SNIPPET_RADIUS);
    const end = Math.min(content.length, at + query.length + SNIPPET_RADIUS);
    let slice = content.slice(start, end);
    if (start > 0) slice = '…' + slice;
    if (end < content.length) slice = slice + '…';
    return _highlight(slice, query);
}

function _highlight(text, query) {
    // Escape both sides before regex, so HTML in content can't break out and
    // queries containing regex specials match literally.
    const escapedText = escHtml(text);
    const escapedQuery = escHtml(query);
    if (!escapedQuery) return escapedText;
    const pattern = new RegExp(_escapeRegExp(escapedQuery), 'gi');
    return escapedText.replace(pattern, (m) => `<mark class="chat-search-mark">${m}</mark>`);
}

function _escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

function _renderIdle() {
    _renderStatus('输入关键词开始搜索');
    const results = document.getElementById('chat_search_results');
    if (results) results.innerHTML = '';
}

function _renderStatus(text) {
    const status = document.getElementById('chat_search_status');
    if (status) status.textContent = text;
}

// ───────────────────────────────────────────────────────────────────────
// Jump to message in chat app
// ───────────────────────────────────────────────────────────────────────

function _jumpToMessage(msgIndex) {
    if (_debounceTimer) {
        clearTimeout(_debounceTimer);
        _debounceTimer = null;
    }
    _searchToken++; // invalidate any pending paint
    _unregisterBackHandler();
    // openChatApp accepts a scrollToMsgIdx option — it expands the initial
    // load-more window if needed, then scrolls + briefly highlights the target.
    openChatApp({ scrollToMsgIdx: msgIndex }).catch((e) => {
        console.warn(`${LOG} openChatApp jump failed:`, e);
    });
}

// ───────────────────────────────────────────────────────────────────────
// Back navigation
// ───────────────────────────────────────────────────────────────────────

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
    if (_debounceTimer) {
        clearTimeout(_debounceTimer);
        _debounceTimer = null;
    }
    _searchToken++; // invalidate any pending paint
    _unregisterBackHandler();
    openChatSettingsPage();
}
