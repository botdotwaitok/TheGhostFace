// modules/phone/voiceCall/tts/providers/gsviTtsProvider.js
// GPT-SoVITS TTS Provider — supports TWO API formats:
//   1. GPT-SoVITS Adapter (port 9881): POST / with { text, target_voice, text_lang, ... }
//      https://github.com/guoql666/GPT-SoVITS_sillytavern_adapter
//   2. GSVI Inference Plugin (port 8000): POST /v1/audio/speech with { model, input, voice, ... }
//      https://github.com/X-T-E-R/GPT-SoVITS-Inference
// Auto-detects which format to use based on endpoint port, or settings.apiFormat override.

import { resolveProxyUrl } from '../../../utils/corsProxyFetch.js';

const LOG_PREFIX = '[GsviTtsProvider]';

export class GsviTtsProvider {
    /** @type {Map<string, string[]>} character → available emotions cache */
    _emotionsCache = new Map();

    /**
     * 合成语音
     * @param {string} text
     * @param {Object} settings - { endpoint, voiceId, model, speed, emotion, textLang, promptLang, apiFormat }
     * @returns {Promise<ArrayBuffer>}
     */
    async synthesize(text, settings) {
        const endpoint = (settings.endpoint || 'http://localhost:9881').replace(/\/$/, '');
        const format = this._detectFormat(endpoint, settings.apiFormat);

        console.debug(`${LOG_PREFIX} Using ${format} format → ${endpoint}`);

        if (format === 'adapter') {
            return this._synthesizeAdapter(text, endpoint, settings);
        } else {
            return this._synthesizeGSVI(text, endpoint, settings);
        }
    }

    /**
     * 当 HTTPS 页面访问 HTTP 端点时（Mixed Content），走 ST 内置 CORS proxy。
     * @param {string} url - 原始 HTTP URL
     * @returns {string} 可能被改写为 /proxy/ 路径的 URL
     */
    _resolveUrl(url) {
        return resolveProxyUrl(url);
    }

    /**
     * Auto-detect API format based on endpoint port or explicit setting.
     * Port 9881 → adapter; port 8000 → gsvi; else fall back to adapter.
     */
    _detectFormat(endpoint, override) {
        if (override === 'adapter' || override === 'gsvi') return override;
        try {
            const url = new URL(endpoint);
            if (url.port === '8000') return 'gsvi';
        } catch { /* ignore */ }
        return 'adapter'; // Default: adapter format (more common)
    }

    // ─── Language Mapping: Chinese full names ↔ short codes (v2Pro compat) ───
    // Old GPT-SoVITS versions accept Chinese names ('多语种混合'), v2Pro needs codes ('auto').
    // EntityWhisper uses short codes ('zh','en','ja'), so we normalize here for compatibility.
    static LANG_CHINESE_TO_CODE = {
        '中文': 'zh', '英语': 'en', '日语': 'ja', '粤语': 'yue',
        '韩语': 'ko', '中英混合': 'zh', '日英混合': 'ja',
        '粤英混合': 'yue', '韩英混合': 'ko',
        '多语种混合': 'auto', '多语种混合(粤语)': 'auto',
    };

    /**
     * Normalize text_lang for Adapter API: try short code first, fall back to original.
     * @param {string} lang - raw text_lang value (could be Chinese name or short code)
     * @returns {string}
     */
    _normalizeTextLang(lang) {
        if (!lang) return 'auto';
        // Already a short code — pass through
        if (/^[a-z]{2,4}$/i.test(lang)) return lang;
        return GsviTtsProvider.LANG_CHINESE_TO_CODE[lang] || lang;
    }

    // ─── Split Method Mapping: Chinese full names → short codes (v2Pro compat) ───
    static SPLIT_CHINESE_TO_CODE = {
        '不切': 'cut0', '凑四句一切': 'cut1', '按50字切': 'cut2',
        '按中文句号切': 'cut3', '按英文句号切': 'cut4', '按标点符号切': 'cut5',
    };

    /**
     * Normalize text_split_method for v2Pro.
     * @param {string} method
     * @returns {string}
     */
    _normalizeSplitMethod(method) {
        if (!method) return 'cut5';
        if (/^cut\d$/i.test(method)) return method;
        return GsviTtsProvider.SPLIT_CHINESE_TO_CODE[method] || method;
    }

    // ─── Format 1: GPT-SoVITS Adapter (POST /) ───
    async _synthesizeAdapter(text, endpoint, settings) {
        const voiceId = settings.voiceId || '';
        const rawEmotion = settings._emotion || settings.emotion || null;

        // Validate emotion against backend's available list (EntityWhisper pattern)
        const emotion = await this.resolveEmotion(rawEmotion, voiceId, endpoint);

        // Append /emotion to target_voice (EntityWhisper pattern: "character/emotion")
        const targetVoice = (emotion && emotion !== 'default')
            ? `${voiceId}/${emotion}`
            : voiceId;

        const requestBody = {
            text,
            target_voice: targetVoice,
            use_st_adapter: true,
            text_lang: this._normalizeTextLang(settings.textLang),
            // NOTE: Do NOT send prompt_lang — the ST compat layer auto-fills it
            // from text_lang. Sending 'auto' causes check_params() to reject it
            // since 'auto' is not a valid GPT-SoVITS language code.
            text_split_method: this._normalizeSplitMethod(settings.textSplitMethod),
            batch_size: settings.batchSize !== undefined ? parseInt(settings.batchSize, 10) : 1,
            media_type: 'wav',
            streaming_mode: false,
        };

        console.debug(`${LOG_PREFIX} POST ${endpoint}/`);
        console.log(`${LOG_PREFIX} Adapter Request Body:`, requestBody);

        const response = await fetch(this._resolveUrl(`${endpoint}/`), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
            const errText = await response.text();
            const err = new Error(`GPT-SoVITS Adapter HTTP ${response.status}: ${errText}`);
            err.status = response.status;
            throw err;
        }

        return response.arrayBuffer();
    }

    // ─── Format 2: GSVI Inference Plugin (POST /v1/audio/speech) ───
    async _synthesizeGSVI(text, endpoint, settings) {
        const voiceId = settings.voiceId || '';
        const model = settings.model || 'GSVI-v4';
        const speed = settings.speed || 1;
        // GSVI: emotions already fetched from /models/{version} in fetchVoices,
        // no need to call /character_emotions (that's an Adapter-only endpoint).
        const emotion = settings._emotion || settings.emotion || '默认';

        const requestBody = {
            model,
            input: text,
            voice: voiceId,
            response_format: 'wav',
            speed,
            other_params: {
                app_key: '',
                text_lang: settings.textLang || 'auto',
                prompt_lang: settings.promptLang || '',
                emotion: emotion || '默认',
                top_k: 10,
                top_p: 1,
                temperature: 1,
                text_split_method: this._normalizeSplitMethod(settings.textSplitMethod),
                batch_size: settings.batchSize !== undefined ? parseInt(settings.batchSize, 10) : 1,
                batch_threshold: 0.75,
                split_bucket: true,
                fragment_interval: 0.3,
                parallel_infer: true,
                repetition_penalty: 1.35,
                sample_steps: 16,
                if_sr: false,
                seed: -1,
            },
        };

        console.debug(`${LOG_PREFIX} POST ${endpoint}/v1/audio/speech`);
        console.log(`${LOG_PREFIX} GSVI Request Body:`, requestBody);

        const response = await fetch(this._resolveUrl(`${endpoint}/v1/audio/speech`), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
            const errText = await response.text();
            const err = new Error(`GPT-SoVITS GSVI HTTP ${response.status}: ${errText}`);
            err.status = response.status;
            throw err;
        }

        return response.arrayBuffer();
    }

    // ═══════════════════════════════════════════════════════════════
    // Emotion Validation — aligned with EntityWhisper
    // ═══════════════════════════════════════════════════════════════

    /**
     * Fetch available emotions for a character from the backend.
     * GET /character_emotions?character=xxx → [string]
     * Results are cached per character to avoid repeated network calls.
     * @param {string} character - Voice ID / character name
     * @param {string} endpoint - Backend endpoint URL
     * @returns {Promise<string[]>}
     */
    async fetchEmotions(character, endpoint) {
        if (!character) return [];

        // Return cached if available
        const cacheKey = `${endpoint}|${character}`;
        if (this._emotionsCache.has(cacheKey)) {
            return this._emotionsCache.get(cacheKey);
        }

        try {
            const url = this._resolveUrl(
                `${endpoint}/character_emotions?character=${encodeURIComponent(character)}`
            );
            const response = await fetch(url);
            if (!response.ok) {
                console.warn(`${LOG_PREFIX} fetchEmotions HTTP ${response.status}`);
                return [];
            }
            const emotions = await response.json();
            this._emotionsCache.set(cacheKey, emotions);
            console.info(`${LOG_PREFIX} Available emotions for "${character}": [${emotions.join(', ')}]`);
            return emotions;
        } catch (err) {
            console.warn(`${LOG_PREFIX} fetchEmotions failed:`, err.message);
            return [];
        }
    }

    /**
     * Validate a raw emotion against the backend's available list.
     * If the emotion is not supported, falls back to 'default'.
     * @param {string|null} rawEmotion - Emotion from <say tone> parsing
     * @param {string} voiceId - Character / voice ID
     * @param {string} endpoint - Backend endpoint URL
     * @returns {Promise<string|null>} Validated emotion or null
     */
    async resolveEmotion(rawEmotion, voiceId, endpoint) {
        if (!rawEmotion || rawEmotion === 'default') return rawEmotion;

        const available = await this.fetchEmotions(voiceId, endpoint);

        // If we couldn't fetch the list, pass through (let backend decide)
        if (available.length === 0) return rawEmotion;

        if (available.includes(rawEmotion)) {
            return rawEmotion;
        }

        // Fallback
        console.warn(`${LOG_PREFIX} Emotion "${rawEmotion}" not in available list [${available.join(', ')}], falling back to "default"`);
        return 'default';
    }

    /**
     * 获取 GPT-SoVITS 可用模型/声音列表
     * 自动检测 API 格式：Adapter (9881) 走 /speakers_list，GSVI (8000) 走 /models/{version}
     * @param {Object} settings - { endpoint, apiFormat }
     * @returns {Promise<Array<{ id: string, name: string, language: string }>>}
     */
    async fetchVoices(settings) {
        const endpoint = (settings.endpoint || 'http://localhost:9881').replace(/\/$/, '');
        const format = this._detectFormat(endpoint, settings.apiFormat);

        console.debug(`${LOG_PREFIX} fetchVoices: format=${format}, endpoint=${endpoint}`);

        if (format === 'adapter') {
            return this._fetchVoicesAdapter(endpoint);
        } else {
            return this._fetchVoicesGSVI(endpoint);
        }
    }

    // ─── Adapter format: GET /speakers_list or /character_list ───
    async _fetchVoicesAdapter(endpoint) {
        // Try /speakers first (returns named models with voice_id), then /speakers_list as fallback
        const tryEndpoints = ['/speakers', '/speakers_list', '/character_list'];
        for (const path of tryEndpoints) {
            try {
                const response = await fetch(this._resolveUrl(`${endpoint}${path}`));
                if (!response.ok) continue;

                const data = await response.json();

                // Response can be: string[] like ["Alice", "Bob"]
                // or object[] like [{ name: "Alice", ... }]
                // or { speakers: [...] } / { characters: [...] }
                let speakerList = [];
                if (Array.isArray(data)) {
                    speakerList = data;
                } else if (data.speakers && Array.isArray(data.speakers)) {
                    speakerList = data.speakers;
                } else if (data.characters && Array.isArray(data.characters)) {
                    speakerList = data.characters;
                } else if (typeof data === 'object') {
                    // Try keys as speaker names
                    speakerList = Object.keys(data);
                }

                if (speakerList.length === 0) continue;

                // Build basic voice list
                const voices = speakerList.map(s => {
                    if (typeof s === 'string') {
                        return { id: s, name: s, language: 'auto' };
                    }
                    return { id: s.name || s.id || String(s), name: s.name || s.id || String(s), language: 'auto' };
                });

                // Enrich each voice with emotions from /character_emotions
                // (EntityWhisper pattern — the endpoint is provided by _ST_COMPAT_TEMPLATE)
                const enriched = await Promise.all(voices.map(async (voice) => {
                    try {
                        const emotionUrl = this._resolveUrl(
                            `${endpoint}/character_emotions?character=${encodeURIComponent(voice.id)}`
                        );
                        const emoResp = await fetch(emotionUrl);
                        if (emoResp.ok) {
                            const emotions = await emoResp.json();
                            if (Array.isArray(emotions) && emotions.length > 0) {
                                voice.promptLangs = ['auto'];
                                voice.emotionsMap = { 'auto': emotions };
                                voice.emotions = emotions;
                            }
                        }
                    } catch (e) {
                        console.debug(`${LOG_PREFIX} No emotions for "${voice.id}": ${e.message}`);
                    }
                    return voice;
                }));

                return enriched;
            } catch (err) {
                console.warn(`⚠️ [TTS] GPT-SoVITS ${path}: ${err.message}`);
            }
        }

        throw new Error('GPT-SoVITS Adapter: 无法获取角色列表 (尝试了 /speakers_list, /character_list, /speakers)');
    }

    // ─── GSVI Inference Plugin: GET /models/{version} ───
    async _fetchVoicesGSVI(endpoint) {
        const versions = ['v2', 'v3', 'v4', 'v2Pro'];
        const allVoices = [];

        for (const version of versions) {
            try {
                const response = await fetch(this._resolveUrl(`${endpoint}/models/${version}`));
                if (!response.ok) {
                    console.warn(`⚠️ [TTS] GPT-SoVITS /models/${version} returned ${response.status}, skipping`);
                    continue;
                }

                const data = await response.json();

                // API returns { msg, models: { modelName: { folder: [emotions] } } }
                const models = data.models || data;
                if (typeof models !== 'object' || Object.keys(models).length === 0) {
                    console.warn(`⚠️ [TTS] GPT-SoVITS /models/${version}: ${data.msg || 'empty'}`);
                    continue;
                }

                for (const [modelName, folders] of Object.entries(models)) {
                    const emotions = [];
                    const promptLangs = [];
                    const emotionsMap = {};
                    let promptLang = '';
                    if (folders && typeof folders === 'object') {
                        for (const [folderName, emotionList] of Object.entries(folders)) {
                            if (!promptLang) promptLang = folderName;
                            promptLangs.push(folderName);
                            emotionsMap[folderName] = Array.isArray(emotionList) ? emotionList.filter(e => e && e.length > 0) : [];
                            if (Array.isArray(emotionList)) {
                                emotions.push(...emotionList.filter(e => e && e.length > 0));
                            }
                        }
                    }
                    allVoices.push({
                        id: modelName,
                        name: `${modelName} [${version}]`,
                        language: promptLang || 'auto',
                        emotions,
                        promptLangs,
                        emotionsMap,
                        version,
                        prompt_lang: promptLang || '',
                    });
                }
            } catch (err) {
                console.warn(`⚠️ [TTS] Failed to fetch /models/${version}: ${err.message}`);
            }
        }

        if (allVoices.length === 0) {
            throw new Error('GPT-SoVITS GSVI: No models found from any version (v2/v3/v4/v2Pro)');
        }

        return allVoices;
    }
}

