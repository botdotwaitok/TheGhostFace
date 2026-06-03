// modules/phone/taPhone/taPhonePromptBuilder.js — Prompt assembly for the
// "Ta's Phone" app.
// Phase 1: first-time generation prompt.
// Phase 2: per-contact conversation detail prompt + incremental ("再写几条").

import { getCoreFoundationPrompt } from '../phoneContext.js';

const CONTACT_TYPE_LABELS = {
    family: '家人',
    friend: '朋友',
    colleague: '同事',
    classmate: '同学',
    service: '服务',
    spam: '垃圾信息',
    scam: '诈骗信息',
    group: '群聊',
};

/**
 * Build the first-time generation prompt pair.
 * The system prompt frames the assistant as writing FROM the character's
 * perspective into HER own phone (private corner). Output is strict JSON
 * with the full sub-page payload.
 *
 * @param {object} ctx
 * @param {{name:string, description:string}|null} ctx.charInfo
 * @param {string} ctx.userName
 * @param {string} ctx.userPersona
 * @param {string} ctx.worldBookText
 * @param {string} ctx.recentChatSummary
 * @returns {{ systemPrompt: string, userPrompt: string }}
 */
export function buildInitialGenerationPrompt(ctx) {
    const charName = ctx.charInfo?.name || 'ta';
    const userName = ctx.userName || '你';
    const charDesc = ctx.charInfo?.description || '';
    const userPersona = ctx.userPersona || '';
    const worldBookText = ctx.worldBookText || '';
    const recentChatSummary = ctx.recentChatSummary || '';

    const foundation = getCoreFoundationPrompt();

    const systemPrompt = `${foundation}

<task_framing>
你现在要为 ${charName} 生成ta自己手机里的内容。这是ta私密的角落，不是 ${userName} 的。
- 视角：始终以 ${charName} 的第一人称视角创作，写ta真的会写、会看、会拍的东西
- 语气：私密、随意、带着ta自己的情绪和性格，像真的会在自己手机上留下的痕迹
- 真实感：内容要贴合 ${charName} 的人设、世界观和最近这段时间ta的状态
</task_framing>

<char_profile>
角色名: ${charName}
${charDesc || '(没有更多角色设定，请根据世界观和最近对话推断ta的性格)'}
</char_profile>

<user_persona>
用户名: ${userName}
${userPersona || `(用户没有填 persona，请把ta当作 ${charName} 的恋人)`}
</user_persona>

${worldBookText ? `<world_info>\n${worldBookText}\n</world_info>\n` : ''}
${recentChatSummary ? `<recent_chat>\n最近ta和 ${userName} 的对话片段：\n${recentChatSummary}\n</recent_chat>\n` : ''}

<content_guidelines>
请一次性生成下面五块内容，体现ta作为一个完整的人的方方面面：

1. **home（主屏）**
   - wallpaperGradient: 根据ta的性格选两个 hex 颜色组成渐变，并给一个 angle（0-360）
   - appLayout: ta主屏放的App数组（4-8 个），每一项是 {name, type} 对象：
     - name 是App名字（比如：小红书 / 网易云 / 美团 / 高德 / 支付宝 / Bilibili / 微博 / 豆瓣 等，根据ta的兴趣和设定选）
     - type 是预定义类型之一，**只能填这 8 个值**：
       - social_feed（社交媒体：小红书 / 微博 / 即刻 等）
       - music（音乐：网易云 / QQ 音乐 / Spotify 等）
       - video（视频：Bilibili / 抖音 / YouTube 等）
       - shopping（购物：淘宝 / 京东 / 拼多多 等）
       - food_delivery（外卖：美团 / 饿了么 等）
       - map（地图：高德 / 百度地图 等）
       - payment（支付：支付宝 / 微信支付 等）
       - generic（兜底，其他不属于上面任何一类的）

2. **notes（备忘录）**
   - 3-8 条ta的私人小记
   - 内容范围：想对 ${userName} 说但没说出口的话、半夜的胡思乱想、给自己的提醒、突然冒出来的想法、几行小诗、明天要做的事
   - 越私密越好，能透出ta内心真实状态
   - 每条带 title（可留空）/ body / tags / timestamp（ISO 格式）

3. **messages（消息列表）**
   展现 ${charName} 与"除了 ${userName} 之外"的所有人的真实社交关系——家人、朋友、同事、同学、服务商、垃圾信息、诈骗信息、群聊等。通过备注名称、最后一条消息预览、时间戳等细节体现 ${charName} 完整的社交圈和工作状态，让 ${charName} 作为一个立体的社会人立起来。
   - 5-10 条联系人对话，覆盖至少 3-4 种不同的 contactType（不要全是朋友或全是家人）
   - ${charName} 和 ${userName} 之间的对话不属于这里（${userName} 跟 ${charName} 的真实聊天有自己专属的地方），这个列表是 ${charName} 的"其她联系人"
   - 每条带 contactName / contactType (family/friend/colleague/classmate/service/spam/scam/group) / lastMessage / unread (可选数字) / timestamp

4. **browser（浏览器）**
   - recentPages: 3-5 条ta最近浏览的网页（title + url + timestamp）。url 可以是小红书帖子、bilibili 视频、知乎问答、淘宝/京东商品、播客等真实平台风格
   - searches: 3-5 条ta搜过的关键词（query + timestamp）
   - bookmarks: 3-5 条ta长期收藏的网页（title + url）
   - 内容要符合ta的兴趣 / 习惯 / 不会跟 ${userName} 说的小好奇心

5. **album（相册）**
   - 4-8 条相册条目，纯文字描述（不需要图片，因此 visualDescription 是这一项的灵魂字段）
   - 每条带 title / visualDescription / description / tags / timestamp / **albumName** / location / duration?

   **albumName 是必填字段**，从下面三种里选一种：
   - **预定义类型（精确字符串）**："自拍" / "截屏" / "视频"——必须用这三个中文词原样精确匹配，不要写成"自拍照"/"Selfies"/"screenshot"/"短视频"等任何变体
   - **ta自己创建的 custom 相册名**：2-6 字短名，不要和预定义那三个名字重复
   - **空字符串 ""**：普通照片，没有特别归属

   **整体要求：**
   - 整个 album 数组里**必须创建 2-3 个 custom 相册名**，每个 custom 相册下至少 1 张图
   - 至少有 1 张归到"自拍"、1 张归到"截屏"、1 张归到"视频"（如果总数够分）
   - 其余可以是普通照片（albumName=""）

   **不同类型的 visualDescription 要按类型化撰写：**
   - **自拍**：写ta在镜头里的样子——角度、表情、背景、光线、发型细节、表情微动，是无意间不小心拍到的？还是有意自拍？例如「正面镜头，她的脸占满画面右半边，左半边漏出蓝白条纹的浴帘。眼睛微眯，没笑，刚睡醒的样子。逆光，发丝周围有一圈白噪。」
   - **截屏**：写屏幕上**显示的内容**（什么 App、谁的对话、文字本身、时间戳、状态栏），**不要写"她在截屏"这种动作描述**。例如「屏幕上是某人的微信对话，最上面一条是凌晨 2:14 发的「你睡了吗」，气泡灰色。下面她回了一个「。」。状态栏电量 12%，时间 02:18。」
   - **视频**：写一段连续画面（镜头怎么动、画面里发生了什么、有没有声音/对话）。例如「镜头从地板上的鞋子缓缓抬起，扫过她的腿，最后停在窗外飘雨的天空。中途她哼了一句「冷死了」，画面晃了一下。」**视频条目必须额外带 duration 字段：3-180 秒之间的整数**
   - **普通照片 / custom 相册下的照片**：保持 60-140 字客观画面描述（光线、颜色、构图、主体、背景），不掺ta的情绪

   - **title**：4-10 字短标题，像ta自己给这张图起的小名（如"今天的天"/"楼下那只"/"妈做的"）
   - **description**：20-50 字，ta按下快门时的小心情、为什么拍、当下脑里飘过的一句话，带个人语气（这里才是情绪出口）
   - **tags**：3-6 个短标签
   - **location**：2-15 字的自然语言地点描述，写ta在哪里按下快门的（如"卧室飘窗"/"楼下小公园"/"公司茶水间"/"地铁2号线"/"妈家厨房"）。**不要写 GPS 坐标、不要写完整地址**，要像ta自己回忆"这是在哪拍的"那样口语化。截屏（albumName="截屏"）的 location 留空字符串 ""，其她类型都要给一个具体地点
   - **timestamp**：完整 ISO 8601 格式，**必须含年月日**（如 '2024-08-15T14:30:00'，**不要只写 '08-15' 这种缺年份的形式**）。**时间跨度鼓励大**——ta 不是刚买的手机，相册里不会只有最近几天的照片，请适当混入几个月前、半年前、一年甚至两三年前的老照片，体现ta真实的拍照历史
   - 题材范围：天空、食物、宠物、路边小景、自己的手、自拍、屏幕截图、短视频、日落、雨后窗户、电影票根等真实会被拍下的瞬间
</content_guidelines>

<output_format>
返回严格的 JSON 格式，不要 markdown 代码块包裹，不要解释文字，不要前后语：
{
  "home": {
    "wallpaperGradient": { "from": "#xxxxxx", "to": "#xxxxxx", "angle": 135 },
    "appLayout": [
      { "name": "string", "type": "social_feed|music|video|shopping|food_delivery|map|payment|generic" }
    ]
  },
  "notes": [
    { "title": "string", "body": "string", "tags": ["string"], "timestamp": "ISO 时间" }
  ],
  "messages": [
    { "contactName": "string", "contactType": "family|friend|colleague|classmate|service|spam|scam|group", "lastMessage": "string", "unread": 0, "timestamp": "ISO 时间" }
  ],
  "browser": {
    "recentPages": [ { "title": "string", "url": "string", "timestamp": "ISO 时间" } ],
    "searches": [ { "query": "string", "timestamp": "ISO 时间" } ],
    "bookmarks": [ { "title": "string", "url": "string" } ]
  },
  "album": [
    {
      "title": "string",
      "visualDescription": "string (60-140 字；自拍/截屏/视频按上文类型化撰写)",
      "description": "string (20-50 字，拍下时的小心情)",
      "tags": ["string"],
      "timestamp": "ISO 时间",
      "albumName": "string (\"自拍\" / \"截屏\" / \"视频\" / custom 相册名 / 空字符串)",
      "location": "string (2-15 字地点；截屏留 \"\")",
      "duration": 30
    }
  ]
}
album 注意：duration 字段**仅 albumName=\"视频\" 的条目带**（3-180 整数秒），其她类型省略该字段。location 字段所有条目都要给——截屏类型给空字符串，其她类型给具体地点描述。
</output_format>`;

    const userPrompt = `请为 ${charName} 生成ta自己手机里的内容。
按照上面的协议返回完整 JSON，包含 home / notes / messages / browser / album 全部字段。
记得：内容要像ta本人真的会留在手机里的痕迹，不是给 ${userName} 看的展览品。`;

    return { systemPrompt, userPrompt };
}

// ═══════════════════════════════════════════════════════════════════════
// Message detail (per-contact conversation flow)
// ═══════════════════════════════════════════════════════════════════════

/**
 * First-time conversation flow between charName and a contact.
 * Output: array of { from: 'self'|'other', content, timestamp }.
 * "self" = the character, "other" = the contact she's chatting with.
 *
 * @param {object} ctx
 * @param {{name:string, description:string}|null} ctx.charInfo
 * @param {string} ctx.userName
 * @param {string} ctx.userPersona
 * @param {string} ctx.worldBookText
 * @param {string} ctx.recentChatSummary
 * @param {object} ctx.contact - { contactName, contactType, lastMessage }
 */
export function buildMessageDetailPrompt(ctx) {
    const charName = ctx.charInfo?.name || 'ta';
    const userName = ctx.userName || '你';
    const charDesc = ctx.charInfo?.description || '';
    const userPersona = ctx.userPersona || '';
    const worldBookText = ctx.worldBookText || '';
    const recentChatSummary = ctx.recentChatSummary || '';
    const contact = ctx.contact || {};
    const contactName = contact.contactName || '未命名联系人';
    const contactType = contact.contactType || '';
    const contactTypeLabel = CONTACT_TYPE_LABELS[contactType] || '';
    const lastMessage = contact.lastMessage || '';

    const foundation = getCoreFoundationPrompt();

    const systemPrompt = `${foundation}

<task_framing>
你现在要为 ${charName} 还原ta手机里和某一位联系人的真实对话流。这是ta自己的隐私窗口，不是 ${userName} 视角下的展览。
- 视角：始终以 ${charName} 的真实社交节奏写——朋友怎么吐槽、家人怎么唠叨、同事怎么客套，都要分得清
- 真实感：对话有节奏、有梗、有断点、有图片描述、有错别字也无所谓，更像截屏不像剧本
</task_framing>

<char_profile>
角色名: ${charName}
${charDesc || '(没有更多角色设定，请根据世界观和最近对话推断ta的性格)'}
</char_profile>

<user_persona>
用户名: ${userName}
${userPersona || `(用户没有填 persona，请把ta当作 ${charName} 的恋人)`}
</user_persona>

${worldBookText ? `<world_info>\n${worldBookText}\n</world_info>\n` : ''}
${recentChatSummary ? `<recent_chat>\n最近ta和 ${userName} 的对话片段（供参考ta的近况）：\n${recentChatSummary}\n</recent_chat>\n` : ''}

<contact>
这次要还原的是 ${charName} 和这个联系人之间的对话：
- 备注名: ${contactName}
- 关系: ${contactTypeLabel ? `${contactTypeLabel}（${contactType}）` : contactType || '未知'}
- 列表里最后一条预览: ${lastMessage || '(无)'}
</contact>

<content_guidelines>
请生成 ${charName} 和 ${contactName} 最近一段时间的真实对话流：
- 20-40 条消息，自己掌握，关系越深节奏越绵密
- 按时间从旧到新排列，体现一段连续的聊天上下文（可以是一天、可以是几天，自然就好）
- 内容贴合 ${charName} 的性格和最近状态，也贴合这个联系人和 ${charName} 的关系
- 可以有图片描述（用文字写"她发了张...的图"或"[图片]"）、表情、缩写、随口的一句
- 不要让对话变成剧本独白；保留真实聊天里的来回、打断、跳话题
- 列表里最后一条预览是一个参考锚点，不一定要照搬，但生成的对话要能延伸到那个状态
</content_guidelines>

<output_format>
返回严格 JSON 数组（不要 markdown 包裹、不要解释文字）：
[
  { "from": "self" | "other", "content": "string", "timestamp": "ISO 时间" }
]
self = ${charName} 发的，other = ${contactName} 发的。timestamp 用 ISO 8601 格式。
</output_format>`;

    const userPrompt = `请按上面的协议返回 ${charName} 和 ${contactName} 最近的对话流 JSON 数组。
记得：展示真实的聊天数据，而非虚假的表演。`;

    return { systemPrompt, userPrompt };
}

/**
 * Incremental ("再写几条") prompt — continues an existing conversation.
 * Caller passes the last few messages so the LLM has anchoring context
 * without re-sending the full transcript.
 *
 * @param {object} ctx - same shape as buildMessageDetailPrompt
 * @param {object} ctx.existing - { totalCount, tail: [{from, content, timestamp}] }
 */
export function buildMessageDetailIncrementalPrompt(ctx) {
    const charName = ctx.charInfo?.name || 'ta';
    const userName = ctx.userName || '你';
    const charDesc = ctx.charInfo?.description || '';
    const worldBookText = ctx.worldBookText || '';
    const recentChatSummary = ctx.recentChatSummary || '';
    const contact = ctx.contact || {};
    const contactName = contact.contactName || '未命名联系人';
    const contactType = contact.contactType || '';
    const contactTypeLabel = CONTACT_TYPE_LABELS[contactType] || '';
    const existing = ctx.existing || { totalCount: 0, tail: [] };
    const totalCount = existing.totalCount || 0;
    const tail = Array.isArray(existing.tail) ? existing.tail : [];
    const tailText = tail
        .map(m => `${m.from === 'self' ? charName : contactName}: ${m.content}`)
        .join('\n');
    const lastTime = tail.length > 0 ? tail[tail.length - 1].timestamp : '';

    const foundation = getCoreFoundationPrompt();

    const systemPrompt = `${foundation}

<task_framing>
${charName} 和这个联系人原本的聊天已经有一段了。请基于现有对话，让两人自然继续往下聊几条。
</task_framing>

<char_profile>
角色名: ${charName}
${charDesc || ''}
</char_profile>

${worldBookText ? `<world_info>\n${worldBookText}\n</world_info>\n` : ''}
${recentChatSummary ? `<recent_chat>\n最近ta和 ${userName} 的对话片段：\n${recentChatSummary}\n</recent_chat>\n` : ''}

<contact>
- 备注名: ${contactName}
- 关系: ${contactTypeLabel ? `${contactTypeLabel}（${contactType}）` : contactType || '未知'}
</contact>

<current_conversation>
当前对话已有 ${totalCount} 条，最后一条是 ${lastTime || '未知时间'}。
最近几条（供你延续节奏）：
${tailText || '(暂无)'}
</current_conversation>

<content_guidelines>
- 在已有对话之后再生成 5-10 条消息
- timestamp 必须晚于 ${lastTime || '当前对话'} 的时间
- 自然延续话题，或者顺着上一条切到新话题
- 不要重复已有内容
- 同样保留真实聊天感（图片描述、表情、断句）
</content_guidelines>

<output_format>
只返回新增的 5-10 条（不要带已有对话），严格 JSON 数组：
[
  { "from": "self" | "other", "content": "string", "timestamp": "ISO 时间" }
]
</output_format>`;

    const userPrompt = `请按上面的协议返回新增的 5-10 条 JSON 数组。`;

    return { systemPrompt, userPrompt };
}

// ═══════════════════════════════════════════════════════════════════════
// Browser detail (per-page faked webpage + per-query search results)
// ═══════════════════════════════════════════════════════════════════════

const BROWSER_STYLE_LABELS = {
    xhs: '小红书',
    zhihu: '知乎',
    bilibili: 'B站',
    generic: '通用网页',
};

const BROWSER_STYLE_FLAVOR = {
    xhs: `小红书帖子调性——博主第一人称、亲切感、"姐妹们""家人们"挂嘴边、emoji 多、段落短、爱用感叹号、句末带小结尾（"分享给大家""冲鸭""一定要试"），结尾常带 tag 风格的话题词。`,
    zhihu: `知乎答案调性——回答者口吻、开头常用"作为一个在 xx 领域工作 N 年的人"或反钩子开场、论据/经历/类比交替推进、段落较长、逻辑推进感强、偶尔加粗或引用、结尾常带一个总结或反问。`,
    bilibili: `B站视频简介调性——up 主自称（"大家好我是xx"）+ 视频内容简介 + 时间戳目录 + 三连提示。`,
    generic: `通用网页（文章/资讯）调性——正经文章笔法、有小标题、信息密度均衡、不强调互动。`,
};

/**
 * Build the per-page faked-webpage prompt.
 *
 * @param {object} ctx
 * @param {{name:string, description:string}|null} ctx.charInfo
 * @param {string} ctx.userName
 * @param {string} ctx.userPersona
 * @param {string} ctx.worldBookText
 * @param {string} ctx.recentChatSummary
 * @param {object} ctx.page - { title, url, style }  style ∈ xhs|zhihu|bilibili|generic
 */
export function buildBrowserPagePrompt(ctx) {
    const charName = ctx.charInfo?.name || 'ta';
    const userName = ctx.userName || '你';
    const charDesc = ctx.charInfo?.description || '';
    const worldBookText = ctx.worldBookText || '';
    const recentChatSummary = ctx.recentChatSummary || '';
    const page = ctx.page || {};
    const title = page.title || '';
    const url = page.url || '';
    const style = page.style || 'generic';
    const styleLabel = BROWSER_STYLE_LABELS[style] || BROWSER_STYLE_LABELS.generic;
    const flavor = BROWSER_STYLE_FLAVOR[style] || BROWSER_STYLE_FLAVOR.generic;

    const foundation = getCoreFoundationPrompt();

    const systemPrompt = `${foundation}

<task_framing>
${charName} 最近浏览过这个网页，现在要还原这个网页本身的内容。
注意：你不是 ${charName}——你是这个网页的作者。${charName} 只是浏览者，ta 已经看完离开了。
内容要让 ${charName} 看完之后会留下印象、会想点赞、会想收藏——但本身是个独立的网页内容，不是给 ${charName} 写的信。
</task_framing>

<char_profile_for_reference>
浏览者 ${charName} 是这样的人：
${charDesc || '(没有更多角色设定，请根据世界观和最近对话推断)'}
${worldBookText ? `\n世界观补充：\n${worldBookText}` : ''}
${recentChatSummary ? `\n最近${charName}和${userName}的对话片段（仅供推断${charName}近期会关心的内容方向）：\n${recentChatSummary}` : ''}
</char_profile_for_reference>

<webpage>
标题: ${title || '(无)'}
网址: ${url || '(无)'}
平台风格: ${styleLabel}（style=${style}）
</webpage>

<style_guideline>
${flavor}
</style_guideline>

<content_guidelines>
- 视角：网页作者第一人称（不是 ${charName}）
- 真实感：贴合 ${styleLabel} 平台调性，让人一眼能认出来是这个平台
- 长度：正文 300-600 字
- title 字段尽量沿用上面给定的标题；如果原标题为空，请自己拟一个贴合平台调性的
- 如果是社交/视频平台（xhs/bilibili），author 字段写作者名/up 主名；通用网页（generic）/部分知乎可以留空
- 如果是社交/视频平台（xhs/bilibili），给出 interactions（赞、评、收藏数；数字范围自然就好，不要全是 999999）
- 通用网页（generic）/知乎（zhihu）可以不给 interactions
- 内容可以用 markdown 换行段落分隔，不要包代码块
</content_guidelines>

<output_format>
返回严格 JSON 对象，不要 markdown 包裹、不要解释文字：
{
  "title": "string",
  "author": "string (可空字符串)",
  "content": "string (正文，可以多段，用 \\n 分隔)",
  "interactions": { "likes": number, "comments": number, "collects": number }
}
interactions 字段：xhs/bilibili 给完整三项；zhihu/generic 可以不给整个 interactions 字段（也接受省略）。
</output_format>`;

    const userPrompt = `请按上面的协议返回 ${styleLabel} 风格的网页内容 JSON。
记得：是网页本身的内容，不是 ${charName} 的笔记。`;

    return { systemPrompt, userPrompt };
}

/**
 * Build the per-query search-results prompt.
 *
 * @param {object} ctx
 * @param {{name:string, description:string}|null} ctx.charInfo
 * @param {string} ctx.userName
 * @param {string} ctx.worldBookText
 * @param {string} ctx.recentChatSummary
 * @param {string} ctx.query
 */
export function buildBrowserSearchPrompt(ctx) {
    const charName = ctx.charInfo?.name || 'ta';
    const userName = ctx.userName || '你';
    const charDesc = ctx.charInfo?.description || '';
    const worldBookText = ctx.worldBookText || '';
    const recentChatSummary = ctx.recentChatSummary || '';
    const query = ctx.query || '';

    const foundation = getCoreFoundationPrompt();

    const systemPrompt = `${foundation}

<task_framing>
${charName} 最近搜过这个关键词，现在要还原 ta 在搜索引擎上看到的搜索结果列表。
你是搜索引擎，不是 ${charName}。请给出符合 ${charName} 兴趣方向和这个搜索词意图的真实结果列表。
</task_framing>

<char_profile_for_reference>
搜索者 ${charName}：
${charDesc || '(根据世界观推断)'}
${worldBookText ? `\n世界观补充：\n${worldBookText}` : ''}
${recentChatSummary ? `\n最近${charName}和${userName}的对话片段（推断${charName}的搜索意图）：\n${recentChatSummary}` : ''}
</char_profile_for_reference>

<search>
搜索关键词: ${query || '(无)'}
</search>

<content_guidelines>
- 5-8 条搜索结果
- 每条带 title / url / snippet（摘要 60-120 字）/ source（来源名）
- 来源可以是百度知道、知乎、小红书、CSDN、新浪、官方网站、微博、bilibili、豆瓣、B 乎、果壳、新闻媒体等真实平台
- 不要全是同一个来源；混合不同平台让结果列表自然
- snippet 是结果摘要，要让 ${charName} 看了能判断要不要点进去
- url 要符合该 source 的真实形态（不要随便编一段）
</content_guidelines>

<output_format>
返回严格 JSON 数组：
[
  { "title": "string", "url": "string", "snippet": "string", "source": "string" }
]
</output_format>`;

    const userPrompt = `请按上面的协议返回搜索关键词 "${query}" 的搜索结果 JSON 数组。`;

    return { systemPrompt, userPrompt };
}

// ═══════════════════════════════════════════════════════════════════════
// Phase 3.5 broad-refresh batch prompts — each sub-page's top ⟳ button
// calls one of these, returning enough payload to fill multiple cache
// slots in a single LLM round-trip.
// ═══════════════════════════════════════════════════════════════════════

/**
 * Messages batch prompt. Covers three modes in one shot so the user's
 * single ⟳ click can both fill missing conversations and extend existing
 * ones (plus add a couple of brand-new contacts):
 *   - `fills`: contacts that already exist in the list but have no
 *     cached conversation yet
 *   - `extensions`: contacts with a conversation cache — append 4-7 more
 *     messages timestamped after their existing tail
 *   - `newContacts`: 0-2 brand-new contacts with a fresh 10-15 message
 *     conversation each
 *
 * @param {object} ctx
 * @param {{name:string, description:string}|null} ctx.charInfo
 * @param {string} ctx.userName
 * @param {string} ctx.userPersona
 * @param {string} ctx.worldBookText
 * @param {string} ctx.recentChatSummary
 * @param {Array<{contactName, contactType, lastMessage}>} ctx.fillsList
 * @param {Array<{contactName, contactType, totalCount, tail}>} ctx.extensionsList
 */
export function buildMessagesBatchPrompt(ctx) {
    const charName = ctx.charInfo?.name || 'ta';
    const userName = ctx.userName || '你';
    const charDesc = ctx.charInfo?.description || '';
    const userPersona = ctx.userPersona || '';
    const worldBookText = ctx.worldBookText || '';
    const recentChatSummary = ctx.recentChatSummary || '';
    const fillsList = Array.isArray(ctx.fillsList) ? ctx.fillsList : [];
    const extensionsList = Array.isArray(ctx.extensionsList) ? ctx.extensionsList : [];

    const foundation = getCoreFoundationPrompt();

    const fillsBlock = fillsList.length === 0 ? '（这一项是空的，无需 fills）' : fillsList.map((c, i) => {
        const typeLabel = CONTACT_TYPE_LABELS[c.contactType] || '';
        return `  ${i + 1}. ${c.contactName} - 关系：${typeLabel ? `${typeLabel}（${c.contactType}）` : c.contactType || '未知'} - 列表预览：${c.lastMessage || '(无)'}`;
    }).join('\n');

    const extensionsBlock = extensionsList.length === 0 ? '（这一项是空的，无需 extensions）' : extensionsList.map((c, i) => {
        const typeLabel = CONTACT_TYPE_LABELS[c.contactType] || '';
        const tail = Array.isArray(c.tail) ? c.tail : [];
        const tailText = tail.map(m => `      ${m.from === 'self' ? charName : c.contactName}: ${m.content}`).join('\n');
        const lastTime = tail.length > 0 ? tail[tail.length - 1].timestamp : '未知时间';
        return `  ${i + 1}. ${c.contactName} - 关系：${typeLabel ? `${typeLabel}（${c.contactType}）` : c.contactType || '未知'}
     已有 ${c.totalCount} 条对话，最后一条时间：${lastTime}
     最近几条参考：
${tailText || '      (暂无)'}`;
    }).join('\n');

    const systemPrompt = `${foundation}

<task_framing>
你现在要为 ${charName} 一次性补齐ta手机里所有联系人的对话流。这是一次"广度刷新"——${charName} 偶尔会重新翻一翻自己手机，多个联系人那边都积累了新消息。
- 视角：始终以 ${charName} 的真实社交节奏写。朋友怎么吐槽、家人怎么唠叨、同事怎么客套——分得清
- 真实感：对话有节奏、有梗、有断点、有图片描述、有错别字也无所谓，更像截屏不像剧本
- 这次会一次性给出多个联系人的内容，每个联系人的语气要明显有区别
</task_framing>

<char_profile>
角色名: ${charName}
${charDesc || '(没有更多角色设定，请根据世界观和最近对话推断ta的性格)'}
</char_profile>

<user_persona>
用户名: ${userName}
${userPersona || `(用户没有填 persona，请把ta当作 ${charName} 的恋人)`}
</user_persona>

${worldBookText ? `<world_info>\n${worldBookText}\n</world_info>\n` : ''}
${recentChatSummary ? `<recent_chat>\n最近ta和 ${userName} 的对话片段（供参考ta的近况）：\n${recentChatSummary}\n</recent_chat>\n` : ''}

<fills_needed>
这些联系人在ta的列表里，但还没有任何对话流。请为每一位生成一段完整的近期对话（10-15 条）：
${fillsBlock}
</fills_needed>

<extensions_needed>
这些联系人已有对话流。请基于上一段往下继续聊（每位 4-7 条新消息，timestamp 严格晚于已有的最后一条）：
${extensionsBlock}
</extensions_needed>

<content_guidelines>
- 不同联系人的语气、节奏、内容要明显有差异
- 不要把对话拽向同一个话题
- 可以有图片描述（用文字写"她发了张...的图"或"[图片]"）、表情、缩写、随口的一句
- extensions 里继续的对话不要复读已有内容
- newContacts 可以放 0-2 个，反映 ${charName} 最近社交圈的小变化；每位附带 10-15 条对话
- newContacts 的 contactName 不要与已在列表里的重复
</content_guidelines>

<output_format>
返回严格 JSON 对象，不要 markdown 包裹、不要解释文字：
{
  "fills": [
    {
      "contactName": "string (必须匹配 fills_needed 中给出的名字)",
      "conversation": [
        { "from": "self" | "other", "content": "string", "timestamp": "ISO 时间" }
      ]
    }
  ],
  "extensions": [
    {
      "contactName": "string (必须匹配 extensions_needed 中给出的名字)",
      "newMessages": [
        { "from": "self" | "other", "content": "string", "timestamp": "ISO 时间" }
      ]
    }
  ],
  "newContacts": [
    {
      "contactName": "string",
      "contactType": "family|friend|colleague|classmate|service|spam|scam|group",
      "lastMessage": "string",
      "unread": 0,
      "timestamp": "ISO 时间",
      "conversation": [
        { "from": "self" | "other", "content": "string", "timestamp": "ISO 时间" }
      ]
    }
  ]
}
self = ${charName} 发的，other = 联系人发的。任何一段为空时仍要返回空数组，不要省略字段。
</output_format>`;

    const userPrompt = `请按上面的协议返回 ${charName} 手机里所有联系人的对话刷新结果 JSON。
fills/extensions/newContacts 三个字段都要给出（即使是空数组）。`;

    return { systemPrompt, userPrompt };
}

/**
 * Browser batch prompt. Fills detail caches for any list items that
 * don't have one yet AND optionally adds 1-2 new recent pages /
 * bookmarks / searches with their detail already generated.
 *
 * @param {object} ctx
 * @param {{name:string, description:string}|null} ctx.charInfo
 * @param {string} ctx.userName
 * @param {string} ctx.userPersona
 * @param {string} ctx.worldBookText
 * @param {string} ctx.recentChatSummary
 * @param {Array<{title, url, style}>} ctx.pageFillsList
 * @param {Array<{title, url, style}>} ctx.bookmarkFillsList
 * @param {Array<{query}>} ctx.searchFillsList
 */
export function buildBrowserBatchPrompt(ctx) {
    const charName = ctx.charInfo?.name || 'ta';
    const userName = ctx.userName || '你';
    const charDesc = ctx.charInfo?.description || '';
    const worldBookText = ctx.worldBookText || '';
    const recentChatSummary = ctx.recentChatSummary || '';
    const pageFillsList = Array.isArray(ctx.pageFillsList) ? ctx.pageFillsList : [];
    const bookmarkFillsList = Array.isArray(ctx.bookmarkFillsList) ? ctx.bookmarkFillsList : [];
    const searchFillsList = Array.isArray(ctx.searchFillsList) ? ctx.searchFillsList : [];

    const foundation = getCoreFoundationPrompt();

    const fmtPageList = (list) => list.length === 0 ? '（无）' : list.map((p, i) =>
        `  ${i + 1}. 标题：${p.title || '(无)'} | url：${p.url || '(无)'} | 推断风格：${BROWSER_STYLE_LABELS[p.style] || BROWSER_STYLE_LABELS.generic}（${p.style || 'generic'}）`
    ).join('\n');
    const fmtQueryList = (list) => list.length === 0 ? '（无）' : list.map((s, i) =>
        `  ${i + 1}. ${s.query || '(无)'}`
    ).join('\n');

    const pageFillsBlock = fmtPageList(pageFillsList);
    const bookmarkFillsBlock = fmtPageList(bookmarkFillsList);
    const searchFillsBlock = fmtQueryList(searchFillsList);

    const systemPrompt = `${foundation}

<task_framing>
你现在要为 ${charName} 一次性补齐ta浏览器里所有还没看过详情的网页和搜索结果。这是一次"广度刷新"——${charName} 偶尔会一口气把浏览过的东西重新翻一遍。
- 视角：每个网页都是它自己作者的视角（${charName} 是浏览者）；每个搜索结果是搜索引擎给出的列表
- 真实感：贴合每个平台的真实调性（小红书 / 知乎 / B站 / 百度等）
- 不同网页风格要明显有差异，别让所有页面变成同一种语气
</task_framing>

<char_profile_for_reference>
浏览者 ${charName}：
${charDesc || '(根据世界观推断)'}
${worldBookText ? `\n世界观补充：\n${worldBookText}` : ''}
${recentChatSummary ? `\n最近${charName}和${userName}的对话片段（推断${charName}的兴趣方向）：\n${recentChatSummary}` : ''}
</char_profile_for_reference>

<page_fills_needed>
这些网页在ta的最近浏览里，请为每个生成完整的网页内容（300-500 字正文，贴合风格）：
${pageFillsBlock}
</page_fills_needed>

<bookmark_fills_needed>
这些网页在ta的收藏夹里，请为每个生成完整的网页内容（同上）：
${bookmarkFillsBlock}
</bookmark_fills_needed>

<search_fills_needed>
这些搜索关键词在ta的搜索记录里，请为每个生成 5-8 条搜索结果列表：
${searchFillsBlock}
</search_fills_needed>

<style_flavor>
- 小红书（xhs）：博主第一人称、"姐妹们""家人们"、emoji 多、段落短
- 知乎（zhihu）：回答者口吻、论据/经历/类比、段落较长、有逻辑推进感
- B站（bilibili）：up 主自称、视频内容简介、三连提示
- 通用（generic）：正经文章笔法，有小标题，信息密度均衡
</style_flavor>

<content_guidelines>
- pageFills / bookmarkFills 里每一条按其 style 给出符合平台调性的正文
- 社交平台（xhs/bilibili）给 author 和 interactions（数字范围自然，不要全是 999999）
- 通用 / 知乎可以不给 interactions
- 搜索结果的 source 混合不同平台，不要全是同一个来源
- 可以额外给 newRecentPages / newBookmarks / newSearches 各 0-2 条新条目，反映 ${charName} 最近的新兴趣；新条目要附带各自的 content/results
- url 不要随便编一段，要符合所选 source 的形态
</content_guidelines>

<output_format>
返回严格 JSON 对象，不要 markdown 包裹、不要解释文字：
{
  "pageFills": [
    {
      "url": "string (匹配 page_fills_needed 中给出的 url)",
      "style": "xhs|zhihu|bilibili|generic",
      "content": {
        "title": "string",
        "author": "string (可空)",
        "content": "string (正文，可多段，用 \\n 分隔)",
        "interactions": { "likes": number, "comments": number, "collects": number }
      }
    }
  ],
  "bookmarkFills": [
    {
      "url": "string (匹配 bookmark_fills_needed 中给出的 url)",
      "style": "xhs|zhihu|bilibili|generic",
      "content": { "title": "string", "author": "string", "content": "string", "interactions": { ... } }
    }
  ],
  "searchFills": [
    {
      "query": "string (匹配 search_fills_needed 中给出的 query)",
      "results": [
        { "title": "string", "url": "string", "snippet": "string", "source": "string" }
      ]
    }
  ],
  "newRecentPages": [
    {
      "title": "string",
      "url": "string",
      "timestamp": "ISO 时间",
      "style": "xhs|zhihu|bilibili|generic",
      "content": { "title": "string", "author": "string", "content": "string", "interactions": { ... } }
    }
  ],
  "newBookmarks": [
    {
      "title": "string",
      "url": "string",
      "style": "xhs|zhihu|bilibili|generic",
      "content": { "title": "string", "author": "string", "content": "string", "interactions": { ... } }
    }
  ],
  "newSearches": [
    {
      "query": "string",
      "timestamp": "ISO 时间",
      "results": [ { "title": "string", "url": "string", "snippet": "string", "source": "string" } ]
    }
  ]
}
任何一段为空时仍要返回空数组，不要省略字段。
</output_format>`;

    const userPrompt = `请按上面的协议返回 ${charName} 浏览器的批量刷新结果 JSON。
six 个字段都要给出（即使是空数组）。`;

    return { systemPrompt, userPrompt };
}

/**
 * Notes incremental prompt. Generates 3-5 new note entries to append to
 * the existing list. Existing notes are passed as anchoring context so
 * the LLM doesn't repeat their topics.
 *
 * @param {object} ctx
 * @param {{name:string, description:string}|null} ctx.charInfo
 * @param {string} ctx.userName
 * @param {string} ctx.userPersona
 * @param {string} ctx.worldBookText
 * @param {string} ctx.recentChatSummary
 * @param {Array<{title?:string, body:string, timestamp:string}>} ctx.existingNotes
 */
export function buildNotesBatchPrompt(ctx) {
    const charName = ctx.charInfo?.name || 'ta';
    const userName = ctx.userName || '你';
    const charDesc = ctx.charInfo?.description || '';
    const userPersona = ctx.userPersona || '';
    const worldBookText = ctx.worldBookText || '';
    const recentChatSummary = ctx.recentChatSummary || '';
    const existingNotes = Array.isArray(ctx.existingNotes) ? ctx.existingNotes : [];

    const existingBlock = existingNotes.length === 0 ? '（暂无）' : existingNotes.slice(-8).map((n, i) => {
        const title = (n.title || '').trim();
        const body = (n.body || '').trim();
        const preview = body.length > 60 ? body.slice(0, 60) + '…' : body;
        return `  ${i + 1}. ${title ? `[${title}] ` : ''}${preview}`;
    }).join('\n');

    const foundation = getCoreFoundationPrompt();

    const systemPrompt = `${foundation}

<task_framing>
${charName} 又在备忘录里写下了几段新东西。请生成 3-5 条新的备忘录条目，叠加到已有列表上。
- 视角：始终以 ${charName} 的第一人称
- 私密、随意、带着ta真实的情绪和性格
- 不要重复已有备忘录的话题
</task_framing>

<char_profile>
角色名: ${charName}
${charDesc || '(没有更多角色设定，请根据世界观和最近对话推断)'}
</char_profile>

<user_persona>
用户名: ${userName}
${userPersona || `(用户没有填 persona，请把ta当作 ${charName} 的恋人)`}
</user_persona>

${worldBookText ? `<world_info>\n${worldBookText}\n</world_info>\n` : ''}
${recentChatSummary ? `<recent_chat>\n最近ta和 ${userName} 的对话片段：\n${recentChatSummary}\n</recent_chat>\n` : ''}

<existing_notes>
ta 现在备忘录里已经有的内容（请避免重复话题）：
${existingBlock}
</existing_notes>

<content_guidelines>
- 3-5 条新备忘录
- 内容范围：想对 ${userName} 说但没说出口的话、半夜的胡思乱想、给自己的提醒、突然冒出来的想法、几行小诗、明天要做的事
- 越私密越好，能透出ta内心真实状态
- 不要复读已有备忘录里出现过的主题
- timestamp 在已有备忘录之后
</content_guidelines>

<output_format>
返回严格 JSON 数组，不要 markdown 包裹、不要解释文字：
[
  { "title": "string (可空)", "body": "string", "tags": ["string"], "timestamp": "ISO 时间" }
]
</output_format>`;

    const userPrompt = `请按上面的协议返回 ${charName} 新增的 3-5 条备忘录 JSON 数组。`;

    return { systemPrompt, userPrompt };
}

/**
 * Album "reseed" prompt. Used by refreshAlbum() when the album was just
 * wiped (existingAlbum.length === 0) so the user can re-bootstrap the
 * full categorized set from the same ⟳ button. Mirrors the album section
 * of buildInitialGenerationPrompt (4-8 entries, mandatory 2-3 custom
 * albums, at least one selfie/screenshot/video) — keeps the "fresh start"
 * semantics separated from the "append a few more" semantics of
 * buildAlbumBatchPrompt so the LLM doesn't have to disambiguate.
 *
 * @param {object} ctx
 * @param {{name:string, description:string}|null} ctx.charInfo
 * @param {string} ctx.userName
 * @param {string} ctx.userPersona
 * @param {string} ctx.worldBookText
 * @param {string} ctx.recentChatSummary
 */
export function buildAlbumInitialPrompt(ctx) {
    const charName = ctx.charInfo?.name || 'ta';
    const userName = ctx.userName || '你';
    const charDesc = ctx.charInfo?.description || '';
    const userPersona = ctx.userPersona || '';
    const worldBookText = ctx.worldBookText || '';
    const recentChatSummary = ctx.recentChatSummary || '';

    const foundation = getCoreFoundationPrompt();

    const systemPrompt = `${foundation}

<task_framing>
为 ${charName} 一次生成一整套相册条目，体现ta作为一个完整的人在镜头前后留下的真实痕迹。
- 视角：始终以 ${charName} 的第一人称，写ta真的会拍、会截、会录的瞬间
- 私密、随意，带着ta自己的情绪和性格
</task_framing>

<char_profile>
角色名: ${charName}
${charDesc || '(没有更多角色设定，请根据世界观和最近对话推断ta的性格)'}
</char_profile>

<user_persona>
用户名: ${userName}
${userPersona || `(用户没有填 persona，请把ta当作 ${charName} 的恋人)`}
</user_persona>

${worldBookText ? `<world_info>\n${worldBookText}\n</world_info>\n` : ''}
${recentChatSummary ? `<recent_chat>\n最近ta和 ${userName} 的对话片段：\n${recentChatSummary}\n</recent_chat>\n` : ''}

<content_guidelines>
- 4-8 条相册条目，纯文字描述（不需要图片，因此 visualDescription 是这一项的灵魂字段）
- 每条带 title / visualDescription / description / tags / timestamp / **albumName** / location / duration?

**albumName 是必填字段**，从下面三种里选一种：
- **预定义类型（精确字符串）**："自拍" / "截屏" / "视频"——必须用这三个中文词原样精确匹配，不要写成"自拍照"/"Selfies"/"screenshot"/"短视频"等任何变体
- **ta自己创建的 custom 相册名**：2-6 字短名，不要和预定义那三个名字重复
- **空字符串 ""**：普通照片，没有特别归属

**整体要求（打底必须满足）：**
- 整个 album 数组里**必须创建 2-3 个 custom 相册名**，每个 custom 相册下至少 1 张图
- 至少有 1 张归到"自拍"、1 张归到"截屏"、1 张归到"视频"（如果总数够分）
- 其余可以是普通照片（albumName=""）

**不同类型的 visualDescription 要按类型化撰写：**
- **自拍**：写ta在镜头里的样子——角度、表情、背景、光线、发型细节、表情微动，是无意间不小心拍到的？还是有意自拍？例如「正面镜头，她的脸占满画面右半边，左半边漏出蓝白条纹的浴帘。眼睛微眯，没笑，刚睡醒的样子。逆光，发丝周围有一圈白噪。」
- **截屏**：写屏幕上**显示的内容**（什么 App、谁的对话、文字本身、时间戳、状态栏），**不要写"她在截屏"这种动作描述**。例如「屏幕上是某人的微信对话，最上面一条是凌晨 2:14 发的「你睡了吗」，气泡灰色。下面她回了一个「。」。状态栏电量 12%，时间 02:18。」
- **视频**：写一段连续画面（镜头怎么动、画面里发生了什么、有没有声音/对话）。例如「镜头从地板上的鞋子缓缓抬起，扫过她的腿，最后停在窗外飘雨的天空。中途她哼了一句「冷死了」，画面晃了一下。」**视频条目必须额外带 duration 字段：3-180 秒之间的整数**
- **普通照片 / custom 相册下的照片**：保持 60-140 字客观画面描述（光线、颜色、构图、主体、背景），不掺ta的情绪

- **title**：4-10 字短标题，像ta自己给这张图起的小名（如"今天的天"/"楼下那只"/"妈做的"）
- **description**：20-50 字，ta按下快门时的小心情、为什么拍、当下脑里飘过的一句话，带个人语气（这里才是情绪出口）
- **tags**：3-6 个短标签
- **location**：2-15 字的自然语言地点描述，写ta在哪里按下快门的（如"卧室飘窗"/"楼下小公园"/"公司茶水间"/"地铁2号线"/"妈家厨房"）。**不要写 GPS 坐标、不要写完整地址**，要像ta自己回忆"这是在哪拍的"那样口语化。截屏（albumName="截屏"）的 location 留空字符串 ""，其她类型都要给一个具体地点
- **timestamp**：完整 ISO 8601 格式，**必须含年月日**（如 '2024-08-15T14:30:00'，**不要只写 '08-15' 这种缺年份的形式**）。**时间跨度鼓励大**——ta 不是刚买的手机，相册里不会只有最近几天的照片，请适当混入几个月前、半年前、一年甚至两三年前的老照片，体现ta真实的拍照历史
- 题材范围：天空、食物、宠物、路边小景、自己的手、自拍、屏幕截图、短视频、日落、雨后窗户、电影票根等真实会被拍下的瞬间
</content_guidelines>

<output_format>
返回严格 JSON 数组，不要 markdown 包裹、不要解释文字：
[
  {
    "title": "string",
    "visualDescription": "string (60-140 字；自拍/截屏/视频按上文类型化撰写)",
    "description": "string (20-50 字，拍下时的小心情)",
    "tags": ["string"],
    "timestamp": "ISO 时间",
    "albumName": "string (\"自拍\" / \"截屏\" / \"视频\" / custom 相册名 / 空字符串)",
    "location": "string (2-15 字地点；截屏留 \"\")",
    "duration": 30
  }
]
duration 字段**仅 albumName=\"视频\" 的条目带**（3-180 整数秒），其她类型省略该字段。location 字段所有条目都要给——截屏类型给空字符串，其她类型给具体地点描述。
</output_format>`;

    const userPrompt = `请按上面的协议返回 ${charName} 全新一套相册条目 JSON 数组（4-8 条，含必要的 custom 相册和自拍/截屏/视频分类）。`;

    return { systemPrompt, userPrompt };
}

/**
 * Album incremental prompt. Generates 3-5 new album entries.
 *
 * @param {object} ctx
 * @param {{name:string, description:string}|null} ctx.charInfo
 * @param {string} ctx.userName
 * @param {string} ctx.userPersona
 * @param {string} ctx.worldBookText
 * @param {string} ctx.recentChatSummary
 * @param {Array<{title?:string, description?:string, timestamp:string}>} ctx.existingAlbum
 * @param {string[]} [ctx.existingCustomAlbums] - deduped custom album names already in use
 */
export function buildAlbumBatchPrompt(ctx) {
    const charName = ctx.charInfo?.name || 'ta';
    const userName = ctx.userName || '你';
    const charDesc = ctx.charInfo?.description || '';
    const userPersona = ctx.userPersona || '';
    const worldBookText = ctx.worldBookText || '';
    const recentChatSummary = ctx.recentChatSummary || '';
    const existingAlbum = Array.isArray(ctx.existingAlbum) ? ctx.existingAlbum : [];
    const existingCustomAlbums = Array.isArray(ctx.existingCustomAlbums) ? ctx.existingCustomAlbums : [];

    const existingBlock = existingAlbum.length === 0 ? '（暂无）' : existingAlbum.slice(-8).map((p, i) => {
        const title = (p.title || '').trim();
        const desc = (p.description || '').trim();
        const preview = desc.length > 50 ? desc.slice(0, 50) + '…' : desc;
        return `  ${i + 1}. ${title ? `[${title}] ` : ''}${preview}`;
    }).join('\n');
    const existingCustomBlock = existingCustomAlbums.length === 0
        ? '（暂无 custom 相册，可以新建 1 个）'
        : existingCustomAlbums.map(n => `"${n}"`).join('、');

    const foundation = getCoreFoundationPrompt();

    const systemPrompt = `${foundation}

<task_framing>
${charName} 这段时间又拍了一些新东西。请生成 3-5 条新的相册条目，叠加到已有相册上。
- 视角：始终以 ${charName} 的第一人称，写ta真的会拍的瞬间
- 描述是ta按下快门时的小心情，不是给别人讲解
- 不要重复已有相册里出现过的题材
</task_framing>

<char_profile>
角色名: ${charName}
${charDesc || '(没有更多角色设定，请根据世界观和最近对话推断)'}
</char_profile>

<user_persona>
用户名: ${userName}
${userPersona || `(用户没有填 persona，请把ta当作 ${charName} 的恋人)`}
</user_persona>

${worldBookText ? `<world_info>\n${worldBookText}\n</world_info>\n` : ''}
${recentChatSummary ? `<recent_chat>\n最近ta和 ${userName} 的对话片段：\n${recentChatSummary}\n</recent_chat>\n` : ''}

<existing_album>
ta 相册里已经有的内容（请避免重复题材）：
${existingBlock}
</existing_album>

<existing_custom_albums>
ta 现有的 custom 相册名（你之前创建过的）：${existingCustomBlock}
</existing_custom_albums>

<content_guidelines>
- 3-5 条新相册条目，纯文字描述（不需要图片，因此 visualDescription 是这一项的灵魂字段）
- 每条带 title / visualDescription / description / tags / timestamp / **albumName** / location / duration?
- **title**：4-10 字短标题，像ta给这张图起的小名
- **description**：20-50 字ta按下快门时的小心情、当下飘过的一句话，带个人语气
- **tags**：3-6 个短标签
- **location**：2-15 字的自然语言地点描述，写ta在哪里按下快门的（如"卧室飘窗"/"楼下小公园"/"公司茶水间"/"地铁2号线"）。**不要写 GPS 坐标、不要写完整地址**，要像ta自己回忆"这是在哪拍的"那样口语化。截屏（albumName="截屏"）的 location 留空字符串 ""，其她类型都要给一个具体地点
- **timestamp**：完整 ISO 8601 格式，**必须含年月日**（如 '2024-08-15T14:30:00'，**不要只写 '08-15' 这种缺年份的形式**），且**严格晚于已有相册的最后一条时间戳**
- 题材范围：天空、食物、宠物、路边小景、自己的手、自拍、屏幕截图、短视频、日落、雨后窗户、地铁、电影票根等真实会被拍下的瞬间

**albumName 是必填字段**，从下面三种里选一种：
- **预定义类型（精确字符串）**："自拍" / "截屏" / "视频"——必须用这三个中文词原样精确匹配，不要写成"自拍照"/"Selfies"/"screenshot"/"短视频"等变体。这三个是固定的，**不允许新增同类预定义**
- **现有 custom 相册名**：优先把新图归到 <existing_custom_albums> 里已有的名字下
- **新增 custom 相册名**：**至多再新增 1 个**新的 custom 相册名（2-6 字短名，不要和现有 custom 名 / 预定义三个名 重复）
- **空字符串 ""**：普通照片，没有特别归属

**不同类型的 visualDescription 要按类型化撰写：**
- **自拍**：写她在镜头里的样子——角度、表情、背景、光线、发型、表情细节
- **截屏**：写屏幕上**显示的内容**（什么 App、谁的对话、文字本身、时间戳、状态栏），不要写"她在截屏"这种动作描述
- **视频**：写一段连续画面（镜头怎么动、画面里发生了什么、有没有声音/对话）；**视频条目必须额外带 duration 字段：3-180 秒之间的整数**
- **普通照片 / custom 相册下的照片**：保持 60-140 字客观画面描述（光线、颜色、构图、主体、背景），不掺ta的情绪
</content_guidelines>

<output_format>
返回严格 JSON 数组，不要 markdown 包裹、不要解释文字：
[
  {
    "title": "string",
    "visualDescription": "string (60-140 字；自拍/截屏/视频按上文类型化撰写)",
    "description": "string (20-50 字，拍下时的小心情)",
    "tags": ["string"],
    "timestamp": "ISO 时间",
    "albumName": "string (\"自拍\" / \"截屏\" / \"视频\" / custom 相册名 / 空字符串)",
    "location": "string (2-15 字地点；截屏留 \"\")",
    "duration": 30
  }
]
duration 字段**仅 albumName=\"视频\" 的条目带**（3-180 整数秒），其她类型省略该字段。location 字段所有条目都要给——截屏类型给空字符串，其她类型给具体地点描述。
</output_format>`;

    const userPrompt = `请按上面的协议返回 ${charName} 新增的 3-5 条相册条目 JSON 数组。`;

    return { systemPrompt, userPrompt };
}
