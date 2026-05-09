
// modules/moments/constants.js — 共享常量 & 工具函数

import { getContext } from '../../../../../../extensions.js';

// ═══════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════

export const MODULE_NAME = 'the_ghost_face';
export const SETTINGS_KEY_PREFIX = `${MODULE_NAME}_moments_v1_`;
export const LOCAL_FEED_KEY_PREFIX = `${MODULE_NAME}_moments_feed_v1_`;
export const MOMENTS_LOG_PREFIX = '[朋友圈]';

export const defaultSettings = {
    backendUrl: '',
    secretToken: '',
    authToken: '',      // Login session token
    username: '',       // Login username
    userId: '',
    displayName: '',
    avatarUrl: '',
    autoPostChance: 0.8,        // 80% chance after each message
    autoCommentChance: 0.8,     // 80% chance to comment on friends' posts
    autoLikeChance: 0.8,        // 80% chance to like friends' posts
    syncInterval: 60 * 1000,    // 60 seconds
    enabled: false,
    showFloatingIcon: true,     // whether to show the floating icon shortcut
    notifications: [],          // Unread notifications
    customUserName: '',         // UI camouflage for User
    customCharName: '',         // UI camouflage for Character
};

// ═══════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════

// Returns the per-character namespace `char_{id}` when a character is active,
// or `null` when no character is loaded (e.g. during character-switch transitions
// or before any character is selected). Callers MUST guard against null on write
// paths — previously we returned a sentinel like 'global_fallback' which silently
// swallowed writes into a shared namespace and polluted other characters' data.
export function getCharacterId() {
    try {
        const context = getContext();
        if (context.characterId !== undefined && context.characterId !== null) {
            return `char_${context.characterId}`;
        }
        return null;
    } catch {
        return null;
    }
}

export function logMoments(msg) {
    if (typeof window.logger !== 'undefined' && window.logger.info) {
        window.logger.info(`${MOMENTS_LOG_PREFIX} ${msg}`);
    } else {
        console.log(`${MOMENTS_LOG_PREFIX} ${msg}`);
    }
}
