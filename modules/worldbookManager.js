import { characters } from '../../../../../script.js';
import { loadWorldInfo, saveWorldInfo, world_info, createWorldInfoEntry } from '../../../../world-info.js';
import { getCharaFilename } from '../../../../utils.js';

import * as utils from './utils.js';

/**
 * Gets all active world book names.
 * This includes the global selected world books, the current character's world books, and extra books.
 */
export async function getAllActiveWorldBookNames() {
    try {
        let activeBooks = new Set();

        // 1. Add globally selected world books (dynamic access — safe for older ST versions)
        let selected_world_info;
        try {
            const wiModule = await import('../../../../world-info.js');
            selected_world_info = wiModule.selected_world_info;
        } catch { /* older ST — ignore */ }
        if (Array.isArray(selected_world_info)) {
            selected_world_info.forEach(book => activeBooks.add(book));
        } else if (selected_world_info) {
            activeBooks.add(selected_world_info);
        }

        // 2. Add current character's world books
        const currentChid = utils.getCurrentChid();
        if (currentChid !== null && currentChid !== undefined && characters && characters[currentChid]) {
            const character = characters[currentChid];

            // From data extensions
            const baseWorldName = character?.data?.extensions?.world;
            if (baseWorldName) activeBooks.add(baseWorldName);

            // From legacy world field
            const legacyWorld = character?.world;
            if (legacyWorld && typeof legacyWorld === 'string') {
                legacyWorld.split(',').map(w => w.trim()).filter(Boolean).forEach(w => activeBooks.add(w));
            }

            // From charLore extra books
            if (typeof getCharaFilename === 'function' && typeof world_info !== 'undefined' && world_info.charLore) {
                try {
                    const fileName = getCharaFilename(currentChid);
                    const extraCharLore = world_info.charLore?.find((e) => e.name === fileName);
                    if (extraCharLore?.extraBooks) {
                        extraCharLore.extraBooks.forEach(book => activeBooks.add(book));
                    }
                } catch { /* ignore */ }
            }
        }

        return Array.from(activeBooks);
    } catch (error) {
        utils.logger.error('获取活跃世界书列表失败:', error);
        return [];
    }
}

/**
 * Fetches all active entries from the specified worldbooks.
 * @param {Array<string>} worldBookNames 
 * @returns {Array<object>} List of all aggregated world info entries with source included
 */
export async function getAllActiveEntries(worldBookNames) {
    let allEntries = [];

    for (const bookName of worldBookNames) {
        try {
            const wbData = await loadWorldInfo(bookName);
            if (wbData && wbData.entries) {
                Object.values(wbData.entries).forEach(entry => {
                    // Inject source book info for UI display
                    const entryData = { ...entry, sourceWorldBook: bookName };
                    allEntries.push(entryData);
                });
            }
        } catch (err) {
            utils.logger.warn(`加载世界书 ${bookName} 数据失败:`, err);
        }
    }

    // Sort entries by order ascending (simulating real LLM reading order: smaller order = earlier in context)
    allEntries.sort((a, b) => {
        const orderA = a.order ?? 100;
        const orderB = b.order ?? 100;
        return orderA - orderB; // Small order first, matching LLM's actual reading sequence
    });

    return allEntries;
}

/**
 * Finds available (empty) order numbers for inserting new entries.
 * @param {Array<object>} currentEntries
 * @param {number} minOrder
 * @param {number} maxOrder
 * @returns {Array<number>} List of available orders
 */
export function findAvailableOrders(currentEntries, minOrder = 0, maxOrder = 200) {
    const usedOrders = new Set(currentEntries.map(e => e.order ?? 100));
    let availableOrders = [];

    for (let i = minOrder; i <= maxOrder; i++) {
        if (!usedOrders.has(i)) {
            availableOrders.push(i);
        }
    }

    return availableOrders;
}

/**
 * Returns all worldbook file names registered with ST (the global `world_names`).
 */
export async function getAllBookNames() {
    try {
        const wiModule = await import('../../../../world-info.js');
        const names = wiModule.world_names;
        return Array.isArray(names) ? [...names] : [];
    } catch (e) {
        utils.logger.warn('Failed to read world_names:', e);
        return [];
    }
}

/**
 * Returns active worldbooks split by source — global / character / charLore.
 * Each list is deduplicated within itself; a book may legitimately appear in
 * more than one bucket (e.g. globally selected AND bound to the character).
 */
export async function getActiveBooksGrouped() {
    const global = [];
    const character = [];
    const charLore = [];

    try {
        const wiModule = await import('../../../../world-info.js');
        const sel = wiModule.selected_world_info;
        if (Array.isArray(sel)) sel.forEach(b => { if (b && !global.includes(b)) global.push(b); });
        else if (sel) global.push(sel);
    } catch { /* older ST — ignore */ }

    const currentChid = utils.getCurrentChid();
    if (currentChid !== null && currentChid !== undefined && characters && characters[currentChid]) {
        const ch = characters[currentChid];

        const baseWorldName = ch?.data?.extensions?.world;
        if (baseWorldName && !character.includes(baseWorldName)) character.push(baseWorldName);

        const legacy = ch?.world;
        if (legacy && typeof legacy === 'string') {
            legacy.split(',').map(w => w.trim()).filter(Boolean).forEach(w => {
                if (!character.includes(w)) character.push(w);
            });
        }

        if (typeof getCharaFilename === 'function' && typeof world_info !== 'undefined' && world_info.charLore) {
            try {
                const fileName = getCharaFilename(currentChid);
                const extra = world_info.charLore?.find((e) => e.name === fileName);
                if (extra?.extraBooks) {
                    extra.extraBooks.forEach(b => { if (b && !charLore.includes(b)) charLore.push(b); });
                }
            } catch { /* ignore */ }
        }
    }

    return { global, character, charLore };
}

/**
 * Loads a single worldbook via ST's native `loadWorldInfo`.
 * Returns null when the book is missing or fails to load.
 */
export async function loadBook(bookName) {
    if (!bookName) return null;
    try {
        const data = await loadWorldInfo(bookName);
        return data || null;
    } catch (e) {
        utils.logger.warn(`Failed to load worldbook ${bookName}:`, e);
        return null;
    }
}

/**
 * Aggregates entry positions across multiple worldbooks into a slot occupancy map.
 *
 * Positions 0,1,2,3,5,6 are one-dimensional timelines indexed by `order`.
 *   0=Before Char, 1=After Char, 2=Before AN, 3=After AN, 5=Before EM, 6=After EM
 * Position 4 (@Depth) is a 2D grid keyed by (depth, order); role is preserved on slots.
 * Position 7 (Outlet) is not aggregated — it requires plugin-specific outlet routing.
 *
 * Within each position bucket, ST sorts activated entries by `b.order - a.order` then
 * `unshift`s into the bucket, which inverts the order — final injection order is
 * ASCENDING by `order` within each position (lower `order` is read first by the LLM).
 *
 * @param {string[]} bookNames
 * @returns {Promise<{
 *   bookNames: string[],
 *   timelines: Record<0|1|2|3|5|6, Array<{order:number, slots: SlotInfo[]}>>,
 *   depthGrid: Array<{depth:number, order:number, slots: SlotInfo[]}>,
 *   bounds: {orderMin:number, orderMax:number, depthMin:number, depthMax:number}
 * }>}
 */
export async function getOccupancyMap(bookNames) {
    if (!Array.isArray(bookNames)) bookNames = [];

    const TIMELINE_POSITIONS = [0, 1, 2, 3, 5, 6];
    const timelinesByPos = {};
    for (const p of TIMELINE_POSITIONS) timelinesByPos[p] = new Map();
    const grid = new Map();
    let orderMin = Infinity, orderMax = -Infinity;
    let depthMin = Infinity, depthMax = -Infinity;

    for (const bookName of bookNames) {
        try {
            const wb = await loadWorldInfo(bookName);
            if (!wb || !wb.entries) continue;
            for (const entry of Object.values(wb.entries)) {
                const pos = Number(entry.position ?? 0);
                const order = Number(entry.order ?? 100);
                const keys = Array.isArray(entry.key) ? entry.key : [];
                const slot = {
                    bookName,
                    uid: entry.uid,
                    comment: entry.comment || '',
                    keyPreview: keys.slice(0, 3).map(String),
                    keyCount: keys.length,
                    constant: !!entry.constant,
                    disable: !!entry.disable,
                    position: pos,
                    order,
                };

                if (Number.isFinite(order)) {
                    if (order < orderMin) orderMin = order;
                    if (order > orderMax) orderMax = order;
                }

                if (pos === 4) {
                    const depth = Number(entry.depth ?? 0);
                    slot.depth = depth;
                    // role: 0=system, 1=user, 2=assistant (matches ST extension_prompt_roles)
                    slot.role = entry.role !== undefined && entry.role !== null ? Number(entry.role) : 0;
                    if (Number.isFinite(depth)) {
                        if (depth < depthMin) depthMin = depth;
                        if (depth > depthMax) depthMax = depth;
                    }
                    const key = `${depth}|${order}`;
                    if (!grid.has(key)) grid.set(key, { depth, order, slots: [] });
                    grid.get(key).slots.push(slot);
                } else if (timelinesByPos[pos]) {
                    const map = timelinesByPos[pos];
                    if (!map.has(order)) map.set(order, { order, slots: [] });
                    map.get(order).slots.push(slot);
                }
            }
        } catch (e) {
            utils.logger.warn(`getOccupancyMap: failed to load ${bookName}`, e);
        }
    }

    const timelines = {};
    for (const p of TIMELINE_POSITIONS) {
        timelines[p] = Array.from(timelinesByPos[p].values()).sort((a, b) => a.order - b.order);
    }
    const depthGrid = Array.from(grid.values()).sort((a, b) =>
        a.depth !== b.depth ? a.depth - b.depth : a.order - b.order,
    );

    if (orderMin === Infinity) orderMin = 0;
    if (orderMax === -Infinity) orderMax = 0;
    if (depthMin === Infinity) depthMin = 0;
    if (depthMax === -Infinity) depthMax = 0;

    return {
        bookNames: [...bookNames],
        timelines,
        depthGrid,
        bounds: { orderMin, orderMax, depthMin, depthMax },
    };
}

/**
 * Wrapper to fetch everything together.
 */
export async function fetchWorldbookEntriesDashboardData() {
    const activeBooks = await getAllActiveWorldBookNames();
    const entries = await getAllActiveEntries(activeBooks);

    return {
        activeBooks,
        entries,
        totalEntries: entries.length
    };
}

/**
 * Updates properties of a specific worldbook entry and saves it.
 * @param {string} worldBookName - Source worldbook name
 * @param {number} uid - The entry UID
 * @param {object} updates - Object containing properties to update (e.g. { order: 10, disable: false })
 */
export async function updateEntryProperties(worldBookName, uid, updates) {
    try {
        const wbOriginal = await loadWorldInfo(worldBookName);
        if (!wbOriginal || !wbOriginal.entries || !wbOriginal.entries[uid]) {
            throw new Error(`Entry UID ${uid} not found in worldbook ${worldBookName}`);
        }

        // Clone and update
        const worldBookData = structuredClone(wbOriginal);
        Object.assign(worldBookData.entries[uid], updates);

        // Save
        await saveWorldInfo(worldBookName, worldBookData, true);
        utils.logger.info(`Updated entry ${uid} in ${worldBookName}:`, updates);
        return true;
    } catch (error) {
        utils.logger.error(`Failed to update entry in ${worldBookName}:`, error);
        throw error;
    }
}

/**
 * Creates a new entry in a worldbook with optional initial fields, then persists.
 * @param {string} worldBookName
 * @param {object} [partial] - optional initial fields to apply on top of the template
 * @returns {Promise<{uid: number, entry: object}>}
 */
export async function createEntryInBook(worldBookName, partial = {}) {
    if (!worldBookName) throw new Error('createEntryInBook: missing worldBookName');
    /** @type {any} */
    const wbOriginal = await loadWorldInfo(worldBookName);
    if (!wbOriginal || !wbOriginal.entries) {
        throw new Error(`Worldbook ${worldBookName} not found or has no entries map`);
    }

    /** @type {any} */
    const worldBookData = structuredClone(wbOriginal);
    /** @type {any} */
    const newEntry = createWorldInfoEntry(worldBookName, worldBookData);
    if (!newEntry || !Number.isInteger(newEntry.uid)) {
        throw new Error('createWorldInfoEntry returned no usable entry');
    }

    if (partial && typeof partial === 'object') {
        Object.assign(worldBookData.entries[newEntry.uid], partial);
    }

    await saveWorldInfo(worldBookName, worldBookData, true);
    utils.logger.info(`Created entry uid=${newEntry.uid} in ${worldBookName}`);
    return { uid: newEntry.uid, entry: worldBookData.entries[newEntry.uid] };
}

/**
 * Deletes an entry from a worldbook and persists.
 * @param {string} worldBookName
 * @param {number} uid
 * @returns {Promise<boolean>}
 */
export async function deleteEntryFromBook(worldBookName, uid) {
    if (!worldBookName) throw new Error('deleteEntryFromBook: missing worldBookName');
    /** @type {any} */
    const wbOriginal = await loadWorldInfo(worldBookName);
    if (!wbOriginal || !wbOriginal.entries) {
        throw new Error(`Worldbook ${worldBookName} not found or has no entries map`);
    }
    if (!(uid in wbOriginal.entries)) {
        throw new Error(`Entry UID ${uid} not found in worldbook ${worldBookName}`);
    }

    /** @type {any} */
    const worldBookData = structuredClone(wbOriginal);
    delete worldBookData.entries[uid];

    await saveWorldInfo(worldBookName, worldBookData, true);
    utils.logger.info(`Deleted entry uid=${uid} from ${worldBookName}`);
    return true;
}
