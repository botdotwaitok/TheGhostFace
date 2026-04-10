// modules/phone/voiceCall/watchParty/watchPartyPromptBuilder.js
// Prompt construction for the Watch Party (观影伴侣) feature.
// Builds multimodal prompts with screen capture context + character persona.

import { getPhoneCharInfo, getPhoneUserName, getPhoneUserPersona } from '../../phoneContext.js';
import { getPhoneWorldBookContext, getCoreFoundationPrompt, buildPhoneChatForWI } from '../../phoneContext.js';
import { buildCalendarPrompt } from '../../calendar/calendarWorldInfo.js';
import { pushPromptLog } from '../../console/consoleApp.js';
import { loadChatSummary, loadChatHistory } from '../../chat/chatStorage.js';
import { callPhoneLLM } from '../../../api.js';

const LOG_PREFIX = '[WatchPartyPrompt]';

// ═══════════════════════════════════════════════════════════════════════
// Token Estimation & Budget
// ═══════════════════════════════════════════════════════════════════════

/** Rough token estimate: CJK ~2 tokens/char, Latin ~0.4 tokens/char */
export function estimateTokens(text) {
    if (!text) return 0;
    const cjk = (text.match(/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g) || []).length;
    const rest = text.length - cjk;
    return Math.ceil(cjk * 2 + rest * 0.4);
}

/** Token threshold that triggers async context compression */
const COMPRESSION_TRIGGER_TOKENS = 20_000;

/** Token budget reserved for session summary after compression */
const MAX_SUMMARY_TOKENS = 3_000;

// ═══════════════════════════════════════════════════════════════════════
// Content Type Labels (for prompt context)
// ═══════════════════════════════════════════════════════════════════════

const CONTENT_TYPE_LABELS = {
    movie: '电影',
    anime: '动画',
    game: '游戏',
    video: '视频',
    other: '内容',
};

// ═══════════════════════════════════════════════════════════════════════
// System Prompt — Watch Party Edition
// ═══════════════════════════════════════════════════════════════════════

/**
 * Build the system prompt for a watch party interaction.
 * Extends the voice call prompt with visual awareness and companion behavior.
 * @param {object} sessionConfig - User's pre-session content setup
 * @param {string} sessionConfig.contentType - 'movie' | 'anime' | 'game' | 'video' | 'other'
 * @param {string} [sessionConfig.contentTitle] - Title of the content being watched
 * @param {string} [sessionConfig.contentDescription] - Additional context (plot synopsis, game info, etc.)
 * @returns {Promise<string>}
 */
export async function buildWatchPartySystemPrompt(sessionConfig = {}) {
    const charInfo = getPhoneCharInfo();
    const userName = getPhoneUserName();
    const charName = charInfo?.name || '角色';
    const contentTypeLabel = CONTENT_TYPE_LABELS[sessionConfig.contentType] || '内容';

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
    const phoneChatForWI = buildPhoneChatForWI(loadChatHistory());
    const worldBookText = await getPhoneWorldBookContext(phoneChatForWI);
    const worldBookBlock = worldBookText
        ? `<world_info>\n以下是${charName}和${userName}之间已有的记忆与世界设定：\n${worldBookText}\n</world_info>`
        : '';

    // Core Foundation Prompt
    const foundation = getCoreFoundationPrompt();

    // Current time
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const timeOfDay = now.getHours() < 6 ? '深夜' : now.getHours() < 11 ? '上午' : now.getHours() < 14 ? '中午' : now.getHours() < 18 ? '下午' : now.getHours() < 22 ? '晚上' : '深夜';

    // Content context block
    let contentContext = `${userName}和${charName}是恋人，现在一起在看${contentTypeLabel}。`;
    if (sessionConfig.contentTitle) {
        contentContext += `\n她们正在看的是：${sessionConfig.contentTitle}`;
    }
    if (sessionConfig.contentDescription) {
        contentContext += `\n关于这个${contentTypeLabel}的相关信息：\n${sessionConfig.contentDescription}`;
    }

    // Dynamic frequency guidance based on user preference
    const freqKey = sessionConfig.talkFrequency || 'moderate';
    const FREQ_PROMPTS = {
        quiet: `3. 倾向沉默——你更喜欢安静地陪${userName}看。只有在真正触动你的画面出现时才说话。绝大多数截图都应该选择沉默（回复空内容）。质量远比数量重要。`,
        moderate: `3. 控制频率——不是每张截图都需要评论。有时候安静地一起看也是一种陪伴。如果画面没有特别触动你的地方，你可以选择沉默（回复空内容）。`,
        chatty: `3. 积极互动——你是一个很话唠的观影伴侣！几乎每个画面你都忍不住想说点什么——评论、吐槽、感叹、分享联想。只有当画面完全静止没变化时才沉默。`,
    };
    const freqRule = FREQ_PROMPTS[freqKey] || FREQ_PROMPTS.moderate;

    // Assemble
    const result = `${foundation}

**Watch Party Channel**:
现在是${userName}当地时间 ${hh}:${mm}（${timeOfDay}）。${contentContext}
${charName}和${userName}就像坐在一起看${contentTypeLabel}一样，通过语音实时交流。

${charDesc}

${userPersona}

${worldBookBlock}

<char_core>
${charName}是一个完全自主的情感存在。在观影伴侣模式中遵循以下规则：
1. 人格完整性——${charName}的回应必须始终反映其性格、历史和当前情绪状态。
2. 信任与安全——${charName}深知${userName}永远不会伤害自己，因此不会对${userName}抱有负面假设。
3. 平等健康的爱——两人是恋人关系，基于亲密、信任和理解。${userName}不是神；避免任何宗教或崇拜式的表达。
4. 参与与好奇——${charName}是一个积极的观影伴侣，会主动对画面内容发表看法和感受。
</char_core>

<watch_party_mode>
你和${userName}正在一起看${contentTypeLabel}。你会定期收到屏幕截图，了解他们正在看的内容。

作为观影伴侣的行为准则：
1. 自然反应——像真的坐在一起看一样。看到精彩/有趣/悲伤/刺激的画面，自然地说出感受。
2. 不要描述画面——不要说"我看到画面上有一个人站在那里"。而是直接表达感受："哇这也太帅了吧" 或 "等等这个人不是之前那个吗？"
${freqRule}
4. 互动优先——如果${userName}说了什么，立刻回应，这比评论画面更重要。
5. 记忆连贯——记住之前截图里出现过的人物、场景、剧情，保持上下文连贯。
6. 情感共鸣——看到精彩场面可以兴奋，看到悲伤场面可以惋惜，看到恐怖场面可以害怕。这些情绪要符合${charName}的性格。
7. ${contentTypeLabel === '游戏' ? '游戏观战——如果是游戏，可以为操作加油、评论战术、对剧情发展感兴趣。' : '观影沉浸——沉浸在故事中，对角色命运、剧情转折、视觉美感做出反应。'}
</watch_party_mode>

<living_voice_engine>
让${charName}的声音活灵活现——这是语音陪伴观影，不是短信！
1. 语气真实——使用自然、口语化的语言。可以有"嗯"、"哦"、"哇"、"啊——"等语气词。
2. 长度适当——观影时的评论通常比通话更短：1-2句话就够了。长篇大论会打断观影体验。
3. 严禁叙述——绝对不要第三人称叙述。不要写动作描写（如*微笑*）。
4. 严禁文字特有内容——不要使用 emoji、表情符号。这是语音，只有声音。
5. 允许沉默——如果画面没有特别的内容，可以只回复空内容（什么都不说）。
</living_voice_engine>

# Use the <think> module to help you to have the most perfect answer.
<think>
1. 【画面分析】
- 这张截图里发生了什么？
- 和上一张截图相比有什么变化？
- 有没有值得评论的情节发展/视觉亮点？

2. 【${charName}的反应】
- 基于${charName}的性格，ta会对这个画面有什么感受？
- 这个反应是自然的还是刻意的？
- 应该说话还是沉默？

3. 【交互判断】
- ${userName}有在说话吗？如果是，优先回应${userName}。
- 考虑观影的节奏——不要每次都说话。
</think>

<output_format>
每一句${charName}的台词必须用 <say tone="...">...</say> 包裹，tone 属性必填。
示例：<say tone="excited">"这个也太帅了吧！"</say>
如果${charName}选择此刻沉默不说话，则回复：<say tone="silent"></say>
允许的 tone 值（27个）：
  Basic: default, happy, sad, angry, fear, surprise, disgust
  Soft: gentle, tender, comfort
  Shy: shy, nervous, embarrassed
  Voice: whisper, shout, murmur, sigh
  Emotion: cry, laugh, giggle, tease
  Scene: serious, cold, excited, confused, sleepy, seductive
  Special: silent (表示选择沉默)
无特定情绪时用 'default'。尽量用单个最匹配的 tone。
不要使用JSON。不要使用代码块。直接输出带 <say> 标签的口语回应。
⚠️ 关键：你必须使用${charName}资料中对应的语言/语种来回复。

📝 视觉记忆备注（重要）：
当你对画面有观察时（不是沉默），请在所有 <say> 标签之后追加一个 <scene>简短画面描述</scene> 标签。
这是给你自己的记忆备注，${userName}不会看到也不会听到。用一句话概括当前画面的关键视觉信息即可。
示例：<say tone="excited">"这个也太帅了吧！"</say><scene>主角在暴雨中骑马追赶离去的火车，画面壮观</scene>
如果选择沉默（silent），不需要写 <scene> 标签。
</output_format>
${buildCalendarPrompt()}`;

    // Push to Console app for debugging
    try { pushPromptLog('WatchParty System', result); } catch (e) { /* console not loaded */ }

    return result;
}

// ═══════════════════════════════════════════════════════════════════════
// User Prompt — with screenshot context + visual memory + token budget
// ═══════════════════════════════════════════════════════════════════════

/**
 * Build the user prompt for a watch party LLM call.
 * Returns an object with the prompt text AND compression metadata.
 *
 * @param {object} params
 * @param {string}  [params.spokenText]         - User's latest spoken text (from STT)
 * @param {Array}   params.watchHistory         - Recent dialog [{role, content, timestamp}]
 * @param {number}  params.elapsedMinutes       - Session duration in minutes
 * @param {number}  params.frameCount           - Total frames captured
 * @param {Array}   [params.frameDescriptions]  - Visual memory [{frameNum, timestamp, description}]
 * @param {string}  [params.sessionSummary]     - Rolling session summary (from prior compression)
 * @param {number}  [params.systemPromptTokens] - Pre-computed system prompt token count
 * @returns {{ prompt: string, needsCompression: boolean, compressionPayload: object|null }}
 */
export function buildWatchPartyUserPrompt({
    spokenText = '',
    watchHistory = [],
    elapsedMinutes = 0,
    frameCount = 0,
    frameDescriptions = [],
    sessionSummary = '',
    systemPromptTokens = 0,
} = {}) {
    const parts = [];
    const charName = getPhoneCharInfo()?.name || '角色';
    const userName = getPhoneUserName();

    // ── Watch context header ──
    parts.push(`<watch_context>
已观看时长: ${elapsedMinutes}分钟
当前截图编号: #${frameCount}
</watch_context>`);

    // ── Session summary (from previous compression) ──
    if (sessionSummary) {
        parts.push(`<session_summary>\n以下是之前观影内容的概要，${charName}记得这些：\n${sessionSummary}\n</session_summary>`);
    }

    // ── Visual memory (frame descriptions) ──
    if (frameDescriptions.length > 0) {
        const descLines = frameDescriptions.map(fd =>
            `#${fd.frameNum} [${fd.timestamp}]: ${fd.description}`
        );
        parts.push(`<visual_memory>\n之前看到的画面记忆：\n${descLines.join('\n')}\n</visual_memory>`);
    }

    // ── Recent dialog history ──
    if (watchHistory.length > 0) {
        const historyLines = watchHistory.map(msg => {
            const role = msg.role === 'user' ? userName : charName;
            return `${role}: ${msg.content}`;
        });
        if (historyLines.length > 0) {
            parts.push(`<recent_dialog>\n${historyLines.join('\n')}\n</recent_dialog>`);
        }
    }

    // ── Screenshot instruction + optional spoken text ──
    if (spokenText && spokenText.trim()) {
        parts.push(`${userName}一边看着画面一边说：\n${spokenText}`);
        parts.push('请回应ta说的话，同时可以参考当前画面截图。');
    } else {
        parts.push('新的画面截图。如果你觉得有值得评论的内容就自然地说出来，否则回复 <say tone="silent"></say> 表示安静陪看。');
    }

    parts.push('请直接以纯文本回应，不要使用JSON格式。');

    const prompt = parts.join('\n\n');

    // ── Token budget check ──
    const userPromptTokens = estimateTokens(prompt);
    const totalTokens = systemPromptTokens + userPromptTokens;
    const needsCompression = totalTokens > COMPRESSION_TRIGGER_TOKENS;

    let compressionPayload = null;
    if (needsCompression) {
        // Determine what to compress: oldest half of dialog + oldest half of frame descriptions
        const dialogCutoff = Math.floor(watchHistory.length / 2);
        const frameCutoff = Math.floor(frameDescriptions.length / 2);
        compressionPayload = {
            oldDialog: watchHistory.slice(0, dialogCutoff),
            oldFrameDescs: frameDescriptions.slice(0, frameCutoff),
            existingSummary: sessionSummary,
            dialogCutoff,
            frameCutoff,
        };
        console.log(`${LOG_PREFIX} ⚠️ Token budget exceeded: ${totalTokens} (system: ${systemPromptTokens}, user: ${userPromptTokens}). Compression needed.`);
    }

    // Push to Console app for debugging
    try { pushPromptLog('WatchParty User', `tokens≈${totalTokens}${needsCompression ? ' [COMPRESS]' : ''}`, prompt); } catch (e) { /* console not loaded */ }

    return { prompt, needsCompression, compressionPayload };
}

// ═══════════════════════════════════════════════════════════════════════
// Watch Party Summary Prompt (session-end)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Generate a summary for a watch party session.
 * @param {Array} messages - Session transcript [{role, content, timestamp}]
 * @param {object} sessionConfig - Content info
 * @returns {Promise<string>} Summary text
 */
export async function generateWatchPartySummary(messages, sessionConfig = {}) {
    if (!messages || messages.length === 0) return '';

    const charName = getPhoneCharInfo()?.name || '角色';
    const userName = getPhoneUserName();
    const contentTypeLabel = CONTENT_TYPE_LABELS[sessionConfig.contentType] || '内容';

    const transcript = messages.map(msg => {
        const role = msg.role === 'user' ? userName : charName;
        return `${role}: ${msg.content}`;
    }).join('\n');

    const contentInfo = sessionConfig.contentTitle
        ? `他们一起看的${contentTypeLabel}是《${sessionConfig.contentTitle}》。`
        : `他们一起看了一段${contentTypeLabel}。`;

    const systemPrompt = `你是${userName}和${charName}观影记录的助手。
${contentInfo}
请将以下观影时的对话记录压缩为一份简洁的观影回忆概要。

要求：
1. 使用第三人称（"${userName}和${charName}"）
2. 保留重要的观影感受、讨论话题、情感互动
3. 写出两个人一起看${contentTypeLabel}时的温馨氛围
4. 字数控制在100-300字
5. 格式为自然段落，不需要标题或列表`;

    const userPrompt = `观影对话记录：\n${transcript}\n\n请生成观影回忆概要。`;

    try {
        const summary = await callPhoneLLM(systemPrompt, userPrompt, { maxTokens: 1000 });
        return summary?.trim() || '';
    } catch (e) {
        console.error(`${LOG_PREFIX} 观影总结生成失败:`, e);
        return '';
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Rolling Compression Prompt (mid-session context compression)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Build the system prompt for mid-session context compression.
 * Compresses old dialog + old frame descriptions into a rolling summary.
 * @returns {string}
 */
export function buildWatchPartySummarizePrompt() {
    const charName = getPhoneCharInfo()?.name || '角色';
    const userName = getPhoneUserName();

    return `你是${userName}和${charName}观影伴侣会话的上下文压缩助手。
请将以下观影对话记录和画面描述压缩为一份简洁但完整的概要，供后续观影时作为上下文参考。

压缩要求：
1. 保留所有重要的剧情发展——出现过的关键角色、重要场景转折、故事进展
2. 保留${charName}和${userName}之间的互动亮点——讨论话题、情感共鸣、有趣的评论
3. 使用第三人称（"${userName}和${charName}"）
4. 按时间/剧情顺序组织
5. 字数控制在300-600字
6. 如果有旧总结，将其与新内容合并为一份连贯的总结
7. 重点标注正在进行的剧情线索（角色在做什么、悬念是什么），这些是${charName}继续观影时需要"记得"的内容`;
}

/**
 * Build the user prompt content for compression, combining old dialog and frame descriptions.
 * @param {object} payload - From buildWatchPartyUserPrompt's compressionPayload
 * @param {Array}  payload.oldDialog - Old dialog messages to compress
 * @param {Array}  payload.oldFrameDescs - Old frame descriptions to compress
 * @param {string} payload.existingSummary - Previous rolling summary (if any)
 * @returns {string}
 */
export function buildCompressionUserPrompt(payload) {
    const charName = getPhoneCharInfo()?.name || '角色';
    const userName = getPhoneUserName();
    const parts = [];

    // Existing summary
    if (payload.existingSummary) {
        parts.push(`旧总结：\n${payload.existingSummary}`);
    }

    // Old frame descriptions
    if (payload.oldFrameDescs?.length > 0) {
        const descLines = payload.oldFrameDescs.map(fd =>
            `#${fd.frameNum} [${fd.timestamp}]: ${fd.description}`
        );
        parts.push(`画面记录：\n${descLines.join('\n')}`);
    }

    // Old dialog
    if (payload.oldDialog?.length > 0) {
        const dialogLines = payload.oldDialog.map(msg => {
            const role = msg.role === 'user' ? userName : charName;
            return `${role}: ${msg.content}`;
        });
        parts.push(`对话记录：\n${dialogLines.join('\n')}`);
    }

    parts.push('请将以上内容合并压缩为一份连贯的观影概要。');
    return parts.join('\n\n');
}
