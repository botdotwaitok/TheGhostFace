import { BRUSH_TYPES, SHAPE_TYPES, COVER_PRESETS } from './handbookConstants.js';
import { A4_WIDTH, A4_HEIGHT, initCanvas, renderTextOnCanvas, setInkColor, setLineWidth, setBrushType, getBrushType, setEraserMode, isEraserMode, setEraserSize, setActiveMode, getActiveMode, setShapeType, getShapeType, setDashEnabled, isDashEnabled, setTextPlacementCallback, getEraserSize, setPencilOnlyMode, isPencilOnlyMode, setOnStrokeEndCallback, undo, redo, clearCanvas, hasContent, exportAsDataUrl, loadFromDataUrl, getInkColor, getLineWidth, setFillColor, getFillColor } from './handbookCanvas.js';
import { uploadCanvasPage, uploadResponseData, saveHandbookMeta, loadHandbookMeta, loadHandbookPage, loadHandbookResponse, createEmptyMeta, nextPageId, uploadCoverImage, loadCoverImage, uploadFlyleafCanvas, loadFlyleafCanvas, uploadCustomBg, loadCustomBg, uploadSticker, loadStickerImage, deleteSticker } from './handbookStorage.js';
import { callHandbookLLM, buildHandbookSystemPrompt, buildHandbookUserPrompt, parseHandbookResponse, migrateOldResponse } from './handbookGeneration.js';
import { AppState } from './handbookState.js';
import { _selectColor, _addRecentColor, _renderToolbarColors, _setToolMode, _updateToolButtonStates, _showTextInputOverlay, _initCursorPreview, _updateCursorSize } from './handbookToolbarUI.js';
import { _renderCover, _renderCoverEditor, _onCoverFileSelected } from './handbookCoverUI.js';
import { _renderFlyleaf, _autoSaveFlyleafCanvas } from './handbookFlyleafUI.js';
import { _renderDiaryPage, _cancelPendingAutoSave, _setDiaryAutoSaveLock } from './handbookDiaryUI.js';
import { _toggleMenu, _toggleTocPanel, _closeTocPanel, isTocPanelOpen, _updateTocFabVisibility, _renderTocPanel, _updateTocActive, _invalidateMenuSections, _renderMenuSection, _onBgFileSelected, _renderSearchTab } from './handbookNavigationUI.js';
import { _onStickerFileSelected, _onTapeFileSelected, _placeResponseNote, _saveStickerPositions, preloadStickerImages } from './handbookInteractables.js';

// modules/phone/handbook/handbookEngine.js — Standalone Window Core Engine (Phase 2)
// View state machine: cover → flyleaf → diary pages → new page
// Bottom menu with tabs: TOC, Search, Cover Edit, Console
// Heart button for triggering LLM responses

export const LOG = '[HandBook Engine]';
export const CHANNEL_NAME = 'gf-handbook-bridge';

// (State moved to handbookState.js — all fields initialized there)

// ═══════════════════════════════════════════════════════════════════════
// Boot — Entry Point
// ═══════════════════════════════════════════════════════════════════════

export async function boot() {
    _setupConsoleCapture();
    console.log(`${LOG} Booting handbook engine (Phase 3B)...`);
    _showInitScreen();

    try {
        AppState.channel = new BroadcastChannel(CHANNEL_NAME);
        AppState.channel.onmessage = _onChannelMessage;
        console.log(`${LOG} BroadcastChannel connected`);
    } catch (e) {
        _showError('BroadcastChannel not available.');
        return;
    }

    const initTimeout = setTimeout(() => {
        if (!AppState.initData) _showError('No response from SillyTavern. Make sure the phone is open.');
    }, 10_000);

    AppState.channel.postMessage({ type: 'requestInit' });

    await new Promise((resolve) => {
        const check = setInterval(() => {
            if (AppState.initData) { clearInterval(check); clearTimeout(initTimeout); resolve(); }
        }, 100);
    });

    console.log(`${LOG} Init data received:`, AppState.initData.charInfo?.name);
    AppState.charId = AppState.initData.charInfo?.name?.replace(/[^a-zA-Z0-9_-]/g, '_')?.replace(/_+/g, '_')?.replace(/^_|_$/g, '') || 'unknown';

    const stHeaders = AppState.initData.stRequestHeaders || {};
    AppState.meta = await loadHandbookMeta(AppState.charId, stHeaders);
    if (!AppState.meta) {
        AppState.meta = createEmptyMeta(AppState.charId, AppState.initData.charInfo?.name || 'Character', AppState.initData.userName || 'User');
        // Ensure cover/flyleaf exist for old data
        if (!AppState.meta.cover) AppState.meta.cover = { type: 'color', color: '#2c3e50', texts: [] };
        if (!AppState.meta.flyleaf) AppState.meta.flyleaf = { ownerName: '', charMessage: '' };
        console.log(`${LOG} Created new handbook for ${AppState.charId}`);
    } else {
        // Migrate v1 meta
        if (!AppState.meta.cover) AppState.meta.cover = { type: 'color', color: '#2c3e50', texts: [] };
        if (!AppState.meta.flyleaf) AppState.meta.flyleaf = { ownerName: '', charMessage: '' };
        if (!AppState.meta.stickers) AppState.meta.stickers = [];
        console.log(`${LOG} Loaded existing handbook: ${AppState.meta.pages.length} pages`);
    }

    // Phase 4 Cover Migration
    if (!AppState.meta.cover.texts) {
        AppState.meta.cover.texts = [];
        if (AppState.meta.cover.title) {
            AppState.meta.cover.texts.push({
                id: 'txt_' + Date.now().toString(36),
                text: AppState.meta.cover.title,
                x: 120, y: 300,
                color: '#ffffff',
                fontSize: 32,
                fontFamily: "'Inter', 'Noto Sans SC', sans-serif",
                bold: true, italic: false, align: 'center',
                textStyle: AppState.meta.cover.textStyle || 'glass'
            });
            delete AppState.meta.cover.title;
        }
        if (AppState.meta.cover.subtitle !== undefined) {
            if (AppState.meta.cover.subtitle.trim()) {
                AppState.meta.cover.texts.push({
                    id: 'txt_' + (Date.now() + 1).toString(36),
                    text: AppState.meta.cover.subtitle,
                    x: 120, y: 380,
                    color: '#ffffff',
                    fontSize: 16,
                    fontFamily: "'Inter', 'Noto Sans SC', sans-serif",
                    bold: false, italic: false, align: 'center',
                    textStyle: 'plain'
                });
            }
            delete AppState.meta.cover.subtitle;
        }
    }
    if (AppState.meta.cover.color === undefined) {
        if (typeof AppState.meta.cover.presetIndex === 'number') {
            AppState.meta.cover.color = COVER_PRESETS[AppState.meta.cover.presetIndex]?.color || '#2c3e50';
            delete AppState.meta.cover.presetIndex;
        } else {
            AppState.meta.cover.color = '#2c3e50';
        }
    }

    // Load cover image if type is 'image'
    if (AppState.meta.cover.type === 'image') {
        AppState.coverImageUrl = await loadCoverImage(AppState.charId, stHeaders);
    }

    // Phase 4 Background Gallery Migration
    if (!Array.isArray(AppState.meta.customBackgrounds)) {
        AppState.meta.customBackgrounds = [];
        // Attempt to migrate legacy single custom background
        try {
            const oldBgUrl = await loadCustomBg(AppState.charId, 'custom', stHeaders);
            if (oldBgUrl) {
                AppState.meta.customBackgrounds.push({ id: 'custom' });
                // If current global settings use it, map it to the old 'custom' ID
                if (AppState.meta.settings?.pagePattern === 'custom' && !AppState.meta.settings.customBgId) {
                    AppState.meta.settings.customBgId = 'custom';
                }
            }
        } catch (e) { }
    }

    // Load custom backgrounds into cache
    const bgLoadPromises = AppState.meta.customBackgrounds.map(async (bg) => {
        try {
            const url = await loadCustomBg(AppState.charId, bg.id, stHeaders);
            if (url) AppState.bgImageCache.set(bg.id, url);
        } catch (e) {
            console.warn(`${LOG} Failed to load custom background ${bg.id}`, e);
        }
    });
    await Promise.all(bgLoadPromises);

    document.title = `手账本 — ${AppState.initData.charInfo?.name || 'Character'}`;

    // Decide initial view
    const isFirstTime = AppState.meta.pages.length === 0 && !AppState.meta.cover._saved;
    if (isFirstTime) {
        AppState.currentView = 'coverEditor';
    } else {
        // Restore last view
        if (AppState.meta.lastView && ['cover', 'flyleaf', 'diary'].includes(AppState.meta.lastView)) {
            AppState.currentView = AppState.meta.lastView;
            if (AppState.currentView === 'diary') {
                AppState.currentDiaryIndex = typeof AppState.meta.lastDiaryIndex === 'number' ? AppState.meta.lastDiaryIndex : -1;
                // Validate index
                if (AppState.currentDiaryIndex >= AppState.meta.pages.length) {
                    AppState.currentDiaryIndex = AppState.meta.pages.length - 1;
                }
            }
        } else {
            AppState.currentView = 'cover';
        }
    }

    // Fire-and-forget sticker preload (P2 optimization)
    preloadStickerImages().catch(err => console.warn(`${LOG} Sticker preload failed:`, err));

    _renderApp();
}

// ═══════════════════════════════════════════════════════════════════════
// BroadcastChannel Client
// ═══════════════════════════════════════════════════════════════════════

function _onChannelMessage(event) {
    const data = event.data;
    if (data.type === 'init') { AppState.initData = data.payload; return; }
    if (data.id && AppState.pendingRpcCallbacks.has(data.id)) {
        const { resolve, reject } = AppState.pendingRpcCallbacks.get(data.id);
        AppState.pendingRpcCallbacks.delete(data.id);
        if (data.error) reject(new Error(data.error)); else resolve(data.result);
    }
}

async function callBridge(method, args = []) {
    return new Promise((resolve, reject) => {
        const id = `hb_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
        AppState.pendingRpcCallbacks.set(id, { resolve, reject });
        setTimeout(() => {
            if (AppState.pendingRpcCallbacks.has(id)) {
                AppState.pendingRpcCallbacks.delete(id);
                reject(new Error(`RPC timeout: ${method}`));
            }
        }, 30_000);
        AppState.channel.postMessage({ id, method, args });
    });
}

// ═══════════════════════════════════════════════════════════════════════
// App Layout — Main Render
// ═══════════════════════════════════════════════════════════════════════

function _renderApp() {
    const container = document.getElementById('hb-app');
    if (!container) return;

    const charName = AppState.initData.charInfo?.name || 'Character';
    const pattern = AppState.meta.settings?.pagePattern || 'dots';

    container.innerHTML = `
        <!-- Top Toolbar -->
        <div class="hb-toolbar" id="hb_toolbar" style="display:none">
            <div class="hb-toolbar-left">
                <!-- TOC toggle button -->
                <button class="hb-tool-btn hb-toc-toolbar-btn" id="hb_toc_toolbar_btn" title="目录">
                    <i class="ph ph-list-bullets"></i>
                </button>
                <div class="hb-toolbar-divider"></div>
                <!-- Pen Box: single button that expands to show brush types -->
                <div class="hb-pen-box-wrapper" style="position:relative">
                    <button class="hb-tool-btn hb-pen-box-btn active" id="hb_pen_box_btn" title="画笔">
                        <i class="ph ${BRUSH_TYPES[0].icon}"></i>
                    </button>
                    <div class="hb-pen-popover" id="hb_pen_popover">
                        ${BRUSH_TYPES.map(b => `
                            <button class="hb-pen-option ${b.id === 'pen' ? 'selected' : ''}"
                                    data-brush="${b.id}" title="${b.label}">
                                <span>${b.label}</span>
                            </button>
                        `).join('')}
                    </div>
                </div>
                <!-- Shape tool -->
                <div class="hb-shape-wrapper" style="position:relative">
                    <button class="hb-tool-btn" id="hb_shape_btn" title="形状">
                        <i class="ph ph-shapes"></i>
                    </button>
                    <div class="hb-shape-popover" id="hb_shape_popover">
                        <div class="hb-shape-grid">
                            ${SHAPE_TYPES.map(s => `
                                <button class="hb-shape-option ${s.id === 'rectangle' ? 'selected' : ''}"
                                        data-shape="${s.id}" title="${s.label}">
                                    <i class="ph ${s.icon}"></i>
                                    <span>${s.label}</span>
                                </button>
                            `).join('')}
                        </div>
                        <div class="hb-shape-settings">
                            <label class="hb-shape-fill-label" title="开启填充效果">
                                <span>开启填充</span>
                                <input type="checkbox" id="hb_shape_fill_toggle">
                            </label>
                            <label class="hb-shape-fill-color-row disabled" id="hb_shape_fill_color_row">
                                <span>填充颜色</span>
                                <div class="hb-custom-color-wrapper" style="width:24px;height:24px;border-radius:4px;position:relative;">
                                    <button class="hb-color-btn" id="hb_shape_fill_color_btn" style="background:#ffffff; width:24px; height:24px; padding:0; border: 1px solid var(--hb-toolbar-border); border-radius:4px;" title="选择颜色"></button>
                                    <input type="color" id="hb_shape_fill_color_picker" value="#ffffff" style="position:absolute; inset:0; opacity:0; width:100%; height:100%; cursor:pointer;">
                                </div>
                            </label>
                        </div>
                    </div>
                </div>
                <!-- Dash toggle -->
                <button class="hb-tool-btn" id="hb_dash_btn" title="虚线">
                    <i class="ph ph-line-segments"></i>
                </button>
                <!-- Tape tool -->
                <button class="hb-tool-btn" id="hb_tape_btn" title="胶带">
                    <i class="ph ph-intersect"></i>
                </button>
                <!-- Text tool -->
                <button class="hb-tool-btn" id="hb_text_btn" title="文字">
                    <i class="ph ph-text-t"></i>
                </button>
                <!-- Eraser (grouped with drawing tools) -->
                <div class="hb-eraser-wrapper" style="position:relative">
                    <button class="hb-tool-btn" id="hb_eraser_btn" title="橡皮擦">
                        <i class="ph ph-eraser"></i>
                    </button>
                    <div class="hb-eraser-popover" id="hb_eraser_popover">
                        <label>大小</label>
                        <input type="range" id="hb_eraser_size_slider" min="2" max="100" value="10">
                        <span class="hb-eraser-size-val" id="hb_eraser_size_val">10</span>
                    </div>
                </div>
            </div>
            <div class="hb-toolbar-center">
                <div class="hb-color-slots" id="hb_color_slots" style="display:flex;gap:4px;"></div>
                <div class="hb-custom-color-wrapper" style="position:relative;display:inline-block;">
                    <button class="hb-color-btn hb-color-custom-btn" id="hb_custom_color_btn_visual" title="自定义颜色" style="position:relative;z-index:1;">
                        <i class="ph ph-palette"></i>
                    </button>
                    <input type="color" id="hb_custom_color_picker" style="position:absolute; inset:0; opacity:0; width:100%; height:100%; cursor:pointer; z-index:2;">
                </div>
                <input type="range" class="hb-width-slider" id="hb_width_slider"
                       min="1" max="30" value="3" title="粗细">
            </div>
            <div class="hb-toolbar-right">
                <button class="hb-tool-btn" id="hb_undo_btn" title="撤销">
                    <i class="ph ph-arrow-counter-clockwise"></i>
                </button>
                <button class="hb-tool-btn" id="hb_redo_btn" title="重做">
                    <i class="ph ph-arrow-clockwise"></i>
                </button>
                <button class="hb-tool-btn" id="hb_clear_btn" title="清空画布">
                    <i class="ph ph-trash"></i>
                </button>
                <button class="hb-tool-btn" id="hb_pencil_only_btn" title="仅 Apple Pencil 绘画">
                    <i class="ph ph-hand"></i>
                </button>
                <button class="hb-tool-btn" id="hb_new_page_btn" title="新建页面">
                    <i class="ph ph-file-plus"></i>
                </button>
                <button class="hb-tool-btn" id="hb_download_btn" title="保存为图片">
                    <i class="ph ph-download-simple"></i>
                </button>
                <div class="hb-toolbar-divider"></div>
                <button class="hb-heart-btn" id="hb_heart_btn">
                    <i class="ph ph-heart"></i>
                </button>
                <button class="hb-tool-btn hb-menu-toggle-btn" id="hb_menu_btn" title="菜单">
                    <i class="ph ph-gear-six"></i>
                </button>
            </div>
        </div>

        <!-- Floating FAB buttons (visible on cover/non-toolbar views) -->
        <button class="hb-toc-fab" id="hb_toc_fab" title="目录">
            <i class="ph ph-list-bullets"></i>
        </button>
        <button class="hb-menu-fab" id="hb_menu_fab" title="菜单">
            <i class="ph ph-gear-six"></i>
        </button>

        <!-- TOC Overlay -->
        <div class="hb-toc-overlay" id="hb_toc_overlay">
            <div class="hb-toc-panel" id="hb_toc_panel">
                <div class="hb-toc-panel-header">
                    <span class="hb-toc-panel-title">目录</span>
                    <button class="hb-toc-panel-close" id="hb_toc_close">
                        <i class="ph ph-x"></i>
                    </button>
                </div>
                <div class="hb-toc-search-container" id="hb_toc_search_container" style="padding: 10px 16px 0;"></div>
                <div class="hb-toc-panel-fixed" id="hb_toc_panel_fixed"></div>
                <div class="hb-toc-panel-pages" id="hb_toc_panel_pages"></div>
                <div class="hb-toc-panel-footer">
                    <button class="hb-toc-panel-new-btn" id="hb_toc_new_btn">
                        <i class="ph ph-plus"></i>
                        <span>新建页面</span>
                    </button>
                </div>
            </div>
        </div>

        <!-- Content Area -->
        <div class="hb-content-area" id="hb_content_area"></div>

        <!-- Dynamic canvas cursor preview -->
        <div class="hb-canvas-cursor" id="hb_canvas_cursor"></div>

        <!-- Menu Overlay (right side slide-in) -->
        <div class="hb-menu-overlay" id="hb_menu_overlay">
            <div class="hb-menu-panel" id="hb_menu_panel">
                <div class="hb-menu-panel-header">
                    <span class="hb-menu-panel-title">工具</span>
                    <button class="hb-menu-panel-close" id="hb_menu_close">
                        <i class="ph ph-x"></i>
                    </button>
                </div>
                <div class="hb-menu-sections" id="hb_menu_sections">
                    <details class="hb-menu-section" data-tab="stickers">
                        <summary class="hb-menu-section-header">
                            <i class="ph ph-sticker"></i>
                            <span>贴纸</span>
                            <i class="ph ph-caret-down hb-menu-section-chevron"></i>
                        </summary>
                        <div class="hb-menu-section-body" id="hb_menu_body_stickers"></div>
                    </details>
                    <details class="hb-menu-section" data-tab="tapes">
                        <summary class="hb-menu-section-header">
                            <i class="ph ph-intersect"></i>
                            <span>胶带</span>
                            <i class="ph ph-caret-down hb-menu-section-chevron"></i>
                        </summary>
                        <div class="hb-menu-section-body" id="hb_menu_body_tapes"></div>
                    </details>
                    <details class="hb-menu-section" data-tab="cover-edit">
                        <summary class="hb-menu-section-header">
                            <i class="ph ph-image"></i>
                            <span>封面</span>
                            <i class="ph ph-caret-down hb-menu-section-chevron"></i>
                        </summary>
                        <div class="hb-menu-section-body" id="hb_menu_body_cover"></div>
                    </details>
                    <details class="hb-menu-section" data-tab="settings">
                        <summary class="hb-menu-section-header">
                            <i class="ph ph-paint-brush"></i>
                            <span>页面样式</span>
                            <i class="ph ph-caret-down hb-menu-section-chevron"></i>
                        </summary>
                        <div class="hb-menu-section-body" id="hb_menu_body_settings"></div>
                    </details>
                    <details class="hb-menu-section" data-tab="console">
                        <summary class="hb-menu-section-header">
                            <i class="ph ph-terminal"></i>
                            <span>Console</span>
                            <i class="ph ph-caret-down hb-menu-section-chevron"></i>
                        </summary>
                        <div class="hb-menu-section-body" id="hb_menu_body_console"></div>
                    </details>
                </div>
            </div>
        </div>

        <!-- Loading Overlay -->
        <div class="hb-loading-overlay" id="hb_loading">
            <div class="hb-loading-content">
                <div class="hb-loading-icon"><i class="ph ph-pen-nib"></i></div>
                <div class="hb-loading-text">${charName}正在写回应…</div>
                <div class="hb-loading-dots"><span>.</span><span>.</span><span>.</span></div>
            </div>
        </div>

        <!-- Hidden file input for cover upload -->
        <input type="file" id="hb_cover_file_input" accept="image/*" style="display:none">
        <!-- Hidden file input for custom bg upload -->
        <input type="file" id="hb_bg_file_input" accept="image/*" style="display:none">
        <!-- Hidden file input for sticker upload -->
        <input type="file" id="hb_sticker_file_input" accept="image/png,image/webp,image/jpeg,image/gif" style="display:none">
        <!-- Hidden file input for tape upload -->
        <input type="file" id="hb_tape_file_input" accept="image/png,image/webp,image/jpeg,image/gif" style="display:none">
    `;

    _bindGlobalEvents();
    _initResponsiveScaling();
    _initCursorPreview();
    _renderSearchTab(document.getElementById('hb_toc_search_container'));
    _renderTocPanel();
    _updateTocFabVisibility();
    _switchToView(AppState.currentView);
}

// ═══════════════════════════════════════════════════════════════════════
// Global Event Binding & Responsive Engine
// ═══════════════════════════════════════════════════════════════════════

function _initResponsiveScaling() {
    const contentArea = document.getElementById('hb_content_area');
    if (!contentArea || !window.ResizeObserver) return;

    // Base A4 canvas dimensions
    const BASE_WIDTH = 595;
    const BASE_HEIGHT = 870; // 842 + approx footer

    const observer = new ResizeObserver(entries => {
        for (let entry of entries) {
            const { width, height } = entry.contentRect;
            // Fill the available area edge-to-edge — no padding
            let scale = Math.min(
                width / BASE_WIDTH,
                height / BASE_HEIGHT
            );

            // Constrain scale (0.15x ~ 2.5x)
            scale = Math.max(0.15, Math.min(2.5, scale));

            // Set scale as a CSS variable on the wrapper
            // .hb-page-paper inherits it and applies `transform: scale()`
            contentArea.style.setProperty('--hb-scale', scale.toFixed(4));
        }
    });

    observer.observe(contentArea);
}

function _bindGlobalEvents() {
    // Menu button
    document.getElementById('hb_menu_btn')?.addEventListener('click', _toggleMenu);
    document.getElementById('hb_menu_fab')?.addEventListener('click', _toggleMenu);

    // Menu overlay backdrop — click to close
    document.getElementById('hb_menu_overlay')?.addEventListener('click', (e) => {
        if (e.target.id === 'hb_menu_overlay' && AppState.menuOpen) _toggleMenu();
    });

    // Menu close button
    document.getElementById('hb_menu_close')?.addEventListener('click', () => {
        if (AppState.menuOpen) _toggleMenu();
    });

    // Heart button
    document.getElementById('hb_heart_btn')?.addEventListener('click', _handleHeartButton);

    // ── Pen Box: expand/collapse ──
    const penBoxBtn = document.getElementById('hb_pen_box_btn');
    const penPopover = document.getElementById('hb_pen_popover');
    if (penBoxBtn) {
        penBoxBtn.addEventListener('click', () => {
            // Clicking pen box → enter draw mode + toggle popover
            _setToolMode('draw');
            penPopover?.classList.toggle('open');
        });
    }

    // ── Pen options inside popover ──
    document.querySelectorAll('.hb-pen-option').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.hb-pen-option').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            setBrushType(btn.dataset.brush);
            // Update pen box icon to match selected brush
            const icon = btn.querySelector('i');
            if (penBoxBtn && icon) {
                penBoxBtn.querySelector('i').className = icon.className;
            }
            _setToolMode('draw');
            penPopover?.classList.remove('open');
        });
    });

    // ── Shape tool: expand/collapse ──
    const shapeBtn = document.getElementById('hb_shape_btn');
    const shapePopover = document.getElementById('hb_shape_popover');
    if (shapeBtn) {
        shapeBtn.addEventListener('click', () => {
            _setToolMode('shape');
            shapePopover?.classList.toggle('open');
        });
    }

    // ── Shape options inside popover ──
    document.querySelectorAll('.hb-shape-option').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.hb-shape-option').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            setShapeType(btn.dataset.shape);
            // Update shape button icon
            const icon = btn.querySelector('i');
            if (shapeBtn && icon) {
                shapeBtn.querySelector('i').className = icon.className;
            }
            _setToolMode('shape');

            // Do NOT auto-close the popover because user might want to adjust fill color
        });
    });

    // ── Shape Fill Options ──
    const shapeFillToggle = document.getElementById('hb_shape_fill_toggle');
    const shapeFillColorRow = document.getElementById('hb_shape_fill_color_row');
    const shapeFillColorBtn = document.getElementById('hb_shape_fill_color_btn');
    const shapeFillColorPicker = document.getElementById('hb_shape_fill_color_picker');

    if (shapeFillToggle) {
        shapeFillToggle.addEventListener('change', (e) => {
            if (e.target.checked) {
                shapeFillColorRow?.classList.remove('disabled');
                setFillColor(shapeFillColorPicker?.value || '#ffffff');
            } else {
                shapeFillColorRow?.classList.add('disabled');
                setFillColor('transparent');
            }
            _setToolMode('shape');
        });
    }

    if (shapeFillColorPicker) {
        shapeFillColorPicker.addEventListener('input', (e) => {
            if (shapeFillColorBtn) shapeFillColorBtn.style.background = e.target.value;
            if (shapeFillToggle?.checked) {
                setFillColor(e.target.value);
            }
            _setToolMode('shape');
        });
        shapeFillColorPicker.addEventListener('change', (e) => {
            _addRecentColor(e.target.value);
        });
    }

    // ── Dash toggle ──
    const dashBtn = document.getElementById('hb_dash_btn');
    if (dashBtn) {
        dashBtn.addEventListener('click', () => {
            setDashEnabled(!isDashEnabled());
            dashBtn.classList.toggle('active', isDashEnabled());
        });
    }

    // ── Tape tool ──
    const tapeBtn = document.getElementById('hb_tape_btn');
    if (tapeBtn) {
        tapeBtn.addEventListener('click', () => {
            if (!AppState.activeTapeId) {
                // If no tape selected, open the tapes tab
                document.getElementById('hb_menu_btn')?.click();
                const tapeSection = document.querySelector('.hb-menu-section[data-tab="tapes"]');
                if (tapeSection && !tapeSection.open) {
                    tapeSection.open = true;
                }
            } else {
                _setToolMode('tape');
            }
        });
    }

    // ── Text tool ──
    const textBtn = document.getElementById('hb_text_btn');
    if (textBtn) {
        textBtn.addEventListener('click', () => {
            _setToolMode('text');
        });
    }

    // Set up text placement callback
    setTextPlacementCallback((x, y) => {
        _showTextInputOverlay(x, y);
    });

    // ── Color buttons (dynamic recent colors) ──
    _renderToolbarColors();

    // ── Custom color picker (native) ──
    const customColorInput = document.getElementById('hb_custom_color_picker');
    if (customColorInput) {
        customColorInput.addEventListener('input', (e) => {
            _selectColor(e.target.value);
        });
        customColorInput.addEventListener('change', (e) => {
            _addRecentColor(e.target.value);
        });
    }

    // ── Width slider ──
    const slider = document.getElementById('hb_width_slider');
    if (slider) slider.addEventListener('input', (e) => {
        setLineWidth(parseInt(e.target.value));
        _updateCursorSize();
    });

    // ── Eraser ──
    const eraserBtn = document.getElementById('hb_eraser_btn');
    const eraserPopover = document.getElementById('hb_eraser_popover');
    if (eraserBtn) {
        eraserBtn.addEventListener('click', () => {
            if (isEraserMode()) {
                // Turn off eraser → go back to draw
                _setToolMode('draw');
                eraserPopover?.classList.remove('open');
            } else {
                // Turn on eraser
                setActiveMode('draw');
                setEraserMode(true);
                _updateToolButtonStates();
                eraserPopover?.classList.add('open');
            }
        });
    }

    // Eraser size slider
    const eraserSlider = document.getElementById('hb_eraser_size_slider');
    if (eraserSlider) {
        eraserSlider.addEventListener('input', (e) => {
            const val = parseInt(e.target.value);
            setEraserSize(val);
            const valLabel = document.getElementById('hb_eraser_size_val');
            if (valLabel) valLabel.textContent = val;
            _updateCursorSize();
        });
    }

    // Close popovers when clicking outside
    document.addEventListener('pointerdown', (e) => {
        if (penPopover?.classList.contains('open') && !e.target.closest('.hb-pen-box-wrapper')) {
            penPopover.classList.remove('open');
        }
        if (shapePopover?.classList.contains('open') && !e.target.closest('.hb-shape-wrapper')) {
            shapePopover.classList.remove('open');
        }
        if (eraserPopover?.classList.contains('open') && !e.target.closest('.hb-eraser-wrapper')) {
            eraserPopover.classList.remove('open');
        }
    });

    document.getElementById('hb_undo_btn')?.addEventListener('click', () => undo());
    document.getElementById('hb_redo_btn')?.addEventListener('click', () => redo());
    document.getElementById('hb_clear_btn')?.addEventListener('click', () => {
        if (confirm('清空当前画布？')) clearCanvas();
    });

    // ── Pencil-only toggle ──
    const pencilOnlyBtn = document.getElementById('hb_pencil_only_btn');
    if (pencilOnlyBtn) {
        pencilOnlyBtn.addEventListener('click', () => {
            setPencilOnlyMode(!isPencilOnlyMode());
            pencilOnlyBtn.classList.toggle('active', isPencilOnlyMode());
        });
    }

    // ── Download as Image ──
    document.getElementById('hb_download_btn')?.addEventListener('click', async () => {
        const btn = document.getElementById('hb_download_btn');
        const contentArea = document.querySelector('.hb-page-paper');

        if (!contentArea) {
            alert('请在有效页面视图中使用此功能。');
            return;
        }

        const oldIcon = btn.innerHTML;
        btn.innerHTML = '<i class="ph ph-spinner-gap ph-spin"></i>';
        btn.disabled = true;

        try {
            if (typeof window.html2canvas === 'undefined') {
                await new Promise((resolve, reject) => {
                    const script = document.createElement('script');
                    script.src = 'https://unpkg.com/html2canvas@1.4.1/dist/html2canvas.min.js';
                    script.onload = resolve;
                    script.onerror = () => reject(new Error('无法加载 html2canvas'));
                    document.head.appendChild(script);
                });
            }

            const cursor = document.getElementById('hb_canvas_cursor');
            if (cursor) cursor.style.display = 'none';

            let generatedPatternDataUrl = null;
            let bgSizeStr = null;

            function _getPatternParams() {
                const s = AppState.meta.settings || {};
                let pageObj = null;
                if (AppState.currentView === 'flyleaf') pageObj = AppState.meta.flyleaf || {};
                else if (AppState.currentView === 'diary' && AppState.currentDiaryIndex >= 0) {
                    pageObj = AppState.meta.pages[AppState.currentDiaryIndex];
                }

                const target = pageObj || s;
                const currentPattern = target === s ? (s.pagePattern || 'dots') : pageObj.pattern;
                const pageColor = target === s ? (s.pageColor || '#fefcf7') : pageObj.pageColor;

                const globalPs = s.patternStyle || {};
                const pagePs = pageObj ? (pageObj.patternStyle || {}) : {};
                const pColor = (target === pageObj ? pagePs.color : undefined) ?? globalPs.color ?? '#b4aa96';
                const pOpacity = (target === pageObj ? pagePs.opacity : undefined) ?? globalPs.opacity ?? 0.4;
                const pSize = (target === pageObj ? pagePs.size : undefined) ?? globalPs.size ?? 1.5;
                const pSpacing = (target === pageObj ? pagePs.spacing : undefined) ?? globalPs.spacing ?? 20;

                return { pattern: currentPattern, color: pColor, opacity: pOpacity, size: pSize, spacing: pSpacing, pageColor };
            }

            const pParams = _getPatternParams();
            if (['dots', 'grid', 'lines'].includes(pParams.pattern)) {
                const c = document.createElement('canvas');
                const spacing = pParams.spacing;
                const size = pParams.size;
                c.width = spacing;
                c.height = spacing;
                const ctx = c.getContext('2d');

                const h = pParams.color.replace('#', '');
                const r = parseInt(h.substring(0, 2), 16);
                const g = parseInt(h.substring(2, 4), 16);
                const b = parseInt(h.substring(4, 6), 16);
                ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${pParams.opacity})`;

                if (pParams.pattern === 'dots') {
                    ctx.beginPath();
                    ctx.arc(spacing / 2, spacing / 2, size, 0, Math.PI * 2);
                    ctx.fill();
                } else if (pParams.pattern === 'grid') {
                    ctx.fillRect(0, 0, spacing, size);
                    ctx.fillRect(0, 0, size, spacing);
                } else if (pParams.pattern === 'lines') {
                    ctx.fillRect(0, spacing - size, spacing, size);
                }

                bgSizeStr = `${spacing}px ${spacing}px`;
                generatedPatternDataUrl = c.toDataURL('image/png');
            }

            const canvas = await window.html2canvas(contentArea, {
                backgroundColor: null,
                useCORS: true,
                scale: 2,
                logging: false,
                onclone: (clonedDoc) => {
                    const el = clonedDoc.querySelector('.hb-page-paper');
                    if (el) {
                        el.style.transform = 'none';
                        if (generatedPatternDataUrl) {
                            el.style.backgroundImage = `url("${generatedPatternDataUrl}")`;
                            el.style.backgroundSize = bgSizeStr;
                        }
                    }
                },
                ignoreElements: (node) => node.classList?.contains('hb-text-input-overlay')
            });

            if (cursor) cursor.style.display = '';

            const dataUrl = canvas.toDataURL('image/png');
            const link = document.createElement('a');

            const charName = AppState.initData?.charInfo?.name || 'Character';
            const dateStr = new Date().toISOString().split('T')[0];
            let pageNum = 'Cover';
            if (AppState.currentView === 'diary') pageNum = `Page${AppState.currentDiaryIndex + 1}`;
            else if (AppState.currentView === 'flyleaf') pageNum = 'Flyleaf';

            link.download = `Handbook_${charName}_${pageNum}_${dateStr}.png`;
            link.href = dataUrl;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

        } catch (e) {
            console.error(LOG, 'Download failed:', e);
            alert('保存图片失败，请重试。\\n' + e.message);
        } finally {
            btn.innerHTML = oldIcon;
            btn.disabled = false;
        }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey || e.metaKey) {
            if (e.key === 'z') { e.preventDefault(); undo(); }
            if (e.key === 'y' || (e.shiftKey && e.key === 'z')) { e.preventDefault(); redo(); }
        }
    });

    // Menu sections (accordion)
    document.querySelectorAll('.hb-menu-section').forEach(section => {
        section.addEventListener('toggle', () => {
            if (section.open) {
                AppState.activeTab = section.dataset.tab;
                _renderMenuSection(AppState.activeTab);
            }
        });
    });

    // Cover file input
    document.getElementById('hb_cover_file_input')?.addEventListener('change', _onCoverFileSelected);

    // ── Sticker / BG / Tape file inputs ──
    document.getElementById('hb_sticker_file_input')?.addEventListener('change', _onStickerFileSelected);
    document.getElementById('hb_bg_file_input')?.addEventListener('change', _onBgFileSelected);
    document.getElementById('hb_tape_file_input')?.addEventListener('change', _onTapeFileSelected);

    // (Old Color Palette Overlay events removed — UI no longer exists)

    // New page button (toolbar)
    document.getElementById('hb_new_page_btn')?.addEventListener('click', () => {
        AppState.currentDiaryIndex = -1;
        _switchToView('diary', 1);
    });

    // ── TOC Panel events ──
    document.getElementById('hb_toc_toolbar_btn')?.addEventListener('click', _toggleTocPanel);
    document.getElementById('hb_toc_fab')?.addEventListener('click', _toggleTocPanel);
    document.getElementById('hb_toc_close')?.addEventListener('click', _closeTocPanel);
    document.getElementById('hb_toc_overlay')?.addEventListener('click', (e) => {
        if (e.target.id === 'hb_toc_overlay') _closeTocPanel();
    });
    document.getElementById('hb_toc_new_btn')?.addEventListener('click', () => {
        AppState.currentDiaryIndex = -1;
        _closeTocPanel();
        _switchToView('diary', 1);
    });

    // Escape key to close overlays (menu first, then TOC)
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (AppState.menuOpen) { e.preventDefault(); _toggleMenu(); }
            else if (isTocPanelOpen()) { e.preventDefault(); _closeTocPanel(); }
        }
    });
}

// ═══════════════════════════════════════════════════════════════════════
// View State Machine
// ═══════════════════════════════════════════════════════════════════════

export async function _switchToView(newView, direction) {
    const contentArea = document.getElementById('hb_content_area');
    const toolbar = document.getElementById('hb_toolbar');
    if (!contentArea) return;

    // Cache previous index for sticker save comparison
    const prevDiaryIndex = AppState.currentDiaryIndex;

    // Save current canvas before switching (flyleaf auto-save)
    if (AppState.currentView === 'flyleaf' && newView !== 'flyleaf') {
        await _autoSaveFlyleafCanvas();
    }

    // Save sticker positions before leaving diary (Fix #3: was self-comparing)
    if (AppState.currentView === 'diary' && (newView !== 'diary' || prevDiaryIndex !== AppState.currentDiaryIndex)) {
        _saveStickerPositions();
    }

    AppState.currentView = newView;
    AppState.selectedSticker = null;

    // Invalidate menu section caches so they re-render for new page context
    _invalidateMenuSections();

    // Save last view to meta
    AppState.meta.lastView = AppState.currentView;
    if (AppState.currentView === 'diary') {
        AppState.meta.lastDiaryIndex = AppState.currentDiaryIndex;
    }
    clearTimeout(_switchToView._timer);
    _switchToView._timer = setTimeout(async () => {
        try {
            const stHeaders = AppState.initData.stRequestHeaders || {};
            await saveHandbookMeta(AppState.meta, AppState.charId, stHeaders);
        } catch (e) {
            console.warn(LOG, 'Failed to save last view:', e);
        }
    }, 1000);

    // Animate transition
    if (direction) {
        const enterClass = direction > 0 ? 'hb-view-enter-right' : 'hb-view-enter-left';
        contentArea.innerHTML = '';
        _renderCurrentView(contentArea);
        const child = contentArea.firstElementChild;
        if (child) {
            child.classList.add(enterClass);
            child.addEventListener('animationend', () => child.classList.remove(enterClass), { once: true });
        }
    } else {
        contentArea.innerHTML = '';
        _renderCurrentView(contentArea);
    }

    // Show/hide toolbar based on view
    const showToolbar = newView === 'flyleaf' || newView === 'diary';
    if (toolbar) toolbar.style.display = showToolbar ? '' : 'none';

    _updateTocFabVisibility();
    _updateTocActive();
}

function _renderCurrentView(container) {
    switch (AppState.currentView) {
        case 'cover': _renderCover(container); break;
        case 'coverEditor': _renderCoverEditor(container); break;
        case 'flyleaf': _renderFlyleaf(container); break;
        case 'diary': _renderDiaryPage(container); break;
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Heart Button — Submit / LLM Trigger
// ═══════════════════════════════════════════════════════════════════════

async function _handleHeartButton() {
    if (!hasContent()) { alert('请先在画布上写/画点什么'); return; }

    // Check if response already exists — offer to regenerate
    const existingNote = document.querySelector('.hb-response-note');
    if (existingNote) {
        if (!confirm('已有回应，重新生成吗？')) return;
        existingNote.remove();
    }

    // Cancel any pending auto-save to prevent race condition (#2)
    _cancelPendingAutoSave();
    _setDiaryAutoSaveLock(true);

    const heartBtn = document.getElementById('hb_heart_btn');
    const loading = document.getElementById('hb_loading');
    if (heartBtn) { heartBtn.disabled = true; heartBtn.classList.add('loading'); }
    if (loading) loading.classList.add('active');

    try {
        const canvasDataUrl = exportAsDataUrl(0.8);
        if (!canvasDataUrl) {
            throw new Error('无法导出画布内容（可能被跨域资源污染）。请尝试撤销最近使用的胶带/贴纸后重试。');
        }
        const stHeaders = AppState.initData.stRequestHeaders || {};

        if (AppState.currentView === 'flyleaf') {
            await _submitFlyleaf(canvasDataUrl, stHeaders);
        } else {
            await _submitDiaryPage(canvasDataUrl, stHeaders);
        }

        console.log(`${LOG} Submit successful!`);
    } catch (e) {
        console.error(`${LOG} Submit failed:`, e);
        alert(`提交失败: ${e.message}`);
    } finally {
        _setDiaryAutoSaveLock(false);
        if (heartBtn) { heartBtn.disabled = false; heartBtn.classList.remove('loading'); }
        if (loading) loading.classList.remove('active');
    }
}

async function _submitFlyleaf(canvasDataUrl, stHeaders) {
    // Save flyleaf canvas
    await uploadFlyleafCanvas(canvasDataUrl, AppState.charId, stHeaders);

    // Get context
    let chatContext = '', worldBookContext = '';
    try {
        chatContext = await callBridge('getTodayChatContext');
        worldBookContext = await callBridge('getWorldBookContext');
    } catch (e) { console.warn(`${LOG} Context fetch failed:`, e); }

    // Special flyleaf prompt
    const charName = AppState.initData.charInfo?.name || 'Character';
    const systemPrompt = buildHandbookSystemPrompt({
        foundationPrompt: AppState.initData.foundationPrompt || '',
        charName, charDescription: AppState.initData.charInfo?.description || '',
        userName: AppState.initData.userName || 'User',
        persona: AppState.initData.persona || '', worldBookContext,
        availableStickers: (AppState.meta.stickers || []).map(s => ({ id: s.id, name: s.name || '', description: s.description || '' })),
    }).replace('在同一页手账上写你的回应', '在手账本的扉页写一段寄语给你的爱人');

    const userPrompt = `这是手账本扉页，上面有她的涂鸦和签名。请写一段温暖的寄语。${chatContext ? '\n\n最近聊天参考:\n' + chatContext : ''}`;

    const rawResponse = await callHandbookLLM({
        systemPrompt, userPrompt, canvasDataUrl,
        apiCredentials: AppState.initData.apiCredentials,
    });

    const parsed = parseHandbookResponse(rawResponse);
    if (parsed) {
        const plainText = parsed.blocks.map(b => b.text || '').join('\n');
        AppState.meta.flyleaf.charMessage = plainText;
        AppState.meta.flyleaf.responseData = parsed;
        await saveHandbookMeta(AppState.meta, AppState.charId, stHeaders);
        // Remove existing response note before placing new one
        document.querySelector('.hb-response-note')?.remove();
        await _placeResponseNote(parsed);
    }
}

async function _submitDiaryPage(canvasDataUrl, stHeaders) {
    const pageId = AppState.currentDiaryIndex >= 0
        ? AppState.meta.pages[AppState.currentDiaryIndex].id
        : nextPageId(AppState.meta);

    await uploadCanvasPage(canvasDataUrl, AppState.charId, pageId, stHeaders);

    let chatContext = '', worldBookContext = '';
    try {
        chatContext = await callBridge('getTodayChatContext');
        worldBookContext = await callBridge('getWorldBookContext');
    } catch (e) { console.warn(`${LOG} Context fetch failed:`, e); }

    // Build sticker list for LLM
    const availableStickers = (AppState.meta.stickers || []).map(s => ({
        id: s.id, name: s.name || '', description: s.description || '',
    }));

    const systemPrompt = buildHandbookSystemPrompt({
        foundationPrompt: AppState.initData.foundationPrompt || '',
        charName: AppState.initData.charInfo?.name || 'Character',
        charDescription: AppState.initData.charInfo?.description || '',
        userName: AppState.initData.userName || 'User',
        persona: AppState.initData.persona || '', worldBookContext,
        availableStickers,
    });
    const userPrompt = buildHandbookUserPrompt(chatContext);

    const rawResponse = await callHandbookLLM({
        systemPrompt, userPrompt, canvasDataUrl,
        apiCredentials: AppState.initData.apiCredentials,
    });

    const parsed = parseHandbookResponse(rawResponse);
    if (!parsed) throw new Error('Failed to parse LLM response');

    const responseData = {
        blocks: parsed.blocks,
        moodText: parsed.moodText,
        timestamp: new Date().toISOString(),
    };
    await uploadResponseData(responseData, AppState.charId, pageId, stHeaders);

    if (AppState.currentDiaryIndex < 0) {
        AppState.meta.pages.push({
            id: pageId,
            date: new Date().toISOString().split('T')[0],
            moodText: parsed.moodText,
            canvasFile: `${pageId}.webp`,
            responseFile: `resp_${pageId}.json`,
            pattern: AppState.meta.settings.pagePattern || 'dots',
        });
        AppState.currentDiaryIndex = AppState.meta.pages.length - 1;
    } else {
        AppState.meta.pages[AppState.currentDiaryIndex].moodText = parsed.moodText;
    }
    await saveHandbookMeta(AppState.meta, AppState.charId, stHeaders);

    // Remove existing response note before placing new one
    document.querySelector('.hb-response-note')?.remove();
    await _placeResponseNote(responseData);
    AppState.responseCache.set(pageId, responseData);
    _renderTocPanel(); // Update TOC with new page / mood text
}

// ═══════════════════════════════════════════════════════════════════════
// Console Capture (replaces old debug panel)
// ═══════════════════════════════════════════════════════════════════════

function _setupConsoleCapture() {
    const origLog = console.log.bind(console);
    const origWarn = console.warn.bind(console);
    const origError = console.error.bind(console);

    const colors = { log: '#0f0', warn: '#ff0', error: '#f44' };

    function capture(level, args) {
        const text = args.map(a => {
            if (typeof a === 'object') try { return JSON.stringify(a, null, 1); } catch { return String(a); }
            return String(a);
        }).join(' ');
        AppState.consoleLogs.push({ color: colors[level] || '#0f0', text: `[${level.toUpperCase()}] ${text}` });
        if (AppState.consoleLogs.length > 200) AppState.consoleLogs.shift();

        // Live update if console tab is open
        const area = document.getElementById('hb_console_area');
        if (area && AppState.menuOpen && AppState.activeTab === 'console') {
            const line = document.createElement('div');
            line.className = 'hb-console-line';
            line.style.color = colors[level] || '#0f0';
            line.textContent = `[${level.toUpperCase()}] ${text}`;
            area.appendChild(line);
            while (area.children.length > 200) area.removeChild(area.firstChild);
            area.scrollTop = area.scrollHeight;
        }

        // Show visible toast for warn / error
        if (level === 'warn' || level === 'error') {
            _showHandbookToast(level, text);
        }
    }

    console.log = (...args) => { origLog(...args); capture('log', args); };
    console.warn = (...args) => { origWarn(...args); capture('warn', args); };
    console.error = (...args) => { origError(...args); capture('error', args); };

    window.addEventListener('error', (e) => capture('error', [`Uncaught: ${e.message} at ${e.filename}:${e.lineno}`]));
    window.addEventListener('unhandledrejection', (e) => capture('error', [`Unhandled Promise: ${e.reason}`]));
}

/**
 * Shows a floating toast notification for warn/error level console messages.
 * Toast auto-dismisses after 5s (warn) or 7s (error), and can be clicked to close.
 * @param {'warn'|'error'} level
 * @param {string} text  — the formatted log text
 */
function _showHandbookToast(level, text) {
    // Ensure container exists (attached to #hb-app so it inherits dark-mode class)
    let container = document.getElementById('hb_toast_container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'hb_toast_container';
        // Attach inside #hb-app so .hb-dark scoping works; fall back to body
        const root = document.getElementById('hb-app') || document.body;
        root.appendChild(container);
    }

    const isError = level === 'error';
    const iconClass = isError ? 'ph ph-warning-octagon' : 'ph ph-warning';
    const label = isError ? 'Error' : 'Warning';
    const timeoutMs = isError ? 7000 : 5000;

    // Truncate very long messages to keep toast readable
    const MAX_CHARS = 160;
    const displayText = text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) + '…' : text;

    const toast = document.createElement('div');
    toast.className = `hb-toast hb-toast-${level}`;
    toast.innerHTML = `
        <i class="hb-toast-icon ${iconClass}"></i>
        <div class="hb-toast-body">
            <span class="hb-toast-label">${label}</span>
            <span class="hb-toast-msg">${_escapeHtml(displayText)}</span>
        </div>
    `;

    const dismiss = () => {
        if (!toast.parentNode) return;
        toast.classList.add('hb-toast-out');
        toast.addEventListener('animationend', () => toast.remove(), { once: true });
    };

    toast.addEventListener('click', dismiss);
    container.appendChild(toast);

    // Limit simultaneous toasts to 4
    while (container.children.length > 4) {
        container.removeChild(container.firstChild);
    }

    setTimeout(dismiss, timeoutMs);
}

// ═══════════════════════════════════════════════════════════════════════
// UI Helpers
// ═══════════════════════════════════════════════════════════════════════

function _showInitScreen() {
    const container = document.getElementById('hb-app');
    if (!container) return;
    container.innerHTML = `
        <div class="hb-init-screen">
            <div class="hb-init-icon"><i class="ph ph-notebook"></i></div>
            <div class="hb-init-text">正在连接酒馆…</div>
        </div>
    `;
}

function _showError(message) {
    const container = document.getElementById('hb-app');
    if (!container) return;
    container.innerHTML = `
        <div class="hb-empty-state">
            <div class="hb-empty-icon"><i class="ph ph-warning-circle"></i></div>
            <div class="hb-empty-title">连接失败</div>
            <div class="hb-empty-desc">${_escapeHtml(message)}</div>
        </div>
    `;
}

export function _escapeHtml(text) {
    if (!text) return '';
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
