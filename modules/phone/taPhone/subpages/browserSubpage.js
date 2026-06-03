// modules/phone/taPhone/subpages/browserSubpage.js — Browser (浏览器) sub-page.
// Phase 1: list-only render.
// Phase 3: every list row is clickable. Recent pages + bookmarks open a
// faked webpage detail (style picked by url domain → xhs / zhihu /
// bilibili / generic). Searches open a faked search-result list.

import { openAppInViewport } from '../../phoneController.js';
import {
    getPhoneCharInfo,
    getPhoneUserName,
    getPhoneUserPersona,
    getPhoneRecentChat,
    getPhoneWorldBookContext,
} from '../../phoneContext.js';
import { escapeHtml } from '../../utils/helpers.js';
import {
    formatTimestamp,
    emptyHtml,
    callDetailLLM,
    pushNav,
    TP_LOG,
} from '../taPhoneShared.js';
import {
    getBrowserPageDetail,
    getBrowserSearchDetail,
    appendBrowserBatch,
    loadData,
} from '../taPhoneStore.js';
import {
    buildBrowserBatchPrompt,
} from '../taPhonePromptBuilder.js';

export const BROWSER_TITLE = '浏览器';
export const BROWSER_EMPTY_ICON = 'ph ph-globe';

// Style picker — purely string match on the url. The plan calls out that
// unknown urls fall back to "generic" and that's expected behavior.
function detectStyle(url) {
    const u = String(url || '').toLowerCase();
    if (u.includes('xiaohongshu') || u.includes('xhs.cn') || u.includes('xhslink')) return 'xhs';
    if (u.includes('zhihu')) return 'zhihu';
    if (u.includes('bilibili') || u.includes('b23.tv')) return 'bilibili';
    return 'generic';
}

const STYLE_LABELS = {
    xhs: '小红书',
    zhihu: '知乎',
    bilibili: 'B站',
    generic: '网页',
};

// Token guards against late LLM results stomping a page the user
// navigated away from (mirrors messagesSubpage._activeDetailToken).
let _activeDetailToken = null;

export function cancelActiveBrowserDetail() {
    _activeDetailToken = null;
}

// ═══════════════════════════════════════════════════════════════════════
// List view
// ═══════════════════════════════════════════════════════════════════════

export function renderBrowserList(browser) {
    const recentPages = Array.isArray(browser?.recentPages) ? browser.recentPages : [];
    const searches = Array.isArray(browser?.searches) ? browser.searches : [];
    const bookmarks = Array.isArray(browser?.bookmarks) ? browser.bookmarks : [];

    if (!recentPages.length && !searches.length && !bookmarks.length) {
        return emptyHtml('她最近还没逛过什么', BROWSER_EMPTY_ICON);
    }

    const sections = [];

    if (recentPages.length) {
        sections.push(`
            <div class="tp-browser-section">
                <div class="tp-section-title"><i class="ph ph-clock-counter-clockwise"></i> 最近浏览</div>
                ${recentPages.map((p, i) => `
                    <div class="tp-browser-item" data-browser-kind="recent" data-browser-index="${i}" role="button" tabindex="0">
                        <div class="tp-browser-title">${escapeHtml(p.title || '')}</div>
                        <div class="tp-browser-url">${escapeHtml(p.url || '')}</div>
                        <div class="tp-browser-time">${escapeHtml(formatTimestamp(p.timestamp))}</div>
                    </div>
                `).join('')}
            </div>
        `);
    }

    if (searches.length) {
        sections.push(`
            <div class="tp-browser-section">
                <div class="tp-section-title"><i class="ph ph-magnifying-glass"></i> 搜索记录</div>
                ${searches.map((s, i) => `
                    <div class="tp-browser-search" data-browser-kind="search" data-browser-index="${i}" role="button" tabindex="0">
                        <i class="ph ph-magnifying-glass"></i>
                        <span class="tp-browser-query">${escapeHtml(s.query || '')}</span>
                        <span class="tp-browser-time">${escapeHtml(formatTimestamp(s.timestamp))}</span>
                    </div>
                `).join('')}
            </div>
        `);
    }

    if (bookmarks.length) {
        sections.push(`
            <div class="tp-browser-section">
                <div class="tp-section-title"><i class="ph ph-bookmark"></i> 收藏夹</div>
                ${bookmarks.map((b, i) => `
                    <div class="tp-browser-item" data-browser-kind="bookmark" data-browser-index="${i}" role="button" tabindex="0">
                        <div class="tp-browser-title">${escapeHtml(b.title || '')}</div>
                        <div class="tp-browser-url">${escapeHtml(b.url || '')}</div>
                    </div>
                `).join('')}
            </div>
        `);
    }

    return sections.join('');
}

/**
 * Hook click handlers onto the browser list rows.
 * @param {HTMLElement} root
 * @param {object} browser - { recentPages, searches, bookmarks }
 * @param {() => void} restoreSelf - re-render this list (used as back stack entry)
 */
export function bindBrowserListEvents(root, browser, restoreSelf) {
    if (!root || !browser) return;
    root.querySelectorAll('[data-browser-kind]').forEach(row => {
        row.addEventListener('click', () => {
            const kind = row.dataset.browserKind;
            const idx = Number(row.dataset.browserIndex);
            if (kind === 'recent') {
                const page = browser.recentPages?.[idx];
                if (page) {
                    pushNav(restoreSelf);
                    openBrowserPageDetail(page);
                }
            } else if (kind === 'bookmark') {
                const page = browser.bookmarks?.[idx];
                if (page) {
                    pushNav(restoreSelf);
                    openBrowserPageDetail(page);
                }
            } else if (kind === 'search') {
                const s = browser.searches?.[idx];
                if (s) {
                    pushNav(restoreSelf);
                    openBrowserSearchDetail(s);
                }
            }
        });
    });
}

// ═══════════════════════════════════════════════════════════════════════
// Page detail (faked webpage by style)
// ═══════════════════════════════════════════════════════════════════════

export async function openBrowserPageDetail(page) {
    const url = (page?.url || '').trim();
    const title = (page?.title || '').trim() || '(无标题)';
    if (!url) {
        _showDetailError(title, '这条没有 url，没法生成网页内容');
        return;
    }

    let cached;
    try {
        cached = await getBrowserPageDetail(url);
    } catch (e) {
        console.warn(`${TP_LOG} getBrowserPageDetail failed:`, e);
        cached = null;
    }

    if (cached && cached.content && typeof cached.content === 'object') {
        _activeDetailToken = { kind: 'page', url };
        _renderPageDetail(cached.style || detectStyle(url), cached.content, { url, fallbackTitle: title });
        return;
    }

    _activeDetailToken = { kind: 'page', url };
    _renderEmptyPageDetail(title);
}

// ─── Render dispatch by style ──────────────────────────────────────────

function _renderPageDetail(style, content, ctx) {
    const url = ctx?.url || '';
    const fallbackTitle = ctx?.fallbackTitle || '';
    const titleText = (content.title || '').trim() || fallbackTitle || '(无标题)';
    const headerTitle = `<span class="tp-title">${escapeHtml(STYLE_LABELS[style] || STYLE_LABELS.generic)}</span>`;

    let bodyHtml;
    switch (style) {
        case 'xhs':       bodyHtml = _renderXhsPage(titleText, content, url); break;
        case 'zhihu':     bodyHtml = _renderZhihuPage(titleText, content, url); break;
        case 'bilibili':  bodyHtml = _renderBilibiliPage(titleText, content, url); break;
        default:          bodyHtml = _renderGenericPage(titleText, content, url); break;
    }

    const html = `<div class="tp-browser-detail tp-fade-in tp-browser-detail-${style}">${bodyHtml}</div>`;
    openAppInViewport(headerTitle, html, () => {});
}

function _renderXhsPage(title, content, url) {
    const author = (content.author || '').trim();
    const body = _markdownishToHtml(content.content || '');
    const inter = content.interactions || {};
    return `
        <div class="tp-xhs-card">
            <div class="tp-xhs-author">
                <div class="tp-xhs-avatar">${escapeHtml((author || 'A').slice(0, 1))}</div>
                <div class="tp-xhs-author-name">${escapeHtml(author || '小红薯')}</div>
                <button class="tp-xhs-follow" disabled>关注</button>
            </div>
            <div class="tp-xhs-image-placeholder">
                <i class="ph ph-image-square"></i>
                <span>图片图片图片</span>
            </div>
            <div class="tp-xhs-title">${escapeHtml(title)}</div>
            <div class="tp-xhs-content">${body}</div>
            <div class="tp-xhs-interactions">
                <span><i class="ph ph-heart"></i> ${_formatCount(inter.likes)}</span>
                <span><i class="ph ph-chat-circle"></i> ${_formatCount(inter.comments)}</span>
                <span><i class="ph ph-bookmark-simple"></i> ${_formatCount(inter.collects)}</span>
            </div>
            ${_renderUrlFooter(url)}
        </div>
    `;
}

function _renderZhihuPage(title, content, url) {
    const author = (content.author || '').trim();
    const body = _markdownishToHtml(content.content || '');
    return `
        <div class="tp-zhihu-card">
            <div class="tp-zhihu-question">${escapeHtml(title)}</div>
            ${author ? `
                <div class="tp-zhihu-author">
                    <div class="tp-zhihu-avatar">${escapeHtml(author.slice(0, 1))}</div>
                    <div class="tp-zhihu-author-name">${escapeHtml(author)}</div>
                </div>
            ` : ''}
            <div class="tp-zhihu-content">${body}</div>
            ${_renderUrlFooter(url)}
        </div>
    `;
}

function _renderBilibiliPage(title, content, url) {
    const author = (content.author || '').trim();
    const body = _markdownishToHtml(content.content || '');
    const inter = content.interactions || {};
    return `
        <div class="tp-bili-card">
            <div class="tp-bili-cover">
                <i class="ph ph-play-circle"></i>
            </div>
            <div class="tp-bili-title">${escapeHtml(title)}</div>
            <div class="tp-bili-up">
                <i class="ph ph-user-circle"></i>
                <span>${escapeHtml(author || 'up主')}</span>
            </div>
            <div class="tp-bili-stats">
                <span><i class="ph ph-eye"></i> ${_formatCount(inter.likes)}</span>
                <span><i class="ph ph-chat-circle"></i> ${_formatCount(inter.comments)}</span>
                <span><i class="ph ph-bookmark-simple"></i> ${_formatCount(inter.collects)}</span>
            </div>
            <div class="tp-bili-description">${body}</div>
            ${_renderUrlFooter(url)}
        </div>
    `;
}

function _renderGenericPage(title, content, url) {
    const author = (content.author || '').trim();
    const body = _markdownishToHtml(content.content || '');
    return `
        <div class="tp-article-card">
            <div class="tp-article-title">${escapeHtml(title)}</div>
            ${author ? `<div class="tp-article-author">作者：${escapeHtml(author)}</div>` : ''}
            <div class="tp-article-content">${body}</div>
            ${_renderUrlFooter(url)}
        </div>
    `;
}

function _renderUrlFooter(url) {
    if (!url) return '';
    return `<div class="tp-browser-detail-url">${escapeHtml(url)}</div>`;
}

// Lightweight markdown-ish: paragraph split on blank lines + line breaks
// inside paragraphs. No bold/italic/links — keeps surface small and the
// output safe to interpolate into the DOM via escapeHtml. Anything more
// fancy than this is overkill for a faked webpage card.
function _markdownishToHtml(text) {
    const raw = String(text || '');
    if (!raw.trim()) return '';
    const paragraphs = raw.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
    return paragraphs
        .map(p => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
        .join('');
}

function _formatCount(n) {
    if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
    if (n < 1000) return String(n);
    if (n < 10000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return (n / 10000).toFixed(1).replace(/\.0$/, '') + 'w';
}

// ═══════════════════════════════════════════════════════════════════════
// Search detail (faked Baidu-style result list)
// ═══════════════════════════════════════════════════════════════════════

export async function openBrowserSearchDetail(search) {
    const query = (search?.query || '').trim();
    if (!query) {
        _showDetailError('搜索结果', '这条搜索是空的');
        return;
    }

    let cached;
    try {
        cached = await getBrowserSearchDetail(query);
    } catch (e) {
        console.warn(`${TP_LOG} getBrowserSearchDetail failed:`, e);
        cached = null;
    }

    if (cached && Array.isArray(cached.results) && cached.results.length > 0) {
        _activeDetailToken = { kind: 'search', query };
        _renderSearchDetail(query, cached.results);
        return;
    }

    _activeDetailToken = { kind: 'search', query };
    _renderEmptySearchDetail(query);
}

function _renderSearchDetail(query, results) {
    const headerTitle = `<span class="tp-title">${escapeHtml(query)}</span>`;
    const itemsHtml = results.map(r => `
        <div class="tp-search-result">
            <div class="tp-search-title">${escapeHtml(r.title || '')}</div>
            <div class="tp-search-url">
                <span class="tp-search-source">${escapeHtml(r.source || '')}</span>
                <span class="tp-search-link">${escapeHtml(r.url || '')}</span>
            </div>
            <div class="tp-search-snippet">${escapeHtml(r.snippet || '')}</div>
        </div>
    `).join('');
    const html = `
        <div class="tp-browser-detail tp-fade-in tp-search-page">
            <div class="tp-search-bar">
                <i class="ph ph-magnifying-glass"></i>
                <span class="tp-search-query">${escapeHtml(query)}</span>
            </div>
            <div class="tp-search-results">${itemsHtml}</div>
        </div>
    `;
    openAppInViewport(headerTitle, html, () => {});
}

// ═══════════════════════════════════════════════════════════════════════
// Empty-state prompt + error pages
// ═══════════════════════════════════════════════════════════════════════

function _renderEmptyPageDetail(titleText) {
    const title = `<span class="tp-title">${escapeHtml(titleText)}</span>`;
    const html = `
        <div class="tp-detail-empty tp-fade-in">
            <div class="tp-empty-prompt-card">
                <div class="tp-empty-prompt-icon"><i class="ph ph-globe"></i></div>
                <div class="tp-empty-prompt-title">这条网页还没生成</div>
                <div class="tp-empty-prompt-body">
                    回到浏览器列表，点顶部的 <i class="ph ph-arrows-clockwise"></i> 一次性补齐所有还没看过的网页和搜索。
                </div>
            </div>
        </div>
    `;
    openAppInViewport(title, html, () => {});
}

function _renderEmptySearchDetail(query) {
    const title = `<span class="tp-title">${escapeHtml(query)}</span>`;
    const html = `
        <div class="tp-detail-empty tp-fade-in">
            <div class="tp-empty-prompt-card">
                <div class="tp-empty-prompt-icon"><i class="ph ph-magnifying-glass"></i></div>
                <div class="tp-empty-prompt-title">这个搜索还没生成结果</div>
                <div class="tp-empty-prompt-body">
                    回到浏览器列表，点顶部的 <i class="ph ph-arrows-clockwise"></i> 一次性补齐所有还没看过的网页和搜索。
                </div>
            </div>
        </div>
    `;
    openAppInViewport(title, html, () => {});
}

function _showDetailError(titleText, lineText) {
    const title = `<span class="tp-title">${escapeHtml(titleText)}</span>`;
    const html = `
        <div class="tp-detail-error tp-fade-in">
            <div class="tp-empty">
                <div class="tp-empty-icon"><i class="ph ph-warning-circle"></i></div>
                <div class="tp-empty-text">${escapeHtml(lineText)}</div>
            </div>
        </div>
    `;
    openAppInViewport(title, html, () => {});
}

// ═══════════════════════════════════════════════════════════════════════
// Broad refresh (top ⟳ on the browser list page) — Phase 3.5
// ═══════════════════════════════════════════════════════════════════════

function _sanitizePageContent(c) {
    if (!c || typeof c !== 'object' || Array.isArray(c)) return null;
    return {
        title: typeof c.title === 'string' ? c.title : '',
        author: typeof c.author === 'string' ? c.author : '',
        content: typeof c.content === 'string' ? c.content : '',
        interactions: (c.interactions && typeof c.interactions === 'object' && !Array.isArray(c.interactions))
            ? {
                likes: Number.isFinite(c.interactions.likes) ? c.interactions.likes : 0,
                comments: Number.isFinite(c.interactions.comments) ? c.interactions.comments : 0,
                collects: Number.isFinite(c.interactions.collects) ? c.interactions.collects : 0,
            }
            : undefined,
    };
}

function _sanitizeSearchResults(list) {
    if (!Array.isArray(list)) return [];
    return list
        .filter(r => r && typeof r === 'object' && typeof r.title === 'string')
        .map(r => ({
            title: r.title,
            url: typeof r.url === 'string' ? r.url : '',
            snippet: typeof r.snippet === 'string' ? r.snippet : '',
            source: typeof r.source === 'string' ? r.source : '',
        }));
}

/**
 * Refresh every browser item in one LLM call. Fills detail caches for
 * pages/searches that don't have one yet AND optionally adds a few new
 * recent pages / bookmarks / searches with their detail already generated.
 *
 * @returns {Promise<{ pageFills:number, bookmarkFills:number, searchFills:number,
 *                     newPages:number, newBookmarks:number, newSearches:number } | null>}
 */
export async function refreshBrowser() {
    let data;
    try {
        data = await loadData();
    } catch (e) {
        console.warn(`${TP_LOG} refreshBrowser loadData failed:`, e);
        return null;
    }

    const recentPages = Array.isArray(data?.browser?.recentPages) ? data.browser.recentPages : [];
    const bookmarks = Array.isArray(data?.browser?.bookmarks) ? data.browser.bookmarks : [];
    const searches = Array.isArray(data?.browser?.searches) ? data.browser.searches : [];

    const pageFillsList = [];
    for (const p of recentPages) {
        const url = (p?.url || '').trim();
        if (!url) continue;
        let cache = null;
        try { cache = await getBrowserPageDetail(url); } catch {}
        if (!cache || !cache.content) {
            pageFillsList.push({ title: p.title || '', url, style: detectStyle(url) });
        }
    }
    const bookmarkFillsList = [];
    for (const b of bookmarks) {
        const url = (b?.url || '').trim();
        if (!url) continue;
        let cache = null;
        try { cache = await getBrowserPageDetail(url); } catch {}
        if (!cache || !cache.content) {
            bookmarkFillsList.push({ title: b.title || '', url, style: detectStyle(url) });
        }
    }
    const searchFillsList = [];
    for (const s of searches) {
        const q = (s?.query || '').trim();
        if (!q) continue;
        let cache = null;
        try { cache = await getBrowserSearchDetail(q); } catch {}
        if (!cache || !Array.isArray(cache.results) || cache.results.length === 0) {
            searchFillsList.push({ query: q });
        }
    }

    const charInfo = getPhoneCharInfo();
    const userName = getPhoneUserName();
    const userPersona = getPhoneUserPersona();
    const recentChatSummary = getPhoneRecentChat(20);
    let worldBookText = '';
    try { worldBookText = await getPhoneWorldBookContext(); } catch {}

    const { systemPrompt, userPrompt } = buildBrowserBatchPrompt({
        charInfo, userName, userPersona, worldBookText, recentChatSummary,
        pageFillsList, bookmarkFillsList, searchFillsList,
    });

    console.log(`${TP_LOG} calling LLM for browser broad refresh (pageFills=${pageFillsList.length}, bookmarkFills=${bookmarkFillsList.length}, searchFills=${searchFillsList.length})`);
    const parsed = await callDetailLLM(systemPrompt, userPrompt, { maxTokens: 12000 });
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

    const existingUrls = new Set(
        recentPages.concat(bookmarks).map(p => (p?.url || '').trim()).filter(Boolean)
    );
    const existingQueries = new Set(searches.map(s => (s?.query || '').trim()).filter(Boolean));

    const pageFills = Array.isArray(parsed.pageFills) ? parsed.pageFills.map(f => ({
        url: (f?.url || '').trim(),
        style: typeof f?.style === 'string' ? f.style : 'generic',
        content: _sanitizePageContent(f?.content),
    })).filter(f => f.url && f.content) : [];

    const bookmarkFills = Array.isArray(parsed.bookmarkFills) ? parsed.bookmarkFills.map(f => ({
        url: (f?.url || '').trim(),
        style: typeof f?.style === 'string' ? f.style : 'generic',
        content: _sanitizePageContent(f?.content),
    })).filter(f => f.url && f.content) : [];

    const searchFills = Array.isArray(parsed.searchFills) ? parsed.searchFills.map(f => ({
        query: (f?.query || '').trim(),
        results: _sanitizeSearchResults(f?.results),
    })).filter(f => f.query && f.results.length > 0) : [];

    const newRecentPages = Array.isArray(parsed.newRecentPages) ? parsed.newRecentPages.map(p => ({
        title: typeof p?.title === 'string' ? p.title : '',
        url: (p?.url || '').trim(),
        timestamp: typeof p?.timestamp === 'string' ? p.timestamp : new Date().toISOString(),
        style: typeof p?.style === 'string' ? p.style : 'generic',
        content: _sanitizePageContent(p?.content),
    })).filter(p => p.url && p.content && !existingUrls.has(p.url)) : [];

    const newBookmarks = Array.isArray(parsed.newBookmarks) ? parsed.newBookmarks.map(p => ({
        title: typeof p?.title === 'string' ? p.title : '',
        url: (p?.url || '').trim(),
        style: typeof p?.style === 'string' ? p.style : 'generic',
        content: _sanitizePageContent(p?.content),
    })).filter(p => p.url && p.content && !existingUrls.has(p.url)) : [];

    const newSearches = Array.isArray(parsed.newSearches) ? parsed.newSearches.map(s => ({
        query: (s?.query || '').trim(),
        timestamp: typeof s?.timestamp === 'string' ? s.timestamp : new Date().toISOString(),
        results: _sanitizeSearchResults(s?.results),
    })).filter(s => s.query && s.results.length > 0 && !existingQueries.has(s.query)) : [];

    const total = pageFills.length + bookmarkFills.length + searchFills.length
        + newRecentPages.length + newBookmarks.length + newSearches.length;
    if (total === 0) return null;

    // pageFills and bookmarkFills both target the same browserDetails
    // cache keyed by url — appendBrowserBatch flattens them together via
    // the single pageFills field. Bookmark "list" entries don't exist for
    // already-listed bookmarks; we just need their content cached.
    try {
        await appendBrowserBatch({
            newRecentPages,
            newBookmarks,
            newSearches,
            pageFills: pageFills.concat(bookmarkFills),
            searchFills,
        });
    } catch (e) {
        console.warn(`${TP_LOG} appendBrowserBatch failed:`, e);
        return null;
    }

    return {
        pageFills: pageFills.length,
        bookmarkFills: bookmarkFills.length,
        searchFills: searchFills.length,
        newPages: newRecentPages.length,
        newBookmarks: newBookmarks.length,
        newSearches: newSearches.length,
    };
}
