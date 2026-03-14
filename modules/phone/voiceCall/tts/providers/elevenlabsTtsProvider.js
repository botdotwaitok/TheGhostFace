// modules/phone/voiceCall/tts/providers/elevenlabsTtsProvider.js
// ElevenLabs TTS Provider — 直接从浏览器调用 ElevenLabs API
// ElevenLabs 的 API 支持 CORS，因此不需要经过服务器代理。
// （之前走 VPS 代理被 ElevenLabs 拒绝 — 数据中心 IP 被视为可疑）

const LOG_PREFIX = '[ElevenlabsTtsProvider]';

export class ElevenlabsTtsProvider {
    /**
     * 合成语音（直接调用 ElevenLabs API）
     * @param {string} text
     * @param {Object} settings - { apiKey, voiceId, model, speed }
     * @returns {Promise<ArrayBuffer>}
     */
    async synthesize(text, settings) {
        const apiKey = settings.apiKey || '';
        const voiceId = settings.voiceId || 'pNInz6obpgDQGcFmaJgB';
        const model = settings.model || 'eleven_multilingual_v2';
        const speed = settings.speed || 1.0;

        if (!apiKey) throw new Error('ElevenLabs API Key is required');

        const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`;

        console.log(`${LOG_PREFIX} Direct call → ${url}`);
        console.log(`${LOG_PREFIX} Key: ${apiKey.slice(0, 4)}...${apiKey.slice(-4)} (len=${apiKey.length}), model=${model}, voice=${voiceId}`);

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'xi-api-key': apiKey,
            },
            body: JSON.stringify({
                text,
                model_id: model,
                voice_settings: {
                    stability: 0.5,
                    similarity_boost: 0.75,
                    speed,
                },
            }),
        });

        if (!response.ok) {
            const errText = await response.text();
            const err = new Error(`ElevenLabs HTTP ${response.status}: ${errText}`);
            err.status = response.status;
            throw err;
        }

        return response.arrayBuffer();
    }

    /**
     * 获取 ElevenLabs 可用声音列表
     * Ported from Whispers tts.js fetchElevenLabsVoices
     * @param {Object} settings - { apiKey }
     * @returns {Promise<Array<{ id: string, name: string, language: string }>>}
     */
    async fetchVoices(settings) {
        const apiKey = settings.apiKey || '';
        if (!apiKey) throw new Error('ElevenLabs API Key is required to fetch voices');

        const response = await fetch('https://api.elevenlabs.io/v1/voices', {
            headers: { 'xi-api-key': apiKey },
        });

        if (!response.ok) {
            throw new Error(`ElevenLabs API error (${response.status})`);
        }

        const data = await response.json();
        return (data.voices || []).map(v => ({
            id: v.voice_id,
            name: `${v.name} (${v.labels?.accent || v.labels?.gender || ''})`,
            language: v.labels?.language || '',
        }));
    }
}
