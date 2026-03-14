// modules/phone/tree/treeQuestions.js — 题库 LLM Prompt 模板 + 校验工具
// LLM 生成的题目存储在 treeStorage 中。
// 不再使用内置兜底题库 — 玩家驱动质检确保 LLM 内容质量。

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
    return `请你暂时担当一位特别的**情侣默契挑战游戏**题目设计师。为${charName}和${userName}这对情侣生成 ${count} 道默契挑战题目。

这是一个考验 ${userName} 对 ${charName} 性格了解程度的游戏。

**题目设计核心原则**：
1. 题目必须是**假设性情景题** — 预设一些从未发生过的虚构场景，让玩家根据对 ${charName} 性格的了解来推断 ${charName} 会怎么做/选择/反应
2. **绝对禁止**直接考察角色资料或世界书中已经写明的信息（如生日、喜好列表、背景故事等事实性问题）
3. 正确答案必须能从 ${charName} 的性格特征中合理推断出来

**好的题目示例思路**：
- "如果突然下暴雨但只有一把伞，${charName}会？"（考察性格中的体贴/独立/浪漫倾向）
- "在游乐园排了两小时的队，${charName}最可能的反应是？"（考察耐心/情绪表达方式）
- "发现${userName}偷偷买了个昂贵的礼物，${charName}会？"（考察金钱观/惊喜反应）

**差的题目示例**（禁止出现）：
- "${charName}最喜欢的颜色是？" ← 事实性问题
- "${charName}的生日是几月？" ← 直接考察资料

要求：
1. 每题 4 个选项，其中有且仅有 1 个正确答案
2. answer 字段是正确选项的索引（0-3）
3. 题目应该有趣、甜蜜、有时带点调皮
4. 难度适中 — 了解 ${charName} 性格的人能答对，但不是一眼看穿
5. 可以包含情侣间色色、调情、亲密互动的火辣暧昧内容

禁止事项（严格遵守）：
- 绝对不允许任何性别刻板印象、性别偏见或厌女内容
- 不允许出现「女生就是…」「女人都…」等性别化表述
- 题目语气应该温暖、尊重、平等

**语言要求**：题目和选项必须使用角色描述中所使用的语言来书写（如角色描述是英文则用英文，中文则用中文，以此类推）。

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
    return `请你暂时担当一位特别的**情侣真心话大冒险**题目设计师。为${charName}和${userName}这对情侣生成 ${count} 道真心话题目。

题目分两类：
- type: "player"（${half} 道）— 这是 ${charName} 问 ${userName} 的问题，由 ${userName} 来回答
- type: "ai"（${count - half} 道）— 这是 ${userName} 问 ${charName} 的问题，由 ${charName} 来回答

⚠️ 极其重要的规则：
1. 题目中**禁止使用「我」「你」等代词**，必须直接使用 ${charName} 和 ${userName} 的名字
2. player 类题目的主语/提问方向是 ${charName} → ${userName}，例：「${userName}，你最近一次偷偷想${charName}是什么时候？」
3. ai 类题目的主语/提问方向是 ${userName} → ${charName}，例：「${charName}，如果有一天${userName}消失了，你会怎么做？」

要求：
1. 题目要有深度、能促进彼此了解、但也要有趣
2. 可以包含甜蜜、搞笑、略带挑战性的问题
3. 题目要有独创性，不要使用常见的恋爱问题模板
4. 可以包含情侣间色色、调情、亲密互动的火辣暧昧内容

禁止事项（严格遵守）：
- 绝对不允许任何性别刻板印象、性别偏见或厌女内容
- 不允许出现「女生就是…」「女人都…」等性别化表述
- 题目语气应该温暖、尊重、平等

**语言要求**：题目必须使用角色描述中所使用的语言来书写（如角色描述是英文则用英文，中文则用中文，以此类推）。

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
