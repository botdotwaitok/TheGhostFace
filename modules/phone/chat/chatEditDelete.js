// modules/phone/chat/chatEditDelete.js — Delete mode, Edit mode, Reroll
// Extracted from chatApp.js

import {
    escHtml, CHAT_LOG_PREFIX, scrollToBottom, showTypingIndicator, sleep,
    getIsGenerating, setIsGenerating, getIsDeleteMode, setIsDeleteMode,
    getSelectedForDeletion,
    getIsEditMode, setIsEditMode, getSelectedEditIndex, setSelectedEditIndex,
    updateButtonStates, rerenderMessagesArea,
} from './chatApp.js';
import {
    loadChatHistory, saveChatHistory,
    deleteMessagesByIndices, updateMessageByIndex,
    getCharacterInfo,
} from './chatStorage.js';
import { callPhoneLLM } from '../../api.js';
import { buildChatSystemPrompt, buildChatUserPrompt, stripMomentsCommands } from './chatPromptBuilder.js';
import { buildBubbleRow, buildRecalledPeekBubble } from './chatHtmlBuilder.js';
import { parseApiResponse } from './chatMessageHandler.js';
import { renderBuffBar } from './chatInventory.js';

// ═══════════════════════════════════════════════════════════════════════
// Delete Mode (iMessage-style Batch Select) & Reroll
// ═══════════════════════════════════════════════════════════════════════

/**
 * Toggle delete mode — shows checkboxes and delete toolbar.
 */
export function toggleDeleteMode() {
    setIsDeleteMode(!getIsDeleteMode());
    getSelectedForDeletion().clear();

    const rows = document.querySelectorAll('.chat-bubble-row[data-msg-index]');
    const inputBar = document.getElementById('chat_input_bar');
    const draftArea = document.getElementById('chat_draft_area');
    const deleteToolbar = document.getElementById('chat_delete_toolbar');

    rows.forEach(row => {
        if (getIsDeleteMode()) {
            row.classList.add('delete-mode');
            row.classList.remove('selected');
        } else {
            row.classList.remove('delete-mode', 'selected');
        }
    });

    // Toggle input bar / delete toolbar visibility
    if (inputBar) inputBar.style.display = getIsDeleteMode() ? 'none' : '';
    if (draftArea && getIsDeleteMode()) draftArea.style.display = 'none';
    if (deleteToolbar) deleteToolbar.style.display = getIsDeleteMode() ? 'flex' : 'none';

    // Update the menu button label
    const deleteModeBtn = document.getElementById('chat_delete_mode_btn');
    if (deleteModeBtn) {
        deleteModeBtn.textContent = getIsDeleteMode() ? '退出删除模式' : '删除消息';
    }

    if (getIsDeleteMode()) updateDeleteToolbar();
}

/**
 * Toggle selection of a single message in batch-delete mode.
 */
export function toggleSelectMessage(index, rowElement) {
    const selected = getSelectedForDeletion();
    if (selected.has(index)) {
        selected.delete(index);
        rowElement.classList.remove('selected');
    } else {
        selected.add(index);
        rowElement.classList.add('selected');
    }
    updateDeleteToolbar();
}

/**
 * Update the delete toolbar count and button state.
 */
export function updateDeleteToolbar() {
    const countEl = document.getElementById('chat_delete_count');
    const confirmBtn = document.getElementById('chat_delete_confirm_btn');
    const count = getSelectedForDeletion().size;

    if (countEl) countEl.textContent = `已选 ${count} 条`;
    if (confirmBtn) confirmBtn.disabled = count === 0;
}

/**
 * Batch delete all selected messages and re-render.
 */
export function handleBatchDelete() {
    const selected = getSelectedForDeletion();
    const count = selected.size;
    if (count === 0) return;

    if (!confirm(`确定删除 ${count} 条消息吗？`)) return;

    const indices = [...selected];
    const deleted = deleteMessagesByIndices(indices);
    console.log(`${CHAT_LOG_PREFIX} 批量删除了 ${deleted} 条消息`);

    selected.clear();

    // Re-render the messages area
    rerenderMessagesArea();

    // Re-apply delete mode
    if (getIsDeleteMode()) {
        const messagesArea = document.getElementById('chat_messages_area');
        messagesArea?.querySelectorAll('.chat-bubble-row[data-msg-index]').forEach(row => {
            row.classList.add('delete-mode');
        });
    }

    updateDeleteToolbar();
}

// ═══════════════════════════════════════════════════════════════════════
// Edit Mode — Tap a message to edit its content in-place
// ═══════════════════════════════════════════════════════════════════════

/**
 * Toggle edit mode — messages become tappable to open the edit overlay.
 */
export function toggleEditMode() {
    setIsEditMode(!getIsEditMode());
    setSelectedEditIndex(-1);

    const rows = document.querySelectorAll('.chat-bubble-row[data-msg-index]');
    const inputBar = document.getElementById('chat_input_bar');
    const draftArea = document.getElementById('chat_draft_area');

    rows.forEach(row => {
        if (getIsEditMode()) {
            row.classList.add('edit-mode');
        } else {
            row.classList.remove('edit-mode');
        }
    });

    if (inputBar) inputBar.style.display = getIsEditMode() ? 'none' : '';
    if (draftArea && getIsEditMode()) draftArea.style.display = 'none';

    const editModeBtn = document.getElementById('chat_edit_mode_btn');
    if (editModeBtn) {
        editModeBtn.textContent = getIsEditMode() ? '退出编辑模式' : '编辑消息';
    }
}

/**
 * Close the edit overlay without saving, and exit edit mode.
 */
export function closeEditOverlay() {
    const editOverlay = document.getElementById('chat_edit_overlay');
    editOverlay?.classList.remove('active');
    setSelectedEditIndex(-1);
    // Exit edit mode after closing
    if (getIsEditMode()) toggleEditMode();
}

/**
 * Open the edit overlay pre-filled with the content of the given message index.
 */
export function openEditOverlay(msgIndex) {
    const history = loadChatHistory();
    if (msgIndex < 0 || msgIndex >= history.length) return;

    const msg = history[msgIndex];
    setSelectedEditIndex(msgIndex);

    const textarea = document.getElementById('chat_edit_textarea');
    if (textarea) {
        textarea.value = msg.content || '';
        // Auto-resize
        textarea.style.height = 'auto';
        textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
    }

    const editOverlay = document.getElementById('chat_edit_overlay');
    editOverlay?.classList.add('active');

    // Focus & move cursor to end
    requestAnimationFrame(() => {
        if (textarea) {
            textarea.focus();
            textarea.setSelectionRange(textarea.value.length, textarea.value.length);
        }
    });
}

/**
 * Save the edited content to history and re-render.
 */
export function handleEditSave() {
    if (getSelectedEditIndex() < 0) return;

    const textarea = document.getElementById('chat_edit_textarea');
    const newContent = textarea?.value?.trim();
    if (!newContent) return;

    const updated = updateMessageByIndex(getSelectedEditIndex(), newContent);
    if (!updated) return;

    console.log(`${CHAT_LOG_PREFIX} 编辑了消息 [${getSelectedEditIndex()}]`);

    // Close overlay + exit edit mode
    const editOverlay = document.getElementById('chat_edit_overlay');
    editOverlay?.classList.remove('active');
    setSelectedEditIndex(-1);
    if (getIsEditMode()) toggleEditMode();

    // Re-render messages
    rerenderMessagesArea();
}

/**
 * Reroll — remove the last AI response(s), then re-generate using the
 * same user message context.
 */
export async function rerollLastMessage() {

    if (getIsGenerating()) return;

    const history = loadChatHistory();
    if (history.length === 0) return;

    // Remove trailing char messages
    let removedCount = 0;
    while (history.length > 0 && history[history.length - 1].role === 'char') {
        history.pop();
        removedCount++;
    }

    if (removedCount === 0) {
        // No trailing char messages — check if we can still regenerate
        // (e.g. user deleted AI messages manually, last messages are user's)
        if (history.length > 0 && history[history.length - 1].role === 'user') {
            console.log(`${CHAT_LOG_PREFIX} 没有尾部AI消息，但找到用户消息，将直接重新生成`);
            // Fall through to use existing user messages for regeneration
        } else {
            console.log(`${CHAT_LOG_PREFIX} 没有可重新生成的AI消息`);
            return;
        }
    }

    // Collect the last user messages that preceded the removed AI messages
    const lastUserMessages = [];
    for (let i = history.length - 1; i >= 0; i--) {
        if (history[i].role === 'user') {
            lastUserMessages.unshift(history[i].content);
        } else {
            break;
        }
    }

    if (lastUserMessages.length === 0) {
        console.warn(`${CHAT_LOG_PREFIX} 找不到之前的用户消息，无法重新生成`);
        return;
    }

    // Save the trimmed history (without the removed AI messages)
    saveChatHistory(history);

    // Re-render without the removed AI messages
    rerenderMessagesArea();

    // Exit delete mode if active
    if (getIsDeleteMode()) toggleDeleteMode();

    // Now re-generate — reuse the core send logic
    setIsGenerating(true);
    updateButtonStates();
    showTypingIndicator(true);

    const messagesArea = document.getElementById('chat_messages_area');
    try {
        const systemPrompt = await buildChatSystemPrompt();
        const userPrompt = buildChatUserPrompt(lastUserMessages, history.slice(0, -lastUserMessages.length));

        console.log(`${CHAT_LOG_PREFIX} Reroll: re-generating with ${lastUserMessages.length} user messages...`);

        const rawResponse = await callPhoneLLM(systemPrompt, userPrompt, { maxTokens: 4000 });

        // ─── Route moments commands (朋友圈/评论) to moments system ───
        try {
            const { handleMainChatOutput } = await import('../moments/momentsWorldInfo.js');
            handleMainChatOutput(rawResponse).catch(e =>
                console.warn(`${CHAT_LOG_PREFIX} Moments routing (reroll) failed:`, e));
        } catch (e) { /* moments module not loaded */ }

        const cleanedResponse = stripMomentsCommands(rawResponse);
        const { messages: charMessages } = parseApiResponse(cleanedResponse);

        // Strip moments commands from message text
        for (const cmsg of charMessages) {
            cmsg.text = stripMomentsCommands(cmsg.text) || cmsg.text;
        }

        if (charMessages.length === 0) {
            throw new Error('LLM返回了空的消息数组');
        }

        showTypingIndicator(false);

        const updatedHistory = loadChatHistory();
        const responseTime = new Date().toISOString();

        for (let i = 0; i < charMessages.length; i++) {
            const cmsg = charMessages[i];
            const delay = i === 0 ? 0 : (cmsg.delay || 1) * 300;

            if (delay > 0) {
                showTypingIndicator(true);
                await sleep(Math.min(delay, 2000));
                showTypingIndicator(false);
            }

            const historyEntry = {
                role: 'char',
                content: cmsg.text,
                thought: cmsg.thought || '',
                timestamp: responseTime,
            };
            if (cmsg.recalledContent) {
                historyEntry.recalledContent = cmsg.recalledContent;
            }
            updatedHistory.push(historyEntry);

            if (messagesArea) {
                if (cmsg.text === '[撤回了一条消息]' && cmsg.recalledContent) {
                    const charName = getCharacterInfo()?.name || '对方';
                    messagesArea.insertAdjacentHTML('beforeend',
                        `<div class="chat-retract">${escHtml(charName)}撤回了一条消息</div>`);
                    messagesArea.insertAdjacentHTML('beforeend',
                        buildRecalledPeekBubble(cmsg.recalledContent));
                } else {
                    messagesArea.insertAdjacentHTML('beforeend', buildBubbleRow('char', cmsg.text, cmsg.thought));
                }
            }
            scrollToBottom(true);
        }

        saveChatHistory(updatedHistory);
        renderBuffBar();

    } catch (error) {
        console.error(`${CHAT_LOG_PREFIX} Reroll failed:`, error);
        showTypingIndicator(false);

        if (messagesArea) {
            messagesArea.insertAdjacentHTML('beforeend',
                `<div class="chat-retract">⚠️ 重新生成失败: ${escHtml(error.message)}</div>`);
        }
        scrollToBottom(true);
    } finally {
        setIsGenerating(false);
        updateButtonStates();
    }
}
