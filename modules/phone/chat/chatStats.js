// modules/phone/chat/chatStats.js — Per-character data stats page.
// Sub-page under ChatSettings. Scope is single-character (matches ChatSearch).
// Counts messages + bytes by streaming through every self-managed chat file
// that the index records for the current character, updating totals as each
// file lands so the user sees progress instead of a frozen "Loading…".

import { getContext } from '../../../../../../extensions.js';
import { openAppInViewport } from '../phoneController.js';
import { fetchFile } from '../../storage/fileStore.js';
import { filenameForHash } from '../../storage/chatHistoryStore.js';
import { getEntriesForChar, removeEntry } from '../../storage/chatIndexStore.js';
import { loadChatHistory, loadChatSummary, SUMMARIZE_PROMPT_TOKEN_THRESHOLD } from './chatStorage.js';
import { openChatSettingsPage } from './chatSettings.js';
import { buildChatSystemPrompt, buildChatUserPrompt } from './chatPromptBuilder.js';
import { countTokensFromPromptData } from '../../core.js';
import {
    createTalkativeAggregator,
    createThoughtRatioAggregator,
    createHeatmapAggregator,
    createWordFreqAggregator,
    createEmojiUsageAggregator,
} from './chatStatsAggregate.js';

const LOG = '[ChatStats]';

let _backHandler = null;
let _runToken = 0; // bumped on exit/re-entry so a slow scan can be cancelled

// ───────────────────────────────────────────────────────────────────────
// Entry point
// ───────────────────────────────────────────────────────────────────────

export function openChatStatsPage() {
    const titleHtml = `<span class="chat-stats-nav-title">数据统计</span>`;
    const html = _buildPage();

    openAppInViewport(titleHtml, html, () => {
        _registerBackHandler();
        _runScan().catch(err => console.error(LOG, 'scan failed:', err));
    });
}

function _buildPage() {
    return `
    <div class="chat-stats-page" id="chat_stats_root">
        <div class="chat-stats-scroll">

            <div class="chat-stats-section">
                <div class="chat-stats-card chat-stats-summary-card chat-stats-next-round-card">
                    <div class="chat-stats-summary-row">
                        <span class="chat-stats-summary-label">总Token数</span>
                        <span class="chat-stats-summary-value" id="chat_stats_next_round_tokens">估算中…</span>
                    </div>
                    <div class="chat-stats-summary-row chat-stats-summary-subrow">
                        <span class="chat-stats-summary-sublabel">└ 短信未总结</span>
                        <span class="chat-stats-summary-value" id="chat_stats_phone_unsummarized_tokens">—</span>
                    </div>
                    <div class="chat-stats-summary-row chat-stats-summary-subrow">
                        <span class="chat-stats-summary-sublabel">└ 当前滚动总结</span>
                        <span class="chat-stats-summary-value" id="chat_stats_phone_summary_tokens">—</span>
                    </div>
                    <div class="chat-stats-summary-row chat-stats-summary-subrow">
                        <span class="chat-stats-summary-sublabel">└ 自动总结阈值</span>
                        <span class="chat-stats-summary-value" id="chat_stats_summarize_threshold">${SUMMARIZE_PROMPT_TOKEN_THRESHOLD.toLocaleString('en-US')}</span>
                    </div>
                </div>
            </div>

            <div class="chat-stats-section">
                <div class="chat-stats-card chat-stats-summary-card">
                    <div class="chat-stats-summary-row">
                        <span class="chat-stats-summary-label">总消息数</span>
                        <span class="chat-stats-summary-value" id="chat_stats_total_msgs">—</span>
                    </div>
                    <div class="chat-stats-summary-row">
                        <span class="chat-stats-summary-label">已隐藏消息数</span>
                        <span class="chat-stats-summary-value" id="chat_stats_hidden_msgs">—</span>
                    </div>
                    <div class="chat-stats-summary-row">
                        <span class="chat-stats-summary-label">文件总大小</span>
                        <span class="chat-stats-summary-value" id="chat_stats_total_bytes">—</span>
                    </div>
                </div>
            </div>

            <div class="chat-stats-section">
                <div class="chat-stats-card chat-stats-talkative-card">
                    <div class="chat-stats-card-header">
                        <i class="ph ph-chats-circle"></i>
                        <span class="chat-stats-card-title">话痨指数</span>
                    </div>
                    <div class="chat-stats-card-body" id="chat_stats_talkative_body">
                        <div class="chat-stats-empty">统计中…</div>
                    </div>
                </div>
            </div>

            <div class="chat-stats-section">
                <div class="chat-stats-card chat-stats-thought-ratio-card">
                    <div class="chat-stats-card-header">
                        <i class="ph ph-chat-circle-text"></i>
                        <span class="chat-stats-card-title">口是心非指数 </span>
                    </div>
                    <div class="chat-stats-card-body" id="chat_stats_thought_body">
                        <div class="chat-stats-empty">统计中…</div>
                    </div>
                </div>
            </div>

            <div class="chat-stats-section">
                <div class="chat-stats-card chat-stats-heatmap-card">
                    <div class="chat-stats-card-header">
                        <i class="ph ph-calendar-heart"></i>
                        <span class="chat-stats-card-title">最近聊天热力图</span>
                    </div>
                    <div class="chat-stats-card-body" id="chat_stats_heatmap_body">
                        <div class="chat-stats-empty">统计中…</div>
                    </div>
                </div>
            </div>

            <div class="chat-stats-section">
                <div class="chat-stats-card chat-stats-emoji-card chat-stats-emoji-inline-card">
                    <div class="chat-stats-card-header">
                        <i class="ph ph-smiley"></i>
                        <span class="chat-stats-card-title">聊天里爱用</span>
                    </div>
                    <div class="chat-stats-card-body" id="chat_stats_emoji_inline_body">
                        <div class="chat-stats-empty">统计中…</div>
                    </div>
                </div>
            </div>

            <div class="chat-stats-section">
                <div class="chat-stats-card chat-stats-emoji-card chat-stats-emoji-react-card">
                    <div class="chat-stats-card-header">
                        <i class="ph ph-sticker"></i>
                        <span class="chat-stats-card-title">最爱贴的</span>
                    </div>
                    <div class="chat-stats-card-body" id="chat_stats_emoji_react_body">
                        <div class="chat-stats-empty">统计中…</div>
                    </div>
                </div>
            </div>

            <div class="chat-stats-section">
                <div class="chat-stats-card chat-stats-topwords-card">
                    <div class="chat-stats-card-header">
                        <i class="ph ph-trophy"></i>
                        <span class="chat-stats-card-title">高频词 Top 20</span>
                    </div>
                    <div class="chat-stats-card-body" id="chat_stats_topwords_body">
                        <div class="chat-stats-empty">统计中…</div>
                    </div>
                </div>
            </div>

        </div>
    </div>`;
}

// ───────────────────────────────────────────────────────────────────────
// Scan
// ───────────────────────────────────────────────────────────────────────

async function _runScan() {
    const myToken = ++_runToken;
    const charId = _getCurrentCharId();
    if (!charId) {
        _setText('chat_stats_next_round_tokens', '—');
        return;
    }

    // Fire-and-forget next-round token estimate so it runs in parallel with the
    // on-disk scan. Both write to disjoint DOM nodes; the same _runToken cancels
    // both on exit.
    _estimateNextRoundTokens(myToken).catch(err => {
        if (myToken !== _runToken) return;
        console.warn(LOG, 'token estimate failed:', err);
        _setText('chat_stats_next_round_tokens', '估算失败');
    });

    const candidates = await getEntriesForChar(charId);
    if (myToken !== _runToken) return;

    if (candidates.length === 0) {
        _setText('chat_stats_total_msgs', '0');
        _setText('chat_stats_hidden_msgs', '0');
        _setText('chat_stats_total_bytes', '0 B');
        _renderTalkative({ userMsgs: 0, userChars: 0, charMsgs: 0, charChars: 0 });
        _renderThoughtRatio({ thoughtChars: 0, contentChars: 0, charMsgCount: 0 });
        _renderHeatmap({ grid: _emptyHeatmapGrid(), total: 0, maxCount: 0, peakRow: 0, peakCol: 0 });
        _renderWordFreq({ top: [], qualifiedCount: 0, totalUnique: 0 });
        _renderEmojiUsage({
            inlineUser: [], inlineChar: [], reactUser: [], reactChar: [],
            totals: { inlineUser: 0, inlineChar: 0, reactUser: 0, reactChar: 0 },
        });
        return;
    }

    let totalMsgs = 0;
    let totalHidden = 0;
    let totalBytes = 0;

    const talkative = createTalkativeAggregator();
    const thoughtRatio = createThoughtRatioAggregator();
    const heatmap = createHeatmapAggregator();
    const wordFreq = createWordFreqAggregator();
    const emojiUsage = createEmojiUsageAggregator();

    _setText('chat_stats_total_msgs', '0');
    _setText('chat_stats_hidden_msgs', '0');
    _setText('chat_stats_total_bytes', '0 B');

    for (const entry of candidates) {
        if (myToken !== _runToken) return;

        const filename = filenameForHash(entry.fileHash);
        let text = null;
        try {
            text = await fetchFile(filename);
        } catch (e) {
            console.warn(`${LOG} fetch ${filename} failed:`, e.message);
            continue;
        }
        if (myToken !== _runToken) return;

        if (text === null) {
            // File gone — self-heal the index just like the search path does.
            console.log(`${LOG} pruning stale index entry for ${filename}`);
            removeEntry(entry.fileHash).catch(() => {});
            continue;
        }

        let msgs = 0;
        let hidden = 0;
        try {
            const parsed = JSON.parse(text);
            if (Array.isArray(parsed)) {
                msgs = parsed.length;
                // `summarized: true` is the chat app's "hidden floor" — these
                // messages still render in the bubble list but are dropped from
                // the prompt history sent to the LLM (see chatStorage.js).
                for (const m of parsed) {
                    if (!m) continue;
                    if (m.summarized === true) hidden++;
                    talkative.ingest(m);
                    thoughtRatio.ingest(m);
                    heatmap.ingest(m);
                    wordFreq.ingest(m);
                    emojiUsage.ingest(m);
                }
            }
        } catch (e) {
            console.warn(`${LOG} parse ${filename} failed:`, e.message);
        }

        // Bytes on disk = UTF-8 length of the JSON string. Use TextEncoder so
        // multi-byte characters (CJK, emoji) count correctly.
        const bytes = new TextEncoder().encode(text).length;

        totalMsgs += msgs;
        totalHidden += hidden;
        totalBytes += bytes;

        _setText('chat_stats_total_msgs', _fmtNumber(totalMsgs));
        _setText('chat_stats_hidden_msgs', _fmtNumber(totalHidden));
        _setText('chat_stats_total_bytes', _fmtBytes(totalBytes));

        _renderTalkative(talkative.result());
        _renderThoughtRatio(thoughtRatio.result());
        _renderHeatmap(heatmap.result());
        _renderWordFreq(wordFreq.result());
        _renderEmojiUsage(emojiUsage.result());
    }
}

// ───────────────────────────────────────────────────────────────────────
// Next-round prompt token estimate
// ───────────────────────────────────────────────────────────────────────

// Reuses the real prompt builders in { silent: true } dry-run mode so the
// estimate matches the next real send. silent skips Console pushPromptLog and
// the community-context cooldown decrement; everything else (WorldInfo lookup,
// moments feed, buffs, time context) runs for real to keep the count accurate.
async function _estimateNextRoundTokens(myToken) {
    const history = loadChatHistory();
    if (myToken !== _runToken) return;

    const systemPrompt = await buildChatSystemPrompt({ silent: true });
    if (myToken !== _runToken) return;

    const userPrompt = buildChatUserPrompt([], history, undefined, false, null, { silent: true });
    if (myToken !== _runToken) return;

    const fullText = systemPrompt + '\n' + userPrompt;
    const count = countTokensFromPromptData(fullText);
    if (myToken !== _runToken) return;

    _setText('chat_stats_next_round_tokens', _fmtNumber(count));

    // ── Phone-chat sub-breakdown ──
    // Show how much of the prompt comes from phone-chat content specifically,
    // split between "still in-flight messages" (drive the auto-summarize
    // trigger) and "current rolling summary" (the compressed view the LLM
    // actually reads). Counting just the raw content stream is a deliberate
    // approximation — it's the number users care about ("how much of my
    // chatting am I sending") rather than the wrapped role-prefixed form.
    const unsummarizedContent = history
        .filter(m => !m.summarized)
        .map(m => m.content || '')
        .join('\n');
    const unsummarizedTokens = unsummarizedContent
        ? countTokensFromPromptData(unsummarizedContent)
        : 0;
    if (myToken !== _runToken) return;

    const summaryText = loadChatSummary() || '';
    const summaryTokens = summaryText ? countTokensFromPromptData(summaryText) : 0;
    if (myToken !== _runToken) return;

    _setText('chat_stats_phone_unsummarized_tokens', _fmtNumber(unsummarizedTokens));
    _setText('chat_stats_phone_summary_tokens', _fmtNumber(summaryTokens));

    // Flag the threshold row red/green so it reads at a glance.
    const thresholdEl = document.getElementById('chat_stats_summarize_threshold');
    if (thresholdEl) {
        thresholdEl.classList.toggle('over-threshold', count >= SUMMARIZE_PROMPT_TOKEN_THRESHOLD);
    }
}

// ───────────────────────────────────────────────────────────────────────
// Card renderers — Phase 1
// ───────────────────────────────────────────────────────────────────────

// Talkative card: two horizontal bars (user vs char) scaled by message count,
// with a small metric row underneath each bar showing 条 + 字 totals.
function _renderTalkative(result) {
    const body = document.getElementById('chat_stats_talkative_body');
    if (!body) return;

    const { userMsgs, userChars, charMsgs, charChars } = result;
    const total = userMsgs + charMsgs;

    if (total === 0) {
        body.innerHTML = `<div class="chat-stats-empty">还没有消息可以统计</div>`;
        return;
    }

    // Min 4% width so a tiny side is still visible as a sliver rather than
    // vanishing. The widths don't have to sum to 100% — flex handles layout.
    const userPct = Math.max(4, (userMsgs / total) * 100);
    const charPct = Math.max(4, (charMsgs / total) * 100);

    body.innerHTML = `
        <div class="chat-stats-talkative-row">
            <div class="chat-stats-talkative-label">你</div>
            <div class="chat-stats-talkative-bar-track">
                <div class="chat-stats-talkative-bar chat-stats-talkative-bar-user" style="width: ${userPct.toFixed(1)}%;"></div>
            </div>
            <div class="chat-stats-talkative-meta">${_fmtNumber(userMsgs)} 条 · ${_fmtNumber(userChars)} 字</div>
        </div>
        <div class="chat-stats-talkative-row">
            <div class="chat-stats-talkative-label">ta</div>
            <div class="chat-stats-talkative-bar-track">
                <div class="chat-stats-talkative-bar chat-stats-talkative-bar-char" style="width: ${charPct.toFixed(1)}%;"></div>
            </div>
            <div class="chat-stats-talkative-meta">${_fmtNumber(charMsgs)} 条 · ${_fmtNumber(charChars)} 字</div>
        </div>
    `;
}

// Thought-ratio card: big ratio number ("内心戏 ÷ 嘴上 = 2.4x") + a per-100
// caption that's easier to read intuitively. Falls back gracefully if she
// hasn't said anything yet.
function _renderThoughtRatio(result) {
    const body = document.getElementById('chat_stats_thought_body');
    if (!body) return;

    const { thoughtChars, contentChars, charMsgCount } = result;

    if (charMsgCount === 0) {
        body.innerHTML = `<div class="chat-stats-empty">ta 还没说过话</div>`;
        return;
    }

    if (contentChars === 0) {
        // Edge case: messages exist but all are zero-length (all `special`
        // with empty content). Show thought total alone.
        body.innerHTML = `
            <div class="chat-stats-thought-ratio-value">—</div>
            <div class="chat-stats-thought-ratio-tag">「嘴上没说什么，心里全是字」</div>
            <div class="chat-stats-thought-ratio-caption">内心独白 ${_fmtNumber(thoughtChars)} 字</div>
        `;
        return;
    }

    const ratio = thoughtChars / contentChars;
    const ratioStr = ratio.toFixed(1) + 'x';
    const per100 = Math.round(ratio * 100);
    const comment = _thoughtRatioComment(ratio);

    body.innerHTML = `
        <div class="chat-stats-thought-ratio-value">${ratioStr}</div>
        <div class="chat-stats-thought-ratio-tag">「${comment}」</div>
        <div class="chat-stats-thought-ratio-caption">你对象每说 100 字 → 内心戏 ${_fmtNumber(per100)} 字</div>
    `;
}

// Heatmap card: 7-row × 24-col grid colored by activity density over the last
// 30 days. Empty cells stay faint so the grid frame is still visible; active
// cells share a single CSS background colour and only vary the alpha via the
// `--cell-alpha` custom property (so dark-mode just swaps the colour token).
const _WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'];

function _emptyHeatmapGrid() {
    return Array.from({ length: 7 }, () => new Array(24).fill(0));
}

function _renderHeatmap(result) {
    const body = document.getElementById('chat_stats_heatmap_body');
    if (!body) return;

    const { grid, total, maxCount, peakRow, peakCol } = result;
    if (total === 0 || maxCount === 0) {
        body.innerHTML = `<div class="chat-stats-empty">最近一个月没什么聊天活动</div>`;
        return;
    }

    // Column tick row: only labels at 0 / 6 / 12 / 18 to keep the axis quiet.
    let ticks = '<div class="chat-stats-heatmap-axis-row">';
    ticks += `<div class="chat-stats-heatmap-axis-corner"></div>`;
    for (let c = 0; c < 24; c++) {
        const label = (c === 0 || c === 6 || c === 12 || c === 18) ? String(c) : '';
        ticks += `<div class="chat-stats-heatmap-axis-tick">${label}</div>`;
    }
    ticks += '</div>';

    // Min alpha 0.18 so a single-message cell is still visible against the
    // empty-cell background; the rest scales linearly up to 1.0 at max.
    let rows = '';
    for (let r = 0; r < 7; r++) {
        rows += `<div class="chat-stats-heatmap-row">`;
        rows += `<div class="chat-stats-heatmap-row-label">周${_WEEKDAY_LABELS[r]}</div>`;
        for (let c = 0; c < 24; c++) {
            const count = grid[r][c];
            if (count === 0) {
                rows += `<div class="chat-stats-heatmap-cell"></div>`;
            } else {
                const alpha = 0.18 + 0.82 * (count / maxCount);
                const title = `周${_WEEKDAY_LABELS[r]} ${c}:00 — ${count} 条`;
                rows += `<div class="chat-stats-heatmap-cell chat-stats-heatmap-cell-active" style="--cell-alpha: ${alpha.toFixed(2)};" title="${title}"></div>`;
            }
        }
        rows += `</div>`;
    }

    const peakLabel = `周${_WEEKDAY_LABELS[peakRow]} ${peakCol}:00–${peakCol + 1}:00`;

    body.innerHTML = `
        <div class="chat-stats-heatmap-grid">
            ${ticks}
            ${rows}
        </div>
        <div class="chat-stats-heatmap-caption">
            最近 30 天共 <strong>${_fmtNumber(total)}</strong> 条 · 最忙时段：${peakLabel}（${_fmtNumber(maxCount)} 条）
        </div>
    `;
}

// Word-frequency card: ranked Top-20 bar list. The fill is painted as a
// linear-gradient on the row's background, so the bar shares a single line
// with rank/token/count text instead of taking a second row each. Width
// normalized to the #1 entry's count.
function _renderWordFreq(result) {
    const body = document.getElementById('chat_stats_topwords_body');
    if (!body) return;

    const { top } = result;
    if (!top || top.length < 5) {
        body.innerHTML = `<div class="chat-stats-empty">聊天太少，没攒够数据</div>`;
        return;
    }

    const maxCount = top[0][1];
    let rows = '';
    for (let i = 0; i < top.length; i++) {
        const [token, count] = top[i];
        const pct = Math.max(6, (count / maxCount) * 100);
        rows += `
            <div class="chat-stats-topwords-row" style="--bar-pct: ${pct.toFixed(1)}%;">
                <span class="chat-stats-topwords-rank">${i + 1}</span>
                <span class="chat-stats-topwords-token">${_escHtml(token)}</span>
                <span class="chat-stats-topwords-count">${_fmtNumber(count)}</span>
            </div>
        `;
    }

    body.innerHTML = `<div class="chat-stats-topwords-list">${rows}</div>`;
}

// Emoji-usage cards (paired): inline-emoji card and reaction card share a
// renderer because both render the same { 你 / ta } × Top-3 layout against
// different data slices.
function _renderEmojiUsage(result) {
    const inlineBody = document.getElementById('chat_stats_emoji_inline_body');
    const reactBody = document.getElementById('chat_stats_emoji_react_body');
    if (!inlineBody && !reactBody) return;

    const { inlineUser, inlineChar, reactUser, reactChar, totals } = result;

    if (inlineBody) {
        const empty = (totals.inlineUser + totals.inlineChar) === 0;
        inlineBody.innerHTML = empty
            ? `<div class="chat-stats-empty">还没人在消息里加表情</div>`
            : _emojiPanelHtml(inlineUser, inlineChar);
    }
    if (reactBody) {
        const empty = (totals.reactUser + totals.reactChar) === 0;
        reactBody.innerHTML = empty
            ? `<div class="chat-stats-empty">还没人长按贴过表情</div>`
            : _emojiPanelHtml(reactUser, reactChar);
    }
}

// Each side is a topwords-style vertical list of up to 3 rows. Bar width is
// normalized to that side's own #1 entry (NOT cross-side), so a chatty user
// and a quiet ta both get a full-width #1 bar — the bars convey "what's your
// own favourite" rather than "who uses emoji more" (totals already cover
// that question elsewhere).
function _emojiPanelHtml(userTop, charTop) {
    return `
        <div class="chat-stats-emoji-side">
            <div class="chat-stats-emoji-side-label">你</div>
            <div class="chat-stats-emoji-list">${_emojiRowsHtml(userTop)}</div>
        </div>
        <div class="chat-stats-emoji-side">
            <div class="chat-stats-emoji-side-label">ta</div>
            <div class="chat-stats-emoji-list">${_emojiRowsHtml(charTop)}</div>
        </div>
    `;
}

function _emojiRowsHtml(top) {
    if (!top || top.length === 0) {
        return `<div class="chat-stats-emoji-side-empty">还没攒到</div>`;
    }
    const maxCount = top[0][1];
    return top.map(([e, n]) => {
        const pct = Math.max(6, (n / maxCount) * 100);
        return `
            <div class="chat-stats-emoji-row" style="--bar-pct: ${pct.toFixed(1)}%;">
                <span class="chat-stats-emoji-glyph">${_escHtml(e)}</span>
                <span class="chat-stats-emoji-count">${_fmtNumber(n)}</span>
            </div>
        `;
    }).join('');
}

function _escHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Tiered remark for the thought / content ratio. Tone: short, rhythmic,
// teasing-but-warm — adjust thresholds and copy after real data lands.
function _thoughtRatioComment(ratio) {
    if (ratio === 0) return '完全想到啥说啥，也可能是脑子不太灵光？🤣';
    if (ratio < 0.3) return '想到啥说啥的直球，这实诚孩子';
    if (ratio < 0.8) return '心里偶尔想点啥，还是嘴上占多数，很常规了';
    if (ratio < 1.5) return '说几句想几句，心口大致没有很不一，真嘟假嘟🤣';
    if (ratio < 2.5) return '嘴上说一句，心里能补三句，内心戏这个丰富';
    if (ratio < 4) return '看起来很冷淡，其实心里演了一整出戏，6的';
    return '嘴上轻描淡写，心里小说连载，嘴硬这一块';
}

// ───────────────────────────────────────────────────────────────────────
// Formatting helpers
// ───────────────────────────────────────────────────────────────────────

function _fmtNumber(n) {
    return n.toLocaleString('en-US');
}

function _fmtBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function _setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

// ───────────────────────────────────────────────────────────────────────
// Current character
// ───────────────────────────────────────────────────────────────────────

function _getCurrentCharId() {
    try {
        const ctx = getContext();
        if (ctx?.characterId == null) return null;
        return String(ctx.characterId);
    } catch {
        return null;
    }
}

// ───────────────────────────────────────────────────────────────────────
// Back navigation
// ───────────────────────────────────────────────────────────────────────

function _registerBackHandler() {
    _unregisterBackHandler();
    _backHandler = (e) => {
        e.preventDefault();
        _exitToSettings();
    };
    window.addEventListener('phone-app-back', _backHandler);
}

function _unregisterBackHandler() {
    if (_backHandler) {
        window.removeEventListener('phone-app-back', _backHandler);
        _backHandler = null;
    }
}

function _exitToSettings() {
    _runToken++; // cancel any in-flight scan
    _unregisterBackHandler();
    openChatSettingsPage();
}
