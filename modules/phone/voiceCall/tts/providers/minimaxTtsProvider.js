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

    /**
     * 获取 MiniMax 可用声音列表（硬编码系统声音）
     * Ported from Whispers tts.js fetchMiniMaxVoices
     * @returns {Promise<Array<{ id: string, name: string, language: string }>>}
     */
    async fetchVoices(_settings) {
        return [
            { id: 'male-qn-qingse', name: '青涩青年 (Male)', language: 'zh' },
            { id: 'male-qn-jingying', name: '精英青年 (Male)', language: 'zh' },
            { id: 'male-qn-badao', name: '霸道青年 (Male)', language: 'zh' },
            { id: 'male-qn-daxuesheng', name: '大学生 (Male)', language: 'zh' },
            { id: 'female-shaonv', name: '少女 (Female)', language: 'zh' },
            { id: 'female-yujie', name: '御姐 (Female)', language: 'zh' },
            { id: 'female-chengshu', name: '成熟女性 (Female)', language: 'zh' },
            { id: 'female-tianmei', name: '甜美女 (Female)', language: 'zh' },
            { id: 'presenter_male', name: '男主持人 (Male)', language: 'zh' },
            { id: 'presenter_female', name: '女主持人 (Female)', language: 'zh' },
            { id: 'audiobook_male_1', name: '有声书男1 (Male)', language: 'zh' },
            { id: 'audiobook_female_1', name: '有声书女1 (Female)', language: 'zh' },
        ];
    }
}
