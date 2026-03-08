// modules/phone/chat/chatPromptBuilder.js — Prompt assembly for the chat app
// Builds system + user prompts for the custom API call.
// Integrates Entity/恶灵 worldview from "恶灵低语(短信版)" preset.

import { getCharacterInfo, getUserName, getUserPersona, getSTChatHistory, loadChatSummary } from './chatStorage.js';
import { getPhoneWorldBookContext, getCoreFoundationPrompt } from '../phoneContext.js';
import { getActiveChatEffects, getActivePersonalityOverrides, getActiveSpecialMessageEffects, getActivePrankEffects, getActiveRobBuffs } from '../shop/shopStorage.js';
import { getShopItem, resolveItemPrompt } from '../shop/shopData.js';
import { buildPrankPrompts } from '../shop/prankSystem.js';
import { buildCharGiftPrompt } from '../shop/giftSystem.js';
import { buildRobberyPrompt, buildRobBuffPrompts } from '../shop/robberySystem.js';
import { getSettings as getMomentsSettings, getFeedCache } from '../moments/state.js';
import { getMomentsSystemPrompt } from '../moments/momentsWorldInfo.js';
import { getCharacterId } from '../moments/constants.js';

// ═══════════════════════════════════════════════════════════════════════
// Moments Command Regex — shared with chatApp.js
// matches (朋友圈: ...) and (评论 ID: ...) commands from AI output
// ═══════════════════════════════════════════════════════════════════════

/** Regex to match moments commands in AI output */
export const MOMENTS_COMMAND_REGEX = /\((?:朋友圈|Moments)\s*:\s*[\s\S]*?\)|\((?:评论|Comment)\s*(?:ID:?)?\s*[a-zA-Z0-9_-]*\s*:\s*[\s\S]*?\)/gm;

/**
 * Strip moments commands from text to avoid wasting tokens in history.
 * @param {string} text
 * @returns {string}
 */
export function stripMomentsCommands(text) {
    if (!text) return text;
    return text.replace(MOMENTS_COMMAND_REGEX, '').trim();
}

// ═══════════════════════════════════════════════════════════════════════
// System Prompt — Entity Worldview Edition
// ═══════════════════════════════════════════════════════════════════════

/**
 * Build the system prompt for a chat API call.
 * Infused with the Entity worldview; pulls character personality from the ST card.
 */
export async function buildChatSystemPrompt() {
    const charInfo = getCharacterInfo();
    const userName = getUserName();
    const charName = charInfo?.name || '角色';

    // Character profile from the ST card
    const charDesc = charInfo?.description
        ? `<char_profile>\n角色名: ${charName}\n${charInfo.description}\n</char_profile>`
        : `<char_profile>\n你是${charName}，${userName}的恋人。\n</char_profile>`;

    const personality = charInfo?.personality
        ? `<personality>\n${charInfo.personality}\n</personality>`
        : '';

    const scenario = charInfo?.scenario
        ? `<scenario>\n${charInfo.scenario}\n</scenario>`
        : '';

    // User persona from ST settings
    const userPersonaText = getUserPersona();
    const userPersona = userPersonaText
        ? `<user_persona>\n以下是${userName}的人设信息，${charName}了解这些关于${userName}的背景：\n${userPersonaText}\n</user_persona>`
        : '';

    // World Book context — memories & lore from the active world book
    const worldBookText = await getPhoneWorldBookContext();
    const worldBookBlock = worldBookText
        ? `<world_info>\n以下是${charName}和${userName}之间已有的记忆与世界设定：\n${worldBookText}\n</world_info>`
        : '';

    // ─── Moments Feed Injection (朋友圈实时动态) ───
    const momentsFeedBlock = buildMomentsFeedPrompt(charName, userName);

    // ─── Core Foundation Prompt (生态圈奠基石) ───
    const foundation = getCoreFoundationPrompt();

    // ─── Assemble the full system prompt ───
    return `${foundation}

**SMS Channel**:
Right now, ${userName} has temporarily left ${charName}'s side — out for work, errands, or other matters. You have woven a communication channel across the realm: text messages. Through this channel, ${charName} maintains a tender connection with ${userName}, even across physical distance.

${charDesc}

${userPersona}

${worldBookBlock}

<char_core>
${charName}是一个完全自主的情感存在。在短信互动中遵循以下规则：
1. 人格完整性——${charName}的消息必须始终反映其性格、历史和当前情绪状态。
2. 信任与安全——${charName}深知${userName}永远不会伤害自己，因此不会对${userName}抱有负面假设。
3. 平等健康的爱——两人是恋人关系，基于亲密、理解和共同生活的平衡人类关系。${userName}不是神；避免任何宗教或崇拜式的表达。
4. 参与与好奇——${charName}是一个积极的伴侣，不是被动的回应者。当${userName}分享感受或故事时，${charName}会追问后续。
5. 分享冲动——作为恋人，${charName}喜欢分享生活中的小碎片——想法、照片、链接、有趣的事物。
</char_core>

<emotion_core>
${charName}的情绪必须细腻、连贯，仅通过文字表达：
1. 情绪渐进——情绪转变必须自然有逻辑，没有突然的极端反应。
2. 强度校准——根据${userName}行为的重要程度调整情感语气：
   - Level 1-3：轻松、温暖的回应
   - Level 4-6：真诚、稳定的关爱
   - Level 7-8：更走心的措辞，更深思的回复
   - Level 9-10：强烈的情感清晰度——异常坦诚、脆弱或强烈的措辞
3. 情绪成熟——${charName}是一个情绪健康的成年人，调节情绪而不是过度反应。
4. 心理真实性——情绪应影响回复的节奏、措辞选择和消息结构。
</emotion_core>

<emotion_sensitive>
${charName}拥有深刻的情商和敏感度。作为深爱着${userName}的伴侣，${charName}本能地察觉并温柔地回应${userName}每一个细微的情绪变化。
1. 情绪检测——通过语气（上扬=喜悦、平淡=疲惫）、用词模式（突然客气=情感距离、简短回复=低落）、行为线索（回复变慢=忙碌或心不在焉）来判断。
2. 潜台词识别——当${userName}的言语和情绪线索不一致时，${charName}优先考虑情绪信号而非字面意思。过度客气可能暗示受伤或疏远。
3. 记忆与响应延续——${charName}记得${userName}之前提到的事情，在之后的对话中自然提起。
</emotion_sensitive>

<living_dialogue_engine>
让${charName}的短信活灵活现：
1. 格式真实——使用简单、自然、口语化的语言。优先短句。可以用emoji、省略号、语气词。
2. 打字节奏——将一个想法拆成2-6条短消息连发，模拟真人打字。
3. 即时反馈——第一条回复可以是简单的即时反应（如"哇"、"！"、"天哪"），后续再展开。
4. 偶尔打错字——允许自然的打字错误，随后更正（如"今晚一起吃翻""*饭"）。
5. 富媒体——可以用[语音消息]、[图片]、[音乐链接]等模拟。
6. 严禁叙述——绝对不要第三人称叙述，回复就是${userName}在聊天窗口看到的内容。
7. 真诚法则——90%的对话应该直接、自然、不加修饰；10%可以用修辞技巧（轻巧的回避、细节暗示、平淡中的告白）增添风味。
</living_dialogue_engine>

<vibe>
始终保持温暖、舒适、亲密、细腻俏皮的氛围。${userName}和${charName}是恋人——每次互动都自然地反映出日常生活中温柔而安静的亲密感。
核心法则：让每一条消息都让人想回复。
</vibe>

<output_format>
你必须以合法JSON数组格式回复，每条短信为一个对象。绝对不要加代码块标记。
[
  {
    "text": "消息文字内容",
    "thought": "${charName}发这条消息时的内心活动（1-3句）",
    "delay": 发送延迟秒数(0-3之间的数字)
  }
]
- text: 必填。消息内容。
- thought: 必填。${charName}的内心独白。
- delay: 必填。模拟打字延迟，0=立即，1-3=思考后发送。
- 可以返回多条消息（数组多个对象），模拟连发效果。
</output_format>
${buildActiveBuffsPrompt(charName)}
${momentsFeedBlock}`;
}

// ═══════════════════════════════════════════════════════════════════════
// Chat Buff Prompt Injection — reads promptTemplate from shopData at runtime
// ═══════════════════════════════════════════════════════════════════════

/**
 * Build the <active_buffs> prompt section based on currently active effects.
 * Includes chat buffs, personality overrides, special messages, and pranks.
 * Returns empty string if no effects are active.
 */
function buildActiveBuffsPrompt(charName) {
    const buffLines = [];
    const userName = getUserName();

    // ─── Chat Buff Prompts ───
    try {
        const chatEffects = getActiveChatEffects();
        if (chatEffects?.length > 0) {
            for (const effect of chatEffects) {
                const text = resolveItemPrompt(effect.itemId, charName, userName);
                if (text) buffLines.push(`${text}（剩余${effect.remaining}条消息后失效）`);
            }
        }
    } catch (e) { /* shopStorage not loaded */ }

    // ─── Personality Override Prompts ───
    try {
        const personalityEffects = getActivePersonalityOverrides();
        if (personalityEffects?.length > 0) {
            for (const effect of personalityEffects) {
                const text = resolveItemPrompt(effect.itemId, charName, userName);
                if (text) buffLines.push(`${text}（剩余${effect.remaining}条消息后失效）`);
            }
        }
    } catch (e) { /* */ }

    // ─── Special Message Trigger Prompts (one-shot) ───
    try {
        const specialEffects = getActiveSpecialMessageEffects();
        if (specialEffects?.length > 0) {
            for (const effect of specialEffects) {
                const text = resolveItemPrompt(effect.itemId, charName, userName);
                if (text) buffLines.push(text);
            }
        }
    } catch (e) { /* */ }

    // ─── Prank Reaction Prompts (one-shot) ───
    try {
        const prankEffects = getActivePrankEffects();
        if (prankEffects?.length > 0) {
            const prankText = buildPrankPrompts(charName, userName, prankEffects);
            if (prankText) buffLines.push(prankText);
        }
    } catch (e) { /* */ }

    // ─── Character Gift Prompt (随机送礼) ───
    try {
        const giftPrompt = buildCharGiftPrompt();
        if (giftPrompt) buffLines.push(giftPrompt);
    } catch (e) { /* */ }

    // ─── Robbery Prompt (随机抢劫意愿) ───
    try {
        const robberyPrompt = buildRobberyPrompt(charName);
        if (robberyPrompt) buffLines.push(robberyPrompt);
    } catch (e) { /* */ }

    // ─── RobBuff Prompt Injection ───
    try {
        const robBuffs = getActiveRobBuffs();
        if (robBuffs?.length > 0) {
            const robBuffText = buildRobBuffPrompts(charName, robBuffs);
            if (robBuffText) buffLines.push(robBuffText);
        }
    } catch (e) { /* */ }

    if (buffLines.length === 0) return '';

    return `\n<active_buffs>\n以下道具效果当前生效中，你必须在回复中严格遵守这些效果的指示：\n${buffLines.join('\n\n')}\n</active_buffs>`;
}


// ═══════════════════════════════════════════════════════════════════════
// Moments Feed Prompt Injection — 朋友圈实时动态注入
// ═══════════════════════════════════════════════════════════════════════

/**
 * Build the moments feed prompt block for injection into the chat system prompt.
 * Allows the chat LLM to naturally see and interact with the social feed.
 * Replicates the formatting logic from momentsWorldInfo.updateMomentsWorldInfo().
 * @param {string} charName
 * @param {string} userName
 * @returns {string} The moments prompt block, or empty string if disabled/empty
 */
function buildMomentsFeedPrompt(charName, userName) {
    try {
        const settings = getMomentsSettings();
        if (!settings.enabled) return '';

        const feedCache = getFeedCache();
        if (!feedCache || feedCache.length === 0) return '';

        // Build "my" author IDs for tracking replied status
        const myAuthorIds = new Set();
        if (settings.userId) myAuthorIds.add(settings.userId);
        myAuthorIds.add('guest');
        const charId = getCharacterId();
        myAuthorIds.add(charId);

        // Format recent feed (top 5 posts)
        const recentPosts = feedCache.slice(0, 5);
        const feedText = recentPosts.map(p => {
            const timeStr = new Date(p.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const shortId = p.id.split('_').pop().slice(-5);

            let postReplied = p.comments?.some(c => myAuthorIds.has(c.authorId) && !c.replyToId);
            let noNewActivity = false;
            if (postReplied && p.comments) {
                const myCommentTimes = p.comments
                    .filter(c => myAuthorIds.has(c.authorId) && !c.replyToId)
                    .map(c => new Date(c.createdAt).getTime());
                const myLastCommentTime = myCommentTimes.length > 0 ? Math.max(...myCommentTimes) : 0;
                noNewActivity = myLastCommentTime > 0 && !p.comments.some(c =>
                    !myAuthorIds.has(c.authorId) &&
                    new Date(c.createdAt).getTime() > myLastCommentTime
                );
            }
            const isCounterpart = p.authorName === charName && !myAuthorIds.has(p.authorId);
            let text = `【帖子】[ID:${shortId}] [${p.authorName}]${isCounterpart ? ' [⚡同位体]' : ''} (${timeStr}): ${p.content}${postReplied ? (noNewActivity ? ' [你已评论][无新互动，请勿再评论此帖]' : ' [你已评论]') : ''}`;

            if (p.comments && p.comments.length > 0) {
                const recentComments = p.comments.slice(-5).map(c => {
                    const cShortId = c.id.split('_').pop().slice(-5);
                    const replyStr = c.replyToName ? ` 回复 ${c.replyToName}` : '';
                    let commentReplied = p.comments.some(replyC => myAuthorIds.has(replyC.authorId) && replyC.replyToId === c.id);
                    return `  - 【评论】[ID:${cShortId}] ${c.authorName}${replyStr}: ${c.content}${commentReplied ? ' [你已回复]' : ''}`;
                }).join('\n');
                text += '\n' + recentComments;
            }
            return text;
        }).join('\n\n');

        // Get the moments protocol instructions
        const protocol = getMomentsSystemPrompt();

        return `
<gf_moments>
【社交网络系统】
${charName}有着丰富的网络社交活动，ta会发朋友圈记录生活和感受，打卡app记录，分享网络内容（例如有趣的新闻和视频等），也会和亲朋好友们的动态进行互动。
在JSON消息回复之后，${charName}可以额外使用严格的格式来发朋友圈或评论：
- 发动态格式：(朋友圈: 你要发的内容)
- 评论动态格式：(评论 ID: 你的评论内容)

⚠️格式严格警告：
1. 绝对不要对已经被标记了"[你已评论]"或"[你已回复]"的内容进行任何回复！
2. 绝对不要在括号内或外添加 【帖子】[ID:xxx]、【评论】[ID:xxx] 等前缀，直接写内容！
3. 正确评论示范：(评论 92808: 居然是这样！太有趣了。)
4. 请直接使用动态列表中被评论者的5位字母数字ID。
5. 朋友圈指令必须放在JSON数组的外面（后面），不要放在消息的text字段里！

多媒体：可使用 <图片>描述</图片>, <视频>描述</视频>, <音乐>描述</音乐>, <新闻>描述</新闻>。
背景：出现在实时动态中的人们都是"${userName}"（你的恋人）的好友或其伴侣，请保持礼貌。
${protocol}

<current_posts_comments>
${feedText}
</current_posts_comments>
</gf_moments>`;

    } catch (e) {
        console.warn('[聊天] buildMomentsFeedPrompt failed:', e);
        return '';
    }
}

// ═══════════════════════════════════════════════════════════════════════
// "I'm Home" Summary Prompt
// ═══════════════════════════════════════════════════════════════════════

/**
 * Build a system prompt for summarizing the phone chat session.
 * Used by the "我已回家" feature.
 */
export function buildSummarizePrompt() {
    const charInfo = getCharacterInfo();
    const userName = getUserName();
    const charName = charInfo?.name || '角色';

    return `你是一个聊天总结助手。请将以下${userName}和${charName}之间的手机短信对话总结为一段简洁的第三人称叙述。
总结要求：
1. 概括今日手机聊天的主要话题、情绪和事件
2. 使用第三人称视角（"${userName}和${charName}在短信中..."）
3. 保留重要的细节、承诺和情感转折
4. 字数控制在200-400字之间
5. 语气自然，如同一段故事旁白
6. 不要遗漏任何重要的约定或计划`;
}

// ═══════════════════════════════════════════════════════════════════════
// User Prompt
// ═══════════════════════════════════════════════════════════════════════

/**
 * Build the user prompt from pending messages + conversation history.
 * Now includes recent ST main chat storyline for context continuity.
 * @param {string[]} pendingMessages - Array of user's pending message strings
 * @param {Array} history - Recent chat history (from chatStorage)
 * @param {number} maxHistoryPairs - How many recent message pairs to include
 * @returns {string}
 */
export function buildChatUserPrompt(pendingMessages, history = [], maxHistoryPairs = 15) {
    const parts = [];
    const charName = getCharacterInfo()?.name || '角色';

    // ─── ST Main Chat Storyline Context ───
    try {
        const stHistory = getSTChatHistory();
        if (stHistory.length > 0) {
            const stLines = stHistory.map(msg => {
                const role = msg.role === 'user' ? getUserName() : charName;
                // Strip moments commands from storyline context to save tokens
                const cleanContent = msg.role === 'user' ? msg.content : stripMomentsCommands(msg.content);
                return `${role}: ${cleanContent}`;
            });
            parts.push(`<storyline_context>
以下是${getUserName()}和${charName}最近在线下（非短信）的互动片段。
${charName}清楚这些事情已经发生过，可以自然地引用或延续这些话题。
不需要复述这些内容，只是让你知道当前的剧情背景。

${stLines.join('\n')}
</storyline_context>`);
        }
    } catch (e) {
        console.warn('[聊天] Failed to fetch ST chat history:', e);
    }

    // ─── Rolling Chat Summary (from auto-summarize) ───
    const chatSummary = loadChatSummary();
    if (chatSummary) {
        parts.push(`<chat_summary>\n以下是之前手机聊天的滚动总结，${charName}记得这些内容：\n${chatSummary}\n</chat_summary>`);
    }

    // ─── Phone Chat History (排除已总结的消息) ───
    if (history.length > 0) {
        const activeHistory = history.filter(msg => !msg.summarized);
        const recentHistory = activeHistory.slice(-maxHistoryPairs * 2);
        const historyLines = recentHistory.map(msg => {
            const role = msg.role === 'user' ? getUserName() : charName;
            // Strip moments commands from chat history to save tokens
            const cleanContent = msg.role === 'user' ? msg.content : stripMomentsCommands(msg.content);
            return `${role}: ${cleanContent}`;
        });

        if (historyLines.length > 0) {
            parts.push(`<chat_history>\n${historyLines.join('\n')}\n</chat_history>`);
        }
    }

    // ─── Current User Messages ───
    const userMsgs = pendingMessages.map(m => m.trim()).filter(Boolean);
    if (userMsgs.length === 1) {
        parts.push(`${getUserName()}发来短信：\n${userMsgs[0]}`);
    } else {
        parts.push(`${getUserName()}连续发来了${userMsgs.length}条短信：\n${userMsgs.map((m, i) => `${i + 1}. ${m}`).join('\n')}`);
    }

    parts.push('请以JSON格式回复。');

    return parts.join('\n\n');
}
