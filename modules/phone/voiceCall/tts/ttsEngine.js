// modules/phone/voiceCall/tts/ttsEngine.js — TTS 引擎
// 管理 Provider 注册/切换、文字合成、Web Audio API 播放。
// 设计参照 sttEngine.js，保持模式一致。

const LOG_PREFIX = '[TtsEngine]';
const SETTINGS_KEY = 'gf_phone_tts_settings';

export class TtsEngine {
    constructor() {
        /** @type {Map<string, { ProviderClass: Function, instance: Object|null }>} */
        this._providers = new Map();

        /** @type {Object|null} */
        this._activeProvider = null;
        this._activeProviderName = 'none';

        /** @type {AudioContext|null} */
        this._audioContext = null;

        /** @type {AudioBufferSourceNode|null} 当前正在播放的 source */
        this._currentSource = null;

        /** @type {boolean} 是否正在播放 */
        this._isPlaying = false;

        this._settings = this._loadSettings();
    }

    // ═══════════════════════════════════════════════════════════════
    // Provider 管理
    // ═══════════════════════════════════════════════════════════════

    registerProvider(name, ProviderClass) {
        this._providers.set(name, { ProviderClass, instance: null });
    }

    async setProvider(name) {
        if (name === 'none' || !this._providers.has(name)) {
            this._activeProvider = null;
            this._activeProviderName = 'none';
            this._settings.provider = 'none';
            this._saveSettings();
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
        console.debug(`${LOG_PREFIX} provider → ${name}`);
    }

    get currentProviderName() { return this._activeProviderName; }
    get currentProvider() { return this._activeProvider; }
    get isPlaying() { return this._isPlaying; }

    getAvailableProviders() {
        return Array.from(this._providers.keys()).map(name => ({ name }));
    }

    /**
     * 获取指定 Provider 的声音/模型列表
     * @param {string} providerName - Provider 名称
     * @returns {Promise<Array<{ id: string, name: string, language?: string }>>}
     */
    async fetchVoices(providerName) {
        const name = providerName || this._activeProviderName;
        if (name === 'none' || !this._providers.has(name)) {
            throw new Error(`Unknown provider: ${name}`);
        }

        const entry = this._providers.get(name);
        if (!entry.instance) {
            entry.instance = new entry.ProviderClass();
        }

        if (typeof entry.instance.fetchVoices !== 'function') {
            throw new Error(`Provider "${name}" does not support fetchVoices`);
        }

        const providerSettings = this._settings.providerSettings[name] || {};
        return entry.instance.fetchVoices(providerSettings);
    }

    // ═══════════════════════════════════════════════════════════════
    // 合成 & 播放 (with retry)
    // ═══════════════════════════════════════════════════════════════

    /**
     * 合成文字并播放。使用三次指数退避重试来应对瞬时网络故障。
     * Returns a promise that resolves when audio playback actually starts.
     * @param {string} text
     * @returns {Promise<number>} Audio duration in seconds (0 if no TTS)
     */
    async speak(text) {
        if (!this._activeProvider || this._activeProviderName === 'none') {
            console.debug(`${LOG_PREFIX} No TTS provider configured, skipping.`);
            return 0;
        }

        if (!text || text.trim().length === 0) return 0;

        // Stop any ongoing playback before starting new
        this.stop();

        console.debug(`${LOG_PREFIX} Speaking: "${text.substring(0, 40)}..."`);

        try {
            const providerSettings = this._settings.providerSettings[this._activeProviderName] || {};
            console.log(`${LOG_PREFIX} [speak] provider=${this._activeProviderName}, settingsKeys=${Object.keys(providerSettings).join(',')}, hasApiKey=${!!providerSettings.apiKey}, keyLen=${(providerSettings.apiKey||'').length}`);

            // Retry synthesize with exponential backoff (500ms → 1000ms → 2000ms)
            const audioBuffer = await this._retryWithBackoff(
                () => this._activeProvider.synthesize(text, providerSettings),
            );

            return await this._playBuffer(audioBuffer);
        } catch (err) {
            console.error(`${LOG_PREFIX} speak() failed after retries:`, err);
            return 0;
        }
    }

    /**
     * Execute an async function with 3-attempt exponential backoff.
     * Silently retries — no UI disruption for TTS failures.
     * Does not retry 4xx client errors (bad API key, invalid params).
     * @param {Function} fn
     * @returns {Promise<*>}
     */
    async _retryWithBackoff(fn) {
        const maxAttempts = 3;
        const baseDelay = 500;
        let lastError;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                return await fn();
            } catch (err) {
                lastError = err;
                // Don't retry 4xx client errors
                if (err?.status >= 400 && err?.status < 500) throw err;
                if (attempt >= maxAttempts) throw err;

                const delay = baseDelay * Math.pow(2, attempt - 1);
                console.warn(`${LOG_PREFIX} TTS attempt ${attempt}/${maxAttempts} failed, retrying in ${delay}ms...`, err.message);
                await new Promise(r => setTimeout(r, delay));
            }
        }
        throw lastError;
    }

    /**
     * 立即停止当前播放。
     */
    stop() {
        if (this._currentSource) {
            try {
                this._currentSource.stop();
            } catch (_) { /* already stopped */ }
            this._currentSource = null;
        }
        this._isPlaying = false;
    }

    /**
     * 解码并通过 Web Audio API 播放 ArrayBuffer。
     * Resolves once playback starts (source.start() called).
     * @param {ArrayBuffer} arrayBuffer
     * @returns {Promise<number>} Duration of the audio in seconds
     */
    async _playBuffer(arrayBuffer) {
        if (!this._audioContext) {
            this._audioContext = new AudioContext();
        }

        // Resume if suspended (browser autoplay policy)
        if (this._audioContext.state === 'suspended') {
            await this._audioContext.resume();
        }

        const decodedBuffer = await this._audioContext.decodeAudioData(arrayBuffer.slice(0));

        const source = this._audioContext.createBufferSource();
        source.buffer = decodedBuffer;
        source.connect(this._audioContext.destination);

        this._currentSource = source;
        this._isPlaying = true;

        source.onended = () => {
            this._isPlaying = false;
            this._currentSource = null;
        };

        source.start(0);
        return decodedBuffer.duration;
    }

    // ═══════════════════════════════════════════════════════════════
    // 设置
    // ═══════════════════════════════════════════════════════════════

    getSettings() { return { ...this._settings }; }

    getProviderSettings(providerName) {
        return this._settings.providerSettings[providerName] || {};
    }

    updateProviderSettings(providerName, updates) {
        if (!this._settings.providerSettings[providerName]) {
            this._settings.providerSettings[providerName] = {};
        }
        Object.assign(this._settings.providerSettings[providerName], updates);
        this._saveSettings();
    }

    _loadSettings() {
        try {
            const raw = localStorage.getItem(SETTINGS_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                return {
                    provider: parsed.provider || 'none',
                    providerSettings: parsed.providerSettings || {},
                };
            }
        } catch { /* 静默 */ }
        return { provider: 'none', providerSettings: {} };
    }

    _saveSettings() {
        try {
            localStorage.setItem(SETTINGS_KEY, JSON.stringify(this._settings));
        } catch (e) {
            console.warn(`${LOG_PREFIX} save failed:`, e);
        }
    }
}
