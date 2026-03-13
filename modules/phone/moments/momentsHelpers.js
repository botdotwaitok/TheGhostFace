
// modules/moments/momentsHelpers.js — 共享 Helper 函数
// 从 generation.js, notifications.js, momentsWorldInfo.js, persistence.js, momentsUI.js
// 中提取的重复函数统一到此处。

import { MOMENTS_LOG_PREFIX, getCharacterId } from './constants.js';
import { getSettings } from './state.js';
import { getContext } from '../../../../../../extensions.js';

// ═══════════════════════════════════════════════════════════════════════
// Author / Identity Helpers
// ═══════════════════════════════════════════════════════════════════════

/**
 * Returns a Set of all authorIds that belong to "me" (current user + current character).
 * Previously duplicated in: generation.js, notifications.js, momentsWorldInfo.js
 */
export function getMyAuthorIds() {
    const settings = getSettings();
    const ids = new Set();
    if (settings.userId) ids.add(settings.userId);
    ids.add('guest');
    const charId = getCharacterId(); // char_{numericId}
    ids.add(charId);
    return ids;
}

/**
 * Get the ST user's display name (name1), with fallback.
 * Previously duplicated in: persistence.js, notifications.js, momentsWorldInfo.js
 */
export function getUserNameFallback() {
    try {
        const context = getContext();
        return context.name1 || 'User';
    } catch {
        return 'User';
    }
}

// Alias for backward compatibility (moments.getUserName() is used by momentsUI.js)
export const getUserName = getUserNameFallback;

/**
 * Get the current character's name, with fallback.
 * Previously in: notifications.js
 */
export function getCharNameFallback() {
    try {
        const context = getContext();
        const charId = context.characterId;
        const charData = (context.characters ?? [])[charId];
        return charData ? (charData.name || context.name2 || 'Character') : null;
    } catch {
        return null;
    }
}

/**
 * Get full character info object (name, description, personality, scenario, avatar).
 * Previously duplicated in: moments.js (getCharacterInfo), momentsWorldInfo.js (_getCharacterInfo)
 */
export function getCharacterInfo() {
    try {
        const context = getContext();
        const charId = context.characterId;
        const charData = (context.characters ?? [])[charId];
        if (!charData) return null;

        return {
            name: charData.name || context.name2 || 'Character',
            description: charData.description || charData.data?.description || '',
            personality: charData.personality || charData.data?.personality || '',
            scenario: charData.scenario || charData.data?.scenario || '',
            avatar: charData.avatar || '',
        };
    } catch (e) {
        console.warn(`${MOMENTS_LOG_PREFIX} getCharacterInfo failed:`, e);
        return null;
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Utility Helpers
// ═══════════════════════════════════════════════════════════════════════

/**
 * Convert a URL to base64 data URI.
 * Previously duplicated in: generation.js, momentsWorldInfo.js
 */
export async function getBase64FromUrl(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) return '';
        const blob = await response.blob();
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = () => resolve('');
            reader.readAsDataURL(blob);
        });
    } catch (e) {
        console.warn(`${MOMENTS_LOG_PREFIX} Failed to convert image to base64: ${url}`, e);
        return '';
    }
}

/**
 * Show a toast notification inside the phone UI.
 * This is the canonical version — auto-creates the container if missing.
 * Previously had inconsistent versions in: momentsUI.js (full), generation.js (simplified), momentsWorldInfo.js (simplified)
 */
export function showToast(msg) {
    // Create a simple toast notification
    let container = document.getElementById('moments_toast_container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'moments_toast_container';
        container.className = 'moments-toast-container';
        // Append inside the phone UI so the toast is visible within the phone viewport
        const phoneParent = document.getElementById('phone_overlay')
            || document.getElementById('moments_panel_overlay')
            || document.body;
        phoneParent.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = 'moments-toast';
    toast.textContent = msg;
    container.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('moments-toast-show'));

    setTimeout(() => {
        toast.classList.remove('moments-toast-show');
        toast.classList.add('moments-toast-hide');
        setTimeout(() => toast.remove(), 300);
    }, 2500);
}
