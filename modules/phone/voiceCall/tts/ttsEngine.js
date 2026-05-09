// modules/phone/voiceCall/tts/ttsEngine.js — TTS 引擎
// 管理 Provider 注册/切换、文字合成、Web Audio API 播放。
// 设计参照 sttEngine.js，保持模式一致。

const LOG_PREFIX = '[TtsEngine]';
import { getPhoneSetting, setPhoneSetting } from '../../phoneSettings.js';

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

    /**
     * Pre-create and resume AudioContext. MUST be called from a user gesture
     * (click/tap) handler to unlock audio playback on mobile browsers.
     * iOS Safari and Chrome for Android keep AudioContext in "suspended" state
     * until resume() is called within a user gesture call stack.
     * Without this, any later async TTS playback (e.g. from STT→LLM→TTS chain)
     * will silently fail because resume() has no effect outside gesture context.
     */
    async warmUp() {
        if (!this._audioContext) {
            this._audioContext = new AudioContext();
            console.debug(`${LOG_PREFIX} AudioContext created (state: ${this._audioContext.state})`);
        }
        if (this._audioContext.state === 'suspended') {
            await this._audioContext.resume();
            console.debug(`${LOG_PREFIX} AudioContext resumed → ${this._audioContext.state}`);
        }
    }

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
     * Synthesize text and play the result through AudioContext.
     * @param {string} text
     * @param {string} [emotion] - Optional emotion/tone for TTS (e.g. 'gentle', 'happy')
     * @param {{ signal?: AbortSignal }} [options] - Pass session signal to abort
     *   the underlying fetch when the call ends mid-synthesis.
     * @returns {Promise<number>} Duration in seconds (0 if skipped)
     */
    async speak(text, emotion, options = {}) {
        if (!this._activeProvider || this._activeProviderName === 'none') {
            console.debug(`${LOG_PREFIX} No TTS provider configured, skipping.`);
            return 0;
        }

        if (!text || text.trim().length === 0) return 0;

        const signal = options.signal;
        if (signal?.aborted) return 0;

        // Note: no implicit stop() here — _playBuffer now resolves on real `onended`,
        // so serial callers naturally chain. Callers that need to interrupt an
        // in-flight utterance (e.g. user starts talking) must call stop() explicitly.

        console.debug(`${LOG_PREFIX} Speaking: "${text.substring(0, 40)}..." emotion=${emotion || 'none'}`);

        try {
            const providerSettings = this._buildProviderSettings(emotion);
            console.log(`${LOG_PREFIX} [speak] provider=${this._activeProviderName}, emotion=${providerSettings._emotion || 'none'}`);

            // Retry synthesize with exponential backoff (500ms → 1000ms → 2000ms).
            // Providers now return { buffer, mime } — we only need buffer for playback.
            const result = await this._retryWithBackoff(
                () => this._activeProvider.synthesize(text, providerSettings, signal),
                signal,
            );
            const buffer = result?.buffer ?? result;

            return await this._playBuffer(buffer, signal);
        } catch (err) {
            if (err?.name === 'AbortError') {
                console.debug(`${LOG_PREFIX} speak() aborted.`);
                return 0;
            }
            console.error(`${LOG_PREFIX} speak() failed after retries:`, err);
            return 0;
        }
    }

    /**
     * Build providerSettings object with emotion injected. Shared by speak / speakAndCapture.
     * @param {string} [emotion]
     * @returns {Object}
     */
    _buildProviderSettings(emotion) {
        const providerSettings = { ...(this._settings.providerSettings[this._activeProviderName] || {}) };
        if (emotion && emotion !== 'default') {
            if (this._activeProviderName === 'GPT-SoVITS') {
                const promptLang = providerSettings.promptLang || '';
                const emotionsMap = providerSettings.emotionsMap || {};
                const validEmotions = emotionsMap[promptLang] || [];
                if (validEmotions.length > 0 && !validEmotions.includes(emotion)) {
                    console.debug(`${LOG_PREFIX} Emotion "${emotion}" not found for ${promptLang}, using default: ${providerSettings.emotion}`);
                    providerSettings._emotion = providerSettings.emotion || '默认';
                } else {
                    providerSettings._emotion = emotion;
                }
            } else {
                providerSettings._emotion = emotion;
            }
        }
        return providerSettings;
    }

    /**
     * Execute an async function with 3-attempt exponential backoff.
     * Silently retries — no UI disruption for TTS failures.
     * Does not retry 4xx client errors (bad API key, invalid params).
     * Bails immediately on AbortError so session-cancellation doesn't keep retrying.
     * @param {Function} fn
     * @param {AbortSignal} [signal] - Optional session signal; aborts the inter-retry sleep.
     * @returns {Promise<*>}
     */
    async _retryWithBackoff(fn, signal) {
        const maxAttempts = 3;
        const baseDelay = 500;
        let lastError;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
            try {
                return await fn();
            } catch (err) {
                lastError = err;
                // Hard exit for abort — don't retry a cancelled fetch.
                if (err?.name === 'AbortError') throw err;
                // Don't retry 4xx client errors
                if (err?.status >= 400 && err?.status < 500) throw err;
                if (attempt >= maxAttempts) throw err;

                const delay = baseDelay * Math.pow(2, attempt - 1);
                console.warn(`${LOG_PREFIX} TTS attempt ${attempt}/${maxAttempts} failed, retrying in ${delay}ms...`, err.message);
                // Abortable sleep
                await new Promise((resolve, reject) => {
                    const t = setTimeout(resolve, delay);
                    signal?.addEventListener('abort', () => {
                        clearTimeout(t);
                        reject(new DOMException('aborted', 'AbortError'));
                    }, { once: true });
                });
            }
        }
        throw lastError;
    }

    /**
     * 合成文字，播放，并返回音频 Blob + 时长 — 供调用方持久化保存。
     * @param {string} text
     * @param {string} [emotion] - Optional emotion/tone for TTS (e.g. 'gentle', 'happy')
     * @param {{ signal?: AbortSignal }} [options] - Pass session signal to abort
     *   the underlying fetch when the call ends mid-synthesis.
     * @returns {Promise<{ duration: number, audioBlob: Blob } | null>}
     */
    async speakAndCapture(text, emotion, options = {}) {
        if (!this._activeProvider || this._activeProviderName === 'none') {
            console.debug(`${LOG_PREFIX} No TTS provider configured, skipping.`);
            return null;
        }
        if (!text || text.trim().length === 0) return null;

        const signal = options.signal;
        if (signal?.aborted) return null;

        // No implicit stop() — see speak() comment above.
        console.debug(`${LOG_PREFIX} speakAndCapture: "${text.substring(0, 40)}..." emotion=${emotion || 'none'}`);

        try {
            const providerSettings = this._buildProviderSettings(emotion);
            console.log(`${LOG_PREFIX} [speakAndCapture] provider=${this._activeProviderName}, emotion=${providerSettings._emotion || 'none'}`);

            const result = await this._retryWithBackoff(
                () => this._activeProvider.synthesize(text, providerSettings, signal),
                signal,
            );
            // Providers return { buffer, mime }; the iOS <audio> element relies
            // on the Blob mime to pick a decoder, so a hard-coded 'audio/mpeg'
            // for a WAV payload silently fails playback in Safari history view.
            const buffer = result?.buffer ?? result;
            const mime = result?.mime || 'audio/mpeg';

            // Create Blob from the raw ArrayBuffer (before decoding) using real mime
            const audioBlob = new Blob([buffer], { type: mime });

            // Play and get duration (waits for actual onended)
            const duration = await this._playBuffer(buffer, signal);

            return { duration, audioBlob };
        } catch (err) {
            if (err?.name === 'AbortError') {
                console.debug(`${LOG_PREFIX} speakAndCapture() aborted.`);
                return null;
            }
            console.error(`${LOG_PREFIX} speakAndCapture() failed:`, err);
            return null;
        }
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
     * Tear down the AudioContext entirely. Called once when the user leaves
     * the entire voice-call App (phoneController switches away), NOT between
     * calls — within a single voice-call session we want the warmed-up
     * AudioContext to persist so playback unlock survives across utterances.
     * Safe to call repeatedly; subsequent calls no-op until warmUp recreates it.
     */
    async destroy() {
        this.stop();
        if (this._audioContext) {
            const ctx = this._audioContext;
            this._audioContext = null;
            try { await ctx.close(); } catch { /* already closed */ }
            console.debug(`${LOG_PREFIX} destroyed (AudioContext closed)`);
        }
    }

    /**
     * 解码并通过 Web Audio API 播放 ArrayBuffer。
     * Resolves once playback finishes naturally (onended) or is aborted via signal.
     * Returning only on real playback end is what lets serial callers await the
     * next sentence without inter-sentence overlap or premature truncation.
     * @param {ArrayBuffer} arrayBuffer
     * @param {AbortSignal} [signal] - Session signal; abort stops playback and resolves with 0.
     * @returns {Promise<number>} Duration in seconds (0 if aborted before/while playing)
     */
    async _playBuffer(arrayBuffer, signal) {
        if (signal?.aborted) return 0;

        if (!this._audioContext) {
            this._audioContext = new AudioContext();
        }

        // Resume if suspended (browser autoplay policy)
        if (this._audioContext.state === 'suspended') {
            await this._audioContext.resume();
        }

        const decodedBuffer = await this._audioContext.decodeAudioData(arrayBuffer.slice(0));
        if (signal?.aborted) return 0;

        return new Promise((resolve) => {
            const source = this._audioContext.createBufferSource();
            source.buffer = decodedBuffer;
            source.connect(this._audioContext.destination);

            this._currentSource = source;
            this._isPlaying = true;

            let settled = false;
            const finish = (duration) => {
                if (settled) return;
                settled = true;
                this._isPlaying = false;
                if (this._currentSource === source) this._currentSource = null;
                if (signal) signal.removeEventListener('abort', onAbort);
                resolve(duration);
            };

            const onAbort = () => {
                try { source.stop(); } catch (_) { /* already stopped */ }
                finish(0);
            };

            source.onended = () => finish(decodedBuffer.duration);
            signal?.addEventListener('abort', onAbort, { once: true });
            source.start(0);
        });
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
            const saved = getPhoneSetting('ttsSettings');
            if (saved) {
                return {
                    provider: saved.provider || 'none',
                    providerSettings: saved.providerSettings || {},
                };
            }
        } catch { /* 静默 */ }
        return { provider: 'none', providerSettings: {} };
    }

    _saveSettings() {
        try {
            setPhoneSetting('ttsSettings', this._settings);
        } catch (e) {
            console.warn(`${LOG_PREFIX} save failed:`, e);
        }
    }
}
