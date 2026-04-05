// modules/phone/discord/discordStorage.js — chat_metadata data layer for Discord Community App
// Manages: server config, members, roles, channel messages, emojis, summaries.
// Persisted inside ST .jsonl chat file (cross-device sync via chat_metadata).

import { getContext, saveMetadataDebounced } from '../../../../../../extensions.js';
import { chat_metadata } from '../../../../../../../script.js';
import { getPhoneCharInfo, getPhoneUserName } from '../phoneContext.js';
import { user_avatar } from '../../../../../../personas.js';

// ═══════════════════════════════════════════════════════════════════════
// chat_metadata Namespace
// ═══════════════════════════════════════════════════════════════════════
//
// All Discord data lives under:  chat_metadata.gf_discord = { ... }
//
// Shape:
//   gf_discord.server        — server config object
//   gf_discord.members       — member array
//   gf_discord.roles         — role array
//   gf_discord.emojis        — custom emoji array
//   gf_discord.autoChatConfig — { enabled, interval }
//   gf_discord.messages      — { [channelId]: messageArray }
//   gf_discord.summaries     — { [channelId]: summaryObject }

const META_KEY = 'gf_discord';
const LOG = '[Discord Storage]';

// ═══════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════

/** Ensure the gf_discord namespace exists in chat_metadata */
function _ensureNamespace() {
    if (chat_metadata && !chat_metadata[META_KEY]) {
        chat_metadata[META_KEY] = {};
    }
}

/**
 * Load a value from the Discord namespace in chat_metadata.
 * @param {string} key - Sub-key within gf_discord (e.g. 'server', 'members')
 * @param {*} fallback - Default value if key missing
 */
function _load(key, fallback = null) {
    try {
        const ns = chat_metadata?.[META_KEY];
        if (!ns) return fallback;
        const val = ns[key];
        return val !== undefined && val !== null ? val : fallback;
    } catch (e) {
        console.warn(`${LOG} Failed to load ${key}:`, e);
        return fallback;
    }
}

/**
 * Save a value to the Discord namespace in chat_metadata.
 * @param {string} key - Sub-key within gf_discord
 * @param {*} data - Data to store
 */
function _save(key, data) {
    try {
        _ensureNamespace();
        if (chat_metadata) {
            chat_metadata[META_KEY][key] = data;
            saveMetadataDebounced();
        }
    } catch (e) {
        console.error(`${LOG} Failed to save ${key}:`, e);
    }
}

/** Generate a short unique ID */
export function generateId(prefix = 'id') {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

// ═══════════════════════════════════════════════════════════════════════
// ST File Upload — binary asset persistence
// ═══════════════════════════════════════════════════════════════════════

/**
 * Upload a base64 data URL to SillyTavern's file system.
 * Uses /api/files/upload — same pattern as voiceMessageService.uploadAudioToST().
 * @param {string} base64DataUrl - Full data URL (data:image/jpeg;base64,...)
 * @param {string} [prefix='discord'] - Filename prefix
 * @returns {Promise<string>} Web path (e.g. 'user/files/discord_emoji_xxx.jpg')
 */
export async function uploadFileToST(base64DataUrl, prefix = 'discord') {
    const base64Data = base64DataUrl.split(',')[1];
    if (!base64Data) throw new Error('Invalid base64 data URL');

    // Detect extension from MIME type
    const mimeMatch = base64DataUrl.match(/^data:image\/(\w+)/);
    const ext = mimeMatch?.[1] === 'png' ? 'png' : 'jpg';
    const filename = `${prefix}_${Date.now()}.${ext}`;

    return new Promise((resolve, reject) => {
        jQuery.ajax({
            url: '/api/files/upload',
            type: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({ name: filename, data: base64Data }),
            success: (result) => {
                const webPath = (result.path || `user/files/${filename}`).replace(/\\/g, '/');
                console.debug(`${LOG} Uploaded: ${webPath}`);
                resolve(webPath);
            },
            error: (xhr, status, err) => {
                console.error(`${LOG} Upload failed:`, xhr.responseText);
                reject(new Error(`Upload failed: ${xhr.status} ${err}`));
            },
        });
    });
}

// ═══════════════════════════════════════════════════════════════════════
// Server Config
// ═══════════════════════════════════════════════════════════════════════

/** Check if the server has been initialized */
export function isServerInitialized() {
    return !!chat_metadata?.[META_KEY]?.server;
}

/** Load server config */
export function loadServerConfig() {
    return _load('server', null);
}

/** Save server config */
export function saveServerConfig(config) {
    _save('server', config);
}

/**
 * Get a flat list of all channels across all categories.
 * @returns {Array<{id, name, categoryId, categoryName, order}>}
 */
export function getAllChannels() {
    const config = loadServerConfig();
    if (!config?.categories) return [];
    const channels = [];
    for (const cat of config.categories) {
        for (const ch of (cat.channels || [])) {
            channels.push({
                ...ch,
                categoryId: cat.id,
                categoryName: cat.name,
            });
        }
    }
    return channels;
}

/** Add a category to server config */
export function addCategory(name) {
    const config = loadServerConfig();
    if (!config) return null;
    const cat = {
        id: generateId('cat'),
        name,
        order: config.categories.length,
        channels: [],
    };
    config.categories.push(cat);
    saveServerConfig(config);
    return cat;
}

/** Add a channel to a category */
export function addChannel(categoryId, name) {
    const config = loadServerConfig();
    if (!config) return null;
    const cat = config.categories.find(c => c.id === categoryId);
    if (!cat) return null;
    const ch = {
        id: generateId('ch'),
        name,
        order: cat.channels.length,
    };
    cat.channels.push(ch);
    saveServerConfig(config);
    return ch;
}

/** Remove a channel */
export function removeChannel(channelId) {
    const config = loadServerConfig();
    if (!config) return;
    for (const cat of config.categories) {
        const idx = cat.channels.findIndex(c => c.id === channelId);
        if (idx !== -1) {
            cat.channels.splice(idx, 1);
            saveServerConfig(config);
            // Also clear channel messages & summary
            clearChannelMessages(channelId);
            return;
        }
    }
}

/** Remove a category and all its channels */
export function removeCategory(categoryId) {
    const config = loadServerConfig();
    if (!config) return;
    const idx = config.categories.findIndex(c => c.id === categoryId);
    if (idx === -1) return;
    const cat = config.categories[idx];
    // Clear all channel data in this category
    for (const ch of cat.channels) {
        clearChannelMessages(ch.id);
    }
    config.categories.splice(idx, 1);
    saveServerConfig(config);
}

// ═══════════════════════════════════════════════════════════════════════
// Members
// ═══════════════════════════════════════════════════════════════════════

/** Load all members */
export function loadMembers() {
    return _load('members', []);
}

/** Save all members */
export function saveMembers(members) {
    _save('members', members);
}

/** Add a new member */
export function addMember(member) {
    const members = loadMembers();
    members.push(member);
    saveMembers(members);
    return member;
}

/** Update an existing member by ID */
export function updateMember(memberId, updates) {
    const members = loadMembers();
    const idx = members.findIndex(m => m.id === memberId);
    if (idx === -1) return false;
    members[idx] = { ...members[idx], ...updates };
    saveMembers(members);
    return true;
}

/** Remove a member by ID (cannot remove protagonist or user) */
export function removeMember(memberId) {
    const members = loadMembers();
    const member = members.find(m => m.id === memberId);
    if (!member || member.isProtagonist || member.isUser) return false;
    const filtered = members.filter(m => m.id !== memberId);
    saveMembers(filtered);
    return true;
}

/** Get the protagonist member (ST char card) */
export function getProtagonist() {
    return loadMembers().find(m => m.isProtagonist) || null;
}

/** Get the user member */
export function getUserMember() {
    return loadMembers().find(m => m.isUser) || null;
}

/** Get all non-user members (for LLM response selection) */
export function getNonUserMembers() {
    return loadMembers().filter(m => !m.isUser);
}

/**
 * Resolve the effective avatar URL for a member.
 * If the member has a custom avatar set, returns it.
 * Otherwise falls back to ST's built-in avatars:
 *   - Protagonist (isProtagonist) → character card avatar at /characters/{filename}
 *   - User (isUser) → persona avatar at User Avatars/{user_avatar}
 * Returns null if no avatar is available.
 * @param {Object} member
 * @returns {string|null}
 */
export function getMemberAvatarUrl(member) {
    // 1. Custom avatar takes priority
    if (member?.avatar) return member.avatar;

    // 2. Protagonist → ST character card avatar
    if (member?.isProtagonist) {
        const charInfo = getPhoneCharInfo();
        if (charInfo?.avatar) {
            return `/characters/${encodeURIComponent(charInfo.avatar)}`;
        }
    }

    // 3. User → ST persona avatar
    if (member?.isUser) {
        if (user_avatar) {
            return `User Avatars/${user_avatar}`;
        }
    }

    return null;
}

// ═══════════════════════════════════════════════════════════════════════
// Roles (Identity Groups)
// ═══════════════════════════════════════════════════════════════════════

/** Load all roles */
export function loadRoles() {
    return _load('roles', []);
}

/** Save all roles */
export function saveRoles(roles) {
    _save('roles', roles);
}

/** Add a new role */
export function addRole(name, color = '#99aab5') {
    const roles = loadRoles();
    const role = {
        id: generateId('role'),
        name,
        color,
        order: roles.length,
    };
    roles.push(role);
    saveRoles(roles);
    return role;
}

/** Remove a role by ID */
export function removeRole(roleId) {
    const roles = loadRoles().filter(r => r.id !== roleId);
    saveRoles(roles);
    // Also remove this role from all members
    const members = loadMembers();
    let changed = false;
    for (const m of members) {
        if (m.roles?.includes(roleId)) {
            m.roles = m.roles.filter(r => r !== roleId);
            changed = true;
        }
    }
    if (changed) saveMembers(members);
}

/** Update a role */
export function updateRole(roleId, updates) {
    const roles = loadRoles();
    const idx = roles.findIndex(r => r.id === roleId);
    if (idx === -1) return false;
    roles[idx] = { ...roles[idx], ...updates };
    saveRoles(roles);
    return true;
}

/** Get the display color for a member (highest priority role color) */
export function getMemberColor(member) {
    if (!member?.roles?.length) return '#99aab5';
    const roles = loadRoles();
    const memberRoles = roles
        .filter(r => member.roles.includes(r.id))
        .sort((a, b) => a.order - b.order);
    return memberRoles[0]?.color || '#99aab5';
}

// ═══════════════════════════════════════════════════════════════════════
// Channel Messages
// ═══════════════════════════════════════════════════════════════════════

/**
 * Load messages for a channel.
 * @param {string} channelId
 * @returns {Array}
 */
export function loadChannelMessages(channelId) {
    const allMessages = _load('messages', {});
    return allMessages[channelId] || [];
}

/**
 * Save messages for a channel.
 * @param {string} channelId
 * @param {Array} messages
 */
export function saveChannelMessages(channelId, messages) {
    const allMessages = _load('messages', {});
    allMessages[channelId] = messages;
    _save('messages', allMessages);
}

/**
 * Append a single message to a channel.
 * @param {string} channelId
 * @param {Object} message
 * @returns {Object} The saved message (with generated ID)
 */
export function appendMessage(channelId, message) {
    const messages = loadChannelMessages(channelId);
    if (!message.id) message.id = generateId('msg');
    if (!message.timestamp) message.timestamp = new Date().toISOString();
    messages.push(message);
    saveChannelMessages(channelId, messages);
    return message;
}

/**
 * Get the last message in a channel (for preview).
 * @param {string} channelId
 * @returns {Object|null}
 */
export function getLastMessage(channelId) {
    const msgs = loadChannelMessages(channelId);
    return msgs.length > 0 ? msgs[msgs.length - 1] : null;
}

/**
 * Clear all messages in a channel.
 * @param {string} channelId
 */
export function clearChannelMessages(channelId) {
    // Clear messages
    const allMessages = _load('messages', {});
    delete allMessages[channelId];
    _save('messages', allMessages);

    // Clear summary
    const allSummaries = _load('summaries', {});
    delete allSummaries[channelId];
    _save('summaries', allSummaries);
}

// ═══════════════════════════════════════════════════════════════════════
// Custom Emojis
// ═══════════════════════════════════════════════════════════════════════

export function loadCustomEmojis() {
    return _load('emojis', []);
}

export function saveCustomEmojis(emojis) {
    _save('emojis', emojis);
}

export function addCustomEmoji(name, data, url = null) {
    const emojis = loadCustomEmojis();
    const emoji = {
        id: generateId('emoji'),
        name,
        data,       // web path (ST file) or null if URL-based
        url,        // external image URL (null if file-based)
        source: url ? 'url' : 'user',
    };
    emojis.push(emoji);
    saveCustomEmojis(emojis);
    return emoji;
}

export function removeCustomEmoji(emojiId) {
    const emojis = loadCustomEmojis().filter(e => e.id !== emojiId);
    saveCustomEmojis(emojis);
}

// ═══════════════════════════════════════════════════════════════════════
// Channel Summary (Rolling Compression)
// ═══════════════════════════════════════════════════════════════════════

export function loadChannelSummary(channelId) {
    const allSummaries = _load('summaries', {});
    return allSummaries[channelId] || null;
}

export function saveChannelSummary(channelId, data) {
    const allSummaries = _load('summaries', {});
    allSummaries[channelId] = data;
    _save('summaries', allSummaries);
}

// ═══════════════════════════════════════════════════════════════════════
// Auto-Chat Config
// ═══════════════════════════════════════════════════════════════════════

const DEFAULT_AUTO_CHAT = { enabled: false, interval: 30 };

export function loadAutoChatConfig() {
    return _load('autoChatConfig', { ...DEFAULT_AUTO_CHAT });
}

export function saveAutoChatConfig(config) {
    _save('autoChatConfig', config);
}

// ═══════════════════════════════════════════════════════════════════════
// Message Compression (Phase 5 stub — logic placeholder)
// ═══════════════════════════════════════════════════════════════════════

const COMPRESS_THRESHOLD = 300;
const KEEP_RECENT = 30;

/**
 * Check if channel needs compression and return the messages to compress.
 * Actual LLM summarization will be in discordMessageHandler (Phase 5).
 * @param {string} channelId
 * @returns {{ needed: boolean, toCompress: Array, toKeep: Array }}
 */
export function checkCompression(channelId) {
    const messages = loadChannelMessages(channelId);
    if (messages.length <= COMPRESS_THRESHOLD) {
        return { needed: false, toCompress: [], toKeep: messages };
    }
    const toKeep = messages.slice(-KEEP_RECENT);
    const toCompress = messages.slice(0, messages.length - KEEP_RECENT);
    return { needed: true, toCompress, toKeep };
}

/**
 * Apply compression: replace messages with only the recent ones.
 * Should be called AFTER LLM summary is saved.
 * @param {string} channelId
 * @param {Array} recentMessages - The messages to keep
 */
export function applyCompression(channelId, recentMessages) {
    saveChannelMessages(channelId, recentMessages);
    console.log(`${LOG} Channel ${channelId} compressed, keeping ${recentMessages.length} messages`);
}

// ═══════════════════════════════════════════════════════════════════════
// Default Server Initialization (Manual Mode)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Create a default empty server with standard categories and channels.
 * Called when user chooses "手动创建".
 */
export function initDefaultServer() {
    const charInfo = getPhoneCharInfo();
    const charName = charInfo?.name || '角色';
    const userName = getPhoneUserName();

    // ─── Ensure namespace ───
    _ensureNamespace();

    // ─── Server Config ───
    const config = {
        name: `${charName}的社区`,
        icon: null,
        description: `${charName}和${userName}共同管理的社区`,
        createdAt: new Date().toISOString(),
        categories: [
            {
                id: 'cat_announce',
                name: '📢 公告区',
                order: 0,
                channels: [
                    { id: 'ch_welcome', name: '欢迎', order: 0 },
                    { id: 'ch_rules', name: '规则', order: 1 },
                    { id: 'ch_announce', name: '公告', order: 2 },
                ],
            },
            {
                id: 'cat_chat',
                name: '💬 聊天区',
                order: 1,
                channels: [
                    { id: 'ch_general', name: '日常闲聊', order: 0 },
                ],
            },
        ],
    };
    saveServerConfig(config);

    // ─── Default Roles ───
    const roles = [
        { id: 'role_admin', name: '管理员', color: '#e74c3c', order: 0 },
        { id: 'role_member', name: '成员', color: '#99aab5', order: 99 },
    ];
    saveRoles(roles);

    // ─── Default Members (protagonist + user) ───
    const avatarColors = ['#e91e8e', '#5865f2', '#57f287', '#fee75c', '#ed4245', '#eb459e'];
    const members = [
        {
            id: 'member_char',
            name: charName,
            avatar: null,
            avatarColor: avatarColors[0],
            bio: '',
            personality: '',
            roles: ['role_admin'],
            isProtagonist: true,
            source: 'auto',
            createdAt: new Date().toISOString(),
        },
        {
            id: 'member_user',
            name: userName,
            avatar: null,
            avatarColor: avatarColors[1],
            bio: '',
            roles: ['role_admin'],
            isUser: true,
            source: 'auto',
            createdAt: new Date().toISOString(),
        },
    ];
    saveMembers(members);

    // ─── Empty Emojis ───
    saveCustomEmojis([]);

    // ─── Empty Messages & Summaries ───
    _save('messages', {});
    _save('summaries', {});

    console.log(`${LOG} Default server initialized: "${config.name}"`);
    return config;
}

/**
 * Save a server config generated by LLM.
 * @param {Object} llmResult - Parsed JSON from LLM
 * @returns {Object} The saved server config
 */
export function initFromLLMResult(llmResult) {
    const charInfo = getPhoneCharInfo();
    const charName = charInfo?.name || '角色';
    const userName = getPhoneUserName();

    // ─── Ensure namespace ───
    _ensureNamespace();

    // ─── Server Config ───
    const config = {
        name: llmResult.serverName || `${charName}的社区`,
        icon: null,
        description: llmResult.serverDescription || '',
        createdAt: new Date().toISOString(),
        categories: (llmResult.categories || []).map((cat, i) => ({
            id: generateId('cat'),
            name: cat.name,
            order: i,
            channels: (cat.channels || []).map((ch, j) => ({
                id: generateId('ch'),
                name: ch.name || ch,
                order: j,
            })),
        })),
    };
    saveServerConfig(config);

    // ─── Roles ───
    const roles = (llmResult.roles || []).map((r, i) => ({
        id: generateId('role'),
        name: r.name,
        color: r.color || '#99aab5',
        order: i,
    }));
    // Ensure admin + member exist
    if (!roles.find(r => r.name === '管理员')) {
        roles.unshift({ id: 'role_admin', name: '管理员', color: '#e74c3c', order: -1 });
    }
    if (!roles.find(r => r.name === '成员')) {
        roles.push({ id: generateId('role'), name: '成员', color: '#99aab5', order: 999 });
    }
    saveRoles(roles);

    // ─── Members (protagonist + user + LLM-generated) ───
    const avatarColors = ['#e91e8e', '#5865f2', '#57f287', '#fee75c', '#ed4245', '#eb459e', '#5865f2', '#1abc9c'];
    const adminRoleId = roles.find(r => r.name === '管理员')?.id || 'role_admin';
    const memberRoleId = roles.find(r => r.name === '成员')?.id || roles[roles.length - 1]?.id;

    const members = [
        {
            id: 'member_char',
            name: charName,
            avatar: null,
            avatarColor: avatarColors[0],
            bio: '',
            personality: '',
            roles: [adminRoleId],
            isProtagonist: true,
            source: 'auto',
            createdAt: new Date().toISOString(),
        },
        {
            id: 'member_user',
            name: userName,
            avatar: null,
            avatarColor: avatarColors[1],
            bio: '',
            roles: [adminRoleId],
            isUser: true,
            source: 'auto',
            createdAt: new Date().toISOString(),
        },
    ];

    // Add LLM-generated members
    if (Array.isArray(llmResult.members)) {
        llmResult.members.forEach((m, i) => {
            // Find matching role IDs
            const memberRoleIds = [];
            if (Array.isArray(m.roles)) {
                for (const rName of m.roles) {
                    const found = roles.find(r => r.name === rName);
                    if (found) memberRoleIds.push(found.id);
                }
            }
            if (memberRoleIds.length === 0) memberRoleIds.push(memberRoleId);

            members.push({
                id: generateId('member'),
                name: m.name || `成员${i + 1}`,
                avatar: null,
                avatarColor: avatarColors[(i + 2) % avatarColors.length],
                bio: m.bio || '',
                personality: m.personality || '',
                roles: memberRoleIds,
                isProtagonist: false,
                isUser: false,
                source: 'llm',
                createdAt: new Date().toISOString(),
            });
        });
    }
    saveMembers(members);

    // ─── Empty Emojis ───
    saveCustomEmojis([]);

    // ─── Empty Messages & Summaries ───
    _save('messages', {});
    _save('summaries', {});

    console.log(`${LOG} LLM server initialized: "${config.name}" with ${members.length} members`);
    return config;
}

/**
 * Reset everything — delete all Discord data.
 */
export function resetAllData() {
    try {
        if (chat_metadata) {
            delete chat_metadata[META_KEY];
            saveMetadataDebounced();
        }
    } catch (e) {
        console.error(`${LOG} Failed to reset data:`, e);
    }
    console.log(`${LOG} All Discord data reset`);
}

// ═══════════════════════════════════════════════════════════════════════
// Temp Injection for LLM Context
// ═══════════════════════════════════════════════════════════════════════

let _tempBioUpdateInject = null;

export function setTempBioUpdate(text) {
    _tempBioUpdateInject = text;
}

export function consumeTempBioUpdate() {
    const t = _tempBioUpdateInject;
    _tempBioUpdateInject = null;
    return t;
}
