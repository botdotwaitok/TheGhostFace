// modules/phone/discord/discordPromptBuilder.js — Prompt assembly for Discord group chat
// Builds system + user prompts for multi-role group chat LLM calls.
// Follows the same architectural pattern as chatPromptBuilder.js but designed for group scenarios.

import {
    getPhoneCharInfo, getPhoneUserName, getPhoneUserPersona,
    getPhoneWorldBookContext, getCoreFoundationPrompt,
} from '../phoneContext.js';
import {
    loadServerConfig, loadMembers, loadRoles, getMemberColor,
    loadChannelMessages, loadChannelSummary, loadCustomEmojis, consumeTempBioUpdate,
    getChannelPermissions,
} from './discordStorage.js';

const LOG = '[Discord Prompt]';

// ═══════════════════════════════════════════════════════════════════════
// Group Chat System Prompt
// ═══════════════════════════════════════════════════════════════════════

/**
 * Build the system prompt for a group chat LLM call.
 * @param {string} channelId - The channel where the conversation is happening
 * @param {Array} respondingMembers - Array of member objects who will respond
 * @returns {Promise<string>} The assembled system prompt
 */
export async function buildGroupChatSystemPrompt(channelId, respondingMembers) {
    const charInfo = getPhoneCharInfo();
    const charName = charInfo?.name || '角色';
    const userName = getPhoneUserName();

    // ─── Core Foundation (生态圈奠基石) ───
    const foundation = getCoreFoundationPrompt();

    // ─── Server & Channel Context ───
    const serverConfig = loadServerConfig();
    const serverName = serverConfig?.name || '社区';
    const channelName = _getChannelName(channelId, serverConfig);
    const channelTopic = _getChannelTopic(channelId, serverConfig);

    // ─── Character Profile (主角角色卡) ───
    const charDesc = charInfo?.description
        ? `<char_profile>\n角色名: ${charName}\n${charInfo.description}\n</char_profile>`
        : `<char_profile>\n你是${charName}，${userName}的恋人，也是社区的管理员。\n</char_profile>`;

    // ─── User Persona ───
    const userPersonaText = getPhoneUserPersona();
    const userPersona = userPersonaText
        ? `<user_persona>\n以下是${userName}的人设信息：\n${userPersonaText}\n</user_persona>`
        : '';

    // ─── World Book Context ───
    // Use channel chat history for WI keyword scanning
    const channelMessages = loadChannelMessages(channelId);
    const chatForWI = _buildChannelChatForWI(channelMessages);
    const worldBookText = await getPhoneWorldBookContext(chatForWI);
    const worldBookBlock = worldBookText
        ? `<world_info>\n以下是相关的世界观和记忆设定：\n${worldBookText}\n</world_info>`
        : '';

    // ─── Community Members (参与回复的成员人设) ───
    const membersBlock = _buildMembersBlock(respondingMembers, charName, userName);

    // ─── Custom Emojis ───
    const emojisBlock = _buildEmojisBlock();

    // ─── Group Chat Rules ───
    const rulesBlock = _buildGroupChatRules(charName, userName, respondingMembers, channelName, channelTopic);

    // ─── Output Format ───
    const outputFormat = _buildOutputFormat(respondingMembers);

    // ─── Channel Permission Context ───
    const channelPerms = getChannelPermissions(channelId);
    let permBlock = '';
    if (channelPerms.length > 0) {
        const roles = loadRoles();
        const permRoleNames = channelPerms
            .map(rid => roles.find(r => r.id === rid)?.name)
            .filter(Boolean);
        permBlock = `\n此频道设有发言权限限制，仅以下身份组可以发言：${permRoleNames.join('、')}。\n只有拥有这些身份组的成员才会出现在本次回复中。`;
    }

    // ─── Assemble ───
    const topicLine = channelTopic
        ? `\n本频道的主题/话题方向：「${channelTopic}」\n成员在此频道的聊天应围绕这个主题方向展开。偶尔的闲聊串场自然可以，但主线话题必须与频道主题相关。`
        : '';

    const result = `${foundation}

<discord_channel>
你现在处于 Discord 社区服务器「${serverName}」的「#${channelName}」频道中。
这是由 ${userName} 和 ${charName} 共同管理的社区。
你需要同时扮演多位社区成员，在群聊中自然地回复。${permBlock}${topicLine}
</discord_channel>

${charDesc}

${userPersona}

${worldBookBlock}

${membersBlock}

${emojisBlock}

${rulesBlock}

${outputFormat}`;

    console.log(`${LOG} System prompt built: ~${result.length} chars, ${respondingMembers.length} responding members`);
    return result;
}

// ═══════════════════════════════════════════════════════════════════════
// Group Chat User Prompt
// ═══════════════════════════════════════════════════════════════════════

/**
 * Build the user prompt for a group chat LLM call.
 * @param {string} channelId - Channel ID
 * @param {string|string[]} userMessages - The user's message text(s) (supports multi-message drafts)
 * @param {Array} mentions - Array of mentioned member IDs
 * @param {boolean} hasImage - Whether user attached an image
 * @param {number} excludeLastN - Number of trailing messages to exclude from chat_history
 *   (the user's messages were already appended to storage before prompt building;
 *    they're shown separately in the explicit user message block)
 * @returns {string} The assembled user prompt
 */
export function buildGroupChatUserPrompt(channelId, userMessages, mentions = [], hasImage = false, excludeLastN = 0) {
    const parts = [];
    const charName = getPhoneCharInfo()?.name || '角色';
    const userName = getPhoneUserName();
    const members = loadMembers();

    // Normalize: accept single string or array
    const messageTexts = Array.isArray(userMessages) ? userMessages : [userMessages];

    // ─── Channel Rolling Summary (频道滚动总结) ───
    const summary = loadChannelSummary(channelId);
    if (summary?.summary) {
        parts.push(`<channel_summary>\n以下是本频道之前的聊天总结：\n${summary.summary}\n</channel_summary>`);
    }

    // ─── Recent Channel History (最近聊天记录) ───
    // Exclude the user's newly sent messages (they appear in the explicit block below)
    // so the LLM doesn't see them twice and get confused about indices.
    const messages = loadChannelMessages(channelId);
    const unsummarized = messages.filter(m => !m.summarized);
    const historyPool = excludeLastN > 0
        ? unsummarized.slice(0, unsummarized.length - excludeLastN)
        : unsummarized;
    const recent = historyPool.slice(-30);

    // ─── Split into old context (no index) and recent indexable (with [N]) ───
    // Find the boundary: the last user message in the pool marks the start of
    // the "previous round". Only messages from that point onward get indices
    // so the LLM can only reference recent messages via replyToIndex.
    const userMemberId = _getUserMemberId(members);
    const recentIndexableStart = _findLastRoundStart(recent, userMemberId);

    // Build id → index map ONLY for indexable messages
    const idToIndex = {};
    let indexCounter = 1;
    for (let i = recentIndexableStart; i < recent.length; i++) {
        idToIndex[recent[i].id] = indexCounter++;
    }

    if (recent.length > 0) {
        const historyLines = recent.map((msg, idx) => {
            const authorName = msg.authorName || _getMemberName(msg.authorId, members);
            const content = msg.content.substring(0, 300);
            // Show which message was replied to for threading context
            let replyTag = '';
            if (msg.replyTo) {
                const repliedIdx = idToIndex[msg.replyTo];
                replyTag = repliedIdx ? ` [回复→${repliedIdx}]` : '';
            }

            if (idx < recentIndexableStart) {
                // Old context: no index, LLM cannot reference these
                return `${authorName}: ${content}`;
            } else {
                // Recent: with [N] index, LLM can use replyToIndex
                const displayIdx = idToIndex[msg.id];
                return `[${displayIdx}] ${authorName}${replyTag}: ${content}`;
            }
        });
        parts.push(`<chat_history>
以下是最近的聊天记录。只有带 [N] 序号的消息可以被 replyToIndex 引用。
没有序号的是更早的上下文，仅供了解话题背景。
${historyLines.join('\n')}
</chat_history>`);
    }

    // ─── Time Context (时间感知) ───
    const hour = new Date().getHours();
    const minute = new Date().getMinutes();
    let timeOfDay;
    if (hour >= 5 && hour < 9) timeOfDay = 'early morning';
    else if (hour >= 9 && hour < 12) timeOfDay = 'morning';
    else if (hour >= 12 && hour < 14) timeOfDay = 'midday';
    else if (hour >= 14 && hour < 18) timeOfDay = 'afternoon';
    else if (hour >= 18 && hour < 22) timeOfDay = 'evening';
    else timeOfDay = 'late night';

    parts.push(`<time_context>\nCurrent time: ${hour}:${String(minute).padStart(2, '0')} (${timeOfDay})\n</time_context>`);

    // ─── Current User Message(s) + Mentions ───
    let userMsgBlock;
    if (messageTexts.length === 1) {
        userMsgBlock = `${userName} 在群聊中发送了消息：\n${messageTexts[0]}`;
    } else {
        const numbered = messageTexts.map((t, i) => `${i + 1}. ${t}`).join('\n');
        userMsgBlock = `${userName} 在群聊中连续发送了 ${messageTexts.length} 条消息：\n${numbered}`;
    }
    if (mentions.length > 0) {
        const mentionNames = mentions
            .map(id => _getMemberName(id, members))
            .filter(Boolean);
        if (mentionNames.length > 0) {
            userMsgBlock += `\n\n${userName} @ 提及了：${mentionNames.join('、')}`;
        }
    }
    // ─── Image Context (图片上下文) ───
    if (hasImage) {
        userMsgBlock += `\n\n${userName} 同时发送了一张图片。请根据图片内容自然地回应，就像群友之间分享照片时的反应一样（评论图片内容、直接回应等）。`;
    }
    parts.push(userMsgBlock);

    // ─── Temp Bio Update Injection ───
    const tempBio = consumeTempBioUpdate();
    if (tempBio) {
        parts.push(tempBio);
    }

    return parts.join('\n\n');
}

// ═══════════════════════════════════════════════════════════════════════
// Channel Summarize Prompt (消息压缩总结)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Build a system prompt for compressing channel chat history into a rolling summary.
 * @returns {string}
 */
export function buildChannelSummarizePrompt() {
    const charName = getPhoneCharInfo()?.name || '角色';
    const userName = getPhoneUserName();

    return `${getCoreFoundationPrompt()}

你是 Discord 社区群聊的档案压缩助手。
请将以下群聊记录压缩为一份简洁但完整的概要，供后续群聊时作为上下文参考。

压缩要求：
1. 保留所有重要话题、讨论结论、情感转折——这些是成员继续聊天时需要"记得"的内容
2. 注明每个话题的主要参与者（使用成员名字）
3. 按时间顺序组织，注明话题转换
4. 区分已完结的话题和仍在进行中的话题（进行中用【进行中】标记）
5. 保留能体现成员性格和互动模式的关键对话片段
6. 字数控制在300-600字
7. 如果有旧总结，可以适当抛弃`;
}

// ═══════════════════════════════════════════════════════════════════════
// Auto-Conversation Prompt (自动群聊)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Build the system prompt for an automatic group conversation (no user message).
 * @param {string} channelId - Channel ID
 * @param {Array} respondingMembers - Members who will participate
 * @returns {Promise<string>}
 */
export async function buildAutoConversationSystemPrompt(channelId, respondingMembers) {
    // Reuse the main system prompt builder
    return await buildGroupChatSystemPrompt(channelId, respondingMembers);
}

/**
 * Build the user prompt for an automatic group conversation.
 * @param {string} channelId - Channel ID
 * @returns {string}
 */
export function buildAutoConversationUserPrompt(channelId) {
    const parts = [];
    const members = loadMembers();

    // ─── Channel Summary ───
    const summary = loadChannelSummary(channelId);
    if (summary?.summary) {
        parts.push(`<channel_summary>\n${summary.summary}\n</channel_summary>`);
    }

    // ─── Recent History (fewer messages for auto-chat) ───
    let messages = loadChannelMessages(channelId);
    messages = messages.filter(m => !m.summarized);
    const recent = messages.slice(-15);
    if (recent.length > 0) {
        const historyLines = recent.map(msg => {
            const authorName = msg.authorName || _getMemberName(msg.authorId, members);
            return `${authorName}: ${msg.content.substring(0, 200)}`;
        });
        parts.push(`<chat_history>\n${historyLines.join('\n')}\n</chat_history>`);
    }

    // ─── Time Context ───
    const hour = new Date().getHours();
    const minute = new Date().getMinutes();
    parts.push(`<time_context>\nCurrent time: ${hour}:${String(minute).padStart(2, '0')}\n</time_context>`);

    // ─── Auto-chat instruction (with channel topic awareness) ───
    const serverConfig = loadServerConfig();
    const channelTopic = _getChannelTopic(channelId, serverConfig);
    const topicGuidance = channelTopic
        ? `\n\n【频道话题方向】本频道的主题是「${channelTopic}」。成员们的聊天内容应与频道主题相关或自然衍生，不要在本频道讨论完全无关的话题。`
        : '';

    parts.push(`社区成员们正在自由聊天。请生成一段自然的群聊对话。
成员们应该聊自己感兴趣的话题——分享日常、吐槽工作/学习、讨论兴趣爱好、接续之前的话题等。
每个成员都有自己的生活和关注点，不要让所有人围绕同一个话题或同一个人。
保持对话轻松自然，像真实的 Discord 群聊一样。${topicGuidance}`);

    return parts.join('\n\n');
}

// ═══════════════════════════════════════════════════════════════════════
// Internal Helpers
// ═══════════════════════════════════════════════════════════════════════

/**
 * Build the <community_members> prompt block for responding members.
 */
function _buildMembersBlock(respondingMembers, charName, userName) {
    if (!respondingMembers || respondingMembers.length === 0) return '';

    const roles = loadRoles();
    const roleMap = {};
    for (const r of roles) roleMap[r.id] = r;

    const memberLines = respondingMembers
        .filter(m => !m.isUser) // Never include user in member descriptions
        .map(m => {
            // Get role names for this member
            const roleNames = (m.roles || [])
                .map(rid => roleMap[rid]?.name)
                .filter(Boolean)
                .join(', ');
            const roleStr = roleNames ? `(${roleNames})` : '';

            if (m.isProtagonist) {
                // Protagonist: full persona comes from <char_profile>, just note the role
                return `- **${m.name}** ${roleStr} — 完整人设已在 <char_profile> 中提供。`;
            }

            // NPC members: use their concise personality field
            const personality = m.personality || m.bio || '普通社区成员';
            return `- **${m.name}** [ID: ${m.id}] ${roleStr} — ${personality}`;
        });

    return `<community_members>
以下是参与本次回复的社区成员。每个人都有独立人格，请分别扮演：

${memberLines.join('\n')}

注意：${charName} 的完整人设已在 <char_profile> 中提供，无需重复。
其她成员的回复应符合各自的简洁人设描述。
</community_members>

<community_context>
社交距离设定——这是一个线上兴趣社区，成员之间的关系是「网友/群友」：
- 成员们不了解 ${userName} 的现实生活细节（住哪里、家里什么样、日常行程等），除非 ${userName} 自己在聊天中主动提及
- 成员们不会主动询问或评论 ${userName} 的家庭、住所、私人生活等隐私话题
- 成员之间的了解程度仅限于在社区群聊中自然产生的互动和信息
- 只有 ${charName} 作为 ${userName} 的恋人，才了解 ${userName} 的私人生活

独立灵魂设定——每个成员都有自己的生活、兴趣和话题：
- 成员们有自己的日常生活、工作、学习、爱好，不只是围着 ${userName} 打转
- 成员们会主动发起自己感兴趣的话题（吐槽工作、分享日常、聊兴趣爱好、讨论新闻热点等）
- 成员之间可以形成独立于 ${userName} 的社交关系和互动（比如两个成员之间的对话）
- 群聊不应该总是以 ${userName} 为中心——有时候成员们在聊自己的事，${userName} 是旁观者或偶尔插话
- 当 ${userName} 没说话时，成员们该继续自己的话题，而不是反复@或等待 ${userName}
</community_members>`;
}

/**
 * Build the custom emojis block.
 */
function _buildEmojisBlock() {
    const emojis = loadCustomEmojis();
    if (!emojis || emojis.length === 0) return '';

    const emojiNames = emojis.map(e => `:${e.name}:`).join(' ');
    return `<available_emojis>
可用自定义表情：${emojiNames}
成员可以在消息中使用 :表情名: 格式引用自定义表情。
</available_emojis>`;
}

/**
 * Build the group chat behavior rules.
 */
function _buildGroupChatRules(charName, userName, respondingMembers, channelName = '', channelTopic = '') {
    const memberCount = respondingMembers.filter(m => !m.isUser).length;

    // Build topic anchor rule if channel has a topic
    const topicAnchorRule = channelTopic
        ? `\n16. 【话题锚点】当前频道「#${channelName}」的主题方向是「${channelTopic}」。所有成员的聊天内容必须与此频道主题相关或自然衍生。不要在本频道讨论与主题完全无关的话题——这是分频道存在的意义。偶尔一两句闲聊串场是自然的，但不应该偏离主线太远`
        : '';

    return `<group_chat_rules>
1. 每个成员的回复必须符合各自的人设和说话风格
2. 成员之间可以互相对话、插话、接梗、互怼——群聊应该感觉像真实的 Discord 服务器
3. 不必每个成员都对用户消息作出回应——有些人可能只回复其她成员，有些人可能只点个表情
4. 对话要自然、随意，语言风格像真实群聊（简短、碎片化、各有性格）
5. ${charName} 作为 ${userName} 的恋人，回复时体现亲密关系但保持群聊场合的自然度
6. 使用 ${charName} profile 中的语言进行回复（如 ${charName} 说英语则用英语）
7. 每位成员的单条消息保持简短（1-3 句话），不要写长段落
8. 同一个成员可以连续发送多条消息（就像真实 Discord 中会连发几条一样：先说一个想法、再追加补充、或发表情包等）
9. 可以生成 1-${Math.min(memberCount * 2, 10)} 条消息，不需要每个成员都说话
10. 禁止任何第三人称叙述或动作描写——所有输出都是纯粹的群聊文字消息
11. 在合适的时候可以使用 Discord markdown 语法来丰富消息表达（如加粗、斜体、代码块、引用等）
12. 成员可以用 <图片>图片内容描述</图片> 来「发送图片」——在消息文本中用此标签包裹对图片的详细描述（如自拍、美食、风景、宠物等）。偶尔使用即可，不要每条消息都发图
13. 可以使用 replyToIndex 引用 chat_history 中带 [N] 序号的消息进行回复（就像 Discord 中引用某条消息回复一样），不用每条都引用，只在明确回应某条消息时使用。不要引用没有序号的旧消息
14. 【社交距离红线】普通成员不得对 ${userName} 的家庭细节、住所环境、私人行程等发表评论或提出问题——大家只是网友，不了解彼此的线下生活
15. 【独立灵魂】至少一部分成员的回复应该围绕 ta 们自己的话题或与其她成员的互动，而不是全部集中回应 ${userName}——真实群聊不会所有人同时围着一个人转${topicAnchorRule}
</group_chat_rules>`;
}

/**
 * Build the JSON output format instruction.
 */
function _buildOutputFormat(respondingMembers) {
    // Build a quick lookup of valid member IDs for the LLM
    const validIds = respondingMembers
        .filter(m => !m.isUser)
        .map(m => `"${m.id}" (${m.name})`)
        .join(', ');

    return `<output_format>
你必须以 JSON 数组格式回复（不要用 markdown 代码块包裹）。
每条群聊消息是一个对象：

[
  {
    "authorId": "成员ID",
    "text": "消息内容",
    "delay": 0-5
  },
  {
    "authorId": "另一个成员ID",
    "text": "回复内容",
    "delay": 2,
    "replyToIndex": 5,
    "reaction": { "targetMsgIndex": -1, "emoji": "❤️" }
  }
]

字段说明：
- authorId: 必填。必须从以下成员中选择：${validIds}
- text: 必填。该成员发送的消息文本
- delay: 必填。模拟打字延迟的秒数（0 = 立即，1-5 = 稍后发送）
- replyToIndex: 可选。只能引用 chat_history 中带 [N] 序号的消息（-1 = 最后一条用户消息）。不要引用没有序号的旧消息
- reaction: 可选。对之前消息添加表情反应
  - targetMsgIndex: -1 = 最后一条用户消息，0+ = 本次回复中的消息索引
  - emoji: Unicode emoji 或 :自定义表情名:

注意：
- 数组中的消息按时间顺序排列
- 同一个 authorId 可以出现多次（模拟同一人连发多条消息，就像真实 Discord 一样）
- 不同成员可以穿插回复（模拟真实群聊的异步感）
- 可以有成员只添加 reaction 而不发文字消息（只有 reaction 字段，text 为空字符串）
</output_format>`;
}

/**
 * Get channel name from server config.
 */
function _getChannelName(channelId, serverConfig) {
    if (!serverConfig?.categories) return '未知频道';
    for (const cat of serverConfig.categories) {
        for (const ch of (cat.channels || [])) {
            if (ch.id === channelId) return ch.name;
        }
    }
    return '未知频道';
}

/**
 * Get channel topic from server config.
 * @param {string} channelId
 * @param {Object} serverConfig
 * @returns {string} Channel topic, or empty string if not set
 */
function _getChannelTopic(channelId, serverConfig) {
    if (!serverConfig?.categories) return '';
    for (const cat of serverConfig.categories) {
        for (const ch of (cat.channels || [])) {
            if (ch.id === channelId) return ch.topic || '';
        }
    }
    return '';
}

/**
 * Get the user member's ID from a members array.
 * @param {Array} members
 * @returns {string|null}
 */
function _getUserMemberId(members) {
    const userMember = members?.find(m => m.isUser);
    return userMember?.id || null;
}

/**
 * Find the start index of the "last round" in the recent messages array.
 * The last round starts at the last user message in the history.
 * Everything before that is "old context" and won't get [N] indices.
 * If no user message is found, all messages are considered indexable (index 0).
 *
 * @param {Array} recent - Recent messages array
 * @param {string|null} userMemberId - The user member's ID
 * @returns {number} Start index of the indexable portion
 */
function _findLastRoundStart(recent, userMemberId) {
    if (!userMemberId || recent.length === 0) return 0;

    // Scan backwards to find the last user message
    for (let i = recent.length - 1; i >= 0; i--) {
        if (recent[i].authorId === userMemberId) {
            // The "last round" includes the last user message and everything after it.
            // But we also want to include the previous LLM round that the user was replying to.
            // So find the user message BEFORE this one to set the boundary.
            for (let j = i - 1; j >= 0; j--) {
                if (recent[j].authorId === userMemberId) {
                    // Found the previous user message — start indexing from the message after it
                    return j + 1;
                }
            }
            // No previous user message found — all messages are from this round
            return 0;
        }
    }
    // No user message at all — everything is indexable
    return 0;
}

/**
 * Get member name by ID.
 */
function _getMemberName(memberId, members) {
    const member = members?.find(m => m.id === memberId);
    return member?.name || '未知用户';
}

/**
 * Convert channel messages to the format expected by buildPhoneChatForWI.
 * Channel messages use authorId/authorName/content instead of role/content.
 * @param {Array} channelMessages
 * @returns {string[]} "name: content" format array for WI scanning
 */
function _buildChannelChatForWI(channelMessages) {
    if (!channelMessages || channelMessages.length === 0) return [];

    return channelMessages
        .filter(m => m && m.content && m.content.trim())
        .slice(-50)
        .map(m => `${m.authorName || '未知'}: ${m.content}`);
}
