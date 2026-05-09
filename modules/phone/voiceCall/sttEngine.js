// modules/phone/voiceCall/sttEngine.js — STT 主控制器
// 管理 Provider 注册/切换、录音（MediaRecorder）、WAV 转换（Web Worker）、统一回调。

import { VoiceActivityDetector } from './vad.js';
import { getPhoneSetting, setPhoneSetting } from '../phoneSettings.js';

const LOG_PREFIX = '[SttEngine]';

/** @enum {string} */
export const SttState = {
    IDLE: 'idle',
    LISTENING: 'listening',
    PROCESSING: 'processing',
    ERROR: 'error',
};

// ── 设置持久化 key ──
const SETTINGS_KEY = 'gf_phone_stt_settings';

/**
 * @typedef {Object} SttSettings
 * @property {string} provider   - 当前选中的 Provider 名称
 * @property {string} language   - 语言代码 (e.g. 'zh-CN')
 * @property {boolean} vadEnabled - 是否启用语音激活
 * @property {Object} providerSettings - 每个 Provider 的专属设置 { [providerName]: {...} }
 */

export class SttEngine {
    constructor() {
        /** @type {Map<string, { ProviderClass: Function, instance: Object|null }>} */
        this._providers = new Map();

        /** @type {Object|null} 当前活跃的 Provider 实例 */
        this._activeProvider = null;
        this._activeProviderName = 'none';

        /** @type {SttState} */
        this._state = SttState.IDLE;

        // MediaRecorder 相关
        /** @type {MediaRecorder|null} */
        this._mediaRecorder = null;
        /** @type {Blob[]} */
        this._audioChunks = [];
        /** @type {MediaStream|null} */
        this._mediaStream = null;

        // VAD 相关
        /** @type {VoiceActivityDetector|null} */
        this._vad = null;
        /** @type {AudioContext|null} VAD 自己的 AudioContext，destroy 时需要 close */
        this._vadAudioContext = null;

        // Per-utterance abort controller — covers the processAudio fetch (transcribe call).
        // Aborted when stopListening / setProvider switches happen, so a slow Whisper
        // request from a previous utterance doesn't deliver its transcript after the user
        // moved on. Created fresh on each MediaRecorder.onstop.
        /** @type {AbortController|null} */
        this._processCtrl = null;

        // ── 回调接口 ──
        /** @type {(text: string) => void} 最终识别结果 */
        this.onTranscript = () => { };
        /** @type {(text: string) => void} 中间结果（实时预览） */
        this.onInterim = () => { };
        /** @type {(state: SttState) => void} 状态变化 */
        this.onStateChange = () => { };
        /** @type {(error: Error) => void} 错误回调 */
        this.onError = () => { };

        // 加载持久化设置
        this._settings = this._loadSettings();
    }

    // ═══════════════════════════════════════════════════════════════
    // Provider 管理
    // ═══════════════════════════════════════════════════════════════

    /**
     * 注册一个 STT Provider
     * @param {string} name - Provider 名称
     * @param {Function} ProviderClass - Provider 类（需实现 processAudio / isAvailable 等方法）
     */
    registerProvider(name, ProviderClass) {
        this._providers.set(name, { ProviderClass, instance: null });
        console.debug(`${LOG_PREFIX} registered provider: ${name}`);
    }

    /**
     * 切换到指定 Provider
     * @param {string} name
     */
    async setProvider(name) {
        // 先停止当前录音
        if (this._state === SttState.LISTENING) {
            await this.stopListening();
        }

        // Cancel any in-flight transcribe request from the previous provider —
        // we don't want a delayed transcript from the old engine surfacing on
        // the new one's callbacks.
        if (this._processCtrl && !this._processCtrl.signal.aborted) {
            try { this._processCtrl.abort(); } catch { /* ignore */ }
            this._processCtrl = null;
        }

        if (name === 'none' || !this._providers.has(name)) {
            this._activeProvider = null;
            this._activeProviderName = 'none';
            this._settings.provider = 'none';
            this._saveSettings();
            console.debug(`${LOG_PREFIX} provider set to: none`);
            return;
        }

        const entry = this._providers.get(name);
        if (!entry.instance) {
            entry.instance = new entry.ProviderClass();
        }
        this._activeProvider = entry.instance;
        this._activeProviderName = name;
        this._settings.provider = name;
        this._saveSettings();
        console.debug(`${LOG_PREFIX} provider set to: ${name}`);
    }

    /**
     * 获取所有已注册 Provider 及其可用状态
     * @returns {{ name: string, available: boolean }[]}
     */
    getAvailableProviders() {
        const result = [];
        for (const [name, entry] of this._providers) {
            let available = true;
            try {
                if (!entry.instance) entry.instance = new entry.ProviderClass();
                available = typeof entry.instance.isAvailable === 'function'
                    ? entry.instance.isAvailable()
                    : true;
            } catch { available = false; }
            result.push({ name, available });
        }
        return result;
    }

    /** 获取当前 Provider 名称 */
    get currentProviderName() { return this._activeProviderName; }

    /** 获取当前 Provider 实例 */
    get currentProvider() { return this._activeProvider; }

    // ═══════════════════════════════════════════════════════════════
    // 录音控制
    // ═══════════════════════════════════════════════════════════════

    /**
     * 开始监听语音
     * Browser Provider 使用自己的 SpeechRecognition，不经过 MediaRecorder。
     * 其她 Provider 使用 MediaRecorder 录音 → WAV 转换 → processAudio。
     */
    async startListening() {
        if (!this._activeProvider) {
            console.warn(`${LOG_PREFIX} no active provider`);
            return;
        }

        if (this._state === SttState.LISTENING) {
            console.debug(`${LOG_PREFIX} already listening`);
            return;
        }

        // Concurrency guard: refuse to start a new utterance while the previous
        // one's transcribe call is still in flight (audit report #23). Otherwise
        // two MediaRecorder cycles can race and deliver transcripts out of order.
        if (this._state === SttState.PROCESSING) {
            console.debug(`${LOG_PREFIX} transcribe in progress, deferring new startListening`);
            return;
        }

        this._setState(SttState.LISTENING);

        try {
            // Browser Provider 有自己的 SpeechRecognition API
            if (typeof this._activeProvider.startRecognition === 'function') {
                await this._activeProvider.startRecognition({
                    language: this._settings.language,
                    onTranscript: (text) => this.onTranscript(text),
                    onInterim: (text) => this.onInterim(text),
                    onEnd: () => this._setState(SttState.IDLE),
                    onError: (err) => {
                        this.onError(err);
                        this._setState(SttState.ERROR);
                    },
                });
                return;
            }

            // 其她 API-based Provider → MediaRecorder 录音
            await this._startMediaRecording();

        } catch (err) {
            const msg = err?.message || err?.name || String(err);
            console.error(`${LOG_PREFIX} startListening failed: ${msg}`, err);
            this.onError(err instanceof Error ? err : new Error(msg));
            this._setState(SttState.ERROR);
        }
    }

    /**
     * 停止监听并处理音频
     */
    async stopListening() {
        if (this._state !== SttState.LISTENING) {
            // If we're mid-transcribe (PROCESSING), kill the in-flight fetch so a
            // hung request doesn't keep the engine stuck. Bail otherwise.
            if (this._state === SttState.PROCESSING && this._processCtrl) {
                try { this._processCtrl.abort(); } catch { /* ignore */ }
            }
            return;
        }

        // Browser Provider
        if (this._activeProvider && typeof this._activeProvider.stopRecognition === 'function') {
            this._activeProvider.stopRecognition();
            this._setState(SttState.IDLE);
            return;
        }

        // MediaRecorder
        if (this._mediaRecorder && this._mediaRecorder.state !== 'inactive') {
            this._mediaRecorder.stop();
            // onstop handler will process the audio
        }
    }

    /** 当前是否正在监听 */
    get isListening() { return this._state === SttState.LISTENING; }

    /** 当前状态 */
    get state() { return this._state; }

    // ═══════════════════════════════════════════════════════════════
    // VAD (Voice Activity Detection)
    // ═══════════════════════════════════════════════════════════════

    /** VAD 是否启用 */
    get vadEnabled() { return this._settings.vadEnabled; }

    /** 设置 VAD 开关 */
    set vadEnabled(val) {
        this._settings.vadEnabled = !!val;
        this._saveSettings();
        // 如果正在录音且有 stream，重新配置 VAD
        if (this._mediaStream) {
            this._destroyVAD();
            if (val) this._setupVAD(this._mediaStream);
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // 设置
    // ═══════════════════════════════════════════════════════════════

    /** 获取当前设置（只读拷贝） */
    getSettings() { return { ...this._settings }; }

    /**
     * 更新设置
     * @param {Partial<SttSettings>} updates
     */
    updateSettings(updates) {
        Object.assign(this._settings, updates);
        this._saveSettings();
    }

    /** 获取当前语言 */
    get language() { return this._settings.language; }
    set language(val) {
        this._settings.language = val;
        this._saveSettings();
    }

    /**
     * 获取指定 Provider 的专属设置
     * @param {string} providerName
     * @returns {Object}
     */
    getProviderSettings(providerName) {
        return this._settings.providerSettings[providerName] || {};
    }

    /**
     * 更新指定 Provider 的专属设置
     * @param {string} providerName
     * @param {Object} updates
     */
    updateProviderSettings(providerName, updates) {
        if (!this._settings.providerSettings[providerName]) {
            this._settings.providerSettings[providerName] = {};
        }
        Object.assign(this._settings.providerSettings[providerName], updates);
        this._saveSettings();
    }

    // ═══════════════════════════════════════════════════════════════
    // 销毁
    // ═══════════════════════════════════════════════════════════════

    destroy() {
        this.stopListening();
        this._destroyVAD();
        this._releaseMediaStream();
        console.debug(`${LOG_PREFIX} destroyed`);
    }

    // ═══════════════════════════════════════════════════════════════
    // 内部方法
    // ═══════════════════════════════════════════════════════════════

    _setState(newState) {
        if (this._state === newState) return;
        this._state = newState;
        this.onStateChange(newState);
        console.debug(`${LOG_PREFIX} state → ${newState}`);
    }

    /** MediaRecorder 录音流程 */
    async _startMediaRecording() {
        // Safari / iOS 在 HTTP 下不暴露 mediaDevices，提前检测并给出友好提示
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error(
                '无法访问麦克风：当前浏览器要求 HTTPS 才能使用录音功能。'
                + '请通过 HTTPS 或 localhost 访问酒馆，或在 PC 端使用 Edge/Chrome。'
            );
        }

        const constraints = {
            audio: { sampleSize: 16, channelCount: 1, sampleRate: 16000 },
        };

        this._mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
        this._audioChunks = [];

        // 设置 VAD（如果启用）
        if (this._settings.vadEnabled) {
            this._setupVAD(this._mediaStream);
        }

        this._mediaRecorder = new MediaRecorder(this._mediaStream);

        this._mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) this._audioChunks.push(e.data);
        };

        this._mediaRecorder.onstop = async () => {
            this._setState(SttState.PROCESSING);

            // Fresh per-utterance controller — stopListening / setProvider can abort
            // this if the user moves on while the transcribe fetch is in flight.
            this._processCtrl = new AbortController();
            const signal = this._processCtrl.signal;

            try {
                const audioBlob = new Blob(this._audioChunks, { type: 'audio/webm;codecs=opus' });
                const wavBlob = await this._convertToWav(audioBlob);

                if (signal.aborted) throw new DOMException('aborted', 'AbortError');

                // 将 providerSettings（apiKey, proxyServer, model 等）+ language 传给 provider
                const providerOpts = {
                    ...this.getProviderSettings(this._activeProviderName),
                    language: this._settings.language,
                };
                const transcript = await this._activeProvider.processAudio(wavBlob, providerOpts, signal);

                if (signal.aborted) {
                    console.debug(`${LOG_PREFIX} transcript dropped — aborted before delivery`);
                } else if (transcript && transcript.trim()) {
                    console.debug(`${LOG_PREFIX} transcript: "${transcript}"`);
                    this.onTranscript(transcript.trim());
                }
            } catch (err) {
                if (err?.name === 'AbortError') {
                    console.debug(`${LOG_PREFIX} processAudio aborted (session ended).`);
                } else {
                    console.error(`${LOG_PREFIX} processAudio failed:`, err);
                    this.onError(err);
                }
            } finally {
                this._processCtrl = null;
                // Release the chunk array reference so GC can reclaim the encoded
                // audio blobs (long calls otherwise keep them alive for the whole session).
                this._audioChunks = [];
            }

            // 如果 VAD 未启用，释放麦克风
            if (!this._settings.vadEnabled) {
                this._releaseMediaStream();
            }

            this._setState(SttState.IDLE);
        };

        this._mediaRecorder.start();
        console.debug(`${LOG_PREFIX} MediaRecorder started`);
    }

    /**
     * 将 webm/opus Blob 转为 WAV Blob（通过 Web Worker）
     * Both AudioContext and Worker are cleaned up via try/finally so a thrown
     * decodeAudioData / Worker error doesn't leak the underlying resources.
     * @param {Blob} audioBlob
     * @returns {Promise<Blob>}
     */
    async _convertToWav(audioBlob) {
        const arrayBuffer = await audioBlob.arrayBuffer();
        const audioContext = new AudioContext();
        let audioBuffer;
        try {
            audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        } finally {
            try { await audioContext.close(); } catch { /* already closed */ }
        }

        const scriptUrl = import.meta.url;
        const baseDir = scriptUrl.substring(0, scriptUrl.lastIndexOf('/'));
        const worker = new Worker(`${baseDir}/waveWorker.js`);

        try {
            return await new Promise((resolve, reject) => {
                worker.onmessage = (e) => {
                    const blob = new Blob([e.data.buffer], { type: 'audio/wav' });
                    resolve(blob);
                };

                worker.onerror = (e) => {
                    console.error(`${LOG_PREFIX} waveWorker error:`, e);
                    reject(new Error('WAV conversion failed'));
                };

                // 提取所有通道的 PCM 数据
                const pcmArrays = [];
                for (let i = 0; i < audioBuffer.numberOfChannels; i++) {
                    pcmArrays.push(audioBuffer.getChannelData(i));
                }

                worker.postMessage({
                    pcmArrays,
                    config: { sampleRate: audioBuffer.sampleRate },
                });
            });
        } finally {
            // Detach handlers before terminate so a late onmessage/onerror can't
            // invoke a stale resolve/reject (terminate alone doesn't clear them).
            worker.onmessage = null;
            worker.onerror = null;
            worker.terminate();
        }
    }

    /** 设置 VAD */
    _setupVAD(stream) {
        try {
            // Hold onto the AudioContext so _destroyVAD can close it later — without
            // this the context (and its underlying audio thread) leaks across
            // VAD on/off toggles and reproducible startListening cycles.
            this._vadAudioContext = new AudioContext();
            const source = this._vadAudioContext.createMediaStreamSource(stream);
            this._vad = new VoiceActivityDetector({
                source,
                voice_start: () => {
                    if (!this.isListening) {
                        console.debug(`${LOG_PREFIX} VAD: voice start → auto-record`);
                        this.startListening();
                    }
                },
                voice_stop: () => {
                    if (this.isListening) {
                        console.debug(`${LOG_PREFIX} VAD: voice stop → auto-stop`);
                        this.stopListening();
                    }
                },
            });
        } catch (err) {
            console.warn(`${LOG_PREFIX} VAD setup failed:`, err);
            // If construction fails after AudioContext was created, close it.
            if (this._vadAudioContext) {
                try { this._vadAudioContext.close(); } catch { /* ignore */ }
                this._vadAudioContext = null;
            }
        }
    }

    _destroyVAD() {
        if (this._vad) {
            this._vad.destroy();
            this._vad = null;
        }
        if (this._vadAudioContext) {
            // close() is async but we don't need to await — VAD is destroyed
            // synchronously, and the context just needs to stop holding its
            // audio thread once this microtask completes.
            const ctx = this._vadAudioContext;
            this._vadAudioContext = null;
            ctx.close().catch(() => { /* already closed */ });
        }
    }

    _releaseMediaStream() {
        if (this._mediaStream) {
            this._mediaStream.getTracks().forEach(t => t.stop());
            this._mediaStream = null;
        }
        this._mediaRecorder = null;
    }

    _loadSettings() {
        try {
            const saved = getPhoneSetting('sttSettings');
            if (saved) {
                return {
                    provider: saved.provider || 'none',
                    language: saved.language || 'zh-CN',
                    vadEnabled: !!saved.vadEnabled,
                    providerSettings: saved.providerSettings || {},
                };
            }
        } catch { /* 静默 */ }

        // 默认设置
        return {
            provider: 'none',
            language: 'zh-CN',
            vadEnabled: false,
            providerSettings: {},
        };
    }

    _saveSettings() {
        try {
            setPhoneSetting('sttSettings', this._settings);
        } catch (e) {
            console.warn(`${LOG_PREFIX} save settings failed:`, e);
        }
    }
}
