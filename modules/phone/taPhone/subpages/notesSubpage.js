// modules/phone/taPhone/subpages/notesSubpage.js — Notes (备忘录) sub-page.
// Phase 1: list-only render extracted verbatim from taPhoneApp.js. No
// detail page in v2 — notes cards already show the full body, so an
// extra layer would just be visual noise.
// Phase 3.5: top ⟳ on the list page appends 3-5 new notes via LLM.

import { escapeHtml } from '../../utils/helpers.js';
import {
    getPhoneCharInfo,
    getPhoneUserName,
    getPhoneUserPersona,
    getPhoneRecentChat,
    getPhoneWorldBookContext,
} from '../../phoneContext.js';
import { formatTimestamp, emptyHtml, callDetailLLM, TP_LOG } from '../taPhoneShared.js';
import { loadData, appendNotes } from '../taPhoneStore.js';
import { buildNotesBatchPrompt } from '../taPhonePromptBuilder.js';

export const NOTES_TITLE = '备忘录';
export const NOTES_EMPTY_ICON = 'ph ph-note';

export function renderNotesList(notes) {
    if (!Array.isArray(notes) || notes.length === 0) {
        return emptyHtml('还没有备忘录', NOTES_EMPTY_ICON);
    }
    const items = notes.map(n => {
        const title = (n.title || '').trim();
        const body = (n.body || '').trim();
        const tags = Array.isArray(n.tags) ? n.tags : [];
        const ts = formatTimestamp(n.timestamp);
        return `
            <div class="tp-card tp-note-card">
                ${title ? `<div class="tp-note-title">${escapeHtml(title)}</div>` : ''}
                <div class="tp-note-body">${escapeHtml(body)}</div>
                <div class="tp-note-meta">
                    <span class="tp-note-time">${escapeHtml(ts)}</span>
                    ${tags.length ? `<span class="tp-note-tags">${tags.map(t => `<span class="tp-tag">${escapeHtml(t)}</span>`).join('')}</span>` : ''}
                </div>
            </div>
        `;
    }).join('');
    return `<div class="tp-list">${items}</div>`;
}

/**
 * Append 3-5 new notes via LLM. No detail page exists for notes, so this
 * is a pure "grow the list" operation.
 *
 * @returns {Promise<{ added:number } | null>}
 */
export async function refreshNotes() {
    let data;
    try {
        data = await loadData();
    } catch (e) {
        console.warn(`${TP_LOG} refreshNotes loadData failed:`, e);
        return null;
    }
    const existingNotes = Array.isArray(data?.notes) ? data.notes : [];

    const charInfo = getPhoneCharInfo();
    const userName = getPhoneUserName();
    const userPersona = getPhoneUserPersona();
    const recentChatSummary = getPhoneRecentChat(20);
    let worldBookText = '';
    try { worldBookText = await getPhoneWorldBookContext(); } catch {}

    const { systemPrompt, userPrompt } = buildNotesBatchPrompt({
        charInfo, userName, userPersona, worldBookText, recentChatSummary,
        existingNotes,
    });

    console.log(`${TP_LOG} calling LLM for notes broad refresh`);
    const parsed = await callDetailLLM(systemPrompt, userPrompt, { maxTokens: 4000 });
    const list = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.notes) ? parsed.notes : null);
    if (!list) return null;

    const newNotes = list
        .filter(n => n && typeof n === 'object' && typeof n.body === 'string' && n.body.trim())
        .map(n => ({
            title: typeof n.title === 'string' ? n.title : '',
            body: n.body,
            tags: Array.isArray(n.tags) ? n.tags.filter(t => typeof t === 'string') : [],
            timestamp: typeof n.timestamp === 'string' ? n.timestamp : new Date().toISOString(),
        }));
    if (newNotes.length === 0) return null;

    try {
        await appendNotes(newNotes);
    } catch (e) {
        console.warn(`${TP_LOG} appendNotes failed:`, e);
        return null;
    }
    return { added: newNotes.length };
}
