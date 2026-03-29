import { PRESET_COLORS, TEXT_FONT_PRESETS, TEXT_SIZE_OPTIONS, HB_TEXT_PREFS_KEY } from './handbookConstants.js';
import { A4_WIDTH, A4_HEIGHT, renderTextOnCanvas, setInkColor, getBrushType, setEraserMode, isEraserMode, setActiveMode, getActiveMode, getEraserSize, getInkColor, getLineWidth } from './handbookCanvas.js';
import { saveHandbookMeta } from './handbookStorage.js';
import { AppState } from './handbookState.js';
import { LOG } from './handbookEngine.js';

// ═══════════════════════════════════════════════════════════════════════
// Color System Helpers
// ═══════════════════════════════════════════════════════════════════════

export function _selectColor(color) {
    if (!color) return;
    document.querySelectorAll('.hb-color-btn').forEach(b => b.classList.remove('selected'));
    const match = document.querySelector(`.hb-color-btn[data-color="${color}"]`);
    if (match) match.classList.add('selected');
    setInkColor(color);
    setEraserMode(false);
    _updateToolButtonStates();
}

export function _addRecentColor(color) {
    if (!AppState.meta?.settings) return;
    if (!AppState.meta.settings.recentColors) AppState.meta.settings.recentColors = [];
    // Remove if exists, push to front
    AppState.meta.settings.recentColors = AppState.meta.settings.recentColors.filter(c => c !== color);
    AppState.meta.settings.recentColors.unshift(color);
    if (AppState.meta.settings.recentColors.length > 8) AppState.meta.settings.recentColors.pop();
    // Persist
    const stHeaders = AppState.initData?.stRequestHeaders || {};
    saveHandbookMeta(AppState.meta, AppState.charId, stHeaders).catch(e => console.warn(`${LOG} Save recent colors failed:`, e));
    
    // Update toolbar buttons to reflect the new colors
    _renderToolbarColors();
}

export function _renderToolbarColors() {
    const container = document.getElementById('hb_color_slots');
    if (!container) return;

    let recent = AppState.meta?.settings?.recentColors || [];
    let colors = [...recent];
    for (const c of PRESET_COLORS) {
        if (colors.length >= 6) break;
        if (!colors.includes(c)) colors.push(c);
    }
    colors = colors.slice(0, 6);

    const currentColor = typeof getInkColor === 'function' ? getInkColor() : PRESET_COLORS[0];

    container.innerHTML = colors.map(c => `
        <button class="hb-color-btn ${c === currentColor ? 'selected' : ''}" 
                style="background: ${c};" data-color="${c}" title="颜色"></button>
    `).join('');

    container.querySelectorAll('.hb-color-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            _selectColor(btn.dataset.color);
        });
    });
}

// (_updateEraserButton removed — superseded by _updateToolButtonStates)

// ═══════════════════════════════════════════════════════════════════════
// Tool Mode Management
// ═══════════════════════════════════════════════════════════════════════

/**
 * Switch to a tool mode: 'draw', 'shape', or 'text'.
 * Clears eraser, updates canvas mode, and highlights the correct button.
 */
export function _setToolMode(mode) {
    setActiveMode(mode);
    setEraserMode(false);
    _updateToolButtonStates();
    _updateCursorSize();
}

/**
 * Update all toolbar buttons to reflect the current active tool.
 * Also toggles pointer-events on stickers/response-notes so drawing
 * tools can paint through them.
 */
export function _updateToolButtonStates() {
    const mode = getActiveMode();
    const eraser = isEraserMode();
    const isDrawing = (mode === 'draw' && !eraser) || mode === 'shape' || mode === 'text' || mode === 'tape' || eraser;

    // Pen box
    const penBtn = document.getElementById('hb_pen_box_btn');
    if (penBtn) penBtn.classList.toggle('active', mode === 'draw' && !eraser);

    // Shape
    const shapeBtn = document.getElementById('hb_shape_btn');
    if (shapeBtn) shapeBtn.classList.toggle('active', mode === 'shape');

    // Text
    const textBtn = document.getElementById('hb_text_btn');
    if (textBtn) textBtn.classList.toggle('active', mode === 'text');

    // Tape
    const tapeBtn = document.getElementById('hb_tape_btn');
    if (tapeBtn) tapeBtn.classList.toggle('active', mode === 'tape');

    // Eraser
    const eraserBtn = document.getElementById('hb_eraser_btn');
    if (eraserBtn) eraserBtn.classList.toggle('active', eraser);

    // Canvas cursor class
    const canvas = document.getElementById('hb_canvas');
    if (canvas) {
        canvas.classList.toggle('eraser-mode', eraser);
        canvas.classList.toggle('text-mode', mode === 'text');
        canvas.classList.toggle('shape-mode', mode === 'shape');
        canvas.classList.toggle('tape-mode', mode === 'tape');
    }

    // Toggle pointer-events on stickers/response-notes:
    // When a drawing tool is active, let events pass through to canvas.
    const layer = document.getElementById('hb_sticker_layer');
    if (layer) {
        const pe = isDrawing ? 'none' : 'auto';
        layer.querySelectorAll('.hb-sticker, .hb-response-note').forEach(el => {
            el.style.pointerEvents = pe;
        });
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Text Input Overlay
// ═══════════════════════════════════════════════════════════════════════

/**
 * Show a floating textarea on the canvas at (x, y) for text input.
 * When confirmed (Enter or blur), renders the text onto the canvas.
 */
export function _showTextInputOverlay(canvasX, canvasY) {
    // Remove any existing overlay
    document.querySelector('.hb-text-input-overlay')?.remove();

    // Load saved preferences
    const prefs = _loadTextPrefs();

    // Convert canvas coords to DOM coords
    const canvasEl = document.getElementById('hb_canvas');
    if (!canvasEl) return;
    const rect = canvasEl.getBoundingClientRect();
    const scaleX = rect.width / A4_WIDTH;
    const scaleY = rect.height / A4_HEIGHT;

    const domX = rect.left + canvasX * scaleX;
    const domY = rect.top + canvasY * scaleY;

    const overlay = document.createElement('div');
    overlay.className = 'hb-text-input-overlay';
    overlay.style.cssText = `
        position: fixed;
        left: ${domX}px;
        top: ${domY}px;
        z-index: 200;
    `;

    // ── Rich text toolbar ──
    const toolbar = document.createElement('div');
    toolbar.className = 'hb-text-toolbar';

    // Font family selector
    const fontSelect = document.createElement('select');
    fontSelect.className = 'hb-text-font-select';
    TEXT_FONT_PRESETS.forEach(f => {
        const opt = document.createElement('option');
        opt.value = f.value;
        opt.textContent = f.name;
        opt.style.fontFamily = f.value;
        if (f.value === prefs.fontFamily) opt.selected = true;
        fontSelect.appendChild(opt);
    });
    // Custom font option
    const customOpt = document.createElement('option');
    customOpt.value = '__custom__';
    customOpt.textContent = '自定义字体…';
    if (prefs.customFontName) {
        customOpt.value = `'${prefs.customFontName}', sans-serif`;
        customOpt.textContent = prefs.customFontName;
        customOpt.selected = true;
    }
    fontSelect.appendChild(customOpt);

    // Font size selector
    const sizeSelect = document.createElement('select');
    sizeSelect.className = 'hb-text-size-select';
    TEXT_SIZE_OPTIONS.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s;
        opt.textContent = s + 'px';
        if (s === prefs.fontSize) opt.selected = true;
        sizeSelect.appendChild(opt);
    });

    // Bold button
    const boldBtn = document.createElement('button');
    boldBtn.className = 'hb-text-style-btn' + (prefs.bold ? ' active' : '');
    boldBtn.innerHTML = '<b>B</b>';
    boldBtn.title = '粗体';

    // Italic button
    const italicBtn = document.createElement('button');
    italicBtn.className = 'hb-text-style-btn' + (prefs.italic ? ' active' : '');
    italicBtn.innerHTML = '<i>I</i>';
    italicBtn.title = '斜体';

    toolbar.appendChild(fontSelect);
    toolbar.appendChild(sizeSelect);
    toolbar.appendChild(boldBtn);
    toolbar.appendChild(italicBtn);

    // ── Textarea ──
    const textarea = document.createElement('textarea');
    textarea.className = 'hb-text-textarea';
    textarea.placeholder = '输入文字…';
    textarea.rows = 3;
    textarea.cols = 20;
    _applyTextPreviewStyle(textarea, prefs);

    // ── Custom font URL section (hidden by default) ──
    const customSection = document.createElement('div');
    customSection.className = 'hb-text-custom-font-section';
    customSection.style.display = prefs.customFontName ? 'flex' : 'none';
    customSection.innerHTML = `
        <input type="text" class="hb-text-custom-font-name" placeholder="字体名称 (如 Ma Shan Zheng)" value="${prefs.customFontName || ''}">
        <input type="text" class="hb-text-custom-font-url" placeholder="Google Fonts URL (粘贴链接)" value="${prefs.customFontUrl || ''}">
    `;

    // ── Confirm button ──
    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'hb-text-confirm-btn';
    confirmBtn.innerHTML = '<i class="ph ph-check"></i>';

    // ── Bottom row (custom section + confirm) ──
    const bottomRow = document.createElement('div');
    bottomRow.className = 'hb-text-bottom-row';
    bottomRow.appendChild(customSection);
    bottomRow.appendChild(confirmBtn);

    overlay.appendChild(toolbar);
    overlay.appendChild(textarea);
    overlay.appendChild(bottomRow);
    document.body.appendChild(overlay);

    textarea.focus();

    // ── State tracking ──
    let currentPrefs = { ...prefs };

    // ── Event handlers ──
    fontSelect.addEventListener('change', () => {
        const val = fontSelect.value;
        if (val === '__custom__') {
            customSection.style.display = 'flex';
            return;
        }
        customSection.style.display = 'none';
        currentPrefs.fontFamily = val;
        currentPrefs.customFontName = '';
        currentPrefs.customFontUrl = '';
        _applyTextPreviewStyle(textarea, currentPrefs);
        // Ensure font is loaded
        const preset = TEXT_FONT_PRESETS.find(f => f.value === val);
        if (preset && !preset.loaded && preset.url) {
            _loadGoogleFont(preset.url);
            preset.loaded = true;
        }
    });

    sizeSelect.addEventListener('change', () => {
        currentPrefs.fontSize = parseInt(sizeSelect.value);
        _applyTextPreviewStyle(textarea, currentPrefs);
    });

    boldBtn.addEventListener('click', () => {
        currentPrefs.bold = !currentPrefs.bold;
        boldBtn.classList.toggle('active', currentPrefs.bold);
        _applyTextPreviewStyle(textarea, currentPrefs);
    });

    italicBtn.addEventListener('click', () => {
        currentPrefs.italic = !currentPrefs.italic;
        italicBtn.classList.toggle('active', currentPrefs.italic);
        _applyTextPreviewStyle(textarea, currentPrefs);
    });

    // Custom font name/url change
    const nameInput = customSection.querySelector('.hb-text-custom-font-name');
    const urlInput = customSection.querySelector('.hb-text-custom-font-url');
    const applyCustomFont = () => {
        const name = nameInput.value.trim();
        const url = urlInput.value.trim();
        if (name) {
            if (url) _loadGoogleFont(url);
            currentPrefs.fontFamily = `'${name}', sans-serif`;
            currentPrefs.customFontName = name;
            currentPrefs.customFontUrl = url;
            // Update dropdown display
            customOpt.value = currentPrefs.fontFamily;
            customOpt.textContent = name;
            fontSelect.value = currentPrefs.fontFamily;
            _applyTextPreviewStyle(textarea, currentPrefs);
        }
    };
    nameInput?.addEventListener('change', applyCustomFont);
    urlInput?.addEventListener('change', applyCustomFont);

    // ── Commit text ──
    const commitText = () => {
        const text = textarea.value.trim();
        if (text) {
            renderTextOnCanvas(text, canvasX, canvasY, {
                color: getInkColor(),
                fontSize: currentPrefs.fontSize,
                fontFamily: currentPrefs.fontFamily,
                bold: currentPrefs.bold,
                italic: currentPrefs.italic,
            });
        }
        _saveTextPrefs(currentPrefs);
        overlay.remove();
    };

    confirmBtn.addEventListener('click', commitText);

    textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            commitText();
        }
        if (e.key === 'Escape') {
            _saveTextPrefs(currentPrefs);
            overlay.remove();
        }
    });
}

/** Apply font preview styling to the textarea */
export function _applyTextPreviewStyle(textarea, prefs) {
    textarea.style.fontFamily = prefs.fontFamily;
    textarea.style.fontSize = prefs.fontSize + 'px';
    textarea.style.fontWeight = prefs.bold ? 'bold' : 'normal';
    textarea.style.fontStyle = prefs.italic ? 'italic' : 'normal';
}

/** Load text tool preferences from localStorage */
export function _loadTextPrefs() {
    try {
        const raw = localStorage.getItem(HB_TEXT_PREFS_KEY);
        if (raw) return { ...DEFAULT_TEXT_PREFS, ...JSON.parse(raw) };
    } catch { /* noop */ }
    return { ...DEFAULT_TEXT_PREFS };
}

export const DEFAULT_TEXT_PREFS = {
    fontFamily: "'Inter', 'Noto Sans SC', sans-serif",
    fontSize: 16,
    bold: false,
    italic: false,
    customFontName: '',
    customFontUrl: '',
};

/** Save text tool preferences to localStorage */
export function _saveTextPrefs(prefs) {
    try { localStorage.setItem(HB_TEXT_PREFS_KEY, JSON.stringify(prefs)); } catch { /* noop */ }
}

/** Dynamically load a Google Fonts URL */
export function _loadGoogleFont(url) {
    const id = 'hb_custom_font_' + url.replace(/\W/g, '').slice(0, 30);
    if (document.getElementById(id)) return;
    let href = url;
    const importMatch = url.match(/url\(['"]?([^)'"]+)['"]?\)/);
    if (importMatch) href = importMatch[1];
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
}

// ═══════════════════════════════════════════════════════════════════════
// Dynamic Canvas Cursor Preview
// ═══════════════════════════════════════════════════════════════════════

export function _initCursorPreview() {
    const cursor = document.getElementById('hb_canvas_cursor');
    if (!cursor) return;

    // Track pointer over canvas areas
    document.addEventListener('pointermove', (e) => {
        const canvasArea = e.target.closest('.hb-canvas-area');
        if (canvasArea) {
            cursor.style.left = `${e.clientX}px`;
            cursor.style.top = `${e.clientY}px`;
            if (!cursor.classList.contains('visible')) {
                cursor.classList.add('visible');
                _updateCursorSize();
            }
        } else {
            cursor.classList.remove('visible');
        }
    });

    // Hide cursor when pointer leaves the window
    document.addEventListener('pointerleave', () => {
        cursor.classList.remove('visible');
    });

    // Hide default cursor on canvas
    const style = document.createElement('style');
    style.textContent = `.hb-canvas-area canvas { cursor: none; }`;
    document.head.appendChild(style);
}

export function _updateCursorSize() {
    const cursor = document.getElementById('hb_canvas_cursor');
    if (!cursor) return;

    // Get current tool size — account for canvas scale
    const canvasEl = document.getElementById('hb_canvas');
    let scale = 1;
    if (canvasEl) {
        const displayW = canvasEl.getBoundingClientRect().width;
        const internalW = canvasEl.width; // retina width
        scale = displayW / internalW;
    }

    let size;
    if (isEraserMode()) {
        size = getEraserSize() * scale;
        cursor.classList.add('eraser-cursor');
    } else if (getActiveMode() === 'tape') {
        size = getLineWidth() * scale;
        cursor.classList.remove('eraser-cursor');
    } else {
        // Brush size: use lineWidth with brush type multiplier
        const brushCfg = { pen: 1, marker: 2.5, highlighter: 4, calligraphy: 1.8 };
        const mul = brushCfg[getBrushType()] || 1;
        size = getLineWidth() * mul * scale;
        cursor.classList.remove('eraser-cursor');
    }

    // Minimum 4px for visibility
    size = Math.max(4, size);
    cursor.style.width = `${size}px`;
    cursor.style.height = `${size}px`;
}
