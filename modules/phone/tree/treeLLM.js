// modules/phone/tree/treeLLM.js — 树树 LLM 调用层
// Stage 4: 集中管理所有 LLM 相关调用。
// Stage 5: 玩家驱动质检 — 分步生成 + 玩家确认流程，不使用兜底内容。
// Stage 6: LLM 输出清洗 — 过滤朋友圈/评论格式 + 注入 moments + 清理 <> 标签。

import { callPhoneLLM } from '../../api.js';
import { handleMainChatOutput } from '../moments/momentsWorldInfo.js';
import {
    getPhoneCharInfo, getPhoneUserName, getPhoneUserPersona,
    getCoreFoundationPrompt, getPhoneContext, getPhoneWorldBookContext,
} from '../phoneContext.js';
import {
    GROWTH_STAGES, CARE_ACTIONS, STAGE_SEASON_DESCRIPTIONS,
    getCurrentSeason,
} from './treeConfig.js';
import {
    loadTreeData, saveTreeData, saveCareLines, getRemainingCareLines,
    appendQuestions, getRemainingQuestions, getTreeState,
} from './treeStorage.js';
import {
    buildQuizPrompt, buildTodPrompt,
    validateQuizQuestions, validateTodQuestions,
    QUIZ_LOW_THRESHOLD, TOD_LOW_THRESHOLD,
} from './treeQuestions.js';

const LOG = '[树树·LLM]';

/** Minimum acceptable care lines after generation */
const MIN_CARE_LINES = 5;
/** Lines per batch */
const BATCH_SIZE = 5;
/** Number of batches */
const BATCH_COUNT = 2;

/**
 * 组装完整的角色 + 玩家 + 世界书上下文块（不截断）。
 * 各 LLM 生成函数在 system prompt 中拼接此段，
 * 确保 LLM 拥有写出细腻个性化内容所需的全部素材。
 */
async function _buildCharContext() {
    const charInfo = getPhoneCharInfo();
    const persona = getPhoneUserPersona();
    const worldBook = await getPhoneWorldBookContext();

    let ctx = '';

    if (charInfo) {
        if (charInfo.description) ctx += `\n#### 角色描述\n${charInfo.description}\n`;
    }
    if (persona) ctx += `\n#### 玩家设定\n${persona}\n`;
    if (worldBook) ctx += `\n#### 世界书（背景故事/设定）\n${worldBook}\n`;

    return ctx;
}

// ═══════════════════════════════════════════════════════════════════════
// 4a. Pre-Generated Care Dialogue
// ═══════════════════════════════════════════════════════════════════════

/**
 * 分批生成照顾台词，存入 dialogueCache。
 * 整个过程后台静默执行，UI 调用方决定是否显示加载提示。
 *
 * @param {string} stageId - 当前树阶段 ID
 * @returns {Promise<{ success: boolean, count: number }>}
 */
export async function generateCareLines(stageId) {
    const charName = getPhoneCharInfo()?.name || '恋人';
    const userName = getPhoneUserName();
    const season = getCurrentSeason();
    const stageObj = GROWTH_STAGES.find(s => s.id === stageId) || GROWTH_STAGES[0];
    const stageDesc = STAGE_SEASON_DESCRIPTIONS[stageId]?.[season.id] || stageObj.name;

    const corePrompt = getCoreFoundationPrompt();
    const charContext = await _buildCharContext();

    const systemPrompt = `${corePrompt}
${charContext}
### [TREE_CARE_DIALOGUE_TASK]
你现在要为「树树」养成游戏生成${charName} 的台词。
${charName} 和 ${userName} 一起养了一棵小树。当她们照顾小树（浇水、施肥、唱歌、抚摸）时，${charName} 会在此情况下说一些特别的话。

当前状态：
- 树的阶段：${stageObj.emoji} ${stageObj.name}（${stageDesc}）
- 季节：${season.emoji} ${season.name}
- 照顾动作：${CARE_ACTIONS.map(a => `${a.emoji}${a.name}`).join('、')}

要求：
1. 每句台词 15-40 个字，保持简洁
2. 台词应该是 ${charName} 的语气，必须完全符合上述角色性格和说话方式
3. 内容需要要关于照顾小树、两人的关系、季节变化等
4. 有些可以俏皮可爱，有些可以深情温暖，请根据${charName} 的性格进行发挥
5. 不要重复意思相似的句子，每一句都要独特，有意义
6. 结合世界书中的背景故事和角色关系来丰富台词内容
7. **语言要求**：台词必须使用角色描述中所使用的语言来书写（如角色描述是英文则用英文，中文则用中文，以此类推）`;

    const allLines = [];

    for (let batch = 0; batch < BATCH_COUNT; batch++) {
        const batchNum = batch + 1;
        const userPrompt = `请生成 ${BATCH_SIZE} 条${charName}照顾小树时说的台词。
${allLines.length > 0 ? `已有台词（请不要重复）：\n${allLines.map(l => `- ${l}`).join('\n')}` : ''}

请严格按以下 JSON 格式输出，不要添加任何其它文字：
["台词1", "台词2", "台词3", "台词4", "台词5"]`;

        // Try with retry
        const batchResult = await _tryGenerateBatch(systemPrompt, userPrompt, batchNum);
        if (batchResult.length > 0) {
            allLines.push(...batchResult);
            console.log(`${LOG} 台词批次 ${batchNum}/${BATCH_COUNT} 成功: ${batchResult.length} 条`);
        } else {
            console.warn(`${LOG} 台词批次 ${batchNum}/${BATCH_COUNT} 失败，跳过`);
        }
    }

    // Save to storage (no builtin fallback — player will decide to retry if needed)
    saveCareLines(allLines, stageId);
    console.log(`${LOG} 台词生成完成: 共 ${allLines.length} 条 (阶段: ${stageId})`);

    return { success: allLines.length > 0, count: allLines.length };
}

/**
 * 单批次生成 + 1 次重试
 * @returns {Promise<string[]>} 成功的台词数组，失败返回 []
 */
async function _tryGenerateBatch(systemPrompt, userPrompt, batchNum) {
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const prompt = attempt === 0
                ? userPrompt
                : userPrompt + '\n\n（请换一种表达方式重新生成）';

            const raw = await callPhoneLLM(systemPrompt, prompt, { maxTokens: 800 });
            const lines = _parseLinesFromResponse(raw);
            if (lines.length > 0) return lines;

            console.warn(`${LOG} 批次 ${batchNum} 第 ${attempt + 1} 次: 解析结果为空`);
        } catch (e) {
            console.warn(`${LOG} 批次 ${batchNum} 第 ${attempt + 1} 次失败:`, e.message);
        }
    }
    return [];
}

/**
 * 检测文本是否包含 SillyTavern 特殊标签或 prompt 残留
 * @param {string} text
 * @returns {boolean} true = 是脏数据，应过滤
 */
function _isDirtyLine(text) {
    // SillyTavern 标签: [wait:1-50], [send:xxx], [pause:xxx] 等
    if (/\[(?:wait|send|pause|idle|trigger|hide|show|run|call):[^\]]*\]/i.test(text)) return true;
    // Handlebars / ST 宏: {{user}}, {{char}}, {{random}} 等
    if (/\{\{[^}]+\}\}/.test(text)) return true;
    // XML-like tags: <START>, <END>, <|im_start|>
    if (/<(?:START|END|\|im_\w+\|)>/i.test(text)) return true;
    // 纯 JSON 残留 / prompt 指令残留
    if (/^[\[{"']\s*$/.test(text)) return true;
    if (/^(?:请|以下|输出|JSON|格式|注意)/.test(text)) return true;
    // 纯数字 / 纯符号
    if (/^[\d\s\-_.,:;!?~]+$/.test(text)) return true;
    return false;
}

/**
 * 从 LLM 原始响应中解析出台词数组
 * 支持 JSON 数组格式和换行列表格式
 * 自动过滤 SillyTavern 特殊标签和脏数据
 */
function _parseLinesFromResponse(raw) {
    if (!raw || typeof raw !== 'string') return [];

    // Trim markdown code fences if present
    let cleaned = raw.trim();
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');

    let lines = [];

    // Try JSON array parse
    try {
        const arr = JSON.parse(cleaned);
        if (Array.isArray(arr)) {
            lines = arr
                .filter(item => typeof item === 'string' && item.trim().length > 0)
                .map(item => item.trim());
        }
    } catch { /* not valid JSON, try fallback */ }

    // Fallback: line-by-line extraction
    if (lines.length === 0) {
        lines = cleaned.split('\n')
            .map(line => line.replace(/^[\d\-\.\)]+\s*/, '').replace(/^["'"「]|["'"」]$/g, '').trim())
            .filter(line => line.length >= 5 && line.length <= 80);
    }

    // Quality filter: remove SillyTavern tags and dirty data
    lines = lines.filter(line => !_isDirtyLine(line));

    return lines;
}


/**
 * 清洗 LLM 直接回答的文本（真心话、扭蛋、里程碑等 UI 层展示的内容）。
 * 1. 提取 (朋友圈: ...) / (评论 ID: ...) → 注入 moments 模块
 * 2. 从显示文本中删除这些格式片段
 * 3. 清除 <标签>内容</标签> 格式（状态栏世界书泄漏）
 * 4. 清理残余空行
 *
 * @param {string} text - LLM 原始输出
 * @returns {Promise<string>} 清洗后的纯净文本
 */
async function sanitizeLLMOutput(text) {
    if (!text || typeof text !== 'string') return text;

    let cleaned = text;

    // ── Step 1: 提取 + 注入朋友圈/评论到 moments ──
    const momentPatterns = /\((?:朋友圈|Moments|评论|Comment)(?:\s*(?:ID:?)?\s*[a-zA-Z0-9_-]*)?\s*:\s*.+?\)/gi;
    const momentMatches = cleaned.match(momentPatterns);
    if (momentMatches && momentMatches.length > 0) {
        // 拼接所有匹配的片段，交给 handleMainChatOutput 统一处理
        const momentsContent = momentMatches.join('\n');
        try {
            await handleMainChatOutput(momentsContent);
            console.log(`${LOG} 清洗: 已将 ${momentMatches.length} 条朋友圈/评论注入 moments`);
        } catch (e) {
            console.warn(`${LOG} 清洗: moments 注入失败:`, e.message);
        }
    }

    // ── Step 2: 从显示文本中删除朋友圈/评论格式 ──
    cleaned = cleaned.replace(momentPatterns, '');

    // ── Step 3: 清除 <标签>内容</标签> 格式 ──
    // 匹配成对标签: <xxx>...</xxx>
    cleaned = cleaned.replace(/<([a-zA-Z\u4e00-\u9fff_]+)>[\s\S]*?<\/\1>/g, '');
    // 匹配独立标签: <xxx> (非 HTML 实体)
    cleaned = cleaned.replace(/<\/?[a-zA-Z\u4e00-\u9fff_]+>/g, '');

    // ── Step 4: 清理残余空行 ──
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();

    return cleaned;
}


// ═══════════════════════════════════════════════════════════════════════
// 4b. Milestone Celebration
// ═══════════════════════════════════════════════════════════════════════

/**
 * 生成树升级时的庆祝台词
 * @param {Object} newStage - 新阶段对象 (from GROWTH_STAGES)
 * @param {string} treeName - 树的名字
 * @returns {Promise<string|null>} 庆祝台词，失败返回 null
 */
export async function generateMilestoneMessage(newStage, treeName) {
    try {
        const charName = getPhoneCharInfo()?.name || '恋人';
        const userName = getPhoneUserName();
        const season = getCurrentSeason();
        const corePrompt = getCoreFoundationPrompt();
        const charContext = await _buildCharContext();

        const systemPrompt = `${corePrompt}
${charContext}
### [MILESTONE_CELEBRATION_TASK]
${charName} 和 ${userName} 养的小树「${treeName}」刚刚升级了！
请以 ${charName} 的语气写一段生动的庆祝台词。`;

        const userPrompt = `小树从之前的阶段升级到了「${newStage.emoji} ${newStage.name}」！
现在是${season.emoji}${season.name}天。

请写一段 ${charName} 对 ${userName} 说的庆祝话语，要温暖感人。
直接输出台词内容，不要加引号或其他格式。
台词必须使用角色描述中所使用的语言来书写。`;

        const result = await callPhoneLLM(systemPrompt, userPrompt, { maxTokens: 200 });
        if (result && result.trim()) {
            console.log(`${LOG} 里程碑庆祝台词生成成功`);
            return await sanitizeLLMOutput(result.trim());
        }
        return null;
    } catch (e) {
        console.warn(`${LOG} 里程碑庆祝台词生成失败:`, e.message);
        return null;
    }
}


// ═══════════════════════════════════════════════════════════════════════
// 4c. Truth-or-Dare AI Answer
// ═══════════════════════════════════════════════════════════════════════

/**
 * AI "中招" 时以角色身份回答真心话问题
 * @param {string} question - 真心话题目
 * @returns {Promise<string|null>} AI 回答，失败返回 null
 */
export async function generateTodAnswer(question) {
    try {
        const charName = getPhoneCharInfo()?.name || '恋人';
        const userName = getPhoneUserName();
        const corePrompt = getCoreFoundationPrompt();
        const charContext = await _buildCharContext();

        const systemPrompt = `${corePrompt}
${charContext}
### [TRUTH_OR_DARE_TASK]
游戏时间到！ ${userName} 正在和${charName} 玩真心话大冒险游戏。现在轮到 ${charName}回答真心话了！
请以 ${charName} 的第一人称回答问题，真实地展现ta的性格和对 ${userName} 的感情。
回答要真诚、有趣，可以害羞、俏皮或深情。
回答必须使用角色描述中所使用的语言来书写。`;

        const userPrompt = `真心话问题：「${question}」

请让 ${charName} 真实地回答这个问题。不要加引号或其它格式标记。`;

        const result = await callPhoneLLM(systemPrompt, userPrompt);
        if (result && result.trim()) {
            console.log(`${LOG} 真心话回答完毕`);
            return await sanitizeLLMOutput(result.trim());
        }
        return null;
    } catch (e) {
        console.warn(`${LOG} 真心话回答失败:`, e.message);
        return null;
    }
}

/**
 * 玩家回答真心话后，AI 恋人对玩家的回答做出反应
 * @param {string} question - 真心话题目
 * @param {string} playerAnswer - 玩家的回答文本
 * @returns {Promise<string|null>} AI 反应，失败返回 null
 */
export async function generateTodReaction(question, playerAnswer) {
    try {
        const charName = getPhoneCharInfo()?.name || '恋人';
        const userName = getPhoneUserName();
        const corePrompt = getCoreFoundationPrompt();
        const charContext = await _buildCharContext();

        const systemPrompt = `${corePrompt}
${charContext}
### [TOD_REACTION_TASK]
${userName} 和 ${charName} 正在玩真心话大冒险游戏。
这一轮 ${userName} 中招了，需要回答一个真心话问题，而 ${userName} 已经回答完毕。

⚠️ 重要的角色映射：
- 题目中的「我」= ${charName}（提问者）
- 题目中的「你」= ${userName}（回答者）
请务必根据这个映射来理解题目内容和 ${userName} 的回答。

现在请你以 ${charName} 的身份（第一人称），对 ${userName} 的回答做出真实的反应。
反应要完全符合 ${charName} 的性格，可以惊喜、害羞、吃醋、调侃、追问等，自然地表达。
反应必须使用角色描述中所使用的语言来书写。`;

        const userPrompt = `真心话问题（题目中的「我」= ${charName}，「你」= ${userName}）：
「${question}」

${userName} 的回答：「${playerAnswer}」

请以 ${charName} 的身份对这个回答做出反应。直接输出反应内容，不要加引号或其它格式标记。`;

        const result = await callPhoneLLM(systemPrompt, userPrompt, { maxTokens: 400 });
        if (result && result.trim()) {
            console.log(`${LOG} 真心话反应生成成功`);
            return await sanitizeLLMOutput(result.trim());
        }
        return null;
    } catch (e) {
        console.warn(`${LOG} 真心话反应生成失败:`, e.message);
        return null;
    }
}


// ═══════════════════════════════════════════════════════════════════════
// 4d. Gacha Dialogue Trigger
// ═══════════════════════════════════════════════════════════════════════

/**
 * 抽到「你对象写的情书」时生成一段甜蜜台词
 * @returns {Promise<string|null>} 甜蜜台词，失败返回 null
 */
export async function generateGachaDialogue() {
    try {
        const charName = getPhoneCharInfo()?.name || '恋人';
        const userName = getPhoneUserName();
        const corePrompt = getCoreFoundationPrompt();
        const charContext = await _buildCharContext();
        const state = getTreeState();
        const treeName = state.treeName || '小树';

        const systemPrompt = `${corePrompt}
${charContext}
### [GACHA_DIALOGUE_TASK]
${userName} 在扭蛋机中抽到了一个稀有级别奖品——「你对象写的情书」💌。
请让 ${charName} 为ta的爱人（${userName}）写一段专属于她的甜蜜台词。
可以是关于她们一起养的小树「${treeName}」，也可以关于她们的感情、回忆或未来。`;

        const userPrompt = `请让 ${charName} 为ta的爱人（${userName}）  写一段甜蜜而真诚的话。
这是一个顶级稀有的的扭蛋奖品，所以要特别温暖感人。
直接输出台词内容，不要加引号或其他格式。
台词必须使用角色描述中所使用的语言来书写。`;

        const result = await callPhoneLLM(systemPrompt, userPrompt, { maxTokens: 300 });
        if (result && result.trim()) {
            console.log(`${LOG} 你对象写的情书生成成功`);
            return await sanitizeLLMOutput(result.trim());
        }
        return null;
    } catch (e) {
        console.warn(`${LOG} 你对象写的情书生成失败:`, e.message);
        return null;
    }
}


// ═══════════════════════════════════════════════════════════════════════
// Question Generation (Quiz + ToD)
// ═══════════════════════════════════════════════════════════════════════

/**
 * 生成默契挑战题目并追加到题库
 * @param {number} count - 生成数量，默认 10
 * @returns {Promise<{ success: boolean, count: number }>}
 */
export async function generateQuizQuestions(count = 10) {
    try {
        const charName = getPhoneCharInfo()?.name || '恋人';
        const userName = getPhoneUserName();
        const corePrompt = getCoreFoundationPrompt();
        const charContext = await _buildCharContext();

        const systemPrompt = `${corePrompt}
${charContext}
### [QUIZ_GENERATION_TASK]
为情侣默契挑战游戏生成题目。
请根据上述角色的性格、背景故事和她们的关系来设计有个性化的题目。`;

        const userPrompt = buildQuizPrompt(charName, userName, count);

        const raw = await callPhoneLLM(systemPrompt, userPrompt, { maxTokens: 2000 });

        // Parse JSON from response
        let parsed;
        try {
            let cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
            parsed = JSON.parse(cleaned);
        } catch {
            console.warn(`${LOG} 默契题目 JSON 解析失败`);
            return { success: false, count: 0 };
        }

        const { valid, items, errors } = validateQuizQuestions(parsed);
        if (errors.length > 0) {
            console.warn(`${LOG} 默契题目校验警告:`, errors);
        }
        if (valid && items.length > 0) {
            appendQuestions('quiz', items);
            console.log(`${LOG} 默契题目生成成功: ${items.length} 条`);
            return { success: true, count: items.length };
        }
        return { success: false, count: 0 };
    } catch (e) {
        console.warn(`${LOG} 默契题目生成失败:`, e.message);
        return { success: false, count: 0 };
    }
}

/**
 * 生成真心话题目并追加到题库
 * @param {number} count - 生成数量，默认 10
 * @returns {Promise<{ success: boolean, count: number }>}
 */
export async function generateTodQuestions(count = 10) {
    try {
        const charName = getPhoneCharInfo()?.name || '恋人';
        const userName = getPhoneUserName();
        const corePrompt = getCoreFoundationPrompt();
        const charContext = await _buildCharContext();

        const systemPrompt = `${corePrompt}
${charContext}
### [TOD_GENERATION_TASK]
为情侣真心话大冒险游戏生成题目。
请根据上述角色的性格、背景故事和她们的关系来设计各种各样的真心话问题。`;

        const userPrompt = buildTodPrompt(charName, userName, count);

        const raw = await callPhoneLLM(systemPrompt, userPrompt, { maxTokens: 2000 });

        let parsed;
        try {
            let cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
            parsed = JSON.parse(cleaned);
        } catch {
            console.warn(`${LOG} 真心话题目 JSON 解析失败`);
            return { success: false, count: 0 };
        }

        const { valid, items, errors } = validateTodQuestions(parsed);
        if (errors.length > 0) {
            console.warn(`${LOG} 真心话题目校验警告:`, errors);
        }
        if (valid && items.length > 0) {
            appendQuestions('tod', items);
            console.log(`${LOG} 真心话题目生成成功: ${items.length} 条`);
            return { success: true, count: items.length };
        }
        return { success: false, count: 0 };
    } catch (e) {
        console.warn(`${LOG} 真心话题目生成失败:`, e.message);
        return { success: false, count: 0 };
    }
}


// ═══════════════════════════════════════════════════════════════════════
// Unified Content Check & Refill
// ═══════════════════════════════════════════════════════════════════════

/**
 * 检查所有内容存量，不足时后台补充。
 * 可在树主界面打开时调用，整个过程静默执行。
 *
 * @param {Object} [options]
 * @param {boolean} [options.forceCareLines=false] - 强制重新生成台词
 * @param {boolean} [options.forceAll=false] - 强制生成所有内容（首次初始化用）
 * @param {Function} [options.onProgress] - 进度回调 ({ step, totalSteps, stepName })
 * @returns {Promise<{ careLines: boolean, quiz: boolean, tod: boolean }>} 各项是否触发了补充
 */
export async function checkAndRefillContent({ forceCareLines = false, forceAll = false, onProgress } = {}) {
    const results = { careLines: false, quiz: false, tod: false };
    const totalSteps = 3;

    const data = loadTreeData();
    const stageId = data.treeState.stage;

    // ── Step 1: Care Lines ──
    if (typeof onProgress === 'function') {
        onProgress({ step: 0, totalSteps, stepName: '正在生成照顾台词…' });
    }
    const careLinesRemaining = getRemainingCareLines();
    const careLinesStageMatch = data.dialogueCache.currentStage === stageId;
    const needCareLines = forceCareLines || careLinesRemaining === 0 || !careLinesStageMatch;
    if (needCareLines) {
        console.log(`${LOG} 台词补充: remaining=${careLinesRemaining}, stageMatch=${careLinesStageMatch}, force=${forceCareLines}`);
        try {
            await generateCareLines(stageId);
            results.careLines = true;
        } catch (e) {
            console.warn(`${LOG} 台词补充失败:`, e.message);
        }
    }

    // ── Step 2: Quiz Questions ──
    if (typeof onProgress === 'function') {
        onProgress({ step: 1, totalSteps, stepName: '正在生成默契挑战题目…' });
    }
    const quizRemaining = getRemainingQuestions().quiz;
    const needQuiz = forceAll ? (quizRemaining === 0) : (quizRemaining < QUIZ_LOW_THRESHOLD);
    if (needQuiz) {
        console.log(`${LOG} 默契题目补充: remaining=${quizRemaining}, threshold=${QUIZ_LOW_THRESHOLD}, forceAll=${forceAll}`);
        try {
            await generateQuizQuestions();
            results.quiz = true;
        } catch (e) {
            console.warn(`${LOG} 默契题目补充失败:`, e.message);
        }
    }

    // ── Step 3: ToD Questions ──
    if (typeof onProgress === 'function') {
        onProgress({ step: 2, totalSteps, stepName: '正在生成真心话题目…' });
    }
    const todRemaining = getRemainingQuestions().tod;
    const needTod = forceAll ? (todRemaining === 0) : (todRemaining < TOD_LOW_THRESHOLD);
    if (needTod) {
        console.log(`${LOG} 真心话题目补充: remaining=${todRemaining}, threshold=${TOD_LOW_THRESHOLD}, forceAll=${forceAll}`);
        try {
            await generateTodQuestions();
            results.tod = true;
        } catch (e) {
            console.warn(`${LOG} 真心话题目补充失败:`, e.message);
        }
    }

    // ── Done ──
    if (typeof onProgress === 'function') {
        onProgress({ step: totalSteps, totalSteps, stepName: '准备完毕！' });
    }

    return results;
}


// ═══════════════════════════════════════════════════════════════════════
// Step-by-Step Generation (Player QC)
// ═══════════════════════════════════════════════════════════════════════

/**
 * 分步生成内容，每步完成后回调让玩家检查质量。
 * 如果玩家否决，可以重新生成。用于首次初始化 loading 页面。
 *
 * @param {Object} options
 * @param {Function} options.onStepStart  - ({ step, totalSteps, stepName }) => void
 * @param {Function} options.onStepComplete - ({ step, totalSteps, stepName, samples, rawCount }) => Promise<'approve'|'retry'>
 *   samples: 本步生成的样本数据供预览
 *   rawCount: 本步生成的总条目数
 *   返回 'approve' 通过，'retry' 重新生成
 * @param {number} [options.maxRetries=3] - 每步最多重试次数
 */
export async function generateContentStepByStep({ onStepStart, onStepComplete, maxRetries = 3, skipCareLines = false, skipQuiz = false, skipTod = false } = {}) {
    const data = loadTreeData();
    const stageId = data.treeState.stage;

    // Calculate how many steps we actually need to run
    const stepsToRun = [!skipCareLines, !skipQuiz, !skipTod].filter(Boolean).length;
    if (stepsToRun === 0) return; // Nothing to do

    let stepCounter = 0;

    // ── Step 1: Care Lines ──
    if (skipCareLines) {
        console.log(`${LOG} 跳过照顾台词生成（存量充足）`);
    } else {
    await _runStepWithQC({
        step: stepCounter,
        totalSteps: stepsToRun,
        stepName: '照顾台词',
        maxRetries,
        onStepStart,
        onStepComplete,
        generateFn: async () => {
            await generateCareLines(stageId);
            // Read back what was saved
            const newData = loadTreeData();
            const lines = newData.dialogueCache.careLines.map(l => l.text);
            // Pick 3 random samples for preview
            const shuffled = [...lines].sort(() => Math.random() - 0.5);
            return { samples: shuffled.slice(0, 3), rawCount: lines.length };
        },
        clearFn: () => {
            // Clear care lines so regeneration starts fresh
            saveCareLines([], stageId);
        },
    });
    stepCounter++;
    }

    // ── Step 2: Quiz Questions ──
    if (skipQuiz) {
        console.log(`${LOG} 跳过默契题目生成（存量充足）`);
    } else {
    await _runStepWithQC({
        step: stepCounter,
        totalSteps: stepsToRun,
        stepName: '默契挑战题目',
        maxRetries,
        onStepStart,
        onStepComplete,
        generateFn: async () => {
            await generateQuizQuestions();
            const newData = loadTreeData();
            const quizItems = newData.questionBank.quiz.filter(q => !q.used);
            // Pick 1 sample
            const sample = quizItems.length > 0 ? quizItems[Math.floor(Math.random() * quizItems.length)] : null;
            return {
                samples: sample ? [{ question: sample.question, options: sample.options, answer: sample.answer }] : [],
                rawCount: quizItems.length,
            };
        },
        clearFn: () => {
            // Clear quiz questions for regeneration
            const d = loadTreeData();
            d.questionBank.quiz = [];
            d.questionBank.lastGeneratedAt = '';
            saveTreeData(d);
        },
    });
    stepCounter++;
    }

    // ── Step 3: ToD Questions ──
    if (skipTod) {
        console.log(`${LOG} 跳过真心话题目生成（存量充足）`);
    } else {
    await _runStepWithQC({
        step: stepCounter,
        totalSteps: stepsToRun,
        stepName: '真心话题目',
        maxRetries,
        onStepStart,
        onStepComplete,
        generateFn: async () => {
            await generateTodQuestions();
            const newData = loadTreeData();
            const todItems = newData.questionBank.tod.filter(q => !q.used);
            const sample = todItems.length > 0 ? todItems[Math.floor(Math.random() * todItems.length)] : null;
            return {
                samples: sample ? [{ question: sample.question, type: sample.type }] : [],
                rawCount: todItems.length,
            };
        },
        clearFn: () => {
            const d = loadTreeData();
            d.questionBank.tod = [];
            d.questionBank.lastGeneratedAt = '';
            saveTreeData(d);
        },
    });
    stepCounter++;
    }
}

/**
 * 执行单步生成 + 玩家质检循环
 */
async function _runStepWithQC({ step, totalSteps, stepName, maxRetries, onStepStart, onStepComplete, generateFn, clearFn }) {
    let retries = 0;

    while (retries <= maxRetries) {
        // Notify step start
        if (typeof onStepStart === 'function') {
            onStepStart({ step, totalSteps, stepName });
        }

        // Generate
        let result;
        try {
            result = await generateFn();
        } catch (e) {
            console.warn(`${LOG} ${stepName} 生成失败 (尝试 ${retries + 1}):`, e.message);
            result = { samples: [], rawCount: 0 };
        }

        // Let player decide
        if (typeof onStepComplete === 'function') {
            const decision = await onStepComplete({
                step,
                totalSteps,
                stepName,
                samples: result.samples,
                rawCount: result.rawCount,
            });

            if (decision === 'approve') {
                console.log(`${LOG} ${stepName} 玩家确认通过 (${result.rawCount} 条)`);
                return; // Step done
            }

            // Player wants retry
            retries++;
            if (retries <= maxRetries) {
                console.log(`${LOG} ${stepName} 玩家要求重新生成 (第 ${retries} 次)`);
                if (typeof clearFn === 'function') clearFn();
            } else {
                console.warn(`${LOG} ${stepName} 已达最大重试次数，使用当前结果`);
            }
        } else {
            // No QC callback, auto-approve
            return;
        }
    }
}
