// modules/phone/chat/voiceMessageService.js — 语音消息服务
// 录音、STT 转写、TTS 合成、音频播放、ST 文件存储。
// 供 chatApp.js 使用，完全独立于 voiceCall 模块。

import { getSttEngine } from '../voiceCall/sttInit.js';
import { getTtsEngine } from '../voiceCall/tts/ttsInit.js';

const LOG = '[VoiceMsg]';
const MAX_DURATION = 60; // seconds

// ═══════════════════════════════════════════════════════════════════════
// State
// ═══════════════════════════════════════════════════════════════════════

/** @type {MediaRecorder|null} */
let _recorder = null;
/** @type {MediaStream|null} */
let _stream = null;
/** @type {Blob[]} */
let _chunks = [];
/** @type {number} */
let _startTime = 0;
/** @type {number|null} */
let _timerInterval = null;
/** @type {number|null} */
let _maxTimer = null;

/** @type {AudioContext|null} */
let _playCtx = null;
/** @type {AudioBufferSourceNode|null} */
let _playSource = null;
let _isPlaying = false;

/** @type {(seconds: number) => void} 计时器回调 */
let _onTick = () => {};

/** @type {string} Browser STT 实时转写结果（录音期间捕获） */
let _liveTranscript = '';
let _liveRecognitionActive = false;

// ═══════════════════════════════════════════════════════════════════════
// Recording
// ═══════════════════════════════════════════════════════════════════════

/**
 * 开始录音。
 * @param {Object} opts
 * @param {(seconds: number) => void} [opts.onTick] - 每秒回调，传入已录时长
 * @param {(text: string) => void} [opts.onInterim] - 实时 STT 中间结果回调
 * @returns {Promise<void>}
 */
export async function startRecording(opts = {}) {
    if (_recorder && _recorder.state === 'recording') {
        console.warn(`${LOG} already recording`);
        return;
    }

    _onTick = opts.onTick || (() => {});
    const _onInterim = opts.onInterim || (() => {});
    _chunks = [];

    _stream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleSize: 16, channelCount: 1, sampleRate: 16000 },
    });

    _recorder = new MediaRecorder(_stream);
    _recorder.ondataavailable = (e) => {
        if (e.data.size > 0) _chunks.push(e.data);
    };

    _startTime = Date.now();
    _recorder.start();

    // ── Browser STT: start live recognition alongside MediaRecorder ──
    _liveTranscript = '';
    _liveRecognitionActive = false;
    try {
        const engine = getSttEngine();
        const provider = engine.currentProvider;
        const providerName = engine.currentProviderName;

        if (providerName?.toLowerCase() === 'browser' && provider?.startRecognition) {
            const settings = engine.getSettings();
            _liveRecognitionActive = true;
            provider.startRecognition({
                language: settings.language || 'zh-CN',
                onTranscript: (text) => {
                    _liveTranscript = text;
                    _onInterim(text); // show final result too
                    console.debug(`${LOG} live transcript: "${text}"`);
                },
                onInterim: (text) => {
                    _onInterim(text); // real-time preview
                },
                onEnd: () => { _liveRecognitionActive = false; },
                onError: (err) => {
                    console.warn(`${LOG} live STT error:`, err);
                    _liveRecognitionActive = false;
                },
            });
        }
    } catch (e) {
        console.warn(`${LOG} live STT setup failed:`, e);
    }

    // 每秒回调
    _timerInterval = setInterval(() => {
        const sec = Math.floor((Date.now() - _startTime) / 1000);
        _onTick(sec);
    }, 1000);

    // 自动停止上限
    _maxTimer = setTimeout(() => {
        if (_recorder && _recorder.state === 'recording') {
            console.log(`${LOG} max duration reached (${MAX_DURATION}s)`);
            _recorder.stop();
        }
    }, MAX_DURATION * 1000);

    console.debug(`${LOG} recording started`);
}

/**
 * 停止录音，返回音频 blob 和时长。
 * @returns {Promise<{ audioBlob: Blob, duration: number } | null>}
 */
export function stopRecording() {
    return new Promise((resolve) => {
        _clearTimers();
        _stopLiveRecognition();

        if (!_recorder || _recorder.state === 'inactive') {
            _releaseStream();
            resolve(null);
            return;
        }

        _recorder.onstop = () => {
            const duration = Math.round((Date.now() - _startTime) / 1000);
            const audioBlob = new Blob(_chunks, { type: 'audio/webm;codecs=opus' });
            _releaseStream();
            console.debug(`${LOG} recording stopped, duration=${duration}s, size=${audioBlob.size}`);
            resolve({ audioBlob, duration: Math.max(duration, 1) });
        };

        _recorder.stop();
    });
}

/**
 * 取消录音，丢弃数据。
 */
export function cancelRecording() {
    _clearTimers();
    _stopLiveRecognition();
    if (_recorder && _recorder.state !== 'inactive') {
        _recorder.onstop = null;
        _recorder.stop();
    }
    _chunks = [];
    _liveTranscript = '';
    _releaseStream();
    console.debug(`${LOG} recording cancelled`);
}

/** 是否正在录音 */
export function isRecording() {
    return _recorder?.state === 'recording';
}

// ═══════════════════════════════════════════════════════════════════════
// STT Transcription
// ═══════════════════════════════════════════════════════════════════════

/**
 * 将录音 blob 转写为文字。
 * 复用 sttEngine 的 provider (需先在 settings 中配置 STT provider)。
 * @param {Blob} audioBlob - webm/opus 格式
 * @returns {Promise<string>} 转写文字
 */
export async function transcribe(audioBlob) {
    const engine = getSttEngine();
    const provider = engine.currentProvider;
    const providerName = engine.currentProviderName;

    if (!provider || providerName === 'none') {
        throw new Error('未配置 STT 引擎，请在设置中选择 STT Provider');
    }

    // Browser provider: use the live transcript captured during recording
    if (providerName?.toLowerCase() === 'browser') {
        const text = _liveTranscript.trim();
        _liveTranscript = '';
        console.debug(`${LOG} transcribed (browser live): "${text}"`);
        return text;
    }

    // Other providers (Groq/OpenAI/Whisper/KoboldCpp): processAudio with WAV
    if (typeof provider.processAudio !== 'function') {
        throw new Error(`STT Provider "${providerName}" 不支持音频转写`);
    }

    const wavBlob = await _convertToWav(audioBlob);

    const settings = engine.getSettings();
    const providerOpts = {
        ...engine.getProviderSettings(providerName),
        language: settings.language,
    };

    const transcript = await provider.processAudio(wavBlob, providerOpts);
    console.debug(`${LOG} transcribed: "${transcript}"`);
    return transcript?.trim() || '';
}

// ═══════════════════════════════════════════════════════════════════════
// TTS Synthesis
// ═══════════════════════════════════════════════════════════════════════

/**
 * 将文字 TTS 合成为音频 blob + base64。
 * @param {string} text
 * @returns {Promise<{ audioBlob: Blob, duration: number, base64: string } | null>}
 */
export async function synthesizeToBlob(text) {
    const engine = getTtsEngine();
    const provider = engine.currentProvider;
    const providerName = engine.currentProviderName;

    if (!provider || providerName === 'none') {
        console.debug(`${LOG} no TTS provider, skipping`);
        return null;
    }

    if (!text?.trim()) return null;

    const providerSettings = engine.getProviderSettings(providerName);
    const arrayBuffer = await provider.synthesize(text, providerSettings);
    const audioBlob = new Blob([arrayBuffer], { type: 'audio/mpeg' });

    // 获取时长
    const duration = await _getAudioDuration(arrayBuffer);

    // base64
    const base64 = await blobToBase64(audioBlob);

    console.debug(`${LOG} TTS synthesized: ${duration.toFixed(1)}s, ${audioBlob.size} bytes`);
    return { audioBlob, duration, base64 };
}

// ═══════════════════════════════════════════════════════════════════════
// Audio Playback
// ═══════════════════════════════════════════════════════════════════════

/**
 * 播放音频（从 base64 或 URL path）。
 * @param {string} audioSrc - base64 data URI 或 web path
 * @param {Object} [opts]
 * @param {() => void} [opts.onEnd] - 播放结束回调
 * @returns {Promise<number>} duration in seconds
 */
export async function playAudio(audioSrc, opts = {}) {
    stopAudio(); // 停掉上一个

    if (!_playCtx) _playCtx = new AudioContext();
    if (_playCtx.state === 'suspended') await _playCtx.resume();

    let arrayBuffer;
    if (audioSrc.startsWith('data:')) {
        // base64 data URI
        const b64 = audioSrc.split(',')[1];
        arrayBuffer = _base64ToArrayBuffer(b64);
    } else {
        // web path — fetch it
        const resp = await fetch(audioSrc.startsWith('/') ? audioSrc : `/${audioSrc}`);
        arrayBuffer = await resp.arrayBuffer();
    }

    const decoded = await _playCtx.decodeAudioData(arrayBuffer.slice(0));
    const source = _playCtx.createBufferSource();
    source.buffer = decoded;
    source.connect(_playCtx.destination);

    _playSource = source;
    _isPlaying = true;

    source.onended = () => {
        _isPlaying = false;
        _playSource = null;
        opts.onEnd?.();
    };

    source.start(0);
    return decoded.duration;
}

/**
 * 停止当前播放。
 */
export function stopAudio() {
    if (_playSource) {
        try { _playSource.stop(); } catch (_) { /* */ }
        _playSource = null;
    }
    _isPlaying = false;
}

/** 是否正在播放 */
export function isAudioPlaying() {
    return _isPlaying;
}

// ═══════════════════════════════════════════════════════════════════════
// ST File Upload — 音频持久化
// ═══════════════════════════════════════════════════════════════════════

/**
 * 将音频 blob 上传到 SillyTavern 服务器文件系统。
 * 使用 /api/files/upload API（与 TheSingularity 相同方案）。
 * @param {Blob} audioBlob
 * @param {string} [prefix='voice'] - 文件名前缀
 * @returns {Promise<string>} 服务器端 web path (例如 'user/files/voice_xxx.webm')
 */
export async function uploadAudioToST(audioBlob, prefix = 'voice') {
    const base64Data = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result.split(',')[1]);
        reader.readAsDataURL(audioBlob);
    });

    const ext = audioBlob.type.includes('mp3') || audioBlob.type.includes('mpeg')
        ? 'mp3'
        : 'webm';
    const filename = `${prefix}_${Date.now()}.${ext}`;

    return new Promise((resolve, reject) => {
        jQuery.ajax({
            url: '/api/files/upload',
            type: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({ name: filename, data: base64Data }),
            success: (result) => {
                const webPath = (result.path || `user/files/${filename}`).replace(/\\/g, '/');
                console.debug(`${LOG} uploaded: ${webPath}`);
                resolve(webPath);
            },
            error: (xhr, status, err) => {
                console.error(`${LOG} upload failed:`, xhr.responseText);
                reject(new Error(`Upload failed: ${xhr.status} ${err}`));
            },
        });
    });
}

// ═══════════════════════════════════════════════════════════════════════
// Utilities
// ═══════════════════════════════════════════════════════════════════════

/**
 * Blob → base64 data URI
 * @param {Blob} blob
 * @returns {Promise<string>}
 */
export function blobToBase64(blob) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(blob);
    });
}

/**
 * base64 string → ArrayBuffer
 * @param {string} b64
 * @returns {ArrayBuffer}
 */
function _base64ToArrayBuffer(b64) {
    const binary = atob(b64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
}

/**
 * 获取 ArrayBuffer 音频的时长(秒)
 * @param {ArrayBuffer} arrayBuffer
 * @returns {Promise<number>}
 */
async function _getAudioDuration(arrayBuffer) {
    try {
        const ctx = new AudioContext();
        const buf = await ctx.decodeAudioData(arrayBuffer.slice(0));
        const dur = buf.duration;
        await ctx.close();
        return dur;
    } catch {
        return 0;
    }
}

/**
 * webm/opus → WAV (for STT APIs that expect WAV)
 * @param {Blob} audioBlob
 * @returns {Promise<Blob>}
 */
async function _convertToWav(audioBlob) {
    const arrayBuffer = await audioBlob.arrayBuffer();
    const audioContext = new AudioContext();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    await audioContext.close();

    return new Promise((resolve, reject) => {
        const scriptUrl = import.meta.url;
        const voiceCallDir = scriptUrl.substring(0, scriptUrl.lastIndexOf('/'));
        // waveWorker 在 voiceCall 目录中
        const workerPath = `${voiceCallDir}/../voiceCall/waveWorker.js`;
        const worker = new Worker(workerPath);

        worker.onmessage = (e) => {
            const blob = new Blob([e.data.buffer], { type: 'audio/wav' });
            resolve(blob);
        };
        worker.onerror = (e) => {
            console.error(`${LOG} waveWorker error:`, e);
            reject(new Error('WAV conversion failed'));
        };

        const pcmArrays = [];
        for (let i = 0; i < audioBuffer.numberOfChannels; i++) {
            pcmArrays.push(audioBuffer.getChannelData(i));
        }
        worker.postMessage({
            pcmArrays,
            config: { sampleRate: audioBuffer.sampleRate },
        });
    });
}

// ── Internal helpers ──

function _clearTimers() {
    if (_timerInterval) { clearInterval(_timerInterval); _timerInterval = null; }
    if (_maxTimer) { clearTimeout(_maxTimer); _maxTimer = null; }
}

function _releaseStream() {
    if (_stream) {
        _stream.getTracks().forEach(t => t.stop());
        _stream = null;
    }
    _recorder = null;
}

/** Stop Browser STT live recognition if active */
function _stopLiveRecognition() {
    if (_liveRecognitionActive) {
        try {
            const engine = getSttEngine();
            engine.currentProvider?.stopRecognition?.();
        } catch (_) { /* */ }
        _liveRecognitionActive = false;
    }
}
