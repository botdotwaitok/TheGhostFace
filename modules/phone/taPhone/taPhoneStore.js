// modules/phone/taPhone/taPhoneStore.js — Self-managed file storage for the
// "Ta's Phone" app. One JSON blob per (chatId, charId) under /user/files/,
// keyed by SHA-1(chatId:charId) truncated to 16 hex chars.
//
// Phase 1 surface:
//   - peekAccepted flag (first-run confirm ritual)
//   - full snapshot read / write (home / notes / messages / browser / album)
//   - clear
//
// Writes go through a serialized queue (one in-flight at a time) so two
// rapid generations cannot interleave their atomicWriteJSON tmp files and
// clobber each other — same incident pattern that hardened chatHistoryStore.

import { getContext } from '../../../../../../extensions.js';
import { atomicWriteJSON, readJSON, deleteFile } from '../../storage/fileStore.js';
import { shortHash } from './taPhoneShared.js';

const LOG = '[TaPhoneStore]';
const FILE_PREFIX = 'ghostface_ta_phone_';
const FILE_EXT = '.json';

// ═══════════════════════════════════════════════════════════════════════
// Key derivation
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

function _currentRawKey() {
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

async function _currentKey() {
    const { chatId, charId } = _currentRawKey();
    const hash = await _hashKey(chatId, charId);
    return { chatId, charId, hash, filename: `${FILE_PREFIX}${hash}${FILE_EXT}` };
}

// ═══════════════════════════════════════════════════════════════════════
// In-memory cache (chatId-scoped — drops on chat switch)
// ═══════════════════════════════════════════════════════════════════════

let _cache = null;       // last-loaded data object
let _cacheHash = null;   // hash the cache belongs to
let _writeQueue = Promise.resolve();

function _emptyData() {
    return {
        peekAccepted: false,
        home: null,
        notes: [],
        messages: [],
        browser: { recentPages: [], searches: [], bookmarks: [] },
        album: [],
        // v2 detail caches: keyed by short hash of the originating
        // identifier (contactName / url / query / virtual-app name).
        // Populated on-demand the first time the user opens a detail
        // page; never auto-evicted (see plan/ta-phone-v2.md D2).
        messagesDetails: {},
        browserDetails: {},
        browserSearchDetails: {},
        virtualAppDetails: {},
    };
}

// v2 protocol change: home.appLayout used to be `[string]` (v1) and is
// now `[{name, type}]`. Existing on-disk data may still hold strings.
// Normalizing on every read keeps the in-memory shape uniform without
// forcing a one-shot migration write.
function _normalizeAppLayout(layout) {
    if (!Array.isArray(layout)) return [];
    return layout
        .map(entry => {
            if (typeof entry === 'string') {
                const name = entry.trim();
                return name ? { name, type: 'generic' } : null;
            }
            if (entry && typeof entry === 'object' && typeof entry.name === 'string' && entry.name.trim()) {
                return {
                    name: entry.name.trim(),
                    type: typeof entry.type === 'string' && entry.type.trim() ? entry.type.trim() : 'generic',
                };
            }
            return null;
        })
        .filter(Boolean);
}

// Phase 5 (album-categories): every album entry must carry an `albumName`
// string. Older data predates the field; coerce to "" so the UI "全部" tab
// has nothing to special-case. `duration` is only valid as a positive
// finite number — drop anything else so the video badge renders cleanly.
function _normalizeAlbumEntries(album) {
    if (!Array.isArray(album)) return [];
    return album.map(entry => {
        if (!entry || typeof entry !== 'object') return null;
        const out = { ...entry };
        out.albumName = typeof out.albumName === 'string' ? out.albumName.trim() : '';
        if (out.duration != null && !(Number.isFinite(out.duration) && out.duration > 0)) {
            delete out.duration;
        }
        return out;
    }).filter(Boolean);
}

function _normalizeData(data) {
    if (!data || typeof data !== 'object') return _emptyData();
    if (data.home && Array.isArray(data.home.appLayout)) {
        data.home.appLayout = _normalizeAppLayout(data.home.appLayout);
    }
    if (Array.isArray(data.album)) {
        data.album = _normalizeAlbumEntries(data.album);
    }
    return data;
}

// ═══════════════════════════════════════════════════════════════════════
// Internal read
// ═══════════════════════════════════════════════════════════════════════

async function _readFromDisk(filename) {
    try {
        const parsed = await readJSON(filename);
        if (parsed && typeof parsed === 'object') {
            // Merge with empty shape so missing fields don't crash callers.
            return _normalizeData({ ..._emptyData(), ...parsed });
        }
    } catch (e) {
        console.warn(`${LOG} read failed for ${filename}; treating as fresh:`, e.message);
    }
    return _emptyData();
}

async function _ensureCache() {
    const key = await _currentKey();
    if (_cacheHash === key.hash && _cache) return { key, data: _cache };
    const data = await _readFromDisk(key.filename);
    _cache = data;
    _cacheHash = key.hash;
    return { key, data };
}

// ═══════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════

/**
 * Whether the app has been fully initialized for the current chat — i.e.
 * the first LLM generation populated `home`. peekAccepted alone is NOT
 * enough; it only records that the confirm popup was answered yes.
 * @returns {Promise<boolean>}
 */
export async function isTaPhoneInitialized() {
    const { data } = await _ensureCache();
    return !!data?.home;
}

/**
 * Whether the user has agreed to the first-run "peek" confirm for the
 * current chat. False on a fresh chat → confirm re-fires on next open.
 * @returns {Promise<boolean>}
 */
export async function isPeekAccepted() {
    const { data } = await _ensureCache();
    return !!data?.peekAccepted;
}

/**
 * Mark peekAccepted=true and flush to disk.
 * @returns {Promise<void>}
 */
export async function setPeekAccepted() {
    const { key, data } = await _ensureCache();
    data.peekAccepted = true;
    _cache = data;
    _cacheHash = key.hash;
    return _enqueueWrite(key.filename, data);
}

/**
 * Read the full data snapshot for the current chat. Always returns an
 * object (empty-shape fallback) — never null.
 * @returns {Promise<object>}
 */
export async function loadData() {
    const { data } = await _ensureCache();
    return data;
}

/**
 * Replace the full data snapshot and flush. Used by first-time generation
 * (writes the LLM result wholesale) and by clear / reset paths.
 * @param {object} data
 * @returns {Promise<void>}
 */
export async function saveData(data) {
    const key = await _currentKey();
    const merged = { ..._emptyData(), ...data };
    _cache = merged;
    _cacheHash = key.hash;
    return _enqueueWrite(key.filename, merged);
}

/**
 * Save first-time generation result. Preserves the existing peekAccepted
 * flag (the confirm answer should not get overwritten by the LLM payload).
 * @param {object} llmResult - { home, notes, messages, browser, album }
 * @returns {Promise<void>}
 */
export async function saveInitialGeneration(llmResult) {
    const { key, data: prev } = await _ensureCache();
    const next = {
        ..._emptyData(),
        peekAccepted: prev.peekAccepted, // preserve the confirm answer
        home: llmResult.home || null,
        notes: Array.isArray(llmResult.notes) ? llmResult.notes : [],
        messages: Array.isArray(llmResult.messages) ? llmResult.messages : [],
        browser: {
            recentPages: Array.isArray(llmResult.browser?.recentPages) ? llmResult.browser.recentPages : [],
            searches: Array.isArray(llmResult.browser?.searches) ? llmResult.browser.searches : [],
            bookmarks: Array.isArray(llmResult.browser?.bookmarks) ? llmResult.browser.bookmarks : [],
        },
        album: Array.isArray(llmResult.album) ? llmResult.album : [],
    };
    _normalizeData(next); // coerce home.appLayout into [{name, type}] shape
    _cache = next;
    _cacheHash = key.hash;
    return _enqueueWrite(key.filename, next);
}

/**
 * Read the cached message-detail blob (conversation flow) for a contact,
 * or null if nothing has been generated yet. Lookup key is shortHash of
 * contactName so emoji / slashes / spaces in names don't pollute JSON keys.
 * @param {string} contactName
 * @returns {Promise<{contactName:string, conversation:Array, generatedAt:string} | null>}
 */
export async function getMessageDetail(contactName) {
    const { data } = await _ensureCache();
    const key = await shortHash(contactName);
    const entry = data.messagesDetails?.[key];
    return entry || null;
}

/**
 * Replace the message-detail blob for a contact (first-time generation).
 * Caller passes the parsed conversation array; we wrap it with the source
 * contactName and a generatedAt timestamp for later debugging.
 * @param {string} contactName
 * @param {Array<{from:string, content:string, timestamp:string}>} conversation
 * @returns {Promise<void>}
 */
export async function saveMessageDetail(contactName, conversation) {
    const { key, data } = await _ensureCache();
    if (!data.messagesDetails || typeof data.messagesDetails !== 'object') {
        data.messagesDetails = {};
    }
    const cacheKey = await shortHash(contactName);
    data.messagesDetails[cacheKey] = {
        contactName,
        conversation: Array.isArray(conversation) ? conversation : [],
        generatedAt: new Date().toISOString(),
    };
    _cache = data;
    _cacheHash = key.hash;
    return _enqueueWrite(key.filename, data);
}

/**
 * Append more messages to an existing conversation cache ("再写几条").
 * No-op if the cache entry is missing — caller should treat that as
 * "fall through to a first-time generation" instead.
 * @param {string} contactName
 * @param {Array<{from:string, content:string, timestamp:string}>} newMessages
 * @returns {Promise<void>}
 */
export async function appendMessageDetail(contactName, newMessages) {
    if (!Array.isArray(newMessages) || newMessages.length === 0) return;
    const { key, data } = await _ensureCache();
    const cacheKey = await shortHash(contactName);
    const entry = data.messagesDetails?.[cacheKey];
    if (!entry) return;
    entry.conversation = entry.conversation.concat(newMessages);
    entry.generatedAt = new Date().toISOString();
    _cache = data;
    _cacheHash = key.hash;
    return _enqueueWrite(key.filename, data);
}

/**
 * Append new notes to the main notes list (Phase 3.5 broad refresh).
 * Notes have no detail page, so the list itself is the content — refresh
 * grows the list. No-op for empty/non-array input.
 * @param {Array<{title?:string, body:string, tags?:string[], timestamp:string}>} newNotes
 * @returns {Promise<void>}
 */
export async function appendNotes(newNotes) {
    if (!Array.isArray(newNotes) || newNotes.length === 0) return;
    const { key, data } = await _ensureCache();
    if (!Array.isArray(data.notes)) data.notes = [];
    data.notes = data.notes.concat(newNotes);
    _cache = data;
    _cacheHash = key.hash;
    return _enqueueWrite(key.filename, data);
}

/**
 * Append new album entries to the main album list (Phase 3.5 broad refresh).
 * Album has no detail page either; refresh grows the list directly.
 * @param {Array<{title?:string, description?:string, tags?:string[], timestamp:string}>} newItems
 * @returns {Promise<void>}
 */
export async function appendAlbum(newItems) {
    if (!Array.isArray(newItems) || newItems.length === 0) return;
    const { key, data } = await _ensureCache();
    if (!Array.isArray(data.album)) data.album = [];
    data.album = data.album.concat(newItems);
    _cache = data;
    _cacheHash = key.hash;
    return _enqueueWrite(key.filename, data);
}

/**
 * Append new messages and/or fill missing conversations across multiple
 * contacts in a single disk write. Mixes three operations atomically so
 * the messages broad-refresh path doesn't fragment into N queued writes.
 *
 * - `extensions`: each entry appends to an EXISTING contact's cached
 *   conversation (used when the contact already had a generated flow).
 * - `fills`: each entry replaces / creates the cache for a contact that
 *   had no flow yet (first-time generation triggered by the broad ⟳).
 * - `newContacts`: each entry both pushes onto the data.messages list
 *   AND seeds its conversation cache (used when the LLM invents a brand
 *   new contact in the same refresh batch).
 *
 * @param {object} batch
 * @param {Array<{contactName:string, newMessages:Array}>} batch.extensions
 * @param {Array<{contactName:string, conversation:Array}>} batch.fills
 * @param {Array<{contactName:string, contactType?:string, lastMessage?:string,
 *                unread?:number, timestamp?:string, conversation:Array}>} batch.newContacts
 * @returns {Promise<void>}
 */
export async function appendMessagesBatch(batch) {
    const extensions = Array.isArray(batch?.extensions) ? batch.extensions : [];
    const fills = Array.isArray(batch?.fills) ? batch.fills : [];
    const newContacts = Array.isArray(batch?.newContacts) ? batch.newContacts : [];
    if (extensions.length === 0 && fills.length === 0 && newContacts.length === 0) return;

    const { key, data } = await _ensureCache();
    if (!data.messagesDetails || typeof data.messagesDetails !== 'object') data.messagesDetails = {};
    if (!Array.isArray(data.messages)) data.messages = [];
    const now = new Date().toISOString();

    for (const ext of extensions) {
        if (!ext?.contactName || !Array.isArray(ext.newMessages) || ext.newMessages.length === 0) continue;
        const cacheKey = await shortHash(ext.contactName);
        const entry = data.messagesDetails[cacheKey];
        if (entry && Array.isArray(entry.conversation)) {
            entry.conversation = entry.conversation.concat(ext.newMessages);
            entry.generatedAt = now;
        } else {
            // Cache went missing between read and write — treat as fill.
            data.messagesDetails[cacheKey] = {
                contactName: ext.contactName,
                conversation: ext.newMessages.slice(),
                generatedAt: now,
            };
        }
    }

    for (const fill of fills) {
        if (!fill?.contactName || !Array.isArray(fill.conversation)) continue;
        const cacheKey = await shortHash(fill.contactName);
        data.messagesDetails[cacheKey] = {
            contactName: fill.contactName,
            conversation: fill.conversation.slice(),
            generatedAt: now,
        };
    }

    for (const c of newContacts) {
        if (!c?.contactName) continue;
        data.messages.push({
            contactName: c.contactName,
            contactType: c.contactType || '',
            lastMessage: c.lastMessage || '',
            unread: Number.isFinite(c.unread) ? c.unread : 0,
            timestamp: c.timestamp || now,
        });
        if (Array.isArray(c.conversation) && c.conversation.length > 0) {
            const cacheKey = await shortHash(c.contactName);
            data.messagesDetails[cacheKey] = {
                contactName: c.contactName,
                conversation: c.conversation.slice(),
                generatedAt: now,
            };
        }
    }

    _cache = data;
    _cacheHash = key.hash;
    return _enqueueWrite(key.filename, data);
}

/**
 * Append new browser items + detail caches in a single atomic write.
 * Used by the browser broad refresh (⟳ on the browser sub-page list).
 * Each section is optional; the helper no-ops if the whole payload is empty.
 *
 * - `newRecentPages` / `newBookmarks`: list-row inserts. If the entry has
 *   a `style` + `content`, the detail cache is also written so the user
 *   can tap the new row without triggering another LLM call.
 * - `newSearches`: list-row insert + cached results (same idea).
 * - `pageFills` / `searchFills`: fill detail caches for items that were
 *   already on the list but had no detail yet.
 *
 * @param {object} batch
 * @param {Array<{title?:string, url:string, timestamp?:string, style?:string, content?:object}>} batch.newRecentPages
 * @param {Array<{title?:string, url:string, style?:string, content?:object}>} batch.newBookmarks
 * @param {Array<{query:string, timestamp?:string, results?:Array}>} batch.newSearches
 * @param {Array<{url:string, style:string, content:object}>} batch.pageFills
 * @param {Array<{query:string, results:Array}>} batch.searchFills
 * @returns {Promise<void>}
 */
export async function appendBrowserBatch(batch) {
    const newRecentPages = Array.isArray(batch?.newRecentPages) ? batch.newRecentPages : [];
    const newBookmarks = Array.isArray(batch?.newBookmarks) ? batch.newBookmarks : [];
    const newSearches = Array.isArray(batch?.newSearches) ? batch.newSearches : [];
    const pageFills = Array.isArray(batch?.pageFills) ? batch.pageFills : [];
    const searchFills = Array.isArray(batch?.searchFills) ? batch.searchFills : [];
    if (newRecentPages.length + newBookmarks.length + newSearches.length
        + pageFills.length + searchFills.length === 0) return;

    const { key, data } = await _ensureCache();
    if (!data.browser || typeof data.browser !== 'object') {
        data.browser = { recentPages: [], searches: [], bookmarks: [] };
    }
    if (!Array.isArray(data.browser.recentPages)) data.browser.recentPages = [];
    if (!Array.isArray(data.browser.searches)) data.browser.searches = [];
    if (!Array.isArray(data.browser.bookmarks)) data.browser.bookmarks = [];
    if (!data.browserDetails || typeof data.browserDetails !== 'object') data.browserDetails = {};
    if (!data.browserSearchDetails || typeof data.browserSearchDetails !== 'object') data.browserSearchDetails = {};
    const now = new Date().toISOString();

    for (const p of newRecentPages) {
        if (!p?.url) continue;
        data.browser.recentPages.push({
            title: p.title || '',
            url: p.url,
            timestamp: p.timestamp || now,
        });
        if (p.content && typeof p.content === 'object') {
            const cacheKey = await shortHash(p.url);
            data.browserDetails[cacheKey] = {
                url: p.url,
                style: p.style || 'generic',
                content: p.content,
                generatedAt: now,
            };
        }
    }

    for (const b of newBookmarks) {
        if (!b?.url) continue;
        data.browser.bookmarks.push({
            title: b.title || '',
            url: b.url,
        });
        if (b.content && typeof b.content === 'object') {
            const cacheKey = await shortHash(b.url);
            data.browserDetails[cacheKey] = {
                url: b.url,
                style: b.style || 'generic',
                content: b.content,
                generatedAt: now,
            };
        }
    }

    for (const s of newSearches) {
        if (!s?.query) continue;
        data.browser.searches.push({
            query: s.query,
            timestamp: s.timestamp || now,
        });
        if (Array.isArray(s.results) && s.results.length > 0) {
            const cacheKey = await shortHash(s.query);
            data.browserSearchDetails[cacheKey] = {
                query: s.query,
                results: s.results.slice(),
                generatedAt: now,
            };
        }
    }

    for (const f of pageFills) {
        if (!f?.url || !f.content || typeof f.content !== 'object') continue;
        const cacheKey = await shortHash(f.url);
        data.browserDetails[cacheKey] = {
            url: f.url,
            style: f.style || 'generic',
            content: f.content,
            generatedAt: now,
        };
    }

    for (const f of searchFills) {
        if (!f?.query || !Array.isArray(f.results)) continue;
        const cacheKey = await shortHash(f.query);
        data.browserSearchDetails[cacheKey] = {
            query: f.query,
            results: f.results.slice(),
            generatedAt: now,
        };
    }

    _cache = data;
    _cacheHash = key.hash;
    return _enqueueWrite(key.filename, data);
}

/**
 * Read the cached browser page detail blob for a url, or null if none.
 * Lookup key is shortHash(url) — see plan/ta-phone-v2.md D2 for rationale.
 * @param {string} url
 * @returns {Promise<{url:string, style:string, content:object, generatedAt:string} | null>}
 */
export async function getBrowserPageDetail(url) {
    const { data } = await _ensureCache();
    const key = await shortHash(url);
    return data.browserDetails?.[key] || null;
}

/**
 * Replace the browser page detail for a url (first-time generation).
 * Caller supplies style ("xhs" | "zhihu" | "bilibili" | "generic") and
 * the parsed LLM content object.
 * @param {string} url
 * @param {string} style
 * @param {object} content - { title, author?, content, interactions? }
 * @returns {Promise<void>}
 */
export async function saveBrowserPageDetail(url, style, content) {
    const { key, data } = await _ensureCache();
    if (!data.browserDetails || typeof data.browserDetails !== 'object') {
        data.browserDetails = {};
    }
    const cacheKey = await shortHash(url);
    data.browserDetails[cacheKey] = {
        url,
        style,
        content: content && typeof content === 'object' ? content : {},
        generatedAt: new Date().toISOString(),
    };
    _cache = data;
    _cacheHash = key.hash;
    return _enqueueWrite(key.filename, data);
}

/**
 * Read the cached search result list for a query, or null if none.
 * @param {string} query
 * @returns {Promise<{query:string, results:Array, generatedAt:string} | null>}
 */
export async function getBrowserSearchDetail(query) {
    const { data } = await _ensureCache();
    const key = await shortHash(query);
    return data.browserSearchDetails?.[key] || null;
}

/**
 * Replace the search result list for a query.
 * @param {string} query
 * @param {Array<{title:string, url:string, snippet:string, source:string}>} results
 * @returns {Promise<void>}
 */
export async function saveBrowserSearchDetail(query, results) {
    const { key, data } = await _ensureCache();
    if (!data.browserSearchDetails || typeof data.browserSearchDetails !== 'object') {
        data.browserSearchDetails = {};
    }
    const cacheKey = await shortHash(query);
    data.browserSearchDetails[cacheKey] = {
        query,
        results: Array.isArray(results) ? results : [],
        generatedAt: new Date().toISOString(),
    };
    _cache = data;
    _cacheHash = key.hash;
    return _enqueueWrite(key.filename, data);
}

/**
 * Erase only the notes list. Home / messages / browser / album and the
 * peekAccepted flag stay intact — user refreshes notes alone to regrow.
 * @returns {Promise<void>}
 */
export async function clearNotes() {
    const { key, data } = await _ensureCache();
    data.notes = [];
    _cache = data;
    _cacheHash = key.hash;
    return _enqueueWrite(key.filename, data);
}

/**
 * Erase the messages list AND all per-contact conversation caches.
 * Dropping the list without dropping messagesDetails would orphan blobs
 * that no list row references anymore.
 * @returns {Promise<void>}
 */
export async function clearMessages() {
    const { key, data } = await _ensureCache();
    data.messages = [];
    data.messagesDetails = {};
    _cache = data;
    _cacheHash = key.hash;
    return _enqueueWrite(key.filename, data);
}

/**
 * Erase the browser state — recent pages, searches, bookmarks, and the
 * page-detail + search-result caches that back them.
 * @returns {Promise<void>}
 */
export async function clearBrowser() {
    const { key, data } = await _ensureCache();
    data.browser = { recentPages: [], searches: [], bookmarks: [] };
    data.browserDetails = {};
    data.browserSearchDetails = {};
    _cache = data;
    _cacheHash = key.hash;
    return _enqueueWrite(key.filename, data);
}

/**
 * Erase only the album list.
 * @returns {Promise<void>}
 */
export async function clearAlbum() {
    const { key, data } = await _ensureCache();
    data.album = [];
    _cache = data;
    _cacheHash = key.hash;
    return _enqueueWrite(key.filename, data);
}

/**
 * Erase all ta-phone data for the current chat (resets peekAccepted too,
 * so the next open re-fires the peek confirm). Reserved for Phase 3
 * "reset" button — exported now so debug helpers can use it.
 * @returns {Promise<void>}
 */
export async function clearData() {
    const key = await _currentKey();
    _cache = _emptyData();
    _cacheHash = key.hash;
    try {
        await deleteFile(key.filename);
    } catch (e) {
        console.warn(`${LOG} clearData delete failed (non-fatal):`, e.message);
    }
}

/**
 * Debug helper: synchronous peek at the in-memory cache, for window-level
 * inspection. Returns null if the cache has not been warmed.
 */
export function debugInfo() {
    return { hash: _cacheHash, data: _cache };
}

// ═══════════════════════════════════════════════════════════════════════
// Serialized writer
// ═══════════════════════════════════════════════════════════════════════

function _enqueueWrite(filename, payload) {
    const snapshot = payload; // already a stable reference; callers don't mutate after save
    const next = _writeQueue
        .catch(() => {})
        .then(() => atomicWriteJSON(filename, snapshot));
    _writeQueue = next;
    return next;
}
