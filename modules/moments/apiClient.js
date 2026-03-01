
// modules/moments/apiClient.js — 后端 API Client & Wrappers

import { MOMENTS_LOG_PREFIX, logMoments } from './constants.js';
import { getSettings, getFeedCache, setFeedCache } from './state.js';
import { updateSettings } from './settings.js';
import { avatarCache, saveLocalFeed, createLocalPost, addLocalComment, sortFeedCache } from './persistence.js';

// ═══════════════════════════════════════════════════════════════════════
// Core API Client
// ═══════════════════════════════════════════════════════════════════════

export async function apiRequest(method, path, body = null) {
    const settings = getSettings();
    if (!settings.backendUrl) {
        throw new Error('Backend URL not configured');
    }

    let baseUrl = settings.backendUrl.trim();
    if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);

    const url = `${baseUrl}${path}`;
    const headers = {
        'Content-Type': 'application/json',
    };

    if (settings.secretToken) {
        headers['Authorization'] = `Bearer ${settings.secretToken}`;
    }
    if (settings.authToken) {
        headers['X-Session-Token'] = settings.authToken;
    }

    const opts = { method, headers };
    if (body && method !== 'GET') {
        opts.body = JSON.stringify(body);
    }

    const response = await fetch(url, opts);
    if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        throw new Error(`API ${method} ${path} failed: ${response.status} — ${errorText} `);
    }
    return response.json();
}

// ═══════════════════════════════════════════════════════════════════════
// Auth Wrappers
// ═══════════════════════════════════════════════════════════════════════

export async function login(username, password) {
    const result = await apiRequest('POST', '/api/auth/login', { username, password });
    const settings = getSettings();
    if (result.token && result.user) {
        let serverSettings = {};
        try {
            if (result.user.settings && typeof result.user.settings === 'string') {
                serverSettings = JSON.parse(result.user.settings);
            } else if (result.user.settings && typeof result.user.settings === 'object') {
                serverSettings = result.user.settings;
            }
        } catch (e) {
            console.warn('Failed to parse settings from server:', e);
        }

        updateSettings({
            authToken: result.token,
            userId: result.user.id,
            username: result.user.username,
            displayName: result.user.displayName,
            avatarUrl: result.user.avatarUrl || settings.avatarUrl,
            ...serverSettings
        }, true);
        return result.user;
    }
    throw new Error('Invalid login response');
}

export async function register(username, password, displayName) {
    const result = await apiRequest('POST', '/api/auth/register', { username, password, displayName });
    const settings = getSettings();
    if (result.token && result.user) {
        let serverSettings = {};
        try {
            if (result.user.settings && typeof result.user.settings === 'string') {
                serverSettings = JSON.parse(result.user.settings);
            } else if (result.user.settings && typeof result.user.settings === 'object') {
                serverSettings = result.user.settings;
            }
        } catch (e) {
            console.warn('Failed to parse settings from server:', e);
        }

        updateSettings({
            authToken: result.token,
            userId: result.user.id,
            username: result.user.username,
            displayName: result.user.displayName,
            avatarUrl: result.user.avatarUrl || settings.avatarUrl,
            ...serverSettings
        }, true);
        return result.user;
    }
    throw new Error('Invalid register response');
}

export async function logout() {
    try {
        await apiRequest('POST', '/api/auth/logout');
    } catch (e) {
        console.warn('Logout API failed, clearing local state anyway');
    }
    updateSettings({
        authToken: '',
        username: '',
        userId: '',
        displayName: 'Guest',
        avatarUrl: ''
    });
}

export async function getUserInfo() {
    const settings = getSettings();
    if (!settings.authToken) return null;
    try {
        const result = await apiRequest('GET', '/api/auth/me');
        if (result.user) {
            let serverSettings = {};
            try {
                if (result.user.settings && typeof result.user.settings === 'string') {
                    serverSettings = JSON.parse(result.user.settings);
                } else if (result.user.settings && typeof result.user.settings === 'object') {
                    serverSettings = result.user.settings;
                }
            } catch (e) {
                console.warn('Failed to parse settings from server:', e);
            }

            updateSettings({
                userId: result.user.id,
                username: result.user.username,
                displayName: result.user.displayName,
                avatarUrl: result.user.avatarUrl || settings.avatarUrl,
                ...serverSettings
            }, true);
            return result.user;
        }
    } catch (e) {
        if (e.message?.includes('401')) {
            updateSettings({ authToken: '' }, true);
        }
    }
    return null;
}

export async function getUserProfile(userId) {
    if (!userId) return null;
    return apiRequest('GET', `/api/users/${userId}`);
}

// ═══════════════════════════════════════════════════════════════════════
// Convenience API Wrappers
// ═══════════════════════════════════════════════════════════════════════

export async function registerUser() {
    const settings = getSettings();
    return apiRequest('POST', '/api/users/register', {
        id: settings.userId,
        displayName: settings.displayName || 'User',
        avatarUrl: settings.avatarUrl || '',
    });
}

export async function addFriend(friendId) {
    const settings = getSettings();
    return apiRequest('POST', '/api/users/friends', {
        userId: settings.userId,
        friendId,
    });
}

export async function removeFriend(friendId) {
    const settings = getSettings();
    return apiRequest('DELETE', '/api/users/friends', {
        userId: settings.userId,
        friendId,
    });
}

export async function listFriends() {
    const settings = getSettings();
    return apiRequest('GET', `/api/users/${settings.userId}/friends`);
}

export async function createPost(content, authorName = null, authorAvatar = null, imageUrl = null) {
    const settings = getSettings();

    // Try backend first
    if (settings.backendUrl && settings.secretToken) {
        try {
            const result = await apiRequest('POST', '/api/posts', {
                authorId: settings.userId,
                authorName: authorName || settings.displayName || 'Anonymous',
                authorAvatar: authorAvatar || settings.avatarUrl || '',
                content,
                imageUrl,
            });
            if (result && result.post) {
                const feedCache = getFeedCache();
                if (!feedCache.find(p => p.id === result.post.id)) {
                    if (result.post.authorAvatar && result.post.authorAvatar.startsWith('data:image')) {
                        const encodedName = encodeURIComponent(result.post.authorName || 'Anonymous');
                        const cacheId = `avatar_${result.post.authorId}_${encodedName}`;
                        await avatarCache.set(cacheId, result.post.authorAvatar);
                        result.post.authorAvatar = `cache:${cacheId}`;
                    }
                    setFeedCache([result.post, ...feedCache]);
                    sortFeedCache();
                    saveLocalFeed();
                    window.dispatchEvent(new CustomEvent('moments-feed-updated', { detail: { posts: getFeedCache() } }));
                }

                // Allow character to react to newly generated posts
                setTimeout(async () => {
                    const { queueComment, maybeGenerateLike } = await import('./generation.js');
                    queueComment(result.post);
                    maybeGenerateLike(result.post);
                }, 1000);
            }
            return result;
        } catch (e) {
            console.warn(`${MOMENTS_LOG_PREFIX} Backend post failed, saving locally:`, e);
        }
    }
    // Local fallback (no backend configured or backend failed)
    const localPost = createLocalPost(content, authorName, authorAvatar, imageUrl);
    setTimeout(async () => {
        const { queueComment, maybeGenerateLike } = await import('./generation.js');
        queueComment(localPost);
        maybeGenerateLike(localPost);
    }, 1000);
    return localPost;
}

export async function publishPost(postId) {
    const settings = getSettings();
    if (!settings.backendUrl || !settings.secretToken) {
        throw new Error('需要配置后端连接才能发布到云端');
    }

    const feedCache = getFeedCache();
    const postToPublish = feedCache.find(p => p.id === postId);
    if (!postToPublish) {
        throw new Error('未找到该动态');
    }

    let { content, authorName, authorAvatar, imageUrl, authorId } = postToPublish;

    if (authorId === 'local_user' || String(authorId).startsWith('char_')) {
        authorId = settings.userId;
    }

    const result = await apiRequest('POST', '/api/posts', {
        authorId,
        authorName,
        authorAvatar,
        content,
        imageUrl,
    });

    if (result && result.post) {
        // Replace the local draft with the published post
        setFeedCache(feedCache.filter(p => p.id !== postId));

        const newFeedCache = getFeedCache();
        if (!newFeedCache.find(p => p.id === result.post.id)) {
            if (result.post.authorAvatar && result.post.authorAvatar.startsWith('data:image')) {
                const encodedName = encodeURIComponent(result.post.authorName || 'Anonymous');
                const cacheId = `avatar_${result.post.authorId}_${encodedName}`;
                await avatarCache.set(cacheId, result.post.authorAvatar);
                result.post.authorAvatar = `cache:${cacheId}`;
            }
            newFeedCache.unshift(result.post);
        }
        sortFeedCache();

        saveLocalFeed();
        window.dispatchEvent(new CustomEvent('moments-feed-updated', {
            detail: { posts: getFeedCache() }
        }));
        import('./momentsWorldInfo.js').then(m => m.updateMomentsWorldInfo()).catch(() => { });

        logMoments(`Published draft: ${postId} -> ${result.post.id}`);

        setTimeout(async () => {
            const { queueComment, maybeGenerateLike } = await import('./generation.js');
            queueComment(result.post);
            maybeGenerateLike(result.post);
        }, 1000);

        return result.post;
    } else {
        throw new Error('发布失败，服务器返回异常');
    }
}

export async function getFeed(since = null) {
    const settings = getSettings();
    let path = `/api/posts/feed/${settings.userId}`;
    if (since) path += `?since=${encodeURIComponent(since)}`;
    return apiRequest('GET', path);
}

export async function getPostDetail(postId) {
    return apiRequest('GET', `/api/posts/${postId}`);
}

export async function addComment(postId, content, authorName = null, replyToId = null, replyToName = null, authorAvatar = null) {
    const settings = getSettings();
    // Always update local cache
    const localComment = addLocalComment(postId, content, authorName, replyToId, replyToName, authorAvatar);

    // Also send to backend if configured
    if (settings.backendUrl && settings.secretToken && !postId.startsWith('local_')) {
        try {
            const backendResult = await apiRequest('POST', `/api/posts/${postId}/comments`, {
                authorId: settings.userId,
                authorName: authorName || settings.displayName || 'Anonymous',
                content,
                replyToId,
                replyToName,
                authorAvatar,
            });

            if (backendResult && backendResult.comment) {
                setTimeout(async () => {
                    const { queueReply } = await import('./generation.js');
                    const feedCache = getFeedCache();
                    const post = feedCache.find(p => p.id === postId);
                    if (post) queueReply(post, backendResult.comment);
                }, 1000);
            }
            return backendResult;
        } catch (e) {
            console.warn(`${MOMENTS_LOG_PREFIX} Backend comment failed, saved locally only:`, e);
        }
    } else {
        // Local only fallback
        setTimeout(async () => {
            const { queueReply } = await import('./generation.js');
            const feedCache = getFeedCache();
            const post = feedCache.find(p => p.id === postId);
            if (post) queueReply(post, localComment);
        }, 1000);
    }
    return localComment;
}

export async function getComments(postId) {
    return apiRequest('GET', `/api/posts/${postId}/comments`);
}

export async function toggleLike(postId) {
    const settings = getSettings();
    const feedCache = getFeedCache();
    // Update local cache first
    const post = feedCache.find(p => p.id === postId);
    let liked = false;
    if (post) {
        post.likedByMe = !post.likedByMe;
        post.likeCount = (post.likeCount || 0) + (post.likedByMe ? 1 : -1);
        liked = post.likedByMe;
        saveLocalFeed();
    }

    // Sync to backend if configured
    if (settings.backendUrl && settings.secretToken) {
        try {
            return await apiRequest('POST', `/api/posts/${postId}/like`, {
                userId: settings.userId,
                userName: settings.displayName || 'Anonymous',
            });
        } catch (e) {
            console.warn(`${MOMENTS_LOG_PREFIX} Backend like failed, saved locally only:`, e);
        }
    }
    return { ok: true, liked };
}
