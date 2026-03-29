import { saveHandbookMeta, loadHandbookResponse, uploadCustomBg, loadCustomBg } from './handbookStorage.js';
import { AppState } from './handbookState.js';
import { _renderCoverEditor } from './handbookCoverUI.js';
import { _renderStickersTab, _renderTapesTab, _extractBlocksText } from './handbookInteractables.js';
import { LOG, _escapeHtml, _switchToView } from './handbookEngine.js';

// ═══════════════════════════════════════════════════════════════════════
// Bottom Menu
// ═══════════════════════════════════════════════════════════════════════

export function _toggleMenu() {
    AppState.menuOpen = !AppState.menuOpen;
    const overlay = document.getElementById('hb_menu_overlay');
    const btn = document.getElementById('hb_menu_btn');
    if (overlay) overlay.classList.toggle('open', AppState.menuOpen);
    if (btn) btn.classList.toggle('open', AppState.menuOpen);
    if (AppState.menuOpen) _renderActiveTab();
}

// ═══════════════════════════════════════════════════════════════════════
// TOC Panel (Slide-in Overlay)
// ═══════════════════════════════════════════════════════════════════════

let _tocPanelOpen = false;

/** Getter for external modules (e.g. Engine Escape key handler) */
export function isTocPanelOpen() { return _tocPanelOpen; }

export function _toggleTocPanel() {
    if (_tocPanelOpen) _closeTocPanel();
    else _openTocPanel();
}

export function _openTocPanel() {
    _tocPanelOpen = true;
    _renderTocPanel();
    const overlay = document.getElementById('hb_toc_overlay');
    if (overlay) overlay.classList.add('open');
}

export function _closeTocPanel() {
    _tocPanelOpen = false;
    const overlay = document.getElementById('hb_toc_overlay');
    if (overlay) overlay.classList.remove('open');
}

/** Show/hide the floating FAB buttons based on view (shown on cover/coverEditor where toolbar is hidden) */
export function _updateTocFabVisibility() {
    const showFab = AppState.currentView === 'cover' || AppState.currentView === 'coverEditor';
    
    const tocFab = document.getElementById('hb_toc_fab');
    if (tocFab) tocFab.classList.toggle('visible', showFab);

    const menuFab = document.getElementById('hb_menu_fab');
    if (menuFab) menuFab.classList.toggle('visible', showFab);
}

/**
 * Render the TOC panel content.
 * - Fixed items: Cover + Flyleaf
 * - Page list: all existing pages + "新的一页" for unsaved new pages
 */
export function _renderTocPanel() {
    const fixedContainer = document.getElementById('hb_toc_panel_fixed');
    const pagesContainer = document.getElementById('hb_toc_panel_pages');
    if (!fixedContainer || !pagesContainer) return;

    // Fixed items: Cover + Flyleaf
    fixedContainer.innerHTML = `
        <button class="hb-toc-panel-item ${AppState.currentView === 'cover' ? 'active' : ''}"
                data-nav="cover">
            <i class="ph ph-book-open"></i>
            <span class="hb-toc-panel-item-label">封面</span>
        </button>
        <button class="hb-toc-panel-item ${AppState.currentView === 'flyleaf' ? 'active' : ''}"
                data-nav="flyleaf">
            <i class="ph ph-feather"></i>
            <span class="hb-toc-panel-item-label">扉页</span>
        </button>
    `;

    // Page list — includes a "新的一页" entry when on a new unsaved page
    let pagesHtml = '';
    if (AppState.meta.pages.length > 0) {
        pagesHtml = AppState.meta.pages.map((p, i) => `
            <div class="hb-toc-panel-item ${AppState.currentView === 'diary' && AppState.currentDiaryIndex === i ? 'active' : ''}"
                    data-nav="diary" data-index="${i}">
                <i class="ph ph-note"></i>
                <span class="hb-toc-panel-item-label" data-index="${i}">${_escapeHtml(p.moodText || `第 ${i + 1} 页`)}</span>
                <span class="hb-toc-panel-item-badge">${p.date || ''}</span>
                <button class="hb-toc-panel-edit-btn" data-index="${i}" title="编辑标题">
                    <i class="ph ph-pencil-simple"></i>
                </button>
                <button class="hb-toc-panel-delete-btn" data-index="${i}" title="删除此页">
                    <i class="ph ph-trash"></i>
                </button>
            </div>
        `).join('');
    }

    // Show "新的一页" entry when the current view is a new unsaved page
    if (AppState.currentView === 'diary' && AppState.currentDiaryIndex < 0) {
        pagesHtml += `
            <div class="hb-toc-panel-item active hb-toc-new-page-indicator"
                    data-nav="diary" data-index="-1">
                <i class="ph ph-sparkle"></i>
                <span class="hb-toc-panel-item-label">新的一页</span>
                <span class="hb-toc-panel-item-badge">未保存</span>
            </div>
        `;
    }

    if (!pagesHtml) {
        pagesContainer.innerHTML = '<div class="hb-toc-panel-empty">还没有日记页</div>';
    } else {
        pagesContainer.innerHTML = pagesHtml;
    }

    // Bind click events
    const allItems = [...fixedContainer.querySelectorAll('.hb-toc-panel-item'),
                      ...pagesContainer.querySelectorAll('.hb-toc-panel-item')];
    allItems.forEach(item => {
        item.addEventListener('click', (e) => {
            if (e.target.closest('.hb-toc-panel-delete-btn') || e.target.closest('.hb-toc-panel-edit-btn') || e.target.closest('.hb-toc-panel-item-edit-input')) return; // handled separately
            const nav = item.dataset.nav;
            if (nav === 'cover') {
                _closeTocPanel();
                _switchToView('cover', -1);
            } else if (nav === 'flyleaf') {
                _closeTocPanel();
                _switchToView('flyleaf', AppState.currentView === 'cover' ? 1 : -1);
            } else if (nav === 'diary') {
                const idx = parseInt(item.dataset.index);
                if (idx >= 0) {
                    const dir = idx > AppState.currentDiaryIndex ? 1 : -1;
                    AppState.currentDiaryIndex = idx;
                    _closeTocPanel();
                    _switchToView('diary', dir);
                }
                // idx === -1 means already on new page, just close
                else {
                    _closeTocPanel();
                }
            }
        });
    });

    // Edit button click events
    pagesContainer.querySelectorAll('.hb-toc-panel-edit-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const idx = parseInt(btn.dataset.index);
            const page = AppState.meta.pages[idx];
            if (!page) return;

            const itemEl = btn.closest('.hb-toc-panel-item');
            const labelEl = itemEl.querySelector('.hb-toc-panel-item-label');
            if (labelEl.querySelector('input')) return; // already editing

            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'hb-toc-panel-item-edit-input';
            // Use current moodText
            input.value = page.moodText || '';
            input.placeholder = `第 ${idx + 1} 页`;

            // Replace text
            labelEl.textContent = '';
            labelEl.appendChild(input);
            input.focus();

            const commitEdit = async () => {
                if (!labelEl.contains(input)) return;
                const newTitle = input.value.trim();
                page.moodText = newTitle;
                
                // Re-render the label text
                labelEl.innerHTML = '';
                labelEl.textContent = page.moodText || `第 ${idx + 1} 页`;
                
                // If it's the current page, update the response cache
                if (AppState.currentView === 'diary' && AppState.currentDiaryIndex === idx) {
                    const cachedResp = AppState.responseCache.get(page.id);
                    if (cachedResp) {
                        cachedResp.moodText = page.moodText;
                    }
                }

                // Save meta
                const stHeaders = AppState.initData.stRequestHeaders || {};
                try {
                    await saveHandbookMeta(AppState.meta, AppState.charId, stHeaders);
                } catch (err) {
                    console.error(`${LOG} Failed to save edited title:`, err);
                }
            };

            input.addEventListener('blur', commitEdit);
            input.addEventListener('keydown', (e2) => {
                if (e2.key === 'Enter') {
                    e2.preventDefault();
                    input.blur(); // will trigger blur to commit
                }
                if (e2.key === 'Escape') {
                    // Cancel
                    e2.preventDefault(); // prevent losing focus unexpectedly
                    labelEl.innerHTML = '';
                    labelEl.textContent = page.moodText || `第 ${idx + 1} 页`;
                }
            });
        });
    });

    // Delete button click events
    pagesContainer.querySelectorAll('.hb-toc-panel-delete-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const idx = parseInt(btn.dataset.index);
            const page = AppState.meta.pages[idx];
            if (!page) return;
            if (!confirm(`确定删除第 ${idx + 1} 页？此操作不可撤销。`)) return;

            AppState.meta.pages.splice(idx, 1);

            // Adjust current diary index
            if (AppState.currentView === 'diary') {
                if (AppState.currentDiaryIndex === idx) {
                    AppState.currentDiaryIndex = AppState.meta.pages.length > 0 ? Math.min(idx, AppState.meta.pages.length - 1) : -1;
                    // Force re-render of the current view
                    _switchToView('diary', 0);
                } else if (AppState.currentDiaryIndex > idx) {
                    AppState.currentDiaryIndex--;
                }
            }
            
            // Re-render TOC
            _renderTocPanel();

            // Save changes asynchronously
            const stHeaders = AppState.initData.stRequestHeaders || {};
            try {
                await saveHandbookMeta(AppState.meta, AppState.charId, stHeaders);
                console.log(`${LOG} Page deleted: index=${idx}`);
            } catch (err) {
                console.error(`${LOG} Failed to delete page:`, err);
            }
        });
    });
}

/** Update active states in the TOC panel without full re-render */
export function _updateTocActive() {
    const fixedContainer = document.getElementById('hb_toc_panel_fixed');
    const pagesContainer = document.getElementById('hb_toc_panel_pages');

    if (fixedContainer) {
        fixedContainer.querySelectorAll('.hb-toc-panel-item').forEach(item => {
            const nav = item.dataset.nav;
            item.classList.toggle('active', nav === AppState.currentView);
        });
    }

    if (pagesContainer) {
        pagesContainer.querySelectorAll('.hb-toc-panel-item').forEach(item => {
            const idx = parseInt(item.dataset.index);
            if (idx === -1) {
                // "新的一页" indicator
                item.classList.toggle('active', AppState.currentView === 'diary' && AppState.currentDiaryIndex < 0);
            } else {
                item.classList.toggle('active', AppState.currentView === 'diary' && AppState.currentDiaryIndex === idx);
            }
        });

        // Re-render if page count changed (new page created/deleted)
        const renderedPageItems = pagesContainer.querySelectorAll('.hb-toc-panel-item:not(.hb-toc-new-page-indicator)').length;
        const hasNewIndicator = !!pagesContainer.querySelector('.hb-toc-new-page-indicator');
        const needsNewIndicator = AppState.currentView === 'diary' && AppState.currentDiaryIndex < 0;
        if (renderedPageItems !== AppState.meta.pages.length || hasNewIndicator !== needsNewIndicator) {
            _renderTocPanel();
        }
    }
}

export function _renderActiveTab() {
    // Render whichever section is currently open
    document.querySelectorAll('.hb-menu-section[open]').forEach(section => {
        _renderMenuSection(section.dataset.tab);
    });
}

/** Invalidate menu section caches that depend on the current page context */
export function _invalidateMenuSections() {
    // Settings and cover depend on which page is active; clear them on view switch
    const settingsBody = document.getElementById('hb_menu_body_settings');
    if (settingsBody) settingsBody.innerHTML = '';
    const coverBody = document.getElementById('hb_menu_body_cover');
    if (coverBody) coverBody.innerHTML = '';
}

export function _renderMenuSection(tab) {
    const bodyMap = {
        'stickers': 'hb_menu_body_stickers',
        'tapes': 'hb_menu_body_tapes',
        'cover-edit': 'hb_menu_body_cover',
        'console': 'hb_menu_body_console',
        'settings': 'hb_menu_body_settings',
    };
    const content = document.getElementById(bodyMap[tab]);
    if (!content) return;
    // Skip re-render if already has content (invalidated sections will be empty)
    if (content.children.length > 0) return;

    switch (tab) {
        case 'stickers':   _renderStickersTab(content); break;
        case 'tapes':      _renderTapesTab(content); break;
        case 'cover-edit': _renderCoverEditor(content, true); break;
        case 'console':    _renderConsoleTab(content); break;
        case 'settings':   _renderSettingsTab(content); break;
    }
}

// (Old _renderTocTab removed — replaced by _renderTocPanel overlay)

// ═══════════════════════════════════════════════════════════════════════
// Search Tab
// ═══════════════════════════════════════════════════════════════════════

export function _renderSearchTab(container) {
    container.innerHTML = `
        <div class="hb-search-wrapper">
            <input class="hb-search-input" id="hb_search_input" placeholder="搜索手账内容…" autocomplete="off">
            <div class="hb-search-results" id="hb_search_results">
                <div class="hb-search-empty">输入关键词搜索</div>
            </div>
        </div>
    `;

    let debounceTimer;
    document.getElementById('hb_search_input')?.addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => _performSearch(e.target.value.trim()), 300);
    });
}

export async function _performSearch(query) {
    const resultsContainer = document.getElementById('hb_search_results');
    if (!resultsContainer) return;

    if (!query) {
        resultsContainer.innerHTML = '<div class="hb-search-empty">输入关键词搜索</div>';
        return;
    }

    // Batch-load all uncached responses in parallel (P5 optimization)
    const stHeaders = AppState.initData.stRequestHeaders || {};
    const uncachedPages = AppState.meta.pages.filter(p => !AppState.responseCache.has(p.id));
    if (uncachedPages.length > 0) {
        resultsContainer.innerHTML = '<div class="hb-search-empty">加载中…</div>';
        const results = await Promise.all(
            uncachedPages.map(p => loadHandbookResponse(AppState.charId, p.id, stHeaders).then(r => ({ id: p.id, resp: r })))
        );
        for (const { id, resp } of results) {
            AppState.responseCache.set(id, resp || null);
        }
    }

    const results = [];
    const lowerQuery = query.toLowerCase();

    AppState.meta.pages.forEach((page, i) => {
        const resp = AppState.responseCache.get(page.id);
        const searchText = [page.moodText, _extractBlocksText(resp)].filter(Boolean).join(' ');
        if (searchText.toLowerCase().includes(lowerQuery)) {
            results.push({ page, index: i, content: _extractBlocksText(resp) || page.moodText || '' });
        }
    });

    if (results.length === 0) {
        resultsContainer.innerHTML = '<div class="hb-search-empty">未找到匹配结果</div>';
        return;
    }

    resultsContainer.innerHTML = results.map(r => {
        const escapedQuery = _escapeHtml(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const highlighted = _escapeHtml(r.content.substring(0, 100))
            .replace(new RegExp(escapedQuery, 'gi'), m => `<mark>${m}</mark>`);
        return `
            <div class="hb-search-result" data-index="${r.index}">
                <div class="hb-search-result-page">第 ${r.index + 1} 页 · ${r.page.date || ''}</div>
                <div class="hb-search-result-text">${highlighted}${r.content.length > 100 ? '…' : ''}</div>
            </div>
        `;
    }).join('');

    resultsContainer.querySelectorAll('.hb-search-result').forEach(item => {
        item.addEventListener('click', () => {
            AppState.currentDiaryIndex = parseInt(item.dataset.index);
            _closeTocPanel();
            _switchToView('diary', 1);
        });
    });
}

// ═══════════════════════════════════════════════════════════════════════
// Console Tab
// ═══════════════════════════════════════════════════════════════════════

export function _renderConsoleTab(container) {
    container.innerHTML = `
        <div class="hb-console-toolbar">
            <button id="hb_console_copy_btn">复制日志</button>
            <button id="hb_console_clear_btn">清空</button>
        </div>
        <div class="hb-console-area" id="hb_console_area">
            ${AppState.consoleLogs.map(l => `<div class="hb-console-line" style="color:${l.color}">${_escapeHtml(l.text)}</div>`).join('')}
        </div>
    `;

    const area = document.getElementById('hb_console_area');
    if (area) area.scrollTop = area.scrollHeight;

    document.getElementById('hb_console_copy_btn')?.addEventListener('click', () => {
        const text = AppState.consoleLogs.map(l => l.text).join('\n');
        navigator.clipboard.writeText(text).catch(() => {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.cssText = 'position:fixed;left:-9999px';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            ta.remove();
        });
    });

    document.getElementById('hb_console_clear_btn')?.addEventListener('click', () => {
        AppState.consoleLogs = [];
        if (area) area.innerHTML = '';
    });
}

// ═══════════════════════════════════════════════════════════════════════
// Settings Tab — Page Color, Texture Type, Texture Style
// ═══════════════════════════════════════════════════════════════════════

export const PATTERN_OPTIONS = [
    { id: 'dots',   icon: 'ph-dots-nine',     label: '圆点' },
    { id: 'grid',   icon: 'ph-grid-four',     label: '格子' },
    { id: 'lines',  icon: 'ph-text-align-left', label: '横线' },
    { id: 'blank',  icon: 'ph-square',        label: '空白' },
    { id: 'custom', icon: 'ph-image',         label: '自定义' },
];

export const PAGE_COLOR_PRESETS = [
    { color: '#fefcf7', label: '暖白纸' },
    { color: '#f5ede0', label: '奶茶色' },
    { color: '#fdf0f2', label: '浅粉' },
    { color: '#eef6f3', label: '薄荷' },
    { color: '#eef2f9', label: '浅蓝' },
    { color: '#f0f0f0', label: '浅灰' },
];

export const PATTERN_COLOR_PRESETS = [
    { color: '#b4aa96', label: '暖灰' },
    { color: '#c8b89a', label: '浅棕' },
    { color: '#c4a6a6', label: '玫瑰灰' },
    { color: '#9ba8b4', label: '蓝灰' },
    { color: '#9bb3a8', label: '薄荷灰' },
    { color: '#888888', label: '深灰' },
];

/** Generate inline background style. Reads from pageObj first, falls back to AppState.meta.settings. */
export function _getPageStyleInline(pageObj) {
    const s = AppState.meta.settings || {};
    const pattern = pageObj?.pattern || s.pagePattern || 'dots';
    const pageColor = pageObj?.pageColor || s.pageColor || '#fefcf7';
    // Merge per-page patternStyle with global fallback field-by-field
    const globalPs = s.patternStyle || {};
    const pagePs = pageObj?.patternStyle || {};
    const pColor = pagePs.color || globalPs.color || '#b4aa96';
    const pOpacity = pagePs.opacity ?? globalPs.opacity ?? 0.4;
    const pSize = pagePs.size ?? globalPs.size ?? 1.5;
    const pSpacing = pagePs.spacing ?? globalPs.spacing ?? 20;

    // Parse hex color to rgba with opacity
    const rgba = _hexToRgba(pColor, pOpacity);

    let bgImage = 'none';
    let bgSize = '';
    let styleStr = '';

    switch (pattern) {
        case 'dots':
            bgImage = `radial-gradient(circle, ${rgba} ${pSize}px, transparent ${pSize}px)`;
            bgSize = `${pSpacing}px ${pSpacing}px`;
            break;
        case 'grid':
            bgImage = `linear-gradient(${rgba} ${pSize}px, transparent ${pSize}px), linear-gradient(90deg, ${rgba} ${pSize}px, transparent ${pSize}px)`;
            bgSize = `${pSpacing}px ${pSpacing}px`;
            break;
        case 'lines':
            bgImage = `repeating-linear-gradient(transparent, transparent ${pSpacing - pSize}px, ${rgba} ${pSpacing}px)`;
            bgSize = '';
            break;
        case 'custom': {
            const bgId = pageObj?.customBgId || s.customBgId || 'custom';
            const cacheUrl = AppState.bgImageCache.get(bgId);
            if (cacheUrl) {
                bgImage = `url('${cacheUrl}')`;
                bgSize = 'cover';
                styleStr += `background-position: center; `;
            } else {
                bgImage = 'none';
            }
            break;
        }
        case 'blank':
        default:
            bgImage = 'none';
            break;
    }

    styleStr += `background-color: ${pageColor}; background-image: ${bgImage};`;
    if (bgImage !== 'none' && bgSize) {
        styleStr += ` background-size: ${bgSize};`;
    }
    return styleStr;
}

/** Hex → rgba string */
export function _hexToRgba(hex, alpha) {
    const h = hex.replace('#', '');
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Apply page style to current visible page paper element */
export function _applyPageStyleLive() {
    const el = document.getElementById('hb_page_paper');
    if (!el) return;
    const page = _getCurrentPageObj();
    const pattern = page?.pattern || AppState.meta.settings?.pagePattern || 'dots';
    el.className = el.className.replace(/hb-pattern-\S+/g, '').trim();
    if (pattern === 'custom') {
        el.classList.add('hb-pattern-custom');
    }
    el.setAttribute('style', _getPageStyleInline(page));
}

/** Helper: get current page object (or flyleaf style data) */
export function _getCurrentPageObj() {
    if (AppState.currentView === 'flyleaf') {
        // Ensure flyleaf has style fields
        if (!AppState.meta.flyleaf) AppState.meta.flyleaf = {};
        return AppState.meta.flyleaf;
    }
    if (AppState.currentView === 'diary' && AppState.currentDiaryIndex >= 0 && AppState.currentDiaryIndex < AppState.meta.pages.length) {
        return AppState.meta.pages[AppState.currentDiaryIndex];
    }
    return null;
}

let _settingsSaveTimer = null;
export function _debouncedSaveSettings() {
    clearTimeout(_settingsSaveTimer);
    _settingsSaveTimer = setTimeout(async () => {
        const stHeaders = AppState.initData.stRequestHeaders || {};
        await saveHandbookMeta(AppState.meta, AppState.charId, stHeaders);
        console.log(`${LOG} Settings saved`);
    }, 300);
}

export function _renderSettingsTab(container) {
    let page = _getCurrentPageObj();
    const s = AppState.meta.settings || {};

    // Helper: get the write target (per-page or global)
    const target = page || s;

    // Ensure per-page fields exist (copy from global defaults on first edit)
    if (page && page.pageColor === undefined) page.pageColor = s.pageColor || '#fefcf7';
    if (page && page.pattern === undefined) page.pattern = s.pagePattern || 'dots';
    if (page && page.patternStyle === undefined) page.patternStyle = s.patternStyle ? { ...s.patternStyle } : {};

    // Read values from the target (field-by-field merge for patternStyle)
    const currentPattern = target === s ? (s.pagePattern || 'dots') : page.pattern;
    const pageColor = target === s ? (s.pageColor || '#fefcf7') : page.pageColor;
    const globalPs = s.patternStyle || {};
    const pagePs = page ? (page.patternStyle || {}) : {};
    const patternColor = (target === page ? pagePs.color : undefined) ?? globalPs.color ?? '#b4aa96';
    const patternOpacity = (target === page ? pagePs.opacity : undefined) ?? globalPs.opacity ?? 0.4;
    const patternSize = (target === page ? pagePs.size : undefined) ?? globalPs.size ?? 1.5;
    const patternSpacing = (target === page ? pagePs.spacing : undefined) ?? globalPs.spacing ?? 20;
    const showStyleControls = ['dots', 'grid', 'lines'].includes(currentPattern);

    let pageLabel = '全局默认页面样式';
    if (AppState.currentView === 'flyleaf') {
        pageLabel = '扉页样式';
    } else if (page && AppState.currentView === 'diary') {
        pageLabel = `当前页面样式 — 第 ${AppState.currentDiaryIndex + 1} 页`;
    }

    container.innerHTML = `
        <div class="hb-settings-section">
            <div class="hb-settings-group-title" style="font-size:14px;opacity:0.7;margin-bottom:4px;">
                <i class="ph ph-paint-brush-broad" style="margin-right:4px;"></i> ${pageLabel}
            </div>

            <!-- ① Page Color -->
            <div class="hb-settings-group">
                <div class="hb-settings-group-title">页面底色</div>
                <div class="hb-color-swatches" id="hb_page_color_swatches">
                    ${PAGE_COLOR_PRESETS.map(p => `
                        <button class="hb-swatch ${p.color === pageColor ? 'selected' : ''}"
                                style="background:${p.color}" data-color="${p.color}" title="${p.label}"></button>
                    `).join('')}
                    <div class="hb-swatch-custom" title="自定义颜色">
                        <input type="color" id="hb_page_color_picker" value="${pageColor}">
                    </div>
                </div>
            </div>

            <!-- ② Texture Type -->
            <div class="hb-settings-group">
                <div class="hb-settings-group-title">纹理类型</div>
                <div class="hb-pattern-options">
                    ${PATTERN_OPTIONS.filter(p => p.id !== 'custom').map(p => `
                        <button class="hb-pattern-option ${p.id === currentPattern ? 'selected' : ''}"
                                data-pattern="${p.id}">
                            <i class="ph ${p.icon}"></i>
                            <span>${p.label}</span>
                        </button>
                    `).join('')}
                </div>
            </div>

            <!-- ③ Texture Style -->
            <div class="hb-settings-group" id="hb_style_controls" style="${showStyleControls ? '' : 'display:none'}">
                <div class="hb-settings-group-title">纹理样式</div>

                <div class="hb-color-swatches" id="hb_pattern_color_swatches">
                    ${PATTERN_COLOR_PRESETS.map(p => `
                        <button class="hb-swatch ${p.color === patternColor ? 'selected' : ''}"
                                style="background:${p.color}" data-color="${p.color}" title="${p.label}"></button>
                    `).join('')}
                    <div class="hb-swatch-custom" title="自定义颜色">
                        <input type="color" id="hb_pattern_color_picker" value="${patternColor}">
                    </div>
                </div>

                <div class="hb-style-controls">
                    <div class="hb-style-row">
                        <span class="hb-style-label">透明度</span>
                        <input type="range" class="hb-style-slider" id="hb_slider_opacity"
                               min="0.1" max="1.0" step="0.05" value="${patternOpacity}">
                        <span class="hb-style-value" id="hb_val_opacity">${patternOpacity.toFixed(2)}</span>
                    </div>
                    <div class="hb-style-row">
                        <span class="hb-style-label">粗细</span>
                        <input type="range" class="hb-style-slider" id="hb_slider_size"
                               min="0.5" max="5" step="0.25" value="${patternSize}">
                        <span class="hb-style-value" id="hb_val_size">${patternSize}px</span>
                    </div>
                    <div class="hb-style-row">
                        <span class="hb-style-label">间距</span>
                        <input type="range" class="hb-style-slider" id="hb_slider_spacing"
                               min="10" max="50" step="1" value="${patternSpacing}">
                        <span class="hb-style-value" id="hb_val_spacing">${patternSpacing}px</span>
                    </div>
                </div>
            </div>

            <!-- ④ Custom Background -->
            <div class="hb-settings-group">
                <div class="hb-settings-group-title">自定义背景</div>
                <div class="hb-pattern-options">
                    ${PATTERN_OPTIONS.filter(p => p.id === 'custom').map(p => `
                        <button class="hb-pattern-option ${p.id === currentPattern ? 'selected' : ''}"
                                data-pattern="${p.id}" style="width: 100%; justify-content: center;">
                            <i class="ph ${p.icon}"></i>
                            <span>${p.label}图片</span>
                        </button>
                    `).join('')}
                </div>
                <div class="hb-bg-gallery" id="hb_bg_upload_area" style="${currentPattern === 'custom' ? 'margin-top: 10px;' : 'display:none; margin-top: 10px;'}">
                    ${(AppState.meta.customBackgrounds || []).map(bg => `
                        <div class="hb-bg-item ${bg.id === target.customBgId ? 'selected' : ''}" data-bg="${bg.id}" title="选择此背景">
                            <img src="${AppState.bgImageCache.get(bg.id) || ''}">
                            <button class="hb-bg-item-delete" data-bg="${bg.id}" title="删除背景"><i class="ph ph-trash"></i></button>
                        </div>
                    `).join('')}
                    <div class="hb-bg-item hb-bg-upload" id="hb_bg_upload_trigger" title="上传背景">
                        <i class="ph ph-plus"></i>
                    </div>
                </div>
            </div>
        </div>
    `;

    const ensurePatternStyle = () => {
        if (!target.patternStyle) target.patternStyle = {};
    };

    // ── Page color swatches ──
    container.querySelectorAll('#hb_page_color_swatches .hb-swatch').forEach(btn => {
        btn.addEventListener('click', () => {
            container.querySelectorAll('#hb_page_color_swatches .hb-swatch').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            target.pageColor = btn.dataset.color;
            _applyPageStyleLive();
            _debouncedSaveSettings();
        });
    });

    document.getElementById('hb_page_color_picker')?.addEventListener('input', (e) => {
        container.querySelectorAll('#hb_page_color_swatches .hb-swatch').forEach(b => b.classList.remove('selected'));
        target.pageColor = e.target.value;
        _applyPageStyleLive();
        _debouncedSaveSettings();
    });

    // ── Pattern type options ──
    container.querySelectorAll('.hb-pattern-option').forEach(btn => {
        btn.addEventListener('click', async () => {
            container.querySelectorAll('.hb-pattern-option').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            const pattern = btn.dataset.pattern;
            if (target === AppState.meta.settings) {
                target.pagePattern = pattern;
            } else {
                target.pattern = pattern;
            }

            // Update UI selected states
            const uploadArea = document.getElementById('hb_bg_upload_area');
            const styleControls = document.getElementById('hb_style_controls');
            if (uploadArea) uploadArea.style.display = pattern === 'custom' ? '' : 'none';
            if (styleControls) styleControls.style.display = ['dots', 'grid', 'lines'].includes(pattern) ? '' : 'none';

            _applyPageStyleLive();

            _debouncedSaveSettings();
        });
    });

    // ── Pattern color swatches ──
    container.querySelectorAll('#hb_pattern_color_swatches .hb-swatch').forEach(btn => {
        btn.addEventListener('click', () => {
            container.querySelectorAll('#hb_pattern_color_swatches .hb-swatch').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            ensurePatternStyle();
            target.patternStyle.color = btn.dataset.color;
            _applyPageStyleLive();
            _debouncedSaveSettings();
        });
    });

    document.getElementById('hb_pattern_color_picker')?.addEventListener('input', (e) => {
        container.querySelectorAll('#hb_pattern_color_swatches .hb-swatch').forEach(b => b.classList.remove('selected'));
        ensurePatternStyle();
        target.patternStyle.color = e.target.value;
        _applyPageStyleLive();
        _debouncedSaveSettings();
    });

    // ── Style sliders ──
    const sliderMap = {
        hb_slider_opacity: { key: 'opacity', valId: 'hb_val_opacity', fmt: v => parseFloat(v).toFixed(2) },
        hb_slider_size:    { key: 'size',    valId: 'hb_val_size',    fmt: v => `${v}px` },
        hb_slider_spacing: { key: 'spacing', valId: 'hb_val_spacing', fmt: v => `${v}px` },
    };

    for (const [sliderId, cfg] of Object.entries(sliderMap)) {
        const slider = document.getElementById(sliderId);
        if (!slider) continue;
        slider.addEventListener('input', () => {
            const val = parseFloat(slider.value);
            ensurePatternStyle();
            target.patternStyle[cfg.key] = val;
            const valLabel = document.getElementById(cfg.valId);
            if (valLabel) valLabel.textContent = cfg.fmt(val);
            _applyPageStyleLive();
            _debouncedSaveSettings();
        });
    }

    // ── BG upload trigger & Gallery actions ──
    document.getElementById('hb_bg_upload_trigger')?.addEventListener('click', () => {
        document.getElementById('hb_bg_file_input')?.click();
    });

    container.querySelectorAll('.hb-bg-item[data-bg]').forEach(item => {
        item.addEventListener('click', (e) => {
            // Delete action
            if (e.target.closest('.hb-bg-item-delete')) {
                e.stopPropagation();
                const bgId = item.dataset.bg;
                if (!confirm('确定删除此背景吗？此操作不会影响已经应用此背景的页面，但将无法再次选中它。')) return;
                
                // Remove logically
                AppState.meta.customBackgrounds = AppState.meta.customBackgrounds.filter(bg => bg.id !== bgId);
                _debouncedSaveSettings();
                
                // Re-render settings tab visually immediately
                _renderSettingsTab(document.getElementById('hb_menu_body_settings'));
                return;
            }
            
            // Select action
            container.querySelectorAll('.hb-bg-item').forEach(b => b.classList.remove('selected'));
            item.classList.add('selected');
            const bgId = item.dataset.bg;
            if (target === AppState.meta.settings) {
                target.customBgId = bgId;
            } else {
                target.customBgId = bgId;
            }
            _applyPageStyleLive();
            _debouncedSaveSettings();
        });
    });
}

export async function _onBgFileSelected(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
        const bgId = 'bg_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
        const stHeaders = AppState.initData.stRequestHeaders || {};
        
        await uploadCustomBg(file, AppState.charId, bgId, stHeaders);
        const url = await loadCustomBg(AppState.charId, bgId, stHeaders);
        
        if (url) AppState.bgImageCache.set(bgId, url);
        if (!AppState.meta.customBackgrounds) AppState.meta.customBackgrounds = [];
        AppState.meta.customBackgrounds.push({ id: bgId });

        // Apply setting
        const page = _getCurrentPageObj();
        let target = page || AppState.meta.settings;
        if (target === AppState.meta.settings) {
            target.pagePattern = 'custom';
        } else {
            target.pattern = 'custom';
        }
        target.customBgId = bgId;
        
        await saveHandbookMeta(AppState.meta, AppState.charId, stHeaders);

        // Re-render settings tab block if visible to show new thumbnail
        _renderSettingsTab(document.getElementById('hb_menu_body_settings'));
        _applyPageStyleLive();

        console.log(`${LOG} Custom background uploaded`);
    } catch (err) {
        console.error(`${LOG} BG upload failed:`, err);
        alert('背景上传失败: ' + err.message);
    }
    e.target.value = '';
}
