import { initCanvas, setOnStrokeEndCallback, exportAsDataUrl, loadFromDataUrl } from './handbookCanvas.js';
import { uploadFlyleafCanvas, loadFlyleafCanvas } from './handbookStorage.js';
import { AppState } from './handbookState.js';
import { _getPageStyleInline } from './handbookNavigationUI.js';
import { _placeResponseNote } from './handbookInteractables.js';
import { LOG } from './handbookEngine.js';

// ═══════════════════════════════════════════════════════════════════════
// Flyleaf Page
// ═══════════════════════════════════════════════════════════════════════

export async function _renderFlyleaf(container) {
    container.innerHTML = `
        <div class="hb-flyleaf" id="hb_current_page">
            <div class="hb-page-paper" id="hb_page_paper" style="${_getPageStyleInline()}">
                <div class="hb-canvas-area">
                    <canvas class="hb-canvas" id="hb_canvas"></canvas>
                    <div class="hb-sticker-layer" id="hb_sticker_layer"></div>
                    <div class="hb-flyleaf-owner-overlay">
                        <span class="hb-flyleaf-owner-label">Owner</span>
                        <div class="hb-flyleaf-owner-line"></div>
                    </div>
                </div>
                <div class="hb-page-footer">
                    <span>FLYLEAF</span>
                </div>
            </div>
        </div>
    `;

    // Init canvas
    const canvas = document.getElementById('hb_canvas');
    if (canvas) {
        initCanvas(canvas, { inkColor: AppState.meta.settings?.userInkColor || '#2c3e50', lineWidth: 3 });
    }

    // ── Auto-save flyleaf on stroke end (debounced) ──
    let _flyleafSaveTimer = null;
    setOnStrokeEndCallback(() => {
        clearTimeout(_flyleafSaveTimer);
        _flyleafSaveTimer = setTimeout(() => _autoSaveFlyleafCanvas(), 2000);
    });

    // Load existing flyleaf canvas
    const stHeaders = AppState.initData.stRequestHeaders || {};
    const flyleafData = await loadFlyleafCanvas(AppState.charId, stHeaders);
    if (flyleafData) await loadFromDataUrl(flyleafData);

    // Render character message as draggable response note
    if (AppState.meta.flyleaf?.responseData || AppState.meta.flyleaf?.charMessage) {
        const respData = AppState.meta.flyleaf.responseData || {
            content: AppState.meta.flyleaf.charMessage,
            moodText: '',
        };
        await _placeResponseNote(respData, {
            x: AppState.meta.flyleaf.responsePos?.x,
            y: AppState.meta.flyleaf.responsePos?.y,
            width: AppState.meta.flyleaf.responsePos?.width,
            scale: AppState.meta.flyleaf.responsePos?.scale,
            rotation: AppState.meta.flyleaf.responsePos?.rotation,
        });
    }
}

export async function _autoSaveFlyleafCanvas() {
    try {
        const dataUrl = exportAsDataUrl(0.8);
        const stHeaders = AppState.initData.stRequestHeaders || {};
        await uploadFlyleafCanvas(dataUrl, AppState.charId, stHeaders);
        console.log(`${LOG} Flyleaf canvas auto-saved`);
    } catch (e) {
        console.warn(`${LOG} Flyleaf auto-save failed:`, e);
    }
}

// _renderCharMessage removed — flyleaf now uses _placeResponseNote on sticker layer
