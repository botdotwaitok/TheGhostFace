// modules/phone/tree/treeConfig.js — 树的成长阶段配置、照顾动作定义、成长值公式

// ═══════════════════════════════════════════════════════════════════════
// 成长阶段定义
// ═══════════════════════════════════════════════════════════════════════

/**
 * 树的成长阶段配置
 * 每阶段需要玩家花费较长时间培育（不照顾也不掉数值，零压力设计）
 *
 * 按默认每日 5 次照顾（玩家 4 种动作各 1 次 + AI 恋人 1 次）估算：
 *   - 浇水 +4, 施肥 +6, 唱歌 +3, 抚摸 +2 → 玩家每日固定 +15
 *   - AI 随机照顾 ≈ +3.75/次 → 每天 ≈ +19/天
 *   - 小游戏奖励 ≈ +5-10/天
 *   - 总计 ≈ +25-30/天 → 阶段跨度 200-800 点 → 约 7-30 天
 *   - 一棵树从种子到大树约 80 天
 */
export const GROWTH_STAGES = [
    {
        id: 'seed',
        name: '种子',
        emoji: '🌱',
        minGrowth: 0,
        maxGrowth: 199,
    },
    {
        id: 'sprout',
        name: '嫩芽',
        emoji: '🌿',
        minGrowth: 200,
        maxGrowth: 599,
    },
    {
        id: 'small',
        name: '小树',
        emoji: '🌳',
        minGrowth: 600,
        maxGrowth: 1199,
    },
    {
        id: 'medium',
        name: '中树',
        emoji: '🎄',
        minGrowth: 1200,
        maxGrowth: 1999,
    },
    {
        id: 'big',
        name: '大树',
        emoji: '🎄',
        minGrowth: 2000,
        maxGrowth: Infinity,
    },
];

// ═══════════════════════════════════════════════════════════════════════
// 季节系统
// ═══════════════════════════════════════════════════════════════════════

export const SEASONS = [
    { id: 'spring', name: '春', emoji: '🌸', months: [3, 4, 5] },
    { id: 'summer', name: '夏', emoji: '☀️', months: [6, 7, 8] },
    { id: 'autumn', name: '秋', emoji: '🍂', months: [9, 10, 11] },
    { id: 'winter', name: '冬', emoji: '❄️', months: [12, 1, 2] },
];

/**
 * 根据当前月份获取季节
 * @param {Date} [date] - 可选，默认当前时间
 * @returns {Object} season object from SEASONS
 */
export function getCurrentSeason(date = new Date()) {
    const month = date.getMonth() + 1; // 1-12
    return SEASONS.find(s => s.months.includes(month)) || SEASONS[0];
}

// ═══════════════════════════════════════════════════════════════════════
// 树种配置（8 种星露谷风格果树）
// ═══════════════════════════════════════════════════════════════════════

export const TREE_TYPES = [
    { id: 'apple', name: '苹果树', emoji: '🍎', fruitName: '苹果' },
    { id: 'apricot', name: '杏树', emoji: '🍑', fruitName: '杏子' },
    { id: 'banana', name: '香蕉树', emoji: '🍌', fruitName: '香蕉' },
    { id: 'cherry', name: '樱桃树', emoji: '🍒', fruitName: '樱桃' },
    { id: 'mango', name: '芒果树', emoji: '🥭', fruitName: '芒果' },
    { id: 'orange', name: '橙子树', emoji: '🍊', fruitName: '橙子' },
    { id: 'peach', name: '蜜桃树', emoji: '🍑', fruitName: '蜜桃' },
    { id: 'pomegranate', name: '石榴树', emoji: '🍎', fruitName: '石榴' },
];

/**
 * 获取树种配置
 * @param {string} typeId - 树种 ID
 * @returns {Object|undefined}
 */
export function getTreeType(typeId) {
    return TREE_TYPES.find(t => t.id === typeId);
}

/**
 * 随机分配一种树种（排除已养过的）
 * @param {string[]} excludeIds - 要排除的树种 ID 列表
 * @returns {Object} 随机选中的树种
 */
export function getRandomTreeType(excludeIds = []) {
    const available = TREE_TYPES.filter(t => !excludeIds.includes(t.id));
    // 如果全都养过了，从头开始（允许重复）
    const pool = available.length > 0 ? available : TREE_TYPES;
    return pool[Math.floor(Math.random() * pool.length)];
}

// ═══════════════════════════════════════════════════════════════════════
// 果实收集配置
// ═══════════════════════════════════════════════════════════════════════

export const FRUIT_CONFIG = {
    /** 中树阶段收集几率 */
    medium: { chance: 0.15 },
    /** 大树阶段收集几率 */
    big: { chance: 0.35 },
    /** 只在秋天出现果实 */
    season: 'autumn',
};

// ═══════════════════════════════════════════════════════════════════════
// 素材路径
// ═══════════════════════════════════════════════════════════════════════

const TREE_ASSET_BASE = '/scripts/extensions/third-party/TheGhostFace/assets/images/tree';

/**
 * 阶段 ID → 素材文件的 stage 编号映射
 * seed=stage0, sprout=stage1, small=stage2, medium=stage3
 * big 阶段使用季节名（spring/summer/autumn/winter）
 */
const STAGE_TO_FILE = {
    seed: 'stage0',
    sprout: 'stage1',
    small: 'stage2',
    medium: 'stage3',
};

/**
 * 季节 × 阶段对应的描述文案（用于 alt text 和无图片时的 fallback 显示）
 */
export const STAGE_SEASON_DESCRIPTIONS = {
    seed: { spring: '嫩绿种子', summer: '嫩绿种子', autumn: '嫩绿种子', winter: '雪覆种子' },
    sprout: { spring: '翠绿嫩芽', summer: '翠绿嫩芽', autumn: '翠绿嫩芽', winter: '光秃带雪' },
    small: { spring: '开花小树', summer: '茂密绿树', autumn: '红叶小树', winter: '雪挂树枝' },
    medium: { spring: '满树花', summer: '果实累累', autumn: '金黄落叶', winter: '冰晶装饰' },
    big: { spring: '花瓣飞舞', summer: '光辉灿烂', autumn: '丰收盛景', winter: '冬日奇迹' },
};

/**
 * 获取树素材图片路径
 * - seed/sprout/small/medium: tree_{type}_stage{0-3}.png（不分季节）
 * - big: tree_{type}_{season}.png（四季各一张）
 *
 * @param {string} treeType - 树种 ID (apple / cherry / ...)
 * @param {string} stageId - 成长阶段 ID (seed / sprout / small / medium / big)
 * @param {string} seasonId - 季节 ID (spring / summer / autumn / winter)
 * @returns {string} 图片路径
 */
export function getTreeImagePath(treeType, stageId, seasonId) {
    if (stageId === 'big') {
        // 大树阶段分四季
        return `${TREE_ASSET_BASE}/tree_${treeType}_${seasonId}.png`;
    }
    // 其她阶段用 stage 编号，不分季节
    const fileSuffix = STAGE_TO_FILE[stageId] || 'stage0';
    return `${TREE_ASSET_BASE}/tree_${treeType}_${fileSuffix}.png`;
}

/**
 * 获取果实图片路径
 * @param {string} treeType - 树种 ID
 * @returns {string} 果实图片路径
 */
export function getFruitImagePath(treeType) {
    return `${TREE_ASSET_BASE}/tree_${treeType}_stump.png`;
}

/**
 * Fallback: 如果图片不存在，返回第一种树（apple）的对应图片
 * 用法：在 img.onerror 中调用
 * @param {string} stageId
 * @param {string} seasonId
 * @returns {string}
 */
export function getTreeImageFallback(stageId, seasonId) {
    return getTreeImagePath('apple', stageId, seasonId);
}

// ═══════════════════════════════════════════════════════════════════════
// 照顾动作定义
// ═══════════════════════════════════════════════════════════════════════

export const CARE_ACTIONS = [
    { id: 'water', name: '浇水', emoji: '💧', icon: 'fa-solid fa-droplet', growthValue: 4 },
    { id: 'feed', name: '施肥', emoji: '💩', icon: 'fa-solid fa-seedling', growthValue: 6 },
    { id: 'sing', name: '唱歌', emoji: '🎵', icon: 'fa-solid fa-music', growthValue: 3 },
    { id: 'pet', name: '抚摸', emoji: '🤗', icon: 'fa-solid fa-hand-holding-heart', growthValue: 2 },
];

// ═══════════════════════════════════════════════════════════════════════
// 每日限额
// ═══════════════════════════════════════════════════════════════════════

/** 玩家每日基础照顾次数（每个动作每天限 1 次，一共 4 种动作 = 4 次） */
export const DAILY_CARE_MAX = CARE_ACTIONS.length;

/** AI 恋人每日自动照顾次数 */
export const AI_DAILY_CARE_COUNT = 1;

// ═══════════════════════════════════════════════════════════════════════
// 成长值辅助函数
// ═══════════════════════════════════════════════════════════════════════

/**
 * 根据当前成长值获取对应的阶段
 * @param {number} growth - 当前成长值
 * @returns {Object} GROWTH_STAGES 中的一个阶段对象
 */
export function getStageByGrowth(growth) {
    for (let i = GROWTH_STAGES.length - 1; i >= 0; i--) {
        if (growth >= GROWTH_STAGES[i].minGrowth) {
            return GROWTH_STAGES[i];
        }
    }
    return GROWTH_STAGES[0];
}

/**
 * 获取当前阶段的成长进度（0-1）
 * @param {number} growth - 当前成长值
 * @returns {number} 进度比例 0.0 ~ 1.0
 */
export function getGrowthProgress(growth) {
    const stage = getStageByGrowth(growth);
    if (stage.maxGrowth === Infinity) return 1; // 已到最高阶段
    const range = stage.maxGrowth - stage.minGrowth + 1;
    const current = growth - stage.minGrowth;
    return Math.min(1, current / range);
}

/**
 * 检查成长值增加后是否触发阶段升级
 * @param {number} oldGrowth - 增加前的成长值
 * @param {number} newGrowth - 增加后的成长值
 * @returns {Object|null} 如果升级了，返回新阶段对象；否则 null
 */
export function checkStageUp(oldGrowth, newGrowth) {
    const oldStage = getStageByGrowth(oldGrowth);
    const newStage = getStageByGrowth(newGrowth);
    if (newStage.id !== oldStage.id) {
        return newStage;
    }
    return null;
}

// ═══════════════════════════════════════════════════════════════════════
// 小游戏奖励配置
// ═══════════════════════════════════════════════════════════════════════

export const GAME_REWARDS = {
    quiz: {
        /** 默契挑战：≥4/5 */
        pass: { bonusCare: 0, bonusGrowth: 8 },
        /** 默契挑战：5/5 满分 */
        perfect: { bonusCare: 0, bonusGrowth: 10, title: '心有灵犀' },
    },
    tod: {
        /** 真心话大冒险：完成一轮 */
        complete: { bonusCare: 0, bonusGrowth: 5 },
    },
};

/** 每日小游戏次数限制 */
export const DAILY_QUIZ_MAX = 3;
export const DAILY_TOD_MAX = 1;

// ═══════════════════════════════════════════════════════════════════════
// 扭蛋配置
// ═══════════════════════════════════════════════════════════════════════

/** 每日免费扭蛋次数 */
export const DAILY_FREE_GACHA = 1;

/** 保底机制：连续 N 次空气后必出稀有 */
export const GACHA_PITY_THRESHOLD = 5;

/** 稀有度等级 */
export const RARITY = {
    COMMON: { id: 'common', name: '普通', color: '#b0b0b0', label: '⬜' },
    RARE: { id: 'rare', name: '稀有', color: '#4a9eff', label: '🟦' },
    EPIC: { id: 'epic', name: '史诗', color: '#a855f7', label: '🟪' },
};

/**
 * 扭蛋奖池
 * weight = 相对权重（越高越容易抽到）
 * pityExclude = true 表示保底时不会出这个
 */
export const GACHA_POOL = [
    // 普通
    { id: 'care_ticket_1', name: '小肥料', emoji: '🌿', rarity: RARITY.COMMON, weight: 30, effect: { type: 'bonusGrowth', value: 5 }, description: '成长值 +5' },
    { id: 'small_fertilizer', name: '小粑粑肥料', emoji: '🌱', rarity: RARITY.COMMON, weight: 25, effect: { type: 'bonusGrowth', value: 10 }, description: '成长值 +10' },
    { id: 'air', name: '一个没有意义的屁', emoji: '💨', rarity: RARITY.COMMON, weight: 35, effect: { type: 'none' }, description: '谢谢参与嘻嘻~', pityExclude: true },

    // 稀有
    { id: 'care_ticket_3', name: '神秘浇灌', emoji: '🏟️', rarity: RARITY.RARE, weight: 8, effect: { type: 'bonusGrowth', value: 15 }, description: '成长值 +15' },
    { id: 'big_fertilizer', name: '神秘大便肥料', emoji: '✨', rarity: RARITY.RARE, weight: 8, effect: { type: 'bonusGrowth', value: 30 }, description: '成长值 +30' },
    { id: 'story_fragment_1', name: '剧情碎片·壹', emoji: '📜', rarity: RARITY.RARE, weight: 6, effect: { type: 'storyFragment', value: 1 }, description: '收集碎片解锁隐藏故事' },
    { id: 'story_fragment_2', name: '剧情碎片·贰', emoji: '📜', rarity: RARITY.RARE, weight: 6, effect: { type: 'storyFragment', value: 2 }, description: '收集碎片解锁隐藏故事' },
    { id: 'story_fragment_3', name: '剧情碎片·叁', emoji: '📜', rarity: RARITY.RARE, weight: 6, effect: { type: 'storyFragment', value: 3 }, description: '收集碎片解锁隐藏故事' },

    // 史诗
    { id: 'golden_dew', name: '恶灵的眼泪', emoji: '💎', rarity: RARITY.EPIC, weight: 2, effect: { type: 'bonusGrowth', value: 50 }, description: '成长值 +50！' },
    { id: 'ai_dialogue', name: '你对象写的情书', emoji: '💌', rarity: RARITY.EPIC, weight: 3, effect: { type: 'triggerDialogue' }, description: '触发一段专属甜蜜台词' },
];

