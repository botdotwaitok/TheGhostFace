// modules/phone/chat/chatStorage.js — Chat history persistence
// Storage: chat_metadata (persisted inside .jsonl chat file, cross-device)

import { getContext, saveMetadataDebounced } from '../../../../../../extensions.js';
import { chat_metadata } from '../../../../../../../script.js';
import { getRegexedString, regex_placement } from '../../../../../regex/engine.js';
import { generateSummary, isContentSimilar } from '../../summarizer.js';
import { buildRollingSummarizePrompt } from './chatPromptBuilder.js';
import { saveToWorldBook } from '../../worldbook.js';
import { callPhoneLLM } from '../../api.js';
import { getPhoneCharInfo, getPhoneUserName, getPhoneUserPersona } from '../phoneContext.js';
import { getPhoneSetting } from '../phoneSettings.js';

// ═══════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════

const CHAT_LOG_PREFIX = '[聊天]';
const MAX_HISTORY_MESSAGES = 500; // Raise cap — summarize handles compression

// ─── Auto-summarize constants ───
const SUMMARIZE_TOKEN_THRESHOLD = 40000; // Trigger when unsummarized tokens reach 40k
const KEEP_RECENT = 60;                  // Keep the most recent N messages unsummarized

// ─── ST main-chat injection ───
// Cap the raw ST history token budget per call. Once auto-summarize fires,
// older ST content is folded into the phone summary and the marker advances,
// so the actual injected count stays well under this cap in steady state.
const ST_HISTORY_TOKEN_LIMIT = 20000;

// ─── chat_metadata keys ───
const META_KEY_HISTORY = 'gf_phoneChatHistory';
const META_KEY_SUMMARY = 'gf_phoneChatSummary';
const META_KEY_PENDING_RESULT = 'gf_phoneChatPendingResult';
const META_KEY_ST_SYNC_MARKER = 'gf_phoneChatLastSTMarker'; // send_date of last ST msg absorbed into summary
const META_KEY_HOME_MARKER = 'gf_phoneChatLastHomeMarker';  // ISO timestamp of last phone msg already 回家'd
const META_KEY_NICKNAME = 'gf_phoneChatNickname';           // user-set display nickname for the character (UI-only)

// ═══════════════════════════════════════════════════════════════════════
// Token Estimation (CJK-aware)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Estimate token count for a string.
 * CJK characters ≈ 1.5 tokens each, ASCII/Latin ≈ 0.25 tokens per char.
 * @param {string} text
 * @returns {number}
 */
function estimateTokenCount(text) {
    if (!text) return 0;
    let tokens = 0;
    for (const char of text) {
        tokens += char.charCodeAt(0) > 0x2E80 ? 1.5 : 0.25;
    }
    return Math.ceil(tokens);
}

/**
 * Estimate total token count for an array of chat messages.
 * @param {Array} messages - [{content, role, ...}]
 * @returns {number}
 */
function estimateMessagesTokens(messages) {
    let total = 0;
    for (const msg of messages) {
        total += estimateTokenCount(msg.content || '');
        total += 10; // overhead: role label, timestamp, separators
    }
    return total;
}

// ═══════════════════════════════════════════════════════════════════════
// Character / User Info Helpers
// ═══════════════════════════════════════════════════════════════════════

export function getCharacterId() {
    try {
        const context = getContext();
        return context.characterId != null ? `char_${context.characterId}` : 'global_fallback';
    } catch {
        return 'global_system';
    }
}

// (removed: _getStorageKey — no longer needed with chat_metadata)

/** @see phoneContext.getPhoneCharInfo — 向后兼容包装 */
export function getCharacterInfo() {
    return getPhoneCharInfo();
}

/** @see phoneContext.getPhoneUserName — 向后兼容包装 */
export function getUserName() {
    return getPhoneUserName();
}

/** @see phoneContext.getPhoneUserPersona — 向后兼容包装 */
export function getUserPersona() {
    return getPhoneUserPersona();
}

// ─── Character Nickname (UI-only, persisted in chat_metadata) ───

/**
 * Load the user-set nickname for the current character. UI-only — never
 * appears in prompts/summaries sent to the LLM, so the model still sees the
 * character by their canonical name.
 * @returns {string} nickname, or '' if none set
 */
export function loadCharacterNickname() {
    try {
        return chat_metadata?.[META_KEY_NICKNAME] || '';
    } catch {
        return '';
    }
}

/**
 * Persist (or clear) the character nickname. Empty/whitespace clears it.
 * @param {string} nickname
 */
export function saveCharacterNickname(nickname) {
    try {
        if (!chat_metadata) return;
        const trimmed = (nickname || '').trim();
        if (trimmed) {
            chat_metadata[META_KEY_NICKNAME] = trimmed;
        } else {
            delete chat_metadata[META_KEY_NICKNAME];
        }
        saveMetadataDebounced();
    } catch (e) {
        console.warn(`${CHAT_LOG_PREFIX} chat_metadata nickname save failed:`, e);
    }
}

/**
 * Get the name to show in the chat UI: nickname if set, otherwise the
 * character's canonical name. Use this anywhere the user reads the name;
 * use getCharacterInfo().name for prompts / cross-platform calls.
 * @returns {string}
 */
export function getCharacterDisplayName() {
    const nickname = loadCharacterNickname();
    if (nickname) return nickname;
    return getPhoneCharInfo()?.name || '角色';
}

// ═══════════════════════════════════════════════════════════════════════
// Load / Save
// ═══════════════════════════════════════════════════════════════════════

/**
 * Message shape:
 * {
 *   role: 'user' | 'char',
 *   content: string,
 *   timestamp: string (ISO),
 *   special?: string   // e.g. 'voice', 'transfer', 'image', 'share', 'retract'
 * }
 */

/**
 * Load chat history from chat_metadata (persisted in .jsonl chat file).
 * @returns {Array} messages
 */
export function loadChatHistory() {
    try {
        const data = chat_metadata?.[META_KEY_HISTORY];
        if (Array.isArray(data) && data.length > 0) return data;
    } catch (e) {
        console.warn(`${CHAT_LOG_PREFIX} chat_metadata 读取失败:`, e);
    }
    return [];
}

/**
 * Save chat history to chat_metadata (persisted in .jsonl chat file).
 * Trims to MAX_HISTORY_MESSAGES to prevent storage bloat.
 * @param {Array} messages
 */
export function saveChatHistory(messages) {
    const trimmed = messages.slice(-MAX_HISTORY_MESSAGES);
    try {
        if (chat_metadata) {
            chat_metadata[META_KEY_HISTORY] = trimmed;
            saveMetadataDebounced();
        }
    } catch (e) {
        console.warn(`${CHAT_LOG_PREFIX} chat_metadata 保存失败:`, e);
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Pending Result Persistence (survives page refresh)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Persist a pending LLM result to chat_metadata so it survives page refresh.
 * @param {{ rawResponse: string, messagesToSend: string[] } | null} result
 */
export function persistPendingResult(result) {
    try {
        if (chat_metadata) {
            chat_metadata[META_KEY_PENDING_RESULT] = result || null;
            saveMetadataDebounced();
        }
    } catch (e) {
        console.warn(`${CHAT_LOG_PREFIX} Pending result persistence failed:`, e);
    }
}

/**
 * Load a previously persisted pending result from chat_metadata.
 * @returns {{ rawResponse: string, messagesToSend: string[] } | null}
 */
export function loadPersistedPendingResult() {
    try {
        return chat_metadata?.[META_KEY_PENDING_RESULT] || null;
    } catch {
        return null;
    }
}

/**
 * Clear the persisted pending result from chat_metadata.
 */
export function clearPersistedPendingResult() {
    try {
        if (chat_metadata?.[META_KEY_PENDING_RESULT]) {
            delete chat_metadata[META_KEY_PENDING_RESULT];
            saveMetadataDebounced();
        }
    } catch (e) {
        console.warn(`${CHAT_LOG_PREFIX} Pending result clear failed:`, e);
    }
}

/**
 * Load the ST sync marker — send_date of the last ST main-chat message that
 * was absorbed into the rolling phone summary.
 * @returns {string} send_date string, or '' if not set
 */
export function loadSTSyncMarker() {
    try {
        return chat_metadata?.[META_KEY_ST_SYNC_MARKER] || '';
    } catch {
        return '';
    }
}

/**
 * Save the ST sync marker.
 * @param {string} marker - send_date string of the last absorbed ST message
 */
export function saveSTSyncMarker(marker) {
    try {
        if (!chat_metadata) return;
        if (marker) {
            chat_metadata[META_KEY_ST_SYNC_MARKER] = marker;
        } else {
            delete chat_metadata[META_KEY_ST_SYNC_MARKER];
        }
        saveMetadataDebounced();
    } catch (e) {
        console.warn(`${CHAT_LOG_PREFIX} ST sync marker save failed:`, e);
    }
}

/**
 * Reset the ST sync marker — next getSTChatHistory call will see all ST history again.
 */
export function clearSTSyncMarker() {
    saveSTSyncMarker('');
}

/**
 * Load the 回家 marker — ISO timestamp of the last phone message that was
 * already folded into a previous 回家 summary. Messages with timestamp <= marker
 * have already been "sent home" and must not be re-sent on subsequent 回家.
 * @returns {string} ISO timestamp string, or '' if not set
 */
export function loadHomeMarker() {
    try {
        return chat_metadata?.[META_KEY_HOME_MARKER] || '';
    } catch {
        return '';
    }
}

/**
 * Save the 回家 marker (ISO timestamp of the newest message included in the 回家 summary).
 * @param {string} marker
 */
export function saveHomeMarker(marker) {
    try {
        if (!chat_metadata) return;
        if (marker) {
            chat_metadata[META_KEY_HOME_MARKER] = marker;
        } else {
            delete chat_metadata[META_KEY_HOME_MARKER];
        }
        saveMetadataDebounced();
    } catch (e) {
        console.warn(`${CHAT_LOG_PREFIX} 回家 marker save failed:`, e);
    }
}

/**
 * Reset the 回家 marker — next 回家 will treat all phone history as new.
 */
export function clearHomeMarker() {
    saveHomeMarker('');
}

/**
 * Get phone messages that have NOT yet been included in a previous 回家 summary.
 * Compares ISO timestamps lexicographically (safe because ISO strings sort chronologically).
 * Messages without a timestamp can't be ordered against the marker, so once a
 * marker exists we conservatively SKIP them — they would otherwise be re-sent
 * on every 回家 forever.
 * @param {Array} history - Full phone chat history
 * @returns {Array} Slice of messages strictly newer than the home marker
 */
export function getMessagesSinceHome(history) {
    if (!Array.isArray(history) || history.length === 0) return [];
    const marker = loadHomeMarker();
    if (!marker) return history.slice();
    return history.filter(m => m.timestamp && m.timestamp > marker);
}

/**
 * Clear all chat history for the current character.
 */
export function clearChatHistory() {
    saveChatHistory([]);
    saveChatSummary('');       // 同时清空滚动总结，避免残留旧上下文
    clearSTSyncMarker();       // 重置 ST 同步进度，下次注入会重新吸收主线
    clearHomeMarker();         // 重置回家进度，下次回家从头开始
}

/**
 * Delete a single message by its index in the history array.
 * @param {number} index - 0-based index into the full history array
 * @returns {boolean} true if deleted successfully
 */
export function deleteMessageByIndex(index) {
    const history = loadChatHistory();
    if (index < 0 || index >= history.length) return false;
    history.splice(index, 1);
    saveChatHistory(history);
    return true;
}

/**
 * Delete multiple messages by their indices in one pass.
 * @param {number[]} indices - Array of 0-based indices to delete
 * @returns {number} Number of messages actually deleted
 */
export function deleteMessagesByIndices(indices) {
    if (!indices || indices.length === 0) return 0;
    const history = loadChatHistory();
    // Sort descending so we splice from the end first (avoids index shifting)
    const sorted = [...indices].sort((a, b) => b - a);
    let deleted = 0;
    for (const idx of sorted) {
        if (idx >= 0 && idx < history.length) {
            history.splice(idx, 1);
            deleted++;
        }
    }
    if (deleted > 0) saveChatHistory(history);
    return deleted;
}

/**
 * Update the content of a single message by its index.
 * @param {number} index - 0-based index into the full history array
 * @param {string} newContent - New message text to set
 * @returns {boolean} true if updated successfully
 */
export function updateMessageByIndex(index, newContent) {
    const history = loadChatHistory();
    if (index < 0 || index >= history.length) return false;
    history[index].content = newContent;
    saveChatHistory(history);
    return true;
}

// ═══════════════════════════════════════════════════════════════════════
// ST Main Chat History Access (Bidirectional Sync)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Read recent messages from ST's main chat (the storyline).
 * Each message is run through ST's regex engine with isPrompt=true so that
 * the user's "promptOnly" filters (e.g. strip thinking/main body, keep summary)
 * apply consistently with what the main LLM sees.
 *
 * Two-stage filter:
 *   1. sinceMarker: drop everything up to and including the last ST message
 *      that was already absorbed into the rolling phone summary
 *   2. tokenLimit: walk from newest backwards, keep as many as fit
 *
 * Returned objects also carry `send_date` so callers (auto-summarize) can
 * advance the marker after successfully folding content into the summary.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.sinceMarker=true] - If true, only return messages newer than the marker
 * @param {number}  [opts.tokenLimit=ST_HISTORY_TOKEN_LIMIT] - Token budget cap; 0 disables
 * @param {number}  [opts.maxMessages=0] - Optional hard message-count cap; 0 disables
 * @returns {Array<{role: string, content: string, send_date: string}>}
 */
export function getSTChatHistory({ sinceMarker = true, tokenLimit = ST_HISTORY_TOKEN_LIMIT, maxMessages = 0 } = {}) {
    try {
        const context = getContext();
        const stChat = context.chat;

        if (!stChat || !Array.isArray(stChat) || stChat.length === 0) {
            return [];
        }

        const total = stChat.length;
        const candidates = [];
        for (let i = 0; i < total; i++) {
            const msg = stChat[i];
            if (!msg || typeof msg.mes !== 'string' || msg.mes.trim() === '') continue;
            if (msg.is_system) continue;
            const depth = total - 1 - i;
            const placement = msg.is_user ? regex_placement.USER_INPUT : regex_placement.AI_OUTPUT;
            const processed = getRegexedString(msg.mes, placement, { isPrompt: true, depth });
            if (!processed || processed.trim() === '') continue;
            candidates.push({
                role: msg.is_user ? 'user' : 'char',
                content: processed,
                send_date: msg.send_date || '',
            });
        }

        let working = candidates;

        // Stage 1: drop messages up to and including the marker.
        // If marker is set but the corresponding message has been deleted,
        // findIndex returns -1 → we silently fall back to "everything",
        // which is the safe behavior (snapshot was lost, re-absorb fresh).
        if (sinceMarker) {
            const marker = loadSTSyncMarker();
            if (marker) {
                const idx = working.findIndex(c => c.send_date === marker);
                if (idx >= 0) working = working.slice(idx + 1);
            }
        }

        // Stage 2: token budget — keep the newest messages that fit.
        if (tokenLimit > 0 && working.length > 0) {
            let acc = 0;
            let cutIdx = 0;
            for (let i = working.length - 1; i >= 0; i--) {
                const cost = estimateTokenCount(working[i].content) + 10;
                if (acc + cost > tokenLimit) {
                    cutIdx = i + 1;
                    break;
                }
                acc += cost;
            }
            working = working.slice(cutIdx);
        }

        if (maxMessages > 0) working = working.slice(-maxMessages);

        console.log(`${CHAT_LOG_PREFIX} Fetched ${working.length} ST messages (sinceMarker=${sinceMarker}, tokenLimit=${tokenLimit})`);
        return working;
    } catch (e) {
        console.warn(`${CHAT_LOG_PREFIX} Failed to read ST main chat:`, e);
        return [];
    }
}

/**
 * Build the summary message text wrapped in 恶灵QR tags.
 * @param {string} summary - The raw summary text
 * @returns {string} The wrapped message
 */
function buildSyncMessage(summary) {
    const charName = getCharacterInfo()?.name || '角色';
    const userName = getUserName();

    return `<恶灵QR>[手机聊天记录同步]
${userName}刚才在外出期间通过手机短信和${charName}进行了一段聊天。以下是这段手机聊天的总结：

${summary}

${userName}现在已经回到了${charName}身边。请${charName}根据手机聊天的内容和当前的情境，自然地继续线下互动。可以提到手机里聊过的话题，但不要机械地复述。</恶灵QR>`;
}

/**
 * Send the phone chat summary as a visible user message in ST's main chat,
 * wrapped in <恶灵QR></恶灵QR> tags, then trigger LLM generation.
 * This replaces the old invisible setExtensionPrompt injection.
 * @param {string} summary - The summary text to send
 */
export async function sendSummaryAsUserMessage(summary) {
    try {
        const messageText = buildSyncMessage(summary);

        // Write into ST's main textarea
        const textarea = document.getElementById('send_textarea');
        if (!textarea) {
            // Fallback: try jQuery selector (ST uses jQuery extensively)
            const $textarea = jQuery('#send_textarea');
            if ($textarea.length === 0) {
                throw new Error('找不到ST主输入框 #send_textarea');
            }
            $textarea.val(messageText).trigger('input');
        } else {
            textarea.value = messageText;
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
        }

        console.log(`${CHAT_LOG_PREFIX} 已将手机聊天总结填入ST输入框`);

        // Click the send button to dispatch as a real user message + trigger generation
        const sendBtn = document.getElementById('send_but');
        if (sendBtn) {
            sendBtn.click();
            console.log(`${CHAT_LOG_PREFIX} 已点击发送按钮，总结将作为用户消息发出`);
        } else {
            // Fallback to jQuery
            jQuery('#send_but').trigger('click');
            console.log(`${CHAT_LOG_PREFIX} 已通过jQuery触发发送`);
        }
    } catch (e) {
        console.error(`${CHAT_LOG_PREFIX} 发送手机聊天总结失败:`, e);
        throw e;
    }
}

/**
 * Send the raw phone chat transcript as a visible user message in ST's main chat.
 * Used by the "原文灌入" return-home mode.
 * @param {Array} history - Phone chat history array [{role, content, timestamp}]
 */
export async function sendRawTranscriptAsUserMessage(history) {
    const charName = getCharacterInfo()?.name || '角色';
    const userName = getUserName();

    const transcript = history.map(msg => {
        const role = msg.role === 'user' ? userName : charName;
        const timeStr = msg.timestamp
            ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : '';
        return timeStr ? `[${timeStr}] ${role}: ${msg.content}` : `${role}: ${msg.content}`;
    }).join('\n');

    const messageText = `<恶灵QR>[手机聊天记录同步 — 原文]
在异地状态时，${userName}和${charName}进行了一些聊天。以下是完整的手机聊天记录原文：

${transcript}

${userName}现在已经和${charName}结束了异地。请${charName}根据手机聊天的内容和当前的情境，自然地继续线下互动。可以提到手机里聊过的话题，但不要机械地复述。</恶灵QR>`;

    try {
        const textarea = document.getElementById('send_textarea');
        if (!textarea) {
            const $textarea = jQuery('#send_textarea');
            if ($textarea.length === 0) {
                throw new Error('找不到ST主输入框 #send_textarea');
            }
            $textarea.val(messageText).trigger('input');
        } else {
            textarea.value = messageText;
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
        }

        console.log(`${CHAT_LOG_PREFIX} 已将手机聊天原文填入ST输入框`);

        const sendBtn = document.getElementById('send_but');
        if (sendBtn) {
            sendBtn.click();
            console.log(`${CHAT_LOG_PREFIX} 已点击发送按钮，原文记录将作为用户消息发出`);
        } else {
            jQuery('#send_but').trigger('click');
            console.log(`${CHAT_LOG_PREFIX} 已通过jQuery触发发送`);
        }
    } catch (e) {
        console.error(`${CHAT_LOG_PREFIX} 发送手机聊天原文失败:`, e);
        throw e;
    }
}



// ═══════════════════════════════════════════════════════════════════════
// Rolling Chat Summary (per-character)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Load the rolling summary text from chat_metadata.
 * @returns {string}
 */
export function loadChatSummary() {
    try {
        return chat_metadata?.[META_KEY_SUMMARY] || '';
    } catch {
        return '';
    }
}

/**
 * Save rolling summary text to chat_metadata.
 * @param {string} summaryText
 */
export function saveChatSummary(summaryText) {
    try {
        if (chat_metadata) {
            chat_metadata[META_KEY_SUMMARY] = summaryText;
            saveMetadataDebounced();
        }
    } catch (e) {
        console.warn(`${CHAT_LOG_PREFIX} chat_metadata summary save failed:`, e);
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Auto-Summarize Logic
// ═══════════════════════════════════════════════════════════════════════

let _isSummarizing = false; // Guard against concurrent runs

/** Show a brief toast in the chat UI (non-blocking, auto-dismiss) */
function _showSummarizeToast(text, durationMs = 3000) {
    const root = document.getElementById('chat_page_root');
    if (!root) return; // User not in chat app
    const existing = root.querySelector('.chat-summarize-toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.className = 'chat-toast chat-summarize-toast';
    toast.textContent = text;
    root.appendChild(toast);
    setTimeout(() => toast.remove(), durationMs);
}

/**
 * Check if auto-summarize should trigger, and if so, run it.
 * Called after every saveChatHistory in sendAllMessages.
 * Runs asynchronously — does NOT block the chat UI.
 */
export async function maybeAutoSummarize() {
    if (_isSummarizing) {
        console.log(`${CHAT_LOG_PREFIX} 自动总结已在运行中，跳过`);
        return;
    }

    const history = loadChatHistory();

    // Estimate tokens of unsummarized messages
    const unsummarized = history.filter(m => !m.summarized);
    const unsummarizedTokens = estimateMessagesTokens(unsummarized);
    if (unsummarizedTokens < SUMMARIZE_TOKEN_THRESHOLD) return;

    _isSummarizing = true;
    console.log(`${CHAT_LOG_PREFIX} 📝 触发自动总结: ${unsummarized.length} 条消息, ~${unsummarizedTokens} tokens (阈值 ${SUMMARIZE_TOKEN_THRESHOLD})`);
    _showSummarizeToast('正在压缩聊天记录…');

    try {
        // ─── Determine slice to summarize ───
        // We summarize all unsummarized messages EXCEPT the most recent KEEP_RECENT
        const toSummarizeCount = unsummarized.length - KEEP_RECENT;
        if (toSummarizeCount <= 0) return;

        // Collect messages to summarize (oldest unsummarized, excluding KEEP_RECENT newest)
        const messagesToSummarize = unsummarized.slice(0, toSummarizeCount);

        // Build identity stamps for safe matching after async operations
        // This avoids the race condition where indices shift if new messages arrive
        const summarizedStamps = new Set(
            messagesToSummarize.map(m => `${m.timestamp}|${m.role}|${(m.content || '').slice(0, 50)}`)
        );

        console.log(`${CHAT_LOG_PREFIX} 将总结 ${messagesToSummarize.length} 条消息，保留最近 ${KEEP_RECENT} 条`);

        // ─── Step 1: Memory fragments → World Book (optional, controlled by settings) ───
        const charInfo = getCharacterInfo();
        const charName = charInfo?.name || '角色';
        const userName = getUserName();

        const doMemoryInAutoSummarize = getPhoneSetting('autoSummarizeMemory', true);
        if (doMemoryInAutoSummarize) {

            // Convert phone messages to the format generateSummary() expects:
            // { parsedContent, parsedDate, is_user, name }
            const summarizerMessages = messagesToSummarize.map(msg => ({
                parsedContent: msg.content || '',
                parsedDate: msg.timestamp ? new Date(msg.timestamp).toLocaleDateString('zh-CN') : null,
                is_user: msg.role === 'user',
                is_system: false,
                name: msg.role === 'user' ? userName : charName,
            }));

            try {
                const fragments = await generateSummary(summarizerMessages);
                if (fragments && Array.isArray(fragments) && fragments.length > 0) {
                    await saveToWorldBook(fragments, null, null, isContentSimilar);
                    console.log(`${CHAT_LOG_PREFIX} ✅ 记忆碎片已写入世界书: ${fragments.length} 条`);
                } else {
                    console.log(`${CHAT_LOG_PREFIX} ℹ️ 鬼面判断无新记忆碎片`);
                }
            } catch (e) {
                console.error(`${CHAT_LOG_PREFIX} ❌ 记忆碎片提取失败:`, e);
                // Continue — rolling summary is independent
            }
        } else {
            console.log(`${CHAT_LOG_PREFIX} ℹ️ 记忆碎片提取已关闭（设置 → 聊天 → 自动压缩）`);
        }

        // ─── Step 2: Rolling summary via LLM ───
        // Also fold in the ST main-chat increment so future prompts can stop
        // re-injecting raw ST history every turn.
        try {
            const existingSummary = loadChatSummary();

            const transcript = messagesToSummarize.map(msg => {
                const role = msg.role === 'user' ? userName : charName;
                return `${role}: ${msg.content}`;
            }).join('\n');

            // Snapshot ST increment BEFORE the LLM call. Any ST messages that
            // arrive during the call will be picked up next round (marker only
            // advances to this snapshot's tail, not to "current end of chat").
            const stIncrement = getSTChatHistory({ sinceMarker: true, tokenLimit: ST_HISTORY_TOKEN_LIMIT });
            const stTranscript = stIncrement.length > 0
                ? stIncrement.map(m => `${m.role === 'user' ? userName : charName}: ${m.content}`).join('\n')
                : '';

            const summarySystemPrompt = buildRollingSummarizePrompt();

            let summaryUserPrompt;
            if (existingSummary && stTranscript) {
                summaryUserPrompt = `旧总结：\n${existingSummary}\n\n新的手机聊天记录：\n${transcript}\n\n相关的主线背景片段（线下互动，请作为环境信息纳入）：\n${stTranscript}\n\n请合并为一份完整的总结。`;
            } else if (existingSummary) {
                summaryUserPrompt = `旧总结：\n${existingSummary}\n\n新的聊天记录：\n${transcript}\n\n请合并为一份完整的总结。`;
            } else if (stTranscript) {
                summaryUserPrompt = `手机聊天记录：\n${transcript}\n\n相关的主线背景片段（线下互动，请作为环境信息纳入）：\n${stTranscript}\n\n请生成一份完整的总结。`;
            } else {
                summaryUserPrompt = `聊天记录：\n${transcript}\n\n请生成总结。`;
            }

            const newSummary = await callPhoneLLM(summarySystemPrompt, summaryUserPrompt, { maxTokens: 2000 });

            if (newSummary && newSummary.trim()) {
                saveChatSummary(newSummary.trim());

                // Advance marker only after a successful summary. Walk from end
                // to grab the newest non-empty send_date — defensively skips
                // any (rare) message lacking the field.
                let newMarker = '';
                for (let i = stIncrement.length - 1; i >= 0; i--) {
                    if (stIncrement[i].send_date) { newMarker = stIncrement[i].send_date; break; }
                }
                if (newMarker) saveSTSyncMarker(newMarker);

                console.log(`${CHAT_LOG_PREFIX} ✅ 滚动总结已更新 (${newSummary.trim().length} 字), ST marker → ${newMarker || '(unchanged)'}`);
            }
        } catch (e) {
            console.error(`${CHAT_LOG_PREFIX} ❌ 滚动总结生成失败:`, e);
        }

        // ─── Step 3: Mark old messages as summarized ───
        // Re-load the live history and match by identity stamp (not index)
        // to safely handle messages added during the async LLM calls above
        const freshHistory = loadChatHistory();
        let markedCount = 0;
        for (const msg of freshHistory) {
            if (msg.summarized) continue;
            const stamp = `${msg.timestamp}|${msg.role}|${(msg.content || '').slice(0, 50)}`;
            if (summarizedStamps.has(stamp)) {
                msg.summarized = true;
                markedCount++;
            }
        }
        saveChatHistory(freshHistory);
        console.log(`${CHAT_LOG_PREFIX} ✅ 已标记 ${markedCount} 条消息为已总结`);
        _showSummarizeToast('聊天记录已压缩');

    } catch (error) {
        console.error(`${CHAT_LOG_PREFIX} ❌ 自动总结流程失败:`, error);
        _showSummarizeToast('记录压缩失败');
    } finally {
        _isSummarizing = false;
    }
}
