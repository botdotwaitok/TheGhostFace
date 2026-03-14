// modules/phone/voiceCall/tts/providers/minimaxTtsProvider.js
// MiniMax TTS Provider — 通过云服务器代理解决 CORS 问题
// 云服务器：http://74.208.78.209:3421/api/tts/generate

import { resolveProxyUrl } from '../../../utils/corsProxyFetch.js';

const LOG_PREFIX = '[MinimaxTtsProvider]';

// 默认云服务器地址（用户可在设置中覆盖）
const DEFAULT_PROXY = 'http://74.208.78.209:3421';

export class MinimaxTtsProvider {
    /**
     * 合成语音（经由云服务器代理）
     * @param {string} text
     * @param {Object} settings - { apiKey, voiceId, model, speed, proxyServer }
     * @returns {Promise<ArrayBuffer>}
     */
    async synthesize(text, settings) {
        const proxyServer = (settings.proxyServer || DEFAULT_PROXY).replace(/\/$/, '');
        const apiKey = settings.apiKey || '';
        const voiceId = settings.voiceId || 'female-shaonv';
        const model = settings.model || 'speech-02-hd';
        const speed = settings.speed || 1.0;

        if (!apiKey) throw new Error('MiniMax API Key is required');

        console.debug(`${LOG_PREFIX} POST ${proxyServer}/api/tts/generate`);

        const response = await fetch(resolveProxyUrl(`${proxyServer}/api/tts/generate`), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                provider: 'minimax',
                text,
                settings: { apiKey, voiceId, model, speed },
            }),
        });

        if (!response.ok) {
            const errText = await response.text();
            const err = new Error(`MiniMax proxy HTTP ${response.status}: ${errText}`);
            err.status = response.status;
            throw err;
        }

        return response.arrayBuffer();
    }
}
