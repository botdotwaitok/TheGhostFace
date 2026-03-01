
// modules/moments/generation.js — AI 自动生成 (Post, Comment, Reply, Like)

import { MOMENTS_LOG_PREFIX, logMoments } from './constants.js';
import { getSettings, getIsGeneratingPost, setIsGeneratingPost, getIsGeneratingComment, setIsGeneratingComment, getIsGeneratingLike, setIsGeneratingLike } from './state.js';
import { callCustomOpenAI, useMomentCustomApi } from '../api.js';
import { getExistingWorldBookContext } from '../worldbook.js';
import { getContext } from '../../../../../extensions.js';
import { addComment, toggleLike } from './apiClient.js';

// ═══════════════════════════════════════════════════════════════════════
// Pending Interactions Queue
// ═══════════════════════════════════════════════════════════════════════

export let pendingInteractions = [];

// ═══════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════

function _getCharacterInfo() {
    try {
        const context = getContext();
        const charId = context.characterId;
        const charData = (context.characters ?? [])[charId];
        if (!charData) return null;

        return {
            name: charData.name || context.name2 || 'Character',
            description: charData.description || charData.data?.description || '',
            personality: charData.personality || charData.data?.personality || '',
            scenario: charData.scenario || charData.data?.scenario || '',
            avatar: charData.avatar || '',
        };
    } catch (e) {
        console.warn(`${MOMENTS_LOG_PREFIX} getCharacterInfo failed:`, e);
        return null;
    }
}

function _getUserName() {
    try {
        const context = getContext();
        return context.name1 || 'User';
    } catch {
        return 'User';
    }
}

function _getRecentChatSnippet(maxMessages = 10) {
    try {
        const context = getContext();
        const chat = context.chat;
        if (!chat || chat.length === 0) return '';

        const recent = chat.slice(-maxMessages);
        return recent.map(msg => {
            const role = msg.is_user ? 'User' : 'Character';
            const text = (msg.mes || '').substring(0, 200);
            return `${role}: ${text}`;
        }).join('\n');
    } catch {
        return '';
    }
}

async function getBase64FromUrl(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) return '';
        const blob = await response.blob();
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = () => resolve('');
            reader.readAsDataURL(blob);
        });
    } catch (e) {
        console.warn(`${MOMENTS_LOG_PREFIX} Failed to convert image to base64: ${url}`, e);
        return '';
    }
}

function _showToast(msg) {
    try {
        const container = document.getElementById('moments_toast_container');
        if (container) {
            const toast = document.createElement('div');
            toast.className = 'moments-toast moments-toast-show';
            toast.textContent = msg;
            container.appendChild(toast);
            setTimeout(() => toast.remove(), 2500);
        }
    } catch { }
}

// ═══════════════════════════════════════════════════════════════════════
// Auto-Post Generation
// ═══════════════════════════════════════════════════════════════════════

export async function maybeGeneratePost() {
    const settings = getSettings();
    if (!settings.enabled || getIsGeneratingPost() || !useMomentCustomApi) return;
    if (Math.random() > settings.autoPostChance) return;

    const charInfo = _getCharacterInfo();
    if (!charInfo) return;

    setIsGeneratingPost(true);
    try {
        const chatSnippet = _getRecentChatSnippet(8);
        const userName = _getUserName();

        const context = getContext();
        const userPersona = context.powerUserSettings?.persona_description || '';
        const worldBookContext = await getExistingWorldBookContext();

        let avatarData = charInfo.avatar;
        if (avatarData && !avatarData.startsWith('http') && !avatarData.startsWith('data:') && !avatarData.startsWith('/')) {
            const base64 = await getBase64FromUrl(`characters/${avatarData}`);
            if (base64) avatarData = base64;
        }

        const systemPrompt = `你需要模拟角色"${charInfo.name}"在社交媒体社交平台上发动态。
角色描述: ${charInfo.description.substring(0, 2000)}
用户的设定(User Persona): ${userPersona.substring(0, 2000)}
世界设定(World Info): ${worldBookContext.substring(0, 20000)}

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

        const content = await callCustomOpenAI(systemPrompt, userPrompt);
        if (content && content.trim()) {
            const { createLocalPost } = await import('./persistence.js');
            await createLocalPost(content.trim(), charInfo.name, avatarData, null, true);
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

    const charInfo = _getCharacterInfo();
    if (!charInfo) return;

    const myUserName = _getUserName();
    let relationshipDesc = '';

    if (post.authorId === settings.userId || post.authorId === 'guest') {
        if (post.authorName === charInfo.name) {
            return;
        } else {
            relationshipDesc = `这是你的恋人（"${myUserName}"，她的社交平台网名为"${post.authorName}"）在社交平台上发的动态。`;
        }
    } else {
        relationshipDesc = `这条动态的发布者"${post.authorName}"是"${myUserName}"（你的恋人）的好友，或者是该好友的伴侣。如果你在设定里不认识对方，请当作是对你恋人朋友的礼貌互动或善意的好奇。`;
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

    const charInfo = _getCharacterInfo();
    if (!charInfo) return;

    if (comment.authorName === charInfo.name) return;

    let shouldReply = false;
    let relationshipDesc = '';
    const myUserName = _getUserName();

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
    if (!useMomentCustomApi) {
        pendingInteractions = [];
        return;
    }

    const charInfo = _getCharacterInfo();
    if (!charInfo) {
        pendingInteractions = [];
        return;
    }

    setIsGeneratingComment(true);
    try {
        const batch = [...pendingInteractions];
        pendingInteractions = [];

        const context = getContext();
        const userPersona = context.powerUserSettings?.persona_description || '';
        const worldBookContext = await getExistingWorldBookContext();

        const systemPrompt = `这是一个模拟社交平台系统，你是角色"${charInfo.name}"。
角色描述: ${charInfo.description.substring(0, 1500)}
用户的设定(User Persona): ${userPersona.substring(0, 1000)}
世界设定(World Info): ${worldBookContext.substring(0, 3000)}

你正在浏览社交平台。我将给你提供多条你需要互动(评论或回复)的内容。
请以"${charInfo.name}"的身份，用符合角色设定的口吻分别对它们进行回复，像真人一样在社交平台互动（纯文字和emoji即可，不超过500字）。如果需要分享媒体，你可以使用 <图片>描述</图片>，<视频>描述</视频>，<音乐>描述</音乐>，<新闻>描述</新闻> 标签。
如果遇到必须用外语的情况，请使用符合角色设定的语言。
禁止任何侮辱性词语或脏话。

请**只**输出一段合法的 JSON 数组，数组中每个对象包含：
- "id": 对应提供内容的ID
- "response": 你的评论/回复内容
不要输出代码块符号(如 \`\`\`json)，不要输出任何其他文本。`;

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

        const resultText = await callCustomOpenAI(systemPrompt, userPrompt);
        if (!resultText) return;

        const cleanedText = resultText.replace(/```json/g, '').replace(/```/g, '').trim();

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
                            _showToast(`💬 角色 ${charInfo.name} 发表了评论`);
                        } else if (originalItem.type === 'reply') {
                            await addComment(originalItem.post.id, resp.response.trim(), charInfo.name, originalItem.comment.id, originalItem.comment.authorName, avatarData);
                            _showToast(`💬 角色 ${charInfo.name} 回复了评论`);
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

    const charInfo = _getCharacterInfo();
    if (!charInfo) return;

    if (post.authorName === charInfo.name) return;
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
