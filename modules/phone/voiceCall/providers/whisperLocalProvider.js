// modules/phone/voiceCall/providers/whisperLocalProvider.js
// SillyTavern 内置 Whisper STT Provider — P1 优先级
// 使用 ST 的 /api/speech/recognize 端点，无需额外服务。

import { getRequestHeaders } from '../../../../../../../../script.js';

const LOG_PREFIX = '[STT:WhisperLocal]';

export class WhisperLocalSttProvider {
    constructor() {
        this.name = 'Whisper (Local)';
        this.description = 'ST 内置 Whisper (本地)';
        this.note = '首次加载模型需要下载';

        this.defaultSettings = {
            model: 'Xenova/whisper-small',
        };

        this.modelOptions = [
            { group: '多语言', options: [
                { value: 'Xenova/whisper-tiny', label: 'whisper-tiny' },
                { value: 'Xenova/whisper-base', label: 'whisper-base' },
                { value: 'Xenova/whisper-small', label: 'whisper-small (推荐)' },
                { value: 'Xenova/whisper-medium', label: 'whisper-medium' },
                { value: 'Xenova/whisper-large-v3', label: 'whisper-large-v3' },
            ]},
            { group: '英语', options: [
                { value: 'Xenova/whisper-tiny.en', label: 'whisper-tiny.en' },
                { value: 'Xenova/whisper-base.en', label: 'whisper-base.en' },
                { value: 'Xenova/whisper-small.en', label: 'whisper-small.en' },
            ]},
        ];
    }

    isAvailable() {
        return true;
    }

    /**
     * 处理音频 Blob → base64 编码 → 调用 ST 内置 Whisper → 返回文本
     * @param {Blob} audioBlob - WAV 格式音频
     * @param {Object} [opts] - { model, language }
     * @returns {Promise<string>}
     */
    async processAudio(audioBlob, opts = {}) {
        const model = opts.model || this.defaultSettings.model;
        const language = opts.language || null;

        // 转为 base64
        const audio = await this._blobToBase64(audioBlob);

        console.debug(`${LOG_PREFIX} transcribing with model: ${model}`);

        const response = await fetch('/api/speech/recognize', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ audio, lang: language, model }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`${LOG_PREFIX} API error (${response.status}):`, errorText);
            throw new Error(`Whisper Local STT 失败 (${response.status}): ${response.statusText}`);
        }

        const result = await response.json();
        return result.text || '';
    }

    /**
     * Blob → base64 data URL
     * @param {Blob} blob
     * @returns {Promise<string>}
     */
    _blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }
}
