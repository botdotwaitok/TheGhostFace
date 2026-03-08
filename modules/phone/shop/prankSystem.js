// modules/phone/shop/prankSystem.js — Prank System: prompt resolution + event card HTML
// Phase 5: Replaces the gift system with hilarious pranks

import { getShopItem, resolveItemPrompt } from './shopData.js';

// ═══════════════════════════════════════════════════════════════════════
// Prank Prompt Resolution — reads promptTemplate from shopData at runtime
// ═══════════════════════════════════════════════════════════════════════

/**
 * Build the prank prompt injection text for all currently active prank effects.
 * @param {string} charName - The character's name
 * @param {string} userName - The user's name
 * @param {Array} prankEffects - Array of active prank effects from shopStorage
 * @returns {string} The assembled prank prompt text, or empty string if no pranks active
 */
export function buildPrankPrompts(charName, userName, prankEffects) {
    if (!prankEffects || prankEffects.length === 0) return '';

    const lines = [];
    for (const effect of prankEffects) {
        const text = resolveItemPrompt(effect.itemId, charName, userName);
        if (text) lines.push(text);
    }

    return lines.join('\n\n');
}

// ═══════════════════════════════════════════════════════════════════════
// Prank Event Card HTML (for chat display)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Generate a styled prank event card HTML for the chat messages area.
 * Shown when a prank is triggered, before the character's reaction.
 * @param {string} prankId - The prank item ID
 * @returns {string} HTML string for the prank event card
 */
export function getPrankEventCardHtml(prankId) {
    const item = getShopItem(prankId);
    if (!item) return '';

    return `
    <div class="chat-prank-event-card">
        <div class="chat-prank-event-icon">${item.emoji}</div>
        <div class="chat-prank-event-content">
            <div class="chat-prank-event-title">🎭 恶作剧发动！</div>
            <div class="chat-prank-event-name">${item.name}</div>
            <div class="chat-prank-event-desc">${item.description}</div>
        </div>
    </div>`;
}
