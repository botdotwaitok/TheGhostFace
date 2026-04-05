// modules/phone/discord/discordMessageHandler.js — Message send → LLM → parse → store pipeline
// Handles: user message submission, responding member selection, LLM call, response parsing,
// message storage, reaction processing, and channel compression.

import { callPhoneLLM } from '../../api.js';
import { cleanLlmJson } from '../utils/llmJsonCleaner.js';
import { getPhoneUserName } from '../phoneContext.js';
import {
    loadMembers, loadChannelMessages, saveChannelMessages, appendMessage,
    getUserMember,
    checkCompression, applyCompression, saveChannelSummary, loadChannelSummary,
    generateId,
} from './discordStorage.js';
import {
    buildGroupChatSystemPrompt, buildGroupChatUserPrompt,
    buildChannelSummarizePrompt,
    buildAutoConversationSystemPrompt, buildAutoConversationUserPrompt,
} from './discordPromptBuilder.js';
import { tryAutoStartKeepAlive } from '../keepAlive.js';

const LOG = '[Discord Handler]';

// ═══════════════════════════════════════════════════════════════════════
// Message Callback Registry — decoupled from UI (Phase 4 plugs in here)
// ═══════════════════════════════════════════════════════════════════════

/** @type {Array<Function>} */
const _messageCallbacks = [];

/**
 * Register a callback to be invoked when a new message is received/stored.
 * Phase 4's discordChannel.js will call this to get real-time UI updates.
 *
 * @param {Function} callback - Called with (message, channelId) for each new message
 * @returns {Function} Unsubscribe function
 */
export function onMessageReceived(callback) {
    _messageCallbacks.push(callback);
    return () => {
        const idx = _messageCallbacks.indexOf(callback);
        if (idx !== -1) _messageCallbacks.splice(idx, 1);
    };
}

/**
 * Notify all registered callbacks about a new message.
 * @param {Object} message - The message object
 * @param {string} channelId - The channel it belongs to
 */
function _notifyMessage(message, channelId) {
    for (const cb of _messageCallbacks) {
        try { cb(message, channelId); } catch (e) {
            console.error(`${LOG} Callback error:`, e);
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Typing Indicator Callback — for "xxx is typing..." UI
// Persists current state so UI can restore indicator on channel re-entry.
// ═══════════════════════════════════════════════════════════════════════

/** @type {Array<Function>} */
const _typingCallbacks = [];

/** Persistent typing state so channel can restore indicator on re-entry */
let _currentTypingState = { isTyping: false, memberNames: [], channelId: null };

/**
 * Register a callback for typing indicator state changes.
 * @param {Function} callback - Called with (isTyping, memberNames[], channelId)
 * @returns {Function} Unsubscribe function
 */
export function onTypingStateChange(callback) {
    _typingCallbacks.push(callback);
    return () => {
        const idx = _typingCallbacks.indexOf(callback);
        if (idx !== -1) _typingCallbacks.splice(idx, 1);
    };
}

/**
 * Get the current typing state (for restoring indicator on channel re-entry).
 * @returns {{ isTyping: boolean, memberNames: string[], channelId: string|null }}
 */
export function getTypingState() {
    return { ..._currentTypingState };
}

function _notifyTyping(isTyping, memberNames, channelId) {
    _currentTypingState = { isTyping, memberNames: [...memberNames], channelId };
    for (const cb of _typingCallbacks) {
        try { cb(isTyping, memberNames, channelId); } catch (e) { /* */ }
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Send User Messages — Main Entry Point (supports multi-message drafts)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Process one or more user messages in a channel:
 * 1. Save all user messages to storage
 * 2. Select responding members
 * 3. Call LLM for multi-role response
 * 4. Parse responses and deliver with delays
 * 5. Handle reactions
 * 6. Check compression
 *
 * @param {string} channelId - Channel to send the message in
 * @param {string[]} texts - Array of user message texts (kiwi drafts)
 * @param {string[]} mentions - Array of mentioned member IDs
 * @param {Object|null} imageData - Optional image { base64, thumbnail, fileName }
 * @param {string|null} replyToId - Optional message ID being replied to
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function sendUserMessages(channelId, texts, mentions = [], imageData = null, replyToId = null) {
    // iOS keep-alive: auto-start silent audio on first message send
    tryAutoStartKeepAlive();

    // Normalize: accept single string for backward compatibility
    const messageTexts = Array.isArray(texts) ? texts : [texts];
    const validTexts = messageTexts.filter(t => t?.trim());
    if (validTexts.length === 0) return { success: false, error: 'Empty message' };

    const userName = getPhoneUserName();
    const userMember = getUserMember();

    // ─── 1. Save all user messages ───
    const userMessages = [];
    for (let i = 0; i < validTexts.length; i++) {
        const text = validTexts[i];
        const msgObj = {
            id: generateId('msg'),
            channelId,
            authorId: userMember?.id || 'member_user',
            authorName: userName,
            content: text.trim(),
            timestamp: new Date().toISOString(),
            reactions: [],
            mentions: mentions || [],
            replyTo: (i === 0 && replyToId) ? replyToId : null,
            summarized: false,
        };

        // Attach image thumbnail to first message
        if (imageData && i === 0) {
            msgObj.imageUrl = imageData.thumbnail;
        }

        const userMsg = appendMessage(channelId, msgObj);
        userMessages.push(userMsg);

        // Notify UI immediately so user sees their own message
        _notifyMessage(userMsg, channelId);
    }

    // ─── 2. Select responding members ───
    const allMembers = loadMembers();
    const respondingMembers = selectRespondingMembers(allMembers, mentions);
    const respondingNames = respondingMembers.filter(m => !m.isUser).map(m => m.name);

    console.log(`${LOG} User sent ${validTexts.length} message(s)${imageData ? ' (with image)' : ''}, responding members: ${respondingNames.join(', ')}`);

    // ─── 3. Show typing indicator ───
    _notifyTyping(true, respondingNames, channelId);

    try {
        // ─── 4. Build prompts & call LLM ───
        const systemPrompt = await buildGroupChatSystemPrompt(channelId, respondingMembers);
        // Exclude user's new messages from chat_history (they're shown separately);
        // this prevents the LLM from seeing them twice and confusing indices.
        const userPrompt = buildGroupChatUserPrompt(channelId, validTexts, mentions, !!imageData, validTexts.length);

        console.log(`${LOG} Calling LLM for group chat response...`);
        // Pass image base64 for multimodal vision if available
        const llmOptions = { maxTokens: 3000 };
        if (imageData?.base64) {
            llmOptions.images = [imageData.base64];
        }
        const rawResponse = await callPhoneLLM(systemPrompt, userPrompt, llmOptions);

        // ─── 5. Parse response ───
        const parsed = _parseGroupResponse(rawResponse, respondingMembers);
        if (!parsed || parsed.length === 0) {
            console.warn(`${LOG} LLM returned no valid messages`);
            _notifyTyping(false, [], channelId);
            return { success: true }; // Not an error, just no one responded
        }

        console.log(`${LOG} Parsed ${parsed.length} messages from LLM`);

        // ─── 6. Deliver messages with delays ───
        // Pass excludeLastN so the index→msgId mapping matches the prompt indices
        await _deliverMessagesWithDelay(channelId, parsed, allMembers, validTexts.length);

        // ─── 7. Hide typing indicator ───
        _notifyTyping(false, [], channelId);

        // ─── 8. Check compression ───
        _maybeCompressChannel(channelId);

        return { success: true };

    } catch (e) {
        console.error(`${LOG} sendUserMessages failed:`, e);
        _notifyTyping(false, [], channelId);
        return { success: false, error: e.message };
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Auto-Chat — Generate autonomous member conversations
// ═══════════════════════════════════════════════════════════════════════

/**
 * Generate an automatic conversation between members (no user message).
 * Used by discordAutoChat.js (Phase 5) for background group chat.
 *
 * @param {string} channelId - Channel to generate conversation in
 * @param {Array} participants - Member objects who will chat
 * @returns {Promise<{success: boolean, messageCount: number, error?: string}>}
 */
export async function generateAutoConversation(channelId, participants) {
    if (!participants || participants.length < 2) {
        return { success: false, messageCount: 0, error: 'Need at least 2 participants' };
    }

    // Show typing indicator for participating members
    const participantNames = participants.filter(m => !m.isUser).map(m => m.name);
    _notifyTyping(true, participantNames, channelId);

    try {
        const systemPrompt = await buildAutoConversationSystemPrompt(channelId, participants);
        const userPrompt = buildAutoConversationUserPrompt(channelId);

        console.log(`${LOG} Generating auto-conversation in channel ${channelId}...`);
        const rawResponse = await callPhoneLLM(systemPrompt, userPrompt, { maxTokens: 2000 });

        const parsed = _parseGroupResponse(rawResponse, participants);
        if (!parsed || parsed.length === 0) {
            _notifyTyping(false, [], channelId);
            return { success: true, messageCount: 0 };
        }

        const allMembers = loadMembers();
        await _deliverMessagesWithDelay(channelId, parsed, allMembers);

        _notifyTyping(false, [], channelId);
        _maybeCompressChannel(channelId);

        return { success: true, messageCount: parsed.length };

    } catch (e) {
        console.error(`${LOG} generateAutoConversation failed:`, e);
        _notifyTyping(false, [], channelId);
        return { success: false, messageCount: 0, error: e.message };
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Member Selection Logic
// ═══════════════════════════════════════════════════════════════════════

/**
 * Select which members will respond to a user message.
 *
 * Rules:
 * - Protagonist (isProtagonist) is ALWAYS selected
 * - Mentioned members are ALWAYS selected
 * - If total non-user members < 5: select ALL
 * - If total non-user members >= 5: select ~half (rounded up)
 * - User member is included for context but won't generate responses
 *
 * @param {Array} allMembers - All server members
 * @param {string[]} mentionedIds - IDs of mentioned members
 * @returns {Array} Selected members (including user for context)
 */
export function selectRespondingMembers(allMembers, mentionedIds = []) {
    const nonUserMembers = allMembers.filter(m => !m.isUser);
    const userMember = allMembers.find(m => m.isUser);
    const mentionSet = new Set(mentionedIds);

    if (nonUserMembers.length === 0) {
        return userMember ? [userMember] : [];
    }

    let selected;

    if (nonUserMembers.length < 5) {
        // Small server: everyone responds
        selected = [...nonUserMembers];
    } else {
        // Larger server: select subset
        const mandatoryMembers = [];
        const optionalMembers = [];

        for (const m of nonUserMembers) {
            if (m.isProtagonist || mentionSet.has(m.id)) {
                mandatoryMembers.push(m);
            } else {
                optionalMembers.push(m);
            }
        }

        // Target: half of total (rounded up), but at least mandatory count
        const targetCount = Math.max(
            Math.ceil(nonUserMembers.length / 2),
            mandatoryMembers.length,
        );

        // Fill remaining slots from optional members (random shuffle)
        const remainingSlots = targetCount - mandatoryMembers.length;
        const shuffled = _shuffle([...optionalMembers]);
        const extraMembers = shuffled.slice(0, Math.max(0, remainingSlots));

        selected = [...mandatoryMembers, ...extraMembers];
    }

    // Always include user member for prompt context
    if (userMember) selected.push(userMember);

    return selected;
}

// ═══════════════════════════════════════════════════════════════════════
// Response Parsing
// ═══════════════════════════════════════════════════════════════════════

/**
 * Parse the LLM's raw JSON response into validated message objects.
 * @param {string} rawResponse - Raw LLM output
 * @param {Array} respondingMembers - Members who were asked to respond
 * @returns {Array} Parsed message objects (validated)
 */
function _parseGroupResponse(rawResponse, respondingMembers) {
    if (!rawResponse) return [];

    try {
        const cleaned = cleanLlmJson(rawResponse);
        const parsed = JSON.parse(cleaned);

        if (!Array.isArray(parsed)) {
            console.warn(`${LOG} LLM response is not an array`);
            return [];
        }

        // Build valid member ID set (non-user members only)
        const validIds = new Set(
            respondingMembers.filter(m => !m.isUser).map(m => m.id),
        );

        // Build name → ID mapping for fallback (LLM sometimes uses names instead of IDs)
        const nameToId = {};
        for (const m of respondingMembers) {
            if (!m.isUser) {
                nameToId[m.name] = m.id;
                nameToId[m.name.toLowerCase()] = m.id;
            }
        }

        const validated = [];
        for (const item of parsed) {
            if (!item || typeof item !== 'object') continue;

            // Resolve authorId (try direct match, then name fallback)
            let authorId = item.authorId;
            if (!validIds.has(authorId)) {
                // Maybe LLM used the member name instead of ID
                const resolvedId = nameToId[authorId] || nameToId[authorId?.toLowerCase?.()];
                if (resolvedId) {
                    authorId = resolvedId;
                } else {
                    console.warn(`${LOG} Invalid authorId "${item.authorId}", skipping`);
                    continue;
                }
            }

            // Validate: must have text or reaction
            const text = (item.text || '').trim();
            const reaction = item.reaction || null;
            if (!text && !reaction) continue;

            validated.push({
                authorId,
                text,
                delay: Math.max(0, Math.min(10, Number(item.delay) || 0)),
                reaction,
                replyToIndex: item.replyToIndex != null ? Number(item.replyToIndex) : null,
            });
        }

        return validated;

    } catch (e) {
        console.error(`${LOG} Failed to parse LLM response:`, e);
        console.error(`${LOG} Raw response:`, rawResponse?.substring(0, 500));
        return [];
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Message Delivery (with delays)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Deliver parsed messages one by one with simulated typing delays.
 * Each message is stored and then the UI callback is fired.
 *
 * @param {string} channelId
 * @param {Array} parsedMessages - Validated message objects from _parseGroupResponse
 * @param {Array} allMembers - All server members (for name lookup)
 * @param {number} [excludeLastN=0] - Number of trailing messages to exclude from index mapping
 *   (must match the excludeLastN passed to buildGroupChatUserPrompt)
 */
async function _deliverMessagesWithDelay(channelId, parsedMessages, allMembers, excludeLastN = 0) {
    const memberMap = {};
    for (const m of allMembers) memberMap[m.id] = m;

    // Build index → msgId mapping from recent channel messages (for LLM replyToIndex)
    // Must match exactly the same message slice used in buildGroupChatUserPrompt's chat_history
    const channelMessages = loadChannelMessages(channelId);
    const unsummarized = channelMessages.filter(m => !m.summarized);
    const historyPool = excludeLastN > 0
        ? unsummarized.slice(0, unsummarized.length - excludeLastN)
        : unsummarized;
    const recentForIndex = historyPool.slice(-30);
    // recentForIndex[0] = index 1 in prompt, etc.
    const indexToMsgId = {};
    for (let i = 0; i < recentForIndex.length; i++) {
        indexToMsgId[i + 1] = recentForIndex[i].id;
    }

    // Track messages stored so far (for reaction targeting)
    const storedMessages = [];

    for (let i = 0; i < parsedMessages.length; i++) {
        const item = parsedMessages[i];
        const member = memberMap[item.authorId];
        if (!member) continue;

        // ─── Wait for delay ───
        if (item.delay > 0 && i > 0) {
            // Add some randomness to make it feel more natural (±30%)
            const jitter = 1 + (Math.random() * 0.6 - 0.3);
            const delayMs = item.delay * 1000 * jitter;
            await _sleep(delayMs);
        }

        // ─── Resolve replyTo ───
        let replyTo = null;
        if (item.replyToIndex != null) {
            if (item.replyToIndex === -1) {
                // Reply to the last user message (most recent in channel)
                const lastUserMsg = channelMessages.filter(m => {
                    const userMember = allMembers.find(mm => mm.isUser);
                    return m.authorId === userMember?.id;
                }).pop();
                replyTo = lastUserMsg?.id || null;
            } else if (indexToMsgId[item.replyToIndex]) {
                replyTo = indexToMsgId[item.replyToIndex];
            }
        }

        // ─── Store message (if has text) ───
        if (item.text) {
            const msg = appendMessage(channelId, {
                id: generateId('msg'),
                channelId,
                authorId: item.authorId,
                authorName: member.name,
                content: item.text,
                timestamp: new Date().toISOString(),
                reactions: [],
                mentions: [],
                replyTo,
                summarized: false,
            });

            storedMessages.push(msg);
            _notifyMessage(msg, channelId);
        }

        // ─── Process reaction ───
        if (item.reaction) {
            _processReaction(channelId, item.reaction, item.authorId, storedMessages);
        }
    }
}

/**
 * Process a reaction from an LLM response.
 * @param {string} channelId
 * @param {Object} reaction - { targetMsgIndex, emoji }
 * @param {string} reactorId - The member who reacts
 * @param {Array} recentStoredMessages - Messages stored in this batch
 */
function _processReaction(channelId, reaction, reactorId, recentStoredMessages) {
    if (!reaction?.emoji) return;

    const messages = loadChannelMessages(channelId);
    let targetMsg = null;

    if (reaction.targetMsgIndex === -1) {
        // React to the last user message
        const members = loadMembers();
        for (let i = messages.length - 1; i >= 0; i--) {
            const m = messages[i];
            const member = members.find(mem => mem.id === m.authorId);
            if (member?.isUser) {
                targetMsg = m;
                break;
            }
        }
    } else if (reaction.targetMsgIndex >= 0 && reaction.targetMsgIndex < recentStoredMessages.length) {
        // React to a message from this batch
        targetMsg = recentStoredMessages[reaction.targetMsgIndex];
    }

    if (!targetMsg) return;

    // Find the message in storage and add the reaction
    const msgInStorage = messages.find(m => m.id === targetMsg.id);
    if (!msgInStorage) return;

    if (!msgInStorage.reactions) msgInStorage.reactions = [];

    // Check if this emoji reaction already exists
    const existingReaction = msgInStorage.reactions.find(r => r.emoji === reaction.emoji);
    if (existingReaction) {
        // Add user to existing reaction if not already there
        if (!existingReaction.users.includes(reactorId)) {
            existingReaction.users.push(reactorId);
        }
    } else {
        // Create new reaction
        msgInStorage.reactions.push({
            emoji: reaction.emoji,
            users: [reactorId],
        });
    }

    // Save updated messages back to storage
    saveChannelMessages(channelId, messages);

    // Notify UI about the reaction update
    _notifyMessage({ ...msgInStorage, _reactionUpdate: true }, channelId);
}

// ═══════════════════════════════════════════════════════════════════════
// Channel Compression
// ═══════════════════════════════════════════════════════════════════════

/**
 * Check if channel needs compression, and run it if so.
 * @param {string} channelId
 */
async function _maybeCompressChannel(channelId) {
    const result = checkCompression(channelId);
    if (!result.needed) return;

    console.log(`${LOG} Channel ${channelId} needs compression (${result.toCompress.length} old messages)`);

    try {
        await compressChannel(channelId, result.toCompress, result.toKeep);
    } catch (e) {
        console.error(`${LOG} Channel compression failed:`, e);
    }
}

/**
 * Compress a channel's old messages into a rolling summary.
 * @param {string} channelId
 * @param {Array} oldMessages - Messages to compress
 * @param {Array} recentMessages - Messages to keep
 */
export async function compressChannel(channelId, oldMessages, recentMessages) {
    const members = loadMembers();

    // ─── Build text from old messages ───
    const oldText = oldMessages.map(m => {
        const name = m.authorName || _getMemberName(m.authorId, members);
        return `${name}: ${m.content}`;
    }).join('\n');

    // ─── Include existing summary if any ───
    const existingSummary = loadChannelSummary(channelId);
    let userPrompt = '';
    if (existingSummary?.summary) {
        userPrompt += `旧总结：\n${existingSummary.summary}\n\n`;
    }
    userPrompt += `新消息记录：\n${oldText}\n\n请合并生成新的滚动总结。`;

    // ─── Call LLM for summarization ───
    const systemPrompt = buildChannelSummarizePrompt();
    console.log(`${LOG} Compressing channel ${channelId}: ${oldMessages.length} messages → summary`);

    const summaryText = await callPhoneLLM(systemPrompt, userPrompt, { maxTokens: 1500 });

    // ─── Save summary ───
    saveChannelSummary(channelId, {
        summary: summaryText,
        lastSummarizedAt: new Date().toISOString(),
        summarizedCount: (existingSummary?.summarizedCount || 0) + oldMessages.length,
    });

    // ─── Apply compression: keep only recent messages ───
    applyCompression(channelId, recentMessages);

    console.log(`${LOG} Channel ${channelId} compressed: ${oldMessages.length} messages summarized, ${recentMessages.length} kept`);
}

// ═══════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════

function _getMemberName(memberId, members) {
    return members?.find(m => m.id === memberId)?.name || '未知用户';
}

/** Fisher-Yates shuffle */
function _shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
