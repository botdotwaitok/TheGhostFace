// modules/phone/voiceCall/sttEngine.js — STT 主控制器
// 管理 Provider 注册/切换、录音（MediaRecorder）、WAV 转换（Web Worker）、统一回调。

import { VoiceActivityDetector } from './vad.js';

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

        // ── 回调接口 ──
        /** @type {(text: string) => void} 最终识别结果 */
        this.onTranscript = () => {};
        /** @type {(text: string) => void} 中间结果（实时预览） */
        this.onInterim = () => {};
        /** @type {(state: SttState) => void} 状态变化 */
        this.onStateChange = () => {};
        /** @type {(error: Error) => void} 错误回调 */
        this.onError = () => {};

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
     * 其他 Provider 使用 MediaRecorder 录音 → WAV 转换 → processAudio。
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

            // 其他 API-based Provider → MediaRecorder 录音
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
        if (this._state !== SttState.LISTENING) return;

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

            try {
                const audioBlob = new Blob(this._audioChunks, { type: 'audio/webm;codecs=opus' });
                const wavBlob = await this._convertToWav(audioBlob);

                // 将 providerSettings（apiKey, proxyServer, model 等）+ language 传给 provider
                const providerOpts = {
                    ...this.getProviderSettings(this._activeProviderName),
                    language: this._settings.language,
                };
                const transcript = await this._activeProvider.processAudio(wavBlob, providerOpts);

                if (transcript && transcript.trim()) {
                    console.debug(`${LOG_PREFIX} transcript: "${transcript}"`);
                    this.onTranscript(transcript.trim());
                }
            } catch (err) {
                console.error(`${LOG_PREFIX} processAudio failed:`, err);
                this.onError(err);
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
     * @param {Blob} audioBlob
     * @returns {Promise<Blob>}
     */
    async _convertToWav(audioBlob) {
        const arrayBuffer = await audioBlob.arrayBuffer();
        const audioContext = new AudioContext();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        await audioContext.close();

        return new Promise((resolve, reject) => {
            // 动态获取 Worker 路径（基于当前模块位置）
            const scriptUrl = import.meta.url;
            const baseDir = scriptUrl.substring(0, scriptUrl.lastIndexOf('/'));
            const worker = new Worker(`${baseDir}/waveWorker.js`);

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
    }

    /** 设置 VAD */
    _setupVAD(stream) {
        try {
            const audioContext = new AudioContext();
            const source = audioContext.createMediaStreamSource(stream);
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
        }
    }

    _destroyVAD() {
        if (this._vad) {
            this._vad.destroy();
            this._vad = null;
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
            const raw = localStorage.getItem(SETTINGS_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                return {
                    provider: parsed.provider || 'none',
                    language: parsed.language || 'zh-CN',
                    vadEnabled: !!parsed.vadEnabled,
                    providerSettings: parsed.providerSettings || {},
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
            localStorage.setItem(SETTINGS_KEY, JSON.stringify(this._settings));
        } catch (e) {
            console.warn(`${LOG_PREFIX} save settings failed:`, e);
        }
    }
}
