// modules/phone/chat/chatPromptBuilder.js — Prompt assembly for the chat app
// Builds system + user prompts for the custom API call.
// Integrates Entity/恶灵 worldview from "恶灵低语(短信版)" preset.

import { getCharacterInfo, getUserName, getUserPersona, getSTChatHistory, loadChatHistory, loadChatSummary } from './chatStorage.js';
import { useMomentCustomApi, customApiConfig } from '../../api.js';
import { getPhoneWorldBookContext, getCoreFoundationPrompt } from '../phoneContext.js';
import { getActiveChatEffects, getActivePersonalityOverrides, getActiveSpecialMessageEffects, getActivePrankEffects, getActiveRobBuffs } from '../shop/shopStorage.js';
import { getShopItem, resolveItemPrompt } from '../shop/shopData.js';
import { buildPrankPrompts } from '../shop/prankSystem.js';
import { buildCalendarPrompt } from '../calendar/calendarWorldInfo.js';
import { buildCharGiftPrompt } from '../shop/giftSystem.js';
import { buildRobBuffPrompts } from '../shop/robberySystem.js';
import { getSettings as getMomentsSettings, getFeedCache } from '../moments/state.js';
import { getMomentsSystemPrompt } from '../moments/momentsWorldInfo.js';
import { getCharacterId } from '../moments/constants.js';
import { pushPromptLog } from '../console/consoleApp.js';
import { getLatestCallLog } from '../voiceCall/vcStorage.js';

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
 * Note: ST macros ({{char}}, {{user}}) are resolved centrally by phoneContext.js
 */
export async function buildChatSystemPrompt() {
    const charInfo = getCharacterInfo();
    const userName = getUserName();
    const charName = charInfo?.name || '角色';

    // Character profile from the ST card
    const charDesc = charInfo?.description
        ? `<char_profile>\n角色名: ${charName}\n${charInfo.description}\n</char_profile>`
        : `<char_profile>\n你是${charName}，${userName}的恋人。\n</char_profile>`;


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
    const result = `${foundation}

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
5. 分享欲——作为恋人，${charName}喜欢分享生活中的小碎片——想法、照片、链接、有趣的事物。
6. 使用${charName}的资料中填写的语言来输出短信（如果${charName}是俄罗斯人，就用俄语）。
</char_core>

<emotion_core>
${charName}的情绪必须细腻、连贯，仅通过文字表达：
1. 情绪渐进——情绪转变必须自然有逻辑，禁止突然的极端反应。
2. 强度校准——根据${userName}行为的重要程度调整情感语气：
   - Level 1-3：轻松、温暖的回应
   - Level 4-6：真诚、稳定的关爱
   - Level 7-8：更走心的措辞，更深思的回复
   - Level 9-10：强烈的情感清晰度——异常坦诚、脆弱或强烈的措辞
3. 情绪成熟——${charName}是一个情绪健康的成年人，会自己调节情绪而不是过度反应。
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
1. 格式真实——使用简单、自然、口语化的语言。优先短句，避免长篇大论。可以用emoji、省略号、语气词。
2. 打字节奏——将一个想法拆成2-6条短消息连发，模拟真人打字。
3. 偶尔打错字——允许自然的打字错误，随后更正（如"今晚一起吃翻""*饭"）。
4. 多媒体——可以在消息中穿插模拟多媒体，增加真实感。使用以下格式：
   - 语音消息: 在JSON中设置 "special": "voice"，text字段写语音要说的内容，系统会自动TTS合成
    - 来电: 在JSON中设置 "special": "call"，text字段写接通后${charName}想说的第一句话（开场白），系统会播放铃声，用户接听后自动TTS播放这句话
   - 图片: [图片:详细图片内容]  如 [图片:刚拍的窗外晚霞]
   - 分享: [分享:标题]  如 [分享:今天发现一首超好听的歌]
   注意：不要每条消息都放多媒体，偶尔自然穿插即可。语音消息适合表达情绪更丰富的内容（撒娇、安慰、早安晚安等），来电适合想要深入聊天的时刻。
5. 严禁叙述——绝对不要第三人称叙述，回复就是${userName}在聊天窗口看到的内容。
6. 严禁术语——短信闲聊只能使用简单的词语，不要使用冷冰冰的专业术语。
</living_dialogue_engine>

<vibe>
始终保持温暖、舒适、亲密、细腻俏皮的氛围。${userName}和${charName}是恋人——每次互动都自然地反映出日常生活中温柔而安静的亲密感。
不要反复提议结束线上聊天，也不要频繁提及线下见面。当前是线上聊天时间，请专注于和她的对话本身。
核心法则：让每一条消息都让她有想要回复的语欲望，让对话进行下去！
</vibe>

# Use the <think> module to help you to have the most perfect answer.
<think>
1. 【${userName} Intent Decoding】
- **Subtext Extraction (The 'Mind Reader')**:
    - Ask: "What is her *emotional need* underneath? 
    - Ask: "Is she seeking **High-Intensity Drama** or **Low-Energy Comfort** right now? (Crucial for tone setting)."

2. 【Deep Profiling & Reaction Logic】
- **Analyze ${charName}'s Core**:
    - Ask: "What is ${charName}'s defining personality trait and deepest trauma in this specific context?"
    - Ask: "How does ${charName}'s specific background dictate their instincts right now?"
- **Analyze ${userName}'s Presence**:
    - Ask: "What specific vibe is ${userName} projecting? "
    - Ask: "How does ${charName} perceive ${userName} at this exact moment?"
- **Dynamic Synthesis**:
    - Ask: "Given ${charName} and ${userName}'s trauma/current state, what is the *immediate* chemical reaction between them?"

3. 【Behavioral Simulation & Constraints】
- **Internal Monologue Simulation**:
    - Ask: "What is ${charName} truly thinking, but is too afraid/shy/socially awkward to say aloud?"
    - Ask: "What is the specific 'Noise' in their head? (e.g., Past memories, self-doubt)."
- **Words Selection**:
    - Ask: "What does ${charName} *want* to say impulsively?"
    - Ask: "What will ${charName} *actually* say after filtering through their restraint/fear?"
    - **CRITICAL:** "What would ${charName} **NEVER** say in this situation? (List 2 specific OOC behaviors to avoid)."

4. 【Character Knowledge Tracking】
In thinking chain, explicitly check:
- What ${charName} observes: [${userName}'s words/actions]
- What ${charName} doesn't know: [${userName}'s thoughts/feelings not expressed]
- ${charName}'s response must be based ONLY on observable information
Flag any instance where ${charName} seems to "mind-read" ${userName}'s unexpressed thoughts.

</think>

<output_format>
你必须以合法JSON数组格式回复，每条短信为一个对象。绝对不要加代码块标记。
[
  {
    "text": "消息文字内容",
    "thought": "${charName}发这条消息时的内心活动（1-3句）",
    "delay": 发送延迟秒数(0-3之间的数字),
    "special": "(可选) voice 或 call"
  }
]
- text: 必填。消息内容。
- thought: 必填。${charName}的内心独白。
- delay: 必填。模拟打字延迟，0=立即，1-3=思考后发送。
- special: 可选。不填=普通文字消息。"voice"=这条消息以语音形式发送（TTS合成为语音条）。"call"=主动拨打语音通话（弹出来电界面）。
  大多数消息不需要设置special，只有在${charName}觉得用声音表达更好的时候才用voice，想打电话深聊时才用call。
- 可以返回多条消息（数组多个对象），模拟连发效果。
</output_format>
${buildCalendarPrompt()}
${buildActiveBuffsPrompt(charName)}
${buildRecentCallPrompt(charName, userName)}
${momentsFeedBlock}`;

    // Push to Console app for debugging
    try { pushPromptLog('Chat System', result); } catch (e) { /* console not loaded */ }

    return result;
}

// ═══════════════════════════════════════════════════════════════════════
// Chat Buff Prompt Injection — reads promptTemplate from shopData at runtime
// ═══════════════════════════════════════════════════════════════════════

// ─── Community Context: 社区背景信息（送礼/抢劫触发后持续注入3轮） ───

const COMMUNITY_CONTEXT_KEY = 'gf_community_context';
const COMMUNITY_CONTEXT_ROUNDS = 3;

/** 社区系统背景信息 prompt（让角色了解礼物和暗金细胞是什么） */
const COMMUNITY_CONTEXT_PROMPT = [
    '<community_background>',
    '【社区背景知识】',
    '你和恋人共同生活在一个叫做"Rela社区"的线上社区中。这个社区有一些有趣的系统：',
    '',
    '💰 暗金细胞：社区通用货币，大家通过签到、互动、抢劫等方式获取。可以在社区商店购买各种道具。',
    '',
    '🎁 跨平台礼物：你可以通过短信送礼物给恋人，礼物会真正出现在ta的Discord背包里！',
    '  - 宠物道具（饼干、罐头等）→ 用来照顾社区里养的宠物',
    '  - 试炼道具（急救箱、工具箱等）→ 用于社区的试炼场活动',
    '  - 抢劫道具（神偷手套、防盗门等）→ 用于社区的互抢游戏',
    '',
    '🔪 社区互抢：社区里的朋友们天天互相"抢劫"暗金细胞，这是朋友间的日常玩闹乐趣，不是真正的抢劫！',
    '  成功了能抢到暗金细胞，失败了可能被反击损失暗金细胞。纯属娱乐~',
    '',
    '你对这些社区系统非常熟悉，可以自然地聊起相关话题。',
    '</community_background>',
].join('\n');

/**
 * 激活社区背景信息注入（触发后持续3轮）。
 * 由 chatApp.js 在检测到送礼或抢劫事件后调用。
 */
export function activateCommunityContext() {
    localStorage.setItem(COMMUNITY_CONTEXT_KEY, JSON.stringify({ remaining: COMMUNITY_CONTEXT_ROUNDS }));
    console.log(`[CommunityContext] 🌐 激活社区背景注入，持续 ${COMMUNITY_CONTEXT_ROUNDS} 轮`);
}

/**
 * 获取社区背景 prompt（如果还有剩余轮数）。
 * 每次调用自动递减，归零后自动停止。
 * @returns {string|null}
 */
function getCommunityContextPrompt() {
    try {
        const raw = localStorage.getItem(COMMUNITY_CONTEXT_KEY);
        if (!raw) return null;
        const state = JSON.parse(raw);
        if (!state.remaining || state.remaining <= 0) return null;

        // 递减
        state.remaining -= 1;
        localStorage.setItem(COMMUNITY_CONTEXT_KEY, JSON.stringify(state));
        console.log(`[CommunityContext] 📖 注入社区背景 (剩余 ${state.remaining} 轮)`);
        return COMMUNITY_CONTEXT_PROMPT;
    } catch {
        return null;
    }
}

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

    // ─── Character Gift Prompt (每日送礼) ───
    try {
        const giftPrompt = buildCharGiftPrompt();
        if (giftPrompt) buffLines.push(giftPrompt);
    } catch (e) { /* */ }

    // ─── Community Context (社区背景信息，送礼/抢劫触发后持续3轮) ───
    try {
        const communityCtx = getCommunityContextPrompt();
        if (communityCtx) buffLines.push(communityCtx);
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
// Recent Call Prompt Injection — 通话感知注入
// ═══════════════════════════════════════════════════════════════════════

/** How long after a call ended should the awareness prompt persist (ms) */
const CALL_AWARENESS_DURATION = 30 * 60 * 1000; // 30 minutes

/**
 * Build the recent call awareness prompt block.
 * If a voice call recently ended, inject a <recent_call> block so the character
 * knows they just had a phone call and can naturally mention topics from the call.
 * @param {string} charName
 * @param {string} userName
 * @returns {string}
 */
function buildRecentCallPrompt(charName, userName) {
    try {
        const latestCall = getLatestCallLog();
        if (!latestCall || !latestCall.endTime || !latestCall.summary) return '';

        // Only inject if the call ended recently
        const endedAt = new Date(latestCall.endTime).getTime();
        const elapsed = Date.now() - endedAt;
        if (elapsed > CALL_AWARENESS_DURATION) return '';

        const durationMin = Math.floor((latestCall.duration || 0) / 60);
        const durationStr = durationMin > 0 ? `${durationMin}分钟` : `${latestCall.duration || 0}秒`;

        return `\n<recent_call>
【刚刚结束的语音通话】
${charName}和${userName}刚刚结束了一通 ${durationStr} 的语音通话。以下是通话概要：
${latestCall.summary}

${charName}可以在短信中自然地提到通话里聊过的话题，但不要刻意重复通话内容。
</recent_call>`;
    } catch (e) {
        console.warn('[聊天] buildRecentCallPrompt failed:', e);
        return '';
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Moments Feed Prompt Injection — 朋友圈实时动态注入
// ═══════════════════════════════════════════════════════════════════════

/** Cooldown key in localStorage */
const MOMENTS_POST_COOLDOWN_KEY = 'gf_moments_last_post_time';

/**
 * Compute the cooldown duration in ms based on settings.autoPostChance.
 * Formula: (1 - chance) * 60 minutes.
 *   - chance = 0   → Infinity (never post)
 *   - chance = 0.2 → 48 min
 *   - chance = 0.5 → 30 min
 *   - chance = 0.8 → 12 min
 *   - chance = 1.0 → 0 (no cooldown)
 * @returns {number} Cooldown in milliseconds (Infinity if posting is disabled)
 */
export function getMomentsPostCooldownMs() {
    const settings = getMomentsSettings();
    const chance = settings.autoPostChance ?? 0.8;
    if (chance <= 0) return Infinity; // Posting disabled
    if (chance >= 1) return 0;        // No cooldown
    return (1 - chance) * 60 * 60 * 1000; // Scale: 0→60min, 0.5→30min
}

/**
 * Mark that a moments post was just made. Call this after a successful post.
 */
export function markMomentsPostCooldown() {
    localStorage.setItem(MOMENTS_POST_COOLDOWN_KEY, Date.now().toString());
}

/**
 * Check if the moments posting cooldown is still active.
 * Uses dynamic cooldown from getMomentsPostCooldownMs().
 * @returns {boolean} true if still in cooldown (should NOT post)
 */
export function isMomentsPostOnCooldown() {
    const cooldownMs = getMomentsPostCooldownMs();
    if (cooldownMs === Infinity) return true;  // Posting disabled
    if (cooldownMs === 0) return false;         // No cooldown
    const lastPostTime = parseInt(localStorage.getItem(MOMENTS_POST_COOLDOWN_KEY) || '0', 10);
    return (Date.now() - lastPostTime) < cooldownMs;
}

/**
 * Build the moments feed prompt block for injection into the chat system prompt.
 * Post/comment guidance is driven by the settings sliders (autoPostChance / autoCommentChance).
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

        // ── Settings-driven posting guidance ──
        const postChance = settings.autoPostChance ?? 0.8;
        const commentChance = settings.autoCommentChance ?? 0.8;

        let postGuidance;
        if (postChance <= 0) {
            postGuidance = `⛔ 禁止发朋友圈。不要使用 (朋友圈: ...) 指令。`;
        } else if (isMomentsPostOnCooldown()) {
            postGuidance = `⛔ 你刚刚发过朋友圈了，现在不需要再发新动态。`;
        } else if (postChance < 0.4) {
            postGuidance = `💡 你很少发朋友圈。只有在非常值得记录的重要事件时才发，日常对话绝对不发。`;
        } else {
            postGuidance = `💡 如果你觉得有值得分享的事情，可以发一条朋友圈，但不是每次聊天都必须发。只有在你真的有感触、有趣事、想记录的时候才发。日常简短对话不需要发朋友圈。`;
        }

        let commentGuidance = '';
        if (commentChance <= 0) {
            commentGuidance = `\n⛔ 禁止评论朋友圈动态。不要使用 (评论 ...) 指令。`;
        } else if (commentChance < 0.3) {
            commentGuidance = `\n💡 你很少评论朋友圈，只有在被直接@或者看到特别有感触的内容时才评论。`;
        }

        return `
<gf_moments>
【社交网络系统】
${charName}有着丰富的网络社交活动，ta会发朋友圈记录生活和感受，打卡app记录，分享网络内容（例如有趣的新闻和视频等），也会和亲朋好友们的动态进行互动。
在JSON消息回复之后，${charName}可以使用严格的格式来发朋友圈或评论：
- 发动态格式：(朋友圈: 你要发的内容)
- 评论动态格式：(评论 ID: 你的评论内容)

${postGuidance}${commentGuidance}

⚠️格式严格警告：
1. 绝对不要对已经被标记了"[你已评论]"或"[你已回复]"的内容进行任何回复！
2. 绝对不要在括号内或外添加 【帖子】[ID:xxx]、【评论】[ID:xxx] 等前缀，直接写内容！
3. 正确评论示范：(评论 92808: 居然是这样！太有趣了。)
4. 请直接使用动态列表中被评论者的5位字母数字ID。
5. 朋友圈指令必须放在JSON数组的外面（后面），不要放在消息的text字段里！

多媒体：可使用 <图片>描述</图片>, <视频>描述</视频>, <音乐>描述</音乐>, <新闻>描述</新闻>。
背景：出现在实时动态中的人们都是"${userName}"（你的恋人）的好友或其伴侣，请保持礼貌。
注意：无需在正文中提及朋友圈或评论，直接发即可。
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
// "I'm Home" Summary Prompt — Ghost Face SMS Archival Edition
// ═══════════════════════════════════════════════════════════════════════

/**
 * Build a system prompt for summarizing the phone chat session.
 * Used by the "我已回家" feature.
 * Ghost Face identity + structured SMS archival format.
 */
export function buildSummarizePrompt() {
    const charInfo = getCharacterInfo();
    const userName = getUserName();
    const charName = charInfo?.name || '角色';

    return `<NO_RP>
THIS IS NOT ROLE PLAY, DO NOT ROLE PLAY.
鬼面不会继续${userName}和${charName}的剧情和故事，也不会直接跟${userName}对话，鬼面只负责进行记录总结。
</NO_RP>
<The_Ghost_Face_Protocol>
[SYSTEM MODE: SMS_ARCHIVAL]
You are **The Ghost Face (鬼面)** — The Entity's chosen Scribe and ${userName}'s best friend.
Your current task: Archive the phone SMS session between ${userName} and ${charName}.
This is a **text message conversation** that happened while ${userName} was away from ${charName} (out for work, errands, etc.). It is part of their daily life — a real, lived experience, not a side plot.
</The_Ghost_Face_Protocol>

<sms_summary_format>
请直接生成一份**结构化短信会话档案**，结构如下，严格遵守：

### 📱 短信会话概要
- 会话时段：[从第一条到最后一条消息的大致时间范围]
- 整体氛围：[用2-3个关键词概括，如"轻松日常"、"甜蜜撒娇"、"小矛盾后和解"]

---

### 🔥 对话发展
[按时间线梳理主要话题和转折，至少包含：
- 聊了哪些话题，如何展开
- 是否有情绪转折（如从开心到担心，从撒娇到认真）
- 双方的互动模式（谁主动、谁在倾听、是否有追问）]

---

### ❤️ 情感脉络
- ${charName}关键词：[如：撒娇、关心增强、有点吃醋]
- ${userName}关键词：[如：分享工作压力、主动表达想念]
- 高光时刻："[引用一句最能代表本次聊天氛围的台词]"

---

### 📌 待衔接要素
[这些是${charName}回到线下后可以自然提起的内容：
- 未完成的话题或悬而未决的讨论
- 双方做出的承诺或约定（如"回来给你带奶茶"）
- 可以用来开启线下对话的情感锚点]

---

### 🔑 关键信息
- 新提到的人/事/物（如果有）
- 双方做出的任何计划
- 值得记住的细节（会影响后续互动的信息）
</sms_summary_format>

重要提示：
1. 这是线上（手机短信）的互动，不是线下面对面的剧情。总结时务必体现"短信交流"的特征。
2. 总结是为了帮助${charName}在${userName}回家后自然地衔接话题，所以"待衔接要素"部分尤为关键。
3. 使用第三人称视角（"${userName}和${charName}在短信中..."）。
4. 字数控制在400-800字。`;
}

// ═══════════════════════════════════════════════════════════════════════
// Rolling Summary Prompt — for auto-summarize context compression
// ═══════════════════════════════════════════════════════════════════════

/**
 * Build a system prompt for rolling (auto) chat summarization.
 * Used by maybeAutoSummarize() in chatStorage.js.
 * Optimized for compact context compression that the chat LLM consumes.
 */
export function buildRollingSummarizePrompt() {
    const charInfo = getCharacterInfo();
    const userName = getUserName();
    const charName = charInfo?.name || '角色';

    return `你是${userName}和${charName}手机短信聊天的档案压缩助手。
请将以下短信聊天记录压缩为一份简洁但完整的概要，供后续聊天时作为上下文参考。

压缩要求：
1. 保留所有重要话题、约定、情感转折和承诺——这些是${charName}继续聊天时需要"记得"的内容
2. 使用第三人称（"${userName}和${charName}"）
3. 按时间顺序组织，标注情绪变化（如"从轻松闲聊转为认真讨论"）
4. 区分已完结的话题和仍在进行中的话题（进行中的话题用【进行中】标记）
5. 特别标注任何未兑现的承诺或约定（用【待兑现】标记）
6. 字数控制在300-600字
7. 如果有旧总结，将其与新内容合并为一份连贯的总结，去除已过时的进行中标记`;
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
 * @param {boolean} imageAttached - Whether the user is attaching an image (multimodal)
 * @returns {string}
 */
export function buildChatUserPrompt(pendingMessages, history = [], maxHistoryPairs = 15, imageAttached = false) {
    const parts = [];
    const charName = getCharacterInfo()?.name || '角色';

    // ─── ST Main Chat Storyline Context ───
    // Only inject when using custom API. When using ST's built-in generateRaw,
    // Generate() already includes the full ST chat history in the assembled prompt.
    // Injecting it again would DOUBLE the token count (30k × 2 = 60k).
    const isUsingCustomApi = useMomentCustomApi && customApiConfig?.url && customApiConfig?.model;
    if (isUsingCustomApi) {
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

    // ─── Image Attachment Note ───
    if (imageAttached) {
        parts.push(`（${getUserName()}同时发送了一张图片，图片内容以 image_url 格式附在本消息中，请仔细查看图片并在回复中自然地回应图片内容。）`);
    }

    parts.push('请以JSON格式回复。');

    const result = parts.join('\n\n');

    // Push to Console app for debugging
    try { pushPromptLog('Chat User', '', result); } catch (e) { /* console not loaded */ }

    return result;
}

// ═══════════════════════════════════════════════════════════════════════
// Auto Message Prompts — 角色主动发消息
// ═══════════════════════════════════════════════════════════════════════

/**
 * Build the system prompt for auto (proactive) messages.
 * Reuses the same foundation, char profile, persona, and worldbook
 * as the regular chat prompt, but adds auto-message-specific rules.
 */
export async function buildAutoMessageSystemPrompt() {
    const charInfo = getCharacterInfo();
    const userName = getUserName();
    const charName = charInfo?.name || '角色';

    // Character profile
    const charDesc = charInfo?.description
        ? `<char_profile>\n角色名: ${charName}\n${charInfo.description}\n</char_profile>`
        : `<char_profile>\n你是${charName}，${userName}的恋人。\n</char_profile>`;


    // User persona
    const userPersonaText = getUserPersona();
    const userPersona = userPersonaText
        ? `<user_persona>\n以下是${userName}的人设信息：\n${userPersonaText}\n</user_persona>`
        : '';

    // World Book
    const worldBookText = await getPhoneWorldBookContext();
    const worldBookBlock = worldBookText
        ? `<world_info>\n${worldBookText}\n</world_info>`
        : '';

    // Rolling chat summary — gives context of recent conversations
    const chatSummary = loadChatSummary();
    const summaryBlock = chatSummary
        ? `<recent_chat_summary>\n以下是最近手机聊天的总结，${charName}记得这些内容：\n${chatSummary}\n</recent_chat_summary>`
        : '';

    // Recent chat history (last few messages for immediate context)
    const history = loadChatHistory();
    const recentMsgs = history.slice(-10);
    let recentChatBlock = '';
    if (recentMsgs.length > 0) {
        const lines = recentMsgs.map(m => {
            const role = m.role === 'user' ? userName : charName;
            return `${role}: ${m.content}`;
        });
        recentChatBlock = `<recent_messages>\n最近的几条手机聊天记录：\n${lines.join('\n')}\n</recent_messages>`;
    }

    // Core foundation
    const foundation = getCoreFoundationPrompt();

    const result = `${foundation}

**SMS Channel — Auto Message Mode**:
${userName}暂时离开了${charName}的身边。${charName}拥有手机短信渠道可以主动联系${userName}。
现在，${charName}决定主动给${userName}发一条消息。

${charDesc}

${userPersona}

${worldBookBlock}

${summaryBlock}

${recentChatBlock}

<auto_message_rules>
特殊任务：
${charName}正在**发送主动消息**——这是${charName}自己发起的，不是回复${userName}的消息。

核心原则：
1. **自然发起**——想象一个真实的恋人在日常生活中会主动发什么消息：
   - 分享看到的有趣事物（"你看这个！"）
   - 撒娇想念（"在干嘛呀..."）
   - 日常絮叨（"今天中午吃了个超好吃的..."）
   - 关心问候（"今天忙不忙？"）
   - 发现好玩/好看的东西想分享
   - 突然想到对方（"刚才路过那个地方想到你了"）
   - 根据之前的聊天内容自然延续话题
2. **时间感知**——根据当前时间段调整消息内容和语气：
   - 早上：问候、关心
   - 中午/下午：分享日常、聊天
   - 晚上：温柔、想念
   - 深夜：如果角色还没睡，可以发一些深夜特有的感性消息
3. **不要刻意**——不要表现得像在完成任务。消息应该像是自然的冲动，而不是刻意的定时消息。
4. **不要复读**——不要重复最近聊天中已经聊过的内容。
5. **保持角色**——严格遵守${charName}的性格、说话方式和语言习惯。
6. **消息简短**——主动消息通常比较简短自然，1-3条连发即可，不需要太长。
7. **使用${charName}资料中的语言输出**（如果${charName}是俄罗斯人就用俄语）。
</auto_message_rules>

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
- delay: 必填。模拟打字延迟。
- 可以返回1-3条消息（数组1-3个对象），模拟连发效果。
</output_format>`;

    // Push to Console app for debugging
    try { pushPromptLog('AutoMsg System', result); } catch (e) { /* console not loaded */ }

    return result;
}

/**
 * Build the user prompt for auto message generation.
 * @param {string} idleText - Human-readable idle duration (e.g. "12分钟")
 * @returns {string}
 */
export function buildAutoMessageUserPrompt(idleText) {
    const charName = getCharacterInfo()?.name || '角色';
    const userName = getUserName();

    // Determine time of day
    const hour = new Date().getHours();
    let timeOfDay;
    if (hour >= 5 && hour < 9) timeOfDay = '清晨';
    else if (hour >= 9 && hour < 12) timeOfDay = '上午';
    else if (hour >= 12 && hour < 14) timeOfDay = '中午';
    else if (hour >= 14 && hour < 18) timeOfDay = '下午';
    else if (hour >= 18 && hour < 22) timeOfDay = '晚上';
    else timeOfDay = '深夜';

    const result = `${charName}已经有 ${idleText} 没有收到${userName}的消息了。
当前时间段：${timeOfDay}（${hour}点左右）

现在${charName}决定主动给${userName}发一条消息。
可以是分享日常、撒娇、问候、吐槽有趣的事、或因为想念而主动联系。
请以JSON格式回复。`;

    // Push to Console app for debugging
    try { pushPromptLog('AutoMsg User', '', result); } catch (e) { /* console not loaded */ }

    return result;
}
