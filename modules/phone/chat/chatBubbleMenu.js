// modules/phone/chat/chatBubbleMenu.js
// iMessage-style long-press menu for chat bubbles.
// Phase 1: stable long-press detection + emoji bar as a fixed body-mounted overlay.
// Phase 2: vertical action menu below the bubble (Copy / Edit).
// Future Phase 3 will add Delete + Reroll.

// Note: do NOT import from chatApp.js here. chatApp.js imports this file,
// and a circular dep makes named imports (functions/getters) read undefined
// during the cycle window — pointerdown handlers would throw silently.
// Action callbacks (onEdit, etc.) are injected via attachBubbleLongPress options.
// chatStorage.js is safe — it doesn't import chatApp.
import { REACTION_EMOJIS, toggleReaction } from './chatReactions.js';
import { loadChatHistory } from './chatStorage.js';
import { EMOJI_CATEGORIES, getRecentEmojis, pushRecentEmoji } from './chatEmojiData.js';

const LONG_PRESS_DELAY = 500;
const MOVE_THRESHOLD = 10;
const OVERLAY_GAP = 8;
const VIEWPORT_PAD_TOP = 60;
const VIEWPORT_PAD_BOTTOM = 60;
const VIEWPORT_PAD_H = 12;

// ── Long-press state ──
let _pressTimer = null;
let _pressStartX = 0;
let _pressStartY = 0;
let _pressRow = null;

// ── Active overlay state ──
let _activeEmojiBar = null;
let _activeActionMenu = null;
let _activeRow = null;
let _scrollHandler = null;
let _resizeHandler = null;
let _outsideHandler = null;
let _escHandler = null;

// ── Active full-emoji-picker state (separate from the bubble menu) ──
let _activeFullPicker = null;
let _activeFullPickerBackdrop = null;
let _fullPickerEscHandler = null;

// ── Configuration injected by attachBubbleLongPress ──
let _isDisabled = () => false;
const _actions = {
    onEdit: null,
    onReroll: null,
    onDelete: null,
    onReply: null,
};

// ═══════════════════════════════════════════════════════════════════════
// Action menu items
// ═══════════════════════════════════════════════════════════════════════
//
// Each item:
//   id          — used as data-action; also identifies the item in handlers
//   label       — visible text
//   icon        — Phosphor icon class suffix (e.g. 'ph-copy')
//   destructive — true paints the item in iOS system red (used for Delete)
//   visible     — (ctx) => boolean; hide the row when false
//   handler     — (ctx) => void; invoked after the menu dismisses
//
// ctx shape (built fresh in buildActionMenu + at click time):
//   { msg, msgIndex, isLastMessage, isLastCharMessage }
const ACTION_ITEMS = [
    {
        id: 'reply',
        label: '引用回复',
        icon: 'ph-arrow-bend-up-left',
        visible: () => true,
        handler: (ctx) => { _actions.onReply?.(ctx.msgIndex); },
    },
    {
        id: 'copy',
        label: '复制',
        icon: 'ph-copy',
        visible: (ctx) => isTextLikeBubble(ctx.msg) && hasCopyableText(ctx.msg),
        handler: (ctx) => copyMessageText(ctx.msg),
    },
    {
        id: 'edit',
        label: '编辑',
        icon: 'ph-pencil-simple',
        visible: () => true,
        handler: (ctx) => { _actions.onEdit?.(ctx.msgIndex); },
    },
    {
        id: 'reroll',
        label: '重新生成',
        icon: 'ph-arrows-clockwise',
        // Only the tail char message can be re-rolled — rerollLastMessage's
        // contract is "drop trailing AI replies, regenerate". Showing it on
        // mid-history bubbles would lie about what the click does.
        visible: (ctx) => ctx.isLastCharMessage,
        handler: () => { _actions.onReroll?.(); },
    },
    {
        id: 'delete',
        label: '删除',
        icon: 'ph-trash',
        destructive: true,
        visible: () => true,
        handler: (ctx) => { _actions.onDelete?.(ctx.msgIndex); },
    },
];

function buildMenuContext(msgIndex) {
    const history = loadChatHistory();
    const msg = history[msgIndex];
    const last = history.length - 1;
    return {
        msg,
        msgIndex,
        isLastMessage: msgIndex === last,
        isLastCharMessage: msgIndex === last && msg?.role === 'char',
    };
}

function isTextLikeBubble(msg) {
    if (!msg) return false;
    // image / voice bubbles set msg.special
    return !msg.special;
}

function hasCopyableText(msg) {
    if (!msg?.content) return false;
    if (msg.content === '[撤回了一条消息]') return false;
    if (msg.content === '[图片]') return false;
    return msg.content.trim().length > 0;
}

async function copyMessageText(msg) {
    const text = msg?.content || '';
    if (!text) {
        if (typeof toastr !== 'undefined') toastr.warning('没有可复制的内容');
        return;
    }
    try {
        await navigator.clipboard.writeText(text);
        if (typeof toastr !== 'undefined') toastr.success('已复制');
        return;
    } catch (_) {
        // Fall through to legacy fallback (mobile Safari without secure context,
        // or permissions denied).
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '0';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
    ta.remove();
    if (typeof toastr !== 'undefined') {
        if (ok) toastr.success('已复制');
        else toastr.error('复制失败');
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════

/**
 * Attach long-press detection to a chat messages container.
 * Idempotent per container.
 *
 * @param {HTMLElement} messagesArea
 * @param {{
 *   isDisabled?: () => boolean,
 *   onEdit?: (msgIndex: number) => void,
 *   onReroll?: () => void,
 *   onDelete?: (msgIndex: number) => void,
 *   onReply?: (msgIndex: number) => void,
 * }} [options]
 *   isDisabled — return true when long-press should be a no-op
 *     (e.g. while delete-mode / edit-mode is active).
 *   onEdit / onReroll / onDelete / onReply — invoked when the user taps the
 *     matching action. Passed via options instead of imported directly to
 *     keep this module out of the chatApp ⇄ chatEditDelete import cycle.
 */
export function attachBubbleLongPress(messagesArea, options = {}) {
    if (!messagesArea) return;
    if (options.isDisabled) _isDisabled = options.isDisabled;
    if (options.onEdit) _actions.onEdit = options.onEdit;
    if (options.onReroll) _actions.onReroll = options.onReroll;
    if (options.onDelete) _actions.onDelete = options.onDelete;
    if (options.onReply) _actions.onReply = options.onReply;
    if (messagesArea.dataset.bubbleLongPressBound === '1') return;
    messagesArea.dataset.bubbleLongPressBound = '1';

    messagesArea.addEventListener('pointerdown', onPointerDown);
    messagesArea.addEventListener('pointerup', cancelPress);
    messagesArea.addEventListener('pointercancel', cancelPress);
    messagesArea.addEventListener('pointerleave', cancelPress);
    messagesArea.addEventListener('contextmenu', onContextMenu);
}

/**
 * Programmatically dismiss the active long-press menu (if any).
 * Also dismisses the full emoji picker so callers don't have to track
 * which overlay is currently open.
 */
export function dismissBubbleMenu() {
    if (_activeEmojiBar) {
        _activeEmojiBar.remove();
        _activeEmojiBar = null;
    }
    if (_activeActionMenu) {
        _activeActionMenu.remove();
        _activeActionMenu = null;
    }
    _activeRow = null;
    unbindDismissListeners();
    dismissFullEmojiPicker();
}

// ═══════════════════════════════════════════════════════════════════════
// Long-press detection
// ═══════════════════════════════════════════════════════════════════════

function onPointerDown(e) {
    if (_isDisabled()) return;
    const row = e.target.closest('.chat-bubble-row[data-msg-index]');
    if (!row) return;
    // Skip interactive children that have their own click semantics.
    if (e.target.closest('button, a, .chat-reaction-badge')) return;

    _pressRow = row;
    _pressStartX = e.clientX;
    _pressStartY = e.clientY;

    row.style.userSelect = 'none';
    row.style.webkitUserSelect = 'none';
    row.style.webkitTouchCallout = 'none';

    clearTimeout(_pressTimer);
    _pressTimer = setTimeout(() => onLongPressFired(row), LONG_PRESS_DELAY);
}

function cancelPress() {
    clearTimeout(_pressTimer);
    _pressTimer = null;
    if (_pressRow) {
        _pressRow.style.userSelect = '';
        _pressRow.style.webkitUserSelect = '';
        _pressRow.style.webkitTouchCallout = '';
        _pressRow = null;
    }
}

function onContextMenu(e) {
    // Block native right-click / iOS Safari long-press menu on bubble rows.
    if (e.target.closest('.chat-bubble-row[data-msg-index]')) {
        e.preventDefault();
    }
}

function onLongPressFired(row) {
    const idx = parseInt(row.dataset.msgIndex, 10);
    if (Number.isNaN(idx)) return;

    // Release press tracking; the row's selection styles got cleared by the
    // upcoming pointerup naturally, but our timer-mediated state is done.
    if (_pressRow === row) {
        row.style.userSelect = '';
        row.style.webkitUserSelect = '';
        row.style.webkitTouchCallout = '';
        _pressRow = null;
    }

    showBubbleMenu(idx, row);

    // Swallow the very next click so chatApp's click delegate (thought toggle,
    // image bubble lightbox, etc.) doesn't fire on the same gesture.
    // Not all browsers fire a click after a long-press (touch can skip it).
    // If none arrives, the fallback timeout detaches the listener so it
    // doesn't accidentally swallow the user's next intentional click
    // (e.g. tapping an emoji inside the picker we just opened).
    const swallowOnce = (e) => {
        e.stopPropagation();
        e.preventDefault();
        cleanup();
    };
    const cleanup = () => {
        document.removeEventListener('click', swallowOnce, true);
        clearTimeout(timeoutId);
    };
    document.addEventListener('click', swallowOnce, true);
    const timeoutId = setTimeout(cleanup, 300);
}

// ═══════════════════════════════════════════════════════════════════════
// Overlay rendering & positioning
// ═══════════════════════════════════════════════════════════════════════

function showBubbleMenu(msgIndex, rowElement) {
    dismissBubbleMenu();

    const isDark = !!document.querySelector('.phone-container.phone-dark-mode');

    const emojiBar = buildEmojiBar(msgIndex, isDark);
    const actionMenu = buildActionMenu(msgIndex, isDark);

    document.body.appendChild(emojiBar);
    if (actionMenu) document.body.appendChild(actionMenu);

    _activeEmojiBar = emojiBar;
    _activeActionMenu = actionMenu;
    _activeRow = rowElement;

    // Position after mount so offsetWidth/offsetHeight are measurable.
    positionOverlays(emojiBar, actionMenu, rowElement);

    requestAnimationFrame(() => {
        emojiBar.classList.add('visible');
        actionMenu?.classList.add('visible');
    });

    bindDismissListeners();
}

function buildEmojiBar(msgIndex, isDark) {
    const overlay = document.createElement('div');
    overlay.className = 'chat-reaction-picker chat-bubble-overlay';
    overlay.dataset.msgIndex = String(msgIndex);
    // .phone-container hosts the dark-mode class, but our overlay lives on
    // <body> (the container has a transform that would break fixed-positioning).
    // Mirror the flag onto the overlay so its dark theme still applies.
    if (isDark) overlay.classList.add('dark');
    // 6 quick emojis + a trailing "+" button that opens the full picker.
    const quickButtons = REACTION_EMOJIS.map(em =>
        `<button class="chat-reaction-emoji" data-emoji="${em}" data-msg-index="${msgIndex}">${em}</button>`
    ).join('');
    const moreButton = `<button class="chat-reaction-emoji chat-reaction-more" data-action="more" data-msg-index="${msgIndex}" aria-label="更多表情"><i class="ph ph-plus"></i></button>`;
    overlay.innerHTML = quickButtons + moreButton;

    overlay.addEventListener('click', (e) => {
        const moreBtn = e.target.closest('.chat-reaction-more');
        if (moreBtn) {
            e.stopPropagation();
            // Close the long-press menu first, then open the full picker.
            dismissBubbleMenu();
            showFullEmojiPicker(msgIndex, isDark);
            return;
        }
        const btn = e.target.closest('.chat-reaction-emoji');
        if (!btn) return;
        e.stopPropagation();
        toggleReaction(msgIndex, btn.dataset.emoji);
        pushRecentEmoji(btn.dataset.emoji);
        dismissBubbleMenu();
    });

    return overlay;
}

// ═══════════════════════════════════════════════════════════════════════
// Full emoji picker (opened via the "+" button on the quick bar)
// ═══════════════════════════════════════════════════════════════════════

function dismissFullEmojiPicker() {
    if (_activeFullPicker) {
        _activeFullPicker.remove();
        _activeFullPicker = null;
    }
    if (_activeFullPickerBackdrop) {
        _activeFullPickerBackdrop.remove();
        _activeFullPickerBackdrop = null;
    }
    if (_fullPickerEscHandler) {
        document.removeEventListener('keydown', _fullPickerEscHandler);
        _fullPickerEscHandler = null;
    }
}

function showFullEmojiPicker(msgIndex, isDark) {
    dismissFullEmojiPicker();

    const recent = getRecentEmojis();
    // Categories shown in the tab bar — "recent" is virtual, added only if
    // the user has tapped at least one emoji before.
    const tabs = [];
    if (recent.length > 0) {
        tabs.push({ id: 'recent', label: '最近', icon: 'ph-clock-counter-clockwise', emojis: recent });
    }
    tabs.push(...EMOJI_CATEGORIES);

    const backdrop = document.createElement('div');
    backdrop.className = 'chat-emoji-picker-backdrop';
    if (isDark) backdrop.classList.add('dark');

    const panel = document.createElement('div');
    panel.className = 'chat-emoji-picker-full';
    if (isDark) panel.classList.add('dark');
    panel.dataset.msgIndex = String(msgIndex);

    // Header: title + close
    const header = `
        <div class="chat-emoji-picker-header">
            <span class="chat-emoji-picker-title">选择表情</span>
            <button class="chat-emoji-picker-close" aria-label="关闭"><i class="ph ph-x"></i></button>
        </div>`;

    // Tabs row (sticky, bottom of panel)
    const tabsHtml = tabs.map((cat, i) =>
        `<button class="chat-emoji-picker-tab${i === 0 ? ' active' : ''}" data-tab="${cat.id}" aria-label="${cat.label}"><i class="ph ${cat.icon}"></i></button>`
    ).join('');

    // Grid — one inner section per category. Active by display: switch on tab click.
    const gridHtml = tabs.map((cat, i) => `
        <div class="chat-emoji-picker-section${i === 0 ? ' active' : ''}" data-section="${cat.id}">
            <div class="chat-emoji-picker-section-label">${cat.label}</div>
            <div class="chat-emoji-picker-grid">
                ${cat.emojis.map(em => `<button class="chat-emoji-picker-cell" data-emoji="${em}">${em}</button>`).join('')}
            </div>
        </div>`).join('');

    panel.innerHTML = `
        ${header}
        <div class="chat-emoji-picker-body">${gridHtml}</div>
        <div class="chat-emoji-picker-tabs">${tabsHtml}</div>
    `;

    // Wire up: close button, tab switching, emoji cell click
    panel.addEventListener('click', (e) => {
        if (e.target.closest('.chat-emoji-picker-close')) {
            e.stopPropagation();
            dismissFullEmojiPicker();
            return;
        }

        const tabBtn = e.target.closest('.chat-emoji-picker-tab');
        if (tabBtn) {
            e.stopPropagation();
            const tabId = tabBtn.dataset.tab;
            panel.querySelectorAll('.chat-emoji-picker-tab').forEach(b => b.classList.toggle('active', b === tabBtn));
            panel.querySelectorAll('.chat-emoji-picker-section').forEach(s => s.classList.toggle('active', s.dataset.section === tabId));
            // Scroll body back to top when switching tabs.
            const body = panel.querySelector('.chat-emoji-picker-body');
            if (body) body.scrollTop = 0;
            return;
        }

        const cell = e.target.closest('.chat-emoji-picker-cell');
        if (cell) {
            e.stopPropagation();
            const emoji = cell.dataset.emoji;
            if (emoji) {
                toggleReaction(msgIndex, emoji);
                pushRecentEmoji(emoji);
            }
            dismissFullEmojiPicker();
        }
    });

    // Backdrop click closes the picker
    backdrop.addEventListener('click', () => dismissFullEmojiPicker());

    document.body.appendChild(backdrop);
    document.body.appendChild(panel);
    _activeFullPicker = panel;
    _activeFullPickerBackdrop = backdrop;

    // Position the panel against the viewport AFTER mount so offsetWidth/Height
    // are measurable. Using explicit top/left in pixels avoids the mobile bug
    // where `bottom: 0` resolves against a transformed ancestor instead of the
    // viewport (see comment in chat.css for full picker styles).
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = panel.offsetWidth;
    const h = panel.offsetHeight;
    panel.style.left = `${Math.max(0, Math.round((vw - w) / 2))}px`;
    panel.style.top = `${Math.max(0, vh - h)}px`;
    // Feed the panel's height to the slide-up animation so it rises from
    // exactly its own height below the final position (full bottom-sheet feel).
    panel.style.setProperty('--picker-h', `${h}px`);

    // Esc to dismiss
    _fullPickerEscHandler = (e) => {
        if (e.key === 'Escape') dismissFullEmojiPicker();
    };
    document.addEventListener('keydown', _fullPickerEscHandler);

    requestAnimationFrame(() => {
        backdrop.classList.add('visible');
        panel.classList.add('visible');
    });
}

function buildActionMenu(msgIndex, isDark) {
    const ctx = buildMenuContext(msgIndex);
    if (!ctx.msg) return null;

    const items = ACTION_ITEMS.filter(item => {
        try { return item.visible(ctx); }
        catch (_) { return false; }
    });
    if (items.length === 0) return null;

    const overlay = document.createElement('div');
    overlay.className = 'chat-bubble-menu chat-bubble-overlay';
    overlay.dataset.msgIndex = String(msgIndex);
    if (isDark) overlay.classList.add('dark');
    overlay.innerHTML = items.map(item => {
        const cls = item.destructive
            ? 'chat-bubble-menu-item destructive'
            : 'chat-bubble-menu-item';
        return `
            <button class="${cls}" data-action="${item.id}">
                <span class="chat-bubble-menu-label">${item.label}</span>
                <i class="ph ${item.icon} chat-bubble-menu-icon"></i>
            </button>`;
    }).join('');

    overlay.addEventListener('click', (e) => {
        const btn = e.target.closest('.chat-bubble-menu-item');
        if (!btn) return;
        e.stopPropagation();
        const id = btn.dataset.action;
        const item = ACTION_ITEMS.find(i => i.id === id);
        if (!item) return;
        // Dismiss BEFORE invoking so the menu is gone before any follow-up UI
        // (edit overlay, delete-mode toolbar, etc.) takes over. The handler
        // may also open its own dialog — stacked floating layers look messy.
        // Re-read history because it may have changed since the menu opened
        // (e.g. an AI reply landed mid-press).
        const freshCtx = buildMenuContext(msgIndex);
        dismissBubbleMenu();
        try { item.handler(freshCtx); }
        catch (err) { console.warn('[BubbleMenu] action failed:', id, err); }
    });

    return overlay;
}

function positionOverlays(emojiBar, actionMenu, row) {
    const rect = row.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const isUser = row.classList.contains('user');

    const eW = emojiBar?.offsetWidth || 0;
    const eH = emojiBar?.offsetHeight || 0;
    const mW = actionMenu?.offsetWidth || 0;
    const mH = actionMenu?.offsetHeight || 0;

    // Decide each overlay's side independently.
    // Emoji bar: above the bubble by default; flip below if it'd hit the
    // top viewport edge (covered by chat header / status bar).
    const emojiSide = (rect.top - eH - OVERLAY_GAP >= VIEWPORT_PAD_TOP)
        ? 'above' : 'below';
    // Action menu: below the bubble by default; flip above if it'd hit the
    // bottom edge (covered by the input bar).
    const menuSide = actionMenu
        ? ((rect.bottom + mH + OVERLAY_GAP <= vh - VIEWPORT_PAD_BOTTOM)
            ? 'below' : 'above')
        : null;

    // Compute vertical positions, stacking when both ended up on the same side.
    let emojiTop, menuTop;
    if (menuSide === 'below' && emojiSide === 'above') {
        // Default layout: emoji up, menu down.
        emojiTop = rect.top - eH - OVERLAY_GAP;
        menuTop = rect.bottom + OVERLAY_GAP;
    } else if (menuSide === 'below' && emojiSide === 'below') {
        // Both below — emoji closer to bubble.
        emojiTop = rect.bottom + OVERLAY_GAP;
        menuTop = emojiTop + eH + OVERLAY_GAP;
    } else if (menuSide === 'above' && emojiSide === 'above') {
        // Both above — menu closer to bubble.
        menuTop = rect.top - mH - OVERLAY_GAP;
        emojiTop = menuTop - eH - OVERLAY_GAP;
    } else if (menuSide === 'above' && emojiSide === 'below') {
        // Bubble fills the viewport — fall back to default sides and let them
        // overlap rather than stacking awkwardly. (Phase 4 will refine this.)
        emojiTop = rect.top - eH - OVERLAY_GAP;
        menuTop = rect.bottom + OVERLAY_GAP;
    } else {
        // No action menu — just place the emoji bar.
        emojiTop = (emojiSide === 'above')
            ? rect.top - eH - OVERLAY_GAP
            : rect.bottom + OVERLAY_GAP;
    }

    // Horizontal: anchor each overlay to the bubble's near side, clamp to viewport.
    const horizPos = (w) => {
        let x = isUser ? rect.right - w : rect.left;
        if (x < VIEWPORT_PAD_H) x = VIEWPORT_PAD_H;
        if (x + w > vw - VIEWPORT_PAD_H) x = vw - VIEWPORT_PAD_H - w;
        return x;
    };

    if (emojiBar) {
        emojiBar.style.top = `${emojiTop}px`;
        emojiBar.style.left = `${horizPos(eW)}px`;
    }
    if (actionMenu) {
        actionMenu.style.top = `${menuTop}px`;
        actionMenu.style.left = `${horizPos(mW)}px`;
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Dismiss triggers
// ═══════════════════════════════════════════════════════════════════════

function bindDismissListeners() {
    const messagesArea = document.getElementById('chat_messages_area');

    _scrollHandler = () => dismissBubbleMenu();
    if (messagesArea) messagesArea.addEventListener('scroll', _scrollHandler, { passive: true });

    _resizeHandler = () => dismissBubbleMenu();
    window.addEventListener('resize', _resizeHandler);

    _escHandler = (e) => {
        if (e.key === 'Escape') dismissBubbleMenu();
    };
    document.addEventListener('keydown', _escHandler);

    // Outside-pointer dismiss — defer to next task so the gesture that opened
    // the overlay doesn't immediately close it on pointerup.
    setTimeout(() => {
        if (!_activeEmojiBar && !_activeActionMenu) return;
        _outsideHandler = (e) => {
            if (!_activeEmojiBar && !_activeActionMenu) return;
            // .chat-bubble-overlay covers both emoji bar and action menu.
            if (e.target.closest('.chat-bubble-overlay')) return;
            dismissBubbleMenu();
        };
        document.addEventListener('pointerdown', _outsideHandler, true);
    }, 0);
}

function unbindDismissListeners() {
    if (_scrollHandler) {
        const messagesArea = document.getElementById('chat_messages_area');
        if (messagesArea) messagesArea.removeEventListener('scroll', _scrollHandler);
        _scrollHandler = null;
    }
    if (_resizeHandler) {
        window.removeEventListener('resize', _resizeHandler);
        _resizeHandler = null;
    }
    if (_escHandler) {
        document.removeEventListener('keydown', _escHandler);
        _escHandler = null;
    }
    if (_outsideHandler) {
        document.removeEventListener('pointerdown', _outsideHandler, true);
        _outsideHandler = null;
    }
}
