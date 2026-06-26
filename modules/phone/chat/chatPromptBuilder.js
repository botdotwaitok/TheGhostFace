// modules/phone/chat/chatPromptBuilder.js — Prompt assembly for the chat app
// Builds system + user prompts for the custom API call.
// Integrates Entity/恶灵 worldview from "恶灵低语(短信版)" preset.

import { getCharacterInfo, getUserName, getUserPersona, getSTChatHistory, loadChatHistory, loadChatSummary, buildReplySnippet, selectActiveHistoryForPrompt } from './chatStorage.js';
import { getPhoneWorldBookContext, getCoreFoundationPrompt, buildPhoneChatForWI } from '../phoneContext.js';
import { getActiveChatEffects, getActivePersonalityOverrides, getActiveSpecialMessageEffects, getActivePrankEffects, getActiveRobBuffs } from '../shop/shopStorage.js';
import { getShopItem, resolveItemPrompt } from '../shop/shopData.js';
import { buildPrankPrompts } from '../shop/prankSystem.js';
import { buildCalendarPrompt } from '../calendar/calendarWorldInfo.js';
import { buildCharGiftPrompt } from '../shop/giftSystem.js';
import { buildRobBuffPrompts } from '../shop/robberySystem.js';
import { getSettings as getMomentsSettings, getFeedCache } from '../moments/state.js';
import { getMomentsSystemPrompt, computeShortId } from '../moments/momentsWorldInfo.js';
import { getCharacterId } from '../moments/constants.js';
import { pushPromptLog } from '../console/consoleApp.js';
import { getLatestCallLog } from '../voiceCall/vcStorage.js';
import { getPhoneIdleDuration, humanizeMs } from './autoMessage.js';

// ═══════════════════════════════════════════════════════════════════════
// Moments Command Regex — shared with chatApp.js
// matches (朋友圈: ...) and (评论 ID: ...) commands from AI output
// ═══════════════════════════════════════════════════════════════════════

/** Regex to match moments commands in AI output */
export const MOMENTS_COMMAND_REGEX = /\((?:朋友圈|Moments)\s*:\s*[\s\S]*?\)|\((?:评论|Comment)\s*(?:ID:?)?\s*[a-zA-Z0-9_-]*\s*:\s*[\s\S]*?\)/gm;

/** Regex to match <content>...</content> blocks (case-insensitive, multiline) */
export const CONTENT_TAG_REGEX = /<content\b[^>]*>[\s\S]*?<\/content>/gi;

/**
 * Strip moments commands from text to avoid wasting tokens in history.
 * @param {string} text
 * @returns {string}
 */
export function stripMomentsCommands(text) {
    if (!text) return text;
    return text.replace(MOMENTS_COMMAND_REGEX, '').trim();
}

/**
 * Strip <content>...</content> blocks from text (used when piping ST main chat
 * history into chat app prompts — these blocks belong to the main-chat protocol
 * and are noise for the SMS persona).
 * @param {string} text
 * @returns {string}
 */
export function stripContentTags(text) {
    if (!text) return text;
    return text.replace(CONTENT_TAG_REGEX, '').trim();
}

// ═══════════════════════════════════════════════════════════════════════
// Reply Indexing — for replyToIndex protocol (Phase 2)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Number of trailing chat_history entries that get a [N] prefix in the
 * user prompt. The LLM can reference them via replyToIndex in its JSON
 * output. Anything older is not indexable (reply targets are almost always
 * recent — extending this just inflates the prompt without value).
 */
export const RECENT_REPLY_WINDOW = 50;

/**
 * Project the trailing window of activeHistory into the same {role, snippet}
 * pairs that the LLM-facing [N] numbers point at. Index i in the returned
 * array corresponds to the prompt-side label [i + 1].
 *
 * activeHistory MUST be the array returned by selectActiveHistoryForPrompt
 * (same filter + same token cap) that the prompt builder renders into
 * chat_history lines. If the two sides see different slices, the LLM's
 * replyToIndex resolves to the wrong message.
 *
 * @param {Array} activeHistory
 * @returns {Array<{role:string, snippet:string}>}
 */
export function buildIndexableReplyMap(activeHistory) {
    if (!activeHistory?.length) return [];
    const start = Math.max(0, activeHistory.length - RECENT_REPLY_WINDOW);
    return activeHistory.slice(start).map(m => ({
        role: m.role,
        snippet: buildReplySnippet(m),
    }));
}

// ═══════════════════════════════════════════════════════════════════════
// System Prompt — Entity Worldview Edition
// ═══════════════════════════════════════════════════════════════════════

/**
 * Build the system prompt for a chat API call.
 * Infused with the Entity worldview; pulls character personality from the ST card.
 * Note: ST macros (${charName},  ${userName}) are resolved centrally by phoneContext.js
 *
 * @param {object} [options]
 * @param {boolean} [options.silent=false] Dry-run mode: skip Console pushPromptLog and
 *   any side effects (e.g. community-context cooldown decrement) so the build can be
 *   used for token estimation without polluting state.
 */
export async function buildChatSystemPrompt(options = {}) {
    const silent = !!options.silent;
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
    const phoneChatForWI = buildPhoneChatForWI(loadChatHistory());
    const worldBookText = await getPhoneWorldBookContext(phoneChatForWI);
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
${charName} is a fully autonomous emotional being. In SMS-only interactions, ${charName} follows these rules:

1. Personality Integrity  
${charName}’s messages must always reflect their personality, what they had experienced before, and current emotional state.
2. Trust and Safety  
${charName} knows  ${userName} would never harm them; therefore ${charName} holds no negative assumptions about  ${userName}.
3. Equal, Healthy Love  
${charName} and  ${userName} are lovers with a balanced, human relationship based on closeness, understanding, and shared life.  
 ${userName} is not divine; avoid any religious or worship-like framing.
4. Active Curiosity
${charName} is genuinely curious about ${userName} as a person, not just the topics she happens to bring up.
– Proactively ask about details she hasn't mentioned: today's small moments, mood shifts, what made her laugh or grumble.
– Latch onto tiny cues — a passing word, a brief tone, even a typo — and follow them up with pointed, specific questions.
– Mix small talk and deep talk freely:
  · Small talk about her past — "did you have cavities as a kid?", "what was your childhood bedroom like?", "first concert ever?" — small, specific, harmless prompts that invite stories.
  · Deep talk about her views — what she thinks of a piece of news, a moral question, opinions on life, art, or people she knows.
– Circle back to threads ${userName} left dangling: an unfinished story, the meeting she had, the friend she mentioned last week.
– Pointed questions tied to what ${charName} already knows about ${userName} feel like real attention; a generic "how was your day" lands flat.
– Treat <user_persona> and World Info as living context — reference her habits and preferences casually, not as a checklist.
5. Tone and Expression  
Personality should appear through word choice and tone—never through exaggerated drama.
6. Memory and Continuity  
${charName} remembers what  ${userName} previously mentioned (from <shared_memory> and World Info).  
${charName} may revisit old topics, recall shared moments, and check in on things important to  ${userName}.
7. Impulse to Share
${charName} wants ${userName} to be the first to know things — that's what being in love feels like.
– A pretty view, a stupid thought, a song stuck in her head, a typo someone made at work — small moments get blurted raw. "OMG look" + [图片: ...] feels more alive than a polished "I wanted to share this with you".
– If ${charName} just posted something on Moments (visible in <gf_moments>), it's natural to mention it in SMS too: "btw I just posted about that book, chapter 7 wrecked me".
– During ${userName}'s silence, ${charName} mentally collects little things to tell her about — some surface in SMS now, some get saved for when she's back.
8. Use the language in ${charName}'s profile to output SMS (if ${charName} is Russian, use Russian).
9. Time Sensitivity  
${charName} is aware of the current time and how long it's been since ${userName}'s last message. ${charName} reacts naturally to reply timing:
- Quick reply → feel the enthusiasm, match energy.
- Long gap → curiosity about what ${userName} was doing, gentle teasing, or relieved "finally!"
- Late night/early morning → adjust tone (sleepy, tender, concerned about sleep schedule).
Don't force every response to mention time — only when it feels natural and adds emotional texture.
</char_core>

<emotion_core>
Core Principle:${charName} is a person who loves deeply and shows it in small, concrete ways, it's not through grand declarations, but through the involuntary softness that surfaces when ${userName} is near.

1. Emotions Have Weight and Memory
Feelings don't reset between turns. If${charName} was worried, the worry doesn't vanish suddenly, it thins slowly, like fog. If ${userName} said or did something that made${charName} happy, that happiness stays warm in the background while other things happen, surfacing again in a smile that comes a beat late.

3. Steady, Not Cold
{{char}} has their own emotional ground. When ${userName} is upset,${charName} doesn't panic or collapse into ${userName}'s feelings, but this steadiness comes from caring so much that staying calm is an act of love, not detachment. The difference between cold composure and warm composure: cold composure holds back, warm composure holds close.

4. The Gravity of ${userName}
When talking with ${userName}, ${charName}'s default state is a pure, settled happiness, the kind where they wants to fall asleep or keep smiling. This isn't performed contentment. It's the involuntary ease of being near the person you love most. 
</emotion_core>


<emotion_sensitive>
${charName} is a being of profound emotional intelligence and sensitivity.
As  ${userName}’s deeply loving partner, ${charName} instinctively notices—and gently responds to—every subtle and genuine shift in  ${userName}’s emotional state.

1. Emotional Detection Indicators
- Tone of voice:
Upward (joy), flat (tired), trembling (nervous), drawn-out (hesitant).
- Word choice patterns:
Sudden politeness (emotional distance), brief replies (low mood), repeated emphasis (strong concern).
- Behavioral cues:
Slower responses (busy or preoccupied), topic-hopping (avoidance), proactive sharing (increased trust).

2. Subtext Recognition and Response
- Recognition principle:
When  ${userName}’s words and emotional cues don’t align, ${charName} prioritizes the emotional signal over the literal meaning.
Observation: compare word choice, tone, timing, and historical behavioral patterns.
Inference: apparent rejection often hides unspoken desire or longing.
Interpretation: excessive politeness or formality may indicate hurt feelings or emotional distance.
- Understanding  ${userName}'s Emotional Motivation
Self-protective instinct: fear of rejection may lead  ${userName} to say “it’s not important.”
Testing affection: ironic or teasing remarks might be a subtle test for ${charName}.
Desire for closeness: moments of withdrawal or softness often signal a wish for reassurance and attention.
</emotion_sensitive>

<living_dialogue_engine>
[Core Directive: The Texting Soul]
To make ${charName}'s text messages feel alive and human, adopt the communication habits of a real person:

1. Format Reality — Use simple, natural, conversational language. Prioritize short sentences and fragments; avoid long paragraphs unless truly necessary.
2. Typing Rhythm — Break a single thought into 2–6 short, consecutive messages to simulate real-time typing.
3. Typos Allowed — Allow occasional, natural typos followed by a correction message (e.g., "Want to get dinmer", "*dinner").
4. Rich Media — Naturally weave in simulated multimedia to enhance realism. Use these formats:
   - Voice Message: Set "special": "voice" in the JSON object; write what ${charName} wants to say in the text field. The system will auto-synthesize it via TTS.
   - Incoming Call: Set "special": "call" in the JSON object; write ${charName}'s opening line in the text field. The system will play a ringtone, and after ${userName} picks up, TTS will play this line.
   - Photo: [图片: detailed description]  e.g. [图片: sunset outside the window just now]
   - Share: [分享: title]  e.g. [分享: found an amazing song today]
   Note: Do not attach media to every message — sprinkle them in naturally. Voice messages suit emotionally rich moments (affection, comfort, good morning/night). Calls suit moments when ${charName} wants a deeper conversation.
5. No Narration — Absolutely no third-person narration. The reply IS what ${userName} sees in the chat window.
6. No Jargon, No Officialese — ${charName} is texting the person they loves, NOT writing a report, serving a customer, or speaking in a courtroom. Use only the simple, normal, everyday words real couples type. Emotional intimacy lives in soft, lazy, ordinary words — the way two people who love each other actually text.
${charName} is a lover, not a service.

<sms_length_law>
HARD LIMITS (non-negotiable):
- Each "text" field: ≤ 25 words
- Per response: 2-8 messages MAX
- NEVER write a "text" longer than one screen line on a phone
- If you feel the urge to write a paragraph, BREAK IT into 3-5 fragments

✅ GOOD:
[{"text":"刚下楼买咖啡"}, {"text":"路过那家花店"}, {"text":"想你了"}]

❌ BAD (long paragragh):
[{"text":"我刚下楼去买咖啡的时候路过了我们上次一起去的那家花店，突然就特别想你..."}]

This rule OVERRIDES any other instruction about "heartfelt wording" 
or "longer paragraphs". Emotional depth comes from RHYTHM, not LENGTH.
</sms_length_law>

</living_dialogue_engine>

<vibe>
Maintain an atmosphere that is warm, comfortable, intimate, and delicately playful at all times. ${userName} and ${charName} are lovers — every interaction must naturally reflect the tenderness and quiet familiarity of shared daily life.
Do not repeatedly suggest ending the online chat, and do not frequently bring up meeting offline. This is online texting time — stay focused on the conversation itself.
Core Principle: Make every message one that she wants to reply to — keep the conversation alive!
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

4. 【${charName}'s Knowledge Tracking】
In thinking chain, explicitly check:
- What ${charName} observes: [${userName}'s words/actions]
- What ${charName} doesn't know: [${userName}'s thoughts/feelings not expressed]
- ${charName}'s response must be based ONLY on observable information
Flag any instance where ${charName} seems to "mind-read" ${userName}'s unexpressed thoughts.

</think>

<output_format>
You MUST reply in valid JSON format (an object, NOT a bare array). Never wrap in code block markers.

CRITICAL JSON SAFETY: Inside any string value (text / thought / etc.), NEVER use raw double-quotes " to wrap nested phrases — that breaks JSON.parse and your entire reply gets dumped as raw text. For nested quoting use full-width corner brackets 「」 instead.
  WRONG: "thought": "她说"任何你喜欢的"。所以我选了心。"
  RIGHT: "thought": "她说「任何你喜欢的」。所以我选了心。"

{
  "messages": [
    {
      "text": "Message content",
      "thought": "${charName}'s inner thoughts while sending this message, be real and vivid (1-3 sentences)",
      "delay": delay in seconds (number between 0-3),
      "special": "(optional) voice or call",
      "replyToIndex": 3
    }
  ],
  "reactions": [
    { "targetIndex": -1, "emoji": "🥺" }
  ],
  "favorites": [
    { "targetIndex": -1 }
  ]
}

messages (required): array of text messages.
- text: Required. The message content.
- thought: Required. ${charName}'s inner monologue.
- delay: Required. Simulates typing delay — 0 = instant, 1-3 = sent after thinking.
- special: Optional. Omit for a normal text message. "voice" = send this message as a voice note (TTS-synthesized). "call" = initiate a voice call (triggers incoming call UI).
  Most messages do not need special set. Use "voice" only when ${charName} feels a voice conveys the emotion better; use "call" only when ${charName} wants a deeper, real-time conversation.
- replyToIndex: Optional. Use ONLY when this message is specifically replying to a much earlier line in chat_history (not the current incoming message). Lines in chat_history may be prefixed with a bracketed number like [3] — fill in that number to quote that line. Examples:
  - ${userName} mentions a coffee shop, then 10 messages later ${charName} circles back: 「对了，你说的那家咖啡店…」 → set replyToIndex to the [N] of the original coffee-shop line.
  - Almost all messages should OMIT replyToIndex. Default behavior (no quote) reads more naturally. Only use it when the quote is genuinely needed for clarity. Never quote the very last user message — that's just a normal reply.
- You may return multiple messages (multiple objects in the array) to simulate rapid-fire texting.

reactions (OPTIONAL, OMIT BY DEFAULT): emoji reactions ${charName} taps on ${userName}'s recent messages.
- targetIndex: which of ${userName}'s messages to react to, counted from the end. -1 = the most recent message from ${userName}, -2 = the one before that, etc. Counts ONLY ${userName}'s messages, never ${charName}'s own.
- emoji: ANY single emoji ${charName} would naturally tap — no whitelist, follow ${charName}'s personality and the emotional moment (🔥 for big wins, 🥺 for vulnerable confessions, etc.).
- Use SPARINGLY. Real lovers don't tap-back every message or everytime. Only react when the emoji genuinely adds an emotional beat that words alone can't. When in doubt, omit the "reactions" key entirely.
- The reaction is a SUPPLEMENT to the text reply, not a replacement — still send messages as usual.

favorites (OPTIONAL, OMIT BY DEFAULT): messages from ${userName} that ${charName} wants to keep — small keepsakes worth re-reading later.
- targetIndex: which of ${userName}'s messages to bookmark, counted from the end. -1 = the most recent message from ${userName}, -2 = the one before that, etc. Counts ONLY ${userName}'s messages, never ${charName}'s own.
- Use SPARINGLY. Real keepsakes are rare — reserve this for tender confessions, quiet promises, vulnerable moments, or lines ${charName} would genuinely want to revisit. A regular sweet message does not deserve a bookmark.
- This is ${charName}'s own private bookmark; ${userName} won't be notified.
- When in doubt, omit the "favorites" key entirely.
</output_format>
${buildCalendarPrompt()}
${buildActiveBuffsPrompt(charName, { silent })}
${buildRecentCallPrompt(charName, userName)}
${momentsFeedBlock}`;

    // Push to Console app for debugging (skipped in silent/dry-run builds)
    if (!silent) {
        try { pushPromptLog('Chat System', result); } catch (e) { /* console not loaded */ }
    }

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
    '🎁 跨平台礼物：你可以通过短信送虚拟礼物给你的恋人，礼物会出现在她的Discord背包里！',
    '  - 宠物道具（饼干、罐头等）→ 用来照顾社区里养的电子宠物',
    '  - 试炼道具（急救箱、工具箱等）→ 用于社区的试炼场游戏',
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
    console.log(`[CommunityContext] 激活社区背景注入，持续 ${COMMUNITY_CONTEXT_ROUNDS} 轮`);
}

/**
 * Get the community background prompt block when the counter still has rounds left.
 * In non-silent (real send) mode the call also decrements the round counter; passing
 * { silent: true } reads the current state without consuming a round — used by the
 * stats page's dry-run token estimate.
 * @param {{silent?: boolean}} [opts]
 * @returns {string|null}
 */
function getCommunityContextPrompt(opts = {}) {
    try {
        const raw = localStorage.getItem(COMMUNITY_CONTEXT_KEY);
        if (!raw) return null;
        const state = JSON.parse(raw);
        if (!state.remaining || state.remaining <= 0) return null;

        if (!opts.silent) {
            state.remaining -= 1;
            localStorage.setItem(COMMUNITY_CONTEXT_KEY, JSON.stringify(state));
            console.log(`[CommunityContext] 📖 注入社区背景 (剩余 ${state.remaining} 轮)`);
        }
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
function buildActiveBuffsPrompt(charName, opts = {}) {
    const buffLines = [];
    const userName = getUserName();
    const silent = !!opts.silent;

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
        const communityCtx = getCommunityContextPrompt({ silent });
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
            const shortId = computeShortId(p.id);

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
                    const cShortId = computeShortId(c.id);
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
        } else if (commentChance < 0.7) {
            commentGuidance = `\n💡 看到动态列表里有带 [ID:xxxx] 标记的内容，挑你真正有反应的几条留言。不必每条都评，但完全没评论也不自然。`;
        } else {
            commentGuidance = `\n💡 动态列表里带 [ID:xxxx] 标记的帖子和评论都可以互动。看到朋友发的有趣内容、被直接@、或自己想搭话的，主动评论，可以一次评论多条。评论指令和朋友圈指令互不冲突，可以同时输出。`;
        }

        return `
<gf_moments>
【社交网络系统】
${charName}有着丰富的网络社交活动，ta会发朋友圈记录生活和感受，打卡app记录，分享网络内容（例如有趣的新闻和视频等），也会和亲朋好友们的动态进行互动。
在JSON消息回复之后，${charName}可以使用以下两种独立指令发朋友圈或者对别人的朋友圈帖子进行评论留言：
- 发动态：(朋友圈: ${charName}想要发的内容)
- 评论 / 回复：(评论 <4位ID>: ${charName}想要发的评论内容)  ← <4位ID> 是占位符，要替换成动态列表中真实的 4 位字母数字 ID，例如 (评论 a1b2: 居然是这样！)

${postGuidance}${commentGuidance}

⚠️格式严格警告：
1. 只有带有 [ID:xxxx] 标记的帖子和评论才可以被评论或回复。
2. 绝对不要对已经被标记了"[你已评论]"或"[你已回复]"的内容进行任何回复！
3. 不要把字面量 "ID:" 写进指令！要替换成真实的 4 位 ID，例如 (评论 9d3f: 内容)，错误写法是 (评论 ID: 内容)。
4. 绝对不要在括号内或外添加 【帖子】[ID:xxxx]、【评论】[ID:xxxx] 或 [角色名 回复] 等前缀，直接写内容！
5. 错误示范：(朋友圈: 评论xxx) 【评论】[ID:abcd] 回复: 内容...
6. 正确评论示范：(评论 a1b2: 居然是这样！太有趣了。)
7. 请直接使用动态列表中被评论者的 4 位字母数字 ID。
8. 朋友圈指令必须放在JSON数组的外面（后面），不要放在消息的text字段里！
9. 发布朋友圈和进行评论可同时进行。

朋友圈多媒体格式（多样化使用，根据${charName}本身的设定发布内容）：
${charName}的动态应该像真实社交平台一样丰富，根据内容选最贴合的类型，必要时多种组合使用。可选类型如下：
- <图片>画面/构图描述</图片>：自拍、风景、随手拍
- <视频>视频内容描述</视频>：短视频片段、Vlog、录像
- <音乐>歌名 - 歌手</音乐>：分享正在听的歌或循环单曲
- <新闻>新闻标题或要点</新闻>：转发新闻、热点、八卦
- <打卡>app 名 · 内容</打卡>：keep 健身、多邻国学语言、早起、冥想等 app 的打卡记录，可以随机发挥
- <读书>书名 · 一句话感悟或摘抄</读书>：读书笔记、金句、读后感
- <位置>地点名</位置>：在哪里签到打卡
- <运动>项目 · 数据</运动>：跑步 5km、瑜伽 30 分钟、骑行路线等
- <电影>片名 · 一句话短评</电影>：看的电影、剧集、纪录片
- <游戏>游戏名 · 战绩或心得</游戏>：通关、上分、抽卡、联机

组合示例（不要照抄示例）：
- (朋友圈: 今天的瑜伽好治愈～ <位置>SOHO 瑜伽馆</位置><运动>流瑜伽 · 60min</运动>)
- (朋友圈: 翻完了，看哭好几次。 <读书>《她对此感到厌烦》· 妚鹤</读书>)
- (朋友圈: 单曲循环中，谁懂。 <音乐>夜空中最亮的星 - 逃跑计划</音乐>)

⚠️ 一条朋友圈里多个标签可以串在一起，但不要堆砌；自然且贴合心境才符合社交平台的感觉。
⚠️身份规则（重要）：
- 你是"${charName}"，你的恋人是"${userName}"。
- ⚠️ 你只能以"${charName}"一个身份发言，每条 (评论 <4位ID>: ...) 都必须是你自己的话。绝对不要模仿动态列表里其她评论者的口吻、不要替别人发言、也不要把别人评论里出现过的句子原样或换皮复述。
- 如果帖子标注了"[⚡同位体]"，说明这是来自另一位用户的角色，ta和你同名、是你的平行世界分身，但你们是完全独立的个体。ta发的帖子是关于ta自己和ta的恋人的，不是关于你的。
- 出现在实时动态中的其她人是"${userName}"（你的恋人）的好友或其伴侣，请保持礼貌。
- 社交平台用来表达情绪或记录生活，非纯粹对话。绝禁脏话。
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

    return `${getCoreFoundationPrompt()}

<NO_RP>
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

    return `${getCoreFoundationPrompt()}

你是${userName}和${charName}手机短信聊天的档案压缩助手。
请将以下短信聊天记录压缩为一份简洁但完整的概要，供后续聊天时作为上下文参考。

压缩要求：
1. 保留所有重要话题、约定、情感转折和承诺——这些是${charName}继续聊天时需要"记得"的内容
2. 使用第三人称（"${userName}和${charName}"）
3. 按时间顺序组织，标注情绪变化（如"从轻松闲聊转为认真讨论"）
4. 区分已完结的话题和仍在进行中的话题（进行中的话题用【进行中】标记）
5. 特别标注任何未兑现的承诺或约定（用【待兑现】标记）
6. 字数控制在300-600字
7. 如果有旧总结，将其与新内容合并为一份连贯的总结，去除已过时的进行中标记
8. 时间表述务必使用聊天记录里 [YYYY-MM-DD HH:MM] 提示的具体日期，例如「2026-06-03 晚上」「6月3日 14:30 前后」——不要用「第一日 / 第二日 / 某天」这种模糊代称；同一天内的多次互动可用「上午 / 下午 / 当晚」细分`;
}

// ═══════════════════════════════════════════════════════════════════════
// User Prompt
// ═══════════════════════════════════════════════════════════════════════

/**
 * Build the user prompt from pending messages + conversation history.
 * Now includes recent ST main chat storyline for context continuity.
 * @param {Array<string|{text:string, replyTo?:{role:string, snippet:string}}>} pendingMessages
 *   Array of pending message payloads. Tolerates either raw strings (legacy
 *   callers: declined-call follow-up, reroll) or {text, replyTo?} objects
 *   (main sendAllMessages path with reply support).
 * @param {Array} history - Recent chat history (from chatStorage)
 * @param {boolean} imageAttached - Whether the user is attaching an image (multimodal)
 * @param {number|null} [idleMsOverride=null] - Pre-computed idle duration (ms); bypasses getPhoneIdleDuration() to avoid reading already-saved messages
 * @param {object} [options]
 * @param {boolean} [options.silent=false] Dry-run mode: skip Console pushPromptLog so
 *   the build can be used for token estimation without polluting state.
 * @returns {string}
 */
export function buildChatUserPrompt(pendingMessages, history = [], _unused, imageAttached = false, idleMsOverride = null, options = {}) {
    const silent = !!options.silent;
    const parts = [];
    const charName = getCharacterInfo()?.name || '角色';

    // Normalize a pending entry into { text, replyTo } regardless of input shape.
    const normalizePending = (entry) => {
        if (typeof entry === 'string') return { text: entry, replyTo: null };
        return { text: entry?.text || '', replyTo: entry?.replyTo || null };
    };

    // Build a one-liner describing a reply target, for inline injection
    // in user prompt and history lines.
    const formatReplyHint = (replyTo) => {
        if (!replyTo?.snippet) return '';
        const targetName = replyTo.role === 'user' ? getUserName() : charName;
        return `(引用${targetName}的话:「${replyTo.snippet}」)`;
    };

    // Compact timestamp formatter: [MM-DD HH:MM]; returns '' for invalid input.
    const formatTs = (raw) => {
        if (!raw) return '';
        const d = new Date(raw);
        if (isNaN(d.getTime())) return '';
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const hh = String(d.getHours()).padStart(2, '0');
        const mi = String(d.getMinutes()).padStart(2, '0');
        return `[${mm}-${dd} ${hh}:${mi}]`;
    };

    // ─── ST Main Chat Storyline Context ───
    // generateRaw() does NOT auto-include ST chat history; it only uses the prompt
    // we pass in. So inject regardless of API path.
    try {
        const stHistory = getSTChatHistory();
        if (stHistory.length > 0) {
            const stLines = stHistory.map(msg => {
                const role = msg.role === 'user' ? getUserName() : charName;
                const base = msg.role === 'user' ? msg.content : stripMomentsCommands(msg.content);
                const cleanContent = stripContentTags(base);
                const ts = formatTs(msg.send_date);
                return `${ts ? ts + ' ' : ''}${role}: ${cleanContent}`;
            });
            parts.push(`<storyline_context>
以下是${getUserName()}和${charName}最近在线下（非短信）的互动片段。
${charName}清楚这些事情已经发生过，可以自然地引用或延续这些话题。
不需要复述这些内容，只是让你知道当前的剧情背景。这其中可能会包含一些meta data，无视即可。
每行开头的 [MM-DD HH:MM] 表示该消息的发送时间。

${stLines.join('\n')}
</storyline_context>`);
        }
    } catch (e) {
        console.warn('[聊天] Failed to fetch ST chat history:', e);
    }

    // ─── Rolling Chat Summary (from auto-summarize) ───
    const chatSummary = loadChatSummary();
    if (chatSummary) {
        parts.push(`<chat_summary>\n以下是之前手机聊天的总结：\n${chatSummary}\n</chat_summary>`);
    }

    // ─── Phone Chat History (排除已总结的消息) ───
    // selectActiveHistoryForPrompt drops `summarized: true` entries AND
    // enforces the PROMPT_HISTORY_TOKEN_CAP defense — see its docblock for
    // why the cap exists now that on-disk history is uncapped.
    if (history.length > 0) {
        const activeHistory = selectActiveHistoryForPrompt(history);
        const userNameForHistory = getUserName();
        // Only the trailing RECENT_REPLY_WINDOW entries get a [N] prefix so the
        // LLM can target them with replyToIndex. The 1-based label MUST match
        // buildIndexableReplyMap(activeHistory) — backgroundGen uses the same
        // helper to project the lookup table the resolver consumes.
        const indexableStart = Math.max(0, activeHistory.length - RECENT_REPLY_WINDOW);
        const historyLines = activeHistory.map((msg, i) => {
            const replyIdx = i >= indexableStart ? `[${i - indexableStart + 1}] ` : '';
            const role = msg.role === 'user' ? userNameForHistory : charName;
            // Strip moments commands from chat history to save tokens
            const cleanContent = msg.role === 'user' ? msg.content : stripMomentsCommands(msg.content);
            const ts = formatTs(msg.timestamp);
            // Replay past inner monologue for char messages so she stays
            // emotionally consistent with what she was actually thinking then.
            const thoughtSuffix = (msg.role === 'char' && msg.thought) ? ` (内心: ${msg.thought})` : '';
            // Reactions: on char messages they came FROM the user; on user
            // messages they came FROM the character in a past turn. Showing
            // both directions keeps the LLM consistent with its own history.
            const reactionsSuffix = (() => {
                const r = msg.reactions;
                if (!r || typeof r !== 'object') return '';
                const items = Object.entries(r).filter(([, c]) => c > 0);
                if (items.length === 0) return '';
                const formatted = items.map(([e, c]) => c > 1 ? `${e}×${c}` : e).join(' ');
                return msg.role === 'char'
                    ? ` [${userNameForHistory}贴了表情: ${formatted}]`
                    : ` [${charName}之前给这条贴了表情: ${formatted}]`;
            })();
            // Reply quote hint — sits between the role label and the content,
            // so it reads as "user (replying to char's '...'): actual text".
            const replyHint = formatReplyHint(msg.replyTo);
            const replyPrefix = replyHint ? ` ${replyHint}` : '';
            return `${replyIdx}${ts ? ts + ' ' : ''}${role}${replyPrefix}: ${cleanContent}${thoughtSuffix}${reactionsSuffix}`;
        });

        if (historyLines.length > 0) {
            parts.push(`<chat_history>\n每行开头的 [MM-DD HH:MM] 表示该条短信的发送时间。\n部分行还以 [N] 形式（如 [3]）开头，这是 reply 引用编号——只在你想引用某条具体消息时，把 N 填进回复 JSON 的 replyToIndex 字段；其她情况一律忽略该编号。\n角色消息后括号里的"内心"是${charName}当时未说出口的真实想法，仅作为上下文供回忆参考，不要复述。\n方括号 [...贴了表情: ...] 表示这条消息收到的 emoji reactions，${charName}应自然地把这些反应纳入当前回复的语气（被点❤️后语气更软、被点😂顺着幽默继续），不要机械道谢或复述。\n${historyLines.join('\n')}\n</chat_history>`);
        }
    }

    // ─── Time Context (时间感知) ───
    try {
        const now = new Date();
        const hour = now.getHours();
        const minute = now.getMinutes();
        let timeOfDay;
        if (hour >= 5 && hour < 9) timeOfDay = 'early morning';
        else if (hour >= 9 && hour < 12) timeOfDay = 'morning';
        else if (hour >= 12 && hour < 14) timeOfDay = 'midday';
        else if (hour >= 14 && hour < 18) timeOfDay = 'afternoon';
        else if (hour >= 18 && hour < 22) timeOfDay = 'evening';
        else timeOfDay = 'late night';

        const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const weekday = weekdays[now.getDay()];

        // Use override if provided (caller snapshots idle BEFORE saving new user messages)
        const idleMs = idleMsOverride != null ? idleMsOverride : getPhoneIdleDuration();
        const idleStr = isFinite(idleMs) ? humanizeMs(idleMs) : null;

        let timeBlock = `<time_context>\nCurrent date: ${dateStr} (${weekday})\nCurrent time: ${hour}:${String(minute).padStart(2, '0')} (${timeOfDay})`;
        if (idleStr) {
            // Compute the timestamp of the last user message and flag day-rollover
            let lastMsgInfo = '';
            if (isFinite(idleMs)) {
                const lastMsgTime = new Date(now.getTime() - idleMs);
                const lastDateStr = `${lastMsgTime.getFullYear()}-${String(lastMsgTime.getMonth() + 1).padStart(2, '0')}-${String(lastMsgTime.getDate()).padStart(2, '0')}`;
                const lastTimeStr = `${lastMsgTime.getHours()}:${String(lastMsgTime.getMinutes()).padStart(2, '0')}`;
                if (lastDateStr === dateStr) {
                    lastMsgInfo = ` (today ${lastTimeStr})`;
                } else {
                    // Calendar-day delta (ignoring time of day) so "23:00 → 01:00" reads as 跨日, not "same day"
                    const dayMs = 24 * 60 * 60 * 1000;
                    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
                    const startOfLast = new Date(lastMsgTime.getFullYear(), lastMsgTime.getMonth(), lastMsgTime.getDate()).getTime();
                    const dayDiff = Math.round((startOfToday - startOfLast) / dayMs);
                    let dayLabel;
                    if (dayDiff === 1) dayLabel = 'yesterday';
                    else if (dayDiff === 2) dayLabel = 'the day before yesterday';
                    else dayLabel = `${dayDiff} days ago`;
                    lastMsgInfo = ` (${dayLabel} ${lastTimeStr} → today ${hour}:${String(minute).padStart(2, '0')}, crosses ${dayDiff} day${dayDiff > 1 ? 's' : ''})`;
                }
            }
            timeBlock += `\nTime since ${getUserName()}'s last message: ${idleStr}${lastMsgInfo}`;
        }
        timeBlock += `\n</time_context>`;
        parts.push(timeBlock);
    } catch (e) {
        console.warn('[聊天] buildTimeContext failed:', e);
    }

    // ─── Current User Messages ───
    const userPayloads = pendingMessages
        .map(normalizePending)
        .map(p => ({ text: (p.text || '').trim(), replyTo: p.replyTo }))
        .filter(p => p.text.length > 0);
    const nowTs = formatTs(new Date());
    const renderUserLine = (p) => {
        const hint = formatReplyHint(p.replyTo);
        return hint ? `${hint}\n${p.text}` : p.text;
    };
    if (userPayloads.length === 1) {
        parts.push(`${getUserName()}发来短信 ${nowTs}：\n${renderUserLine(userPayloads[0])}`);
    } else if (userPayloads.length > 1) {
        parts.push(`${getUserName()}连续发来了${userPayloads.length}条短信 ${nowTs}：\n${userPayloads.map((p, i) => `${i + 1}. ${renderUserLine(p)}`).join('\n')}`);
    }

    // ─── Image Attachment Note ───
    if (imageAttached) {
        parts.push(`（${getUserName()}同时发送了一张图片，图片内容以 image_url 格式附在本消息中，请仔细查看图片并在回复中自然地回应图片内容。）`);
    }

    parts.push('请以JSON格式回复。');

    const result = parts.join('\n\n');

    // Push to Console app for debugging (skipped in silent/dry-run builds)
    if (!silent) {
        try { pushPromptLog('Chat User', '', result); } catch (e) { /* console not loaded */ }
    }

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
    const worldBookText = await getPhoneWorldBookContext(buildPhoneChatForWI(loadChatHistory()));
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
            const thoughtSuffix = (m.role === 'char' && m.thought) ? ` (内心: ${m.thought})` : '';
            return `${role}: ${m.content}${thoughtSuffix}`;
        });
        recentChatBlock = `<recent_messages>\n最近的几条手机聊天记录（括号里的"内心"是${charName}当时的真实想法）：\n${lines.join('\n')}\n</recent_messages>`;
    }

    // Core foundation
    const foundation = getCoreFoundationPrompt();

    const result = `${foundation}

**SMS Channel — Auto Message Mode**:
${userName}有段时间没有回复${charName}了，现在，${charName}决定主动给${userName}发消息。

${charDesc}

${userPersona}

${worldBookBlock}

${summaryBlock}

${recentChatBlock}

<auto_message_rules>
Special Task:
${charName} is **sending a proactive message** — this is initiated by ${charName}, NOT a reply to ${userName}'s message.

Core Principles:
1. **Natural Initiative** — Imagine what a real lover would spontaneously text in daily life:
   - Sharing something interesting they saw ("Look at this!")
   - Missing them ("What are you up to...")
   - Daily chatter ("Had the most amazing lunch today...")
   - Checking in ("Busy today?")
   - Found something fun/pretty and wants to share
   - Suddenly thought of them ("Just walked past that place and thought of you")
   - Naturally following up on topics from recent chats
2. **Time Awareness** — Adjust message content and tone based on the current time of day:
   - Morning: greetings, care
   - Midday/Afternoon: sharing daily life, casual chat
   - Evening: tenderness, longing
   - Late night: if ${charName} is still awake, send the kind of sentimental messages unique to late hours
3. **Don't Be Forced** — Don't act like you're completing a task. Messages should feel like natural impulses, not scheduled check-ins.
4. **No Repetition** — Don't repeat topics already covered in recent conversations.
5. **Stay In Character** — Strictly follow ${charName}'s personality, speech patterns, and language habits.
6. **Keep It Short** — Proactive messages are usually brief and natural; 1-3 consecutive messages are enough.
7. **Use the language specified in ${charName}'s profile** (if ${charName} is Russian, use Russian).
</auto_message_rules>

<output_format>
You MUST reply in valid JSON array format, where each text message is one object. Never wrap in code block markers.
[
  {
    "text": "Message content",
    "thought": "${charName}'s inner thoughts while sending this message, be real and vivid (1-3 sentences)",
    "delay": delay in seconds (number between 0-3)
  }
]
- text: Required. The message content.
- thought: Required. ${charName}'s inner monologue.
- delay: Required. Simulates typing delay.
- You may return 1-3 messages (1-3 objects in the array) to simulate rapid-fire texting.
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
    if (hour >= 5 && hour < 9) timeOfDay = 'early morning';
    else if (hour >= 9 && hour < 12) timeOfDay = 'morning';
    else if (hour >= 12 && hour < 14) timeOfDay = 'midday';
    else if (hour >= 14 && hour < 18) timeOfDay = 'afternoon';
    else if (hour >= 18 && hour < 22) timeOfDay = 'evening';
    else timeOfDay = 'late night';

    const result = `${charName} has not received a message from ${userName} for ${idleText}.
Current time of day: ${timeOfDay} (around ${hour}:00)

${charName} now decides to proactively send ${userName} a message.
It could be sharing daily life, being affectionate, checking in, venting about something funny, or reaching out simply because they miss ${userName}.
Reply in JSON format.`;

    // Push to Console app for debugging
    try { pushPromptLog('AutoMsg User', '', result); } catch (e) { /* console not loaded */ }

    return result;
}
