
// modules/moments/sync.js — 同步引擎 & 生命周期管理

import { MOMENTS_LOG_PREFIX, logMoments } from './constants.js';
import {
    getSettings, getFeedCache, setFeedCache, getSyncTimerId, setSyncTimerId,
    getConsecutiveFailures, setConsecutiveFailures, resetConsecutiveFailures,
    incrementConsecutiveFailures, MAX_CONSECUTIVE_FAILURES
} from './state.js';
import { getFeed } from './apiClient.js';
import { avatarCache, saveLocalFeed, sortFeedCache } from './persistence.js';
import { getNotificationType, addNotification } from './notifications.js';
import { queueComment, queueReply, maybeGenerateLike } from './generation.js';

// ═══════════════════════════════════════════════════════════════════════
// Sync Engine
// ═══════════════════════════════════════════════════════════════════════

export async function syncFeed(force = false) {
    const settings = getSettings();
    if (!settings.backendUrl || !settings.secretToken) return;

    try {
        const result = await getFeed();

        // Reset failure count on success
        if (getConsecutiveFailures() > 0) {
            resetConsecutiveFailures();
        }

        if (result.ok && result.posts) {
            // Process incoming avatars to save localStorage space
            for (const post of result.posts) {
                if (post.authorAvatar && post.authorAvatar.startsWith('data:image')) {
                    const encodedName = encodeURIComponent(post.authorName || 'Anonymous');
                    const cacheId = `avatar_${post.authorId}_${encodedName}`;
                    await avatarCache.set(cacheId, post.authorAvatar);
                    post.authorAvatar = `cache:${cacheId}`;
                }
            }

            const feedCache = getFeedCache();
            const existingIds = new Set(feedCache.map(p => p.id));
            const newPosts = result.posts.filter(p => !existingIds.has(p.id));

            // Keep local-only posts that aren't in backend yet
            const backendIds = new Set(result.posts.map(p => p.id));
            const localOnlyPosts = feedCache.filter(p => p.isLocal && !backendIds.has(p.id));

            // Check for new comments on EXISTING posts
            const oldPostsMap = new Map(feedCache.map(p => [p.id, p]));

            // Replace cache completely
            setFeedCache([...result.posts, ...localOnlyPosts]);
            sortFeedCache();

            // Limit interactions to the 5 most recent posts
            const currentFeed = getFeedCache();
            const top5Posts = currentFeed.slice(0, 5);
            const top5Ids = new Set(top5Posts.map(p => p.id));

            if (newPosts.length > 0) {
                (async () => {
                    for (const post of newPosts) {
                        if (!top5Ids.has(post.id)) continue;
                        await queueComment(post);
                        await maybeGenerateLike(post);
                    }
                })().catch(e => console.warn(`${MOMENTS_LOG_PREFIX} Auto-interaction failed:`, e));
            }

            const newCommentsToReply = [];
            const myName = settings.displayName || 'Anonymous';
            for (const backendPost of result.posts) {
                const localPost = oldPostsMap.get(backendPost.id);
                if (localPost) {
                    const localCommentIds = new Set(localPost.comments.map(c => c.id));
                    const newComments = backendPost.comments.filter(c => !localCommentIds.has(c.id));
                    for (const newComment of newComments) {
                        if (top5Ids.has(backendPost.id)) {
                            newCommentsToReply.push({ post: backendPost, comment: newComment });
                        }

                        // Notification check for synced comments
                        const notifyType = getNotificationType(backendPost, newComment);
                        if (notifyType) {
                            addNotification({
                                id: newComment.id,
                                type: notifyType,
                                postId: backendPost.id,
                                commentId: newComment.id,
                                authorName: newComment.authorName,
                                authorAvatar: newComment.authorAvatar,
                                authorId: newComment.authorId,
                                content: newComment.content,
                                createdAt: newComment.createdAt
                            });
                        }
                    }
                }
            }

            if (newCommentsToReply.length > 0) {
                (async () => {
                    for (const item of newCommentsToReply) {
                        await queueReply(item.post, item.comment);
                    }
                })().catch(e => console.warn(`${MOMENTS_LOG_PREFIX} Reply queueing failed:`, e));
            }
        }

        // Persist merged feed locally
        saveLocalFeed();

        // Dispatch event for UI to re-render
        window.dispatchEvent(new CustomEvent('moments-feed-updated', {
            detail: { posts: getFeedCache() }
        }));

        // Update World Info for Main LLM context
        import('./momentsWorldInfo.js').then(m => m.updateMomentsWorldInfo()).catch(() => { });
    } catch (e) {
        console.warn(`${MOMENTS_LOG_PREFIX} Sync failed:`, e);

        // Circuit Breaker Logic
        incrementConsecutiveFailures();
        if (getConsecutiveFailures() >= MAX_CONSECUTIVE_FAILURES) {
            console.warn(`${MOMENTS_LOG_PREFIX} Too many connection failures (${getConsecutiveFailures()}). Stopping auto-sync.`);
            logMoments(`无法连接服务器，已切换为离线模式`);
            stopSync();
            window.dispatchEvent(new CustomEvent('moments-sync-stopped', {
                detail: { reason: 'connection_failure' }
            }));
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Lifecycle Management
// ═══════════════════════════════════════════════════════════════════════

export function startSync() {
    stopSync();
    const settings = getSettings();
    if (!settings.enabled) return;

    // Initial sync
    resetConsecutiveFailures();
    syncFeed();

    // Periodic sync
    setSyncTimerId(setInterval(() => syncFeed(), settings.syncInterval));

    logMoments('云端已成功连接');
}

export function stopSync() {
    const timerId = getSyncTimerId();
    if (timerId) {
        clearInterval(timerId);
        setSyncTimerId(null);
    }
}
