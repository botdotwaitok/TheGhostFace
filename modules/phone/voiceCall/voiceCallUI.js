// modules/phone/voiceCall/voiceCallUI.js — iPhone-style voice call interface
// Manages the full-screen call overlay, STT lifecycle, LLM interaction, and TTS playback.
// Uses callPhoneLLM() with dedicated vcPromptBuilder — fully independent from ST main chat.
// Supports two-stage incoming call flow: ringing → answer → normal call.

import { getSttEngine } from './sttInit.js';
import { getPhoneCharInfo, getPhoneUserName, getCoreFoundationPrompt } from '../phoneContext.js';
import { escapeHtml } from '../utils/helpers.js';
import { getTtsEngine } from './tts/ttsInit.js';
import { parseSayTags, stripSayTags } from './tts/toneMappings.js';
import { callPhoneLLM } from '../../api.js';
import { buildVcSystemPrompt, buildVcUserPrompt, generateCallSummary } from './vcPromptBuilder.js';
import { saveCallLog, generateCallId } from './vcStorage.js';
import { uploadAudioToST } from '../chat/voiceMessageService.js';
import { playRingtone, stopRingtone, getCurrentRingtone } from './ringtoneManager.js';
import { initAmbient, startAmbient, stopAmbient, stopAmbientImmediate } from './ambientManager.js';

const LOG_PREFIX = '[VoiceCallUI]';

let _overlayMounted = false;
let _sttEngine = null;
let _ttsEngine = null;
let _callStartTime = 0;
let _timerInterval = null;
let _hangupConfirmTimeout = null;  // Auto-revert hangup confirmation

// ─── Call Session State ───
let _callId = null;
let _callMessages = [];    // Transcript: [{ role: 'user'|'char', content, timestamp }]
let _isProcessingLLM = false;  // Guard: prevent overlapping LLM requests
let _callOptions = {};     // Options passed from caller (e.g. { chatContext: true })

// ─── Ringing Stage State ───
let _isRinging = false;           // true while in ringing phase
let _greetingAudioBlob = null;    // Pre-generated greeting TTS blob
let _greetingText = '';           // Pre-generated greeting text

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
// Ringing Stage — incoming call UI (ring → answer → normal call)
// ═══════════════════════════════════════════════════════════════════════

const ringingTemplate = String.raw`
<div id="phone_voice_call_overlay" class="phone-voice-call-overlay">
    <div class="voice-call-bg" id="voice_call_bg"></div>
    <div class="voice-call-content voice-call-ringing-content">
        <div class="voice-call-ringing-header">
            <img src="" alt="Avatar" class="voice-call-ringing-avatar" id="voice_call_avatar">
            <div class="voice-call-name" id="voice_call_name">角色</div>
            <div class="voice-call-ringing-status" id="voice_call_ringing_status">来电中...</div>
        </div>

        <div class="voice-call-ringing-controls">
            <div class="voice-call-ringing-btn-group">
                <button class="voice-control-btn ringing-decline" id="voice_call_decline_btn">
                    <i class="fa-solid fa-phone-slash"></i>
                </button>
                <span class="voice-call-ringing-btn-label">拒接</span>
            </div>
            <div class="voice-call-ringing-btn-group">
                <button class="voice-control-btn ringing-accept" id="voice_call_accept_btn">
                    <i class="fa-solid fa-phone"></i>
                </button>
                <span class="voice-call-ringing-btn-label">接听</span>
            </div>
        </div>
    </div>
</div>`;

/**
 * Mount the ringing-stage UI (incoming call).
 * Shows avatar, name, "来电中...", accept/decline buttons.
 */
function _mountRingingUI() {
    if (_overlayMounted) return;
    const container = document.querySelector('.phone-container');
    if (!container) return;

    container.insertAdjacentHTML('beforeend', ringingTemplate);
    _overlayMounted = true;
    _isRinging = true;

    // Set character info
    const charInfo = getPhoneCharInfo();
    const charName = charInfo?.name || '未知联系人';
    const avatarUrl = charInfo?.avatar ? `/characters/${encodeURIComponent(charInfo.avatar)}` : '';

    const nameEl = document.getElementById('voice_call_name');
    const avatarEl = document.getElementById('voice_call_avatar');
    const bgEl = document.getElementById('voice_call_bg');

    if (nameEl) nameEl.textContent = charName;
    if (avatarEl && avatarUrl) avatarEl.src = avatarUrl;
    if (bgEl && avatarUrl) bgEl.style.backgroundImage = `url('${avatarUrl}')`;

    // Wait 1 frame for CSS transition
    requestAnimationFrame(() => {
        const overlay = document.getElementById('phone_voice_call_overlay');
        if (overlay) overlay.classList.add('active');
    });

    // Bind ringing buttons
    const acceptBtn = document.getElementById('voice_call_accept_btn');
    const declineBtn = document.getElementById('voice_call_decline_btn');

    if (acceptBtn) {
        acceptBtn.onclick = () => _acceptIncomingCall();
    }
    if (declineBtn) {
        declineBtn.onclick = () => _declineIncomingCall();
    }
}

/**
 * Transition from ringing UI to normal call UI.
 * Replaces the ringing overlay contents with the active call template.
 */
function _transitionToActiveCall() {
    const overlay = document.getElementById('phone_voice_call_overlay');
    if (!overlay) return;

    _isRinging = false;

    // Replace inner content with active call template
    overlay.innerHTML = `
    <div class="voice-call-bg" id="voice_call_bg"></div>
    <div class="voice-call-content">
        <div class="voice-call-header">
            <img src="" alt="Avatar" class="voice-call-avatar" id="voice_call_avatar">
            <div class="voice-call-name" id="voice_call_name">角色</div>
            <div class="voice-call-timer" id="voice_call_timer">00:00</div>
        </div>

        <div class="voice-call-subtitles" id="voice_call_subtitles">
        </div>

        <div class="voice-call-controls">
            <button class="voice-control-btn mic" id="voice_call_mic_btn">
                <i class="fa-solid fa-microphone"></i>
            </button>
            <button class="voice-control-btn hangup" id="voice_call_hangup_btn">
                <i class="fa-solid fa-phone-slash"></i>
            </button>
        </div>
    </div>`;

    // Re-init DOM with character info
    _initDOM();
    _bindEvents();
}

/**
 * Pre-generate the character's greeting TTS while ringing.
 * If greetingText is provided, skips LLM call and only synthesizes TTS.
 * If not, generates greeting via LLM first, then synthesizes.
 * @param {string} [providedText=''] - Greeting text from chat message
 */
async function _preGenerateGreeting(providedText = '') {
    const charInfo = getPhoneCharInfo();
    const charName = charInfo?.name || '角色';

    try {
        if (providedText && providedText.trim()) {
            // ── Optimized path: text already provided, skip LLM ──
            _greetingText = providedText.replace(/^["'「]|["'」]$/g, '').trim();
            console.log(`${LOG_PREFIX} Greeting text provided: "${_greetingText}"`);
        } else {
            // ── Fallback: generate greeting via LLM ──
            const userName = getPhoneUserName();
            const systemPrompt = `${getCoreFoundationPrompt()}

你是${charName}，你刚主动打电话给${userName}。
请用1-2句话作为开场白打招呼。要求：
- 自然、口语化
- 符合你的性格
- 不超过30字
- 只写开场白内容，不要加引号或说明`;
            const userPrompt = `${userName}接了你的电话，说一句开场白吧。`;

            console.log(`${LOG_PREFIX} Pre-generating greeting for ${charName}...`);
            _greetingText = await callPhoneLLM(systemPrompt, userPrompt);
            _greetingText = _greetingText.replace(/^["'「]|["'」]$/g, '').trim();
            console.log(`${LOG_PREFIX} Greeting text: "${_greetingText}"`);
        }

        // Synthesize TTS without playing — access provider directly
        if (_ttsEngine && _ttsEngine.currentProvider && _greetingText) {
            const providerSettings = { ...(_ttsEngine.getProviderSettings(_ttsEngine.currentProviderName) || {}) };
            const audioBuffer = await _ttsEngine.currentProvider.synthesize(_greetingText, providerSettings);
            if (audioBuffer) {
                _greetingAudioBlob = new Blob([audioBuffer], { type: 'audio/mpeg' });
                console.log(`${LOG_PREFIX} Greeting TTS ready: ${_greetingAudioBlob.size} bytes`);
            }
        }
    } catch (e) {
        console.warn(`${LOG_PREFIX} Greeting pre-generation failed:`, e);
        _greetingText = '';
        _greetingAudioBlob = null;
    }
}

/**
 * Handle user accepting the incoming call.
 * Stops ringtone, transitions to call UI, plays greeting, starts STT.
 */
async function _acceptIncomingCall() {
    console.log(`${LOG_PREFIX} Incoming call accepted!`);
    stopRingtone();

    // Transition to active call UI
    _transitionToActiveCall();
    _startTimer();

    // Play pre-generated greeting if available
    if (_greetingText) {
        addSystemSubtitle('通话已接通');

        // Record greeting as char message
        const charEntry = {
            role: 'char',
            content: _greetingText,
            timestamp: new Date().toISOString(),
        };
        _callMessages.push(charEntry);

        // Show greeting in subtitles
        const subs = document.getElementById('voice_call_subtitles');
        if (subs) {
            subs.insertAdjacentHTML('beforeend',
                `<div class="voice-subtitle-bubble char">${escapeHtml(_greetingText)}</div>`);
            _scrollToBottom();
        }

        // Play the pre-generated audio via Audio element
        if (_greetingAudioBlob) {
            try {
                const blobUrl = URL.createObjectURL(_greetingAudioBlob);
                const audioEl = new Audio(blobUrl);
                await audioEl.play();
                // Wait for playback to finish
                await new Promise((resolve) => {
                    audioEl.onended = () => {
                        URL.revokeObjectURL(blobUrl);
                        resolve();
                    };
                    audioEl.onerror = () => {
                        URL.revokeObjectURL(blobUrl);
                        resolve();
                    };
                });
                // Upload for persistence
                try {
                    const audioPath = await uploadAudioToST(_greetingAudioBlob, 'voice_call');
                    charEntry.audioPath = audioPath;
                } catch (e) {
                    console.warn(`${LOG_PREFIX} Greeting audio upload failed:`, e);
                }
            } catch (e) {
                console.warn(`${LOG_PREFIX} Greeting audio playback failed:`, e);
            }
        }
    } else {
        addSystemSubtitle('通话已接通');
    }

    // Start STT (user can now talk)
    try {
        await _sttEngine.startListening({ continuous: true });
        if (_sttEngine.vadEnabled) {
            addSystemSubtitle('您可以开始说话了 (自动检测中)');
        } else {
            addSystemSubtitle('通话完毕请点击挂断，进行小总结');
        }
    } catch (e) {
        console.error(`${LOG_PREFIX} STT start failed after accept:`, e);
        addSystemSubtitle(`录音失败: ${e.message}`);
    }

    // Cleanup greeting state
    _greetingAudioBlob = null;
    _greetingText = '';
}

/**
 * Handle user declining the incoming call.
 * Stops ringtone, unmounts UI, no call log saved.
 */
function _declineIncomingCall() {
    console.log(`${LOG_PREFIX} Incoming call declined.`);
    stopRingtone();
    _isRinging = false;
    _greetingAudioBlob = null;
    _greetingText = '';
    _callMessages = [];
    _callId = null;
    _callOptions = {};
    _unmountUI();

    // Notify chat system so the character can react to the missed call
    window.dispatchEvent(new CustomEvent('phone-call-declined'));
}

// ═══════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════

/**
 * Open the voice call UI.
 * @param {object} [options]
 * @param {boolean} [options.chatContext=false] - If true, inject chat context into the call prompt
 * @param {boolean} [options.incoming=false] - If true, show ringing stage first (incoming call)
 * @param {string}  [options.greetingText=''] - Pre-generated greeting text (skips LLM call if provided)
 */
export async function openVoiceCall({ chatContext = false, incoming = false, greetingText = '' } = {}) {
    console.log(`${LOG_PREFIX} Opening Voice Call... (chatContext: ${chatContext}, incoming: ${incoming}, greeting: ${greetingText ? 'provided' : 'none'})`);
    _sttEngine = getSttEngine();

    // Verify STT setup
    if (!_sttEngine.currentProvider) {
        alert('请先在"设置 → 语音通话"中配置一个语音识别引擎');
        return;
    }

    // Init TTS engine
    _ttsEngine = getTtsEngine();

    // Init call session
    _callId = generateCallId();
    _callMessages = [];
    _isProcessingLLM = false;
    _callOptions = { chatContext, incoming };

    // Pre-load ambient audio (downloads default if needed)
    initAmbient();

    if (incoming) {
        // ── INCOMING CALL: ringing stage ──
        _mountRingingUI();

        // Start ringtone playback (silent fallback if none selected)
        playRingtone();

        // Pre-generate greeting TTS in background (don't await)
        // If greetingText is provided, skip LLM and only synthesize TTS
        _preGenerateGreeting(greetingText);
        return; // Wait for user to accept/decline
    }

    // ── OUTGOING CALL: direct to active call ──
    _mountIfNeeded();
    _initDOM();
    _bindEvents();

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
 * @param {object} [options]
 * @param {boolean} [options.skipSummary=false] - If true, skip AI summary generation
 */
export async function closeVoiceCall({ skipSummary = false } = {}) {
    console.log(`${LOG_PREFIX} Closing Voice Call... (skipSummary: ${skipSummary})`);

    // Clear hangup confirmation timeout if pending
    if (_hangupConfirmTimeout) {
        clearTimeout(_hangupConfirmTimeout);
        _hangupConfirmTimeout = null;
    }

    // Stop ambient sound
    stopAmbientImmediate();

    // Stop ringtone if still playing (e.g. hangup during ringing)
    stopRingtone();

    // If in ringing stage, just unmount and cleanup
    if (_isRinging) {
        _declineIncomingCall();
        return;
    }

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

        // Generate summary unless skipped
        let summary = '';
        if (!skipSummary) {
            addSystemSubtitle('正在生成通话总结...');
            try {
                if (_callMessages.length >= 2) {
                    summary = await generateCallSummary(_callMessages);
                }
            } catch (e) {
                console.warn(`${LOG_PREFIX} Summary generation failed:`, e);
            }
        } else {
            addSystemSubtitle('正在保存通话记录...');
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
        console.log(`${LOG_PREFIX} Call log saved: ${_callMessages.length} messages, ${duration}s, summary: ${skipSummary ? 'skipped' : 'generated'}`);
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
        hangupBtn.onclick = () => _showHangupConfirmation();
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

// ─── Hangup Confirmation ───

function _showHangupConfirmation() {
    const controls = document.querySelector('.voice-call-controls');
    if (!controls || controls.classList.contains('confirming')) return;

    controls.classList.add('confirming');
    controls.innerHTML = `
        <div class="voice-hangup-confirm">
            <button class="voice-hangup-option with-summary" id="vc_hangup_with_summary">
                <i class="ph ph-note"></i>
                <span>挂断并总结</span>
            </button>
            <button class="voice-hangup-option no-summary" id="vc_hangup_no_summary">
                <i class="ph ph-phone-disconnect"></i>
                <span>直接挂断</span>
            </button>
        </div>`;

    document.getElementById('vc_hangup_with_summary').onclick = () => {
        _clearHangupConfirmTimeout();
        closeVoiceCall({ skipSummary: false });
    };
    document.getElementById('vc_hangup_no_summary').onclick = () => {
        _clearHangupConfirmTimeout();
        closeVoiceCall({ skipSummary: true });
    };

    // Auto-revert after 3s
    _hangupConfirmTimeout = setTimeout(() => _hideHangupConfirmation(), 3000);
}

function _hideHangupConfirmation() {
    _clearHangupConfirmTimeout();
    const controls = document.querySelector('.voice-call-controls');
    if (!controls || !controls.classList.contains('confirming')) return;

    controls.classList.remove('confirming');
    controls.innerHTML = `
        <button class="voice-control-btn mic" id="voice_call_mic_btn">
            <i class="fa-solid fa-microphone"></i>
        </button>
        <button class="voice-control-btn hangup" id="voice_call_hangup_btn">
            <i class="fa-solid fa-phone-slash"></i>
        </button>`;

    // Re-bind events on restored buttons
    _bindEvents();
}

function _clearHangupConfirmTimeout() {
    if (_hangupConfirmTimeout) {
        clearTimeout(_hangupConfirmTimeout);
        _hangupConfirmTimeout = null;
    }
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

    // Start ambient sound during thinking gap
    startAmbient();
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

        // 🎭 Parse <say tone="..."> tags from LLM output
        const parsed = parseSayTags(cleanResponse);
        const displayText = parsed.fullText; // Clean text without tags
        const emotion = parsed.primaryTone;  // First segment's tone for TTS
        console.log(`${LOG_PREFIX} Tone parsed: emotion="${emotion}", segments=${parsed.segments.length}, text="${displayText.substring(0, 40)}..."`);

        // Record char message with clean text (no tags in history)
        const charMessageEntry = {
            role: 'char',
            content: displayText,
            timestamp: new Date().toISOString(),
        };
        _callMessages.push(charMessageEntry);

        // 🔊 TTS: synthesize with emotion + play + capture blob for persistence
        // Stop ambient before TTS plays
        stopAmbient();

        let audioDuration = 0;
        let audioPath = null;
        if (_ttsEngine) {
            try {
                const ttsResult = await _ttsEngine.speakAndCapture(displayText, emotion);
                if (ttsResult) {
                    audioDuration = ttsResult.duration || 0;
                    // Upload audio to ST file system for persistence
                    try {
                        audioPath = await uploadAudioToST(ttsResult.audioBlob, 'voice_call');
                        charMessageEntry.audioPath = audioPath;
                        console.log(`${LOG_PREFIX} TTS audio saved: ${audioPath}`);
                    } catch (uploadErr) {
                        console.warn(`${LOG_PREFIX} TTS audio upload failed:`, uploadErr);
                    }
                }
            } catch (e) {
                console.warn(`${LOG_PREFIX} TTS failed, text-only fallback`, e);
            }
        }

        if (charBubble) {
            charBubble.removeAttribute('id');
            await _typewriterDisplay(charBubble, displayText, audioDuration);
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
