// modules/phone/discord/discordAutoChat.js — Timer-driven auto group chat
// Members autonomously chat in random channels when auto-chat is enabled.
// Follows the same timer pattern as chat/autoMessage.js (setTimeout + recursive reschedule).

import {
    loadAutoChatConfig, loadServerConfig, loadMembers, getAllChannels,
    getNonUserMembers,
} from './discordStorage.js';
import { generateAutoConversation } from './discordMessageHandler.js';
import { tryAutoStartKeepAlive } from '../keepAlive.js';

const LOG = '[Discord AutoChat]';

// ═══════════════════════════════════════════════════════════════════════
// State
// ═══════════════════════════════════════════════════════════════════════

let _timer = null;
let _isGenerating = false;
let _generation = 0; // incremented on every start to invalidate stale callbacks

// ═══════════════════════════════════════════════════════════════════════
// Unread Tracking — channels with auto-chat activity not yet seen by user
// ═══════════════════════════════════════════════════════════════════════

/** @type {Map<string, number>} channelId → unread count */
const _unreadCounts = new Map();

/** @type {Array<Function>} */
const _unreadCallbacks = [];

// TODO: Wire into homeWidgets or app icon badge to show total unread
/**
 * Register a callback to be notified when unread counts change.
 * @param {Function} callback — Called with (channelId, count)
 * @returns {Function} Unsubscribe function
 */
export function onUnreadChange(callback) {
    _unreadCallbacks.push(callback);
    return () => {
        const idx = _unreadCallbacks.indexOf(callback);
        if (idx !== -1) _unreadCallbacks.splice(idx, 1);
    };
}

/**
 * Get the unread count for a specific channel.
 * @param {string} channelId
 * @returns {number}
 */
export function getUnreadCount(channelId) {
    return _unreadCounts.get(channelId) || 0;
}

// TODO: Wire into homeWidgets or app icon badge
/**
 * Get total unread across all channels.
 * @returns {number}
 */
export function getTotalUnread() {
    let total = 0;
    for (const count of _unreadCounts.values()) total += count;
    return total;
}

/**
 * Mark a channel as read (user opened it).
 * @param {string} channelId
 */
export function markChannelRead(channelId) {
    if (_unreadCounts.has(channelId)) {
        _unreadCounts.delete(channelId);
        _notifyUnread(channelId, 0);
    }
}

function _incrementUnread(channelId) {
    const current = _unreadCounts.get(channelId) || 0;
    _unreadCounts.set(channelId, current + 1);
    _notifyUnread(channelId, current + 1);
}

function _notifyUnread(channelId, count) {
    for (const cb of _unreadCallbacks) {
        try { cb(channelId, count); } catch (e) { /* */ }
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Timer Control
// ═══════════════════════════════════════════════════════════════════════

/**
 * Start the auto-chat timer loop.
 * Uses the configured interval with ±30% random jitter.
 * If already running, will restart with the latest config.
 */
export function startAutoChatTimer() {
    stopAutoChatTimer();

    const config = loadAutoChatConfig();
    if (!config.enabled) {
        console.log(`${LOG} Auto-chat disabled, timer not started`);
        return;
    }

    if (!loadServerConfig()) {
        console.log(`${LOG} No server initialized, timer not started`);
        return;
    }

    // Bump generation so any in-flight old callback won't reschedule
    const gen = ++_generation;

    // Random jitter: interval × random(0.7, 1.3)
    const baseMs = config.interval * 60 * 1000;
    const jitter = 0.7 + Math.random() * 0.6; // 0.7 ~ 1.3
    const actualMs = Math.round(baseMs * jitter);

    console.log(`${LOG} Timer started: ~${config.interval}min (actual: ${Math.round(actualMs / 60000)}min)`);

    // iOS keep-alive: ensure silent audio is running so the timer survives background
    tryAutoStartKeepAlive();

    _timer = setTimeout(async () => {
        await _onTimerFired();
        // Only reschedule if this generation is still current
        if (_generation === gen) {
            startAutoChatTimer();
        } else {
            console.log(`${LOG} Timer generation stale (${gen} vs ${_generation}), not rescheduling`);
        }
    }, actualMs);
}

/**
 * Stop the auto-chat timer.
 */
export function stopAutoChatTimer() {
    if (_timer) {
        clearTimeout(_timer);
        _timer = null;
    }
}

/**
 * Check if the auto-chat timer is currently running.
 * @returns {boolean}
 */
export function isTimerRunning() {
    return _timer !== null;
}

// ═══════════════════════════════════════════════════════════════════════
// Core Logic — Timer Fired
// ═══════════════════════════════════════════════════════════════════════

async function _onTimerFired() {
    const config = loadAutoChatConfig();
    if (!config.enabled || _isGenerating) {
        console.log(`${LOG} Skipping: ${!config.enabled ? 'disabled' : 'already generating'}`);
        return;
    }

    _isGenerating = true;

    try {
        // ─── 1. Pick a random channel (exclude rules/announcement channels) ───
        const allChannels = getAllChannels();
        const EXCLUDED_NAMES = ['规则', 'rules', 'rule', '公告', 'announce', 'announcement', '欢迎', 'welcome'];
        const channels = allChannels.filter(ch => {
            const lower = ch.name.toLowerCase();
            return !EXCLUDED_NAMES.some(kw => lower.includes(kw));
        });
        if (channels.length === 0) {
            console.log(`${LOG} No eligible channels available (all are rules/announce), skipping`);
            return;
        }

        const channel = channels[Math.floor(Math.random() * channels.length)];
        console.log(`${LOG} Selected channel: #${channel.name} (${channel.id})`);

        // ─── 2. Pick 2-4 random non-user members ───
        const nonUserMembers = getNonUserMembers();
        if (nonUserMembers.length < 2) {
            console.log(`${LOG} Not enough members (${nonUserMembers.length}), need at least 2`);
            return;
        }

        const participantCount = Math.min(
            nonUserMembers.length,
            2 + Math.floor(Math.random() * 3), // 2, 3, or 4
        );
        const participants = _pickRandom(nonUserMembers, participantCount);

        console.log(`${LOG} Participants: ${participants.map(p => p.name).join(', ')}`);

        // ─── 3. Generate conversation ───
        const result = await generateAutoConversation(channel.id, participants);

        if (result.success && result.messageCount > 0) {
            console.log(`${LOG} Auto-chat generated: ${result.messageCount} messages in #${channel.name}`);

            // ─── 4. Update unread if user is not viewing this channel ───
            if (!_isUserViewingChannel(channel.id)) {
                // Add unread count for each message
                for (let i = 0; i < result.messageCount; i++) {
                    _incrementUnread(channel.id);
                }
            }
        } else if (result.error) {
            console.warn(`${LOG} Auto-chat failed:`, result.error);
        }
    } catch (e) {
        console.error(`${LOG} Auto-chat error:`, e);
    } finally {
        _isGenerating = false;
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════

/**
 * Pick N random items from an array (Fisher-Yates partial shuffle).
 * @param {Array} arr - Source array
 * @param {number} n - Number to pick
 * @returns {Array} Selected items
 */
function _pickRandom(arr, n) {
    const copy = [...arr];
    const result = [];
    const count = Math.min(n, copy.length);
    for (let i = 0; i < count; i++) {
        const idx = Math.floor(Math.random() * copy.length);
        result.push(copy.splice(idx, 1)[0]);
    }
    return result;
}

/**
 * Check if the user is currently viewing a specific channel in the Discord app.
 * @param {string} channelId
 * @returns {boolean}
 */
function _isUserViewingChannel(channelId) {
    const channelPage = document.getElementById('dc_channel_page');
    if (!channelPage) return false;
    const viewport = document.getElementById('phone_app_viewport');
    if (!viewport?.classList.contains('app-active')) return false;
    // Match the exact channelId stored in the DOM attribute
    return channelPage.dataset.channelId === channelId;
}
