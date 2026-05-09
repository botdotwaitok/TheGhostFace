// modules/phone/voiceCall/providers/groqProvider.js
// Groq Whisper STT Provider — 通过 GhostFace Server 代理
// 用户在手机设置里直接填 API Key，不依赖 SillyTavern。

import { resolveProxyUrl, withTimeout, arrayBufferToBase64 } from '../../utils/corsProxyFetch.js';

const LOG_PREFIX = '[STT:Groq]';

export class GroqSttProvider {
    constructor() {
        this.name = 'Groq';
        this.description = 'Groq Whisper (免费快速)';

        this.defaultSettings = {
            model: 'whisper-large-v3-turbo',
        };

        this.modelOptions = [
            { value: 'whisper-large-v3', label: 'whisper-large-v3' },
            { value: 'whisper-large-v3-turbo', label: 'whisper-large-v3-turbo (推荐)' },
        ];
    }

    isAvailable() {
        return true;
    }

    /**
     * 处理音频 Blob → 通过 GhostFace 代理调用 Groq Whisper → 返回文本
     * @param {Blob} audioBlob - WAV 格式音频
     * @param {Object} [opts] - { apiKey, proxyServer, model, language }
     * @param {AbortSignal} [signal] - Session abort signal — cancels the transcribe fetch
     *   when the user moves on. A 30s timeout is applied on top.
     * @returns {Promise<string>}
     */
    async processAudio(audioBlob, opts = {}, signal) {
        const apiKey = opts.apiKey;
        const proxyServer = opts.proxyServer;
        const model = opts.model || this.defaultSettings.model;
        const rawLang = opts.language || '';
        const fullLangCodes = ['haw', 'yue'];
        const language = fullLangCodes.includes(rawLang) ? rawLang : rawLang.slice(0, 2);

        if (!apiKey) {
            throw new Error('请在设置中填写 Groq API Key');
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
                provider: 'Groq',
                audio: base64,
                settings: { apiKey, model, language },
            }),
            signal: withTimeout(signal),
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            const msg = errorData.error || response.statusText;
            console.error(`${LOG_PREFIX} API error (${response.status}):`, msg);
            const err = new Error(`Groq STT 失败 (${response.status}): ${msg}`);
            err.status = response.status;
            throw err;
        }

        const result = await response.json();
        return result.text || '';
    }
}
