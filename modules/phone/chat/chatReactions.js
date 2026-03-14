// modules/phone/chat/chatReactions.js — Emoji reaction system
// Extracted from chatApp.js

import { escHtml } from './chatApp.js';
import { loadChatHistory, saveChatHistory } from './chatStorage.js';

// ═══════════════════════════════════════════════════════════════════════
// Emoji Reactions (贴表情)
// ═══════════════════════════════════════════════════════════════════════

export const REACTION_EMOJIS = ['❤️', '😂', '👍', '😮', '😢', '🔥'];

/**
 * Show a floating emoji picker above a message bubble.
 */
export function showReactionPicker(msgIndex, rowElement) {
    dismissReactionPicker(); // Remove any existing picker

    const isUser = rowElement.classList.contains('user');
    const pickerHtml = `
    <div class="chat-reaction-picker" data-msg-index="${msgIndex}">
        ${REACTION_EMOJIS.map(e => `<button class="chat-reaction-emoji" data-emoji="${e}" data-msg-index="${msgIndex}">${e}</button>`).join('')}
    </div>`;

    // Insert picker above the bubble row
    rowElement.insertAdjacentHTML('beforebegin', pickerHtml);

    // Position the picker
    const picker = rowElement.previousElementSibling;
    if (picker && picker.classList.contains('chat-reaction-picker')) {
        picker.classList.add(isUser ? 'align-right' : 'align-left');
        // Add a small animation
        requestAnimationFrame(() => picker.classList.add('visible'));
    }
}

/**
 * Remove all reaction pickers from the DOM.
 */
export function dismissReactionPicker() {
    document.querySelectorAll('.chat-reaction-picker').forEach(el => el.remove());
}

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

    saveChatHistory(history);

    // Re-render just the reaction badge for this message
    const row = document.querySelector(`.chat-bubble-row[data-msg-index="${msgIndex}"]`);
    if (row) {
        const col = row.querySelector('.chat-bubble-column');
        const existingBadge = col?.querySelector('.chat-reaction-badge');
        if (existingBadge) existingBadge.remove();

        if (msg.reactions && Object.keys(msg.reactions).length > 0) {
            const badges = Object.entries(msg.reactions)
                .filter(([, count]) => count > 0)
                .map(([em, count]) => `<span class="chat-reaction-item">${em}${count > 1 ? ` ${count}` : ''}</span>`)
                .join('');
            if (badges && col) {
                col.insertAdjacentHTML('beforeend',
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
        if (!emoji || !REACTION_EMOJIS.includes(emoji)) continue;

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
