// modules/phone/chat/chatInventory.js — Buff bar, Inventory panel, Return Home
// Extracted from chatApp.js

import { getPhoneSetting } from '../phoneSettings.js';

import { escHtml, CHAT_LOG_PREFIX, scrollToBottom } from './chatApp.js';
import {
    loadChatHistory, getCharacterInfo, getUserName,
    sendSummaryAsUserMessage, sendRawTranscriptAsUserMessage,
    loadChatSummary, saveChatSummary,
} from './chatStorage.js';
import { callPhoneLLM } from '../../api.js';
import { generateSummary, isContentSimilar } from '../../summarizer.js';
import { saveToWorldBook } from '../../worldbook.js';
import { buildSummarizePrompt, buildRollingSummarizePrompt } from './chatPromptBuilder.js';
import { pushPromptLog } from '../console/consoleApp.js';
import {
    getInventory, activateItem, getActiveEffects,
    getActiveChatEffects, getActivePersonalityOverrides,
    getActiveSpecialMessageEffects, getActivePrankEffects,
} from '../shop/shopStorage.js';
import { getShopItem } from '../shop/shopData.js';

// ═══════════════════════════════════════════════════════════════════════
// Phase 2: Buff Bar
// ═══════════════════════════════════════════════════════════════════════

/** Render the buff indicator bar below the nav */
export function renderBuffBar() {
    const bar = document.getElementById('chat_buff_bar');
    if (!bar) return;

    let allEffects = [];
    try {
        const chatEffects = getActiveChatEffects();
        if (chatEffects?.length > 0) allEffects.push(...chatEffects);
    } catch (e) { /* */ }

    try {
        const overrideEffects = getActivePersonalityOverrides();
        if (overrideEffects?.length > 0) allEffects.push(...overrideEffects);
    } catch (e) { /* */ }

    try {
        const specialEffects = getActiveSpecialMessageEffects();
        if (specialEffects?.length > 0) allEffects.push(...specialEffects);
    } catch (e) { /* */ }

    try {
        const prankEffects = getActivePrankEffects();
        if (prankEffects?.length > 0) allEffects.push(...prankEffects);
    } catch (e) { /* */ }

    if (allEffects.length === 0) {
        bar.innerHTML = '';
        bar.style.display = 'none';
        return;
    }

    bar.style.display = 'flex';
    bar.innerHTML = allEffects.map(e => {
        const item = getShopItem(e.itemId);
        if (!item) return '';
        const label = e.type === 'specialMessage' ? '1次' : `${e.remaining}条`;
        return `<div class="chat-buff-pill" title="${escHtml(item.name)} — 剩余${label}">
            <span class="chat-buff-emoji">${item.emoji}</span>
            <span class="chat-buff-count">${e.remaining}</span>
        </div>`;
    }).join('');
}

// ═══════════════════════════════════════════════════════════════════════
// In-Chat Inventory (道具背包)
// ═══════════════════════════════════════════════════════════════════════

/** Render the inventory list inside the chat inventory overlay */
export function renderChatInventory() {
    const listEl = document.getElementById('chat_inventory_list');
    const activeEl = document.getElementById('chat_inventory_active');
    if (!listEl) return;

    const inventory = getInventory();
    const itemIds = Object.keys(inventory);

    if (itemIds.length === 0) {
        listEl.innerHTML = `
            <div class="chat-inventory-empty">
                <div class="chat-inventory-empty-icon"><i class="ph ph-package"></i></div>
                <div class="chat-inventory-empty-text">背包空空如也</div>
                <div class="chat-inventory-empty-hint">去商城逛逛吧～</div>
            </div>`;
    } else {
        listEl.innerHTML = itemIds.map(id => {
            const item = getShopItem(id);
            const qty = inventory[id];
            if (!item || qty <= 0) return '';

            const canUse = ['chatPrompt', 'diaryPrompt', 'personalityOverride', 'specialMessage', 'prankReaction'].includes(item.effectType);

            return `
                <div class="chat-inventory-row">
                    <div class="chat-inventory-row-left">
                        <div class="chat-inventory-row-emoji">${item.emoji}</div>
                        <div class="chat-inventory-row-info">
                            <div class="chat-inventory-row-name">${escHtml(item.name)}</div>
                            <div class="chat-inventory-row-desc">${escHtml(item.description)}</div>
                        </div>
                    </div>
                    <div class="chat-inventory-row-right">
                        <span class="chat-inventory-row-qty">×${qty}</span>
                        ${canUse ? `<button class="chat-inventory-use-btn" data-use-item="${item.id}">使用</button>` : ''}
                    </div>
                </div>`;
        }).filter(Boolean).join('');

        // Bind use buttons
        listEl.querySelectorAll('.chat-inventory-use-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                
                // Hide the inventory dialog immediately before prompting
                const inventoryOverlay = document.getElementById('chat_inventory_overlay');
                if (inventoryOverlay) {
                    inventoryOverlay.classList.remove('active');
                }

                handleChatUseItem(btn.dataset.useItem);
            });
        });
    }

    // Active effects section
    if (activeEl) {
        const effects = getActiveEffects().filter(e =>
            ['chatPrompt', 'diaryPrompt', 'personalityOverride', 'specialMessage', 'prankReaction'].includes(e.type)
        );

        if (effects.length === 0) {
            activeEl.style.display = 'none';
            activeEl.innerHTML = '';
        } else {
            activeEl.style.display = 'block';
            activeEl.innerHTML = `
                <div class="chat-inventory-active-title"><i class="fa-solid fa-bolt"></i> 当前生效</div>
                <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px;">
                ${effects.map(e => {
                const item = getShopItem(e.itemId);
                if (!item) return '';
                const unit = e.type === 'diaryPrompt' ? '次日记'
                    : e.type === 'specialMessage' ? '次使用'
                        : e.type === 'prankReaction' ? '次(待触发)'
                            : '条消息';
                return `<div class="chat-inventory-active-pill">${item.emoji} ${escHtml(item.name)} · 剩余${e.remaining}${unit}</div>`;
            }).filter(Boolean).join('')}
                </div>`;
        }
    }
}

/** Handle using an item from the in-chat inventory */
export function handleChatUseItem(itemId) {
    const item = getShopItem(itemId);
    if (!item) return;

    let confirmMsg;
    if (item.effectType === 'prankReaction') {
        confirmMsg = `确认使用【${item.name}】吗？\n下次聊天时将自动对你对象发动恶作剧！🎭`;
    } else {
        const durationUnit = item.effectType === 'diaryPrompt' ? '次日记'
            : item.effectType === 'specialMessage' ? '次使用'
                : '条消息';
        confirmMsg = `确认使用【${item.name}】吗？\n效果将持续 ${item.duration} ${durationUnit}。`;
    }

    if (!confirm(confirmMsg)) return;

    const result = activateItem(itemId);

    // Show feedback as system message in chat
    const messagesArea = document.getElementById('chat_messages_area');
    if (result.success) {
        if (messagesArea) {
            messagesArea.insertAdjacentHTML('beforeend',
                `<div class="chat-retract"><i class="ph ph-sparkle"></i> ${escHtml(result.message)}</div>`);
        }
        scrollToBottom(true);
    } else {
        if (messagesArea) {
            messagesArea.insertAdjacentHTML('beforeend',
                `<div class="chat-retract"><i class="ph ph-x-circle"></i> ${escHtml(result.message)}</div>`);
        }
    }

    // Refresh inventory + buff bar
    renderChatInventory();
    renderBuffBar();
}

// ═══════════════════════════════════════════════════════════════════════
// "我已回家" — Return Home Logic
// ═══════════════════════════════════════════════════════════════════════

export async function handleReturnHome() {
    const history = loadChatHistory();

    if (history.length === 0) {
        alert('还没有聊天记录，不需要同步～');
        return;
    }

    // Read user preferences from persistent settings
    const doMemoryFragments = getPhoneSetting('rhMemory', false);
    const syncMode = getPhoneSetting('rhSyncMode', 'summary');

    const modeLabel = syncMode === 'raw' ? '原文灌入' : 'AI压缩总结';
    const memoryLabel = doMemoryFragments ? '[ ON ] 提取记忆碎片' : '[ OFF ] 不提取记忆碎片';

    if (!confirm(`确定要结束手机聊天并回到线下吗？\n\n当前设置：\n同步方式: ${modeLabel}\n${memoryLabel}\n\n（可在 设置 → 聊天 中修改）`)) {
        return;
    }

    const charName = getCharacterInfo()?.name || '角色';
    const userName = getUserName();

    // Show a "syncing" status
    const messagesArea = document.getElementById('chat_messages_area');
    if (messagesArea) {
        messagesArea.insertAdjacentHTML('beforeend',
            `<div class="chat-retract" id="chat_sync_status"><i class="ph ph-house"></i> 正在处理回家流程…</div>`
        );
    }
    scrollToBottom(true);

    try {
        // ─── Optional Step: Memory Fragment Extraction ───
        if (doMemoryFragments) {
            const statusEl = document.getElementById('chat_sync_status');
            if (statusEl) statusEl.innerHTML = '<i class="ph ph-puzzle-piece"></i> 正在提取记忆碎片…';

            console.log(`${CHAT_LOG_PREFIX} Return home: extracting memory fragments...`);

            try {
                // Convert phone chat messages to the format generateSummary() expects
                const summarizerMessages = history.map(msg => ({
                    parsedContent: msg.content || '',
                    parsedDate: msg.timestamp ? new Date(msg.timestamp).toLocaleDateString('zh-CN') : null,
                    is_user: msg.role === 'user',
                    is_system: false,
                    name: msg.role === 'user' ? userName : charName,
                }));

                const fragments = await generateSummary(summarizerMessages);
                if (fragments && Array.isArray(fragments) && fragments.length > 0) {
                    await saveToWorldBook(fragments, null, null, isContentSimilar);
                    console.log(`${CHAT_LOG_PREFIX} ✅ 记忆碎片已写入世界书: ${fragments.length} 条`);
                    if (statusEl) statusEl.innerHTML = `<i class="ph ph-puzzle-piece"></i> 记忆碎片提取完成！写入 ${fragments.length} 条。正在同步…`;
                } else {
                    console.log(`${CHAT_LOG_PREFIX} ℹ️ 鬼面判断无新记忆碎片`);
                    if (statusEl) statusEl.innerHTML = '<i class="ph ph-puzzle-piece"></i> 无新记忆碎片。正在同步…';
                }
            } catch (memErr) {
                console.error(`${CHAT_LOG_PREFIX} 记忆碎片提取失败:`, memErr);
                if (statusEl) statusEl.innerHTML = '<i class="ph ph-warning"></i> 记忆碎片提取失败，继续同步…';
                // Don't abort — continue with sync
            }
        }

        // ─── Sync to ST main chat ───
        const statusEl = document.getElementById('chat_sync_status');

        if (syncMode === 'raw') {
            // ── Raw transcript mode ──
            if (statusEl) statusEl.innerHTML = '<i class="ph ph-file-text"></i> 正在将原文聊天记录同步…';
            console.log(`${CHAT_LOG_PREFIX} Return home: sending raw transcript...`);

            await sendRawTranscriptAsUserMessage(history);

            if (statusEl) statusEl.innerHTML = '<i class="ph ph-house"></i> 已回家！原文聊天记录已发送，你对象正在回应～';

        } else {
            // ── AI compressed summary mode (default) ──
            if (statusEl) statusEl.innerHTML = '<i class="ph ph-robot"></i> 正在生成AI压缩总结…';
            console.log(`${CHAT_LOG_PREFIX} Return home: generating AI summary...`);

            const transcript = history.map(msg => {
                const role = msg.role === 'user' ? userName : charName;
                const timeStr = msg.timestamp
                    ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    : '';
                return timeStr ? `[${timeStr}] ${role}: ${msg.content}` : `${role}: ${msg.content}`;
            }).join('\n');

            const summarizePrompt = buildSummarizePrompt();
            const summaryUserPrompt = `以下是今日手机聊天的完整记录，请进行总结：\n\n${transcript}`;

            const summary = await callPhoneLLM(summarizePrompt, summaryUserPrompt, { maxTokens: 2000 });

            if (!summary || summary.trim().length === 0) {
                throw new Error('总结生成失败');
            }

            console.log(`${CHAT_LOG_PREFIX} Summary generated: ${summary.substring(0, 100)}...`);

            if (statusEl) statusEl.innerHTML = '<i class="ph ph-check-circle"></i> 总结生成成功！正在发送…';

            await sendSummaryAsUserMessage(summary.trim());

            if (statusEl) statusEl.innerHTML = '<i class="ph ph-house"></i> 已回家！总结已作为消息发送，你对象正在回应～';
        }

        console.log(`${CHAT_LOG_PREFIX} Return home flow completed successfully (mode: ${syncMode}, memory: ${doMemoryFragments})`);

    } catch (error) {
        console.error(`${CHAT_LOG_PREFIX} Return home failed:`, error);

        const statusEl = document.getElementById('chat_sync_status');
        if (statusEl) {
            statusEl.innerHTML = `<i class="ph ph-warning"></i> 同步失败: ${error.message}`;
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════
// "手动总结" — Manual Summarize
// ═══════════════════════════════════════════════════════════════════════

/**
 * Manually trigger rolling summary generation.
 * Fallback for when auto-summarize fails or user wants to force it.
 */
export async function handleManualSummarize() {
    const history = loadChatHistory();
    const unsummarized = history.filter(m => !m.summarized);

    if (unsummarized.length === 0) {
        alert('没有需要总结的新消息～');
        return;
    }

    if (!confirm(`将对 ${unsummarized.length} 条未总结消息进行压缩总结。\n这会消耗一次LLM调用，确定继续吗？`)) {
        return;
    }

    const charName = getCharacterInfo()?.name || '角色';
    const userName = getUserName();

    // Show status in chat
    const messagesArea = document.getElementById('chat_messages_area');
    if (messagesArea) {
        messagesArea.insertAdjacentHTML('beforeend',
            `<div class="chat-retract" id="chat_summarize_status"><i class="ph ph-note"></i> 正在生成总结…</div>`);
    }
    scrollToBottom(true);

    try {
        // Keep recent 30 messages unsummarized (same as auto-summarize)
        const KEEP_RECENT = 30;
        const toSummarizeCount = unsummarized.length - KEEP_RECENT;

        if (toSummarizeCount <= 0) {
            const statusEl = document.getElementById('chat_summarize_status');
            if (statusEl) statusEl.innerHTML = '<i class="ph ph-check-circle"></i> 消息数量不足，无需总结（少于30条未总结）';
            return;
        }

        const messagesToSummarize = unsummarized.slice(0, toSummarizeCount);

        // Build identity stamps for safe matching
        const summarizedStamps = new Set(
            messagesToSummarize.map(m => `${m.timestamp}|${m.role}|${(m.content || '').slice(0, 50)}`)
        );

        // Build transcript
        const transcript = messagesToSummarize.map(msg => {
            const role = msg.role === 'user' ? userName : charName;
            const timeStr = msg.timestamp
                ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : '';
            return timeStr ? `[${timeStr}] ${role}: ${msg.content}` : `${role}: ${msg.content}`;
        }).join('\n');

        const existingSummary = loadChatSummary();
        const summarySystemPrompt = buildRollingSummarizePrompt();

        let summaryUserPrompt;
        if (existingSummary) {
            summaryUserPrompt = `旧总结：\n${existingSummary}\n\n新的聊天记录：\n${transcript}\n\n请合并为一份完整的总结。`;
        } else {
            summaryUserPrompt = `聊天记录：\n${transcript}\n\n请生成总结。`;
        }

        // Push to Console app for debugging
        try { pushPromptLog('ManualSummarize System', summarySystemPrompt); } catch (e) { /* */ }
        try { pushPromptLog('ManualSummarize User', '', summaryUserPrompt); } catch (e) { /* */ }

        const statusEl = document.getElementById('chat_summarize_status');
        if (statusEl) statusEl.innerHTML = '<i class="ph ph-spinner"></i> LLM 正在压缩总结…';

        const newSummary = await callPhoneLLM(summarySystemPrompt, summaryUserPrompt, { maxTokens: 2000 });

        if (!newSummary || !newSummary.trim()) {
            throw new Error('LLM 返回了空的总结');
        }

        // Save summary
        saveChatSummary(newSummary.trim());

        // Mark messages as summarized
        const freshHistory = loadChatHistory();
        let markedCount = 0;
        for (const msg of freshHistory) {
            if (msg.summarized) continue;
            const stamp = `${msg.timestamp}|${msg.role}|${(msg.content || '').slice(0, 50)}`;
            if (summarizedStamps.has(stamp)) {
                msg.summarized = true;
                markedCount++;
            }
        }
        // Use direct save to persist
        const { saveChatHistory } = await import('./chatStorage.js');
        saveChatHistory(freshHistory);

        console.log(`${CHAT_LOG_PREFIX} ✅ 手动总结完成: ${newSummary.trim().length} 字, 标记 ${markedCount} 条`);
        if (statusEl) statusEl.innerHTML = `<i class="ph ph-check-circle"></i> 总结完成！压缩了 ${markedCount} 条消息 (${newSummary.trim().length} 字)`;

    } catch (error) {
        console.error(`${CHAT_LOG_PREFIX} ❌ 手动总结失败:`, error);
        const statusEl = document.getElementById('chat_summarize_status');
        if (statusEl) statusEl.innerHTML = `<i class="ph ph-warning"></i> 总结失败: ${error.message}`;
    }
}
