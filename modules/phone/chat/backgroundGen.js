// modules/phone/chat/backgroundGen.js — Background LLM task manager
// Decouples API calls from DOM rendering so generation continues
// even when the user leaves the chat interface.
// Includes auto-retry with exponential backoff on failure.

import { callPhoneLLM } from '../../api.js';
import { buildChatSystemPrompt, buildChatUserPrompt, stripMomentsCommands } from './chatPromptBuilder.js';

// ═══════════════════════════════════════════════════════════════════════
// Config
// ═══════════════════════════════════════════════════════════════════════

const MAX_RETRIES = 3;              // Total retry attempts after first failure
const RETRY_DELAYS = [5, 15, 30];   // Seconds before each retry (escalating)

// ═══════════════════════════════════════════════════════════════════════
// State
// ═══════════════════════════════════════════════════════════════════════

let _pendingResult = null;   // { rawResponse, messagesToSend } | null
let _isGenerating = false;
let _error = null;           // Error string if generation failed (all retries exhausted)
let _cancelled = false;      // True if user cancelled the retry
let _retryTimer = null;      // setTimeout ID for current retry countdown (for cancellation)

const LOG_PREFIX = '[后台生成]';

// ═══════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════

/**
 * Start a background LLM generation with auto-retry on failure.
 * On completion, stores the result in memory and dispatches
 * a 'phone-chat-response-ready' event so the UI layer can decide
 * whether to render immediately or defer.
 *
 * @param {string[]} messagesToSend - User messages that were sent
 * @param {Array} historyBeforeSend - Chat history BEFORE the user messages were appended
 */
export async function startBackgroundGeneration(messagesToSend, historyBeforeSend) {
    _isGenerating = true;
    _error = null;
    _pendingResult = null;
    _cancelled = false;

    // Build prompts once (no need to rebuild on retry)
    let systemPrompt, userPrompt;
    try {
        systemPrompt = await buildChatSystemPrompt();
        userPrompt = buildChatUserPrompt(messagesToSend, historyBeforeSend);
    } catch (promptErr) {
        console.error(`${LOG_PREFIX} Prompt building failed:`, promptErr);
        _error = promptErr.message || 'Prompt building failed';
        _isGenerating = false;
        _dispatchReady(false);
        return;
    }

    // ── Attempt loop (1 initial + MAX_RETRIES retries) ──
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (_cancelled) {
            console.log(`${LOG_PREFIX} Cancelled by user.`);
            _error = '已取消重试';
            break;
        }

        try {
            console.log(`${LOG_PREFIX} Attempt ${attempt + 1}/${MAX_RETRIES + 1}: sending ${messagesToSend.length} messages...`);

            const rawResponse = await callPhoneLLM(systemPrompt, userPrompt, { maxTokens: 4000 });

            // ── Route moments commands (fire-and-forget, doesn't affect retry) ──
            try {
                const { handleMainChatOutput } = await import('../moments/momentsWorldInfo.js');
                handleMainChatOutput(rawResponse).catch(e =>
                    console.warn(`${LOG_PREFIX} Moments routing failed:`, e));
            } catch (e) { /* moments module not loaded */ }

            // ── Success! Store result and exit loop ──
            _pendingResult = { rawResponse, messagesToSend };
            _error = null;
            console.log(`${LOG_PREFIX} Generation succeeded on attempt ${attempt + 1}.`);
            break;

        } catch (error) {
            console.error(`${LOG_PREFIX} Attempt ${attempt + 1} failed:`, error);

            if (attempt < MAX_RETRIES && !_cancelled) {
                // ── Notify UI about retry countdown ──
                const retryDelay = RETRY_DELAYS[attempt] || 30;
                window.dispatchEvent(new CustomEvent('phone-chat-retry', {
                    detail: {
                        attempt: attempt + 1,
                        maxRetries: MAX_RETRIES,
                        retryInSeconds: retryDelay,
                        error: error.message || 'Unknown error',
                    },
                }));

                // ── Wait with cancellable timer ──
                await _cancellableSleep(retryDelay * 1000);

                if (_cancelled) {
                    console.log(`${LOG_PREFIX} Cancelled during retry wait.`);
                    _error = '已取消重试';
                    break;
                }
                // Continue to next attempt...
            } else {
                // All retries exhausted
                _error = error.message || 'Unknown error';
            }
        }
    }

    _isGenerating = false;
    _dispatchReady(!_error);
}

/**
 * Cancel the current retry cycle.
 * If called during a retry countdown, the timer is cleared immediately.
 */
export function cancelRetry() {
    _cancelled = true;
    if (_retryTimer) {
        clearTimeout(_retryTimer);
        _retryTimer = null;
    }
}

/**
 * Consume and clear the pending result.
 * @returns {{ rawResponse: string, messagesToSend: string[] } | null}
 */
export function consumePendingResult() {
    const result = _pendingResult;
    _pendingResult = null;
    return result;
}

/**
 * Consume and clear the pending error.
 * @returns {string | null}
 */
export function consumeError() {
    const err = _error;
    _error = null;
    return err;
}

/** @returns {boolean} */
export function isBackgroundGenerating() {
    return _isGenerating;
}

/** @returns {boolean} */
export function hasPendingResult() {
    return !!_pendingResult;
}

/** @returns {boolean} */
export function hasError() {
    return !!_error;
}

// ═══════════════════════════════════════════════════════════════════════
// Internal Helpers
// ═══════════════════════════════════════════════════════════════════════

/** Dispatch the completion event */
function _dispatchReady(success) {
    window.dispatchEvent(new CustomEvent('phone-chat-response-ready', {
        detail: { success, error: _error },
    }));
}

/**
 * Sleep that can be interrupted by cancelRetry().
 * @param {number} ms
 */
function _cancellableSleep(ms) {
    return new Promise(resolve => {
        _retryTimer = setTimeout(() => {
            _retryTimer = null;
            resolve();
        }, ms);
    });
}
