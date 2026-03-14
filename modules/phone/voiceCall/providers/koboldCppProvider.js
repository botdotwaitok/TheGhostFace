// modules/phone/voiceCall/providers/koboldCppProvider.js
// KoboldCpp Whisper STT Provider — P2 优先级
// 通过 SillyTavern 代理 API 调用 KoboldCpp 的 Whisper 功能。

import { getRequestHeaders } from '../../../../../../../../script.js';

const LOG_PREFIX = '[STT:KoboldCpp]';

export class KoboldCppSttProvider {
    constructor() {
        this.name = 'KoboldCpp';
        this.description = 'KoboldCpp Whisper (本地部署)';
        this.note = '需要 KoboldCpp 1.67+ 并在 ST 中配置连接';

        this.defaultSettings = {};
    }

    isAvailable() {
        return true;
    }

    /**
     * 处理音频 Blob → 调用 KoboldCpp Whisper → 返回文本
     * @param {Blob} audioBlob - WAV 格式音频
     * @param {Object} [opts] - { language }
     * @returns {Promise<string>}
     */
    async processAudio(audioBlob, opts = {}) {
        const language = opts.language || '';

        // 获取 KoboldCpp 服务器地址
        // 尝试从 ST 的 textgen 设置中获取
        let serverUrl = '';
        try {
            const { textgenerationwebui_settings, textgen_types } = await import('../../../../../../../textgen-settings.js');
            serverUrl = textgenerationwebui_settings?.server_urls?.[textgen_types?.KOBOLDCPP] || '';
        } catch (e) {
            console.warn(`${LOG_PREFIX} could not read KoboldCpp server URL from ST settings`);
        }

        if (!serverUrl) {
            throw new Error('KoboldCpp 服务器地址未配置，请在 ST 文本补全设置中配置');
        }

        const formData = new FormData();
        formData.append('avatar', audioBlob, 'record.wav');
        if (language) formData.append('language', language);
        formData.append('server', serverUrl);

        console.debug(`${LOG_PREFIX} transcribing via: ${serverUrl}`);

        const response = await fetch('/api/backends/kobold/transcribe-audio', {
            method: 'POST',
            headers: getRequestHeaders({ omitContentType: true }),
            body: formData,
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`${LOG_PREFIX} API error (${response.status}):`, errorText);
            throw new Error(`KoboldCpp STT 失败 (${response.status}): ${response.statusText}`);
        }

        const result = await response.json();
        return result.text || '';
    }
}
