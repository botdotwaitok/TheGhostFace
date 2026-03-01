// worldbook.js
import { getContext, extension_settings } from '../../../../extensions.js';
import { characters } from '../../../../../script.js';
import { createWorldInfoEntry, deleteWIOriginalDataValue, deleteWorldInfoEntry, loadWorldInfo, saveWorldInfo, world_info } from '../../../../world-info.js';
import { eventSource } from '../../../../../script.js';
import { getCharaFilename } from '../../../../utils.js';


import * as core from './core.js';
import * as utils from './utils.js';



//获取现有世界书内容作为上下文（防止AI重复生成）
export async function getExistingWorldBookContext() {
    try {
        // 🎯 获取世界书 - 仅从绑定获取
        let worldBookName = await utils.findActiveWorldBook();

        if (!worldBookName) {
            // 🔄 回退到手动检测方案
            const worldSelect = document.querySelector('#world_editor_select');
            if (worldSelect && worldSelect.value) {
                worldBookName = worldSelect.selectedOptions[0].textContent;
                console.log(`🧠 手动检测到世界书: ${worldBookName}`);
            } else {
                console.log('🧠 未检测到世界书');
                return '档案库为空，这是第一次记录。';
            }
        } else {
            console.log(`🧠 自动检测到绑定世界书: ${worldBookName}`);
        }

        const worldBookData = await loadWorldInfo(worldBookName);

        if (!worldBookData || !worldBookData.entries) {
            console.log('🧠 世界书为空');
            return '档案库为空，这是第一次记录。';
        }

        const currentChatIdentifier = await core.getCurrentChatIdentifier();
        let contextParts = [];


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
        });

        const finalContext = contextParts.length > 0
            ? contextParts.join('\n\n')
            : '档案库为空，这是第一次记录。';

        //logger.info(`🧠 已获取现有世界书上下文，长度: ${finalContext.length} 字符`);
        //logger.info(`🧠 找到 ${contextParts.length} 个现有类别的记录`);

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

            // ❌ 不再禁用其他聊天的条目
            // if (!isForCurrentChat && !entry.disable) {
            //   entry.disable = true;
            //   changed++;
            //   logger.info(`❌ 禁用其他聊天的总结条目: ${entry.comment}`);
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
export async function saveToWorldBook(summaryEntries, startIndex = null, endIndex = null, isContentSimilar = null, isAutoTriggered = false) {
    console.log('[鬼面] === 鬼面开始往世界书里写字 (fragment mode) ===');

    try {
        // 🎯 获取世界书 - 仅从绑定获取
        let worldBookName = await utils.findActiveWorldBook();

        if (!worldBookName) {
            // 🔄 回退到手动检测方案
            const worldSelect = document.querySelector('#world_editor_select');
            if (worldSelect && worldSelect.value) {
                worldBookName = worldSelect.selectedOptions[0].textContent;
                console.log(`[鬼面] 手动检测到世界书: ${worldBookName}`);
            } else {
                throw new Error('请先在 World Info 页面选择一个世界书，或确保角色已绑定世界书');
            }
        } else {
            console.log(`[鬼面] 自动检测到绑定世界书: ${worldBookName}`);
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
        let skippedCount = 0;

        // 🔧 收集现有碎片条目用于去重
        const existingFragments = [];
        if (worldBookData.entries) {
            Object.values(worldBookData.entries).forEach((entry) => {
                if (!entry || !entry.comment) return;
                const comment = String(entry.comment).trim();
                // Match both old category entries and new fragment entries
                if (comment.startsWith('我们的故事 - ')) {
                    existingFragments.push({
                        comment: comment,
                        content: entry.content || ''
                    });
                }
            });
        }
        logger.info(`[鬼面] 扫描完成: 找到 ${existingFragments.length} 个现有条目用于去重`);

        // 🧠 为每个记忆碎片创建独立的 WI 条目
        for (let i = 0; i < summaryEntries.length; i++) {
            const fragment = summaryEntries[i];

            try {
                logger.info(`[鬼面] 处理碎片 ${i + 1}/${summaryEntries.length}: [${fragment.label}]`);

                // 🧼 去重检查 — 对比所有现有条目
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

                // 🛡️ 拦截不属于记忆碎片的条目（大总结等）
                const forbiddenLabels = ['大总结', '世界线总结', '情节发展', '情感递进'];
                if (forbiddenLabels.some(f => (fragment.label || '').includes(f) || (fragment.content || '').includes(f))) {
                    logger.warn(`[鬼面] ⚠️ saveToWorldBook: 拦截了不属于记忆碎片的条目: [${fragment.label}]`);
                    skippedCount++;
                    continue;
                }

                // 🆕 创建新的独立条目
                const newEntry = createWorldInfoEntry(null, worldBookData);
                if (!newEntry) {
                    logger.error('[鬼面] createWorldInfoEntry 返回 null');
                    continue;
                }

                // Generate a short unique identifier for the comment
                const timestamp = Date.now().toString(36);
                const fragmentId = `${timestamp}-${i}`;
                // Use the label from the fragment (which now contains a short title)
                const safeLabel = (fragment.label || '未命名碎片').replace(/[\\/:*?"<>|]/g, '_');
                const commentText = `记忆碎片 - ${safeLabel}`;

                // 🧱 楼层/时间标签
                const floorTag = (typeof startIndex === 'number' && typeof endIndex === 'number')
                    ? `[第${startIndex + 1}-${endIndex + 1}楼]`
                    : `[主动记忆 ${new Date().toLocaleString()}]`;

                const entryContent = `${floorTag} ${fragment.content}`;

                // Set up the keywords — use fragment's keywords if available, fallback to label
                const keywords = fragment.keywords && fragment.keywords.length > 0
                    ? fragment.keywords
                    : [fragment.label];

                Object.assign(newEntry, {
                    comment: commentText,
                    content: entryContent,
                    key: keywords,
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
                    comment: commentText,
                    content: entryContent
                });

                createdCount++;
                logger.info(`[鬼面] ✅ 碎片条目创建成功: [${fragment.label}] (UID: ${newEntry.uid}, Keywords: ${keywords.join(', ')})`);

            } catch (entryError) {
                logger.error(`[鬼面] ❌ 处理碎片 ${i + 1} 失败:`, entryError);
                continue;
            }
        }


        if (createdCount === 0) {
            logger.warn(`[鬼面] 没有新碎片需要保存 (${skippedCount} 条重复被跳过)`);
            return { created: 0, updated: 0 };
        }

        logger.info('[鬼面] 开始保存世界书...');
        await saveWorldInfo(worldBookName, worldBookData, true);
        logger.info(`[鬼面] ✅ 世界书保存成功: ${createdCount} 个新碎片条目, ${skippedCount} 个重复被跳过`);

        // 🆕 管理鬼面总结条目的激活状态
        await manageGhostSummaryEntries(worldBookName, currentChatFileIdentifier);

        return { created: createdCount, updated: 0 };

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
            // 🔄 回退到手动检测方案
            const worldSelect = document.querySelector('#world_editor_select');
            if (worldSelect && worldSelect.value) {
                worldBookName = worldSelect.selectedOptions[0].textContent;
                console.log(`🔍 手动检测到世界书: ${worldBookName}`);
            } else {
                console.log('🔍 未检测到世界书');
                return -1;
            }
        } else {
            console.log(`🔍 自动检测到绑定世界书: ${worldBookName}`);
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

        // 🥇 优先方法1：查找追踪条目
        Object.values(worldBookData.entries).forEach(entry => {
            if (entry.comment === GHOST_TRACKING_COMMENT) {
                foundTrackingEntry = true;
                const content = entry.content || '';
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

export const GHOST_SUMMARY_PREFIX = "鬼面总结-";
export const GHOST_TRACKING_COMMENT = "鬼面楼层追踪记录";

