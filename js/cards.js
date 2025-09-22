import { state, ALL_DIRECTIONS, CATEGORY_CATALOG } from './state.js';
import { $, $$, formatBytes } from './utils.js';
import { createColorSelect } from './colors.js';
import { buildTagsPicker, buildCategoryPicker } from './tags.js';
import { recalcCountsAndTags, pushJSON } from './data.js';
import { showNotification } from './notifications.js';

/* =========================
   Helpers Overlay / Grille
   ========================= */

/** Retourne (scale, dispW, dispH, offX, offY, cw, ch, iw, ih) pour un wrapper + <img> en object-contain */
function computeContainMetrics(wrapper, img){
    const cw = wrapper.clientWidth || 1;
    const ch = wrapper.clientHeight || 1;
    const iw = img.naturalWidth || 1;
    const ih = img.naturalHeight || 1;
    const scale = Math.min(cw / iw, ch / ih);
    const dispW = iw * scale;
    const dispH = ih * scale;
    const offX = (cw - dispW) / 2;
    const offY = (ch - dispH) / 2;
    return { scale, dispW, dispH, offX, offY, cw, ch, iw, ih };
}

/** Prépare un canvas HiDPI et renvoie le ctx en unités CSS px */
function sizeCanvasFor(wrapper, canvas){
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const w = wrapper.clientWidth || 1;
    const h = wrapper.clientHeight || 1;
    canvas.width  = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    canvas.style.width  = w + 'px';
    canvas.style.height = h + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
}

/** Dessine la grille 32×32 (source) selon le scale + cases sélectionnées */
function drawGridOverlay(canvas, metrics, selectedSet){
    const { dispW, dispH, offX, offY, scale } = metrics;
    const ctx = sizeCanvasFor(canvas.parentElement, canvas);

    // clear
    ctx.clearRect(0,0,canvas.parentElement.clientWidth, canvas.parentElement.clientHeight);

    // zone image
    const x0 = offX, y0 = offY, x1 = offX + dispW, y1 = offY + dispH;

    const tile = 32 * scale;     // taille d'un carré 32 source à l'écran
    const major = tile * 4;      // trait majeur toutes les 4 cases

    // Sélections (remplissage rouge)
    if (selectedSet && selectedSet.size){
        ctx.save();
        ctx.beginPath();
        ctx.rect(x0, y0, dispW, dispH);
        ctx.clip();
        ctx.fillStyle = 'rgba(239, 68, 68, 0.25)'; // red-500 @ 25%
        selectedSet.forEach(key=>{
            const [cxStr, cyStr] = key.split(',');
            const cx = parseInt(cxStr,10), cy = parseInt(cyStr,10);
            const px = x0 + cx * tile;
            const py = y0 + cy * tile;
            ctx.fillRect(px, py, tile, tile);
        });
        ctx.restore();
    }

    // Grille fine
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, dispW, dispH);
    ctx.clip();
    ctx.strokeStyle = 'rgba(0,0,0,0.15)';
    ctx.lineWidth = 1;
    for (let x = x0; x <= x1 + 0.5; x += tile){
        ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke();
    }
    for (let y = y0; y <= y1 + 0.5; y += tile){
        ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
    }

    // Lignes majeures
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1.5;
    for (let x = x0; x <= x1 + 0.5; x += major){
        ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke();
    }
    for (let y = y0; y <= y1 + 0.5; y += major){
        ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
    }
    ctx.restore();

    // Contour zone image (optionnel)
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.strokeRect(x0, y0, dispW, dispH);
}

/** Convertit un clic dans le canvas vers la cellule (cx, cy) 32px */
function pickCellFromClick(evt, metrics){
    const tile = 32 * metrics.scale;
    const x0 = metrics.offX;
    const y0 = metrics.offY;
    const rect = evt.currentTarget.getBoundingClientRect();
    const x = evt.clientX - rect.left;
    const y = evt.clientY - rect.top;
    if (x < x0 || y < y0 || x > x0 + metrics.dispW || y > y0 + metrics.dispH) return null;
    const cx = Math.floor((x - x0) / tile);
    const cy = Math.floor((y - y0) / tile);
    return { cx, cy };
}

/* =========================
   Carte / Card (UI)
   ========================= */

export function buildAssetCard(asset){
    // Garde-fous : s'assurer que certains champs State existent
    if (!state.gridSelections || !(state.gridSelections instanceof Map)) {
        state.gridSelections = new Map();
    }
    if (!state.selected || !(state.selected instanceof Set)) {
        state.selected = new Set();
    }

    const card = document.createElement('div');
    card.className='asset-card rounded-xl border border-gray-200 bg-white p-3 shadow-sm hover:shadow transition';
    card.dataset.imagePath = asset?.imagePath || '';
    card.tabIndex = 0;

    if (state.selected.has(asset.imagePath)){
        card.classList.add('selected','border-green-500','bg-green-50');
    }

    // Image wrapper (relative pour overlay)
    const imageContainer = document.createElement('div');
    imageContainer.className = 'relative';
    const img = new Image();
    img.className = 'w-full h-48 object-contain bg-white rounded-md border border-gray-200';
    const overlay = document.createElement('canvas');
    overlay.className = 'absolute inset-0 z-10'; // devant l'image
    overlay.setAttribute('aria-label', 'grid overlay');
    overlay.style.cursor = 'crosshair';

    const details = document.createElement('div');
    details.className = 'mt-1 text-xs text-gray-500';
    const filename = (asset.imagePath || '').split('/').pop() || '';
    let dimsText = '', sizeText = '';
    details.innerHTML = `<small><strong>${filename}</strong></small>`;

    imageContainer.appendChild(img);
    imageContainer.appendChild(overlay);
    imageContainer.appendChild(details);
    card.appendChild(imageContainer);

    // Sélections de grille pour cet asset
    if (!state.gridSelections.has(asset.imagePath)) {
        state.gridSelections.set(asset.imagePath, new Set());
    }
    const selSet = state.gridSelections.get(asset.imagePath);

    let loadedOk = false;
    let lastMetrics = null;

    const ro = new ResizeObserver(()=>{
        if (!loadedOk) return;
        lastMetrics = computeContainMetrics(imageContainer, img);
        drawGridOverlay(overlay, lastMetrics, selSet);
    });

    function renderDetails(){
        if (!loadedOk) {
            details.innerHTML = `<small><strong>${filename}</strong> — Loading…</small>`;
            return;
        }
        details.innerHTML = `<small><strong>${filename}</strong> — ${dimsText}${sizeText ? ' — ' + sizeText : ''}</small>`;
    }

    const onLoad = () => {
        loadedOk = true;
        dimsText = `${img.naturalWidth}×${img.naturalHeight}px`;
        lastMetrics = computeContainMetrics(imageContainer, img);
        drawGridOverlay(overlay, lastMetrics, selSet);
        renderDetails();
        ro.observe(imageContainer);
    };

    const onError = () => {
        loadedOk = false;
        details.innerHTML = `<small><strong>${filename}</strong> — Failed to load</small>`;
    };

    img.addEventListener('load', onLoad, { once:true });
    img.addEventListener('error', onError, { once:true });

    // HEAD pour taille fichier (optionnel)
    (async () => {
        try {
            const r = await fetch(asset.imagePath, { method: 'HEAD' });
            const size = r.ok ? Number(r.headers.get('content-length') || 0) : 0;
            sizeText = size ? formatBytes(size) : '';
            if (loadedOk) renderDetails();
        } catch {}
    })();

    img.src = asset.imagePath;
    if (img.complete) {
        if (img.naturalWidth > 0) onLoad(); else onError();
    } else {
        renderDetails();
    }

    // Interaction overlay : clic => toggle case
    overlay.addEventListener('click', (ev)=>{
        ev.stopPropagation(); // ne pas sélectionner la card
        if (!loadedOk || !lastMetrics) return;
        const cell = pickCellFromClick(ev, lastMetrics);
        if (!cell) return;
        const key = `${cell.cx},${cell.cy}`;
        if (selSet.has(key)) selSet.delete(key); else selSet.add(key);
        drawGridOverlay(overlay, lastMetrics, selSet);
    });

    // ==== Form fields ====

    const formGroup = (labelText) => {
        const wrap = document.createElement('div');
        wrap.className = 'form-group mt-3';
        const label = document.createElement('label');
        label.className = 'block text-xs text-gray-600 mb-1';
        label.textContent = labelText;
        wrap.appendChild(label);
        return { wrap, label };
    };

    // Name
    {
        const { wrap } = formGroup('Name');
        const input = document.createElement('input');
        input.className = 'editable-field h-9 w-full rounded-lg border border-gray-300 bg-white px-3 outline-none focus:border-gray-400';
        input.type = 'text';
        input.value = asset.name || '';
        input.addEventListener('click', e=>e.stopPropagation());
        input.addEventListener('change', (e)=> updateAsset(asset.imagePath, 'name', e.target.value));
        wrap.appendChild(input);
        card.appendChild(wrap);
    }

    // Tags (dropdown ABSOLUTE)
    {
        const { wrap } = formGroup('Tags');
        wrap.innerHTML += `
      <div class="custom-tags-select relative rounded-lg border border-gray-300 bg-white">
        <div class="tags-input-container flex flex-wrap items-center gap-2 p-2" data-component="tags-input">
          <input type="text" placeholder="Pick tags…" aria-label="Edit tags"
                 class="h-9 min-w-[10rem] flex-1 outline-none"/>
        </div>
        <div class="tags-list-container absolute left-0 right-0 top-full mt-1 max-h-64 overflow-auto rounded-lg border border-gray-200 bg-white shadow-lg z-50 hidden" aria-hidden="true"></div>
      </div>`;
        const tagsCtl = buildTagsPicker(wrap.querySelector('.custom-tags-select'), {
            role:'card',
            onChange: (tags) => updateAsset(asset.imagePath, 'tags', tags)
        });
        tagsCtl.setTags(asset.tags || []);
        card.appendChild(wrap);
    }

    // Category (multi, dropdown ABSOLUTE) — si utilisé
    {
        const { wrap } = formGroup('Category');
        wrap.innerHTML += `
      <div class="category-select relative rounded-lg border border-gray-300 bg-white">
        <div class="tags-input-container flex flex-wrap items-center gap-2 p-2" data-component="tags-input">
          <input type="text" placeholder="Pick category…" aria-label="Edit category"
                 class="h-9 min-w-[10rem] flex-1 outline-none cursor-pointer"/>
        </div>
        <div class="tags-list-container absolute left-0 right-0 top-full mt-1 max-h-64 overflow-auto rounded-lg border border-gray-200 bg-white shadow-lg z-50 hidden" aria-hidden="true"></div>
      </div>`;
        const catRoot = wrap.querySelector('.category-select');
        const initial = Array.isArray(asset.category) ? asset.category : (asset.category ? [asset.category] : []);
        buildCategoryPicker(catRoot, {
            options: (window.CATEGORY_CATALOG || CATEGORY_CATALOG || []).map(c=>({label:c.label||c, hint:c.hint||''})),
            values: initial,
            label: 'Pick category…',
            onChange: (vals) => updateAsset(asset.imagePath, 'category', vals)
        });
        card.appendChild(wrap);
    }

    // Primary Color (dropdown ABSOLUTE)
    {
        const { wrap } = formGroup('Color');
        wrap.innerHTML += `
      <div class="custom-color-select relative rounded-lg border border-gray-300 bg-white" data-component="color-select" aria-haspopup="listbox" aria-expanded="false">
        <div class="selected-color-display flex h-10 cursor-pointer items-center gap-2 px-3" tabindex="0">
          <div class="color-swatch h-5 w-5 rounded border border-gray-300"></div>
          <span class="color-name text-sm">Leave unchanged</span>
          <span class="color-hex text-xs text-gray-500"></span>
          <div class="dropdown-arrow ml-auto">▾</div>
        </div>
        <div class="color-options-list absolute left-0 right-0 top-full mt-1 max-h-64 overflow-auto rounded-lg border border-gray-200 bg-white shadow-lg z-50 hidden" role="listbox" aria-hidden="true"></div>
      </div>`;
        const root = wrap.querySelector('[data-component="color-select"]');
        createColorSelect(root, {
            initialHex: asset.color || '',
            allowAll:false,
            onChange:(hex)=>{ const v = (hex==='transparent') ? '' : hex; updateAsset(asset.imagePath, 'color', v); }
        });
        card.appendChild(wrap);
    }

    // Secondary Color (dropdown ABSOLUTE)
    {
        const { wrap } = formGroup('Secondary Color');
        wrap.innerHTML += `
      <div class="custom-color-select relative rounded-lg border border-gray-300 bg-white" data-component="color-select" aria-haspopup="listbox" aria-expanded="false">
        <div class="selected-color-display flex h-10 cursor-pointer items-center gap-2 px-3" tabindex="0">
          <div class="color-swatch h-5 w-5 rounded border border-gray-300"></div>
          <span class="color-name text-sm">Leave unchanged</span>
          <span class="color-hex text-xs text-gray-500"></span>
          <div class="dropdown-arrow ml-auto">▾</div>
        </div>
        <div class="color-options-list absolute left-0 right-0 top-full mt-1 max-h-64 overflow-auto rounded-lg border border-gray-200 bg-white shadow-lg z-50 hidden" role="listbox" aria-hidden="true"></div>
      </div>`;
        const root = wrap.querySelector('[data-component="color-select"]');
        createColorSelect(root, {
            initialHex: asset.secondaryColor || '',
            allowAll:false,
            onChange:(hex)=>{ const v = (hex==='transparent') ? '' : hex; updateAsset(asset.imagePath, 'secondaryColor', v); }
        });
        card.appendChild(wrap);
    }

    // Direction
    {
        const { wrap } = formGroup('Direction');
        const dirSelect = document.createElement('select');
        dirSelect.className = 'editable-field h-9 w-full rounded-lg border border-gray-300 bg-white px-3 outline-none focus:border-gray-400';
        for (const d of ALL_DIRECTIONS){
            const opt = document.createElement('option');
            opt.value=d;
            const c = state.counts.direction[d] || 0;
            opt.textContent = `${d} (${c})`;
            dirSelect.appendChild(opt);
        }
        dirSelect.value = asset.direction || '';
        dirSelect.addEventListener('click', (e)=> e.stopPropagation());
        dirSelect.addEventListener('change', (e)=> updateAsset(asset.imagePath, 'direction', e.target.value));
        wrap.appendChild(dirSelect);
        card.appendChild(wrap);
    }

    // Sélection carte (ne pas sélectionner si contrôle)
    const CONTROL_SELECTOR = "canvas, input, select, textarea, button, .selected-color-display, .tags-input-container, .tags-list-container, .color-options-list";
    card.addEventListener('click', (ev)=>{
        if (ev.target.closest(CONTROL_SELECTOR)) return;
        if (card.classList.contains('selected')){
            card.classList.remove('selected','border-green-500','bg-green-50');
            state.selected.delete(asset.imagePath);
        } else {
            card.classList.add('selected','border-green-500','bg-green-50');
            state.selected.add(asset.imagePath);
        }
        $('#selected-count').textContent = String(state.selected.size);
        $('#deselect-btn').classList.toggle('hidden', state.selected.size === 0);
        $('#validate-btn').classList.toggle('hidden', state.selected.size === 0);
        $('#bulk-edit-btn').classList.toggle('hidden', state.selected.size === 0);
    });

    state.cardsByPath.set(asset.imagePath, { card });
    return card;
}

export function updateAsset(imagePath, field, value){
    const asset = state.data.collection.find(a => a.imagePath === imagePath);
    if (!asset) return;
    asset[field] = value; // 'category' peut être un tableau
    const fileLabel = asset.name || (asset.imagePath.split('/').pop() || 'item');
    const fieldLabel = (field.charAt(0).toUpperCase() + field.slice(1));
    showNotification('info', `${fieldLabel} updated on "${fileLabel}"`);
    recalcCountsAndTags();
    pushJSON();
}