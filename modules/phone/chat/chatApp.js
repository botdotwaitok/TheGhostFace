// modules/phone/chat/chatApp.js — iMessage-style Chat App
// Entry point for the chat feature within the GhostFace phone.

import { openAppInViewport, updateAppBadge } from '../phoneController.js';
import { callPhoneLLM } from '../../api.js';
import { cleanLlmJson } from '../utils/llmJsonCleaner.js';
import {
    loadChatHistory, saveChatHistory, clearChatHistory, deleteMessageByIndex,
    deleteMessagesByIndices, updateMessageByIndex,
    getCharacterInfo, getUserName,
    sendSummaryAsUserMessage,
    sendRawTranscriptAsUserMessage,
    maybeAutoSummarize,
} from './chatStorage.js';
import { generateSummary, isContentSimilar } from '../../summarizer.js';
import { saveToWorldBook } from '../../worldbook.js';
import { buildChatSystemPrompt, buildChatUserPrompt, buildSummarizePrompt, stripMomentsCommands, activateCommunityContext } from './chatPromptBuilder.js';
import {
    startBackgroundGeneration, consumePendingResult, consumeError,
    isBackgroundGenerating, hasPendingResult, hasError,
    cancelRetry,
} from './backgroundGen.js';
import {
    getInventory, activateItem, getActiveEffects,
    getActiveChatEffects, decrementChatEffects,
    getActivePersonalityOverrides, decrementPersonalityOverrides,
    getActiveSpecialMessageEffects, consumeSpecialMessage,
    getActivePrankEffects, consumePrankEffect,
} from '../shop/shopStorage.js';
import { getShopItem } from '../shop/shopData.js';
import { getPrankEventCardHtml } from '../shop/prankSystem.js';
import { CHARACTER_GIFTS, getGiftEventCardHtml, triggerCrossplatformGift, markGiftSent } from '../shop/giftSystem.js';
import { getRobberyResultCardHtml, getAutoRobberyCardHtml, triggerRobbery, getRandomVictimList, shouldAutoRobToday, markRobberyDone, broadcastRobberyToMoments } from '../shop/robberySystem.js';
import { tryAutoStartKeepAlive } from '../keepAlive.js';
import { hasAutoMessagePending, consumeAutoMessages, resetAutoMessageTimer } from './autoMessage.js';

// ═══════════════════════════════════════════════════════════════════════
// State
// ═══════════════════════════════════════════════════════════════════════

let pendingMessages = [];          // Strings queued by the user before sending
let isGenerating = false;          // Lock to prevent double sends
let isDeleteMode = false;          // Delete-mode toggle
let selectedForDeletion = new Set(); // Batch-select indices for deletion
let isEditMode = false;            // Edit-mode toggle
let selectedEditIndex = -1;        // Which message is being edited
let _overlayOpenedAt = 0;          // Timestamp guard for overlay dismiss (prevents ghost-click close)
let _responseReadyHandler = null;  // Stored reference for cleanup of 'phone-chat-response-ready' listener
let _retryHandler = null;          // Stored reference for cleanup of 'phone-chat-retry' listener
let _autoMsgHandler = null;        // Stored reference for cleanup of 'phone-auto-message-ready' listener
let _retryCountdownTimer = null;   // Interval ID for live countdown display

const CHAT_LOG_PREFIX = '[聊天]';

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
        <button class="chat-nav-btn" id="chat_menu_btn" title="更多">
            <i class="fa-solid fa-ellipsis"></i>
        </button>`;

    openAppInViewport(titleHtml, html, () => {
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
            _renderAutoMessages(consumeAutoMessages());
            updateAppBadge('chat', 0);
        }

        // ── If background generation is still running, show typing indicator ──
        if (isBackgroundGenerating()) {
            showTypingIndicator(true);
        }
    }, actionsHtml);
}

// ═══════════════════════════════════════════════════════════════════════
// HTML Builders
// ═══════════════════════════════════════════════════════════════════════

function buildChatPage(history) {
    const charInfo = getCharacterInfo();
    const charName = charInfo?.name || '角色';

    // Messages HTML
    const displayHistory = history.slice(-20);
    const hasMore = history.length > 20;

    let messagesHtml = displayHistory.length > 0
        ? buildMessagesHtml(displayHistory, history.length - displayHistory.length)
        : `<div class="chat-empty">
               <div class="chat-empty-icon">💬</div>
               <div class="chat-empty-text">开始和你的${escHtml(charName)}聊天吧…</div>
           </div>`;

    if (hasMore && displayHistory.length > 0) {
        messagesHtml = `<div class="chat-load-more" id="chat_load_more_btn" data-limit="20">查看更早的聊天记录</div>` + messagesHtml;
    }

    return `
    <div class="chat-page" id="chat_page_root">
        <!-- Buff indicator bar (Phase 2) -->
        <div class="chat-buff-bar" id="chat_buff_bar"></div>

        <!-- Messages area -->
        <div class="chat-messages" id="chat_messages_area">
            ${messagesHtml}
        </div>

        <!-- Draft area -->
        <div class="chat-draft-area" id="chat_draft_area" style="display:none;">
            <div class="chat-draft-label">待发送:</div>
            <div id="chat_draft_list"></div>
        </div>

        <!-- Input bar — iMessage layout: [+] [input] [🥝] [↑] -->
        <div class="chat-input-bar" id="chat_input_bar">
            <button class="chat-btn-plus" id="chat_plus_btn" title="更多选项">
                <i class="fa-solid fa-plus"></i>
            </button>
            <div class="chat-input-wrap">
                <textarea class="chat-input" id="chat_input" rows="1"
                    placeholder="输入消息…"></textarea>
            </div>
            <button class="chat-btn-kiwi" id="chat_kiwi_btn" title="添加到待发">
                🥝
            </button>
            <button class="chat-btn-send" id="chat_send_btn" title="发送" disabled>
                <i class="fa-solid fa-arrow-up"></i>
            </button>
        </div>

        <!-- Delete mode toolbar (hidden by default) -->
        <div class="chat-delete-toolbar" id="chat_delete_toolbar" style="display:none;">
            <div class="chat-delete-toolbar-info">
                <span id="chat_delete_count">已选 0 条</span>
            </div>
            <div class="chat-delete-toolbar-actions">
                <button class="chat-delete-toolbar-btn select-all" id="chat_select_all_btn">全选</button>
                <button class="chat-delete-toolbar-btn cancel" id="chat_delete_cancel_btn">取消</button>
                <button class="chat-delete-toolbar-btn confirm" id="chat_delete_confirm_btn" disabled>删除</button>
            </div>
        </div>

        <!-- Plus action panel (bottom sheet) -->
        <div class="chat-plus-overlay" id="chat_plus_overlay">
            <div class="chat-plus-panel">
                <div class="chat-plus-title">发送特殊消息</div>
                <div class="chat-plus-grid">
                    <div class="chat-plus-item" data-template="[语音消息:内容描述(时长)]">
                        <div class="chat-plus-icon voice"><i class="fa-solid fa-microphone"></i></div>
                        <div class="chat-plus-label">语音</div>
                    </div>
                    <div class="chat-plus-item" data-template="[图片:图片描述]">
                        <div class="chat-plus-icon image"><i class="fa-solid fa-image"></i></div>
                        <div class="chat-plus-label">图片</div>
                    </div>
                    <div class="chat-plus-item" id="chat_plus_inventory_btn">
                        <div class="chat-plus-icon inventory"><i class="fa-solid fa-box-open"></i></div>
                        <div class="chat-plus-label">道具</div>
                    </div>
                    <div class="chat-plus-item" data-template="[分享:标题]">
                        <div class="chat-plus-icon share"><i class="fa-solid fa-share-from-square"></i></div>
                        <div class="chat-plus-label">分享</div>
                    </div>
                </div>
                <div class="chat-plus-divider"></div>
                <div class="chat-plus-home" id="chat_return_home_btn">
                    <div class="chat-plus-home-icon">🏠</div>
                    <div class="chat-plus-home-text">
                        <div class="chat-plus-home-title">我已回家</div>
                        <div class="chat-plus-home-desc">总结今日聊天，回到线下互动</div>
                    </div>
                </div>
                <div class="chat-plus-cancel" id="chat_plus_cancel">取消</div>
            </div>
        </div>

        <!-- Inventory (道具背包) overlay -->
        <div class="chat-inventory-overlay" id="chat_inventory_overlay">
            <div class="chat-inventory-panel">
                <div class="chat-inventory-header">
                    <div class="chat-inventory-title"><i class="fa-solid fa-box-open"></i> 道具背包</div>
                    <button class="chat-inventory-close" id="chat_inventory_close_btn"><i class="fa-solid fa-xmark"></i></button>
                </div>
                <div class="chat-inventory-list" id="chat_inventory_list"></div>
                <div class="chat-inventory-active" id="chat_inventory_active"></div>
            </div>
        </div>

        <!-- Action sheet menu (top-right ⋯) -->
        <div class="chat-menu-overlay" id="chat_menu_overlay">
            <div class="chat-menu-sheet">
                <div class="chat-menu-item" id="chat_reroll_btn">重新生成</div>
                <div class="chat-menu-item" id="chat_edit_mode_btn">编辑消息</div>
                <div class="chat-menu-item" id="chat_delete_mode_btn">删除消息</div>
                <div class="chat-menu-item danger" id="chat_clear_history">清空聊天记录</div>
                <div class="chat-menu-cancel" id="chat_menu_cancel">取消</div>
            </div>
        </div>

        <!-- Edit message overlay -->
        <div class="chat-edit-overlay" id="chat_edit_overlay">
            <div class="chat-edit-panel">
                <div class="chat-edit-header">
                    <span class="chat-edit-title">编辑消息</span>
                    <button class="chat-edit-close" id="chat_edit_close_btn"><i class="fa-solid fa-xmark"></i></button>
                </div>
                <textarea class="chat-edit-textarea" id="chat_edit_textarea" rows="4" placeholder="输入新内容…"></textarea>
                <div class="chat-edit-actions">
                    <button class="chat-edit-cancel-btn" id="chat_edit_cancel_btn">取消</button>
                    <button class="chat-edit-save-btn" id="chat_edit_save_btn">保存</button>
                </div>
            </div>
        </div>
    </div>
    `;
}

function buildMessagesHtml(history, startIndex = 0) {
    let html = '';
    let lastRole = null;
    let lastTimestamp = null;

    for (let i = 0; i < history.length; i++) {
        const msg = history[i];
        const globalIndex = startIndex + i;

        // Time divider (show if > 5 min gap)
        if (msg.timestamp) {
            const msgTime = new Date(msg.timestamp);
            if (!lastTimestamp || (msgTime - lastTimestamp) > 5 * 60 * 1000) {
                html += `<div class="chat-time-divider">${formatChatTime(msgTime)}</div>`;
            }
            lastTimestamp = msgTime;
        }

        // Check for retracted message
        if (msg.content === '[撤回了一条消息]') {
            const name = msg.role === 'char' ? (getCharacterInfo()?.name || '对方') : getUserName();
            html += `<div class="chat-retract">${escHtml(name)}撤回了一条消息</div>`;
            // If recall blocker revealed content, show "peeked" bubble
            if (msg.recalledContent && msg.role === 'char') {
                html += buildRecalledPeekBubble(msg.recalledContent);
            }
            lastRole = null;
            continue;
        }

        // Regular or special bubble (pass thought, reactions for char messages)
        html += buildBubbleRow(msg.role, msg.content, msg.thought, globalIndex, msg.reactions);
        lastRole = msg.role;
    }

    return html;
}

function buildBubbleRow(role, content, thought, msgIndex, reactions) {
    const parsed = parseSpecialMessages(content);
    let thoughtHtml = '';
    if (role === 'char' && thought) {
        thoughtHtml = `<div class="chat-bubble chat-thought-bubble collapsed">${escHtml(thought)}</div>`;
    }
    const indexAttr = msgIndex !== undefined ? ` data-msg-index="${msgIndex}"` : '';

    // Batch-select checkbox (shown in delete mode)
    const checkboxHtml = msgIndex !== undefined
        ? `<div class="chat-select-checkbox" data-msg-index="${msgIndex}"><i class="fa-solid fa-check"></i></div>`
        : '';

    // Reaction badge
    let reactionHtml = '';
    if (reactions && typeof reactions === 'object' && Object.keys(reactions).length > 0) {
        const badges = Object.entries(reactions)
            .filter(([, count]) => count > 0)
            .map(([emoji, count]) => `<span class="chat-reaction-item">${emoji}${count > 1 ? ` ${count}` : ''}</span>`)
            .join('');
        if (badges) {
            reactionHtml = `<div class="chat-reaction-badge" data-msg-index="${msgIndex}">${badges}</div>`;
        }
    }

    return `
    <div class="chat-bubble-row ${role}"${indexAttr}>
        ${checkboxHtml}
        <div class="chat-bubble-column">
            ${parsed}
            ${thoughtHtml}
            ${reactionHtml}
        </div>
    </div>`;
}

// ═══════════════════════════════════════════════════════════════════════
// Special Message Parser
// ═══════════════════════════════════════════════════════════════════════

/**
 * Parse text for special message patterns and render as styled cards.
 * Supports both full-match (entire message is a token) and embedded tokens
 * within mixed text (e.g. "给你~ [礼物:小玩具球]").
 * Falls back to plain text bubble.
 */
function parseSpecialMessages(text) {
    // ── Special token definitions (order matters: first match wins) ──
    const SPECIAL_PATTERNS = [
        {
            // Voice message: [语音消息:内容(时长)]
            regex: /\[语音消息[:：](.+?)(?:\((\d+)秒\))?\]/,
            render: (m) => {
                const desc = m[1].trim();
                const dur = m[2] || '??';
                return `
                <div class="chat-bubble">
                    <div class="chat-special-card" style="padding: 10px 14px; min-width: auto;">
                        <div style="flex:1; display:flex; align-items:center; justify-content:space-between; gap:12px;">
                            <div style="font-size: 14px;">▶ ${escHtml(desc)}</div>
                            <div class="chat-voice-duration" style="opacity:0.6; font-size:12px;">${dur}″</div>
                        </div>
                    </div>
                </div>`;
            },
        },
        {
            // Image: [图片:描述]
            regex: /\[图片[:：](.+?)\]/,
            render: (m) => `
                <div class="chat-bubble">
                    <div class="chat-special-card">
                        <div class="chat-special-icon image"><i class="fa-solid fa-image"></i></div>
                        <div class="chat-special-content">
                            ${escHtml(m[1].trim())}
                            <div class="chat-special-label">图片</div>
                        </div>
                    </div>
                </div>`,
        },
        {
            // Share: [分享:标题]
            regex: /\[分享[:：](.+?)\]/,
            render: (m) => `
                <div class="chat-bubble">
                    <div class="chat-special-card">
                        <div class="chat-special-icon share"><i class="fa-solid fa-share-from-square"></i></div>
                        <div class="chat-special-content">
                            ${escHtml(m[1].trim())}
                            <div class="chat-special-label">分享</div>
                        </div>
                    </div>
                </div>`,
        },
        {
            // Gift: [礼物:道具名称]
            regex: /\[礼物[::：](.+?)\]/,
            render: (m) => {
                const giftName = m[1].trim();
                const charName = getCharacterInfo()?.name || '角色';
                return getGiftEventCardHtml(giftName, charName);
            },
        },
        {
            // Prank event card: [恶作剧:描述]
            regex: /\[恶作剧[:：](.+?)\]/,
            render: (m) => `
                <div class="chat-bubble">
                    <div class="chat-special-card prank">
                        <div class="chat-special-icon prank"><i class="fa-solid fa-wand-magic-sparkles"></i></div>
                        <div class="chat-special-content">
                            ${escHtml(m[1].trim())}
                            <div class="chat-special-label">恶作剧</div>
                        </div>
                    </div>
                </div>`,
        },
    ];

    // ── Try full-match first (entire text is exactly one special token) ──
    for (const pattern of SPECIAL_PATTERNS) {
        const fullRe = new RegExp(`^${pattern.regex.source}$`);
        const fullMatch = text.match(fullRe);
        if (fullMatch) return pattern.render(fullMatch);
    }

    // ── Scan for embedded special tokens within mixed text ──
    // Try each pattern individually to find the first embedded token
    let firstMatch = null;
    let matchedPattern = null;

    for (const pattern of SPECIAL_PATTERNS) {
        const m = text.match(pattern.regex);
        if (m && (firstMatch === null || m.index < firstMatch.index)) {
            firstMatch = m;
            matchedPattern = pattern;
        }
    }

    if (firstMatch && matchedPattern) {
        const htmlParts = [];
        const tokenStart = firstMatch.index;
        const tokenEnd = tokenStart + firstMatch[0].length;

        // Text before the token → plain bubble
        const before = text.slice(0, tokenStart).trim();
        if (before) {
            htmlParts.push(`<div class="chat-bubble">${escHtml(before)}</div>`);
        }

        // Render the matched token as its special card
        htmlParts.push(matchedPattern.render(firstMatch));

        // Text after the token → plain bubble
        const after = text.slice(tokenEnd).trim();
        if (after) {
            htmlParts.push(`<div class="chat-bubble">${escHtml(after)}</div>`);
        }

        return htmlParts.join('');
    }

    // ── No special tokens found → plain text bubble ──
    return `<div class="chat-bubble">${escHtml(text)}</div>`;
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
    const menuOverlay = document.getElementById('chat_menu_overlay');
    const menuCancel = document.getElementById('chat_menu_cancel');
    const clearHistoryBtn = document.getElementById('chat_clear_history');
    const plusOverlay = document.getElementById('chat_plus_overlay');
    const plusCancel = document.getElementById('chat_plus_cancel');
    const returnHomeBtn = document.getElementById('chat_return_home_btn');
    const messagesArea = document.getElementById('chat_messages_area');

    if (!input) return;

    // Auto-resize textarea
    input.addEventListener('input', () => {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 100) + 'px';
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
        let _didLongPress = false; // Flag to prevent click from firing after long-press

        messagesArea.addEventListener('pointerdown', (e) => {
            if (isDeleteMode || isEditMode) return;
            const row = e.target.closest('.chat-bubble-row[data-msg-index]');
            if (!row) return;
            // Don't trigger on interactive elements (buttons, links, etc.)
            if (e.target.closest('button') || e.target.closest('a') ||
                e.target.closest('.chat-reaction-badge') || e.target.closest('.chat-reaction-picker')) return;
            _longPressTarget = row;
            _didLongPress = false;
            // Prevent native text selection & context menu on mobile
            e.preventDefault();
            _longPressTimer = setTimeout(() => {
                _didLongPress = true;
                const idx = parseInt(row.dataset.msgIndex, 10);
                showReactionPicker(idx, row);
                _longPressTarget = null;
            }, 500);
        });

        messagesArea.addEventListener('pointerup', () => {
            clearTimeout(_longPressTimer);
            _longPressTarget = null;
            // Note: do NOT reset _didLongPress here — let click handler read it
        });

        messagesArea.addEventListener('pointerleave', () => {
            clearTimeout(_longPressTimer);
            _longPressTarget = null;
        });

        // Cancel long-press on scroll (touchmove) or pointer cancel
        messagesArea.addEventListener('touchmove', () => {
            clearTimeout(_longPressTimer);
            _longPressTarget = null;
        }, { passive: true });

        messagesArea.addEventListener('pointercancel', () => {
            clearTimeout(_longPressTimer);
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



            // Thought toggle — only affects the clicked message
            // Skip if clicking on interactive elements inside special cards
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
                // Deselect all
                selectedForDeletion.clear();
                rows.forEach(row => row.classList.remove('selected'));
                selectAllBtn.textContent = '全选';
            } else {
                // Select all
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

    // ─── 🥝 Kiwi button → add to draft (replaces old + button) ───
    if (kiwiBtn) {
        kiwiBtn.addEventListener('click', () => addPendingMessage());
    }

    // ─── Send button ───
    if (sendBtn) {
        sendBtn.addEventListener('click', () => sendAllMessages());
    }

    // ─── Plus panel: special message template items ───
    if (plusOverlay) {
        plusOverlay.querySelectorAll('.chat-plus-item[data-template]').forEach(item => {
            item.addEventListener('click', () => {
                const template = item.dataset.template;
                if (input && template) {
                    input.value = template;
                    input.style.height = 'auto';
                    input.style.height = Math.min(input.scrollHeight, 100) + 'px';
                    updateButtonStates();
                    input.focus();
                    // Select the editable part of the template
                    const colonIdx = template.indexOf(':');
                    if (colonIdx > 0) {
                        const bracketEnd = template.lastIndexOf(']');
                        input.setSelectionRange(colonIdx + 1, bracketEnd > colonIdx ? bracketEnd : template.length);
                    }
                }
                plusOverlay.classList.remove('active');
            });
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
    // Clean up any previous handlers first
    if (_responseReadyHandler) {
        window.removeEventListener('phone-chat-response-ready', _responseReadyHandler);
    }
    _responseReadyHandler = (e) => _handleResponseReady(e);
    window.addEventListener('phone-chat-response-ready', _responseReadyHandler);

    // ── Register retry event handler (countdown UI) ──
    if (_retryHandler) {
        window.removeEventListener('phone-chat-retry', _retryHandler);
    }
    _retryHandler = (e) => _handleRetryEvent(e);
    window.addEventListener('phone-chat-retry', _retryHandler);

    // ── Register auto-message handler ──
    if (_autoMsgHandler) {
        window.removeEventListener('phone-auto-message-ready', _autoMsgHandler);
    }
    _autoMsgHandler = () => _handleAutoMessageReady();
    window.addEventListener('phone-auto-message-ready', _autoMsgHandler);
}



// ═══════════════════════════════════════════════════════════════════════
// Delete Mode (iMessage-style Batch Select) & Reroll
// ═══════════════════════════════════════════════════════════════════════

/**
 * Toggle delete mode — shows checkboxes and delete toolbar.
 */
function toggleDeleteMode() {
    isDeleteMode = !isDeleteMode;
    selectedForDeletion.clear();

    const rows = document.querySelectorAll('.chat-bubble-row[data-msg-index]');
    const inputBar = document.getElementById('chat_input_bar');
    const draftArea = document.getElementById('chat_draft_area');
    const deleteToolbar = document.getElementById('chat_delete_toolbar');

    rows.forEach(row => {
        if (isDeleteMode) {
            row.classList.add('delete-mode');
            row.classList.remove('selected');
        } else {
            row.classList.remove('delete-mode', 'selected');
        }
    });

    // Toggle input bar / delete toolbar visibility
    if (inputBar) inputBar.style.display = isDeleteMode ? 'none' : '';
    if (draftArea && isDeleteMode) draftArea.style.display = 'none';
    if (deleteToolbar) deleteToolbar.style.display = isDeleteMode ? 'flex' : 'none';

    // Update the menu button label
    const deleteModeBtn = document.getElementById('chat_delete_mode_btn');
    if (deleteModeBtn) {
        deleteModeBtn.textContent = isDeleteMode ? '退出删除模式' : '删除消息';
    }

    if (isDeleteMode) updateDeleteToolbar();
}

/**
 * Toggle selection of a single message in batch-delete mode.
 */
function toggleSelectMessage(index, rowElement) {
    if (selectedForDeletion.has(index)) {
        selectedForDeletion.delete(index);
        rowElement.classList.remove('selected');
    } else {
        selectedForDeletion.add(index);
        rowElement.classList.add('selected');
    }
    updateDeleteToolbar();
}

/**
 * Update the delete toolbar count and button state.
 */
function updateDeleteToolbar() {
    const countEl = document.getElementById('chat_delete_count');
    const confirmBtn = document.getElementById('chat_delete_confirm_btn');
    const count = selectedForDeletion.size;

    if (countEl) countEl.textContent = `已选 ${count} 条`;
    if (confirmBtn) confirmBtn.disabled = count === 0;
}

/**
 * Batch delete all selected messages and re-render.
 */
function handleBatchDelete() {
    const count = selectedForDeletion.size;
    if (count === 0) return;

    if (!confirm(`确定删除 ${count} 条消息吗？`)) return;

    const indices = [...selectedForDeletion];
    const deleted = deleteMessagesByIndices(indices);
    console.log(`${CHAT_LOG_PREFIX} 批量删除了 ${deleted} 条消息`);

    selectedForDeletion.clear();

    // Re-render the messages area
    rerenderMessagesArea();

    // Re-apply delete mode
    if (isDeleteMode) {
        const messagesArea = document.getElementById('chat_messages_area');
        messagesArea?.querySelectorAll('.chat-bubble-row[data-msg-index]').forEach(row => {
            row.classList.add('delete-mode');
        });
    }

    updateDeleteToolbar();
}

// ═══════════════════════════════════════════════════════════════════════
// Edit Mode — Tap a message to edit its content in-place
// ═══════════════════════════════════════════════════════════════════════

/**
 * Toggle edit mode — messages become tappable to open the edit overlay.
 */
function toggleEditMode() {
    isEditMode = !isEditMode;
    selectedEditIndex = -1;

    const rows = document.querySelectorAll('.chat-bubble-row[data-msg-index]');
    const inputBar = document.getElementById('chat_input_bar');
    const draftArea = document.getElementById('chat_draft_area');

    rows.forEach(row => {
        if (isEditMode) {
            row.classList.add('edit-mode');
        } else {
            row.classList.remove('edit-mode');
        }
    });

    if (inputBar) inputBar.style.display = isEditMode ? 'none' : '';
    if (draftArea && isEditMode) draftArea.style.display = 'none';

    const editModeBtn = document.getElementById('chat_edit_mode_btn');
    if (editModeBtn) {
        editModeBtn.textContent = isEditMode ? '退出编辑模式' : '编辑消息';
    }
}

/**
 * Close the edit overlay without saving, and exit edit mode.
 */
function closeEditOverlay() {
    const editOverlay = document.getElementById('chat_edit_overlay');
    editOverlay?.classList.remove('active');
    selectedEditIndex = -1;
    // Exit edit mode after closing
    if (isEditMode) toggleEditMode();
}

/**
 * Open the edit overlay pre-filled with the content of the given message index.
 */
function openEditOverlay(msgIndex) {
    const history = loadChatHistory();
    if (msgIndex < 0 || msgIndex >= history.length) return;

    const msg = history[msgIndex];
    selectedEditIndex = msgIndex;

    const textarea = document.getElementById('chat_edit_textarea');
    if (textarea) {
        textarea.value = msg.content || '';
        // Auto-resize
        textarea.style.height = 'auto';
        textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
    }

    const editOverlay = document.getElementById('chat_edit_overlay');
    editOverlay?.classList.add('active');

    // Focus & move cursor to end
    requestAnimationFrame(() => {
        if (textarea) {
            textarea.focus();
            textarea.setSelectionRange(textarea.value.length, textarea.value.length);
        }
    });
}

/**
 * Save the edited content to history and re-render.
 */
function handleEditSave() {
    if (selectedEditIndex < 0) return;

    const textarea = document.getElementById('chat_edit_textarea');
    const newContent = textarea?.value?.trim();
    if (!newContent) return;

    const updated = updateMessageByIndex(selectedEditIndex, newContent);
    if (!updated) return;

    console.log(`${CHAT_LOG_PREFIX} 编辑了消息 [${selectedEditIndex}]`);

    // Close overlay + exit edit mode
    const editOverlay = document.getElementById('chat_edit_overlay');
    editOverlay?.classList.remove('active');
    selectedEditIndex = -1;
    if (isEditMode) toggleEditMode();

    // Re-render messages
    rerenderMessagesArea();
}

/**
 * Reroll — remove the last AI response(s), then re-generate using the
 * same user message context.
 */
async function rerollLastMessage() {

    if (isGenerating) return;

    const history = loadChatHistory();
    if (history.length === 0) return;

    // Remove trailing char messages
    let removedCount = 0;
    while (history.length > 0 && history[history.length - 1].role === 'char') {
        history.pop();
        removedCount++;
    }

    if (removedCount === 0) {
        // No trailing char messages — check if we can still regenerate
        // (e.g. user deleted AI messages manually, last messages are user's)
        if (history.length > 0 && history[history.length - 1].role === 'user') {
            console.log(`${CHAT_LOG_PREFIX} 没有尾部AI消息，但找到用户消息，将直接重新生成`);
            // Fall through to use existing user messages for regeneration
        } else {
            console.log(`${CHAT_LOG_PREFIX} 没有可重新生成的AI消息`);
            return;
        }
    }

    // Collect the last user messages that preceded the removed AI messages
    const lastUserMessages = [];
    for (let i = history.length - 1; i >= 0; i--) {
        if (history[i].role === 'user') {
            lastUserMessages.unshift(history[i].content);
        } else {
            break;
        }
    }

    if (lastUserMessages.length === 0) {
        console.warn(`${CHAT_LOG_PREFIX} 找不到之前的用户消息，无法重新生成`);
        return;
    }

    // Save the trimmed history (without the removed AI messages)
    saveChatHistory(history);

    // Re-render without the removed AI messages
    rerenderMessagesArea();

    // Exit delete mode if active
    if (isDeleteMode) toggleDeleteMode();

    // Now re-generate — reuse the core send logic
    isGenerating = true;
    updateButtonStates();
    showTypingIndicator(true);

    try {
        const systemPrompt = await buildChatSystemPrompt();
        const userPrompt = buildChatUserPrompt(lastUserMessages, history.slice(0, -lastUserMessages.length));

        console.log(`${CHAT_LOG_PREFIX} Reroll: re-generating with ${lastUserMessages.length} user messages...`);

        const rawResponse = await callPhoneLLM(systemPrompt, userPrompt, { maxTokens: 4000 });

        // ─── Route moments commands (朋友圈/评论) to moments system ───
        try {
            const { handleMainChatOutput } = await import('../moments/momentsWorldInfo.js');
            handleMainChatOutput(rawResponse).catch(e =>
                console.warn(`${CHAT_LOG_PREFIX} Moments routing (reroll) failed:`, e));
        } catch (e) { /* moments module not loaded */ }

        const cleanedResponse = stripMomentsCommands(rawResponse);
        const { messages: charMessages } = parseApiResponse(cleanedResponse);

        // Strip moments commands from message text
        for (const cmsg of charMessages) {
            cmsg.text = stripMomentsCommands(cmsg.text) || cmsg.text;
        }

        if (charMessages.length === 0) {
            throw new Error('LLM返回了空的消息数组');
        }

        showTypingIndicator(false);

        const updatedHistory = loadChatHistory();
        const responseTime = new Date().toISOString();

        for (let i = 0; i < charMessages.length; i++) {
            const cmsg = charMessages[i];
            const delay = i === 0 ? 0 : (cmsg.delay || 1) * 300;

            if (delay > 0) {
                showTypingIndicator(true);
                await sleep(Math.min(delay, 2000));
                showTypingIndicator(false);
            }

            const historyEntry = {
                role: 'char',
                content: cmsg.text,
                thought: cmsg.thought || '',
                timestamp: responseTime,
            };
            if (cmsg.recalledContent) {
                historyEntry.recalledContent = cmsg.recalledContent;
            }
            updatedHistory.push(historyEntry);

            if (messagesArea) {
                if (cmsg.text === '[撤回了一条消息]' && cmsg.recalledContent) {
                    const charName = getCharacterInfo()?.name || '对方';
                    messagesArea.insertAdjacentHTML('beforeend',
                        `<div class="chat-retract">${escHtml(charName)}撤回了一条消息</div>`);
                    messagesArea.insertAdjacentHTML('beforeend',
                        buildRecalledPeekBubble(cmsg.recalledContent));
                } else {
                    messagesArea.insertAdjacentHTML('beforeend', buildBubbleRow('char', cmsg.text, cmsg.thought));
                }
            }
            scrollToBottom(true);
        }

        saveChatHistory(updatedHistory);
        renderBuffBar();

    } catch (error) {
        console.error(`${CHAT_LOG_PREFIX} Reroll failed:`, error);
        showTypingIndicator(false);

        if (messagesArea) {
            messagesArea.insertAdjacentHTML('beforeend',
                `<div class="chat-retract">⚠️ 重新生成失败: ${escHtml(error.message)}</div>`);
        }
        scrollToBottom(true);
    } finally {
        isGenerating = false;
        updateButtonStates();
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Emoji Reactions (贴表情)
// ═══════════════════════════════════════════════════════════════════════

const REACTION_EMOJIS = ['❤️', '😂', '👍', '😮', '😢', '🔥'];

/**
 * Show a floating emoji picker above a message bubble.
 */
function showReactionPicker(msgIndex, rowElement) {
    dismissReactionPicker(); // Remove any existing picker

    const isUser = rowElement.classList.contains('user');
    const pickerHtml = `
    <div class="chat-reaction-picker" data-msg-index="${msgIndex}">
        ${REACTION_EMOJIS.map(e => `<button class="chat-reaction-emoji" data-emoji="${e}" data-msg-index="${msgIndex}">${e}</button>`).join('')}
    </div>`;

    // Insert picker above the bubble row
    rowElement.insertAdjacentHTML('beforebegin', pickerHtml);

    // Position the picker
    const picker = rowElement.previousElementSibling;
    if (picker && picker.classList.contains('chat-reaction-picker')) {
        picker.classList.add(isUser ? 'align-right' : 'align-left');
        // Add a small animation
        requestAnimationFrame(() => picker.classList.add('visible'));
    }
}

/**
 * Remove all reaction pickers from the DOM.
 */
function dismissReactionPicker() {
    document.querySelectorAll('.chat-reaction-picker').forEach(el => el.remove());
}

/**
 * Toggle a reaction emoji on a message (add or remove).
 */
function toggleReaction(msgIndex, emoji) {
    const history = loadChatHistory();
    if (msgIndex < 0 || msgIndex >= history.length) return;

    const msg = history[msgIndex];
    if (!msg.reactions) msg.reactions = {};

    if (msg.reactions[emoji]) {
        delete msg.reactions[emoji];
        // Clean up empty reactions object
        if (Object.keys(msg.reactions).length === 0) delete msg.reactions;
    } else {
        msg.reactions[emoji] = 1;
    }

    saveChatHistory(history);

    // Re-render just the reaction badge for this message
    const row = document.querySelector(`.chat-bubble-row[data-msg-index="${msgIndex}"]`);
    if (row) {
        const col = row.querySelector('.chat-bubble-column');
        const existingBadge = col?.querySelector('.chat-reaction-badge');
        if (existingBadge) existingBadge.remove();

        if (msg.reactions && Object.keys(msg.reactions).length > 0) {
            const badges = Object.entries(msg.reactions)
                .filter(([, count]) => count > 0)
                .map(([em, count]) => `<span class="chat-reaction-item">${em}${count > 1 ? ` ${count}` : ''}</span>`)
                .join('');
            if (badges && col) {
                col.insertAdjacentHTML('beforeend',
                    `<div class="chat-reaction-badge" data-msg-index="${msgIndex}">${badges}</div>`);
            }
        }
    }
}

/**
 * Apply AI-generated reactions from the parsed response.
 * Expected format in AI response JSON: "reactions": [{"targetIndex": -1, "emoji": "❤️"}]
 * targetIndex: -1 means "last user message", -2 means "second to last user message", etc.
 */
function applyAIReactions(aiReactions, currentHistory) {
    if (!aiReactions || !Array.isArray(aiReactions) || aiReactions.length === 0) return;

    // Find user message indices
    const userIndices = [];
    for (let i = 0; i < currentHistory.length; i++) {
        if (currentHistory[i].role === 'user') userIndices.push(i);
    }

    for (const reaction of aiReactions) {
        const emoji = reaction.emoji;
        if (!emoji || !REACTION_EMOJIS.includes(emoji)) continue;

        let targetIdx;
        if (reaction.targetIndex < 0) {
            // Negative index: count from end of user messages
            const userPos = userIndices.length + reaction.targetIndex;
            if (userPos < 0 || userPos >= userIndices.length) continue;
            targetIdx = userIndices[userPos];
        } else {
            targetIdx = reaction.targetIndex;
        }

        if (targetIdx < 0 || targetIdx >= currentHistory.length) continue;

        const msg = currentHistory[targetIdx];
        if (!msg.reactions) msg.reactions = {};
        msg.reactions[emoji] = (msg.reactions[emoji] || 0) + 1;
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Pending Messages Logic
// ═══════════════════════════════════════════════════════════════════════

function addPendingMessage() {
    const input = document.getElementById('chat_input');
    const text = input?.value?.trim();
    if (!text || isGenerating) return;

    pendingMessages.push(text);
    input.value = '';
    input.style.height = 'auto';

    renderDraftArea();
    updateButtonStates();
    input.focus();
}

function removePendingMessage(index) {
    pendingMessages.splice(index, 1);
    renderDraftArea();
    updateButtonStates();
}

function renderDraftArea() {
    const area = document.getElementById('chat_draft_area');
    const list = document.getElementById('chat_draft_list');
    if (!area || !list) return;

    if (pendingMessages.length === 0) {
        area.style.display = 'none';
        return;
    }

    area.style.display = 'flex';
    list.innerHTML = pendingMessages.map((msg, i) => `
        <div class="chat-draft-bubble" data-draft-index="${i}">${escHtml(msg)}</div>
    `).join('');

    // Click to remove
    list.querySelectorAll('.chat-draft-bubble').forEach(el => {
        el.addEventListener('click', () => {
            const idx = parseInt(el.dataset.draftIndex);
            removePendingMessage(idx);
        });
    });
}

function updateButtonStates() {
    const input = document.getElementById('chat_input');
    const sendBtn = document.getElementById('chat_send_btn');
    const kiwiBtn = document.getElementById('chat_kiwi_btn');
    const hasText = input?.value?.trim().length > 0;
    const hasDrafts = pendingMessages.length > 0;

    if (sendBtn) {
        sendBtn.disabled = isGenerating || (!hasDrafts && !hasText);
    }

    // Kiwi button visual feedback
    if (kiwiBtn) {
        kiwiBtn.style.opacity = hasText ? '1' : '0.4';
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Send & API Call
// ═══════════════════════════════════════════════════════════════════════

async function sendAllMessages() {
    // iOS keep-alive: auto-start silent audio on first message send
    tryAutoStartKeepAlive();

    const input = document.getElementById('chat_input');
    const remainingText = input?.value?.trim();

    // If there's text in the input field, add it to pending
    if (remainingText) {
        pendingMessages.push(remainingText);
        if (input) {
            input.value = '';
            input.style.height = 'auto';
        }
    }

    if (pendingMessages.length === 0 || isGenerating) return;

    isGenerating = true;
    updateButtonStates();

    const messagesToSend = [...pendingMessages];
    pendingMessages = [];
    renderDraftArea();

    // Load history, add user messages
    const history = loadChatHistory();
    const historyBeforeSend = [...history]; // snapshot for prompt building
    const now = new Date().toISOString();

    for (const msg of messagesToSend) {
        history.push({ role: 'user', content: msg, timestamp: now });
    }
    saveChatHistory(history);

    // Render user messages immediately
    const messagesArea = document.getElementById('chat_messages_area');
    if (messagesArea) {
        // Remove empty state if present
        const emptyState = messagesArea.querySelector('.chat-empty');
        if (emptyState) emptyState.remove();

        // Maybe add time divider (show if > 5 min since last divider, or no divider exists)
        const allDividers = messagesArea.querySelectorAll('.chat-time-divider');
        const lastTimeDiv = allDividers.length > 0 ? allDividers[allDividers.length - 1] : null;
        let needTime = !lastTimeDiv;
        if (lastTimeDiv && !needTime) {
            // Parse the displayed time to check gap (approximate: always show if > 5 min)
            needTime = true; // Safe default: always add a divider on new sends
        }
        if (needTime) {
            messagesArea.insertAdjacentHTML('beforeend',
                `<div class="chat-time-divider">${formatChatTime(new Date())}</div>`
            );
        }

        for (const msg of messagesToSend) {
            messagesArea.insertAdjacentHTML('beforeend', buildBubbleRow('user', msg));
        }
    }

    scrollToBottom(true);

    // Show typing indicator
    showTypingIndicator(true);

    // ── Fire off background generation (does NOT block the UI) ──
    // The result will be handled by _handleResponseReady() via event
    startBackgroundGeneration(messagesToSend, historyBeforeSend);

    // Reset auto-message timer (user just sent a message, restart idle countdown)
    resetAutoMessageTimer();
}

// ═══════════════════════════════════════════════════════════════════════
// Background Generation — Response Handler
// ═══════════════════════════════════════════════════════════════════════

/**
 * Check if the user is currently viewing the chat app.
 * Uses viewport activation state + presence of chat DOM root.
 */
function isUserInChatApp() {
    const viewport = document.getElementById('phone_app_viewport');
    const chatRoot = document.getElementById('chat_page_root');
    return viewport?.classList.contains('app-active') && !!chatRoot;
}

/**
 * Handle the 'phone-chat-response-ready' event from backgroundGen.
 * If user is still in chat → render immediately with animations.
 * If user has left → store result, show badge on desktop icon.
 */
function _handleResponseReady(e) {
    const { success, error } = e.detail || {};

    // Clear any retry countdown UI
    _clearRetryCountdown();

    if (isUserInChatApp()) {
        // User is still in chat — render result immediately
        if (success && hasPendingResult()) {
            const result = consumePendingResult();
            if (result) {
                renderResponseToDom(result.rawResponse, result.messagesToSend);
            }
        } else if (!success) {
            const errMsg = consumeError();
            showTypingIndicator(false);
            const messagesArea = document.getElementById('chat_messages_area');
            if (messagesArea && errMsg) {
                messagesArea.insertAdjacentHTML('beforeend',
                    `<div class="chat-retract">⚠️ 发送失败: ${escHtml(errMsg)}</div>`);
            }
            scrollToBottom(true);
        }
        // Reset generating state
        isGenerating = false;
        updateButtonStates();
    } else {
        // User left chat — keep result in memory, show badge
        console.log(`${CHAT_LOG_PREFIX} User not in chat, setting badge notification.`);
        if (success) {
            updateAppBadge('chat', 1);
        }
        // Reset generating state (user will consume result when re-opening)
        isGenerating = false;
    }
}

/**
 * Handle the 'phone-chat-retry' event from backgroundGen.
 * Shows a countdown message in chat with a cancel button.
 */
function _handleRetryEvent(e) {
    const { attempt, maxRetries, retryInSeconds, error: errMsg } = e.detail || {};

    if (!isUserInChatApp()) return; // No UI to show if user isn't in chat

    const messagesArea = document.getElementById('chat_messages_area');
    if (!messagesArea) return;

    // Remove any previous retry notice
    _clearRetryCountdown();

    // Create retry notice with live countdown
    let remaining = retryInSeconds;
    const noticeId = `chat_retry_notice_${Date.now()}`;
    messagesArea.insertAdjacentHTML('beforeend', `
        <div class="chat-retry-notice" id="${noticeId}">
            <div class="chat-retry-text">
                ⚠️ 生成失败: ${escHtml(errMsg)}
            </div>
            <div class="chat-retry-countdown">
                ⏳ <span class="chat-retry-seconds">${remaining}</span>秒后重试 (${attempt}/${maxRetries})
            </div>
            <button class="chat-retry-cancel-btn" id="chat_retry_cancel_btn">取消重试</button>
        </div>
    `);

    // Hide typing indicator during countdown
    showTypingIndicator(false);
    scrollToBottom(true);

    // Bind cancel button
    const cancelBtn = document.getElementById('chat_retry_cancel_btn');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
            cancelRetry();
            _clearRetryCountdown();
            // Show cancelled notice
            if (messagesArea) {
                messagesArea.insertAdjacentHTML('beforeend',
                    `<div class="chat-retract">🚫 已取消重试</div>`);
                scrollToBottom(true);
            }
            // Reset generating state
            isGenerating = false;
            updateButtonStates();
            showTypingIndicator(false);
        });
    }

    // Live countdown
    _retryCountdownTimer = setInterval(() => {
        remaining--;
        const secondsEl = document.querySelector(`#${noticeId} .chat-retry-seconds`);
        if (secondsEl && remaining > 0) {
            secondsEl.textContent = remaining;
        } else {
            // Countdown done — show "retrying..." state
            clearInterval(_retryCountdownTimer);
            _retryCountdownTimer = null;
            const notice = document.getElementById(noticeId);
            if (notice) {
                notice.innerHTML = `<div class="chat-retry-text">🔄 正在重试生成... (${attempt}/${maxRetries})</div>`;
            }
            showTypingIndicator(true);
        }
    }, 1000);
}

/** Clear the retry countdown interval and remove any retry notice from DOM */
function _clearRetryCountdown() {
    if (_retryCountdownTimer) {
        clearInterval(_retryCountdownTimer);
        _retryCountdownTimer = null;
    }
    // Remove retry notice from DOM
    const notice = document.querySelector('.chat-retry-notice');
    if (notice) notice.remove();
}

// ═══════════════════════════════════════════════════════════════════════
// Auto Message — Handler & Renderer
// ═══════════════════════════════════════════════════════════════════════

/**
 * Handle the 'phone-auto-message-ready' event from autoMessage.js.
 * If user is in chat → render immediately. Otherwise badge is already set.
 */
function _handleAutoMessageReady() {
    if (!isUserInChatApp()) return;

    if (hasAutoMessagePending()) {
        const msgs = consumeAutoMessages();
        if (msgs) {
            _renderAutoMessages(msgs);
            updateAppBadge('chat', 0);
        }
    }
}

/**
 * Render auto-generated character messages to the DOM.
 * @param {Array<{text: string, thought?: string, delay?: number}>} messages
 */
function _renderAutoMessages(messages) {
    if (!messages || messages.length === 0) return;

    const messagesArea = document.getElementById('chat_messages_area');
    if (!messagesArea) return;

    // Remove empty state if present
    const emptyState = messagesArea.querySelector('.chat-empty');
    if (emptyState) emptyState.remove();

    // Maybe add time divider
    messagesArea.insertAdjacentHTML('beforeend',
        `<div class="chat-time-divider">${formatChatTime(new Date())}</div>`
    );

    for (const msg of messages) {
        const text = (msg.text || msg.content || '').trim();
        if (!text) continue;
        messagesArea.insertAdjacentHTML('beforeend', buildBubbleRow('char', text));
    }

    scrollToBottom(true);
}

/**
 * Parse raw AI response and render character messages to the DOM.
 * This handles all the post-generation logic: message rendering,
 * buff decrements, gift detection, reactions, etc.
 * Used by both "immediate" (user in chat) and "deferred" (re-open) paths.
 *
 * @param {string} rawResponse - Raw LLM response text
 * @param {string[]} messagesToSend - The user messages that triggered this response
 */
async function renderResponseToDom(rawResponse, messagesToSend) {
    const messagesArea = document.getElementById('chat_messages_area');

    try {
        // Parse JSON response — strip moments commands first so they don't break JSON.parse
        const cleanedResponse = stripMomentsCommands(rawResponse);
        const { messages: charMessages, aiReactions } = parseApiResponse(cleanedResponse);

        if (charMessages.length === 0) {
            throw new Error('LLM返回了空的消息数组');
        }

        // Strip moments commands from message text (in case LLM put them inside)
        for (const cmsg of charMessages) {
            cmsg.text = stripMomentsCommands(cmsg.text) || cmsg.text;
        }

        // Hide typing, render character messages with staggered delays
        showTypingIndicator(false);

        const updatedHistory = loadChatHistory();
        const responseTime = new Date().toISOString();

        for (let i = 0; i < charMessages.length; i++) {
            const cmsg = charMessages[i];
            const delay = i === 0 ? 0 : (cmsg.delay || 1) * 300; // Scale delay for UX (not full seconds)

            if (delay > 0) {
                showTypingIndicator(true);
                await sleep(Math.min(delay, 2000));
                showTypingIndicator(false);
            }

            // Save to history (including thought + recalledContent)
            const historyEntry = {
                role: 'char',
                content: cmsg.text,
                thought: cmsg.thought || '',
                timestamp: responseTime,
            };
            if (cmsg.recalledContent) {
                historyEntry.recalledContent = cmsg.recalledContent;
            }
            updatedHistory.push(historyEntry);

            // Render bubble with thought (and recalled peek if applicable)
            if (messagesArea) {
                if (cmsg.text === '[撤回了一条消息]' && cmsg.recalledContent) {
                    // Recall blocker: show retract notice + peeked content
                    const charName = getCharacterInfo()?.name || '对方';
                    messagesArea.insertAdjacentHTML('beforeend',
                        `<div class="chat-retract">${escHtml(charName)}撤回了一条消息</div>`);
                    messagesArea.insertAdjacentHTML('beforeend',
                        buildRecalledPeekBubble(cmsg.recalledContent));
                } else {
                    messagesArea.insertAdjacentHTML('beforeend', buildBubbleRow('char', cmsg.text, cmsg.thought));
                }
            }

            scrollToBottom(true);
        }

        // ─── Apply AI reactions to user messages ───
        try {
            if (aiReactions && aiReactions.length > 0) {
                applyAIReactions(aiReactions, updatedHistory);
            }
        } catch (e) { console.warn('[聊天] AI reactions error:', e); }

        saveChatHistory(updatedHistory);

        // Re-render to show reactions (lightweight: just update badges)
        if (aiReactions && aiReactions.length > 0) {
            // Full re-render to show the new reaction badges
            rerenderMessagesArea(true);
        }

        // ─── Phase 2: Decrement chat buff effects ───
        const expired = decrementChatEffects();
        if (expired.length > 0) {
            for (const expId of expired) {
                const expItem = getShopItem(expId);
                if (expItem) {
                    showTypingIndicator(false);
                    if (messagesArea) {
                        messagesArea.insertAdjacentHTML('beforeend',
                            `<div class="chat-retract">✨ 【${escHtml(expItem.name)}】效果已消退</div>`);
                    }
                }
            }
        }

        // ─── Phase 4: Decrement personality override effects ───
        const expiredOverrides = decrementPersonalityOverrides();
        if (expiredOverrides.length > 0) {
            for (const expId of expiredOverrides) {
                const expItem = getShopItem(expId);
                if (expItem) {
                    showTypingIndicator(false);
                    if (messagesArea) {
                        messagesArea.insertAdjacentHTML('beforeend',
                            `<div class="chat-retract">🎭 【${escHtml(expItem.name)}】人格已恢复正常</div>`);
                    }
                }
            }
        }

        // ─── Phase 4: Consume one-shot special message effects ───
        try {
            const specialEffects = getActiveSpecialMessageEffects();
            for (const effect of specialEffects) {
                consumeSpecialMessage(effect.itemId);
                const expItem = getShopItem(effect.itemId);
                if (expItem && messagesArea) {
                    messagesArea.insertAdjacentHTML('beforeend',
                        `<div class="chat-retract">🎭 【${escHtml(expItem.name)}】已触发完毕</div>`);
                }
            }
        } catch (e) { /* */ }

        // ─── Phase 5: Consume prank effects + show event cards ───
        try {
            const prankEffects = getActivePrankEffects();
            for (const effect of prankEffects) {
                consumePrankEffect(effect.itemId);
                const expItem = getShopItem(effect.itemId);
                if (expItem && messagesArea) {
                    messagesArea.insertAdjacentHTML('beforeend',
                        getPrankEventCardHtml(effect.itemId));
                    messagesArea.insertAdjacentHTML('beforeend',
                        `<div class="chat-retract">🎭 【${escHtml(expItem.name)}】恶作剧已发动！</div>`);
                }
            }
        } catch (e) { /* */ }

        // ─── Phase 5: Detect gift messages + fire cross-platform delivery + mark daily ───
        try {
            const charName = getCharacterInfo()?.name || '角色';
            let giftDetected = false;
            for (const cmsg of charMessages) {
                const giftRegex = /\[礼物[::：](.+?)\]/g;
                let match;
                while ((match = giftRegex.exec(cmsg.text)) !== null) {
                    const giftName = match[1].trim();
                    if (CHARACTER_GIFTS[giftName]) {
                        giftDetected = true;
                        // Find the status element for this gift card
                        const statusEls = messagesArea?.querySelectorAll('.gift-card-status');
                        const statusId = statusEls?.length ? statusEls[statusEls.length - 1]?.id : null;
                        // Fire-and-forget cross-platform delivery
                        triggerCrossplatformGift(giftName, charName, statusId)
                            .catch(e => console.warn('[GiftSystem] delivery error:', e));
                    }
                }
            }
            // 标记今日已送礼（下次不再注入 prompt）+ 激活社区背景信息
            if (giftDetected) {
                markGiftSent();
                activateCommunityContext();
            }
        } catch (e) { console.warn('[GiftSystem] gift detection error:', e); }

        // ─── Phase 7: Auto Robbery (每日随机，无需用户选择) ───
        try {
            if (shouldAutoRobToday()) {
                const charName2 = getCharacterInfo()?.name || '角色';
                const { html: robCardHtml, cardId: robCardId } = getAutoRobberyCardHtml(charName2);
                if (messagesArea) {
                    messagesArea.insertAdjacentHTML('beforeend',
                        `<div class="chat-bubble-row char"><div class="chat-bubble-column">${robCardHtml}</div></div>`);
                    scrollToBottom(true);
                }
                // 标记已执行（无论结果如何）+ 激活社区背景信息
                markRobberyDone();
                activateCommunityContext();
                // 获取候选目标并执行
                const candidates = await getRandomVictimList();
                if (candidates && candidates.length > 0) {
                    const result = await triggerRobbery(candidates, charName2, `${robCardId}_status`);
                    // 展示结果卡片
                    if (messagesArea && result && !result.error) {
                        messagesArea.insertAdjacentHTML('beforeend',
                            `<div class="chat-bubble-row char"><div class="chat-bubble-column">${getRobberyResultCardHtml(result, charName2)}</div></div>`);
                        scrollToBottom(true);
                        // 广播到 Moments
                        broadcastRobberyToMoments(result, charName2).catch(e =>
                            console.warn('[RobberySystem] broadcast error:', e));
                    }
                } else {
                    // 没有候选目标
                    const statusEl = document.getElementById(`${robCardId}_status`);
                    if (statusEl) statusEl.textContent = '⚠️ 找不到可以抢劫的目标';
                }
            }
        } catch (e) { console.warn('[RobberySystem] auto-robbery error:', e); }


        renderBuffBar();

        // ─── Auto-summarize check (fire-and-forget, non-blocking) ───
        maybeAutoSummarize().catch(e => console.warn('[聊天] 自动总结后台错误:', e));

    } catch (error) {
        console.error(`${CHAT_LOG_PREFIX} Response rendering failed:`, error);
        showTypingIndicator(false);

        // Show error as system message
        if (messagesArea) {
            messagesArea.insertAdjacentHTML('beforeend',
                `<div class="chat-retract">⚠️ 发送失败: ${escHtml(error.message)}</div>`
            );
        }
        scrollToBottom(true);
    }
}

/**
 * Parse the API response — expects JSON with { messages: [...] }
 * Falls back gracefully if the LLM doesn't return perfect JSON.
 */
function parseApiResponse(raw) {
    // Extract clean JSON from the response (handles markdown code fences & garbage text)
    const jsonStr = cleanLlmJson(raw);

    try {
        const parsed = JSON.parse(jsonStr);

        const mapMsg = (m) => ({
            text: m.text.trim(),
            thought: (m.thought && typeof m.thought === 'string') ? m.thought.trim() : '',
            delay: typeof m.delay === 'number' ? m.delay : 1,
            // Phase 2: recall blocker support
            recalledContent: (m.recalledContent && typeof m.recalledContent === 'string') ? m.recalledContent.trim() : '',
        });

        // Extract optional AI reactions
        let aiReactions = null;
        if (parsed.reactions && Array.isArray(parsed.reactions)) {
            aiReactions = parsed.reactions;
        }

        if (parsed.messages && Array.isArray(parsed.messages)) {
            return {
                messages: parsed.messages
                    .filter(m => m.text && typeof m.text === 'string')
                    .map(mapMsg),
                aiReactions,
            };
        }

        // Maybe it's just an array
        if (Array.isArray(parsed)) {
            return {
                messages: parsed
                    .filter(m => m.text && typeof m.text === 'string')
                    .map(mapMsg),
                aiReactions: null,
            };
        }
    } catch (e) {
        console.warn(`${CHAT_LOG_PREFIX} JSON parse failed, trying line-split fallback`);
    }

    // Fallback: split by double newlines or ---, treat each as a message
    const lines = raw
        .split(/(?:\n\s*\n|---+)/)
        .map(l => l.trim())
        .filter(Boolean);

    if (lines.length > 0) {
        return {
            messages: lines.map((line, i) => ({
                text: line,
                thought: '',
                delay: i === 0 ? 0 : 1,
                recalledContent: '',
            })), aiReactions: null
        };
    }

    // Last resort: entire response as one message
    return { messages: [{ text: raw.trim(), thought: '', delay: 0, recalledContent: '' }], aiReactions: null };
}

// ═══════════════════════════════════════════════════════════════════════
// "我已回家" — Return Home Logic
// ═══════════════════════════════════════════════════════════════════════

async function handleReturnHome() {
    const history = loadChatHistory();

    if (history.length === 0) {
        alert('还没有聊天记录，不需要同步～');
        return;
    }

    // Read user preferences from localStorage
    const doMemoryFragments = localStorage.getItem('gf_phone_rh_memory') === 'true';
    const syncMode = localStorage.getItem('gf_phone_rh_sync_mode') || 'summary';

    const modeLabel = syncMode === 'raw' ? '原文灌入' : 'AI压缩总结';
    const memoryLabel = doMemoryFragments ? '✅ 提取记忆碎片' : '❌ 不提取记忆碎片';

    if (!confirm(`确定要结束手机聊天并回到线下吗？\n\n当前设置：\n📄 同步方式: ${modeLabel}\n🧩 ${memoryLabel}\n\n（可在 设置 → 回家模式 中修改）`)) {
        return;
    }

    const charName = getCharacterInfo()?.name || '角色';
    const userName = getUserName();

    // Show a "syncing" status
    const messagesArea = document.getElementById('chat_messages_area');
    if (messagesArea) {
        messagesArea.insertAdjacentHTML('beforeend',
            `<div class="chat-retract" id="chat_sync_status">🏠 正在处理回家流程…</div>`
        );
    }
    scrollToBottom(true);

    try {
        // ─── Optional Step: Memory Fragment Extraction ───
        if (doMemoryFragments) {
            const statusEl = document.getElementById('chat_sync_status');
            if (statusEl) statusEl.textContent = '🧩 正在提取记忆碎片…';

            console.log(`${CHAT_LOG_PREFIX} Return home: extracting memory fragments...`);

            try {
                // Convert phone chat messages to the format generateSummary() expects
                const summarizerMessages = history.map(msg => ({
                    parsedContent: msg.content || '',
                    parsedDate: msg.timestamp ? new Date(msg.timestamp).toLocaleDateString('zh-CN') : null,
                    is_user: msg.role === 'user',
                    is_system: false,
                    name: msg.role === 'user' ? userName : charName,
                }));

                const fragments = await generateSummary(summarizerMessages);
                if (fragments && Array.isArray(fragments) && fragments.length > 0) {
                    await saveToWorldBook(fragments, null, null, isContentSimilar, false);
                    console.log(`${CHAT_LOG_PREFIX} ✅ 记忆碎片已写入世界书: ${fragments.length} 条`);
                    if (statusEl) statusEl.textContent = `🧩 记忆碎片提取完成！写入 ${fragments.length} 条。正在同步…`;
                } else {
                    console.log(`${CHAT_LOG_PREFIX} ℹ️ 鬼面判断无新记忆碎片`);
                    if (statusEl) statusEl.textContent = '🧩 无新记忆碎片。正在同步…';
                }
            } catch (memErr) {
                console.error(`${CHAT_LOG_PREFIX} 记忆碎片提取失败:`, memErr);
                if (statusEl) statusEl.textContent = '⚠️ 记忆碎片提取失败，继续同步…';
                // Don't abort — continue with sync
            }
        }

        // ─── Sync to ST main chat ───
        const statusEl = document.getElementById('chat_sync_status');

        if (syncMode === 'raw') {
            // ── Raw transcript mode ──
            if (statusEl) statusEl.textContent = '📄 正在将原文聊天记录同步…';
            console.log(`${CHAT_LOG_PREFIX} Return home: sending raw transcript...`);

            await sendRawTranscriptAsUserMessage(history);

            if (statusEl) statusEl.textContent = '🏠 已回家！原文聊天记录已发送，你对象正在回应～';

        } else {
            // ── AI compressed summary mode (default) ──
            if (statusEl) statusEl.textContent = '🤖 正在生成AI压缩总结…';
            console.log(`${CHAT_LOG_PREFIX} Return home: generating AI summary...`);

            const transcript = history.map(msg => {
                const role = msg.role === 'user' ? userName : charName;
                return `${role}: ${msg.content}`;
            }).join('\n');

            const summarizePrompt = buildSummarizePrompt();
            const summaryUserPrompt = `以下是今日手机聊天的完整记录，请进行总结：\n\n${transcript}`;

            const summary = await callPhoneLLM(summarizePrompt, summaryUserPrompt, { maxTokens: 2000 });

            if (!summary || summary.trim().length === 0) {
                throw new Error('总结生成失败');
            }

            console.log(`${CHAT_LOG_PREFIX} Summary generated: ${summary.substring(0, 100)}...`);

            if (statusEl) statusEl.textContent = '✅ 总结生成成功！正在发送…';

            await sendSummaryAsUserMessage(summary.trim());

            if (statusEl) statusEl.textContent = '🏠 已回家！总结已作为消息发送，你对象正在回应～';
        }

        console.log(`${CHAT_LOG_PREFIX} Return home flow completed successfully (mode: ${syncMode}, memory: ${doMemoryFragments})`);

    } catch (error) {
        console.error(`${CHAT_LOG_PREFIX} Return home failed:`, error);

        const statusEl = document.getElementById('chat_sync_status');
        if (statusEl) {
            statusEl.textContent = `⚠️ 同步失败: ${error.message}`;
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════
// UI Helpers
// ═══════════════════════════════════════════════════════════════════════

function showTypingIndicator(show) {
    const area = document.getElementById('chat_messages_area');
    if (!area) return;

    // Remove existing
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
 * Centralised helper used by batch-delete, edit-save, reroll, and reaction renders.
 * @param {boolean} [smooth=false] - If true, smooth-scroll to bottom after render
 */
function rerenderMessagesArea(smooth = false) {
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

function scrollToBottom(smooth = true) {
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

function formatChatTime(date) {
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();

    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday = date.toDateString() === yesterday.toDateString();

    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    const timeStr = `${hh}:${mm}`;

    if (isToday) return timeStr;
    if (isYesterday) return `昨天 ${timeStr}`;

    const month = date.getMonth() + 1;
    const day = date.getDate();
    return `${month}/${day} ${timeStr}`;
}

function escHtml(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ═══════════════════════════════════════════════════════════════════════
// Phase 2: Buff Bar & Recall Peek
// ═══════════════════════════════════════════════════════════════════════

/** Render the buff indicator bar below the nav */
function renderBuffBar() {
    const bar = document.getElementById('chat_buff_bar');
    if (!bar) return;

    let allEffects = [];
    try {
        const chatEffects = getActiveChatEffects();
        if (chatEffects?.length > 0) allEffects.push(...chatEffects);
    } catch (e) { /* */ }

    try {
        const overrideEffects = getActivePersonalityOverrides();
        if (overrideEffects?.length > 0) allEffects.push(...overrideEffects);
    } catch (e) { /* */ }

    try {
        const specialEffects = getActiveSpecialMessageEffects();
        if (specialEffects?.length > 0) allEffects.push(...specialEffects);
    } catch (e) { /* */ }

    try {
        const prankEffects = getActivePrankEffects();
        if (prankEffects?.length > 0) allEffects.push(...prankEffects);
    } catch (e) { /* */ }

    if (allEffects.length === 0) {
        bar.innerHTML = '';
        bar.style.display = 'none';
        return;
    }

    bar.style.display = 'flex';
    bar.innerHTML = allEffects.map(e => {
        const item = getShopItem(e.itemId);
        if (!item) return '';
        const label = e.type === 'specialMessage' ? '1次' : `${e.remaining}条`;
        return `<div class="chat-buff-pill" title="${escHtml(item.name)} — 剩余${label}">
            <span class="chat-buff-emoji">${item.emoji}</span>
            <span class="chat-buff-count">${e.remaining}</span>
        </div>`;
    }).join('');
}

// ═══════════════════════════════════════════════════════════════════════
// In-Chat Inventory (道具背包)
// ═══════════════════════════════════════════════════════════════════════

/** Render the inventory list inside the chat inventory overlay */
function renderChatInventory() {
    const listEl = document.getElementById('chat_inventory_list');
    const activeEl = document.getElementById('chat_inventory_active');
    if (!listEl) return;

    const inventory = getInventory();
    const itemIds = Object.keys(inventory);

    if (itemIds.length === 0) {
        listEl.innerHTML = `
            <div class="chat-inventory-empty">
                <div class="chat-inventory-empty-icon">📦</div>
                <div class="chat-inventory-empty-text">背包空空如也</div>
                <div class="chat-inventory-empty-hint">去商城逛逛吧～</div>
            </div>`;
    } else {
        listEl.innerHTML = itemIds.map(id => {
            const item = getShopItem(id);
            const qty = inventory[id];
            if (!item || qty <= 0) return '';

            const canUse = ['chatPrompt', 'diaryPrompt', 'personalityOverride', 'specialMessage', 'prankReaction'].includes(item.effectType);

            return `
                <div class="chat-inventory-row">
                    <div class="chat-inventory-row-left">
                        <div class="chat-inventory-row-emoji">${item.emoji}</div>
                        <div class="chat-inventory-row-info">
                            <div class="chat-inventory-row-name">${escHtml(item.name)}</div>
                            <div class="chat-inventory-row-desc">${escHtml(item.description)}</div>
                        </div>
                    </div>
                    <div class="chat-inventory-row-right">
                        <span class="chat-inventory-row-qty">×${qty}</span>
                        ${canUse ? `<button class="chat-inventory-use-btn" data-use-item="${item.id}">使用</button>` : ''}
                    </div>
                </div>`;
        }).filter(Boolean).join('');

        // Bind use buttons
        listEl.querySelectorAll('.chat-inventory-use-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                handleChatUseItem(btn.dataset.useItem);
            });
        });
    }

    // Active effects section
    if (activeEl) {
        const effects = getActiveEffects().filter(e =>
            ['chatPrompt', 'diaryPrompt', 'personalityOverride', 'specialMessage', 'prankReaction'].includes(e.type)
        );

        if (effects.length === 0) {
            activeEl.innerHTML = '';
        } else {
            activeEl.innerHTML = `
                <div class="chat-inventory-active-title"><i class="fa-solid fa-bolt"></i> 当前生效</div>
                ${effects.map(e => {
                const item = getShopItem(e.itemId);
                if (!item) return '';
                const unit = e.type === 'diaryPrompt' ? '次日记'
                    : e.type === 'specialMessage' ? '次使用'
                        : e.type === 'prankReaction' ? '次（待触发）'
                            : '条消息';
                return `<div class="chat-inventory-active-pill">${item.emoji} ${escHtml(item.name)} · 剩余${e.remaining}${unit}</div>`;
            }).filter(Boolean).join('')}`;
        }
    }
}

/** Handle using an item from the in-chat inventory */
function handleChatUseItem(itemId) {
    const item = getShopItem(itemId);
    if (!item) return;

    let confirmMsg;
    if (item.effectType === 'prankReaction') {
        confirmMsg = `确认使用【${item.name}】吗？\n下次聊天时将自动对你对象发动恶作剧！🎭`;
    } else {
        const durationUnit = item.effectType === 'diaryPrompt' ? '次日记'
            : item.effectType === 'specialMessage' ? '次使用'
                : '条消息';
        confirmMsg = `确认使用【${item.name}】吗？\n效果将持续 ${item.duration} ${durationUnit}。`;
    }

    if (!confirm(confirmMsg)) return;

    const result = activateItem(itemId);

    // Show feedback as system message in chat
    const messagesArea = document.getElementById('chat_messages_area');
    if (result.success) {
        if (messagesArea) {
            messagesArea.insertAdjacentHTML('beforeend',
                `<div class="chat-retract">✨ ${escHtml(result.message)}</div>`);
        }
        scrollToBottom(true);
    } else {
        if (messagesArea) {
            messagesArea.insertAdjacentHTML('beforeend',
                `<div class="chat-retract">❌ ${escHtml(result.message)}</div>`);
        }
    }

    // Refresh inventory + buff bar
    renderChatInventory();
    renderBuffBar();
}

/** Build a "peeked" recalled message bubble (translucent + strikethrough) */
function buildRecalledPeekBubble(content) {
    return `
    <div class="chat-bubble-row char">
        <div class="chat-bubble-column">
            <div class="chat-bubble chat-recalled-peek">
                <div class="chat-recalled-peek-label">🔓 偷看到的撤回内容：</div>
                <div class="chat-recalled-peek-text">${escHtml(content)}</div>
            </div>
        </div>
    </div>`;
}
