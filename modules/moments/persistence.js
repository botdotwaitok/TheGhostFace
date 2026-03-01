
// modules/moments/persistence.js — 本地存储、AvatarCache、本地数据操作

import { LOCAL_FEED_KEY_PREFIX, MOMENTS_LOG_PREFIX, getCharacterId, logMoments } from './constants.js';
import { getSettings, getFeedCache, setFeedCache } from './state.js';
import { saveSettings } from './settings.js';
import { getNotificationType, addNotification } from './notifications.js';
import { getContext } from '../../../../../extensions.js';

// ═══════════════════════════════════════════════════════════════════════
// Avatar Cache System (IndexedDB)
// ═══════════════════════════════════════════════════════════════════════

class AvatarCache {
    constructor() {
        this.dbName = 'GhostFaceMomentsDB';
        this.storeName = 'avatars';
        this.db = null;
        this.initPromise = this.init();
    }

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, 1);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve();
            };
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    db.createObjectStore(this.storeName, { keyPath: 'id' });
                }
            };
        });
    }

    async get(id) {
        await this.initPromise;
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const request = store.get(id);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result?.data || null);
        });
    }

    async set(id, data) {
        await this.initPromise;
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.put({ id, data, timestamp: Date.now() });
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve();
        });
    }
}

export const avatarCache = new AvatarCache();

// ═══════════════════════════════════════════════════════════════════════
// Local Feed Persistence
// ═══════════════════════════════════════════════════════════════════════

export function saveLocalFeed() {
    try {
        const feedCache = getFeedCache();
        if (feedCache.length > 50) feedCache.length = 50;
        const key = `${LOCAL_FEED_KEY_PREFIX}${getCharacterId()}`;
        localStorage.setItem(key, JSON.stringify(feedCache));
    } catch (e) {
        console.warn(`${MOMENTS_LOG_PREFIX} Failed to save local feed: `, e);
    }
}

export function loadLocalFeed() {
    try {
        const key = `${LOCAL_FEED_KEY_PREFIX}${getCharacterId()}`;
        const raw = localStorage.getItem(key);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                setFeedCache(parsed);
                sortFeedCache();
                logMoments(`已从本地加载 ${parsed.length} 条动态`);
            }
        }
    } catch (e) {
        console.warn(`${MOMENTS_LOG_PREFIX} Failed to load local feed: `, e);
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Feed Cache Utilities
// ═══════════════════════════════════════════════════════════════════════

export function sortFeedCache() {
    const feedCache = getFeedCache();
    feedCache.sort((a, b) => {
        // Pending posts (drafts) always at the top
        if (a.pendingUpload && !b.pendingUpload) return -1;
        if (!a.pendingUpload && b.pendingUpload) return 1;
        // Then sort by createdAt descending
        return new Date(b.createdAt) - new Date(a.createdAt);
    });
}

// ═══════════════════════════════════════════════════════════════════════
// Local Post / Comment CRUD
// ═══════════════════════════════════════════════════════════════════════

/**
 * Create a post object locally (no backend required).
 * Returns the new post and prepends it to feedCache.
 */
export function createLocalPost(content, authorName = null, authorAvatar = null, imageUrl = null, pendingUpload = false) {
    const settings = getSettings();
    let finalAuthorId = settings.userId || 'guest';
    let finalAuthorUsername = settings.username || '';
    const myName = settings.displayName || 'Anonymous';
    const myCamoName = settings.customUserName || '';
    const stUserName = _getUserNameFallback();

    if (authorName && authorName !== myName && authorName !== myCamoName && authorName !== stUserName) {
        finalAuthorId = `char_${authorName}`;
        finalAuthorUsername = authorName;
    }

    const post = {
        id: `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        authorId: finalAuthorId,
        authorUsername: finalAuthorUsername,
        authorName: authorName || myName,
        authorAvatar: authorAvatar || settings.avatarUrl || '',
        content,
        imageUrl: imageUrl || null,
        createdAt: new Date().toISOString(),
        likeCount: 0,
        likedByMe: false,
        commentCount: 0,
        comments: [],
        isLocal: true,
        pendingUpload: !!pendingUpload,
    };
    const feedCache = getFeedCache();
    setFeedCache([post, ...feedCache]);
    sortFeedCache();
    saveLocalFeed();
    window.dispatchEvent(new CustomEvent('moments-feed-updated', {
        detail: { posts: getFeedCache() }
    }));
    // Lazy import to avoid circular dependency
    import('./momentsWorldInfo.js').then(m => m.updateMomentsWorldInfo()).catch(() => { });
    return post;
}

export async function deletePost(postId) {
    const feedCache = getFeedCache();
    // 1. Remove from local cache
    const index = feedCache.findIndex(p => p.id === postId);
    if (index !== -1) {
        feedCache.splice(index, 1);
        saveLocalFeed();
        window.dispatchEvent(new CustomEvent('moments-feed-updated', {
            detail: { posts: feedCache }
        }));
        try {
            const { updateMomentsWorldInfo } = await import('./momentsWorldInfo.js');
            await updateMomentsWorldInfo();
        } catch { }
    }

    // 2. Remove from backend if connected
    if (postId.startsWith('local_')) {
        return;
    }

    const settings = getSettings();
    if (settings.backendUrl) {
        try {
            const { apiRequest } = await import('./apiClient.js');
            await apiRequest('DELETE', `/api/posts/${postId}`, {
                userId: settings.userId
            });
            logMoments(`已删除动态: ${postId} `);
        } catch (e) {
            if (e.message && e.message.includes('404')) {
                logMoments(`后端未找到动态 ${postId} (视为已删除)`);
            } else {
                console.warn(`${MOMENTS_LOG_PREFIX} Backend delete failed: `, e);
            }
        }
    }
}

/**
 * Add a comment locally to a post already in feedCache.
 */
export function addLocalComment(postId, content, authorName = null, replyToId = null, replyToName = null, authorAvatar = null) {
    const feedCache = getFeedCache();
    const settings = getSettings();
    const post = feedCache.find(p => p.id === postId);
    if (!post) return null;
    if (!post.comments) post.comments = [];

    let finalAuthorId = settings.userId || 'guest';
    let finalAuthorUsername = settings.username || '';
    const myName = settings.displayName || 'Anonymous';
    const myCamoName = settings.customUserName || '';
    const stUserName = _getUserNameFallback();

    if (authorName && authorName !== myName && authorName !== myCamoName && authorName !== stUserName) {
        finalAuthorId = `char_${authorName}`;
        finalAuthorUsername = authorName;
    }

    const comment = {
        id: `local_c_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        postId,
        authorId: finalAuthorId,
        authorUsername: finalAuthorUsername,
        authorName: authorName || myName,
        authorAvatar: authorAvatar || null,
        content,
        replyToId: replyToId || null,
        replyToName: replyToName || null,
        createdAt: new Date().toISOString(),
    };
    post.comments.push(comment);
    if (post.comments.length > 50) post.comments.shift(); // keep newest 50
    post.commentCount = post.comments.length;
    saveLocalFeed();
    import('./momentsWorldInfo.js').then(m => m.updateMomentsWorldInfo()).catch(() => { });

    // Notification check
    const notifyType = getNotificationType(post, comment);
    if (notifyType) {
        addNotification({
            id: comment.id,
            type: notifyType,
            postId: postId,
            commentId: comment.id,
            authorName: comment.authorName,
            authorAvatar: comment.authorAvatar,
            authorId: comment.authorId,
            content: content,
            createdAt: comment.createdAt
        });
    }

    return comment;
}

export async function deleteComment(postId, commentId) {
    const feedCache = getFeedCache();
    const post = feedCache.find(p => p.id === postId);
    if (!post || !post.comments) return;

    // 1. Remove from local cache
    const index = post.comments.findIndex(c => c.id === commentId);
    if (index !== -1) {
        post.comments.splice(index, 1);
        post.commentCount = post.comments.length;
        saveLocalFeed();
        window.dispatchEvent(new CustomEvent('moments-feed-updated', {
            detail: { posts: feedCache }
        }));
        try {
            const { updateMomentsWorldInfo } = await import('./momentsWorldInfo.js');
            await updateMomentsWorldInfo();
        } catch { }
    }

    // 2. Remove from backend if connected
    if (commentId.startsWith('local_')) {
        return;
    }

    const settings = getSettings();
    if (settings.backendUrl) {
        try {
            const { apiRequest } = await import('./apiClient.js');
            await apiRequest('DELETE', `/api/posts/${postId}/comments/${commentId}`, {
                userId: settings.userId
            });
            logMoments(`已删除评论: ${commentId} `);
        } catch (e) {
            if (e.message && e.message.includes('404')) {
                logMoments(`后端未找到评论 ${commentId} (视为已删除)`);
            } else {
                console.warn(`${MOMENTS_LOG_PREFIX} Backend delete comment failed: `, e);
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Internal helper
// ═══════════════════════════════════════════════════════════════════════

function _getUserNameFallback() {
    try {
        const context = getContext();
        return context.name1 || 'User';
    } catch {
        return 'User';
    }
}
