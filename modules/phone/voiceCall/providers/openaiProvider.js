// modules/phone/voiceCall/providers/openaiProvider.js
// OpenAI Whisper STT Provider — 通过 GhostFace Server 代理
// 用户在手机设置里直接填 API Key，不依赖 SillyTavern。

const LOG_PREFIX = '[STT:OpenAI]';

export class OpenAISttProvider {
    constructor() {
        this.name = 'OpenAI';
        this.description = 'OpenAI Whisper (付费)';

        this.defaultSettings = {
            model: 'whisper-1',
        };

        this.modelOptions = [
            { value: 'whisper-1', label: 'whisper-1' },
            { value: 'gpt-4o-mini-transcribe', label: 'gpt-4o-mini-transcribe' },
            { value: 'gpt-4o-transcribe', label: 'gpt-4o-transcribe' },
        ];
    }

    isAvailable() {
        return true;
    }

    /**
     * 处理音频 Blob → 通过 GhostFace 代理调用 OpenAI Whisper → 返回文本
     * @param {Blob} audioBlob - WAV 格式音频
     * @param {Object} [opts] - { apiKey, proxyServer, model, language }
     * @returns {Promise<string>}
     */
    async processAudio(audioBlob, opts = {}) {
        const apiKey = opts.apiKey;
        const proxyServer = opts.proxyServer;
        const model = opts.model || this.defaultSettings.model;
        const language = opts.language || '';

        if (!apiKey) {
            throw new Error('请在设置中填写 OpenAI API Key');
        }
        if (!proxyServer) {
            throw new Error('请在设置中填写代理服务器地址');
        }

        // Convert Blob → base64
        const arrayBuffer = await audioBlob.arrayBuffer();
        const base64 = btoa(
            new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
        );

        console.debug(`${LOG_PREFIX} transcribing with model: ${model}, audio: ${(base64.length * 0.75 / 1024).toFixed(1)} KB`);

        const response = await fetch(`${proxyServer}/api/stt/transcribe`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                provider: 'OpenAI',
                audio: base64,
                settings: { apiKey, model, language },
            }),
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            const msg = errorData.error || response.statusText;
            console.error(`${LOG_PREFIX} API error (${response.status}):`, msg);
            throw new Error(`OpenAI STT 失败 (${response.status}): ${msg}`);
        }

        const result = await response.json();
        return result.text || '';
    }
}
