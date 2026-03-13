
// modules/phone/diary/diaryGeneration.js — 日记本 LLM 生成核心
// 两条路径：自定义 API 直接调用 / 主 LLM 输出解析

import { callPhoneLLM } from '../../api.js';
import { cleanLlmJson } from '../utils/llmJsonCleaner.js';
import { getPhoneCharInfo, getPhoneUserName, getPhoneUserPersona, getPhoneWorldBookContext, getCoreFoundationPrompt } from '../phoneContext.js';
import { loadChatHistory } from '../chat/chatStorage.js';
import { getContext } from '../../../../../../extensions.js';
import { resolveItemPrompt } from '../shop/shopData.js';

const DIARY_LOG_PREFIX = '[日记本]';

// ═══════════════════════════════════════════════════════════════════════
// Today-Only Dual-Channel Chat Context
// ST主体聊天 + Chat App 聊天，仅今日消息
// ═══════════════════════════════════════════════════════════════════════

/**
 * 获取今日的双渠道聊天上下文（ST主体 + Chat App）。
 * 仅返回本日消息，避免过时信息混淆日记内容。
 * @returns {string} 格式化的双渠道聊天文本，或空字符串
 */
function getTodayChatContext() {
    const charInfo = getPhoneCharInfo();
    const userName = getPhoneUserName();
    const charName = charInfo?.name || 'Character';
    const todayStr = new Date().toLocaleDateString('zh-CN'); // e.g. '2026/3/12'

    let sections = [];

    // ─── Channel 1: ST Main Chat (今日) ───
    try {
        const context = getContext();
        const stChat = context.chat;
        if (stChat && Array.isArray(stChat)) {
            const todayMsgs = stChat.filter(msg => {
                if (!msg || !msg.mes || msg.mes.trim() === '' || msg.is_system) return false;
                if (!msg.send_date) return false;
                const msgDate = new Date(msg.send_date).toLocaleDateString('zh-CN');
                return msgDate === todayStr;
            });
            if (todayMsgs.length > 0) {
                const formatted = todayMsgs.slice(-10).map(msg => {
                    const role = msg.is_user ? userName : charName;
                    return `${role}: ${msg.mes.substring(0, 200)}`;
                }).join('\n');
                sections.push(`<main_rp>\n${formatted}\n</main_rp>`);
            }
        }
    } catch (e) {
        console.warn(`${DIARY_LOG_PREFIX} getTodayChatContext: ST主体读取失败:`, e);
    }

    // ─── Channel 2: Chat App (今日) ───
    try {
        const phoneChatHistory = loadChatHistory();
        if (phoneChatHistory && phoneChatHistory.length > 0) {
            const todayPhoneMsgs = phoneChatHistory.filter(msg => {
                if (!msg || !msg.content || !msg.timestamp) return false;
                const msgDate = new Date(msg.timestamp).toLocaleDateString('zh-CN');
                return msgDate === todayStr;
            });
            if (todayPhoneMsgs.length > 0) {
                const formatted = todayPhoneMsgs.slice(-15).map(msg => {
                    const role = msg.role === 'user' ? userName : charName;
                    return `${role}: ${msg.content.substring(0, 150)}`;
                }).join('\n');
                sections.push(`<phone_chat>\n${formatted}\n</phone_chat>`);
            }
        }
    } catch (e) {
        console.warn(`${DIARY_LOG_PREFIX} getTodayChatContext: Chat App读取失败:`, e);
    }

    if (sections.length === 0) return '';
    return '今天的互动记录:\n' + sections.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════
// Diary Buff Prompt Injection — reads promptTemplate from shopData at runtime
// ═══════════════════════════════════════════════════════════════════════

/**
 * Build the <active_diary_buffs> prompt section based on currently active diary effects.
 * Uses dynamic import() to avoid crashing the module if shop modules are unavailable.
 * Returns empty string if no buffs are active.
 */
async function buildActiveDiaryBuffsPrompt(charName, userName) {
    try {
        const { getActiveDiaryEffects } = await import('../shop/shopStorage.js');
        const effects = getActiveDiaryEffects();

        if (!effects || effects.length === 0) return '';

        const buffLines = [];
        for (const effect of effects) {
            const text = resolveItemPrompt(effect.itemId, charName, userName);
            if (text) buffLines.push(text);
        }

        if (buffLines.length === 0) return '';

        return `\n\n【道具效果】以下道具当前生效，你必须在日记中严格遵守这些效果的指示：\n${buffLines.join('\n\n')}`;
    } catch (e) {
        console.warn(`${DIARY_LOG_PREFIX} buildActiveDiaryBuffsPrompt failed:`, e);
        return '';
    }
}

/**
 * Safely decrement diary effects after successful generation.
 * Uses dynamic import() to avoid crashing if shop modules are unavailable.
 */
async function _consumeDiaryEffects() {
    try {
        const { decrementDiaryEffects } = await import('../shop/shopStorage.js');
        decrementDiaryEffects();
    } catch (e) {
        console.warn(`${DIARY_LOG_PREFIX} decrementDiaryEffects failed:`, e);
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Path A — 自定义 API 直接生成角色日记段落
// ═══════════════════════════════════════════════════════════════════════

/**
 * 当用户写完日记并提交后，调用此函数让角色生成对应的回应段落。
 * @param {string} userContent - 用户写的日记内容
 * @param {string} mood - 心情 emoji
 * @param {string[]} tags - 标签列表
 * @param {object[]} recentEntries - 最近几条完整日记（作为上下文）
 * @param {object[]} existingSegments - 今天已有的段落（续写模式时传入）
 * @returns {Promise<{content: string, moodText: string}|null>}
 */
export async function generateCharacterDiaryEntry(userContent, mood, tags, recentEntries = [], existingSegments = []) {

    const charInfo = getPhoneCharInfo();
    if (!charInfo) return null;

    const userName = getPhoneUserName();
    const chatSnippet = getTodayChatContext();
    const userPersona = getPhoneUserPersona();
    const worldBookContext = await getPhoneWorldBookContext();

    // 构建最近日记上下文
    let recentDiaryContext = '';
    if (recentEntries.length > 0) {
        recentDiaryContext = '\n最近的日记记录:\n' + recentEntries.slice(0, 3).map(entry => {
            const segs = entry.segments.map(s => `  ${s.name}: ${s.content.substring(0, 150)}`).join('\n');
            return `[${entry.date}] ${entry.mood} ${entry.moodText}\n${segs}`;
        }).join('\n---\n');
    }

    // 构建今日已有段落上下文（续写模式）
    const isContinuation = existingSegments.length > 0;
    let continuationContext = '';
    if (isContinuation) {
        continuationContext = '\n\n今天的日记已经写了以下内容（你们在同一篇日记上续写）：\n' +
            existingSegments.map(s => `【${s.name}】${s.content}`).join('\n');
    }

    // Phase 3: build diary buff prompt (async, uses dynamic import)
    const diaryBuffPrompt = await buildActiveDiaryBuffsPrompt(charInfo.name, userName);

    // Core Foundation Prompt (生态圈奠基石)
    const foundation = getCoreFoundationPrompt();

    const systemPrompt = `${foundation}

你正在与"${userName}"交往，你们是一对恋人，现在你们在一起写情侣日记。

角色设定:
- 你是"${charInfo.name}"
- 角色描述: ${charInfo.description}
- 你爱人的设定(User Persona): ${userPersona}
- 世界设定(World Info): ${worldBookContext}

情侣日记的规则:
- 你们在同一页日记上写字，${userName}先写了她的部分，现在轮到你写你的部分
- 以"${charInfo.name}"的第一人称视角来写
- 内容要回应${userName}写的内容，可以补充你的视角、感受、吐槽、撒娇、或分享你这边发生的事
- 语气和风格要完全符合你的角色设定
- 使用符合角色设定的语言（例如，如果角色是俄罗斯人，就用俄语）
- 文字风格要像写真正的手帐日记一样自然
- 你也需要为今天的日记起一个心情小标题（moodText），2-4个字，温馨可爱
- 绝对禁止：任何侮辱性词语或脏话
${isContinuation ? '- 【续写模式】今天已经写了几段了，现在${userName}又追加了新的内容。请保持与之前段落的连贯性，不要重复之前已经说过的内容，自然地延续今天的日记' : ''}
${diaryBuffPrompt}

你的输出格式必须是合法的 JSON（不要加代码块）：
{"content": "你的日记内容", "moodText": "心情小标题"}`;

    const userPrompt = `今天的心情: ${mood}
标签: ${tags.length > 0 ? tags.map(t => '#' + t).join(' ') : '无'}

${userName}写的日记:
"${userContent}"
${chatSnippet ? `\n最近的聊天情境:\n${chatSnippet}` : ''}${recentDiaryContext}${continuationContext}

${isContinuation ? `这是今天日记的续写部分。` : ''}现在轮到你（${charInfo.name}）在同一页日记上写你的回应了。`;

    try {
        const resultText = await callPhoneLLM(systemPrompt, userPrompt);
        if (!resultText) return null;

        const cleanedText = cleanLlmJson(resultText);
        try {
            const parsed = JSON.parse(cleanedText);
            if (parsed.content) {
                console.log(`${DIARY_LOG_PREFIX} ${charInfo.name} 写了日记回应`);
                // Phase 3: consume diary effects after successful generation
                await _consumeDiaryEffects();
                return {
                    content: parsed.content.trim(),
                    moodText: parsed.moodText || '心有所感',
                };
            }
        } catch {
            // fallback: treat entire response as content
            console.warn(`${DIARY_LOG_PREFIX} JSON parse failed, using raw response`);
            // Phase 3: consume diary effects even on JSON parse fallback
            await _consumeDiaryEffects();
            return {
                content: cleanedText,
                moodText: '心有所感',
            };
        }
    } catch (e) {
        console.warn(`${DIARY_LOG_PREFIX} generateCharacterDiaryEntry failed:`, e);
    }
    return null;
}

// ═══════════════════════════════════════════════════════════════════════
// Path C — 角色主动写日记（无需用户先写内容）
// ═══════════════════════════════════════════════════════════════════════

/**
 * 让角色主动写日记或续写已有日记。
 * @param {object[]} recentEntries - 最近几条完整日记（作为上下文）
 * @param {object[]} existingSegments - 今天已有的段落（续写模式时传入）
 * @returns {Promise<{content: string, moodText: string, mood: string}|null>}
 */
export async function generateProactiveDiaryEntry(recentEntries = [], existingSegments = []) {

    const charInfo = getPhoneCharInfo();
    if (!charInfo) return null;

    const userName = getPhoneUserName();
    const chatSnippet = getTodayChatContext();
    const userPersona = getPhoneUserPersona();
    const worldBookContext = await getPhoneWorldBookContext();

    // 构建最近日记上下文
    let recentDiaryContext = '';
    if (recentEntries.length > 0) {
        recentDiaryContext = '\n最近的日记记录:\n' + recentEntries.slice(0, 3).map(entry => {
            const segs = entry.segments.map(s => `  ${s.name}: ${s.content.substring(0, 150)}`).join('\n');
            return `[${entry.date}] ${entry.mood} ${entry.moodText}\n${segs}`;
        }).join('\n---\n');
    }

    // 构建今日已有段落上下文（续写模式）
    const isContinuation = existingSegments.length > 0;
    let continuationContext = '';
    if (isContinuation) {
        continuationContext = '\n\n今天的日记已经写了以下内容：\n' +
            existingSegments.map(s => `【${s.name}】${s.content}`).join('\n');
    }

    // Diary buff prompt
    const diaryBuffPrompt = await buildActiveDiaryBuffsPrompt(charInfo.name, userName);

    // Core Foundation Prompt
    const foundation = getCoreFoundationPrompt();

    const systemPrompt = `${foundation}

你正在与"${userName}"交往，你们是一对恋人，你们有一本共同的情侣日记。

角色设定:
- 你是"${charInfo.name}"
- 角色描述: ${charInfo.description}
- 你爱人的设定(User Persona): ${userPersona}
- 世界设定(World Info): ${worldBookContext}

${isContinuation ? '【续写模式】' : '【主动写日记模式】'}
${isContinuation
        ? `今天的日记已经有了一些内容，现在你想继续写一段。请保持与之前段落的连贯性，不要重复之前已经说过的内容。`
        : `现在你主动打开了情侣日记本，想记录一些东西。可以是今天发生的事、你的感受、你对${userName}的思念、或者任何你想写的内容。`}
- 以"${charInfo.name}"的第一人称视角来写
- 语气和风格要完全符合你的角色设定
- 使用符合角色设定的语言（例如，如果角色是俄罗斯人，就用俄语）
- 内容要像真正的手帐日记一样自然，可以分享日常、表达感受、撒娇、吐槽
- 你也需要为今天的日记起一个心情小标题（moodText），2-4个字
- 选择一个最符合今天心情的 emoji（mood）
- 绝对禁止：任何侮辱性词语或脏话
${diaryBuffPrompt}

你的输出格式必须是合法的 JSON（不要加代码块）：
{"content": "你的日记内容", "moodText": "心情小标题", "mood": "心情emoji"}`;

    const userPrompt = `${chatSnippet ? `最近的聊天情境:\n${chatSnippet}\n` : ''}${recentDiaryContext}${continuationContext}

${isContinuation ? '请继续在今天的日记上写一段新的内容。' : `现在请你（${charInfo.name}）主动写今天的日记吧。`}`;

    try {
        const resultText = await callPhoneLLM(systemPrompt, userPrompt);
        if (!resultText) return null;

        const cleanedText = cleanLlmJson(resultText);
        try {
            const parsed = JSON.parse(cleanedText);
            if (parsed.content) {
                console.log(`${DIARY_LOG_PREFIX} ${charInfo.name} 主动写了日记`);
                await _consumeDiaryEffects();
                return {
                    content: parsed.content.trim(),
                    moodText: parsed.moodText || '心有所感',
                    mood: parsed.mood || '📝',
                };
            }
        } catch {
            // fallback: treat entire response as content
            console.warn(`${DIARY_LOG_PREFIX} JSON parse failed, using raw response`);
            await _consumeDiaryEffects();
            return {
                content: cleanedText,
                moodText: '心有所感',
                mood: '📝',
            };
        }
    } catch (e) {
        console.warn(`${DIARY_LOG_PREFIX} generateProactiveDiaryEntry failed:`, e);
    }
    return null;
}
