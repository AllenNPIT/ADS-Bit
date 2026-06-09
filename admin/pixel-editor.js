// ADS-Bit In-App Pixel Editor
// A dependency-free Canvas2D sprite editor for the admin Sprites tab.
// Edits sprites at their native 500x333 resolution and exports a PNG that
// is POSTed to the existing /api/admin/sprites/{type} endpoint.
//
// Public API:
//   PixelEditor.open(spriteType, { onSave })
//
// Tools:    pencil, eraser, color picker, fill bucket, pan,
//           line, rectangle, ellipse (outline/filled), rectangular select.
// Features: zoom/pan, undo/redo, grid overlay, brush size & opacity,
//           custom + recent color palettes, reference-image overlay,
//           selection move/cut/copy/paste/delete, load existing, export PNG.
(function () {
    'use strict';

    // ----- Sprite dimensions (fixed by the sprite spec) -----
    const SPRITE_W = 500;
    const SPRITE_H = 333;

    // ----- Tunables -----
    const MIN_ZOOM = 0.5;
    const MAX_ZOOM = 40;
    const HISTORY_LIMIT = 40;       // max undo snapshots (~666 KB each)
    const GRID_MIN_ZOOM = 6;        // only show pixel grid when zoomed in enough
    const RECENT_LIMIT = 10;
    const CUSTOM_KEY = 'pe-custom-palette';

    // ----- Retro palette (SNES-style white/blue/red leaning) -----
    const PALETTE = [
        '#000000', '#1a1a1a', '#3c3c3c', '#5c5c5c', '#9c9c9c', '#fcfcfc',
        '#5c94fc', '#3c5cac', '#1a2c6c', '#b4d4ec', '#54b4fc', '#0c84fc',
        '#fc5454', '#ac2c2c', '#fc9c9c', '#fcd444', '#fc9838', '#a85400',
        '#54fc54', '#2c942c', '#a4e4a4', '#fc54fc', '#9438a8', '#54fcdc',
    ];

    const SHAPE_TOOLS = ['line', 'rect', 'ellipse'];

    // ----- Module state -----
    let root = null;            // overlay element
    let els = {};               // cached DOM references

    let srcCanvas = null;       // 500x333 source-of-truth canvas
    let srcCtx = null;
    let viewCanvas = null;      // on-screen scaled render target
    let viewCtx = null;

    let tool = 'pencil';
    let brushSize = 1;
    let brushOpacity = 1;       // 0..1, applies to color tools (not eraser)
    let color = '#5c94fc';
    let shapeFill = false;
    let zoom = 1;
    let panX = 0, panY = 0;
    let showGrid = true;

    let spriteType = null;
    let saveCallback = null;

    // Pointer interaction state
    let drawing = false;        // pencil/eraser stroke in progress
    let drawingShape = false;   // line/rect/ellipse drag in progress
    let panning = false;        // pan drag in progress
    let spaceDown = false;      // hold space to temporarily pan
    let lastDraw = null;        // last source pixel during a stroke {x,y}
    let panStart = null;        // {cx,cy,panX,panY} at pan start
    let shapeStart = null;      // {x,y} where a shape drag began
    let shapeSnapshot = null;   // ImageData captured at shape drag start

    // Selection / move / clipboard
    let selection = null;       // {x,y,w,h} committed selection (source px)
    let selDrag = null;         // {mode:'new'|'move', sx,sy, ox,oy}
    let floating = null;        // {canvas,x,y,w,h} lifted/pasted pixels
    let clipboard = null;       // <canvas> of copied pixels

    // Color palettes
    let recentColors = [];
    let customPalette = [];

    // Reference overlay
    let refImage = null;
    let refOpacity = 0.5;
    let refVisible = true;

    // Undo/redo
    let history = [];
    let historyIndex = -1;

    // ===================================================================
    // DOM construction
    // ===================================================================
    function build() {
        if (root) return;

        root = document.createElement('div');
        root.id = 'pe-overlay';
        root.className = 'pe-overlay hidden';
        root.innerHTML = `
            <div class="pe-modal">
                <div class="pe-header">
                    <h2 class="retro-title" id="pe-title">PIXEL EDITOR</h2>
                    <div class="pe-header-actions">
                        <button class="btn btn-small" id="pe-load">LOAD CURRENT</button>
                        <button class="btn btn-small" id="pe-clear">CLEAR</button>
                        <button class="btn btn-small btn-primary" id="pe-save">SAVE</button>
                        <button class="btn btn-small btn-danger" id="pe-close">CLOSE</button>
                    </div>
                </div>
                <div class="pe-body">
                    <div class="pe-toolbar">
                        <div class="pe-tool-group">
                            <button class="pe-tool active" data-tool="pencil" title="Pencil (B)">✏</button>
                            <button class="pe-tool" data-tool="eraser" title="Eraser (E)">⌫</button>
                            <button class="pe-tool" data-tool="picker" title="Color picker (I)">⊙</button>
                            <button class="pe-tool" data-tool="fill" title="Fill bucket (F)">▣</button>
                        </div>
                        <div class="pe-tool-group">
                            <button class="pe-tool" data-tool="line" title="Line (L)">╱</button>
                            <button class="pe-tool" data-tool="rect" title="Rectangle (R)">▭</button>
                            <button class="pe-tool" data-tool="ellipse" title="Ellipse (O)">◯</button>
                            <label class="pe-check" title="Fill shapes"><input type="checkbox" id="pe-fill"> FILL</label>
                        </div>
                        <div class="pe-tool-group">
                            <button class="pe-tool" data-tool="select" title="Select & move (M)">⬚</button>
                            <button class="pe-tool" data-tool="pan" title="Pan (hold Space)">✥</button>
                        </div>
                        <div class="pe-tool-group">
                            <button class="pe-icon-btn" id="pe-undo" title="Undo (Ctrl+Z)">↶</button>
                            <button class="pe-icon-btn" id="pe-redo" title="Redo (Ctrl+Y)">↷</button>
                        </div>
                        <div class="pe-tool-group">
                            <button class="pe-icon-btn" id="pe-zoom-out" title="Zoom out (-)">−</button>
                            <button class="pe-icon-btn" id="pe-zoom-in" title="Zoom in (+)">+</button>
                            <button class="pe-icon-btn" id="pe-zoom-fit" title="Fit to screen (0)">⤢</button>
                        </div>
                        <div class="pe-tool-group pe-grid-toggle">
                            <label class="pe-check"><input type="checkbox" id="pe-grid" checked> GRID</label>
                        </div>
                        <div class="pe-tool-group pe-brush-group">
                            <span class="pe-tool-label">SIZE</span>
                            <input type="range" id="pe-brush" min="1" max="8" value="1">
                            <span id="pe-brush-val" class="pe-tool-label">1</span>
                        </div>
                    </div>
                    <div class="pe-canvas-wrap" id="pe-canvas-wrap">
                        <canvas id="pe-view"></canvas>
                    </div>
                    <div class="pe-sidebar">
                        <div class="pe-color-current">
                            <div class="pe-swatch-large" id="pe-current-swatch"></div>
                            <input type="color" id="pe-color-input" value="#5c94fc">
                        </div>
                        <div class="pe-opacity-group">
                            <span class="pe-tool-label">OPACITY <span id="pe-opacity-val">100%</span></span>
                            <input type="range" id="pe-opacity" min="10" max="100" value="100">
                        </div>
                        <div class="pe-palette" id="pe-palette"></div>
                        <button class="pe-mini-btn" id="pe-add-swatch" title="Save current color to your custom palette">+ SAVE COLOR</button>
                        <div class="pe-subhead" id="pe-custom-head">CUSTOM</div>
                        <div class="pe-palette" id="pe-custom-palette"></div>
                        <div class="pe-subhead">RECENT</div>
                        <div class="pe-palette" id="pe-recent-palette"></div>
                        <div class="pe-subhead">REFERENCE</div>
                        <div class="pe-ref-controls">
                            <div class="pe-ref-row">
                                <label class="pe-mini-btn pe-ref-load">LOAD
                                    <input type="file" id="pe-ref-file" accept="image/*" hidden>
                                </label>
                                <button class="pe-mini-btn" id="pe-ref-clear">CLEAR</button>
                            </div>
                            <label class="pe-check"><input type="checkbox" id="pe-ref-show" checked> SHOW</label>
                            <input type="range" id="pe-ref-opacity" min="5" max="100" value="50" title="Reference opacity">
                        </div>
                        <div class="pe-readout">
                            <div>POS <span id="pe-pos">--, --</span></div>
                            <div>ZOOM <span id="pe-zoom-val">100%</span></div>
                            <div>SEL <span id="pe-sel">none</span></div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(root);

        // Cache references
        els.title = root.querySelector('#pe-title');
        els.wrap = root.querySelector('#pe-canvas-wrap');
        els.palette = root.querySelector('#pe-palette');
        els.customPalette = root.querySelector('#pe-custom-palette');
        els.recentPalette = root.querySelector('#pe-recent-palette');
        els.currentSwatch = root.querySelector('#pe-current-swatch');
        els.colorInput = root.querySelector('#pe-color-input');
        els.pos = root.querySelector('#pe-pos');
        els.zoomVal = root.querySelector('#pe-zoom-val');
        els.selVal = root.querySelector('#pe-sel');
        els.brush = root.querySelector('#pe-brush');
        els.brushVal = root.querySelector('#pe-brush-val');
        els.fill = root.querySelector('#pe-fill');
        els.opacity = root.querySelector('#pe-opacity');
        els.opacityVal = root.querySelector('#pe-opacity-val');
        els.grid = root.querySelector('#pe-grid');
        els.undo = root.querySelector('#pe-undo');
        els.redo = root.querySelector('#pe-redo');
        els.refFile = root.querySelector('#pe-ref-file');
        els.refShow = root.querySelector('#pe-ref-show');
        els.refOpacity = root.querySelector('#pe-ref-opacity');

        viewCanvas = root.querySelector('#pe-view');
        viewCtx = viewCanvas.getContext('2d');

        // Source-of-truth canvas (offscreen)
        srcCanvas = document.createElement('canvas');
        srcCanvas.width = SPRITE_W;
        srcCanvas.height = SPRITE_H;
        srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true });

        buildPalette(els.palette, PALETTE, false);
        wireEvents();
    }

    // Build a row of color swatches. `removable` enables right-click removal
    // (used by the custom palette).
    function buildPalette(container, colors, removable) {
        container.innerHTML = '';
        colors.forEach(c => {
            const sw = document.createElement('button');
            sw.className = 'pe-swatch';
            sw.style.background = c;
            sw.title = removable ? `${c} (right-click to remove)` : c;
            sw.addEventListener('click', () => setColor(c));
            if (removable) {
                sw.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    customPalette = customPalette.filter(x => x !== c);
                    saveCustomPalette();
                    buildCustomPalette();
                });
            }
            container.appendChild(sw);
        });
    }

    function buildCustomPalette() {
        buildPalette(els.customPalette, customPalette, true);
        root.querySelector('#pe-custom-head').style.opacity = customPalette.length ? '1' : '0.5';
    }

    function buildRecentPalette() {
        buildPalette(els.recentPalette, recentColors, false);
    }

    // ===================================================================
    // Event wiring
    // ===================================================================
    function wireEvents() {
        root.querySelectorAll('.pe-tool').forEach(btn => {
            btn.addEventListener('click', () => setTool(btn.dataset.tool));
        });

        root.querySelector('#pe-close').addEventListener('click', () => {
            if (confirmDiscard()) close();
        });
        root.querySelector('#pe-save').addEventListener('click', save);
        root.querySelector('#pe-load').addEventListener('click', () => loadExisting(true));
        root.querySelector('#pe-clear').addEventListener('click', clearCanvas);

        root.querySelector('#pe-zoom-in').addEventListener('click', () => zoomAt(1.25, centerPoint()));
        root.querySelector('#pe-zoom-out').addEventListener('click', () => zoomAt(0.8, centerPoint()));
        root.querySelector('#pe-zoom-fit').addEventListener('click', fitToScreen);

        els.undo.addEventListener('click', undo);
        els.redo.addEventListener('click', redo);

        els.grid.addEventListener('change', () => { showGrid = els.grid.checked; render(); });
        els.brush.addEventListener('input', () => {
            brushSize = parseInt(els.brush.value, 10);
            els.brushVal.textContent = brushSize;
        });
        els.fill.addEventListener('change', () => { shapeFill = els.fill.checked; });
        els.opacity.addEventListener('input', () => {
            brushOpacity = parseInt(els.opacity.value, 10) / 100;
            els.opacityVal.textContent = els.opacity.value + '%';
        });

        els.colorInput.addEventListener('input', () => setColor(els.colorInput.value));
        root.querySelector('#pe-add-swatch').addEventListener('click', addCurrentColorToPalette);

        // Reference overlay
        els.refFile.addEventListener('change', (e) => {
            const f = e.target.files[0];
            if (f) loadRefFromFile(f);
            e.target.value = '';
        });
        root.querySelector('#pe-ref-clear').addEventListener('click', clearRef);
        els.refShow.addEventListener('change', () => { refVisible = els.refShow.checked; render(); });
        els.refOpacity.addEventListener('input', () => {
            refOpacity = parseInt(els.refOpacity.value, 10) / 100;
            render();
        });

        // Canvas pointer events
        viewCanvas.addEventListener('pointerdown', onPointerDown);
        viewCanvas.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
        viewCanvas.addEventListener('pointerleave', () => { els.pos.textContent = '--, --'; });
        viewCanvas.addEventListener('wheel', onWheel, { passive: false });
        viewCanvas.addEventListener('contextmenu', e => e.preventDefault());

        document.addEventListener('keydown', onKeyDown);
        document.addEventListener('keyup', onKeyUp);

        window.addEventListener('resize', () => { if (isOpen()) { resizeView(); render(); } });
    }

    // ===================================================================
    // Public open/close
    // ===================================================================
    function open(type, opts) {
        opts = opts || {};
        build();
        spriteType = type;
        saveCallback = opts.onSave || null;
        els.title.textContent = 'PIXEL EDITOR — ' + type;

        // Reset transient state
        zoom = 1; panX = 0; panY = 0;
        history = []; historyIndex = -1;
        selection = null; selDrag = null; floating = null;
        drawing = drawingShape = false; shapeSnapshot = null;
        refImage = null; refVisible = true;
        recentColors = [];
        brushOpacity = 1;
        shapeFill = false;
        els.opacity.value = 100; els.opacityVal.textContent = '100%';
        els.fill.checked = false;
        els.refShow.checked = true;
        loadCustomPalette();
        buildCustomPalette();
        buildRecentPalette();
        setTool('pencil');
        updateSelReadout();
        srcCtx.clearRect(0, 0, SPRITE_W, SPRITE_H);

        root.classList.remove('hidden');
        document.body.classList.add('pe-open');

        loadExisting(false, () => {
            resizeView();
            fitToScreen();
            pushHistory();      // baseline snapshot
            updateHistoryButtons();
        });
    }

    function isOpen() { return root && !root.classList.contains('hidden'); }

    function close() {
        root.classList.add('hidden');
        document.body.classList.remove('pe-open');
        spriteType = null;
        saveCallback = null;
    }

    function confirmDiscard() {
        if (historyIndex > 0 || floating) {
            return window.confirm('Discard unsaved changes and close the editor?');
        }
        return true;
    }

    // ===================================================================
    // Loading / clearing
    // ===================================================================
    function loadExisting(recordHistory, done) {
        const url = `/images/${spriteType}.png?v=${Date.now()}`;
        const img = new Image();
        img.onload = () => {
            srcCtx.clearRect(0, 0, SPRITE_W, SPRITE_H);
            srcCtx.imageSmoothingEnabled = false;
            srcCtx.drawImage(img, 0, 0, SPRITE_W, SPRITE_H);
            if (recordHistory) { pushHistory(); toast('Loaded current sprite'); }
            render();
            if (done) done();
        };
        img.onerror = () => {
            if (recordHistory) { pushHistory(); toast('No existing sprite — blank canvas', true); }
            render();
            if (done) done();
        };
        img.src = url;
    }

    function clearCanvas() {
        floating = null; selection = null; updateSelReadout();
        srcCtx.clearRect(0, 0, SPRITE_W, SPRITE_H);
        pushHistory();
        render();
    }

    // ===================================================================
    // Tool / color selection
    // ===================================================================
    function setTool(t) {
        if (t !== tool) {
            stampFloating();           // commit any lifted pixels before switching
            if (t !== 'select') { selection = null; updateSelReadout(); }
        }
        tool = t;
        root.querySelectorAll('.pe-tool').forEach(b => {
            b.classList.toggle('active', b.dataset.tool === t);
        });
        updateCursor();
    }

    function setColor(c) {
        color = c;
        els.currentSwatch.style.background = c;
        if (els.colorInput.value.toLowerCase() !== c.toLowerCase()) {
            els.colorInput.value = c;
        }
    }

    function recordColor(c) {
        c = c.toLowerCase();
        recentColors = recentColors.filter(x => x !== c);
        recentColors.unshift(c);
        if (recentColors.length > RECENT_LIMIT) recentColors.length = RECENT_LIMIT;
        buildRecentPalette();
    }

    function addCurrentColorToPalette() {
        const c = color.toLowerCase();
        if (!customPalette.includes(c)) {
            customPalette.push(c);
            saveCustomPalette();
            buildCustomPalette();
            toast('Color saved to palette');
        }
    }

    function loadCustomPalette() {
        try { customPalette = JSON.parse(localStorage.getItem(CUSTOM_KEY) || '[]'); }
        catch (e) { customPalette = []; }
    }
    function saveCustomPalette() {
        try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(customPalette)); } catch (e) { /* ignore */ }
    }

    function updateCursor() {
        let cur = 'crosshair';
        if (tool === 'pan' || spaceDown) cur = panning ? 'grabbing' : 'grab';
        else if (tool === 'picker') cur = 'cell';
        else if (tool === 'select') cur = 'crosshair';
        viewCanvas.style.cursor = cur;
    }

    function updateSelReadout() {
        if (floating) els.selVal.textContent = `${floating.w}×${floating.h} (moving)`;
        else if (selection) els.selVal.textContent = `${selection.w}×${selection.h}`;
        else els.selVal.textContent = 'none';
    }

    // ===================================================================
    // Reference overlay
    // ===================================================================
    function loadRefFromFile(file) {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            refImage = img;
            refVisible = true;
            els.refShow.checked = true;
            render();
            URL.revokeObjectURL(url);
            toast('Reference loaded');
        };
        img.onerror = () => { toast('Could not load reference image', true); URL.revokeObjectURL(url); };
        img.src = url;
    }

    function clearRef() {
        refImage = null;
        render();
    }

    // ===================================================================
    // Coordinate mapping
    // ===================================================================
    function eventToSource(e) {
        const rect = viewCanvas.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        return {
            x: Math.floor((cx - panX) / zoom),
            y: Math.floor((cy - panY) / zoom),
            cx, cy,
        };
    }

    function centerPoint() {
        return { cx: viewCanvas.width / 2, cy: viewCanvas.height / 2 };
    }

    function isShapeTool(t) { return SHAPE_TOOLS.indexOf(t) !== -1; }
    function pointInRect(p, r) { return r && p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h; }

    // ===================================================================
    // Pointer handlers
    // ===================================================================
    function onPointerDown(e) {
        e.preventDefault();
        viewCanvas.setPointerCapture(e.pointerId);
        const p = eventToSource(e);

        // Pan: pan tool, space held, or middle mouse.
        if (tool === 'pan' || spaceDown || e.button === 1) {
            panning = true;
            panStart = { cx: e.clientX, cy: e.clientY, panX, panY };
            updateCursor();
            return;
        }

        if (tool === 'picker') { pickColor(p.x, p.y); return; }

        if (tool === 'select') { onSelectDown(p); return; }

        // All remaining tools draw onto the canvas — commit any floating first.
        stampFloating();

        if (tool === 'fill') {
            floodFill(p.x, p.y);
            pushHistory();
            recordColor(color);
            render();
            return;
        }

        if (isShapeTool(tool)) {
            shapeStart = { x: p.x, y: p.y };
            shapeSnapshot = srcCtx.getImageData(0, 0, SPRITE_W, SPRITE_H);
            drawingShape = true;
            rasterShape(tool, p.x, p.y, p.x, p.y);
            render();
            return;
        }

        // Pencil / eraser stroke begins.
        drawing = true;
        lastDraw = null;
        applyBrush(p.x, p.y);
        lastDraw = { x: p.x, y: p.y };
        render();
    }

    function onSelectDown(p) {
        if (floating) {
            if (pointInRect(p, floating)) {
                selDrag = { mode: 'move', sx: p.x, sy: p.y, ox: floating.x, oy: floating.y };
                return;
            }
            stampFloating();    // clicked outside → drop it in place
        }
        if (selection && pointInRect(p, selection)) {
            liftSelection();    // begin moving the committed selection
            selDrag = { mode: 'move', sx: p.x, sy: p.y, ox: floating.x, oy: floating.y };
            return;
        }
        // Begin a new selection rectangle.
        selDrag = { mode: 'new', sx: p.x, sy: p.y };
        selection = { x: p.x, y: p.y, w: 1, h: 1 };
        updateSelReadout();
        render();
    }

    function onPointerMove(e) {
        const p = eventToSource(e);
        els.pos.textContent = (p.x >= 0 && p.x < SPRITE_W && p.y >= 0 && p.y < SPRITE_H)
            ? `${p.x}, ${p.y}` : '--, --';

        if (panning && panStart) {
            panX = panStart.panX + (e.clientX - panStart.cx);
            panY = panStart.panY + (e.clientY - panStart.cy);
            render();
            return;
        }

        if (selDrag) {
            if (selDrag.mode === 'new') {
                const x0 = clamp(selDrag.sx, 0, SPRITE_W - 1), y0 = clamp(selDrag.sy, 0, SPRITE_H - 1);
                const x1 = clamp(p.x, 0, SPRITE_W - 1), y1 = clamp(p.y, 0, SPRITE_H - 1);
                selection = {
                    x: Math.min(x0, x1), y: Math.min(y0, y1),
                    w: Math.abs(x1 - x0) + 1, h: Math.abs(y1 - y0) + 1
                };
            } else if (floating) {
                floating.x = selDrag.ox + (p.x - selDrag.sx);
                floating.y = selDrag.oy + (p.y - selDrag.sy);
            }
            updateSelReadout();
            render();
            return;
        }

        if (drawingShape) {
            srcCtx.putImageData(shapeSnapshot, 0, 0);
            rasterShape(tool, shapeStart.x, shapeStart.y, p.x, p.y);
            render();
            return;
        }

        if (drawing && (tool === 'pencil' || tool === 'eraser')) {
            if (lastDraw) lineApply(lastDraw.x, lastDraw.y, p.x, p.y);
            else applyBrush(p.x, p.y);
            lastDraw = { x: p.x, y: p.y };
            render();
        }
    }

    function onPointerUp() {
        if (selDrag) {
            if (selDrag.mode === 'new' && selection && (selection.w < 1 || selection.h < 1)) {
                selection = null;
            }
            selDrag = null;
            updateSelReadout();
            render();
        }
        if (drawingShape) {
            drawingShape = false;
            shapeSnapshot = null;
            pushHistory();
            recordColor(color);
        }
        if (drawing) {
            drawing = false;
            lastDraw = null;
            pushHistory();
            if (tool !== 'eraser') recordColor(color);
        }
        if (panning) {
            panning = false;
            panStart = null;
            updateCursor();
        }
    }

    function onWheel(e) {
        e.preventDefault();
        const rect = viewCanvas.getBoundingClientRect();
        zoomAt(e.deltaY < 0 ? 1.15 : 0.87, { cx: e.clientX - rect.left, cy: e.clientY - rect.top });
    }

    // ===================================================================
    // Drawing primitives (operate on the 500x333 source canvas)
    // ===================================================================
    function applyBrush(x, y) {
        const half = Math.floor(brushSize / 2);
        const x0 = x - half, y0 = y - half;
        if (tool === 'eraser') {
            srcCtx.clearRect(x0, y0, brushSize, brushSize);
        } else {
            srcCtx.globalAlpha = brushOpacity;
            srcCtx.fillStyle = color;
            srcCtx.fillRect(x0, y0, brushSize, brushSize);
            srcCtx.globalAlpha = 1;
        }
    }

    // Bresenham line, stamping the brush along it.
    function lineApply(x0, y0, x1, y1) {
        const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
        const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
        let err = dx - dy;
        while (true) {
            applyBrush(x0, y0);
            if (x0 === x1 && y0 === y1) break;
            const e2 = 2 * err;
            if (e2 > -dy) { err -= dy; x0 += sx; }
            if (e2 < dx) { err += dx; y0 += sy; }
        }
    }

    // ----- Shape rasterizers (commit into srcCtx) -----
    function rasterShape(t, x0, y0, x1, y1) {
        if (t === 'line') lineApply(x0, y0, x1, y1);
        else if (t === 'rect') rasterRect(x0, y0, x1, y1, shapeFill);
        else if (t === 'ellipse') rasterEllipse(x0, y0, x1, y1, shapeFill);
    }

    function rasterRect(x0, y0, x1, y1, fill) {
        const left = Math.min(x0, x1), right = Math.max(x0, x1);
        const top = Math.min(y0, y1), bottom = Math.max(y0, y1);
        if (fill) {
            srcCtx.globalAlpha = brushOpacity;
            srcCtx.fillStyle = color;
            srcCtx.fillRect(left, top, right - left + 1, bottom - top + 1);
            srcCtx.globalAlpha = 1;
        } else {
            lineApply(left, top, right, top);
            lineApply(left, bottom, right, bottom);
            lineApply(left, top, left, bottom);
            lineApply(right, top, right, bottom);
        }
    }

    function rasterEllipse(x0, y0, x1, y1, fill) {
        const left = Math.min(x0, x1), right = Math.max(x0, x1);
        const top = Math.min(y0, y1), bottom = Math.max(y0, y1);
        const a = (right - left) / 2, b = (bottom - top) / 2;
        const cx = (left + right) / 2, cy = (top + bottom) / 2;
        if (a < 0.5 || b < 0.5) { lineApply(left, top, right, bottom); return; }

        if (fill) {
            srcCtx.globalAlpha = brushOpacity;
            srcCtx.fillStyle = color;
            for (let y = top; y <= bottom; y++) {
                const ny = (y - cy) / b;
                if (Math.abs(ny) > 1) continue;
                const dx = a * Math.sqrt(1 - ny * ny);
                const xl = Math.round(cx - dx), xr = Math.round(cx + dx);
                srcCtx.fillRect(xl, y, xr - xl + 1, 1);
            }
            srcCtx.globalAlpha = 1;
        } else {
            // Scan rows then columns so the 1px outline has no gaps.
            for (let y = top; y <= bottom; y++) {
                const ny = (y - cy) / b;
                if (Math.abs(ny) > 1) continue;
                const dx = a * Math.sqrt(1 - ny * ny);
                applyBrush(Math.round(cx - dx), y);
                applyBrush(Math.round(cx + dx), y);
            }
            for (let x = left; x <= right; x++) {
                const nx = (x - cx) / a;
                if (Math.abs(nx) > 1) continue;
                const dy = b * Math.sqrt(1 - nx * nx);
                applyBrush(x, Math.round(cy - dy));
                applyBrush(x, Math.round(cy + dy));
            }
        }
    }

    function pickColor(x, y) {
        if (x < 0 || x >= SPRITE_W || y < 0 || y >= SPRITE_H) return;
        const d = srcCtx.getImageData(x, y, 1, 1).data;
        if (d[3] === 0) { toast('Picked transparent pixel', true); return; }
        setColor(rgbToHex(d[0], d[1], d[2]));
        setTool('pencil');
    }

    // 4-neighbour flood fill with exact-color matching.
    function floodFill(sx, sy) {
        if (sx < 0 || sx >= SPRITE_W || sy < 0 || sy >= SPRITE_H) return;
        const img = srcCtx.getImageData(0, 0, SPRITE_W, SPRITE_H);
        const data = img.data;
        const idx = (sy * SPRITE_W + sx) * 4;
        const target = [data[idx], data[idx + 1], data[idx + 2], data[idx + 3]];
        const fill = hexToRgb(color);
        const fillA = 255;

        if (target[0] === fill.r && target[1] === fill.g &&
            target[2] === fill.b && target[3] === fillA) return;

        const stack = [sy * SPRITE_W + sx];
        while (stack.length) {
            const pos = stack.pop();
            const o = pos * 4;
            if (data[o] !== target[0] || data[o + 1] !== target[1] ||
                data[o + 2] !== target[2] || data[o + 3] !== target[3]) continue;
            data[o] = fill.r; data[o + 1] = fill.g; data[o + 2] = fill.b; data[o + 3] = fillA;
            const px = pos % SPRITE_W, py = (pos - px) / SPRITE_W;
            if (px > 0) stack.push(pos - 1);
            if (px < SPRITE_W - 1) stack.push(pos + 1);
            if (py > 0) stack.push(pos - SPRITE_W);
            if (py < SPRITE_H - 1) stack.push(pos + SPRITE_W);
        }
        srcCtx.putImageData(img, 0, 0);
    }

    // ===================================================================
    // Selection / move / clipboard
    // ===================================================================
    function clampSelection() {
        if (!selection) return;
        const x = clamp(selection.x, 0, SPRITE_W - 1);
        const y = clamp(selection.y, 0, SPRITE_H - 1);
        selection = {
            x, y,
            w: clamp(selection.w, 1, SPRITE_W - x),
            h: clamp(selection.h, 1, SPRITE_H - y),
        };
    }

    // Lift the selected pixels off the canvas into a floating layer.
    function liftSelection() {
        clampSelection();
        const { x, y, w, h } = selection;
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(srcCanvas, x, y, w, h, 0, 0, w, h);
        srcCtx.clearRect(x, y, w, h);
        floating = { canvas: c, x, y, w, h };
        selection = null;
        updateSelReadout();
    }

    // Composite the floating layer back onto the canvas and record history.
    function stampFloating() {
        if (!floating) return;
        srcCtx.drawImage(floating.canvas, floating.x, floating.y);
        floating = null;
        updateSelReadout();
        pushHistory();
        render();
    }

    function copySelection() {
        if (!selection) { toast('Nothing selected', true); return; }
        clampSelection();
        const { x, y, w, h } = selection;
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(srcCanvas, x, y, w, h, 0, 0, w, h);
        clipboard = c;
        toast(`Copied ${w}×${h}`);
    }

    function cutSelection() {
        if (!selection) { toast('Nothing selected', true); return; }
        copySelection();
        const { x, y, w, h } = selection;
        srcCtx.clearRect(x, y, w, h);
        selection = null;
        updateSelReadout();
        pushHistory();
        render();
    }

    function pasteClipboard() {
        if (!clipboard) { toast('Clipboard empty', true); return; }
        stampFloating();
        const c = document.createElement('canvas');
        c.width = clipboard.width; c.height = clipboard.height;
        c.getContext('2d').drawImage(clipboard, 0, 0);
        const x = selection ? selection.x : 0;
        const y = selection ? selection.y : 0;
        floating = { canvas: c, x, y, w: c.width, h: c.height };
        setTool('select');
        updateSelReadout();
        render();
        toast('Pasted — drag to position, Enter to place');
    }

    function deleteSelection() {
        if (floating) { floating = null; updateSelReadout(); pushHistory(); render(); return; }
        if (!selection) return;
        clampSelection();
        const { x, y, w, h } = selection;
        srcCtx.clearRect(x, y, w, h);
        pushHistory();
        render();
    }

    function nudgeFloating(dx, dy) {
        if (!floating && selection) liftSelection();
        if (floating) {
            floating.x += dx; floating.y += dy;
            render();
        }
    }

    // ===================================================================
    // Zoom / pan
    // ===================================================================
    function zoomAt(factor, focus) {
        const newZoom = clamp(zoom * factor, MIN_ZOOM, MAX_ZOOM);
        if (newZoom === zoom) return;
        const sxBefore = (focus.cx - panX) / zoom;
        const syBefore = (focus.cy - panY) / zoom;
        zoom = newZoom;
        panX = focus.cx - sxBefore * zoom;
        panY = focus.cy - syBefore * zoom;
        render();
    }

    function fitToScreen() {
        const w = viewCanvas.width, h = viewCanvas.height;
        const margin = 24;
        zoom = clamp(Math.min((w - margin) / SPRITE_W, (h - margin) / SPRITE_H), MIN_ZOOM, MAX_ZOOM);
        panX = (w - SPRITE_W * zoom) / 2;
        panY = (h - SPRITE_H * zoom) / 2;
        render();
    }

    function resizeView() {
        const rect = els.wrap.getBoundingClientRect();
        viewCanvas.width = Math.max(100, Math.floor(rect.width));
        viewCanvas.height = Math.max(100, Math.floor(rect.height));
    }

    // ===================================================================
    // Rendering
    // ===================================================================
    function render() {
        const w = viewCanvas.width, h = viewCanvas.height;
        viewCtx.clearRect(0, 0, w, h);

        const dw = SPRITE_W * zoom, dh = SPRITE_H * zoom;

        drawCheckerboard(panX, panY, dw, dh);

        // Reference overlay sits under the sprite so you can trace over it.
        if (refImage && refVisible) {
            viewCtx.globalAlpha = refOpacity;
            viewCtx.imageSmoothingEnabled = false;
            viewCtx.drawImage(refImage, panX, panY, dw, dh);
            viewCtx.globalAlpha = 1;
        }

        viewCtx.imageSmoothingEnabled = false;
        viewCtx.drawImage(srcCanvas, panX, panY, dw, dh);

        // Floating (moved/pasted) pixels render above the sprite.
        if (floating) {
            viewCtx.imageSmoothingEnabled = false;
            viewCtx.drawImage(floating.canvas,
                panX + floating.x * zoom, panY + floating.y * zoom,
                floating.w * zoom, floating.h * zoom);
        }

        // Artboard border.
        viewCtx.strokeStyle = '#5c94fc';
        viewCtx.lineWidth = 1;
        viewCtx.strokeRect(panX + 0.5, panY + 0.5, dw, dh);

        if (showGrid && zoom >= GRID_MIN_ZOOM) drawGrid(dw, dh);

        if (selection) drawMarquee(selection, '#fcd444');
        if (floating) drawMarquee(floating, '#54fc54');

        els.zoomVal.textContent = Math.round(zoom * 100) + '%';
    }

    function drawMarquee(r, stroke) {
        viewCtx.save();
        viewCtx.setLineDash([4, 3]);
        viewCtx.strokeStyle = stroke;
        viewCtx.lineWidth = 1;
        viewCtx.strokeRect(panX + r.x * zoom + 0.5, panY + r.y * zoom + 0.5, r.w * zoom, r.h * zoom);
        viewCtx.restore();
    }

    function drawCheckerboard(ox, oy, dw, dh) {
        const tile = 8;
        viewCtx.save();
        viewCtx.beginPath();
        viewCtx.rect(ox, oy, dw, dh);
        viewCtx.clip();
        const startX = Math.floor(ox / tile) * tile;
        const startY = Math.floor(oy / tile) * tile;
        for (let y = startY; y < oy + dh; y += tile) {
            for (let x = startX; x < ox + dw; x += tile) {
                const odd = ((x / tile) + (y / tile)) % 2 !== 0;
                viewCtx.fillStyle = odd ? '#2c2c2c' : '#3c3c3c';
                viewCtx.fillRect(x, y, tile, tile);
            }
        }
        viewCtx.restore();
    }

    function drawGrid(dw, dh) {
        viewCtx.strokeStyle = 'rgba(255,255,255,0.18)';
        viewCtx.lineWidth = 1;
        viewCtx.beginPath();
        for (let x = 0; x <= SPRITE_W; x++) {
            const px = Math.round(panX + x * zoom) + 0.5;
            viewCtx.moveTo(px, panY);
            viewCtx.lineTo(px, panY + dh);
        }
        for (let y = 0; y <= SPRITE_H; y++) {
            const py = Math.round(panY + y * zoom) + 0.5;
            viewCtx.moveTo(panX, py);
            viewCtx.lineTo(panX + dw, py);
        }
        viewCtx.stroke();
    }

    // ===================================================================
    // Undo / redo
    // ===================================================================
    function pushHistory() {
        if (historyIndex < history.length - 1) {
            history = history.slice(0, historyIndex + 1);
        }
        history.push(srcCtx.getImageData(0, 0, SPRITE_W, SPRITE_H));
        if (history.length > HISTORY_LIMIT) history.shift();
        historyIndex = history.length - 1;
        updateHistoryButtons();
    }

    function restore(index) {
        // Pending floating/selection are invalidated by an undo/redo.
        floating = null; selection = null; selDrag = null;
        updateSelReadout();
        srcCtx.putImageData(history[index], 0, 0);
        render();
        updateHistoryButtons();
    }

    function undo() {
        stampFloating();
        if (historyIndex <= 0) return;
        historyIndex--;
        restore(historyIndex);
    }

    function redo() {
        if (historyIndex >= history.length - 1) return;
        historyIndex++;
        restore(historyIndex);
    }

    function updateHistoryButtons() {
        els.undo.disabled = historyIndex <= 0 && !floating;
        els.redo.disabled = historyIndex >= history.length - 1;
    }

    // ===================================================================
    // Save / export
    // ===================================================================
    function save() {
        if (!spriteType) return;
        stampFloating();    // bake any floating pixels before exporting
        const saveBtn = root.querySelector('#pe-save');
        saveBtn.disabled = true;
        saveBtn.textContent = 'SAVING…';
        srcCanvas.toBlob(async (blob) => {
            if (!blob) {
                toast('Export failed', true);
                saveBtn.disabled = false; saveBtn.textContent = 'SAVE';
                return;
            }
            const fd = new FormData();
            fd.append('file', blob, `${spriteType}.png`);
            try {
                const res = await fetch(`/api/admin/sprites/${spriteType}`, { method: 'POST', body: fd });
                if (res.ok) {
                    toast(`${spriteType} sprite saved`);
                    history = [srcCtx.getImageData(0, 0, SPRITE_W, SPRITE_H)];
                    historyIndex = 0;
                    updateHistoryButtons();
                    if (saveCallback) saveCallback();
                } else {
                    const err = await res.json().catch(() => ({}));
                    toast(err.error || 'Save failed', true);
                }
            } catch (e) {
                toast('Connection error', true);
            }
            saveBtn.disabled = false; saveBtn.textContent = 'SAVE';
        }, 'image/png');
    }

    // ===================================================================
    // Keyboard shortcuts
    // ===================================================================
    function onKeyDown(e) {
        if (!isOpen()) return;
        // Don't hijack typing in text/number inputs.
        if (e.target.tagName === 'INPUT' && e.target.type !== 'checkbox' && e.target.type !== 'range') {
            if (e.key === 'Escape') e.target.blur();
            return;
        }

        const ctrl = e.ctrlKey || e.metaKey;
        if (ctrl) {
            const k = e.key.toLowerCase();
            if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
            if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); return; }
            if (k === 'c') { e.preventDefault(); copySelection(); return; }
            if (k === 'x') { e.preventDefault(); cutSelection(); return; }
            if (k === 'v') { e.preventDefault(); pasteClipboard(); return; }
            return;
        }

        switch (e.key) {
            case 'Escape':
                if (floating) { stampFloating(); }
                else if (selection) { selection = null; updateSelReadout(); render(); }
                else if (confirmDiscard()) close();
                break;
            case 'Enter': if (floating) stampFloating(); break;
            case 'Delete': case 'Backspace': e.preventDefault(); deleteSelection(); break;
            case 'b': case 'B': setTool('pencil'); break;
            case 'e': case 'E': setTool('eraser'); break;
            case 'i': case 'I': setTool('picker'); break;
            case 'f': case 'F': setTool('fill'); break;
            case 'l': case 'L': setTool('line'); break;
            case 'r': case 'R': setTool('rect'); break;
            case 'o': case 'O': setTool('ellipse'); break;
            case 'm': case 'M': setTool('select'); break;
            case 'g': case 'G': els.grid.checked = !els.grid.checked; showGrid = els.grid.checked; render(); break;
            case '+': case '=': zoomAt(1.25, centerPoint()); break;
            case '-': case '_': zoomAt(0.8, centerPoint()); break;
            case '0': fitToScreen(); break;
            case 'ArrowLeft': if (selOrFloat()) { e.preventDefault(); nudgeFloating(-1, 0); } break;
            case 'ArrowRight': if (selOrFloat()) { e.preventDefault(); nudgeFloating(1, 0); } break;
            case 'ArrowUp': if (selOrFloat()) { e.preventDefault(); nudgeFloating(0, -1); } break;
            case 'ArrowDown': if (selOrFloat()) { e.preventDefault(); nudgeFloating(0, 1); } break;
            case ' ':
                if (!spaceDown) { spaceDown = true; updateCursor(); }
                e.preventDefault();
                break;
        }
    }

    function selOrFloat() { return tool === 'select' && (selection || floating); }

    function onKeyUp(e) {
        if (!isOpen()) return;
        if (e.key === ' ') { spaceDown = false; updateCursor(); }
    }

    // ===================================================================
    // Helpers
    // ===================================================================
    function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

    function hexToRgb(hex) {
        hex = hex.replace('#', '');
        if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
        const n = parseInt(hex, 16);
        return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
    }

    function rgbToHex(r, g, b) {
        return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
    }

    function toast(msg, isError) {
        const el = document.getElementById('toast');
        if (!el) return;
        el.textContent = msg;
        el.classList.remove('hidden', 'error');
        if (isError) el.classList.add('error');
        clearTimeout(el._timer);
        el._timer = setTimeout(() => el.classList.add('hidden'), 3000);
    }

    // Expose public API
    window.PixelEditor = { open, close };
})();
