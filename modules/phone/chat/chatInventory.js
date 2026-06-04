// modules/phone/chat/chatInventory.js — Buff bar, Inventory panel, Return Home
// Extracted from chatApp.js

import { getPhoneSetting } from '../phoneSettings.js';

import { escHtml, CHAT_LOG_PREFIX, scrollToBottom } from './chatApp.js';
import {
    loadChatHistory, getCharacterInfo, getUserName,
    sendSummaryAsUserMessage, sendRawTranscriptAsUserMessage,
    loadChatSummary, saveChatSummary,
    getMessagesSinceHome, loadHomeMarker, saveHomeMarker,
    markMessagesSummarizedUntil,
    pushChatSummaryHistory,
    pushReturnHomeArchive,
    callPhoneLLMWithTimeout,
    formatTranscriptLine,
    isAnySummarizing, setManualSummarizingFlag,
} from './chatStorage.js';
import { openProgressCard } from './chatProgressCard.js';
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

    // Only sync messages newer than the previous 回家 — never re-send what was
    // already folded into a prior summary. Marker advances on success below.
    const newMessages = getMessagesSinceHome(history);
    if (newMessages.length === 0) {
        alert('上次回家之后还没有新的聊天记录，不需要再同步～');
        return;
    }

    // Drop manually-hidden / already-folded messages (`summarized: true`).
    // Same field the prompt builder uses to exclude bubbles from <chat_history>,
    // so the manual-hide gesture must apply here too — otherwise 回家 silently
    // re-sends what the user just chose to hide and burns a fortune in tokens.
    const visibleNewMessages = newMessages.filter(m => !m.summarized);
    const hiddenCount = newMessages.length - visibleNewMessages.length;

    if (visibleNewMessages.length === 0) {
        alert(`上次回家之后的 ${newMessages.length} 条新消息全部被手动隐藏了，没有可同步的内容～`);
        return;
    }

    // Read user preferences from persistent settings
    const doMemoryFragments = getPhoneSetting('rhMemory', false);
    const syncMode = getPhoneSetting('rhSyncMode', 'summary');

    const modeLabel = syncMode === 'raw' ? '原文灌入' : '压缩总结';
    const memoryLabel = doMemoryFragments ? '[ ON ] 提取记忆碎片' : '[ OFF ] 不提取记忆碎片';
    const skippedBeforeMarker = history.length - newMessages.length;

    // Headline stays a single number so the user can't misread how much is
    // about to be sent. Skip details drop into a quiet second-line parenthetical
    // only when they're non-zero — and only the entries actually present show up.
    const skipNotes = [];
    if (hiddenCount > 0) skipNotes.push(`手动隐藏 ${hiddenCount} 条`);
    if (skippedBeforeMarker > 0) skipNotes.push(`上次回家前 ${skippedBeforeMarker} 条`);
    const scopeLabel = skipNotes.length > 0
        ? `本次将总结 ${visibleNewMessages.length} 条消息\n（已自动跳过：${skipNotes.join('、')}）`
        : `本次将总结 ${visibleNewMessages.length} 条消息`;

    if (!confirm(`确定要结束手机聊天并回到线下吗？\n\n${scopeLabel}\n\n同步方式: ${modeLabel}\n${memoryLabel}\n\n（可在 设置 → 聊天 中修改）`)) {
        return;
    }

    const charName = getCharacterInfo()?.name || '角色';
    const userName = getUserName();

    // Progress card lives on the phone shell, not the chat DOM — survives the
    // user switching to another app while the LLM call is still running.
    const card = openProgressCard({ title: '回家流程' });

    // Snapshot the rolling chat summary BEFORE running any LLM call. It
    // covers the earlier portion of this 回家 cycle that auto-summarize
    // already folded out of <chat_history> — those raw messages now carry
    // summarized: true and are filtered from visibleNewMessages, so this
    // summary is the only remaining record of that span. We must fold it
    // into the LLM input or that whole span gets silently dropped on the
    // way to ST main chat, then permanently erased by saveChatSummary('')
    // at the end of the flow.
    const existingSummary = loadChatSummary();

    // Captured across the try-block so the archive push at the end sees the
    // same content that actually went to ST main chat. payloadText holds the
    // user-meaningful body (LLM summary for summary mode; transcript +
    // optional prior-summary prefix for raw mode), memoryFragmentCount notes
    // how many world-book entries this run produced (0 when extraction was
    // off or returned nothing).
    let archivePayload = '';
    let archiveMemoryFragmentCount = 0;

    try {
        // ─── Optional Step: Memory Fragment Extraction ───
        if (doMemoryFragments) {
            card.setStage('正在提取记忆碎片 …');
            console.log(`${CHAT_LOG_PREFIX} Return home: extracting memory fragments...`);

            try {
                // Convert phone chat messages to the format generateSummary() expects.
                // Use visibleNewMessages (post-marker slice, minus manually-hidden)
                // so we don't re-extract memory from chats that a previous 回家
                // already processed, and so the user's hide gesture is honored here too.
                const summarizerMessages = visibleNewMessages.map(msg => ({
                    parsedContent: msg.content || '',
                    parsedDate: msg.timestamp ? new Date(msg.timestamp).toLocaleDateString('zh-CN') : null,
                    is_user: msg.role === 'user',
                    is_system: false,
                    name: msg.role === 'user' ? userName : charName,
                }));

                // generateSummary returns { entries, timelineSegments }, not a bare array
                const summaryResult = await generateSummary(summarizerMessages, true);
                const fragments = summaryResult?.entries;
                if (Array.isArray(fragments) && fragments.length > 0) {
                    await saveToWorldBook(fragments, null, null, isContentSimilar);
                    archiveMemoryFragmentCount = fragments.length;
                    console.log(`${CHAT_LOG_PREFIX} ✅ 记忆碎片已写入世界书: ${fragments.length} 条`);
                    card.setStage(`记忆碎片已写入 ${fragments.length} 条 …`);
                } else {
                    console.log(`${CHAT_LOG_PREFIX} ℹ️ 鬼面判断无新记忆碎片`);
                    card.setStage('无新记忆碎片 …');
                }
            } catch (memErr) {
                console.error(`${CHAT_LOG_PREFIX} 记忆碎片提取失败:`, memErr);
                card.setStage('记忆碎片提取失败，继续同步 …');
                // Don't abort — continue with sync
            }
        }

        // ─── Sync to ST main chat ───
        if (syncMode === 'raw') {
            // ── Raw transcript mode ──
            card.setStage('正在发送原文聊天记录 …');
            const priorNote = existingSummary ? ` (+ ${existingSummary.length}-char prior summary prefix)` : '';
            console.log(`${CHAT_LOG_PREFIX} Return home: sending raw transcript (${visibleNewMessages.length} visible / ${newMessages.length} total new, ${hiddenCount} hidden)${priorNote}...`);

            // Reproduce the transcript body that sendRawTranscriptAsUserMessage
            // builds for ST main chat, so the archive's payload mirrors the
            // user-meaningful content of this run (without the QR wrapper /
            // scene-time block, which are template scaffolding). When a prior
            // rolling summary covered the earlier slice, prepend it the same
            // way the sender does — that's the actual record of what 回家 sent.
            const rawTranscript = visibleNewMessages.map(msg => {
                const role = msg.role === 'user' ? userName : charName;
                const timeStr = msg.timestamp
                    ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    : '';
                return timeStr ? `[${timeStr}] ${role}: ${msg.content}` : `${role}: ${msg.content}`;
            }).join('\n');
            const hasPrior = typeof existingSummary === 'string' && existingSummary.trim().length > 0;
            archivePayload = hasPrior
                ? `【更早些时候已被压缩的对话（仅总结形式）】\n${existingSummary}\n\n【尚未压缩的对话原文】\n${rawTranscript}`
                : rawTranscript;

            await sendRawTranscriptAsUserMessage(visibleNewMessages, existingSummary);

        } else {
            // ── AI compressed summary mode (default) ──
            card.setStage('鬼面正在浓缩今日聊天 …');
            console.log(`${CHAT_LOG_PREFIX} Return home: generating AI summary (${visibleNewMessages.length} visible / ${newMessages.length} total new, ${hiddenCount} hidden)...`);

            const transcript = visibleNewMessages.map(msg => {
                const role = msg.role === 'user' ? userName : charName;
                const timeStr = msg.timestamp
                    ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    : '';
                return timeStr ? `[${timeStr}] ${role}: ${msg.content}` : `${role}: ${msg.content}`;
            }).join('\n');

            const summarizePrompt = buildSummarizePrompt();

            // When a rolling chat summary exists, the visible transcript only
            // covers the unsummarized tail — the earlier span lives in that
            // summary. Hand both halves to the LLM and ask for an integrated
            // recap so ST main chat receives the whole 回家 cycle, not just
            // the recent leftovers.
            const summaryUserPrompt = existingSummary
                ? `以下是今日手机聊天的内容，请整合成一份完整的回顾给线下场景使用：\n\n` +
                  `【之前的对话总结】\n${existingSummary}\n\n` +
                  `【最近的对话】\n${transcript}`
                : `以下是今日手机聊天的完整记录，请进行总结：\n\n${transcript}`;

            const summary = await callPhoneLLM(summarizePrompt, summaryUserPrompt, { maxTokens: 40000 });

            if (!summary || summary.trim().length === 0) {
                throw new Error('总结生成失败');
            }

            console.log(`${CHAT_LOG_PREFIX} Summary generated: ${summary.substring(0, 100)}...`);

            card.setStage('总结生成成功，正在送达 …');

            archivePayload = summary.trim();
            await sendSummaryAsUserMessage(summary.trim(), visibleNewMessages);
        }

        // Advance the 回家 marker. Re-read history here instead of using
        // newMessages.end — during the LLM call (5–30s) autoMessage or the
        // user can append new messages to phone history. Anchoring to
        // history's true tail folds those concurrent messages into "已处理"
        // for the same 回家 batch, avoiding a re-sync window.
        const latestHistory = loadChatHistory();
        let newMarker = '';
        for (let i = latestHistory.length - 1; i >= 0; i--) {
            if (latestHistory[i].timestamp) { newMarker = latestHistory[i].timestamp; break; }
        }
        if (newMarker) {
            // Snapshot the marker BEFORE we advance it so the archive entry
            // can record where to roll back to if the user later deletes it.
            // Without this, deleting an archive entry would clear summarized
            // marks but leave the home marker frozen at its new position —
            // getMessagesSinceHome filters by marker only, so the next 回家
            // would still see the just-restored slice as "already synced".
            // Empty string is a valid value (first-ever 回家).
            const prevHomeMarker = loadHomeMarker();
            await saveHomeMarker(newMarker);
            console.log(`${CHAT_LOG_PREFIX} 回家 marker → ${newMarker}`);

            // Hide already-synced messages from future chat prompts. The
            // content was just folded into ST main chat (summary or raw),
            // so re-sending it through <chat_history> would waste tokens
            // and tempt the LLM to repeat itself. UI still shows the
            // bubbles — only the prompt-side filter skips them.
            const markedCount = await markMessagesSummarizedUntil(newMarker);
            if (markedCount > 0) {
                console.log(`${CHAT_LOG_PREFIX} ✅ 已将 ${markedCount} 条回家前的消息标记为已总结，下次进入聊天不再回灌 LLM`);
            }

            // ─── Phase 6: paper-trail archive ───
            // Push only after the marker + summarized marks have already
            // landed — those two are the load-bearing state changes; if any
            // of them failed earlier the catch path runs and we never reach
            // here. floorRange is the slice this run folded, sourced from
            // visibleNewMessages (the exact set passed to the sender). Skip
            // the range when any message lacks .floor (pre-Phase-1 data) so
            // the archive UI doesn't try to "restore" a NaN range and unmark
            // unrelated messages.
            try {
                const floors = visibleNewMessages
                    .map(m => m.floor)
                    .filter(f => typeof f === 'number' && Number.isFinite(f));
                const archiveFloorRange = floors.length === visibleNewMessages.length && floors.length > 0
                    ? { from: Math.min(...floors), to: Math.max(...floors) }
                    : undefined;
                await pushReturnHomeArchive({
                    mode: syncMode === 'raw' ? 'raw' : 'summary',
                    payload: archivePayload,
                    msgCount: visibleNewMessages.length,
                    prevHomeMarker,
                    ...(archiveFloorRange ? { floorRange: archiveFloorRange } : {}),
                    ...(archiveMemoryFragmentCount > 0 ? { memoryFragmentCount: archiveMemoryFragmentCount } : {}),
                });
                console.log(`${CHAT_LOG_PREFIX} ✅ 回家档案已记录 (mode=${syncMode}, msgs=${visibleNewMessages.length}, range=${archiveFloorRange ? `#${archiveFloorRange.from}-#${archiveFloorRange.to}` : 'unknown'})`);
            } catch (archiveErr) {
                // Archive failure must NOT roll back the successful sync —
                // ST main chat already received the payload, the marker is
                // already advanced. Log and continue so the user still sees
                // 回家 succeed; the paper trail just misses one entry.
                console.warn(`${CHAT_LOG_PREFIX} 回家档案写入失败（同步本身已成功）:`, archiveErr);
            }

            // Drop the rolling chat summary. 回家 is the canonical handoff
            // to ST main chat — any compressed snapshot of pre-回家 content
            // is now stale (the main story may advance past it) and would
            // double-cover the same range that markMessagesSummarizedUntil
            // already excludes from <chat_history>.
            await saveChatSummary('');
            console.log(`${CHAT_LOG_PREFIX} ✅ 已清空回家前的滚动总结，避免与 ST 主线重复`);
        }

        console.log(`${CHAT_LOG_PREFIX} Return home flow completed successfully (mode: ${syncMode}, memory: ${doMemoryFragments})`);
        card.complete('已回家！');

    } catch (error) {
        console.error(`${CHAT_LOG_PREFIX} Return home failed:`, error);
        card.fail(`同步失败：${error.message}`);
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

    if (isAnySummarizing()) {
        alert('后台正在压缩中，请稍候…');
        return;
    }

    if (!confirm(`将对 ${unsummarized.length} 条未总结消息进行压缩总结。\n这会消耗一次LLM调用，确定继续吗？`)) {
        return;
    }

    const charName = getCharacterInfo()?.name || '角色';
    const userName = getUserName();

    setManualSummarizingFlag(true);
    const card = openProgressCard({ title: '压缩聊天记忆' });

    try {
        // Keep recent 30 messages unsummarized — manual summarize is meant for
        // an explicit "compress now" user gesture and reuses a smaller floor
        // than auto's 60, so a tap on the button actually folds something even
        // when the chat is below the auto threshold.
        const KEEP_RECENT = 30;
        const toSummarizeCount = unsummarized.length - KEEP_RECENT;

        if (toSummarizeCount <= 0) {
            card.complete('消息不足，无需总结');
            return;
        }

        const messagesToSummarize = unsummarized.slice(0, toSummarizeCount);

        // Build identity stamps for safe matching
        const summarizedStamps = new Set(
            messagesToSummarize.map(m => `${m.timestamp}|${m.role}|${(m.content || '').slice(0, 50)}`)
        );

        // Use the shared transcript formatter so manual and auto paths feed
        // identical [YYYY-MM-DD HH:MM] context to the LLM — the rolling-summary
        // prompt asks for concrete dates and the model can only obey if it
        // actually sees them on each line.
        const transcript = messagesToSummarize.map(msg => {
            const role = msg.role === 'user' ? userName : charName;
            return formatTranscriptLine(role, msg);
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

        card.setStage('鬼面正在奋笔疾书 …');

        const newSummary = await callPhoneLLMWithTimeout(
            summarySystemPrompt,
            summaryUserPrompt,
            { maxTokens: 40000 },
        );

        if (!newSummary || !newSummary.trim()) {
            throw new Error('鬼面返回了空的总结');
        }

        card.setStage('收尾归档 …');

        // Archive the previous rolling summary into history BEFORE overwriting
        // so the "查看总结 → 历史" page keeps a paper trail. The auto path
        // already does this; manual was missing it, which is why users only
        // ever saw the latest version with no way to recover prior text.
        // floorRange = the slice this round newly folded; skipped if any
        // message lacks .floor (pre-migration data) so we never write a NaN
        // range that would break the Phase 3 "delete & restore" lookup.
        const foldedFloors = messagesToSummarize
            .map(m => m.floor)
            .filter(f => typeof f === 'number' && Number.isFinite(f));
        const foldedFloorRange = foldedFloors.length === messagesToSummarize.length
            ? { from: Math.min(...foldedFloors), to: Math.max(...foldedFloors) }
            : undefined;
        await pushChatSummaryHistory({
            summary: existingSummary,
            source: 'auto',
            msgCount: messagesToSummarize.length,
            floorRange: foldedFloorRange,
        });
        await saveChatSummary(newSummary.trim());

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
        await saveChatHistory(freshHistory);

        console.log(`${CHAT_LOG_PREFIX} ✅ 手动总结完成: ${newSummary.trim().length} 字, 标记 ${markedCount} 条`);
        card.complete(`压缩完成，折叠 ${markedCount} 条`);

    } catch (error) {
        console.error(`${CHAT_LOG_PREFIX} ❌ 手动总结失败:`, error);
        card.fail(`压缩失败：${error.message}`);
    } finally {
        setManualSummarizingFlag(false);
    }
}
