
// modules/moments/settings.js — 设置管理

import { extension_settings } from '../../../../../../extensions.js';
import { saveSettingsDebounced } from '../../../../../../../script.js';
import { SETTINGS_KEY_PREFIX, MOMENTS_LOG_PREFIX, getCharacterId, defaultSettings } from './constants.js';
import { getSettings, setSettings, getSettingsSyncTimeout, setSettingsSyncTimeout } from './state.js';

// ═══════════════════════════════════════════════════════════════════════
// Settings Management
// ═══════════════════════════════════════════════════════════════════════

export function loadSettings() {
    try {
        const charId = getCharacterId();
        // 切角色瞬间 characterId 可能短暂为 undefined。此时仅暴露 defaults +
        // global identity，避免读到/写入 char_undefined 这种污染键。
        if (!charId) {
            const globalSettings = extension_settings?.the_ghost_face?.moments?.global || {};
            setSettings({ ...defaultSettings, ...globalSettings });
            return getSettings();
        }
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

        // 一次性清理：notifications 早期被错误地存为全局，导致跨角色泄漏。
        // 现已改为 per-character 存储，把 stale 的全局数组删掉。
        if (globalSettings.notifications !== undefined) {
            delete globalSettings.notifications;
            extension_settings.the_ghost_face.moments.global = globalSettings;
            saveSettingsDebounced();
        }

        // Try load from extension_settings first
        if (extension_settings.the_ghost_face.moments[charId]) {
            charSettings = extension_settings.the_ghost_face.moments[charId];
            // 已迁移成功，本次启动可以放心清理 legacy key（这次进入这个分支
            // 说明 extension_settings 已经把数据真正落盘了）。
            if (localStorage.getItem(localKey)) {
                localStorage.removeItem(localKey);
            }
        } else {
            // Fallback: migrate from legacy localStorage
            const savedLocal = localStorage.getItem(localKey);
            if (savedLocal) {
                try {
                    charSettings = JSON.parse(savedLocal);

                    // Migrate global settings out if not set yet
                    const globalKeys = ['backendUrl', 'secretToken', 'authToken', 'username', 'userId', 'displayName', 'avatarUrl', 'customUserName', 'discordBound'];
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
                    // 不在这里删除 legacy key：saveSettingsDebounced 是异步的，
                    // 如果浏览器在落盘前崩溃，数据会两边都丢。等下次 loadSettings
                    // 命中 extension_settings 分支后再清理。
                } catch (e) {
                    console.warn(`${MOMENTS_LOG_PREFIX} Failed to parse legacy settings:`, e);
                }
            }
        }

        // Merge: defaults → global (auth/identity) → char-specific (probabilities etc.)
        // Strip global keys from charSettings to prevent stale legacy values from
        // overriding the authoritative globalSettings (e.g. authToken, userId).
        // discordBound 是 per-account 状态（服务端按账号存），不能 per-character 存，
        // 否则切换角色后第一次请求总会因 undefined 触发一次失败往返。
        const globalKeys = new Set(['backendUrl', 'secretToken', 'authToken', 'username', 'userId', 'displayName', 'avatarUrl', 'customUserName', 'discordBound']);
        const charOnly = {};
        for (const [k, v] of Object.entries(charSettings)) {
            if (!globalKeys.has(k)) charOnly[k] = v;
        }
        const settings = { ...defaultSettings, ...globalSettings, ...charOnly };
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
        const charId = getCharacterId();
        // 没有角色加载时跳过 per-character 写入。globalSettings 仍然按下面流程
        // 落到 .moments.global，所以登录态/avatar 等不会丢。
        if (!charId) {
            const settingsForGlobalOnly = getSettings();
            if (!extension_settings.the_ghost_face) extension_settings.the_ghost_face = {};
            if (!extension_settings.the_ghost_face.moments) extension_settings.the_ghost_face.moments = {};
            const globalKeys = ['backendUrl', 'secretToken', 'authToken', 'username', 'userId', 'displayName', 'avatarUrl', 'customUserName', 'discordBound'];
            const globalSettingsObj = extension_settings.the_ghost_face.moments.global || {};
            for (const k of globalKeys) {
                if (settingsForGlobalOnly[k] !== undefined) globalSettingsObj[k] = settingsForGlobalOnly[k];
            }
            extension_settings.the_ghost_face.moments.global = globalSettingsObj;
            if (typeof saveSettingsDebounced === 'function') saveSettingsDebounced();
            return;
        }
        const settings = getSettings();

        if (!extension_settings.the_ghost_face) {
            extension_settings.the_ghost_face = {};
        }
        if (!extension_settings.the_ghost_face.moments) {
            extension_settings.the_ghost_face.moments = {};
        }

        const globalKeys = ['backendUrl', 'secretToken', 'authToken', 'username', 'userId', 'displayName', 'avatarUrl', 'customUserName', 'discordBound'];
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

    // Only sync if the fields tracked by the backend actually changed.
    // customCharName 是 per-character 本地设置，不参与同步（见 apiClient.SERVER_SETTINGS_WHITELIST）
    const backendFieldsChanged = partial.hasOwnProperty('autoPostChance') ||
        partial.hasOwnProperty('autoCommentChance') ||
        partial.hasOwnProperty('autoLikeChance') ||
        partial.hasOwnProperty('customUserName');

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
            // customCharName 故意不上送：per-character 本地设置
        };

        await apiRequest('PUT', `/api/users/${settings.userId}/settings`, {
            settings: syncPayload
        });
    } catch (e) {
        console.warn(`${MOMENTS_LOG_PREFIX} Failed to sync settings to server: `, e);
    }
}
