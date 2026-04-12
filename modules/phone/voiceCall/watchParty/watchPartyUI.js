// modules/phone/voiceCall/watchParty/watchPartyUI.js — Watch Party overlay UI
// Full-screen overlay for the AI companion watch party experience.
// Captures screen frames periodically, sends to multimodal LLM, plays TTS reactions.
// Reuses voice call infrastructure (STT, TTS, callPhoneLLM).

import { getSttEngine } from '../sttInit.js';
import { getPhoneCharInfo, getPhoneUserName } from '../../phoneContext.js';
import { escapeHtml, stripLLMTags } from '../../utils/helpers.js';
import { getTtsEngine } from '../tts/ttsInit.js';
import { parseSayTags } from '../tts/toneMappings.js';
import { callPhoneLLM } from '../../../api.js';
import { buildWatchPartySystemPrompt, buildWatchPartyUserPrompt, generateWatchPartySummary, buildWatchPartySummarizePrompt, buildCompressionUserPrompt, estimateTokens } from './watchPartyPromptBuilder.js';
import { saveCallLog, generateCallId } from '../vcStorage.js';
import { uploadAudioToST } from '../../chat/voiceMessageService.js';
import { startScreenCapture, stopScreenCapture, captureFrame, captureThumbnail, isCapturing, onCaptureEnded } from './screenCapture.js';

const LOG_PREFIX = '[WatchPartyUI]';

// ─── UI State ───
let _overlayMounted = false;

// ─── Engines ───
let _sttEngine = null;
let _ttsEngine = null;

// ─── Session State ───
let _callId = null;
let _watchMessages = [];       // Working transcript (trimmed by compression): [{ role, content, timestamp }]
let _fullTranscript = [];      // Complete transcript (never trimmed): used for callLog + session summary
let _isProcessingLLM = false;
let _isTtsPlaying = false;
let _sessionConfig = {};       // { contentType, contentTitle, contentDescription }
let _systemPromptCache = null; // Cached system prompt (built once at session start)

// ─── Timer & Frame State ───
let _startTime = 0;
let _timerInterval = null;
let _frameInterval = null;     // Auto-capture interval
let _frameCount = 0;
let _isPaused = false;         // User paused frame capture
let _lastFrameDataUrl = null;  // Last captured frame (for change detection in Phase 2)

// ─── Visual Memory & Context Compression ───
let _frameDescriptions = [];   // Visual memory: [{ frameNum, timestamp, description }]
let _sessionSummary = '';      // Rolling compression summary
let _isCompressing = false;    // Compression lock (prevents concurrent runs)
let _systemPromptTokens = 0;   // Cached system prompt token count

// ─── Configuration (dynamic, set from sessionConfig) ───
const DEFAULT_FRAME_INTERVAL_MS = 20_000;   // Default: 20 seconds per frame
const DEFAULT_MIN_LLM_INTERVAL_MS = 15_000; // Default: minimum 15s between auto-triggered LLM calls
let _lastLLMCallTime = 0;

// ═══════════════════════════════════════════════════════════════════════
// Template & Mounting
// ═══════════════════════════════════════════════════════════════════════

const watchPartyTemplate = String.raw`
<div id="phone_watch_party_overlay" class="phone-voice-call-overlay watch-party-overlay">
    <div class="voice-call-bg watch-party-bg" id="watch_party_bg"></div>
    <div class="voice-call-content watch-party-content">
        <div class="watch-party-header">
            <img src="" alt="Avatar" class="voice-call-avatar watch-party-avatar" id="watch_party_avatar">
            <div class="watch-party-header-info">
                <div class="voice-call-name" id="watch_party_name">角色</div>
                <div class="watch-party-content-label" id="watch_party_content_label"></div>
            </div>
            <div class="voice-call-timer" id="watch_party_timer">00:00</div>
        </div>

        <div class="voice-call-subtitles watch-party-subtitles" id="watch_party_subtitles">
            <!-- Subtitles injected here -->
        </div>

        <div class="voice-call-controls watch-party-controls">
            <button class="voice-control-btn mic" id="watch_party_mic_btn">
                <i class="fa-solid fa-microphone"></i>
            </button>
            <button class="voice-control-btn watch-pause" id="watch_party_pause_btn" title="暂停截屏">
                <i class="ph ph-pause"></i>
            </button>
            <button class="voice-control-btn hangup" id="watch_party_hangup_btn">
                <i class="fa-solid fa-phone-slash"></i>
            </button>
        </div>
    </div>
</div>`;

function _mountOverlay() {
    if (_overlayMounted) return;
    const container = document.querySelector('.phone-container');
    if (!container) return;

    container.insertAdjacentHTML('beforeend', watchPartyTemplate);
    _overlayMounted = true;

    requestAnimationFrame(() => {
        const overlay = document.getElementById('phone_watch_party_overlay');
        if (overlay) overlay.classList.add('active');
    });
}

function _unmountOverlay() {
    const overlay = document.getElementById('phone_watch_party_overlay');
    if (overlay) {
        overlay.classList.remove('active');
        setTimeout(() => {
            overlay.remove();
            _overlayMounted = false;
        }, 300);
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════

/**
 * Open the Watch Party UI.
 * @param {object} sessionConfig
 * @param {string} sessionConfig.contentType - 'movie' | 'anime' | 'game' | 'video' | 'other'
 * @param {string} [sessionConfig.contentTitle] - Title of the content
 * @param {string} [sessionConfig.contentDescription] - Additional context
 */
export async function openWatchParty(sessionConfig = {}) {
    console.log(`${LOG_PREFIX} Opening Watch Party...`, sessionConfig);

    // ── Initialize engines ──
    _sttEngine = getSttEngine();
    if (!_sttEngine?.currentProvider) {
        alert('请先在"设置 → 语音通话"中配置一个语音识别引擎');
        return;
    }
    _ttsEngine = getTtsEngine();

    // ── Start screen capture (triggers browser picker) ──
    try {
        await startScreenCapture();
    } catch (err) {
        console.error(`${LOG_PREFIX} Screen capture failed:`, err);
        alert(`屏幕共享失败: ${err.message}`);
        return;
    }

    // ── Init session state ──
    _callId = generateCallId();
    _watchMessages = [];
    _fullTranscript = [];
    _isProcessingLLM = false;
    _isTtsPlaying = false;
    _sessionConfig = sessionConfig;
    _frameCount = 0;
    _isPaused = false;
    _lastFrameDataUrl = null;
    _lastLLMCallTime = 0;

    // ── Inject previous session context ("Continue Watching" mode) ──
    _frameDescriptions = [];
    _isCompressing = false;
    if (sessionConfig.previousSummary) {
        _sessionSummary = sessionConfig.previousSummary;
        console.log(`${LOG_PREFIX} Resuming with previous summary (${_sessionSummary.length} chars)`);
    } else {
        _sessionSummary = '';
    }

    // ── Pre-build system prompt (cached for the session) ──
    _systemPromptCache = await buildWatchPartySystemPrompt(sessionConfig);
    _systemPromptTokens = estimateTokens(_systemPromptCache);

    // ── Mount UI ──
    _mountOverlay();
    _initDOM();
    _bindEvents();

    // ── Warm up audio ──
    if (_ttsEngine) await _ttsEngine.warmUp();

    // ── Start timer ──
    _startTime = Date.now();
    _startTimer();

    // ── Listen for user stopping share via browser UI ──
    onCaptureEnded(() => {
        _addSystemSubtitle('屏幕共享已被中止');
        closeWatchParty({ skipSummary: false });
    });

    // ── Start STT ──
    _addSystemSubtitle('观影模式已开启');
    if (sessionConfig.previousSummary) {
        _addSystemSubtitle('正在继续上次的观影...');
    }
    if (sessionConfig.contentTitle) {
        _addSystemSubtitle(`正在一起看：${sessionConfig.contentTitle}`);
    }

    try {
        await _sttEngine.startListening({ continuous: true });
        if (_sttEngine.vadEnabled) {
            _addSystemSubtitle('随时可以说话，我在听 (自动检测中)');
        }
    } catch (e) {
        console.error(`${LOG_PREFIX} STT start failed:`, e);
        _addSystemSubtitle(`语音识别启动失败: ${e.message}`);
    }

    // ── Start auto-frame capture loop ──
    _startFrameLoop();
}

/**
 * Close the Watch Party and save the session log.
 * @param {object} [options]
 * @param {boolean} [options.skipSummary=false]
 */
export async function closeWatchParty({ skipSummary = false } = {}) {
    console.log(`${LOG_PREFIX} Closing Watch Party... (skipSummary: ${skipSummary})`);

    // Stop frame capture loop
    _stopFrameLoop();

    // Stop screen capture
    stopScreenCapture();

    // Stop STT
    if (_sttEngine) {
        _sttEngine.stopListening();
        _sttEngine.onInterim = () => {};
        _sttEngine.onTranscript = () => {};
        _sttEngine.onStateChange = () => {};
    }

    // Stop TTS
    if (_ttsEngine) _ttsEngine.stop();

    _stopTimer();

    // ── Save session log ──
    if (_fullTranscript.length > 0) {
        const endTime = new Date().toISOString();
        const duration = _startTime ? Math.floor((Date.now() - _startTime) / 1000) : 0;

        let summary = '';
        if (!skipSummary && _fullTranscript.length >= 2) {
            _addSystemSubtitle('正在生成观影回忆...');
            try {
                summary = await generateWatchPartySummary(_fullTranscript, _sessionConfig);
            } catch (e) {
                console.warn(`${LOG_PREFIX} Summary generation failed:`, e);
            }
        }

        // Capture a final thumbnail for the call log
        const thumbnail = captureThumbnail();

        const callLog = {
            id: _callId,
            type: 'watch-party',
            startTime: new Date(_startTime).toISOString(),
            endTime,
            duration,
            summary,
            messages: [..._fullTranscript],
            contentType: _sessionConfig.contentType || 'other',
            contentTitle: _sessionConfig.contentTitle || '',
            thumbnails: thumbnail ? [thumbnail] : [],
            frameDescriptions: [..._frameDescriptions],
            sessionSummary: _sessionSummary,
            ..._sessionConfig.resumedFromId ? { resumedFrom: _sessionConfig.resumedFromId } : {},
        };

        saveCallLog(callLog);
        console.log(`${LOG_PREFIX} Watch party log saved: ${_fullTranscript.length} messages, ${duration}s`);
    }

    // ── Reset state ──
    _callId = null;
    _watchMessages = [];
    _fullTranscript = [];
    _isProcessingLLM = false;
    _isTtsPlaying = false;
    _sessionConfig = {};
    _systemPromptCache = null;
    _frameCount = 0;
    _frameDescriptions = [];
    _sessionSummary = '';
    _isCompressing = false;
    _systemPromptTokens = 0;

    _unmountOverlay();
}

// ═══════════════════════════════════════════════════════════════════════
// DOM & Events
// ═══════════════════════════════════════════════════════════════════════

function _initDOM() {
    const charInfo = getPhoneCharInfo();
    const charName = charInfo?.name || '未知联系人';
    const avatarUrl = charInfo?.avatar ? `/characters/${encodeURIComponent(charInfo.avatar)}` : '';

    const nameEl = document.getElementById('watch_party_name');
    const avatarEl = document.getElementById('watch_party_avatar');
    const bgEl = document.getElementById('watch_party_bg');
    const labelEl = document.getElementById('watch_party_content_label');

    if (nameEl) nameEl.textContent = charName;
    if (avatarEl && avatarUrl) avatarEl.src = avatarUrl;
    if (bgEl && avatarUrl) bgEl.style.backgroundImage = `url('${avatarUrl}')`;

    // Content label
    if (labelEl) {
        const typeLabels = { movie: '电影', anime: '动画', game: '游戏', video: '视频', other: '共享' };
        const label = _sessionConfig.contentTitle
            ? `${typeLabels[_sessionConfig.contentType] || '共享'} · ${_sessionConfig.contentTitle}`
            : `一起看${typeLabels[_sessionConfig.contentType] || '内容'}`;
        labelEl.textContent = label;
    }

    // Clear subtitles
    const subtitlesArea = document.getElementById('watch_party_subtitles');
    if (subtitlesArea) subtitlesArea.innerHTML = '';
}

function _bindEvents() {
    // Hangup
    const hangupBtn = document.getElementById('watch_party_hangup_btn');
    if (hangupBtn) {
        hangupBtn.onclick = () => _showHangupConfirmation();
    }

    // Mic toggle
    const micBtn = document.getElementById('watch_party_mic_btn');
    if (micBtn) {
        micBtn.onclick = () => {
            const isMuted = micBtn.classList.contains('muted');
            if (isMuted) {
                micBtn.classList.remove('muted');
                micBtn.innerHTML = '<i class="fa-solid fa-microphone"></i>';
                if (_sttEngine?.state === 'idle' && !_sttEngine.vadEnabled) {
                    _sttEngine.startListening({ continuous: true }).catch(e => console.error(e));
                }
            } else {
                micBtn.classList.add('muted');
                micBtn.innerHTML = '<i class="fa-solid fa-microphone-slash"></i>';
                if (_sttEngine?.state === 'listening' && !_sttEngine.vadEnabled) {
                    _sttEngine.stopListening();
                }
            }
        };
    }

    // Pause/resume frame capture
    const pauseBtn = document.getElementById('watch_party_pause_btn');
    if (pauseBtn) {
        pauseBtn.onclick = () => {
            _isPaused = !_isPaused;
            if (_isPaused) {
                pauseBtn.innerHTML = '<i class="ph ph-play"></i>';
                pauseBtn.title = '恢复截屏';
                pauseBtn.classList.add('paused');
                _addSystemSubtitle('截屏已暂停');
            } else {
                pauseBtn.innerHTML = '<i class="ph ph-pause"></i>';
                pauseBtn.title = '暂停截屏';
                pauseBtn.classList.remove('paused');
                _addSystemSubtitle('截屏已恢复');
            }
        };
    }

    // STT callbacks
    _sttEngine.onInterim = _onSttInterim;
    _sttEngine.onTranscript = _onSttTranscript;
    _sttEngine.onStateChange = _onSttStateChange;
}

// ─── Hangup Confirmation ───

function _showHangupConfirmation() {
    const controls = document.querySelector('.watch-party-controls');
    if (!controls || controls.classList.contains('confirming')) return;

    controls.classList.add('confirming');
    controls.innerHTML = `
        <div class="voice-hangup-confirm">
            <button class="voice-hangup-option with-summary" id="wp_hangup_with_summary">
                <i class="ph ph-note"></i>
                <span>结束并总结</span>
            </button>
            <button class="voice-hangup-option no-summary" id="wp_hangup_no_summary">
                <i class="ph ph-phone-disconnect"></i>
                <span>直接结束</span>
            </button>
        </div>`;

    document.getElementById('wp_hangup_with_summary').onclick = () => {
        closeWatchParty({ skipSummary: false });
    };
    document.getElementById('wp_hangup_no_summary').onclick = () => {
        closeWatchParty({ skipSummary: true });
    };

    // Auto-revert after 3s
    setTimeout(() => _hideHangupConfirmation(), 3000);
}

function _hideHangupConfirmation() {
    const controls = document.querySelector('.watch-party-controls');
    if (!controls || !controls.classList.contains('confirming')) return;

    controls.classList.remove('confirming');
    controls.innerHTML = `
        <button class="voice-control-btn mic" id="watch_party_mic_btn">
            <i class="fa-solid fa-microphone"></i>
        </button>
        <button class="voice-control-btn watch-pause" id="watch_party_pause_btn" title="暂停截屏">
            <i class="ph ph-pause"></i>
        </button>
        <button class="voice-control-btn hangup" id="watch_party_hangup_btn">
            <i class="fa-solid fa-phone-slash"></i>
        </button>`;

    _bindEvents();
}

// ═══════════════════════════════════════════════════════════════════════
// Timer
// ═══════════════════════════════════════════════════════════════════════

function _startTimer() {
    const timerEl = document.getElementById('watch_party_timer');
    _timerInterval = setInterval(() => {
        if (!timerEl) return;
        const elapsed = Math.floor((Date.now() - _startTime) / 1000);
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

// ═══════════════════════════════════════════════════════════════════════
// Frame Capture Loop
// ═══════════════════════════════════════════════════════════════════════

function _startFrameLoop() {
    const intervalMs = _sessionConfig.frameIntervalMs || DEFAULT_FRAME_INTERVAL_MS;
    const minLlmMs = _sessionConfig.minLlmIntervalMs || DEFAULT_MIN_LLM_INTERVAL_MS;
    console.log(`${LOG_PREFIX} Starting auto-frame loop (interval: ${intervalMs}ms, minLLM: ${minLlmMs}ms, freq: ${_sessionConfig.talkFrequency || 'default'})`);
    _frameInterval = setInterval(() => {
        if (_isPaused || _isProcessingLLM || !isCapturing()) return;

        // Enforce minimum interval between auto LLM calls
        const now = Date.now();
        if (now - _lastLLMCallTime < minLlmMs) return;

        const frame = captureFrame();
        if (!frame) return;

        _frameCount++;
        _lastFrameDataUrl = frame;
        console.log(`${LOG_PREFIX} Auto-captured frame #${_frameCount}`);

        // Send to LLM (auto-mode: no spoken text)
        _sendToLLM({ frameDataUrl: frame, spokenText: '' });
    }, intervalMs);
}

function _stopFrameLoop() {
    if (_frameInterval) {
        clearInterval(_frameInterval);
        _frameInterval = null;
    }
}

// ═══════════════════════════════════════════════════════════════════════
// STT Callbacks
// ═══════════════════════════════════════════════════════════════════════

let _currentUserBubble = null;

function _onSttInterim(text) {
    if (!text) return;
    const subs = document.getElementById('watch_party_subtitles');
    if (!subs) return;

    if (!_currentUserBubble) {
        subs.insertAdjacentHTML('beforeend', `<div class="voice-subtitle-bubble user interim" id="wp_current_user_bubble"></div>`);
        _currentUserBubble = document.getElementById('wp_current_user_bubble');
    }
    if (_currentUserBubble) {
        _currentUserBubble.textContent = text;
        _scrollToBottom();
    }
}

function _onSttTranscript(text) {
    if (!text) return;
    const subs = document.getElementById('watch_party_subtitles');
    if (!subs) return;

    if (_currentUserBubble) {
        _currentUserBubble.textContent = text;
        _currentUserBubble.classList.remove('interim');
        _currentUserBubble.removeAttribute('id');
        _currentUserBubble = null;
    } else {
        subs.insertAdjacentHTML('beforeend', `<div class="voice-subtitle-bubble user">${escapeHtml(text)}</div>`);
    }
    _scrollToBottom();

    // Record user message
    const userMsg = {
        role: 'user',
        content: text,
        timestamp: new Date().toISOString(),
    };
    _watchMessages.push(userMsg);
    _fullTranscript.push(userMsg);

    // Capture a fresh frame to pair with the user's speech
    const frame = captureFrame();
    if (frame) {
        _frameCount++;
        _lastFrameDataUrl = frame;
    }

    // Send to LLM with spoken text + current frame
    _sendToLLM({ frameDataUrl: frame || _lastFrameDataUrl, spokenText: text });
}

function _onSttStateChange(state) {
    const micBtn = document.getElementById('watch_party_mic_btn');
    if (!micBtn) return;

    if (state === 'processing') {
        micBtn.style.opacity = '0.5';
    } else {
        micBtn.style.opacity = '1';
    }

    // Auto-restart STT when idle
    if (state === 'idle' && _overlayMounted && _sttEngine) {
        const isMuted = micBtn.classList.contains('muted');
        if (!isMuted && !_isTtsPlaying) {
            setTimeout(() => {
                if (_overlayMounted && _sttEngine?.state === 'idle' && !_isTtsPlaying) {
                    _sttEngine.startListening({ continuous: true }).catch(e => {
                        console.warn(`${LOG_PREFIX} STT auto-restart failed:`, e);
                    });
                }
            }, 300);
        }
    }
}

function _restartSttAfterTts() {
    if (!_overlayMounted || !_sttEngine) return;
    const micBtn = document.getElementById('watch_party_mic_btn');
    const isMuted = micBtn?.classList.contains('muted');
    if (isMuted || _isTtsPlaying) return;
    if (_sttEngine.state !== 'idle') return;

    setTimeout(() => {
        if (_overlayMounted && _sttEngine?.state === 'idle' && !_isTtsPlaying) {
            _sttEngine.startListening({ continuous: true }).catch(e => {
                console.warn(`${LOG_PREFIX} STT restart after TTS failed:`, e);
            });
        }
    }, 300);
}

// ═══════════════════════════════════════════════════════════════════════
// UI Helpers
// ═══════════════════════════════════════════════════════════════════════

function _scrollToBottom() {
    const el = document.getElementById('watch_party_subtitles');
    if (el) el.scrollTop = el.scrollHeight;
}

function _addSystemSubtitle(text) {
    const subs = document.getElementById('watch_party_subtitles');
    if (subs) {
        subs.insertAdjacentHTML('beforeend', `<div class="voice-subtitle-bubble system">${escapeHtml(text)}</div>`);
        _scrollToBottom();
    }
}

// ═══════════════════════════════════════════════════════════════════════
// LLM Integration — multimodal call with screen frame
// ═══════════════════════════════════════════════════════════════════════

/**
 * Send a frame + optional spoken text to the LLM and handle the response.
 * @param {object} params
 * @param {string} params.frameDataUrl - Base64 data URL of the screen capture frame
 * @param {string} [params.spokenText] - User's spoken text (from STT)
 */
async function _sendToLLM({ frameDataUrl, spokenText = '' }) {
    if (_isProcessingLLM) {
        console.log(`${LOG_PREFIX} LLM already processing, skipping.`);
        return;
    }

    _isProcessingLLM = true;
    _lastLLMCallTime = Date.now();

    const subs = document.getElementById('watch_party_subtitles');
    let charBubble = null;

    try {
        // Create thinking indicator
        if (subs && spokenText) {
            // Only show thinking bubble when replying to user speech
            subs.insertAdjacentHTML('beforeend',
                `<div class="voice-subtitle-bubble char" id="wp_thinking_bubble">` +
                `<span class="streaming-cursor"></span></div>`
            );
            charBubble = document.getElementById('wp_thinking_bubble');
            _scrollToBottom();
        }

        // Build user prompt (now returns object with compression metadata)
        const elapsedMinutes = Math.floor((Date.now() - _startTime) / 60000);
        const promptResult = buildWatchPartyUserPrompt({
            spokenText,
            watchHistory: _watchMessages,
            elapsedMinutes,
            frameCount: _frameCount,
            frameDescriptions: _frameDescriptions,
            sessionSummary: _sessionSummary,
            systemPromptTokens: _systemPromptTokens,
        });

        // ── Multimodal LLM call with image ──
        const images = frameDataUrl ? [frameDataUrl] : [];
        const response = await callPhoneLLM(_systemPromptCache, promptResult.prompt, { images });

        if (!response || !response.trim()) {
            console.log(`${LOG_PREFIX} LLM returned empty response, treating as silence.`);
            if (charBubble) charBubble.remove();
            return;
        }

        const cleanResponse = response.trim();

        // ── Extract <scene> tag (visual memory — hidden from user) ──
        const sceneMatch = cleanResponse.match(/<scene>(.*?)<\/scene>/s);
        if (sceneMatch && sceneMatch[1]) {
            const sceneDesc = sceneMatch[1].trim();
            if (sceneDesc) {
                const elapsed = Math.floor((Date.now() - _startTime) / 1000);
                const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
                const ss = String(elapsed % 60).padStart(2, '0');
                _frameDescriptions.push({
                    frameNum: _frameCount,
                    timestamp: `${mm}:${ss}`,
                    description: sceneDesc,
                });
                console.log(`${LOG_PREFIX} 🖼️ Scene memory stored: #${_frameCount} — ${sceneDesc.substring(0, 60)}...`);
            }
        }

        // Strip <scene> tag from response before display/TTS
        let displayResponse = cleanResponse.replace(/<scene>.*?<\/scene>/gs, '').trim();

        // Strip any remaining leaked tags (<think>, <状态栏>, etc.)
        displayResponse = stripLLMTags(displayResponse);

        // Parse <say tone="..."> tags (using cleaned response without <scene>)
        const parsed = parseSayTags(displayResponse);
        const displayText = parsed.fullText;
        const emotion = parsed.primaryTone;

        // ── Check for silence response ──
        if (emotion === 'silent' || !displayText || displayText.trim().length === 0) {
            console.log(`${LOG_PREFIX} Character chose to stay silent.`);
            if (charBubble) charBubble.remove();
            return;
        }

        console.log(`${LOG_PREFIX} Response: emotion="${emotion}", text="${displayText.substring(0, 50)}..."`);

        // Record char message
        const charMessageEntry = {
            role: 'char',
            content: displayText,
            timestamp: new Date().toISOString(),
        };
        _watchMessages.push(charMessageEntry);
        _fullTranscript.push(charMessageEntry);

        // ── TTS playback ──
        if (_ttsEngine) {
            _isTtsPlaying = true;
            if (_sttEngine?.state === 'listening') {
                _sttEngine.stopListening();
            }

            // Typewriter display
            if (charBubble) {
                charBubble.removeAttribute('id');
                _typewriterDisplay(charBubble, displayText);
            } else if (subs) {
                // For auto-mode responses (no thinking bubble was created)
                subs.insertAdjacentHTML('beforeend',
                    `<div class="voice-subtitle-bubble char"></div>`
                );
                const newBubble = subs.lastElementChild;
                _typewriterDisplay(newBubble, displayText);
            }

            // Play TTS segments
            const audioBlobs = [];
            for (let i = 0; i < parsed.segments.length; i++) {
                const seg = parsed.segments[i];
                if (!seg.text || seg.text.trim().length === 0) continue;

                const sentences = _splitIntoSentences(seg.text);
                for (let j = 0; j < sentences.length; j++) {
                    try {
                        const ttsResult = await _ttsEngine.speakAndCapture(sentences[j], seg.tone);
                        if (ttsResult) {
                            if (ttsResult.audioBlob) audioBlobs.push(ttsResult.audioBlob);
                            if (ttsResult.duration > 0) {
                                await new Promise(r => setTimeout(r, ttsResult.duration * 1000));
                            }
                        }
                    } catch (e) {
                        console.warn(`${LOG_PREFIX} TTS sentence failed:`, e);
                    }
                }
            }

            // Upload merged audio
            if (audioBlobs.length > 0) {
                try {
                    const mergedBlob = new Blob(audioBlobs, { type: 'audio/mpeg' });
                    const audioPath = await uploadAudioToST(mergedBlob, 'watch_party');
                    charMessageEntry.audioPath = audioPath;
                } catch (uploadErr) {
                    console.warn(`${LOG_PREFIX} TTS audio upload failed:`, uploadErr);
                }
            }
        } else {
            // No TTS — just show text
            if (charBubble) {
                charBubble.removeAttribute('id');
                charBubble.textContent = displayText;
            } else if (subs) {
                subs.insertAdjacentHTML('beforeend',
                    `<div class="voice-subtitle-bubble char">${escapeHtml(displayText)}</div>`
                );
            }
        }

        _scrollToBottom();
        _isTtsPlaying = false;
        _restartSttAfterTts();

    } catch (e) {
        console.error(`${LOG_PREFIX} LLM call failed:`, e);
        if (charBubble) {
            charBubble.removeAttribute('id');
            charBubble.textContent = '（信号不好...）';
            charBubble.classList.add('system');
            charBubble.classList.remove('char');
        }
    } finally {
        _isProcessingLLM = false;
        if (_isTtsPlaying) {
            _isTtsPlaying = false;
            _restartSttAfterTts();
        }

        // ── Trigger async compression if needed (non-blocking) ──
        // Re-check after LLM call since we may have added new frame descriptions
        if (!_isCompressing) {
            const elapsedMinutes = Math.floor((Date.now() - _startTime) / 60000);
            const checkResult = buildWatchPartyUserPrompt({
                spokenText: '',
                watchHistory: _watchMessages,
                elapsedMinutes,
                frameCount: _frameCount,
                frameDescriptions: _frameDescriptions,
                sessionSummary: _sessionSummary,
                systemPromptTokens: _systemPromptTokens,
            });
            if (checkResult.needsCompression && checkResult.compressionPayload) {
                _compressSessionHistory(checkResult.compressionPayload);
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Context Compression — async, non-blocking
// ═══════════════════════════════════════════════════════════════════════

/**
 * Compress old dialog + frame descriptions into a rolling summary.
 * Runs in the background — does NOT block frame capture or LLM calls.
 * @param {object} compressionPayload - From buildWatchPartyUserPrompt
 */
async function _compressSessionHistory(compressionPayload) {
    if (_isCompressing || !_overlayMounted) return;
    _isCompressing = true;

    const { dialogCutoff, frameCutoff } = compressionPayload;
    console.log(`${LOG_PREFIX} 📝 Starting context compression (dialog: ${dialogCutoff} msgs, frames: ${frameCutoff} descs)...`);

    try {
        const systemPrompt = buildWatchPartySummarizePrompt();
        const userPrompt = buildCompressionUserPrompt(compressionPayload);
        const newSummary = await callPhoneLLM(systemPrompt, userPrompt, { maxTokens: 1500 });

        if (newSummary?.trim()) {
            _sessionSummary = newSummary.trim();

            // Remove compressed messages from working arrays
            _watchMessages.splice(0, dialogCutoff);
            _frameDescriptions.splice(0, frameCutoff);

            console.log(`${LOG_PREFIX} ✅ Context compressed: summary ${_sessionSummary.length} chars, remaining dialog: ${_watchMessages.length}, frames: ${_frameDescriptions.length}`);
        } else {
            console.warn(`${LOG_PREFIX} ⚠️ Compression returned empty result, skipping`);
        }
    } catch (e) {
        console.error(`${LOG_PREFIX} ❌ Context compression failed:`, e);
    } finally {
        _isCompressing = false;
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Text Helpers (mirrored from voiceCallUI.js)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Split text into sentences for TTS.
 */
function _splitIntoSentences(text) {
    if (!text || text.trim().length === 0) return [];
    const sentences = text.split(/(?<=[.!?。！？])\s+/);
    const result = sentences.map(s => s.trim()).filter(s => s.length > 0);
    return result.length > 0 ? result : [text.trim()];
}

/**
 * Typewriter effect for subtitle bubbles.
 */
function _typewriterDisplay(bubble, text) {
    if (!bubble) return;

    let idx = 0;
    const charDelay = 50; // slightly faster for watch party (shorter responses)

    bubble.textContent = '';
    bubble.insertAdjacentHTML('beforeend', '<span class="streaming-cursor"></span>');

    const interval = setInterval(() => {
        if (idx < text.length) {
            const cursor = bubble.querySelector('.streaming-cursor');
            if (cursor) {
                cursor.insertAdjacentText('beforebegin', text[idx]);
            }
            idx++;
            _scrollToBottom();
        } else {
            clearInterval(interval);
            const cursor = bubble.querySelector('.streaming-cursor');
            if (cursor) cursor.remove();
        }
    }, charDelay);
}
