
// modules/moments/moments.js — 统一入口 & Re-Export
// 所有子模块通过此文件对外暴露，消费者（momentsUI.js, index.js）无需修改。

import { getContext } from '../../../../../extensions.js';
import { MOMENTS_LOG_PREFIX, getCharacterId, logMoments } from './constants.js';
import { getSettings as _getSettings, getFeedCache, setFeedCache, setLastCharacterId, getLastCharacterId, resetSettings } from './state.js';
import { loadSettings, saveSettings, updateSettings } from './settings.js';
import { loadLocalFeed, saveLocalFeed, sortFeedCache } from './persistence.js';
import { registerUser } from './apiClient.js';
import { startSync, stopSync } from './sync.js';
import { updateMomentsWorldInfo } from './momentsWorldInfo.js';

// ═══════════════════════════════════════════════════════════════════════
// Re-Exports — 维持对外 API 不变
// ═══════════════════════════════════════════════════════════════════════

// constants
export { logMoments } from './constants.js';

// state (only the public getters)
export { getSettings, getFeedCache } from './state.js';

// settings
export { loadSettings, saveSettings, updateSettings } from './settings.js';

// notifications
export { addNotification, markNotificationsRead, getUnreadNotifications, clearNotifications } from './notifications.js';

// persistence
export { avatarCache, saveLocalFeed, loadLocalFeed, createLocalPost, deletePost, addLocalComment, deleteComment, sortFeedCache } from './persistence.js';

// apiClient
export { apiRequest, login, register, logout, getUserInfo, getUserProfile, registerUser, addFriend, removeFriend, listFriends, createPost, publishPost, getFeed, getPostDetail, addComment, getComments, toggleLike } from './apiClient.js';

// generation
export { pendingInteractions, queueComment, queueReply, processPendingInteractions, maybeGeneratePost, maybeGenerateLike } from './generation.js';

// sync
export { syncFeed, startSync, stopSync } from './sync.js';

// worldinfo
export { updateMomentsWorldInfo, getMomentsSystemPrompt, handleMainChatOutput, showToast } from './momentsWorldInfo.js';

// ═══════════════════════════════════════════════════════════════════════
// Context Gathering (used by multiple sub-modules, kept here as canonical)
// ═══════════════════════════════════════════════════════════════════════

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

export function getUserName() {
    try {
        const context = getContext();
        return context.name1 || 'User';
    } catch {
        return 'User';
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Character Switch Handling
// ═══════════════════════════════════════════════════════════════════════

export async function onCharacterChanged() {
    const currentCharacterId = getCharacterId();
    if (getLastCharacterId() === currentCharacterId) return;
    setLastCharacterId(currentCharacterId);

    // 1. Stop existing sync to prevent data leak
    stopSync();

    // 2. Clear current memory cache
    setFeedCache([]);
    resetSettings();

    // 3. Reload settings and feed for the NEW character
    loadSettings();
    loadLocalFeed();

    // 4. Notify UI to clear/refresh immediately
    window.dispatchEvent(new CustomEvent('moments-feed-updated', {
        detail: { posts: getFeedCache() }
    }));

    // 5. Restart sync if enabled for this new character
    const settings = _getSettings();
    if (settings.enabled && settings.backendUrl && settings.secretToken) {
        try {
            await registerUser();
            startSync();
        } catch (e) {
            console.warn(`${MOMENTS_LOG_PREFIX} Restart sync failed:`, e);
        }
    } else {
        logMoments('当前角色未启用云端同步，仅使用本地存储');
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Initialize
// ═══════════════════════════════════════════════════════════════════════

export async function initialize() {
    setLastCharacterId(getCharacterId());
    loadSettings();

    // Always load local feed first — works even without backend
    loadLocalFeed();

    // Dispatch loaded posts so any open UI can render immediately
    const feedCache = getFeedCache();
    if (feedCache.length > 0) {
        window.dispatchEvent(new CustomEvent('moments-feed-updated', {
            detail: { posts: feedCache }
        }));
    }

    const settings = _getSettings();
    if (settings.enabled && settings.backendUrl && settings.secretToken) {
        try {
            await registerUser();
            startSync();
        } catch (e) {
            console.warn(`${MOMENTS_LOG_PREFIX} Init failed:`, e);
            logMoments('云端连接失败，使用本地存储模式');
        }
    } else {
        logMoments('朋友圈已初始化 (仅本地存储模式)');
    }
}
