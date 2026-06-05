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

// On-disk format.
//   v1: wraps messages alongside a persistent floor counter so the next-floor
//       id never resets across reloads even after the tail message is deleted.
//   v2: adds summary / summaryHistory / homeMarker so all phone-chat-derived
//       metadata lives in the same self-managed file as the messages it
//       references. Before v2 these lived in chat_metadata, which desynced
//       from messages on backup/restore — most visibly, summaryHistory
//       wasn't even in the backup payload (chatImportExport.js bug).
// Bare-array files from the pre-floor era are still accepted on read and
// rewritten as the current schema on the next save; see prewarm() for the
// migration branch.
export const CHAT_FILE_SCHEMA_VERSION = 2;

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

// Flips to true when the last prewarm() attempt threw before populating the
// cache. saveHistory refuses to write while this is set — without that guard,
// the catch block's previous behavior of forcing _cache=[] + _cacheReady=true
// let any subsequent loadChatHistory+saveChatHistory cycle reverse-publish an
// empty snapshot back to disk, deleting the user's real history. invalidate()
// and the next successful prewarm both clear it back to false.
let _prewarmFailed = false;

// Floor counter for the currently loaded key. Always read/written through
// getNextFloor / setNextFloor so the in-memory value and the on-disk
// `nextFloor` field stay in lockstep. Monotonically increasing; never reused
// even after tail deletions — that's the whole point of persisting it.
let _nextFloor = 0;

// Phone-chat-derived metadata. Same lifecycle as _cache / _nextFloor: loaded
// in prewarm(), mutated via setters, flushed by saveHistory(). Setters DO NOT
// auto-save (mirror of setNextFloor) — the chatStorage.js dual-track layer
// is responsible for awaiting saveHistory() / flushNow() after a mutation
// when an immediate disk ack is required (which it is for all three: a
// dropped summary triggers full re-summarize, a lost marker re-sends the
// whole transcript on 回家, and lost summaryHistory entries are
// unrecoverable).
let _summary = '';
let _summaryHistory = [];
let _homeMarker = '';

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
    // Clear any prior failure flag — this attempt gets to decide its own fate.
    _prewarmFailed = false;

    const work = (async () => {
        try {
            await _recoverOrphanTmp(nextKey.filename);
            const parsed = await readJSON(nextKey.filename);
            // Race check: if user already switched away during our await, drop result.
            if (_currentKey?.hash !== nextKey.hash) {
                console.log(`${LOG} prewarm for ${nextKey.filename} superseded — discarding`);
                return;
            }

            // Three on-disk shapes to handle:
            //   1. null / missing                    → fresh empty cache
            //   2. bare array (pre-floor era)        → wrap + backfill floors,
            //                                          mark for resave
            //   3. { schema, messages, nextFloor, ... } → schema-aware load;
            //                                          unknown schema falls back
            //                                          to defensive field pluck
            let messages = [];
            let nextFloor = 0;
            let summary = '';
            let summaryHistory = [];
            let homeMarker = '';
            let needsResave = false;

            if (parsed === null || parsed === undefined) {
                // Stays empty.
            } else if (Array.isArray(parsed)) {
                messages = parsed;
                // Backfill floor on every message that lacks one. Index-order
                // is the only signal we have for legacy data; once written,
                // these ids become the contract going forward.
                //
                // Null guard: a corrupt entry (null / undefined / non-object)
                // used to throw TypeError on `.floor` here, tipping the whole
                // prewarm into the catch block — which then forced the cache
                // to []+ready and let the next save overwrite the file with
                // an empty payload. One bad row trashed the whole chat. Now
                // we just skip the bad slot and keep going; the file gets
                // rewritten at v2 schema with the rest of the messages intact.
                for (let i = 0; i < messages.length; i++) {
                    if (!messages[i] || typeof messages[i] !== 'object') continue;
                    if (typeof messages[i].floor !== 'number') {
                        messages[i].floor = i;
                    }
                }
                // Use length as the counter floor — never reuse the indices
                // we just assigned, and the wrapped file flips us to the
                // current schema on the next save so this migration only
                // ever runs once. Summary / marker fields stay empty here —
                // the dual-track layer in chatStorage.js will seed them from
                // chat_metadata on first toggle if anything's there.
                nextFloor = messages.length;
                needsResave = true;
                console.log(`${LOG} migrating bare-array file ${nextKey.filename} → schema ${CHAT_FILE_SCHEMA_VERSION} (${messages.length} messages, nextFloor=${nextFloor})`);
            } else if (typeof parsed === 'object') {
                if (Array.isArray(parsed.messages)) {
                    messages = parsed.messages;
                    nextFloor = typeof parsed.nextFloor === 'number' ? parsed.nextFloor : messages.length;
                    // Schema-aware field extraction. v1 lacks summary/marker
                    // fields; reading them as missing → empty is the correct
                    // upgrade path (the dual-track layer will seed from
                    // chat_metadata on first toggle if needed).
                    summary = typeof parsed.summary === 'string' ? parsed.summary : '';
                    summaryHistory = Array.isArray(parsed.summaryHistory) ? parsed.summaryHistory : [];
                    homeMarker = typeof parsed.homeMarker === 'string' ? parsed.homeMarker : '';
                    if (parsed.schema !== CHAT_FILE_SCHEMA_VERSION) {
                        // Two scenarios: (a) old schema (v1) — we just upgraded
                        // it in memory and need to flush so the file ends up
                        // at the current version; (b) future schema from a
                        // parallel ST instance — we extracted what we
                        // recognized, write-back will downgrade the file,
                        // acceptable for a single-user tool.
                        needsResave = true;
                        console.log(`${LOG} schema ${parsed.schema} → ${CHAT_FILE_SCHEMA_VERSION} on next save (${nextKey.filename})`);
                    }
                } else {
                    console.warn(`${LOG} unrecognized object shape in ${nextKey.filename}; starting empty`);
                }
            }

            _cache = messages;
            _nextFloor = nextFloor;
            _summary = summary;
            _summaryHistory = summaryHistory;
            _homeMarker = homeMarker;
            _cacheReady = true;
            _cacheKey = nextKey.hash; // tag _cache with the key it belongs to
            console.log(`${LOG} prewarm ${nextKey.filename}: ${_cache.length} messages, nextFloor=${_nextFloor}, summary=${_summary.length}c, sumHist=${_summaryHistory.length}, marker=${_homeMarker ? 'yes' : 'no'}`);

            // Side-effect: refresh the lookup index used by phone chat search.
            // Fire-and-forget so a slow/failed index write never blocks chat
            // load; loadIndex de-dupes a same-tuple upsert into a no-op.
            upsertIndexEntry(nextKey.hash, charId, chatId).catch(err => {
                console.warn(`${LOG} index upsert failed (non-fatal):`, err.message);
            });

            if (needsResave) {
                // Flush the wrapped format so subsequent loads skip the
                // bare-array branch. Fire-and-forget: failure just delays
                // the rewrite to whenever the next saveHistory lands.
                saveHistory(_cache).catch(err => {
                    console.warn(`${LOG} bare-array→v1 resave failed for ${nextKey.filename} (will retry on next save):`, err.message);
                });
            }
        } catch (e) {
            // CRITICAL: do NOT mark the cache ready here, do NOT reset _cache,
            // do NOT touch _cacheKey. The previous version of this block did
            // all three and shipped an empty cache forward as if it were the
            // truth — every saveHistory after that overwrote the on-disk file
            // with [] and silently deleted the user's chat (reported in 4.4.2).
            //
            // Leaving _cacheReady=false has two effects:
            //   - loadHistory({ allowStale: true }) still serves the previous
            //     snapshot if _cacheKey survived a same-chat invalidate, so
            //     same-chat refreshes keep painting the existing messages.
            //   - saveHistory throws via the _prewarmFailed guard below,
            //     refusing to publish an unverified-empty cache to disk.
            //
            // Race check: only set the flag if we're still the active key —
            // a later prewarm against a different chat may have already taken
            // over and we don't want to poison its state.
            console.error(`${LOG} prewarm failed for ${nextKey.filename}; cache will NOT be marked ready, writes will be refused until next prewarm:`, e.message);
            if (_currentKey?.hash === nextKey.hash) {
                _prewarmFailed = true;
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
    // Always reset the failure flag — invalidate marks a fresh attempt boundary.
    // Whatever the next prewarm decides will overwrite this.
    _prewarmFailed = false;
    if (!keepCache) {
        _cache = [];
        _cacheKey = null;
        _nextFloor = 0;
        _summary = '';
        _summaryHistory = [];
        _homeMarker = '';
    }
    // When keepCache is true, _nextFloor / _summary / _summaryHistory /
    // _homeMarker all stay at their preserved values so the allowStale
    // snapshot is internally consistent until prewarm completes.
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
export async function saveHistory(messages, { allowEmpty = false } = {}) {
    if (!_currentKey) {
        throw new Error('chatHistoryStore.saveHistory: no active key — call prewarm() first');
    }
    // Refuse to write when the active key's prewarm never produced a verified
    // snapshot. Writing here would let the caller's loadChatHistory()→[]
    // (served from the catch-block fallback in older versions, or simply from
    // a never-loaded cache) round-trip back to disk and overwrite the real
    // file with an empty payload. The caller sees an exception and can
    // surface it; saveChatHistory's race-retry path will then call
    // handleChatChanged → re-prewarm and either succeed cleanly or fail loud
    // — never silently delete data.
    if (_prewarmFailed) {
        throw new Error(
            `chatHistoryStore.saveHistory: prewarm failed for ${_currentKey.filename} — ` +
            'refusing to write; would risk overwriting on-disk history with an empty cache'
        );
    }
    const snapshot = messages.slice();
    const keyAtCall = _currentKey;
    _cache = snapshot;
    // Snapshot ALL persisted fields at queue-time so a save queued before
    // a later mutation still writes the values that matched its snapshot.
    // Without this freeze, a fast follow-up setNextFloor / setSummary /
    // setHomeMarker could land the newer value alongside the older messages
    // slice and create a torn-write window if the process dies mid-queue.
    const floorAtCall = _nextFloor;
    const summaryAtCall = _summary;
    const summaryHistoryAtCall = _summaryHistory.slice();
    const homeMarkerAtCall = _homeMarker;

    const next = _writeQueue
        .catch(() => {}) // isolate prior failures from later tasks
        .then(async () => {
            // Empty-write safety net. Last-line-of-defense against any path
            // (current bug, future bug, or our own oversight) that ends up
            // calling saveHistory with [] against a populated on-disk file.
            // Only triggers when the in-memory snapshot is empty — steady-state
            // save cost is unchanged. Legitimate clears pass allowEmpty: true
            // (clearHistory, user-initiated 清空, the delete-last-message
            // path) so they get through without a round-trip.
            if (snapshot.length === 0 && !allowEmpty) {
                let diskMessages;
                try {
                    const existing = await readJSON(keyAtCall.filename);
                    diskMessages = Array.isArray(existing)
                        ? existing
                        : (Array.isArray(existing?.messages) ? existing.messages : []);
                } catch (e) {
                    // Can't confirm disk is safe to overwrite — refuse. Better
                    // a failed save than a silent wipe.
                    throw new Error(
                        `chatHistoryStore.saveHistory: cannot verify ${keyAtCall.filename} ` +
                        `before empty-write (readJSON failed: ${e.message}); refusing to write`
                    );
                }
                if (diskMessages.length > 0) {
                    throw new Error(
                        `chatHistoryStore.saveHistory: refusing to overwrite ${keyAtCall.filename} ` +
                        `(${diskMessages.length} messages on disk) with empty snapshot; ` +
                        'pass { allowEmpty: true } if this is an intentional clear'
                    );
                }
            }
            // Even if the user switched chats after this save was queued, we
            // still want this write to go through against ITS original key
            // (snapshotted as keyAtCall) — those bytes ARE that file's truth.
            await atomicWriteJSON(keyAtCall.filename, buildFilePayload(snapshot, floorAtCall, {
                summary: summaryAtCall,
                summaryHistory: summaryHistoryAtCall,
                homeMarker: homeMarkerAtCall,
            }));
        });
    _writeQueue = next;
    return next;
}

/**
 * Trigger a disk write of the current in-memory snapshot. Setters of summary /
 * summaryHistory / homeMarker don't auto-save (same as setNextFloor), so the
 * dual-track layer calls flushNow() after a mutation that must reach disk now.
 *
 * Skips if cache isn't ready — better to drop one mid-prewarm flush than to
 * crash the chat lifecycle path. The next genuine saveHistory will pick up
 * the in-memory value anyway.
 *
 * @returns {Promise<void>}
 */
export async function flushNow() {
    if (!_cacheReady || !_currentKey) return;
    await saveHistory(_cache);
}

// ═══════════════════════════════════════════════════════════════════════
// Floor counter (persisted alongside messages)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Current next-to-assign floor id for the loaded key. Returns null when the
 * cache hasn't been primed yet (caller forgot ensureReady) so the failure
 * is loud rather than silently allocating from 0 against the wrong key.
 * @returns {number | null}
 */
export function getNextFloor() {
    if (!_cacheReady) return null;
    return _nextFloor;
}

/**
 * Overwrite the next-floor counter. Persists on the next saveHistory call,
 * which is the same write that lands the message that consumed the previous
 * id — so the (messages, nextFloor) pair stays atomic from the file's POV.
 * @param {number} n
 */
export function setNextFloor(n) {
    if (!_cacheReady) return;
    _nextFloor = n;
}

/**
 * Wrap (messages, nextFloor, extras) into the on-disk schema payload. Exposed
 * so the migrate-from-legacy and fresh-file branches in chatStorage.js can
 * write the same shape without each importer hard-coding the schema field.
 *
 * @param {Array} messages
 * @param {number} nextFloor
 * @param {{ summary?: string, summaryHistory?: Array, homeMarker?: string }} [extras]
 * @returns {{ schema: number, messages: Array, nextFloor: number, summary: string, summaryHistory: Array, homeMarker: string }}
 */
export function buildFilePayload(messages, nextFloor, extras = {}) {
    return {
        schema: CHAT_FILE_SCHEMA_VERSION,
        messages,
        nextFloor: typeof nextFloor === 'number' ? nextFloor : (Array.isArray(messages) ? messages.length : 0),
        summary: typeof extras.summary === 'string' ? extras.summary : '',
        summaryHistory: Array.isArray(extras.summaryHistory) ? extras.summaryHistory : [],
        homeMarker: typeof extras.homeMarker === 'string' ? extras.homeMarker : '',
    };
}

// ═══════════════════════════════════════════════════════════════════════
// Summary triplet (current rolling summary, summary history, home marker)
// ═══════════════════════════════════════════════════════════════════════
//
// All three live in the same file as messages so backup/restore and chat-
// switch operate atomically — particularly important now that summaryHistory
// entries can carry floorRange that references messages by floor id. Before
// schema v2 these lived in chat_metadata and went out of sync on restore.
//
// Setters do not auto-save (mirror of setNextFloor): the dual-track layer in
// chatStorage.js calls flushNow() after a mutation that must reach disk.
// Getters return null when the cache isn't ready so the failure is loud
// rather than serving '' / [] against the wrong key.

/**
 * @returns {string | null} current rolling summary, or null if cache not ready
 */
export function getSummary() {
    if (!_cacheReady) return null;
    return _summary;
}

/**
 * @param {string} text
 */
export function setSummary(text) {
    if (!_cacheReady) return;
    _summary = typeof text === 'string' ? text : '';
}

/**
 * Shallow copy so callers can't mutate the in-memory array directly — keeps
 * the "all writes go through setSummaryHistory" contract intact.
 * @returns {Array | null}
 */
export function getSummaryHistory() {
    if (!_cacheReady) return null;
    return _summaryHistory.slice();
}

/**
 * @param {Array} arr
 */
export function setSummaryHistory(arr) {
    if (!_cacheReady) return;
    _summaryHistory = Array.isArray(arr) ? arr.slice() : [];
}

/**
 * @returns {string | null} ISO timestamp of last 回家'd message, or null if cache not ready
 */
export function getHomeMarker() {
    if (!_cacheReady) return null;
    return _homeMarker;
}

/**
 * @param {string} marker
 */
export function setHomeMarker(marker) {
    if (!_cacheReady) return;
    _homeMarker = typeof marker === 'string' ? marker : '';
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
 * Empty the current key's history both in memory and on disk. Passes
 * allowEmpty so the saveHistory empty-write safety net lets us through —
 * this is the sanctioned way to actually publish an empty file.
 * @returns {Promise<void>}
 */
export async function clearHistory() {
    if (!_currentKey) return;
    await saveHistory([], { allowEmpty: true });
}

/**
 * Debug / "清理自管文件" support: inspect current internal state.
 */
export function debugInfo() {
    return {
        currentKey: _currentKey,
        cacheReady: _cacheReady,
        prewarmFailed: _prewarmFailed,
        cacheLength: _cache.length,
        nextFloor: _nextFloor,
        summaryChars: _summary.length,
        summaryHistoryCount: _summaryHistory.length,
        homeMarker: _homeMarker || '(none)',
    };
}
