// modules/phone/voiceCall/voiceCallUI.js — iPhone-style voice call interface
// Manages the full-screen call overlay, STT lifecycle, LLM interaction, and TTS playback.
// Uses callPhoneLLM() with dedicated vcPromptBuilder — fully independent from ST main chat.
// Supports two-stage incoming call flow: ringing → answer → normal call.

import { getSttEngine } from './sttInit.js';
import { getPhoneCharInfo, getPhoneUserName, getCoreFoundationPrompt } from '../phoneContext.js';
import { escapeHtml, stripLLMTags } from '../utils/helpers.js';
import { getTtsEngine } from './tts/ttsInit.js';
import { parseSayTags, stripSayTags } from './tts/toneMappings.js';
import { callPhoneLLM } from '../../api.js';
import { buildVcSystemPrompt, buildVcUserPrompt, generateCallSummary } from './vcPromptBuilder.js';
import { saveCallLog, generateCallId } from './vcStorage.js';
import { uploadAudioToST } from '../chat/voiceMessageService.js';
import { playRingtone, stopRingtone, getCurrentRingtone } from './ringtoneManager.js';
import { initAmbient, startAmbient, stopAmbient, stopAmbientImmediate, warmUpAmbient } from './ambientManager.js';
import { initProactive, startProactive, stopProactive, notifyUserSpoke } from './proactiveSpeech.js';
import { acquireWakeLock, releaseWakeLock } from './wakeLockManager.js';

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
let _isTtsPlaying = false;     // Guard: suppress STT while TTS is playing
let _callOptions = {};     // Options passed from caller (e.g. { chatContext: true })

// ─── Ringing Stage State ───
let _isRinging = false;           // true while in ringing phase
let _greetingAudioBlob = null;    // Pre-generated greeting TTS blob
let _greetingText = '';           // Pre-generated greeting text

// ─── Session-Wide Abort + Reentry Guards ───
// Phase 1 audit fix: a single AbortController per call session lets closeVoiceCall
// kill all in-flight LLM/TTS/STT fetches at once. _isClosing guards against
// double-entry from rapid clicks / [挂断] auto-hangup colliding with manual hangup.
// _pendingTimeouts tracks every session-scoped setTimeout so closeVoiceCall can clear
// them all (otherwise the 300ms unmount timeout from a previous call can delete a
// freshly-mounted overlay when the user immediately re-dials).
let _sessionAbortCtrl = null;
let _isClosing = false;
const _pendingTimeouts = new Set();
// Phase 4: typewriter setInterval handles. Without tracking, hanging up mid-typewriter
// leaves the interval running after the bubble is detached — small leak but adds up
// across reproducible reopens. closeVoiceCall clears them all. We store {id, resolve}
// pairs so force-clear can also resolve the corresponding Promise — otherwise
// _sendToLLM's `await typewriterDone` would hang forever after a hangup.
const _typewriterIntervals = new Set();
// Phase 4: greeting object URLs that must be revoked when the call ends or the
// session is reset. Otherwise the greeting Blob is held alive for the page lifetime.
const _activeGreetingUrls = new Set();

// ═══════════════════════════════════════════════════════════════════════
// Template & Mounting
// ═══════════════════════════════════════════════════════════════════════

const callControlsHtml = String.raw`
    <button class="voice-control-btn mic" id="voice_call_mic_btn">
        <i class="fa-solid fa-microphone"></i>
    </button>
    <button class="voice-control-btn keyboard" id="voice_call_keyboard_btn" title="文字输入">
        <i class="ph ph-keyboard"></i>
    </button>
    <button class="voice-control-btn hangup" id="voice_call_hangup_btn">
        <i class="fa-solid fa-phone-slash"></i>
    </button>`;

const textInputBarHtml = String.raw`
<div class="voice-text-input-bar" id="voice_text_input_bar">
    <textarea id="voice_text_input" class="voice-text-input" placeholder="想说什么..." rows="1" maxlength="500"></textarea>
    <button class="voice-text-input-close" id="voice_text_input_close" title="关闭">
        <i class="ph ph-x"></i>
    </button>
</div>`;

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
            ${callControlsHtml}
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
        // Tracked via _pendingTimeouts: if user re-dials inside the 300ms window,
        // _resetSessionState will clear this before the new overlay can be deleted.
        _scheduleTimeout(() => {
            overlay.remove();
            _overlayMounted = false;
        }, 300); // Wait for fade out
    }
}

// ─── Session timer tracking + reentry guards ───

/**
 * Schedule a session-scoped setTimeout. Auto-registers into _pendingTimeouts so
 * closeVoiceCall / _resetSessionState can cancel it. Auto-deregisters on fire.
 * @param {Function} fn
 * @param {number} ms
 * @returns {number} timeout id
 */
function _scheduleTimeout(fn, ms) {
    const id = setTimeout(() => {
        _pendingTimeouts.delete(id);
        fn();
    }, ms);
    _pendingTimeouts.add(id);
    return id;
}

function _clearPendingTimeouts() {
    for (const id of _pendingTimeouts) clearTimeout(id);
    _pendingTimeouts.clear();
}

function _clearTypewriterIntervals() {
    for (const entry of _typewriterIntervals) {
        clearInterval(entry.id);
        try { entry.resolve(); } catch { /* already resolved */ }
    }
    _typewriterIntervals.clear();
}

function _revokeGreetingUrls() {
    for (const url of _activeGreetingUrls) {
        try { URL.revokeObjectURL(url); } catch { /* ignore */ }
    }
    _activeGreetingUrls.clear();
}

/**
 * Initialize per-session state at the start of a new call. Cancels any leftover
 * timeouts and aborts any in-flight tasks from a previous session that hasn't
 * fully torn down (e.g. user re-dials within the 300ms unmount fade window).
 */
function _resetSessionState() {
    _clearPendingTimeouts();
    _clearTypewriterIntervals();
    _revokeGreetingUrls();
    if (_sessionAbortCtrl && !_sessionAbortCtrl.signal.aborted) {
        try { _sessionAbortCtrl.abort(); } catch { /* ignore */ }
    }
    _sessionAbortCtrl = new AbortController();
    _isClosing = false;
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
            ${callControlsHtml}
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

    // Snapshot the session controller so a decline-then-redial flow doesn't write
    // stale greeting data onto the new session's state.
    const snapshotCtrl = _sessionAbortCtrl;
    const signal = snapshotCtrl?.signal;
    const isStillCurrent = () => !_isClosing && snapshotCtrl === _sessionAbortCtrl && !signal?.aborted;

    try {
        if (providedText && providedText.trim()) {
            // ── Optimized path: text already provided, skip LLM ──
            if (!isStillCurrent()) return;
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
            const greetingResponse = await callPhoneLLM(systemPrompt, userPrompt);
            if (!isStillCurrent()) return;
            _greetingText = greetingResponse.replace(/^["'「]|["'」]$/g, '').trim();
            console.log(`${LOG_PREFIX} Greeting text: "${_greetingText}"`);
        }

        // Synthesize TTS without playing — access provider directly
        if (_ttsEngine && _ttsEngine.currentProvider && _greetingText) {
            const providerSettings = { ...(_ttsEngine.getProviderSettings(_ttsEngine.currentProviderName) || {}) };
            const result = await _ttsEngine.currentProvider.synthesize(_greetingText, providerSettings, signal);
            if (!isStillCurrent()) return;
            // Providers return { buffer, mime }; use real mime so iOS Safari
            // accepts the Blob when the greeting plays back from history.
            const buffer = result?.buffer ?? result;
            const mime = result?.mime || 'audio/mpeg';
            if (buffer) {
                _greetingAudioBlob = new Blob([buffer], { type: mime });
                console.log(`${LOG_PREFIX} Greeting TTS ready: ${_greetingAudioBlob.size} bytes (${mime})`);
            }
        }
    } catch (e) {
        if (e?.name === 'AbortError' || !isStillCurrent()) {
            console.log(`${LOG_PREFIX} Greeting pre-gen aborted (call ended).`);
            return;
        }
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

    // 🔊 Warm up AudioContext during user gesture (tap) to unlock mobile audio
    if (_ttsEngine) await _ttsEngine.warmUp();
    warmUpAmbient();

    // Keep screen awake — user gesture (accept tap) is required by Wake Lock API
    acquireWakeLock();

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
                _activeGreetingUrls.add(blobUrl);
                const audioEl = new Audio(blobUrl);
                await audioEl.play();
                // Wait for playback to finish
                await new Promise((resolve) => {
                    const cleanup = () => {
                        if (_activeGreetingUrls.delete(blobUrl)) {
                            try { URL.revokeObjectURL(blobUrl); } catch { /* ignore */ }
                        }
                        resolve();
                    };
                    audioEl.onended = cleanup;
                    audioEl.onerror = cleanup;
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

    // Start proactive-speech timer once the incoming call is active.
    startProactive();

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
    // Abort any in-flight greeting pre-gen (LLM + TTS) before tearing down state
    // so the response doesn't land on the next call's overlay.
    if (_sessionAbortCtrl) {
        try { _sessionAbortCtrl.abort(); } catch { /* ignore */ }
    }
    _clearPendingTimeouts();
    _clearTypewriterIntervals();
    _revokeGreetingUrls();
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

    // Reset session state — cancels stale 300ms unmount timeouts / aborts orphaned
    // tasks from a previous call that hasn't fully torn down yet.
    _resetSessionState();

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

    // Console-debug hook for proactive-speech testing (Phase 1 verification).
    // Use from devtools: window.__vcSendToLLM(null, { proactiveInstruction: '...' })
    window.__vcSendToLLM = _sendToLLM;

    // Wire up proactive-speech callbacks (Phase 2). startProactive 由接通点触发。
    initProactive({
        onFire: (instruction) => _sendToLLM(null, { proactiveInstruction: instruction }),
        canFire: () => !_isTtsPlaying && !_isProcessingLLM,
    });

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

    // 🔊 Warm up AudioContext during user gesture (tap) to unlock mobile audio
    if (_ttsEngine) await _ttsEngine.warmUp();
    warmUpAmbient();

    // Keep screen awake — user gesture (call tap) is required by Wake Lock API
    acquireWakeLock();

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

        // Start proactive-speech timer once the call is fully active.
        startProactive();

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
    // Reentry guard: rapid clicks, [挂断] auto-hangup colliding with manual hangup,
    // or onCaptureEnded firing during teardown could all call us twice. Bail early.
    if (_isClosing) {
        console.log(`${LOG_PREFIX} closeVoiceCall already in progress — ignoring re-entry`);
        return;
    }
    _isClosing = true;

    console.log(`${LOG_PREFIX} Closing Voice Call... (skipSummary: ${skipSummary})`);

    // Snapshot the session controller — if openVoiceCall replaces it during the
    // long summary await (user re-dials), we must NOT keep tearing down state
    // that now belongs to a fresh call.
    const closingCtrl = _sessionAbortCtrl;

    // Abort all in-flight session tasks (LLM, TTS, STT fetches) so their await
    // continuations bail out without writing to _callMessages or DOM.
    if (closingCtrl) {
        try { closingCtrl.abort(); } catch { /* ignore */ }
    }

    // Cancel all pending session timeouts (STT auto-restart, [挂断] 1.5s delay,
    // any unmount fade scheduled by a prior call).
    _clearPendingTimeouts();
    // Phase 4: also clear typewriter intervals + revoke any greeting object URLs
    // so a long teardown (summary generation) doesn't leave them dangling.
    _clearTypewriterIntervals();
    _revokeGreetingUrls();

    // Release screen wake lock — call is ending
    releaseWakeLock();

    // Stop proactive-speech first so no late tick fires after teardown.
    stopProactive();

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

    // ── Save call log — snapshot fields BEFORE any await, since the user
    // may re-dial during summary generation and clobber module state. ──
    const messagesSnapshot = [..._callMessages];
    const callIdSnapshot = _callId;
    const callStartTimeSnapshot = _callStartTime;

    if (messagesSnapshot.length > 0) {
        const endTime = new Date().toISOString();
        const duration = callStartTimeSnapshot ? Math.floor((Date.now() - callStartTimeSnapshot) / 1000) : 0;

        // Generate summary unless skipped
        let summary = '';
        if (!skipSummary) {
            addSystemSubtitle('正在生成通话总结...');
            try {
                if (messagesSnapshot.length >= 2) {
                    summary = await generateCallSummary(messagesSnapshot);
                }
            } catch (e) {
                console.warn(`${LOG_PREFIX} Summary generation failed:`, e);
            }
        } else {
            addSystemSubtitle('正在保存通话记录...');
        }

        const callLog = {
            id: callIdSnapshot,
            startTime: new Date(callStartTimeSnapshot).toISOString(),
            endTime,
            duration,
            summary,
            messages: messagesSnapshot,
        };

        saveCallLog(callLog);
        console.log(`${LOG_PREFIX} Call log saved: ${messagesSnapshot.length} messages, ${duration}s, summary: ${skipSummary ? 'skipped' : 'generated'}`);
    }

    // If the user re-dialed while summary was generating, openVoiceCall already
    // ran _resetSessionState (replacing _sessionAbortCtrl). DO NOT touch any
    // shared module state or the overlay — they belong to the new session now.
    if (_sessionAbortCtrl !== closingCtrl) {
        console.log(`${LOG_PREFIX} A new session started during summary generation — leaving fresh state alone.`);
        return;
    }

    // Reset session state
    _callId = null;
    _callMessages = [];
    _isProcessingLLM = false;
    _isTtsPlaying = false;
    _callOptions = {};

    // Tear down debug hook
    if (window.__vcSendToLLM) delete window.__vcSendToLLM;

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
    const keyboardBtn = document.getElementById('voice_call_keyboard_btn');

    if (hangupBtn) {
        hangupBtn.onclick = () => _showHangupConfirmation();
    }

    if (keyboardBtn) {
        keyboardBtn.onclick = () => _showTextInput();
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

// ─── Text Input Bar ───

let _textInputPrevMuted = false; // mic state before input bar opened

function _showTextInput() {
    const overlay = document.getElementById('phone_voice_call_overlay');
    if (!overlay) return;
    if (document.getElementById('voice_text_input_bar')) return; // already open

    // Remember mic state, then mute STT while typing
    const micBtn = document.getElementById('voice_call_mic_btn');
    _textInputPrevMuted = micBtn?.classList.contains('muted') || false;
    if (!_textInputPrevMuted) {
        if (_sttEngine && _sttEngine.state === 'listening') {
            _sttEngine.stopListening();
        }
        if (micBtn) {
            micBtn.classList.add('muted');
            micBtn.innerHTML = '<i class="fa-solid fa-microphone-slash"></i>';
        }
    }

    const content = overlay.querySelector('.voice-call-content');
    if (!content) return;
    content.insertAdjacentHTML('beforeend', textInputBarHtml);
    overlay.classList.add('text-input-active');

    const ta = document.getElementById('voice_text_input');
    const closeBtn = document.getElementById('voice_text_input_close');

    if (ta) {
        ta.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.isComposing) {
                e.preventDefault();
                const text = ta.value.trim();
                if (text) {
                    _handleTextSubmit(text);
                    ta.value = '';
                }
            }
        });
        setTimeout(() => ta.focus(), 50);
    }

    if (closeBtn) {
        closeBtn.onclick = () => _hideTextInput();
    }

    _scrollToBottom();
}

function _hideTextInput() {
    const bar = document.getElementById('voice_text_input_bar');
    if (bar) bar.remove();
    const overlay = document.getElementById('phone_voice_call_overlay');
    if (overlay) overlay.classList.remove('text-input-active');

    // Restore mic UI and STT if user wasn't manually muted before
    if (!_textInputPrevMuted) {
        const micBtn = document.getElementById('voice_call_mic_btn');
        if (micBtn) {
            micBtn.classList.remove('muted');
            micBtn.innerHTML = '<i class="fa-solid fa-microphone"></i>';
        }
        _restartSttAfterTts();
    }
}

function _handleTextSubmit(text) {
    if (!text) return;
    const subs = document.getElementById('voice_call_subtitles');
    if (subs) {
        subs.insertAdjacentHTML('beforeend',
            `<div class="voice-subtitle-bubble user">${escapeHtml(text)}</div>`);
        _scrollToBottom();
    }

    _callMessages.push({
        role: 'user',
        content: text,
        timestamp: new Date().toISOString(),
    });

    // Text input is also a user utterance — reset proactive timer.
    notifyUserSpoke(text);

    _sendToLLM(text);
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
    controls.innerHTML = callControlsHtml;

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

    // Reset proactive-speech silence timer — user just spoke.
    notifyUserSpoke(text);

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
        if (!isMuted && !_isTtsPlaying && !_isClosing) {
            // Small delay to avoid race conditions with MediaRecorder cleanup
            _scheduleTimeout(() => {
                // Re-check conditions after delay (closeVoiceCall may have fired meanwhile)
                if (_isClosing) return;
                if (_overlayMounted && _sttEngine && _sttEngine.state === 'idle' && !_isTtsPlaying) {
                    console.debug('[VoiceCallUI] Auto-restarting STT...');
                    _sttEngine.startListening({ continuous: true }).catch(e => {
                        console.warn('[VoiceCallUI] STT auto-restart failed:', e);
                    });
                }
            }, 300);
        }
    }
}

/**
 * Explicitly restart STT after TTS playback finishes.
 * This covers the case where the STT state-change auto-restart was blocked
 * because _isTtsPlaying was true at the time of the idle transition.
 */
function _restartSttAfterTts() {
    if (!_overlayMounted || !_sttEngine || _isClosing) return;
    const micBtn = document.getElementById('voice_call_mic_btn');
    const isMuted = micBtn?.classList.contains('muted');
    if (isMuted || _isTtsPlaying) return;
    if (_sttEngine.state !== 'idle') return;

    _scheduleTimeout(() => {
        // Re-check after short delay to avoid race conditions
        if (_isClosing) return;
        if (_overlayMounted && _sttEngine && _sttEngine.state === 'idle' && !_isTtsPlaying) {
            console.debug(`${LOG_PREFIX} Restarting STT after TTS finished`);
            _sttEngine.startListening({ continuous: true }).catch(e => {
                console.warn(`${LOG_PREFIX} STT restart after TTS failed:`, e);
            });
        }
    }, 300);
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
        if (_isClosing) throw new DOMException('aborted', 'AbortError');
        try {
            return await fn();
        } catch (err) {
            lastError = err;
            if (err?.name === 'AbortError' || _isClosing) throw err;
            if (attempt >= maxAttempts || !shouldRetry(err)) throw err;
            const delay = baseDelay * Math.pow(2, attempt - 1); // 500, 1000, 2000
            console.warn(`${LOG_PREFIX} Attempt ${attempt}/${maxAttempts} failed, retrying in ${delay}ms...`, err.message);
            onRetry(attempt, err);
            // Abortable sleep — close interrupts the wait immediately
            await new Promise(resolve => {
                const t = setTimeout(resolve, delay);
                _sessionAbortCtrl?.signal.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
            });
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
 * @param {string|null} text - User's spoken text from STT. Pass null/empty in proactive mode.
 * @param {object} [options]
 * @param {string} [options.proactiveInstruction=''] - When set, the call is being driven
 *   by the proactive-speech timer (no user utterance). The instruction is injected as a
 *   <proactive_directive> block in the system prompt and the user prompt switches to
 *   placeholder mode. Char output is still recorded into _callMessages; user side is not.
 */
async function _sendToLLM(text, options = {}) {
    if (_isProcessingLLM) {
        console.log(`${LOG_PREFIX} LLM already processing, queuing...`);
        // Simple approach: skip overlapping requests in voice call context
        return;
    }
    if (_isClosing) {
        console.log(`${LOG_PREFIX} Session is closing, skipping new LLM request.`);
        return;
    }

    const proactiveInstruction = options.proactiveInstruction || '';
    const isProactive = !!proactiveInstruction;
    let wantsHangUp = false;

    // Snapshot session identifiers so post-await continuation can detect that
    // the call has ended (or been replaced by a new call) and bail out.
    const snapshotCallId = _callId;
    const signal = _sessionAbortCtrl?.signal;

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
        const systemPrompt = await buildVcSystemPrompt({ ..._callOptions, proactiveInstruction });
        const userPrompt = buildVcUserPrompt(text || '', _callMessages, 20, { proactive: isProactive });

        if (_isClosing || _callId !== snapshotCallId) return;

        // Call LLM with retry
        const response = await _retryWithBackoff(
            () => callPhoneLLM(systemPrompt, userPrompt),
            {
                onRetry: (attempt, err) => {
                    if (_isClosing) return;
                    addSystemSubtitle(`信号不好，重新连接中... (${attempt}/3)`);
                },
            }
        );

        // Session closed (or replaced) while LLM was thinking — discard the response
        // entirely. Do NOT push to _callMessages, do NOT touch DOM (the bubble may
        // belong to a different call now).
        if (_isClosing || _callId !== snapshotCallId) {
            console.log(`${LOG_PREFIX} Session ended during LLM call, dropping response.`);
            return;
        }

        if (!response || !response.trim()) {
            throw new Error('LLM returned empty response');
        }

        const rawClean = stripLLMTags(response.trim());
        // [挂断] is a system-action marker — strip it before TTS / parseSayTags so it
        // never makes it into the spoken text. We schedule closeVoiceCall after playback.
        wantsHangUp = rawClean.includes('[挂断]');
        const cleanResponse = rawClean.replace(/\[挂断\]/g, '').trim();
        if (wantsHangUp) {
            console.log(`${LOG_PREFIX} [挂断] marker detected — call will end after TTS finishes.`);
        }

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

        // 🔊 TTS: synthesize each <say> segment individually with its own emotion.
        // Previously all segments were merged into one string, causing GPT-SoVITS
        // to silently truncate long text. Now each segment is sent separately.
        // Stop ambient before TTS plays
        stopAmbient();

        let totalAudioDuration = 0;
        const audioBlobs = [];   // Collect blobs from each segment for merged upload
        if (_ttsEngine) {
            _isTtsPlaying = true;
            // Stop STT during TTS to prevent capturing speaker output
            if (_sttEngine && _sttEngine.state === 'listening') {
                _sttEngine.stopListening();
            }

            // Start typewriter in parallel — it will run across all segments
            let typewriterDone = Promise.resolve();
            if (charBubble) {
                charBubble.removeAttribute('id');
                // Estimate total duration for typewriter (will be approximate for first pass)
                // We use a generous estimate — actual sync comes from awaiting each segment
                typewriterDone = _typewriterDisplay(charBubble, displayText, 0);
            }

            // Play each segment sequentially, splitting into individual sentences
            // to prevent GPT-SoVITS from truncating long text within a single segment.
            for (let i = 0; i < parsed.segments.length; i++) {
                const seg = parsed.segments[i];
                if (!seg.text || seg.text.trim().length === 0) continue;

                // Split segment into individual sentences for reliable TTS
                const sentences = _splitIntoSentences(seg.text);
                console.log(`${LOG_PREFIX} TTS segment ${i + 1}/${parsed.segments.length}: tone="${seg.tone}", ${sentences.length} sentence(s)`);

                for (let j = 0; j < sentences.length; j++) {
                    if (_isClosing || _callId !== snapshotCallId) break;
                    const sentence = sentences[j];
                    console.debug(`${LOG_PREFIX}   sentence ${j + 1}/${sentences.length}: "${sentence.substring(0, 50)}..."`);
                    try {
                        // speakAndCapture awaits real `onended` (or session abort),
                        // so no extra setTimeout(duration*1000) wait is needed here.
                        const ttsResult = await _ttsEngine.speakAndCapture(sentence, seg.tone, { signal });
                        if (_isClosing || _callId !== snapshotCallId) break;
                        if (ttsResult) {
                            totalAudioDuration += ttsResult.duration || 0;
                            if (ttsResult.audioBlob) {
                                audioBlobs.push(ttsResult.audioBlob);
                            }
                        }
                    } catch (e) {
                        if (e?.name === 'AbortError') break;
                        console.warn(`${LOG_PREFIX} TTS sentence ${j + 1} failed, skipping:`, e);
                    }
                }
                if (_isClosing || _callId !== snapshotCallId) break;
            }

            // Upload merged audio for persistence (only if session is still alive)
            if (audioBlobs.length > 0 && !_isClosing && _callId === snapshotCallId) {
                try {
                    const mergedBlob = new Blob(audioBlobs, { type: 'audio/mpeg' });
                    const audioPath = await uploadAudioToST(mergedBlob, 'voice_call');
                    charMessageEntry.audioPath = audioPath;
                    console.log(`${LOG_PREFIX} TTS audio saved (${audioBlobs.length} segments merged): ${audioPath}`);
                } catch (uploadErr) {
                    console.warn(`${LOG_PREFIX} TTS audio upload failed:`, uploadErr);
                }
            }

            // Wait for typewriter to finish (it may still be running)
            await typewriterDone;
        } else {
            // No TTS engine — just show typewriter
            if (charBubble) {
                charBubble.removeAttribute('id');
                await _typewriterDisplay(charBubble, displayText, 0);
            }
        }

        // 🔑 Clear flag and restart STT after audio + typewriter both finish
        _isTtsPlaying = false;
        if (_isClosing || _callId !== snapshotCallId) return;
        if (wantsHangUp) {
            // Brief breath after the last word before tearing down the call.
            // Tracked via _pendingTimeouts so a manual hangup before the 1.5s
            // mark cancels this scheduled call (otherwise closeVoiceCall fires twice).
            _scheduleTimeout(() => closeVoiceCall(), 1500);
        } else {
            _restartSttAfterTts();
        }

    } catch (e) {
        // Aborted via session controller (user hung up) — silent bail.
        if (e?.name === 'AbortError' || _isClosing || _callId !== snapshotCallId) {
            console.log(`${LOG_PREFIX} LLM call aborted, dropping bubble silently.`);
            if (charBubble && !_isClosing) charBubble.remove();
            return;
        }
        console.error(`${LOG_PREFIX} LLM call failed after retries:`, e);
        if (charBubble) {
            charBubble.removeAttribute('id');
            charBubble.textContent = '（通话信号不好...）';
            charBubble.classList.add('system');
            charBubble.classList.remove('char');
        }
    } finally {
        _isProcessingLLM = false;
        // Safety net: ensure TTS flag is always cleared
        if (_isTtsPlaying) {
            _isTtsPlaying = false;
            if (!_isClosing) _restartSttAfterTts();
        }
    }
}

/**
 * Split text into individual sentences for TTS synthesis.
 * GPT-SoVITS tends to silently truncate audio for long text (3+ sentences).
 * Splitting into 1-sentence chunks ensures complete synthesis.
 * @param {string} text
 * @returns {string[]} Array of sentences (never empty — returns [text] if no split points found)
 */
function _splitIntoSentences(text) {
    if (!text || text.trim().length === 0) return [];

    // Split on sentence-ending punctuation followed by whitespace.
    // Covers: . ? ! (English) and 。？！(Chinese)
    // Uses lookbehind to keep the punctuation attached to its sentence.
    const sentences = text.split(/(?<=[.!?。！？])\s+/);
    const result = sentences.map(s => s.trim()).filter(s => s.length > 0);

    // If no split points found, return the whole text as a single chunk
    return result.length > 0 ? result : [text.trim()];
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

        const entry = { id: 0, resolve };
        let settled = false;
        const finish = () => {
            if (settled) return;
            settled = true;
            clearInterval(entry.id);
            _typewriterIntervals.delete(entry);
            // Remove cursor (best-effort — bubble may already be detached)
            const cursor = bubble.querySelector?.('.streaming-cursor');
            if (cursor) cursor.remove();
            resolve();
        };

        entry.id = setInterval(() => {
            // Bail if the call is closing — leftover ticks shouldn't keep firing
            // against a detached bubble.
            if (_isClosing) {
                finish();
                return;
            }
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
                finish();
            }
        }, charDelay);
        _typewriterIntervals.add(entry);
    });
}
