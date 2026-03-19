// modules/phone/tree/treeQuestions.js — 题库 LLM Prompt 模板 + 校验工具
// LLM 生成的题目存储在 treeStorage 中。
// 不再使用内置兜底题库 — 玩家驱动质检确保 LLM 内容质量。

// ═══════════════════════════════════════════════════════════════════════
// 随机种子池 — 给 LLM 注入脑洞灵感，打破千篇一律
// ═══════════════════════════════════════════════════════════════════════

/** 默契挑战 / 情景题脑洞种子 */
const QUIZ_WILD_SEEDS = [
    '末日生存', '穿越到古代', '变成猫', '突然获得一百万', '读心术',
    '隐身能力', '时间暂停', '交换身体', '外星人入侵', '中了彩票',
    '被困荒岛', '回到十年前', '获得超能力', '突然失忆', '变成巨人',
    '缩小到蚂蚁大小', '进入游戏世界', '穿越到电影里', '成为总统',
    '被鬼追', '住进鬼屋', '困在电梯里', '暴风雪中迷路',
    '突然变成透明人', '被选中参加真人秀', '意外得到一只独角兽',
    '被困在同一天的时间循环', '发现家里有密室', '收到未来自己的信',
    '突然会说动物语言', '参加吃辣比赛', '变成对方的宠物一天',
    '被困在游乐园过夜', '在演唱会上被点名上台', '考试迟到了',
    '结婚典礼出了意外', '忘记重要纪念日', '在公共场合放了巨响的屁',
    '走路摔了个狗啃泥', '被前任当面表白', '做了个超级离谱的梦',
    '手机掉进马桶', '被困在超市冷库里', '坐过山车时机器停了',
    '旅行时行李全丢了', '约会时钱包不见了', '在面试中打了个喷嚏',
    '误发消息给了老板', '吃到超级难吃的黑暗料理',
];

/** 真心话脑洞种子 — 通用有趣问题方向 */
const TOD_TRUTH_SEEDS = [
    '最丢脸的经历', '最离谱的梦', '最后悔的决定', '不为人知的怪癖',
    '最想拥有的超能力', '最怕的东西', '最尴尬的约会经历',
    '做过最疯狂的事', '对未来最浪漫的幻想', '小时候最蠢的想法',
    '如果世界只剩72小时', '最想去的平行宇宙', '一个人的时候会做什么奇怪的事',
    '最不想让对方知道的事', '最想偷偷做的坏事', '对另一半隐瞒过什么',
    '最想体验的职业', '最讨厌被问的问题', '洗澡时会不会唱歌',
    '最想穿越到哪个时代', '最想删除的一段记忆', '有没有假装没看到消息',
    '最想和对方一起做的冒险', '睡觉时有什么奇怪习惯',
    '有没有偷偷闻过对方的衣服', '最想对十年前的自己说什么',
    '最大的guilty pleasure', '有没有对着镜子自言自语过',
    '做过最肉麻的事', '最近一次哭是因为什么',
    '最怕对方发现自己的什么', '最意想不到的才能',
    '如果可以交换性别一天会做什么', '最近撒过的谎',
];

/**
 * 从种子池中随机抽取 N 个不重复的种子
 * @param {string[]} pool - 种子池
 * @param {number} count - 抽取数量
 * @returns {string[]}
 */
function _pickRandomSeeds(pool, count) {
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, Math.min(count, pool.length));
}

// ═══════════════════════════════════════════════════════════════════════
// LLM 生成 Prompt 模板
// ═══════════════════════════════════════════════════════════════════════

/**
 * 生成默契挑战题目的 prompt 模板
 * 题目为假设性情景题，考验玩家对角色性格的了解
 * 每题有正确答案（answer 字段，0-3 索引）
 * @param {string} charName - AI恋人的名字
 * @param {string} userName - 玩家的名字
 * @param {number} count - 需要生成的题目数量
 */
export function buildQuizPrompt(charName, userName, count = 10) {
    const seeds = _pickRandomSeeds(QUIZ_WILD_SEEDS, 5);
    const seedList = seeds.map(s => `「${s}」`).join('、');

    return `请你暂时担当一位特别的**情侣默契挑战游戏**题目设计师。为${charName}和${userName}这对情侣生成 ${count} 道默契挑战题目。

这是一个考验 ${userName} 对 ${charName} 性格了解程度的游戏。

**题目设计核心原则**：
1. 题目必须是**假设性情景题** — 预设一些从未发生过的虚构场景，让玩家根据对 ${charName} 性格的了解来推断 ${charName} 会怎么做/选择/反应
2. **绝对禁止**直接考察角色资料或世界书中已经写明的信息（如生日、喜好列表、背景故事等事实性问题）
3. 正确答案必须能从 ${charName} 的性格特征中合理推断出来

**🎲 随机性与创意要求（极其重要）**：
- 本次的脑洞灵感种子：${seedList}
- 题目中至少 **60%** 必须是天马行空、脑洞大开的离谱场景，不要只围绕日常恋爱互动
- 把灵感种子融入情景题中，创造出意想不到的有趣场景
- 另外 **40%** 可以基于${charName}的性格和日常互动来出题
- **禁止出现"如果突然下雨""在游乐园排队""收到礼物"这类老套恋爱情景**，要更有创意！

**好的题目示例思路**：
- "如果${charName}突然获得了读心术，第一件事会？"（脑洞 + 性格推断）
- "世界末日只剩24小时，${charName}会带走的三样东西中不包括？"（脑洞 + 价值观推断）
- "如果${charName}和${userName}交换身体一天，${charName}最先做的事是？"（脑洞 + 性格推断）
- "${charName}被困在荒岛上，最先崩溃的原因是？"（脑洞 + 性格推断）

**差的题目示例**（禁止出现）：
- "${charName}最喜欢的颜色是？" ← 事实性问题
- "${charName}的生日是几月？" ← 直接考察资料
- "如果突然下暴雨但只有一把伞" ← 太老套

要求：
1. 每题 4 个选项，其中有且仅有 1 个正确答案
2. answer 字段是正确选项的索引（0-3）
3. 题目应该有趣、有创意、出人意料
4. 难度适中 — 了解 ${charName} 性格的人能答对，但不是一眼看穿
5. 可以包含情侣间色色、调情、亲密互动的火辣暧昧内容
6. **每道题的场景都必须不同，禁止重复同类型场景**

请严格按以下 JSON 格式输出，不要添加任何其她文字：
[
  { "question": "题目内容", "options": ["选项A", "选项B", "选项C", "选项D"], "answer": 0 }
]`;
}

/**
 * 生成真心话题目的 prompt 模板
 * @param {string} charName
 * @param {string} userName
 * @param {number} count
 */
export function buildTodPrompt(charName, userName, count = 10) {
    const half = Math.ceil(count / 2);
    const seeds = _pickRandomSeeds(TOD_TRUTH_SEEDS, 5);
    const seedList = seeds.map(s => `「${s}」`).join('、');

    return `请你暂时担当一位特别的**情侣真心话大冒险**题目设计师。为${charName}和${userName}这对情侣生成 ${count} 道真心话题目。

题目分两类：
- type: "player"（${half} 道）— 这是 ${charName} 问 ${userName} 的问题，由 ${userName} 来回答
- type: "ai"（${count - half} 道）— 这是 ${userName} 问 ${charName} 的问题，由 ${charName} 来回答

⚠️ 极其重要的规则：
1. 题目中**禁止使用「我」「你」等代词**，必须直接使用 ${charName} 和 ${userName} 的名字
2. player 类题目的主语/提问方向是 ${charName} → ${userName}，例：「${userName}，你最近一次偷偷想${charName}是什么时候？」
3. ai 类题目的主语/提问方向是 ${userName} → ${charName}，例：「${charName}，如果有一天${userName}消失了，你会怎么做？」

**🎲 随机性与创意要求（极其重要）**：
- 本次的脑洞灵感种子：${seedList}
- 题目中至少 **60%** 必须是天马行空、大胆、出人意料的问题
- 把灵感种子融入真心话问题中，创造出让人又害羞又想回答的有趣问题
- 另外 **40%** 可以基于感情和日常互动来出题
- **禁止出现"最喜欢对方什么""第一次见面的感受""最感动的事"这类老套恋爱问题**，要更大胆、更有创意！
- 问题可以刁钻、搞怪、让人脸红，但不能冒犯

要求：
1. 题目要有深度、能促进彼此了解、但也要有趣
2. 可以包含甜蜜、搞笑、略带挑战性的问题
3. 题目要有独创性，不要使用常见的恋爱问题模板
4. 可以包含情侣间色色、调情、亲密互动的火辣暧昧内容
5. **每道题的主题和角度都必须不同，禁止重复同类问题**

请严格按以下 JSON 格式输出，不要添加任何其她文字：
[
  { "question": "题目内容", "type": "player" },
  { "question": "题目内容", "type": "ai" }
]`;
}

// ═══════════════════════════════════════════════════════════════════════
// 题库验证工具
// ═══════════════════════════════════════════════════════════════════════

/**
 * 校验 LLM 生成的默契题目格式是否合法
 * 现在要求 answer 字段（正确选项索引 0-3）
 * @param {*} data - JSON.parse 后的数据
 * @returns {{ valid: boolean, items: object[], errors: string[] }}
 */
export function validateQuizQuestions(data) {
    const errors = [];
    const items = [];

    if (!Array.isArray(data)) {
        return { valid: false, items: [], errors: ['返回数据不是数组'] };
    }

    for (let i = 0; i < data.length; i++) {
        const q = data[i];
        if (!q.question || typeof q.question !== 'string') {
            errors.push(`题目 #${i + 1}: 缺少 question 字段`);
            continue;
        }
        if (!Array.isArray(q.options) || q.options.length < 2) {
            errors.push(`题目 #${i + 1}: options 不是有效数组`);
            continue;
        }
        // 补齐到 4 个选项（如果 LLM 只输出了 2-3 个）
        while (q.options.length < 4) {
            q.options.push('其它');
        }
        // 验证 answer 字段
        let answer = typeof q.answer === 'number' ? q.answer : 0;
        if (answer < 0 || answer >= q.options.length) {
            answer = 0; // fallback to first option
        }
        items.push({
            question: q.question.trim(),
            options: q.options.map(o => String(o).trim()),
            answer,
        });
    }

    return { valid: items.length > 0, items, errors };
}

/**
 * 校验 LLM 生成的真心话题目格式是否合法
 * @param {*} data
 * @returns {{ valid: boolean, items: object[], errors: string[] }}
 */
export function validateTodQuestions(data) {
    const errors = [];
    const items = [];

    if (!Array.isArray(data)) {
        return { valid: false, items: [], errors: ['返回数据不是数组'] };
    }

    for (let i = 0; i < data.length; i++) {
        const q = data[i];
        if (!q.question || typeof q.question !== 'string') {
            errors.push(`题目 #${i + 1}: 缺少 question 字段`);
            continue;
        }
        const type = (q.type === 'ai') ? 'ai' : 'player'; // 默认归为 player
        items.push({ question: q.question.trim(), type });
    }

    return { valid: items.length > 0, items, errors };
}

// ═══════════════════════════════════════════════════════════════════════
// 每轮用量常量
// ═══════════════════════════════════════════════════════════════════════

/** 每轮默契挑战抽取的题目数 */
export const QUIZ_PER_ROUND = 5;

/** 当剩余未使用题目 ≤ 此值时提醒补充 */
export const QUIZ_LOW_THRESHOLD = QUIZ_PER_ROUND * 2; // 10 题

/** 每轮真心话大冒险的回合数 */
export const TOD_ROUNDS_PER_GAME = 6;

/** 当剩余未使用真心话 ≤ 此值时提醒补充 */
export const TOD_LOW_THRESHOLD = TOD_ROUNDS_PER_GAME * 2; // 12 题
