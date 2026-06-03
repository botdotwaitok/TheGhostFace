// modules/phone/taPhone/taPhoneApp.js — "Ta's Phone" app entry
// Phase 1: peek confirm → init page (auto/manual) → loading carousel +
// keepAlive → first-time LLM generation → home screen (gradient wallpaper +
// app grid with dead easter-egg icon) → 5 sub-pages (notes / favorites /
// messages / browser / album).

import { openAppInViewport } from '../phoneController.js';
import {
    getPhoneCharInfo,
    getPhoneUserName,
    getPhoneUserPersona,
    getPhoneRecentChat,
    getPhoneWorldBookContext,
} from '../phoneContext.js';
import { callPhoneLLM } from '../../api.js';
import { cleanLlmJson, repairUnescapedQuotes } from '../utils/llmJsonCleaner.js';
import { escapeHtml } from '../utils/helpers.js';
import { tryAutoStartKeepAlive } from '../keepAlive.js';
import { getCharFavorites } from '../chat/chatFavorites.js';
import {
    isTaPhoneInitialized,
    isPeekAccepted,
    setPeekAccepted,
    loadData,
    saveInitialGeneration,
} from './taPhoneStore.js';
import { buildInitialGenerationPrompt } from './taPhonePromptBuilder.js';
import {
    formatTimestamp,
    emptyHtml,
    installBackHandler,
    clearNav,
    pushNav,
    showLoadingPage,
    dismissLoading,
    stopLoadingCarousel,
} from './taPhoneShared.js';
import { renderNotesList, NOTES_TITLE, refreshNotes } from './subpages/notesSubpage.js';
import {
    renderMessagesList,
    MESSAGES_TITLE,
    bindMessagesListEvents,
    cancelActiveMessageDetail,
    refreshMessages,
} from './subpages/messagesSubpage.js';
import {
    renderBrowserList,
    BROWSER_TITLE,
    bindBrowserListEvents,
    cancelActiveBrowserDetail,
    refreshBrowser,
} from './subpages/browserSubpage.js';
import {
    renderAlbumList,
    ALBUM_TITLE,
    refreshAlbum,
    bindAlbumListEvents,
} from './subpages/albumSubpage.js';

const LOG = '[TaPhone]';

// ═══════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════

const DEFAULT_WALLPAPER = { from: '#e2d8ff', to: '#ffe5f2', angle: 135 };

// Real sub-pages with their phone-grid presentation.
const REAL_APPS = [
    { id: 'notes', name: '备忘录', icon: 'ph ph-note', color: '#ffb84d' },
    { id: 'favorites', name: '聊天收藏', icon: 'ph ph-bookmark-simple', color: '#ff6b9d' },
    { id: 'messages', name: '消息', icon: 'ph ph-chat-circle-text', color: '#34c759' },
    { id: 'browser', name: '浏览器', icon: 'ph ph-globe', color: '#5ac8fa' },
    { id: 'album', name: '相册', icon: 'ph ph-image-square', color: '#af52de' },
];

const DBD_EASTER_EGG = {
    id: '__dbd_egg',
    name: '黎明杀机',
    iconImage: '/scripts/extensions/third-party/TheGhostFace/assets/images/dbd-icon.png',
    color: '#1a1a1a',
};

// ═══════════════════════════════════════════════════════════════════════
// Entry point
// ═══════════════════════════════════════════════════════════════════════

/**
 * Open Ta's Phone. First open per chat shows the peek confirm; subsequent
 * opens skip straight to the home screen. Called by both the phone home grid
 * and the chatSettings secondary entry.
 */
export async function openTaPhoneApp() {
    // Reset the multi-layer back stack and make sure the single global
    // listener that drives it is installed (idempotent).
    clearNav();
    installBackHandler();
    try {
        const initialized = await isTaPhoneInitialized();
        if (initialized) {
            _showHome();
            return;
        }

        const peeked = await isPeekAccepted();
        if (!peeked) {
            _showPeekConfirm();
            return;
        }

        // peekAccepted but no home yet — interrupted run. Skip the confirm,
        // jump straight back into generation.
        _startGeneration();
    } catch (e) {
        console.error(`${LOG} openTaPhoneApp failed:`, e);
        _showError('打开 ta 的手机出错了，再试一次？');
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Peek confirm (first-run ritual)
// ═══════════════════════════════════════════════════════════════════════

function _showPeekConfirm() {
    const titleHtml = `<span class="tp-title">ta 的手机</span>`;
    const html = `
        <div class="tp-peek-page tp-fade-in" id="tp_peek_page">
            <div class="tp-peek-card">
                <div class="tp-peek-icon">
                    <i class="ph ph-device-mobile"></i>
                </div>
                <div class="tp-peek-text">
                    现在你得到了一个查看你恋人手机的机会。<br>
                    你确定要进行偷看吗？
                </div>
                <div class="tp-peek-actions">
                    <button class="tp-btn tp-btn-secondary" id="tp_peek_cancel">不要不要</button>
                    <button class="tp-btn tp-btn-primary" id="tp_peek_confirm">确定偷看</button>
                </div>
            </div>
        </div>
    `;

    openAppInViewport(titleHtml, html, () => {
        clearNav();
        document.getElementById('tp_peek_cancel')?.addEventListener('click', _closeViewport);
        document.getElementById('tp_peek_confirm')?.addEventListener('click', async () => {
            try {
                await setPeekAccepted();
            } catch (e) {
                console.warn(`${LOG} setPeekAccepted failed (continuing anyway):`, e);
            }
            _startGeneration();
        });
    });
}

// ═══════════════════════════════════════════════════════════════════════
// Initial generation (LLM is the only primary path; empty shell is an
// error-fallback only, surfaced via _showInitError).
// ═══════════════════════════════════════════════════════════════════════

async function _startGeneration() {
    // Initial generation: no back-restore — the loading page sits at the
    // bottom of the navigation (right after the peek confirm). Once it
    // resolves, _showHome takes over and clearNav() runs there anyway.
    clearNav();
    showLoadingPage('ta 的手机');
    tryAutoStartKeepAlive();

    try {
        const result = await _generateInitialWithLLM();
        if (!result) {
            dismissLoading({ poppedBackEntry: false });
            _showInitError('生成失败，请稍后再试');
            return;
        }
        await saveInitialGeneration(result);
        dismissLoading({ poppedBackEntry: false });
        _showHome();
    } catch (e) {
        console.error(`${LOG} generation failed:`, e);
        dismissLoading({ poppedBackEntry: false });
        _showInitError(`生成失败：${e?.message || '未知错误'}`);
        if (e?.code !== 'USER_CANCELLED' && typeof toastr !== 'undefined') {
            toastr.error('ta 的手机出了点问题，再试一次？');
        }
    }
}

async function _useEmptyShell() {
    const empty = {
        home: {
            wallpaperGradient: DEFAULT_WALLPAPER,
            appLayout: [],
        },
        notes: [],
        messages: [],
        browser: { recentPages: [], searches: [], bookmarks: [] },
        album: [],
    };
    try {
        await saveInitialGeneration(empty);
    } catch (e) {
        console.warn(`${LOG} empty shell save failed:`, e);
    }
    _showHome();
}

// ═══════════════════════════════════════════════════════════════════════
// LLM generation
// ═══════════════════════════════════════════════════════════════════════

async function _generateInitialWithLLM() {
    const charInfo = getPhoneCharInfo();
    const userName = getPhoneUserName();
    const userPersona = getPhoneUserPersona();
    const recentChatSummary = getPhoneRecentChat(20);
    const worldBookText = await getPhoneWorldBookContext();

    const { systemPrompt, userPrompt } = buildInitialGenerationPrompt({
        charInfo,
        userName,
        userPersona,
        worldBookText,
        recentChatSummary,
    });

    console.log(`${LOG} calling LLM for initial generation...`);
    const raw = await callPhoneLLM(systemPrompt, userPrompt, { maxTokens: 20000 });

    // First parse attempt — clean fences + parse.
    let cleaned = cleanLlmJson(raw);
    try {
        return JSON.parse(cleaned);
    } catch (e1) {
        // Second attempt — repair mid-string unescaped quotes.
        try {
            const repaired = repairUnescapedQuotes(cleaned);
            return JSON.parse(repaired);
        } catch (e2) {
            console.warn(`${LOG} JSON parse failed:`, e2.message);
            console.warn(`${LOG} raw LLM response:`, raw);
            return null;
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Home screen — gradient wallpaper + app grid
// ═══════════════════════════════════════════════════════════════════════

async function _showHome() {
    _activeSubPageId = null;
    cancelActiveMessageDetail();
    cancelActiveBrowserDetail();
    let data;
    try {
        data = await loadData();
    } catch (e) {
        console.error(`${LOG} loadData failed:`, e);
        _showError('读取她的手机数据出错了');
        return;
    }

    const gradient = _safeGradient(data?.home?.wallpaperGradient);
    const virtualApps = Array.isArray(data?.home?.appLayout) ? data.home.appLayout : [];

    const titleHtml = `<span class="tp-title">ta 的手机</span>`;
    const html = `
        <div class="tp-home-page tp-fade-in" id="tp_home_page"
             style="background: linear-gradient(${gradient.angle}deg, ${gradient.from}, ${gradient.to});">
            <div class="tp-home-grid" id="tp_home_grid">
                ${_buildAppGridHtml(virtualApps)}
            </div>
        </div>
    `;

    openAppInViewport(titleHtml, html, () => {
        // Home sits at the bottom of the back stack — clearing means
        // pressing back from here lets phoneController close the app
        // (matches the original "home back = close" behavior).
        clearNav();
        _bindHomeEvents();
    });
}

function _buildAppGridHtml(virtualApps) {
    const real = REAL_APPS.map(a => _renderGridIcon(a, { dead: false, real: true })).join('');
    const dbd = _renderGridIcon(DBD_EASTER_EGG, { dead: true, real: false });
    // v2 appLayout entries are {name, type} objects (normalized in the
    // store). type is unused in Phase 1 — virtual apps stay dead tiles
    // until Phase 5 wires up the type→template dispatch.
    const virtuals = virtualApps
        .filter(app => app && typeof app.name === 'string' && app.name.trim())
        .slice(0, 24)
        .map(app => _renderGridIcon({
            id: `__virtual_${app.name}`,
            name: app.name,
            icon: 'ph ph-app-window',
            color: _virtualAppColor(app.name),
        }, { dead: true, real: false }))
        .join('');

    return real + dbd + virtuals;
}

function _renderGridIcon(app, { dead, real }) {
    const realCls = real ? 'tp-app-real' : '';
    const deadCls = dead ? 'tp-app-dead' : '';
    const inner = app.iconImage
        ? `<img class="tp-app-icon-img" src="${escapeHtml(app.iconImage)}" alt="${escapeHtml(app.name)}">`
        : `<i class="${app.icon}"></i>`;
    return `
        <div class="tp-app-tile ${realCls} ${deadCls}" data-app-id="${escapeHtml(app.id)}">
            <div class="tp-app-icon" style="background:${app.color};">
                ${inner}
            </div>
            <div class="tp-app-label">${escapeHtml(app.name)}</div>
        </div>
    `;
}

function _bindHomeEvents() {
    document.querySelectorAll('.tp-app-tile.tp-app-real').forEach(tile => {
        tile.addEventListener('click', () => {
            const id = tile.dataset.appId;
            if (id) _showSubPage(id);
        });
    });
    // Dead tiles (virtual apps + DBD easter egg) — no-op on click, but
    // give a tiny press feedback so it doesn't feel broken.
    document.querySelectorAll('.tp-app-tile.tp-app-dead').forEach(tile => {
        tile.addEventListener('click', () => {
            tile.classList.add('tp-pressed');
            setTimeout(() => tile.classList.remove('tp-pressed'), 180);
        });
    });
}

// ═══════════════════════════════════════════════════════════════════════
// Sub-pages
// ═══════════════════════════════════════════════════════════════════════

// Per-subpage broad refresh — Phase 3.5. Favorites is intentionally
// excluded: it's a read-only mirror of the chat's ST-side favorites,
// no LLM content of its own to refresh.
const SUBPAGE_REFRESH = {
    notes:    refreshNotes,
    messages: refreshMessages,
    browser:  refreshBrowser,
    album:    refreshAlbum,
};

const SUBPAGE_DISPATCH = {
    notes:     { title: NOTES_TITLE,    render: (data) => renderNotesList(data.notes) },
    favorites: { title: '聊天收藏',     render: () => _renderFavorites() },
    messages:  { title: MESSAGES_TITLE, render: (data) => renderMessagesList(data.messages) },
    browser:   { title: BROWSER_TITLE,  render: (data) => renderBrowserList(data.browser) },
    album:     { title: ALBUM_TITLE,    render: (data) => renderAlbumList(data.album) },
};

let _refreshInFlight = false;
// Tracks which sub-page is currently visible. Used by _handleSubPageRefresh
// to detect "user backed out during the LLM call" so the late result
// doesn't re-mount a page they already left.
let _activeSubPageId = null;

async function _showSubPage(id, { skipNavPush = false } = {}) {
    _activeSubPageId = id;
    const dispatch = SUBPAGE_DISPATCH[id];
    if (!dispatch) return;

    // Returning to (or entering) a sub-page list means we're no longer
    // inside a detail page — drop any pending detail LLM result.
    cancelActiveMessageDetail();
    cancelActiveBrowserDetail();

    let data;
    try {
        data = await loadData();
    } catch (e) {
        console.error(`${LOG} sub-page load failed:`, e);
        _showError('读取数据出错了');
        return;
    }

    const pageHtml = dispatch.render(data);
    const titleHtml = `<span class="tp-title">${escapeHtml(dispatch.title)}</span>`;
    const html = `<div class="tp-subpage tp-fade-in" id="tp_subpage_root">${pageHtml}</div>`;
    const hasRefresh = !!SUBPAGE_REFRESH[id];
    const actionsHtml = hasRefresh
        ? `<button class="tp-header-btn" id="tp_subpage_refresh" title="一次性补齐内容"><i class="ph ph-arrows-clockwise"></i></button>`
        : '';

    // Entering a sub-page pushes "return to home" onto the back stack.
    // Refresh re-renders skip this so the nav stack stays flat instead
    // of accumulating duplicate _showHome entries.
    if (!skipNavPush) {
        pushNav(() => _showHome());
    }

    openAppInViewport(titleHtml, html, () => {
        const root = document.getElementById('tp_subpage_root');
        if (root) {
            if (id === 'messages') {
                bindMessagesListEvents(root, data.messages || [], () => _showSubPage('messages', { skipNavPush: true }));
            } else if (id === 'browser') {
                bindBrowserListEvents(root, data.browser || {}, () => _showSubPage('browser', { skipNavPush: true }));
            } else if (id === 'album') {
                bindAlbumListEvents(root, data.album || [], () => _showSubPage('album', { skipNavPush: true }));
            }
        }
        const refreshBtn = document.getElementById('tp_subpage_refresh');
        refreshBtn?.addEventListener('click', () => _handleSubPageRefresh(id, refreshBtn));
    }, actionsHtml);
}

async function _handleSubPageRefresh(id, btn) {
    const refreshFn = SUBPAGE_REFRESH[id];
    if (!refreshFn || _refreshInFlight) return;

    // Confirm gate — the user is about to spend an LLM call, so be loud
    // about it before kicking off. Native confirm() matches the rest of
    // the project's destructive-ish confirms (literature reset etc.).
    const ok = window.confirm(_buildRefreshConfirmText(id));
    if (!ok) return;

    _refreshInFlight = true;
    btn?.classList.add('tp-header-btn-busy');

    // Snapshot which sub-page we're refreshing so a back-press during the
    // LLM call returns to the same list page after dismissLoading() pops
    // our nav entry. _showSubPage already manages its own nav semantics.
    const subPageTitle = SUBPAGE_DISPATCH[id]?.title || 'ta 的手机';
    showLoadingPage(subPageTitle, {
        hintText: '请稍等片刻片刻刻刻刻……',
        backRestoreFn: () => _showSubPage(id, { skipNavPush: true }),
    });

    try {
        const result = await refreshFn();
        // User backed out during the LLM call → loading already torn
        // down by the nav handler. Data may still have been written; we
        // surface a soft toast and stop.
        if (_activeSubPageId !== id) {
            if (result && typeof toastr !== 'undefined') {
                toastr.success(_formatRefreshToast(id, result) + '（你已经返回，下次进来看）');
            }
            return;
        }
        dismissLoading();
        if (!result) {
            if (typeof toastr !== 'undefined') toastr.warning('暂时拉不到新内容，过会再试');
            // After dismissLoading the viewport is empty — re-render the
            // sub-page so the user lands somewhere sensible.
            await _showSubPage(id, { skipNavPush: true });
            return;
        }
        if (typeof toastr !== 'undefined') toastr.success(_formatRefreshToast(id, result));
        await _showSubPage(id, { skipNavPush: true });
    } catch (e) {
        console.error(`${LOG} refresh failed for ${id}:`, e);
        if (_activeSubPageId === id) {
            dismissLoading();
            await _showSubPage(id, { skipNavPush: true });
        }
        if (typeof toastr !== 'undefined') toastr.error('刷新失败了');
    } finally {
        _refreshInFlight = false;
        if (btn && document.body.contains(btn)) {
            btn.classList.remove('tp-header-btn-busy');
            btn.innerHTML = '<i class="ph ph-arrows-clockwise"></i>';
        }
    }
}

function _buildRefreshConfirmText(id) {
    const what = {
        messages: '所有联系人的对话（补齐空的、续写已有的，可能新增 1-2 位联系人）',
        browser:  '所有还没看过的网页和搜索结果（可能新增 1-2 条浏览记录）',
        notes:    '3-5 条新备忘录追加到列表末尾',
        album:    '3-5 张新相册条目追加到列表末尾',
    }[id] || '该 sub-page 的全部内容';
    return `一次刷新会调用一次 LLM 生成：\n\n${what}\n\n确认继续吗？`;
}

function _formatRefreshToast(id, r) {
    if (id === 'messages') {
        const parts = [];
        if (r.filled) parts.push(`补齐 ${r.filled} 位`);
        if (r.extended) parts.push(`续写 ${r.extended} 位`);
        if (r.added) parts.push(`新增 ${r.added} 位`);
        return parts.length ? `消息：${parts.join('，')}` : '消息已刷新';
    }
    if (id === 'browser') {
        const parts = [];
        const fills = r.pageFills + r.bookmarkFills + r.searchFills;
        const adds = r.newPages + r.newBookmarks + r.newSearches;
        if (fills) parts.push(`补齐 ${fills} 条`);
        if (adds) parts.push(`新增 ${adds} 条`);
        return parts.length ? `浏览器：${parts.join('，')}` : '浏览器已刷新';
    }
    if (id === 'notes') return `备忘录：新增 ${r.added} 条`;
    if (id === 'album') return `相册：新增 ${r.added} 张`;
    return '已刷新';
}

// Favorites stays inline: it's 20 lines of pure runtime read from
// chatFavorites with no LLM, no per-contact detail. Splitting it into
// its own file would just be ceremony.
function _renderFavorites() {
    let favs;
    try {
        favs = getCharFavorites();
    } catch (e) {
        console.warn(`${LOG} getCharFavorites failed:`, e);
        favs = [];
    }
    if (!favs.length) {
        return emptyHtml('她还没有把你的话收藏起来', 'ph ph-bookmark-simple');
    }
    const items = favs.map(f => {
        const ts = formatTimestamp(f.favoritedAt || f.timestamp);
        return `
            <div class="tp-card tp-fav-card">
                <div class="tp-fav-body">${escapeHtml(f.content || '')}</div>
                <div class="tp-fav-meta">
                    <i class="ph ph-bookmark-simple"></i>
                    <span>${escapeHtml(ts)}</span>
                </div>
            </div>
        `;
    }).join('');
    return `<div class="tp-list">${items}</div>`;
}

// ═══════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════

function _showError(text) {
    const titleHtml = `<span class="tp-title">ta 的手机</span>`;
    const html = `
        <div class="tp-error-page tp-fade-in">
            <div class="tp-empty">
                <div class="tp-empty-icon"><i class="ph ph-warning-circle"></i></div>
                <div class="tp-empty-text">${escapeHtml(text)}</div>
            </div>
        </div>
    `;
    openAppInViewport(titleHtml, html, () => clearNav());
}

function _showInitError(text) {
    const page = document.getElementById('tp_loading_page');
    if (!page) {
        _showError(text);
        return;
    }
    page.innerHTML = `
        <div class="tp-init-error tp-fade-in">
            <div class="tp-empty">
                <div class="tp-empty-icon"><i class="ph ph-warning-circle"></i></div>
                <div class="tp-empty-text">${escapeHtml(text)}</div>
                <div class="tp-init-error-actions">
                    <button class="tp-btn tp-btn-secondary" id="tp_init_empty">先空着打开</button>
                    <button class="tp-btn tp-btn-primary" id="tp_init_retry">再试一次</button>
                </div>
            </div>
        </div>
    `;
    document.getElementById('tp_init_retry')?.addEventListener('click', () => _startGeneration());
    document.getElementById('tp_init_empty')?.addEventListener('click', () => _useEmptyShell());
}

function _closeViewport() {
    clearNav();
    stopLoadingCarousel();
    const viewport = document.getElementById('phone_app_viewport');
    if (viewport) viewport.classList.remove('app-active');
}

const HEX_RE = /^#?[0-9a-fA-F]{6}$/;

function _safeGradient(g) {
    const fromOk = g && typeof g.from === 'string' && HEX_RE.test(g.from);
    const toOk = g && typeof g.to === 'string' && HEX_RE.test(g.to);
    const angle = Number.isFinite(g?.angle) ? Math.max(0, Math.min(360, g.angle)) : DEFAULT_WALLPAPER.angle;
    return {
        from: fromOk ? _normalizeHex(g.from) : DEFAULT_WALLPAPER.from,
        to: toOk ? _normalizeHex(g.to) : DEFAULT_WALLPAPER.to,
        angle,
    };
}

function _normalizeHex(h) {
    return h.startsWith('#') ? h : `#${h}`;
}

// Stable color picker for virtual apps so the same name always lands on the
// same tile color (feels less random across re-opens).
function _virtualAppColor(name) {
    const palette = ['#ff6b9d', '#ffa94d', '#ffd43b', '#69db7c', '#4dabf7', '#9775fa', '#ff8787', '#74c0fc'];
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return palette[h % palette.length];
}
