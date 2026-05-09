// modules/phone/voiceCall/providers/openaiProvider.js
// OpenAI Whisper STT Provider — 通过 GhostFace Server 代理
// 用户在手机设置里直接填 API Key，不依赖 SillyTavern。

import { resolveProxyUrl, withTimeout, arrayBufferToBase64 } from '../../utils/corsProxyFetch.js';

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
     * @param {AbortSignal} [signal] - Session abort signal — cancels the transcribe fetch
     *   when the user moves on. A 30s timeout is applied on top so a hung backend
     *   can't leave the engine stuck in PROCESSING.
     * @returns {Promise<string>}
     */
    async processAudio(audioBlob, opts = {}, signal) {
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

        // Convert Blob → base64 via chunked encoder.
        // 旧实现的 reduce + 字符串累加是 O(N²)，30s 录音在 iOS 上能直接卡死或 OOM。
        const arrayBuffer = await audioBlob.arrayBuffer();
        const base64 = arrayBufferToBase64(arrayBuffer);

        console.debug(`${LOG_PREFIX} transcribing with model: ${model}, audio: ${(base64.length * 0.75 / 1024).toFixed(1)} KB`);

        const response = await fetch(resolveProxyUrl(`${proxyServer}/api/stt/transcribe`), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                provider: 'OpenAI',
                audio: base64,
                settings: { apiKey, model, language },
            }),
            signal: withTimeout(signal),
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            const msg = errorData.error || response.statusText;
            console.error(`${LOG_PREFIX} API error (${response.status}):`, msg);
            const err = new Error(`OpenAI STT 失败 (${response.status}): ${msg}`);
            err.status = response.status;
            throw err;
        }

        const result = await response.json();
        return result.text || '';
    }
}
