// modules/phone/chat/chatStorage.js — Chat history persistence
// Storage: chat_metadata (persisted inside .jsonl chat file, cross-device)

import { getContext, saveMetadataDebounced } from '../../../../../../extensions.js';
import { chat_metadata, saveChatConditional } from '../../../../../../../script.js';
import { getRegexedString, regex_placement } from '../../../../../regex/engine.js';
import { generateSummary, isContentSimilar } from '../../summarizer.js';
import { buildRollingSummarizePrompt } from './chatPromptBuilder.js';
import { saveToWorldBook } from '../../worldbook.js';
import { callPhoneLLM } from '../../api.js';
import { getPhoneCharInfo, getPhoneUserName, getPhoneUserPersona } from '../phoneContext.js';
import { getPhoneSetting } from '../phoneSettings.js';
import * as chatHistoryStore from '../../storage/chatHistoryStore.js';
import { atomicWriteJSON, readJSON, deleteFile } from '../../storage/fileStore.js';
import { eventSource, event_types } from '../../../../../../../script.js';

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
// Note: an earlier Phase 2 prototype also wrote gf_storageMigrated into
// chat_metadata as a "已迁移" marker. That approach forced a queueSaveChat
// during every migrate and could race with ST's chat load to blank the .jsonl.
// The current design (Phase 2.5) uses the existence of the self-managed file
// itself as the source of truth, so no per-chat marker is needed. Legacy
// gf_storageMigrated values left on old chats are silently ignored.

// ═══════════════════════════════════════════════════════════════════════
// Serialized save queue
// ═══════════════════════════════════════════════════════════════════════
// All saveChatConditional() calls go through this single promise chain to
// prevent concurrent writes from racing and corrupting chat_metadata — a real
// incident we've hit before on remote (tailscale) sessions, where ST's mutex
// + HTTP RTT lets two callers' writes interleave on the server side.
//
// Serializing here lets UI hot-paths fire-and-forget without losing ordering,
// while callers that need durability before continuing can still await the
// returned promise.

let _saveQueue = Promise.resolve();

/**
 * Enqueue a saveChatConditional() call. The returned promise resolves when
 * THIS save completes (or rejects with its error). Errors are isolated per
 * task — one failing save will not poison subsequent saves in the queue.
 *
 * @returns {Promise<void>}
 */
export function queueSaveChat() {
    const next = _saveQueue
        .catch(() => {}) // isolate failures of prior tasks from later ones
        .then(() => saveChatConditional());
    _saveQueue = next;
    return next;
}

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
 *   special?: string,    // e.g. 'voice', 'transfer', 'image', 'share', 'retract'
 *   replyTo?: {          // present when this message quotes another one
 *       role: 'user' | 'char',
 *       snippet: string, // frozen text snapshot, <= 60 code points
 *   }
 * }
 */

// ── Reply snippet helper ──
// Builds the frozen text preview stored on msg.replyTo. Snippet is captured
// at the moment of quoting; original content edits/deletes never propagate.
const REPLY_SNIPPET_MAX = 60;

export function buildReplySnippet(msg) {
    if (!msg) return '';
    if (msg.special === 'voice') return '[语音]';
    if (msg.special === 'image') return '[图片]';
    if (msg.special === 'call') return '[来电]';
    const content = msg.content || '';
    if (content === '[撤回了一条消息]') return '[已撤回]';
    // Code-point iteration so multi-byte emoji/CJK aren't cut mid-char.
    const cps = [...content];
    if (cps.length <= REPLY_SNIPPET_MAX) return content;
    return cps.slice(0, REPLY_SNIPPET_MAX).join('') + '…';
}

/**
 * Load chat history from chat_metadata (persisted in .jsonl chat file).
 *
 * Returns a SHALLOW COPY of the underlying array. Callers may freely push,
 * splice, or replace items without immediately mutating chat_metadata —
 * they must call saveChatHistory() to persist. Returning the live reference
 * caused a race where a multi-bubble LLM response would leak partial state
 * to chat_metadata mid-loop, and any ST autosave firing during the inter-
 * bubble delays would snapshot only the first 1–2 messages to disk. A
 * subsequent refresh would then resurrect only that partial state.
 *
 * Note: message objects themselves are still shared references; in-place
 * mutations (msg.content = ..., msg.reactions = ...) still leak. All such
 * paths already call saveChatHistory() right after, so this is acceptable.
 *
 * @returns {Array} messages (caller-owned copy)
 */
export function loadChatHistory() {
    if (_useExternalStorage()) {
        try {
            return chatHistoryStore.loadHistory();
        } catch (e) {
            // Cache not ready (e.g. prewarm still in-flight). Fall through to
            // chat_metadata — once migration succeeds the legacy key is deleted,
            // so this fallback safely returns [] for already-migrated chats.
            console.warn(`${CHAT_LOG_PREFIX} chatHistoryStore not ready, fallback to chat_metadata:`, e.message);
        }
    }
    try {
        const data = chat_metadata?.[META_KEY_HISTORY];
        if (Array.isArray(data) && data.length > 0) return data.slice();
    } catch (e) {
        console.warn(`${CHAT_LOG_PREFIX} chat_metadata 读取失败:`, e);
    }
    return [];
}

/**
 * Sync the in-memory chat_metadata snapshot of the chat history WITHOUT
 * queuing a disk write. Use when a hot path needs subsequent loadChatHistory()
 * calls (e.g. from the bubble long-press menu or toggleReaction) to see new
 * entries immediately, but the caller will batch the durable save later.
 *
 * Specifically needed by renderResponseToDom: each LLM bubble is inserted
 * into the DOM with its final msgIndex right after the local push, but the
 * actual saveChatHistory() awaits once at the end of the loop. Without this
 * sync, a long-press on a freshly-arrived bubble would loadChatHistory(),
 * find msgIndex out of range, and silently bail.
 *
 * Returns the length of what actually got stored (after MAX_HISTORY_MESSAGES
 * trim), so the caller can derive a correct msgIndex. The local array passed
 * in may be longer than the stored slice; using its length as msgIndex would
 * point past the trimmed array's end.
 *
 * @returns {number} stored length (0 if chat_metadata missing)
 */
export function commitHistoryInMemory(messages) {
    if (_useExternalStorage()) {
        return chatHistoryStore.commitInMemory(messages);
    }
    if (!chat_metadata) return 0;
    const trimmed = messages.slice(-MAX_HISTORY_MESSAGES);
    chat_metadata[META_KEY_HISTORY] = trimmed;
    return trimmed.length;
}

/**
 * Save chat history to chat_metadata (persisted in .jsonl chat file).
 * Trims to MAX_HISTORY_MESSAGES to prevent storage bloat.
 *
 * NOTE: This is async and uses saveChatConditional (immediate, mutex-protected)
 * rather than saveMetadataDebounced (1s debounce). The debounce variant could
 * be silently canceled mid-flight by subsequent calls, leaving the .jsonl on
 * disk stale across page reloads — and in the worst case allowing ST's
 * getChat()/getChatResult fallback to overwrite the file with a first_message.
 * Callers in async contexts should `await` to guarantee the write reaches disk
 * before kicking off any long-running operation (e.g. LLM generation) that
 * could be interrupted by a refresh.
 *
 * @param {Array} messages
 * @returns {Promise<void>}
 */
export async function saveChatHistory(messages) {
    if (_useExternalStorage()) {
        try {
            await chatHistoryStore.ensureReady();
            await chatHistoryStore.saveHistory(messages);
            return;
        } catch (e) {
            // Critical: do NOT fall back to chat_metadata here. Falling back
            // would split data between two backends and the next prewarm would
            // overwrite the file with the stale cached state. Better to surface
            // the failure to the caller (chatMessageHandler etc.) and let it
            // decide whether to toast / retry.
            console.error(`${CHAT_LOG_PREFIX} chatHistoryStore save failed (NOT falling back):`, e);
            throw e;
        }
    }
    const trimmed = messages.slice(-MAX_HISTORY_MESSAGES);
    try {
        if (!chat_metadata) return;
        chat_metadata[META_KEY_HISTORY] = trimmed;
        await queueSaveChat();
    } catch (e) {
        console.warn(`${CHAT_LOG_PREFIX} chat_metadata 保存失败:`, e);
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Pending Result Persistence (survives page refresh)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Persist a pending LLM result to chat_metadata so it survives page refresh.
 * Async + immediate save: the whole point of this helper is "survive refresh",
 * so we cannot tolerate a debounce that might be canceled before flush.
 * @param {{ rawResponse: string, messagesToSend: string[] } | null} result
 * @returns {Promise<void>}
 */
export async function persistPendingResult(result) {
    try {
        if (!chat_metadata) return;
        chat_metadata[META_KEY_PENDING_RESULT] = result || null;
        await queueSaveChat();
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
 * Fire-and-forget: a missed clear is harmless — the stale entry on disk will
 * just be re-consumed on next load. Keeping this sync so the synchronous
 * consumePendingResult() caller doesn't need to thread async through.
 */
export function clearPersistedPendingResult() {
    try {
        if (chat_metadata?.[META_KEY_PENDING_RESULT]) {
            delete chat_metadata[META_KEY_PENDING_RESULT];
            queueSaveChat().catch(e =>
                console.warn(`${CHAT_LOG_PREFIX} Pending result clear flush failed:`, e));
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
 * Immediate save: a dropped marker would cause auto-summarize to re-absorb
 * already-summarized ST history on the next round, ballooning the prompt.
 * @param {string} marker - send_date string of the last absorbed ST message
 * @returns {Promise<void>}
 */
export async function saveSTSyncMarker(marker) {
    try {
        if (!chat_metadata) return;
        if (marker) {
            chat_metadata[META_KEY_ST_SYNC_MARKER] = marker;
        } else {
            delete chat_metadata[META_KEY_ST_SYNC_MARKER];
        }
        await queueSaveChat();
    } catch (e) {
        console.warn(`${CHAT_LOG_PREFIX} ST sync marker save failed:`, e);
    }
}

/**
 * Reset the ST sync marker — next getSTChatHistory call will see all ST history again.
 * @returns {Promise<void>}
 */
export async function clearSTSyncMarker() {
    await saveSTSyncMarker('');
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
 * Immediate save: a dropped marker would resend the entire phone transcript
 * on the next 回家, which is very visible to the user.
 * @param {string} marker
 * @returns {Promise<void>}
 */
export async function saveHomeMarker(marker) {
    try {
        if (!chat_metadata) return;
        if (marker) {
            chat_metadata[META_KEY_HOME_MARKER] = marker;
        } else {
            delete chat_metadata[META_KEY_HOME_MARKER];
        }
        await queueSaveChat();
    } catch (e) {
        console.warn(`${CHAT_LOG_PREFIX} 回家 marker save failed:`, e);
    }
}

/**
 * Reset the 回家 marker — next 回家 will treat all phone history as new.
 * @returns {Promise<void>}
 */
export async function clearHomeMarker() {
    await saveHomeMarker('');
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
 * Mark every message with timestamp <= marker as summarized, in place.
 *
 * Done by direct chat_metadata mutation (no loadChatHistory + saveChatHistory
 * roundtrip) so that any messages appended concurrently — e.g. an autoMessage
 * that fires while the caller is in an await — are preserved. saveChatHistory
 * would slice() and overwrite the array, dropping those late arrivals.
 *
 * UI rendering doesn't read .summarized, so the user still sees the bubbles;
 * only the chat prompt's <chat_history> block filters them out, preventing
 * the same content from being re-sent to the LLM after it's already been
 * folded into ST main chat via 回家.
 *
 * @param {string} marker - ISO timestamp; messages at or before this are marked
 * @returns {Promise<number>} count of newly-marked messages
 */
export async function markMessagesSummarizedUntil(marker) {
    if (!marker) return 0;
    if (_useExternalStorage()) {
        try {
            await chatHistoryStore.ensureReady();
            let count = 0;
            await chatHistoryStore.mutateInPlace((live) => {
                if (!Array.isArray(live) || live.length === 0) return;
                for (const msg of live) {
                    if (msg.summarized) continue;
                    if (msg.timestamp && msg.timestamp <= marker) {
                        msg.summarized = true;
                        count++;
                    }
                }
            });
            return count;
        } catch (e) {
            console.warn(`${CHAT_LOG_PREFIX} markMessagesSummarizedUntil (external) failed:`, e);
            return 0;
        }
    }
    try {
        if (!chat_metadata) return 0;
        const live = chat_metadata[META_KEY_HISTORY];
        if (!Array.isArray(live) || live.length === 0) return 0;
        let count = 0;
        for (const msg of live) {
            if (msg.summarized) continue;
            if (msg.timestamp && msg.timestamp <= marker) {
                msg.summarized = true;
                count++;
            }
        }
        if (count > 0) await queueSaveChat();
        return count;
    } catch (e) {
        console.warn(`${CHAT_LOG_PREFIX} markMessagesSummarizedUntil failed:`, e);
        return 0;
    }
}

/**
 * Clear all chat history for the current character.
 * @returns {Promise<void>}
 */
export async function clearChatHistory() {
    await saveChatHistory([]);
    await saveChatSummary('');       // also clear rolling summary so no stale context lingers
    await clearSTSyncMarker();       // reset ST sync progress; next injection re-absorbs main chat
    await clearHomeMarker();         // reset home progress; next 回家 starts fresh
}

/**
 * Delete a single message by its index in the history array.
 * @param {number} index - 0-based index into the full history array
 * @returns {Promise<boolean>} true if deleted successfully
 */
export async function deleteMessageByIndex(index) {
    const history = loadChatHistory();
    if (index < 0 || index >= history.length) return false;
    history.splice(index, 1);
    await saveChatHistory(history);
    return true;
}

/**
 * Delete multiple messages by their indices in one pass.
 * @param {number[]} indices - Array of 0-based indices to delete
 * @returns {Promise<number>} Number of messages actually deleted
 */
export async function deleteMessagesByIndices(indices) {
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
    if (deleted > 0) await saveChatHistory(history);
    return deleted;
}

/**
 * Update the content of a single message by its index.
 * @param {number} index - 0-based index into the full history array
 * @param {string} newContent - New message text to set
 * @returns {Promise<boolean>} true if updated successfully
 */
export async function updateMessageByIndex(index, newContent) {
    const history = loadChatHistory();
    if (index < 0 || index >= history.length) return false;
    history[index].content = newContent;
    await saveChatHistory(history);
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
在异地状态时，${userName}和${charName}进行了一些聊天。以下是完整的手机聊天记录原文：

${summary}

${userName}现在已经和${charName}结束了异地。请${charName}根据手机聊天的内容和当前的情境，自然地继续线下互动。可以提到手机里聊过的话题，但不要机械地复述。</恶灵QR>`;
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
 * Immediate save: the rolling summary represents 40k+ tokens of folded
 * history; losing it forces re-summarization on the next round.
 * @param {string} summaryText
 * @returns {Promise<void>}
 */
export async function saveChatSummary(summaryText) {
    try {
        if (!chat_metadata) return;
        chat_metadata[META_KEY_SUMMARY] = summaryText;
        await queueSaveChat();
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
                // generateSummary returns { entries, timelineSegments }, not a bare array
                const summaryResult = await generateSummary(summarizerMessages, true);
                const fragments = summaryResult?.entries;
                if (Array.isArray(fragments) && fragments.length > 0) {
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
                await saveChatSummary(newSummary.trim());

                // Advance marker only after a successful summary. Walk from end
                // to grab the newest non-empty send_date — defensively skips
                // any (rare) message lacking the field.
                let newMarker = '';
                for (let i = stIncrement.length - 1; i >= 0; i--) {
                    if (stIncrement[i].send_date) { newMarker = stIncrement[i].send_date; break; }
                }
                if (newMarker) await saveSTSyncMarker(newMarker);

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
        await saveChatHistory(freshHistory);
        console.log(`${CHAT_LOG_PREFIX} ✅ 已标记 ${markedCount} 条消息为已总结`);
        _showSummarizeToast('聊天记录已压缩');

    } catch (error) {
        console.error(`${CHAT_LOG_PREFIX} ❌ 自动总结流程失败:`, error);
        _showSummarizeToast('记录压缩失败');
    } finally {
        _isSummarizing = false;
    }
}

// ═══════════════════════════════════════════════════════════════════════
// External Storage (Phase 2 — chatHistoryStore backed by /user/files/)
// ═══════════════════════════════════════════════════════════════════════
// _useExternalStorage() only checks the user opt-in setting. The single
// source of truth for "is this chat migrated" is the self-managed file's
// existence on disk (probed by _ensureSelfManagedFile). META_KEY_MIGRATED
// is no longer used — relying on it forced us to queueSaveChat() during
// every migrate, which could race with ST's chat load and blank the .jsonl
// (Phase 2 事故 B). Old chats may still carry the residual key in chat_metadata;
// it is silently ignored, never read, never re-written.
//
// LEGACY cleanup (deleting chat_metadata.gf_phoneChatHistory and triggering
// queueSaveChat) is decoupled from the migrate-write step and gated on
// ST's chat array being populated. If the chat array is empty, we skip the
// cleanup and let the next CHAT_CHANGED handle it — safer to leave the LEGACY
// key untouched than to risk overwriting the .jsonl with [].

function _useExternalStorage() {
    try {
        return !!getPhoneSetting('useExternalChatStorage', false);
    } catch {
        return false;
    }
}

function _getCurrentKey() {
    try {
        const ctx = getContext();
        return {
            chatId: ctx?.chatId || ctx?.chat_id || 'no_chat',
            charId: ctx?.characterId != null ? String(ctx.characterId) : 'no_char',
        };
    } catch {
        return { chatId: 'no_chat', charId: 'no_char' };
    }
}

/**
 * True iff ST's runtime chat array currently holds at least one message.
 * Used as a gate before any queueSaveChat() we trigger, because saveChat()
 * unconditionally writes `chat.slice()` — calling it when chat is [] blanks
 * the .jsonl (Phase 2 事故 B). When this returns false we defer whatever
 * chat_metadata cleanup we wanted to do until the next CHAT_CHANGED.
 */
function _isSTChatReady() {
    try {
        const ctx = getContext();
        return Array.isArray(ctx?.chat) && ctx.chat.length > 0;
    } catch {
        return false;
    }
}

/**
 * Best-effort cleanup of the legacy chat_metadata.gf_phoneChatHistory key
 * once the self-managed file is confirmed to hold the truth. Only flushes
 * if ST's chat array is populated — otherwise the queueSaveChat would write
 * an empty chat slice to disk. Idempotent: callable any number of times.
 */
async function _maybeCleanupLegacyKey(reason) {
    if (!chat_metadata) return;
    if (!Array.isArray(chat_metadata[META_KEY_HISTORY])) return;
    if (!_isSTChatReady()) {
        console.warn(`${CHAT_LOG_PREFIX} skipping LEGACY cleanup (${reason}) — ST chat array empty; will retry on next CHAT_CHANGED`);
        return;
    }
    delete chat_metadata[META_KEY_HISTORY];
    await queueSaveChat();
    console.log(`${CHAT_LOG_PREFIX} cleared LEGACY chat_metadata key (${reason})`);
}

/**
 * Ensure a self-managed file exists for (chatId, charId). Three branches:
 *
 *   A. Self-managed file already exists  → it IS the truth, never overwrite.
 *                                          Try to clean stale LEGACY (gated).
 *   B. File missing + LEGACY has data    → migrate (atomicWrite + verify),
 *                                          then try to clean LEGACY (gated).
 *   C. File missing + no LEGACY          → create empty file. Does not touch
 *                                          chat_metadata at all → no jsonl risk.
 *
 * Every branch is idempotent — re-running on the same key is a no-op (A) or
 * a verified re-write (B never repeats once file exists) or a re-create of
 * an empty file (C, the file is overwritten with [] which it already was).
 *
 * Critically: this function never overwrites an existing self-managed file
 * from chat_metadata, so restoring an older .jsonl backup that still carries
 * LEGACY data cannot resurrect stale chat history over newer data on disk.
 *
 * @returns {Promise<{branch: 'exists'|'migrated'|'fresh', filename: string, migratedCount?: number}>}
 */
async function _ensureSelfManagedFile(chatId, charId) {
    const filename = await chatHistoryStore.filenameForKey(chatId, charId);

    const existing = await readJSON(filename);
    if (existing !== null) {
        // Branch A — file is truth. Don't touch it.
        await _maybeCleanupLegacyKey('self-managed file already present');
        return { branch: 'exists', filename };
    }

    const legacy = chat_metadata?.[META_KEY_HISTORY];
    if (Array.isArray(legacy) && legacy.length > 0) {
        // Branch B — first-time migration.
        console.log(`${CHAT_LOG_PREFIX} migrating ${legacy.length} messages → ${filename}`);
        await atomicWriteJSON(filename, legacy);

        const readback = await readJSON(filename);
        if (!Array.isArray(readback) || readback.length !== legacy.length) {
            throw new Error(`migrate verify: length mismatch (legacy=${legacy.length} readback=${readback?.length ?? 'null'})`);
        }
        const last = legacy.length - 1;
        const firstOk = readback[0]?.content === legacy[0]?.content
            && readback[0]?.timestamp === legacy[0]?.timestamp;
        const lastOk = readback[last]?.content === legacy[last]?.content
            && readback[last]?.timestamp === legacy[last]?.timestamp;
        if (!firstOk || !lastOk) {
            throw new Error(`migrate verify: first/last content mismatch`);
        }
        console.log(`${CHAT_LOG_PREFIX} ✅ migration verified: ${legacy.length} messages → ${filename}`);

        await _maybeCleanupLegacyKey('migration just completed');
        return { branch: 'migrated', filename, migratedCount: legacy.length };
    }

    // Branch C — fresh start. Create an empty self-managed file so future
    // reads have something to find. atomicWriteJSON([]) only touches /user/files/,
    // never ST's jsonl, so there is no chance of blanking the chat.
    await atomicWriteJSON(filename, []);
    console.log(`${CHAT_LOG_PREFIX} created empty self-managed file ${filename}`);
    return { branch: 'fresh', filename };
}

/**
 * Called on CHAT_CHANGED. Always invalidates the cache (key changed). If the
 * external-storage switch is on, also ensures the self-managed file exists
 * (creating it / migrating from LEGACY if needed) and prewarms the cache.
 * Failure in either step is logged but never propagated — the user must not
 * see the chat app crash because of a storage hiccup.
 *
 * @returns {Promise<void>}
 */
export async function handleChatChanged() {
    chatHistoryStore.invalidate();

    if (!_useExternalStorage()) return;

    const { chatId, charId } = _getCurrentKey();
    try {
        await _ensureSelfManagedFile(chatId, charId);
    } catch (e) {
        console.error(`${CHAT_LOG_PREFIX} _ensureSelfManagedFile failed for ${chatId}/${charId}:`, e);
        return;
    }

    try {
        await chatHistoryStore.prewarm(chatId, charId);
    } catch (e) {
        console.error(`${CHAT_LOG_PREFIX} prewarm failed for ${chatId}/${charId}:`, e);
    }
}

/**
 * Register the CHAT_CHANGED listener. Idempotent guard via a module flag so
 * repeated init calls don't stack listeners. Driven purely by ST events — we
 * never trigger handleChatChanged() ourselves, because doing so during plugin
 * init (when ST's chat array may not be filled yet) would let _tryMigrate's
 * downstream queueSaveChat() rewrite the .jsonl with an empty chat. ST's
 * own CHAT_CHANGED emit happens at the end of getChatResult, by which point
 * chat is guaranteed populated.
 */
let _hooksRegistered = false;
export function initChatStorageHooks() {
    if (_hooksRegistered) return;
    try {
        if (eventSource && event_types?.CHAT_CHANGED) {
            eventSource.on(event_types.CHAT_CHANGED, () => {
                handleChatChanged().catch(e =>
                    console.error(`${CHAT_LOG_PREFIX} handleChatChanged threw:`, e));
            });
            _hooksRegistered = true;
            console.log(`${CHAT_LOG_PREFIX} chat storage hooks registered`);
        } else {
            console.warn(`${CHAT_LOG_PREFIX} eventSource unavailable; hooks NOT registered`);
        }
    } catch (e) {
        console.error(`${CHAT_LOG_PREFIX} initChatStorageHooks failed:`, e);
    }
}

/**
 * Escape hatch (plan D6 "彻底回到 chat_metadata"): delete this chat's
 * self-managed file and invalidate the in-memory cache. The caller MUST also
 * flip the useExternalChatStorage setting OFF (and refresh), otherwise the
 * next CHAT_CHANGED will just recreate an empty self-managed file. We do not
 * touch chat_metadata here — the legacy gf_storageMigrated key is harmless
 * residual data and removing it would require a queueSaveChat that could
 * race with ST chat load (Phase 2 事故 B).
 *
 * @returns {Promise<{ok: boolean, deletedFile?: string, error?: string}>}
 */
export async function purgeExternalChatHistory() {
    try {
        const { chatId, charId } = _getCurrentKey();
        const filename = await chatHistoryStore.filenameForKey(chatId, charId);
        await deleteFile(filename);
        chatHistoryStore.invalidate();
        return { ok: true, deletedFile: filename };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}
