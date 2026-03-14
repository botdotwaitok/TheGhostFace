// modules/phone/chat/chatMessageHandler.js — Send messages, API response handling, auto-messages
// Extracted from chatApp.js

import { updateAppBadge } from '../phoneController.js';
import { callPhoneLLM } from '../../api.js';
import { cleanLlmJson } from '../utils/llmJsonCleaner.js';
import {
    loadChatHistory, saveChatHistory,
    getCharacterInfo, getUserName,
    maybeAutoSummarize,
} from './chatStorage.js';
import { stripMomentsCommands, activateCommunityContext } from './chatPromptBuilder.js';
import {
    startBackgroundGeneration, consumePendingResult, consumeError,
    hasPendingResult, hasError, cancelRetry,
} from './backgroundGen.js';
import {
    decrementChatEffects, decrementPersonalityOverrides,
    getActiveSpecialMessageEffects, consumeSpecialMessage,
    getActivePrankEffects, consumePrankEffect,
} from '../shop/shopStorage.js';
import { getShopItem } from '../shop/shopData.js';
import { getPrankEventCardHtml } from '../shop/prankSystem.js';
import {
    CHARACTER_GIFTS, triggerCrossplatformGift, markGiftSent,
} from '../shop/giftSystem.js';
import {
    getRobberyResultCardHtml, getAutoRobberyCardHtml,
    triggerRobbery, getRandomVictimList,
    shouldAutoRobToday, markRobberyDone, broadcastRobberyToMoments,
} from '../shop/robberySystem.js';
import { tryAutoStartKeepAlive } from '../keepAlive.js';
import { hasAutoMessagePending, consumeAutoMessages, resetAutoMessageTimer } from './autoMessage.js';
import { synthesizeToBlob, uploadAudioToST } from './voiceMessageService.js';
import { buildBubbleRow, buildRecalledPeekBubble, formatChatTime } from './chatHtmlBuilder.js';
import { applyAIReactions } from './chatReactions.js';
import { renderBuffBar } from './chatInventory.js';
import { getPendingVoiceData, clearPendingVoiceData } from './chatVoice.js';

import {
    escHtml, CHAT_LOG_PREFIX, scrollToBottom, showTypingIndicator, sleep,
    getPendingMessages, setPendingMessages,
    getIsGenerating, setIsGenerating,
    getPendingImageData, setPendingImageData,
    updateButtonStates, rerenderMessagesArea,
    isUserInChatApp,
} from './chatApp.js';

// ═══════════════════════════════════════════════════════════════════════
// Pending Messages Logic
// ═══════════════════════════════════════════════════════════════════════

export function addPendingMessage() {
    const input = document.getElementById('chat_input');
    const text = input?.value?.trim();
    if (!text || getIsGenerating()) return;

    getPendingMessages().push(text);
    input.value = '';
    input.style.height = 'auto';

    renderDraftArea();
    updateButtonStates();
    input.focus();
}

export function removePendingMessage(index) {
    const voiceData = getPendingVoiceData();
    const pending = getPendingMessages();
    // If removing the voice draft, clear the voice data
    if (voiceData && index === pending.length - 1) {
        clearPendingVoiceData();
    }
    pending.splice(index, 1);
    renderDraftArea();
    updateButtonStates();
}

export function renderDraftArea() {
    const area = document.getElementById('chat_draft_area');
    const list = document.getElementById('chat_draft_list');
    if (!area || !list) return;

    const pendingMessages = getPendingMessages();
    const imageData = getPendingImageData();

    if (pendingMessages.length === 0 && !imageData) {
        area.style.display = 'none';
        return;
    }

    area.style.display = 'flex';

    let html = '';

    // ── Image draft (shown first if present) ──
    if (imageData) {
        html += `
        <div class="chat-draft-bubble chat-draft-image" data-draft-type="image">
            <img src="${escHtml(imageData.thumbnail)}" alt="图片" />
            <span class="chat-draft-image-remove"><i class="fa-solid fa-xmark"></i></span>
        </div>`;
    }

    // ── Text/voice drafts ──
    const voiceData = getPendingVoiceData();
    html += pendingMessages.map((msg, i) => {
        // If this is the last item and we have pending voice data, mark as voice draft
        const isVoice = voiceData && i === pendingMessages.length - 1;
        if (isVoice) {
            const dur = voiceData.duration || 0;
            const durStr = dur >= 60 ? `${Math.floor(dur / 60)}:${String(Math.round(dur % 60)).padStart(2, '0')}` : `${Math.round(dur)}″`;
            return `
            <div class="chat-draft-bubble chat-draft-voice" data-draft-index="${i}">
                <span class="chat-draft-voice-icon">
                    <svg width="14" height="12" viewBox="0 0 20 16" fill="currentColor">
                        <rect x="0" y="5" width="2.5" height="6" rx="1"/>
                        <rect x="4" y="2" width="2.5" height="12" rx="1"/>
                        <rect x="8" y="4" width="2.5" height="8" rx="1"/>
                        <rect x="12" y="1" width="2.5" height="14" rx="1"/>
                        <rect x="16" y="3" width="2.5" height="10" rx="1"/>
                    </svg>
                    ${durStr}
                </span>
                ${escHtml(msg)}
            </div>`;
        }
        return `
            <div class="chat-draft-bubble" data-draft-index="${i}">${escHtml(msg)}</div>
        `;
    }).join('');

    list.innerHTML = html;

    // Click to remove text/voice drafts
    list.querySelectorAll('.chat-draft-bubble[data-draft-index]').forEach(el => {
        el.addEventListener('click', () => {
            const idx = parseInt(el.dataset.draftIndex);
            removePendingMessage(idx);
        });
    });

    // Click to remove image draft
    const imgDraft = list.querySelector('.chat-draft-image');
    if (imgDraft) {
        imgDraft.addEventListener('click', () => {
            setPendingImageData(null);
            renderDraftArea();
            updateButtonStates();
        });
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Send & API Call
// ═══════════════════════════════════════════════════════════════════════

export async function sendAllMessages() {
    // iOS keep-alive: auto-start silent audio on first message send
    tryAutoStartKeepAlive();

    const input = document.getElementById('chat_input');
    const remainingText = input?.value?.trim();

    // If there's text in the input field, add it to pending
    if (remainingText) {
        getPendingMessages().push(remainingText);
        if (input) {
            input.value = '';
            input.style.height = 'auto';
        }
    }

    const pendingMessages = getPendingMessages();
    if (pendingMessages.length === 0 || getIsGenerating()) return;

    setIsGenerating(true);
    updateButtonStates();

    const messagesToSend = [...pendingMessages];
    setPendingMessages([]);

    // Capture image data (if any)
    const imageData = getPendingImageData();
    setPendingImageData(null);

    renderDraftArea();

    // Capture voice data (if any) — only applies to the LAST message in the batch
    const voiceData = getPendingVoiceData();
    clearPendingVoiceData();

    // If we have an image but no text messages, add a placeholder
    if (imageData && messagesToSend.length === 0) {
        messagesToSend.push('[图片]');
    }

    // Load history, add user messages
    const history = loadChatHistory();
    const historyBeforeSend = [...history]; // snapshot for prompt building
    const now = new Date().toISOString();

    for (let i = 0; i < messagesToSend.length; i++) {
        const msg = messagesToSend[i];
        const entry = { role: 'user', content: msg, timestamp: now };

        // Attach voice metadata to the last message if we have pending voice data
        if (voiceData && i === messagesToSend.length - 1) {
            entry.special = 'voice';
            entry.audioDuration = voiceData.duration;
            entry.audioPath = voiceData.audioPath;
        }

        // Attach image metadata to the first message if we have pending image data
        if (imageData && i === 0) {
            entry.special = 'image';
            entry.imageThumbnail = imageData.thumbnail;
            entry.imageFileName = imageData.fileName;
        }

        history.push(entry);
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
            needTime = true; // Safe default: always add a divider on new sends
        }
        if (needTime) {
            messagesArea.insertAdjacentHTML('beforeend',
                `<div class="chat-time-divider">${formatChatTime(new Date())}</div>`
            );
        }

        // Render each message — voice/image messages render as special bubbles
        for (let i = 0; i < messagesToSend.length; i++) {
            const msg = messagesToSend[i];
            const histIdx = history.length - messagesToSend.length + i;
            const histEntry = history[histIdx];

            if (histEntry?.special === 'voice' || histEntry?.special === 'image') {
                messagesArea.insertAdjacentHTML('beforeend',
                    buildBubbleRow('user', msg, null, histIdx, null, histEntry));
            } else {
                messagesArea.insertAdjacentHTML('beforeend', buildBubbleRow('user', msg));
            }
        }
    }

    scrollToBottom(true);

    // Show typing indicator
    showTypingIndicator(true);

    // ── Fire off background generation (does NOT block the UI) ──
    // The result will be handled by _handleResponseReady() via event
    startBackgroundGeneration(messagesToSend, historyBeforeSend, imageData?.base64 || null);

    // Reset auto-message timer (user just sent a message, restart idle countdown)
    resetAutoMessageTimer();
}

// ═══════════════════════════════════════════════════════════════════════
// Background Generation — Response Handler
// ═══════════════════════════════════════════════════════════════════════

/**
 * Handle the 'phone-chat-response-ready' event from backgroundGen.
 * If user is still in chat → render immediately with animations.
 * If user has left → store result, show badge on desktop icon.
 */
export function handleResponseReady(e) {
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
                    `<div class="chat-retract"><i class="ph ph-warning"></i> 发送失败: ${escHtml(errMsg)}</div>`);
            }
            scrollToBottom(true);
        }
        // Reset generating state
        setIsGenerating(false);
        updateButtonStates();
    } else {
        // User left chat — keep result in memory, show badge
        console.log(`${CHAT_LOG_PREFIX} User not in chat, setting badge notification.`);
        if (success) {
            updateAppBadge('chat', 1);
        }
        // Reset generating state (user will consume result when re-opening)
        setIsGenerating(false);
    }
}

/**
 * Handle the 'phone-chat-retry' event from backgroundGen.
 * Shows a countdown message in chat with a cancel button.
 */
export function handleRetryEvent(e) {
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
                <i class="ph ph-warning"></i> 生成失败: ${escHtml(errMsg)}
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
                    `<div class="chat-retract"><i class="ph ph-prohibit"></i> 已取消重试</div>`);
                scrollToBottom(true);
            }
            // Reset generating state
            setIsGenerating(false);
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
                notice.innerHTML = `<div class="chat-retry-text"><i class="ph ph-arrows-clockwise"></i> 正在重试生成... (${attempt}/${maxRetries})</div>`;
            }
            showTypingIndicator(true);
        }
    }, 1000);
}

let _retryCountdownTimer = null;

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
export function handleAutoMessageReady() {
    if (!isUserInChatApp()) return;

    if (hasAutoMessagePending()) {
        const msgs = consumeAutoMessages();
        if (msgs) {
            renderAutoMessages(msgs);
            updateAppBadge('chat', 0);
        }
    }
}

/**
 * Render auto-generated character messages to the DOM.
 * @param {Array<{text: string, thought?: string, delay?: number}>} messages
 */
export function renderAutoMessages(messages) {
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
export async function renderResponseToDom(rawResponse, messagesToSend) {
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

        // ── Pre-check: should we defer the last message for TTS? ──
        // If the user's last message was voice, we want to hold back the last
        // AI reply so it can appear directly as a voice bubble (no text→voice flicker).
        let shouldDeferLast = false;
        {
            const prevHistory = updatedHistory; // history before we push new AI messages
            const lastUserIdx = prevHistory.slice(0).reverse().findIndex(m => m.role === 'user');
            const lastUser = lastUserIdx >= 0 ? prevHistory[prevHistory.length - 1 - lastUserIdx] : null;
            if (lastUser?.special === 'voice' && charMessages.length > 0) {
                shouldDeferLast = true;
            }
        }

        let deferredHistoryEntry = null; // Will hold the history entry for the deferred message

        for (let i = 0; i < charMessages.length; i++) {
            const cmsg = charMessages[i];
            const isLast = i === charMessages.length - 1;
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

            // If this is the last message and we're deferring for TTS → skip DOM render
            if (shouldDeferLast && isLast) {
                deferredHistoryEntry = historyEntry;
                // Keep typing indicator visible while TTS is processing
                showTypingIndicator(true);
                continue;
            }

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

        // ─── Auto-TTS: if last message was deferred → await TTS then render ───
        if (shouldDeferLast && deferredHistoryEntry) {
            const lastCharMsg = charMessages[charMessages.length - 1];
            try {
                const ttsResult = await synthesizeToBlob(lastCharMsg.text);
                if (ttsResult) {
                    // Upload to ST
                    const audioPath = await uploadAudioToST(ttsResult.audioBlob, 'voice_char');

                    // Update history entry with voice metadata
                    deferredHistoryEntry.special = 'voice';
                    deferredHistoryEntry.audioDuration = Math.round(ttsResult.duration);
                    deferredHistoryEntry.audioPath = audioPath;
                    saveChatHistory(updatedHistory);
                    console.log(`${CHAT_LOG_PREFIX} Auto-TTS complete: ${ttsResult.duration.toFixed(1)}s`);
                }
            } catch (e) {
                console.warn(`${CHAT_LOG_PREFIX} Auto-TTS failed, falling back to text bubble:`, e);
            }

            // Render the deferred message (voice bubble if TTS succeeded, text bubble otherwise)
            showTypingIndicator(false);
            if (messagesArea) {
                messagesArea.insertAdjacentHTML('beforeend',
                    buildBubbleRow('char', lastCharMsg.text, lastCharMsg.thought,
                                   undefined, null, deferredHistoryEntry));
            }
            scrollToBottom(true);
        }

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
                            `<div class="chat-retract"><i class="ph ph-sparkle"></i> 【${escHtml(expItem.name)}】效果已消退</div>`);
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
                            `<div class="chat-retract"><i class="ph ph-masks-theater"></i> 【${escHtml(expItem.name)}】人格已恢复正常</div>`);
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
                        `<div class="chat-retract"><i class="ph ph-masks-theater"></i> 【${escHtml(expItem.name)}】已触发完毕</div>`);
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
                        `<div class="chat-retract"><i class="ph ph-masks-theater"></i> 【${escHtml(expItem.name)}】恶作剧已发动！</div>`);
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
                    if (statusEl) statusEl.innerHTML = '<i class="ph ph-warning"></i> 找不到可以抢劫的目标';
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
                `<div class="chat-retract"><i class="ph ph-warning"></i> 发送失败: ${escHtml(error.message)}</div>`
            );
        }
        scrollToBottom(true);
    }
}

/**
 * Parse the API response — expects JSON with { messages: [...] }
 * Falls back gracefully if the LLM doesn't return perfect JSON.
 */
export function parseApiResponse(raw) {
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
