// modules/phone/voiceCall/voiceCallUI.js — iPhone-style voice call interface
// Manages the full-screen call overlay, STT lifecycle, LLM interaction, and TTS playback.
// Uses callPhoneLLM() with dedicated vcPromptBuilder — fully independent from ST main chat.

import { getSttEngine } from './sttInit.js';
import { getPhoneCharInfo, getPhoneUserName } from '../phoneContext.js';
import { escapeHtml } from '../utils/helpers.js';
import { getTtsEngine } from './tts/ttsInit.js';
import { callPhoneLLM } from '../../api.js';
import { buildVcSystemPrompt, buildVcUserPrompt, generateCallSummary } from './vcPromptBuilder.js';
import { saveCallLog, generateCallId } from './vcStorage.js';

const LOG_PREFIX = '[VoiceCallUI]';

let _overlayMounted = false;
let _sttEngine = null;
let _ttsEngine = null;
let _callStartTime = 0;
let _timerInterval = null;

// ─── Call Session State ───
let _callId = null;
let _callMessages = [];    // Transcript: [{ role: 'user'|'char', content, timestamp }]
let _isProcessingLLM = false;  // Guard: prevent overlapping LLM requests
let _callOptions = {};     // Options passed from caller (e.g. { chatContext: true })

// ═══════════════════════════════════════════════════════════════════════
// Template & Mounting
// ═══════════════════════════════════════════════════════════════════════

const voiceCallTemplate = String.raw`
<div id="phone_voice_call_overlay" class="phone-voice-call-overlay">
    <div class="voice-call-bg" id="voice_call_bg"></div>
    <div class="voice-call-content">
        <div class="voice-call-header">
            <img src="" alt="Avatar" class="voice-call-avatar" id="voice_call_avatar">
            <div class="voice-call-name" id="voice_call_name">角色</div>
            <div class="voice-call-timer" id="voice_call_timer">拨号中...</div>
        </div>

        <div class="voice-call-subtitles" id="voice_call_subtitles">
            <!-- Subtitles injected here -->
        </div>

        <div class="voice-call-controls">
            <button class="voice-control-btn mic" id="voice_call_mic_btn">
                <i class="fa-solid fa-microphone"></i>
            </button>
            <button class="voice-control-btn hangup" id="voice_call_hangup_btn">
                <i class="fa-solid fa-phone-slash"></i>
            </button>
        </div>
    </div>
</div>`;

function _mountIfNeeded() {
    if (_overlayMounted) return;
    const container = document.querySelector('.phone-container');
    if (!container) return; // Phone not opened

    container.insertAdjacentHTML('beforeend', voiceCallTemplate);
    _overlayMounted = true;

    // Wait 1 frame so CSS transition works
    requestAnimationFrame(() => {
        const overlay = document.getElementById('phone_voice_call_overlay');
        if (overlay) overlay.classList.add('active');
    });
}

function _unmountUI() {
    const overlay = document.getElementById('phone_voice_call_overlay');
    if (overlay) {
        overlay.classList.remove('active');
        setTimeout(() => {
            overlay.remove();
            _overlayMounted = false;
        }, 300); // Wait for fade out
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════

/**
 * Open the true-voice-call UI.
 * @param {object} [options]
 * @param {boolean} [options.chatContext=false] - If true, inject chat context into the call prompt
 */
export async function openVoiceCall({ chatContext = false } = {}) {
    console.log(`${LOG_PREFIX} Opening Voice Call... (chatContext: ${chatContext})`);
    _sttEngine = getSttEngine();

    // Verify STT setup
    if (!_sttEngine.currentProvider) {
        alert('请先在"设置 → 语音通话"中配置一个语音识别引擎');
        return;
    }

    _mountIfNeeded();
    _initDOM();
    _bindEvents();

    // Init TTS engine
    _ttsEngine = getTtsEngine();

    // Init call session
    _callId = generateCallId();
    _callMessages = [];
    _isProcessingLLM = false;
    _callOptions = { chatContext };

    addSystemSubtitle('正在建立加密通话...');

    try {
        await _sttEngine.startListening({ continuous: true });
        _startTimer();

        // Remove '拨号中...' text and show 00:00
        const timerEl = document.getElementById('voice_call_timer');
        if (timerEl) timerEl.textContent = '00:00';

        // Let user know STT is ready
        if (_sttEngine.vadEnabled) {
            addSystemSubtitle('您可以开始说话了 (自动检测中)');
        } else {
            addSystemSubtitle('通话完毕请点击挂断，进行小总结');
        }

    } catch (e) {
        console.error(`${LOG_PREFIX} Start failed:`, e);
        addSystemSubtitle(`录音失败: ${e.message}`);
    }
}

/**
 * Close and clean up the voice call.
 */
export async function closeVoiceCall() {
    console.log(`${LOG_PREFIX} Closing Voice Call...`);

    // Stop STT Engine
    if (_sttEngine) {
        _sttEngine.stopListening();
        _sttEngine.onInterim = () => { };
        _sttEngine.onTranscript = () => { };
        _sttEngine.onStateChange = () => { };
    }

    // Stop TTS immediately
    if (_ttsEngine) {
        _ttsEngine.stop();
    }

    _stopTimer();

    // ── Save call log ──
    if (_callMessages.length > 0) {
        const endTime = new Date().toISOString();
        const duration = _callStartTime ? Math.floor((Date.now() - _callStartTime) / 1000) : 0;

        addSystemSubtitle('正在保存通话记录...');

        // Generate summary (async, don't block hangup)
        let summary = '';
        try {
            if (_callMessages.length >= 2) {
                summary = await generateCallSummary(_callMessages);
            }
        } catch (e) {
            console.warn(`${LOG_PREFIX} Summary generation failed:`, e);
        }

        const callLog = {
            id: _callId,
            startTime: new Date(_callStartTime).toISOString(),
            endTime,
            duration,
            summary,
            messages: [..._callMessages],
        };

        saveCallLog(callLog);
        console.log(`${LOG_PREFIX} Call log saved: ${_callMessages.length} messages, ${duration}s`);
    }

    // Reset session state
    _callId = null;
    _callMessages = [];
    _isProcessingLLM = false;
    _callOptions = {};

    _unmountUI();
}

// ═══════════════════════════════════════════════════════════════════════
// Internal Mechanics
// ═══════════════════════════════════════════════════════════════════════

function _initDOM() {
    const charInfo = getPhoneCharInfo();
    const charName = charInfo?.name || '未知联系人';
    const avatarUrl = charInfo?.avatar ? `/characters/${encodeURIComponent(charInfo.avatar)}` : '';

    const nameEl = document.getElementById('voice_call_name');
    const avatarEl = document.getElementById('voice_call_avatar');
    const bgEl = document.getElementById('voice_call_bg');

    if (nameEl) nameEl.textContent = charName;
    if (avatarEl && avatarUrl) avatarEl.src = avatarUrl;
    if (bgEl && avatarUrl) bgEl.style.backgroundImage = `url('${avatarUrl}')`;

    // Clear subtitles
    const subtitlesArea = document.getElementById('voice_call_subtitles');
    if (subtitlesArea) subtitlesArea.innerHTML = '';
}

function _bindEvents() {
    const hangupBtn = document.getElementById('voice_call_hangup_btn');
    const micBtn = document.getElementById('voice_call_mic_btn');

    if (hangupBtn) {
        hangupBtn.onclick = () => closeVoiceCall();
    }

    if (micBtn) {
        micBtn.onclick = () => {
            const isMuted = micBtn.classList.contains('muted');
            if (isMuted) {
                // Unmute
                micBtn.classList.remove('muted');
                micBtn.innerHTML = '<i class="fa-solid fa-microphone"></i>';
                if (_sttEngine.state === 'idle' && !_sttEngine.vadEnabled) {
                    _sttEngine.startListening({ continuous: true }).catch(e => console.error(e));
                }
            } else {
                // Mute
                micBtn.classList.add('muted');
                micBtn.innerHTML = '<i class="fa-solid fa-microphone-slash"></i>';
                if (_sttEngine.state === 'listening' && !_sttEngine.vadEnabled) {
                    _sttEngine.stopListening();
                }
            }
        };
    }

    // Bind STT Callbacks
    _sttEngine.onInterim = _onSttInterim;
    _sttEngine.onTranscript = _onSttTranscript;
    _sttEngine.onStateChange = _onSttStateChange;
}

// ─── Timer ───

function _startTimer() {
    _callStartTime = Date.now();
    const timerEl = document.getElementById('voice_call_timer');

    _timerInterval = setInterval(() => {
        if (!timerEl) return;
        const elapsed = Math.floor((Date.now() - _callStartTime) / 1000);
        const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
        const s = String(elapsed % 60).padStart(2, '0');
        timerEl.textContent = `${m}:${s}`;
    }, 1000);
}

function _stopTimer() {
    if (_timerInterval) {
        clearInterval(_timerInterval);
        _timerInterval = null;
    }
}

// ─── UI Helpers ───

function _scrollToBottom() {
    const el = document.getElementById('voice_call_subtitles');
    if (el) {
        el.scrollTop = el.scrollHeight;
    }
}

// User text (STT) tracking
let _currentUserBubble = null;

function _onSttInterim(text) {
    if (!text) return;
    const subs = document.getElementById('voice_call_subtitles');
    if (!subs) return;

    if (!_currentUserBubble) {
        // Create new bubble
        subs.insertAdjacentHTML('beforeend', `<div class="voice-subtitle-bubble user interim" id="current_user_bubble"></div>`);
        _currentUserBubble = document.getElementById('current_user_bubble');
    }

    if (_currentUserBubble) {
        _currentUserBubble.textContent = text;
        _scrollToBottom();
    }
}

function _onSttTranscript(text) {
    if (!text) return;
    const subs = document.getElementById('voice_call_subtitles');
    if (!subs) return;

    if (_currentUserBubble) {
        _currentUserBubble.textContent = text;
        _currentUserBubble.classList.remove('interim');
        _currentUserBubble.removeAttribute('id'); // Solidify it
        _currentUserBubble = null;
    } else {
        subs.insertAdjacentHTML('beforeend', `<div class="voice-subtitle-bubble user">${escapeHtml(text)}</div>`);
    }
    _scrollToBottom();

    // Record user message
    _callMessages.push({
        role: 'user',
        content: text,
        timestamp: new Date().toISOString(),
    });

    // 🔥 Send to LLM
    _sendToLLM(text);
}

function _onSttStateChange(state) {
    const micBtn = document.getElementById('voice_call_mic_btn');
    if (!micBtn) return;

    // Give visual indication when audio processing starts (API calls)
    if (state === 'processing') {
        micBtn.style.opacity = '0.5';
    } else {
        micBtn.style.opacity = '1';
    }

    // 🔄 Auto-restart STT when it goes idle — keeps the voice call loop alive
    if (state === 'idle' && _overlayMounted && _sttEngine) {
        const isMuted = micBtn.classList.contains('muted');
        if (!isMuted) {
            // Small delay to avoid race conditions with MediaRecorder cleanup
            setTimeout(() => {
                // Re-check conditions after delay
                if (_overlayMounted && _sttEngine && _sttEngine.state === 'idle') {
                    console.debug('[VoiceCallUI] Auto-restarting STT...');
                    _sttEngine.startListening({ continuous: true }).catch(e => {
                        console.warn('[VoiceCallUI] STT auto-restart failed:', e);
                    });
                }
            }, 300);
        }
    }
}

export function addSystemSubtitle(text) {
    const subs = document.getElementById('voice_call_subtitles');
    if (subs) {
        subs.insertAdjacentHTML('beforeend', `<div class="voice-subtitle-bubble system">${escapeHtml(text)}</div>`);
        _scrollToBottom();
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Retry Helper — exponential backoff for transient failures
// ═══════════════════════════════════════════════════════════════════════

const RETRY_CONFIG = {
    maxAttempts: 3,
    baseDelayMs: 500,       // 500ms → 1000ms → 2000ms
    retryableCheck: (err) => {
        // Don't retry 4xx client errors (bad API key, malformed request, etc.)
        if (err?.status >= 400 && err?.status < 500) return false;
        // Retry network errors, 5xx, timeouts, connection refused
        return true;
    },
};

/**
 * Execute an async function with exponential backoff retry.
 * @param {Function} fn - Async function to execute
 * @param {object} [opts]
 * @param {number} [opts.maxAttempts=3]
 * @param {number} [opts.baseDelayMs=500]
 * @param {Function} [opts.onRetry] - Called before each retry with (attempt, error)
 * @param {Function} [opts.retryableCheck] - Return false to skip retry for certain errors
 * @returns {Promise<*>}
 */
async function _retryWithBackoff(fn, opts = {}) {
    const maxAttempts = opts.maxAttempts ?? RETRY_CONFIG.maxAttempts;
    const baseDelay = opts.baseDelayMs ?? RETRY_CONFIG.baseDelayMs;
    const shouldRetry = opts.retryableCheck ?? RETRY_CONFIG.retryableCheck;
    const onRetry = opts.onRetry ?? (() => { });

    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (err) {
            lastError = err;
            if (attempt >= maxAttempts || !shouldRetry(err)) throw err;
            const delay = baseDelay * Math.pow(2, attempt - 1); // 500, 1000, 2000
            console.warn(`${LOG_PREFIX} Attempt ${attempt}/${maxAttempts} failed, retrying in ${delay}ms...`, err.message);
            onRetry(attempt, err);
            await new Promise(r => setTimeout(r, delay));
        }
    }
    throw lastError;
}

// ═══════════════════════════════════════════════════════════════════════
// LLM Integration — callPhoneLLM with vcPromptBuilder + retry
// ═══════════════════════════════════════════════════════════════════════

/**
 * Send the user's spoken text to the LLM and display the response.
 * Uses 3-attempt exponential backoff for transient failures.
 * @param {string} text - User's spoken text from STT
 */
async function _sendToLLM(text) {
    if (_isProcessingLLM) {
        console.log(`${LOG_PREFIX} LLM already processing, queuing...`);
        // Simple approach: skip overlapping requests in voice call context
        return;
    }

    _isProcessingLLM = true;
    const subs = document.getElementById('voice_call_subtitles');
    let charBubble = null;

    try {
        // Create thinking indicator bubble
        if (subs) {
            subs.insertAdjacentHTML('beforeend',
                `<div class="voice-subtitle-bubble char" id="vc_thinking_bubble">` +
                `<span class="streaming-cursor"></span></div>`
            );
            charBubble = document.getElementById('vc_thinking_bubble');
            _scrollToBottom();
        }

        // Build prompts
        const systemPrompt = await buildVcSystemPrompt(_callOptions);
        const userPrompt = buildVcUserPrompt(text, _callMessages);

        // Call LLM with retry
        const response = await _retryWithBackoff(
            () => callPhoneLLM(systemPrompt, userPrompt),
            {
                onRetry: (attempt, err) => {
                    addSystemSubtitle(`信号不好，重新连接中... (${attempt}/3)`);
                },
            }
        );

        if (!response || !response.trim()) {
            throw new Error('LLM returned empty response');
        }

        const cleanResponse = response.trim();

        // Record char message
        _callMessages.push({
            role: 'char',
            content: cleanResponse,
            timestamp: new Date().toISOString(),
        });

        // 🔊 TTS first (await synthesis + decode), then sync typewriter to audio duration
        let audioDuration = 0;
        if (_ttsEngine) {
            try {
                audioDuration = await _ttsEngine.speak(cleanResponse) || 0;
            } catch (e) {
                console.warn(`${LOG_PREFIX} TTS failed, text-only fallback`, e);
            }
        }

        if (charBubble) {
            charBubble.removeAttribute('id');
            await _typewriterDisplay(charBubble, cleanResponse, audioDuration);
        }

    } catch (e) {
        console.error(`${LOG_PREFIX} LLM call failed after retries:`, e);
        if (charBubble) {
            charBubble.removeAttribute('id');
            charBubble.textContent = '（通话信号不好...）';
            charBubble.classList.add('system');
            charBubble.classList.remove('char');
        }
    } finally {
        _isProcessingLLM = false;
    }
}

/**
 * Typewriter effect: display text character by character in a bubble.
 * Speed is synced to audio duration when available.
 * @param {HTMLElement} bubble - The subtitle bubble element
 * @param {string} text - Full text to display
 * @param {number} [audioDuration=0] - Audio duration in seconds (0 = use default speed)
 * @returns {Promise<void>}
 */
function _typewriterDisplay(bubble, text, audioDuration = 0) {
    return new Promise(resolve => {
        if (!bubble) { resolve(); return; }

        let idx = 0;
        // If we have audio duration, sync typewriter to it; otherwise use default
        const DEFAULT_DELAY = 60; // ms per char (fallback)
        const MIN_DELAY = 20;
        const MAX_DELAY = 200;
        let charDelay;

        if (audioDuration > 0 && text.length > 0) {
            // Distribute audio duration across characters, leave 200ms buffer at the end
            charDelay = Math.max(MIN_DELAY, Math.min(MAX_DELAY,
                ((audioDuration * 1000) - 200) / text.length
            ));
        } else {
            charDelay = DEFAULT_DELAY;
        }

        bubble.textContent = '';
        bubble.insertAdjacentHTML('beforeend', '<span class="streaming-cursor"></span>');

        const interval = setInterval(() => {
            if (idx < text.length) {
                // Insert character before cursor
                const cursor = bubble.querySelector('.streaming-cursor');
                if (cursor) {
                    cursor.insertAdjacentText('beforebegin', text[idx]);
                } else {
                    bubble.textContent = text.slice(0, idx + 1);
                }
                idx++;
                _scrollToBottom();
            } else {
                clearInterval(interval);
                // Remove cursor
                const cursor = bubble.querySelector('.streaming-cursor');
                if (cursor) cursor.remove();
                resolve();
            }
        }, charDelay);
    });
}
