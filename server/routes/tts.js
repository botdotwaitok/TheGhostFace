// server/routes/tts.js — TTS CORS 代理路由
// 作为透明代理转发 ElevenLabs / MiniMax TTS 请求，解决浏览器 CORS 限制。
// GPT-SoVITS 本地直连，无需经过此路由。
//
// 此路由为公开接口（无需 Bearer Token），因为：
//   - 服务器不持有任何 TTS API Key
//   - 用户的 API Key 随请求发来，服务器只是转发
//   - 已通过全局速率限制防止滥用

const express = require('express');
const router = express.Router();

const LOG_PREFIX = '[TTS Proxy]';

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/tts/generate
// Body: { provider, text, settings: { apiKey, voiceId, model, speed, ... } }
// Response: binary audio buffer (Content-Type: audio/mpeg or audio/wav)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/generate', async (req, res) => {
    const { provider, text, settings = {} } = req.body;

    if (!provider || !text || text.trim().length === 0) {
        return res.status(400).json({ error: 'Missing required fields: provider, text' });
    }

    console.log(`${LOG_PREFIX} [${provider}] Synthesizing ${text.length} chars...`);
    // Debug: show masked key to trace transmission issues
    const _k = settings.apiKey || '';
    console.log(`${LOG_PREFIX} [${provider}] API Key: ${_k ? `${_k.slice(0, 4)}...${_k.slice(-4)} (len=${_k.length})` : '(EMPTY!)'}`);


    try {
        let audioBuffer;
        let contentType;

        switch (provider) {
            case 'elevenlabs':
                ({ buffer: audioBuffer, contentType } = await _elevenlabs(text, settings));
                break;
            case 'minimax':
                ({ buffer: audioBuffer, contentType } = await _minimax(text, settings));
                break;
            default:
                return res.status(400).json({ error: `Unknown TTS provider: ${provider}` });
        }

        console.log(`${LOG_PREFIX} [${provider}] OK — ${(audioBuffer.length / 1024).toFixed(1)} KB`);

        res.set('Content-Type', contentType);
        res.set('Content-Length', audioBuffer.length);
        res.set('Cache-Control', 'no-cache');
        return res.send(audioBuffer);

    } catch (err) {
        console.error(`${LOG_PREFIX} [${provider}] Failed:`, err.message);
        // Forward upstream HTTP status (e.g. 401 invalid key) instead of always 502
        const upstreamStatus = err.upstreamStatus || 502;
        return res.status(upstreamStatus).json({ error: `TTS generation failed: ${err.message}` });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// ElevenLabs
// ─────────────────────────────────────────────────────────────────────────────
async function _elevenlabs(text, settings) {
    const apiKey = settings.apiKey;
    const voiceId = settings.voiceId || 'pNInz6obpgDQGcFmaJgB';
    const model = settings.model || 'eleven_multilingual_v2';
    const speed = settings.speed || 1.0;

    if (!apiKey) throw new Error('ElevenLabs API Key is required');

    const response = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
        {
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
        }
    );

    if (!response.ok) {
        const errText = await response.text();
        const err = new Error(`ElevenLabs HTTP ${response.status}: ${errText}`);
        err.upstreamStatus = response.status; // Forward 4xx/5xx to client
        throw err;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    return { buffer, contentType: 'audio/mpeg' };
}

// ─────────────────────────────────────────────────────────────────────────────
// MiniMax
// ─────────────────────────────────────────────────────────────────────────────
async function _minimax(text, settings) {
    const apiKey = settings.apiKey;
    const voiceId = settings.voiceId || 'female-shaonv';
    const model = settings.model || 'speech-02-hd';
    const speed = settings.speed || 1.0;

    if (!apiKey) throw new Error('MiniMax API Key is required');

    const response = await fetch('https://api.minimax.chat/v1/t2a_v2', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model,
            text,
            stream: false,
            voice_setting: {
                voice_id: voiceId,
                speed,
            },
            audio_setting: {
                format: 'mp3',
                sample_rate: 32000,
            },
        }),
    });

    if (!response.ok) {
        const errText = await response.text();
        const err = new Error(`MiniMax HTTP ${response.status}: ${errText}`);
        err.upstreamStatus = response.status;
        throw err;
    }

    const data = await response.json();

    if (data.base_resp && data.base_resp.status_code !== 0) {
        throw new Error(`MiniMax API error: ${data.base_resp.status_msg}`);
    }

    // MiniMax returns hex-encoded audio in data.data.audio
    if (data.data && data.data.audio) {
        const buffer = Buffer.from(data.data.audio, 'hex');
        return { buffer, contentType: 'audio/mpeg' };
    }

    // Fallback: audio_file URL
    if (data.audio_file) {
        const audioRes = await fetch(data.audio_file);
        const buffer = Buffer.from(await audioRes.arrayBuffer());
        return { buffer, contentType: 'audio/mpeg' };
    }

    throw new Error('MiniMax: No audio data in response');
}

module.exports = router;
