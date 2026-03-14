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

    // ─── Format 1: GPT-SoVITS Adapter (POST /) ───
    async _synthesizeAdapter(text, endpoint, settings) {
        const voiceId = settings.voiceId || '';
        const textLang = settings.textLang || 'zh';

        const requestBody = {
            text,
            target_voice: voiceId,
            use_st_adapter: true,
            text_lang: textLang,
            text_split_method: 'cut5',
            batch_size: 1,
            media_type: 'wav',
            streaming_mode: 'false',
        };

        console.debug(`${LOG_PREFIX} POST ${endpoint}/`);

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
        const emotion = settings.emotion || '默认';
        const textLang = settings.textLang || '多语种混合';
        const promptLang = settings.promptLang || '中文';

        const requestBody = {
            model,
            input: text,
            voice: voiceId,
            response_format: 'wav',
            speed,
            other_params: {
                app_key: '',
                text_lang: textLang,
                prompt_lang: promptLang,
                emotion,
                top_k: 10,
                top_p: 1,
                temperature: 1,
                text_split_method: '按标点符号切',
                batch_size: 1,
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

                return speakerList.map(s => {
                    if (typeof s === 'string') {
                        return { id: s, name: s, language: 'auto' };
                    }
                    return { id: s.name || s.id || String(s), name: s.name || s.id || String(s), language: 'auto' };
                });
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
                    let promptLang = '';
                    if (folders && typeof folders === 'object') {
                        for (const [folderName, emotionList] of Object.entries(folders)) {
                            if (!promptLang) promptLang = folderName;
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

