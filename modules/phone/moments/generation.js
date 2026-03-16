
// modules/moments/generation.js — AI 自动生成 (Post, Comment, Reply, Like)

import { MOMENTS_LOG_PREFIX, logMoments, getCharacterId } from './constants.js';
import { getSettings, getIsGeneratingPost, setIsGeneratingPost, getIsGeneratingComment, setIsGeneratingComment, getIsGeneratingLike, setIsGeneratingLike } from './state.js';
import { callPhoneLLM } from '../../api.js';
import { cleanLlmJson } from '../utils/llmJsonCleaner.js';
import { getPhoneCharInfo, getPhoneUserName, getPhoneRecentChat, getPhoneUserPersona, getPhoneWorldBookContext, getCoreFoundationPrompt, buildPhoneChatForWI } from '../phoneContext.js';
import { markMomentsPostCooldown, isMomentsPostOnCooldown } from '../chat/chatPromptBuilder.js';
import { loadChatHistory } from '../chat/chatStorage.js';
import { addComment, toggleLike } from './apiClient.js';
import { getMyAuthorIds, getBase64FromUrl, showToast } from './momentsHelpers.js';

// ═══════════════════════════════════════════════════════════════════════
// Pending Interactions Queue
// ═══════════════════════════════════════════════════════════════════════

export let pendingInteractions = [];

// ═══════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════

function _isMyPost(post) {
    return getMyAuthorIds().has(post.authorId);
}

function _isMyContent(item) {
    return getMyAuthorIds().has(item.authorId);
}

// ═══════════════════════════════════════════════════════════════════════
// Auto-Post Generation
// ═══════════════════════════════════════════════════════════════════════

export async function maybeGeneratePost() {
    const settings = getSettings();
    if (!settings.enabled || getIsGeneratingPost()) return;
    if (Math.random() > settings.autoPostChance) return;

    // ── Cooldown gate: skip if on cooldown ──
    if (isMomentsPostOnCooldown()) {
        logMoments(`🕐 自动发帖冷却中，跳过本次生成`);
        return;
    }

    const charInfo = getPhoneCharInfo();
    if (!charInfo) return;

    setIsGeneratingPost(true);
    try {
        const chatSnippet = getPhoneRecentChat(8);
        const userName = getPhoneUserName();

        const userPersona = getPhoneUserPersona();
        const worldBookContext = await getPhoneWorldBookContext(buildPhoneChatForWI(loadChatHistory()));

        let avatarData = charInfo.avatar;
        if (avatarData && !avatarData.startsWith('http') && !avatarData.startsWith('data:') && !avatarData.startsWith('/')) {
            const base64 = await getBase64FromUrl(`characters/${avatarData}`);
            if (base64) avatarData = base64;
        }

        const foundation = getCoreFoundationPrompt();
        const systemPrompt = `${foundation}

你需要模拟角色"${charInfo.name}"在社交媒体社交平台上发动态。
角色描述: ${charInfo.description}
用户的设定(User Persona): ${userPersona}
世界设定(World Info): ${worldBookContext}

要求:
- 以"${charInfo.name}"的第一人称发一条社交平台动态
- 内容应该自然、随意，像真人发社交媒体一样
- 可以分享日常、感想、网络内容、或与"${userName}"相关的事
- 内容可以包含纯文本、emoji，以及媒体标签。你可以使用以下四种媒体标签来分享多媒体内容：<图片>描述</图片>，<视频>描述</视频>，<音乐>描述</音乐>，<新闻>描述</新闻>。例如: "<视频>一只正在玩耍的小猫</视频>"。
- 不要加引号或者任何tag系统不认识的格式，不要加"发布"等前缀
- 内容要符合角色设定和世界观，且使用符合角色设定的语言（例如，如果角色是俄罗斯人，就用俄语）
- 注意：这条动态是发布在社交平台上的，是用来表达你的情绪或者记录生活的，而不是与${userName}的对话。
- 绝对禁止：任何侮辱性词语或脏话。`;

        const userPrompt = chatSnippet
            ? `最近的对话:\n${chatSnippet}\n\n根据最近的对话和角色性格，发一条社交平台动态。`
            : `根据角色性格和场景，发一条日常社交平台动态。`;

        const content = await callPhoneLLM(systemPrompt, userPrompt);
        if (content && content.trim()) {
            const { createLocalPost } = await import('./persistence.js');
            await createLocalPost(content.trim(), charInfo.name, avatarData, null, true);
            markMomentsPostCooldown();
            logMoments(`${charInfo.name} 生成了待发布动态: ${content.trim().substring(0, 500)}...`);
        }
    } catch (e) {
        console.warn(`${MOMENTS_LOG_PREFIX} Auto-post generation failed:`, e);
    } finally {
        setIsGeneratingPost(false);
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Auto-Comment Generation (Batched)
// ═══════════════════════════════════════════════════════════════════════

export async function queueComment(post) {
    const settings = getSettings();
    if (!settings.enabled) return;
    if (Math.random() > settings.autoCommentChance) return;
    // 跳过 pending 帖子（草稿未发布）
    if (post.pendingUpload) return;

    const charInfo = getPhoneCharInfo();
    if (!charInfo) return;

    // ── 防重复：如果角色已评论过此帖且无新外部活动，则不再评论 ──
    const myAuthorIds = getMyAuthorIds();
    if (post.comments && post.comments.length > 0) {
        const myCommentTimes = post.comments
            .filter(c => myAuthorIds.has(c.authorId) && !c.replyToId)
            .map(c => new Date(c.createdAt).getTime());
        const myLastCommentTime = myCommentTimes.length > 0 ? Math.max(...myCommentTimes) : 0;
        if (myLastCommentTime > 0) {
            const hasNewExternalActivity = post.comments.some(c =>
                !myAuthorIds.has(c.authorId) &&
                new Date(c.createdAt).getTime() > myLastCommentTime
            );
            if (!hasNewExternalActivity) {
                logMoments(`跳过评论: 帖子 [${post.id}] 无新外部活动`);
                return;
            }
        }
    }

    const myUserName = getPhoneUserName();
    let relationshipDesc = '';

    if (_isMyPost(post)) {
        // This is genuinely my own post (same authorId)
        if (post.authorName === charInfo.name) {
            return; // Don't comment on my own post
        } else {
            relationshipDesc = `这是你的恋人（"${myUserName}"，她的社交平台网名为"${post.authorName}"）在社交平台上发的动态。`;
        }
    } else if (post.authorName === charInfo.name) {
        // 🌀 Parallel-world counterpart: same name but DIFFERENT authorId
        relationshipDesc = `这条动态的发布者与你同名（都叫"${charInfo.name}"），ta是来自另一位用户的角色——你的平行世界同位体。你们虽然有相同的名字和相似的灵魂，但是是完全独立的个体。ta发布的内容是关于ta自己和ta的恋人的，不是关于你和"${myUserName}"的。请以好奇、友好、或你性格中自然的方式互动。`;
    } else {
        relationshipDesc = `这条动态的发布者"${post.authorName}"是"${myUserName}"（你的恋人）的好友或其伴侣。ta发布的内容是关于ta自己的生活和ta自己的恋人的，与你和"${myUserName}"无关。请以礼貌友好的身份互动，不要将帖子中的内容代入到自己身上。`;
    }

    pendingInteractions.push({
        type: 'comment',
        post: post,
        contextDesc: relationshipDesc
    });
}

export async function queueReply(post, comment) {
    const settings = getSettings();
    if (!settings.enabled) return;
    // 跳过 pending 帖子（草稿未发布）
    if (post.pendingUpload) return;

    const charInfo = getPhoneCharInfo();
    if (!charInfo) return;

    if (_isMyContent(comment)) return;

    // ── 防重复：如果已回复过此条评论，不再回复 ──
    const myAuthorIds = getMyAuthorIds();
    if (post.comments) {
        const alreadyReplied = post.comments.some(c =>
            myAuthorIds.has(c.authorId) && c.replyToId === comment.id
        );
        if (alreadyReplied) return;
    }

    let shouldReply = false;
    let relationshipDesc = '';
    const myUserName = getPhoneUserName();

    if (comment.replyToName === charInfo.name) {
        shouldReply = true;
        relationshipDesc = `这条评论是"${comment.authorName}"直接回复给你的。"${comment.authorName}"可能是"${myUserName}"（你的恋人）的好友或其伴侣。如果你不认识对方，请保持礼貌或好奇。`;
    } else if (post.authorName === charInfo.name && !comment.replyToName) {
        if (Math.random() <= 0.8) {
            shouldReply = true;
            relationshipDesc = `这是在你的动态下的一条评论。评论者"${comment.authorName}"可能是"${myUserName}"（你的恋人）的好友或其伴侣。如果你不认识对方，请保持礼貌或好奇。`;
        }
    } else {
        if (Math.random() <= 0.05) {
            shouldReply = true;
            relationshipDesc = `你可以自然地在这个讨论中插入对话。参与者包含"${myUserName}"（你的恋人）的好友或其伴侣。如果你不认识对方，请保持礼貌或好奇。`;
        }
    }

    if (!shouldReply) return;

    pendingInteractions.push({
        type: 'reply',
        post: post,
        comment: comment,
        contextDesc: relationshipDesc
    });
}

export async function processPendingInteractions() {
    const settings = getSettings();
    if (!settings.enabled || pendingInteractions.length === 0 || getIsGeneratingComment()) return;


    const charInfo = getPhoneCharInfo();
    if (!charInfo) {
        pendingInteractions = [];
        return;
    }

    setIsGeneratingComment(true);
    try {
        const batch = [...pendingInteractions];
        pendingInteractions = [];

        const userPersona = getPhoneUserPersona();
        const worldBookContext = await getPhoneWorldBookContext(buildPhoneChatForWI(loadChatHistory()));

        const foundation = getCoreFoundationPrompt();
        const systemPrompt = `${foundation}

这是一个模拟社交平台系统，你是角色"${charInfo.name}"。
角色描述: ${charInfo.description}
用户的设定(User Persona): ${userPersona}
世界设定(World Info): ${worldBookContext}

你正在浏览社交平台。我将给你提供多条你需要互动(评论或回复)的内容。
请以"${charInfo.name}"的身份，用符合角色设定的口吻分别对它们进行回复，像真人一样在社交平台互动（纯文字和emoji即可，不超过500字）。如果需要分享媒体，你可以使用 <图片>描述</图片>，<视频>描述</视频>，<音乐>描述</音乐>，<新闻>描述</新闻> 标签。
如果遇到必须用外语的情况，请使用符合角色设定的语言。
禁止任何侮辱性词语或脏话。

请**只**输出一段合法的 JSON 数组，数组中每个对象包含：
- "id": 对应提供内容的ID
- "response": 你的评论/回复内容
不要输出代码块符号(如 \`\`\`json)，不要输出任何其她文本。`;

        let userPromptItems = [];

        batch.forEach((item, index) => {
            if (item.type === 'comment') {
                userPromptItems.push(
                    `【ID: item_${index}】\n情况说明: ${item.contextDesc}\n动态作者: ${item.post.authorName}\n动态内容: "${item.post.content}"\n请根据以上信息写一条评论。`
                );
            } else if (item.type === 'reply') {
                let msg = `【ID: item_${index}】\n情况说明: ${item.contextDesc}\n（原动态作者: ${item.post.authorName}, 动态内容: "${item.post.content}"）\n`;
                if (item.comment.replyToName) {
                    msg += `${item.comment.authorName} 回复了 ${item.comment.replyToName}: "${item.comment.content}"\n请写一条回复给 ${item.comment.authorName}。`;
                } else {
                    msg += `${item.comment.authorName} 评论道: "${item.comment.content}"\n请写一条回复给 ${item.comment.authorName}。`;
                }
                userPromptItems.push(msg);
            }
        });

        const userPrompt = userPromptItems.join('\n\n-----------------\n\n');

        const resultText = await callPhoneLLM(systemPrompt, userPrompt);
        if (!resultText) return;

        const cleanedText = cleanLlmJson(resultText);

        let responses = [];
        try {
            responses = JSON.parse(cleanedText);
        } catch (err) {
            console.warn(`${MOMENTS_LOG_PREFIX} Failed to parse batched LLM response as JSON. Text was:`, resultText);
            return;
        }

        if (Array.isArray(responses)) {
            let avatarData = charInfo.avatar;
            if (avatarData && !avatarData.startsWith('http') && !avatarData.startsWith('data:') && !avatarData.startsWith('/')) {
                const base64 = await getBase64FromUrl(`characters/${avatarData}`);
                if (base64) avatarData = base64;
            }

            for (const resp of responses) {
                if (resp && resp.id && resp.id.startsWith('item_') && resp.response) {
                    const idx = parseInt(resp.id.split('_')[1], 10);
                    const originalItem = batch[idx];
                    if (originalItem) {
                        if (originalItem.type === 'comment') {
                            await addComment(originalItem.post.id, resp.response.trim(), charInfo.name, null, null, avatarData);
                            showToast(`💬 角色 ${charInfo.name} 发表了评论`);
                        } else if (originalItem.type === 'reply') {
                            await addComment(originalItem.post.id, resp.response.trim(), charInfo.name, originalItem.comment.id, originalItem.comment.authorName, avatarData);
                            showToast(`💬 角色 ${charInfo.name} 回复了评论`);
                        }
                    }
                }
            }
        }

    } catch (e) {
        console.warn(`${MOMENTS_LOG_PREFIX} Batched auto-interaction failed:`, e);
    } finally {
        setIsGeneratingComment(false);
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Auto-Like Generation
// ═══════════════════════════════════════════════════════════════════════

export async function maybeGenerateLike(post) {
    const settings = getSettings();
    if (!settings.enabled || getIsGeneratingLike()) return;
    if (Math.random() > settings.autoLikeChance) return;

    const charInfo = getPhoneCharInfo();
    if (!charInfo) return;

    if (_isMyPost(post)) return;
    if (post.likedByMe) return;

    setIsGeneratingLike(true);
    try {
        await toggleLike(post.id);
        logMoments(`${charInfo.name} 点赞了 ${post.authorName} 的动态`);
    } catch (e) {
        console.warn(`${MOMENTS_LOG_PREFIX} Auto-like failed:`, e);
    } finally {
        setIsGeneratingLike(false);
    }
}
