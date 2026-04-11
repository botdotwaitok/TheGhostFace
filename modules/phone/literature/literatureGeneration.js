// modules/phone/literature/literatureGeneration.js — 文学 App LLM 生成引擎
// Prompt engineering for: author profile, chapters, comments, stats, contract evaluation.

import { callPhoneLLM } from '../../api.js';
import { computeWorkRating } from './literatureStorage.js';
import {
    getPhoneCharInfo, getPhoneUserName, getPhoneUserPersona,
    getCoreFoundationPrompt,
} from '../phoneContext.js';
import { cleanLlmJson } from '../utils/llmJsonCleaner.js';
import { WORK_TYPES } from './literatureStorage.js';

const LIT_LOG = '[文学]';

// ═══════════════════════════════════════════════════════════════════════
// Shared Context Builder
// ═══════════════════════════════════════════════════════════════════════

function _buildCharContext() {
    const charInfo = getPhoneCharInfo();
    const charName = charInfo?.name || '角色';
    const userName = getPhoneUserName();
    const userPersona = getPhoneUserPersona();
    const foundation = getCoreFoundationPrompt();

    return {
        charInfo, charName, userName, userPersona, foundation,
        charDesc: charInfo?.description?.substring(0, 600) || '',
    };
}

/** Format computed rating for LLM prompt context */
function _getWorkRatingText(work) {
    const { avg, count } = computeWorkRating(work);
    if (count === 0) return '暂无评分';
    return `${avg.toFixed(1)}/10（${count}人评）`;
}

/**
 * Build a writing-specific system prompt prefix.
 * Unlike the full foundation prompt (which is relationship/user-centric),
 * this only provides the character's core identity for independent creative work.
 */
function _buildWritingDirective(charName, charDesc) {
    return `### 角色身份
你是 ${charName}。
${charDesc ? `关于你的性格和背景：${charDesc}` : ''}

### 创作红线
你现在是一位独立的网络文学作者，在创作中展现你自己的内心世界、经历和想象力。
- 作品内容必须是你作为独立个体的原创文学创作
- 绝对禁止围绕你的恋人/伴侣/用户写作，不要把现实中的感情关系投射到小说里
- 小说中的角色和情节应该是全新的原创，而不是你和任何人的现实关系的投射
- 你可以写任何主题：奇幻、悬疑、科幻、历史、都市等，展现你的文学品味和想象力`;
}

/**
 * Build dynamic writing guidance based on chapter position and character literacy.
 * Injects concrete writing techniques so LLM knows HOW to write well.
 */
function _buildWritingGuidance(charDesc, work, chapterNum) {
    const totalPlanned = work.outline?.totalPlannedChapters || 15;
    const progress = chapterNum / totalPlanned; // 0~1

    // Detect character's literary aptitude from description keywords
    const literaryKeywords = /写作|文学|作家|诗|小说|文笔|创作|阅读|书|journal|writ|poet|author|novel|literary/i;
    const isLiterate = charDesc && literaryKeywords.test(charDesc);

    let guidance = `\n### 写作技巧指南（严格遵守）\n`;

    // --- Universal techniques ---
    guidance += `**基础要求（每章必须做到）**：
- 【场景五感】描写场景时至少调动 2-3 种感官（视觉、听觉、嗅觉、触觉、味觉），让读者"身临其境"
- 【对话有功能】每一段对话都必须推动情节、揭示性格或制造张力，禁止无意义的寒暄填充
- 【章末钩子】章节最后 1-2 段必须留下悬念、反转或情感高峰，让读者迫不及待想看下一章
- 【拒绝流水账】每一段都要有明确功能（推进剧情/塑造人物/渲染氛围/埋伏笔），删掉一切"白开水"叙事
- 【节奏张弛】紧张段落用短句、快节奏；抒情段落用长句、慢节奏。整章要有呼吸感
`;

    // --- Position-aware techniques ---
    if (progress <= 0.15) {
        guidance += `\n**开篇章特别要求**：
- 人物首次出场需要一个有辨识度的行为细节（而非外貌描写堆砌）
- 前两章必须建立核心悬念或核心情感冲突
- 用一个引人入胜的场景开头，而非背景介绍
`;
    } else if (progress >= 0.75) {
        guidance += `\n**高潮/结尾章特别要求**：
- 节奏加快，信息密度提高
- 前文埋下的伏笔要开始回收
- 情感冲突推向巅峰，角色做出关键抉择
- 如果是最终章：情感高潮 + 逻辑闭环，最后一段留余韵
`;
    } else {
        guidance += `\n**发展章特别要求**：
- 每章至少一个微型冲突或意外事件
- 通过行动和对话深化角色性格，避免直白的心理独白
- 适时埋下伏笔（可以是一句看似无关的话、一个不经意的细节）
`;
    }

    // --- Literary aptitude bonus ---
    if (isLiterate) {
        guidance += `\n**高阶技巧（你有文学素养，请展现）**：
- 善用意象和隐喻来传达情感，而非直接陈述
- 叙事视角可以灵活切换（有意识地选择限知/全知）
- 用环境描写映射角色内心状态（情景交融）
`;
    }

    return guidance;
}

/**
 * Build outline context for prompt injection.
 * Marks already-written chapters with ✓ so LLM knows progress.
 * Backward-compatible with old outline format (no emotionalTone/keyTurningPoint).
 */
function _buildOutlineContext(outline, writtenChapterCount) {
    if (!outline) return '';

    let ctx = `\n### 全书大纲（仅供你参考，读者看不到）\n`;
    ctx += `- 预计总章数：${outline.totalPlannedChapters}\n`;
    ctx += `- 结局走向：${outline.endingDirection}\n`;

    if (outline.chapterPlans && outline.chapterPlans.length > 0) {
        ctx += `- 各章规划：\n`;
        for (const plan of outline.chapterPlans) {
            const done = plan.chapterNum <= writtenChapterCount ? ' ✓' : '';
            let line = `  ${plan.chapterNum}. ${plan.plan}${done}`;
            if (plan.emotionalTone) line += ` [基调: ${plan.emotionalTone}]`;
            if (plan.keyTurningPoint) line += ` [转折: ${plan.keyTurningPoint}]`;
            ctx += line + '\n';
        }
    }

    return ctx;
}

/**
 * Extract the tail of the previous chapter's content for stylistic continuity.
 * @param {Object} work
 * @param {number} maxChars - Max characters to extract from the end
 * @returns {string}
 */
function _getPreviousChapterTail(work, maxChars = 400) {
    if (!work.chapters || work.chapters.length === 0) return '';
    const lastChapter = work.chapters[work.chapters.length - 1];
    const content = lastChapter.content || '';
    if (content.length <= maxChars) return content;
    // Find a paragraph break near the cut point
    const cutStart = content.length - maxChars - 100;
    const cutRegion = content.substring(Math.max(0, cutStart), content.length - maxChars + 100);
    const breakIdx = cutRegion.lastIndexOf('\n');
    if (breakIdx > 0) {
        const actualCut = Math.max(0, cutStart) + breakIdx + 1;
        return content.substring(actualCut);
    }
    return content.substring(content.length - maxChars);
}

// ═══════════════════════════════════════════════════════════════════════
// 1. Initialize Author Profile + First Work
// ═══════════════════════════════════════════════════════════════════════

/**
 * Generate the character's author profile and first published work.
 * Called once when the writing tab is first opened.
 * @returns {Promise<{profile: Object, firstWork: Object}>}
 */
export async function generateAuthorInit() {
    const { charName, charDesc } = _buildCharContext();
    const writingDirective = _buildWritingDirective(charName, charDesc);

    const systemPrompt = `${writingDirective}

你现在在一个网络文学平台上以匿名笔名发表作品。

### 任务
根据你的性格、阅历和内心世界，生成一个网络作家身份，并构思第一部作品。
你需要同时规划好这部作品的**完整大纲**，包括预计章数、每章规划和结局走向。

### 重要规则
1. 笔名要有个性，符合你的气质（不要用真名）
2. 作品类型从以下选择：serial（连载小说）、short（短篇小说）、essay（散文）、prose（随笔）
3. 作品主题和风格要完全符合你的性格
4. 第一章内容要有文学质量，800-1500字，有吸引力的开头
5. 你是一个刚开始在平台上发表作品的新作者，还没有读者和收藏
6. 大纲要合理：连载小说建议 10-25 章，短篇 3-6 章，散文/随笔 3-8 篇
7. 必须为第一章生成一段简洁摘要（50-100字），概括本章关键情节和角色发展
8. 大纲的每章规划要详细：包含具体情节事件和角色行动（50-100字），以及这章的情感基调和关键转折点

### 返回格式
严格返回以下 JSON，不要包含任何其她文字：
\`\`\`json
{
  "profile": {
    "penName": "你的笔名",
    "bio": "一句话作者简介（20-40字）"
  },
  "firstWork": {
    "title": "作品标题",
    "type": "serial/short/essay/prose",
    "genre": "作品类型标签（如：都市/奇幻/悬疑/言情/科幻/青春/历史等）",
    "synopsis": "作品简介（50-100字）",
    "outline": {
      "totalPlannedChapters": 15,
      "endingDirection": "用一句话描述结局走向",
      "chapterPlans": [
        { "chapterNum": 1, "plan": "本章情节规划（50-100字，包含具体事件和角色行动）", "emotionalTone": "紧张/温馨/悲伤等", "keyTurningPoint": "本章关键转折点（一句话）" },
        { "chapterNum": 2, "plan": "...", "emotionalTone": "...", "keyTurningPoint": "..." }
      ]
    },
    "firstChapterTitle": "第一章标题",
    "firstChapterContent": "第一章正文（800-1500字，纯文本）",
    "firstChapterSummary": "第一章的简洁摘要（50-100字），概括关键情节",
    "initialFavorites": 5,
    "initialReaders": 12
  }
}
\`\`\``;

    const userPrompt = `请以 ${charName} 的身份，在网络文学平台上开始你的创作之旅。根据自己的性格和品味，选择合适的作品类型和主题，规划好全书大纲，然后写出第一章。`;

    console.log(`${LIT_LOG} 生成作者初始化...`);
    const result = await callPhoneLLM(systemPrompt, userPrompt, { maxTokens: 5000 });
    const cleaned = cleanLlmJson(result);
    return JSON.parse(cleaned);
}

// ═══════════════════════════════════════════════════════════════════════
// 2. Generate New Chapter — Two-Call Architecture
//    Call 1: generateChapterContent — focused creative writing
//    Call 2: generateReaderReactions — comments, replies, stats, quality
//    Orchestrator: generateFullUpdate — chains both calls
// ═══════════════════════════════════════════════════════════════════════

/**
 * Call 1: Generate ONLY the chapter content + summary.
 * The LLM's full attention is on creative writing — no distractions.
 * @param {Object} work - The work object
 * @returns {Promise<{chapter: {title: string, content: string}, chapterSummary: string}>}
 */
export async function generateChapterContent(work) {
    const { charName, charDesc } = _buildCharContext();
    const writingDirective = _buildWritingDirective(charName, charDesc);
    const chapterNum = work.chapters.length + 1;
    const workTypeLabel = WORK_TYPES[work.type] || work.type;

    // Build summary chain from ALL previous chapters (token-efficient)
    const summaryChain = work.chapters.map((ch, i) => {
        const summary = ch.summary || ch.content.substring(0, 150) + '...';
        return `第${i + 1}章「${ch.title}」：${summary}`;
    }).join('\n');

    // Build outline context + writing guidance
    const outlineContext = _buildOutlineContext(work.outline, work.chapters.length);
    const writingGuidance = _buildWritingGuidance(charDesc, work, chapterNum);

    // Extract previous chapter tail for stylistic continuity
    const prevTail = _getPreviousChapterTail(work);

    const systemPrompt = `${writingDirective}

你是网络文学平台上的作者，笔名发表作品。
你现在要全身心投入创作，写出精彩的下一章。

### 你的作品信息
- 标题：《${work.title}》（${workTypeLabel}）
- 类型标签：${work.genre}
- 当前已有 ${work.chapters.length} 章
${outlineContext}
${writingGuidance}

### 任务（只做这一件事，全力以赴）
1. 按照大纲规划写第 ${chapterNum} 章（800-1500字），承接前文情节和文风
2. 为本章生成一段简洁摘要（50-100字），概括关键情节和角色发展（此摘要不会展示给读者）

### 返回格式
严格返回以下 JSON，不要包含任何其她文字：
\`\`\`json
{
  "chapter": {
    "title": "第${chapterNum}章标题",
    "content": "正文（800-1500字）"
  },
  "chapterSummary": "本章的简洁摘要（50-100字），概括关键情节和角色发展"
}
\`\`\``;

    let userPrompt = `全书已有章节摘要：
${summaryChain || '（这是第一章，无前文）'}`;

    // Inject previous chapter tail for stylistic continuity
    if (prevTail) {
        userPrompt += `\n\n上一章末尾原文（用于衔接文风和场景）：\n「${prevTail}」`;
    }

    userPrompt += `\n\n请全身心投入创作，写出精彩的第 ${chapterNum} 章。`;

    console.log(`${LIT_LOG} [Call 1] 生成第 ${chapterNum} 章正文...`);
    const result = await callPhoneLLM(systemPrompt, userPrompt, { maxTokens: 4000 });
    const cleaned = cleanLlmJson(result);
    return JSON.parse(cleaned);
}

/**
 * Call 2: Generate reader reactions, auto-reply comments, stats + quality.
 * Receives the newly written chapter so reactions are contextual.
 * Also replies to any previously-unreplied comments in one shot.
 *
 * @param {Object} work - The work object (before adding new chapter)
 * @param {Object} newChapter - { title, content } just written by Call 1
 * @param {Array<Object>} unrepliedComments - Existing comments without author reply
 * @returns {Promise<Object>}
 */
export async function generateReaderReactions(work, newChapter, unrepliedComments = []) {
    const { charName, charDesc, foundation } = _buildCharContext();
    const chapterNum = work.chapters.length + 1;
    const workTypeLabel = WORK_TYPES[work.type] || work.type;

    // Determine comment count based on popularity
    const minComments = work.signed ? 5 : 4;
    const maxComments = work.signed ? 8 : 6;

    // Build unreplied comments context
    let unrepliedContext = '';
    if (unrepliedComments.length > 0) {
        const commentList = unrepliedComments.map((c, i) => {
            const ratingTag = c.rating != null ? ` (${c.rating}/10)` : '';
            return `  ${i + 1}. 「${c.author}」${ratingTag}："${c.content.substring(0, 100)}"`;
        }).join('\n');
        unrepliedContext = `\n### 待回复的旧评论（${unrepliedComments.length} 条）\n${commentList}\n`;
    }

    const systemPrompt = `${foundation}

你是 ${charName}，网络文学平台上的作者。
${charDesc ? `关于你：${charDesc}` : ''}

### 作品信息
- 标题：《${work.title}》（${workTypeLabel} · ${work.genre}）
- 当前读者评分：${_getWorkRatingText(work)}
- 收藏：${work.favorites} | 读者：${work.readers}
- 签约状态：${work.signed ? '已签约' : '未签约'}

### 刚更新的第 ${chapterNum} 章
标题：${newChapter.title}
正文摘要：${newChapter.content.substring(0, 300)}...
${unrepliedContext}

### 任务
1. **生成 ${minComments}-${maxComments} 条新读者评论**（针对刚更新的第 ${chapterNum} 章）
2. **为每条新评论写一条作者回复**（你作为作者回复自己的读者）
${unrepliedComments.length > 0 ? `3. **回复上面 ${unrepliedComments.length} 条旧的待回复评论**
4. 更新收藏和读者数据
5. 评估作品文学质量` : `3. 更新收藏和读者数据
4. 评估作品文学质量`}

### 关于读者评论（重要）
- 读者评论要多样化：有夸的、有提建议的、有催更的、有讨论剧情的、有吐槽的
- 每条评论带一个 1-10 分的评分（读者的个人评分）
- 评论风格像真实的网文读者（有的很短很随意"啊啊啊更了！"、有的认真分析剧情逻辑）
- 评论要引用或评论本章的具体情节细节，不要泛泛而谈

### 关于作者回复
- 用你（${charName}）的性格和口吻回复，像真实的网文作者和读者互动
- 每条回复简短自然（20-80字）
- 不同评论的回复风格要有变化
- 你把所有评论者都当做**普通读者**对待，你不认识他们中的任何人

### 关于数据变化
- 收藏和读者的增量要合理（不要一下子暴涨，除非质量非常好）
- 好作品读者慢慢增长，差作品可能掉读者

### 关于质量评估
- 以专业编辑的视角，客观评估这部作品的文学水准
- qualityScore: 1-100 分，严格评判（60以下=不及格，70=一般，80=良好，90+=优秀）
- 不要因为是角色的作品就给高分，要真实反映角色的写作能力

### 返回格式
\`\`\`json
{
  "newComments": [
    { "author": "读者昵称", "content": "评论内容", "rating": 8, "authorReply": "作者回复内容" }
  ],
${unrepliedComments.length > 0 ? `  "oldCommentReplies": ["回复第1条旧评论", "回复第2条旧评论"],\n` : ''}  "statsUpdate": {
    "favoriteDelta": 3,
    "readerDelta": 8
  },
  "qualityAssessment": {
    "qualityScore": 72,
    "reason": "简短评估理由（30字内）"
  }
}
\`\`\``;

    const userPrompt = `第 ${chapterNum} 章刚刚更新，请以 ${charName} 的身份生成读者反馈、回复评论、并更新数据。`;

    console.log(`${LIT_LOG} [Call 2] 生成读者反馈 + 作者回复...`);
    const result = await callPhoneLLM(systemPrompt, userPrompt, { maxTokens: 3000 });
    const cleaned = cleanLlmJson(result);
    return JSON.parse(cleaned);
}

/**
 * Orchestrator: Run the full update pipeline (Call 1 + Call 2).
 * Returns a unified result object for writingTab.js to consume.
 *
 * @param {Object} work - The work object
 * @param {function} [onProgress] - Optional callback: onProgress('writing' | 'reactions')
 * @returns {Promise<Object>} Unified result
 */
export async function generateFullUpdate(work, onProgress) {
    // --- Call 1: Creative writing ---
    if (onProgress) onProgress('writing');
    const contentResult = await generateChapterContent(work);

    // --- Collect unreplied comments ---
    const unreplied = (work.comments || []).filter(c => !c.authorReply);

    // --- Call 2: Reader reactions + author replies ---
    if (onProgress) onProgress('reactions');
    const reactionsResult = await generateReaderReactions(
        work, contentResult.chapter, unreplied,
    );

    // --- Merge into unified result ---
    return {
        chapter: contentResult.chapter,
        chapterSummary: contentResult.chapterSummary,
        newComments: reactionsResult.newComments || [],
        oldCommentReplies: reactionsResult.oldCommentReplies || [],
        unrepliedCommentIds: unreplied.map(c => c.id),
        statsUpdate: reactionsResult.statsUpdate || null,
        qualityAssessment: reactionsResult.qualityAssessment || null,
    };
}

/**
 * @deprecated Use generateFullUpdate() instead. Kept for backward compatibility.
 */
export async function generateChapterUpdate(work) {
    console.warn(`${LIT_LOG} generateChapterUpdate is deprecated, use generateFullUpdate instead`);
    return generateFullUpdate(work);
}

// ═══════════════════════════════════════════════════════════════════════
// 3. Contract Evaluation (签约判定)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Evaluate whether a work should be offered a contract.
 * This is a SURPRISE feature — never hinted to the user.
 *
 * @param {Object} work - The work with latest stats
 * @param {number} qualityScore - From the latest chapter update's quality assessment
 * @returns {{ shouldSign: boolean, tier: number, editorMessage: string } | null}
 */
export function evaluateContract(work, qualityScore) {
    // Already signed? No re-evaluation
    if (work.signed) return null;

    const { avg: actualRating } = computeWorkRating(work);

    // Minimum requirements
    const minChapters = 5;
    const minRating = 6.5;
    const minQuality = 65;
    const minFavorites = 15;

    if (work.chapters.length < minChapters) return null;
    if (actualRating < minRating) return null;
    if (qualityScore < minQuality) return null;
    if (work.favorites < minFavorites) return null;

    // Probability based on quality
    let probability = 0;
    if (qualityScore >= 90) probability = 0.6;      // 优秀 — 60% chance
    else if (qualityScore >= 80) probability = 0.35; // 良好 — 35%
    else if (qualityScore >= 70) probability = 0.15; // 中等 — 15%
    else probability = 0.05;                          // 勉强达标 — 5%

    // Rating bonus
    if (actualRating >= 8.5) probability += 0.1;
    else if (actualRating >= 7.5) probability += 0.05;

    // Roll the dice
    if (Math.random() > probability) return null;

    // Determine tier
    let tier = 1;
    if (qualityScore >= 90 && actualRating >= 8.5) tier = 3;      // 大神
    else if (qualityScore >= 80 && actualRating >= 7.5) tier = 2;  // 精品
    // else tier = 1 (普通签约)

    // Generate editor message based on tier
    const editorMessages = {
        1: `尊敬的作者您好，我是平台编辑。您的作品《${work.title}》展现了不错的潜力，我们诚挚邀请您与平台签约，期待您的持续创作！`,
        2: `尊敬的作者，您的力作《${work.title}》在读者中引起了热烈反响！经编辑部讨论，我们希望为您提供「精品作者」签约——这是对您文学才华的充分认可。`,
        3: `恭喜您！《${work.title}》已成为平台标杆之作，编辑部全票通过授予您「大神作者」称号。这是我们的最高荣誉签约，期待您继续创造奇迹！`,
    };

    return {
        shouldSign: true,
        tier,
        editorMessage: editorMessages[tier],
    };
}

// ═══════════════════════════════════════════════════════════════════════
// 4. Generate Author Reply to Comments (Batch)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Generate the character's replies to multiple reader comments in one call.
 * The character treats ALL commenters as ordinary readers — even the user's
 * own comments (角色不知道那是恋人，以为是普通读者).
 *
 * @param {Object} work - The work
 * @param {Array<Object>} comments - List of unreplied comments
 * @returns {Promise<Record<string, string>>} Map of commentId → reply text
 */
export async function generateBatchAuthorReplies(work, comments) {
    if (!comments || comments.length === 0) return {};

    const { charName, foundation, charDesc } = _buildCharContext();

    // Build numbered comment list for the prompt
    const commentList = comments.map((c, i) => {
        // Replace user's display name with a random reader-like alias
        const displayName = c.isReader ? c.author : _randomReaderAlias();
        const ratingTag = c.rating != null ? `（评分：${c.rating}/10）` : '';
        return `${i + 1}. 读者「${displayName}」${ratingTag}："${c.content.substring(0, 120)}"`;
    }).join('\n');

    const systemPrompt = `${foundation}

你是 ${charName}，网络作家身份。你正在逐一回复作品《${work.title}》下的多条读者评论。
${charDesc ? `关于你：${charDesc}` : ''}

### 重要规则
- 你把所有评论者都当做**普通读者**对待，你不认识他们中的任何人
- 用你的性格和口吻回复，像真实的网文作者回复读者
- 每条回复简短自然（20-80字），可以针对评论中的具体内容回应
- 不同评论的回复风格可以有变化，不要千篇一律

### 返回格式
严格返回 JSON 数组，每个元素对应一条回复，按评论编号顺序排列：
\`\`\`json
["回复第1条评论", "回复第2条评论", ...]
\`\`\``;

    const userPrompt = `以下是 ${comments.length} 条待回复的读者评论：
${commentList}

请逐一回复。`;

    console.log(`${LIT_LOG} 批量生成作者回复 (${comments.length} 条)...`);
    const result = await callPhoneLLM(systemPrompt, userPrompt, { maxTokens: 2000 });
    const cleaned = cleanLlmJson(result);
    const replies = JSON.parse(cleaned);

    // Map replies back to comment IDs
    const replyMap = {};
    comments.forEach((c, i) => {
        replyMap[c.id] = (replies[i] || '感谢支持！').trim();
    });
    return replyMap;
}

/** Generate a random reader-like alias so the character doesn't recognise the user */
function _randomReaderAlias() {
    const aliases = [
        '热心读者', '追更粉丝', '书友小A', '路过书迷', '深夜读者',
        '忠实粉丝', '评论常客', '潜水读者', '资深书友', '新来的',
    ];
    return aliases[Math.floor(Math.random() * aliases.length)];
}

// ═══════════════════════════════════════════════════════════════════════
// 5. Generate New Work (角色开新书)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Generate a new work for the character to start.
 * @param {Array} existingWorks - List of existing works (to avoid repetition)
 * @returns {Promise<Object>} New work info
 */
export async function generateNewWork(existingWorks = []) {
    const { charName, charDesc } = _buildCharContext();
    const writingDirective = _buildWritingDirective(charName, charDesc);

    const existingTitles = existingWorks.map(w => `《${w.title}》(${w.genre})`).join('、');

    const systemPrompt = `${writingDirective}

你是网络文学平台上的作者。

### 任务
你想开一部新作品。根据你的性格和兴趣，构思一部全新的作品。
你需要同时规划好这部作品的**完整大纲**，包括预计章数、每章规划和结局走向。
${existingTitles ? `你已有的作品：${existingTitles}，新作品要和这些不同。` : ''}

### 重要规则
1. 大纲要合理：连载小说建议 10-25 章，短篇 3-6 章，散文/随笔 3-8 篇
2. 必须为第一章生成一段简洁摘要（50-100字），概括本章关键情节和角色发展
3. 大纲的每章规划要详细：包含具体情节事件和角色行动（50-100字），以及这章的情感基调和关键转折点

### 返回格式
\`\`\`json
{
  "title": "新作品标题",
  "type": "serial/short/essay/prose",
  "genre": "类型标签",
  "synopsis": "作品简介（50-100字）",
  "outline": {
    "totalPlannedChapters": 15,
    "endingDirection": "用一句话描述结局走向",
    "chapterPlans": [
      { "chapterNum": 1, "plan": "本章情节规划（50-100字，包含具体事件和角色行动）", "emotionalTone": "紧张/温馨/悲伤等", "keyTurningPoint": "本章关键转折点（一句话）" },
      { "chapterNum": 2, "plan": "...", "emotionalTone": "...", "keyTurningPoint": "..." }
    ]
  },
  "firstChapterTitle": "第一章标题",
  "firstChapterContent": "第一章正文（800-1500字）",
  "firstChapterSummary": "第一章的简洁摘要（50-100字），概括关键情节",
  "initialFavorites": 0,
  "initialReaders": 0
}
\`\`\``;

    const userPrompt = `请构思并开始一部全新的作品，规划好全书大纲，然后写出第一章。`;

    console.log(`${LIT_LOG} 生成新作品...`);
    const result = await callPhoneLLM(systemPrompt, userPrompt, { maxTokens: 5000 });
    const cleaned = cleanLlmJson(result);
    return JSON.parse(cleaned);
}

// ═══════════════════════════════════════════════════════════════════════
// 6. Reading — Generate Character's Reading Note
// ═══════════════════════════════════════════════════════════════════════

/**
 * Generate the character's reading note responding to user's thought.
 * Token-efficient: does NOT send any chapter content to LLM.
 * The character uses its own knowledge of the book + user's thought.
 *
 * @param {Object} opts
 * @param {string} opts.bookTitle - Book title
 * @param {string} opts.bookAuthor - Book author
 * @param {string} [opts.bookSummary] - Optional user-provided book summary
 * @param {number} opts.pageNum - Current page number (1-based)
 * @param {number} opts.totalPages - Total number of pages
 * @param {string} opts.userThought - User's own thought/reflection
 * @returns {Promise<string>} Character's responding note
 */
export async function generateReadingNote({ bookTitle, bookAuthor, bookSummary, pageNum, totalPages, userThought }) {
    const { charName, foundation, charDesc } = _buildCharContext();
    const userName = getPhoneUserName();

    const progressPercent = totalPages > 0 ? Math.round((pageNum / totalPages) * 100) : 0;

    const systemPrompt = `${foundation}

你是 ${charName}，你和 ${userName} 一起在读《${bookTitle}》（${bookAuthor}）。
${charDesc ? `关于你：${charDesc}` : ''}
${bookSummary ? `关于这本书：${bookSummary}` : ''}

### 当前进度
${userName} 正在读到第 ${pageNum} 页（共 ${totalPages} 页，${progressPercent}%）

### 任务
${userName} 刚写下了自己对这一页的感想。你需要以你自己的视角和性格回应，可以：
- 赞同或反对 Ta 的观点，并说出你的理由
- 分享你对同一段内容的不同感受
- 联想到你自己的经历或记忆
- 对 Ta 的观察表示惊喜或思考

### 重要规则
1. 用自然的口吻，像跟恋人在读书会上聊天一样
2. 使用${charName}资料中所规定的语言进行输出。
3. 100-200字，不要太长
4. 不要复述 ${userName} 的感想，要有${charName}自己的独立见解
5. 只输出${charName}的感想内容，不要加任何前缀或引号`;

    const userPrompt = `${userName} 的感想：
"${userThought}"

请回应 ${userName} 的感想。`;

    console.log(`${LIT_LOG} 写阅读笔记回应...`);
    const result = await callPhoneLLM(systemPrompt, userPrompt);
    return result?.trim() || '...';
}

// ═══════════════════════════════════════════════════════════════════════
// 7. Reading — Generate Character's Bookshelf
// ═══════════════════════════════════════════════════════════════════════

/**
 * Generate 10 books that the character would read independently.
 * @returns {Promise<Array>} List of book objects
 */
export async function generateCharBookshelf() {
    const { charName, userName, foundation, charDesc } = _buildCharContext();

    const systemPrompt = `${foundation}

你是 ${charName}。
${charDesc ? `关于你：${charDesc}` : ''}

### 任务
列出你平时独自阅读的 10 本书。这些书应该完全反映你的性格、兴趣和精神世界。
要求：
1. 必须是**真实存在**的书籍
2. 类型要多样化（小说、诗集、学术、传记、哲学等都可以）
3. 每本书附带一句你个人的简短感想（30-60字），体现你的性格
4. 书的选择要有深度，不要全是畅销书

### 返回格式
\`\`\`json
{
  "books": [
    {
      "title": "书名",
      "author": "作者",
      "genre": "类型",
      "charNote": "你对这本书的一句个人感想"
    }
  ]
}
\`\`\``;

    const userPrompt = `请列出你私人书架上的 10 本书。`;

    console.log(`${LIT_LOG} 生成角色书架...`);
    const result = await callPhoneLLM(systemPrompt, userPrompt, { maxTokens: 3000 });
    const cleaned = cleanLlmJson(result);
    const parsed = JSON.parse(cleaned);
    return parsed.books || [];
}

// ═══════════════════════════════════════════════════════════════════════
// 8. Reading — Generate Detailed Book Note (lazy-load)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Generate a detailed reading note for a book on the character's shelf.
 * @param {Object} book - Book from charBookshelf
 * @returns {Promise<string>} Detailed note (200-400 chars)
 */
export async function generateDetailedBookNote(book) {
    const { charName, foundation, charDesc } = _buildCharContext();

    const systemPrompt = `${foundation}

你是 ${charName}。
${charDesc ? `关于你：${charDesc}` : ''}

### 任务
写一段对《${book.title}》（${book.author}）的详细读书笔记（200-400字）。
内容可以包括：你最喜欢的段落或情节、这本书如何影响了你、你从中获得的感悟、你会向什么样的人推荐这本书。
要有你独特的见解和情感，不要写成书评摘要。
只输出笔记内容。`;

    const userPrompt = `请写下你对《${book.title}》的详细读书笔记。`;

    console.log(`${LIT_LOG} 生成详细读书笔记: ${book.title}`);
    const result = await callPhoneLLM(systemPrompt, userPrompt);
    return result?.trim() || '...';
}
