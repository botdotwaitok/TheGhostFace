// modules/phone/chat/chatEditDelete.js — Delete mode, Edit mode, Reroll
// Extracted from chatApp.js

import {
    escHtml, CHAT_LOG_PREFIX, scrollToBottom, showTypingIndicator,
    getIsGenerating, setIsGenerating, getIsDeleteMode, setIsDeleteMode,
    getSelectedForDeletion,
    getIsEditMode, setIsEditMode, getSelectedEditIndex, setSelectedEditIndex,
    updateButtonStates, rerenderMessagesArea,
} from './chatApp.js';
import {
    loadChatHistory, saveChatHistory,
    deleteMessagesByIndices, updateMessageByIndex,
    selectActiveHistoryForPrompt,
} from './chatStorage.js';
import { callPhoneLLM } from '../../api.js';
import { buildChatSystemPrompt, buildChatUserPrompt, buildIndexableReplyMap } from './chatPromptBuilder.js';
import { renderResponseToDom } from './chatMessageHandler.js';

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

    if (getIsDeleteMode()) updateDeleteToolbar();
}

/**
 * Enter delete mode and preselect a single message — convenience entry point
 * for the long-press bubble menu's "delete this one" action. Order matters:
 * toggleDeleteMode must run first so the row receives the .delete-mode class
 * and the toolbar appears; only then can the row be marked .selected.
 */
export function selectMessageForDeletion(msgIndex) {
    if (getIsDeleteMode()) return;
    toggleDeleteMode();
    const row = document.querySelector(`.chat-bubble-row[data-msg-index="${msgIndex}"]`);
    if (row) toggleSelectMessage(msgIndex, row);
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
export async function handleBatchDelete() {
    const selected = getSelectedForDeletion();
    const count = selected.size;
    if (count === 0) return;

    if (!confirm(`确定删除 ${count} 条消息吗？`)) return;

    const indices = [...selected];
    const deleted = await deleteMessagesByIndices(indices);
    console.log(`${CHAT_LOG_PREFIX} 批量删除了 ${deleted} 条消息`);

    selected.clear();

    // Re-render the messages area
    rerenderMessagesArea();

    // Exit delete mode so click / long-press work again right after deletion.
    // Without this, freshly painted rows keep .delete-mode and the click
    // delegate falls into the delete-mode branch (silently toggling selection)
    // while long-press stays gated by isDeleteMode — looks like the bubble
    // became inert. Mirrors rerollLastMessage's exit pattern.
    if (getIsDeleteMode()) toggleDeleteMode();
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
export async function handleEditSave() {
    if (getSelectedEditIndex() < 0) return;

    const textarea = document.getElementById('chat_edit_textarea');
    const newContent = textarea?.value?.trim();
    if (!newContent) return;

    const updated = await updateMessageByIndex(getSelectedEditIndex(), newContent);
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

    // Persist trimmed history — fire-and-forget through the serialized save
    // queue. Mirrors sendAllMessages: chat_metadata is already updated
    // synchronously inside saveChatHistory before its first await, so the
    // in-memory state is consistent for the rerender below. The disk write
    // can take seconds-to-minutes on remote (tailscale) sessions and must
    // not block visual feedback or the LLM call.
    saveChatHistory(history).catch(e =>
        console.warn(`${CHAT_LOG_PREFIX} background save during reroll failed:`, e));

    // Re-render without the removed AI messages — reads chat_metadata, which
    // the synchronous portion of saveChatHistory has already updated.
    rerenderMessagesArea();

    // Exit delete mode if active
    if (getIsDeleteMode()) toggleDeleteMode();

    // Flip UI to generating state right away — buttons grey out, typing
    // indicator appears — instead of waiting on the disk write.
    setIsGenerating(true);
    updateButtonStates();
    showTypingIndicator(true);

    const messagesArea = document.getElementById('chat_messages_area');
    try {
        const historyBeforeReroll = history.slice(0, -lastUserMessages.length);
        const systemPrompt = await buildChatSystemPrompt();
        const userPrompt = buildChatUserPrompt(lastUserMessages, historyBeforeReroll);
        // Mirror backgroundGen: snapshot the [N] lookup table for replyToIndex
        // resolution so a reroll can still produce reply-quoted bubbles. Must
        // go through selectActiveHistoryForPrompt so summarized filter + token
        // cap stay in lockstep with the prompt builder's chat_history slice.
        const rerollReplyMap = buildIndexableReplyMap(
            selectActiveHistoryForPrompt(historyBeforeReroll));

        console.log(`${CHAT_LOG_PREFIX} Reroll: re-generating with ${lastUserMessages.length} user messages...`);

        const rawResponse = await callPhoneLLM(systemPrompt, userPrompt, { maxTokens: 4000 });

        // Route moments commands (朋友圈/评论) to moments system — must run
        // before renderResponseToDom so the JSON has moments commands stripped
        // by the same logic the regular send path uses.
        try {
            const { handleMainChatOutput } = await import('../moments/momentsWorldInfo.js');
            handleMainChatOutput(rawResponse).catch(e =>
                console.warn(`${CHAT_LOG_PREFIX} Moments routing (reroll) failed:`, e));
        } catch (e) { /* moments module not loaded */ }

        // Delegate to the unified render path so reroll picks up buff decrement,
        // gift detection, robbery, AI reactions, auto-summarize — same as a normal send.
        await renderResponseToDom(rawResponse, lastUserMessages, rerollReplyMap);

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
