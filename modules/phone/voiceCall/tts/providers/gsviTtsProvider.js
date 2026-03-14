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
}
