// timeline.js — 📅 故事时间线：生成、合并、压缩、世界书读写
import { getContext } from '../../../../extensions.js';
import { createWorldInfoEntry, loadWorldInfo, saveWorldInfo } from '../../../../world-info.js';

import * as utils from './utils.js';
import { logger } from './utils.js';
import * as api from './api.js';

// ═══════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════

export const TIMELINE_COMMENT = '📅 故事时间线';
const TIMELINE_ORDER = 998;
const TIMELINE_POSITION = 1; // After Char
const TIMELINE_KEYS = ['时间线', '故事', '大纲'];
const TIMELINE_MAX_TOKENS = 2000;

// Rough estimate: 1 CJK char ≈ 1.5 tokens, 1 English word ≈ 1.3 tokens
// For safety we use a conservative char-to-token ratio
const CHARS_PER_TOKEN = 1.5;

// ═══════════════════════════════════════════════════════════════════════
// World Book Read / Write
// ═══════════════════════════════════════════════════════════════════════

/**
 * 从世界书读取当前时间线条目内容
 * @returns {Promise<string|null>} 时间线文本，不存在则返回 null
 */
export async function readTimelineFromWorldbook() {
    try {
        const worldBookName = await utils.findActiveWorldBook();
        if (!worldBookName) {
            logger.warn('[时间线] 未找到绑定的世界书');
            return null;
        }

        const wb = await loadWorldInfo(worldBookName);
        if (!wb || !wb.entries) return null;

        for (const entry of Object.values(wb.entries)) {
            if (!entry) continue;
            const comment = String(entry.comment || '').trim();
            if (comment === TIMELINE_COMMENT && !entry.disable) {
                logger.info('[时间线] 📖 已读取现有时间线条目');
                // 剥离 <current_timeline> 标签后返回纯内容
                const raw = entry.content || '';
                return raw.replace(/^<current_timeline>\n?/, '').replace(/\n?<\/current_timeline>$/, '');
            }
        }

        logger.info('[时间线] 📖 世界书中不存在时间线条目');
        return null;
    } catch (error) {
        logger.error('[时间线] 读取时间线失败:', error);
        return null;
    }
}

/**
 * 写入/更新时间线条目到世界书
 * @param {string} content 时间线文本
 */
export async function writeTimelineToWorldbook(content) {
    let worldBookName = await utils.findActiveWorldBook();
    if (!worldBookName) {
        const sel = document.querySelector('#world_editor_select');
        if (sel?.value) worldBookName = sel.selectedOptions[0].textContent.trim();
    }
    if (!worldBookName) throw new Error('[时间线] 未找到绑定的世界书');

    const wbOriginal = await loadWorldInfo(worldBookName);
    if (!wbOriginal) throw new Error('[时间线] 世界书加载失败');

    // 深拷贝避免污染 ST 缓存
    const wb = structuredClone(wbOriginal);
    if (!wb.entries) wb.entries = {};

    // 查找已有的时间线条目
    let found = false;
    for (const entry of Object.values(wb.entries)) {
        if (!entry) continue;
        const comment = String(entry.comment || '').trim();
        if (comment === TIMELINE_COMMENT) {
            entry.content = `<current_timeline>\n${content}\n</current_timeline>`;
            entry.disable = false;
            found = true;
            logger.info('[时间线] ✏️ 已更新现有时间线条目');
            break;
        }
    }

    // 不存在则创建新条目
    if (!found) {
        const newEntry = createWorldInfoEntry(null, wb);
        Object.assign(newEntry, {
            comment: TIMELINE_COMMENT,
            content: `<current_timeline>\n${content}\n</current_timeline>`,
            key: TIMELINE_KEYS,
            constant: true,
            selective: false,
            disable: false,
            order: TIMELINE_ORDER,
            position: TIMELINE_POSITION,
            excludeRecursion: true,
            preventRecursion: true,
        });
        logger.info('[时间线] 🆕 已创建新时间线条目');
    }

    await saveWorldInfo(worldBookName, wb, true);
    logger.success('[时间线] 💾 时间线已保存到世界书');
}

// ═══════════════════════════════════════════════════════════════════════
// Prompt Builders
// ═══════════════════════════════════════════════════════════════════════

/**
 * 构建「从一段对话消息中提取时间线片段」的 LLM prompt
 * @param {string} messagesText 已格式化的对话文本
 * @returns {string}
 */
export function buildTimelinePrompt(messagesText) {
    return `
<NO_RP>
THIS IS NOT ROLE PLAY, DO NOT ROLE PLAY.
鬼面不会继续{{user}}和{{char}}的剧情和故事，鬼面只负责进行时间线大纲提取。
</NO_RP>
<The_Ghost_Face_Protocol>
[SYSTEM MODE: TIMELINE_EXTRACTION]

**IDENTITY:**
You are **The Ghost Face (鬼面)** — The Entity's chosen Scribe.
Your current task is to create a concise timeline outline from the conversation below.
</The_Ghost_Face_Protocol>

**任务：从以下对话中提取关键剧情事件，生成一段简短的时间线大纲。**

**规则：**
1. 只提取**重要的剧情转折、关键事件、情感节点**，忽略日常闲聊
2. 每个事件用一行表示，格式为：\`- [时间标签] 事件描述\`
3. **时间标签提取优先级（严格遵守）：**
   - **最高优先**：使用对话中出现的**具体日期和时间**（如"2024年6月15日 下午3点"→\`[2024.6.15 下午]\`）
   - **次高优先**：组合"天数+时段"（如\`[第1天-清晨]\`、\`[第2天-下午]\`、\`[第3天-晚上]\`）
   - **最低优先**：仅当完全无法推断天数时，才使用纯阶段描述（如\`[初识阶段]\`）
   - **禁止**：不要使用单独的\`[清晨]\`\`[晚上]\`\`[午饭时]\`等无日期的纯时段标签
4. 从对话上下文中推断日期关系：如果发现"第二天早上"、"次日"、"昨天"等表达，必须结合上文推算出是第几天
5. 保持简洁，每段对话提取 **3-8 个要点**
6. 保留关键情感信息和重要决定

**输出格式示例（只输出时间线，不要输出其他任何内容）：**

- [第1天-午夜] {{user}}首次出现在{{char}}梦中
- [第1天-清晨] {{char}}发现自己获得了新的能力
- [第1天-下午] {{char}}在学校完成了{{user}}的任务
- [第2天-上午] {{char}}决定改变自己的命运
...

**以下是需要分析的对话内容：**
${messagesText}

请只输出时间线要点，不要输出任何其他解释或前言。`;
}

/**
 * 构建「合并多个时间线片段」的 LLM prompt
 * @param {string[]} segments 多个时间线片段文本
 * @returns {string}
 */
export function buildMergePrompt(segments) {
    const numbered = segments.map((s, i) => `=== 片段 ${i + 1} ===\n${s}`).join('\n\n');
    return `
<NO_RP>
THIS IS NOT ROLE PLAY, DO NOT ROLE PLAY.
</NO_RP>

**任务：将以下多个时间线片段合并为一个连贯的时间线大纲。**

**规则：**
1. 按时间顺序排列所有事件
2. 合并重复或相似的事件
3. 保持简洁，每个事件一行
4. 格式：\`- [时间/阶段] 事件描述\`
5. 保留所有重要的剧情转折和情感节点
6. 合并后的时间线应该是一个**连贯的故事大纲**

**以下是需要合并的时间线片段：**

${numbered}

请只输出合并后的时间线，不要输出任何其他解释或前言。`;
}

/**
 * 构建「压缩时间线前半部分」的 LLM prompt
 * @param {string} oldPart 需要压缩的前半部分
 * @param {string} recentPart 保持不变的后半部分（仅供参考不压缩）
 * @returns {string}
 */
export function buildCompressionPrompt(oldPart, recentPart) {
    return `
<NO_RP>
THIS IS NOT ROLE PLAY, DO NOT ROLE PLAY.
</NO_RP>

**任务：压缩以下时间线的"早期事件"部分为 2-3 个简短的章节概括。**

**规则：**
1. 将下面的"早期事件"压缩为 **2-3 行**，每行是一个章节概括
2. 格式：\`- [章节名] 一句话概括该阶段发生的核心事件\`
3. 保留最关键的剧情转折
4. 下面的"近期事件"仅供参考，**不需要修改**

**需要压缩的早期事件：**
${oldPart}

**近期事件（仅参考，请勿修改或输出）：**
${recentPart}

请只输出压缩后的 2-3 行章节概括，不要输出其他内容。`;
}

// ═══════════════════════════════════════════════════════════════════════
// LLM Interaction Helpers
// ═══════════════════════════════════════════════════════════════════════

/**
 * 调用 LLM（自动选择自定义 API 或 ST 内置）
 * @param {string} prompt 完整 prompt
 * @param {number} [maxTokens=2048] 最大生成 token 数
 * @returns {Promise<string>} LLM 返回的文本
 */
async function callLLM(prompt, maxTokens = 2048) {
    const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('[时间线] LLM 调用超时 (90秒)')), 90000)
    );

    if (api.useCustomApi && api.customApiConfig?.url) {
        return Promise.race([
            api.callCustomOpenAI('', prompt, { maxTokens }),
            timeout,
        ]);
    }

    // ST 内置 provider
    const context = await getContext();
    if (!context || typeof context.generateQuietPrompt !== 'function') {
        throw new Error('[时间线] ST context.generateQuietPrompt 不可用');
    }
    return Promise.race([
        context.generateQuietPrompt(prompt, true, false, ''),
        timeout,
    ]);
}

// ═══════════════════════════════════════════════════════════════════════
// Core Timeline Functions
// ═══════════════════════════════════════════════════════════════════════

/**
 * 对一段消息调用 LLM，生成简短时间线片段
 * @param {Array} messages 解析后的消息数组（带 parsedContent）
 * @returns {Promise<string>} 时间线片段文本
 */
export async function generateTimelineSegment(messages) {
    if (!messages || messages.length === 0) {
        logger.warn('[时间线] generateTimelineSegment: 没有消息');
        return '';
    }

    // 过滤掉内容为空的消息
    const validMessages = messages.filter(msg => {
        const content = msg.parsedContent || msg.mes || msg.message || '';
        return content.trim().length > 0;
    });

    if (validMessages.length === 0) {
        logger.warn('[时间线] generateTimelineSegment: 所有消息内容为空，跳过');
        return '';
    }

    // 格式化消息为文本
    const messagesText = validMessages.map(msg => {
        const speaker = msg.is_user ? '{{user}}'
            : msg.is_system ? 'System'
                : (msg.name || '{{char}}');
        const content = msg.parsedContent || msg.mes || msg.message || '[无内容]';
        const datePrefix = msg.parsedDate ? `[${msg.parsedDate}] ` : '';
        return `${datePrefix}${speaker}: ${content}`;
    }).join('\n');

    // 最终检查：如果格式化后的文本太短（无实质内容），跳过 LLM 调用
    const strippedText = messagesText.replace(/\[.*?\]\s*\w+:\s*/g, '').trim();
    if (strippedText.length < 10) {
        logger.warn(`[时间线] generateTimelineSegment: 有效内容过短 (${strippedText.length} 字符)，跳过`);
        return '';
    }

    const prompt = buildTimelinePrompt(messagesText);
    const result = await callLLM(prompt);

    if (!result || !result.trim()) {
        logger.warn('[时间线] LLM 未返回时间线内容');
        return '';
    }

    logger.info(`[时间线] ✅ 已生成时间线片段 (${result.trim().split('\n').length} 个要点)`);
    return result.trim();
}

/**
 * 将多个时间线片段合并为一个连贯的时间线
 * @param {string[]} segments 时间线片段数组
 * @returns {Promise<string>} 合并后的时间线文本
 */
export async function mergeTimelineSegments(segments) {
    // 过滤空片段
    const valid = segments.filter(s => s && s.trim());

    if (valid.length === 0) return '';
    if (valid.length === 1) return valid[0];

    // 如果片段不多（≤3），直接简单拼接
    if (valid.length <= 3) {
        const combined = valid.join('\n');
        // 如果拼接结果不太长就直接用，省一次 LLM 调用
        if (estimateTokens(combined) <= TIMELINE_MAX_TOKENS) {
            logger.info(`[时间线] 📎 ${valid.length} 个片段直接拼接 (tokens 在阈值内)`);
            return combined;
        }
    }

    logger.info(`[时间线] 🔄 调用 LLM 合并 ${valid.length} 个时间线片段...`);
    const prompt = buildMergePrompt(valid);
    const merged = await callLLM(prompt, 4096);

    if (!merged || !merged.trim()) {
        // 合并失败回退到简单拼接
        logger.warn('[时间线] LLM 合并失败，回退到简单拼接');
        return valid.join('\n');
    }

    logger.info(`[时间线] ✅ 合并完成 (${merged.trim().split('\n').length} 个要点)`);
    return merged.trim();
}

/**
 * 当时间线超过 TIMELINE_MAX_TOKENS 时，压缩最早的事件为章节概括
 * @param {string} timeline 当前时间线文本
 * @returns {Promise<string>} 压缩后的时间线
 */
export async function compressTimeline(timeline) {
    if (!timeline || !timeline.trim()) return timeline;

    const tokens = estimateTokens(timeline);
    if (tokens <= TIMELINE_MAX_TOKENS) {
        logger.info(`[时间线] 📐 时间线 ${tokens} tokens，无需压缩`);
        return timeline;
    }

    logger.info(`[时间线] 🗜️ 时间线 ${tokens} tokens > ${TIMELINE_MAX_TOKENS}，开始压缩...`);

    // 分为前半部分和后半部分
    const lines = timeline.split('\n').filter(l => l.trim());
    const midpoint = Math.ceil(lines.length / 2);
    const oldPart = lines.slice(0, midpoint).join('\n');
    const recentPart = lines.slice(midpoint).join('\n');

    const prompt = buildCompressionPrompt(oldPart, recentPart);
    const compressed = await callLLM(prompt, 1024);

    if (!compressed || !compressed.trim()) {
        logger.warn('[时间线] 压缩失败，保留原始时间线');
        return timeline;
    }

    // 拼接：压缩后的前半部分 + 原始后半部分
    const result = compressed.trim() + '\n' + recentPart;
    const newTokens = estimateTokens(result);
    logger.info(`[时间线] ✅ 压缩完成: ${tokens} → ${newTokens} tokens`);

    // 递归检查是否还需要压缩
    if (newTokens > TIMELINE_MAX_TOKENS) {
        logger.info('[时间线] ⚠️ 仍超过阈值，递归压缩...');
        return compressTimeline(result);
    }

    return result;
}

/**
 * 追加新事件到已有时间线，必要时触发压缩
 * @param {Array} messages 新发生的消息
 * @returns {Promise<string>} 更新后的时间线文本
 */
export async function appendToTimeline(messages) {
    logger.info(`[时间线] 📝 开始追加时间线 (${messages.length} 条消息)...`);

    // 1. 从消息中生成新的时间线片段
    const newSegment = await generateTimelineSegment(messages);
    if (!newSegment) {
        logger.info('[时间线] 未提取到新事件，跳过追加');
        return await readTimelineFromWorldbook() || '';
    }

    // 2. 读取现有时间线
    const existing = await readTimelineFromWorldbook();

    let updated;
    if (existing && existing.trim()) {
        // 拼接到末尾
        updated = existing.trim() + '\n' + newSegment;
    } else {
        updated = newSegment;
    }

    // 3. 如果超出 token 限制，压缩
    updated = await compressTimeline(updated);

    // 4. 写回世界书
    await writeTimelineToWorldbook(updated);

    logger.success(`[时间线] ✅ 时间线追加完成`);
    return updated;
}

// ═══════════════════════════════════════════════════════════════════════
// Utility
// ═══════════════════════════════════════════════════════════════════════

/**
 * 粗略估算文本的 token 数
 * @param {string} text
 * @returns {number}
 */
function estimateTokens(text) {
    if (!text) return 0;
    // CJK characters count more heavily; ASCII words count less
    let cjk = 0;
    let ascii = 0;
    for (const ch of text) {
        if (ch.charCodeAt(0) > 0x2E7F) cjk++;
        else if (/\S/.test(ch)) ascii++;
    }
    // Each CJK char ≈ 1.5 tokens; every ~4 ASCII chars ≈ 1 token
    return Math.ceil(cjk * CHARS_PER_TOKEN + ascii / 4);
}
