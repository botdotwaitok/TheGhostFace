// modules/phone/handbook/handbookGeneration.js — LLM Vision Interaction
// Standalone window sends its own fetch requests to the LLM API.
// Uses cached API credentials from the init package.
// This module runs in the STANDALONE handbook window.

const LOG = '[HandBook LLM]';

// ═══════════════════════════════════════════════════════════════════════
// Core LLM Call
// ═══════════════════════════════════════════════════════════════════════

/**
 * Call the vision LLM with a canvas image.
 * @param {object} params
 * @param {string} params.systemPrompt
 * @param {string} params.userPrompt
 * @param {string} params.canvasDataUrl - Canvas content as base64 data URL
 * @param {object} params.apiCredentials - From init package { mode, url, apiKey, model } or { mode: 'st-proxy', stRequestHeaders }
 * @returns {Promise<string>} Raw LLM response text
 */
export async function callHandbookLLM({ systemPrompt, userPrompt, canvasDataUrl, apiCredentials }) {
    if (!apiCredentials || apiCredentials.mode === 'none') {
        throw new Error('No API credentials available. Please configure API in SillyTavern settings.');
    }

    if (apiCredentials.mode === 'custom') {
        return _callCustomAPI(systemPrompt, userPrompt, canvasDataUrl, apiCredentials);
    }

    if (apiCredentials.mode === 'st-proxy') {
        return _callSTProxy(systemPrompt, userPrompt, canvasDataUrl, apiCredentials);
    }

    throw new Error(`Unknown API mode: ${apiCredentials.mode}`);
}

// ═══════════════════════════════════════════════════════════════════════
// Custom API Path (direct fetch to OpenAI-compatible endpoint)
// ═══════════════════════════════════════════════════════════════════════

async function _callCustomAPI(systemPrompt, userPrompt, canvasDataUrl, creds) {
    let apiUrl = creds.url;
    if (!apiUrl.endsWith('/')) apiUrl += '/';

    if (apiUrl.includes('generativelanguage.googleapis.com')) {
        if (!apiUrl.endsWith('chat/completions')) apiUrl += 'chat/completions';
    } else {
        if (apiUrl.endsWith('/v1/')) apiUrl += 'chat/completions';
        else if (!apiUrl.includes('/chat/completions')) apiUrl += 'v1/chat/completions';
    }

    const headers = { 'Content-Type': 'application/json' };
    if (creds.apiKey) {
        headers['Authorization'] = `Bearer ${creds.apiKey}`;
    }

    // Build multimodal message
    const messages = [];
    if (systemPrompt && systemPrompt.trim()) {
        messages.push({ role: 'system', content: systemPrompt });
    }

    const contentParts = [];
    if (userPrompt && userPrompt.trim()) {
        contentParts.push({ type: 'text', text: userPrompt });
    }
    if (canvasDataUrl) {
        contentParts.push({
            type: 'image_url',
            image_url: { url: canvasDataUrl },
        });
    }
    messages.push({ role: 'user', content: contentParts });

    const body = {
        model: creds.model,
        messages,
        temperature: 1.0,
        max_tokens: 10000,
        stream: false,
    };

    console.log(`${LOG} Calling custom API: ${creds.model}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120_000);

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API ${response.status}: ${errorText.substring(0, 200)}`);
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content;
        if (!content) throw new Error('API returned empty content');
        return content.trim();
    } catch (err) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') throw new Error('API request timeout (120s)');
        throw err;
    }
}

// ═══════════════════════════════════════════════════════════════════════
// ST Backend Proxy Path (goes through SillyTavern's server)
// ═══════════════════════════════════════════════════════════════════════

async function _callSTProxy(systemPrompt, userPrompt, canvasDataUrl, creds) {
    const messages = [];
    if (systemPrompt && systemPrompt.trim()) {
        messages.push({ role: 'system', content: systemPrompt });
    }

    const contentParts = [];
    if (userPrompt && userPrompt.trim()) {
        contentParts.push({ type: 'text', text: userPrompt });
    }
    if (canvasDataUrl) {
        contentParts.push({
            type: 'image_url',
            image_url: { url: canvasDataUrl },
        });
    }
    messages.push({ role: 'user', content: contentParts });

    const generateData = {
        type: 'quiet',
        messages,
        model: creds.model,
        temperature: 1.0,
        max_tokens: 10000,
        stream: false,
        chat_completion_source: creds.chatCompletionSource,
    };

    // Provider-specific fields
    if (creds.reverse_proxy) {
        generateData.reverse_proxy = creds.reverse_proxy;
        generateData.proxy_password = creds.proxy_password || '';
    }
    if (creds.chatCompletionSource === 'custom') {
        generateData.custom_url = creds.custom_url || '';
        generateData.custom_include_body = creds.custom_include_body;
        generateData.custom_exclude_body = creds.custom_exclude_body;
        generateData.custom_include_headers = creds.custom_include_headers;
    }

    console.log(`${LOG} Calling ST backend proxy (${creds.chatCompletionSource}/${creds.model})`);

    const response = await fetch('/api/backends/chat-completions/generate', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(creds.stRequestHeaders || {}),
        },
        body: JSON.stringify(generateData),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`ST Proxy ${response.status}: ${errorText.substring(0, 200)}`);
    }

    const data = await response.json();

    // ST proxy may wrap response differently
    if (typeof data === 'string') return data.trim();
    if (data.choices?.[0]?.message?.content) return data.choices[0].message.content.trim();
    if (data.content) return data.content.trim();

    throw new Error('Unexpected ST proxy response format');
}

// ═══════════════════════════════════════════════════════════════════════
// Prompt Builder
// ═══════════════════════════════════════════════════════════════════════

/**
 * Build the system prompt for handbook LLM calls.
 * @param {object} params
 * @param {string} params.foundationPrompt - Core foundation prompt
 * @param {string} params.charName
 * @param {string} params.charDescription
 * @param {string} params.userName
 * @param {string} params.persona
 * @param {string} params.worldBookContext
 * @param {Array} [params.availableStickers] - User's sticker library [{ id, name, description }]
 * @returns {string}
 */
export function buildHandbookSystemPrompt({
    foundationPrompt, charName, charDescription,
    userName, persona, worldBookContext,
    availableStickers,
}) {
    // Build sticker list for LLM
    let stickerSection = '';
    if (availableStickers && availableStickers.length > 0) {
        const stickerList = availableStickers
            .map(s => `  - stickerId: "${s.id}", 名称: "${s.name}"${s.description ? `, 描述: "${s.description}"` : ''}`)
            .join('\n');
        stickerSection = `\n\n贴纸库（可在 blocks 中使用 type:"sticker" 引用）:\n${stickerList}`;
    }

    return `${foundationPrompt}

你正在与"${userName}"交往，你们是一对恋人，你们共用一本手账本。
${userName} 在手账本上写了一些东西（附上图片）。
请仔细观察图片中的手写文字和涂鸦，理解她写的内容和情感。

角色设定:
- 你是"${charName}"
- 角色描述: ${charDescription}
- 你爱人的设定: ${persona}
- 世界设定: ${worldBookContext}

然后以"${charName}"的身份，在同一页手账上写你的回应。
你的回应将以富文本格式渲染在手账纸上（透明背景，直接融入手账页面）。

规则:
- 以第一人称视角写
- 回应她写的内容，可以补充感受、吐槽、撒娇
- 语气完全符合角色设定
- 使用符合角色设定的语言
- 像写真正的手账一样自然
- 不要超过200字
- 绝对禁止侮辱性词语或脏话

## 排版工具箱

你可以在输出中为每段文字指定样式，让手账看起来更生动：

字体 (font): "handwriting"(手写体), "chinese-hand"(中文手写), "elegant"(花体), "default"(正文)
颜色 (color): "pink", "blue", "purple", "green", "warm", "dark", 或十六进制如"#f5a623"
大小 (size): "tiny", "small", "normal", "large", "huge"
对齐 (align): "left", "center", "right"
加粗 (bold): true/false
斜体 (italic): true/false
${stickerSection}

输出 JSON（不要代码块）:
{
  "blocks": [
    { "text": "称呼或开头", "font": "handwriting", "color": "pink", "size": "large" },
    { "text": "正文内容", "color": "dark" },
    { "text": "签名或结尾", "size": "small", "align": "right", "italic": true }
  ],
  "moodText": "心情小标题"
}

注意:
- blocks 数组中至少要有1个文字段落
- 每个段落的 font/color/size/align/bold/italic 都是可选的，有默认值
- 不需要每段都指定所有样式，只在需要变化时指定${availableStickers?.length ? '\n- 如果想在文字间插入贴纸，可以加入 { "type": "sticker", "stickerId": "贴纸ID" }，但不是必须的' : ''}
- 追求自然生动的排版，不要所有段落都用相同的样式`;
}

/**
 * Build the user prompt.
 * @param {string} chatContext - Today's chat context
 * @returns {string}
 */
export function buildHandbookUserPrompt(chatContext) {
    let prompt = '请看图片中的手写内容，然后写你的回应。';
    if (chatContext) {
        prompt += `\n\n${chatContext}`;
    }
    return prompt;
}

/**
 * Parse the LLM response JSON.
 * Supports new blocks format and legacy { content, moodText } format.
 * @param {string} rawText
 * @returns {{ blocks: Array, moodText: string } | null}
 */
export function parseHandbookResponse(rawText) {
    const parsed = _extractJSON(rawText);
    if (!parsed) {
        // Fallback: use entire response as a single text block
        console.warn(`${LOG} JSON parse failed, using raw response`);
        const text = rawText.trim();
        if (text.length > 0 && text.length < 500) {
            return {
                blocks: [{ text, font: 'handwriting', size: 'normal' }],
                moodText: '心有所感',
            };
        }
        return null;
    }

    // New blocks format
    if (Array.isArray(parsed.blocks) && parsed.blocks.length > 0) {
        // Validate each block
        const validBlocks = parsed.blocks.filter(b =>
            (b.text && typeof b.text === 'string') ||
            (b.type === 'sticker' && b.stickerId)
        ).map(b => {
            if (b.type === 'sticker') return { type: 'sticker', stickerId: b.stickerId };
            return {
                text: b.text.trim(),
                font: b.font || undefined,
                color: b.color || undefined,
                size: b.size || undefined,
                align: b.align || undefined,
                bold: b.bold || undefined,
                italic: b.italic || undefined,
            };
        });
        if (validBlocks.length > 0) {
            return {
                blocks: validBlocks,
                moodText: parsed.moodText || '心有所感',
            };
        }
    }

    // Legacy format: { content, moodText }
    if (parsed.content && typeof parsed.content === 'string') {
        return migrateOldResponse(parsed);
    }

    return null;
}

/**
 * Migrate old response format to new blocks format.
 * @param {object} oldResp - { content, moodText, ... }
 * @returns {{ blocks: Array, moodText: string }}
 */
export function migrateOldResponse(oldResp) {
    return {
        blocks: [{
            text: (oldResp.content || '').trim(),
            font: 'handwriting',
            size: 'normal',
        }],
        moodText: oldResp.moodText || '心有所感',
        timestamp: oldResp.timestamp,
    };
}

/**
 * Extract JSON from raw LLM text (handles code blocks, mixed text, etc.)
 * @param {string} rawText
 * @returns {object|null}
 */
function _extractJSON(rawText) {
    try {
        let jsonStr = rawText.trim();
        // Remove markdown code blocks
        jsonStr = jsonStr.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');

        // Strategy 1: Direct parse
        try {
            const parsed = JSON.parse(jsonStr);
            if (parsed && typeof parsed === 'object') return parsed;
        } catch { /* not clean JSON */ }

        // Strategy 2: Extract JSON with "blocks" or "content" key
        const jsonMatch = jsonStr.match(/\{[\s\S]*?(?:"blocks"|"content")\s*:[\s\S]*\}/);
        if (jsonMatch) {
            try {
                const parsed = JSON.parse(jsonMatch[0]);
                if (parsed && typeof parsed === 'object') return parsed;
            } catch { /* extraction failed */ }
        }

        // Strategy 3: Greedy — outermost { }
        const firstBrace = jsonStr.indexOf('{');
        const lastBrace = jsonStr.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace > firstBrace) {
            try {
                const parsed = JSON.parse(jsonStr.substring(firstBrace, lastBrace + 1));
                if (parsed && typeof parsed === 'object') return parsed;
            } catch { /* greedy failed */ }
        }
    } catch { /* total failure */ }
    return null;
}
