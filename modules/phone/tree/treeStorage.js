// modules/phone/tree/treeStorage.js — localStorage 存储层 + 服务器同步
// 树状态、台词缓存、游戏历史、设置的本地持久化。
// Stage 6: 本地主导 + 异步火忘同步到云端。

import { apiRequest } from '../moments/apiClient.js';
import { getSettings } from '../moments/state.js';

const STORAGE_KEY = 'gf_tree_data';
const TREE_LOG_PREFIX = '[树树]';

// ═══════════════════════════════════════════════════════════════════════
// 默认数据结构
// ═══════════════════════════════════════════════════════════════════════

function createDefaultData() {
    return {
        // ── 树状态 ──
        treeState: {
            treeName: '',               // 玩家给树起的名字
            treeType: '',               // 当前树种 ID（apple / cherry / ...）
            growth: 0,                  // 当前成长值
            stage: 'seed',              // 当前阶段 ID
            dailyCareUsedActions: [],    // 今日已使用的照顾动作 ID 列表（每个动作每天限 1 次）
            lastCareDate: '',           // 上次照顾的日期 (YYYY-MM-DD)
            bonusCareCount: 0,          // 额外照顾次数（来自小游戏/道具）
            aiCaredToday: false,        // 恋人今日是否已自动照顾
            adoptedAt: '',              // 领养日期
            totalCareDays: 0,           // 累计照顾天数
            fruitsCollected: [],        // 已收集的果实 treeType ID 列表
        },

        // ── 已完成大树归档（图鉴） ──
        treeArchive: [],                // [{ treeType, treeName, completedAt }]

        // ── LLM 预生成台词缓存 ──
        dialogueCache: {
            careLines: [],              // 照顾反应台词 [{text, used}]
            currentStage: '',           // 这批台词对应的阶段 ID
            generatedAt: '',            // 生成时间
        },

        // ── 题库（LLM 生成 + 兜底合并） ──
        questionBank: {
            quiz: [],                   // [{question, options, used}]
            tod: [],                    // [{question, type, used}]
            lastGeneratedAt: '',
        },

        // ── 游戏历史统计 ──
        gameHistory: {
            quizPlayed: 0,
            quizPerfect: 0,             // 满分次数
            gachaPlayed: 0,
            gachaPityCounter: 0,        // 连续空气计数器（保底机制）
            todPlayed: 0,
            lastQuizDate: '',
            lastGachaDate: '',
            lastTodDate: '',
            dailyGachaUsed: 0,          // 今日已用免费扭蛋次数
            dailyQuizPlayed: 0,         // 今日已玩默契挑战轮数
            dailyTodPlayed: 0,          // 今日已玩真心话轮数
        },

        // ── 扭蛋图鉴 ──
        gachaCollection: [],            // 已获得的物品 ID 列表（去重）

        // ── 剧情碎片 ──
        storyFragments: [],             // 已收集的碎片 ID 列表

        // ── 设置 ──
        settings: {
            injectWorldBook: false,     // 是否注入 World Book
        },

        // ── 元信息 ──
        _version: 2,
    };
}

// ═══════════════════════════════════════════════════════════════════════
// 核心读写
// ═══════════════════════════════════════════════════════════════════════

/**
 * 从 localStorage 读取树数据，不存在则返回默认值
 * @returns {Object} 完整的树数据对象
 */
export function loadTreeData() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return createDefaultData();
        const parsed = JSON.parse(raw);
        // 合并默认值，确保新加的字段不会 undefined
        const data = deepMerge(createDefaultData(), parsed);
        // 修正阶段：旧版 _getStageId 阈值与 treeConfig 不一致，
        // 可能导致 treeState.stage 与实际 growth 不匹配
        const correctStage = _getStageId(data.treeState.growth);
        if (data.treeState.stage !== correctStage) {
            console.log(`${TREE_LOG_PREFIX} 修正阶段: "${data.treeState.stage}" → "${correctStage}" (growth=${data.treeState.growth})`);
            data.treeState.stage = correctStage;
            saveTreeData(data);
        }
        return data;
    } catch (e) {
        console.warn(`${TREE_LOG_PREFIX} Failed to load tree data:`, e);
        return createDefaultData();
    }
}

/**
 * 将树数据写入 localStorage
 * @param {Object} data - 完整的树数据对象
 */
export function saveTreeData(data) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
        console.error(`${TREE_LOG_PREFIX} Failed to save tree data:`, e);
    }
    // Stage 6: 异步火忘同步到服务器
    _syncToServer(data);
}

// ═══════════════════════════════════════════════════════════════════════
// 便捷存储 API
// ═══════════════════════════════════════════════════════════════════════

/**
 * 获取树状态
 */
export function getTreeState() {
    return loadTreeData().treeState;
}

/**
 * 更新树状态（部分更新）
 * @param {Object} updates - 要更新的字段
 */
export function updateTreeState(updates) {
    const data = loadTreeData();
    Object.assign(data.treeState, updates);
    saveTreeData(data);
    return data.treeState;
}

/**
 * 增加成长值
 * @param {number} amount - 增加量
 * @returns {{ newGrowth: number, stageChanged: boolean, newStage: string }}
 */
export function addGrowth(amount) {
    const data = loadTreeData();
    const oldGrowth = data.treeState.growth;
    data.treeState.growth = oldGrowth + amount;

    // 检查是否升级（使用内联阈值避免循环导入 treeConfig）
    const oldStage = data.treeState.stage;
    const newStageId = _getStageId(data.treeState.growth);
    data.treeState.stage = newStageId;
    const stageChanged = oldStage !== newStageId;

    saveTreeData(data);
    return {
        newGrowth: data.treeState.growth,
        stageChanged,
        newStage: newStageId,
    };
}

// ── 每日重置检查 ──────────────────────────────────────────────────────

/**
 * 获取今天的日期字符串 (YYYY-MM-DD)
 */
function getTodayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * 检查并执行每日重置（照顾次数、扭蛋次数等）
 * 应在每次打开树树 App 时调用
 * @returns {{ isNewDay: boolean, data: Object }}
 */
export function checkDailyReset() {
    const data = loadTreeData();
    const today = getTodayStr();
    const isNewDay = data.treeState.lastCareDate !== today;

    if (isNewDay) {
        data.treeState.dailyCareUsedActions = [];
        data.treeState.bonusCareCount = 0;   // 奖励照顾次数每日重置
        data.treeState.aiCaredToday = false;
        data.gameHistory.dailyGachaUsed = 0;
        data.gameHistory.dailyQuizPlayed = 0;
        data.gameHistory.dailyTodPlayed = 0;

        // 累计照顾天数（只要之前有过照顾记录）
        if (data.treeState.lastCareDate) {
            data.treeState.totalCareDays += 1;
        }

        data.treeState.lastCareDate = today;
        saveTreeData(data);
        console.log(`${TREE_LOG_PREFIX} 新的一天！每日次数已重置`);
    }

    return { isNewDay, data };
}

// ── 台词缓存 ─────────────────────────────────────────────────────────

/**
 * 获取一条未使用的照顾台词，并标记为已使用
 * @returns {string|null} 台词文本，或 null（无可用台词）
 */
export function popCareLine() {
    const data = loadTreeData();
    const unused = data.dialogueCache.careLines.filter(l => !l.used);
    if (unused.length === 0) return null;

    // 随机选一条
    const idx = Math.floor(Math.random() * unused.length);
    const line = unused[idx];
    line.used = true;
    saveTreeData(data);
    return line.text;
}

/**
 * 获取剩余未使用台词数量
 */
export function getRemainingCareLines() {
    const data = loadTreeData();
    return data.dialogueCache.careLines.filter(l => !l.used).length;
}

/**
 * 保存新生成的台词（替换旧的）
 * @param {string[]} lines - 台词文本数组
 * @param {string} stageId - 当前阶段 ID
 */
export function saveCareLines(lines, stageId) {
    const data = loadTreeData();
    data.dialogueCache = {
        careLines: lines.map(text => ({ text, used: false })),
        currentStage: stageId,
        generatedAt: new Date().toISOString(),
    };
    saveTreeData(data);
}

// ── 题库管理 ─────────────────────────────────────────────────────────

/**
 * 获取未使用的默契题目
 * @param {number} count - 需要的数量
 * @returns {Object[]} 题目数组
 */
export function popQuizQuestions(count) {
    const data = loadTreeData();
    const unused = data.questionBank.quiz.filter(q => !q.used);
    const selected = unused.slice(0, count);
    selected.forEach(q => { q.used = true; });
    saveTreeData(data);
    return selected;
}

/**
 * 获取未使用的真心话题目
 * @param {number} count
 * @returns {Object[]}
 */
export function popTodQuestions(count) {
    const data = loadTreeData();
    const unused = data.questionBank.tod.filter(q => !q.used);
    const selected = unused.slice(0, count);
    selected.forEach(q => { q.used = true; });
    saveTreeData(data);
    return selected;
}

/**
 * 按类型获取未使用的真心话题目
 * @param {'player'|'ai'} type - 题目类型
 * @param {number} count - 需要数量
 * @returns {Object[]}
 */
export function popTodQuestionsByType(type, count) {
    const data = loadTreeData();
    const unused = data.questionBank.tod.filter(q => !q.used && q.type === type);
    const selected = unused.slice(0, count);
    selected.forEach(q => { q.used = true; });
    saveTreeData(data);
    return selected;
}

/**
 * 获取剩余未使用题目数量
 */
export function getRemainingQuestions() {
    const data = loadTreeData();
    return {
        quiz: data.questionBank.quiz.filter(q => !q.used).length,
        tod: data.questionBank.tod.filter(q => !q.used).length,
    };
}

/**
 * 追加新题目到题库
 * @param {'quiz'|'tod'} type
 * @param {Object[]} questions
 */
export function appendQuestions(type, questions) {
    const data = loadTreeData();
    const existing = data.questionBank[type];
    const existingTexts = new Set(existing.map(q => q.question));

    for (const q of questions) {
        if (!existingTexts.has(q.question)) {
            existing.push({ ...q, used: false });
        }
    }

    data.questionBank.lastGeneratedAt = new Date().toISOString();
    saveTreeData(data);
    console.log(`${TREE_LOG_PREFIX} 追加 ${type} 题目 ${questions.length} 条，去重后总计 ${existing.length} 条`);
}

// ── 扭蛋图鉴 ─────────────────────────────────────────────────────────

/**
 * 记录获得的扭蛋物品到图鉴
 * @param {string} itemId
 */
export function addToCollection(itemId) {
    const data = loadTreeData();
    if (!data.gachaCollection.includes(itemId)) {
        data.gachaCollection.push(itemId);
    }
    saveTreeData(data);
}

/**
 * 获取图鉴（已收集的物品 ID 列表）
 */
export function getCollection() {
    return loadTreeData().gachaCollection;
}

// ── 剧情碎片 ─────────────────────────────────────────────────────────

/**
 * 添加剧情碎片
 * @param {number} fragmentId
 */
export function addStoryFragment(fragmentId) {
    const data = loadTreeData();
    if (!data.storyFragments.includes(fragmentId)) {
        data.storyFragments.push(fragmentId);
    }
    saveTreeData(data);
}

/**
 * 获取已收集的碎片列表
 */
export function getStoryFragments() {
    return loadTreeData().storyFragments;
}

// ── 游戏历史 ─────────────────────────────────────────────────────────

/**
 * 更新游戏历史（部分更新）
 * @param {Object} updates
 */
export function updateGameHistory(updates) {
    const data = loadTreeData();
    Object.assign(data.gameHistory, updates);
    saveTreeData(data);
}

/**
 * 获取游戏历史
 */
export function getGameHistory() {
    return loadTreeData().gameHistory;
}

// ── 设置 ──────────────────────────────────────────────────────────────

/**
 * 获取树树设置
 */
export function getTreeSettings() {
    return loadTreeData().settings;
}

/**
 * 更新设置
 * @param {Object} updates
 */
export function updateTreeSettings(updates) {
    const data = loadTreeData();
    Object.assign(data.settings, updates);
    saveTreeData(data);
}

// ═══════════════════════════════════════════════════════════════════════
// 数据迁移 / 重置
// ═══════════════════════════════════════════════════════════════════════

/**
 * 完全重置树数据（谨慎使用！）
 */
export function resetTreeData() {
    const data = createDefaultData();
    saveTreeData(data);
    console.log(`${TREE_LOG_PREFIX} 树数据已重置`);
    return data;
}

/**
 * 仅重置 LLM 生成的内容（台词 + 题目），保留树状态、图鉴、果实等
 * 用于玩家手动触发"重新生成内容"
 */
export function resetTreeContent() {
    const data = loadTreeData();
    // 清空台词缓存
    data.dialogueCache.careLines = [];
    data.dialogueCache.currentStage = '';
    // 清空题库
    data.questionBank.quiz = [];
    data.questionBank.tod = [];
    data.questionBank.lastGeneratedAt = '';
    saveTreeData(data);
    console.log(`${TREE_LOG_PREFIX} 台词内容已重置（树状态保留）`);
    return data;
}

/**
 * 导出树数据（用于备份/调试）
 */
export function exportTreeData() {
    return loadTreeData();
}

/**
 * 导入树数据（用于恢复/调试）
 * @param {Object} data
 */
export function importTreeData(data) {
    const merged = deepMerge(createDefaultData(), data);
    saveTreeData(merged);
    console.log(`${TREE_LOG_PREFIX} 树数据已导入`);
}

// ═══════════════════════════════════════════════════════════════════════
// 服务器同步 (Stage 6)
// ═══════════════════════════════════════════════════════════════════════

/** 防抖计时器 */
let _syncTimer = null;
const SYNC_DEBOUNCE_MS = 3000; // 3 秒内多次保存只同步一次

/**
 * 异步火忘同步到服务器（防抖）
 * @param {Object} data - 完整的树数据
 */
function _syncToServer(data) {
    const settings = getSettings();
    if (!settings.backendUrl || !settings.userId) return;

    // 安全防护：不上传空白/默认数据，防止覆盖服务器上的真实数据
    if (!data?.treeState?.treeName) {
        console.log(`${TREE_LOG_PREFIX} 跳过同步：本地数据无树名（空白默认值），不覆盖服务器`);
        return;
    }

    // 防抖：短时间内多次保存只触发最后一次
    if (_syncTimer) clearTimeout(_syncTimer);
    _syncTimer = setTimeout(async () => {
        try {
            await apiRequest('POST', `/api/tree/${encodeURIComponent(settings.userId)}`, { data });
            console.log(`${TREE_LOG_PREFIX} 数据已同步到服务器 ✅`);
        } catch (e) {
            console.warn(`${TREE_LOG_PREFIX} 服务器同步失败（不影响本地使用）:`, e.message);
        }
    }, SYNC_DEBOUNCE_MS);
}

/**
 * 手动强制同步当前本地数据到服务器（用于数据恢复）
 * 在原始浏览器的 console 中调用
 */
export async function forceSyncToServer() {
    const data = loadTreeData();
    if (!data?.treeState?.treeName) {
        console.error(`${TREE_LOG_PREFIX} 本地无有效数据，无法同步`);
        return false;
    }
    const settings = getSettings();
    if (!settings.backendUrl || !settings.userId) {
        console.error(`${TREE_LOG_PREFIX} 缺少 backendUrl 或 userId`);
        return false;
    }
    try {
        await apiRequest('POST', `/api/tree/${encodeURIComponent(settings.userId)}`, { data });
        console.log(`${TREE_LOG_PREFIX} 数据已强制同步到服务器 ✅`);
        return true;
    } catch (e) {
        console.error(`${TREE_LOG_PREFIX} 强制同步失败:`, e.message);
        return false;
    }
}

/**
 * 从服务器拉取树数据
 * @returns {Promise<Object|null>} 服务器上的树数据，或 null
 */
async function _pullFromServer() {
    const settings = getSettings();
    console.log(`${TREE_LOG_PREFIX} [云端恢复] 检查 settings: backendUrl=${!!settings.backendUrl}, userId=${settings.userId || '(空)'}`);
    if (!settings.backendUrl || !settings.userId) {
        console.warn(`${TREE_LOG_PREFIX} [云端恢复] 跳过拉取：缺少 backendUrl 或 userId`);
        return null;
    }

    try {
        const result = await apiRequest('GET', `/api/tree/${encodeURIComponent(settings.userId)}`);
        console.log(`${TREE_LOG_PREFIX} [云端恢复] 服务器返回:`, JSON.stringify(result).slice(0, 200));
        if (result && result.data) {
            console.log(`${TREE_LOG_PREFIX} 从服务器恢复数据 ✅ treeName=${result.data?.treeState?.treeName}`);
            return result.data;
        } else {
            console.warn(`${TREE_LOG_PREFIX} [云端恢复] 服务器返回 data 为空/null — 服务器上无此用户的树数据`);
        }
    } catch (e) {
        console.warn(`${TREE_LOG_PREFIX} 从服务器拉取数据失败:`, e.message);
    }
    return null;
}

/**
 * 异步初始化：如果本地无数据，尝试从服务器恢复
 * 应在 treeApp.js 首次打开时调用
 * @returns {Promise<Object>} 树数据（本地或服务器来源）
 */
export async function initTreeDataFromServer() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
        try {
            const local = JSON.parse(raw);
            // 本地有数据且有树名 → 真实数据，直接用本地
            if (local?.treeState?.treeName) {
                console.log(`${TREE_LOG_PREFIX} [云端恢复] 本地已有有效数据 (${local.treeState.treeName})，跳过服务器拉取`);
                return loadTreeData();
            }
            // 本地有数据但无树名 → 之前只写了空白默认值，仍需尝试服务器
            console.log(`${TREE_LOG_PREFIX} [云端恢复] 本地有数据但无树名（空白默认值），尝试从服务器拉取…`);
        } catch (e) {
            console.warn(`${TREE_LOG_PREFIX} [云端恢复] 本地数据解析失败，尝试从服务器拉取…`);
        }
    } else {
        console.log(`${TREE_LOG_PREFIX} [云端恢复] 本地无数据，尝试从服务器拉取…`);
    }

    // 本地无有效数据，尝试从服务器恢复
    const serverData = await _pullFromServer();
    if (serverData) {
        const merged = deepMerge(createDefaultData(), serverData);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
        console.log(`${TREE_LOG_PREFIX} 已从服务器恢复数据到本地 ✅`);
        return merged;
    }

    console.warn(`${TREE_LOG_PREFIX} [云端恢复] 服务器也无数据，使用全新默认值`);
    return createDefaultData();
}

// ═══════════════════════════════════════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════════════════════════════════════

/**
 * 深度合并对象（target 为默认值，source 为已存储的值）
 * source 的值覆盖 target，但 target 中新增的字段会被保留
 */
function deepMerge(target, source) {
    const result = { ...target };
    for (const key of Object.keys(source)) {
        if (
            source[key] !== null &&
            typeof source[key] === 'object' &&
            !Array.isArray(source[key]) &&
            typeof target[key] === 'object' &&
            !Array.isArray(target[key])
        ) {
            result[key] = deepMerge(target[key], source[key]);
        } else {
            result[key] = source[key];
        }
    }
    return result;
}

/**
 * 根据成长值返回阶段 ID（内联版本，避免循环导入 treeConfig）
 * 阈值与 treeConfig.GROWTH_STAGES 保持一致
 */
function _getStageId(growth) {
    if (growth >= 2000) return 'big';
    if (growth >= 1200) return 'medium';
    if (growth >= 600) return 'small';
    if (growth >= 200) return 'sprout';
    return 'seed';
}

// ═══════════════════════════════════════════════════════════════════════
// 果实收集
// ═══════════════════════════════════════════════════════════════════════

/**
 * 添加果实到收集列表
 * @param {string} treeType - 树种 ID (apple / cherry / ...)
 * @returns {boolean} 是否是新收集的（true = 新果实）
 */
export function addFruitToCollection(treeType) {
    const data = loadTreeData();
    if (data.treeState.fruitsCollected.includes(treeType)) {
        return false; // 已有
    }
    data.treeState.fruitsCollected.push(treeType);
    saveTreeData(data);
    console.log(`${TREE_LOG_PREFIX} 收集到新果实: ${treeType} 🎉`);
    return true;
}

/**
 * 获取已收集的果实列表
 * @returns {string[]}
 */
export function getFruitsCollected() {
    return loadTreeData().treeState.fruitsCollected || [];
}

// ═══════════════════════════════════════════════════════════════════════
// 大树归档（图鉴）
// ═══════════════════════════════════════════════════════════════════════

/**
 * 归档当前大树（毕业），重置树状态为新树
 * @param {string} newTreeType - 新树种 ID
 * @param {string} newTreeName - 新树名字
 * @returns {Object} 归档记录
 */
export function archiveCurrentTree(newTreeType, newTreeName) {
    const data = loadTreeData();
    const currentState = data.treeState;

    // 保存归档记录
    const archiveRecord = {
        treeType: currentState.treeType,
        treeName: currentState.treeName,
        completedAt: new Date().toISOString(),
    };
    data.treeArchive.push(archiveRecord);

    // 重置树状态
    data.treeState = {
        treeName: newTreeName,
        treeType: newTreeType,
        growth: 0,
        stage: 'seed',
        dailyCareCount: 0,
        lastCareDate: '',
        bonusCareCount: 0,
        aiCaredToday: false,
        adoptedAt: new Date().toISOString(),
        totalCareDays: 0,
        fruitsCollected: currentState.fruitsCollected || [], // 果实收集保留
    };

    // 清空旧台词缓存（新树需要新台词）
    data.dialogueCache = {
        careLines: [],
        currentStage: '',
        generatedAt: '',
    };

    saveTreeData(data);
    console.log(`${TREE_LOG_PREFIX} 大树归档: ${archiveRecord.treeName} (${archiveRecord.treeType})`);
    return archiveRecord;
}

/**
 * 获取已归档的大树列表（图鉴）
 * @returns {Object[]}
 */
export function getTreeArchive() {
    return loadTreeData().treeArchive || [];
}

/**
 * 获取已养过的树种 ID 列表（当前 + 归档）
 * @returns {string[]}
 */
export function getCompletedTreeTypes() {
    const data = loadTreeData();
    const archived = (data.treeArchive || []).map(a => a.treeType);
    if (data.treeState.treeType) {
        archived.push(data.treeState.treeType);
    }
    return [...new Set(archived)];
}
