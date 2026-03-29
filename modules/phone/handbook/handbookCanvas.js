// modules/phone/handbook/handbookCanvas.js — Canvas Handwriting Engine
// Pressure-sensitive drawing with Pointer Events, Bézier smoothing,
// color/width controls, eraser, command-based undo/redo.
// Brush system: pen, marker, highlighter, calligraphy.
// This module runs in the STANDALONE handbook window.

const LOG = '[HandBook Canvas]';

// ═══════════════════════════════════════════════════════════════════════
// Fixed A4 Canvas Dimensions
// ═══════════════════════════════════════════════════════════════════════
// A4 ratio ≈ 1:1.414. CSS display size is 595×842, but we render at
// 2× for retina clarity.  The canvas never resizes, so drawn content
// is never cleared by a dimension change.

export const A4_WIDTH  = 595;   // CSS px
export const A4_HEIGHT = 842;   // CSS px
const DPR = 2;                  // fixed retina multiplier

// ═══════════════════════════════════════════════════════════════════════
// Brush Configurations
// ═══════════════════════════════════════════════════════════════════════

const BRUSH_CONFIGS = {
    pen: {
        alpha: 1.0,
        widthMul: 1.0,
        lineCap: 'round',
        lineJoin: 'round',
        usePressure: true,
        useSpeed: true,
    },
    marker: {
        alpha: 0.85,
        widthMul: 2.5,
        lineCap: 'butt',
        lineJoin: 'bevel',
        usePressure: false,
        useSpeed: false,
    },
    highlighter: {
        alpha: 0.30,
        widthMul: 4.0,
        lineCap: 'butt',
        lineJoin: 'bevel',
        usePressure: false,
        useSpeed: false,
    },
    calligraphy: {
        alpha: 1.0,
        widthMul: 1.0,
        lineCap: 'square',
        lineJoin: 'miter',
        usePressure: true,
        useSpeed: false,
    },
};

// ═══════════════════════════════════════════════════════════════════════
// State
// ═══════════════════════════════════════════════════════════════════════

let _canvas = null;
let _ctx = null;

// Overlay canvas for shape preview (temporary drawing)
let _overlayCanvas = null;
let _overlayCtx = null;

// Drawing state
let _isDrawing = false;
let _lastX = 0;
let _lastY = 0;
let _lastMidX = 0;  // Midpoint B-spline: previous midpoint for gap-free strokes
let _lastMidY = 0;
let _lastPressure = 0.5;
let _lastTime = 0;

// Tool settings
let _inkColor = '#2c3e50';
let _lineWidth = 3;
let _isEraser = false;
let _eraserSize = 10;   // Variable eraser size
let _brushType = 'pen'; // 'pen' | 'marker' | 'highlighter' | 'calligraphy'

// Active drawing mode: 'draw' (freehand), 'shape', 'text'
let _activeMode = 'draw';

// Shape drawing state
let _shapeType = 'rectangle'; // 'rectangle' | 'ellipse' | 'line' | 'arrow'
let _shapeStartX = 0;
let _shapeStartY = 0;
let _fillColor = 'transparent'; // 'transparent' means no fill

// Dashed line toggle (applies to both freehand brushes and shapes)
let _dashEnabled = false;
let _dashOffsetDist = 0;

// Text input callback (set by engine to handle text placement)
let _textPlacementCallback = null;

// ═══════════════════════════════════════════════════════════════════════
// Command-based Undo/Redo System
// ═══════════════════════════════════════════════════════════════════════
// Instead of storing 8MB ImageData snapshots, we store lightweight
// command objects and replay them on undo. Typical session uses ~1-2MB
// vs ~160MB under the old approach.

/** @typedef {'stroke'|'shape'|'tape'|'text'|'clear'|'base_image'} CmdType */

/**
 * @type {Array<{type: CmdType, ...}>}
 * Stack of all drawing commands since page load / last clear.
 */
const _commandStack = [];
const _redoStack = [];

/**
 * In-progress stroke being recorded (null when not drawing)
 * @type {{ points: Array<{x,y,pressure,time}>, config: object }|null}
 */
let _currentStroke = null;

// Dirty flag: tracks whether canvas has any drawn content (P3 optimization)
let _hasDrawnContent = false;

// Touch fallback flag (for iPad Safari where pointer events may not fire)
let _usingTouchFallback = false;

// Apple Pencil-only mode: when true, finger touch does not draw
let _pencilOnlyMode = false;
let _penDetected = false;   // auto-detect: set true on first pen event

// Tape tool state
let _tapeImage = null;
let _tapePattern = null;
let _tapeOriginalSrc = null;  // Original URL before blob conversion, for undo replay

// Stroke-end callback (for auto-save)
let _onStrokeEndCallback = null;

// ═══════════════════════════════════════════════════════════════════════
// Init
// ═══════════════════════════════════════════════════════════════════════

/**
 * Initialize the canvas engine with fixed A4 dimensions.
 * Canvas size never changes after init → no resize-clears-content bug.
 * @param {HTMLCanvasElement} canvas
 * @param {object} [options]
 * @param {string} [options.inkColor='#2c3e50']
 * @param {number} [options.lineWidth=3]
 */
export function initCanvas(canvas, options = {}) {
    _canvas = canvas;
    _ctx = canvas.getContext('2d', { willReadFrequently: true });

    // Clear undo/redo stacks to prevent cross-page undo corruption (#10)
    _commandStack.length = 0;
    _redoStack.length = 0;
    _currentStroke = null;
    _hasDrawnContent = false;

    if (options.inkColor) _inkColor = options.inkColor;
    if (options.lineWidth) _lineWidth = options.lineWidth;

    // ── Fixed A4 sizing ──
    canvas.width  = A4_WIDTH  * DPR;
    canvas.height = A4_HEIGHT * DPR;
    _ctx.scale(DPR, DPR);
    _ctx.lineCap = 'round';
    _ctx.lineJoin = 'round';

    // ── Create overlay canvas for shape preview ──
    _overlayCanvas = document.createElement('canvas');
    _overlayCanvas.className = 'hb-canvas-overlay';
    _overlayCanvas.width  = A4_WIDTH  * DPR;
    _overlayCanvas.height = A4_HEIGHT * DPR;
    _overlayCanvas.style.cssText = `
        position: absolute; top: 0; left: 0;
        width: ${A4_WIDTH}px; height: ${A4_HEIGHT}px;
        pointer-events: none; z-index: 2;
    `;
    _overlayCtx = _overlayCanvas.getContext('2d');
    _overlayCtx.scale(DPR, DPR);
    canvas.parentElement?.appendChild(_overlayCanvas);

    // Prevent scrolling while drawing
    canvas.style.touchAction = 'none';
    canvas.style.webkitTouchCallout = 'none';
    canvas.style.webkitUserSelect = 'none';
    canvas.style.userSelect = 'none';

    // ── Pointer events ──
    let _pointerFired = false;
    canvas.addEventListener('pointerdown', (e) => {
        _pointerFired = true;
        _onPointerDown(e);
    });
    canvas.addEventListener('pointermove', _onPointerMove);
    canvas.addEventListener('pointerup', _onPointerUp);
    canvas.addEventListener('pointerleave', _onPointerUp);
    canvas.addEventListener('pointercancel', (e) => {
        _onPointerUp(e);
    });

    // ── Touch event fallback for iPad Safari ──
    canvas.addEventListener('touchstart', (e) => {
        e.preventDefault();
        // Suppress touch fallback when pencil-only mode is active
        if (_pencilOnlyMode) { _pointerFired = false; return; }
        if (!_pointerFired) {
            const touch = e.touches[0];
            _onTouchStart(touch);
        }
        _pointerFired = false;
    }, { passive: false });

    canvas.addEventListener('touchmove', (e) => {
        e.preventDefault();
        if (_usingTouchFallback) {
            const touch = e.touches[0];
            _onTouchMove(touch);
        }
    }, { passive: false });

    canvas.addEventListener('touchend', (e) => {
        e.preventDefault();
        if (_usingTouchFallback) {
            _onTouchEnd();
        }
    }, { passive: false });

    canvas.addEventListener('touchcancel', (e) => {
        e.preventDefault();
        if (_usingTouchFallback) {
            _onTouchEnd();
        }
    }, { passive: false });
}

// ═══════════════════════════════════════════════════════════════════════
// Pointer Event Handlers — Mode Dispatcher
// ═══════════════════════════════════════════════════════════════════════

function _onPointerDown(e) {
    e.preventDefault();

    // ── Apple Pencil auto-detect ──
    if (e.pointerType === 'pen' && !_penDetected) {
        _penDetected = true;
        _pencilOnlyMode = true;
        console.log(`${LOG} Apple Pencil detected → pencil-only mode ON`);
    }

    // ── Reject finger touch when pencil-only ──
    if (_pencilOnlyMode && e.pointerType === 'touch') return;

    const { x, y } = _getCanvasPos(e);

    // Text mode: trigger callback instead of drawing
    if (_activeMode === 'text') {
        if (_textPlacementCallback) _textPlacementCallback(x, y);
        return;
    }

    _isDrawing = true;
    _redoStack.length = 0;

    _lastX = x;
    _lastY = y;
    _lastPressure = _getPressure(e);
    _lastTime = Date.now();

    if (_activeMode === 'shape' || _activeMode === 'tape') {
        _shapeStartX = x;
        _shapeStartY = y;
    } else {
        // Freehand draw mode — start recording stroke
        _dashOffsetDist = 0;
        _lastMidX = x;
        _lastMidY = y;
        _ctx.beginPath();
        _ctx.moveTo(x, y);

        _currentStroke = {
            points: [{ x, y, pressure: _lastPressure, time: _lastTime }],
            config: {
                brushType: _brushType,
                inkColor: _inkColor,
                lineWidth: _lineWidth,
                isEraser: _isEraser,
                eraserSize: _eraserSize,
                dashEnabled: _dashEnabled,
            },
        };
    }

    try { _canvas.setPointerCapture(e.pointerId); } catch (_) { /* noop */ }
}

function _onPointerMove(e) {
    if (!_isDrawing) return;
    // Reject finger touch when pencil-only
    if (_pencilOnlyMode && e.pointerType === 'touch') return;
    e.preventDefault();

    const { x, y } = _getCanvasPos(e);
    const pressure = _getPressure(e);
    const now = Date.now();

    if (_activeMode === 'shape') {
        _previewShape(x, y);
    } else if (_activeMode === 'tape') {
        _previewTape(x, y);
    } else {
        _drawSegment(x, y, pressure, now);
        // Record point for command-based undo
        if (_currentStroke) {
            _currentStroke.points.push({ x, y, pressure, time: now });
        }
    }

    _lastX = x;
    _lastY = y;
    _lastPressure = pressure;
    _lastTime = now;
}

function _onPointerUp(e) {
    if (!_isDrawing) return;
    e.preventDefault();
    _isDrawing = false;

    if (_activeMode === 'shape') {
        const { x, y } = _getCanvasPos(e);
        _commitShape(x, y);
    } else if (_activeMode === 'tape') {
        const { x, y } = _getCanvasPos(e);
        _commitTape(x, y);
    } else {
        // Commit the recorded stroke as a command
        _commitStrokeCommand();
    }

    if (_onStrokeEndCallback) _onStrokeEndCallback();
}

// ═══════════════════════════════════════════════════════════════════════
// Touch Event Fallback (iPad Safari)
// ═══════════════════════════════════════════════════════════════════════

function _onTouchStart(touch) {
    _usingTouchFallback = true;

    const { x, y } = _getTouchCanvasPos(touch);

    // Text mode: trigger callback
    if (_activeMode === 'text') {
        if (_textPlacementCallback) _textPlacementCallback(x, y);
        return;
    }

    _isDrawing = true;
    _redoStack.length = 0;

    _lastX = x;
    _lastY = y;
    _lastPressure = touch.force || 0.5;
    _lastTime = Date.now();

    if (_activeMode === 'shape' || _activeMode === 'tape') {
        _shapeStartX = x;
        _shapeStartY = y;
    } else {
        _dashOffsetDist = 0;
        _lastMidX = x;
        _lastMidY = y;
        _ctx.beginPath();
        _ctx.moveTo(x, y);

        _currentStroke = {
            points: [{ x, y, pressure: _lastPressure, time: _lastTime }],
            config: {
                brushType: _brushType,
                inkColor: _inkColor,
                lineWidth: _lineWidth,
                isEraser: _isEraser,
                eraserSize: _eraserSize,
                dashEnabled: _dashEnabled,
            },
        };
    }
}

function _onTouchMove(touch) {
    if (!_isDrawing) return;

    const { x, y } = _getTouchCanvasPos(touch);
    const pressure = touch.force || 0.5;
    const now = Date.now();

    if (_activeMode === 'shape') {
        _previewShape(x, y);
    } else if (_activeMode === 'tape') {
        _previewTape(x, y);
    } else {
        _drawSegment(x, y, pressure, now);
        if (_currentStroke) {
            _currentStroke.points.push({ x, y, pressure, time: now });
        }
    }

    _lastX = x;
    _lastY = y;
    _lastPressure = pressure;
    _lastTime = now;
}

function _onTouchEnd() {
    if (!_isDrawing) return;
    _isDrawing = false;
    _usingTouchFallback = false;

    if (_activeMode === 'shape') {
        _commitShape(_lastX, _lastY);
    } else if (_activeMode === 'tape') {
        _commitTape(_lastX, _lastY);
    } else {
        _commitStrokeCommand();
    }

    if (_onStrokeEndCallback) _onStrokeEndCallback();
}

function _getTouchCanvasPos(touch) {
    const rect = _canvas.getBoundingClientRect();
    const scaleX = A4_WIDTH / rect.width;
    const scaleY = A4_HEIGHT / rect.height;
    return {
        x: (touch.clientX - rect.left) * scaleX,
        y: (touch.clientY - rect.top) * scaleY,
    };
}

// ═══════════════════════════════════════════════════════════════════════
// Core Drawing — Brush-aware segment renderer
// ═══════════════════════════════════════════════════════════════════════

/**
 * Draw a segment from the last midpoint to the new midpoint.
 * This is the live drawing path — also used during replay.
 */
function _drawSegment(x, y, pressure, now) {
    const brush = BRUSH_CONFIGS[_brushType] || BRUSH_CONFIGS.pen;

    const dx = x - _lastX;
    const dy = y - _lastY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    _dashOffsetDist += dist;
    const dt = now - _lastTime || 1;
    const speed = dist / dt; // px/ms

    // ── Calculate effective width ──
    let width = _lineWidth * brush.widthMul;

    if (brush.usePressure) {
        width *= pressure;
    }
    if (brush.useSpeed) {
        const speedFactor = Math.max(0.3, Math.min(1.0, 1.0 - speed * 0.15));
        width *= speedFactor;
    }

    // Calligraphy: angle-based width variation (flat nib effect)
    if (_brushType === 'calligraphy') {
        const angle = Math.atan2(dy, dx);
        // Width varies based on stroke angle relative to a 45° nib
        const nibAngle = Math.PI / 4;
        const angleFactor = 0.3 + 0.7 * Math.abs(Math.sin(angle - nibAngle));
        width *= angleFactor;
    }

    _ctx.save();
    if (_isEraser) {
        _ctx.globalCompositeOperation = 'destination-out';
        _ctx.lineWidth = _eraserSize;
        _ctx.lineCap = 'round';
        _ctx.lineJoin = 'round';
        _ctx.setLineDash([]);
    } else {
        _ctx.globalCompositeOperation = 'source-over';
        _ctx.globalAlpha = brush.alpha;
        _ctx.strokeStyle = _inkColor;
        _ctx.lineWidth = Math.max(0.5, width);
        _ctx.lineCap = brush.lineCap;
        _ctx.lineJoin = brush.lineJoin;
        // Dashed line support
        const finalW = Math.max(0.5, width);
        const dLen = Math.max(6, finalW * 1.5);
        const dGap = Math.max(4, finalW * 2.5);
        _ctx.setLineDash(_dashEnabled ? [dLen, dGap] : []);
        if (_dashEnabled) _ctx.lineDashOffset = -_dashOffsetDist;
    }

    const midX = (_lastX + x) / 2;
    const midY = (_lastY + y) / 2;

    _ctx.beginPath();
    _ctx.moveTo(_lastMidX, _lastMidY);
    _ctx.quadraticCurveTo(_lastX, _lastY, midX, midY);
    _ctx.stroke();

    _ctx.restore();

    _lastMidX = midX;
    _lastMidY = midY;
}

// ═══════════════════════════════════════════════════════════════════════
// Command Commit — Record operations for undo/redo
// ═══════════════════════════════════════════════════════════════════════

/** Commit the current in-progress stroke to the command stack */
function _commitStrokeCommand() {
    if (!_currentStroke || _currentStroke.points.length < 2) {
        _currentStroke = null;
        return; // Single dot — too small to undo
    }
    _commandStack.push({ type: 'stroke', ..._currentStroke });
    _hasDrawnContent = true;
    _currentStroke = null;
}

/** Push a shape command to the stack */
function _pushShapeCommand(startX, startY, endX, endY) {
    _commandStack.push({
        type: 'shape',
        shapeType: _shapeType,
        startX, startY, endX, endY,
        inkColor: _inkColor,
        lineWidth: _lineWidth,
        fillColor: _fillColor,
        dashEnabled: _dashEnabled,
    });
    _hasDrawnContent = true;
}

/** Push a tape command to the stack */
function _pushTapeCommand(startX, startY, endX, endY) {
    // Store the ORIGINAL URL (not the converted blob: URL) so replay works
    _commandStack.push({
        type: 'tape',
        startX, startY, endX, endY,
        lineWidth: _lineWidth,
        tapeSrc: _tapeOriginalSrc || _tapeImage?.src || null,
    });
    _hasDrawnContent = true;
}

/** Push a text command to the stack */
function _pushTextCommand(text, x, y, opts) {
    _commandStack.push({
        type: 'text',
        text, x, y,
        fontSize: opts.fontSize || 16,
        fontFamily: opts.fontFamily || "'Inter', 'Noto Sans SC', sans-serif",
        color: opts.color || _inkColor,
        bold: !!opts.bold,
        italic: !!opts.italic,
    });
    _hasDrawnContent = true;
}

// ═══════════════════════════════════════════════════════════════════════
// Command Replay — Core of the undo system
// ═══════════════════════════════════════════════════════════════════════

/**
 * Clear the canvas and replay all commands in the stack.
 * This is the primary undo mechanism.
 */
async function _replayAll() {
    if (!_ctx || !_canvas) return;
    _ctx.save();
    _ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    _ctx.clearRect(0, 0, A4_WIDTH, A4_HEIGHT);
    _ctx.restore();

    _hasDrawnContent = false;

    for (const cmd of _commandStack) {
        await _replayCommand(cmd);
    }
}

/**
 * Replay a single command onto the canvas.
 * @param {object} cmd
 */
async function _replayCommand(cmd) {
    switch (cmd.type) {
        case 'base_image':
            await _replayBaseImage(cmd);
            break;
        case 'stroke':
            _replayStroke(cmd);
            break;
        case 'shape':
            _replayShape(cmd);
            break;
        case 'tape':
            await _replayTape(cmd);
            break;
        case 'text':
            _replayText(cmd);
            break;
        case 'clear':
            _ctx.save();
            _ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
            _ctx.clearRect(0, 0, A4_WIDTH, A4_HEIGHT);
            _ctx.restore();
            _hasDrawnContent = false;
            break;
    }
}

/**
 * Replay a stroke command by iterating through its recorded points.
 */
function _replayStroke(cmd) {
    if (!cmd.points || cmd.points.length < 2) return;

    // Temporarily set tool state to match the command
    const savedBrushType = _brushType;
    const savedInkColor = _inkColor;
    const savedLineWidth = _lineWidth;
    const savedIsEraser = _isEraser;
    const savedEraserSize = _eraserSize;
    const savedDash = _dashEnabled;

    _brushType = cmd.config.brushType;
    _inkColor = cmd.config.inkColor;
    _lineWidth = cmd.config.lineWidth;
    _isEraser = cmd.config.isEraser;
    _eraserSize = cmd.config.eraserSize;
    _dashEnabled = cmd.config.dashEnabled;

    _dashOffsetDist = 0;
    const p0 = cmd.points[0];
    _lastX = p0.x;
    _lastY = p0.y;
    _lastMidX = p0.x;
    _lastMidY = p0.y;
    _lastPressure = p0.pressure;
    _lastTime = p0.time;

    _ctx.beginPath();
    _ctx.moveTo(p0.x, p0.y);

    for (let i = 1; i < cmd.points.length; i++) {
        const pt = cmd.points[i];
        _drawSegment(pt.x, pt.y, pt.pressure, pt.time);
        _lastX = pt.x;
        _lastY = pt.y;
        _lastPressure = pt.pressure;
        _lastTime = pt.time;
    }

    // Restore tool state
    _brushType = savedBrushType;
    _inkColor = savedInkColor;
    _lineWidth = savedLineWidth;
    _isEraser = savedIsEraser;
    _eraserSize = savedEraserSize;
    _dashEnabled = savedDash;

    _hasDrawnContent = true;
}

/**
 * Replay a shape command.
 */
function _replayShape(cmd) {
    if (!_ctx) return;

    // Temporarily set shape state
    const savedShapeType = _shapeType;
    _shapeType = cmd.shapeType;

    _ctx.save();
    _ctx.strokeStyle = cmd.inkColor;
    _ctx.lineWidth = cmd.lineWidth;
    _ctx.lineCap = 'round';
    _ctx.lineJoin = 'round';
    const dLen = Math.max(6, cmd.lineWidth * 1.5);
    const dGap = Math.max(4, cmd.lineWidth * 2.5);
    _ctx.setLineDash(cmd.dashEnabled ? [dLen, dGap] : []);

    _drawShapePath(_ctx, cmd.startX, cmd.startY, cmd.endX, cmd.endY);
    if (cmd.fillColor !== 'transparent' && (cmd.shapeType === 'rectangle' || cmd.shapeType === 'ellipse')) {
        _ctx.fillStyle = cmd.fillColor;
        _ctx.fill();
    }
    _ctx.stroke();
    _ctx.restore();

    _shapeType = savedShapeType;
    _hasDrawnContent = true;
}

/**
 * Replay a tape command.
 */
async function _replayTape(cmd) {
    if (!_ctx || !cmd.tapeSrc) return;

    // Rasterize SVG data URIs to PNG to avoid Safari canvas taint
    const safeUrl = await _safeImageUrlAsync(cmd.tapeSrc);

    const img = new Image();
    await new Promise((resolve) => {
        img.onload = resolve;
        img.onerror = resolve; // skip if load fails
        img.src = safeUrl;
    });

    const pattern = _ctx.createPattern(img, 'repeat');
    if (!pattern) return;

    _ctx.save();

    const dx = cmd.endX - cmd.startX;
    const dy = cmd.endY - cmd.startY;
    const angle = Math.atan2(dy, dx);
    const tapeNativeHeight = img.height || 100;
    const scale = cmd.lineWidth / tapeNativeHeight;

    const matrix = new DOMMatrix()
        .translate(cmd.startX, cmd.startY)
        .rotate(angle * 180 / Math.PI)
        .scale(scale, scale)
        .translate(0, -tapeNativeHeight / 2);

    pattern.setTransform(matrix);

    _ctx.strokeStyle = pattern;
    _ctx.lineWidth = cmd.lineWidth;
    _ctx.lineCap = 'butt';
    _ctx.lineJoin = 'miter';

    _ctx.beginPath();
    _ctx.moveTo(cmd.startX, cmd.startY);
    _ctx.lineTo(cmd.endX, cmd.endY);
    _ctx.stroke();

    _ctx.restore();
    _hasDrawnContent = true;
}

/**
 * Replay a text command.
 */
function _replayText(cmd) {
    if (!_ctx) return;

    const bold = cmd.bold ? 'bold ' : '';
    const italic = cmd.italic ? 'italic ' : '';

    _ctx.save();
    _ctx.font = `${italic}${bold}${cmd.fontSize}px ${cmd.fontFamily}`;
    _ctx.fillStyle = cmd.color;
    _ctx.textBaseline = 'top';

    const maxWidth = A4_WIDTH - cmd.x - 20;
    const lines = _wrapText(_ctx, cmd.text, maxWidth);
    const lineHeight = cmd.fontSize * 1.4;

    for (let i = 0; i < lines.length; i++) {
        _ctx.fillText(lines[i], cmd.x, cmd.y + i * lineHeight);
    }

    _ctx.restore();
    _hasDrawnContent = true;
}

/**
 * Replay a base image (loaded page).
 */
function _replayBaseImage(cmd) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            _ctx.drawImage(img, 0, 0, A4_WIDTH, A4_HEIGHT);
            _hasDrawnContent = true;
            resolve();
        };
        img.onerror = () => resolve(); // skip silently
        img.src = cmd.dataUrl;
    });
}

// ═══════════════════════════════════════════════════════════════════════
// Shape Drawing Engine
// ═══════════════════════════════════════════════════════════════════════

/** Draw temporary shape preview on the overlay canvas */
function _previewShape(curX, curY) {
    if (!_overlayCtx) return;
    _overlayCtx.clearRect(0, 0, _overlayCanvas.width, _overlayCanvas.height);
    _overlayCtx.save();
    _overlayCtx.strokeStyle = _inkColor;
    _overlayCtx.lineWidth = _lineWidth;
    _overlayCtx.lineCap = 'round';
    _overlayCtx.lineJoin = 'round';
    const dLen = Math.max(6, _lineWidth * 1.5);
    const dGap = Math.max(4, _lineWidth * 2.5);
    _overlayCtx.setLineDash(_dashEnabled ? [dLen, dGap] : []);

    _drawShapePath(_overlayCtx, _shapeStartX, _shapeStartY, curX, curY);
    if (_fillColor !== 'transparent' && (_shapeType === 'rectangle' || _shapeType === 'ellipse')) {
        _overlayCtx.fillStyle = _fillColor;
        _overlayCtx.fill();
    }
    _overlayCtx.stroke();

    _overlayCtx.restore();
}

/** Commit the final shape to the main canvas and clear overlay */
function _commitShape(curX, curY) {
    if (!_ctx) return;

    _ctx.save();
    _ctx.strokeStyle = _inkColor;
    _ctx.lineWidth = _lineWidth;
    _ctx.lineCap = 'round';
    _ctx.lineJoin = 'round';
    const dLen = Math.max(6, _lineWidth * 1.5);
    const dGap = Math.max(4, _lineWidth * 2.5);
    _ctx.setLineDash(_dashEnabled ? [dLen, dGap] : []);

    _drawShapePath(_ctx, _shapeStartX, _shapeStartY, curX, curY);
    if (_fillColor !== 'transparent' && (_shapeType === 'rectangle' || _shapeType === 'ellipse')) {
        _ctx.fillStyle = _fillColor;
        _ctx.fill();
    }
    _ctx.stroke();

    _ctx.restore();

    // Clear overlay
    if (_overlayCtx) _overlayCtx.clearRect(0, 0, _overlayCanvas.width, _overlayCanvas.height);

    // Record command
    _pushShapeCommand(_shapeStartX, _shapeStartY, curX, curY);
}

/** Draw the shape path on a given context */
function _drawShapePath(ctx, x1, y1, x2, y2) {
    ctx.beginPath();

    switch (_shapeType) {
        case 'rectangle':
            ctx.rect(x1, y1, x2 - x1, y2 - y1);
            break;

        case 'ellipse': {
            const cx = (x1 + x2) / 2;
            const cy = (y1 + y2) / 2;
            const rx = Math.abs(x2 - x1) / 2;
            const ry = Math.abs(y2 - y1) / 2;
            ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
            break;
        }

        case 'line':
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            break;

        case 'arrow': {
            // Shaft
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);

            // Arrowhead
            const angle = Math.atan2(y2 - y1, x2 - x1);
            const headLen = Math.max(10, _lineWidth * 4);
            ctx.moveTo(x2, y2);
            ctx.lineTo(
                x2 - headLen * Math.cos(angle - Math.PI / 6),
                y2 - headLen * Math.sin(angle - Math.PI / 6)
            );
            ctx.moveTo(x2, y2);
            ctx.lineTo(
                x2 - headLen * Math.cos(angle + Math.PI / 6),
                y2 - headLen * Math.sin(angle + Math.PI / 6)
            );
            break;
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Tape Drawing Engine
// ═══════════════════════════════════════════════════════════════════════

export async function setActiveTapeImage(url) {
    if (!url) {
        _tapeImage = null;
        _tapePattern = null;
        _tapeOriginalSrc = null;
        return;
    }
    // Preserve the original URL for command stack serialization
    _tapeOriginalSrc = url;

    // Rasterize SVG data URIs to PNG bitmaps to avoid Safari canvas taint.
    // blob: URLs of SVG images still taint the canvas in WebKit.
    const safeUrl = await _safeImageUrlAsync(url);

    _tapeImage = new Image();
    _tapeImage.onload = () => {
        if (_ctx) _tapePattern = _ctx.createPattern(_tapeImage, 'repeat');
    };
    _tapeImage.onerror = () => {
        console.warn(`${LOG} Failed to load tape image`);
        _tapePattern = null;
    };
    _tapeImage.src = safeUrl;
}

function _drawTapePath(ctx, x1, y1, x2, y2) {
    if (!_tapePattern || !_tapeImage) return;

    ctx.save();
    
    const dx = x2 - x1;
    const dy = y2 - y1;
    const angle = Math.atan2(dy, dx);

    const tapeNativeHeight = _tapeImage.height || 100;
    // Scale tape so its height matches the current _lineWidth
    const scale = _lineWidth / tapeNativeHeight;

    const matrix = new DOMMatrix()
        .translate(x1, y1)
        .rotate(angle * 180 / Math.PI)
        .scale(scale, scale)
        .translate(0, -tapeNativeHeight / 2);

    _tapePattern.setTransform(matrix);

    ctx.strokeStyle = _tapePattern;
    ctx.lineWidth = _lineWidth;
    // Butted ends prevent the tape from having rounded, non-patterned caps spilling over
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'miter';

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    ctx.restore();
}

function _previewTape(curX, curY) {
    if (!_overlayCtx) return;
    _overlayCtx.clearRect(0, 0, _overlayCanvas.width, _overlayCanvas.height);
    _drawTapePath(_overlayCtx, _shapeStartX, _shapeStartY, curX, curY);
}

function _commitTape(curX, curY) {
    if (!_ctx) return;
    _drawTapePath(_ctx, _shapeStartX, _shapeStartY, curX, curY);
    if (_overlayCtx) _overlayCtx.clearRect(0, 0, _overlayCanvas.width, _overlayCanvas.height);

    // Record command
    _pushTapeCommand(_shapeStartX, _shapeStartY, curX, curY);
}

// ═══════════════════════════════════════════════════════════════════════
// Text Rendering
// ═══════════════════════════════════════════════════════════════════════

/**
 * Render text onto the canvas at the specified position.
 * @param {string} text - The text content
 * @param {number} x - X position in A4 coordinates
 * @param {number} y - Y position in A4 coordinates
 * @param {object} [opts] - Options { fontSize, fontFamily, color, bold, italic }
 */
export function renderTextOnCanvas(text, x, y, opts = {}) {
    if (!_ctx || !text) return;

    const fontSize = opts.fontSize || 16;
    const fontFamily = opts.fontFamily || "'Inter', 'Noto Sans SC', sans-serif";
    const color = opts.color || _inkColor;
    const bold = opts.bold ? 'bold ' : '';
    const italic = opts.italic ? 'italic ' : '';

    _ctx.save();
    _ctx.font = `${italic}${bold}${fontSize}px ${fontFamily}`;
    _ctx.fillStyle = color;
    _ctx.textBaseline = 'top';

    // Word wrap for long text
    const maxWidth = A4_WIDTH - x - 20;
    const lines = _wrapText(_ctx, text, maxWidth);
    const lineHeight = fontSize * 1.4;

    for (let i = 0; i < lines.length; i++) {
        _ctx.fillText(lines[i], x, y + i * lineHeight);
    }

    _ctx.restore();

    // Record text command
    _pushTextCommand(text, x, y, { fontSize, fontFamily, color, bold: opts.bold, italic: opts.italic });

    if (_onStrokeEndCallback) _onStrokeEndCallback();
}

/**
 * Smart text wrapping helper.
 * Splits on word boundaries for Latin text, per-character for CJK.
 * English words won't be broken mid-word (unless a single word exceeds maxWidth).
 */
function _wrapText(ctx, text, maxWidth) {
    if (maxWidth <= 0) return [text];
    const paragraphs = text.split('\n');
    const result = [];
    // Tokenize: CJK characters are individual tokens, Latin words stay together
    const TOKEN_RE = /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]|[^\s\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]+|\s+/g;
    for (const para of paragraphs) {
        const tokens = para.match(TOKEN_RE) || [''];
        let line = '';
        for (const token of tokens) {
            const test = line + token;
            if (ctx.measureText(test).width > maxWidth && line) {
                result.push(line);
                // Don't start a new line with whitespace
                line = token.trim() ? token : '';
            } else {
                line = test;
            }
        }
        result.push(line);
    }
    return result;
}

// ═══════════════════════════════════════════════════════════════════════
// Tool Controls (called from handbookEngine.js)
// ═══════════════════════════════════════════════════════════════════════

/** Set ink color */
export function setInkColor(color) {
    _inkColor = color;
    _isEraser = false;
}

/** Set line width */
export function setLineWidth(width) {
    _lineWidth = width;
}

/** Set brush type */
export function setBrushType(type) {
    if (BRUSH_CONFIGS[type]) {
        _brushType = type;
        _isEraser = false;
    } else {
        console.warn(`${LOG} Unknown brush type: ${type}`);
    }
}

/** Get current brush type */
export function getBrushType() {
    return _brushType;
}

/** Toggle eraser mode */
export function setEraserMode(enabled) {
    _isEraser = enabled;
}

/** Get current eraser state */
export function isEraserMode() {
    return _isEraser;
}

/** Set eraser size */
export function setEraserSize(size) {
    _eraserSize = Math.max(2, Math.min(100, size));
}

// ── Mode / Shape / Dash controls ──

/** Set active drawing mode: 'draw' | 'shape' | 'text' */
export function setActiveMode(mode) {
    _activeMode = mode;
    _isEraser = false;
}

/** Get active drawing mode */
export function getActiveMode() {
    return _activeMode;
}

/** Set shape type: 'rectangle' | 'ellipse' | 'line' | 'arrow' */
export function setShapeType(type) {
    _shapeType = type;
}

/** Get current shape type */
export function getShapeType() {
    return _shapeType;
}

/** Set shape fill color */
export function setFillColor(color) {
    _fillColor = color;
}

/** Get shape fill color */
export function getFillColor() {
    return _fillColor;
}

/** Enable/disable dashed strokes */
export function setDashEnabled(enabled) {
    _dashEnabled = !!enabled;
}

/** Get dash state */
export function isDashEnabled() {
    return _dashEnabled;
}

/** Set text placement callback (called with x, y when user taps in text mode) */
export function setTextPlacementCallback(fn) {
    _textPlacementCallback = fn;
}

/** Get current eraser size */
export function getEraserSize() {
    return _eraserSize;
}

/** Set pencil-only mode (reject finger touch for drawing) */
export function setPencilOnlyMode(enabled) {
    _pencilOnlyMode = !!enabled;
}

/** Get pencil-only mode state */
export function isPencilOnlyMode() {
    return _pencilOnlyMode;
}

/** Set a callback to fire after each stroke/operation ends */
export function setOnStrokeEndCallback(fn) {
    _onStrokeEndCallback = fn;
}

// ═══════════════════════════════════════════════════════════════════════
// Undo / Redo — Command-based
// ═══════════════════════════════════════════════════════════════════════

/** Undo last operation by removing last command and replaying all remaining */
export async function undo() {
    if (_commandStack.length === 0) return;
    const removed = _commandStack.pop();
    _redoStack.push(removed);
    await _replayAll();
    if (_onStrokeEndCallback) _onStrokeEndCallback();
}

/** Redo last undone operation */
export async function redo() {
    if (_redoStack.length === 0) return;
    const cmd = _redoStack.pop();
    _commandStack.push(cmd);
    // Execute just the re-added command (faster than replaying all)
    await _replayCommand(cmd);
    if (_onStrokeEndCallback) _onStrokeEndCallback();
}

// ═══════════════════════════════════════════════════════════════════════
// Canvas Operations
// ═══════════════════════════════════════════════════════════════════════

/** Clear the entire canvas */
export function clearCanvas() {
    if (!_ctx || !_canvas) return;
    _ctx.save();
    _ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    _ctx.clearRect(0, 0, A4_WIDTH, A4_HEIGHT);
    _ctx.restore();

    // Push a 'clear' command so undo can restore pre-clear state
    _commandStack.push({ type: 'clear' });
    _redoStack.length = 0;
    _hasDrawnContent = false;
    if (_onStrokeEndCallback) _onStrokeEndCallback();
}

/**
 * Check if the canvas has any drawn content.
 * Uses a fast dirty flag instead of scanning all pixels (P3 optimization).
 */
export function hasContent() {
    return _hasDrawnContent;
}

/**
 * Export the canvas as a WebP data URL.
 * @param {number} [quality=0.8]
 * @returns {string} Data URL
 */
export function exportAsDataUrl(quality = 0.8) {
    if (!_canvas) return '';
    try {
        return _canvas.toDataURL('image/webp', quality);
    } catch (e) {
        // Canvas may be tainted by cross-origin patterns (tape/sticker).
        // Fall back to a blank export so auto-save doesn't crash.
        console.warn(`${LOG} toDataURL failed (canvas tainted?):`, e.message);
        return '';
    }
}

/**
 * Load an image data URL onto the canvas.
 * Stores as a BASE_IMAGE command for undo support.
 * @param {string} dataUrl
 * @returns {Promise<void>}
 */
export function loadFromDataUrl(dataUrl) {
    return new Promise((resolve, reject) => {
        if (!_ctx || !_canvas) return reject(new Error('Canvas not initialized'));
        const img = new Image();
        img.onload = () => {
            _ctx.clearRect(0, 0, _canvas.width, _canvas.height);
            _ctx.drawImage(img, 0, 0, A4_WIDTH, A4_HEIGHT);

            // Store as base image command (first in stack)
            _commandStack.push({ type: 'base_image', dataUrl });
            _hasDrawnContent = true;
            resolve();
        };
        img.onerror = reject;
        img.src = dataUrl;
    });
}

/** Get current ink color */
export function getInkColor() {
    return _inkColor;
}

/** Get current line width */
export function getLineWidth() {
    return _lineWidth;
}

// ═══════════════════════════════════════════════════════════════════════
// Internal Helpers
// ═══════════════════════════════════════════════════════════════════════

/**
 * Convert a data: URI to a taint-safe URL for canvas use.
 *
 * Safari/WebKit taints the canvas when an SVG image is used with
 * drawImage/createPattern — even from a same-origin blob: URL.
 * The only reliable workaround is to **rasterize** the SVG into a
 * bitmap (PNG) via an offscreen canvas so the browser no longer
 * treats it as an SVG resource.
 *
 * For non-SVG data URIs we still do the cheaper data→blob conversion.
 * Non-data URLs (http:, blob:, etc.) are returned unchanged.
 *
 * @param {string} url
 * @returns {string} A safe URL (sync for non-data, sync for non-SVG data, or pre-rasterized)
 */
function _safeImageUrl(url) {
    if (!url || !url.startsWith('data:')) return url;

    // Check if this is an SVG data URI — needs rasterization
    const isSvg = url.startsWith('data:image/svg+xml');
    if (isSvg) {
        // For SVG, check the rasterization cache first
        if (_rasterCache.has(url)) return _rasterCache.get(url);
        // Return the raw URL for now; callers that use SVG should call
        // _safeImageUrlAsync instead. This keeps the sync API working
        // for non-SVG callers.
    }

    try {
        const [header, data] = url.split(',');
        const mime = header.match(/:(.*?);/)?.[1] || 'image/png';
        const isBase64 = header.includes(';base64');
        let bytes;
        if (isBase64) {
            const binary = atob(data);
            bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        } else {
            const decoded = decodeURIComponent(data);
            const encoder = new TextEncoder();
            bytes = encoder.encode(decoded);
        }
        const blob = new Blob([bytes], { type: mime });
        return URL.createObjectURL(blob);
    } catch (e) {
        console.warn(`${LOG} _safeImageUrl conversion failed, using original:`, e.message);
        return url;
    }
}

/**
 * Cache for rasterized SVG → PNG blob URLs.
 * Key: original data URI, Value: blob: URL of the rasterized PNG.
 */
const _rasterCache = new Map();

/**
 * Async version that rasterizes SVG data URIs into PNG bitmaps.
 * This is the only way to prevent Safari canvas taint from SVGs.
 * Non-SVG URLs are processed synchronously via _safeImageUrl.
 *
 * @param {string} url
 * @returns {Promise<string>} Taint-safe URL
 */
async function _safeImageUrlAsync(url) {
    if (!url) return url;
    if (!url.startsWith('data:image/svg+xml')) return _safeImageUrl(url);

    // Check cache
    if (_rasterCache.has(url)) return _rasterCache.get(url);

    try {
        // 1. Load SVG via blob: URL (same-origin)
        const blobUrl = _safeImageUrl(url);
        const img = new Image();
        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = () => reject(new Error('SVG load failed'));
            img.src = blobUrl;
        });

        // 2. Rasterize onto an offscreen canvas
        const w = img.naturalWidth || img.width || 40;
        const h = img.naturalHeight || img.height || 40;
        const offscreen = document.createElement('canvas');
        offscreen.width = w * 2;   // 2× for crisp patterns
        offscreen.height = h * 2;
        const octx = offscreen.getContext('2d');
        octx.drawImage(img, 0, 0, offscreen.width, offscreen.height);

        // 3. Export as PNG blob URL
        const pngBlob = await new Promise(resolve =>
            offscreen.toBlob(resolve, 'image/png')
        );
        const pngUrl = URL.createObjectURL(pngBlob);

        // Revoke the intermediate SVG blob URL
        URL.revokeObjectURL(blobUrl);

        // Cache for future use
        _rasterCache.set(url, pngUrl);
        console.log(`${LOG} SVG rasterized to PNG: ${w}×${h}`);
        return pngUrl;
    } catch (e) {
        console.warn(`${LOG} SVG rasterization failed, falling back:`, e.message);
        return _safeImageUrl(url);
    }
}

function _getCanvasPos(e) {
    const rect = _canvas.getBoundingClientRect();
    // Scale from display coordinates to A4 coordinates
    const scaleX = A4_WIDTH / rect.width;
    const scaleY = A4_HEIGHT / rect.height;
    return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY,
    };
}

function _getPressure(e) {
    // Apple Pencil / Wacom: real pressure (0.0 - 1.0)
    // Mouse / Finger: simulate 0.5
    // Note: e.pressure === 1.0 is valid for max-force stylus input,
    // but mouse buttons report exactly 0.5 when pressed, so we use
    // pointerType to disambiguate.
    if (e.pointerType === 'pen' && typeof e.pressure === 'number') {
        // Stylus: trust the hardware pressure, clamp to [0.05, 1.0]
        // (0.05 floor prevents invisible strokes on very light touch)
        return Math.max(0.05, Math.min(1.0, e.pressure));
    }
    if (e.pressure && e.pressure > 0 && e.pressure !== 0.5) {
        // Non-pen device reporting unusual pressure — trust it
        return e.pressure;
    }
    return 0.5;
}
