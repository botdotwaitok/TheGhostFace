// modules/phone/chat/chatHtmlBuilder.js — HTML builders for chat UI
// Extracted from chatApp.js

import { escHtml } from './chatApp.js';
import { getCharacterInfo, getUserName } from './chatStorage.js';
import { getGiftEventCardHtml } from '../shop/giftSystem.js';
import { isKeepAliveEnabled } from '../keepAlive.js';

// ═══════════════════════════════════════════════════════════════════════
// HTML Builders
// ═══════════════════════════════════════════════════════════════════════

export function buildChatPage(history) {
    const charInfo = getCharacterInfo();
    const charName = charInfo?.name || '角色';

    // Messages HTML
    const displayHistory = history.slice(-20);
    const hasMore = history.length > 20;

    let messagesHtml = displayHistory.length > 0
        ? buildMessagesHtml(displayHistory, history.length - displayHistory.length)
        : `<div class="chat-empty">
               <div class="chat-empty-icon">💬</div>
               <div class="chat-empty-text">开始和你的${escHtml(charName)}聊天吧…</div>
           </div>`;

    if (hasMore && displayHistory.length > 0) {
        messagesHtml = `<div class="chat-load-more" id="chat_load_more_btn" data-limit="20">查看更早的聊天记录</div>` + messagesHtml;
    }

    return `
    <div class="chat-page" id="chat_page_root">
        <!-- Buff indicator bar (Phase 2) -->
        <div class="chat-buff-bar" id="chat_buff_bar"></div>

        <!-- Messages area -->
        <div class="chat-messages" id="chat_messages_area">
            ${messagesHtml}
        </div>

        <!-- Draft area -->
        <div class="chat-draft-area" id="chat_draft_area" style="display:none;">
            <div class="chat-draft-label">待发送:</div>
            <div id="chat_draft_list"></div>
        </div>

        <!-- Input bar — extended text area with inline buttons -->
        <div class="chat-input-bar" id="chat_input_bar">
            <button class="chat-btn-plus" id="chat_plus_btn" title="更多选项">
                <i class="fa-solid fa-plus"></i>
            </button>
            <div class="chat-input-wrap">
                <textarea class="chat-input" id="chat_input" rows="1"
                    placeholder="输入消息…"></textarea>
                <div class="chat-input-actions">
                    <button class="chat-btn-kiwi" id="chat_kiwi_btn" title="添加到待发">
                        🥝
                    </button>
                    <button class="chat-btn-send" id="chat_send_btn" title="发送" disabled>
                        <i class="fa-solid fa-arrow-up"></i>
                    </button>
                </div>
            </div>
        </div>

        <!-- Delete mode toolbar (hidden by default) -->
        <div class="chat-delete-toolbar" id="chat_delete_toolbar" style="display:none;">
            <div class="chat-delete-toolbar-info">
                <span id="chat_delete_count">已选 0 条</span>
            </div>
            <div class="chat-delete-toolbar-actions">
                <button class="chat-delete-toolbar-btn select-all" id="chat_select_all_btn">全选</button>
                <button class="chat-delete-toolbar-btn cancel" id="chat_delete_cancel_btn">取消</button>
                <button class="chat-delete-toolbar-btn confirm" id="chat_delete_confirm_btn" disabled>删除</button>
            </div>
        </div>

        <!-- Plus action panel (bottom sheet) -->
        <div class="chat-plus-overlay" id="chat_plus_overlay">
            <div class="chat-menu-sheet">
                <div class="chat-plus-row">
                    <div class="chat-plus-action" id="chat_return_home_btn">
                        <i class="fa-solid fa-house"></i>
                        <span>回家</span>
                    </div>
                    <div class="chat-plus-action" id="chat_plus_image_btn">
                        <i class="fa-solid fa-image"></i>
                        <span>图片</span>
                    </div>
                    <div class="chat-plus-action" id="chat_plus_inventory_btn">
                        <i class="fa-solid fa-box-open"></i>
                        <span>道具</span>
                    </div>
                    <div class="chat-plus-action ${isKeepAliveEnabled() ? 'active' : ''}" id="chat_plus_keepalive_btn">
                        <i class="ph ph-broadcast"></i>
                        <span>${isKeepAliveEnabled() ? '保活中' : '保活'}</span>
                    </div>
                </div>
                <div class="chat-menu-cancel" id="chat_plus_cancel">取消</div>
            </div>
        </div>

        <!-- Inventory (道具背包) overlay -->
        <div class="chat-inventory-overlay" id="chat_inventory_overlay">
            <div class="chat-inventory-panel">
                <div class="chat-inventory-header">
                    <div class="chat-inventory-title"><i class="fa-solid fa-box-open"></i> 道具背包</div>
                    <button class="chat-inventory-close" id="chat_inventory_close_btn"><i class="fa-solid fa-xmark"></i></button>
                </div>
                <div class="chat-inventory-list" id="chat_inventory_list"></div>
                <div class="chat-inventory-active" id="chat_inventory_active"></div>
            </div>
        </div>

        <!-- Action sheet menu (top-right ⋯) -->
        <div class="chat-menu-overlay" id="chat_menu_overlay">
            <div class="chat-menu-sheet">
                <div class="chat-menu-item" id="chat_reroll_btn">重新生成</div>
                <div class="chat-menu-item" id="chat_edit_mode_btn">编辑消息</div>
                <div class="chat-menu-item" id="chat_delete_mode_btn">删除消息</div>
                <div class="chat-menu-item danger" id="chat_clear_history">清空聊天记录</div>
                <div class="chat-menu-cancel" id="chat_menu_cancel">取消</div>
            </div>
        </div>

        <!-- Edit message overlay -->
        <div class="chat-edit-overlay" id="chat_edit_overlay">
            <div class="chat-edit-panel">
                <div class="chat-edit-header">
                    <span class="chat-edit-title">编辑消息</span>
                    <button class="chat-edit-close" id="chat_edit_close_btn"><i class="fa-solid fa-xmark"></i></button>
                </div>
                <textarea class="chat-edit-textarea" id="chat_edit_textarea" rows="4" placeholder="输入新内容…"></textarea>
                <div class="chat-edit-actions">
                    <button class="chat-edit-cancel-btn" id="chat_edit_cancel_btn">取消</button>
                    <button class="chat-edit-save-btn" id="chat_edit_save_btn">保存</button>
                </div>
            </div>
        </div>

        <!-- Recording overlay (语音录制中) -->
        <div class="chat-recording-overlay hidden" id="chat_recording_overlay">
            <div class="chat-recording-panel">
                <div class="chat-recording-indicator"><i class="fa-solid fa-microphone"></i></div>
                <div class="chat-recording-timer" id="chat_recording_timer">0:00</div>
                <div class="chat-recording-preview" id="chat_recording_preview"></div>
                <div class="chat-recording-hint" id="chat_recording_hint">松开发送，上滑取消</div>
            </div>
        </div>

        <!-- Hidden file input for image selection -->
        <input type="file" accept="image/*" id="chat_image_input" style="display:none" />

        <!-- Image lightbox overlay -->
        <div class="chat-image-lightbox" id="chat_image_lightbox">
            <img id="chat_lightbox_img" src="" alt="" />
        </div>
    </div>
    `;
}

export function buildMessagesHtml(history, startIndex = 0) {
    let html = '';
    let lastRole = null;
    let lastTimestamp = null;

    for (let i = 0; i < history.length; i++) {
        const msg = history[i];
        const globalIndex = startIndex + i;

        // Time divider (show if > 5 min gap)
        if (msg.timestamp) {
            const msgTime = new Date(msg.timestamp);
            if (!lastTimestamp || (msgTime - lastTimestamp) > 5 * 60 * 1000) {
                html += `<div class="chat-time-divider">${formatChatTime(msgTime)}</div>`;
            }
            lastTimestamp = msgTime;
        }

        // Check for retracted message
        if (msg.content === '[撤回了一条消息]') {
            const name = msg.role === 'char' ? (getCharacterInfo()?.name || '对方') : getUserName();
            html += `<div class="chat-retract">${escHtml(name)}撤回了一条消息</div>`;
            if (msg.recalledContent && msg.role === 'char') {
                html += buildRecalledPeekBubble(msg.recalledContent);
            }
            lastRole = null;
            continue;
        }

        // Regular or special bubble — pass full msg object for voice detection
        html += buildBubbleRow(msg.role, msg.content, msg.thought, globalIndex, msg.reactions, msg);
        lastRole = msg.role;
    }

    return html;
}

export function buildBubbleRow(role, content, thought, msgIndex, reactions, msg) {
    // ── Image message bubble ──
    if (msg && msg.special === 'image' && msg.imageThumbnail) {
        const indexAttr = msgIndex !== undefined ? ` data-msg-index="${msgIndex}"` : '';
        const checkboxHtml = msgIndex !== undefined
            ? `<div class="chat-select-checkbox" data-msg-index="${msgIndex}"><i class="fa-solid fa-check"></i></div>`
            : '';
        let thoughtHtml = '';
        if (role === 'char' && thought) {
            thoughtHtml = `<div class="chat-bubble chat-thought-bubble collapsed">${escHtml(thought)}</div>`;
        }
        let reactionHtml = '';
        if (reactions && typeof reactions === 'object' && Object.keys(reactions).length > 0) {
            const badges = Object.entries(reactions)
                .filter(([, count]) => count > 0)
                .map(([emoji, count]) => `<span class="chat-reaction-item">${emoji}${count > 1 ? ` ${count}` : ''}</span>`)
                .join('');
            if (badges) reactionHtml = `<div class="chat-reaction-badge" data-msg-index="${msgIndex}">${badges}</div>`;
        }
        // If content exists alongside image, show it as text below
        const captionHtml = content && content !== '[图片]'
            ? `<div class="chat-bubble" style="margin-top:4px;">${escHtml(content)}</div>`
            : '';
        return `
        <div class="chat-bubble-row ${role}"${indexAttr}>
            ${checkboxHtml}
            <div class="chat-bubble-column">
                <div class="chat-image-bubble" data-full-src="${escHtml(msg.imageThumbnail)}">
                    <img src="${escHtml(msg.imageThumbnail)}" alt="图片" loading="lazy" />
                </div>
                ${captionHtml}
                ${thoughtHtml}
                ${reactionHtml}
            </div>
        </div>`;
    }

    // ── Voice message bubble (real audio) ──
    if (msg && msg.special === 'voice' && (msg.audioPath || msg.audioData)) {
        const dur = msg.audioDuration || 0;
        const durStr = dur >= 60 ? `${Math.floor(dur / 60)}:${String(Math.round(dur % 60)).padStart(2, '0')}` : `${Math.round(dur)}″`;
        const audioSrc = msg.audioPath
            ? (msg.audioPath.startsWith('/') ? msg.audioPath : '/' + msg.audioPath)
            : msg.audioData;
        // Generate pseudo-random waveform bar heights from content hash
        const bars = _generateWaveformBars(content || '', 16);
        const barsHtml = bars.map(h => `<div class="voice-waveform-bar" style="height:${h}px"></div>`).join('');

        const indexAttr = msgIndex !== undefined ? ` data-msg-index="${msgIndex}"` : '';
        const checkboxHtml = msgIndex !== undefined
            ? `<div class="chat-select-checkbox" data-msg-index="${msgIndex}"><i class="fa-solid fa-check"></i></div>`
            : '';
        let thoughtHtml = '';
        if (role === 'char' && thought) {
            thoughtHtml = `<div class="chat-bubble chat-thought-bubble collapsed">${escHtml(thought)}</div>`;
        }
        let reactionHtml = '';
        if (reactions && typeof reactions === 'object' && Object.keys(reactions).length > 0) {
            const badges = Object.entries(reactions)
                .filter(([, count]) => count > 0)
                .map(([emoji, count]) => `<span class="chat-reaction-item">${emoji}${count > 1 ? ` ${count}` : ''}</span>`)
                .join('');
            if (badges) reactionHtml = `<div class="chat-reaction-badge" data-msg-index="${msgIndex}">${badges}</div>`;
        }

        return `
        <div class="chat-bubble-row ${role}"${indexAttr}>
            ${checkboxHtml}
            <div class="chat-bubble-column">
                <div class="chat-bubble">
                    <div class="voice-bubble" data-audio-src="${escHtml(audioSrc)}">
                        <button class="voice-play-btn"><i class="fa-solid fa-play"></i></button>
                        <div class="voice-waveform">${barsHtml}</div>
                        <span class="voice-duration">${durStr}</span>
                    </div>
                </div>
                ${thoughtHtml}
                ${reactionHtml}
            </div>
        </div>`;
    }

    // ── Normal bubble (original logic) ──
    const parsed = parseSpecialMessages(content);
    let thoughtHtml = '';
    if (role === 'char' && thought) {
        thoughtHtml = `<div class="chat-bubble chat-thought-bubble collapsed">${escHtml(thought)}</div>`;
    }
    const indexAttr = msgIndex !== undefined ? ` data-msg-index="${msgIndex}"` : '';

    const checkboxHtml = msgIndex !== undefined
        ? `<div class="chat-select-checkbox" data-msg-index="${msgIndex}"><i class="fa-solid fa-check"></i></div>`
        : '';

    let reactionHtml = '';
    if (reactions && typeof reactions === 'object' && Object.keys(reactions).length > 0) {
        const badges = Object.entries(reactions)
            .filter(([, count]) => count > 0)
            .map(([emoji, count]) => `<span class="chat-reaction-item">${emoji}${count > 1 ? ` ${count}` : ''}</span>`)
            .join('');
        if (badges) {
            reactionHtml = `<div class="chat-reaction-badge" data-msg-index="${msgIndex}">${badges}</div>`;
        }
    }

    return `
    <div class="chat-bubble-row ${role}"${indexAttr}>
        ${checkboxHtml}
        <div class="chat-bubble-column">
            ${parsed}
            ${thoughtHtml}
            ${reactionHtml}
        </div>
    </div>`;
}

// ═══════════════════════════════════════════════════════════════════════
// Special Message Parser
// ═══════════════════════════════════════════════════════════════════════

/**
 * Parse XML-style media tags (<图片>, <视频>, <音乐>, <新闻>) in HTML-escaped text.
 * Renders them as styled media cards, matching the moments module's rendering.
 * Must be called on ALREADY escHtml'd text (since the tags become &lt;图片&gt;).
 * @param {string} escapedText - HTML-escaped text
 * @returns {string} Text with media tags replaced by styled cards
 */
function parseChatMediaTags(escapedText) {
    if (!escapedText) return escapedText;

    const MEDIA_TYPES = {
        '图片': { icon: 'fa-image', label: '图片' },
        '视频': { icon: 'fa-video', label: '视频' },
        '音乐': { icon: 'fa-music', label: '音乐' },
        '新闻': { icon: 'fa-newspaper', label: '新闻' },
    };

    let result = escapedText;
    for (const [tag, props] of Object.entries(MEDIA_TYPES)) {
        const regex = new RegExp(`&lt;${tag}&gt;([\\s\\S]*?)&lt;\\/${tag}&gt;`, 'gi');
        result = result.replace(regex, (_, content) => `
            <div class="chat-special-card">
                <div class="chat-special-icon image"><i class="fa-solid ${props.icon}"></i></div>
                <div class="chat-special-content">
                    ${content}
                    <div class="chat-special-label">${props.label}</div>
                </div>
            </div>`);
    }
    return result;
}

/**
 * Parse text for special message patterns and render as styled cards.
 * Supports both full-match (entire message is a token) and embedded tokens
 * within mixed text (e.g. "给你~ [礼物:小玩具球]").
 * Also handles XML-style media tags (<图片>, <视频>, etc.).
 * Falls back to plain text bubble.
 */
function parseSpecialMessages(text) {
    // ── Special token definitions (order matters: first match wins) ──
    const SPECIAL_PATTERNS = [
        {
            // Voice message: [语音消息:内容(时长)]
            regex: /\[语音消息[:：](.+?)(?:\((\d+)秒\))?\]/,
            render: (m) => {
                const desc = m[1].trim();
                const dur = m[2] || '??';
                return `
                <div class="chat-bubble">
                    <div class="chat-special-card" style="padding: 10px 14px; min-width: auto;">
                        <div style="flex:1; display:flex; align-items:center; justify-content:space-between; gap:12px;">
                            <div style="font-size: 14px;">▶ ${escHtml(desc)}</div>
                            <div class="chat-voice-duration" style="opacity:0.6; font-size:12px;">${dur}″</div>
                        </div>
                    </div>
                </div>`;
            },
        },
        {
            // Image: [图片:描述]
            regex: /\[图片[:：](.+?)\]/,
            render: (m) => `
                <div class="chat-bubble">
                    <div class="chat-special-card">
                        <div class="chat-special-icon image"><i class="fa-solid fa-image"></i></div>
                        <div class="chat-special-content">
                            ${escHtml(m[1].trim())}
                            <div class="chat-special-label">图片</div>
                        </div>
                    </div>
                </div>`,
        },
        {
            // Share: [分享:标题]
            regex: /\[分享[:：](.+?)\]/,
            render: (m) => `
                <div class="chat-bubble">
                    <div class="chat-special-card">
                        <div class="chat-special-icon share"><i class="fa-solid fa-share-from-square"></i></div>
                        <div class="chat-special-content">
                            ${escHtml(m[1].trim())}
                            <div class="chat-special-label">分享</div>
                        </div>
                    </div>
                </div>`,
        },
        {
            // Gift: [礼物:道具名称]
            regex: /\[礼物[::：](.+?)\]/,
            render: (m) => {
                const giftName = m[1].trim();
                const charName = getCharacterInfo()?.name || '角色';
                return getGiftEventCardHtml(giftName, charName);
            },
        },
        {
            // Prank event card: [恶作剧:描述]
            regex: /\[恶作剧[:：](.+?)\]/,
            render: (m) => `
                <div class="chat-bubble">
                    <div class="chat-special-card prank">
                        <div class="chat-special-icon prank"><i class="fa-solid fa-wand-magic-sparkles"></i></div>
                        <div class="chat-special-content">
                            ${escHtml(m[1].trim())}
                            <div class="chat-special-label">恶作剧</div>
                        </div>
                    </div>
                </div>`,
        },
        {
            // Missed/declined call: [用户拒接了来电]
            regex: /\[用户拒接了来电\]/,
            render: () => `
                <div class="chat-bubble">
                    <div class="chat-special-card">
                        <div class="chat-special-icon" style="background:linear-gradient(135deg,#FF3B30,#FF6961);">
                            <i class="ph ph-phone-x"></i>
                        </div>
                        <div class="chat-special-content">
                            未接来电
                            <div class="chat-special-label">语音通话</div>
                        </div>
                    </div>
                </div>`,
        },
    ];

    // ── Try full-match first (entire text is exactly one special token) ──
    for (const pattern of SPECIAL_PATTERNS) {
        const fullRe = new RegExp(`^${pattern.regex.source}$`);
        const fullMatch = text.match(fullRe);
        if (fullMatch) return pattern.render(fullMatch);
    }

    // ── Scan for ALL embedded special tokens within mixed text ──
    // Collect all matches with their positions, then build output in order
    const allMatches = [];
    for (const pattern of SPECIAL_PATTERNS) {
        const globalRe = new RegExp(pattern.regex.source, 'g');
        let m;
        while ((m = globalRe.exec(text)) !== null) {
            allMatches.push({ match: m, pattern, start: m.index, end: m.index + m[0].length });
        }
    }

    if (allMatches.length > 0) {
        // Sort by position and remove overlapping matches (keep earliest)
        allMatches.sort((a, b) => a.start - b.start);
        const filtered = [allMatches[0]];
        for (let i = 1; i < allMatches.length; i++) {
            if (allMatches[i].start >= filtered[filtered.length - 1].end) {
                filtered.push(allMatches[i]);
            }
        }

        const htmlParts = [];
        let cursor = 0;
        for (const { match, pattern, start, end } of filtered) {
            // Text before this token → plain bubble (with media tag rendering)
            const before = text.slice(cursor, start).trim();
            if (before) {
                htmlParts.push(`<div class="chat-bubble">${parseChatMediaTags(escHtml(before))}</div>`);
            }
            // Render the matched token as its special card
            htmlParts.push(pattern.render(match));
            cursor = end;
        }
        // Text after the last token → plain bubble (with media tag rendering)
        const after = text.slice(cursor).trim();
        if (after) {
            htmlParts.push(`<div class="chat-bubble">${parseChatMediaTags(escHtml(after))}</div>`);
        }

        return htmlParts.join('');
    }

    // ── No bracket-style tokens found → plain text with media tag rendering ──
    return `<div class="chat-bubble">${parseChatMediaTags(escHtml(text))}</div>`;
}

/** Build a "peeked" recalled message bubble (translucent + strikethrough) */
export function buildRecalledPeekBubble(content) {
    return `
    <div class="chat-bubble-row char">
        <div class="chat-bubble-column">
            <div class="chat-bubble chat-recalled-peek">
                <div class="chat-recalled-peek-label">🔓 偷看到的撤回内容：</div>
                <div class="chat-recalled-peek-text">${escHtml(content)}</div>
            </div>
        </div>
    </div>`;
}

/**
 * Generate deterministic waveform bar heights from a text string.
 * Uses a simple hash to produce pseudo-random but consistent heights.
 * @param {string} text - Source text (used as seed)
 * @param {number} count - Number of bars
 * @returns {number[]} Array of pixel heights (6–20)
 */
function _generateWaveformBars(text, count) {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
        hash = (hash * 31 + text.charCodeAt(i)) | 0;
    }
    const bars = [];
    for (let i = 0; i < count; i++) {
        hash = (hash * 1103515245 + 12345) | 0;
        const h = 6 + Math.abs(hash % 15); // 6–20px
        bars.push(h);
    }
    return bars;
}

/**
 * Format a date for chat time dividers.
 * @param {Date} date
 * @returns {string}
 */
export function formatChatTime(date) {
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();

    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday = date.toDateString() === yesterday.toDateString();

    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    const timeStr = `${hh}:${mm}`;

    if (isToday) return timeStr;
    if (isYesterday) return `昨天 ${timeStr}`;

    const month = date.getMonth() + 1;
    const day = date.getDate();
    return `${month}/${day} ${timeStr}`;
}
