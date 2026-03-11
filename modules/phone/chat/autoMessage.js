// modules/phone/chat/autoMessage.js — Timer-driven proactive messages
// Allows the character to initiate conversation when the user has been idle.
// Config is stored in localStorage; prompts are built via chatPromptBuilder.

import { callPhoneLLM } from '../../api.js';
import { loadChatHistory, saveChatHistory } from './chatStorage.js';
import { buildAutoMessageSystemPrompt, buildAutoMessageUserPrompt } from './chatPromptBuilder.js';
import { cleanLlmJson } from '../utils/llmJsonCleaner.js';
import { updateAppBadge } from '../phoneController.js';

// ═══════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════

const STORAGE_KEY = 'gf_phone_auto_msg_settings';
const LOG_PREFIX = '[主动消息]';

const DEFAULT_CONFIG = {
    enabled: false,
    interval: 30, // minutes — slider value, range 1~480 (8 hours)
};

// ═══════════════════════════════════════════════════════════════════════
// State
// ═══════════════════════════════════════════════════════════════════════

let _timer = null;
let _isGenerating = false;
let _pendingAutoMessages = null; // Array of { text, thought } | null

// ═══════════════════════════════════════════════════════════════════════
// Config Persistence (localStorage)
// ═══════════════════════════════════════════════════════════════════════

export function getConfig() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        return saved ? { ...DEFAULT_CONFIG, ...JSON.parse(saved) } : { ...DEFAULT_CONFIG };
    } catch { return { ...DEFAULT_CONFIG }; }
}

export function saveConfig(partial) {
    const config = { ...getConfig(), ...partial };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    return config;
}

// ═══════════════════════════════════════════════════════════════════════
// Idle Duration Calculation
// ═══════════════════════════════════════════════════════════════════════

/**
 * Calculate how long (ms) since the user's last message in phone chat.
 * Only considers phone chat history, NOT the ST main chat.
 * @returns {number} milliseconds since last user message, or Infinity if none
 */
export function getPhoneIdleDuration() {
    const history = loadChatHistory();
    const lastUserMsg = [...history].reverse().find(m => m.role === 'user');
    if (!lastUserMsg?.timestamp) return Infinity;
    return Date.now() - new Date(lastUserMsg.timestamp).getTime();
}

/**
 * Convert milliseconds to a human-readable Chinese string.
 * @param {number} ms
 * @returns {string} e.g. "3分钟", "1小时20分钟", "8小时"
 */
function humanizeMs(ms) {
    const totalMinutes = Math.floor(ms / 60000);
    if (totalMinutes < 1) return '不到1分钟';
    if (totalMinutes < 60) return `${totalMinutes}分钟`;
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    if (mins === 0) return `${hours}小时`;
    return `${hours}小时${mins}分钟`;
}

// ═══════════════════════════════════════════════════════════════════════
// Timer Control
// ═══════════════════════════════════════════════════════════════════════

/**
 * Start the auto-message timer loop.
 * Uses the configured interval with ±30% random jitter.
 */
export function startAutoMessageTimer() {
    stopAutoMessageTimer(); // Clear any existing timer

    const config = getConfig();
    if (!config.enabled) return;

    // Random jitter: interval × random(0.7, 1.3)
    const baseMs = config.interval * 60 * 1000;
    const jitter = 0.7 + Math.random() * 0.6; // 0.7 ~ 1.3
    const actualMs = Math.round(baseMs * jitter);

    console.log(`${LOG_PREFIX} Timer started: ~${config.interval}min (actual: ${Math.round(actualMs / 60000)}min)`);

    _timer = setTimeout(async () => {
        await _onTimerFired();
        // Recursively schedule next round
        startAutoMessageTimer();
    }, actualMs);
}

/**
 * Stop the auto-message timer.
 */
export function stopAutoMessageTimer() {
    if (_timer) {
        clearTimeout(_timer);
        _timer = null;
    }
}

/**
 * Reset the timer (called when user sends a message).
 * This restarts the idle countdown from zero.
 */
export function resetAutoMessageTimer() {
    const config = getConfig();
    if (!config.enabled) return;
    startAutoMessageTimer();
}

// ═══════════════════════════════════════════════════════════════════════
// Pending Auto Message Consumption (for chatApp.js)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Check if there are pending auto messages to render.
 * @returns {boolean}
 */
export function hasAutoMessagePending() {
    return !!_pendingAutoMessages;
}

/**
 * Consume and clear pending auto messages.
 * @returns {Array<{text: string, thought: string}>|null}
 */
export function consumeAutoMessages() {
    const msgs = _pendingAutoMessages;
    _pendingAutoMessages = null;
    return msgs;
}

// ═══════════════════════════════════════════════════════════════════════
// Core Generation Logic
// ═══════════════════════════════════════════════════════════════════════

/**
 * Called when the timer fires. Checks idle duration, then generates.
 */
async function _onTimerFired() {
    const config = getConfig();
    if (!config.enabled || _isGenerating) return;

    // Idle threshold: min(interval × 0.5, 10 minutes)
    const idleThresholdMs = Math.min(config.interval * 0.5 * 60 * 1000, 10 * 60 * 1000);
    const idleMs = getPhoneIdleDuration();

    if (idleMs < idleThresholdMs) {
        console.log(`${LOG_PREFIX} User not idle enough (${humanizeMs(idleMs)} < ${humanizeMs(idleThresholdMs)}), skipping.`);
        return;
    }

    // Don't generate if there are already pending messages waiting to be seen
    if (_pendingAutoMessages) {
        console.log(`${LOG_PREFIX} Previous auto message still pending, skipping.`);
        return;
    }

    console.log(`${LOG_PREFIX} User idle for ${humanizeMs(idleMs)}, generating auto message...`);

    _isGenerating = true;
    try {
        await _generateAutoMessage(idleMs);
    } catch (e) {
        console.error(`${LOG_PREFIX} Generation failed:`, e);
    } finally {
        _isGenerating = false;
    }
}

/**
 * Generate an auto message via LLM, save to history, notify UI.
 * @param {number} idleMs - How long the user has been idle (ms)
 */
async function _generateAutoMessage(idleMs) {
    const idleText = humanizeMs(idleMs);

    const systemPrompt = await buildAutoMessageSystemPrompt();
    const userPrompt = buildAutoMessageUserPrompt(idleText);

    const rawResponse = await callPhoneLLM(systemPrompt, userPrompt, { maxTokens: 2000 });

    // Parse JSON response
    let charMessages;
    try {
        const cleaned = cleanLlmJson(rawResponse);
        const parsed = JSON.parse(cleaned);
        charMessages = Array.isArray(parsed) ? parsed : [parsed];
    } catch (e) {
        console.error(`${LOG_PREFIX} Failed to parse LLM response:`, e);
        console.error(`${LOG_PREFIX} Raw response:`, rawResponse);
        return;
    }

    if (!charMessages || charMessages.length === 0) {
        console.warn(`${LOG_PREFIX} LLM returned empty messages.`);
        return;
    }

    // Save to chat history
    const history = loadChatHistory();
    const now = new Date().toISOString();

    for (const msg of charMessages) {
        const text = (msg.text || msg.content || '').trim();
        if (!text) continue;
        history.push({
            role: 'char',
            content: text,
            thought: msg.thought || '',
            timestamp: now,
        });
    }
    saveChatHistory(history);

    console.log(`${LOG_PREFIX} ✅ Auto message generated: ${charMessages.length} bubble(s)`);

    // Check if user is currently viewing the chat app
    const isInChat = _isUserInChatApp();

    if (isInChat) {
        // Store for immediate rendering by chatApp
        _pendingAutoMessages = charMessages;
        window.dispatchEvent(new CustomEvent('phone-auto-message-ready'));
    } else {
        // User not in chat — show badge
        updateAppBadge('chat', 1);
        // Also store so it renders when they open chat
        _pendingAutoMessages = charMessages;
    }
}

/**
 * Check if the user is currently viewing the chat app.
 */
function _isUserInChatApp() {
    const viewport = document.getElementById('phone_app_viewport');
    const chatRoot = document.getElementById('chat_page_root');
    return viewport?.classList.contains('app-active') && !!chatRoot;
}

// ═══════════════════════════════════════════════════════════════════════
// Slider Display Helper
// ═══════════════════════════════════════════════════════════════════════

/**
 * Convert a slider value (minutes) to a display label.
 * @param {number} minutes
 * @returns {string}
 */
export function formatIntervalLabel(minutes) {
    if (minutes < 60) return `${minutes}分钟`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (m === 0) return `${h}小时`;
    return `${h}小时${m}分`;
}
