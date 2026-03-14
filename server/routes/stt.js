// server/routes/stt.js — STT CORS 代理路由
// 作为透明代理转发 Groq / OpenAI Whisper 请求，解决浏览器 CORS 限制。
// Browser STT (Web Speech API) 本地直连，无需经过此路由。
//
// 此路由为公开接口（无需 Bearer Token），因为：
//   - 服务器不持有任何 STT API Key
//   - 用户的 API Key 随请求发来，服务器只是转发
//   - 已通过全局速率限制防止滥用

const express = require('express');
const router = express.Router();

const LOG_PREFIX = '[STT Proxy]';

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/stt/transcribe
// Body: { provider, audio (base64), settings: { apiKey, model, language } }
// Response: JSON { text: "..." }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/transcribe', async (req, res) => {
    const { provider, audio, settings = {} } = req.body;

    if (!provider || !audio) {
        return res.status(400).json({ error: 'Missing required fields: provider, audio' });
    }

    console.log(`${LOG_PREFIX} [${provider}] Transcribing ${(audio.length * 0.75 / 1024).toFixed(1)} KB audio...`);
    // Debug: show masked key
    const _k = settings.apiKey || '';
    console.log(`${LOG_PREFIX} [${provider}] API Key: ${_k ? `${_k.slice(0, 4)}...${_k.slice(-4)} (len=${_k.length})` : '(EMPTY!)'}`);

    try {
        let result;

        switch (provider) {
            case 'Groq':
                result = await _groq(audio, settings);
                break;
            case 'OpenAI':
                result = await _openai(audio, settings);
                break;
            default:
                return res.status(400).json({ error: `Unknown STT provider: ${provider}` });
        }

        console.log(`${LOG_PREFIX} [${provider}] OK — "${result.text?.slice(0, 60)}..."`);
        return res.json(result);

    } catch (err) {
        console.error(`${LOG_PREFIX} [${provider}] Failed:`, err.message);
        const upstreamStatus = err.upstreamStatus || 502;
        return res.status(upstreamStatus).json({ error: `STT transcription failed: ${err.message}` });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// Groq Whisper
// ─────────────────────────────────────────────────────────────────────────────
async function _groq(audioBase64, settings) {
    const apiKey = settings.apiKey;
    const model = settings.model || 'whisper-large-v3-turbo';
    const language = settings.language || '';

    if (!apiKey) throw new Error('Groq API Key is required');

    // Decode base64 → Buffer → build multipart form
    const audioBuffer = Buffer.from(audioBase64, 'base64');
    const blob = new Blob([audioBuffer], { type: 'audio/wav' });

    const formData = new FormData();
    formData.append('file', blob, 'audio.wav');
    formData.append('model', model);
    formData.append('response_format', 'json');
    if (language) formData.append('language', language);

    const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
        },
        body: formData,
    });

    if (!response.ok) {
        const errText = await response.text();
        const err = new Error(`Groq HTTP ${response.status}: ${errText}`);
        err.upstreamStatus = response.status;
        throw err;
    }

    return await response.json(); // { text: "..." }
}

// ─────────────────────────────────────────────────────────────────────────────
// OpenAI Whisper
// ─────────────────────────────────────────────────────────────────────────────
async function _openai(audioBase64, settings) {
    const apiKey = settings.apiKey;
    const model = settings.model || 'whisper-1';
    const language = settings.language || '';

    if (!apiKey) throw new Error('OpenAI API Key is required');

    const audioBuffer = Buffer.from(audioBase64, 'base64');
    const blob = new Blob([audioBuffer], { type: 'audio/wav' });

    const formData = new FormData();
    formData.append('file', blob, 'audio.wav');
    formData.append('model', model);
    formData.append('response_format', 'json');
    if (language) formData.append('language', language);

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
        },
        body: formData,
    });

    if (!response.ok) {
        const errText = await response.text();
        const err = new Error(`OpenAI HTTP ${response.status}: ${errText}`);
        err.upstreamStatus = response.status;
        throw err;
    }

    return await response.json(); // { text: "..." }
}

module.exports = router;
