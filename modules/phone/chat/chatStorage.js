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
import { openProgressCard, getCurrentProgressCard } from './chatProgressCard.js';

// ═══════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════

const CHAT_LOG_PREFIX = '[聊天]';
// No message-count cap on either storage backend. Legacy chat_metadata path
// originally trimmed to 500 to protect ST's .jsonl autosave; self-managed
// files have no such constraint and the two backends are kept symmetric so
// behavior doesn't diverge based on a hidden setting. Summarize-for-prompt
// handles LLM token pressure separately from on-disk storage.

// ─── Auto-summarize constants ───
// Threshold is measured against the FULL next-round prompt (system + history +
// world info + ST main chat injection + …), counted with ST's real tokenizer —
// the same number the "数据统计" page surfaces as "总 Token 数". Earlier
// versions used a cheap CJK/ASCII heuristic over phone-chat-only unsummarized
// messages, which understated the real LLM context pressure dramatically and
// let prompts sail past 100k+ without ever folding. Reusing the precise
// estimator means the trigger fires when context actually matters.
export const SUMMARIZE_PROMPT_TOKEN_THRESHOLD = 50000;
const KEEP_RECENT = 30;                  // Keep the most recent N messages unsummarized
// Per-round upper bound on how many messages a single summarize cycle folds.
// Without this, a long-deferred chat (or a救援操作 that wiped all summarized
// marks) can force one LLM call to digest thousands of messages — guaranteed
// to blow past the model's context window and return empty. Cap at 200 so
// recovery happens incrementally over several sends instead of failing
// loudly once.
const MAX_MESSAGES_PER_SUMMARIZE = 200;
const SUMMARIZE_LLM_TIMEOUT_MS = 300_000; // Abort the rolling-summary LLM call after 300s
//
// Without this timeout, a stalled remote LLM call (tailscale latency, dead
// connection, provider hang) leaves `_isSummarizing` stuck at true and every
// subsequent send short-circuits at the "already running" guard — auto-summarize
// effectively dies until page refresh. The timer abort surfaces to the outer
// catch, which runs the finally block and clears the flag.
//
// 300s budget covers slow remote models + long transcripts. Earlier 60s value
// was too aggressive — anything past a moderately-sized chat with a non-local
// model would trip it. NOTE: this guards the *rolling summary's own LLM call*
// only. Memory-fragment extraction goes through summarizer.js, which has its
// own internal per-chunk timeouts (80s single chunk / 180s big-summary /
// 240s unified), so we don't double-wrap that path.

// Hard token cap on what selectActiveHistoryForPrompt() will hand to the
// prompt builder. Operates on the cheap CJK/ASCII heuristic over phone-chat
// messages only — it's a last-resort guard against the prompt-history block
// alone blowing up, NOT the full-prompt trigger that drives summarize.
// Auto-summarize is gated on SUMMARIZE_PROMPT_TOKEN_THRESHOLD, which counts
// the whole next-round prompt with ST's real tokenizer; this cap just makes
// sure that when summarize is stalled / disabled / pre-migration, the prompt
// still has a hard ceiling.
const PROMPT_HISTORY_TOKEN_CAP = 50000;

// ─── ST main-chat injection ───
// Cap the raw ST history token budget per call. Once auto-summarize fires,
// older ST content is folded into the phone summary and the marker advances,
// so the actual injected count stays well under this cap in steady state.
const ST_HISTORY_TOKEN_LIMIT = 20000;

// ─── chat_metadata keys ───
const META_KEY_HISTORY = 'gf_phoneChatHistory';
const META_KEY_SUMMARY = 'gf_phoneChatSummary';
const META_KEY_SUMMARY_HISTORY = 'gf_phoneChatSummaryHistory'; // snapshots of prior rolling summaries, newest pushed at tail
const META_KEY_PENDING_RESULT = 'gf_phoneChatPendingResult';
const META_KEY_ST_SYNC_MARKER = 'gf_phoneChatLastSTMarker'; // send_date of last ST msg absorbed into summary
const META_KEY_HOME_MARKER = 'gf_phoneChatLastHomeMarker';  // ISO timestamp of last phone msg already 回家'd
const META_KEY_NICKNAME = 'gf_phoneChatNickname';           // user-set display nickname for the character (UI-only)

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

// Returned promise resolves when THIS save completes. Errors are isolated per
// task — one failing save will not poison subsequent saves in the queue.
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

// CJK characters ≈ 1.5 tokens each, ASCII/Latin ≈ 0.25 tokens per char.
function estimateTokenCount(text) {
    if (!text) return 0;
    let tokens = 0;
    for (const char of text) {
        tokens += char.charCodeAt(0) > 0x2E80 ? 1.5 : 0.25;
    }
    return Math.ceil(tokens);
}

/**
 * Estimate how many tokens one message will consume inside the prompt
 * <chat_history> block. Mirrors the line shape from buildChatUserPrompt:
 * content + thought + reply hint + wrapper (timestamp / role / [N] index /
 * reaction suffix). Counting content alone undercounts thought-heavy chats
 * by 3-5x, which lets the prompt-history cap silently miss its budget and
 * makes the manual-hide UI's "after hide" preview meaningless.
 *
 * @param {{content?:string, thought?:string, replyTo?:{snippet?:string}}} msg
 * @returns {number}
 */
export function estimateMessagePromptCost(msg) {
    if (!msg) return 0;
    return estimateTokenCount(msg.content || '')
         + estimateTokenCount(msg.thought || '')
         + estimateTokenCount(msg.replyTo?.snippet || '')
         + 20;
}


// Module-level dedup guard — the cap warning is loud but should only print
// once per truncation event, not once per call site (prompt builder + indexable
// reply map both invoke selectActiveHistoryForPrompt on the same history,
// which would otherwise log twice for one logical send).
let _lastCapWarnSignature = null;

/**
 * Project a full history array down to the slice that goes into LLM prompts.
 * Mirrors how ST's hidden-floor mechanism filters out `is_system: true`
 * messages — here `summarized: true` plays the same role (set by rolling
 * summary, persisted on disk, never resurfaced in prompts).
 *
 * Now that the on-disk 500-message cap is gone, this helper is the only
 * thing standing between an LLM call and a pathologically long unsummarized
 * tail (auto-summarize disabled, pre-migration data with no `summarized`
 * marker, or a long network stall that prevented summary from finishing).
 * Walks newest→oldest accumulating token cost; once the budget would be
 * exceeded, drops everything older. Cuts are temporary (in-memory only,
 * not persisted to disk) — the next send re-evaluates from scratch, so as
 * soon as auto-summarize catches up the older context comes back through
 * the summary path.
 *
 * Must be called from every place that feeds the prompt's chat_history
 * block AND from every place that builds the [N] reply index, otherwise
 * those two would disagree on what counts as "the last RECENT_REPLY_WINDOW
 * entries" and the LLM's replyToIndex would resolve to the wrong message.
 *
 * @param {Array} history - full chat history (cache or disk snapshot)
 * @param {number} [tokenBudget=PROMPT_HISTORY_TOKEN_CAP]
 * @returns {Array} contiguous tail slice of unsummarized messages, in order
 */
export function selectActiveHistoryForPrompt(history, tokenBudget = PROMPT_HISTORY_TOKEN_CAP) {
    if (!Array.isArray(history) || history.length === 0) return [];
    const unsummarized = history.filter(m => !m.summarized);
    if (unsummarized.length === 0) return [];
    if (tokenBudget <= 0) return unsummarized;

    let acc = 0;
    let cutIdx = 0; // 0 = keep everything
    let cutFired = false;
    for (let i = unsummarized.length - 1; i >= 0; i--) {
        const cost = estimateMessagePromptCost(unsummarized[i]);
        if (acc + cost > tokenBudget) {
            cutIdx = i + 1;
            cutFired = true;
            break;
        }
        acc += cost;
    }
    if (!cutFired) return unsummarized;

    const kept = unsummarized.slice(cutIdx);
    const dropped = unsummarized.length - kept.length;
    // Dedup the warn by (dropped, kept.length, total) signature — adjacent
    // calls within one send loop will collapse to a single log line.
    const sig = `${dropped}|${kept.length}|${unsummarized.length}`;
    if (sig !== _lastCapWarnSignature) {
        _lastCapWarnSignature = sig;
        console.warn(
            `${CHAT_LOG_PREFIX} prompt history token-capped at ${tokenBudget}: ` +
            `dropped ${dropped} of ${unsummarized.length} unsummarized message(s), ` +
            `kept newest ${kept.length}. ` +
            `Auto-summarize likely stalled or disabled — older context is missing from this turn.`
        );
    }
    return kept;
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

export function getCharacterInfo() {
    return getPhoneCharInfo();
}

export function getUserName() {
    return getPhoneUserName();
}

export function getUserPersona() {
    return getPhoneUserPersona();
}

// ─── Character Nickname (UI-only, persisted in chat_metadata) ───

// UI-only — never appears in prompts/summaries sent to the LLM, so the model
// still sees the character by their canonical name.
export function loadCharacterNickname() {
    try {
        return chat_metadata?.[META_KEY_NICKNAME] || '';
    } catch {
        return '';
    }
}

// Empty/whitespace nickname clears the stored value.
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

// Use this anywhere the user reads the name; use getCharacterInfo().name for
// prompts / cross-platform calls.
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
 *   special?: string,        // e.g. 'voice', 'transfer', 'image', 'share', 'retract'
 *   replyTo?: {              // present when this message quotes another one
 *       role: 'user' | 'char',
 *       snippet: string,     // frozen text snapshot, <= 60 code points
 *   },
 *   favoritedByUser?: boolean, // user long-pressed → 收藏
 *   favoritedByChar?: boolean, // LLM returned favorites: [...] pointing at this user msg
 *   favoritedAt?: string,    // ISO timestamp of last toggle (kept on untoggle; debug only)
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
            // allowStale lets a same-chat race window (invalidate fired but
            // prewarm not yet finished) serve the last successful snapshot
            // instead of throwing — without this, the UI would paint an
            // empty conversation during the gap and the user would think
            // their messages were wiped. Fresh data lands the moment prewarm
            // completes; stale data is read-only (saveHistory has its own
            // _currentKey guard and is never tricked into writing it back).
            return chatHistoryStore.loadHistory({ allowStale: true });
        } catch (e) {
            // Cache truly empty (no prior prewarm ever succeeded for ANY
            // key, e.g. plugin just loaded and CHAT_CHANGED hasn't fired).
            // Fall through to chat_metadata — once migration succeeds the
            // legacy key is deleted, so for already-migrated chats this
            // safely returns []. Pre-migration chats still find their data.
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
 * Returns the stored length so the caller can derive a correct msgIndex.
 * History is never trimmed, so this currently equals messages.length, but
 * the return-shape is preserved so future re-introductions of a cap (e.g.
 * via a user setting) would not require call-site changes.
 *
 * @returns {number} stored length (0 if chat_metadata missing)
 */
export function commitHistoryInMemory(messages) {
    if (_useExternalStorage()) {
        return chatHistoryStore.commitInMemory(messages);
    }
    if (!chat_metadata) return 0;
    const snapshot = messages.slice();
    chat_metadata[META_KEY_HISTORY] = snapshot;
    return snapshot.length;
}

/**
 * Save chat history to chat_metadata (persisted in .jsonl chat file).
 * No message-count cap — full history is written as-is.
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
            // Self-heal a prewarm race: if ST dispatched CHAT_CHANGED while
            // an LLM call was in flight, handleChatChanged() may have called
            // invalidate() but not yet finished _ensureSelfManagedFile /
            // prewarm. The cache state is then (_currentKey=null,
            // _cacheReady=false, _pendingPrewarm=null) — ensureReady() is a
            // no-op against that state, so saveHistory throws "no active key".
            // Re-running handleChatChanged is idempotent (it always invalidates
            // first then rebuilds), so we can safely re-prime the cache here
            // and retry the save once.
            const racey = /no active key|cache not ready/i.test(e?.message || '');
            if (racey) {
                console.warn(`${CHAT_LOG_PREFIX} prewarm race detected during save; re-running handleChatChanged + retry...`);
                try {
                    await handleChatChanged();
                    await chatHistoryStore.saveHistory(messages);
                    console.log(`${CHAT_LOG_PREFIX} ✅ save retry succeeded after handleChatChanged`);
                    return;
                } catch (retryErr) {
                    console.error(`${CHAT_LOG_PREFIX} retry also failed (NOT falling back):`, retryErr);
                    throw retryErr;
                }
            }
            // Non-race failure: do NOT fall back to chat_metadata. Falling
            // back would split data between two backends and the next prewarm
            // would overwrite the file with the stale cached state. Better
            // to surface the failure to the caller (chatMessageHandler etc.)
            // and let it decide whether to toast / retry.
            console.error(`${CHAT_LOG_PREFIX} chatHistoryStore save failed (NOT falling back):`, e);
            throw e;
        }
    }
    const snapshot = messages.slice();
    try {
        if (!chat_metadata) return;
        chat_metadata[META_KEY_HISTORY] = snapshot;
        await queueSaveChat();
    } catch (e) {
        console.warn(`${CHAT_LOG_PREFIX} chat_metadata 保存失败:`, e);
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Pending Result Persistence (survives page refresh)
// ═══════════════════════════════════════════════════════════════════════

// Async + immediate save: the whole point of this helper is "survive refresh",
// so we cannot tolerate a debounce that might be canceled before flush.
export async function persistPendingResult(result) {
    try {
        if (!chat_metadata) return;
        chat_metadata[META_KEY_PENDING_RESULT] = result || null;
        await queueSaveChat();
    } catch (e) {
        console.warn(`${CHAT_LOG_PREFIX} Pending result persistence failed:`, e);
    }
}

export function loadPersistedPendingResult() {
    try {
        return chat_metadata?.[META_KEY_PENDING_RESULT] || null;
    } catch {
        return null;
    }
}

// Fire-and-forget: a missed clear is harmless — the stale entry on disk will
// just be re-consumed on next load. Sync so the synchronous
// consumePendingResult() caller doesn't need to thread async through.
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

export function loadSTSyncMarker() {
    try {
        return chat_metadata?.[META_KEY_ST_SYNC_MARKER] || '';
    } catch {
        return '';
    }
}

// Immediate save: a dropped marker would cause auto-summarize to re-absorb
// already-summarized ST history on the next round, ballooning the prompt.
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

export async function clearSTSyncMarker() {
    await saveSTSyncMarker('');
}

// Messages with timestamp <= marker have already been "sent home" and must
// not be re-sent on subsequent 回家.
export function loadHomeMarker() {
    try {
        return chat_metadata?.[META_KEY_HOME_MARKER] || '';
    } catch {
        return '';
    }
}

// Immediate save: a dropped marker would resend the entire phone transcript
// on the next 回家, which is very visible to the user.
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

export async function clearHomeMarker() {
    await saveHomeMarker('');
}

// ISO timestamps compare lexicographically (sort chronologically). Messages
// without a timestamp can't be ordered against the marker, so once a marker
// exists we conservatively SKIP them — otherwise they'd be re-sent on every
// 回家 forever.
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

export async function clearChatHistory() {
    await saveChatHistory([]);
    await saveChatSummary('');       // also clear rolling summary so no stale context lingers
    await clearSTSyncMarker();       // reset ST sync progress; next injection re-absorbs main chat
    await clearHomeMarker();         // reset home progress; next 回家 starts fresh
}

export async function deleteMessageByIndex(index) {
    const history = loadChatHistory();
    if (index < 0 || index >= history.length) return false;
    history.splice(index, 1);
    await saveChatHistory(history);
    return true;
}

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

// Format a Date as 24h HH:MM, optionally prefixed with M月D日 when the chat
// spans midnight so the model can still tell start vs end apart.
function formatChatTime(date, includeDate = false) {
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    const timeStr = `${hh}:${mm}`;
    if (!includeDate) return timeStr;
    return `${date.getMonth() + 1}月${date.getDate()}日 ${timeStr}`;
}

// Pull the in-story timespan covered by a phone chat history slice, so the
// ST sync prompt can explicitly tell the main story how much offline time
// has advanced. Returns { hasTime: false } when no usable timestamps exist.
function extractChatTimespan(history) {
    if (!Array.isArray(history) || history.length === 0) return { hasTime: false };

    let firstTs = null;
    let lastTs = null;
    for (const msg of history) {
        if (msg?.timestamp) {
            if (firstTs === null) firstTs = msg.timestamp;
            lastTs = msg.timestamp;
        }
    }
    if (firstTs === null || lastTs === null) return { hasTime: false };

    const startDate = new Date(firstTs);
    const endDate = new Date(lastTs);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) return { hasTime: false };

    const crossDay = startDate.toDateString() !== endDate.toDateString();
    const startStr = formatChatTime(startDate, crossDay);
    const endStr = formatChatTime(endDate, crossDay);

    const diffMs = endDate.getTime() - startDate.getTime();
    const totalMinutes = Math.max(0, Math.round(diffMs / 60000));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    let durationStr;
    if (totalMinutes < 1) durationStr = '不到 1 分钟';
    else if (hours === 0) durationStr = `${minutes} 分钟`;
    else if (minutes === 0) durationStr = `${hours} 小时`;
    else durationStr = `${hours} 小时 ${minutes} 分钟`;

    return { hasTime: true, startStr, endStr, durationStr };
}

// Render the "scene clock has advanced" block. Without this, the main story
// model defaults to continuing at the last ST timestamp it remembers (e.g.
// staying at "morning 8AM" after an 8-hour phone interlude).
function buildTimeAdvanceBlock(timespan, userName, charName) {
    if (!timespan.hasTime) return '';
    return `【线下场景时间推进】
- ${userName}和${charName}的手机聊天发生在线下互动暂停期间
- 时间已从 ${timespan.startStr} 推进到 ${timespan.endStr}（持续约 ${timespan.durationStr}）
- 手机聊天里的时间戳标示的就是线下场景同步推进的时间，不是另一个时空
- 线下场景现在从 ${timespan.endStr} 继续，不要把时间倒回到手机聊天开始之前

`;
}

// Wraps the summary in 恶灵QR tags and injects the "scene time has advanced"
// block when the history slice carries usable timestamps.
function buildSyncMessage(summary, history) {
    const charName = getCharacterInfo()?.name || '角色';
    const userName = getUserName();
    const timespan = extractChatTimespan(history);

    if (timespan.hasTime) {
        return `<恶灵QR>[手机聊天记录同步]
${buildTimeAdvanceBlock(timespan, userName, charName)}以下是这段时间的完整手机聊天内容总结：

${summary}

请${charName}基于当前已推进到 ${timespan.endStr} 的时间，自然地继续线下互动。可以提到手机里聊过的话题，但不要机械地复述。</恶灵QR>`;
    }

    return `<恶灵QR>[手机聊天记录同步]
在异地状态时，${userName}和${charName}进行了一些聊天。以下是完整的手机聊天内容总结：

${summary}

${userName}现在已经和${charName}结束了异地。请${charName}根据手机聊天的内容和当前的情境，自然地继续线下互动。可以提到手机里聊过的话题，但不要机械地复述。</恶灵QR>`;
}

// Replaces the old invisible setExtensionPrompt injection — the summary now
// goes through ST's regular send path so it shows up in the chat log.
export async function sendSummaryAsUserMessage(summary, history) {
    try {
        const messageText = buildSyncMessage(summary, history);

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

// Used by the "原文灌入" return-home mode (raw transcript instead of summary).
// priorSummary covers earlier rolling-summarized messages whose raw content is
// no longer in `history` (auto-summarize folded them out). When non-empty it
// gets prefixed to the transcript so ST main chat still sees the entire 回家
// span — without this, raw-mode loses the same chunk that summary-mode would.
export async function sendRawTranscriptAsUserMessage(history, priorSummary = '') {
    const charName = getCharacterInfo()?.name || '角色';
    const userName = getUserName();
    const timespan = extractChatTimespan(history);

    const transcript = history.map(msg => {
        const role = msg.role === 'user' ? userName : charName;
        const timeStr = msg.timestamp ? formatChatTime(new Date(msg.timestamp), false) : '';
        return timeStr ? `[${timeStr}] ${role}: ${msg.content}` : `${role}: ${msg.content}`;
    }).join('\n');

    const hasPrior = typeof priorSummary === 'string' && priorSummary.trim().length > 0;
    const introLine = hasPrior
        ? '以下是这段时间的手机聊天记录（早期对话已被压缩为总结，最新对话保留原文）：'
        : '以下是这段时间的完整手机聊天记录原文：';
    const recordBody = hasPrior
        ? `【更早些时候已被压缩的对话（仅总结形式）】\n${priorSummary}\n\n【尚未压缩的对话原文】\n${transcript}`
        : transcript;

    const messageText = timespan.hasTime
        ? `<恶灵QR>[手机聊天记录同步 — 原文]
${buildTimeAdvanceBlock(timespan, userName, charName)}${introLine}

${recordBody}

请${charName}基于当前已推进到 ${timespan.endStr} 的时间，自然地继续线下互动。可以提到手机里聊过的话题，但不要机械地复述。</恶灵QR>`
        : `<恶灵QR>[手机聊天记录同步 — 原文]
在异地状态时，${userName}和${charName}进行了一些聊天。${introLine}

${recordBody}

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

export function loadChatSummary() {
    try {
        return chat_metadata?.[META_KEY_SUMMARY] || '';
    } catch {
        return '';
    }
}

// Immediate save: the rolling summary represents 40k+ tokens of folded
// history; losing it forces re-summarization on the next round.
export async function saveChatSummary(summaryText) {
    try {
        if (!chat_metadata) return;
        chat_metadata[META_KEY_SUMMARY] = summaryText;
        await queueSaveChat();
    } catch (e) {
        console.warn(`${CHAT_LOG_PREFIX} chat_metadata summary save failed:`, e);
    }
}

// Entries are stored in chronological order — oldest first, newest at tail.
export function loadChatSummaryHistory() {
    try {
        const arr = chat_metadata?.[META_KEY_SUMMARY_HISTORY];
        return Array.isArray(arr) ? arr : [];
    } catch {
        return [];
    }
}

// Called by maybeAutoSummarize (source='auto') and by the 查看总结 edit page
// (source='manual') before the live summary is overwritten. Empty/whitespace
// summaries are silently skipped so we don't pollute history with placeholders.
export async function pushChatSummaryHistory(entry) {
    try {
        if (!chat_metadata) return;
        const text = (entry?.summary || '').trim();
        if (!text) return; // never archive an empty/placeholder summary

        const history = loadChatSummaryHistory();
        history.push({
            savedAt: new Date().toISOString(),
            summary: text,
            source: entry.source === 'manual' ? 'manual' : 'auto',
            ...(typeof entry.msgCount === 'number' ? { msgCount: entry.msgCount } : {}),
        });
        chat_metadata[META_KEY_SUMMARY_HISTORY] = history;
        await queueSaveChat();
    } catch (e) {
        console.warn(`${CHAT_LOG_PREFIX} chat_metadata summary history push failed:`, e);
    }
}

/**
 * Strip the `.summarized = true` marker from every message in the active
 * history. Recovery path for the earlier auto-summarize bug where messages got
 * marked as summarized even though the LLM returned an empty summary —
 * those messages then disappeared from prompts without their content being
 * captured anywhere, permanently losing context. Calling this re-exposes them
 * to the next prompt build; the next auto-summarize cycle will then re-fold
 * them properly.
 *
 * @returns {Promise<number>} count of messages whose marker was removed
 */
export async function clearAllSummarizedMarks() {
    if (_useExternalStorage()) {
        try {
            await chatHistoryStore.ensureReady();
            let count = 0;
            await chatHistoryStore.mutateInPlace((live) => {
                if (!Array.isArray(live)) return;
                for (const msg of live) {
                    if (msg.summarized) {
                        delete msg.summarized;
                        count++;
                    }
                }
            });
            console.log(`${CHAT_LOG_PREFIX} 清除了 ${count} 条消息的 summarized 标记 (external storage)`);
            return count;
        } catch (e) {
            console.warn(`${CHAT_LOG_PREFIX} clearAllSummarizedMarks (external) failed:`, e);
            return 0;
        }
    }
    try {
        if (!chat_metadata) return 0;
        const live = chat_metadata[META_KEY_HISTORY];
        if (!Array.isArray(live) || live.length === 0) return 0;
        let count = 0;
        for (const msg of live) {
            if (msg.summarized) {
                delete msg.summarized;
                count++;
            }
        }
        if (count > 0) await queueSaveChat();
        console.log(`${CHAT_LOG_PREFIX} 清除了 ${count} 条消息的 summarized 标记 (chat_metadata)`);
        return count;
    } catch (e) {
        console.warn(`${CHAT_LOG_PREFIX} clearAllSummarizedMarks failed:`, e);
        return 0;
    }
}

/**
 * Mark the oldest N currently-unsummarized messages as summarized. Used by
 * the manual-hide UI to fold off a prefix of in-prompt history without running
 * an LLM summarize cycle — the bubbles stay visible in the chat list but stop
 * appearing in the prompt <chat_history> block.
 *
 * Walks the live array in order and counts only the messages that are NOT
 * already summarized, so the wall already-folded prefix is skipped. Returns
 * the count actually marked (may be less than n if there were fewer
 * unsummarized messages available).
 *
 * @param {number} n
 * @returns {Promise<number>}
 */
export async function markOldestNAsSummarized(n) {
    if (!Number.isFinite(n) || n <= 0) return 0;
    const target = Math.floor(n);

    const apply = (live) => {
        if (!Array.isArray(live)) return 0;
        let count = 0;
        for (let i = 0; i < live.length && count < target; i++) {
            const msg = live[i];
            if (msg && !msg.summarized) {
                msg.summarized = true;
                count++;
            }
        }
        return count;
    };

    if (_useExternalStorage()) {
        try {
            await chatHistoryStore.ensureReady();
            let count = 0;
            await chatHistoryStore.mutateInPlace((live) => {
                count = apply(live);
            });
            console.log(`${CHAT_LOG_PREFIX} markOldestNAsSummarized(${target}): marked ${count} (external storage)`);
            return count;
        } catch (e) {
            console.warn(`${CHAT_LOG_PREFIX} markOldestNAsSummarized (external) failed:`, e);
            return 0;
        }
    }
    try {
        if (!chat_metadata) return 0;
        const live = chat_metadata[META_KEY_HISTORY];
        if (!Array.isArray(live) || live.length === 0) return 0;
        const count = apply(live);
        if (count > 0) await queueSaveChat();
        console.log(`${CHAT_LOG_PREFIX} markOldestNAsSummarized(${target}): marked ${count} (chat_metadata)`);
        return count;
    } catch (e) {
        console.warn(`${CHAT_LOG_PREFIX} markOldestNAsSummarized failed:`, e);
        return 0;
    }
}

// Indices reference the on-disk chronological order (oldest-first).
// Out-of-range / duplicate indices are tolerated and skipped.
export async function removeChatSummaryHistoryByIndices(indices) {
    try {
        if (!chat_metadata) return 0;
        if (!Array.isArray(indices) || indices.length === 0) return 0;
        const history = loadChatSummaryHistory();
        if (history.length === 0) return 0;
        // Splice from the tail so earlier indices stay valid.
        const sorted = [...new Set(indices)].sort((a, b) => b - a);
        let removed = 0;
        for (const idx of sorted) {
            if (Number.isInteger(idx) && idx >= 0 && idx < history.length) {
                history.splice(idx, 1);
                removed++;
            }
        }
        if (removed === 0) return 0;
        chat_metadata[META_KEY_SUMMARY_HISTORY] = history;
        await queueSaveChat();
        return removed;
    } catch (e) {
        console.warn(`${CHAT_LOG_PREFIX} chat_metadata summary history remove failed:`, e);
        return 0;
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Auto-Summarize Logic
// ═══════════════════════════════════════════════════════════════════════

// Aborts via AbortController once the timer fires; the race rejects so the
// caller's finally can release any in-flight guards (e.g. _isSummarizing) even
// when the underlying network call would otherwise hang forever.
// Caller must NOT pass `signal` in opts — we own it.
export async function callPhoneLLMWithTimeout(systemPrompt, userPrompt, opts = {}, timeoutMs = SUMMARIZE_LLM_TIMEOUT_MS) {
    const ctrl = new AbortController();
    let timer;
    const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(() => {
            ctrl.abort();
            reject(new Error(`LLM 调用超时（${Math.round(timeoutMs / 1000)}s）`));
        }, timeoutMs);
    });
    try {
        return await Promise.race([
            callPhoneLLM(systemPrompt, userPrompt, { ...opts, signal: ctrl.signal }),
            timeoutPromise,
        ]);
    } finally {
        clearTimeout(timer);
    }
}

// ─── Summary transcript formatting ───
// Shared by maybeAutoSummarize and handleManualSummarize so both feed the LLM
// the same shape (full date + time prefix per line). Without an absolute date
// the model can only describe events as "第一日 / 第二日"; with [YYYY-MM-DD HH:MM]
// it can write "2026-06-03 14:30 双方约定..."  See chatPromptBuilder's rolling
// summarize prompt for the wording requirement.
export function formatTranscriptLine(role, msg) {
    const ts = msg?.timestamp;
    if (!ts) return `${role}: ${msg?.content || ''}`;
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return `${role}: ${msg?.content || ''}`;
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `[${yyyy}-${mm}-${dd} ${hh}:${mi}] ${role}: ${msg.content || ''}`;
}

let _isSummarizing = false; // Guard against concurrent auto runs

// Set/cleared by chatInventory.handleManualSummarize so the auto path can
// skip while a manual run is in flight. We don't reuse _isSummarizing because
// the watchdog and progress-card lifecycle in maybeAutoSummarize would
// conflict with the manual path's own try/finally.
let _isManualSummarizing = false;
export function setManualSummarizingFlag(value) {
    _isManualSummarizing = !!value;
}
/** Returns true if either auto or manual summarize is currently running. */
export function isAnySummarizing() {
    return _isSummarizing || _isManualSummarizing;
}

// Watchdog: if _isSummarizing was set true but the call site failed to clear
// it (uncaught throw outside the try/finally, page navigation while await is
// pending, etc.), reset after a generous window so the next send isn't
// permanently short-circuited. Pure safety net — the in-call timeout above
// is the primary mechanism.
//
// Budget accounts for the worst case: step 1 (generateSummary — bounded by
// summarizer.js's own internal timeouts) + step 2 (callPhoneLLMWithTimeout,
// SUMMARIZE_LLM_TIMEOUT_MS) + step 3 disk writes + retry backoffs inside
// callPhoneLLM. Formula `timeout * 2 + 60s` keeps the watchdog proportional
// without ballooning: at 300s timeout this gives 11min, plenty of headroom
// over the LLM call itself but short enough that a real hang clears the
// _isSummarizing flag before the user gives up and refreshes.
const SUMMARIZE_FLAG_WATCHDOG_MS = SUMMARIZE_LLM_TIMEOUT_MS * 2 + 60_000;
let _summarizeWatchdog = null;
function _armSummarizeWatchdog() {
    if (_summarizeWatchdog) clearTimeout(_summarizeWatchdog);
    _summarizeWatchdog = setTimeout(() => {
        if (_isSummarizing) {
            console.warn(`${CHAT_LOG_PREFIX} ⚠️ summarize watchdog firing — _isSummarizing stuck true, forcing reset`);
            _isSummarizing = false;
            // If a progress card is still showing, the LLM never returned and
            // the try/finally never ran. Tell the user the operation gave up
            // so the card doesn't spin forever.
            const orphanCard = getCurrentProgressCard();
            if (orphanCard) orphanCard.fail('压缩超时，已放弃本轮');
        }
        _summarizeWatchdog = null;
    }, SUMMARIZE_FLAG_WATCHDOG_MS);
}
function _disarmSummarizeWatchdog() {
    if (_summarizeWatchdog) {
        clearTimeout(_summarizeWatchdog);
        _summarizeWatchdog = null;
    }
}

// Called after every saveChatHistory in sendAllMessages. Runs asynchronously —
// does NOT block the chat UI.
export async function maybeAutoSummarize() {
    if (_isSummarizing) {
        console.log(`${CHAT_LOG_PREFIX} 自动总结已在运行中，跳过`);
        return;
    }
    if (_isManualSummarizing) {
        console.log(`${CHAT_LOG_PREFIX} 手动总结正在运行中，自动跳过本轮`);
        return;
    }

    const history = loadChatHistory();
    const unsummarized = history.filter(m => !m.summarized);
    const summarizedCount = history.length - unsummarized.length;

    // ── Cheap pre-filter ──
    // KEEP_RECENT acts as the floor regardless of prompt size: if there are
    // fewer than (KEEP_RECENT + 1) unsummarized messages, even a successful
    // summarize would have nothing to fold. Skip the expensive estimate.
    if (unsummarized.length <= KEEP_RECENT) {
        console.log(
            `${CHAT_LOG_PREFIX} 自动总结诊断: history=${history.length} ` +
            `(已总结 ${summarizedCount} / 未总结 ${unsummarized.length}), ` +
            `unsummarized ≤ KEEP_RECENT=${KEEP_RECENT}，本轮跳过（无可折叠片段）`
        );
        return;
    }

    // ── Real prompt-token estimate ──
    // Reuse the same dry-run path chatStats' "总 Token 数" uses so the trigger
    // matches what the user sees. silent:true skips Console pushPromptLog +
    // community-context cooldown but keeps WorldInfo / moments / time context
    // active so the count tracks reality.
    let promptTokens = 0;
    try {
        const { buildChatSystemPrompt, buildChatUserPrompt } = await import('./chatPromptBuilder.js');
        const { countTokensFromPromptData } = await import('../../core.js');
        const systemPrompt = await buildChatSystemPrompt({ silent: true });
        const userPrompt = buildChatUserPrompt([], history, undefined, false, null, { silent: true });
        promptTokens = countTokensFromPromptData(`${systemPrompt}\n${userPrompt}`);
    } catch (e) {
        console.warn(`${CHAT_LOG_PREFIX} 自动总结估算 prompt token 失败:`, e);
        return;
    }

    console.log(
        `${CHAT_LOG_PREFIX} 自动总结诊断: history=${history.length} ` +
        `(已总结 ${summarizedCount} / 未总结 ${unsummarized.length}), ` +
        `prompt≈${promptTokens} tokens, 阈值=${SUMMARIZE_PROMPT_TOKEN_THRESHOLD}, KEEP_RECENT=${KEEP_RECENT}`
    );

    if (promptTokens < SUMMARIZE_PROMPT_TOKEN_THRESHOLD) {
        console.log(`${CHAT_LOG_PREFIX} 未达阈值（${promptTokens} < ${SUMMARIZE_PROMPT_TOKEN_THRESHOLD}），不触发`);
        return;
    }

    _isSummarizing = true;
    _armSummarizeWatchdog();
    console.log(`${CHAT_LOG_PREFIX} 📝 触发自动总结: ${unsummarized.length} 条未总结消息, prompt≈${promptTokens} tokens (阈值 ${SUMMARIZE_PROMPT_TOKEN_THRESHOLD})`);

    const card = openProgressCard({ title: '后台压缩聊天记忆' });

    try {
        // ─── Determine slice to summarize ───
        // Take the oldest unsummarized chunk, capped both ways:
        //   - leave KEEP_RECENT newest untouched (so the model still has the
        //     immediate context in raw form)
        //   - never send more than MAX_MESSAGES_PER_SUMMARIZE in a single
        //     LLM call (an unbounded slice can easily exceed the context
        //     window and return empty — see MAX_MESSAGES_PER_SUMMARIZE comment)
        const eligibleCount = unsummarized.length - KEEP_RECENT;
        if (eligibleCount <= 0) {
            console.log(
                `${CHAT_LOG_PREFIX} 阈值过了但 unsummarized=${unsummarized.length} ≤ ` +
                `KEEP_RECENT=${KEEP_RECENT}，无可折叠片段，本轮跳过`
            );
            card.close();
            return;
        }
        const toSummarizeCount = Math.min(eligibleCount, MAX_MESSAGES_PER_SUMMARIZE);
        if (toSummarizeCount < eligibleCount) {
            console.log(
                `${CHAT_LOG_PREFIX} ⚠️ 本轮折叠 ${toSummarizeCount} 条（上限 ` +
                `${MAX_MESSAGES_PER_SUMMARIZE}），剩余 ${eligibleCount - toSummarizeCount} ` +
                `条留待下一轮自动总结处理`
            );
        }

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
            card.setStage('正在整理重要片段 …');

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
                // generateSummary returns { entries, timelineSegments }, not a bare array.
                // summarizer.js handles its own timeouts internally — per-chunk
                // (80s), big-summary (180s), unified (240s) — and each chunk gets
                // independent timing so one slow chunk doesn't fail the rest.
                // No outer wrapper here: it would just race the inner deadlines
                // and abort prematurely on long transcripts.
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
        //
        // CRITICAL: Step 3 (marking messages summarized) MUST be gated on
        // step 2 actually landing the new summary on disk. An earlier version
        // used a try/catch around step 2 and unconditionally ran step 3 —
        // when the LLM returned a falsy/empty response the `if (newSummary…)`
        // block was silently skipped, summary stayed stale, and step 3 still
        // marked the messages as `.summarized = true`. Those messages then
        // disappeared from future prompts WITHOUT being represented in the
        // summary, permanently losing the chunk of context. Now: empty LLM
        // output → throw → bail out before any marking happens. Step 3 lives
        // strictly downstream of a confirmed successful summary write.
        card.setStage('鬼面正在奋笔疾书 …');
        const existingSummary = loadChatSummary();
        let newSummaryText = null;
        let stIncrementSnapshot = [];
        try {
            const transcript = messagesToSummarize.map(msg => {
                const role = msg.role === 'user' ? userName : charName;
                return formatTranscriptLine(role, msg);
            }).join('\n');

            // Snapshot ST increment BEFORE the LLM call. Any ST messages that
            // arrive during the call will be picked up next round (marker only
            // advances to this snapshot's tail, not to "current end of chat").
            stIncrementSnapshot = getSTChatHistory({ sinceMarker: true, tokenLimit: ST_HISTORY_TOKEN_LIMIT });
            const stTranscript = stIncrementSnapshot.length > 0
                ? stIncrementSnapshot.map(m => formatTranscriptLine(m.role === 'user' ? userName : charName, { content: m.content, timestamp: m.send_date })).join('\n')
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

            const newSummary = await callPhoneLLMWithTimeout(
                summarySystemPrompt,
                summaryUserPrompt,
                { maxTokens: 2000 },
            );

            if (!newSummary || !newSummary.trim()) {
                // Promote falsy/empty to a real throw so the outer catch path
                // runs the "leave messages unmarked" branch — see the comment
                // above this block for why this is load-bearing.
                throw new Error('LLM 返回空总结，未写入新版本');
            }
            newSummaryText = newSummary.trim();
        } catch (e) {
            console.error(`${CHAT_LOG_PREFIX} ❌ 滚动总结生成失败，保留旧总结，跳过消息标记:`, e);
            card.fail('记录压缩失败：保留原状');
            return; // bail out before step 3 — finally still runs (_isSummarizing reset)
        }

        // ─── Step 3 (only on confirmed Step 2 success) ───
        // Archive the old summary, persist the new one, advance the ST sync
        // marker, then mark the folded messages as summarized. Each await is
        // ordered so an interruption mid-sequence leaves at most one of these
        // unwritten — never a state where messages are marked but the summary
        // is stale.
        card.setStage('收尾归档 …');
        await pushChatSummaryHistory({
            summary: existingSummary,
            source: 'auto',
            msgCount: messagesToSummarize.length,
        });
        await saveChatSummary(newSummaryText);

        let newMarker = '';
        for (let i = stIncrementSnapshot.length - 1; i >= 0; i--) {
            if (stIncrementSnapshot[i].send_date) { newMarker = stIncrementSnapshot[i].send_date; break; }
        }
        if (newMarker) await saveSTSyncMarker(newMarker);

        console.log(`${CHAT_LOG_PREFIX} ✅ 滚动总结已更新 (${newSummaryText.length} 字), ST marker → ${newMarker || '(unchanged)'}`);

        // Re-load the live history and match by identity stamp (not index) to
        // safely handle messages added during the async LLM call above.
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
        card.complete('压缩完成');

    } catch (error) {
        console.error(`${CHAT_LOG_PREFIX} ❌ 自动总结流程失败:`, error);
        card.fail('压缩失败');
    } finally {
        _isSummarizing = false;
        _disarmSummarizeWatchdog();
        // No explicit card.close() here: complete/fail already schedule their
        // own delayed close so the terminal state has time to read. The early
        // "nothing to fold" short-circuit closes the card before its return.
    }
}

// ═══════════════════════════════════════════════════════════════════════
// External Storage (chatHistoryStore backed by /user/files/)
// ═══════════════════════════════════════════════════════════════════════
// Source of truth for "is this chat migrated" is the self-managed file's
// existence on disk (probed by _ensureSelfManagedFile). We never write a
// per-chat marker into chat_metadata — doing so forced a queueSaveChat()
// during every migrate, which could race with ST's chat load and blank
// the .jsonl (事故 B).
//
// LEGACY cleanup (deleting chat_metadata.gf_phoneChatHistory and triggering
// queueSaveChat) is decoupled from the migrate-write step and gated on
// ST's chat array being populated — if it's empty, we defer cleanup to the
// next CHAT_CHANGED rather than risk overwriting the .jsonl with [].

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

// Gate before any queueSaveChat() we trigger: saveChat() unconditionally
// writes `chat.slice()`, so calling it when chat is [] blanks the .jsonl
// (事故 B). When this returns false we defer chat_metadata cleanup to the
// next CHAT_CHANGED.
function _isSTChatReady() {
    try {
        const ctx = getContext();
        return Array.isArray(ctx?.chat) && ctx.chat.length > 0;
    } catch {
        return false;
    }
}

// Only flushes if ST's chat array is populated — otherwise queueSaveChat
// would write an empty chat slice to disk. Idempotent.
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

// Always invalidates the cache (key changed). If external storage is on, also
// ensures the self-managed file exists (creating/migrating from LEGACY as
// needed) and prewarms the cache. Failure is logged but never propagated —
// the user must not see the chat app crash because of a storage hiccup.
export async function handleChatChanged() {
    if (!_useExternalStorage()) {
        // Backend disabled — force-clear cache; legacy chat_metadata is the
        // truth and the in-memory cache is irrelevant.
        chatHistoryStore.invalidate();
        return;
    }

    const { chatId, charId } = _getCurrentKey();

    // Compute the incoming hash BEFORE invalidating so we can ask the cache
    // to be preserved when it already corresponds to the same key — that's
    // the path a refresh / same-chat reload takes, and preserving the cache
    // lets loadHistory({ allowStale }) keep the UI populated while prewarm
    // races to complete.
    let preservedHash = null;
    try {
        preservedHash = await chatHistoryStore.computeKeyHash(chatId, charId);
    } catch (e) {
        console.warn(`${CHAT_LOG_PREFIX} computeKeyHash failed; cache will be cleared:`, e.message);
    }
    chatHistoryStore.invalidate({ preservedHash });

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

// Driven purely by ST events — we never trigger handleChatChanged() ourselves,
// because doing so during plugin init (when ST's chat array may not be filled
// yet) would let the downstream queueSaveChat() rewrite the .jsonl with an
// empty chat. ST's own CHAT_CHANGED emit happens at the end of getChatResult,
// by which point chat is guaranteed populated.
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

// Used by the chat-app open path (and other read-then-render entry points)
// to ensure prewarm has completed before calling loadChatHistory(). Without
// this gate, the page-reload race — CHAT_CHANGED fires async, prewarm awaits
// readJSON over a slow remote — can leave the cache empty when the UI renders,
// painting an empty conversation that allowStale cannot save (fresh reload
// starts with _cacheKey = null).
//
// Cheap no-op when the cache is already ready, and a full no-op for the
// chat_metadata backend. Failure is swallowed and logged — "best effort,
// caller still gets to render with whatever the cache currently holds".
export async function ensureChatHistoryReady() {
    if (!_useExternalStorage()) return;
    try {
        await chatHistoryStore.ensureReady();
        if (chatHistoryStore.debugInfo().cacheReady) return;
        // No in-flight prewarm and cache still empty: drive one ourselves.
        // handleChatChanged is idempotent against the current key.
        await handleChatChanged();
    } catch (e) {
        console.warn(`${CHAT_LOG_PREFIX} ensureChatHistoryReady failed (rendering anyway):`, e.message);
    }
}

// Escape hatch — "彻底回到 chat_metadata". Caller MUST also flip the
// useExternalChatStorage setting OFF (and refresh), otherwise the next
// CHAT_CHANGED will just recreate an empty self-managed file. We deliberately
// do NOT touch chat_metadata here: any queueSaveChat could race with ST chat
// load (事故 B).
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
