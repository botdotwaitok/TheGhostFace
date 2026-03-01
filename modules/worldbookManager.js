import { getContext, extension_settings, } from '../../../../extensions.js';
import { chat_metadata, getMaxContextSize, generateRaw, streamingProcessor, main_api, system_message_types, saveSettingsDebounced, getRequestHeaders, saveChatDebounced, chat, this_chid, characters, reloadCurrentChat, } from '../../../../../script.js';
import { createWorldInfoEntry, deleteWIOriginalDataValue, deleteWorldInfoEntry, importWorldInfo, loadWorldInfo, saveWorldInfo, world_info } from '../../../../world-info.js';
import { eventSource, event_types } from '../../../../../script.js';
import { download, debounce, initScrollHeight, resetScrollHeight, parseJsonFile, extractDataFromPng, getFileBuffer, getCharaFilename, getSortableDelay, escapeRegex, PAGINATION_TEMPLATE, navigation_option, waitUntilCondition, isTrueBoolean, setValueByPath, flashHighlight, select2ModifyOptions, getSelect2OptionId, dynamicSelect2DataViaAjax, highlightRegex, select2ChoiceClickSubscribe, isFalseBoolean, getSanitizedFilename, checkOverwriteExistingData, getStringHash, parseStringArray, cancelDebounce, findChar, onlyUnique, equalsIgnoreCaseAndAccents } from '../../../../utils.js';

import * as core from './core.js';
import * as utils from './utils.js';
import * as worldbook from './worldbook.js';

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
                    const currentChid = utils.getCurrentChid();
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
