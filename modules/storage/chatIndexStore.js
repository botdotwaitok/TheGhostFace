// modules/storage/chatIndexStore.js — Minimal lookup index over the
// self-managed phone-chat files. Maps fileHash → { charId, chatId } so a
// search UI can enumerate "which files belong to character X" without a
// directory-listing endpoint (ST has none — see fileStore.js note).
//
// Index is populated ONLY by chatHistoryStore.prewarm() on a successful read.
// Write path (saveHistory) intentionally stays untouched so chat hot writes
// never wait on index I/O. Stale entries (file gone) are removed by search
// path self-healing in a later phase; clearHistory does NOT remove entries
// because the file is still present (cleared to []), just empty.

import { atomicWriteJSON, readJSON } from './fileStore.js';

const LOG = '[ChatIndex]';
const INDEX_FILE = 'ghostface_chat_index.json';

let _cache = null;
let _loadingPromise = null;
let _writeQueue = Promise.resolve();

async function _coldLoad() {
    try {
        const parsed = await readJSON(INDEX_FILE);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            _cache = parsed;
        } else {
            _cache = {};
        }
    } catch (e) {
        console.warn(`${LOG} index load failed, starting empty:`, e.message);
        _cache = {};
    }
    return _cache;
}

/**
 * Lazy-load (and cache) the entire index map. Returns a live reference —
 * callers must treat it as read-only. Concurrent calls share one in-flight
 * promise.
 *
 * @returns {Promise<Object<string, {charId:string, chatId:string}>>}
 */
export async function loadIndex() {
    if (_cache) return _cache;
    if (_loadingPromise) return _loadingPromise;
    _loadingPromise = _coldLoad().finally(() => { _loadingPromise = null; });
    return _loadingPromise;
}

function _enqueueWrite() {
    const next = _writeQueue
        .catch(() => {}) // isolate prior failures from later tasks
        .then(() => atomicWriteJSON(INDEX_FILE, _cache));
    _writeQueue = next;
    return next;
}

/**
 * Add or refresh an entry. No-op when the same (fileHash, charId, chatId)
 * tuple is already present, so re-prewarming a known chat does not trigger
 * a disk write.
 *
 * @param {string} fileHash - 16-char hex, must match chatHistoryStore's hash
 * @param {string} charId
 * @param {string} chatId
 * @returns {Promise<void>}
 */
export async function upsertEntry(fileHash, charId, chatId) {
    if (!fileHash || !charId || !chatId) return;
    const idx = await loadIndex();
    const existing = idx[fileHash];
    if (existing && existing.charId === charId && existing.chatId === chatId) return;
    idx[fileHash] = { charId, chatId };
    try {
        await _enqueueWrite();
    } catch (e) {
        console.warn(`${LOG} upsertEntry write failed:`, e.message);
    }
}

/**
 * Remove a single entry. Used by search-path self-healing when a fileHash
 * resolves to a 404 (file gone). Not called from clearHistory by design —
 * see module header.
 *
 * @param {string} fileHash
 * @returns {Promise<void>}
 */
export async function removeEntry(fileHash) {
    if (!fileHash) return;
    const idx = await loadIndex();
    if (!(fileHash in idx)) return;
    delete idx[fileHash];
    try {
        await _enqueueWrite();
    } catch (e) {
        console.warn(`${LOG} removeEntry write failed:`, e.message);
    }
}

/**
 * Convenience read: return every entry whose charId matches. Phase 3 search
 * uses this to narrow the candidate set before opening files.
 *
 * @param {string} charId
 * @returns {Promise<Array<{fileHash:string, charId:string, chatId:string}>>}
 */
export async function getEntriesForChar(charId) {
    if (!charId) return [];
    const idx = await loadIndex();
    const out = [];
    for (const [fileHash, v] of Object.entries(idx)) {
        if (v && v.charId === charId) {
            out.push({ fileHash, charId: v.charId, chatId: v.chatId });
        }
    }
    return out;
}

/**
 * Drop the in-memory cache so the next loadIndex() re-reads from disk.
 * Useful for manual recovery testing; not needed in normal operation.
 */
export function invalidateCache() {
    _cache = null;
    _loadingPromise = null;
}
