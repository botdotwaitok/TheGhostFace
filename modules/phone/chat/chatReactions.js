// modules/phone/chat/chatReactions.js — Emoji reaction data layer
// The floating picker UI lives in chatBubbleMenu.js; this file owns the
// constants, the toggle/badge re-render flow, and AI-generated reactions.

import { loadChatHistory, saveChatHistory } from './chatStorage.js';

// ═══════════════════════════════════════════════════════════════════════
// Emoji Reactions (贴表情)
// ═══════════════════════════════════════════════════════════════════════

export const REACTION_EMOJIS = ['❤️', '😂', '👍', '😮', '😢', '🔥'];

/**
 * Toggle a reaction emoji on a message (add or remove).
 */
export function toggleReaction(msgIndex, emoji) {
    const history = loadChatHistory();
    if (msgIndex < 0 || msgIndex >= history.length) return;

    const msg = history[msgIndex];
    if (!msg.reactions) msg.reactions = {};

    if (msg.reactions[emoji]) {
        delete msg.reactions[emoji];
        // Clean up empty reactions object
        if (Object.keys(msg.reactions).length === 0) delete msg.reactions;
    } else {
        msg.reactions[emoji] = 1;
    }

    // Fire-and-forget: UI re-renders from the in-memory mutation immediately;
    // a missed flush at worst loses one emoji toggle on a refresh, which the
    // user can redo. Not worth threading async through every reaction click.
    saveChatHistory(history).catch(e =>
        console.warn('[聊天] reaction flush failed:', e));

    // Re-render just the reaction badge for this message.
    // The badge lives inside .chat-bubble-anchor so it can absolute-position
    // against the bubble's actual edges (not the full-width column).
    const row = document.querySelector(`.chat-bubble-row[data-msg-index="${msgIndex}"]`);
    if (row) {
        const anchor = row.querySelector('.chat-bubble-anchor');
        const existingBadge = anchor?.querySelector(':scope > .chat-reaction-badge');
        if (existingBadge) existingBadge.remove();

        if (anchor && msg.reactions && Object.keys(msg.reactions).length > 0) {
            const badges = Object.entries(msg.reactions)
                .filter(([, count]) => count > 0)
                .map(([em, count]) => `<span class="chat-reaction-item" data-emoji="${em}">${em}${count > 1 ? ` ${count}` : ''}</span>`)
                .join('');
            if (badges) {
                anchor.insertAdjacentHTML('beforeend',
                    `<div class="chat-reaction-badge" data-msg-index="${msgIndex}">${badges}</div>`);
            }
        }
    }
}

/**
 * Apply AI-generated reactions from the parsed response.
 * Expected format in AI response JSON: "reactions": [{"targetIndex": -1, "emoji": "❤️"}]
 * targetIndex: -1 means "last user message", -2 means "second to last user message", etc.
 */
export function applyAIReactions(aiReactions, currentHistory) {
    if (!aiReactions || !Array.isArray(aiReactions) || aiReactions.length === 0) return;

    // Find user message indices
    const userIndices = [];
    for (let i = 0; i < currentHistory.length; i++) {
        if (currentHistory[i].role === 'user') userIndices.push(i);
    }

    for (const reaction of aiReactions) {
        const emoji = reaction.emoji;
        // No whitelist — the LLM is trusted to pick any emoji that fits.
        // Length cap guards against the model dumping a whole string here.
        if (!emoji || typeof emoji !== 'string' || emoji.length > 16) continue;

        let targetIdx;
        if (reaction.targetIndex < 0) {
            // Negative index: count from end of user messages
            const userPos = userIndices.length + reaction.targetIndex;
            if (userPos < 0 || userPos >= userIndices.length) continue;
            targetIdx = userIndices[userPos];
        } else {
            targetIdx = reaction.targetIndex;
        }

        if (targetIdx < 0 || targetIdx >= currentHistory.length) continue;

        const msg = currentHistory[targetIdx];
        if (!msg.reactions) msg.reactions = {};
        msg.reactions[emoji] = (msg.reactions[emoji] || 0) + 1;
    }
}
