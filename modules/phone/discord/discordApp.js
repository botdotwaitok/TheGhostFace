// modules/phone/discord/discordApp.js — Discord Community App Entry
// Handles: initialization flow, server home page, channel list rendering, navigation.

import { openAppInViewport } from '../phoneController.js';
import { getPhoneCharInfo, getPhoneUserName, getPhoneWorldBookContext, getCoreFoundationPrompt } from '../phoneContext.js';
import { callPhoneLLM } from '../../api.js';
import { cleanLlmJson } from '../utils/llmJsonCleaner.js';
import { escapeHtml } from '../utils/helpers.js';
import {
    isServerInitialized, loadServerConfig, saveServerConfig,
    loadMembers, loadRoles, getLastMessage, getMemberColor,
    initDefaultServer, initFromLLMResult, getAllChannels,
    appendMessage, generateId, getChannelPermissions,
} from './discordStorage.js';
import { openServerSettings } from './discordServerSettings.js';
import { openChannel as openChannelView } from './discordChannel.js';
import { startAutoChatTimer, isTimerRunning, getUnreadCount, markChannelRead } from './discordAutoChat.js';

const LOG = '[Discord]';

// ═══════════════════════════════════════════════════════════════════════
// Entry Point
// ═══════════════════════════════════════════════════════════════════════

/**
 * Open the Discord Community App.
 * Called by phoneController when user taps the app icon.
 */
export function openDiscordApp() {
    if (!isServerInitialized()) {
        _showInitPage();
    } else {
        // Start auto-chat timer only if not already running
        if (!isTimerRunning()) {
            startAutoChatTimer();
        }
        _showServerHome();
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Initialization Page — First Run
// ═══════════════════════════════════════════════════════════════════════

function _showInitPage() {
    const html = `
        <div class="dc-init-page dc-fade-in" id="dc_init_page">
            <div class="dc-init-icon">
                <i class="ph ph-discord-logo"></i>
            </div>
            <div class="dc-init-title">创建你的社区</div>
            <div class="dc-init-subtitle">
                和你对象一起管理一个 Discord 社区，<br>
                添加成员，建设频道，群聊互动！
            </div>
            <div class="dc-init-options">
                <div class="dc-init-option" id="dc_init_llm">
                    <div class="dc-init-option-icon llm">
                        <i class="ph ph-sparkle"></i>
                    </div>
                    <div class="dc-init-option-text">
                        <div class="dc-init-option-title">自动创建</div>
                        <div class="dc-init-option-desc">
                            根据世界观和设定，自动生成服务器名、频道、成员和身份组
                        </div>
                    </div>
                </div>
                <div class="dc-init-option" id="dc_init_manual">
                    <div class="dc-init-option-icon manual">
                        <i class="ph ph-wrench"></i>
                    </div>
                    <div class="dc-init-option-text">
                        <div class="dc-init-option-title">手动创建</div>
                        <div class="dc-init-option-desc">
                            自定义服务器名，手动添加频道和成员
                        </div>
                    </div>
                </div>
            </div>
            <div class="dc-init-footer">
                无论选择哪种方式，之后都可以在服务器设置中随时修改
            </div>
        </div>
    `;

    const titleHtml = `<span style="font-weight:600;">社区</span>`;

    openAppInViewport(titleHtml, html, () => {
        document.getElementById('dc_init_llm')?.addEventListener('click', _handleLLMInit);
        document.getElementById('dc_init_manual')?.addEventListener('click', _handleManualInit);
    });
}

// ─── Manual Init ───

function _handleManualInit() {
    initDefaultServer();
    _showServerHome();
}

// ─── LLM Init ───

async function _handleLLMInit() {
    const page = document.getElementById('dc_init_page');
    if (!page) return;

    // Show loading state
    page.innerHTML = `
        <div class="dc-init-loading dc-fade-in">
            <div class="dc-init-spinner"></div>
            <div class="dc-init-loading-text">正在根据设定生成社区配置...</div>
            <div class="dc-init-loading-text" style="font-size:12px; color:var(--dc-text-muted); margin-top:4px;">
                这可能需要一些时间
            </div>
        </div>
    `;

    try {
        const result = await _generateServerWithLLM();
        if (result) {
            const config = initFromLLMResult(result);
            _seedInitialMessages(result, config);
            _showServerHome();
        } else {
            // Fallback to manual if LLM fails
            _showInitError('生成失败，已使用默认配置创建服务器');
            initDefaultServer();
            setTimeout(() => _showServerHome(), 1500);
        }
    } catch (e) {
        console.error(`${LOG} LLM init failed:`, e);
        _showInitError(`生成失败: ${e.message}`);
        initDefaultServer();
        setTimeout(() => _showServerHome(), 2000);
    }
}

function _showInitError(msg) {
    const page = document.getElementById('dc_init_page');
    if (!page) return;
    page.innerHTML = `
        <div class="dc-init-loading dc-fade-in">
            <div style="font-size:32px; margin-bottom:12px;">
                <i class="ph ph-warning-circle" style="color:var(--dc-yellow);"></i>
            </div>
            <div class="dc-init-loading-text">${escapeHtml(msg)}</div>
        </div>
    `;
}

/**
 * Seed rules, announcement, and channel history messages.
 * Called after LLM init to populate channels with realistic content.
 */
function _seedInitialMessages(llmResult, config) {
    const charInfo = getPhoneCharInfo();
    const charName = charInfo?.name || '角色';
    const channels = getAllChannels();
    const members = loadMembers();

    // Helper: find a channel by fuzzy name match
    const findChannel = (...keywords) => {
        const lower = keywords.map(k => k.toLowerCase());
        return channels.find(ch => {
            const name = ch.name.toLowerCase();
            return lower.some(kw => name.includes(kw));
        });
    };

    // Helper: resolve member name → memberId
    const resolveMemberId = (authorName) => {
        const found = members.find(m =>
            m.name === authorName || m.name.toLowerCase() === authorName?.toLowerCase(),
        );
        return found?.id || 'member_char';
    };

    // ── Seed rules ──
    if (llmResult.rules) {
        const rulesChannel = findChannel('规则', 'rules', 'rule');
        if (rulesChannel) {
            appendMessage(rulesChannel.id, {
                id: generateId('msg'),
                channelId: rulesChannel.id,
                authorId: 'member_char',
                authorName: charName,
                content: llmResult.rules,
                timestamp: new Date(Date.now() - 24 * 60 * 60000).toISOString(),
                reactions: [],
                mentions: [],
                replyTo: null,
                summarized: false,
                pinned: true,
            });
            console.log(`${LOG} Seeded rules in #${rulesChannel.name}`);
        }
    }

    // ── Seed announcement ──
    if (llmResult.announcement) {
        const announceChannel = findChannel('公告', 'announce', 'welcome', '欢迎');
        if (announceChannel) {
            appendMessage(announceChannel.id, {
                id: generateId('msg'),
                channelId: announceChannel.id,
                authorId: 'member_char',
                authorName: charName,
                content: llmResult.announcement,
                timestamp: new Date(Date.now() - 24 * 60 * 60000).toISOString(),
                reactions: [],
                mentions: [],
                replyTo: null,
                summarized: false,
                pinned: true,
            });
            console.log(`${LOG} Seeded announcement in #${announceChannel.name}`);
        }
    }

    // ── Seed channel history ──
    if (Array.isArray(llmResult.channelHistory)) {
        for (const chHistory of llmResult.channelHistory) {
            if (!chHistory?.channelName || !Array.isArray(chHistory.messages)) continue;

            // Match channel by name
            const channel = channels.find(ch =>
                ch.name.toLowerCase() === chHistory.channelName.toLowerCase(),
            );
            if (!channel) {
                console.warn(`${LOG} Channel history: no match for "${chHistory.channelName}", skipping`);
                continue;
            }

            let seeded = 0;
            for (const histMsg of chHistory.messages) {
                if (!histMsg?.content) continue;
                const authorId = resolveMemberId(histMsg.authorName);
                const authorName = histMsg.authorName || charName;
                const minutesAgo = Math.max(1, Number(histMsg.minutesAgo) || 60);

                appendMessage(channel.id, {
                    id: generateId('msg'),
                    channelId: channel.id,
                    authorId,
                    authorName,
                    content: histMsg.content,
                    timestamp: new Date(Date.now() - minutesAgo * 60000).toISOString(),
                    reactions: [],
                    mentions: [],
                    replyTo: null,
                    summarized: false,
                });
                seeded++;
            }
            if (seeded > 0) {
                console.log(`${LOG} Seeded ${seeded} history messages in #${channel.name}`);
            }
        }
    }
}

/**
 * Call LLM to generate a complete server configuration.
 * @returns {Object|null} Parsed JSON result
 */
async function _generateServerWithLLM() {
    const charInfo = getPhoneCharInfo();
    const charName = charInfo?.name || '角色';
    const userName = getPhoneUserName();
    const charDesc = charInfo?.description || '';

    // Get world book context for richer generation (no chat dependency — pure character/world data)
    const worldBookText = await getPhoneWorldBookContext();

    const hasWorldInfo = !!(charDesc || worldBookText);

    const systemPrompt = `${getCoreFoundationPrompt()}

假设 ${charName} 是一个 Discord 社区的 Owner（服务器主）。
请基于 ${charName} 的性格、兴趣爱好、职业或世界观背景，构建出属于ta的这个服务器的完整细节。

核心定位：
把这个 DC 服务器当成一个**长期运营的兴趣爱好社区**。
- 服务器应有明确的主题和社区文化
- 频道设计应该模拟一个真实的、有活跃用户的 Discord 服务器
- 成员应该是这个兴趣社区中自然存在的人物（可以是世界观设定中的人，也可以是原创的社区常客）
- ${userName} 是 ${charName} 的恋人，同时也是服务器的管理员
- 【核心红线】如果背景设定里没有合适的原始角色，则以强壮聪明的原创女性角色为主，绝对禁止代入常规的父权视角或生成典型男性化形象（如称兄道弟的“老哥”、“哥们”等）。

社交关系定位：
- 所有成员之间是**网友/群友**关系——他们通过这个线上社区认识，不是现实中的朋友
- 成员们不了解 ${userName} 的现实生活细节（住哪里、家什么样、日常作息等），除非 ${userName} 在群里主动分享过
- 每个成员都有**自己独立的生活、兴趣和社交圈**，不围着 ${userName} 打转
- 成员加入社区的理由是对社区主题感兴趣，不是因为 ${userName}
- 成员之间会形成独立于 ${userName} 的社交互动（比如两个群友互怼、几个人组队讨论话题等）

要求：
1. 服务器名要简洁、有辨识度，贴合主题（像真实 DC 服务器名那样）
2. 频道分类和频道名要模拟真实 Discord 社区（如 "公告" / "闲聊" / "话题" 等）
3. 必须包含一个 "规则" 频道和一个 "公告" 频道
4. 每个频道必须有一个 topic 字段，简要描述该频道的主题方向（如“分享游戏截图和战绩”“日常闲聊吐槽”“分享美食和吃吃喝喝”等），这将帮助成员们在对应频道聊相关话题
5. 每个成员的 personality 字段保持简洁：3-5 句话概括说话风格和性格特点（只描述群聊中的表现，不涉及私生活）
6. 身份组要符合社区定位（如 管理组/活跃成员/新人 等）
7. 使用世界观中的语言/风格来命名一切
8. 生成的 rules（社区规则）应该使用 Discord Markdown 排版——用 **加粗** 标记规则标题，用列表格式分条，至少十条规则，模拟 ${charName} 的语气
9. 生成一条公告/欢迎消息，使用 Discord Markdown 排版（标题、加粗、列表等），模拟服务器主 ${charName} 的语气和说话风格
10. 为每个**非规则/非公告**频道生成 5-10 条历史聊天消息（channelHistory），让服务器看起来已经有一段时间的活跃讨论

channelHistory 规则：
- 每条消息的 authorName 必须是 members 数组中的成员名字
- 消息内容必须符合该频道的主题（闲聊频道是日常聊天，话题频道是相关讨论等）
- 可以使用 Discord Markdown 语法（加粗、斜体、引用、代码块等）来丰富消息
- minutesAgo 表示该消息发生在多少分钟前，数组中的消息应该从大到小排列（越早的消息 minutesAgo 越大）
- 消息风格要短小自然，像真实的 Discord 群聊（1-3句话，碎片化，有聊天主题，有互动）
- 不同成员之间应该有对话互动，不要只是独白——尤其是成员间的对话，不要总是围着管理员说话
- 规则和公告频道**不要**生成历史消息

${!hasWorldInfo ? '⚠️ 注意：当前没有可用的世界设定信息，请根据角色名和你的创意进行合理创作。' : ''}

输出严格的 JSON 格式（不要 markdown 代码块）：
{
  "serverName": "服务器名称",
  "serverDescription": "服务器描述（一句话简介）",
  "categories": [
    {
      "name": "分类名（根据${charName} 的性格决定，允许带 emoji）",
      "channels": [
        { "name": "频道名", "topic": "简短描述该频道的主题方向，如‘分享日常生活、吃吃喝喝玩玩’" }
      ]
    }
  ],
  "roles": [
    { "name": "身份组名", "color": "#hex颜色" }
  ],
  "members": [
    {
      "name": "成员名",
      "bio": "简短的个性签名或当前状态",
      "personality": "3-5句性格和说话风格描述",
      "roles": ["对应的身份组名"]
    }
  ],
  "rules": "服务器规则文本（使用 Discord Markdown 排版）",
  "announcement": "公告/欢迎消息文本（使用 Discord Markdown 排版，模拟 ${charName} 的语气）",
  "channelHistory": [
    {
      "channelName": "频道名（必须与 categories 中的频道名完全一致）",
      "messages": [
        { "authorName": "成员名", "content": "消息内容", "minutesAgo": 120 },
        { "authorName": "另一个成员名", "content": "回复内容", "minutesAgo": 118 }
      ]
    }
  ]
}

生成 3-4 个分类，每个分类有 2-3 个频道。
生成 3-5 个身份组。
生成 5-8 个社区成员（不要包含 ${charName} 和 ${userName}）。`;

    let userPrompt = `请为以下角色创建 Discord 社区服务器：\n\n`;
    userPrompt += `角色名（服务器主）: ${charName}\n`;
    userPrompt += `用户名（恋人 + 管理员）: ${userName}\n\n`;

    if (charDesc) {
        userPrompt += `角色设定：\n${charDesc.substring(0, 2000)}\n\n`;
    }
    if (worldBookText) {
        userPrompt += `世界观设定：\n${worldBookText.substring(0, 3000)}\n\n`;
    }

    if (!hasWorldInfo) {
        userPrompt += `（没有找到角色设定和世界书信息，请发挥创意，把角色想象成某个兴趣爱好领域的社区经营者。）\n\n`;
    }

    userPrompt += `请生成完整的 JSON 配置。记得包含 rules、announcement 和 channelHistory 字段。每个非规则/非公告频道都要有 5-10 条历史消息。`;

    console.log(`${LOG} Generating server with LLM...`);
    const rawResponse = await callPhoneLLM(systemPrompt, userPrompt, { maxTokens: 6000 });

    try {
        const cleaned = cleanLlmJson(rawResponse);
        const parsed = JSON.parse(cleaned);
        console.log(`${LOG} LLM server config parsed:`, parsed);
        return parsed;
    } catch (e) {
        console.error(`${LOG} Failed to parse LLM response:`, e);
        console.error(`${LOG} Raw response:`, rawResponse);
        return null;
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Server Home Page — Channel List
// ═══════════════════════════════════════════════════════════════════════

function _showServerHome() {
    const config = loadServerConfig();
    if (!config) {
        console.error(`${LOG} No server config found`);
        return;
    }

    const html = _buildServerHomeHtml(config);

    const titleHtml = `
        <div class="dc-server-header-inline" id="dc_server_header_btn">
            <span class="dc-server-name-inline">${escapeHtml(config.name)}</span>
            <i class="ph ph-caret-down dc-chevron-inline"></i>
        </div>`;

    openAppInViewport(titleHtml, html, () => {
        _bindServerHomeEvents(config);
    });
}

function _buildServerHomeHtml(config) {
    const categories = config.categories || [];

    if (categories.length === 0) {
        return `
            <div class="dc-server-page">
                <div class="dc-empty">
                    <div class="dc-empty-icon"><i class="ph ph-chat-dots"></i></div>
                    <div class="dc-empty-text">还没有任何频道<br>在服务器设置中添加分类和频道</div>
                </div>
            </div>
        `;
    }

    const channelListHtml = categories.map(cat => _buildCategoryHtml(cat)).join('');

    const bannerHtml = config.banner ? `
        <div class="dc-server-banner">
            <img src="${config.banner}" alt="Banner" />
        </div>
    ` : '';

    return `
        <div class="dc-server-page dc-fade-in" id="dc_server_page">
            ${bannerHtml}
            <div class="dc-channel-list" id="dc_channel_list">
                ${channelListHtml}
            </div>
        </div>
    `;
}

function _buildCategoryHtml(category) {
    const channelsHtml = (category.channels || [])
        .map(ch => _buildChannelItemHtml(ch))
        .join('');

    return `
        <div class="dc-category" data-cat-id="${category.id}">
            <div class="dc-category-header" data-cat-id="${category.id}">
                <div class="dc-category-arrow">
                    <i class="ph ph-caret-down"></i>
                </div>
                <div class="dc-category-name">${escapeHtml(category.name)}</div>
            </div>
            <div class="dc-category-channels">
                ${channelsHtml}
            </div>
        </div>
    `;
}

function _buildChannelItemHtml(channel) {
    const unread = getUnreadCount(channel.id);
    const unreadHtml = unread > 0
        ? `<div class="dc-channel-unread">${unread > 99 ? '99+' : unread}</div>`
        : '';

    // Show lock icon if channel has permissions set
    const perms = getChannelPermissions(channel.id);
    const lockIcon = perms.length > 0
        ? '<i class="ph ph-lock-simple dc-channel-lock"></i>'
        : '';

    // Show channel topic if available
    const topicHtml = channel.topic
        ? `<div class="dc-channel-topic-hint">${escapeHtml(channel.topic)}</div>`
        : '';

    return `
        <div class="dc-channel-item${unread > 0 ? ' dc-channel-unread-item' : ''}" data-channel-id="${channel.id}" data-channel-name="${escapeHtml(channel.name)}">
            <span class="dc-channel-hash">#</span>
            <div class="dc-channel-info">
                <div class="dc-channel-name">${escapeHtml(channel.name)}${lockIcon}</div>
                ${topicHtml}
            </div>
            ${unreadHtml}
        </div>
    `;
}


// ═══════════════════════════════════════════════════════════════════════
// Server Home Events
// ═══════════════════════════════════════════════════════════════════════

function _bindServerHomeEvents(config) {
    // ── Server header click → server settings ──
    document.getElementById('dc_server_header_btn')?.addEventListener('click', () => {
        openServerSettings(() => _showServerHome());
    });

    // ── Category collapse/expand ──
    document.querySelectorAll('.dc-category-header').forEach(header => {
        header.addEventListener('click', () => {
            const catEl = header.closest('.dc-category');
            if (catEl) catEl.classList.toggle('collapsed');
        });
    });

    // ── Channel click → open channel ──
    document.querySelectorAll('.dc-channel-item').forEach(item => {
        item.addEventListener('click', () => {
            const channelId = item.dataset.channelId;
            const channelName = item.dataset.channelName;
            if (channelId) {
                _openChannel(channelId, channelName);
            }
        });
    });
}

// ═══════════════════════════════════════════════════════════════════════
// Channel View → delegates to discordChannel.js (Phase 4)
// ═══════════════════════════════════════════════════════════════════════

function _openChannel(channelId, channelName) {
    // Mark channel as read when user opens it
    markChannelRead(channelId);
    openChannelView(channelId, channelName, () => _showServerHome());
}

// ═══════════════════════════════════════════════════════════════════════
// CSS Injection (header inline styles)
// ═══════════════════════════════════════════════════════════════════════

// Inline styles for the compressed header (since it's inside viewport title area)
const _headerStyle = document.createElement('style');
_headerStyle.textContent = `
    .dc-server-header-inline {
        display: flex;
        align-items: center;
        gap: 8px;
        cursor: pointer;
        user-select: none;
        max-width: 100%;
        min-width: 0;
    }
    .dc-server-name-inline {
        font-weight: 600;
        font-size: 15px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        min-width: 0;
    }
    .dc-chevron-inline {
        font-size: 12px;
        color: var(--dc-text-secondary, #949ba4);
        flex-shrink: 0;
    }
`;
document.head.appendChild(_headerStyle);
