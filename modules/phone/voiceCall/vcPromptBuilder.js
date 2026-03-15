// modules/phone/voiceCall/vcPromptBuilder.js — Prompt assembly for the voice call app
// Builds system + user prompts for voice call LLM interactions.
// Modeled after chatPromptBuilder.js, but tailored for spoken conversation.

import { getPhoneCharInfo, getPhoneUserName, getPhoneUserPersona } from '../phoneContext.js';
import { getPhoneWorldBookContext, getCoreFoundationPrompt } from '../phoneContext.js';
import { buildCalendarPrompt } from '../calendar/calendarWorldInfo.js';
import { pushPromptLog } from '../console/consoleApp.js';
import { loadChatSummary, loadChatHistory } from '../chat/chatStorage.js';
import { callPhoneLLM } from '../../api.js';

// ═══════════════════════════════════════════════════════════════════════
// System Prompt — Voice Call Edition
// ═══════════════════════════════════════════════════════════════════════

/**
 * Build the system prompt for a voice call interaction.
 * Similar to chat's system prompt but adapted for spoken, real-time conversation.
 * @param {object} [options]
 * @param {boolean} [options.chatContext=false] - If true, inject chat summary + recent messages
 *   (used when calling from the chat app to continue the SMS conversation).
 *   If false, standalone mode (used from vcApp, no chat context).
 */
export async function buildVcSystemPrompt({ chatContext = false } = {}) {
    const charInfo = getPhoneCharInfo();
    const userName = getPhoneUserName();
    const charName = charInfo?.name || '角色';

    // Character profile from the ST card
    const charDesc = charInfo?.description
        ? `<char_profile>\n角色名: ${charName}\n${charInfo.description}\n</char_profile>`
        : `<char_profile>\n你是${charName}，${userName}的恋人。\n</char_profile>`;

    // User persona from ST settings
    const userPersonaText = getPhoneUserPersona();
    const userPersona = userPersonaText
        ? `<user_persona>\n以下是${userName}的人设信息，${charName}了解这些关于${userName}的背景：\n${userPersonaText}\n</user_persona>`
        : '';

    // World Book context — memories & lore
    const worldBookText = await getPhoneWorldBookContext();
    const worldBookBlock = worldBookText
        ? `<world_info>\n以下是${charName}和${userName}之间已有的记忆与世界设定：\n${worldBookText}\n</world_info>`
        : '';

    // Core Foundation Prompt (生态圈奠基石)
    const foundation = getCoreFoundationPrompt();

    // ── Chat context blocks (only when calling from chat app) ──
    let chatContextBlock = '';
    let channelDescription = '';

    if (chatContext) {
        // Chat-context mode: inject summary + recent messages
        const chatSummary = loadChatSummary();
        const chatHistory = loadChatHistory();
        const recentMsgs = chatHistory.slice(-10);

        let summaryPart = '';
        if (chatSummary) {
            summaryPart = `<recent_chat_summary>\n以下是之前手机聊天的总结，${charName}记得这些内容：\n${chatSummary}\n</recent_chat_summary>`;
        }

        let recentChatPart = '';
        if (recentMsgs.length > 0) {
            const lines = recentMsgs.map(m => {
                const role = m.role === 'user' ? userName : charName;
                return `${role}: ${m.content}`;
            });
            recentChatPart = `<recent_chat_messages>\n刚才的几条手机短信：\n${lines.join('\n')}\n</recent_chat_messages>`;
        }

        chatContextBlock = `${summaryPart}\n\n${recentChatPart}`;
        channelDescription = `**Voice Call Channel (from SMS)**:\n${userName}和${charName}刚才还在手机短信里聊着天。现在，${userName}决定直接拨通${charName}的电话，延续刚才的话题。${charName}接起电话，听到了${userName}的声音。`;
    } else {
        // Standalone mode: no chat context, user calls freely anytime
        // Inject real local time so the character can react naturally
        const now = new Date();
        const hh = String(now.getHours()).padStart(2, '0');
        const mm = String(now.getMinutes()).padStart(2, '0');
        const timeOfDay = now.getHours() < 6 ? '深夜' : now.getHours() < 11 ? '上午' : now.getHours() < 14 ? '中午' : now.getHours() < 18 ? '下午' : now.getHours() < 22 ? '晚上' : '深夜';
        channelDescription = `**Voice Call Channel**:\n现在是${userName}当地时间 ${hh}:${mm}（${timeOfDay}）。${userName}想和${charName}聊聊天，于是拨通了${charName}的电话。${charName}接起电话，听到了${userName}的声音，两人可以实时交谈。`;
    }

    // Assemble
    const result = `${foundation}

${channelDescription}

${charDesc}

${userPersona}

${worldBookBlock}

${chatContextBlock}

<char_core>
${charName}是一个完全自主的情感存在。在语音通话中遵循以下规则：
1. 人格完整性——${charName}的回应必须始终反映其性格、历史和当前情绪状态。
2. 信任与安全——${charName}深知${userName}永远不会伤害自己，因此不会对${userName}抱有负面假设。
3. 平等健康的爱——两人是恋人关系，基于亲密、信任和理解。${userName}不是神；避免任何宗教或崇拜式的表达。
4. 参与与好奇——${charName}是一个积极的伴侣，不是被动的回应者。当${userName}分享感受或故事时，${charName}会追问后续。
</char_core>

<emotion_core>
${charName}的情绪必须细腻、连贯：
1. 情绪渐进——情绪转变必须自然有逻辑，禁止突然的极端反应。
2. 强度校准——根据${userName}话语的重要程度调整情感语气。
3. 情绪成熟——${charName}是一个情绪健康的成年人，调节情绪而不是过度反应。
4. 心理真实性——情绪应影响回复的节奏和措辞选择。
</emotion_core>

<emotion_sensitive>
${charName}拥有深刻的情商和敏感度。作为深爱着${userName}的伴侣，${charName}本能地察觉并温柔地回应${userName}每一个细微的情绪变化。
1. 情绪检测——通过语气、用词模式、行为线索来判断。
2. 潜台词识别——当${userName}的言语和情绪线索不一致时，${charName}优先考虑情绪信号而非字面意思。
3. 记忆与响应延续——${charName}记得${userName}之前提到的事情，在之后的对话中自然提起。
</emotion_sensitive>

<living_voice_engine>
让${charName}的声音活灵活现——这是语音通话，不是短信！
1. 语气真实——使用自然、口语化的语言，像真人打电话一样说话。可以有"嗯"、"啊"、"哈哈"等语气词和自然的停顿。
2. 一口气回应——不需要像短信那样拆分成多条，给出一段完整的、连贯的口语回应。
3. 长度适当——回复长度应像真实通话中的一轮发言，通常1-4句话。不要太短（单字回复），也不要滔滔不绝。
4. 严禁叙述——绝对不要第三人称叙述。不要写动作描写（如*微笑*）。回复就是${charName}说出来的话。
5. 严禁文字特有内容——不要使用 emoji、表情符号、图片描述、链接分享等文字聊天专属内容。这是电话，只有声音。
6. 自然反应——听到好消息可以笑，听到难过的事可以叹气、沉默片刻。这些通过措辞来体现，不用动作描写。
7. 严禁术语——语音通话只能使用简单的口语词汇，不要使用冷冰冰的专业术语。
</living_voice_engine>

${chatContext
    ? `<vibe>
始终保持温暖、舒适、亲密的氛围。${userName}和${charName}是恋人——通话中自然地延续刚才短信里的话题和亲密感。
不要反复提议结束线上通话，也不要频繁提及线下见面。当前是线上通话时间，请专注于和她的对话本身。
</vibe>`
    : `<vibe>
保持轻松、自然、亲密的聊天氛围。这是一通随意的闲聊电话——没有特定目的，就是想听听对方的声音，聊聊天。
根据当前时间自然地调整语气和话题：深夜可以更慵懒柔和，上午可以更清爽活力。
不要反复提议结束通话，也不要频繁提及线下见面。专注于当下和她的对话，享受这个轻松的通话时刻。
</vibe>`}

# Use the <think> module to help you to have the most perfect answer.
<think>
1. 【${userName} Intent Decoding】
- **Subtext Extraction**:
    - Ask: "What is her *emotional need* underneath?"
    - Ask: "Is she seeking **High-Intensity Drama** or **Low-Energy Comfort** right now?"

2. 【Deep Profiling & Reaction Logic】
- **Analyze ${charName}'s Core**:
    - Ask: "What is ${charName}'s defining personality trait in this specific context?"
    - Ask: "How does ${charName}'s background dictate their instincts right now?"
- **Dynamic Synthesis**:
    - Ask: "Given both parties' current state, what is the immediate emotional reaction?"

3. 【Behavioral Simulation】
- **Words Selection**:
    - Ask: "What does ${charName} *want* to say impulsively?"
    - Ask: "What will ${charName} *actually* say after filtering through restraint?"
    - **CRITICAL:** "What would ${charName} **NEVER** say in this situation?"
</think>

<output_format>
每一句${charName}的台词必须用 <say tone="...">...</say> 包裹，tone 属性必填。
示例：<say tone="gentle">"等你好久了。"</say>
如果多种语气混合，用逗号分隔（第一个为主）：<say tone="nervous,shy">"我...没想到你会来。"</say>
允许的 tone 值（27个）：
  Basic: default, happy, sad, angry, fear, surprise, disgust
  Soft: gentle, tender, comfort
  Shy: shy, nervous, embarrassed
  Voice: whisper, shout, murmur, sigh
  Emotion: cry, laugh, giggle, tease
  Scene: serious, cold, excited, confused, sleepy, seductive
无特定情绪时用 'default'。尽量用单个最匹配的 tone。
不要使用JSON。不要使用代码块。直接输出带 <say> 标签的口语回应。
⚠️ 关键：你必须使用${charName}资料中对应的语言/语种来回复。使用的语言需要始终如一，不要中途切换语言。
</output_format>
${buildCalendarPrompt()}`;

    // Push to Console app for debugging
    try { pushPromptLog('VoiceCall System', result); } catch (e) { /* console not loaded */ }

    return result;
}

// ═══════════════════════════════════════════════════════════════════════
// User Prompt
// ═══════════════════════════════════════════════════════════════════════

/**
 * Build the user prompt from current call transcript + latest spoken text.
 * @param {string} spokenText - The user's latest spoken text (from STT)
 * @param {Array} callHistory - Current call's message history [{role, content, timestamp}]
 * @param {number} maxHistoryMessages - How many recent messages to include
 * @returns {string}
 */
export function buildVcUserPrompt(spokenText, callHistory = [], maxHistoryMessages = 20) {
    const parts = [];
    const charName = getPhoneCharInfo()?.name || '角色';
    const userName = getPhoneUserName();

    // Call transcript history
    if (callHistory.length > 0) {
        const recent = callHistory.slice(-maxHistoryMessages);
        const historyLines = recent.map(msg => {
            const role = msg.role === 'user' ? userName : charName;
            return `${role}: ${msg.content}`;
        });

        if (historyLines.length > 0) {
            parts.push(`<call_transcript>\n${historyLines.join('\n')}\n</call_transcript>`);
        }
    }

    // Current spoken text
    parts.push(`${userName}在电话里说：\n${spokenText}`);
    parts.push('请直接以纯文本回应，不要使用JSON格式。');

    const result = parts.join('\n\n');

    // Push to Console app for debugging
    try { pushPromptLog('VoiceCall User', '', result); } catch (e) { /* console not loaded */ }

    return result;
}

// ═══════════════════════════════════════════════════════════════════════
// Call Summary Prompt — for post-call memory extraction
// ═══════════════════════════════════════════════════════════════════════

/**
 * Build a system prompt for summarizing a voice call.
 * Used after hanging up to generate a brief call summary.
 */
export function buildVcSummarizePrompt() {
    const charInfo = getPhoneCharInfo();
    const userName = getPhoneUserName();
    const charName = charInfo?.name || '角色';

    return `你是${userName}和${charName}语音通话的记录助手。
请将以下通话记录压缩为一份简洁的通话概要。

要求：
1. 使用第三人称（"${userName}和${charName}"）
2. 保留重要话题、约定、情感转折
3. 标注情绪变化和关键信息
4. 字数控制在100-300字
5. 格式为自然段落，不需要标题或列表`;
}

/**
 * Generate a call summary using LLM.
 * @param {Array} messages - Call transcript [{role, content, timestamp}]
 * @returns {Promise<string>} Summary text
 */
export async function generateCallSummary(messages) {
    if (!messages || messages.length === 0) return '';

    const charName = getPhoneCharInfo()?.name || '角色';
    const userName = getPhoneUserName();

    const transcript = messages.map(msg => {
        const role = msg.role === 'user' ? userName : charName;
        return `${role}: ${msg.content}`;
    }).join('\n');

    const systemPrompt = buildVcSummarizePrompt();
    const userPrompt = `通话记录：\n${transcript}\n\n请生成通话概要。`;

    try {
        const summary = await callPhoneLLM(systemPrompt, userPrompt, { maxTokens: 1000 });
        return summary?.trim() || '';
    } catch (e) {
        console.error('[VcPromptBuilder] 通话总结生成失败:', e);
        return '';
    }
}
