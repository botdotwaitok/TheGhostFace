// modules/phone/settings/wbBlacklist.js — World Book Blacklist for Phone
// Manages a dual-layer blacklist: global (all characters) + per-character.
// Blocked world books and entries are excluded from the phone's LLM prompt.

import { getCharacterFileName } from '../../utils.js';

const STORAGE_KEY = 'gf_phone_wb_blacklist';

// ═══════════════════════════════════════════════════════════════════════
// Data structure
// ═══════════════════════════════════════════════════════════════════════
// {
//   "global": {
//     "blockedBooks": ["bookNameA"],
//     "blockedEntries": { "bookNameB": ["entryComment1", "entryComment2"] }
//   },
//   "char": {
//     "charFileName1": {
//       "blockedBooks": ["bookNameC"],
//       "blockedEntries": { "bookNameD": ["entryComment3"] }
//     }
//   }
// }

/** @returns {object} The full blacklist data */
export function getBlacklist() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return _emptyBlacklist();
        const data = JSON.parse(raw);
        // Ensure structure integrity
        if (!data.global) data.global = _emptyLayer();
        if (!data.char) data.char = {};
        return data;
    } catch {
        return _emptyBlacklist();
    }
}

/** @param {object} data Full blacklist data to save */
export function saveBlacklist(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

// ═══════════════════════════════════════════════════════════════════════
// Query API — merges global + current character layers
// ═══════════════════════════════════════════════════════════════════════

/**
 * Check if an entire world book is blocked (global OR current character).
 * @param {string} bookName
 * @returns {boolean}
 */
export function isBookBlocked(bookName) {
    const bl = getBlacklist();
    // Check global
    if (bl.global.blockedBooks?.includes(bookName)) return true;
    // Check current character
    const charKey = getCharacterFileName();
    if (charKey && bl.char[charKey]?.blockedBooks?.includes(bookName)) return true;
    return false;
}

/**
 * Check if a specific entry is blocked (global OR current character).
 * @param {string} bookName
 * @param {string} entryComment
 * @returns {boolean}
 */
export function isEntryBlocked(bookName, entryComment) {
    if (!entryComment) return false;
    const bl = getBlacklist();
    // Check global
    if (bl.global.blockedEntries?.[bookName]?.includes(entryComment)) return true;
    // Check current character
    const charKey = getCharacterFileName();
    if (charKey && bl.char[charKey]?.blockedEntries?.[bookName]?.includes(entryComment)) return true;
    return false;
}

// ═══════════════════════════════════════════════════════════════════════
// Mutation API
// ═══════════════════════════════════════════════════════════════════════

/**
 * Toggle blocking an entire world book.
 * @param {string} bookName
 * @param {'global'|'char'} scope
 */
export function toggleBookBlock(bookName, scope = 'global') {
    const bl = getBlacklist();
    const layer = _getLayer(bl, scope);
    if (!layer.blockedBooks) layer.blockedBooks = [];

    const idx = layer.blockedBooks.indexOf(bookName);
    if (idx >= 0) {
        layer.blockedBooks.splice(idx, 1);
    } else {
        layer.blockedBooks.push(bookName);
    }
    saveBlacklist(bl);
}

/**
 * Toggle blocking a specific entry within a world book.
 * @param {string} bookName
 * @param {string} entryComment
 * @param {'global'|'char'} scope
 */
export function toggleEntryBlock(bookName, entryComment, scope = 'global') {
    const bl = getBlacklist();
    const layer = _getLayer(bl, scope);
    if (!layer.blockedEntries) layer.blockedEntries = {};
    if (!layer.blockedEntries[bookName]) layer.blockedEntries[bookName] = [];

    const list = layer.blockedEntries[bookName];
    const idx = list.indexOf(entryComment);
    if (idx >= 0) {
        list.splice(idx, 1);
        if (list.length === 0) delete layer.blockedEntries[bookName];
    } else {
        list.push(entryComment);
    }
    saveBlacklist(bl);
}

/**
 * Check if a book is blocked in a specific scope (not merged).
 * @param {string} bookName
 * @param {'global'|'char'} scope
 * @returns {boolean}
 */
export function isBookBlockedInScope(bookName, scope) {
    const bl = getBlacklist();
    const layer = _getLayer(bl, scope);
    return layer.blockedBooks?.includes(bookName) ?? false;
}

/**
 * Check if an entry is blocked in a specific scope (not merged).
 * @param {string} bookName
 * @param {string} entryComment
 * @param {'global'|'char'} scope
 * @returns {boolean}
 */
export function isEntryBlockedInScope(bookName, entryComment, scope) {
    const bl = getBlacklist();
    const layer = _getLayer(bl, scope);
    return layer.blockedEntries?.[bookName]?.includes(entryComment) ?? false;
}

// ═══════════════════════════════════════════════════════════════════════
// Internals
// ═══════════════════════════════════════════════════════════════════════

function _emptyLayer() {
    return { blockedBooks: [], blockedEntries: {} };
}

function _emptyBlacklist() {
    return { global: _emptyLayer(), char: {} };
}

/**
 * Get the correct layer object for a given scope.
 * Creates it if it doesn't exist.
 */
function _getLayer(bl, scope) {
    if (scope === 'global') return bl.global;
    const charKey = getCharacterFileName();
    if (!charKey) return bl.global; // fallback to global if no character
    if (!bl.char[charKey]) bl.char[charKey] = _emptyLayer();
    return bl.char[charKey];
}
