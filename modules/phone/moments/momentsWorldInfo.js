
// modules/moments/momentsWorldInfo.js — LLM 集成 (World Info & Chat Output Parsing)

import { MOMENTS_LOG_PREFIX, logMoments, getCharacterId } from './constants.js';
import { getSettings, getFeedCache } from './state.js';
import { addComment } from './apiClient.js';
import { createLocalPost } from './persistence.js';
import { useMomentCustomApi } from '../../api.js';
import { markMomentsPostCooldown, isMomentsPostOnCooldown } from '../chat/chatPromptBuilder.js';
import { getContext } from '../../../../../../extensions.js';
import { getCharacterInfo, getUserNameFallback, getMyAuthorIds, getCharAuthorId, getBase64FromUrl, showToast } from './momentsHelpers.js';
// (Helpers moved to momentsHelpers.js)

// ═══════════════════════════════════════════════════════════════════════
// Mutual Sync (Main LLM Integration)
// ═══════════════════════════════════════════════════════════════════════

export async function updateMomentsWorldInfo() {
    try {
        // Import WI utilities
        const { saveWorldInfo, loadWorldInfo } = await import('../../../../../../world-info.js');
        const { findActiveWorldBook } = await import('../../utils.js');

        const worldBookName = await findActiveWorldBook();
        if (!worldBookName) return;

        const WI_KEY = 'm_feed';
        const wb = await loadWorldInfo(worldBookName);
        let targetEntry = Object.values(wb.entries).find(e => e.key && e.key.includes(WI_KEY));

        const settings = getSettings();
        const feedCache = getFeedCache();

        if (!settings.enabled || feedCache.length === 0) {
            if (targetEntry && !targetEntry.disable) {
                targetEntry.disable = true;
                await saveWorldInfo(worldBookName, wb);
            }
            return;
        }

        // Format recent feed
        const recentPosts = feedCache.filter(p => !p.pendingUpload).slice(0, 5);
        const charInfo = getCharacterInfo();
        const myCharName = charInfo ? charInfo.name : null;
        const myAuthorIds = getMyAuthorIds();

        const userName = getUserNameFallback();
        const feedText = recentPosts.map(p => {
            const timeStr = new Date(p.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const shortId = p.id.split('_').pop().slice(-5);

            // 只检查角色自身是否评论过（不混入用户 ID）
            const charAuthorId = getCharAuthorId();
            let postReplied = p.comments?.some(c => c.authorId === charAuthorId && !c.replyToId);
            // 检测帖子是否有新的外部活动（自角色上次评论后）
            let noNewActivity = false;
            if (postReplied && p.comments) {
                const myCommentTimes = p.comments
                    .filter(c => c.authorId === charAuthorId && !c.replyToId)
                    .map(c => new Date(c.createdAt).getTime());
                const myLastCommentTime = myCommentTimes.length > 0 ? Math.max(...myCommentTimes) : 0;
                noNewActivity = myLastCommentTime > 0 && !p.comments.some(c =>
                    c.authorId !== charAuthorId &&
                    new Date(c.createdAt).getTime() > myLastCommentTime
                );
            }
            const isCounterpart = myCharName && p.authorName === myCharName && !myAuthorIds.has(p.authorId);
            // 确定帖子归属关系标签
            let ownerLabel = '';
            if (myAuthorIds.has(p.authorId) && p.authorName !== myCharName) {
                ownerLabel = ` [${userName}发布]`;
            } else if (isCounterpart) {
                ownerLabel = ` [⚡同位体·非你本人·来自其她用户的角色]`;
            } else if (!myAuthorIds.has(p.authorId) && p.authorName !== myCharName) {
                ownerLabel = ` [${userName}的好友或其伴侣发布]`;
            }
            let text = `【帖子】[ID:${shortId}] [${p.authorName}]${ownerLabel} (${timeStr}): ${p.content}${postReplied ? (noNewActivity ? ' [你已评论][无新互动，请勿再评论此帖]' : ' [你已评论]') : ''}`;

            if (p.comments && p.comments.length > 0) {
                const recentComments = p.comments.slice(-5).map(c => {
                    const cShortId = c.id.split('_').pop().slice(-5);
                    const replyStr = c.replyToName ? ` 回复 ${c.replyToName}` : '';
                    let commentReplied = p.comments.some(replyC => replyC.authorId === charAuthorId && replyC.replyToId === c.id);
                    return `  - 【评论】[ID:${cShortId}] ${c.authorName}${replyStr}: ${c.content}${commentReplied ? ' [你已回复]' : ''}`;
                }).join('\n');
                text += '\n' + recentComments;
            }
            return text;
        }).join('\n\n');


        let baseText = `
        <gf_moments>
        【社交网络系统】
        {{char}}有着丰富的网络社交活动，ta会发朋友圈记录生活和感受，打卡app记录，分享网络内容（例如有趣的新闻和视频等），也会和亲朋好友们的动态进行互动。
        在完成正文的之后，{{char}}必须使用严格的格式来发朋友圈或评论或回复：
- 发动态格式：(朋友圈: 你要发的内容)
- 评论动态格式：(评论 ID: 你的评论内容)

⚠️格式严格警告：
1. 绝对不要对已经被标记了"[你已评论]"或"[你已回复]"的内容进行任何回复！那代表你已经回复过了！如果再次回复会让别人觉得奇怪，所以绝对不可以！特别是被标记了"[无新互动，请勿再评论此帖]"的帖子，绝对禁止再次评论或在该帖下查找可以回复的评论！
2. 绝对不要在括号内或外添加 【帖子】[ID:xxx]、【评论】[ID:xxx] 或 [角色名 回复] 等前缀，直接写内容！
3. 错误示范：(朋友圈: 评论xxx) 【评论】[ID:123] 回复: 内容...
4. 正确评论示范：(评论 92808: 居然是这样！太有趣了。)
5. 请直接使用动态列表中被评论者的5位字母数字ID。
6. 鼓励批量回复多条评论，也可以同时发布朋友圈。


多媒体：可使用 <图片>描述</图片>, <视频>描述</视频>, <音乐>描述</音乐>, <新闻>描述</新闻>。
⚠️身份规则（重要）：
- 你是"${myCharName}"，你的恋人是"${userName}"。
- 如果帖子标注了"[${userName}发布]"，代表你的恋人本人发的动态，ta的社交平台网名可能和本名不同。
- 如果帖子标注了"[${userName}的好友或其伴侣发布]"，说明这是别人发的帖子，帖子中提到的内容是关于ta自己和ta自己恋人的事，与你和"${userName}"无关，不要代入到你自己身上。
- 如果帖子标注了"[⚡同位体·非你本人·来自其她用户的角色]"，说明这是来自另一位用户的角色，ta和你同名、是你的平行世界分身，但你们是完全独立的个体。ta发的帖子是关于ta自己和ta的恋人的，不是关于你的。
- 社交平台用来表达情绪或记录生活，非纯粹对话。绝禁脏话。
以下是{{char}}的社交平台实时动态。
注意：无需在正文中提及朋友圈或评论，直接发即可。

<current_posts_comments>
`;

        const entryContent = `${baseText}\n${feedText}\n\n</current_posts_comments>\n\n</gf_moments>
        `;

        if (!targetEntry) {
            let maxId = 0;
            Object.keys(wb.entries).forEach(id => {
                const num = parseInt(id);
                if (!isNaN(num) && num > maxId) maxId = num;
            });
            const newId = maxId + 1;

            wb.entries[newId] = {
                uid: newId,
                key: [WI_KEY, '朋友圈'],
                comment: '朋友圈实时动态 (Auto-generated)',
                content: entryContent,
                constant: true,
                position: 4,
                depth: 1,
                order: 999,
                disable: false,
                excludeRecursion: true,
                preventRecursion: true,
                displayIndex: 0
            };
        } else {
            targetEntry.content = entryContent;
            targetEntry.disable = false;
            targetEntry.position = 4;
            targetEntry.depth = 1;
            targetEntry.order = 999;
            targetEntry.excludeRecursion = true;
            targetEntry.preventRecursion = true;
        }

        await saveWorldInfo(worldBookName, wb);
    } catch (e) {
        console.warn(`${MOMENTS_LOG_PREFIX} Update WI failed:`, e);
    }
}

export function getMomentsSystemPrompt() {
    const settings = getSettings();
    if (!settings.enabled) return '';
    const protocolText = `
[MOMENTS PROTOCOL]
Recent social feed is in World Info. To interact:
- Post: (朋友圈: your text)
- Comment on a post or reply to a comment: (评论 ID: your text)

【FORMATTING RULES - CRITICAL】
1. Example using a 5-character ID: (评论 a1b2c: Hello there!)
2. DO NOT use names in the command, ONLY use the 5-character ID.
3. DO NOT output fake IDs or prefix your text with 【帖子】[ID:xxx], 【评论】[ID:xxx] or [Name] outside or inside the command.
4. ALWAYS output the pure text inside the command syntax.`;

    if (!useMomentCustomApi) {
        return protocolText + `\n\n【IMPORTANT】在你正常回复用户之后，如果想互动，你**必须**严格使用以上 (朋友圈: ...) 或 (评论 ID: ...) 的格式在回复的最末尾。绝不要混淆发动态和评论的功能。`;
    }
    return protocolText;
}

export async function handleMainChatOutput(content) {
    const settings = getSettings();
    if (!settings.enabled || !content) return false;

    let posted = false;
    const feedCache = getFeedCache();

    // ── Cooldown gate: skip new posts if on cooldown ──
    const postCooldownActive = isMomentsPostOnCooldown();

    // Regex for (朋友圈: ...)
    const postMatches = Array.from(content.matchAll(/\((?:朋友圈|Moments):\s*(.+?)\)/gi));
    for (const postMatch of postMatches) {
        if (postMatch && postMatch[1]) {
            const text = postMatch[1].trim();
            if (text) {
                // Block if on cooldown
                if (postCooldownActive) {
                    console.log(`${MOMENTS_LOG_PREFIX} 🕐 朋友圈发帖冷却中，跳过: ${text.substring(0, 50)}...`);
                    continue;
                }
                const charInfo = getCharacterInfo();
                let avatarData = charInfo?.avatar;
                if (avatarData && !avatarData.startsWith('http') && !avatarData.startsWith('data:') && !avatarData.startsWith('/')) {
                    const base64 = await getBase64FromUrl(`characters/${avatarData}`);
                    if (base64) avatarData = base64;
                }
                await createLocalPost(text, charInfo?.name, avatarData, null, true);
                logMoments(`📝 ${charInfo.name} 的朋友圈草稿等你审核: ${text}`);
                showToast && showToast(`已生成待发布草稿`);
                markMomentsPostCooldown();
                posted = true;
            }
        }
    }

    // Regex for (评论 ID: ...) or (评论 e23d7: ...) or (评论: ...)
    const commentMatches = Array.from(content.matchAll(/\((?:评论|Comment)\s*(?:ID:?)?\s*([a-zA-Z0-9_-]+)?\s*:\s*(.+?)\)/gi));
    for (const commentMatch of commentMatches) {
        if (commentMatch && commentMatch[2]) {
            const targetId = commentMatch[1];
            const text = commentMatch[2].trim();
            if (text && feedCache.length > 0) {
                let targetPost = null;
                let targetComment = null;

                if (targetId) {
                    const cleanTargetId = targetId.toLowerCase().trim();
                    for (const p of feedCache) {
                        if (p.id.toLowerCase().trim().endsWith(cleanTargetId)) {
                            targetPost = p;
                            break;
                        }
                        if (p.comments) {
                            const matchedComment = p.comments.find(c => c.id.toLowerCase().trim().endsWith(cleanTargetId));
                            if (matchedComment) {
                                targetPost = p;
                                targetComment = matchedComment;
                                break;
                            }
                        }
                    }
                } else {
                    targetPost = feedCache[0];
                }

                if (!targetPost && targetId) {
                    console.warn(`${MOMENTS_LOG_PREFIX} Target ID [${targetId}] not found for comment, skipping.`);
                    continue;
                }

                if (targetPost) {
                    const charInfo = getCharacterInfo();

                    if (charInfo && charInfo.name && targetPost.comments) {
                        // 只检查角色自身的 authorId，避免用户评论被误判为角色已互动
                        const charAuthorId = getCharAuthorId();
                        let isDuplicate = false;
                        if (targetComment) {
                            isDuplicate = targetPost.comments.some(c => c.authorId === charAuthorId && c.replyToId === targetComment.id);
                        } else {
                            isDuplicate = targetPost.comments.some(c => c.authorId === charAuthorId && !c.replyToId);
                        }
                        let exactTextDuplicate = targetPost.comments.some(c => c.authorId === charAuthorId && c.content === text);

                        // ── 防重复：帖子无新外部活动时阻止评论 ──
                        if (!isDuplicate && !targetComment) {
                            const myCommentTimes = targetPost.comments
                                .filter(c => c.authorId === charAuthorId && !c.replyToId)
                                .map(c => new Date(c.createdAt).getTime());
                            const myLastCommentTime = myCommentTimes.length > 0 ? Math.max(...myCommentTimes) : 0;
                            if (myLastCommentTime > 0) {
                                const hasNewExternalActivity = targetPost.comments.some(c =>
                                    c.authorId !== charAuthorId &&
                                    new Date(c.createdAt).getTime() > myLastCommentTime
                                );
                                if (!hasNewExternalActivity) {
                                    isDuplicate = true;
                                    console.warn(`${MOMENTS_LOG_PREFIX} Blocking comment: no new external activity on post [${targetId}].`);
                                }
                            }
                        }

                        if (isDuplicate || exactTextDuplicate) {
                            console.warn(`${MOMENTS_LOG_PREFIX} Prevents duplicate reply or exact same text for ID [${targetId}].`);
                            continue;
                        }
                    }

                    if (targetComment) {
                        await addComment(targetPost.id, text, charInfo?.name, targetComment.id, targetComment.authorName, charInfo?.avatar);
                        logMoments(`💬 ${charInfo.name} 回复了 ${targetComment.authorName} 的评论: ${text}`);
                    } else {
                        await addComment(targetPost.id, text, charInfo?.name, null, null, charInfo?.avatar);
                        logMoments(`💬 ${charInfo.name} 评论了 ${targetPost.authorName}: ${text}`);
                    }
                    showToast && showToast(`已评论: ${text.substring(0, 10)}...`);
                }
            }
        }
    }

    return posted;
}
