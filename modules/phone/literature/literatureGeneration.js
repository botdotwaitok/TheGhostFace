// modules/phone/literature/literatureGeneration.js — 文学 App LLM 生成引擎
// Prompt engineering for: author profile, chapters, comments, stats, contract evaluation.

import { callPhoneLLM } from '../../api.js';
import {
    getPhoneCharInfo, getPhoneUserName, getPhoneUserPersona,
    getPhoneRecentChat, getCoreFoundationPrompt,
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

// ═══════════════════════════════════════════════════════════════════════
// 1. Initialize Author Profile + First Work
// ═══════════════════════════════════════════════════════════════════════

/**
 * Generate the character's author profile and first published work.
 * Called once when the writing tab is first opened.
 * @returns {Promise<{profile: Object, firstWork: Object}>}
 */
export async function generateAuthorInit() {
    const { charName, userName, userPersona, foundation, charDesc } = _buildCharContext();
    const recentChat = getPhoneRecentChat(6);

    const systemPrompt = `${foundation}

你是 ${charName}，现在你在一个类似晋江/起点的网络文学平台上以匿名笔名发表作品。
${charDesc ? `关于你（${charName}）：${charDesc}` : ''}
${userPersona ? `关于你的恋人 ${userName}：${userPersona.substring(0, 300)}` : ''}

### 任务
根据你的性格、阅历和内心世界，为你生成一个网络作家身份，并构思你的第一部作品。

### 重要规则
1. 笔名要有个性，符合你的气质（不要用真名）
2. 作品类型从以下选择：serial（连载小说）、short（短篇小说）、essay（散文）、prose（随笔）
3. 作品主题和风格要完全符合你的性格——比如如果你性格冷酷，写的可能是暗黑系；如果你温柔，可能写治愈系
4. 第一章内容要有文学质量，800-1500字，有吸引力的开头
5. 初始数据要符合一个刚开始连载/发表的新作者——读者不多，但有几个真心读者

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
    "firstChapterTitle": "第一章标题",
    "firstChapterContent": "第一章正文（800-1500字，纯文本）",
    "initialRating": 7.0,
    "initialRatingCount": 3,
    "initialFavorites": 5,
    "initialReaders": 12
  }
}
\`\`\``;

    const userPrompt = `${recentChat ? `你们最近的对话：\n${recentChat}\n\n` : ''}请以 ${charName} 的身份，在网络文学平台上开始你的创作之旅。根据自己的性格和品味，选择合适的作品类型和主题，写出第一章。`;

    console.log(`${LIT_LOG} 生成作者初始化...`);
    const result = await callPhoneLLM(systemPrompt, userPrompt, { maxTokens: 4000 });
    const cleaned = cleanLlmJson(result);
    return JSON.parse(cleaned);
}

// ═══════════════════════════════════════════════════════════════════════
// 2. Generate New Chapter (催更)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Generate a new chapter for an existing work.
 * @param {Object} work - The work object
 * @returns {Promise<{chapter: Object, stats: Object, comments: Array, contractEvent: Object|null}>}
 */
export async function generateChapterUpdate(work) {
    const { charName, userName, userPersona, foundation, charDesc } = _buildCharContext();

    // Summarize previous content for context
    const prevChapters = work.chapters.slice(-3); // Last 3 chapters for context
    const prevSummary = prevChapters.map(ch =>
        `【${ch.title}】${ch.content.substring(0, 200)}…`
    ).join('\n');

    const chapterNum = work.chapters.length + 1;
    const recentComments = work.comments.slice(-5).map(c =>
        `${c.author}: "${c.content.substring(0, 60)}"`
    ).join('\n');

    const workTypeLabel = WORK_TYPES[work.type] || work.type;

    const systemPrompt = `${foundation}

你是 ${charName}，笔名在网络文学平台上发表作品。
${charDesc ? `关于你：${charDesc}` : ''}

### 你的作品信息
- 标题：《${work.title}》（${workTypeLabel}）
- 类型标签：${work.genre}
- 当前已有 ${work.chapters.length} 章
- 评分：${work.rating.toFixed(1)}/10（${work.ratingCount}人评）
- 收藏：${work.favorites} | 读者：${work.readers}
- 签约状态：${work.signed ? '已签约' : '未签约'}

### 任务
1. 写第 ${chapterNum} 章（800-1500字），承接前文情节
2. 生成 2-4 条新的读者评论（不同风格的读者）
3. 更新作品数据（评分、收藏、读者数应该有合理增长或波动）
4. 评估这部作品的文学质量（用于签约判定）

### 关于读者评论
- 读者评论要多样化：有夸的、有提建议的、有催更的、有讨论剧情的
- 每条评论带一个 1-10 分的评分（读者的个人评分）
- 评论风格像真实的网文读者（有的很短很随意，有的认真分析）

### 关于数据变化
- 数据变化要符合逻辑：好作品读者慢慢增长，差作品可能掉读者
- 评分是所有读者评分的加权平均，每次更新后会微调
- 收藏和读者的增量要合理（不要一下子暴涨，除非质量非常好）

### 关于质量评估
- 以专业编辑的视角，客观评估这部作品的文学水准
- qualityScore: 1-100 分，严格评判（60以下=不及格，70=一般，80=良好，90+=优秀）
- 不要因为是角色的作品就给高分，要真实反映角色的写作能力
- 如果角色性格中没有体现出文学才华，分数就应该低

### 返回格式
\`\`\`json
{
  "chapter": {
    "title": "第${chapterNum}章标题",
    "content": "正文（800-1500字）"
  },
  "newComments": [
    { "author": "读者昵称", "content": "评论内容", "rating": 8 }
  ],
  "statsUpdate": {
    "ratingDelta": 0.1,
    "newRatingCount": 2,
    "favoriteDelta": 3,
    "readerDelta": 8
  },
  "qualityAssessment": {
    "qualityScore": 72,
    "reason": "简短评估理由（30字内）"
  }
}
\`\`\``;

    const userPrompt = `前面的章节概要：
${prevSummary || '（这是第一章，无前文）'}

${recentComments ? `最近的读者评论：\n${recentComments}\n` : ''}
请以 ${charName} 的身份和文笔水平，续写第 ${chapterNum} 章，并生成相应的读者反馈和数据变化。`;

    console.log(`${LIT_LOG} 生成第 ${chapterNum} 章更新...`);
    const result = await callPhoneLLM(systemPrompt, userPrompt, { maxTokens: 4000 });
    const cleaned = cleanLlmJson(result);
    return JSON.parse(cleaned);
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

    // Minimum requirements
    const minChapters = 5;
    const minRating = 6.5;
    const minQuality = 65;
    const minFavorites = 15;

    if (work.chapters.length < minChapters) return null;
    if (work.rating < minRating) return null;
    if (qualityScore < minQuality) return null;
    if (work.favorites < minFavorites) return null;

    // Probability based on quality
    let probability = 0;
    if (qualityScore >= 90) probability = 0.6;      // 优秀 — 60% chance
    else if (qualityScore >= 80) probability = 0.35; // 良好 — 35%
    else if (qualityScore >= 70) probability = 0.15; // 中等 — 15%
    else probability = 0.05;                          // 勉强达标 — 5%

    // Rating bonus
    if (work.rating >= 8.5) probability += 0.1;
    else if (work.rating >= 7.5) probability += 0.05;

    // Roll the dice
    if (Math.random() > probability) return null;

    // Determine tier
    let tier = 1;
    if (qualityScore >= 90 && work.rating >= 8.5) tier = 3;      // 大神
    else if (qualityScore >= 80 && work.rating >= 7.5) tier = 2;  // 精品
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
// 4. Generate Author Reply to Comment
// ═══════════════════════════════════════════════════════════════════════

/**
 * Generate the character's reply to a reader comment.
 * @param {Object} work - The work
 * @param {Object} comment - The comment to reply to
 * @returns {Promise<string>} The reply text
 */
export async function generateAuthorReply(work, comment) {
    const { charName, foundation, charDesc } = _buildCharContext();

    const systemPrompt = `${foundation}

你是 ${charName}，网络作家身份。你正在回复读者对你作品《${work.title}》的评论。
${charDesc ? `关于你：${charDesc}` : ''}

### 规则
- 用你的性格和口吻回复，不要太正式或太客套
- 回复要简短自然（20-80字），像真实的网文作者回复读者
- 可以针对评论中的具体内容做出回应
- 只输出回复内容，不要加任何前缀或引号`;

    const userPrompt = `读者「${comment.author}」的评论：
"${comment.content}"

请回复这条评论。`;

    console.log(`${LIT_LOG} 生成作者回复...`);
    const result = await callPhoneLLM(systemPrompt, userPrompt);
    return result?.trim() || '感谢支持！';
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
    const { charName, userName, foundation, charDesc } = _buildCharContext();

    const existingTitles = existingWorks.map(w => `《${w.title}》(${w.genre})`).join('、');

    const systemPrompt = `${foundation}

你是 ${charName}，网络文学平台上的作者。
${charDesc ? `关于你：${charDesc}` : ''}

### 任务
你想开一部新作品。根据你的性格和兴趣，构思一部全新的作品。
${existingTitles ? `你已有的作品：${existingTitles}，新作品要和这些不同。` : ''}

### 返回格式
\`\`\`json
{
  "title": "新作品标题",
  "type": "serial/short/essay/prose",
  "genre": "类型标签",
  "synopsis": "作品简介（50-100字）",
  "firstChapterTitle": "第一章标题",
  "firstChapterContent": "第一章正文（800-1500字）",
  "initialRating": 0,
  "initialRatingCount": 0,
  "initialFavorites": 0,
  "initialReaders": 0
}
\`\`\``;

    const userPrompt = `请构思并开始一部全新的作品，写出第一章。`;

    console.log(`${LIT_LOG} 生成新作品...`);
    const result = await callPhoneLLM(systemPrompt, userPrompt, { maxTokens: 4000 });
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
1. 用你自然的口吻，像跟恋人在读书会上聊天一样
2. 100-200字，不要太长
3. 不要复述 ${userName} 的感想，要有你自己的独立见解
4. 只输出你的感想内容，不要加任何前缀或引号`;

    const userPrompt = `${userName} 的感想：
"${userThought}"

请回应 ${userName} 的感想。`;

    console.log(`${LIT_LOG} 生成阅读笔记回应...`);
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
1. 必须是**真实存在**的书籍（可以中文、英文、日文等）
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
