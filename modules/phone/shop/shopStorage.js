// ui/phone/shop/shopStorage.js — Manages local inventory and active effects for purchased shop items
import { getShopReviews, postShopReview, deleteShopReview } from '../moments/apiClient.js';

/**
 * Data Structure stored in localStorage under 'gf_shop_state'
 * {
 *   inventory: { 'item_id': quantity },
 *   activeEffects: [
 *     { itemId: 'chat_mind_reader', remaining: 5, type: 'chatPrompt' }
 *   ]
 * }
 */

import { getShopItem } from './shopData.js';
import { applyTreeBuff } from './shopTreeBridge.js';

const STORAGE_KEY = 'gf_shop_state';

/** Load the entire shop state from localStorage */
function loadState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            return JSON.parse(raw);
        }
    } catch (e) {
        console.error('[GF Shop] Failed to parse shop state:', e);
    }
    return { inventory: {}, activeEffects: [] };
}

/** Save the entire shop state to localStorage */
function saveState(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// ═══════════════════════════════════════════════════════════════════════
// Inventory Management
// ═══════════════════════════════════════════════════════════════════════

/** Get current inventory object mapping item IDs to quantities */
export function getInventory() {
    const state = loadState();
    return state.inventory || {};
}

/** Check quantity of a specific item */
export function getItemQuantity(itemId) {
    const state = loadState();
    return (state.inventory && state.inventory[itemId]) || 0;
}

/** Add items to inventory */
export function addItemToInventory(itemId, quantity = 1) {
    const state = loadState();
    if (!state.inventory) state.inventory = {};
    if (!state.inventory[itemId]) state.inventory[itemId] = 0;
    state.inventory[itemId] += quantity;
    saveState(state);
    return state.inventory[itemId];
}

/** Remove items from inventory (returns true if successful, false if not enough) */
export function consumeItemFromInventory(itemId, quantity = 1) {
    const state = loadState();
    if (!state.inventory) state.inventory = {};
    if (!state.inventory[itemId] || state.inventory[itemId] < quantity) {
        return false;
    }
    state.inventory[itemId] -= quantity;
    if (state.inventory[itemId] === 0) {
        delete state.inventory[itemId];
    }
    saveState(state);
    return true;
}

// ═══════════════════════════════════════════════════════════════════════
// Active Effects Management
// ═══════════════════════════════════════════════════════════════════════

/** Add a new active effect (raw, used internally) */
export function addActiveEffect(itemId, duration, type) {
    const state = loadState();
    if (!state.activeEffects) state.activeEffects = [];
    
    // Same itemId → stack duration; different itemId → coexist
    const existingIdx = state.activeEffects.findIndex(e => e.itemId === itemId);
    if (existingIdx !== -1) {
        state.activeEffects[existingIdx].remaining += duration;
    } else {
        state.activeEffects.push({ itemId, remaining: duration, type });
    }
    
    saveState(state);
}

/** Get all current active effects */
export function getActiveEffects() {
    const state = loadState();
    return state.activeEffects || [];
}

/** Decrement duration of a specific effect */
export function decrementEffectCount(itemId) {
    const state = loadState();
    if (!state.activeEffects) return;
    
    const idx = state.activeEffects.findIndex(e => e.itemId === itemId);
    if (idx !== -1) {
        state.activeEffects[idx].remaining -= 1;
        if (state.activeEffects[idx].remaining <= 0) {
            state.activeEffects.splice(idx, 1);
        }
        saveState(state);
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Phase 2: Chat-Specific Active Effects API
// ═══════════════════════════════════════════════════════════════════════

/**
 * Activate a chat item from inventory.
 * Consumes 1 from inventory → adds to activeEffects.
 * Returns { success, message }.
 */
export function activateItem(itemId) {
    const item = getShopItem(itemId);
    if (!item) {
        return { success: false, message: '未知道具' };
    }

    // Check inventory
    const qty = getItemQuantity(itemId);
    if (qty <= 0) {
        return { success: false, message: '库存不足' };
    }

    // ── treeBuff: instant consumption, no active effect ──
    if (item.effectType === 'treeBuff') {
        const result = applyTreeBuff(itemId);
        if (result.success) {
            consumeItemFromInventory(itemId, 1);
        }
        return result;
    }

    // Consume 1 from inventory
    consumeItemFromInventory(itemId, 1);

    // Add to active effects (pranks use remaining=1 so they persist until consumed by chat)
    const effectDuration = item.effectType === 'prankReaction' ? 1 : item.duration;
    addActiveEffect(itemId, effectDuration, item.effectType);

    // Build activation message
    if (item.effectType === 'prankReaction') {
        return {
            success: true,
            message: `【${item.name}】已激活！下次聊天时将自动发动恶作剧 🎭`,
        };
    }

    const durationUnit = item.effectType === 'diaryPrompt' ? '次日记'
        : item.effectType === 'specialMessage' ? '次使用'
        : '条消息';

    return {
        success: true,
        message: `【${item.name}】已激活！持续 ${item.duration} ${durationUnit}`,
    };
}

/**
 * Get all active effects of type 'chatPrompt'.
 * Returns array of { itemId, remaining, type }.
 */
export function getActiveChatEffects() {
    return getActiveEffects().filter(e => e.type === 'chatPrompt');
}

/**
 * Decrement remaining count for ALL chatPrompt-type effects by 1.
 * Auto-removes effects that hit 0.
 * Returns array of expired effect itemIds (for UI notification).
 */
export function decrementChatEffects() {
    const state = loadState();
    if (!state.activeEffects) return [];

    const expired = [];
    state.activeEffects = state.activeEffects.filter(e => {
        if (e.type !== 'chatPrompt') return true; // keep non-chat effects untouched
        e.remaining -= 1;
        if (e.remaining <= 0) {
            expired.push(e.itemId);
            return false; // remove
        }
        return true;
    });

    saveState(state);
    return expired;
}

// ═══════════════════════════════════════════════════════════════════════
// Phase 3: Diary-Specific Active Effects API
// ═══════════════════════════════════════════════════════════════════════

/**
 * Get all active effects of type 'diaryPrompt'.
 * Returns array of { itemId, remaining, type }.
 */
export function getActiveDiaryEffects() {
    return getActiveEffects().filter(e => e.type === 'diaryPrompt');
}

/**
 * Decrement remaining count for ALL diaryPrompt-type effects by 1.
 * Auto-removes effects that hit 0.
 * Returns array of expired effect itemIds (for UI notification).
 */
export function decrementDiaryEffects() {
    const state = loadState();
    if (!state.activeEffects) return [];

    const expired = [];
    state.activeEffects = state.activeEffects.filter(e => {
        if (e.type !== 'diaryPrompt') return true; // keep non-diary effects untouched
        e.remaining -= 1;
        if (e.remaining <= 0) {
            expired.push(e.itemId);
            return false; // remove
        }
        return true;
    });

    saveState(state);
    return expired;
}

// ═══════════════════════════════════════════════════════════════════════
// Phase 4: Personality Override & Special Message Effects API
// ═══════════════════════════════════════════════════════════════════════

/**
 * Get all active effects of type 'personalityOverride'.
 * Returns array of { itemId, remaining, type }.
 */
export function getActivePersonalityOverrides() {
    return getActiveEffects().filter(e => e.type === 'personalityOverride');
}

/**
 * Decrement remaining count for ALL personalityOverride-type effects by 1.
 * Auto-removes effects that hit 0.
 * Returns array of expired effect itemIds (for UI notification).
 */
export function decrementPersonalityOverrides() {
    const state = loadState();
    if (!state.activeEffects) return [];

    const expired = [];
    state.activeEffects = state.activeEffects.filter(e => {
        if (e.type !== 'personalityOverride') return true;
        e.remaining -= 1;
        if (e.remaining <= 0) {
            expired.push(e.itemId);
            return false;
        }
        return true;
    });

    saveState(state);
    return expired;
}

/**
 * Get all active effects of type 'specialMessage'.
 * Returns array of { itemId, remaining, type }.
 */
export function getActiveSpecialMessageEffects() {
    return getActiveEffects().filter(e => e.type === 'specialMessage');
}

/**
 * Consume a specific specialMessage effect (one-shot removal).
 * Returns true if found and removed, false otherwise.
 */
export function consumeSpecialMessage(itemId) {
    const state = loadState();
    if (!state.activeEffects) return false;

    const idx = state.activeEffects.findIndex(e => e.itemId === itemId && e.type === 'specialMessage');
    if (idx === -1) return false;

    state.activeEffects.splice(idx, 1);
    saveState(state);
    return true;
}

// ═══════════════════════════════════════════════════════════════════════
// Phase 5: Prank Reaction Effects API
// ═══════════════════════════════════════════════════════════════════════

/**
 * Get all active effects of type 'prankReaction'.
 * Returns array of { itemId, remaining, type }.
 */
export function getActivePrankEffects() {
    return getActiveEffects().filter(e => e.type === 'prankReaction');
}

/**
 * Consume a specific prankReaction effect (one-shot removal).
 * Returns true if found and removed, false otherwise.
 */
export function consumePrankEffect(itemId) {
    const state = loadState();
    if (!state.activeEffects) return false;

    const idx = state.activeEffects.findIndex(e => e.itemId === itemId && e.type === 'prankReaction');
    if (idx === -1) return false;

    state.activeEffects.splice(idx, 1);
    saveState(state);
    return true;
}

// ═══════════════════════════════════════════════════════════════════════
// Phase 7: Robbery Buff Effects API
// ═══════════════════════════════════════════════════════════════════════

/**
 * Get all active effects of type 'robBuff'.
 * Returns array of { itemId, remaining, type }.
 */
export function getActiveRobBuffs() {
    return getActiveEffects().filter(e => e.type === 'robBuff');
}

/**
 * Consume a specific robBuff effect (one-shot removal).
 * Returns true if found and removed, false otherwise.
 */
export function consumeRobBuff(itemId) {
    const state = loadState();
    if (!state.activeEffects) return false;

    const idx = state.activeEffects.findIndex(e => e.itemId === itemId && e.type === 'robBuff');
    if (idx === -1) return false;

    state.activeEffects.splice(idx, 1);
    saveState(state);
    return true;
}

// ═══════════════════════════════════════════════════════════════════════
// Phase 8: Product Reviews API
// ═══════════════════════════════════════════════════════════════════════

const REVIEWS_KEY = 'gf_shop_reviews';

function loadReviews() {
    try {
        const raw = localStorage.getItem(REVIEWS_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch (e) {
        console.error('[GF Shop] Failed to parse reviews:', e);
        return {};
    }
}

function saveReviews(reviews) {
    localStorage.setItem(REVIEWS_KEY, JSON.stringify(reviews));
}

/**
 * Get all reviews for a specific item.
 * Returns array sorted newest-first.
 */
export function getReviews(itemId) {
    const all = loadReviews();
    return (all[itemId] || []).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

/**
 * Add a review for an item.
 * @param {string} itemId
 * @param {{ author: string, text: string, rating: number, isCharacter?: boolean }} review
 */
export function addReview(itemId, review) {
    const localId = `lr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const finalReview = {
        ...review,
        localId,
        date: new Date().toISOString().slice(0, 10),
    };
    // Save locally
    const all = loadReviews();
    if (!all[itemId]) all[itemId] = [];
    all[itemId].push(finalReview);
    saveReviews(all);

    // Also POST to server (fire-and-forget, local is the source of truth if this fails)
    postShopReview(itemId, finalReview).catch(e => {
        console.warn('[Shop] Failed to sync review to server:', e);
    });
}

/**
 * Delete a specific local review by its localId.
 * Also attempts to remove the review from the remote server (if it has a serverId / id field).
 * @param {string} itemId
 * @param {string} localId
 */
export function deleteReview(itemId, localId) {
    const all = loadReviews();
    if (!all[itemId]) return;
    const review = all[itemId].find(r => r.localId === localId);
    all[itemId] = all[itemId].filter(r => r.localId !== localId);
    saveReviews(all);

    // Fire-and-forget: delete from server if we stored the server-assigned id
    const serverId = review?.id || review?.serverId;
    if (serverId) {
        deleteShopReview(itemId, serverId).catch(e => {
            console.warn('[Shop] Failed to delete remote review:', e);
        });
    }
}

/**
 * Fallback delete for old reviews without a localId.
 * Matches by signature: "author|date|textPrefix".
 * @param {string} itemId
 * @param {string} signature
 */
export function deleteReviewBySignature(itemId, signature) {
    const all = loadReviews();
    if (!all[itemId]) return;
    all[itemId] = all[itemId].filter(r => {
        const sig = `${r.author}|${r.date}|${(r.text || '').slice(0, 30)}`;
        return sig !== signature;
    });
    saveReviews(all);
}

/**
 * Delete a remote-only review by its server-assigned ID.
 * Calls the remote API and also removes from local storage if present.
 * @param {string} itemId
 * @param {string} serverId
 */
export function deleteReviewByServerId(itemId, serverId) {
    // Remove from local storage if it happens to be there
    const all = loadReviews();
    if (all[itemId]) {
        all[itemId] = all[itemId].filter(r => (r.id || r._id) !== serverId);
        saveReviews(all);
    }
    // Delete from server
    deleteShopReview(itemId, serverId).catch(e => {
        console.warn('[Shop] Failed to delete remote review by serverId:', e);
    });
}

/**
 * Fetch remote reviews and merge with local ones.
 * Deduplicates by (author + date + text).
 * Returns merged array sorted newest-first.
 */
export async function getMergedReviews(itemId) {
    const localReviews = getReviews(itemId);
    let remoteReviews = [];
    try {
        remoteReviews = await getShopReviews(itemId);
    } catch (e) {
        // Silently fall back to local only
    }

    // Build a Set of local review signatures to detect duplicates
    const localSigs = new Set(
        localReviews.map(r => `${r.author}|${r.date}|${r.text?.slice(0, 30)}`)
    );

    // Only add remote reviews that aren't already local
    for (const rr of remoteReviews) {
        const sig = `${rr.author}|${rr.date}|${rr.text?.slice(0, 30)}`;
        if (!localSigs.has(sig)) {
            localReviews.push(rr);
        }
    }

    return localReviews.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}
