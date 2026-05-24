
// modules/moments/momentsWorldInfo.js — LLM 集成 (World Info & Chat Output Parsing)

import { MOMENTS_LOG_PREFIX, logMoments, getCharacterId } from './constants.js';
import { getSettings, getFeedCache } from './state.js';
import { addComment } from './apiClient.js';
import { createLocalPost } from './persistence.js';
import { useMomentCustomApi } from '../../api.js';
import { markMomentsPostCooldown, isMomentsPostOnCooldown } from '../chat/chatPromptBuilder.js';
import { getContext } from '../../../../../../extensions.js';
import { getCharacterInfo, getUserNameFallback, getMyAuthorIds, getCharAuthorId, resolveCharAvatar, showToast } from './momentsHelpers.js';
// (Helpers moved to momentsHelpers.js)

// ═══════════════════════════════════════════════════════════════════════
// Short-ID: last 4 base36 chars of the full ID's tail segment.
// Working set is at most ~30 IDs (5 posts * 5 visible comments + 5 posts),
// 4 chars (~1.6M space) gives ~0.02% birthday-collision probability — plenty.
// Shorter than 8 because LLMs transcribe 4 random chars more reliably.
// Match rule is strict equality (no endsWith) so suffix collisions can't shadow.
// ═══════════════════════════════════════════════════════════════════════
const SHORT_ID_LEN = 4;
export function computeShortId(fullId) {
    if (!fullId) return '';
    const lastSegment = String(fullId).split('_').pop();
    return lastSegment.slice(-SHORT_ID_LEN).toLowerCase();
}

// ═══════════════════════════════════════════════════════════════════════
// Mutual Sync (Main LLM Integration)
// ═══════════════════════════════════════════════════════════════════════

// 串行化锁：sync / addComment / deletePost / createLocalPost / publishPost 都会
// 触发 updateMomentsWorldInfo，并发执行时 loadWorldInfo → modify → saveWorldInfo 的
// RMW 会互相覆盖。用 promise 链把所有调用排成队列。
let _wiUpdateChain = Promise.resolve();
export function updateMomentsWorldInfo() {
    const next = _wiUpdateChain.then(_runUpdateMomentsWorldInfo, _runUpdateMomentsWorldInfo);
    _wiUpdateChain = next.catch(() => { }); // 不让上一次的异常阻断后续调用
    return next;
}

async function _runUpdateMomentsWorldInfo() {
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
            const shortId = computeShortId(p.id);

            // ── 双重匹配：authorId 或 authorName 匹配角色即视为角色评论 ──
            // 本地创建的评论 authorId = "char_42"，后端同步回来的可能是服务器 userId
            const charAuthorId = getCharAuthorId();
            const _isCharComment = (c) => c.authorId === charAuthorId || (myCharName && c.authorName === myCharName);

            let postReplied = p.comments?.some(c => _isCharComment(c) && !c.replyToId);
            // 检测帖子是否有新的外部活动（自角色上次评论后）
            let hasNewExternalActivity = false;
            if (postReplied && p.comments) {
                const myCommentTimes = p.comments
                    .filter(c => _isCharComment(c) && !c.replyToId)
                    .map(c => new Date(c.createdAt).getTime());
                const myLastCommentTime = myCommentTimes.length > 0 ? Math.max(...myCommentTimes) : 0;
                hasNewExternalActivity = myLastCommentTime > 0 && p.comments.some(c =>
                    !_isCharComment(c) &&
                    new Date(c.createdAt).getTime() > myLastCommentTime
                );
            }

            // ── 核心逻辑：已回复且无新活动的帖子不注入 ID，LLM 无法对其操作 ──
            const postInteractable = !postReplied || hasNewExternalActivity;

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

            // 有 ID → 可互动；无 ID → 仅作为上下文背景
            let text;
            if (postInteractable) {
                text = `【帖子】[ID:${shortId}] [${p.authorName}]${ownerLabel} (${timeStr}): ${p.content}`;
            } else {
                text = `【帖子】[${p.authorName}]${ownerLabel} (${timeStr}): ${p.content}`;
            }

            if (p.comments && p.comments.length > 0) {
                const recentComments = p.comments.slice(-5).map(c => {
                    const cShortId = computeShortId(c.id);
                    const replyStr = c.replyToName ? ` 回复 ${c.replyToName}` : '';
                    // 角色自己的评论永远不注入 ID（角色不会回复自己）
                    if (_isCharComment(c)) {
                        return `  - 【评论】${c.authorName}${replyStr}: ${c.content}`;
                    }
                    const commentReplied = p.comments.some(replyC => _isCharComment(replyC) && replyC.replyToId === c.id);
                    // 已回复的评论不注入 ID，仅保留文本上下文
                    if (commentReplied) {
                        return `  - 【评论】${c.authorName}${replyStr}: ${c.content}`;
                    }
                    return `  - 【评论】[ID:${cShortId}] ${c.authorName}${replyStr}: ${c.content}`;
                }).join('\n');
                text += '\n' + recentComments;
            }
            return text;
        }).join('\n\n');


        let baseText = `<gf_moments>
【社交网络系统】
{{char}}有着丰富的网络社交活动，ta会发朋友圈记录生活和感受，打卡app记录，分享网络内容（例如有趣的新闻和视频等），也会和亲朋好友们的动态进行互动。
在完成正文之后，{{char}}可以使用以下两种独立指令发朋友圈或者对别人的朋友圈帖子进行评论留言：
- 发动态：(朋友圈: {{char}}想要发的内容)
- 评论 / 回复：(评论 <4位ID>: {{char}}想要发的评论内容)  ← <4位ID> 是占位符，要替换成动态列表中真实的 4 位字母数字 ID，例如 (评论 a1b2: 居然是这样！)

⚠️格式严格警告：
1. 只有带有 [ID:xxxx] 标记的帖子和评论才可以被评论或回复。
2. 不要把字面量 "ID:" 写进指令！要替换成真实的 4 位 ID，例如 (评论 9d3f: 内容)，错误写法是 (评论 ID: 内容)。
3. 绝对不要在括号内或外添加 【帖子】[ID:xxxx]、【评论】[ID:xxxx] 或 [角色名 回复] 等前缀，直接写内容！
4. 错误示范：(朋友圈: 评论xxx) 【评论】[ID:abcd] 回复: 内容...
5. 正确评论示范：(评论 9d3f: 居然是这样！太有趣了。)
6. 请直接使用动态列表中被评论者的 4 位字母数字 ID。
7. 发布朋友圈和进行评论可同时进行。


朋友圈多媒体格式（多样化使用，根据{{char}}本身的设定发布内容）：
{{char}}的动态应该像真实社交平台一样丰富，根据内容选最贴合的类型，必要时多种组合使用。可选类型如下：
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
- 你是"${myCharName}"，你的恋人是"${userName}"。
- ⚠️ 你只能以"${myCharName}"一个身份发言，每条 (评论 ID: ...) 都必须是你自己的话。绝对不要模仿动态列表里其她评论者的口吻、不要替别人发言、也不要把别人评论里出现过的句子原样或换皮复述。
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
- Comment / reply: (评论 <4-char-id>: your text) — replace <4-char-id> with the real 4-char alphanumeric ID from the feed, e.g. (评论 a1b2: Hello there!)

【FORMATTING RULES - CRITICAL】
1. You may ONLY interact with posts/comments that have an [ID:xxxx] marker. Items without an ID are read-only background context — DO NOT attempt to comment on or reply to them.
2. DO NOT write the literal word "ID" in the command. Substitute the real 4-char ID. Wrong: (评论 ID: text). Correct: (评论 9d3f: text).
3. DO NOT use names in the command, ONLY use the 4-character ID.
4. DO NOT output fake IDs or prefix your text with 【帖子】[ID:xxxx], 【评论】[ID:xxxx] or [Name] outside or inside the command.
5. ALWAYS output the pure text inside the command syntax.`;

    if (!useMomentCustomApi) {
        return protocolText + `\n\n【IMPORTANT】在你正常回复用户之后，如果想互动，请严格使用以上 (朋友圈: ...) 或 (评论 <4位ID>: ...) 的格式在回复的最末尾。这两种指令是独立的，可以**同时输出**：既发一条朋友圈、又对动态列表里的多条内容写评论，都放在回复末尾即可。看到动态里别人发的有意思的事，主动留个评论是很自然的社交行为。`;
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

    // 整次调用复用同一份 charInfo + 头像 base64，避免在每个匹配里重复 fetch
    const charInfo = getCharacterInfo();
    let _resolvedAvatar = null;
    const _getAvatar = async () => {
        if (_resolvedAvatar === null) _resolvedAvatar = await resolveCharAvatar(charInfo);
        return _resolvedAvatar;
    };

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
                const avatarData = await _getAvatar();
                await createLocalPost(text, charInfo?.name, avatarData, null, true);
                logMoments(`📝 ${charInfo.name} 的朋友圈草稿等你审核: ${text}`);
                showToast && showToast(`已生成待发布草稿`);
                markMomentsPostCooldown();
                posted = true;
            }
        }
    }

    // Regex for (评论 ID: ...). ID is required to prevent fuzzy matches landing on the latest post.
    const commentMatches = Array.from(content.matchAll(/\((?:评论|Comment)\s*(?:ID:?)?\s*([a-zA-Z0-9_-]+)\s*[:：]\s*(.+?)\)/gi));
    for (const commentMatch of commentMatches) {
        if (commentMatch && commentMatch[2]) {
            const targetId = commentMatch[1];
            const text = commentMatch[2].trim();
            if (text && feedCache.length > 0) {
                let targetPost = null;
                let targetComment = null;

                const cleanTargetId = targetId.toLowerCase().trim();
                for (const p of feedCache) {
                    if (computeShortId(p.id) === cleanTargetId) {
                        targetPost = p;
                        break;
                    }
                    if (p.comments) {
                        const matchedComment = p.comments.find(c => computeShortId(c.id) === cleanTargetId);
                        if (matchedComment) {
                            targetPost = p;
                            targetComment = matchedComment;
                            break;
                        }
                    }
                }

                if (!targetPost) {
                    if (cleanTargetId === 'id') {
                        console.warn(`${MOMENTS_LOG_PREFIX} LLM emitted literal "ID:" instead of a real 4-char ID — comment dropped. Text was: "${text}"`);
                    } else {
                        console.warn(`${MOMENTS_LOG_PREFIX} Target ID [${targetId}] not found for comment, skipping.`);
                    }
                    continue;
                }

                if (targetPost) {
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

                        // Cross-author dedup: block parroting any existing comment (e.g. copying another commenter verbatim).
                        const normalize = (s) => (s || '').trim().replace(/\s+/g, ' ').toLowerCase();
                        const newNorm = normalize(text);
                        const crossAuthorDuplicate = newNorm.length > 0 && targetPost.comments.some(c => normalize(c.content) === newNorm);
                        if (crossAuthorDuplicate) {
                            console.warn(`${MOMENTS_LOG_PREFIX} Blocking comment: parrots an existing comment on post [${targetId}].`);
                            continue;
                        }

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

                    const avatarData = await _getAvatar();
                    if (targetComment) {
                        await addComment(targetPost.id, text, charInfo?.name, targetComment.id, targetComment.authorName, avatarData);
                        logMoments(`💬 ${charInfo.name} 回复了 ${targetComment.authorName} 的评论: ${text}`);
                    } else {
                        await addComment(targetPost.id, text, charInfo?.name, null, null, avatarData);
                        logMoments(`💬 ${charInfo.name} 评论了 ${targetPost.authorName}: ${text}`);
                    }
                    showToast && showToast(`已评论: ${text.substring(0, 10)}...`);
                }
            }
        }
    }

    return posted;
}
