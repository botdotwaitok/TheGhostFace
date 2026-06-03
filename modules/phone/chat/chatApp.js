// modules/phone/chat/chatApp.js — iMessage-style Chat App
// Entry point + shared state center for the chat feature.
// Sub-modules import getters/setters from here to access shared state.

import { openAppInViewport, updateAppBadge } from '../phoneController.js';
import {
    loadChatHistory,
    getCharacterInfo,
    getCharacterDisplayName, loadCharacterNickname, saveCharacterNickname,
    buildReplySnippet,
    ensureChatHistoryReady,
} from './chatStorage.js';
import {
    consumePendingResult, consumeError,
    isBackgroundGenerating, hasPendingResult, hasError,
    cancelGeneration,
} from './backgroundGen.js';
import { hasAutoMessagePending, consumeAutoMessages } from './autoMessage.js';
import { openVoiceCall } from '../voiceCall/voiceCallUI.js';
import { isKeepAliveEnabled, setKeepAliveEnabled, startKeepAlive, stopKeepAlive } from '../keepAlive.js';

// ── Sub-module imports ──
import { buildChatPage, buildMessagesAreaInner, CHAT_DISPLAY_COUNT, computeChatWindow, attachBubbleTailObserver } from './chatHtmlBuilder.js';
import {
    addPendingMessage, sendAllMessages,
    handleResponseReady, handleRetryEvent,
    handleAutoMessageReady, renderAutoMessages, renderDraftArea,
    renderResponseToDom, handleCallDeclined,
} from './chatMessageHandler.js';
import {
    toggleDeleteMode, toggleSelectMessage, updateDeleteToolbar, handleBatchDelete,
    openEditOverlay, closeEditOverlay, handleEditSave,
    rerollLastMessage, selectMessageForDeletion,
} from './chatEditDelete.js';
import { toggleReaction } from './chatReactions.js';
import { attachBubbleLongPress, isBubbleMenuActiveOrRecent } from './chatBubbleMenu.js';
import { renderBuffBar, renderChatInventory, handleReturnHome, handleManualSummarize } from './chatInventory.js';
import { beginRecording } from './chatVoice.js';
import { handleImageSelection, showImageLightbox } from './chatImage.js';
import { handleVoicePlayback } from './chatVoice.js';
import {
    applyChatBackground, uploadChatBackground, clearChatBackground, hasChatBackground,
} from './chatBackground.js';
import { openChatSettingsPage } from './chatSettings.js';

// ═══════════════════════════════════════════════════════════════════════
// Shared State
// ═══════════════════════════════════════════════════════════════════════

let pendingMessages = [];          // Array of { text, replyTo } payloads queued before sending
let isGenerating = false;          // Lock to prevent double sends
let isDeleteMode = false;          // Delete-mode toggle
let selectedForDeletion = new Set(); // Batch-select indices for deletion
let isEditMode = false;            // Edit-mode toggle
let selectedEditIndex = -1;        // Which message is being edited
let _overlayOpenedAt = 0;          // Timestamp guard for overlay dismiss
let _responseReadyHandler = null;  // Stored reference for cleanup
let _retryHandler = null;          // Stored reference for cleanup
let _autoMsgHandler = null;        // Stored reference for cleanup
let _callDeclinedHandler = null;   // Stored reference for cleanup
let _pendingImageData = null;      // { base64, thumbnail, fileName } | null
// Reply target for the NEXT message about to be drafted. Cleared after the
// draft is pushed onto pendingMessages so each draft captures its own snapshot.
// Shape: { role: 'user'|'char', snippet: string } | null
let _pendingReplyTo = null;

// Anchor-window state — the inclusive [startIdx, endIdx] slice of chat history
// currently rendered into messagesArea. Tracked so search-jump can land on
// arbitrarily old messages WITHOUT mounting every bubble between target and
// tail (a 10k-message scrollback would otherwise paint ~10k DOM nodes). The
// "older / newer" load buttons each shift one end of the window outward.
//
// Maintained by:
//   - openChatApp + rerenderMessagesArea  → reset window after full repaint
//   - load-more / load-newer click handlers → shift one end
//   - chatMessageHandler ensureWindowAtTail → snap back to tail before append
//
// Default sentinel (endIdx < startIdx) marks "not yet committed" — any
// isWindowAtTail() check on the sentinel returns false so the very first
// append after page boot still triggers a full repaint instead of writing
// into an unmounted window.
let _chatWindow = { startIdx: 0, endIdx: -1 };

export const CHAT_LOG_PREFIX = '[聊天]';

// ── State Getters / Setters (for sub-modules) ──

export function getPendingMessages() { return pendingMessages; }
export function setPendingMessages(v) { pendingMessages = v; }
export function getIsGenerating() { return isGenerating; }
export function setIsGenerating(v) { isGenerating = v; }
export function getIsDeleteMode() { return isDeleteMode; }
export function setIsDeleteMode(v) { isDeleteMode = v; }
export function getSelectedForDeletion() { return selectedForDeletion; }
export function getIsEditMode() { return isEditMode; }
export function setIsEditMode(v) { isEditMode = v; }
export function getSelectedEditIndex() { return selectedEditIndex; }
export function setSelectedEditIndex(v) { selectedEditIndex = v; }
export function getPendingImageData() { return _pendingImageData; }
export function setPendingImageData(v) { _pendingImageData = v; }
export function getPendingReplyTo() { return _pendingReplyTo; }
export function setPendingReplyTo(v) { _pendingReplyTo = v; }
export function clearPendingReplyTo() { _pendingReplyTo = null; }

// ── Anchor-window getters / setters (for chatMessageHandler + builder) ──
export function getChatWindow() {
    return { ..._chatWindow };
}
export function setChatWindow(startIdx, endIdx) {
    _chatWindow = { startIdx, endIdx };
}

/**
 * True when the rendered window's right edge is at the latest history index.
 * Append-style DOM writes (new user msg, AI reply, auto message) MUST only
 * fire when this returns true — otherwise they'd insert into the middle of a
 * non-contiguous scrollback.
 *
 * @param {number} [historyLength] - optional override for callers who already
 *   loaded history (avoids a redundant cache lookup).
 * @returns {boolean}
 */
export function isWindowAtTail(historyLength) {
    const len = typeof historyLength === 'number' ? historyLength : loadChatHistory().length;
    if (len === 0) return true; // empty chat: nothing to be "behind"
    return _chatWindow.endIdx >= len - 1;
}

/**
 * If the user is parked in a historical anchor window (search-jump aftermath),
 * snap back to the tail before doing any append. Resets the window via
 * rerenderMessagesArea, which re-mounts the last CHAT_DISPLAY_COUNT messages
 * and scrolls to bottom.
 *
 * Two usage patterns:
 *   1. PRE-push (caller will history.push next): isWindowAtTail check uses the
 *      pre-push length, so a tail user is a no-op and a historical-window user
 *      gets a rerender of pre-push entries. Caller then pushes + manually
 *      appends bubbles + calls syncWindowToTail() to commit the new endIdx.
 *   2. POST-push (renderAutoMessages): isWindowAtTail check sees endIdx lagging
 *      behind newly-pushed entries, so rerender triggers AND repaints those
 *      entries. Caller MUST check the return value and skip its manual append
 *      loop when this returns true.
 *
 * @returns {boolean} true iff a rerender fired (caller should skip manual append)
 */
export function ensureWindowAtTail() {
    if (isWindowAtTail()) return false;
    rerenderMessagesArea(false);
    return true;
}

/**
 * Move _chatWindow.endIdx to the current last-index of history. Call this
 * AFTER manually appending new bubbles, so the anchor window state reflects
 * the DOM. Otherwise the next isWindowAtTail() check falsely returns false
 * and triggers an unnecessary rerender.
 */
export function syncWindowToTail() {
    const len = loadChatHistory().length;
    setChatWindow(_chatWindow.startIdx, len === 0 ? -1 : len - 1);
}

/**
 * Begin a reply to a history message. Snippet is captured now and frozen;
 * later edits/deletes to the original message do not propagate. Stored on
 * _pendingReplyTo until the next draft is pushed (then transferred onto
 * the payload object and cleared).
 */
export function startReplyTo(msgIndex) {
    const history = loadChatHistory();
    const msg = history[msgIndex];
    if (!msg) return;
    _pendingReplyTo = {
        role: msg.role,
        snippet: buildReplySnippet(msg),
    };
    renderDraftArea();
    const input = document.getElementById('chat_input');
    if (input) {
        input.focus();
    }
}

/**
 * Cancel a pending reply (the × on the preview bar). Input text is preserved.
 */
export function cancelReplyTo() {
    _pendingReplyTo = null;
    renderDraftArea();
}

// ═══════════════════════════════════════════════════════════════════════
// Entry Point
// ═══════════════════════════════════════════════════════════════════════

export async function openChatApp(opts = {}) {
    // Drive the external-storage cache to a ready state BEFORE reading
    // history. Without this, a page-reload race window (CHAT_CHANGED fired,
    // prewarm still awaiting readJSON over a slow remote) lets loadChatHistory
    // fall through to an empty chat_metadata and paint a blank conversation —
    // and allowStale can't rescue that case because a fresh page load starts
    // with _cacheKey = null. Cheap no-op when cache is already warm.
    await ensureChatHistoryReady();

    const history = loadChatHistory();
    pendingMessages = [];
    _pendingReplyTo = null;

    // scrollToMsgIdx is set by the search panel (chatSearch.js) when the user
    // clicks a hit. buildChatPage centers a ±CHAT_DISPLAY_COUNT anchor window
    // on the target so far-back jumps don't mount the whole scrollback.
    const scrollToMsgIdx = Number.isInteger(opts.scrollToMsgIdx) && opts.scrollToMsgIdx >= 0
        ? opts.scrollToMsgIdx
        : null;
    const html = buildChatPage(history, { scrollToMsgIdx });

    // Commit the window we just rendered into module state so subsequent
    // appends (chatMessageHandler) and load-more / load-newer clicks know
    // where the rendered slice begins and ends.
    const initialWindow = computeChatWindow(history.length, scrollToMsgIdx);
    setChatWindow(initialWindow.startIdx, initialWindow.endIdx);

    // Build custom header for chat
    const charInfo = getCharacterInfo();
    const realName = charInfo?.name || '角色';
    const displayName = getCharacterDisplayName();

    const avatarHtml = charInfo?.avatar
        ? `<img src="/characters/${encodeURIComponent(charInfo.avatar)}" alt="${escHtml(displayName)}" />`
        : `<i class="fa-solid fa-user"></i>`;

    const titleHtml = `
        <div class="chat-nav-avatar">${avatarHtml}</div>
        <div class="chat-nav-info">
            <div class="chat-nav-name" id="chat_nav_name" title="点击设置昵称（清空恢复 ${escHtml(realName)}）">${escHtml(displayName)}</div>
        </div>`;

    const actionsHtml = `
        <button class="chat-nav-btn" id="chat_menu_btn" title="更多">
            <i class="fa-solid fa-ellipsis"></i>
        </button>`;

    openAppInViewport(titleHtml, html, () => {
        resetButtonStateCache();

        // Re-sync the chatApp-local `isGenerating` flag with the background
        // module before bindChatEvents() runs updateButtonStates(). Without
        // this, leaving mid-generation (e.g. switching to Console app and
        // returning after the LLM finished) leaves the local flag stuck at
        // true, and the stop button flashes on re-entry until the
        // response-ready handler fires.
        setIsGenerating(isBackgroundGenerating());

        applyChatBackground();

        bindChatEvents();

        // iMessage bubble tails: assign on initial render and auto-reflow
        // for every subsequent insert/remove (covers all call sites that
        // append bubbles into chat_messages_area).
        attachBubbleTailObserver(document.getElementById('chat_messages_area'));

        // Pending background results, errors, and auto-messages all eventually
        // trigger an append that — through ensureWindowAtTail — would snap the
        // anchor window back to the history tail. In jump mode that would yank
        // the user away from the search target before they ever see it. Leave
        // these queued (badge stays visible) so the next normal chat open can
        // consume them.
        if (scrollToMsgIdx === null) {
            // ── Consume pending background result if available ──
            if (hasPendingResult()) {
                console.log(`${CHAT_LOG_PREFIX} Pending background result found, rendering...`);
                const result = consumePendingResult();
                if (result) {
                    renderResponseToDom(result.rawResponse, result.messagesToSend, result.indexableReplyMap || null);
                }
                updateAppBadge('chat', 0); // Clear red dot
            } else if (hasError()) {
                // Show error from failed background generation
                const errMsg = consumeError();
                const messagesArea = document.getElementById('chat_messages_area');
                if (messagesArea && errMsg) {
                    messagesArea.insertAdjacentHTML('beforeend',
                        `<div class="chat-retract">⚠️ 发送失败: ${escHtml(errMsg)}</div>`);
                    scrollToBottom(true);
                }
                updateAppBadge('chat', 0);
            }

            // ── Consume pending auto messages if available ──
            if (hasAutoMessagePending()) {
                console.log(`${CHAT_LOG_PREFIX} Pending auto message found, rendering...`);
                renderAutoMessages(consumeAutoMessages());
                updateAppBadge('chat', 0);
            }
        }

        // ── If background generation is still running, show typing indicator + stop button ──
        if (isBackgroundGenerating()) {
            showTypingIndicator(true);
            updateButtonStates();
        }

        // ── Search jump: scroll the target into view + briefly highlight it.
        // Runs after bindChatEvents()' default scrollToBottom, so this wins
        // for jump-mode opens and is a no-op for plain opens.
        if (scrollToMsgIdx !== null) {
            scrollToMsgIndex(scrollToMsgIdx);
        }
    }, actionsHtml);
}

/**
 * Locate the bubble row carrying `data-msg-index="<idx>"`, center it in the
 * viewport, and pulse a `.chat-search-jump-target` class for 2 seconds.
 * Falls back silently if the row is missing (e.g. history changed between
 * search and click).
 *
 * @param {number} idx — globalIndex of the message to focus
 */
function scrollToMsgIndex(idx) {
    requestAnimationFrame(() => {
        const area = document.getElementById('chat_messages_area');
        if (!area) return;
        const row = area.querySelector(`.chat-bubble-row[data-msg-index="${idx}"]`);
        if (!row) {
            console.warn(`${CHAT_LOG_PREFIX} scrollToMsgIndex: row ${idx} not in DOM`);
            return;
        }
        row.scrollIntoView({ block: 'center', behavior: 'smooth' });
        row.classList.add('chat-search-jump-target');
        setTimeout(() => row.classList.remove('chat-search-jump-target'), 2000);
    });
}

// ═══════════════════════════════════════════════════════════════════════
// Event Binding
// ═══════════════════════════════════════════════════════════════════════

function bindChatEvents() {
    const input = document.getElementById('chat_input');
    const plusBtn = document.getElementById('chat_plus_btn');
    const kiwiBtn = document.getElementById('chat_kiwi_btn');
    const sendBtn = document.getElementById('chat_send_btn');
    const menuBtn = document.getElementById('chat_menu_btn');
    const plusOverlay = document.getElementById('chat_plus_overlay');
    const plusCancel = document.getElementById('chat_plus_cancel');
    const returnHomeBtn = document.getElementById('chat_return_home_btn');
    const messagesArea = document.getElementById('chat_messages_area');
    const navName = document.getElementById('chat_nav_name');

    if (!input) return;

    // Click character name in nav bar → inline-edit nickname
    if (navName) {
        navName.addEventListener('click', () => openNicknameEditor(navName));
    }

    // Auto-resize textarea (batched to avoid double reflow)
    input.addEventListener('input', () => {
        requestAnimationFrame(() => {
            input.style.height = 'auto';
            input.style.height = Math.min(input.scrollHeight, 100) + 'px';
        });
        updateButtonStates();
    });

    // Enter to add message (no shift+enter needed for mobile!)
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            addPendingMessage();
        }
    });

    // ─── Thought & Load More & Delete & Reactions (event delegation) ───
    if (messagesArea) {
        // Long-press → bubble menu (emoji bar). Detection + overlay lives in
        // chatBubbleMenu.js; the click delegate below only handles taps.
        // Disable predicate is injected (instead of importing back from this
        // file) to avoid a circular dependency.
        attachBubbleLongPress(messagesArea, {
            isDisabled: () => isDeleteMode || isEditMode,
            onEdit: (idx) => openEditOverlay(idx),
            onReroll: () => rerollLastMessage(),
            onDelete: (idx) => selectMessageForDeletion(idx),
            onReply: (idx) => startReplyTo(idx),
        });

        messagesArea.addEventListener('click', (e) => {
            // Delete mode: handle checkbox toggle
            if (isDeleteMode) {
                const row = e.target.closest('.chat-bubble-row[data-msg-index]');
                if (row) {
                    e.stopPropagation();
                    const idx = parseInt(row.dataset.msgIndex, 10);
                    toggleSelectMessage(idx, row);
                    return;
                }
            }

            // Edit mode: tap a bubble to open its edit overlay
            if (isEditMode) {
                const row = e.target.closest('.chat-bubble-row[data-msg-index]');
                if (row) {
                    e.stopPropagation();
                    const idx = parseInt(row.dataset.msgIndex, 10);
                    openEditOverlay(idx);
                    return;
                }
            }

            // Image bubble → lightbox
            const imgBubble = e.target.closest('.chat-image-bubble');
            if (imgBubble) {
                e.stopPropagation();
                const fullSrc = imgBubble.dataset.fullSrc;
                if (fullSrc) showImageLightbox(fullSrc);
                return;
            }

            // Voice bubble playback
            const playBtn = e.target.closest('.voice-play-btn');
            if (playBtn) {
                e.stopPropagation();
                const bubble = playBtn.closest('.voice-bubble');
                if (bubble) handleVoicePlayback(bubble, playBtn);
                return;
            }

            // Reaction badge: tap an applied emoji to remove it.
            // Must run before the thought-toggle branch since badges sit inside
            // .chat-bubble-column and would otherwise fall through to it.
            const reactionItem = e.target.closest('.chat-reaction-item');
            if (reactionItem) {
                e.stopPropagation();
                const badge = reactionItem.closest('.chat-reaction-badge');
                const idx = badge ? parseInt(badge.dataset.msgIndex, 10) : NaN;
                const emoji = reactionItem.dataset.emoji;
                if (!Number.isNaN(idx) && emoji) toggleReaction(idx, emoji);
                return;
            }

            // Thought toggle — must hit the actual bubble anchor (fit-content),
            // not the surrounding column which spans the full row width and would
            // fire on blank space beside the bubble.
            if (e.target.closest('button') || e.target.closest('a') || e.target.closest('.chat-special-card')) return;
            const anchor = e.target.closest('.chat-bubble-anchor');
            if (anchor && anchor.closest('.chat-bubble-row.char')) {
                // Suppress when a long-press menu just opened or just dismissed —
                // the click that ends the long-press gesture (or the click that
                // closed the menu by tapping outside) should not flip the thought.
                if (isBubbleMenuActiveOrRecent()) return;
                const col = anchor.closest('.chat-bubble-column');
                const thought = col && col.querySelector('.chat-thought-bubble');
                if (thought) {
                    thought.classList.toggle('collapsed');
                }
            }

            // Load more — older direction (top button)
            if (e.target.id === 'chat_load_more_btn') {
                const oldScrollHeight = messagesArea.scrollHeight;
                const win = _chatWindow;
                const history = loadChatHistory();
                const newStart = Math.max(0, win.startIdx - CHAT_DISPLAY_COUNT);
                _paintChatWindow(messagesArea, history, newStart, win.endIdx);
                // Preserve scroll position so the previously-visible content
                // stays put while new bubbles appear above the viewport.
                messagesArea.scrollTop = messagesArea.scrollHeight - oldScrollHeight;
                return;
            }

            // Load newer — bottom button (only present inside a search-jump
            // anchor window; expanding to history end will drop it).
            if (e.target.id === 'chat_load_newer_btn') {
                const win = _chatWindow;
                const history = loadChatHistory();
                const newEnd = Math.min(history.length - 1, win.endIdx + CHAT_DISPLAY_COUNT);
                _paintChatWindow(messagesArea, history, win.startIdx, newEnd);
                // New bubbles sit below the previously-visible content; the
                // user can scroll into them naturally.
                return;
            }
        });
    }

    // ─── Delete toolbar buttons ───
    const selectAllBtn = document.getElementById('chat_select_all_btn');
    const deleteCancelBtn = document.getElementById('chat_delete_cancel_btn');
    const deleteConfirmBtn = document.getElementById('chat_delete_confirm_btn');

    if (selectAllBtn) {
        selectAllBtn.addEventListener('click', () => {
            const rows = document.querySelectorAll('.chat-bubble-row[data-msg-index]');
            const allSelected = selectedForDeletion.size === rows.length;
            if (allSelected) {
                selectedForDeletion.clear();
                rows.forEach(row => row.classList.remove('selected'));
                selectAllBtn.textContent = '全选';
            } else {
                rows.forEach(row => {
                    const idx = parseInt(row.dataset.msgIndex, 10);
                    selectedForDeletion.add(idx);
                    row.classList.add('selected');
                });
                selectAllBtn.textContent = '取消全选';
            }
            updateDeleteToolbar();
        });
    }

    if (deleteCancelBtn) {
        deleteCancelBtn.addEventListener('click', () => toggleDeleteMode());
    }

    if (deleteConfirmBtn) {
        deleteConfirmBtn.addEventListener('click', () => handleBatchDelete());
    }

    // ─── + Plus button → open plus panel ───
    if (plusBtn) {
        plusBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            _overlayOpenedAt = Date.now();
            plusOverlay?.classList.add('active');
        });
    }

    // ─── 🥝 Kiwi button → add to draft ───
    if (kiwiBtn) {
        kiwiBtn.addEventListener('click', () => addPendingMessage());
    }

    // ─── Send button (context-aware: send / mic / stop mode) ───
    if (sendBtn) {
        sendBtn.addEventListener('click', () => {
            if (sendBtn.classList.contains('stop-mode')) {
                cancelGeneration();
            } else if (sendBtn.classList.contains('mic-mode')) {
                beginRecording();
            } else {
                sendAllMessages();
            }
        });
    }

    // ─── Plus panel: cancel ───
    if (plusCancel) {
        plusCancel.addEventListener('click', () => {
            plusOverlay?.classList.remove('active');
        });
    }
    if (plusOverlay) {
        plusOverlay.addEventListener('click', (e) => {
            if (e.target === plusOverlay && Date.now() - _overlayOpenedAt > 200) {
                plusOverlay.classList.remove('active');
            }
        });
    }

    // ─── Plus panel: "我已回家" ───
    if (returnHomeBtn) {
        returnHomeBtn.addEventListener('click', () => {
            plusOverlay?.classList.remove('active');
            handleReturnHome();
        });
    }

    // ─── Plus panel: "总结" ───
    const summarizeBtn = document.getElementById('chat_plus_summarize_btn');
    if (summarizeBtn) {
        summarizeBtn.addEventListener('click', () => {
            plusOverlay?.classList.remove('active');
            handleManualSummarize();
        });
    }

    // ─── Plus panel: "重新生成" ───
    const plusRerollBtn = document.getElementById('chat_plus_reroll_btn');
    if (plusRerollBtn) {
        plusRerollBtn.addEventListener('click', () => {
            plusOverlay?.classList.remove('active');
            rerollLastMessage();
        });
    }

    // ─── Plus panel: 🎤 语音按钮 ───
    const plusVoiceBtn = document.getElementById('chat_plus_voice_btn');
    if (plusVoiceBtn) {
        plusVoiceBtn.addEventListener('click', () => {
            plusOverlay?.classList.remove('active');
            beginRecording();
        });
    }

    // ─── Plus panel: 📷 图片按钮 ───
    const plusImageBtn = document.getElementById('chat_plus_image_btn');
    const imageInput = document.getElementById('chat_image_input');
    if (plusImageBtn && imageInput) {
        plusImageBtn.addEventListener('click', () => {
            plusOverlay?.classList.remove('active');
            imageInput.click();
        });
        imageInput.addEventListener('change', (e) => {
            if (e.target.files && e.target.files[0]) {
                handleImageSelection(e.target.files[0]);
            }
            imageInput.value = '';
        });
    }

    // ─── Plus panel: chat background ───
    const plusBgBtn = document.getElementById('chat_plus_bg_btn');
    const bgInput = document.getElementById('chat_bg_input');
    const bgOverlay = document.getElementById('chat_bg_overlay');
    const bgChangeBtn = document.getElementById('chat_bg_change_btn');
    const bgClearBtn = document.getElementById('chat_bg_clear_btn');
    const bgCancel = document.getElementById('chat_bg_cancel');

    const showBgToast = (msg) => {
        const toast = document.createElement('div');
        toast.className = 'chat-toast';
        toast.textContent = msg;
        document.getElementById('chat_page_root')?.appendChild(toast);
        setTimeout(() => toast.remove(), 2000);
    };

    if (plusBgBtn && bgInput) {
        plusBgBtn.addEventListener('click', () => {
            plusOverlay?.classList.remove('active');
            if (hasChatBackground() && bgOverlay) {
                _overlayOpenedAt = Date.now();
                bgOverlay.classList.add('active');
            } else {
                bgInput.click();
            }
        });

        bgInput.addEventListener('change', async (e) => {
            const file = e.target.files && e.target.files[0];
            bgInput.value = '';
            if (!file) return;
            try {
                await uploadChatBackground(file);
                showBgToast('背景已更新');
            } catch (err) {
                console.error(`${CHAT_LOG_PREFIX} 背景上传失败:`, err);
                showBgToast('背景上传失败');
            }
        });
    }

    if (bgChangeBtn && bgInput) {
        bgChangeBtn.addEventListener('click', () => {
            bgOverlay?.classList.remove('active');
            bgInput.click();
        });
    }

    if (bgClearBtn) {
        bgClearBtn.addEventListener('click', async () => {
            bgOverlay?.classList.remove('active');
            try {
                await clearChatBackground();
                showBgToast('背景已清除');
            } catch (err) {
                console.error(`${CHAT_LOG_PREFIX} 背景清除失败:`, err);
                showBgToast('背景清除失败');
            }
        });
    }

    if (bgCancel) {
        bgCancel.addEventListener('click', () => {
            bgOverlay?.classList.remove('active');
        });
    }

    if (bgOverlay) {
        bgOverlay.addEventListener('click', (e) => {
            if (e.target === bgOverlay && Date.now() - _overlayOpenedAt > 200) {
                bgOverlay.classList.remove('active');
            }
        });
    }

    // ─── Plus panel: 保活 toggle ───
    const keepAliveBtn = document.getElementById('chat_plus_keepalive_btn');
    if (keepAliveBtn) {
        keepAliveBtn.addEventListener('click', () => {
            const wasOn = isKeepAliveEnabled();
            const newState = !wasOn;
            setKeepAliveEnabled(newState);
            if (newState) {
                startKeepAlive();
            } else {
                stopKeepAlive();
            }
            // Update button visual
            keepAliveBtn.classList.toggle('active', newState);
            const label = keepAliveBtn.querySelector('span');
            if (label) label.textContent = newState ? '保活中' : '保活';
            // Toast
            const toast = document.createElement('div');
            toast.className = 'chat-toast';
            toast.textContent = newState ? '静默保活已开启' : '静默保活已关闭';
            document.getElementById('chat_page_root')?.appendChild(toast);
            setTimeout(() => toast.remove(), 2000);
            // Don't close overlay — let user see the state change
        });
    }

    // ─── Lightbox close on click ───
    const lightbox = document.getElementById('chat_image_lightbox');
    if (lightbox) {
        lightbox.addEventListener('click', () => {
            lightbox.classList.remove('active');
        });
    }

    // ─── Plus panel: 道具背包 ───
    const inventoryBtn = document.getElementById('chat_plus_inventory_btn');
    const inventoryOverlay = document.getElementById('chat_inventory_overlay');
    const inventoryCloseBtn = document.getElementById('chat_inventory_close_btn');

    if (inventoryBtn) {
        inventoryBtn.addEventListener('click', () => {
            plusOverlay?.classList.remove('active');
            renderChatInventory();
            _overlayOpenedAt = Date.now();
            inventoryOverlay?.classList.add('active');
        });
    }

    if (inventoryCloseBtn) {
        inventoryCloseBtn.addEventListener('click', () => {
            inventoryOverlay?.classList.remove('active');
        });
    }

    if (inventoryOverlay) {
        inventoryOverlay.addEventListener('click', (e) => {
            if (e.target === inventoryOverlay && Date.now() - _overlayOpenedAt > 200) {
                inventoryOverlay.classList.remove('active');
            }
        });
    }

    // ─── Top-right ⋯ button → ChatSettings second-level page ───
    if (menuBtn) {
        menuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openChatSettingsPage();
        });
    }

    // ─── Phone call entry in plus sheet (with chat context) ───
    const plusCallBtn = document.getElementById('chat_plus_call_btn');
    if (plusCallBtn) {
        plusCallBtn.addEventListener('click', () => {
            plusOverlay?.classList.remove('active');
            openVoiceCall({ chatContext: true });
        });
    }

    // ─── Edit overlay: close & cancel ───
    const editOverlay = document.getElementById('chat_edit_overlay');
    const editCloseBtn = document.getElementById('chat_edit_close_btn');
    const editCancelBtn = document.getElementById('chat_edit_cancel_btn');
    const editSaveBtn = document.getElementById('chat_edit_save_btn');

    if (editCloseBtn) editCloseBtn.addEventListener('click', () => closeEditOverlay());
    if (editCancelBtn) editCancelBtn.addEventListener('click', () => closeEditOverlay());
    if (editOverlay) {
        editOverlay.addEventListener('click', (e) => {
            if (e.target === editOverlay && Date.now() - _overlayOpenedAt > 200) closeEditOverlay();
        });
    }
    if (editSaveBtn) {
        editSaveBtn.addEventListener('click', () => handleEditSave());
    }

    // Scroll to bottom on initial load
    scrollToBottom(false);

    // Update button states
    updateButtonStates();

    // Render buff bar (Phase 2)
    renderBuffBar();

    // ── Register background generation response handler ──
    if (_responseReadyHandler) {
        window.removeEventListener('phone-chat-response-ready', _responseReadyHandler);
    }
    _responseReadyHandler = (e) => handleResponseReady(e);
    window.addEventListener('phone-chat-response-ready', _responseReadyHandler);

    // ── Register retry event handler (countdown UI) ──
    if (_retryHandler) {
        window.removeEventListener('phone-chat-retry', _retryHandler);
    }
    _retryHandler = (e) => handleRetryEvent(e);
    window.addEventListener('phone-chat-retry', _retryHandler);

    // ── Register auto-message handler ──
    if (_autoMsgHandler) {
        window.removeEventListener('phone-auto-message-ready', _autoMsgHandler);
    }
    _autoMsgHandler = () => handleAutoMessageReady();
    window.addEventListener('phone-auto-message-ready', _autoMsgHandler);

    // ── Register declined-call handler (character follow-up) ──
    if (_callDeclinedHandler) {
        window.removeEventListener('phone-call-declined', _callDeclinedHandler);
    }
    _callDeclinedHandler = () => handleCallDeclined();
    window.addEventListener('phone-call-declined', _callDeclinedHandler);
}

// ═══════════════════════════════════════════════════════════════════════
// Nickname inline editor (top nav bar)
// ═══════════════════════════════════════════════════════════════════════

function openNicknameEditor(nameEl) {
    const realName = getCharacterInfo()?.name || '角色';
    const current = loadCharacterNickname();

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'chat-nav-name-input';
    input.id = 'chat_nav_name_input';
    input.value = current;
    input.placeholder = realName;
    input.maxLength = 30;
    input.autocomplete = 'off';
    input.spellcheck = false;

    nameEl.replaceWith(input);
    input.focus();
    input.select();

    let finished = false;
    const finish = (commit) => {
        if (finished) return;
        finished = true;
        if (commit) saveCharacterNickname(input.value);
        const newDisplay = getCharacterDisplayName();
        const restored = document.createElement('div');
        restored.className = 'chat-nav-name';
        restored.id = 'chat_nav_name';
        restored.title = `点击设置昵称（清空恢复 ${realName}）`;
        restored.textContent = newDisplay;
        restored.addEventListener('click', () => openNicknameEditor(restored));
        input.replaceWith(restored);
    };

    input.addEventListener('blur', () => finish(true));
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            input.blur();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            finish(false);
        }
    });
}

// ═══════════════════════════════════════════════════════════════════════
// UI Helpers (shared across sub-modules)
// ═══════════════════════════════════════════════════════════════════════

export function showTypingIndicator(show) {
    const area = document.getElementById('chat_messages_area');
    if (!area) return;

    const existing = area.querySelector('.chat-typing-row');
    if (existing) existing.remove();

    if (show) {
        area.insertAdjacentHTML('beforeend', `
            <div class="chat-typing-row">
                <div class="chat-typing-bubble">
                    <div class="chat-typing-dot"></div>
                    <div class="chat-typing-dot"></div>
                    <div class="chat-typing-dot"></div>
                </div>
            </div>
        `);
        scrollToBottom(true);
    }
}

/**
 * Re-render the messages area from the current history. Always snaps the
 * anchor window back to the tail (last CHAT_DISPLAY_COUNT messages) — this
 * is also the recovery path used by ensureWindowAtTail() when an append
 * fires while the user is parked in a historical jump window.
 *
 * @param {boolean} [smooth=false] - If true, smooth-scroll to bottom
 */
export function rerenderMessagesArea(smooth = false) {
    const messagesArea = document.getElementById('chat_messages_area');
    if (!messagesArea) return;

    const history = loadChatHistory();
    const { startIdx, endIdx } = computeChatWindow(history.length, null);
    _paintChatWindow(messagesArea, history, startIdx, endIdx, '开始聊天吧…');
    scrollToBottom(smooth);
}

/**
 * Paint the messages area for an arbitrary [startIdx, endIdx] anchor window
 * and commit that window to module state. Used by load-more / load-newer
 * click handlers and by rerenderMessagesArea.
 *
 * @param {HTMLElement} area - #chat_messages_area
 * @param {object[]} history
 * @param {number} startIdx
 * @param {number} endIdx
 * @param {string} [emptyText='开始聊天吧…']
 */
function _paintChatWindow(area, history, startIdx, endIdx, emptyText = '开始聊天吧…') {
    area.innerHTML = buildMessagesAreaInner(history, startIdx, endIdx, emptyText);
    setChatWindow(startIdx, endIdx);
}

export function scrollToBottom(smooth = true) {
    requestAnimationFrame(() => {
        const area = document.getElementById('chat_messages_area');
        if (area) {
            area.scrollTo({
                top: area.scrollHeight,
                behavior: smooth ? 'smooth' : 'auto',
            });
        }
    });
}

// ── Cached state for updateButtonStates() to avoid redundant DOM writes ──
let _lastBtnMode = null; // 'mic' | 'send' | 'stop' | null
let _lastBtnDisabled = null;
let _lastKiwiOpacity = null;

export function updateButtonStates() {
    const input = document.getElementById('chat_input');
    const sendBtn = document.getElementById('chat_send_btn');
    const kiwiBtn = document.getElementById('chat_kiwi_btn');
    const hasText = input?.value?.trim().length > 0;
    const hasDrafts = pendingMessages.length > 0;
    const hasImage = !!_pendingImageData;

    const generating = isGenerating || isBackgroundGenerating();

    if (sendBtn) {
        if (generating) {
            // Stop mode — clicking aborts the in-flight LLM call
            if (_lastBtnMode !== 'stop') {
                sendBtn.classList.remove('mic-mode');
                sendBtn.classList.add('stop-mode');
                sendBtn.innerHTML = '<i class="fa-solid fa-stop"></i>';
                sendBtn.title = '停止生成';
                _lastBtnMode = 'stop';
            }
            if (_lastBtnDisabled !== false) {
                sendBtn.disabled = false;
                _lastBtnDisabled = false;
            }
        } else if (!hasText && !hasDrafts && !hasImage) {
            // Mic mode — only rewrite innerHTML if mode actually changed
            if (_lastBtnMode !== 'mic') {
                sendBtn.classList.remove('stop-mode');
                sendBtn.classList.add('mic-mode');
                sendBtn.innerHTML = `<svg width="20" height="16" viewBox="0 0 20 16" fill="currentColor">
                    <rect x="0" y="5" width="2.5" height="6" rx="1"/>
                    <rect x="4" y="2" width="2.5" height="12" rx="1"/>
                    <rect x="8" y="4" width="2.5" height="8" rx="1"/>
                    <rect x="12" y="1" width="2.5" height="14" rx="1"/>
                    <rect x="16" y="3" width="2.5" height="10" rx="1"/>
                </svg>`;
                sendBtn.title = '语音输入';
                _lastBtnMode = 'mic';
            }
            if (_lastBtnDisabled !== false) {
                sendBtn.disabled = false;
                _lastBtnDisabled = false;
            }
        } else {
            // Send mode — only rewrite innerHTML if mode actually changed
            if (_lastBtnMode !== 'send') {
                sendBtn.classList.remove('mic-mode');
                sendBtn.classList.remove('stop-mode');
                sendBtn.innerHTML = '<i class="fa-solid fa-arrow-up"></i>';
                sendBtn.title = '发送';
                _lastBtnMode = 'send';
            }
            if (_lastBtnDisabled !== false) {
                sendBtn.disabled = false;
                _lastBtnDisabled = false;
            }
        }
    }

    if (kiwiBtn) {
        const newOpacity = hasText ? '1' : '0.4';
        if (_lastKiwiOpacity !== newOpacity) {
            kiwiBtn.style.opacity = newOpacity;
            _lastKiwiOpacity = newOpacity;
        }
    }
}

/** Reset cached button state (call when re-entering the chat app) */
export function resetButtonStateCache() {
    _lastBtnMode = null;
    _lastBtnDisabled = null;
    _lastKiwiOpacity = null;
}

const _escDiv = document.createElement('div');
export function escHtml(str) {
    if (!str) return '';
    _escDiv.textContent = str;
    return _escDiv.innerHTML;
}

export function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Check if the user is currently viewing the chat app.
 */
export function isUserInChatApp() {
    const viewport = document.getElementById('phone_app_viewport');
    const chatRoot = document.getElementById('chat_page_root');
    return viewport?.classList.contains('app-active') && !!chatRoot;
}
