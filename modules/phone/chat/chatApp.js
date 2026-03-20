// modules/phone/chat/chatApp.js — iMessage-style Chat App
// Entry point + shared state center for the chat feature.
// Sub-modules import getters/setters from here to access shared state.

import { openAppInViewport, updateAppBadge } from '../phoneController.js';
import {
    loadChatHistory, clearChatHistory,
    getCharacterInfo,
} from './chatStorage.js';
import {
    consumePendingResult, consumeError,
    isBackgroundGenerating, hasPendingResult, hasError,
} from './backgroundGen.js';
import { hasAutoMessagePending, consumeAutoMessages } from './autoMessage.js';
import { openVoiceCall } from '../voiceCall/voiceCallUI.js';
import { isKeepAliveEnabled, setKeepAliveEnabled, startKeepAlive, stopKeepAlive } from '../keepAlive.js';

// ── Sub-module imports ──
import { buildChatPage, buildMessagesHtml, buildBubbleRow } from './chatHtmlBuilder.js';
import {
    addPendingMessage, sendAllMessages,
    handleResponseReady, handleRetryEvent,
    handleAutoMessageReady, renderAutoMessages, renderDraftArea,
    renderResponseToDom, handleCallDeclined,
} from './chatMessageHandler.js';
import {
    toggleDeleteMode, toggleSelectMessage, updateDeleteToolbar, handleBatchDelete,
    toggleEditMode, openEditOverlay, closeEditOverlay, handleEditSave,
    rerollLastMessage,
} from './chatEditDelete.js';
import {
    showReactionPicker, dismissReactionPicker, toggleReaction,
} from './chatReactions.js';
import { renderBuffBar, renderChatInventory, handleReturnHome, handleManualSummarize } from './chatInventory.js';
import { beginRecording } from './chatVoice.js';
import { handleImageSelection, showImageLightbox } from './chatImage.js';
import { handleVoicePlayback } from './chatVoice.js';

// ═══════════════════════════════════════════════════════════════════════
// Shared State
// ═══════════════════════════════════════════════════════════════════════

let pendingMessages = [];          // Strings queued by the user before sending
let isGenerating = false;          // Lock to prevent double sends
let isDeleteMode = false;          // Delete-mode toggle
let selectedForDeletion = new Set(); // Batch-select indices for deletion
let isEditMode = false;            // Edit-mode toggle
let selectedEditIndex = -1;        // Which message is being edited
let _overlayOpenedAt = 0;          // Timestamp guard for overlay dismiss
let _responseReadyHandler = null;  // Stored reference for cleanup
let _retryHandler = null;          // Stored reference for cleanup
let _autoMsgHandler = null;        // Stored reference for cleanup
let _pendingImageData = null;      // { base64, thumbnail, fileName } | null

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

// ═══════════════════════════════════════════════════════════════════════
// Entry Point
// ═══════════════════════════════════════════════════════════════════════

export function openChatApp() {
    const history = loadChatHistory();
    pendingMessages = [];
    const html = buildChatPage(history);

    // Build custom header for chat
    const charInfo = getCharacterInfo();
    const charName = charInfo?.name || '角色';

    const avatarHtml = charInfo?.avatar
        ? `<img src="/characters/${encodeURIComponent(charInfo.avatar)}" alt="${escHtml(charName)}" />`
        : `<i class="fa-solid fa-user"></i>`;

    const titleHtml = `
        <div class="chat-nav-avatar">${avatarHtml}</div>
        <div class="chat-nav-info">
            <div class="chat-nav-name">${escHtml(charName)}</div>
            <div class="chat-nav-status">iMessage</div>
        </div>`;

    const actionsHtml = `
        <button class="chat-nav-btn" id="chat_call_btn" title="语音通话">
            <i class="fa-solid fa-phone"></i>
        </button>
        <button class="chat-nav-btn" id="chat_menu_btn" title="更多">
            <i class="fa-solid fa-ellipsis"></i>
        </button>`;

    openAppInViewport(titleHtml, html, () => {
        resetButtonStateCache();
        bindChatEvents();

        // ── Consume pending background result if available ──
        if (hasPendingResult()) {
            console.log(`${CHAT_LOG_PREFIX} Pending background result found, rendering...`);
            const result = consumePendingResult();
            if (result) {
                renderResponseToDom(result.rawResponse, result.messagesToSend);
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

        // ── If background generation is still running, show typing indicator ──
        if (isBackgroundGenerating()) {
            showTypingIndicator(true);
        }
    }, actionsHtml);
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
    const callBtn = document.getElementById('chat_call_btn');
    const menuOverlay = document.getElementById('chat_menu_overlay');
    const menuCancel = document.getElementById('chat_menu_cancel');
    const clearHistoryBtn = document.getElementById('chat_clear_history');
    const plusOverlay = document.getElementById('chat_plus_overlay');
    const plusCancel = document.getElementById('chat_plus_cancel');
    const returnHomeBtn = document.getElementById('chat_return_home_btn');
    const messagesArea = document.getElementById('chat_messages_area');

    if (!input) return;

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
        // Long-press / double-click for reaction picker
        let _longPressTimer = null;
        let _longPressTarget = null;
        let _didLongPress = false;

        messagesArea.addEventListener('pointerdown', (e) => {
            if (isDeleteMode || isEditMode) return;
            const row = e.target.closest('.chat-bubble-row[data-msg-index]');
            if (!row) return;
            if (e.target.closest('button') || e.target.closest('a') ||
                e.target.closest('.chat-reaction-badge') || e.target.closest('.chat-reaction-picker')) return;
            _longPressTarget = row;
            _didLongPress = false;
            // NOTE: Do NOT call e.preventDefault() here!
            // On mobile, preventing pointerdown kills the entire touch→click chain,
            // which breaks delete-mode / edit-mode tap-to-select.
            // Use CSS user-select instead to prevent text selection during long-press.
            row.style.userSelect = 'none';
            row.style.webkitUserSelect = 'none';
            _longPressTimer = setTimeout(() => {
                _didLongPress = true;
                const idx = parseInt(row.dataset.msgIndex, 10);
                showReactionPicker(idx, row);
                _longPressTarget = null;
            }, 500);
        });

        messagesArea.addEventListener('pointerup', () => {
            clearTimeout(_longPressTimer);
            if (_longPressTarget) {
                _longPressTarget.style.userSelect = '';
                _longPressTarget.style.webkitUserSelect = '';
            }
            _longPressTarget = null;
        });

        messagesArea.addEventListener('pointerleave', () => {
            clearTimeout(_longPressTimer);
            if (_longPressTarget) {
                _longPressTarget.style.userSelect = '';
                _longPressTarget.style.webkitUserSelect = '';
            }
            _longPressTarget = null;
        });

        messagesArea.addEventListener('touchmove', () => {
            clearTimeout(_longPressTimer);
            _longPressTarget = null;
        }, { passive: true });

        messagesArea.addEventListener('pointercancel', () => {
            clearTimeout(_longPressTimer);
            if (_longPressTarget) {
                _longPressTarget.style.userSelect = '';
                _longPressTarget.style.webkitUserSelect = '';
            }
            _longPressTarget = null;
        });

        // Desktop: double-click to open reaction picker
        messagesArea.addEventListener('dblclick', (e) => {
            if (isDeleteMode) return;
            const row = e.target.closest('.chat-bubble-row[data-msg-index]');
            if (!row) return;
            if (e.target.closest('.chat-reaction-badge') || e.target.closest('.chat-reaction-picker')) return;
            const idx = parseInt(row.dataset.msgIndex, 10);
            showReactionPicker(idx, row);
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

            // Reaction picker emoji click
            const pickerEmoji = e.target.closest('.chat-reaction-emoji');
            if (pickerEmoji) {
                const emoji = pickerEmoji.dataset.emoji;
                const idx = parseInt(pickerEmoji.dataset.msgIndex, 10);
                toggleReaction(idx, emoji);
                dismissReactionPicker();
                return;
            }

            // Dismiss reaction picker on outside click
            if (document.querySelector('.chat-reaction-picker')) {
                if (!e.target.closest('.chat-reaction-picker')) {
                    dismissReactionPicker();
                }
            }

            // If a long-press just happened, swallow this click
            if (_didLongPress) {
                _didLongPress = false;
                return;
            }

            // Thought toggle
            if (e.target.closest('button') || e.target.closest('a') || e.target.closest('.chat-special-card')) return;
            const col = e.target.closest('.chat-bubble-column');
            if (col && col.closest('.char')) {
                const thought = col.querySelector('.chat-thought-bubble');
                if (thought) {
                    thought.classList.toggle('collapsed');
                }
            }

            // Load more
            if (e.target.id === 'chat_load_more_btn') {
                const oldScrollHeight = messagesArea.scrollHeight;
                let currentLimit = parseInt(e.target.dataset.limit || '20', 10);
                currentLimit += 20;
                const history = loadChatHistory();
                const displayHistory = history.slice(-currentLimit);

                const startIndex = history.length - currentLimit;
                let newHtml = buildMessagesHtml(displayHistory, Math.max(0, startIndex));
                if (history.length > currentLimit) {
                    newHtml = `<div class="chat-load-more" id="chat_load_more_btn" data-limit="${currentLimit}">查看更早的聊天记录</div>` + newHtml;
                }
                messagesArea.innerHTML = newHtml;
                messagesArea.scrollTop = messagesArea.scrollHeight - oldScrollHeight;
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

    // ─── Send button (context-aware: send mode vs mic mode) ───
    if (sendBtn) {
        sendBtn.addEventListener('click', () => {
            if (sendBtn.classList.contains('mic-mode')) {
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

    // ─── Image bubble click → lightbox ───
    if (messagesArea) {
        messagesArea.addEventListener('click', (e) => {
            const imgBubble = e.target.closest('.chat-image-bubble');
            if (imgBubble) {
                e.stopPropagation();
                const fullSrc = imgBubble.dataset.fullSrc;
                if (fullSrc) showImageLightbox(fullSrc);
            }
        });
    }

    // ─── Lightbox close on click ───
    const lightbox = document.getElementById('chat_image_lightbox');
    if (lightbox) {
        lightbox.addEventListener('click', () => {
            lightbox.classList.remove('active');
        });
    }

    // ─── Voice bubble playback (event delegation) ───
    if (messagesArea) {
        messagesArea.addEventListener('click', (e) => {
            const playBtn = e.target.closest('.voice-play-btn');
            if (!playBtn) return;
            e.stopPropagation();
            const bubble = playBtn.closest('.voice-bubble');
            if (!bubble) return;
            handleVoicePlayback(bubble, playBtn);
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

    // ─── Top-right ⋯ Menu ───
    if (menuBtn) {
        menuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            _overlayOpenedAt = Date.now();
            menuOverlay?.classList.add('active');
        });
    }

    // ─── Phone call button (with chat context) ───
    if (callBtn) {
        callBtn.addEventListener('click', () => {
            openVoiceCall({ chatContext: true });
        });
    }
    if (menuCancel) {
        menuCancel.addEventListener('click', () => {
            menuOverlay?.classList.remove('active');
        });
    }
    if (menuOverlay) {
        menuOverlay.addEventListener('click', (e) => {
            if (e.target === menuOverlay && Date.now() - _overlayOpenedAt > 200) {
                menuOverlay.classList.remove('active');
            }
        });
    }
    if (clearHistoryBtn) {
        clearHistoryBtn.addEventListener('click', () => {
            if (confirm('确定要清空所有聊天记录吗？\n此操作无法撤销。')) {
                clearChatHistory();
                pendingMessages = [];
                openChatApp(); // Re-render
            }
            menuOverlay?.classList.remove('active');
        });
    }

    // ─── Reroll button ───
    const rerollBtn = document.getElementById('chat_reroll_btn');
    if (rerollBtn) {
        rerollBtn.addEventListener('click', () => {
            menuOverlay?.classList.remove('active');
            rerollLastMessage();
        });
    }

    // ─── Delete mode button ───
    const deleteModeBtn = document.getElementById('chat_delete_mode_btn');
    if (deleteModeBtn) {
        deleteModeBtn.addEventListener('click', () => {
            menuOverlay?.classList.remove('active');
            toggleDeleteMode();
        });
    }

    // ─── Edit mode button ───
    const editModeBtn = document.getElementById('chat_edit_mode_btn');
    if (editModeBtn) {
        editModeBtn.addEventListener('click', () => {
            menuOverlay?.classList.remove('active');
            toggleEditMode();
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
    window.addEventListener('phone-call-declined', handleCallDeclined);
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
 * Re-render the messages area from the current history.
 * @param {boolean} [smooth=false] - If true, smooth-scroll to bottom
 */
export function rerenderMessagesArea(smooth = false) {
    const messagesArea = document.getElementById('chat_messages_area');
    if (!messagesArea) return;

    const history = loadChatHistory();
    const displayHistory = history.slice(-20);
    const startIndex = history.length - displayHistory.length;

    let newHtml = displayHistory.length > 0
        ? buildMessagesHtml(displayHistory, startIndex)
        : `<div class="chat-empty">
               <div class="chat-empty-icon">💬</div>
               <div class="chat-empty-text">开始聊天吧…</div>
           </div>`;

    if (history.length > 20 && displayHistory.length > 0) {
        newHtml = `<div class="chat-load-more" id="chat_load_more_btn" data-limit="20">查看更早的聊天记录</div>` + newHtml;
    }

    messagesArea.innerHTML = newHtml;
    scrollToBottom(smooth);
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
let _lastBtnMode = null; // 'mic' | 'send' | null
let _lastBtnDisabled = null;
let _lastKiwiOpacity = null;

export function updateButtonStates() {
    const input = document.getElementById('chat_input');
    const sendBtn = document.getElementById('chat_send_btn');
    const kiwiBtn = document.getElementById('chat_kiwi_btn');
    const hasText = input?.value?.trim().length > 0;
    const hasDrafts = pendingMessages.length > 0;
    const hasImage = !!_pendingImageData;

    if (sendBtn) {
        if (!hasText && !hasDrafts && !hasImage) {
            // Mic mode — only rewrite innerHTML if mode actually changed
            if (_lastBtnMode !== 'mic') {
                sendBtn.classList.add('mic-mode');
                sendBtn.innerHTML = `<svg width="20" height="16" viewBox="0 0 20 16" fill="currentColor">
                    <rect x="0" y="5" width="2.5" height="6" rx="1"/>
                    <rect x="4" y="2" width="2.5" height="12" rx="1"/>
                    <rect x="8" y="4" width="2.5" height="8" rx="1"/>
                    <rect x="12" y="1" width="2.5" height="14" rx="1"/>
                    <rect x="16" y="3" width="2.5" height="10" rx="1"/>
                </svg>`;
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
                sendBtn.innerHTML = '<i class="fa-solid fa-arrow-up"></i>';
                _lastBtnMode = 'send';
            }
            const shouldDisable = isGenerating;
            if (_lastBtnDisabled !== shouldDisable) {
                sendBtn.disabled = shouldDisable;
                _lastBtnDisabled = shouldDisable;
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
