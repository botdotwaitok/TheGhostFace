import { FONT_MAP, COLOR_MAP, SIZE_MAP, TEXT_SIZE_OPTIONS } from './handbookConstants.js';
import { uploadResponseData, saveHandbookMeta, uploadSticker, loadStickerImage, deleteSticker, uploadTape, loadTapeImage } from './handbookStorage.js';
import { migrateOldResponse } from './handbookGeneration.js';
import { AppState } from './handbookState.js';
import { _toggleMenu, _renderTocPanel } from './handbookNavigationUI.js';
import { LOG, _escapeHtml } from './handbookEngine.js';

// ═══════════════════════════════════════════════════════════════════════
// Stickers Tab (Menu Panel) — with custom categories
// ═══════════════════════════════════════════════════════════════════════

export function _ensureStickerCategories() {
    if (!AppState.meta.stickerCategories) {
        AppState.meta.stickerCategories = [{ id: '__uncategorized__', name: '未分类' }];
    }
    // Assign uncategorized to stickers without categoryId
    if (AppState.meta.stickers) {
        for (const stk of AppState.meta.stickers) {
            if (!stk.categoryId) stk.categoryId = '__uncategorized__';
        }
    }
}

/**
 * Preload all sticker images into the cache at boot time.
 * Called once during Engine boot so _renderStickersTab never needs to fetch.
 */
export async function preloadStickerImages() {
    const stHeaders = AppState.initData.stRequestHeaders || {};
    const allStickers = AppState.meta.stickers || [];
    const uncached = allStickers.filter(s => !AppState.stickerImageCache.has(s.id));
    if (uncached.length === 0) return;
    await Promise.all(uncached.map(async (stk) => {
        const url = await loadStickerImage(AppState.charId, stk.id, stHeaders);
        if (url) AppState.stickerImageCache.set(stk.id, url);
    }));
}

export async function _renderStickersTab(container) {
    _ensureStickerCategories();
    const categories = AppState.meta.stickerCategories;
    const allStickers = AppState.meta.stickers || [];

    // If cache is cold (e.g. boot preload hasn't finished), load now as fallback
    const stHeaders = AppState.initData.stRequestHeaders || {};
    for (const stk of allStickers) {
        if (!AppState.stickerImageCache.has(stk.id)) {
            const url = await loadStickerImage(AppState.charId, stk.id, stHeaders);
            if (url) AppState.stickerImageCache.set(stk.id, url);
        }
    }

    // Validate active category still exists
    if (AppState.activeStickerCategory !== '__all__' && !categories.find(c => c.id === AppState.activeStickerCategory)) {
        AppState.activeStickerCategory = '__all__';
    }

    // Filter stickers by category
    const filtered = AppState.activeStickerCategory === '__all__'
        ? allStickers
        : allStickers.filter(s => s.categoryId === AppState.activeStickerCategory);

    container.innerHTML = `
        <div class="hb-sticker-tab-wrapper">
            <!-- Category pills -->
            <div class="hb-sticker-categories">
                <button class="hb-sticker-cat-pill ${AppState.activeStickerCategory === '__all__' ? 'active' : ''}" data-cat-id="__all__">全部</button>
                ${categories.map(c => `
                    <button class="hb-sticker-cat-pill ${AppState.activeStickerCategory === c.id ? 'active' : ''}" data-cat-id="${c.id}">
                        ${_escapeHtml(c.name)}
                    </button>
                `).join('')}
                <button class="hb-sticker-cat-pill hb-sticker-cat-add" id="hb_add_cat_btn" title="新建分类">
                    <i class="ph ph-plus"></i>
                </button>
            </div>

            <!-- Category management (only when specific cat selected) -->
            ${AppState.activeStickerCategory !== '__all__' && AppState.activeStickerCategory !== '__uncategorized__' ? `
                <div class="hb-sticker-cat-actions">
                    <button class="hb-sticker-cat-action-btn" id="hb_rename_cat_btn" title="重命名">
                        <i class="ph ph-pencil-simple"></i> 重命名
                    </button>
                    <button class="hb-sticker-cat-action-btn hb-sticker-cat-action-danger" id="hb_delete_cat_btn" title="删除分类">
                        <i class="ph ph-trash"></i> 删除分类
                    </button>
                </div>
            ` : ''}

            <!-- Sticker grid -->
            <div class="hb-sticker-grid" id="hb_sticker_grid">
                <div class="hb-sticker-upload-btn" id="hb_add_sticker_btn">
                    <i class="ph ph-plus"></i>
                </div>
                ${filtered.map(stk => {
                    const url = AppState.stickerImageCache.get(stk.id);
                    return url ? `
                        <div class="hb-sticker-thumb-wrap" data-sticker-id="${stk.id}" title="${_escapeHtml(stk.name || '')}${stk.description ? '\n' + _escapeHtml(stk.description) : ''}">
                            <img class="hb-sticker-thumb" src="${url}" alt="${_escapeHtml(stk.name || 'sticker')}">
                            ${stk.name ? `<span class="hb-sticker-thumb-name">${_escapeHtml(stk.name)}</span>` : ''}
                            <button class="hb-sticker-thumb-delete" data-sticker-id="${stk.id}">
                                <i class="ph ph-x"></i>
                            </button>
                        </div>
                    ` : '';
                }).join('')}
            </div>

            ${filtered.length === 0 ? '<div class="hb-toc-empty">这个分类还没有贴纸</div>' : ''}
        </div>
    `;

    // ── Category pill click ──
    container.querySelectorAll('.hb-sticker-cat-pill:not(.hb-sticker-cat-add)').forEach(btn => {
        btn.addEventListener('click', () => {
            AppState.activeStickerCategory = btn.dataset.catId;
            _renderStickersTab(container);
        });
    });

    // ── Add category ──
    document.getElementById('hb_add_cat_btn')?.addEventListener('click', async () => {
        const name = prompt('新分类名称:');
        if (!name || !name.trim()) return;
        const catId = `cat_${Date.now().toString(36)}`;
        AppState.meta.stickerCategories.push({ id: catId, name: name.trim() });
        AppState.activeStickerCategory = catId;
        await saveHandbookMeta(AppState.meta, AppState.charId, AppState.initData.stRequestHeaders || {});
        _renderStickersTab(container);
    });

    // ── Rename category ──
    document.getElementById('hb_rename_cat_btn')?.addEventListener('click', async () => {
        const cat = categories.find(c => c.id === AppState.activeStickerCategory);
        if (!cat) return;
        const newName = prompt('重命名分类:', cat.name);
        if (!newName || !newName.trim()) return;
        cat.name = newName.trim();
        await saveHandbookMeta(AppState.meta, AppState.charId, AppState.initData.stRequestHeaders || {});
        _renderStickersTab(container);
    });

    // ── Delete category ──
    document.getElementById('hb_delete_cat_btn')?.addEventListener('click', async () => {
        if (!confirm('删除该分类？贴纸将移到「未分类」。')) return;
        // Move stickers to uncategorized
        for (const stk of allStickers) {
            if (stk.categoryId === AppState.activeStickerCategory) stk.categoryId = '__uncategorized__';
        }
        AppState.meta.stickerCategories = categories.filter(c => c.id !== AppState.activeStickerCategory);
        AppState.activeStickerCategory = '__all__';
        await saveHandbookMeta(AppState.meta, AppState.charId, AppState.initData.stRequestHeaders || {});
        _renderStickersTab(container);
    });

    // ── Upload button ──
    document.getElementById('hb_add_sticker_btn')?.addEventListener('click', () => {
        document.getElementById('hb_sticker_file_input')?.click();
    });

    // ── Click sticker thumb → place on page ──
    container.querySelectorAll('.hb-sticker-thumb').forEach(img => {
        img.addEventListener('click', () => {
            const id = img.closest('.hb-sticker-thumb-wrap')?.dataset.stickerId;
            if (id && AppState.currentView === 'diary') {
                _placeSticker(id);
                _toggleMenu();
            }
        });
    });

    // ── Delete sticker from library ──
    container.querySelectorAll('.hb-sticker-thumb-delete').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const id = btn.dataset.stickerId;
            if (!id) return;
            AppState.meta.stickers = AppState.meta.stickers.filter(s => s.id !== id);
            for (const p of AppState.meta.pages) {
                if (p.stickers) p.stickers = p.stickers.filter(s => s.stickerId !== id);
            }
            const stHeaders = AppState.initData.stRequestHeaders || {};
            await deleteSticker(AppState.charId, id, stHeaders);
            await saveHandbookMeta(AppState.meta, AppState.charId, stHeaders);
            if (AppState.stickerImageCache.has(id)) {
                URL.revokeObjectURL(AppState.stickerImageCache.get(id));
                AppState.stickerImageCache.delete(id);
            }
            _renderStickersTab(container);
            console.log(`${LOG} Sticker ${id} deleted`);
        });
    });
}

export async function _onStickerFileSelected(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Prompt for name + description (for future LLM integration)
    const stickerName = prompt('贴纸名称:');
    if (stickerName === null) { e.target.value = ''; return; } // cancelled
    const stickerDesc = prompt('简要描述 (可留空):') || '';

    try {
        const stickerId = `stk_${Date.now().toString(36)}`;
        const stHeaders = AppState.initData.stRequestHeaders || {};
        await uploadSticker(file, AppState.charId, stickerId, stHeaders);

        // Determine category: use active category if specific, else uncategorized
        const catId = (AppState.activeStickerCategory && AppState.activeStickerCategory !== '__all__')
            ? AppState.activeStickerCategory
            : '__uncategorized__';

        // Add to meta with name + description
        AppState.meta.stickers.push({
            id: stickerId,
            categoryId: catId,
            name: stickerName.trim() || '',
            description: stickerDesc.trim(),
            filename: `hb_${AppState.charId}_sticker_${stickerId}.webp`
        });
        await saveHandbookMeta(AppState.meta, AppState.charId, stHeaders);

        // Cache
        const url = await loadStickerImage(AppState.charId, stickerId, stHeaders);
        if (url) AppState.stickerImageCache.set(stickerId, url);

        // Re-render if menu is open on stickers tab
        const stickerBody = document.getElementById('hb_menu_body_stickers');
        if (stickerBody && AppState.menuOpen && AppState.activeTab === 'stickers') {
            _renderStickersTab(stickerBody);
        }
        console.log(`${LOG} Sticker uploaded: ${stickerId} (${stickerName})`);
    } catch (err) {
        console.error(`${LOG} Sticker upload failed:`, err);
        alert('贴纸上传失败: ' + err.message);
    }
    e.target.value = '';
}

// ═══════════════════════════════════════════════════════════════════════
// Tapes Tab (Menu Panel)
// ═══════════════════════════════════════════════════════════════════════

export async function _renderTapesTab(container) {
    const stHeaders = AppState.initData.stRequestHeaders || {};
    const customTapes = AppState.meta.tapes || [];
    
    // Default preset tapes from constants
    const { TAPE_PRESETS } = await import('./handbookConstants.js');
    
    // We will merge presets and custom tapes for display
    const allTapes = [
        ...TAPE_PRESETS.map(p => ({ ...p, isPreset: true })),
        ...customTapes.map(t => ({ ...t, isPreset: false }))
    ];

    // Preload custom tape images into cache
    for (const t of customTapes) {
        if (!AppState.tapeImageCache.has(t.id)) {
            const url = await loadTapeImage(AppState.charId, t.id, stHeaders);
            if (url) AppState.tapeImageCache.set(t.id, url);
        }
    }

    container.innerHTML = `
        <div class="hb-sticker-tab-wrapper">
            <div class="hb-sticker-grid" id="hb_tape_grid">
                <div class="hb-sticker-upload-btn" id="hb_add_tape_btn">
                    <i class="ph ph-plus"></i>
                </div>
                ${allTapes.map(tape => {
                    const url = tape.isPreset ? tape.url : (AppState.tapeImageCache?.get(tape.id) || '');
                    return url ? `
                        <div class="hb-sticker-thumb-wrap ${AppState.activeTapeId === tape.id ? 'active' : ''}" data-tape-id="${tape.id}" title="${_escapeHtml(tape.name || '')}">
                            <img class="hb-sticker-thumb" src="${url}" alt="${_escapeHtml(tape.name || 'tape')}">
                            ${tape.name ? `<span class="hb-sticker-thumb-name">${_escapeHtml(tape.name)}</span>` : ''}
                            ${!tape.isPreset ? `
                            <button class="hb-sticker-thumb-delete" data-tape-id="${tape.id}">
                                <i class="ph ph-x"></i>
                            </button>
                            ` : ''}
                        </div>
                    ` : '';
                }).join('')}
            </div>
            ${allTapes.length === 0 ? '<div class="hb-toc-empty">还没有胶带</div>' : ''}
        </div>
    `;

    // ── Upload button ──
    document.getElementById('hb_add_tape_btn')?.addEventListener('click', () => {
        document.getElementById('hb_tape_file_input')?.click();
    });

    // ── Click tape thumb → select tape ──
    container.querySelectorAll('.hb-sticker-thumb-wrap').forEach(wrap => {
        wrap.addEventListener('click', async () => {
            const id = wrap.dataset.tapeId;
            if (id) {
                // Select tape globally
                AppState.activeTapeId = id;
                const tapeObj = allTapes.find(t => t.id === id);
                if (tapeObj) {
                    const url = tapeObj.isPreset ? tapeObj.url : (AppState.tapeImageCache?.get(id) || '');
                    const { setActiveTapeImage } = await import('./handbookCanvas.js');
                    await setActiveTapeImage(url);
                    
                    const { _setToolMode } = await import('./handbookToolbarUI.js');
                    _setToolMode('tape');
                }
                _renderTapesTab(container);
            }
        });
    });

    // ── Delete tape from library ──
    container.querySelectorAll('.hb-sticker-thumb-delete').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const id = btn.dataset.tapeId;
            if (!id) return;
            AppState.meta.tapes = AppState.meta.tapes.filter(t => t.id !== id);
            
            const stHeaders = AppState.initData.stRequestHeaders || {};
            // ST backend doesn't support direct file deletion, so we skip backend deletion logic.
            // Just save meta and memory cache.
            await saveHandbookMeta(AppState.meta, AppState.charId, stHeaders);
            if (AppState.tapeImageCache && AppState.tapeImageCache.has(id)) {
                URL.revokeObjectURL(AppState.tapeImageCache.get(id));
                AppState.tapeImageCache.delete(id);
            }
            if (AppState.activeTapeId === id) AppState.activeTapeId = null;
            
            _renderTapesTab(container);
            console.log(`${LOG} Tape ${id} deleted`);
        });
    });
}

export async function _onTapeFileSelected(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    const tapeName = prompt('胶带名称:');
    if (tapeName === null) { e.target.value = ''; return; } // cancelled

    try {
        const tapeId = `tape_${Date.now().toString(36)}`;
        const stHeaders = AppState.initData.stRequestHeaders || {};
        await uploadTape(file, AppState.charId, tapeId, stHeaders);

        if (!AppState.meta.tapes) AppState.meta.tapes = [];
        AppState.meta.tapes.push({
            id: tapeId,
            name: tapeName.trim() || '',
            filename: `hb_${AppState.charId}_tape_${tapeId}.webp`
        });
        await saveHandbookMeta(AppState.meta, AppState.charId, stHeaders);

        const url = await loadTapeImage(AppState.charId, tapeId, stHeaders);
        if (url) {
            AppState.tapeImageCache.set(tapeId, url);
        }

        const tapeBody = document.getElementById('hb_menu_body_tapes');
        if (tapeBody && AppState.menuOpen && AppState.activeTab === 'tapes') {
            _renderTapesTab(tapeBody);
        }
        console.log(`${LOG} Tape uploaded: ${tapeId}`);
    } catch (err) {
        console.error(`${LOG} Tape upload failed:`, err);
        alert('胶带上传失败: ' + err.message);
    }
    e.target.value = '';
}



// ═══════════════════════════════════════════════════════════════════════
// Sticker Placement & Interaction
// ═══════════════════════════════════════════════════════════════════════

export function _placeSticker(stickerId, opts = {}) {
    const layer = document.getElementById('hb_sticker_layer');
    if (!layer) return;

    const url = AppState.stickerImageCache.get(stickerId);
    if (!url) { console.warn(`${LOG} No cached image for sticker ${stickerId}`); return; }

    const x = opts.x ?? (layer.offsetWidth / 2 - 40);
    const y = opts.y ?? (layer.offsetHeight / 2 - 40);
    const scale = opts.scale ?? 1;
    const rotation = opts.rotation ?? 0;

    const wrapper = document.createElement('div');
    wrapper.className = 'hb-sticker';
    wrapper.dataset.stickerId = stickerId;
    wrapper.style.cssText = `
        left: ${x}px; top: ${y}px;
        transform: rotate(${rotation}deg) scale(${scale});
    `;
    wrapper.innerHTML = `
        <img src="${url}" draggable="false" class="hb-sticker-img">
        <button class="hb-sticker-delete"><i class="ph ph-x"></i></button>
        <div class="hb-sticker-rotate"><i class="ph ph-arrow-clockwise"></i></div>
        <div class="hb-sticker-resize" title="按住拖拽调节大小"><i class="ph ph-arrows-out-simple"></i></div>
    `;

    layer.appendChild(wrapper);
    _initDraggableInteraction(wrapper);
}

// ═══════════════════════════════════════════════════════════════════════
// Response Note — Rich Text LLM Response (Blocks System)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Resolve a color value from the toolbox map or raw hex.
 */
export function _resolveBlockColor(color, fallback) {
    if (!color) return fallback;
    if (COLOR_MAP[color]) return COLOR_MAP[color];
    if (/^#[0-9a-fA-F]{3,8}$/.test(color)) return color;
    return fallback;
}

export function _resolveBlockFont(font) {
    if (!font) return null;
    return FONT_MAP[font] || null;
}

export function _resolveBlockSize(size) {
    if (!size) return null;
    if (SIZE_MAP[size]) return SIZE_MAP[size];
    const num = parseInt(size);
    return isNaN(num) ? null : num;
}

/**
 * Render a single block's inner HTML.
 */
export function _renderBlockHtml(block, index) {
    if (block.type === 'sticker') {
        const url = AppState.stickerImageCache.get(block.stickerId);
        if (url) {
            return `<div class="hb-resp-sticker" data-block-index="${index}" data-sticker-id="${block.stickerId}">
                <img src="${url}" draggable="false">
            </div>`;
        }
        return ''; // Sticker not found in cache
    }

    const charInk = AppState.meta.settings?.charInkColor || '#e74c6a';
    const charFont = AppState.meta.settings?.charFont || "'Caveat', cursive";

    const color = _resolveBlockColor(block.color, charInk);
    const font = _resolveBlockFont(block.font) || charFont;
    const size = _resolveBlockSize(block.size) || 18;
    const align = block.align || 'left';
    const bold = block.bold ? 'font-weight:bold;' : '';
    const italic = block.italic ? 'font-style:italic;' : '';

    const style = `color:${color};font-family:${font};font-size:${size}px;text-align:${align};${bold}${italic}`;

    return `<div class="hb-resp-block" data-block-index="${index}" style="${style}">
        ${_escapeHtml(block.text).replace(/\n/g, '<br>')}
    </div>`;
}

/**
 * Place an LLM response as a draggable rich text element on the sticker layer.
 * @param {object} responseData - { blocks: [...], moodText } (new format) or { content, moodText } (legacy)
 * @param {object} [opts] - { x, y, width, scale, rotation }
 */
export async function _placeResponseNote(responseData, opts = {}) {
    const layer = document.getElementById('hb_sticker_layer');
    if (!layer) return;

    // Migrate old format if needed
    let data = responseData;
    if (!data.blocks && data.content) {
        data = migrateOldResponse(data);
    }
    if (!data.blocks || data.blocks.length === 0) return;

    // Preload sticker images referenced in blocks
    const stHeaders = AppState.initData.stRequestHeaders || {};
    for (const block of data.blocks) {
        if (block.type === 'sticker' && block.stickerId && !AppState.stickerImageCache.has(block.stickerId)) {
            const url = await loadStickerImage(AppState.charId, block.stickerId, stHeaders);
            if (url) AppState.stickerImageCache.set(block.stickerId, url);
        }
    }

    const x = opts.x ?? Math.max(10, layer.offsetWidth * 0.3);
    const y = opts.y ?? Math.max(10, layer.offsetHeight * 0.45);
    const scale = opts.scale ?? 1;
    const rotation = opts.rotation ?? ((Math.random() * 4 - 2));
    const noteWidth = opts.width ?? 240;

    const note = document.createElement('div');
    note.className = 'hb-response-note';
    note.style.cssText = `
        left: ${x}px; top: ${y}px;
        width: ${noteWidth}px;
        transform: rotate(${rotation}deg) scale(${scale});
        ${opts.width ? 'max-width: none;' : ''}
    `;

    // Store blocks data on the DOM element for later editing/saving
    note._blocksData = data.blocks;
    note._moodText = data.moodText || '';

    // Render blocks
    const blocksHtml = data.blocks.map((b, i) => _renderBlockHtml(b, i)).join('');
    const moodHtml = data.moodText ? `
        <div class="hb-response-note-mood">
            — ${_escapeHtml(data.moodText)}
        </div>
    ` : '';

    note.innerHTML = `
        <div class="hb-response-note-content">${blocksHtml}</div>
        ${moodHtml}
        <button class="hb-sticker-delete"><i class="ph ph-x"></i></button>
        <div class="hb-sticker-rotate"><i class="ph ph-arrow-clockwise"></i></div>
        <div class="hb-response-note-resize"><i class="ph ph-arrows-out-simple"></i></div>
    `;

    // Block click → show editor
    note.querySelectorAll('.hb-resp-block, .hb-resp-sticker').forEach(blockEl => {
        blockEl.addEventListener('click', (e) => {
            e.stopPropagation();
            const idx = parseInt(blockEl.dataset.blockIndex);
            _showBlockEditor(note, blockEl, idx);
        });
    });

    layer.appendChild(note);
    _initDraggableInteraction(note);
}

// ═══════════════════════════════════════════════════════════════════════
// Block Editor — Floating Inline Toolbar
// ═══════════════════════════════════════════════════════════════════════

let _activeBlockEditor = null;
let _activeCloseHandler = null;

export function _dismissBlockEditor() {
    if (_activeCloseHandler) {
        document.removeEventListener('pointerdown', _activeCloseHandler);
        _activeCloseHandler = null;
    }
    if (_activeBlockEditor) {
        _activeBlockEditor.remove();
        _activeBlockEditor = null;
    }
    document.querySelectorAll('.hb-resp-block.editing').forEach(el => el.classList.remove('editing'));
}

/**
 * Show a floating editor toolbar above a clicked block.
 */
export function _showBlockEditor(noteEl, blockEl, blockIndex) {
    _dismissBlockEditor();

    const blocks = noteEl._blocksData;
    if (!blocks || !blocks[blockIndex]) return;
    const block = blocks[blockIndex];
    if (block.type === 'sticker') {
        _showStickerEditor(noteEl, blockEl, blockIndex);
        return;
    }

    blockEl.classList.add('editing');

    const editor = document.createElement('div');
    editor.className = 'hb-block-editor';

    // Current values
    const currentFont = block.font || 'handwriting';
    const currentColor = block.color || '';
    const currentSize = block.size || 'normal';
    const currentAlign = block.align || 'left';
    const currentBold = block.bold || false;
    const currentItalic = block.italic || false;

    editor.innerHTML = `
        <select class="hb-be-font" title="字体">
            ${Object.entries(FONT_MAP).map(([key, val]) => `
                <option value="${key}" ${key === currentFont ? 'selected' : ''}>${
                    key === 'handwriting' ? '手写' :
                    key === 'chinese-hand' ? '中文手写' :
                    key === 'elegant' ? '花体' : '正文'
                }</option>
            `).join('')}
        </select>
        <div class="hb-be-color-group">
            ${Object.entries(COLOR_MAP).map(([key, hex]) => `
                <button class="hb-be-color-dot ${key === currentColor ? 'active' : ''}"
                        data-color-key="${key}" style="background:${hex};" title="${key}"></button>
            `).join('')}
        </div>
        <select class="hb-be-size" title="大小">
            ${TEXT_SIZE_OPTIONS.map(px => `
                <option value="${px}" ${px === (_resolveBlockSize(currentSize) || 18) ? 'selected' : ''}>${px}px</option>
            `).join('')}
        </select>
        <button class="hb-be-btn ${currentBold ? 'active' : ''}" data-action="bold" title="加粗">
            <i class="ph ph-text-b"></i>
        </button>
        <button class="hb-be-btn ${currentItalic ? 'active' : ''}" data-action="italic" title="斜体">
            <i class="ph ph-text-italic"></i>
        </button>
        <div class="hb-be-divider"></div>
        <button class="hb-be-btn ${currentAlign === 'left' ? 'active' : ''}" data-action="align-left" title="左对齐">
            <i class="ph ph-text-align-left"></i>
        </button>
        <button class="hb-be-btn ${currentAlign === 'center' ? 'active' : ''}" data-action="align-center" title="居中">
            <i class="ph ph-text-align-center"></i>
        </button>
        <button class="hb-be-btn ${currentAlign === 'right' ? 'active' : ''}" data-action="align-right" title="右对齐">
            <i class="ph ph-text-align-right"></i>
        </button>
    `;

    // Position: above the block
    const noteRect = noteEl.getBoundingClientRect();
    const blockRect = blockEl.getBoundingClientRect();
    editor.style.position = 'fixed';
    editor.style.left = `${blockRect.left}px`;
    editor.style.top = `${blockRect.top - 44}px`;
    editor.style.zIndex = '600';

    document.body.appendChild(editor);
    _activeBlockEditor = editor;

    // Clamp to viewport
    requestAnimationFrame(() => {
        const edRect = editor.getBoundingClientRect();
        if (edRect.right > window.innerWidth) {
            editor.style.left = `${window.innerWidth - edRect.width - 8}px`;
        }
        if (edRect.top < 0) {
            editor.style.top = `${blockRect.bottom + 4}px`;
        }
    });

    // ── Apply style change helper ──
    const applyChange = () => {
        // Re-render block DOM
        const charInk = AppState.meta.settings?.charInkColor || '#e74c6a';
        const charFont = AppState.meta.settings?.charFont || "'Caveat', cursive";
        const color = _resolveBlockColor(block.color, charInk);
        const font = _resolveBlockFont(block.font) || charFont;
        const size = _resolveBlockSize(block.size) || 18;
        const align = block.align || 'left';
        const bold = block.bold ? 'font-weight:bold;' : '';
        const italic = block.italic ? 'font-style:italic;' : '';
        blockEl.style.cssText = `color:${color};font-family:${font};font-size:${size}px;text-align:${align};${bold}${italic}`;
        // Save
        _saveResponseBlocksData(noteEl);
    };

    // ── Font dropdown ──
    editor.querySelector('.hb-be-font')?.addEventListener('change', (e) => {
        block.font = e.target.value;
        applyChange();
    });

    // ── Size dropdown ──
    editor.querySelector('.hb-be-size')?.addEventListener('change', (e) => {
        block.size = e.target.value;
        applyChange();
    });

    // ── Color dots ──
    editor.querySelectorAll('.hb-be-color-dot').forEach(dot => {
        dot.addEventListener('click', (e) => {
            e.stopPropagation();
            editor.querySelectorAll('.hb-be-color-dot').forEach(d => d.classList.remove('active'));
            dot.classList.add('active');
            block.color = dot.dataset.colorKey;
            applyChange();
        });
    });

    // ── Action buttons ──
    editor.querySelectorAll('.hb-be-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const action = btn.dataset.action;
            if (action === 'bold') {
                block.bold = !block.bold;
                btn.classList.toggle('active', block.bold);
            } else if (action === 'italic') {
                block.italic = !block.italic;
                btn.classList.toggle('active', block.italic);
            } else if (action === 'align-left') {
                block.align = 'left';
                editor.querySelectorAll('[data-action^="align-"]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            } else if (action === 'align-center') {
                block.align = 'center';
                editor.querySelectorAll('[data-action^="align-"]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            } else if (action === 'align-right') {
                block.align = 'right';
                editor.querySelectorAll('[data-action^="align-"]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            }
            applyChange();
        });
    });

    // Close editor on outside click (delayed to avoid immediate close)
    setTimeout(() => {
        _activeCloseHandler = (e) => {
            if (!editor.contains(e.target) && e.target !== blockEl && !e.target.closest('.hb-resp-block') && !e.target.closest('.hb-resp-sticker')) {
                _dismissBlockEditor();
            }
        };
        document.addEventListener('pointerdown', _activeCloseHandler);
    }, 100);
}

/**
 * Show a floating sticker gallery to replace a sticker block.
 */
export function _showStickerEditor(noteEl, blockEl, blockIndex) {
    const blocks = noteEl._blocksData;
    const block = blocks[blockIndex];

    blockEl.classList.add('editing');

    const editor = document.createElement('div');
    editor.className = 'hb-block-editor hb-sticker-replacer';
    
    const allStickers = AppState.meta.stickers || [];
    if (allStickers.length === 0) {
        editor.innerHTML = `<div style="padding: 8px; font-size: 13px; color: #666;">贴纸库为空，请先上传贴纸。</div>`;
    } else {
        const thumbs = allStickers.map(stk => {
            const url = AppState.stickerImageCache.get(stk.id) || '';
            if (!url) return '';
            const isActive = stk.id === block.stickerId;
            return `
                <img src="${url}" class="hb-be-sticker-thumb ${isActive ? 'active' : ''}" data-sticker-id="${stk.id}" title="${_escapeHtml(stk.name || '贴纸')}">
            `;
        }).join('');
        editor.innerHTML = `<div class="hb-be-sticker-grid">${thumbs}</div>`;
    }

    const blockRect = blockEl.getBoundingClientRect();
    editor.style.position = 'fixed';
    editor.style.left = `${blockRect.left}px`;
    editor.style.top = `${blockRect.top - 100}px`; // Temporary, will measure shortly
    editor.style.zIndex = '600';

    document.body.appendChild(editor);
    _activeBlockEditor = editor;

    // Reposition
    requestAnimationFrame(() => {
        const edRect = editor.getBoundingClientRect();
        if (edRect.right > window.innerWidth) {
            editor.style.left = `${window.innerWidth - edRect.width - 8}px`;
        }
        let top = blockRect.top - edRect.height - 8;
        if (top < 0) {
            top = blockRect.bottom + 8;
        }
        editor.style.top = `${top}px`;
    });

    editor.querySelectorAll('.hb-be-sticker-thumb').forEach(thumb => {
        thumb.addEventListener('click', (e) => {
            e.stopPropagation();
            const newId = thumb.dataset.stickerId;
            
            block.stickerId = newId;
            
            const imgEl = blockEl.querySelector('img');
            if (imgEl) imgEl.src = AppState.stickerImageCache.get(newId);
            
            editor.querySelectorAll('.hb-be-sticker-thumb').forEach(t => t.classList.remove('active'));
            thumb.classList.add('active');

            _saveResponseBlocksData(noteEl);
        });
    });

    setTimeout(() => {
        _activeCloseHandler = (e) => {
            if (!editor.contains(e.target) && e.target !== blockEl && !e.target.closest('.hb-resp-block') && !e.target.closest('.hb-resp-sticker')) {
                _dismissBlockEditor();
            }
        };
        document.addEventListener('pointerdown', _activeCloseHandler);
    }, 100);
}

/**
 * Save modified blocks data back to the response JSON file.
 */
export function _saveResponseBlocksData(noteEl) {
    if (!noteEl._blocksData) return;

    const pageId = AppState.currentDiaryIndex >= 0 ? AppState.meta.pages[AppState.currentDiaryIndex]?.id : null;
    if (!pageId && AppState.currentView !== 'flyleaf') return;

    const responseData = {
        blocks: noteEl._blocksData,
        moodText: noteEl._moodText || '',
        timestamp: new Date().toISOString(),
    };

    // Update cache
    if (pageId) AppState.responseCache.set(pageId, responseData);

    // Debounced save to file
    clearTimeout(_saveResponseBlocksData._timer);
    _saveResponseBlocksData._timer = setTimeout(async () => {
        try {
            const stHeaders = AppState.initData.stRequestHeaders || {};
            if (AppState.currentView === 'flyleaf') {
                // Flyleaf response is stored in meta
                AppState.meta.flyleaf.charMessage = responseData.blocks.map(b => b.text || '').join('\n');
                AppState.meta.flyleaf.responseData = responseData;
                await saveHandbookMeta(AppState.meta, AppState.charId, stHeaders);
            } else if (pageId) {
                await uploadResponseData(responseData, AppState.charId, pageId, stHeaders);
            }
            console.log(`${LOG} Response blocks saved`);
        } catch (e) {
            console.warn(`${LOG} Failed to save response blocks:`, e);
        }
    }, 800);
}

/**
 * Extract plain text from blocks for search indexing.
 */
export function _extractBlocksText(responseData) {
    if (!responseData) return '';
    if (responseData.blocks) {
        return responseData.blocks
            .filter(b => b.text)
            .map(b => b.text)
            .join(' ');
    }
    // Legacy
    return responseData.content || '';
}

// ═══════════════════════════════════════════════════════════════════════
// Shared Draggable Interaction (used by stickers & response notes)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Initialize drag, scale, rotate interactions on a positioned element.
 * Supports pointer events, pinch zoom, mouse wheel zoom, and rotate handle.
 */
export function _initDraggableInteraction(el) {
    let isDragging = false;
    let startX, startY, origLeft, origTop;
    let currentScale = _parseStickerScale(el);
    let currentRotation = _parseStickerRotation(el);
    
    const applyTransform = () => {
        el.style.transform = `rotate(${currentRotation}deg) scale(${currentScale})`;
        el.style.setProperty('--inv-scale', 1 / currentScale);
    };
    
    el.style.setProperty('--inv-scale', 1 / currentScale);

    // ── Select on tap ──
    el.addEventListener('pointerdown', (e) => {
        if (e.target.closest('.hb-sticker-delete') || e.target.closest('.hb-sticker-rotate') || e.target.closest('.hb-response-note-resize') || e.target.closest('.hb-sticker-resize')) return;
        // Skip drag when clicking a block for editing or if element natively allows it
        if (e.target.closest('.hb-resp-block') || e.target.closest('.hb-resp-sticker') || e.target.isContentEditable) {
            e.stopPropagation();
            _selectSticker(el);
            return; // Don't start drag or capture pointer
        }
        e.stopPropagation();
        _selectSticker(el);
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        origLeft = el.offsetLeft;
        origTop = el.offsetTop;
        el.setPointerCapture(e.pointerId);
        el.style.cursor = 'grabbing';
    });

    el.addEventListener('pointermove', (e) => {
        if (!isDragging) return;
        e.preventDefault();
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        el.style.left = `${origLeft + dx}px`;
        el.style.top = `${origTop + dy}px`;
    });

    el.addEventListener('pointerup', (e) => {
        if (!isDragging) return;
        isDragging = false;
        el.style.cursor = 'grab';
        _saveLayerPositions();
    });

    // ── Delete button ──
    el.querySelector('.hb-sticker-delete')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const isResponseNote = el.classList.contains('hb-response-note');
        const isCoverText = el.classList.contains('hb-cover-text');
        const textId = isCoverText ? el.dataset.textId : null;
        
        el.remove();
        AppState.selectedSticker = null;
        
        if (isCoverText && textId) {
            AppState.meta.cover.texts = AppState.meta.cover.texts.filter(t => t.id !== textId);
        }
        
        _saveLayerPositions();

        // If it was the LLM response note, save an empty JSON so it stays deleted on refresh
        if (isResponseNote) {
            const stHeaders = AppState.initData.stRequestHeaders || {};
            if (AppState.currentView === 'flyleaf') {
                AppState.meta.flyleaf.charMessage = '';
                AppState.meta.flyleaf.responseData = null;
                saveHandbookMeta(AppState.meta, AppState.charId, stHeaders).catch(err => console.warn(LOG, 'Delete flyleaf note failed', err));
            } else if (AppState.currentDiaryIndex >= 0 && AppState.currentDiaryIndex < AppState.meta.pages.length) {
                const pageId = AppState.meta.pages[AppState.currentDiaryIndex].id;
                const emptyResp = { blocks: [], moodText: '', timestamp: new Date().toISOString() };
                AppState.responseCache.set(pageId, emptyResp);
                uploadResponseData(emptyResp, AppState.charId, pageId, stHeaders).catch(err => console.warn(LOG, 'Delete diary note failed', err));
            }
            // Refresh TOC to update mood text display
            _renderTocPanel();
        }
    });

    // ── Rotate handle ──
    const rotateHandle = el.querySelector('.hb-sticker-rotate');
    if (rotateHandle) {
        let isRotating = false;
        let rotateStartAngle = 0;

        rotateHandle.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            isRotating = true;
            const rect = el.getBoundingClientRect();
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            rotateStartAngle = Math.atan2(e.clientY - cy, e.clientX - cx) * (180 / Math.PI) - currentRotation;
            rotateHandle.setPointerCapture(e.pointerId);
        });

        rotateHandle.addEventListener('pointermove', (e) => {
            if (!isRotating) return;
            e.preventDefault();
            const rect = el.getBoundingClientRect();
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            const angle = Math.atan2(e.clientY - cy, e.clientX - cx) * (180 / Math.PI);
            currentRotation = angle - rotateStartAngle;
            applyTransform();
        });

        rotateHandle.addEventListener('pointerup', () => {
            isRotating = false;
            _saveLayerPositions();
        });
    }

    // ── Scale Resize handle (for stickers) ──
    const scaleHandle = el.querySelector('.hb-sticker-resize');
    if (scaleHandle) {
        let isScaling = false;
        let scaleStartX = 0;
        let scaleStartY = 0;
        let scaleStartValue = 1;

        scaleHandle.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            isScaling = true;
            scaleStartX = e.clientX;
            scaleStartY = e.clientY;
            scaleStartValue = currentScale;
            scaleHandle.setPointerCapture(e.pointerId);
        });

        scaleHandle.addEventListener('pointermove', (e) => {
            if (!isScaling) return;
            e.preventDefault();
            const dx = e.clientX - scaleStartX;
            const dy = e.clientY - scaleStartY;
            
            // Project dx, dy onto bottom-left vector (-1, 1). Distance = -dx + dy
            const projectedDelta = -dx + dy; 
            const deltaScale = projectedDelta / 150; // Smooth scaling
            
            currentScale = Math.max(0.3, Math.min(3, scaleStartValue + deltaScale));
            applyTransform();
        });

        scaleHandle.addEventListener('pointerup', () => {
            isScaling = false;
            _saveLayerPositions();
        });
    }

    // ── Resize handle (for response notes) ──
    const resizeHandle = el.querySelector('.hb-response-note-resize');
    if (resizeHandle) {
        let isResizing = false;
        let resizeStartX = 0;
        let resizeStartY = 0;
        let origWidth = 0;
        let origHeight = 0;

        resizeHandle.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            isResizing = true;
            resizeStartX = e.clientX;
            resizeStartY = e.clientY;
            origWidth = el.offsetWidth;
            origHeight = el.offsetHeight;
            resizeHandle.setPointerCapture(e.pointerId);
            el.style.maxWidth = 'none'; // Unlock max-width constraint defined in CSS
        });

        resizeHandle.addEventListener('pointermove', (e) => {
            if (!isResizing) return;
            e.preventDefault();
            const dw = e.clientX - resizeStartX;
            const dh = e.clientY - resizeStartY;
            const newW = Math.max(80, origWidth + dw);
            const newH = Math.max(40, origHeight + dh);
            el.style.width = `${newW}px`;
            el.style.height = `${newH}px`;
        });

        resizeHandle.addEventListener('pointerup', () => {
            isResizing = false;
            _saveLayerPositions();
        });
    }

    // ── Pinch zoom (touch) ──
    let initialPinchDist = null;
    let initialPinchScale = 1;

    el.addEventListener('touchstart', (e) => {
        if (e.touches.length === 2) {
            e.preventDefault();
            initialPinchDist = _getTouchDistance(e.touches);
            initialPinchScale = currentScale;
        }
    }, { passive: false });

    el.addEventListener('touchmove', (e) => {
        if (e.touches.length === 2 && initialPinchDist) {
            e.preventDefault();
            const dist = _getTouchDistance(e.touches);
            currentScale = Math.max(0.3, Math.min(3, initialPinchScale * (dist / initialPinchDist)));
            applyTransform();
        }
    }, { passive: false });

    el.addEventListener('touchend', () => {
        if (initialPinchDist) {
            initialPinchDist = null;
            _saveLayerPositions();
        }
    });

    // ── Mouse wheel zoom ──
    el.addEventListener('wheel', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const delta = e.deltaY > 0 ? -0.05 : 0.05;
        currentScale = Math.max(0.3, Math.min(3, currentScale + delta));
        applyTransform();
        _saveLayerPositions();
    }, { passive: false });
}

export function _selectSticker(el) {
    _deselectSticker();
    AppState.selectedSticker = el;
    el.classList.add('selected');
}

export function _deselectSticker() {
    if (AppState.selectedSticker) {
        AppState.selectedSticker.classList.remove('selected');
        AppState.selectedSticker = null;
    }
    _dismissBlockEditor();
}

/**
 * Save positions of all draggable elements (stickers + response notes).
 * Works for both diary pages and flyleaf.
 */
export function _saveLayerPositions() {
    const layer = document.getElementById('hb_sticker_layer');
    if (!layer) return;

    // ── Save response note position ──
    const responseNote = layer.querySelector('.hb-response-note');
    const responsePos = responseNote ? {
        x: responseNote.offsetLeft,
        y: responseNote.offsetTop,
        width: responseNote.offsetWidth,
        height: responseNote.style.height ? responseNote.offsetHeight : undefined,
        scale: _parseStickerScale(responseNote),
        rotation: _parseStickerRotation(responseNote),
    } : null;

    if (AppState.currentView === 'cover' && AppState.meta.cover.texts) {
        // ── Save cover custom texts positions ──
        layer.querySelectorAll('.hb-cover-text').forEach(el => {
            const id = el.dataset.textId;
            const match = AppState.meta.cover.texts.find(t => t.id === id);
            if (match) {
                match.x = el.offsetLeft;
                match.y = el.offsetTop;
            }
        });
    } else if (AppState.currentView === 'flyleaf') {
        AppState.meta.flyleaf.responsePos = responsePos || null;
    } else if (AppState.currentDiaryIndex >= 0 && AppState.currentDiaryIndex < AppState.meta.pages.length) {
        // ── Save sticker positions ──
        const stickers = [];
        layer.querySelectorAll('.hb-sticker:not(.hb-cover-text)').forEach(el => {
            stickers.push({
                stickerId: el.dataset.stickerId,
                x: el.offsetLeft,
                y: el.offsetTop,
                scale: _parseStickerScale(el),
                rotation: _parseStickerRotation(el),
            });
        });
        AppState.meta.pages[AppState.currentDiaryIndex].stickers = stickers;
        AppState.meta.pages[AppState.currentDiaryIndex].responsePos = responsePos || null;
    }

    // Debounced save
    clearTimeout(_saveLayerPositions._timer);
    _saveLayerPositions._timer = setTimeout(async () => {
        const stHeaders = AppState.initData.stRequestHeaders || {};
        await saveHandbookMeta(AppState.meta, AppState.charId, stHeaders);
        console.log(`${LOG} Layer positions saved`);
    }, 500);
}

// Keep old name as alias for any potential external calls
export function _saveStickerPositions() { _saveLayerPositions(); }

export async function _loadPageStickers(page) {
    const layer = document.getElementById('hb_sticker_layer');
    if (!layer || !page?.stickers?.length) return;

    const stHeaders = AppState.initData.stRequestHeaders || {};

    for (const stk of page.stickers) {
        // Ensure image is cached
        if (!AppState.stickerImageCache.has(stk.stickerId)) {
            const url = await loadStickerImage(AppState.charId, stk.stickerId, stHeaders);
            if (url) AppState.stickerImageCache.set(stk.stickerId, url);
        }
        if (AppState.stickerImageCache.has(stk.stickerId)) {
            _placeSticker(stk.stickerId, {
                x: stk.x, y: stk.y,
                scale: stk.scale ?? 1,
                rotation: stk.rotation ?? 0,
            });
        }
    }
}

// ── Sticker Helpers ──

export function _parseStickerScale(el) {
    const match = el.style.transform?.match(/scale\(([^)]+)\)/);
    return match ? parseFloat(match[1]) : 1;
}

export function _parseStickerRotation(el) {
    const match = el.style.transform?.match(/rotate\(([^)]+)deg\)/);
    return match ? parseFloat(match[1]) : 0;
}

export function _getTouchDistance(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
}
