// modules/storage/chatHistoryStore.js — Phone chat history persistence backed
// by a self-managed file under /user/files/ (instead of chat_metadata).
//
// One file per (ST chat_id, char_id) combo. Filenames are flat + hex-hashed
// (Phase 0 spike: no subdirs, charset [a-zA-Z0-9_-] only).
//
// In-memory cache holds the active key's messages so loadHistory() can stay
// synchronous; writes go through atomicWriteJSON via an internal queue that
// is independent of ST's saveChatConditional serialization. await on a
// save MUST resolve only after disk ack — never relax this. See plan D5 +
// chatStorage.js:264-271 for the incident that motivated it.

import { atomicWriteJSON, readJSON, deleteFile, tmpNameFor } from './fileStore.js';
import { upsertEntry as upsertIndexEntry } from './chatIndexStore.js';

const LOG = '[ChatHistoryStore]';
const FILE_PREFIX = 'ghostface_chat_';
const FILE_EXT = '.json';

// No message-count cap. The 500-message limit inherited from the chat_metadata
// era existed only to protect ST's .jsonl autosave from bloat. Self-managed
// files live under /user/files/ and never touch the .jsonl, so the cap has no
// remaining justification and was silently dropping history users expected to
// keep. Summarize-for-prompt-context handles LLM token pressure separately.

// ═══════════════════════════════════════════════════════════════════════
// Internal state
// ═══════════════════════════════════════════════════════════════════════

// The active (chat_id, char_id) — only one is live at a time. Switching
// chats invalidates and re-prewarms; concurrent reads/writes against a stale
// key are detected via the _currentKey identity check inside async sections.
let _currentKey = null;       // { chatId, charId, hash, filename }
let _cache = [];              // shallow copy; truth is on disk
let _cacheReady = false;
let _pendingPrewarm = null;   // Promise<void> currently loading (for ensureReady)
let _writeQueue = Promise.resolve();

// Hash of whatever (chatId, charId) the current _cache belongs to. Tracked
// separately from _currentKey so that during a same-chat invalidate→prewarm
// cycle (e.g. ST refresh, page reload) the cache can be preserved as a
// stale-read fallback for loadHistory({ allowStale }) — keeping the UI from
// rendering "empty chat" while prewarm is still in flight. On a real chat
// switch the hash differs and _cache is cleared, so stale data from a
// previous character/chat cannot leak into the new view.
let _cacheKey = null;

// ═══════════════════════════════════════════════════════════════════════
// Key / filename helpers
// ═══════════════════════════════════════════════════════════════════════

async function _hashKey(chatId, charId) {
    const text = `${chatId ?? ''}:${charId ?? ''}`;
    const buf = new TextEncoder().encode(text);
    const hashBuf = await crypto.subtle.digest('SHA-1', buf);
    const hex = Array.from(new Uint8Array(hashBuf))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    return hex.slice(0, 16);
}

function _filenameFor(hash) {
    return `${FILE_PREFIX}${hash}${FILE_EXT}`;
}

/**
 * Compute the filename for a (chatId, charId) without touching state.
 * Useful for migration / debug code that wants to know "where would X go".
 * @returns {Promise<string>}
 */
export async function filenameForKey(chatId, charId) {
    const hash = await _hashKey(chatId, charId);
    return _filenameFor(hash);
}

/**
 * Synchronous filename construction from a known hash. The lookup index keeps
 * fileHash as its primary key, so search-path code already has the hash in
 * hand and only needs to map it back to a disk filename.
 *
 * @param {string} hash - 16-char hex hash matching the index key
 * @returns {string}
 */
export function filenameForHash(hash) {
    return _filenameFor(hash);
}

/**
 * Public wrapper over the internal hash function so the chat lifecycle
 * layer (handleChatChanged) can ask "what hash will this (chatId, charId)
 * map to?" before invalidating, in order to pass it as preservedHash and
 * keep the stale-read fallback alive across a same-key reload.
 *
 * @param {string} chatId
 * @param {string} charId
 * @returns {Promise<string>}
 */
export async function computeKeyHash(chatId, charId) {
    return _hashKey(chatId, charId);
}

// ═══════════════════════════════════════════════════════════════════════
// Prewarm / invalidate (chat switch lifecycle)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Load the cache for (chatId, charId) from disk. Idempotent for the same
 * key — returns immediately if cache is already ready for it. On a different
 * key, invalidates first then re-reads. Concurrent prewarms for different
 * keys are tolerated; only the most-recent-keyed result is kept.
 *
 * MUST be awaited before any synchronous loadHistory() / commitInMemory()
 * call against this key.
 *
 * @param {string} chatId
 * @param {string} charId
 * @returns {Promise<void>}
 */
export async function prewarm(chatId, charId) {
    const hash = await _hashKey(chatId, charId);
    if (_currentKey?.hash === hash && _cacheReady) return;

    const nextKey = { chatId, charId, hash, filename: _filenameFor(hash) };
    _currentKey = nextKey;
    _cacheReady = false;

    const work = (async () => {
        try {
            await _recoverOrphanTmp(nextKey.filename);
            const parsed = await readJSON(nextKey.filename);
            // Race check: if user already switched away during our await, drop result.
            if (_currentKey?.hash !== nextKey.hash) {
                console.log(`${LOG} prewarm for ${nextKey.filename} superseded — discarding`);
                return;
            }
            _cache = Array.isArray(parsed) ? parsed : [];
            _cacheReady = true;
            _cacheKey = nextKey.hash; // tag _cache with the key it belongs to
            console.log(`${LOG} prewarm ${nextKey.filename}: ${_cache.length} messages loaded`);

            // Side-effect: refresh the lookup index used by phone chat search.
            // Fire-and-forget so a slow/failed index write never blocks chat
            // load; loadIndex de-dupes a same-tuple upsert into a no-op.
            upsertIndexEntry(nextKey.hash, charId, chatId).catch(err => {
                console.warn(`${LOG} index upsert failed (non-fatal):`, err.message);
            });
        } catch (e) {
            console.warn(`${LOG} prewarm failed for ${nextKey.filename}; starting empty:`, e.message);
            if (_currentKey?.hash === nextKey.hash) {
                _cache = [];
                _cacheReady = true;
                _cacheKey = nextKey.hash;
            }
        }
    })();
    _pendingPrewarm = work;
    return work;
}

/**
 * Await any in-flight prewarm. Resolves immediately if cache is already ready
 * for the current key. Safe to call repeatedly.
 * @returns {Promise<void>}
 */
export async function ensureReady() {
    if (_cacheReady) return;
    if (_pendingPrewarm) await _pendingPrewarm;
}

/**
 * Drop the cache-ready flag; next prewarm() re-reads from disk.
 *
 * Pass `preservedHash` (the hash that the upcoming prewarm will use) to
 * KEEP the in-memory data when it matches `_cacheKey`. The data becomes
 * stale-but-non-empty, so loadHistory({ allowStale }) can serve it during
 * the race window between invalidate and the next successful prewarm.
 * Without this, a same-chat reload (refresh / ST CHAT_CHANGED echo on the
 * SAME chat) would briefly return [] from loadHistory and the UI would
 * paint an empty conversation — looking exactly like "all messages were
 * deleted" until the next prewarm finishes.
 *
 * Omit `preservedHash` (or pass a different hash) on a real chat switch:
 * keeping stale data from the previous (chatId, charId) would leak the
 * old chat's messages into the new chat's view.
 *
 * @param {{ preservedHash?: string }} [opts]
 */
export function invalidate({ preservedHash = null } = {}) {
    const keepCache = (preservedHash != null && _cacheKey != null && preservedHash === _cacheKey);
    _currentKey = null;
    _cacheReady = false;
    _pendingPrewarm = null;
    if (!keepCache) {
        _cache = [];
        _cacheKey = null;
    }
}

/**
 * Startup recovery for orphan tmp files left by a crashed atomicWriteJSON.
 * Logic:
 *   - No tmp: nothing to do
 *   - Tmp exists, real file missing: tmp is our best bet — promote it
 *   - Both exist: trust real (the previous write reached step 3); delete tmp
 *
 * @param {string} name - the real filename (without _tmp suffix)
 */
async function _recoverOrphanTmp(name) {
    try {
        const tmpName = tmpNameFor(name);
        const tmpContent = await readJSON(tmpName);
        if (tmpContent === null) return;
        const realContent = await readJSON(name);
        if (realContent === null) {
            console.warn(`${LOG} orphan tmp ${tmpName} with no real file — promoting`);
            await atomicWriteJSON(name, tmpContent);
            return;
        }
        await deleteFile(tmpName);
        console.log(`${LOG} cleaned orphan tmp ${tmpName} (real file intact)`);
    } catch (e) {
        console.warn(`${LOG} _recoverOrphanTmp failed (non-fatal):`, e.message);
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Read / Write API
// ═══════════════════════════════════════════════════════════════════════

/**
 * Return a shallow copy of the cached history.
 *
 * Default behavior: throws if cache is not ready, forcing the caller to
 * ensure prewarm has run.
 *
 * `allowStale: true`: if the cache is marked not-ready but still holds
 * data tagged with a _cacheKey (i.e. invalidate was called with a matching
 * preservedHash), return that stale snapshot instead of throwing. Reader-
 * side callers (UI render path) want this so a race-window read returns
 * the last-known-good messages rather than [], which the UI would paint
 * as "this chat was wiped".
 *
 * Writer-side callers (saveHistory in particular) MUST NOT pass allowStale:
 * writing back a stale slice could clobber messages that landed on disk
 * after the cache went stale.
 *
 * @param {{ allowStale?: boolean }} [opts]
 * @returns {Array}
 */
export function loadHistory({ allowStale = false } = {}) {
    if (_cacheReady) return _cache.slice();
    if (allowStale && _cacheKey != null) return _cache.slice();
    throw new Error('chatHistoryStore.loadHistory: cache not ready — call prewarm() first');
}

/**
 * Persist a new history snapshot to disk. No message-count cap — full history
 * is written as-is. Serialized through an internal queue independent of ST's
 * saveChatConditional.
 *
 * Await semantics: the returned Promise resolves only after disk ack, never
 * sooner. Callers in async hot paths (chatMessageHandler, sendAllMessages)
 * MUST await before triggering long-running follow-up work (e.g. LLM gen)
 * that could be interrupted by a refresh — same reason ST's saveChatConditional
 * is preferred over saveMetadataDebounced.
 *
 * @param {Array} messages
 * @returns {Promise<void>}
 */
export async function saveHistory(messages) {
    if (!_currentKey) {
        throw new Error('chatHistoryStore.saveHistory: no active key — call prewarm() first');
    }
    const snapshot = messages.slice();
    const keyAtCall = _currentKey;
    _cache = snapshot;

    const next = _writeQueue
        .catch(() => {}) // isolate prior failures from later tasks
        .then(async () => {
            // Even if the user switched chats after this save was queued, we
            // still want this write to go through against ITS original key
            // (snapshotted as keyAtCall) — those bytes ARE that file's truth.
            await atomicWriteJSON(keyAtCall.filename, snapshot);
        });
    _writeQueue = next;
    return next;
}

/**
 * Update the in-memory cache without flushing. Used by render hot-path where
 * the DOM needs new state immediately but the caller batches the durable
 * save at end-of-loop. Mirror of the ex-commitHistoryInMemory in chatStorage.
 *
 * @param {Array} messages
 */
export function commitInMemory(messages) {
    if (!_currentKey) return 0;
    _cache = messages.slice();
    return _cache.length;
}

/**
 * Apply an in-place mutator to the live cache and flush. Mutator must not
 * rebuild the array — only mutate items in place (msg.summarized = true,
 * msg.reactions.push(...), etc.). This is the only safe way to preserve
 * messages appended concurrently during the caller's await — replaceAll-style
 * mutation would overwrite a stale snapshot.
 *
 * @param {(liveArray: Array) => void | Promise<void>} mutator
 * @returns {Promise<void>}
 */
export async function mutateInPlace(mutator) {
    if (!_currentKey) {
        throw new Error('chatHistoryStore.mutateInPlace: no active key — call prewarm() first');
    }
    await mutator(_cache);
    await saveHistory(_cache);
}

/**
 * Empty the current key's history both in memory and on disk.
 * @returns {Promise<void>}
 */
export async function clearHistory() {
    if (!_currentKey) return;
    await saveHistory([]);
}

/**
 * Debug / "清理自管文件" support: inspect current internal state.
 */
export function debugInfo() {
    return {
        currentKey: _currentKey,
        cacheReady: _cacheReady,
        cacheLength: _cache.length,
    };
}
