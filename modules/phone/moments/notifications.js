
// modules/moments/notifications.js — 通知管理

import { getSettings } from './state.js';
import { getCharacterId } from './constants.js';
import { saveSettings } from './settings.js';
import { getContext } from '../../../../../../extensions.js';
import { getMyAuthorIds, getUserNameFallback, getCharNameFallback } from './momentsHelpers.js';

// ═══════════════════════════════════════════════════════════════════════
// Notification Management
// ═══════════════════════════════════════════════════════════════════════

export function getNotificationType(post, comment) {
    const settings = getSettings();
    const myName = settings.displayName || 'Anonymous';
    const myCamoName = settings.customUserName || '';
    const stUserName = getUserNameFallback();
    const myCharName = getCharNameFallback();
    const myCharCamoName = settings.customCharName || '';

    const isMe = comment.authorId === settings.userId || comment.authorName === myName || (settings.customUserName && comment.authorName === settings.customUserName) || comment.authorName === stUserName;
    if (isMe) return null;

    const targetNames = [myName, stUserName];
    if (myCamoName) targetNames.push(myCamoName);
    if (myCharName) targetNames.push(myCharName);
    if (myCharCamoName) targetNames.push(myCharCamoName);

    // 1. Is it a direct reply to me?
    const isReplyToMe = comment.replyToName && targetNames.includes(comment.replyToName);
    if (isReplyToMe) return 'reply';

    // 2. Regex check for "回复 user" (Requested filter)
    for (const name of targetNames) {
        const regex = new RegExp(`^回复\\s*${name}`, 'i');
        if (regex.test(comment.content)) return 'reply';
    }

    // 3. Is it a comment on my post? (and not a reply to someone else)
    const myAuthorIds = getMyAuthorIds();
    const isMyPost = myAuthorIds.has(post.authorId);
    if (isMyPost && !comment.replyToId) return 'comment';

    return null;
}

export function addNotification(notification) {
    const settings = getSettings();
    if (!settings.notifications) settings.notifications = [];
    if (!settings.notifications.find(n => n.id === notification.id)) {
        notification.read = false;
        settings.notifications.unshift(notification);
        if (settings.notifications.length > 25) settings.notifications.length = 25;
        saveSettings();
        window.dispatchEvent(new CustomEvent('moments-notifications-updated', {
            detail: { notifications: settings.notifications }
        }));
    }
}

export function markNotificationsRead(postId = null) {
    const settings = getSettings();
    if (!settings.notifications) return;
    let changed = false;
    for (const n of settings.notifications) {
        if (!n.read) {
            if (!postId || n.postId === postId) {
                n.read = true;
                changed = true;
            }
        }
    }
    if (changed) {
        saveSettings();
        window.dispatchEvent(new CustomEvent('moments-notifications-updated', {
            detail: { notifications: settings.notifications }
        }));
    }
}

export function getUnreadNotifications() {
    const settings = getSettings();
    return (settings.notifications || []).filter(n => !n.read);
}

export function clearNotifications() {
    const settings = getSettings();
    settings.notifications = [];
    saveSettings();
    window.dispatchEvent(new CustomEvent('moments-notifications-updated', {
        detail: { notifications: settings.notifications }
    }));
}
