// modules/phone/discord/discordChannel.js — Channel chat UI
// Handles: message list rendering, input area, @mentions, typing indicator,
// member drawer, context menu, reactions display, real-time message updates.

import { openAppInViewport } from '../phoneController.js';
import { escapeHtml } from '../utils/helpers.js';
import { getPhoneUserName } from '../phoneContext.js';
import {
    loadChannelMessages, loadMembers, loadRoles, getMemberColor,
    getUserMember, saveChannelMessages, loadServerConfig, uploadFileToST,
    getMemberAvatarUrl, getChannelPermissions,
} from './discordStorage.js';
import { sendUserMessages, generateAutoConversation, onMessageReceived, onTypingStateChange, getTypingState } from './discordMessageHandler.js';
import { openStickerPanel, closeStickerPanel, getQuickReactions, renderStickersInText } from './discordEmoji.js';
import { openServerSettings } from './discordServerSettings.js';
import { handleDiscordImageSelection, showDiscordImageLightbox } from './discordImage.js';
import { isKeepAliveEnabled, setKeepAliveEnabled, startKeepAlive, stopKeepAlive } from '../keepAlive.js';

const LOG = '[Discord Channel]';

// ═══════════════════════════════════════════════════════════════════════
// State
// ═══════════════════════════════════════════════════════════════════════

let _currentChannelId = null;
let _currentChannelName = '';
let _onReturn = null;
let _unsubMessage = null;
let _unsubTyping = null;
let _mentionIds = [];          // accumulated @mentions for current message
let _memberDrawerOpen = false;
let _pendingMessages = [];     // 🥝 kiwi draft queue
let _pendingImageData = null;  // { base64, thumbnail, fileName } | null
let _isDeleteMode = false;     // batch-delete mode
let _isEditMode = false;       // edit mode (tap to edit)
let _selectedForDeletion = new Set(); // msg IDs selected for batch delete
let _selectedEditMsgId = null; // msg ID being edited
let _isGenerating = false;     // reroll lock
let _menuOpenedAt = 0;         // timestamp guard for overlay dismiss
let _plusOpenedAt = 0;         // timestamp guard for plus panel dismiss
let _contextMenuOpen = false;  // whether long-press context menu is visible
let _replyToMsg = null;        // message being replied to { id, authorName, content }

// ═══════════════════════════════════════════════════════════════════════
// Public Entry
// ═══════════════════════════════════════════════════════════════════════

/**
 * Open the channel chat view.
 * @param {string} channelId
 * @param {string} channelName
 * @param {Function} onReturn — callback to return to server home
 */
export function openChannel(channelId, channelName, onReturn) {
    _currentChannelId = channelId;
    _currentChannelName = channelName;
    _onReturn = onReturn;
    _mentionIds = [];
    _memberDrawerOpen = false;
    _pendingImageData = null;
    _pendingMessages = [];

    _renderChannelView();
}

// ═══════════════════════════════════════════════════════════════════════
// Main Render
// ═══════════════════════════════════════════════════════════════════════

function _renderChannelView() {
    const messages = loadChannelMessages(_currentChannelId);
    const members = loadMembers();
    const roles = loadRoles();

    const messagesHtml = _buildMessagesHtml(messages, members, roles);

    const html = `
        <div class="dc-channel-page" id="dc_channel_page" data-channel-id="${_currentChannelId}">
            <div class="dc-channel-messages" id="dc_channel_messages">
                ${messagesHtml || _buildWelcomeHtml()}
            </div>
            <div class="dc-typing-area" id="dc_typing_area" style="display:none;">
                <div class="dc-typing-dots">
                    <div class="dc-typing-dot"></div>
                    <div class="dc-typing-dot"></div>
                    <div class="dc-typing-dot"></div>
                </div>
                <span class="dc-typing-text" id="dc_typing_text"></span>
            </div>
            <div class="dc-channel-input-area" id="dc_channel_input_area">
                <div class="dc-draft-area" id="dc_draft_area" style="display:none;">
                    <div class="dc-draft-label">待发送:</div>
                    <div class="dc-draft-list" id="dc_draft_list"></div>
                </div>
                <div class="dc-mention-bar" id="dc_mention_bar" style="display:none;"></div>
                <div class="dc-mention-dropdown" id="dc_mention_dropdown" style="display:none;"></div>
                <div class="dc-reply-bar" id="dc_reply_bar" style="display:none;">
                    <div class="dc-reply-bar-content">
                        <i class="ph ph-arrow-bend-up-left"></i>
                        <span class="dc-reply-bar-name" id="dc_reply_bar_name"></span>
                        <span class="dc-reply-bar-text" id="dc_reply_bar_text"></span>
                    </div>
                    <button class="dc-reply-bar-close" id="dc_reply_bar_close">
                        <i class="ph ph-x"></i>
                    </button>
                </div>
                ${_buildPermissionNoticeHtml()}
                <div class="dc-input-row">
                    <button class="dc-btn-plus" id="dc_plus_btn" title="更多选项">
                        <i class="ph ph-plus"></i>
                    </button>
                    <div class="dc-input-wrap">
                        <input type="text" class="dc-chat-input" id="dc_chat_input"
                               placeholder="发送消息到 #${escapeHtml(_currentChannelName)}"
                               autocomplete="off" />
                        <div class="dc-input-actions">
                            <button class="dc-btn-kiwi" id="dc_kiwi_btn" title="添加到待发">🥝</button>
                        </div>
                    </div>
                    <button class="dc-send-btn" id="dc_send_btn" disabled>
                        <i class="ph ph-paper-plane-right"></i>
                    </button>
                </div>
            </div>
            <!-- Plus Action Panel (bottom sheet) -->
            <div class="dc-plus-overlay" id="dc_plus_overlay">
                <div class="dc-plus-sheet">
                    <div class="dc-plus-row">
                        <div class="dc-plus-action" id="dc_plus_sticker_btn">
                            <i class="ph ph-smiley-sticker"></i>
                            <span>表情</span>
                        </div>
                        <div class="dc-plus-action" id="dc_plus_image_btn">
                            <i class="ph ph-image"></i>
                            <span>图片</span>
                        </div>
                        <div class="dc-plus-action ${isKeepAliveEnabled() ? 'active' : ''}" id="dc_plus_keepalive_btn">
                            <i class="ph ph-broadcast"></i>
                            <span>${isKeepAliveEnabled() ? '保活中' : '保活'}</span>
                        </div>
                    </div>
                    <div class="dc-plus-cancel" id="dc_plus_cancel">取消</div>
                </div>
            </div>
            <!-- Hidden file input for image selection -->
            <input type="file" accept="image/*" id="dc_image_input" style="display:none" />
            <!-- Image lightbox overlay -->
            <div class="dc-image-lightbox" id="dc_image_lightbox">
                <img id="dc_lightbox_img" src="" alt="" />
            </div>
            <!-- Delete Toolbar (replaces input bar in delete mode) -->
            <div class="dc-delete-toolbar" id="dc_delete_toolbar" style="display:none;">
                <div class="dc-delete-toolbar-info">
                    <span id="dc_delete_count">已选 0 条</span>
                </div>
                <div class="dc-delete-toolbar-actions">
                    <button class="dc-delete-toolbar-btn select-all" id="dc_select_all_btn">全选</button>
                    <button class="dc-delete-toolbar-btn cancel" id="dc_delete_cancel_btn">取消</button>
                    <button class="dc-delete-toolbar-btn confirm" id="dc_delete_confirm_btn" disabled>删除</button>
                </div>
            </div>
            <!-- Action Sheet Menu -->
            <div class="dc-menu-overlay" id="dc_menu_overlay">
                <div class="dc-menu-sheet">
                    <div class="dc-menu-item" id="dc_reroll_btn">重新生成</div>
                    <div class="dc-menu-item" id="dc_auto_chat_btn">让她们聊聊</div>
                    <div class="dc-menu-item" id="dc_edit_mode_btn">编辑消息</div>
                    <div class="dc-menu-item" id="dc_delete_mode_btn">删除消息</div>
                    <div class="dc-menu-item" id="dc_members_btn">成员列表</div>
                    <div class="dc-menu-cancel" id="dc_menu_cancel">取消</div>
                </div>
            </div>
            <!-- Edit Overlay -->
            <div class="dc-edit-overlay" id="dc_edit_overlay">
                <div class="dc-edit-panel">
                    <div class="dc-edit-header">
                        <span class="dc-edit-title">编辑消息</span>
                        <button class="dc-edit-close" id="dc_edit_close"><i class="ph ph-x"></i></button>
                    </div>
                    <textarea class="dc-edit-textarea" id="dc_edit_textarea"></textarea>
                    <div class="dc-edit-actions">
                        <button class="dc-edit-cancel-btn" id="dc_edit_cancel">取消</button>
                        <button class="dc-edit-save-btn" id="dc_edit_save">保存</button>
                    </div>
                </div>
            </div>
            <!-- Member Drawer -->
            <div class="dc-member-drawer-overlay" id="dc_drawer_overlay" style="display:none;"></div>
            <div class="dc-member-drawer" id="dc_member_drawer">
                <div class="dc-drawer-header">
                    <span class="dc-drawer-title">成员</span>
                    <button class="dc-icon-btn" id="dc_drawer_close">
                        <i class="ph ph-x"></i>
                    </button>
                </div>
                <div class="dc-drawer-body" id="dc_drawer_body"></div>
            </div>
            <!-- Context Menu -->
            <div class="dc-context-menu" id="dc_context_menu" style="display:none;"></div>
        </div>
    `;

    // Build permission tag for title
    const channelPerms = getChannelPermissions(_currentChannelId);
    const permIcon = channelPerms.length > 0
        ? '<i class="ph ph-lock-simple dc-channel-perm-icon"></i>'
        : '';

    const titleHtml = `
        <span style="font-weight:500; color:var(--dc-channel-default);">#</span>
        <span style="font-weight:600; margin-left:4px;">${escapeHtml(_currentChannelName)}</span>
        ${permIcon}`;

    const actionsHtml = `
        <button class="dc-icon-btn dc-header-action" id="dc_menu_btn" title="更多">
            <i class="ph ph-dots-three"></i>
        </button>`;

    openAppInViewport(titleHtml, html, () => {
        _bindChannelEvents();
        _scrollToBottom(false);
        _subscribeToUpdates();

        // Back button → return to server home
        const backHandler = (e) => {
            e.preventDefault();
            window.removeEventListener('phone-app-back', backHandler);
            _cleanup();
            if (_onReturn) _onReturn();
        };
        window.addEventListener('phone-app-back', backHandler);
    }, actionsHtml);
}

// ═══════════════════════════════════════════════════════════════════════
// Permission Notice
// ═══════════════════════════════════════════════════════════════════════

function _buildPermissionNoticeHtml() {
    const perms = getChannelPermissions(_currentChannelId);
    if (!perms || perms.length === 0) return '';

    const roles = loadRoles();
    const roleNames = perms
        .map(rid => roles.find(r => r.id === rid)?.name)
        .filter(Boolean);

    if (roleNames.length === 0) return '';

    return `
        <div class="dc-perm-notice" id="dc_perm_notice">
            <i class="ph ph-lock-simple"></i>
            <span>仅 ${escapeHtml(roleNames.join('、'))} 可发言</span>
        </div>
    `;
}

// ═══════════════════════════════════════════════════════════════════════
// Message List Build
// ═══════════════════════════════════════════════════════════════════════

function _buildWelcomeHtml() {
    // Get channel topic from config
    const config = loadServerConfig();
    let channelTopic = '';
    if (config?.categories) {
        for (const cat of config.categories) {
            const ch = (cat.channels || []).find(c => c.id === _currentChannelId);
            if (ch) { channelTopic = ch.topic || ''; break; }
        }
    }
    const topicHtml = channelTopic
        ? `<div class="dc-welcome-topic">${escapeHtml(channelTopic)}</div>`
        : '';

    return `
        <div class="dc-channel-welcome">
            <div class="dc-welcome-hash">#</div>
            <div class="dc-welcome-title">欢迎来到 #${escapeHtml(_currentChannelName)}！</div>
            <div class="dc-welcome-subtitle">这是 #${escapeHtml(_currentChannelName)} 频道的开始。</div>
            ${topicHtml}
        </div>
    `;
}

function _buildMessagesHtml(messages, members, roles) {
    if (!messages || messages.length === 0) return '';

    const memberMap = {};
    for (const m of members) memberMap[m.id] = m;
    const roleMap = {};
    for (const r of roles) roleMap[r.id] = r;

    let html = '';
    let lastAuthorId = null;
    let lastTimestamp = null;

    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        const member = memberMap[msg.authorId];
        const isConsecutive = _isConsecutiveMessage(msg, lastAuthorId, lastTimestamp);

        html += _buildSingleMessageHtml(msg, member, members, roleMap, isConsecutive, i);

        lastAuthorId = msg.authorId;
        lastTimestamp = msg.timestamp;
    }

    return html;
}

function _isConsecutiveMessage(msg, lastAuthorId, lastTimestamp) {
    if (msg.authorId !== lastAuthorId) return false;
    if (!lastTimestamp) return false;
    // Consecutive if within 5 minutes
    const diff = new Date(msg.timestamp) - new Date(lastTimestamp);
    return diff < 5 * 60 * 1000;
}

function _buildSingleMessageHtml(msg, member, members, roleMap, isConsecutive, index) {
    const memberName = member?.name || msg.authorName || '未知';
    const nameColor = member ? getMemberColor(member) : '#99aab5';
    const timeStr = _formatTimestamp(msg.timestamp);

    // Process @mentions in content
    const processedContent = _processMessageContent(msg.content, members);

    // Image attachment
    const imageHtml = msg.imageUrl
        ? `<div class="dc-msg-image" data-full-src="${escapeHtml(msg.imageUrl)}"><img src="${escapeHtml(msg.imageUrl)}" alt="图片" loading="lazy" /></div>`
        : '';

    // Reactions
    const reactionsHtml = _buildReactionsHtml(msg);

    // Reply reference (quoted message)
    let replyHtml = '';
    if (msg.replyTo) {
        const allMessages = loadChannelMessages(_currentChannelId);
        const repliedMsg = allMessages.find(m => m.id === msg.replyTo);
        if (repliedMsg) {
            const repliedName = repliedMsg.authorName || '未知';
            const repliedMember = members.find(m => m.id === repliedMsg.authorId);
            const repliedColor = repliedMember ? getMemberColor(repliedMember) : '#99aab5';
            const repliedText = repliedMsg.content?.substring(0, 80) || '';
            replyHtml = `
                <div class="dc-reply-ref">
                    <div class="dc-reply-ref-bar" style="background:${repliedColor}"></div>
                    <span class="dc-reply-ref-name" style="color:${repliedColor}">${escapeHtml(repliedName)}</span>
                    <span class="dc-reply-ref-text">${escapeHtml(repliedText)}</span>
                </div>
            `;
        }
    }

    if (isConsecutive) {
        // Compact — no avatar/name, just content
        return `
            <div class="dc-message dc-message-compact" data-msg-id="${msg.id}" data-msg-index="${index}">
                <div class="dc-message-compact-time">${timeStr.split(' ').pop()}</div>
                <div class="dc-message-body">
                    ${replyHtml}
                    ${imageHtml}
                    <div class="dc-message-content">${processedContent}</div>
                    ${reactionsHtml}
                </div>
            </div>
        `;
    }

    // Full message with avatar + name
    const avatarHtml = _buildAvatarHtml(member, msg);

    return `
        <div class="dc-message" data-msg-id="${msg.id}" data-msg-index="${index}">
            ${avatarHtml}
            <div class="dc-message-body">
                ${replyHtml}
                <div class="dc-message-header">
                    <span class="dc-message-author" style="color:${nameColor}">${escapeHtml(memberName)}</span>
                    <span class="dc-message-time">${timeStr}</span>
                </div>
                ${imageHtml}
                <div class="dc-message-content">${processedContent}</div>
                ${reactionsHtml}
            </div>
        </div>
    `;
}

function _buildAvatarHtml(member, msg) {
    const color = member?.avatarColor || '#5865f2';
    const avatarUrl = getMemberAvatarUrl(member);
    if (avatarUrl) {
        return `<div class="dc-msg-avatar" style="background:${color}"><img src="${avatarUrl}" alt="" /></div>`;
    }
    const initial = (member?.name || msg.authorName || '?').charAt(0);
    return `<div class="dc-msg-avatar" style="background:${color}">${escapeHtml(initial)}</div>`;
}

function _processMessageContent(text, members) {
    if (!text) return '';

    // Escape HTML first
    let processed = escapeHtml(text);

    // ── Discord-style Markdown rendering ──
    // Order matters: code blocks → headings → inline styles → block styles → mentions

    // Code blocks: ```code``` → <pre><code>code</code></pre>
    processed = processed.replace(/```([\s\S]*?)```/g, (_, code) =>
        `<pre class="dc-md-codeblock"><code>${code.trim()}</code></pre>`
    );

    // Inline code: `code` → <code>code</code>
    processed = processed.replace(/`([^`\n]+)`/g,
        '<code class="dc-md-code">$1</code>'
    );

    // Headings: # / ## / ### (must be at line start)
    processed = processed.replace(/(^|\n)### +(.+)/g,
        '$1<div class="dc-md-h3">$2</div>'
    );
    processed = processed.replace(/(^|\n)## +(.+)/g,
        '$1<div class="dc-md-h2">$2</div>'
    );
    processed = processed.replace(/(^|\n)# +(.+)/g,
        '$1<div class="dc-md-h1">$2</div>'
    );

    // Subtext: -# text (Discord small text)
    processed = processed.replace(/(^|\n)-# +(.+)/g,
        '$1<div class="dc-md-subtext">$2</div>'
    );

    // Spoiler: ||text|| → <span class="dc-md-spoiler">text</span>
    processed = processed.replace(/\|\|(.+?)\|\|/g,
        '<span class="dc-md-spoiler">$1</span>'
    );

    // Bold + italic: ***text*** → <strong><em>text</em></strong>
    processed = processed.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');

    // Bold: **text** → <strong>text</strong>
    processed = processed.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

    // Italic: *text* → <em>text</em>
    processed = processed.replace(/\*(.+?)\*/g, '<em>$1</em>');

    // Underline: __text__ → <u>text</u>
    processed = processed.replace(/__(.+?)__/g, '<u>$1</u>');

    // Strikethrough: ~~text~~ → <del>text</del>
    processed = processed.replace(/~~(.+?)~~/g, '<del>$1</del>');

    // Blockquotes: lines starting with > → <div class="dc-md-blockquote">text</div>
    processed = processed.replace(/(^|\n)&gt; ?(.+)/g,
        '$1<div class="dc-md-blockquote">$2</div>'
    );

    // Unordered list items: - text (line start)
    processed = processed.replace(/(^|\n)- +(.+)/g,
        '$1<div class="dc-md-list-item"><span class="dc-md-bullet">•</span> $2</div>'
    );

    // Image description: <图片>description</图片> → styled card
    processed = processed.replace(/&lt;图片&gt;([\s\S]*?)&lt;\/图片&gt;/g, (_, desc) =>
        `<div class="dc-img-desc"><i class="ph ph-camera"></i><span>${desc.trim()}</span></div>`
    );

    // Newlines → <br>
    processed = processed.replace(/\n/g, '<br>');

    // Highlight @mentions: @username → <span class="dc-mention">@username</span>
    for (const m of members) {
        const regex = new RegExp(`@${_escapeRegex(m.name)}`, 'g');
        processed = processed.replace(regex, `<span class="dc-mention">@${escapeHtml(m.name)}</span>`);
    }

    // Render custom stickers :name: → inline <img> if matched, else leave as styled text
    processed = renderStickersInText(processed);

    return processed;
}

function _buildReactionsHtml(msg) {
    if (!msg.reactions || msg.reactions.length === 0) return '';

    const userMember = getUserMember();
    const userId = userMember?.id;

    const pills = msg.reactions.map(r => {
        const count = r.users?.length || 0;
        const isMine = r.users?.includes(userId);
        const mineClass = isMine ? 'dc-reaction-mine' : '';
        return `
            <div class="dc-reaction-pill ${mineClass}" data-msg-id="${msg.id}" data-emoji="${escapeHtml(r.emoji)}">
                <span class="dc-reaction-emoji">${r.emoji}</span>
                <span class="dc-reaction-count">${count}</span>
            </div>
        `;
    }).join('');

    return `<div class="dc-reactions">${pills}</div>`;
}

// ═══════════════════════════════════════════════════════════════════════
// Event Binding
// ═══════════════════════════════════════════════════════════════════════

function _bindChannelEvents() {
    const input = document.getElementById('dc_chat_input');
    const sendBtn = document.getElementById('dc_send_btn');
    const kiwiBtn = document.getElementById('dc_kiwi_btn');
    const plusBtn = document.getElementById('dc_plus_btn');
    const menuBtn = document.getElementById('dc_menu_btn');
    const menuOverlay = document.getElementById('dc_menu_overlay');
    const menuCancel = document.getElementById('dc_menu_cancel');
    const drawerOverlay = document.getElementById('dc_drawer_overlay');
    const drawerClose = document.getElementById('dc_drawer_close');
    const plusOverlay = document.getElementById('dc_plus_overlay');
    const plusCancel = document.getElementById('dc_plus_cancel');
    const imageInput = document.getElementById('dc_image_input');

    // ── Input handling ──
    input?.addEventListener('input', () => {
        _handleInputChange(input);
    });

    // ── Enter key → add to draft (same as Chat App kiwi pattern) ──
    input?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            _addPendingMessage();
        }
    });

    // ── Kiwi button → add to draft ──
    kiwiBtn?.addEventListener('click', () => _addPendingMessage());

    // ── Send button → send all drafts + remaining input ──
    sendBtn?.addEventListener('click', () => _handleSendAll());

    // ── + Plus button → open plus panel ──
    plusBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        _plusOpenedAt = Date.now();
        plusOverlay?.classList.add('active');
    });

    // ── Plus panel: cancel ──
    plusCancel?.addEventListener('click', () => plusOverlay?.classList.remove('active'));
    plusOverlay?.addEventListener('click', (e) => {
        if (e.target === plusOverlay && Date.now() - _plusOpenedAt > 200) {
            plusOverlay.classList.remove('active');
        }
    });

    // ── Plus panel: Sticker button ──
    document.getElementById('dc_plus_sticker_btn')?.addEventListener('click', () => {
        plusOverlay?.classList.remove('active');
        openStickerPanel(
            (sticker) => {
                if (input) {
                    input.value += sticker;
                    input.focus();
                    _handleInputChange(input);
                }
            },
            () => {
                // Navigate to server settings for sticker management
                _cleanup();
                openServerSettings(() => {
                    // When returning from settings, re-open channel view
                    openChannel(_currentChannelId, _currentChannelName, _onReturn);
                });
            },
        );
    });

    // ── Plus panel: Image button ──
    document.getElementById('dc_plus_image_btn')?.addEventListener('click', () => {
        plusOverlay?.classList.remove('active');
        imageInput?.click();
    });
    imageInput?.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
            handleDiscordImageSelection(e.target.files[0], (imageData) => {
                _pendingImageData = imageData;
                _renderDraftArea();
                _updateButtonStates();
            });
        }
        imageInput.value = '';
    });

    // ── Image lightbox close ──
    const lightbox = document.getElementById('dc_image_lightbox');
    lightbox?.addEventListener('click', () => lightbox.classList.remove('active'));

    // ── Plus panel: Keep alive toggle ──
    const keepAliveBtn = document.getElementById('dc_plus_keepalive_btn');
    if (keepAliveBtn) {
        keepAliveBtn.addEventListener('click', () => {
            const wasOn = isKeepAliveEnabled();
            const newState = !wasOn;
            setKeepAliveEnabled(newState);
            if (newState) {
                startKeepAlive();
            } else {
                stopKeepAlive();
            }
            // Update button visual
            keepAliveBtn.classList.toggle('active', newState);
            const label = keepAliveBtn.querySelector('span');
            if (label) label.textContent = newState ? '保活中' : '保活';
            // Toast
            if (typeof toastr !== 'undefined') {
                toastr.info(newState ? '静默保活已开启' : '静默保活已关闭');
            }
            // Don't close overlay — let user see the state change
        });
    }

    // ── ⋯ Menu button ──
    menuBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        _menuOpenedAt = Date.now();
        menuOverlay?.classList.add('active');
    });
    menuCancel?.addEventListener('click', () => menuOverlay?.classList.remove('active'));
    menuOverlay?.addEventListener('click', (e) => {
        if (e.target === menuOverlay && Date.now() - _menuOpenedAt > 200) {
            menuOverlay.classList.remove('active');
        }
    });

    // ── Menu: Reroll ──
    document.getElementById('dc_reroll_btn')?.addEventListener('click', () => {
        menuOverlay?.classList.remove('active');
        _rerollLastResponse();
    });

    // ── Menu: Auto chat (let them chat) ──
    document.getElementById('dc_auto_chat_btn')?.addEventListener('click', () => {
        menuOverlay?.classList.remove('active');
        _triggerAutoChat();
    });

    // ── Menu: Edit mode ──
    document.getElementById('dc_edit_mode_btn')?.addEventListener('click', () => {
        menuOverlay?.classList.remove('active');
        _toggleEditMode();
    });

    // ── Menu: Delete mode ──
    document.getElementById('dc_delete_mode_btn')?.addEventListener('click', () => {
        menuOverlay?.classList.remove('active');
        _toggleDeleteMode();
    });

    // ── Menu: Member list ──
    document.getElementById('dc_members_btn')?.addEventListener('click', () => {
        menuOverlay?.classList.remove('active');
        _toggleMemberDrawer();
    });

    // ── Delete toolbar buttons ──
    document.getElementById('dc_select_all_btn')?.addEventListener('click', () => _handleSelectAll());
    document.getElementById('dc_delete_cancel_btn')?.addEventListener('click', () => _toggleDeleteMode());
    document.getElementById('dc_delete_confirm_btn')?.addEventListener('click', () => _handleBatchDelete());

    // ── Edit overlay buttons ──
    document.getElementById('dc_edit_close')?.addEventListener('click', () => _closeEditOverlay());
    document.getElementById('dc_edit_cancel')?.addEventListener('click', () => _closeEditOverlay());
    document.getElementById('dc_edit_save')?.addEventListener('click', () => _handleEditSave());
    const editOverlay = document.getElementById('dc_edit_overlay');
    editOverlay?.addEventListener('click', (e) => {
        if (e.target === editOverlay) _closeEditOverlay();
    });

    // ── Member drawer ──
    drawerOverlay?.addEventListener('click', () => _closeMemberDrawer());
    drawerClose?.addEventListener('click', () => _closeMemberDrawer());

    // ── Message interactions (delegation) ──
    const messagesContainer = document.getElementById('dc_channel_messages');
    if (messagesContainer) {
        // Long press for context menu
        let longPressTimer = null;
        let longPressTarget = null;

        messagesContainer.addEventListener('pointerdown', (e) => {
            if (_isDeleteMode || _isEditMode || _contextMenuOpen) return;
            const msgEl = e.target.closest('.dc-message');
            if (!msgEl) return;
            longPressTarget = msgEl;
            longPressTimer = setTimeout(() => {
                _showContextMenu(msgEl, e);
            }, 500);
        });

        messagesContainer.addEventListener('pointerup', () => {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        });

        messagesContainer.addEventListener('pointerleave', () => {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        });

        // Suppress native browser context menu on messages
        messagesContainer.addEventListener('contextmenu', (e) => {
            e.preventDefault();
        });

        // ── Swipe-left to reply gesture ──
        let _swipeStartX = 0;
        let _swipeStartY = 0;
        let _swipeMsgEl = null;
        let _swipeDirection = null; // 'horizontal' | 'vertical' | null
        const SWIPE_THRESHOLD = 60; // min px to trigger reply
        const DIRECTION_LOCK = 10;  // min px to lock direction

        messagesContainer.addEventListener('touchstart', (e) => {
            if (_isDeleteMode || _isEditMode) return;
            const msgEl = e.target.closest('.dc-message');
            if (!msgEl) return;
            _swipeMsgEl = msgEl;
            _swipeStartX = e.touches[0].clientX;
            _swipeStartY = e.touches[0].clientY;
            _swipeDirection = null;
            msgEl.style.transition = 'none';
        }, { passive: true });

        messagesContainer.addEventListener('touchmove', (e) => {
            if (!_swipeMsgEl) return;
            const deltaX = e.touches[0].clientX - _swipeStartX;
            const deltaY = e.touches[0].clientY - _swipeStartY;

            // Lock direction on first significant movement
            if (!_swipeDirection) {
                if (Math.abs(deltaX) > DIRECTION_LOCK || Math.abs(deltaY) > DIRECTION_LOCK) {
                    _swipeDirection = Math.abs(deltaX) > Math.abs(deltaY) ? 'horizontal' : 'vertical';
                }
                if (_swipeDirection !== 'horizontal') return;
            }

            if (_swipeDirection !== 'horizontal') return;

            // Only allow swipe left (negative deltaX)
            if (deltaX >= 0) {
                _swipeMsgEl.style.transform = '';
                return;
            }

            // Cancel long press
            clearTimeout(longPressTimer);

            // Clamp max swipe to -100px
            const clampedX = Math.max(deltaX, -100);
            _swipeMsgEl.style.transform = `translateX(${clampedX}px)`;
        }, { passive: true });

        messagesContainer.addEventListener('touchend', () => {
            if (!_swipeMsgEl) return;
            const msgEl = _swipeMsgEl;
            _swipeMsgEl = null;

            // Snap back with animation
            msgEl.style.transition = 'transform 0.25s ease';
            const currentTransform = msgEl.style.transform;
            const match = currentTransform.match(/translateX\((-?\d+(?:\.\d+)?)px\)/);
            const deltaX = match ? parseFloat(match[1]) : 0;

            msgEl.style.transform = '';

            // Trigger reply if swiped beyond threshold
            if (deltaX < -SWIPE_THRESHOLD) {
                const msgId = msgEl.dataset.msgId;
                _setReplyTo(msgId);
            }

            _swipeDirection = null;
        }, { passive: true });

        // ── Reply bar close button ──
        document.getElementById('dc_reply_bar_close')?.addEventListener('click', () => {
            _clearReplyTo();
        });

        // Click delegation: delete mode, edit mode, reactions, spoilers, lightbox
        messagesContainer.addEventListener('click', (e) => {
            // Delete mode: toggle selection
            if (_isDeleteMode) {
                const msgEl = e.target.closest('.dc-message');
                if (msgEl) {
                    e.stopPropagation();
                    const msgId = msgEl.dataset.msgId;
                    _toggleSelectMessage(msgId, msgEl);
                    return;
                }
            }

            // Edit mode: open edit overlay
            if (_isEditMode) {
                const msgEl = e.target.closest('.dc-message');
                if (msgEl) {
                    e.stopPropagation();
                    _openEditOverlay(msgEl.dataset.msgId);
                    return;
                }
            }

            // Image click → lightbox
            const imgBubble = e.target.closest('.dc-msg-image');
            if (imgBubble) {
                e.stopPropagation();
                const fullSrc = imgBubble.dataset.fullSrc;
                if (fullSrc) showDiscordImageLightbox(fullSrc);
                return;
            }

            // Reaction pill click (toggle self reaction)
            const pill = e.target.closest('.dc-reaction-pill');
            if (pill) {
                _handleReactionPillClick(pill);
                return;
            }

            // Spoiler click-to-reveal
            const spoiler = e.target.closest('.dc-md-spoiler');
            if (spoiler) {
                spoiler.classList.toggle('dc-spoiler-revealed');
            }
        });
    }

    // Context menu dismiss is now handled by the backdrop in _showContextMenu
}

// ═══════════════════════════════════════════════════════════════════════
// Input & Send
// ═══════════════════════════════════════════════════════════════════════

function _handleInputChange(input) {
    const val = input.value;

    // Check for @ mention trigger
    const atMatch = val.match(/@(\S*)$/);
    if (atMatch) {
        _showMentionDropdown(atMatch[1]);
    } else {
        _hideMentionDropdown();
    }

    // Update send/kiwi button states
    _updateButtonStates();
}

// ═══════════════════════════════════════════════════════════════════════
// 🥝 Kiwi Draft System (mirrors Chat App's pending message pattern)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Add current input text to the pending drafts queue.
 */
function _addPendingMessage() {
    const input = document.getElementById('dc_chat_input');
    const text = input?.value?.trim();
    if (!text) return;

    _pendingMessages.push(text);
    input.value = '';
    input.focus();

    _renderDraftArea();
    _updateButtonStates();
}

/**
 * Remove a draft by index.
 */
function _removePendingMessage(index) {
    _pendingMessages.splice(index, 1);
    _renderDraftArea();
    _updateButtonStates();
}

/**
 * Render the draft area above the input bar.
 */
function _renderDraftArea() {
    const area = document.getElementById('dc_draft_area');
    const list = document.getElementById('dc_draft_list');
    if (!area || !list) return;

    if (_pendingMessages.length === 0 && !_pendingImageData) {
        area.style.display = 'none';
        return;
    }

    area.style.display = 'flex';

    let html = '';

    // ── Image draft (shown first if present) ──
    if (_pendingImageData) {
        html += `
        <div class="dc-draft-bubble dc-draft-image" data-draft-type="image">
            <img src="${escapeHtml(_pendingImageData.thumbnail)}" alt="图片" />
            <span class="dc-draft-image-remove"><i class="ph ph-x"></i></span>
        </div>`;
    }

    // ── Text drafts ──
    html += _pendingMessages.map((msg, i) =>
        `<div class="dc-draft-bubble" data-draft-index="${i}">${escapeHtml(msg)}</div>`
    ).join('');

    list.innerHTML = html;

    // Click to remove text drafts
    list.querySelectorAll('.dc-draft-bubble[data-draft-index]').forEach(el => {
        el.addEventListener('click', () => {
            const idx = parseInt(el.dataset.draftIndex);
            _removePendingMessage(idx);
        });
    });

    // Click to remove image draft
    const imgDraft = list.querySelector('.dc-draft-image');
    if (imgDraft) {
        imgDraft.addEventListener('click', () => {
            _pendingImageData = null;
            _renderDraftArea();
            _updateButtonStates();
        });
    }
}

/**
 * Update kiwi + send button visual states.
 */
function _updateButtonStates() {
    const input = document.getElementById('dc_chat_input');
    const sendBtn = document.getElementById('dc_send_btn');
    const kiwiBtn = document.getElementById('dc_kiwi_btn');
    const hasText = input?.value?.trim().length > 0;
    const hasDrafts = _pendingMessages.length > 0;
    const hasImage = !!_pendingImageData;

    if (sendBtn) {
        // Send enabled when there are drafts OR text in input OR image pending
        sendBtn.disabled = !hasText && !hasDrafts && !hasImage;
    }

    if (kiwiBtn) {
        kiwiBtn.style.opacity = hasText ? '1' : '0.4';
    }
}

/**
 * Set the reply-to state and show the reply bar.
 */
function _setReplyTo(msgId) {
    const messages = loadChannelMessages(_currentChannelId);
    const msg = messages.find(m => m.id === msgId);
    if (!msg) return;

    _replyToMsg = {
        id: msg.id,
        authorName: msg.authorName || '未知',
        content: msg.content || '',
    };

    const bar = document.getElementById('dc_reply_bar');
    const nameEl = document.getElementById('dc_reply_bar_name');
    const textEl = document.getElementById('dc_reply_bar_text');
    if (bar && nameEl && textEl) {
        nameEl.textContent = _replyToMsg.authorName;
        textEl.textContent = _replyToMsg.content.length > 50
            ? _replyToMsg.content.substring(0, 50) + '…'
            : _replyToMsg.content;
        bar.style.display = 'flex';
    }

    // Focus input so user can type right away
    document.getElementById('dc_chat_input')?.focus();
}

/**
 * Clear the reply-to state and hide the reply bar.
 */
function _clearReplyTo() {
    _replyToMsg = null;
    const bar = document.getElementById('dc_reply_bar');
    if (bar) bar.style.display = 'none';
}

/**
 * Send all pending drafts + any remaining input text.
 */
async function _handleSendAll() {
    const input = document.getElementById('dc_chat_input');
    const remainingText = input?.value?.trim();

    // Add remaining input text to the drafts
    if (remainingText) {
        _pendingMessages.push(remainingText);
    }

    // Capture image data (if any)
    const imageData = _pendingImageData;
    _pendingImageData = null;

    // If we have an image but no text messages, add a placeholder
    if (imageData && _pendingMessages.length === 0) {
        _pendingMessages.push('[图片]');
    }

    if (_pendingMessages.length === 0) return;

    // Snapshot and clear
    const messagesToSend = [..._pendingMessages];
    _pendingMessages = [];

    // Capture and clear reply-to
    const replyToId = _replyToMsg?.id || null;
    _clearReplyTo();

    // Clear UI
    if (input) { input.value = ''; input.focus(); }
    _mentionIds = [];
    _updateMentionBar();
    _renderDraftArea();
    _updateButtonStates();

    // Extract @mentions from all texts
    const members = loadMembers();
    const mentions = [];
    for (const text of messagesToSend) {
        for (const m of members) {
            if (text.includes(`@${m.name}`) && !mentions.includes(m.id)) {
                mentions.push(m.id);
            }
        }
    }

    // Upload image to ST file system (if any) — replaces base64 with web path
    if (imageData?.thumbnail) {
        try {
            const webPath = await uploadFileToST(imageData.thumbnail, 'discord_img');
            imageData.thumbnail = webPath;
        } catch (e) {
            console.error(`${LOG} Image upload failed, using base64 fallback:`, e);
        }
    }

    // Send all messages (handler will broadcast each to our callback)
    const result = await sendUserMessages(_currentChannelId, messagesToSend, mentions, imageData, replyToId);
    if (!result.success && result.error) {
        console.error(`${LOG} Send failed:`, result.error);
        if (typeof toastr !== 'undefined') toastr.error(`发送失败: ${result.error}`);
    }
}

// ═══════════════════════════════════════════════════════════════════════
// @Mention Dropdown
// ═══════════════════════════════════════════════════════════════════════

function _showMentionDropdown(filter) {
    const dropdown = document.getElementById('dc_mention_dropdown');
    if (!dropdown) return;

    const members = loadMembers().filter(m => !m.isUser);
    const lowerFilter = filter.toLowerCase();
    const filtered = lowerFilter
        ? members.filter(m => m.name.toLowerCase().includes(lowerFilter))
        : members;

    if (filtered.length === 0) {
        _hideMentionDropdown();
        return;
    }

    dropdown.innerHTML = filtered.map(m => {
        const color = getMemberColor(m);
        const initial = (m.name || '?').charAt(0);
        const avatarBg = m.avatarColor || '#5865f2';
        const avatarUrl = getMemberAvatarUrl(m);
        const avatarContent = avatarUrl
            ? `<img src="${avatarUrl}" alt="" />`
            : escapeHtml(initial);
        return `
            <div class="dc-mention-item" data-member-id="${m.id}" data-member-name="${escapeHtml(m.name)}">
                <div class="dc-avatar small" style="background:${avatarBg}">${avatarContent}</div>
                <span style="color:${color}">${escapeHtml(m.name)}</span>
            </div>
        `;
    }).join('');

    dropdown.style.display = 'flex';

    // Bind click events
    dropdown.querySelectorAll('.dc-mention-item').forEach(item => {
        item.addEventListener('click', () => {
            const name = item.dataset.memberName;
            const memberId = item.dataset.memberId;
            const input = document.getElementById('dc_chat_input');
            if (input) {
                // Replace the @partial with @fullname
                input.value = input.value.replace(/@\S*$/, `@${name} `);
                input.focus();
                _handleInputChange(input);
            }
            if (!_mentionIds.includes(memberId)) {
                _mentionIds.push(memberId);
            }
            _updateMentionBar();
            _hideMentionDropdown();
        });
    });
}

function _hideMentionDropdown() {
    const dropdown = document.getElementById('dc_mention_dropdown');
    if (dropdown) dropdown.style.display = 'none';
}

function _updateMentionBar() {
    const bar = document.getElementById('dc_mention_bar');
    if (!bar) return;

    if (_mentionIds.length === 0) {
        bar.style.display = 'none';
        return;
    }

    const members = loadMembers();
    const pills = _mentionIds.map(id => {
        const m = members.find(mem => mem.id === id);
        if (!m) return '';
        return `
            <span class="dc-mention-pill">
                @${escapeHtml(m.name)}
                <i class="ph ph-x dc-mention-pill-remove" data-member-id="${id}"></i>
            </span>
        `;
    }).join('');

    bar.innerHTML = pills;
    bar.style.display = 'flex';

    // Remove mention click
    bar.querySelectorAll('.dc-mention-pill-remove').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.memberId;
            _mentionIds = _mentionIds.filter(mid => mid !== id);
            _updateMentionBar();
        });
    });
}

// ═══════════════════════════════════════════════════════════════════════
// Real-time Updates (Message & Typing Callbacks)
// ═══════════════════════════════════════════════════════════════════════

function _subscribeToUpdates() {
    // Clean up old subscriptions
    _cleanup();

    // ── New message callback ──
    _unsubMessage = onMessageReceived((message, channelId) => {
        if (channelId !== _currentChannelId) return;

        if (message._reactionUpdate) {
            // Reaction update — re-render just that message's reactions
            _updateMessageReactions(message);
            return;
        }

        // Append new message to the list
        _appendMessageToUI(message);
    });

    // ── Typing indicator callback ──
    _unsubTyping = onTypingStateChange((isTyping, memberNames, channelId) => {
        if (channelId !== _currentChannelId) return;
        _renderTypingIndicator(isTyping, memberNames);
    });

    // ── Restore typing indicator if LLM is already generating for this channel ──
    const currentTyping = getTypingState();
    if (currentTyping.isTyping && currentTyping.channelId === _currentChannelId) {
        _renderTypingIndicator(true, currentTyping.memberNames);
    }
}

/**
 * Render typing indicator UI (extracted to avoid duplication between
 * callback handler and state restoration on channel re-entry).
 */
function _renderTypingIndicator(isTyping, memberNames) {
    const typingArea = document.getElementById('dc_typing_area');
    const typingText = document.getElementById('dc_typing_text');
    if (!typingArea || !typingText) return;

    if (isTyping && memberNames.length > 0) {
        let text;
        if (memberNames.length === 1) {
            text = `${memberNames[0]} 正在输入...`;
        } else if (memberNames.length <= 3) {
            text = `${memberNames.join('、')} 正在输入...`;
        } else {
            text = `${memberNames.length} 人正在输入...`;
        }
        typingText.textContent = text;
        typingArea.style.display = 'flex';
    } else {
        typingArea.style.display = 'none';
    }
}

function _cleanup() {
    if (_unsubMessage) { _unsubMessage(); _unsubMessage = null; }
    if (_unsubTyping) { _unsubTyping(); _unsubTyping = null; }
}

function _appendMessageToUI(message) {
    const container = document.getElementById('dc_channel_messages');
    if (!container) return;

    // Remove welcome message if present
    const welcome = container.querySelector('.dc-channel-welcome');
    if (welcome) welcome.remove();

    const members = loadMembers();
    const roles = loadRoles();
    const memberMap = {};
    for (const m of members) memberMap[m.id] = m;
    const roleMap = {};
    for (const r of roles) roleMap[r.id] = r;

    // Check if consecutive with last message
    const lastMsgEl = container.querySelector('.dc-message:last-child');
    let isConsecutive = false;
    if (lastMsgEl) {
        const lastMsgId = lastMsgEl.dataset.msgId;
        const allMsgs = loadChannelMessages(_currentChannelId);
        const lastMsg = allMsgs.find(m => m.id === lastMsgId);
        if (lastMsg) {
            isConsecutive = _isConsecutiveMessage(message, lastMsg.authorId, lastMsg.timestamp);
        }
    }

    const member = memberMap[message.authorId];
    const index = container.querySelectorAll('.dc-message').length;
    const msgHtml = _buildSingleMessageHtml(message, member, members, roleMap, isConsecutive, index);

    container.insertAdjacentHTML('beforeend', msgHtml);

    // Animate the new message
    const newMsgEl = container.querySelector(`[data-msg-id="${message.id}"]`);
    if (newMsgEl) {
        newMsgEl.classList.add('dc-msg-enter');
    }

    _scrollToBottom(true);
}

function _updateMessageReactions(message) {
    const msgEl = document.querySelector(`[data-msg-id="${message.id}"]`);
    if (!msgEl) return;

    // Remove old reactions and add new
    const oldReactions = msgEl.querySelector('.dc-reactions');
    if (oldReactions) oldReactions.remove();

    const newReactionsHtml = _buildReactionsHtml(message);
    if (newReactionsHtml) {
        const bodyEl = msgEl.querySelector('.dc-message-body');
        if (bodyEl) bodyEl.insertAdjacentHTML('beforeend', newReactionsHtml);
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Context Menu (Long Press)
// ═══════════════════════════════════════════════════════════════════════

function _showContextMenu(msgEl, event) {
    const menu = document.getElementById('dc_context_menu');
    if (!menu) return;

    const msgId = msgEl.dataset.msgId;
    const messages = loadChannelMessages(_currentChannelId);
    const msg = messages.find(m => m.id === msgId);
    if (!msg) return;

    const userMember = getUserMember();
    const isMyMessage = msg.authorId === userMember?.id;

    // Quick reaction row
    const quickReactions = getQuickReactions();
    const quickReactionHtml = quickReactions.map(emoji =>
        `<div class="dc-ctx-reaction" data-emoji="${emoji}" data-msg-id="${msgId}">${emoji}</div>`
    ).join('');

    let menuItems = `
        <div class="dc-ctx-reactions-row">${quickReactionHtml}</div>
        <div class="dc-ctx-divider"></div>
        <div class="dc-ctx-item" data-action="reply" data-msg-id="${msgId}">
            <i class="ph ph-arrow-bend-up-left"></i>
            <span>回复</span>
        </div>
    `;

    if (isMyMessage) {
        menuItems += `
            <div class="dc-ctx-item dc-ctx-danger" data-action="delete" data-msg-id="${msgId}">
                <i class="ph ph-trash"></i>
                <span>删除消息</span>
            </div>
        `;
    }

    menu.innerHTML = menuItems;

    // Position menu near the long-press point
    const page = document.getElementById('dc_channel_page');
    if (page) {
        const pageRect = page.getBoundingClientRect();
        let top = event.clientY - pageRect.top;
        let left = event.clientX - pageRect.left;

        // Keep within bounds
        const menuWidth = 220;
        const menuHeight = 160;
        if (left + menuWidth > pageRect.width) left = pageRect.width - menuWidth - 8;
        if (top + menuHeight > pageRect.height) top = top - menuHeight;
        if (left < 8) left = 8;
        if (top < 8) top = 8;

        menu.style.top = `${top}px`;
        menu.style.left = `${left}px`;
    }

    menu.style.display = 'flex';
    _contextMenuOpen = true;

    // ── Create transparent backdrop to capture dismiss clicks ──
    let backdrop = document.getElementById('dc_context_backdrop');
    if (!backdrop) {
        backdrop = document.createElement('div');
        backdrop.id = 'dc_context_backdrop';
        backdrop.className = 'dc-context-backdrop';
        page?.appendChild(backdrop);
    }
    backdrop.style.display = 'block';

    // Dismiss on backdrop click/touch (single use)
    const dismissHandler = (e) => {
        e.preventDefault();
        e.stopPropagation();
        backdrop.removeEventListener('pointerdown', dismissHandler);
        _hideContextMenu();
    };
    backdrop.addEventListener('pointerdown', dismissHandler);

    // ── Bind context menu events ──

    // Reply
    menu.querySelector('[data-action="reply"]')?.addEventListener('click', () => {
        _setReplyTo(msgId);
        _hideContextMenu();
    });

    // Quick reaction
    menu.querySelectorAll('.dc-ctx-reaction').forEach(el => {
        el.addEventListener('click', () => {
            const emoji = el.dataset.emoji;
            _addReactionToMessage(msgId, emoji);
            _hideContextMenu();
        });
    });

    // Delete
    menu.querySelector('[data-action="delete"]')?.addEventListener('click', () => {
        _deleteMessage(msgId);
        _hideContextMenu();
    });
}

function _hideContextMenu() {
    const menu = document.getElementById('dc_context_menu');
    if (menu) menu.style.display = 'none';
    _contextMenuOpen = false;

    // Remove backdrop
    const backdrop = document.getElementById('dc_context_backdrop');
    if (backdrop) backdrop.style.display = 'none';
}

// ═══════════════════════════════════════════════════════════════════════
// Reaction Handling
// ═══════════════════════════════════════════════════════════════════════

function _addReactionToMessage(msgId, emoji) {
    const userMember = getUserMember();
    if (!userMember) return;

    const messages = loadChannelMessages(_currentChannelId);
    const msg = messages.find(m => m.id === msgId);
    if (!msg) return;

    if (!msg.reactions) msg.reactions = [];

    const existing = msg.reactions.find(r => r.emoji === emoji);
    if (existing) {
        if (existing.users.includes(userMember.id)) {
            // Remove user's reaction
            existing.users = existing.users.filter(u => u !== userMember.id);
            if (existing.users.length === 0) {
                msg.reactions = msg.reactions.filter(r => r.emoji !== emoji);
            }
        } else {
            existing.users.push(userMember.id);
        }
    } else {
        msg.reactions.push({ emoji, users: [userMember.id] });
    }

    saveChannelMessages(_currentChannelId, messages);
    _updateMessageReactions(msg);
}

function _handleReactionPillClick(pill) {
    const msgId = pill.dataset.msgId;
    const emoji = pill.dataset.emoji;
    if (msgId && emoji) {
        _addReactionToMessage(msgId, emoji);
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Delete Message (single)
// ═══════════════════════════════════════════════════════════════════════

function _deleteMessage(msgId) {
    const messages = loadChannelMessages(_currentChannelId);
    const filtered = messages.filter(m => m.id !== msgId);
    saveChannelMessages(_currentChannelId, filtered);

    // Remove from UI
    const msgEl = document.querySelector(`[data-msg-id="${msgId}"]`);
    if (msgEl) {
        msgEl.style.opacity = '0';
        msgEl.style.transform = 'translateX(-20px)';
        msgEl.style.transition = 'all 0.2s ease';
        setTimeout(() => msgEl.remove(), 200);
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Delete Mode (Batch Select)
// ═══════════════════════════════════════════════════════════════════════

function _toggleDeleteMode() {
    _isDeleteMode = !_isDeleteMode;
    _selectedForDeletion.clear();

    // Exit edit mode if active
    if (_isDeleteMode && _isEditMode) _toggleEditMode();

    const msgs = document.querySelectorAll('.dc-message');
    const inputArea = document.getElementById('dc_channel_input_area');
    const deleteToolbar = document.getElementById('dc_delete_toolbar');

    msgs.forEach(msg => {
        if (_isDeleteMode) {
            msg.classList.add('dc-delete-mode');
            msg.classList.remove('dc-selected');
        } else {
            msg.classList.remove('dc-delete-mode', 'dc-selected');
        }
    });

    if (inputArea) inputArea.style.display = _isDeleteMode ? 'none' : '';
    if (deleteToolbar) deleteToolbar.style.display = _isDeleteMode ? 'flex' : 'none';

    const btn = document.getElementById('dc_delete_mode_btn');
    if (btn) btn.textContent = _isDeleteMode ? '退出删除模式' : '删除消息';

    if (_isDeleteMode) _updateDeleteToolbar();
}

function _toggleSelectMessage(msgId, msgEl) {
    if (_selectedForDeletion.has(msgId)) {
        _selectedForDeletion.delete(msgId);
        msgEl.classList.remove('dc-selected');
    } else {
        _selectedForDeletion.add(msgId);
        msgEl.classList.add('dc-selected');
    }
    _updateDeleteToolbar();
}

function _handleSelectAll() {
    const msgs = document.querySelectorAll('.dc-message');
    const allSelected = _selectedForDeletion.size === msgs.length;
    if (allSelected) {
        _selectedForDeletion.clear();
        msgs.forEach(m => m.classList.remove('dc-selected'));
    } else {
        msgs.forEach(m => {
            _selectedForDeletion.add(m.dataset.msgId);
            m.classList.add('dc-selected');
        });
    }
    _updateDeleteToolbar();

    const btn = document.getElementById('dc_select_all_btn');
    if (btn) btn.textContent = allSelected ? '全选' : '取消全选';
}

function _updateDeleteToolbar() {
    const countEl = document.getElementById('dc_delete_count');
    const confirmBtn = document.getElementById('dc_delete_confirm_btn');
    const count = _selectedForDeletion.size;
    if (countEl) countEl.textContent = `已选 ${count} 条`;
    if (confirmBtn) confirmBtn.disabled = count === 0;
}

function _handleBatchDelete() {
    const count = _selectedForDeletion.size;
    if (count === 0) return;
    if (!confirm(`确定删除 ${count} 条消息吗？`)) return;

    const messages = loadChannelMessages(_currentChannelId);
    const filtered = messages.filter(m => !_selectedForDeletion.has(m.id));
    saveChannelMessages(_currentChannelId, filtered);
    console.log(`${LOG} Batch deleted ${count} messages`);

    _selectedForDeletion.clear();
    _rerenderMessages();

    if (_isDeleteMode) {
        document.querySelectorAll('.dc-message').forEach(m => m.classList.add('dc-delete-mode'));
    }
    _updateDeleteToolbar();
}

// ═══════════════════════════════════════════════════════════════════════
// Edit Mode
// ═══════════════════════════════════════════════════════════════════════

function _toggleEditMode() {
    _isEditMode = !_isEditMode;
    _selectedEditMsgId = null;

    // Exit delete mode if active
    if (_isEditMode && _isDeleteMode) _toggleDeleteMode();

    const msgs = document.querySelectorAll('.dc-message');
    const inputArea = document.getElementById('dc_channel_input_area');

    msgs.forEach(msg => {
        if (_isEditMode) {
            msg.classList.add('dc-edit-mode');
        } else {
            msg.classList.remove('dc-edit-mode');
        }
    });

    if (inputArea) inputArea.style.display = _isEditMode ? 'none' : '';

    const btn = document.getElementById('dc_edit_mode_btn');
    if (btn) btn.textContent = _isEditMode ? '退出编辑模式' : '编辑消息';
}

function _openEditOverlay(msgId) {
    const messages = loadChannelMessages(_currentChannelId);
    const msg = messages.find(m => m.id === msgId);
    if (!msg) return;

    _selectedEditMsgId = msgId;

    const textarea = document.getElementById('dc_edit_textarea');
    if (textarea) {
        textarea.value = msg.content || '';
        textarea.style.height = 'auto';
        textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
    }

    const overlay = document.getElementById('dc_edit_overlay');
    overlay?.classList.add('active');

    requestAnimationFrame(() => textarea?.focus());
}

function _closeEditOverlay() {
    document.getElementById('dc_edit_overlay')?.classList.remove('active');
    _selectedEditMsgId = null;
    if (_isEditMode) _toggleEditMode();
}

function _handleEditSave() {
    if (!_selectedEditMsgId) return;

    const textarea = document.getElementById('dc_edit_textarea');
    const newContent = textarea?.value?.trim();
    if (!newContent) return;

    const messages = loadChannelMessages(_currentChannelId);
    const msg = messages.find(m => m.id === _selectedEditMsgId);
    if (!msg) return;

    msg.content = newContent;
    saveChannelMessages(_currentChannelId, messages);
    console.log(`${LOG} Edited message ${_selectedEditMsgId}`);

    _closeEditOverlay();
    _rerenderMessages();
}

// ═══════════════════════════════════════════════════════════════════════
// Reroll (Regenerate Last Response)
// ═══════════════════════════════════════════════════════════════════════

async function _rerollLastResponse() {
    if (_isGenerating) return;

    const messages = loadChannelMessages(_currentChannelId);
    if (messages.length === 0) return;

    const userMember = getUserMember();
    const userId = userMember?.id;

    // Remove trailing non-user messages (NPC responses)
    let removedCount = 0;
    while (messages.length > 0 && messages[messages.length - 1].authorId !== userId) {
        messages.pop();
        removedCount++;
    }

    if (removedCount === 0) {
        console.log(`${LOG} No trailing NPC messages to reroll`);
        return;
    }

    // Collect AND remove trailing user messages (sendUserMessages will re-create them)
    const lastUserTexts = [];
    const lastUserMentions = [];
    let lastImageData = null;
    let lastReplyToId = null;

    while (messages.length > 0 && messages[messages.length - 1].authorId === userId) {
        const msg = messages.pop();
        if (msg.content !== '[图片]') {
            lastUserTexts.unshift(msg.content);
        }
        if (msg.mentions) lastUserMentions.push(...msg.mentions);
        
        if (msg.imageUrl && !lastImageData) {
            lastImageData = { thumbnail: msg.imageUrl };
        }
        if (msg.replyTo && !lastReplyToId) {
            lastReplyToId = msg.replyTo;
        }
    }

    if (lastUserTexts.length === 0 && !lastImageData) {
        console.warn(`${LOG} No user messages found for reroll`);
        return;
    }

    // Save trimmed history (without the removed NPC + user messages)
    saveChannelMessages(_currentChannelId, messages);
    _rerenderMessages();

    // Exit modes if active
    if (_isDeleteMode) _toggleDeleteMode();
    if (_isEditMode) _toggleEditMode();

    // Re-send user messages → creates new user msgs + triggers new LLM response
    _isGenerating = true;
    console.log(`${LOG} Reroll: removed ${removedCount} NPC + ${lastUserTexts.length} user messages, re-sending...`);

    const result = await sendUserMessages(
        _currentChannelId, 
        lastUserTexts.length ? lastUserTexts : ['[图片]'], 
        [...new Set(lastUserMentions)],
        lastImageData,
        lastReplyToId
    );
    _isGenerating = false;

    if (!result.success && result.error) {
        console.error(`${LOG} Reroll failed:`, result.error);
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Auto Chat (Let Them Chat — on-demand group conversation)
// ═══════════════════════════════════════════════════════════════════════

async function _triggerAutoChat() {
    if (_isGenerating) return;

    const allMembers = loadMembers();
    const npcMembers = allMembers.filter(m => !m.isUser);

    if (npcMembers.length < 2) {
        console.warn(`${LOG} Not enough NPC members for auto chat`);
        return;
    }

    // Select 2-4 random NPC participants
    const shuffled = [...npcMembers].sort(() => Math.random() - 0.5);
    const count = Math.min(shuffled.length, 2 + Math.floor(Math.random() * 3)); // 2-4
    const participants = shuffled.slice(0, count);

    _isGenerating = true;
    console.log(`${LOG} Auto chat: ${participants.map(p => p.name).join(', ')} in channel ${_currentChannelId}`);

    const result = await generateAutoConversation(_currentChannelId, participants);
    _isGenerating = false;

    if (result.success) {
        console.log(`${LOG} Auto chat generated ${result.messageCount} messages`);
    } else {
        console.error(`${LOG} Auto chat failed:`, result.error);
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Re-render Messages (shared helper for delete/edit)
// ═══════════════════════════════════════════════════════════════════════

function _rerenderMessages() {
    const container = document.getElementById('dc_channel_messages');
    if (!container) return;

    const messages = loadChannelMessages(_currentChannelId);
    const members = loadMembers();
    const roles = loadRoles();

    const html = _buildMessagesHtml(messages, members, roles);
    container.innerHTML = html || _buildWelcomeHtml();
    _scrollToBottom(false);
}

// ═══════════════════════════════════════════════════════════════════════
// Member Drawer (Right Slide)
// ═══════════════════════════════════════════════════════════════════════

function _toggleMemberDrawer() {
    if (_memberDrawerOpen) {
        _closeMemberDrawer();
    } else {
        _openMemberDrawer();
    }
}

function _openMemberDrawer() {
    _memberDrawerOpen = true;
    const drawer = document.getElementById('dc_member_drawer');
    const overlay = document.getElementById('dc_drawer_overlay');
    if (!drawer || !overlay) return;

    // Populate drawer body
    const body = document.getElementById('dc_drawer_body');
    if (body) body.innerHTML = _buildDrawerMembersHtml();

    overlay.style.display = 'block';
    requestAnimationFrame(() => {
        drawer.classList.add('dc-drawer-open');
        overlay.classList.add('dc-drawer-overlay-visible');
    });
}

function _closeMemberDrawer() {
    _memberDrawerOpen = false;
    const drawer = document.getElementById('dc_member_drawer');
    const overlay = document.getElementById('dc_drawer_overlay');
    if (drawer) drawer.classList.remove('dc-drawer-open');
    if (overlay) {
        overlay.classList.remove('dc-drawer-overlay-visible');
        setTimeout(() => { overlay.style.display = 'none'; }, 300);
    }
}

function _buildDrawerMembersHtml() {
    const members = loadMembers();
    const roles = loadRoles();
    const roleMap = {};
    for (const r of roles) roleMap[r.id] = r;

    // Group by role (same logic as discordMembers)
    const sortedRoles = [...roles].sort((a, b) => a.order - b.order);
    const groups = [];
    const placed = new Set();

    for (const role of sortedRoles) {
        const roleMembers = members.filter(m => {
            if (placed.has(m.id)) return false;
            return m.roles?.includes(role.id);
        });
        if (roleMembers.length > 0) {
            roleMembers.forEach(m => placed.add(m.id));
            groups.push({ name: role.name, color: role.color, members: roleMembers });
        }
    }

    const unplaced = members.filter(m => !placed.has(m.id));
    if (unplaced.length > 0) {
        groups.push({ name: '无身份组', color: '#99aab5', members: unplaced });
    }

    return groups.map(g => {
        const memberItems = g.members.map(m => {
            const nameColor = getMemberColor(m);
            const avatarBg = m.avatarColor || '#5865f2';
            const initial = (m.name || '?').charAt(0);
            const avatarUrl = getMemberAvatarUrl(m);
            const avatarContent = avatarUrl
                ? `<img src="${avatarUrl}" alt="" />`
                : escapeHtml(initial);

            return `
                <div class="dc-drawer-member">
                    <div class="dc-avatar small" style="background:${avatarBg}">${avatarContent}</div>
                    <span class="dc-drawer-member-name" style="color:${nameColor}">${escapeHtml(m.name)}</span>
                </div>
            `;
        }).join('');

        return `
            <div class="dc-drawer-group">
                <div class="dc-drawer-group-header" style="color:${g.color}">
                    ${escapeHtml(g.name)} — ${g.members.length}
                </div>
                ${memberItems}
            </div>
        `;
    }).join('');
}

// ═══════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════

function _scrollToBottom(smooth = true) {
    requestAnimationFrame(() => {
        const container = document.getElementById('dc_channel_messages');
        if (container) {
            container.scrollTo({
                top: container.scrollHeight,
                behavior: smooth ? 'smooth' : 'instant',
            });
        }
    });
}

function _formatTimestamp(iso) {
    if (!iso) return '';
    const date = new Date(iso);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();

    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    const timeStr = `${hh}:${mm}`;

    if (isToday) return `今天 ${timeStr}`;

    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) return `昨天 ${timeStr}`;

    const month = date.getMonth() + 1;
    const day = date.getDate();
    return `${month}/${day} ${timeStr}`;
}

function _escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
