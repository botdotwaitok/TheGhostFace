// modules/phone/discord/discordBubbleMenu.js
// Discord-flavored long-press context menu for channel messages.
//
// This mirrors the *interaction skeleton* of chat/chatBubbleMenu.js (stable
// long-press detection, clean dismiss, grace-period guard) but keeps Discord's
// own single-card visual layout (.dc-context-menu / .dc-ctx-* styles) — the
// reactions row + reply + delete card, not chat's split emoji-bar/action-menu.
//
// Phase 1: extract the existing long-press + render logic into this module,
// behavior-for-behavior. Smart flip positioning / swallow-next-click / .visible
// transitions land in Phase 2.
//
// Like chatBubbleMenu, the data actions are INJECTED via attach options rather
// than imported, because _addReactionToMessage / _setReplyTo / _deleteMessage
// are module-private to discordChannel.js and importing them would create a
// circular dependency. getQuickReactions is safe to import directly
// (discordEmoji.js doesn't import discordChannel).
import { getQuickReactions } from './discordEmoji.js';

const LONG_PRESS_DELAY = 500;
// If the finger moves past this before the timer fires, it's a scroll or a
// swipe-to-reply — not a long press — so cancel the pending menu.
const MOVE_THRESHOLD = 10;
// Gap kept between the menu and the page edges when positioning.
const EDGE_PAD = 8;

// ── Long-press state ──
let _pressTimer = null;
let _pressStartX = 0;
let _pressStartY = 0;
let _pressMsgEl = null;

// ── Active overlay state ──
let _activeMenu = null;
let _activeBackdrop = null;
// Timestamp of the most recent dismissal — feeds isDiscordBubbleMenuActiveOrRecent
// so a tap that lands right after the menu closes doesn't fall through to the
// message row's own click handlers (reaction pill, avatar edit, etc.).
let _menuDismissedAt = 0;
const MENU_GRACE_MS = 400;

// ── Configuration injected by attachDiscordBubbleLongPress ──
const _cfg = {
    isDisabled: () => false,
    // (msgId) => { msg, isMine } | null
    resolveMsg: null,
    onReply: null,
    onDelete: null,
    onReact: null,
    onStickerMore: null,
};

// ═══════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════

/**
 * Attach long-press / right-click detection to a channel messages container.
 * Idempotent per container element.
 *
 * @param {HTMLElement} container
 * @param {{
 *   isDisabled?: () => boolean,
 *   resolveMsg?: (msgId: string) => ({ msg: object, isMine: boolean } | null),
 *   onReply?: (msgId: string) => void,
 *   onDelete?: (msgId: string) => void,
 *   onReact?: (msgId: string, emoji: string) => void,
 *   onStickerMore?: (msgId: string) => void,
 * }} [options]
 */
export function attachDiscordBubbleLongPress(container, options = {}) {
    if (!container) return;
    // Always refresh callbacks — they close over the live _currentChannelId in
    // discordChannel, and the container is rebuilt on each channel open.
    Object.assign(_cfg, options);
    if (container.dataset.dcBubbleLongPressBound === '1') return;
    container.dataset.dcBubbleLongPressBound = '1';

    container.addEventListener('pointerdown', onPointerDown);
    container.addEventListener('pointermove', onPointerMove);
    container.addEventListener('pointerup', cancelDiscordLongPress);
    container.addEventListener('pointercancel', cancelDiscordLongPress);
    container.addEventListener('pointerleave', cancelDiscordLongPress);
    container.addEventListener('contextmenu', onContextMenu);
}

/** Programmatically dismiss the active context menu (if any). */
export function dismissDiscordBubbleMenu() {
    const wasActive = !!_activeMenu;
    const menu = _activeMenu;
    const backdrop = _activeBackdrop;
    // Detach references first so a menu opened during the exit animation isn't
    // clobbered by the trailing removal below.
    _activeMenu = null;
    _activeBackdrop = null;
    if (menu) {
        // Play the exit transition, then remove. Matches the 0.15s in CSS.
        menu.classList.remove('visible');
        setTimeout(() => menu.remove(), 150);
    }
    // Backdrop is transparent — no exit animation needed.
    if (backdrop) backdrop.remove();
    if (wasActive) _menuDismissedAt = Date.now();
}

/**
 * True while the menu is open, or briefly after dismissal. The swipe-to-reply
 * gesture and other click delegates in discordChannel use this to stay out of
 * the way of the long-press gesture.
 */
export function isDiscordBubbleMenuActiveOrRecent() {
    if (_activeMenu) return true;
    return (Date.now() - _menuDismissedAt) < MENU_GRACE_MS;
}

/** Abort a pending long-press (called by the swipe gesture when it locks horizontal). */
export function cancelDiscordLongPress() {
    clearTimeout(_pressTimer);
    _pressTimer = null;
    _clearPressStyles();
}

// ═══════════════════════════════════════════════════════════════════════
// Long-press detection
// ═══════════════════════════════════════════════════════════════════════

function onPointerDown(e) {
    if (_cfg.isDisabled?.()) return;
    const msgEl = e.target.closest('.dc-message');
    if (!msgEl) return;

    _pressMsgEl = msgEl;
    _pressStartX = e.clientX;
    _pressStartY = e.clientY;

    // Suppress text selection / iOS long-press callout while holding.
    msgEl.style.userSelect = 'none';
    msgEl.style.webkitUserSelect = 'none';
    msgEl.style.webkitTouchCallout = 'none';

    clearTimeout(_pressTimer);
    _pressTimer = setTimeout(() => fireLongPress(msgEl, e), LONG_PRESS_DELAY);
}

function onPointerMove(e) {
    if (!_pressTimer) return;
    const dx = Math.abs(e.clientX - _pressStartX);
    const dy = Math.abs(e.clientY - _pressStartY);
    if (dx > MOVE_THRESHOLD || dy > MOVE_THRESHOLD) {
        // Finger drifted — this is a scroll / swipe, not a long press.
        cancelDiscordLongPress();
    }
}

function fireLongPress(msgEl, event) {
    _clearPressStyles();
    showMenu(msgEl, event);

    // Swallow the very next click so the gesture that opened the menu doesn't
    // fall through to the message row's own click delegate (reaction pill,
    // image lightbox, spoiler, avatar edit). Touch often skips the click
    // entirely; the 300ms fallback detaches the listener so it doesn't eat the
    // user's next intentional tap (e.g. on a menu item).
    const swallowOnce = (ev) => {
        ev.stopPropagation();
        ev.preventDefault();
        cleanup();
    };
    const cleanup = () => {
        document.removeEventListener('click', swallowOnce, true);
        clearTimeout(timeoutId);
    };
    document.addEventListener('click', swallowOnce, true);
    const timeoutId = setTimeout(cleanup, 300);
}

function _clearPressStyles() {
    if (_pressMsgEl) {
        _pressMsgEl.style.userSelect = '';
        _pressMsgEl.style.webkitUserSelect = '';
        _pressMsgEl.style.webkitTouchCallout = '';
        _pressMsgEl = null;
    }
}

function onContextMenu(e) {
    const msgEl = e.target.closest('.dc-message');
    if (!msgEl) return;
    // Block the native right-click / iOS Safari menu on message rows.
    e.preventDefault();
    if (_cfg.isDisabled?.()) return;
    cancelDiscordLongPress();
    showMenu(msgEl, e);
}

// ═══════════════════════════════════════════════════════════════════════
// Menu render & positioning
// ═══════════════════════════════════════════════════════════════════════

function showMenu(msgEl, event) {
    dismissDiscordBubbleMenu();

    const page = document.getElementById('dc_channel_page');
    if (!page) return;

    const msgId = msgEl.dataset.msgId;
    const resolved = _cfg.resolveMsg?.(msgId);
    if (!resolved || !resolved.msg) return;

    const menu = buildMenu(msgId, resolved.isMine);

    // Transparent backdrop captures dismiss taps. Appended first so the menu
    // (later in DOM, higher z-index) sits on top.
    const backdrop = document.createElement('div');
    backdrop.className = 'dc-context-backdrop';
    backdrop.style.display = 'block';
    backdrop.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dismissDiscordBubbleMenu();
    });

    page.appendChild(backdrop);
    page.appendChild(menu);
    _activeMenu = menu;
    _activeBackdrop = backdrop;

    // Measure + place while still at opacity 0, then fade/scale in next frame.
    positionMenu(menu, event, page);
    requestAnimationFrame(() => menu.classList.add('visible'));
}

function buildMenu(msgId, isMine) {
    const menu = document.createElement('div');
    menu.className = 'dc-context-menu';
    menu.dataset.msgId = msgId;

    const quickReactionHtml = getQuickReactions().map(emoji =>
        `<div class="dc-ctx-reaction" data-emoji="${emoji}" data-msg-id="${msgId}">${emoji}</div>`
    ).join('');

    let html = `
        <div class="dc-ctx-reactions-row">
            ${quickReactionHtml}
            <div class="dc-ctx-reaction dc-ctx-reaction-more" data-action="reaction-more" data-msg-id="${msgId}">
                <i class="ph ph-sticker"></i>
            </div>
        </div>
        <div class="dc-ctx-divider"></div>
        <div class="dc-ctx-item" data-action="reply" data-msg-id="${msgId}">
            <i class="ph ph-arrow-bend-up-left"></i>
            <span>回复</span>
        </div>
    `;
    if (isMine) {
        html += `
            <div class="dc-ctx-item dc-ctx-danger" data-action="delete" data-msg-id="${msgId}">
                <i class="ph ph-trash"></i>
                <span>删除消息</span>
            </div>
        `;
    }
    menu.innerHTML = html;

    menu.addEventListener('click', (e) => {
        const reactionEl = e.target.closest('.dc-ctx-reaction');
        if (reactionEl) {
            e.stopPropagation();
            if (reactionEl.classList.contains('dc-ctx-reaction-more')) {
                // Close the menu first, then hand off to the sticker panel.
                dismissDiscordBubbleMenu();
                _cfg.onStickerMore?.(msgId);
            } else {
                _cfg.onReact?.(msgId, reactionEl.dataset.emoji);
                dismissDiscordBubbleMenu();
            }
            return;
        }
        const item = e.target.closest('.dc-ctx-item');
        if (!item) return;
        e.stopPropagation();
        const action = item.dataset.action;
        dismissDiscordBubbleMenu();
        if (action === 'reply') _cfg.onReply?.(msgId);
        else if (action === 'delete') _cfg.onDelete?.(msgId);
    });

    return menu;
}

function positionMenu(menu, event, page) {
    const pageRect = page.getBoundingClientRect();
    // Anchor at the press point, in page-local coordinates.
    const anchorX = event.clientX - pageRect.left;
    const anchorY = event.clientY - pageRect.top;

    // Real measured size (transform/scale doesn't affect offset*).
    const mW = menu.offsetWidth;
    const mH = menu.offsetHeight;

    // Horizontal: open rightward from the anchor, clamp inside the page.
    let left = anchorX;
    if (left + mW > pageRect.width - EDGE_PAD) left = pageRect.width - EDGE_PAD - mW;
    if (left < EDGE_PAD) left = EDGE_PAD;

    // Vertical: open downward by default; flip above the anchor if it would
    // overflow the bottom edge, then clamp to the top.
    let top = anchorY;
    if (top + mH > pageRect.height - EDGE_PAD) top = anchorY - mH;
    if (top < EDGE_PAD) top = EDGE_PAD;

    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;
}
