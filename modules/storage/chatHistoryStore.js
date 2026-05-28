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

const LOG = '[ChatHistoryStore]';
const FILE_PREFIX = 'ghostface_chat_';
const FILE_EXT = '.json';
const MAX_HISTORY_MESSAGES = 500;

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
            console.log(`${LOG} prewarm ${nextKey.filename}: ${_cache.length} messages loaded`);
        } catch (e) {
            console.warn(`${LOG} prewarm failed for ${nextKey.filename}; starting empty:`, e.message);
            if (_currentKey?.hash === nextKey.hash) {
                _cache = [];
                _cacheReady = true;
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
 * Drop the cache; next prewarm() re-reads from disk. Call when (chat_id,
 * char_id) changes outside the prewarm flow.
 */
export function invalidate() {
    _currentKey = null;
    _cache = [];
    _cacheReady = false;
    _pendingPrewarm = null;
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
 * Return a shallow copy of the cached history. Throws if cache is not ready,
 * forcing the caller to ensure prewarm has run — preventing the
 * "empty array displayed but data exists on disk" race.
 *
 * @returns {Array}
 */
export function loadHistory() {
    if (!_cacheReady) {
        throw new Error('chatHistoryStore.loadHistory: cache not ready — call prewarm() first');
    }
    return _cache.slice();
}

/**
 * Persist a new history snapshot to disk. Trims to MAX_HISTORY_MESSAGES.
 * Serialized through an internal queue independent of ST's saveChatConditional.
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
    const trimmed = messages.slice(-MAX_HISTORY_MESSAGES);
    const keyAtCall = _currentKey;
    _cache = trimmed;

    const next = _writeQueue
        .catch(() => {}) // isolate prior failures from later tasks
        .then(async () => {
            // Even if the user switched chats after this save was queued, we
            // still want this write to go through against ITS original key
            // (snapshotted as keyAtCall) — those bytes ARE that file's truth.
            await atomicWriteJSON(keyAtCall.filename, trimmed);
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
    _cache = messages.slice(-MAX_HISTORY_MESSAGES);
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
