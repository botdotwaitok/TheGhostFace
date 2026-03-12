// modules/phone/chat/chatStorage.js — Chat history persistence
// Storage: chat_metadata (persisted inside .jsonl chat file, cross-device)

import { getContext, saveMetadataDebounced } from '../../../../../../extensions.js';
import { chat_metadata } from '../../../../../../../script.js';
import { generateSummary, isContentSimilar } from '../../summarizer.js';
import { buildRollingSummarizePrompt } from './chatPromptBuilder.js';
import { saveToWorldBook } from '../../worldbook.js';
import { callPhoneLLM } from '../../api.js';
import { getPhoneCharInfo, getPhoneUserName, getPhoneUserPersona } from '../phoneContext.js';

// ═══════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════

const CHAT_LOG_PREFIX = '[聊天]';
const MAX_HISTORY_MESSAGES = 500; // Raise cap — summarize handles compression

// ─── Auto-summarize constants ───
const SUMMARIZE_THRESHOLD = 200; // Trigger summarize when history reaches this
const KEEP_RECENT = 30;          // Keep the most recent N messages unsummarized

// ─── chat_metadata keys ───
const META_KEY_HISTORY = 'gf_phoneChatHistory';
const META_KEY_SUMMARY = 'gf_phoneChatSummary';

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

/**
 * Clear all chat history for the current character.
 */
export function clearChatHistory() {
    saveChatHistory([]);
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
 * Read the most recent messages from ST's main chat (the storyline).
 * This allows the phone chat LLM to know what's happening "offline".
 * @param {number} maxMessages - Maximum number of recent messages to fetch
 * @returns {Array<{role: string, content: string}>}
 */
export function getSTChatHistory(maxMessages = 0) {
    try {
        const context = getContext();
        const stChat = context.chat;

        if (!stChat || !Array.isArray(stChat) || stChat.length === 0) {
            return [];
        }

        // Filter to user + character messages only (skip system, narrator, etc.)
        let filtered = stChat
            .filter(msg => {
                if (!msg || typeof msg.mes !== 'string' || msg.mes.trim() === '') return false;
                // Skip system messages / hidden / etc.
                if (msg.is_system) return false;
                return true;
            });

        // Only slice if a limit is specified
        if (maxMessages > 0) {
            filtered = filtered.slice(-maxMessages);
        }

        filtered = filtered.map(msg => ({
                role: msg.is_user ? 'user' : 'char',
                content: msg.mes,
            }));

        console.log(`${CHAT_LOG_PREFIX} Fetched ${filtered.length} messages from ST main chat`);
        return filtered;
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
        return `${role}: ${msg.content}`;
    }).join('\n');

    const messageText = `<恶灵QR>[手机聊天记录同步 — 原文]
${userName}刚才在外出期间通过手机短信和${charName}进行了一段聊天。以下是完整的手机聊天记录原文：

${transcript}

${userName}现在已经回到了${charName}身边。请${charName}根据手机聊天的内容和当前的情境，自然地继续线下互动。可以提到手机里聊过的话题，但不要机械地复述。</恶灵QR>`;

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

    // Only unsummarized messages count toward the threshold
    const unsummarized = history.filter(m => !m.summarized);
    if (unsummarized.length < SUMMARIZE_THRESHOLD) return;

    _isSummarizing = true;
    console.log(`${CHAT_LOG_PREFIX} 📝 触发自动总结: ${unsummarized.length} 条未总结消息 (阈值 ${SUMMARIZE_THRESHOLD})`);

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

        // ─── Step 1: Memory fragments → World Book ───
        const charInfo = getCharacterInfo();
        const charName = charInfo?.name || '角色';
        const userName = getUserName();

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
                await saveToWorldBook(fragments, null, null, isContentSimilar, false);
                console.log(`${CHAT_LOG_PREFIX} ✅ 记忆碎片已写入世界书: ${fragments.length} 条`);
            } else {
                console.log(`${CHAT_LOG_PREFIX} ℹ️ 鬼面判断无新记忆碎片`);
            }
        } catch (e) {
            console.error(`${CHAT_LOG_PREFIX} ❌ 记忆碎片提取失败:`, e);
            // Continue — rolling summary is independent
        }

        // ─── Step 2: Rolling summary via LLM ───
        try {
            const existingSummary = loadChatSummary();

            const transcript = messagesToSummarize.map(msg => {
                const role = msg.role === 'user' ? userName : charName;
                return `${role}: ${msg.content}`;
            }).join('\n');

            const summarySystemPrompt = buildRollingSummarizePrompt();

            let summaryUserPrompt = '';
            if (existingSummary) {
                summaryUserPrompt = `旧总结：\n${existingSummary}\n\n新的聊天记录：\n${transcript}\n\n请合并为一份完整的总结。`;
            } else {
                summaryUserPrompt = `聊天记录：\n${transcript}\n\n请生成总结。`;
            }

            const newSummary = await callPhoneLLM(summarySystemPrompt, summaryUserPrompt, { maxTokens: 2000 });

            if (newSummary && newSummary.trim()) {
                saveChatSummary(newSummary.trim());
                console.log(`${CHAT_LOG_PREFIX} ✅ 滚动总结已更新 (${newSummary.trim().length} 字)`);
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

    } catch (error) {
        console.error(`${CHAT_LOG_PREFIX} ❌ 自动总结流程失败:`, error);
    } finally {
        _isSummarizing = false;
    }
}
