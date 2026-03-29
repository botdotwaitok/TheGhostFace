import { initCanvas, setOnStrokeEndCallback, clearCanvas, hasContent, exportAsDataUrl, loadFromDataUrl } from './handbookCanvas.js';
import { uploadCanvasPage, saveHandbookMeta, loadHandbookPage, loadHandbookResponse, nextPageId } from './handbookStorage.js';
import { AppState } from './handbookState.js';
import { _renderTocPanel, _getPageStyleInline } from './handbookNavigationUI.js';
import { _placeResponseNote, _deselectSticker, _loadPageStickers } from './handbookInteractables.js';
import { LOG } from './handbookEngine.js';

// ═══════════════════════════════════════════════════════════════════════
// Diary Page
// ═══════════════════════════════════════════════════════════════════════

export async function _renderDiaryPage(container) {
    const isNew = AppState.currentDiaryIndex < 0;
    const page = !isNew ? AppState.meta.pages[AppState.currentDiaryIndex] : null;
    // Per-page pattern, fallback to global
    const pattern = page?.pattern || AppState.meta.settings?.pagePattern || 'dots';
    const isCustom = pattern === 'custom';

    container.innerHTML = `
        <div class="hb-page-wrapper">
            <div class="hb-page" id="hb_current_page">
                <div class="hb-page-paper ${isCustom ? 'hb-pattern-custom' : ''}" id="hb_page_paper"
                     style="${isCustom && AppState.customBgUrl ? `background-image: url('${AppState.customBgUrl}'); background-size: cover; background-position: center;` : _getPageStyleInline(page)}">
                    <div class="hb-canvas-area">
                        <canvas class="hb-canvas" id="hb_canvas"></canvas>
                        <div class="hb-sticker-layer" id="hb_sticker_layer"></div>
                    </div>
                    <div class="hb-page-footer">
                        <span class="hb-page-number" id="hb_page_number">${isNew ? `PAGE ${AppState.meta.pages.length + 1}` : `PAGE ${AppState.currentDiaryIndex + 1}`}</span>
                    </div>
                </div>
            </div>
        </div>
    `;

    const canvas = document.getElementById('hb_canvas');
    if (canvas) {
        initCanvas(canvas, { inkColor: AppState.meta.settings?.userInkColor || '#2c3e50', lineWidth: 3 });
    }

    // ── Auto-save on stroke end (debounced) ──
    setOnStrokeEndCallback(() => _debouncedAutoSaveDiary());

    if (!isNew) {
        await _loadDiaryPageData(AppState.currentDiaryIndex);
    }

    // Deselect sticker/response-note on page click
    document.getElementById('hb_current_page')?.addEventListener('pointerdown', (e) => {
        if (!e.target.closest('.hb-sticker') && !e.target.closest('.hb-response-note') && !e.target.closest('.hb-block-editor')) {
            _deselectSticker();
        }
    });
}

// ── Debounced diary auto-save ──
let _diaryAutoSaveTimer = null;
let _diaryAutoSaveLock = false;  // Prevents race between auto-save and heart button

export function _debouncedAutoSaveDiary() {
    clearTimeout(_diaryAutoSaveTimer);
    _diaryAutoSaveTimer = setTimeout(() => _autoSaveDiaryCanvas(), 2000);
}

export function _setDiaryAutoSaveLock(val) {
    _diaryAutoSaveLock = val;
}

/** Cancel any pending auto-save (called before heart button submit) */
export function _cancelPendingAutoSave() {
    clearTimeout(_diaryAutoSaveTimer);
}

export async function _autoSaveDiaryCanvas() {
    if (_diaryAutoSaveLock) return; // Heart button is in progress, skip
    if (!hasContent() && AppState.currentDiaryIndex < 0) return; // Do not auto-create a new page if the canvas is blank
    try {
        const stHeaders = AppState.initData.stRequestHeaders || {};
        const canvasDataUrl = exportAsDataUrl(0.8);
        if (!canvasDataUrl) {
            console.warn(`${LOG} Canvas export returned empty — skipping auto-save (tainted?)`);
            return;
        }

        // Determine page ID — for new pages, auto-create a metadata entry
        let pageId;
        if (AppState.currentDiaryIndex >= 0) {
            pageId = AppState.meta.pages[AppState.currentDiaryIndex].id;
        } else {
            // New page: create meta entry so it's not lost
            pageId = nextPageId(AppState.meta);
            const s = AppState.meta.settings || {};
            AppState.meta.pages.push({
                id: pageId,
                date: new Date().toISOString().split('T')[0],
                moodText: '',
                canvasFile: `${pageId}.webp`,
                responseFile: `resp_${pageId}.json`,
                pattern: s.pagePattern || 'dots',
                pageColor: s.pageColor || '#fefcf7',
                patternStyle: s.patternStyle ? { ...s.patternStyle } : undefined,
            });
            AppState.currentDiaryIndex = AppState.meta.pages.length - 1;
            await saveHandbookMeta(AppState.meta, AppState.charId, stHeaders);
            _renderTocPanel(); // Immediately show new page in TOC
        }

        await uploadCanvasPage(canvasDataUrl, AppState.charId, pageId, stHeaders);
        console.log(`${LOG} Diary canvas auto-saved (page: ${pageId})`);
    } catch (e) {
        console.warn(`${LOG} Diary auto-save failed:`, e);
    }
}

export async function _loadDiaryPageData(index) {
    if (index < 0 || index >= AppState.meta.pages.length) return;
    const page = AppState.meta.pages[index];
    const stHeaders = AppState.initData.stRequestHeaders || {};

    const canvasData = await loadHandbookPage(AppState.charId, page.id, stHeaders);
    if (canvasData) await loadFromDataUrl(canvasData);
    else clearCanvas();

    // Load response as draggable note on sticker layer
    const respData = await loadHandbookResponse(AppState.charId, page.id, stHeaders);
    AppState.responseCache.set(page.id, respData || null);
    if (respData) {
        await _placeResponseNote(respData, {
            x: page.responsePos?.x,
            y: page.responsePos?.y,
            width: page.responsePos?.width,
            scale: page.responsePos?.scale,
            rotation: page.responsePos?.rotation,
        });
    }

    // Load stickers for this page
    await _loadPageStickers(page);
}

// _renderResponse removed — replaced by _placeResponseNote on the sticker layer
