// modules/phone/chat/chatMessageHandler.js — Send messages, API response handling, auto-messages
// Extracted from chatApp.js

import { updateAppBadge } from '../phoneController.js';
import { callPhoneLLM } from '../../api.js';
import { cleanLlmJson, repairUnescapedQuotes } from '../utils/llmJsonCleaner.js';
import {
    loadChatHistory, saveChatHistory, commitHistoryInMemory,
    getCharacterInfo, getCharacterDisplayName, getUserName,
    maybeAutoSummarize, assignNextFloor,
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
import { hasAutoMessagePending, consumeAutoMessages, resetAutoMessageTimer, getPhoneIdleDuration } from './autoMessage.js';
import { synthesizeToBlob, uploadAudioToST } from './voiceMessageService.js';
import { buildBubbleRow, buildRecalledPeekBubble, formatChatTime, shiftBubbleMsgIndexes } from './chatHtmlBuilder.js';
import { applyAIReactions } from './chatReactions.js';
import { applyAIFavorites } from './chatFavorites.js';
import { renderBuffBar } from './chatInventory.js';
import { getPendingVoiceData, clearPendingVoiceData } from './chatVoice.js';
import { openVoiceCall } from '../voiceCall/voiceCallUI.js';

import {
    escHtml, CHAT_LOG_PREFIX, scrollToBottom, showTypingIndicator, sleep,
    getPendingMessages, setPendingMessages,
    getIsGenerating, setIsGenerating,
    getPendingImageData, setPendingImageData,
    getPendingReplyTo, clearPendingReplyTo, cancelReplyTo,
    updateButtonStates, rerenderMessagesArea,
    isUserInChatApp, ensureWindowAtTail, syncWindowToTail,
} from './chatApp.js';

// ═══════════════════════════════════════════════════════════════════════
// Declined Call → Character Follow-up
// ═══════════════════════════════════════════════════════════════════════

/**
 * Handle the 'phone-call-declined' event.
 * Injects a system event into chat history and triggers background generation
 * so the character reacts to the missed call (e.g. sends a follow-up message).
 * Async so the missed-call entry is durably on disk before we kick off the
 * long-running LLM call — otherwise a mid-generation refresh would lose it.
 */
export async function handleCallDeclined() {
    if (getIsGenerating()) {
        console.log(`${CHAT_LOG_PREFIX} Skipping declined-call follow-up: already generating.`);
        return;
    }

    console.log(`${CHAT_LOG_PREFIX} Call declined — triggering character follow-up.`);

    // Snapshot idle duration BEFORE saving the missed call entry
    const idleMsSnapshot = getPhoneIdleDuration();

    // Inject missed call event into chat history as a user action.
    // Snap the anchor window back to tail BEFORE the push — if we did it
    // after, the rerender would paint the just-pushed bubble itself, and
    // the manual append below would duplicate it. (Same pre-push pattern is
    // used by sendAllMessages and renderResponseToDom.)
    ensureWindowAtTail();
    const history = loadChatHistory();
    const now = new Date().toISOString();
    const missedCallEntry = {
        role: 'user',
        content: '[用户拒接了来电]',
        timestamp: now,
        floor: assignNextFloor(),
    };
    history.push(missedCallEntry);
    await saveChatHistory(history);

    // Show the missed call card in chat UI if user is viewing
    const messagesArea = document.getElementById('chat_messages_area');
    if (messagesArea) {
        // Remove empty state if present
        const emptyState = messagesArea.querySelector('.chat-empty');
        if (emptyState) emptyState.remove();

        // Use the saved (possibly trimmed) length for msgIndex so the bubble's
        // data-msg-index matches what loadChatHistory() returns. If the save
        // trimmed entries off the head, shift existing DOM indexes too so old
        // rows don't collide with the new bubble's index.
        const loadedLen = loadChatHistory().length;
        const trimmedOff = history.length - loadedLen;
        if (trimmedOff > 0) shiftBubbleMsgIndexes(messagesArea, trimmedOff);

        messagesArea.insertAdjacentHTML('beforeend',
            `<div class="chat-time-divider">${formatChatTime(new Date())}</div>`);
        const missedIdx = loadedLen - 1;
        messagesArea.insertAdjacentHTML('beforeend',
            buildBubbleRow('user', '[用户拒接了来电]', null, missedIdx, null, missedCallEntry));
        scrollToBottom(true);
    }
    syncWindowToTail();

    // Trigger background generation (character will react to the missed call)
    const historyBeforeSend = history.slice(0, -1);
    setIsGenerating(true);
    updateButtonStates();
    showTypingIndicator(true);
    startBackgroundGeneration(['[用户拒接了来电]'], historyBeforeSend, null, idleMsSnapshot);
}

// ═══════════════════════════════════════════════════════════════════════
// Pending Messages Logic
// ═══════════════════════════════════════════════════════════════════════

export function addPendingMessage() {
    const input = document.getElementById('chat_input');
    const text = input?.value?.trim();
    if (!text || getIsGenerating()) return;

    // Snapshot the active reply target (if any) onto this draft and clear it
    // so the next draft starts fresh — replies are per-message, not per-batch.
    const replyTo = getPendingReplyTo();
    getPendingMessages().push({ text, replyTo: replyTo || null });
    clearPendingReplyTo();
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
    const replyTo = getPendingReplyTo();

    if (pendingMessages.length === 0 && !imageData && !replyTo) {
        area.style.display = 'none';
        return;
    }

    area.style.display = 'flex';

    let html = '';

    // ── Active reply preview ──
    // Rendered as a real chat bubble (lifted out of the conversation onto the
    // input bar) rather than a separate "preview card" treatment — preserves
    // the iMessage feel without the perf cost of a full-screen blur overlay.
    if (replyTo) {
        const charName = getCharacterInfo()?.name || '角色';
        const userName = getUserName();
        const targetLabel = replyTo.role === 'user' ? userName : charName;
        html += `
        <div class="chat-reply-preview chat-bubble-row ${replyTo.role}">
            <div class="chat-bubble-column">
                <div class="chat-reply-preview-label">
                    <i class="ph ph-arrow-bend-up-left"></i> 回复 ${escHtml(targetLabel)}
                </div>
                <div class="chat-bubble-anchor">
                    <div class="chat-bubble">${escHtml(replyTo.snippet)}</div>
                    <button class="chat-reply-preview-close" id="chat_reply_preview_close" title="取消引用">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>
            </div>
        </div>`;
    }

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
    html += pendingMessages.map((payload, i) => {
        const text = payload?.text || '';
        const draftReply = payload?.replyTo;
        // Small inline reply indicator on the draft bubble itself, so the user
        // can see which queued draft carries a quote (in case they queue many).
        const replyTag = draftReply
            ? `<span class="chat-draft-reply-tag" title="引用：${escHtml(draftReply.snippet)}"><i class="ph ph-arrow-bend-up-left"></i></span>`
            : '';

        // If this is the last item and we have pending voice data, mark as voice draft
        const isVoice = voiceData && i === pendingMessages.length - 1;
        if (isVoice) {
            const dur = voiceData.duration || 0;
            const durStr = dur >= 60 ? `${Math.floor(dur / 60)}:${String(Math.round(dur % 60)).padStart(2, '0')}` : `${Math.round(dur)}″`;
            return `
            <div class="chat-draft-bubble chat-draft-voice" data-draft-index="${i}">
                ${replyTag}
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
                ${escHtml(text)}
            </div>`;
        }
        return `
            <div class="chat-draft-bubble" data-draft-index="${i}">${replyTag}${escHtml(text)}</div>
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

    // Reply preview bar close button — cancels the active reply target
    const replyClose = list.querySelector('#chat_reply_preview_close');
    if (replyClose) {
        replyClose.addEventListener('click', (e) => {
            e.stopPropagation();
            cancelReplyTo();
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

    // If there's text in the input field, add it to pending. Capture the
    // active reply target onto THIS draft (and clear it) — same per-message
    // ownership as addPendingMessage.
    if (remainingText) {
        const replyTo = getPendingReplyTo();
        getPendingMessages().push({ text: remainingText, replyTo: replyTo || null });
        clearPendingReplyTo();
        if (input) {
            input.value = '';
            input.style.height = 'auto';
        }
    }

    const pendingMessages = getPendingMessages();
    if (pendingMessages.length === 0 || getIsGenerating()) return;

    setIsGenerating(true);
    updateButtonStates();

    // payloads is the object array; messagesToSend keeps text-only form for
    // legacy call sites (e.g. DOM rendering loop below uses raw text).
    const payloads = [...pendingMessages];
    const messagesToSend = payloads.map(p => p?.text ?? '');
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
        payloads.push({ text: '[图片]', replyTo: null });
    }

    // Pre-push: snap the anchor window back to tail before mutating history.
    // Doing this AFTER push would trigger a rerender that paints the just-
    // pushed bubbles, then the manual append loop below would duplicate them.
    ensureWindowAtTail();

    // Load history, add user messages
    const history = loadChatHistory();
    const historyBeforeSend = [...history]; // snapshot for prompt building
    const now = new Date().toISOString();

    // ── Snapshot idle duration BEFORE saving new messages ──
    // getPhoneIdleDuration() reads from loadChatHistory(), so we must capture
    // the time gap *before* the new user messages are persisted, otherwise
    // the idle duration will always be ~0ms.
    const idleMsSnapshot = getPhoneIdleDuration();

    for (let i = 0; i < messagesToSend.length; i++) {
        const msg = messagesToSend[i];
        const payload = payloads[i];
        const entry = { role: 'user', content: msg, timestamp: now, floor: assignNextFloor() };

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

        // Freeze the reply target onto the history entry.
        if (payload?.replyTo) {
            entry.replyTo = payload.replyTo;
        }

        history.push(entry);
    }

    // Render user messages FIRST (synchronous DOM ops, instant) so the user
    // sees their bubble immediately. The save below is queued through
    // queueSaveChat (serialized to prevent metadata-overwrite races) but NOT
    // awaited — on remote (tailscale) sessions one saveChatConditional can
    // take seconds to minutes, and we do not want to block generation on it.
    const messagesArea = document.getElementById('chat_messages_area');
    if (messagesArea) {
        // Remove empty state if present
        const emptyState = messagesArea.querySelector('.chat-empty');
        if (emptyState) emptyState.remove();

        // Maybe add time divider (show if > 5 min since last message, or empty history)
        const lastHistMsg = historyBeforeSend[historyBeforeSend.length - 1];
        const lastTimestamp = lastHistMsg?.timestamp ? new Date(lastHistMsg.timestamp) : null;
        const nowDate = new Date(now);
        const needTime = !lastTimestamp || (nowDate - lastTimestamp) > 5 * 60 * 1000;
        if (needTime) {
            messagesArea.insertAdjacentHTML('beforeend',
                `<div class="chat-time-divider">${formatChatTime(nowDate)}</div>`
            );
        }

        // Sync chat_metadata UPFRONT so the rendered msgIndex values match what
        // loadChatHistory() will return. History is no longer trimmed, so
        // storedLen == history.length in normal operation; the shift branch
        // below remains as a defensive guard against any future re-introduction
        // of a head-trimming cap.
        const storedLen = commitHistoryInMemory(history);
        const trimmedOff = history.length - storedLen;
        if (trimmedOff > 0) {
            shiftBubbleMsgIndexes(messagesArea, trimmedOff);
        }
        const startHistIdx = storedLen - messagesToSend.length;

        // Render each message — voice/image messages render as special bubbles
        for (let i = 0; i < messagesToSend.length; i++) {
            const msg = messagesToSend[i];
            const histIdx = startHistIdx + i;
            const histEntry = history[history.length - messagesToSend.length + i];

            // Pass histEntry through unconditionally so buildBubbleRow can
            // render special (voice/image) bubbles AND the reply quote block
            // for quoted text messages.
            messagesArea.insertAdjacentHTML('beforeend',
                buildBubbleRow('user', msg, null, histIdx, null, histEntry));
        }
    }
    // Commit the new tail position so the next ensureWindowAtTail() correctly
    // sees the window as up-to-date.
    syncWindowToTail();

    scrollToBottom(true);

    // Show typing indicator
    showTypingIndicator(true);

    // Persist user messages — fire-and-forget through the serialized save queue.
    // We do NOT await: chat_metadata is already updated synchronously inside
    // saveChatHistory before its first await, so a refresh between this call
    // and the queue draining would lose only the disk write, not the in-memory
    // state. Awaiting would block generation behind a possibly multi-minute
    // remote HTTP round-trip.
    saveChatHistory(history).catch(e =>
        console.warn(`${CHAT_LOG_PREFIX} background save of user messages failed:`, e));

    // ── Fire off background generation (does NOT block the UI) ──
    // The result will be handled by _handleResponseReady() via event.
    // Pass the payload objects (with replyTo metadata) so the prompt builder
    // can inject reply context. Legacy string-array callers (declined call,
    // reroll) keep working — buildChatUserPrompt tolerates either shape.
    startBackgroundGeneration(payloads, historyBeforeSend, imageData?.base64 || null, idleMsSnapshot);

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
                renderResponseToDom(result.rawResponse, result.messagesToSend, result.indexableReplyMap || null);
            }
        } else if (!success) {
            const errMsg = consumeError();
            showTypingIndicator(false);
            ensureWindowAtTail();
            const messagesArea = document.getElementById('chat_messages_area');
            if (messagesArea && errMsg) {
                const isCancelled = errMsg === '已取消生成' || errMsg === '已取消重试';
                const icon = isCancelled ? 'ph-prohibit' : 'ph-warning';
                const label = isCancelled ? escHtml(errMsg) : `发送失败: ${escHtml(errMsg)}`;
                messagesArea.insertAdjacentHTML('beforeend',
                    `<div class="chat-retract"><i class="ph ${icon}"></i> ${label}</div>`);
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

    ensureWindowAtTail();
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

    // Post-push entry point: autoMessage.js already pushed these to history
    // and saved before invoking us. That means ensureWindowAtTail() sees endIdx
    // lagging behind length-1 and rerenders — repainting the just-pushed auto
    // messages as part of the tail-40 slice. When that happens we must skip
    // the manual append loop to avoid duplicate bubbles.
    if (ensureWindowAtTail()) {
        // rerender already painted everything — nothing else to do here.
        scrollToBottom(true);
        return;
    }

    const messagesArea = document.getElementById('chat_messages_area');
    if (!messagesArea) return;

    // Remove empty state if present
    const emptyState = messagesArea.querySelector('.chat-empty');
    if (emptyState) emptyState.remove();

    // Maybe add time divider
    messagesArea.insertAdjacentHTML('beforeend',
        `<div class="chat-time-divider">${formatChatTime(new Date())}</div>`
    );

    // Auto messages were pushed to history before this render runs (see
    // autoMessage.js). Recover their global indices so the rendered rows
    // carry data-msg-index — without it the long-press bubble menu skips them.
    const histAfterSave = loadChatHistory();
    const nonEmptyCount = messages.filter(m => ((m.text || m.content || '').trim())).length;
    let nextIdx = histAfterSave.length - nonEmptyCount;

    for (const msg of messages) {
        const text = (msg.text || msg.content || '').trim();
        if (!text) continue;
        messagesArea.insertAdjacentHTML('beforeend',
            buildBubbleRow('char', text, msg.thought, nextIdx, null, histAfterSave[nextIdx]));
        nextIdx++;
    }
    syncWindowToTail();

    scrollToBottom(true);
}

/**
 * Resolve a 1-based replyToIndex (from LLM JSON) against the snapshot of
 * indexable history rows the prompt actually showed. Returns null on any
 * miss — out of range, missing snippet, bad type — so callers can simply
 * skip attaching replyTo instead of branching on each failure mode.
 * @param {number|null|undefined} idx
 * @param {Array<{role:string, snippet:string}>|null|undefined} indexableReplyMap
 * @returns {{role:string, snippet:string}|null}
 */
function resolveReplyToIndex(idx, indexableReplyMap) {
    if (!indexableReplyMap?.length) return null;
    if (typeof idx !== 'number' || !Number.isInteger(idx)) return null;
    if (idx < 1 || idx > indexableReplyMap.length) return null;
    const target = indexableReplyMap[idx - 1];
    if (!target || !target.snippet) return null;
    return { role: target.role, snippet: target.snippet };
}

/**
 * Parse raw AI response and render character messages to the DOM.
 * This handles all the post-generation logic: message rendering,
 * buff decrements, gift detection, reactions, etc.
 * Used by both "immediate" (user in chat) and "deferred" (re-open) paths.
 *
 * @param {string} rawResponse - Raw LLM response text
 * @param {string[]} messagesToSend - The user messages that triggered this response
 * @param {Array<{role:string, snippet:string}>|null} [indexableReplyMap=null]
 *   Snapshot of {role, snippet} pairs the LLM's replyToIndex addresses. Null
 *   when the caller (reroll legacy path) didn't compute one — replyToIndex
 *   silently degrades to "no quote" in that case.
 */
export async function renderResponseToDom(rawResponse, messagesToSend, indexableReplyMap = null) {
    ensureWindowAtTail();
    const messagesArea = document.getElementById('chat_messages_area');

    try {
        // Parse JSON response — strip moments commands first so they don't break JSON.parse
        const cleanedResponse = stripMomentsCommands(rawResponse);
        const { messages: charMessages, aiReactions, aiFavorites } = parseApiResponse(cleanedResponse);

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

        // ─── Pre-push all char entries + commit ONCE before rendering ───
        // We push everything upfront (instead of one-per-iteration) so each
        // bubble gets a unique, final msgIndex. The original motivation was
        // an interaction with a head-trimming cap on chat_metadata: a per-
        // iteration commit pinned storedLen at the cap once history crossed
        // it, so every bubble in the burst inherited the last entry's index,
        // breaking per-bubble reactions and reply targeting. The cap is gone,
        // but pre-pushing remains the cleanest way to hand out distinct
        // indexes (burstBaseIdx + i) in a single commit pass.
        const historyEntries = charMessages.map((cmsg) => {
            const entry = {
                role: 'char',
                content: cmsg.text,
                thought: cmsg.thought || '',
                timestamp: responseTime,
                floor: assignNextFloor(),
            };
            if (cmsg.recalledContent) {
                entry.recalledContent = cmsg.recalledContent;
            }
            // Resolve replyToIndex against the prompt-time history snapshot
            // and freeze the {role, snippet} pair onto this char entry. Out
            // of range / missing snippet → silently skip and console.warn so
            // a hallucinated index doesn't crash the render.
            if (cmsg.replyToIndex != null) {
                const resolved = resolveReplyToIndex(cmsg.replyToIndex, indexableReplyMap);
                if (resolved) {
                    entry.replyTo = resolved;
                } else {
                    console.warn(`${CHAT_LOG_PREFIX} replyToIndex=${cmsg.replyToIndex} did not resolve (window=${indexableReplyMap?.length ?? 0}); rendering as plain message.`);
                }
            }
            return entry;
        });
        const prePushLen = updatedHistory.length;
        updatedHistory.push(...historyEntries);
        const storedLenAfterBurst = commitHistoryInMemory(updatedHistory);
        // If the commit trimmed K entries off the head, every existing DOM
        // bubble's data-msg-index now points one-past where its message lives.
        // Shift them down so the new burst's indexes don't collide with stale
        // old rows (which would land emoji badges / reply targets on the wrong
        // bubble — querySelector returns the first DOM match).
        const trimmedOff = (prePushLen + charMessages.length) - storedLenAfterBurst;
        if (trimmedOff > 0) {
            shiftBubbleMsgIndexes(messagesArea, trimmedOff);
        }
        // Index of charMessages[0] in the persisted history. clamp(0, …)
        // defensively absorbs any unexpected commit return that's shorter
        // than the burst (e.g. if a future cap is reintroduced).
        const burstBaseIdx = Math.max(0, storedLenAfterBurst - charMessages.length);

        for (let i = 0; i < charMessages.length; i++) {
            const cmsg = charMessages[i];
            const historyEntry = historyEntries[i];
            const newMsgIdx = burstBaseIdx + i;
            const isLast = i === charMessages.length - 1;
            const delay = i === 0 ? 0 : (cmsg.delay || 1) * 300; // Scale delay for UX (not full seconds)

            if (delay > 0) {
                showTypingIndicator(true);
                await sleep(Math.min(delay, 2000));
                showTypingIndicator(false);
            }

            // ── AI-initiated voice message ──
            if (cmsg.special === 'voice' && cmsg.text) {
                showTypingIndicator(true);
                try {
                    const ttsResult = await synthesizeToBlob(cmsg.text);
                    if (ttsResult) {
                        const audioPath = await uploadAudioToST(ttsResult.audioBlob, 'voice_char');
                        historyEntry.special = 'voice';
                        historyEntry.audioDuration = Math.round(ttsResult.duration);
                        historyEntry.audioPath = audioPath;
                        console.log(`${CHAT_LOG_PREFIX} AI voice message TTS: ${ttsResult.duration.toFixed(1)}s`);
                    }
                } catch (e) {
                    console.warn(`${CHAT_LOG_PREFIX} AI voice TTS failed, text fallback:`, e);
                }
                showTypingIndicator(false);
                if (messagesArea) {
                    messagesArea.insertAdjacentHTML('beforeend',
                        buildBubbleRow('char', cmsg.text, cmsg.thought, newMsgIdx, null, historyEntry));
                }
                scrollToBottom(true);
                continue;
            }

            // ── AI-initiated phone call ──
            if (cmsg.special === 'call') {
                if (messagesArea) {
                    messagesArea.insertAdjacentHTML('beforeend',
                        `<div class="chat-retract"><i class="ph ph-phone-incoming"></i> 来电...</div>`);
                    scrollToBottom(true);
                }
                // Small delay for the "incoming call" text to be visible
                await sleep(800);
                try {
                    openVoiceCall({ chatContext: true, incoming: true, greetingText: cmsg.text || '' });
                } catch (e) {
                    console.warn(`${CHAT_LOG_PREFIX} AI call failed:`, e);
                }
                continue;
            }

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
                    const displayName = getCharacterDisplayName();
                    messagesArea.insertAdjacentHTML('beforeend',
                        `<div class="chat-retract">${escHtml(displayName)}撤回了一条消息</div>`);
                    messagesArea.insertAdjacentHTML('beforeend',
                        buildRecalledPeekBubble(cmsg.recalledContent));
                } else {
                    // Pass historyEntry through so buildBubbleRow can render
                    // the reply quote block when replyToIndex resolved above.
                    // msgIndex must be set so long-press / bubble-menu can find
                    // this row — without data-msg-index the menu silently skips it.
                    messagesArea.insertAdjacentHTML('beforeend',
                        buildBubbleRow('char', cmsg.text, cmsg.thought, newMsgIdx, null, historyEntry));
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

        // ─── Apply AI favorites (LLM bookmarks user messages) ───
        // Mutates updatedHistory in place; persisted by the saveChatHistory
        // call below. No DOM update — favorites are page-only (bubble stays
        // clean by design), so toggling favoritedByChar needs no rerender.
        try {
            if (aiFavorites && aiFavorites.length > 0) {
                applyAIFavorites(aiFavorites, updatedHistory);
            }
        } catch (e) { console.warn('[聊天] AI favorites error:', e); }

        await saveChatHistory(updatedHistory);

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
                    await saveChatHistory(updatedHistory);
                    console.log(`${CHAT_LOG_PREFIX} Auto-TTS complete: ${ttsResult.duration.toFixed(1)}s`);
                }
            } catch (e) {
                console.warn(`${CHAT_LOG_PREFIX} Auto-TTS failed, falling back to text bubble:`, e);
            }

            // Render the deferred message (voice bubble if TTS succeeded, text bubble otherwise).
            // The deferred entry is the last one in the burst — its index is
            // burstBaseIdx + (charMessages.length - 1).
            showTypingIndicator(false);
            if (messagesArea) {
                const deferredIdx = burstBaseIdx + charMessages.length - 1;
                messagesArea.insertAdjacentHTML('beforeend',
                    buildBubbleRow('char', lastCharMsg.text, lastCharMsg.thought,
                                   deferredIdx, null, deferredHistoryEntry));
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
                        `<div class="chat-bubble-row char"><div class="chat-bubble-column"><div class="chat-bubble">${robCardHtml}</div></div></div>`);
                    scrollToBottom(true);
                }
                // 标记已执行（无论结果如何）+ 激活社区背景信息
                markRobberyDone();
                activateCommunityContext();
                // 获取候选目标并执行（triggerRobbery 内部已处理空名单：
                // 直接更新 status 元素为 error 并返回 { error, success: false }）
                const candidates = await getRandomVictimList();
                const result = await triggerRobbery(candidates || [], charName2, `${robCardId}_status`);
                if (messagesArea && result && !result.error) {
                    messagesArea.insertAdjacentHTML('beforeend',
                        `<div class="chat-bubble-row char"><div class="chat-bubble-column"><div class="chat-bubble">${getRobberyResultCardHtml(result, charName2)}</div></div></div>`);
                    scrollToBottom(true);
                    // 广播到 Moments
                    broadcastRobberyToMoments(result, charName2).catch(e =>
                        console.warn('[RobberySystem] broadcast error:', e));
                }
            }
        } catch (e) { console.warn('[RobberySystem] auto-robbery error:', e); }


        renderBuffBar();

        // Commit the new tail position — the bubble loop above appended fresh
        // char messages beyond _chatWindow.endIdx, and without this the next
        // ensureWindowAtTail() check would needlessly rerender.
        syncWindowToTail();

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

    // Try the cleaned string first; if it fails (common case: LLM put raw "
    // inside a string value), run the unescaped-quote repair pass and retry
    // once before falling through to the line-split last resort.
    let parsed = null;
    try {
        parsed = JSON.parse(jsonStr);
    } catch (e) {
        try {
            parsed = JSON.parse(repairUnescapedQuotes(jsonStr));
            console.warn(`${CHAT_LOG_PREFIX} JSON parse needed quote-repair fallback.`);
        } catch (e2) {
            console.warn(`${CHAT_LOG_PREFIX} JSON parse failed, trying line-split fallback`);
        }
    }

    if (parsed) {
        const mapMsg = (m) => ({
            text: m.text.trim(),
            thought: (m.thought && typeof m.thought === 'string') ? m.thought.trim() : '',
            delay: typeof m.delay === 'number' ? m.delay : 1,
            // Phase 2: recall blocker support
            recalledContent: (m.recalledContent && typeof m.recalledContent === 'string') ? m.recalledContent.trim() : '',
            // Phase 3: AI-initiated voice messages & calls
            special: (m.special === 'voice' || m.special === 'call') ? m.special : '',
            // chat-reply Phase 2: raw 1-based index of a history line the LLM
            // wants to quote; renderResponseToDom resolves it against the
            // indexableReplyMap snapshot from the prompt-time history.
            replyToIndex: (typeof m.replyToIndex === 'number' && Number.isFinite(m.replyToIndex)) ? m.replyToIndex : null,
        });

        // Extract optional AI reactions
        let aiReactions = null;
        if (parsed.reactions && Array.isArray(parsed.reactions)) {
            aiReactions = parsed.reactions;
        }

        // Extract optional AI favorites (LLM bookmarks targeting user messages)
        let aiFavorites = null;
        if (parsed.favorites && Array.isArray(parsed.favorites)) {
            aiFavorites = parsed.favorites;
        }

        if (parsed.messages && Array.isArray(parsed.messages)) {
            return {
                messages: parsed.messages
                    .filter(m => m.text && typeof m.text === 'string')
                    .map(mapMsg),
                aiReactions,
                aiFavorites,
            };
        }

        // Maybe it's just an array
        if (Array.isArray(parsed)) {
            return {
                messages: parsed
                    .filter(m => m.text && typeof m.text === 'string')
                    .map(mapMsg),
                aiReactions: null,
                aiFavorites: null,
            };
        }
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
            })), aiReactions: null, aiFavorites: null
        };
    }

    // Last resort: entire response as one message
    return { messages: [{ text: raw.trim(), thought: '', delay: 0, recalledContent: '' }], aiReactions: null, aiFavorites: null };
}
