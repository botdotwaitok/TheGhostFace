
// modules/moments/settings.js — 设置管理

import { extension_settings } from '../../../../../extensions.js';
import { saveSettingsDebounced } from '../../../../../../script.js';
import { SETTINGS_KEY_PREFIX, MOMENTS_LOG_PREFIX, getCharacterId, defaultSettings } from './constants.js';
import { getSettings, setSettings, getSettingsSyncTimeout, setSettingsSyncTimeout } from './state.js';

// ═══════════════════════════════════════════════════════════════════════
// Settings Management
// ═══════════════════════════════════════════════════════════════════════

export function loadSettings() {
    try {
        const charId = getCharacterId().trim();
        const localKey = `${SETTINGS_KEY_PREFIX}${charId}`;

        // Ensure the nested structure exists
        if (!extension_settings.the_ghost_face) {
            extension_settings.the_ghost_face = {};
        }
        if (!extension_settings.the_ghost_face.moments) {
            extension_settings.the_ghost_face.moments = {};
        }

        let charSettings = {};
        let globalSettings = extension_settings.the_ghost_face.moments.global || {};

        // Try load from extension_settings first
        if (extension_settings.the_ghost_face.moments[charId]) {
            charSettings = extension_settings.the_ghost_face.moments[charId];
        } else {
            // Fallback: migrate from legacy localStorage
            const savedLocal = localStorage.getItem(localKey);
            if (savedLocal) {
                try {
                    charSettings = JSON.parse(savedLocal);

                    // Migrate global settings out if not set yet
                    const globalKeys = ['backendUrl', 'secretToken', 'authToken', 'username', 'userId', 'displayName', 'avatarUrl', 'notifications', 'customUserName'];
                    if (!globalSettings.userId && charSettings.userId) {
                        for (const k of globalKeys) {
                            if (charSettings[k] !== undefined) {
                                globalSettings[k] = charSettings[k];
                            }
                        }
                        extension_settings.the_ghost_face.moments.global = globalSettings;
                    }

                    // Migrate it over
                    extension_settings.the_ghost_face.moments[charId] = charSettings;
                    saveSettingsDebounced();
                    console.log(`${MOMENTS_LOG_PREFIX} Migrated settings from localStorage to extension_settings for ${charId}`);
                    // Optionally remove the old localeStorage key to clean up space
                    localStorage.removeItem(localKey);
                } catch (e) {
                    console.warn(`${MOMENTS_LOG_PREFIX} Failed to parse legacy settings:`, e);
                }
            }
        }

        const settings = { ...defaultSettings, ...charSettings, ...globalSettings };
        setSettings(settings);

        // Generate userId if missing (legacy fallback)
        if (!settings.userId) {
            settings.userId = '';
            saveSettings();
        }
    } catch (e) {
        console.warn(`${MOMENTS_LOG_PREFIX} Failed to load settings:`, e);
    }
    return getSettings();
}

export function saveSettings() {
    try {
        const charId = getCharacterId().trim();
        const settings = getSettings();

        if (!extension_settings.the_ghost_face) {
            extension_settings.the_ghost_face = {};
        }
        if (!extension_settings.the_ghost_face.moments) {
            extension_settings.the_ghost_face.moments = {};
        }

        const globalKeys = ['backendUrl', 'secretToken', 'authToken', 'username', 'userId', 'displayName', 'avatarUrl', 'notifications', 'customUserName'];
        let charSettings = extension_settings.the_ghost_face.moments[charId] || {};
        let globalSettingsObj = extension_settings.the_ghost_face.moments.global || {};

        for (const [key, value] of Object.entries(settings)) {
            if (globalKeys.includes(key)) {
                globalSettingsObj[key] = value;
            } else {
                charSettings[key] = value;
            }
        }

        extension_settings.the_ghost_face.moments[charId] = charSettings;
        extension_settings.the_ghost_face.moments.global = globalSettingsObj;

        if (typeof saveSettingsDebounced === 'function') {
            saveSettingsDebounced();
        }
    } catch (e) {
        console.warn(`${MOMENTS_LOG_PREFIX} Failed to save settings:`, e);
    }
}

export function updateSettings(partial, skipSync = false) {
    const settings = getSettings();
    Object.assign(settings, partial);
    saveSettings();

    // Only sync if the fields tracked by the backend actually changed
    const backendFieldsChanged = partial.hasOwnProperty('autoPostChance') ||
        partial.hasOwnProperty('autoCommentChance') ||
        partial.hasOwnProperty('autoLikeChance') ||
        partial.hasOwnProperty('customUserName') ||
        partial.hasOwnProperty('customCharName');

    // Optionally sync settings to the server
    if (!skipSync && backendFieldsChanged && settings.userId && settings.authToken && settings.backendUrl) {
        const timeout = getSettingsSyncTimeout();
        if (timeout) clearTimeout(timeout);
        // Debounce sync for 2 seconds to avoid spamming the backend
        setSettingsSyncTimeout(setTimeout(() => {
            syncSettingsToServer();
        }, 2000));
    }
}

async function syncSettingsToServer() {
    // Lazy import to avoid circular dependency
    const { apiRequest } = await import('./apiClient.js');
    const settings = getSettings();
    try {
        const syncPayload = {
            autoPostChance: settings.autoPostChance,
            autoCommentChance: settings.autoCommentChance,
            autoLikeChance: settings.autoLikeChance,
            customUserName: settings.customUserName,
            customCharName: settings.customCharName,
        };

        await apiRequest('PUT', `/api/users/${settings.userId}/settings`, {
            settings: syncPayload
        });
    } catch (e) {
        console.warn(`${MOMENTS_LOG_PREFIX} Failed to sync settings to server: `, e);
    }
}
