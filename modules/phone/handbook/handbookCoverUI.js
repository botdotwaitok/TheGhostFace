import { TEXT_FONT_PRESETS } from './handbookConstants.js';
import { A4_WIDTH, A4_HEIGHT } from './handbookCanvas.js';
import { saveHandbookMeta, uploadCoverImage, loadCoverImage } from './handbookStorage.js';
import { AppState } from './handbookState.js';
import { _loadGoogleFont } from './handbookToolbarUI.js';
import { _toggleMenu } from './handbookNavigationUI.js';
import { _dismissBlockEditor, _initDraggableInteraction, _deselectSticker } from './handbookInteractables.js';
import { LOG, _escapeHtml, _switchToView } from './handbookEngine.js';

// ═══════════════════════════════════════════════════════════════════════
// Cover Page
// ═══════════════════════════════════════════════════════════════════════

export function _renderCover(container) {
    const cover = AppState.meta.cover;
    const bgAttr = cover.type === 'image' && AppState.coverImageUrl
        ? `style="background-image: url('${AppState.coverImageUrl}'); background-size: cover; background-position: center;"`
        : `style="background-color: ${cover.color || '#2c3e50'};"`;

    container.innerHTML = `
        <div class="hb-page-wrapper">
            <div class="hb-page" id="hb_cover_page">
                <div class="hb-page-paper" style="border-radius: 4px 16px 16px 4px; overflow: hidden; height: 842px;">
                    <div class="hb-cover" style="position: absolute; inset: 0; width: auto; height: auto;">
                        <div class="hb-cover-bg" ${bgAttr}></div>
                        <div class="hb-sticker-layer" id="hb_sticker_layer">
                            <!-- Draggable text blocks -->
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    document.getElementById('hb_cover_page')?.addEventListener('pointerdown', (e) => {
        // Deselect text and commit edits if clicking outside
        if (e.target.closest('.hb-cover-text') || e.target.closest('.hb-cover-text-overlay') || e.target.closest('.hb-cover-editor')) return;
        if (typeof _deselectSticker === 'function') _deselectSticker();
        if (window._hbCurrentCoverEditorCommit) window._hbCurrentCoverEditorCommit();
    });

    const layer = document.getElementById('hb_sticker_layer');
    if (layer && cover.texts) {
        cover.texts.forEach(txtObj => {
            _placeCoverTextItem(txtObj, layer);
        });
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Cover Editor
// ═══════════════════════════════════════════════════════════════════════

export function _renderCoverEditor(container, isInMenu = false) {
    const cover = AppState.meta.cover;
    const currentType = cover.type || 'color';

    function _updateCoverPreviewLive() {
        if (AppState.currentView === 'cover') {
            const contentArea = document.getElementById('hb_content_area');
            if (contentArea) _renderCover(contentArea);
        }
    }

    container.innerHTML = `
        <div class="hb-cover-editor">
            ${isInMenu ? '' : '<h2>自定义封面</h2>'}
            <div class="hb-cover-type-toggle">
                <button data-type="color" class="${currentType === 'color' ? 'active' : ''}">纯色</button>
                <button data-type="image" class="${currentType === 'image' ? 'active' : ''}">上传图片</button>
            </div>

            <!-- Color mode -->
            <div id="hb_cover_color_section" style="${currentType === 'image' ? 'display:none' : ''}">
                <div class="hb-cover-editor-label">封面背景色</div>
                <div style="display:flex; align-items:center; gap: 12px;">
                    <input type="color" id="hb_cover_color_picker" value="${cover.color || '#2c3e50'}" class="hb-native-color-picker">
                    <span id="hb_cover_hex_label">${cover.color || '#2c3e50'}</span>
                </div>
            </div>

            <!-- Image mode -->
            <div id="hb_cover_image_section" style="${currentType === 'color' ? 'display:none' : ''}">
                <div class="hb-cover-upload-area" id="hb_cover_upload_area">
                    <i class="ph ph-upload-simple"></i>
                    <div>点击选择封面图片</div>
                </div>
                ${AppState.coverImageUrl ? `<img class="hb-cover-upload-preview" src="${AppState.coverImageUrl}">` : ''}
            </div>

            <div class="hb-cover-editor-label" style="margin-top:20px;">自由文字</div>
            <button class="hb-cover-add-text-btn" id="hb_cover_add_text_btn">
                <i class="ph ph-text-t"></i> 添加文字块
            </button>
            <div style="font-size:12px; opacity:0.6; margin-top:8px;">
                在封面上点击文字快可修改内容和样式，拖拽可调整位置。
            </div>

            <button class="hb-cover-save-btn" id="hb_cover_save_btn" style="margin-top:24px;">保存封面</button>
        </div>
    `;

    // Type toggle
    container.querySelectorAll('.hb-cover-type-toggle button').forEach(btn => {
        btn.addEventListener('click', () => {
            container.querySelectorAll('.hb-cover-type-toggle button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const type = btn.dataset.type;
            const colorSec = document.getElementById('hb_cover_color_section');
            const imgSec = document.getElementById('hb_cover_image_section');
            if (colorSec) colorSec.style.display = type === 'color' ? '' : 'none';
            if (imgSec) imgSec.style.display = type === 'image' ? '' : 'none';
            AppState.meta.cover.type = type;
            _updateCoverPreviewLive();
        });
    });

    // Color picker
    const colorPicker = document.getElementById('hb_cover_color_picker');
    const hexLabel = document.getElementById('hb_cover_hex_label');
    colorPicker?.addEventListener('input', (e) => {
        const c = e.target.value;
        if (hexLabel) hexLabel.textContent = c;
        AppState.meta.cover.color = c;
        _updateCoverPreviewLive();
    });

    // Add Text button
    document.getElementById('hb_cover_add_text_btn')?.addEventListener('click', () => {
        const newText = {
            id: 'txt_' + Date.now().toString(36),
            text: '新文字',
            x: A4_WIDTH / 2 - 40,
            y: A4_HEIGHT / 2 - 20,
            color: '#ffffff',
            fontSize: 24,
            fontFamily: "'Inter', 'Noto Sans SC', sans-serif",
            bold: false,
            italic: false,
            align: 'center',
            textStyle: 'plain'
        };
        if (!AppState.meta.cover.texts) AppState.meta.cover.texts = [];
        AppState.meta.cover.texts.push(newText);
        
        // If viewing cover, place it immediately
        if (AppState.currentView === 'cover') {
            const layer = document.getElementById('hb_sticker_layer');
            if (layer) _placeCoverTextItem(newText, layer);
        }
        
        // Auto-save
        saveHandbookMeta(AppState.meta, AppState.charId, AppState.initData.stRequestHeaders || {}).catch(e => console.error(e));
    });

    // Upload area click
    document.getElementById('hb_cover_upload_area')?.addEventListener('click', () => {
        document.getElementById('hb_cover_file_input')?.click();
    });

    // Save button
    document.getElementById('hb_cover_save_btn')?.addEventListener('click', () => _handleCoverSave(isInMenu));
}

export async function _onCoverFileSelected(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
        const stHeaders = AppState.initData.stRequestHeaders || {};
        await uploadCoverImage(file, AppState.charId, stHeaders);
        if (AppState.coverImageUrl) URL.revokeObjectURL(AppState.coverImageUrl);
        AppState.coverImageUrl = await loadCoverImage(AppState.charId, stHeaders);
        AppState.meta.cover.type = 'image';
        
        const preview = document.querySelector('.hb-cover-upload-preview');
        if (preview) {
            preview.src = AppState.coverImageUrl;
        } else {
            const area = document.getElementById('hb_cover_upload_area');
            if (area) area.insertAdjacentHTML('afterend', `<img class="hb-cover-upload-preview" src="${AppState.coverImageUrl}">`);
        }
        if (AppState.currentView === 'cover') {
            const contentArea = document.getElementById('hb_content_area');
            if (contentArea) _renderCover(contentArea);
        }
    } catch (err) {
        alert('封面上传失败: ' + err.message);
    }
}

export async function _handleCoverSave(isInMenu) {
    AppState.meta.cover._saved = true;
    try {
        const stHeaders = AppState.initData.stRequestHeaders || {};
        await saveHandbookMeta(AppState.meta, AppState.charId, stHeaders);
    } catch (err) {
        console.error(`${LOG} Cover save failed:`, err);
    }

    if (isInMenu) {
        _toggleMenu();
        if (AppState.currentView === 'cover') _switchToView('cover');
    } else {
        _switchToView('flyleaf', 1);
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Cover Custom Text Logic
// ═══════════════════════════════════════════════════════════════════════

export function _placeCoverTextItem(txtObj, layer) {
    const el = document.createElement('div');
    el.className = 'hb-cover-text hb-sticker'; // hb-sticker for drag system
    el.dataset.textId = txtObj.id;
    
    // Position
    el.style.cssText = `
        left: ${txtObj.x}px; 
        top: ${txtObj.y}px;
    `;
    
    // Apply styling
    _applyCoverTextStyle(el, txtObj);
    
    layer.appendChild(el);
    _initDraggableInteraction(el);
    
    // Double click or simple click to edit
    let pressTimer;
    el.addEventListener('pointerdown', () => {
        pressTimer = setTimeout(() => {}, 200); // threshold
    });
    
    el.addEventListener('pointerup', (e) => {
        if (!el.classList.contains('dragging_active')) {
            _showCoverTextEditor(txtObj, el);
        }
    });

    // Detect true dragging so we don't open editor on drop
    el.addEventListener('pointermove', () => el.classList.add('dragging_active'));
    el.addEventListener('pointerdown', () => el.classList.remove('dragging_active'));
}

export function _applyCoverTextStyle(el, txtObj, skipTextUpdate = false) {
    const bold = txtObj.bold ? 'font-weight:bold;' : 'font-weight:normal;';
    const italic = txtObj.italic ? 'font-style:italic;' : 'font-style:normal;';
    const glassClass = txtObj.textStyle === 'glass' ? 'hb-cover-text-glass' : '';
    
    let inner = el.querySelector('.hb-cover-text-inner');
    if (!inner) {
        el.innerHTML = `
            <div class="hb-cover-text-inner"></div>
            <button class="hb-sticker-delete"><i class="ph ph-x"></i></button>
        `;
        inner = el.querySelector('.hb-cover-text-inner');
    }

    inner.className = `hb-cover-text-inner ${glassClass}`;
    inner.style.cssText = `
        color: ${txtObj.color}; 
        font-size: ${txtObj.fontSize}px;
        font-family: ${txtObj.fontFamily};
        text-align: ${txtObj.align};
        ${bold} ${italic}
    `;
    
    if (!skipTextUpdate) {
        inner.innerHTML = _escapeHtml(txtObj.text).replace(/\\n/g, '<br>');
    }
}

export function _showCoverTextEditor(txtObj, domElement) {
    // Dismiss any existing overlays and commit their text
    if (window._hbCurrentCoverEditorCommit) {
        window._hbCurrentCoverEditorCommit();
    }
    
    document.querySelector('.hb-text-input-overlay')?.remove();
    _dismissBlockEditor();

    // DOM coordinates
    const rect = domElement.getBoundingClientRect();
    const overlay = document.createElement('div');
    overlay.className = 'hb-text-input-overlay hb-cover-text-overlay';
    
    let domTop = rect.bottom + 10;
    if (domTop + 200 > window.innerHeight) domTop = rect.top - 200; // open above if space limited
    
    overlay.style.cssText = `
        position: fixed;
        left: ${Math.max(10, rect.left)}px;
        top: ${domTop}px;
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
        if (f.value === txtObj.fontFamily) opt.selected = true;
        fontSelect.appendChild(opt);
    });
    // Size selector
    const sizeSelect = document.createElement('select');
    sizeSelect.className = 'hb-text-size-select';
    [12, 14, 16, 20, 24, 28, 32, 36, 48, 64, 72].forEach(s => {
        const opt = document.createElement('option');
        opt.value = s;
        opt.textContent = s + 'px';
        if (s === txtObj.fontSize) opt.selected = true;
        sizeSelect.appendChild(opt);
    });
    
    // Style toggle
    const styleBtn = document.createElement('button');
    styleBtn.className = 'hb-text-style-btn' + (txtObj.textStyle === 'glass' ? ' active' : '');
    styleBtn.innerHTML = '<i class="ph ph-drop"></i>';
    styleBtn.title = '毛玻璃背景';

    const boldBtn = document.createElement('button');
    boldBtn.className = 'hb-text-style-btn' + (txtObj.bold ? ' active' : '');
    boldBtn.innerHTML = '<b>B</b>';
    boldBtn.title = '粗体';

    const italicBtn = document.createElement('button');
    italicBtn.className = 'hb-text-style-btn' + (txtObj.italic ? ' active' : '');
    italicBtn.innerHTML = '<i>I</i>';
    italicBtn.title = '斜体';

    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.value = txtObj.color || '#ffffff';
    colorInput.className = 'hb-native-color-picker hb-text-overlay-color';

    toolbar.appendChild(fontSelect);
    toolbar.appendChild(sizeSelect);
    toolbar.appendChild(styleBtn);
    toolbar.appendChild(boldBtn);
    toolbar.appendChild(italicBtn);
    toolbar.appendChild(colorInput);

    const applyPreview = () => {
        // update actual DOM element immediately, skip rewriting innerHTML
        _applyCoverTextStyle(domElement, txtObj, true);
    };

    // ── Confirm button ──
    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'hb-text-confirm-btn';
    confirmBtn.innerHTML = '<i class="ph ph-check"></i>';

    const bottomRow = document.createElement('div');
    bottomRow.className = 'hb-text-bottom-row';
    bottomRow.appendChild(confirmBtn);

    overlay.appendChild(toolbar);
    overlay.appendChild(bottomRow);
    document.body.appendChild(overlay);

    // ── Enable inline editing ──
    const inner = domElement.querySelector('.hb-cover-text-inner');
    if (inner) {
        inner.contentEditable = 'true';
        inner.focus();
        
        // Select all text
        const range = document.createRange();
        range.selectNodeContents(inner);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
    }

    // ── Bindings ──
    fontSelect.addEventListener('change', () => {
        txtObj.fontFamily = fontSelect.value;
        const preset = TEXT_FONT_PRESETS.find(f => f.value === fontSelect.value);
        if (preset && !preset.loaded && preset.url) {
            _loadGoogleFont(preset.url);
            preset.loaded = true;
        }
        applyPreview();
    });
    sizeSelect.addEventListener('change', () => { txtObj.fontSize = parseInt(sizeSelect.value); applyPreview(); });
    boldBtn.addEventListener('click', () => { txtObj.bold = !txtObj.bold; boldBtn.classList.toggle('active', txtObj.bold); applyPreview(); });
    italicBtn.addEventListener('click', () => { txtObj.italic = !txtObj.italic; italicBtn.classList.toggle('active', txtObj.italic); applyPreview(); });
    styleBtn.addEventListener('click', () => { 
        txtObj.textStyle = txtObj.textStyle === 'glass' ? 'plain' : 'glass'; 
        styleBtn.classList.toggle('active', txtObj.textStyle === 'glass'); 
        applyPreview(); 
    });
    colorInput.addEventListener('input', (e) => { txtObj.color = e.target.value; applyPreview(); });

    const commitAndClose = () => {
        if (inner) {
            inner.contentEditable = 'false';
            txtObj.text = inner.innerText; // Commit final text with line breaks as \n
        }
        overlay.remove();
        if (window._hbCurrentCoverEditorCommit === commitAndClose) {
            window._hbCurrentCoverEditorCommit = null;
        }
        saveHandbookMeta(AppState.meta, AppState.charId, AppState.initData.stRequestHeaders || {}).catch(e => console.error(e));
    };

    window._hbCurrentCoverEditorCommit = commitAndClose;

    confirmBtn.addEventListener('click', commitAndClose);
    
    if (inner) {
        inner.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commitAndClose(); }
            if (e.key === 'Escape') commitAndClose();
        });
    }
}
