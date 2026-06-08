// ADS-Bit In-App Pixel Editor
// A dependency-free Canvas2D sprite editor for the admin Sprites tab.
// Edits sprites at their native 500x333 resolution and exports a PNG that
// is POSTed to the existing /api/admin/sprites/{type} endpoint.
//
// Public API:
//   PixelEditor.open(spriteType, { existingUrl, onSave })
//
// Tools: pencil, eraser, color picker, fill bucket, pan.
// Features: zoom/pan, undo/redo, grid overlay, load existing, export PNG.
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

    // ----- Retro palette (SNES-style white/blue/red leaning) -----
    const PALETTE = [
        '#000000', '#1a1a1a', '#3c3c3c', '#5c5c5c', '#9c9c9c', '#fcfcfc',
        '#5c94fc', '#3c5cac', '#1a2c6c', '#b4d4ec', '#54b4fc', '#0c84fc',
        '#fc5454', '#ac2c2c', '#fc9c9c', '#fcd444', '#fc9838', '#a85400',
        '#54fc54', '#2c942c', '#a4e4a4', '#fc54fc', '#9438a8', '#54fcdc',
    ];

    // ----- Module state -----
    let root = null;            // overlay element
    let els = {};               // cached DOM references

    let srcCanvas = null;       // 500x333 source-of-truth canvas
    let srcCtx = null;
    let viewCanvas = null;      // on-screen scaled render target
    let viewCtx = null;

    let tool = 'pencil';
    let brushSize = 1;
    let color = '#5c94fc';
    let zoom = 1;
    let panX = 0, panY = 0;
    let showGrid = true;

    let spriteType = null;
    let saveCallback = null;

    // Pointer interaction state
    let drawing = false;        // a draw stroke is in progress
    let panning = false;        // a pan drag is in progress
    let spaceDown = false;      // hold space to temporarily pan
    let lastDraw = null;        // last source pixel during a stroke {x,y}
    let panStart = null;        // {x,y,panX,panY} at pan start

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
                        <div class="pe-palette" id="pe-palette"></div>
                        <div class="pe-readout">
                            <div>POS <span id="pe-pos">--, --</span></div>
                            <div>ZOOM <span id="pe-zoom-val">100%</span></div>
                            <div>SIZE 500×333</div>
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
        els.currentSwatch = root.querySelector('#pe-current-swatch');
        els.colorInput = root.querySelector('#pe-color-input');
        els.pos = root.querySelector('#pe-pos');
        els.zoomVal = root.querySelector('#pe-zoom-val');
        els.brush = root.querySelector('#pe-brush');
        els.brushVal = root.querySelector('#pe-brush-val');
        els.grid = root.querySelector('#pe-grid');
        els.undo = root.querySelector('#pe-undo');
        els.redo = root.querySelector('#pe-redo');

        viewCanvas = root.querySelector('#pe-view');
        viewCtx = viewCanvas.getContext('2d');

        // Source-of-truth canvas (offscreen)
        srcCanvas = document.createElement('canvas');
        srcCanvas.width = SPRITE_W;
        srcCanvas.height = SPRITE_H;
        srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true });

        buildPalette();
        wireEvents();
    }

    function buildPalette() {
        els.palette.innerHTML = '';
        PALETTE.forEach(c => {
            const sw = document.createElement('button');
            sw.className = 'pe-swatch';
            sw.style.background = c;
            sw.title = c;
            sw.addEventListener('click', () => setColor(c));
            els.palette.appendChild(sw);
        });
    }

    // ===================================================================
    // Event wiring
    // ===================================================================
    function wireEvents() {
        // Tool buttons
        root.querySelectorAll('.pe-tool').forEach(btn => {
            btn.addEventListener('click', () => setTool(btn.dataset.tool));
        });

        // Header actions
        root.querySelector('#pe-close').addEventListener('click', () => {
            if (confirmDiscard()) close();
        });
        root.querySelector('#pe-save').addEventListener('click', save);
        root.querySelector('#pe-load').addEventListener('click', () => loadExisting(true));
        root.querySelector('#pe-clear').addEventListener('click', clearCanvas);

        // Zoom controls
        root.querySelector('#pe-zoom-in').addEventListener('click', () => zoomAt(1.25, centerPoint()));
        root.querySelector('#pe-zoom-out').addEventListener('click', () => zoomAt(0.8, centerPoint()));
        root.querySelector('#pe-zoom-fit').addEventListener('click', fitToScreen);

        // Undo/redo
        els.undo.addEventListener('click', undo);
        els.redo.addEventListener('click', redo);

        // Grid + brush
        els.grid.addEventListener('change', () => { showGrid = els.grid.checked; render(); });
        els.brush.addEventListener('input', () => {
            brushSize = parseInt(els.brush.value, 10);
            els.brushVal.textContent = brushSize;
        });

        // Color input
        els.colorInput.addEventListener('input', () => setColor(els.colorInput.value));

        // Canvas pointer events
        viewCanvas.addEventListener('pointerdown', onPointerDown);
        viewCanvas.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
        viewCanvas.addEventListener('pointerleave', () => { els.pos.textContent = '--, --'; });
        viewCanvas.addEventListener('wheel', onWheel, { passive: false });
        viewCanvas.addEventListener('contextmenu', e => e.preventDefault());

        // Keyboard shortcuts (only active while editor is open)
        document.addEventListener('keydown', onKeyDown);
        document.addEventListener('keyup', onKeyUp);

        // Keep the view sized to its container
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

        // Reset state
        zoom = 1; panX = 0; panY = 0;
        history = []; historyIndex = -1;
        setTool('pencil');
        srcCtx.clearRect(0, 0, SPRITE_W, SPRITE_H);

        root.classList.remove('hidden');
        document.body.classList.add('pe-open');

        // Load existing sprite (if any), then size + draw.
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
        // Only warn if there is edit history beyond the baseline.
        if (historyIndex > 0) {
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
            // Draw centered/stretched into the 500x333 buffer.
            srcCtx.imageSmoothingEnabled = false;
            srcCtx.drawImage(img, 0, 0, SPRITE_W, SPRITE_H);
            if (recordHistory) { pushHistory(); toast('Loaded current sprite'); }
            render();
            if (done) done();
        };
        img.onerror = () => {
            // No existing sprite — start from a blank transparent canvas.
            if (recordHistory) { pushHistory(); toast('No existing sprite — blank canvas', true); }
            render();
            if (done) done();
        };
        img.src = url;
    }

    function clearCanvas() {
        srcCtx.clearRect(0, 0, SPRITE_W, SPRITE_H);
        pushHistory();
        render();
    }

    // ===================================================================
    // Tool / color selection
    // ===================================================================
    function setTool(t) {
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

    function updateCursor() {
        let cur = 'crosshair';
        if (tool === 'pan' || spaceDown) cur = panning ? 'grabbing' : 'grab';
        else if (tool === 'picker') cur = 'cell';
        viewCanvas.style.cursor = cur;
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

        if (tool === 'picker') {
            pickColor(p.x, p.y);
            return;
        }

        if (tool === 'fill') {
            floodFill(p.x, p.y);
            pushHistory();
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

    function onPointerMove(e) {
        const p = eventToSource(e);
        if (p.x >= 0 && p.x < SPRITE_W && p.y >= 0 && p.y < SPRITE_H) {
            els.pos.textContent = `${p.x}, ${p.y}`;
        } else {
            els.pos.textContent = '--, --';
        }

        if (panning && panStart) {
            panX = panStart.panX + (e.clientX - panStart.cx);
            panY = panStart.panY + (e.clientY - panStart.cy);
            render();
            return;
        }

        if (drawing && (tool === 'pencil' || tool === 'eraser')) {
            // Interpolate from the last point so fast strokes have no gaps.
            if (lastDraw) lineApply(lastDraw.x, lastDraw.y, p.x, p.y);
            else applyBrush(p.x, p.y);
            lastDraw = { x: p.x, y: p.y };
            render();
        }
    }

    function onPointerUp() {
        if (drawing) {
            drawing = false;
            lastDraw = null;
            pushHistory();          // one undo step per completed stroke
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
        const focus = { cx: e.clientX - rect.left, cy: e.clientY - rect.top };
        zoomAt(e.deltaY < 0 ? 1.15 : 0.87, focus);
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
            srcCtx.fillStyle = color;
            srcCtx.fillRect(x0, y0, brushSize, brushSize);
        }
    }

    // Bresenham line between two source pixels, stamping the brush along it.
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

        // No-op if the target already equals the fill color.
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
    // Zoom / pan
    // ===================================================================
    function zoomAt(factor, focus) {
        const newZoom = clamp(zoom * factor, MIN_ZOOM, MAX_ZOOM);
        if (newZoom === zoom) return;
        // Keep the source pixel under the focus point stationary.
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

        // Transparency checkerboard behind the artboard.
        drawCheckerboard(panX, panY, dw, dh);

        // The sprite itself, nearest-neighbour scaled.
        viewCtx.imageSmoothingEnabled = false;
        viewCtx.drawImage(srcCanvas, panX, panY, dw, dh);

        // Artboard border.
        viewCtx.strokeStyle = '#5c94fc';
        viewCtx.lineWidth = 1;
        viewCtx.strokeRect(panX + 0.5, panY + 0.5, dw, dh);

        if (showGrid && zoom >= GRID_MIN_ZOOM) drawGrid(dw, dh);

        els.zoomVal.textContent = Math.round(zoom * 100) + '%';
    }

    function drawCheckerboard(ox, oy, dw, dh) {
        const tile = 8;
        // Clip to artboard so the checker stays inside the sprite bounds.
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
        // Drop any redo tail.
        if (historyIndex < history.length - 1) {
            history = history.slice(0, historyIndex + 1);
        }
        history.push(srcCtx.getImageData(0, 0, SPRITE_W, SPRITE_H));
        // Cap memory use.
        if (history.length > HISTORY_LIMIT) history.shift();
        historyIndex = history.length - 1;
        updateHistoryButtons();
    }

    function undo() {
        if (historyIndex <= 0) return;
        historyIndex--;
        srcCtx.putImageData(history[historyIndex], 0, 0);
        render();
        updateHistoryButtons();
    }

    function redo() {
        if (historyIndex >= history.length - 1) return;
        historyIndex++;
        srcCtx.putImageData(history[historyIndex], 0, 0);
        render();
        updateHistoryButtons();
    }

    function updateHistoryButtons() {
        els.undo.disabled = historyIndex <= 0;
        els.redo.disabled = historyIndex >= history.length - 1;
    }

    // ===================================================================
    // Save / export
    // ===================================================================
    function save() {
        if (!spriteType) return;
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
                const res = await fetch(`/api/admin/sprites/${spriteType}`, {
                    method: 'POST', body: fd,
                });
                if (res.ok) {
                    toast(`${spriteType} sprite saved`);
                    // Treat the saved state as the new baseline.
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
        // Don't hijack typing in inputs.
        if (e.target.tagName === 'INPUT' && e.target.type !== 'checkbox' && e.target.type !== 'range') {
            if (e.key === 'Escape') e.target.blur();
            return;
        }

        const ctrl = e.ctrlKey || e.metaKey;
        if (ctrl && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
        if (ctrl && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
            e.preventDefault(); redo(); return;
        }

        switch (e.key) {
            case 'Escape': if (confirmDiscard()) close(); break;
            case 'b': case 'B': setTool('pencil'); break;
            case 'e': case 'E': setTool('eraser'); break;
            case 'i': case 'I': setTool('picker'); break;
            case 'f': case 'F': setTool('fill'); break;
            case 'g': case 'G': els.grid.checked = !els.grid.checked; showGrid = els.grid.checked; render(); break;
            case '+': case '=': zoomAt(1.25, centerPoint()); break;
            case '-': case '_': zoomAt(0.8, centerPoint()); break;
            case '0': fitToScreen(); break;
            case ' ':
                if (!spaceDown) { spaceDown = true; updateCursor(); }
                e.preventDefault();
                break;
        }
    }

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

    // Reuse the admin toast if present, else fall back to a console message.
    function toast(msg, isError) {
        const el = document.getElementById('toast');
        if (!el) { return; }
        el.textContent = msg;
        el.classList.remove('hidden', 'error');
        if (isError) el.classList.add('error');
        clearTimeout(el._timer);
        el._timer = setTimeout(() => el.classList.add('hidden'), 3000);
    }

    // Expose public API
    window.PixelEditor = { open, close };
})();
