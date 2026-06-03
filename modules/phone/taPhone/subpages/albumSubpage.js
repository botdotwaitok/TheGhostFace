// modules/phone/taPhone/subpages/albumSubpage.js — Album (相册) sub-page.
// Phase 1: grid render extracted verbatim from taPhoneApp.js.
// Phase 3.5: top ⟳ on the list page appends 3-5 new album entries via LLM.
// Phase 4: big-card detail page (no LLM — just a richer visual reframe of
// the already-stored fields with a title-hashed gradient canvas that
// holds the LLM-written visualDescription as the photo stand-in, plus
// prev/next nav that wraps around. Every recomputation is deterministic
// so revisiting the same photo always lands on the same gradient.

import { openAppInViewport } from '../../phoneController.js';
import { escapeHtml } from '../../utils/helpers.js';
import {
    getPhoneCharInfo,
    getPhoneUserName,
    getPhoneUserPersona,
    getPhoneRecentChat,
    getPhoneWorldBookContext,
} from '../../phoneContext.js';
import { formatTimestamp, emptyHtml, callDetailLLM, pushNav, TP_LOG } from '../taPhoneShared.js';
import { loadData, appendAlbum } from '../taPhoneStore.js';
import { buildAlbumBatchPrompt, buildAlbumInitialPrompt } from '../taPhonePromptBuilder.js';

export const ALBUM_TITLE = '相册';
export const ALBUM_EMPTY_ICON = 'ph ph-image-square';

// Phase 5 (album-categories): the three predefined auto-categories. LLM is
// instructed to emit these as exact strings; anything else non-empty is
// treated as a custom album.
export const PREDEFINED_ALBUMS = ['自拍', '截屏', '视频'];

// Sentinel for the "show everything" tab. Internal-only — never shown to
// the user, never matched against an albumName. Using a sentinel (instead
// of the literal "全部") guards against an LLM happening to coin a custom
// album literally named "全部".
const ALBUM_TAB_ALL = '__all__';

// Predefined-name → thumbnail/tab icon. Anything not in this map is either
// "custom" (folder icon) or unsorted (no icon).
const PREDEFINED_ICON = {
    '自拍':  'ph-user-circle',
    '截屏':  'ph-device-mobile-camera',
    '视频':  'ph-play-fill',
};

// Last tab the user was on. Module-level so that opening a photo detail
// and backing out lands on the same tab (the back path re-runs
// renderAlbumList from scratch via _showSubPage). Refresh also re-renders
// through the same path, so the tab survives that too.
let _activeAlbumTab = ALBUM_TAB_ALL;

// Per-tab page cursor. Each tab paginates independently so a long
// "全部" page count doesn't reset when the user briefly visits "自拍".
// Refresh (⟳) clears the map so newly generated photos always surface
// on page 1, matching iOS Photos behavior.
const ALBUM_PAGE_SIZE = 50;
const _pageByTab = new Map();

function _formatDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return '--:--';
    const total = Math.max(0, Math.floor(seconds));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
}

function _normalizeAlbumName(name) {
    return typeof name === 'string' ? name.trim() : '';
}

function _buildTabList(album) {
    const predefinedPresent = new Set();
    const customsOrder = [];
    const seenCustoms = new Set();
    for (const p of album) {
        const name = _normalizeAlbumName(p && p.albumName);
        if (!name) continue;
        if (PREDEFINED_ALBUMS.includes(name)) {
            predefinedPresent.add(name);
        } else if (!seenCustoms.has(name)) {
            seenCustoms.add(name);
            customsOrder.push(name);
        }
    }
    const tabs = [{ key: ALBUM_TAB_ALL, label: '全部', icon: '' }];
    for (const name of PREDEFINED_ALBUMS) {
        if (!predefinedPresent.has(name)) continue;
        tabs.push({ key: name, label: name, icon: PREDEFINED_ICON[name] || '' });
    }
    for (const name of customsOrder) {
        tabs.push({ key: name, label: name, icon: 'ph-folder' });
    }
    return tabs;
}

function _buildThumbBadgeHtml(albumName, duration) {
    if (albumName === '自拍' || albumName === '截屏') {
        return `<span class="tp-album-badge tp-album-badge--icon"><i class="ph ${PREDEFINED_ICON[albumName]}"></i></span>`;
    }
    if (albumName === '视频') {
        return `<span class="tp-album-badge tp-album-badge--video"><i class="ph ph-play-fill"></i><span>${escapeHtml(_formatDuration(duration))}</span></span>`;
    }
    return '';
}

// Detail-page canvas badge — bigger sibling of _buildThumbBadgeHtml. Same
// rules: only predefined mediaTypes get a corner badge; custom / unsorted
// stay clean (custom name is surfaced in the body instead).
function _buildCanvasBadgeHtml(albumName, duration) {
    if (albumName === '自拍' || albumName === '截屏') {
        return `<span class="tp-photo-canvas-badge tp-photo-canvas-badge--icon"><i class="ph ${PREDEFINED_ICON[albumName]}"></i></span>`;
    }
    if (albumName === '视频') {
        return `<span class="tp-photo-canvas-badge tp-photo-canvas-badge--video"><i class="ph ph-play-fill"></i><span>${escapeHtml(_formatDuration(duration))}</span></span>`;
    }
    return '';
}

export function renderAlbumList(album) {
    if (!Array.isArray(album) || album.length === 0) {
        return emptyHtml('她还没拍过什么', ALBUM_EMPTY_ICON);
    }
    const tabs = _buildTabList(album);
    // If the active tab is no longer represented (unlikely — refresh only
    // appends — but defensive), fall back to "all".
    const activeKey = tabs.some(t => t.key === _activeAlbumTab) ? _activeAlbumTab : ALBUM_TAB_ALL;
    _activeAlbumTab = activeKey;

    // Newest-first view: photos arrive via concat to the tail, but the
    // list reads better with the latest entries on top (matches iOS
    // Photos). Each entry keeps its origIdx so detail-page navigation
    // stays anchored to the underlying array and doesn't need a mapping
    // table whenever a refresh appends new items.
    const indexed = album.map((p, origIdx) => ({ p, origIdx }));
    indexed.reverse();
    const filtered = activeKey === ALBUM_TAB_ALL
        ? indexed
        : indexed.filter(({ p }) => _normalizeAlbumName(p.albumName) === activeKey);

    const totalPages = Math.max(1, Math.ceil(filtered.length / ALBUM_PAGE_SIZE));
    let pageIdx = _pageByTab.get(activeKey) ?? 0;
    if (pageIdx >= totalPages) pageIdx = totalPages - 1;
    if (pageIdx < 0) pageIdx = 0;
    _pageByTab.set(activeKey, pageIdx);

    const start = pageIdx * ALBUM_PAGE_SIZE;
    const pageItems = filtered.slice(start, start + ALBUM_PAGE_SIZE);

    // Only render the strip when there's something to filter by. Pure old
    // data (every entry albumName="") collapses to just [全部] and we hide
    // the strip so behavior matches the pre-categories list. The trailing
    // toggle button flips the strip into a wrapping multi-line view so
    // overflowing folders stay reachable even when horizontal scroll is
    // hard to discover (e.g. desktop mouse without shift+wheel).
    const tabsInnerHtml = tabs.map(t => {
        const isActive = t.key === activeKey;
        const iconHtml = t.icon ? `<i class="ph ${t.icon}"></i>` : '';
        return `<button type="button" class="tp-album-tab${isActive ? ' tp-album-tab--active' : ''}" data-tab="${escapeHtml(t.key)}" role="tab" aria-selected="${isActive ? 'true' : 'false'}">${iconHtml}<span>${escapeHtml(t.label)}</span></button>`;
    }).join('');
    const tabStripHtml = tabs.length > 1
        ? `<div class="tp-album-tabs-bar">
            <div class="tp-album-tabs" role="tablist">${tabsInnerHtml}</div>
            <button type="button" class="tp-album-tabs-toggle" aria-expanded="false" aria-label="展开全部分类" title="展开全部分类"><i class="ph ph-caret-down"></i></button>
        </div>`
        : '';

    const items = pageItems.map(({ p, origIdx }) => {
        const title = (p.title || '').trim();
        const desc = (p.description || '').trim();
        const tags = Array.isArray(p.tags) ? p.tags : [];
        const ts = formatTimestamp(p.timestamp);
        const albumName = _normalizeAlbumName(p.albumName);
        const grad = _stableGradient(title || `untitled-${origIdx}`);
        const thumbStyle = `background: linear-gradient(${grad.angle}deg, ${grad.from}, ${grad.to});`;
        const badgeHtml = _buildThumbBadgeHtml(albumName, p.duration);
        return `
            <div class="tp-album-card" data-album-index="${origIdx}" role="button" tabindex="0">
                <div class="tp-album-thumb" style="${thumbStyle}">
                    <i class="ph ph-image-square"></i>
                    ${badgeHtml}
                </div>
                <div class="tp-album-meta">
                    <div class="tp-album-title">${escapeHtml(title || '无标题')}</div>
                    <div class="tp-album-desc">${escapeHtml(desc)}</div>
                    <div class="tp-album-foot">
                        <span class="tp-album-time">${escapeHtml(ts)}</span>
                        ${tags.length ? `<span class="tp-album-tags">${tags.map(t => `<span class="tp-tag">${escapeHtml(t)}</span>`).join('')}</span>` : ''}
                    </div>
                </div>
            </div>
        `;
    }).join('');

    const pagerHtml = totalPages > 1
        ? `<div class="tp-album-pager">
            <button type="button" class="tp-album-pager-btn" id="tp_album_pager_prev" aria-label="上一页"${pageIdx === 0 ? ' disabled' : ''}><i class="ph ph-caret-left"></i></button>
            <span class="tp-album-pager-info">${pageIdx + 1}/${totalPages}</span>
            <button type="button" class="tp-album-pager-btn" id="tp_album_pager_next" aria-label="下一页"${pageIdx === totalPages - 1 ? ' disabled' : ''}><i class="ph ph-caret-right"></i></button>
        </div>`
        : '';

    return `${tabStripHtml}<div class="tp-album-grid" data-active-tab="${escapeHtml(activeKey)}">${items}</div>${pagerHtml}`;
}

/**
 * Hook click handlers onto album cards so each one opens the big-card
 * detail page. Mirrors bindMessagesListEvents / bindBrowserListEvents.
 * @param {HTMLElement} root - container holding .tp-album-card elements
 * @param {Array} album - the same array used by renderAlbumList
 * @param {() => void} restoreSelf - re-render the list (back-stack entry)
 */
export function bindAlbumListEvents(root, album, restoreSelf) {
    if (!root || !Array.isArray(album) || album.length === 0) return;

    const tabStrip = root.querySelector('.tp-album-tabs');
    const tabsToggle = root.querySelector('.tp-album-tabs-toggle');
    const collapseTabs = () => {
        if (!tabStrip?.classList.contains('tp-album-tabs--expanded')) return;
        tabStrip.classList.remove('tp-album-tabs--expanded');
        tabsToggle?.classList.remove('tp-album-tabs-toggle--expanded');
        tabsToggle?.setAttribute('aria-expanded', 'false');
        tabsToggle?.setAttribute('aria-label', '展开全部分类');
        tabsToggle?.setAttribute('title', '展开全部分类');
    };
    if (tabStrip && tabsToggle) {
        // No point offering "expand all" when every tab already fits — hide
        // the toggle once layout has settled if there is no overflow.
        requestAnimationFrame(() => {
            if (tabStrip.scrollWidth <= tabStrip.clientWidth + 1) {
                tabsToggle.classList.add('tp-album-tabs-toggle--hidden');
            }
        });
        tabsToggle.addEventListener('click', () => {
            const expanded = tabStrip.classList.toggle('tp-album-tabs--expanded');
            tabsToggle.classList.toggle('tp-album-tabs-toggle--expanded', expanded);
            tabsToggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
            tabsToggle.setAttribute('aria-label', expanded ? '收起分类' : '展开全部分类');
            tabsToggle.setAttribute('title', expanded ? '收起分类' : '展开全部分类');
        });
    }
    const tabBtns = Array.from(root.querySelectorAll('.tp-album-tab'));
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const key = btn.dataset.tab || ALBUM_TAB_ALL;
            if (key === _activeAlbumTab) {
                collapseTabs();
                return;
            }
            _activeAlbumTab = key;
            // Picking a tab always lands on its first page (iOS Photos
            // behavior). The full subpage re-render below also resets
            // the expanded strip back to the compact form.
            _pageByTab.set(key, 0);
            if (typeof restoreSelf === 'function') restoreSelf();
        });
    });

    const prevPageBtn = root.querySelector('#tp_album_pager_prev');
    const nextPageBtn = root.querySelector('#tp_album_pager_next');
    if (prevPageBtn) {
        prevPageBtn.addEventListener('click', () => {
            if (prevPageBtn.disabled) return;
            const cur = _pageByTab.get(_activeAlbumTab) ?? 0;
            if (cur <= 0) return;
            _pageByTab.set(_activeAlbumTab, cur - 1);
            if (typeof restoreSelf === 'function') restoreSelf();
        });
    }
    if (nextPageBtn) {
        nextPageBtn.addEventListener('click', () => {
            if (nextPageBtn.disabled) return;
            const cur = _pageByTab.get(_activeAlbumTab) ?? 0;
            _pageByTab.set(_activeAlbumTab, cur + 1);
            if (typeof restoreSelf === 'function') restoreSelf();
        });
    }

    root.querySelectorAll('.tp-album-card').forEach(card => {
        card.addEventListener('click', () => {
            const idx = Number(card.dataset.albumIndex);
            if (!Number.isFinite(idx) || idx < 0 || idx >= album.length) return;
            pushNav(restoreSelf);
            openAlbumDetail(album, idx);
        });
    });
}

// ═══════════════════════════════════════════════════════════════════════
// Detail page — big card, no LLM. Prev/next wraps around inside the same
// detail page so the back stack stays a single entry (the list).
// ═══════════════════════════════════════════════════════════════════════

// Two-color gradient palette tuned to feel like phone-photo placeholders:
// muted, slightly desaturated, never neon. Pairs of indices in the hash
// pick two entries; collisions resolved by bumping the second index.
const GRADIENT_PALETTE = [
    '#f7c5cc', '#f7d5b5', '#f6e7a8', '#cfe7a4', '#a8d8c3',
    '#a8c5e0', '#b6a8e0', '#e0a8c8', '#f0a8a8', '#ffd8a0',
    '#9cc9c2', '#7faecf', '#b5a5e5', '#e89bbf', '#cdb78a',
    '#8fb8a3',
];

function _stableHash(str) {
    const s = String(str || '');
    let h = 2166136261 >>> 0; // FNV-1a basis
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
    }
    return h;
}

function _stableGradient(seed) {
    const h = _stableHash(seed);
    const a = h % GRADIENT_PALETTE.length;
    let b = (h >>> 8) % GRADIENT_PALETTE.length;
    if (b === a) b = (b + 1) % GRADIENT_PALETTE.length;
    // 8 stable angles distributed around the circle.
    const angle = ((h >>> 16) & 0x7) * 45;
    return {
        from: GRADIENT_PALETTE[a],
        to: GRADIENT_PALETTE[b],
        angle,
    };
}

// Pretty "year-month-day hh:mm" form for the EXIF strip — absolute, not
// "今天 / 昨天" relative, because we want a "looking at an old shot" feel.
function _formatExifTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const y = d.getFullYear();
    const mo = d.getMonth() + 1;
    const dd = d.getDate();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${y}年${mo}月${dd}日 ${hh}:${mm}`;
}

/**
 * Open the big-card detail page for album[index]. Prev/next call this
 * recursively — they reuse the same nav entry (openAppInViewport just
 * swaps the viewport content), so backing out from photo #5 still lands
 * on the album list, not on photo #4.
 *
 * @param {Array} album - full album array
 * @param {number} index - position into album (wraps via modulo)
 */
export function openAlbumDetail(album, index) {
    if (!Array.isArray(album) || album.length === 0) return;
    const total = album.length;
    const i = ((index % total) + total) % total;
    const photo = album[i] || {};

    const title = (photo.title || '').trim() || '无标题';
    const visual = (photo.visualDescription || '').trim();
    const desc = (photo.description || '').trim();
    const tags = Array.isArray(photo.tags) ? photo.tags.filter(t => typeof t === 'string') : [];
    const ts = (photo.timestamp || '').trim();
    const location = (photo.location || '').trim();
    const albumName = _normalizeAlbumName(photo.albumName);
    const isCustomAlbum = !!albumName && !PREDEFINED_ALBUMS.includes(albumName);

    const grad = _stableGradient(title);
    const exifTime = _formatExifTime(ts);

    // The list view is newest-first, so the header should count from the
    // tail (viewIdx 0 = the most recent photo). The underlying `i` still
    // indexes into the raw array so storage logic stays unchanged.
    const viewIdx = total - 1 - i;
    const headerTitle = `<span class="tp-title">${escapeHtml(`${viewIdx + 1} / ${total}`)}</span>`;
    const tagsHtml = tags.length
        ? `<div class="tp-photo-tags">${tags.map(t => `<span class="tp-tag">${escapeHtml(t)}</span>`).join('')}</div>`
        : '';
    const descHtml = desc
        ? `<div class="tp-photo-desc">${escapeHtml(desc)}</div>`
        : '';
    const exifItems = [];
    if (exifTime) {
        exifItems.push(`<span class="tp-photo-exif-item"><i class="ph ph-clock"></i> ${escapeHtml(exifTime)}</span>`);
    }
    if (location) {
        exifItems.push(`<span class="tp-photo-exif-item"><i class="ph ph-map-pin"></i> ${escapeHtml(location)}</span>`);
    }
    const exifHtml = exifItems.length
        ? `<div class="tp-photo-exif">${exifItems.join('')}</div>`
        : '';
    // visualDescription compensates for the lack of real image generation:
    // it lives inside the canvas as a frosted "caption over the image".
    // Old data without the field falls back to the original icon placeholder.
    const canvasInnerHtml = visual
        ? `<div class="tp-photo-canvas-text">${escapeHtml(visual)}</div>`
        : `<i class="ph ph-image-square tp-photo-canvas-icon"></i>`;
    const canvasBadgeHtml = _buildCanvasBadgeHtml(albumName, photo.duration);
    const albumNameHtml = isCustomAlbum
        ? `<div class="tp-photo-album-name"><i class="ph ph-folder"></i><span>${escapeHtml(albumName)}</span></div>`
        : '';

    const html = `
        <div class="tp-photo-detail tp-fade-in">
            <div class="tp-photo-scroll">
                <div class="tp-photo-canvas" style="background: linear-gradient(${grad.angle}deg, ${grad.from}, ${grad.to});">
                    ${canvasInnerHtml}
                    ${canvasBadgeHtml}
                </div>
                <div class="tp-photo-body">
                    <div class="tp-photo-title">${escapeHtml(title)}</div>
                    ${albumNameHtml}
                    ${exifHtml}
                    ${descHtml}
                    ${tagsHtml}
                </div>
            </div>
            <div class="tp-photo-nav">
                <button class="tp-photo-nav-btn" id="tp_photo_prev" type="button">
                    <i class="ph ph-caret-left"></i>
                    <span>上一张</span>
                </button>
                <button class="tp-photo-nav-btn" id="tp_photo_next" type="button">
                    <span>下一张</span>
                    <i class="ph ph-caret-right"></i>
                </button>
            </div>
        </div>
    `;

    openAppInViewport(headerTitle, html, () => {
        // List order is reversed: "上一张" in the UI = the visually
        // preceding (newer) entry = +1 in the underlying array; "下一张"
        // = the visually following (older) entry = -1.
        document.getElementById('tp_photo_prev')?.addEventListener('click', () => {
            openAlbumDetail(album, i + 1);
        });
        document.getElementById('tp_photo_next')?.addEventListener('click', () => {
            openAlbumDetail(album, i - 1);
        });
    });
}

/**
 * Append 3-5 new album entries via LLM. The album has no detail page in
 * v2 (D5 — no LLM per-photo), so refresh is a pure "grow the list" op.
 *
 * @returns {Promise<{ added:number } | null>}
 */
export async function refreshAlbum() {
    let data;
    try {
        data = await loadData();
    } catch (e) {
        console.warn(`${TP_LOG} refreshAlbum loadData failed:`, e);
        return null;
    }
    const existingAlbum = Array.isArray(data?.album) ? data.album : [];
    const existingCustomAlbums = Array.from(new Set(
        existingAlbum
            .map(p => (typeof p?.albumName === 'string' ? p.albumName.trim() : ''))
            .filter(name => name && !PREDEFINED_ALBUMS.includes(name))
    ));

    const charInfo = getPhoneCharInfo();
    const userName = getPhoneUserName();
    const userPersona = getPhoneUserPersona();
    const recentChatSummary = getPhoneRecentChat(20);
    let worldBookText = '';
    try { worldBookText = await getPhoneWorldBookContext(); } catch {}

    // Empty album → ⟳ acts as "reseed from scratch" (used after the user
    // clears the album from Settings). Reuses the initial-generation
    // semantics so the resulting payload still has the mandatory 2-3
    // custom albums + at least one selfie/screenshot/video. Non-empty →
    // batch append, which preserves existing custom names and caps new
    // ones at +1.
    const isReseed = existingAlbum.length === 0;
    const { systemPrompt, userPrompt } = isReseed
        ? buildAlbumInitialPrompt({
            charInfo, userName, userPersona, worldBookText, recentChatSummary,
        })
        : buildAlbumBatchPrompt({
            charInfo, userName, userPersona, worldBookText, recentChatSummary,
            existingAlbum,
            existingCustomAlbums,
        });

    console.log(`${TP_LOG} calling LLM for album ${isReseed ? 'reseed' : 'broad refresh'}`);
    const parsed = await callDetailLLM(systemPrompt, userPrompt, { maxTokens: 4000 });
    const list = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.album) ? parsed.album : null);
    if (!list) return null;

    const newItems = list
        .filter(p => p && typeof p === 'object' && typeof p.title === 'string')
        .map(p => {
            const item = {
                title: p.title,
                visualDescription: typeof p.visualDescription === 'string' ? p.visualDescription : '',
                description: typeof p.description === 'string' ? p.description : '',
                tags: Array.isArray(p.tags) ? p.tags.filter(t => typeof t === 'string') : [],
                timestamp: typeof p.timestamp === 'string' ? p.timestamp : new Date().toISOString(),
                albumName: typeof p.albumName === 'string' ? p.albumName.trim() : '',
                location: typeof p.location === 'string' ? p.location.trim() : '',
            };
            if (Number.isFinite(p.duration) && p.duration > 0) {
                item.duration = p.duration;
            }
            return item;
        });
    if (newItems.length === 0) return null;

    try {
        await appendAlbum(newItems);
    } catch (e) {
        console.warn(`${TP_LOG} appendAlbum failed:`, e);
        return null;
    }
    // Newly generated photos belong on page 1 of every tab — reset all
    // per-tab page cursors so the user lands on the fresh content.
    _pageByTab.clear();
    return { added: newItems.length };
}
