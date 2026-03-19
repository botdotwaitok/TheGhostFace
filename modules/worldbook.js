// worldbook.js
import { createWorldInfoEntry, loadWorldInfo, saveWorldInfo } from '../../../../world-info.js';
import { getContext } from '../../../../extensions.js';


import * as core from './core.js';
import * as utils from './utils.js';
import { logger } from './utils.js';

export const GHOST_SUMMARY_PREFIX = "鬼面总结-";
export const GHOST_TRACKING_COMMENT = "鬼面楼层追踪记录";

// 🔄 宏替换：将 {{user}}/{{char}} 替换为真实角色名
function replaceMacros(text) {
    if (!text || typeof text !== 'string') return text;
    try {
        const ctx = getContext();
        const userName = ctx?.name1 || '{{user}}';
        const charName = ctx?.name2 || '{{char}}';
        return text.replace(/\{\{user\}\}/gi, userName).replace(/\{\{char\}\}/gi, charName);
    } catch {
        return text;
    }
}


//获取现有世界书内容作为上下文（防止AI重复生成）
export async function getExistingWorldBookContext() {
    try {
        // 🎯 获取世界书 - 仅从绑定获取
        let worldBookName = await utils.findActiveWorldBook();

        if (!worldBookName) {
            console.log('🧠 未检测到绑定的世界书');
            return '档案库为空，这是第一次记录。';
        }

        const worldBookData = await loadWorldInfo(worldBookName);

        if (!worldBookData || !worldBookData.entries) {
            console.log('🧠 世界书为空');
            return '档案库为空，这是第一次记录。';
        }

        let contextParts = [];
        let fragmentTitles = []; // 🆕 收集记忆碎片标题


        Object.values(worldBookData.entries).forEach(entry => {
            if (!entry || !entry.comment || entry.disable) return;

            if (entry.comment.startsWith('我们的故事 - ')) {
                const category = entry.comment.replace('我们的故事 - ', '');
                const content = entry.content || '';

                // 清理内容，移除楼层标记和时间戳，只保留实际信息
                const cleanContent = content
                    .split('\n')
                    .filter(line => {
                        const trimmed = line.trim();
                        return trimmed &&
                            !trimmed.startsWith('---') &&
                            !trimmed.includes('楼总结') &&
                            !trimmed.includes('自动总结') &&
                            !trimmed.match(/^\d{4}-\d{2}-\d{2}/);
                    })
                    .join('\n')
                    .trim();

                if (cleanContent) {
                    contextParts.push(`**${category}类别已记录:**\n${cleanContent}`);
                }
            }

            // 🆕 收集记忆碎片标题
            if (entry.comment.startsWith('记忆碎片 - ')) {
                const fragTitle = entry.comment.replace('记忆碎片 - ', '').trim();
                const fragContent = (entry.content || '').replace(/^\[第\d+-\d+楼\]\s*/, '').replace(/^\[主动记忆.*?\]\s*/, '').trim();
                // 取内容的前60个字符作为摘要
                const snippet = fragContent.length > 60 ? fragContent.substring(0, 60) + '...' : fragContent;
                fragmentTitles.push(`- [${fragTitle}]: ${snippet}`);
            }
        });

        // 🆕 构建碎片标题清单
        let fragmentListSection = '';
        if (fragmentTitles.length > 0) {
            fragmentListSection = `\n\n**已有记忆碎片标题列表 (共${fragmentTitles.length}条，同一件事有发展时请用 ===UPDATE=== 更新对应标题):**\n${fragmentTitles.join('\n')}`;
        }

        const finalContext = contextParts.length > 0 || fragmentTitles.length > 0
            ? (contextParts.length > 0 ? contextParts.join('\n\n') : '') + fragmentListSection
            : '档案库为空，这是第一次记录。';

        return finalContext;

    } catch (error) {
        logger.error('🧠 获取现有世界书内容失败:', error);
        return '档案库读取失败，按新内容处理。';
    }
}

// 预定义的固定类别
export const PREDEFINED_CATEGORIES = {
    '喜好': {
        comment: '我们的故事 - 喜好偏好',
        key: ['喜欢', '偏好', '爱好', '喜好'],
        order: 90
    },
    '恐惧': {
        comment: '我们的故事 - 恐惧害怕',
        key: ['害怕', '恐惧', '讨厌', '不喜欢'],
        order: 91
    },
    '事件': {
        comment: '我们的故事 - 重要事件',
        key: ['发生', '事件', '经历', '回忆'],
        order: 92
    },
    '关系': {
        comment: '我们的故事 - 人际关系',
        key: ['朋友', '家人', '关系', '认识'],
        order: 93
    },
    '梦境': {
        comment: '我们的故事 - 梦境幻想',
        key: ['梦见', '梦境', '幻想', '想象'],
        order: 94
    },
    '互动': {
        comment: '我们的故事 - 独特互动',
        key: ['互动', '交流', '对话', '玩耍'],
        order: 95
    }
};

// 创建或更新鬼面总结条目
export async function createOrUpdateGhostSummaryEntry(worldBookData, chatIdentifier, startIndex, endIndex, content) {
    try {
        const entryComment = `${GHOST_SUMMARY_PREFIX}${chatIdentifier}-${startIndex + 1}-${endIndex + 1}`;

        let existingEntry = null;
        Object.values(worldBookData.entries).forEach(entry => {
            if (entry.comment === entryComment) {
                existingEntry = entry;
            }
        });

        const entryContent = `楼层范围: ${startIndex + 1}-${endIndex + 1}\n聊天: ${chatIdentifier}\n时间: ${new Date().toLocaleString()}\n\n${content}`;

        if (existingEntry) {
            existingEntry.content = entryContent;
            logger.info(`👻 更新鬼面总结条目: ${entryComment}`);
        } else {
            const newEntry = createWorldInfoEntry(null, worldBookData);
            Object.assign(newEntry, {
                comment: entryComment,
                content: entryContent,
                key: [`总结${startIndex + 1}${endIndex + 1}`, chatIdentifier, '鬼面'],
                constant: true,
                selective: false,
                disable: false,
                order: 999, // 按楼层排序
                position: 1,
                excludeRecursion: true,
                preventRecursion: true
            });
            logger.info(`鬼面在创建总结条目: ${entryComment}`);
        }

    } catch (error) {
        logger.error('👻 创建/更新鬼面总结条目失败:', error);
    }
}

// 管理鬼面总结条目激活状态
export async function manageGhostSummaryEntries(worldBookName, currentChatIdentifier) {

    try {
        const wbOriginal = await loadWorldInfo(worldBookName);
        if (!wbOriginal || !wbOriginal.entries) return;

        // ⚠️ 深拷贝，避免直接修改 ST 缓存中的对象
        const worldBookData = structuredClone(wbOriginal);

        let changed = 0;

        // 直接改 entries 里的对象，而不是仅仅 push 到一个数组
        for (const entry of Object.values(worldBookData.entries)) {
            if (!entry?.comment || !entry.comment.startsWith(GHOST_SUMMARY_PREFIX)) continue;

            const isForCurrentChat = entry.comment.includes(currentChatIdentifier);

            // ✅ 只启用“当前聊天”的总结条目
            if (isForCurrentChat && entry.disable) {
                entry.disable = false;
                changed++;
                logger.info(`✅ 启用当前聊天的总结条目: ${entry.comment}`);
            }

            // ❌ 不再禁用其她聊天的条目
            // if (!isForCurrentChat && !entry.disable) {
            //   entry.disable = true;
            //   changed++;
            //   logger.info(`❌ 禁用其她聊天的总结条目: ${entry.comment}`);
            // }
        }

        if (changed > 0) {
            await saveWorldInfo(worldBookName, worldBookData, true);
            logger.info(`👻 已更新 ${changed} 个总结条目的激活状态`);
        }
    } catch (error) {
        logger.error('👻 管理总结条目激活状态失败:', error);
    }
}


// 更新世界书函数 — 为每个记忆碎片创建独立条目
export async function saveToWorldBook(summaryEntries, startIndex = null, endIndex = null, isContentSimilar = null) {
    console.log('[鬼面] === 鬼面开始往世界书里写字 (fragment mode) ===');

    try {
        // 🎯 获取世界书 - 仅从绑定获取
        let worldBookName = await utils.findActiveWorldBook();

        if (!worldBookName) {
            throw new Error('请先在鬼面面板为当前角色指定一个世界书');
        }

        const currentChatFileIdentifier = await core.getCurrentChatIdentifier();
        console.log('[鬼面] 当前聊天标识:', currentChatFileIdentifier);

        const wbOriginal = await loadWorldInfo(worldBookName);
        if (!wbOriginal) {
            throw new Error('无法加载世界书数据');
        }

        // ⚠️ 深拷贝，避免 createWorldInfoEntry 直接修改 ST 缓存中的对象
        const worldBookData = structuredClone(wbOriginal);

        // summaryEntries is now an array of { label, content, keywords }
        if (!Array.isArray(summaryEntries) || summaryEntries.length === 0) {
            throw new Error('没有找到有效的记忆碎片数据');
        }

        logger.info(`[鬼面] 收到 ${summaryEntries.length} 个记忆碎片条目，开始逐条处理...`);

        // Track used orders for position 1 (After Char)
        const usedOrders = new Set();
        if (worldBookData.entries) {
            Object.values(worldBookData.entries).forEach(e => {
                const pos = e.position !== undefined ? parseInt(e.position) : 1;
                // Currently memory fragments are inserted at position 1
                if (pos === 1) {
                    usedOrders.add(e.order !== undefined ? parseInt(e.order) : 100);
                }
            });
        }

        // Helper to find next unused order starting from 100
        let nextOrderTarget = 100;
        const getNextAvailableOrder = () => {
            while (usedOrders.has(nextOrderTarget)) {
                nextOrderTarget++;
            }
            usedOrders.add(nextOrderTarget);
            return nextOrderTarget;
        };

        let createdCount = 0;
        let updatedCount = 0;
        let skippedCount = 0;

        // 🔧 收集现有碎片条目用于去重（包含引用以便直接修改）
        const existingFragments = [];
        if (worldBookData.entries) {
            Object.entries(worldBookData.entries).forEach(([uid, entry]) => {
                if (!entry || !entry.comment) return;
                const comment = String(entry.comment).trim();
                // Match both old category entries and new fragment entries
                if (comment.startsWith('我们的故事 - ') || comment.startsWith('记忆碎片 - ')) {
                    const label = comment.startsWith('记忆碎片 - ')
                        ? comment.replace('记忆碎片 - ', '').trim()
                        : null;
                    existingFragments.push({
                        uid: uid,
                        comment: comment,
                        content: entry.content || '',
                        label: label,
                        entryRef: entry  // 🆕 保留引用以便直接修改
                    });
                }
            });
        }
        logger.info(`[鬼面] 扫描完成: 找到 ${existingFragments.length} 个现有条目用于去重`);

        // 🆕 标题相似度计算（用于模糊标题匹配）
        const isLabelSimilar = (label1, label2) => {
            if (!label1 || !label2) return false;
            // 去除标签前缀（如 "喜好-", "事件-" 等）
            const stripPrefix = (l) => l.replace(/^[^\-]+[\-－]/, '').trim();
            const l1 = stripPrefix(label1).toLowerCase();
            const l2 = stripPrefix(label2).toLowerCase();
            if (l1 === l2) return true;
            // 包含关系
            if (l1.length > 1 && l2.length > 1 && (l1.includes(l2) || l2.includes(l1))) return true;
            // 字符级相似度 > 60%
            const maxLen = Math.max(l1.length, l2.length);
            if (maxLen === 0) return false;
            let matches = 0;
            const minLen = Math.min(l1.length, l2.length);
            for (let c = 0; c < minLen; c++) {
                if (l1[c] === l2[c]) matches++;
            }
            return (matches / maxLen) > 0.6;
        };

        // 🧠 为每个记忆碎片创建或更新 WI 条目
        for (let i = 0; i < summaryEntries.length; i++) {
            const fragment = summaryEntries[i];

            try {
                logger.info(`[鬼面] 处理碎片 ${i + 1}/${summaryEntries.length}: [${fragment.label}]${fragment.updateTarget ? ' (UPDATE → ' + fragment.updateTarget + ')' : ''}`);

                // 🛡️ 拦截不属于记忆碎片的条目（大总结等）
                const forbiddenLabels = ['大总结', '世界线总结', '情节发展', '情感递进'];
                if (forbiddenLabels.some(f => (fragment.label || '').includes(f) || (fragment.content || '').includes(f))) {
                    logger.warn(`[鬼面] ⚠️ saveToWorldBook: 拦截了不属于记忆碎片的条目: [${fragment.label}]`);
                    skippedCount++;
                    continue;
                }

                // 🧱 楼层/时间标签
                const floorTag = (typeof startIndex === 'number' && typeof endIndex === 'number')
                    ? `[第${startIndex + 1}-${endIndex + 1}楼]`
                    : `[主动记忆 ${new Date().toLocaleString()}]`;

                // 🧠 合并 AI 关键词 + 标题核心词（保底：标题里的词一定触发）
                const labelParts = (fragment.label || '')
                    .split(/[-－]/)
                    .map(s => s.trim())
                    .filter(s => s.length > 0);
                const aiKeywords = fragment.keywords && fragment.keywords.length > 0
                    ? fragment.keywords
                    : [];
                const newKeywords = [...new Set([...labelParts, ...aiKeywords])];

                // ============================================================
                // 🔄 路径A: AI 明确指定了 updateTarget（===UPDATE=== 块）
                // ============================================================
                if (fragment.updateTarget) {
                    const targetTitle = fragment.updateTarget.trim();
                    const matchEntry = existingFragments.find(ef =>
                        ef.label && ef.label === targetTitle
                    );

                    if (matchEntry && matchEntry.entryRef) {
                        // 直接覆盖旧条目内容
                        matchEntry.entryRef.content = `${floorTag} ${replaceMacros(fragment.content)}`;
                        // 合并关键词（去重）
                        const oldKeys = Array.isArray(matchEntry.entryRef.key) ? matchEntry.entryRef.key : [];
                        const mergedKeys = [...new Set([...newKeywords, ...oldKeys])];
                        matchEntry.entryRef.key = mergedKeys;
                        // 更新内部缓存
                        matchEntry.content = matchEntry.entryRef.content;

                        updatedCount++;
                        logger.info(`[鬼面] 🔄 精确合并更新: [${targetTitle}] (Keywords: ${mergedKeys.join(', ')})`);
                        continue;
                    } else {
                        logger.warn(`[鬼面] ⚠️ UPDATE 目标 "${targetTitle}" 未找到匹配条目，将作为新条目创建`);
                        // 继续走下面的创建流程
                    }
                }

                // ============================================================
                // 🔄 路径B: 模糊去重 — 标题 + 内容双重检查
                // ============================================================
                let mergedWithExisting = false;

                // B1: 标题模糊匹配 — 找到标题相似的旧条目则合并
                for (const existing of existingFragments) {
                    if (existing.label && isLabelSimilar(fragment.label, existing.label)) {
                        // 标题相似 → 合并更新旧条目
                        if (existing.entryRef) {
                            existing.entryRef.content = `${floorTag} ${replaceMacros(fragment.content)}`;
                            const oldKeys = Array.isArray(existing.entryRef.key) ? existing.entryRef.key : [];
                            const mergedKeys = [...new Set([...newKeywords, ...oldKeys])];
                            existing.entryRef.key = mergedKeys;
                            existing.content = existing.entryRef.content;

                            updatedCount++;
                            mergedWithExisting = true;
                            logger.info(`[鬼面] 🔄 标题模糊合并: [${fragment.label}] → 旧条目 [${existing.label}] (Keywords: ${mergedKeys.join(', ')})`);
                            break;
                        }
                    }
                }
                if (mergedWithExisting) continue;

                // B2: 内容相似度去重 — 内容几乎一样则跳过
                let isDuplicate = false;
                if (typeof isContentSimilar === 'function') {
                    for (const existing of existingFragments) {
                        if (isContentSimilar(fragment.content, existing.content)) {
                            isDuplicate = true;
                            logger.info(`[鬼面] 🧠 碎片 "${fragment.content.substring(0, 40)}..." 与现有条目语义重复，跳过`);
                            break;
                        }
                    }
                }

                if (isDuplicate) {
                    skippedCount++;
                    continue;
                }

                // ============================================================
                // 🆕 路径C: 全新条目 — 创建独立 WI entry
                // ============================================================
                const newEntry = createWorldInfoEntry(null, worldBookData);
                if (!newEntry) {
                    logger.error('[鬼面] createWorldInfoEntry 返回 null');
                    continue;
                }

                const safeLabel = replaceMacros((fragment.label || '未命名碎片')).replace(/[\\/:*?"<>|]/g, '_');
                const commentText = `记忆碎片 - ${safeLabel}`;
                const entryContent = `${floorTag} ${replaceMacros(fragment.content)}`;

                Object.assign(newEntry, {
                    comment: commentText,
                    content: entryContent,
                    key: newKeywords,
                    constant: false,       // 🟢 Green light: keyword-triggered, not always-on
                    selective: false,
                    selectiveLogic: false,
                    addMemo: false,
                    order: getNextAvailableOrder(),
                    position: 1,           // After char defs
                    disable: false,
                    excludeRecursion: true,
                    preventRecursion: true,
                    delayUntilRecursion: false,
                    probability: 100,
                    useProbability: false
                });

                // Add to existing fragments list for dedup of later entries in the same batch
                existingFragments.push({
                    uid: newEntry.uid,
                    comment: commentText,
                    content: entryContent,
                    label: safeLabel,
                    entryRef: newEntry
                });

                createdCount++;
                logger.info(`[鬼面] ✅ 碎片条目创建成功: [${fragment.label}] (UID: ${newEntry.uid}, Keywords: ${newKeywords.join(', ')})`);

            } catch (entryError) {
                logger.error(`[鬼面] ❌ 处理碎片 ${i + 1} 失败:`, entryError);
                continue;
            }
        }


        if (createdCount === 0 && updatedCount === 0) {
            logger.warn(`[鬼面] 没有新碎片需要保存 (${skippedCount} 条重复被跳过)`);
            return { created: 0, updated: 0 };
        }

        logger.info('[鬼面] 开始保存世界书...');
        await saveWorldInfo(worldBookName, worldBookData, true);
        logger.info(`[鬼面] ✅ 世界书保存成功: ${createdCount} 新建, ${updatedCount} 合并更新, ${skippedCount} 重复跳过`);

        // 🆕 管理鬼面总结条目的激活状态
        await manageGhostSummaryEntries(worldBookName, currentChatFileIdentifier);

        return { created: createdCount, updated: updatedCount };

    } catch (error) {
        logger.error('[鬼面] 世界书保存失败:', error);
        throw error;
    }
}


// 🔧 从世界书获取已总结的最大楼层
export async function getMaxSummarizedFloorFromWorldBook() {
    try {
        // 🎯 获取世界书 - 仅从绑定获取
        let worldBookName = await utils.findActiveWorldBook();

        if (!worldBookName) {
            console.log('🔍 未检测到绑定的世界书');
            return -1;
        }

        const currentChatIdentifier = await core.getCurrentChatIdentifier();
        const worldBookData = await loadWorldInfo(worldBookName);

        if (!worldBookData || !worldBookData.entries) {
            logger.debug('🔍 世界书数据为空');
            return -1;
        }

        let maxFloor = -1;
        let foundTrackingEntry = false;
        let foundSummaryEntries = 0;

        // 🥇 优先方法1：查找追踪条目（必须匹配当前聊天标识）
        Object.values(worldBookData.entries).forEach(entry => {
            if (entry.comment === GHOST_TRACKING_COMMENT) {
                foundTrackingEntry = true;
                const content = entry.content || '';
                // 🔧 校验聊天标识：只有属于当前聊天的追踪条目才可信
                const chatMatch = content.match(/聊天标识:\s*(.+)/);
                if (chatMatch && chatMatch[1].trim() !== currentChatIdentifier) {
                    logger.debug(`🔍 追踪条目属于其他聊天 (${chatMatch[1].trim()})，跳过`);
                    return; // 跳过，让备用方法接管
                }
                const match = content.match(/最后总结楼层:\s*(\d+)/);
                if (match) {
                    const floorNum = parseInt(match[1]) - 1; // 转为0-based
                    maxFloor = Math.max(maxFloor, floorNum);
                    logger.debug(`🔍 从追踪条目找到楼层: ${floorNum + 1}`);
                }
            }
        });

        // 🥈 备用方法2：从鬼面总结条目解析
        if (maxFloor === -1) {
            Object.values(worldBookData.entries).forEach(entry => {
                if (entry.comment &&
                    entry.comment.startsWith(GHOST_SUMMARY_PREFIX) &&
                    entry.comment.includes(currentChatIdentifier) &&
                    !entry.disable) {

                    foundSummaryEntries++;
                    const match = entry.comment.match(/-(\d+)-(\d+)$/);
                    if (match) {
                        const endFloor = parseInt(match[2]) - 1; // 转为0-based
                        maxFloor = Math.max(maxFloor, endFloor);
                        logger.debug(`🔍 从总结条目找到楼层: ${endFloor + 1} (条目: ${entry.comment})`);
                    }
                }
            });
        }

        return maxFloor;

    } catch (error) {
        logger.error('🔍 从世界书获取总结状态失败:', error);
        return -1;
    }
}

