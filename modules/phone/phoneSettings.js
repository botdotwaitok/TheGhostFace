// modules/phone/phoneSettings.js — Centralized persistent settings for Phone extension
// Stores settings in extension_settings.the_ghost_face.phone (server-side, survives cache clear).
// Auto-migrates legacy localStorage values on first load.

import { extension_settings } from '../../../../../extensions.js';
import { saveSettingsDebounced } from '../../../../../../script.js';

const LOG = '[PhoneSettings]';
const EXT_KEY = 'the_ghost_face';
const PHONE_KEY = 'phone';

// ═══════════════════════════════════════════════════════════════════════
// Keys to migrate from localStorage → extension_settings
// Format: { lsKey: string, settingKey: string, type: 'string'|'boolean'|'json' }
// ═══════════════════════════════════════════════════════════════════════

const MIGRATION_MAP = [
    // Appearance
    { lsKey: 'gf_phone_dark_mode', settingKey: 'darkMode', type: 'boolean' },
    { lsKey: 'gf_phone_wallpaper', settingKey: 'wallpaper', type: 'string' },

    // Diary
    { lsKey: 'gf_phone_diary_enabled', settingKey: 'diaryEnabled', type: 'boolean', defaultVal: true },
    { lsKey: 'gf_phone_diary_mode', settingKey: 'diaryMode', type: 'string' },
    { lsKey: 'gf_phone_diary_theme', settingKey: 'diaryTheme', type: 'string' },
    { lsKey: 'gf_phone_diary_custom_vars', settingKey: 'diaryCustomVars', type: 'json' },

    // Memory / Summarize
    { lsKey: 'gf_phone_auto_summarize_memory', settingKey: 'autoSummarizeMemory', type: 'boolean', defaultVal: true },
    { lsKey: 'gf_phone_rh_memory', settingKey: 'rhMemory', type: 'boolean' },
    { lsKey: 'gf_phone_rh_sync_mode', settingKey: 'rhSyncMode', type: 'string' },

    // STT / TTS engine configs
    { lsKey: 'gf_phone_stt_settings', settingKey: 'sttSettings', type: 'json' },
    { lsKey: 'gf_phone_tts_settings', settingKey: 'ttsSettings', type: 'json' },

    // Ambient
    { lsKey: 'gf_phone_ambient_enabled', settingKey: 'ambientEnabled', type: 'boolean', defaultVal: true },
    { lsKey: 'gf_phone_ambient_custom_path', settingKey: 'ambientCustomPath', type: 'string' },
    { lsKey: 'gf_phone_ambient_custom_name', settingKey: 'ambientCustomName', type: 'string' },
    { lsKey: 'gf_phone_ambient_default_path', settingKey: 'ambientDefaultPath', type: 'string' },
];

// ═══════════════════════════════════════════════════════════════════════
// Internal: ensure nested object path exists
// ═══════════════════════════════════════════════════════════════════════

function _ensureRoot() {
    if (!extension_settings[EXT_KEY]) {
        extension_settings[EXT_KEY] = {};
    }
    if (!extension_settings[EXT_KEY][PHONE_KEY]) {
        extension_settings[EXT_KEY][PHONE_KEY] = {};
    }
    return extension_settings[EXT_KEY][PHONE_KEY];
}

// ═══════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════

/**
 * Get a phone setting value.
 * @param {string} key - Setting key (e.g. 'darkMode')
 * @param {*} [defaultValue] - Default if not set
 * @returns {*}
 */
export function getPhoneSetting(key, defaultValue = undefined) {
    const store = _ensureRoot();
    const val = store[key];
    return val !== undefined ? val : defaultValue;
}

/**
 * Set a phone setting value and persist to server.
 * @param {string} key
 * @param {*} value
 */
export function setPhoneSetting(key, value) {
    const store = _ensureRoot();
    store[key] = value;
    if (typeof saveSettingsDebounced === 'function') {
        saveSettingsDebounced();
    }
}

/**
 * Remove a phone setting.
 * @param {string} key
 */
export function removePhoneSetting(key) {
    const store = _ensureRoot();
    delete store[key];
    if (typeof saveSettingsDebounced === 'function') {
        saveSettingsDebounced();
    }
}

/**
 * Get the entire phone settings object (for bulk reads like STT/TTS).
 * @returns {object}
 */
export function getAllPhoneSettings() {
    return _ensureRoot();
}

// ═══════════════════════════════════════════════════════════════════════
// Init & Migration
// ═══════════════════════════════════════════════════════════════════════

/**
 * Initialize phone settings. Call once at extension startup.
 * Migrates any legacy localStorage values into extension_settings.
 */
export function initPhoneSettings() {
    const store = _ensureRoot();
    let migrated = 0;

    for (const { lsKey, settingKey, type } of MIGRATION_MAP) {
        // Skip if already present in persistent storage
        if (store[settingKey] !== undefined) continue;

        const raw = localStorage.getItem(lsKey);
        if (raw === null) continue;

        // Parse based on type
        let parsed;
        try {
            if (type === 'boolean') {
                parsed = raw === 'true';
            } else if (type === 'json') {
                parsed = JSON.parse(raw);
            } else {
                parsed = raw; // string
            }
        } catch (e) {
            console.warn(`${LOG} Failed to parse localStorage key "${lsKey}":`, e);
            continue;
        }

        store[settingKey] = parsed;
        migrated++;
        console.log(`${LOG} Migrated: ${lsKey} → phone.${settingKey}`);

        // Remove from localStorage to avoid confusion
        localStorage.removeItem(lsKey);
    }

    if (migrated > 0) {
        console.log(`${LOG} Migrated ${migrated} settings from localStorage → extension_settings`);
        if (typeof saveSettingsDebounced === 'function') {
            saveSettingsDebounced();
        }
    } else {
        console.log(`${LOG} No migration needed, ${Object.keys(store).length} settings loaded`);
    }
}
