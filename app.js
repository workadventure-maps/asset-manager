(() => {
  /* =============================
     Asset Manager - app.js (grid + collision highlights)
     ============================= */

  const API_URL = 'http://localhost:8000';
  let ASSETS_FILE = 'assets_list.json'; // <- can change if we reset after upload

  // ==== STATE (unique, defensive) ===========================================
  if (!window.state) {
    window.state = {
      data: { collectionName: '', tags: [], collection: [] },
      filtered: [],
      renderList: [],
      selection: new Set(),
      cardsByPath: new Map(),
      debounceTimers: {},
      // Infinite scroll (kept)
      pagination: { batchSize: 50, page: 0, loading: false, renderedCount: 0 },
      // filters
      filter: { name:'', tags:[], direction:'', colorHex:'' },
      // catalog/meta
      availableTags: [],
      counts: { tags:{}, direction:{}, color:{} },
      // NEW: toggle dist32
      useProcessedDir: false,

      // NEW: info about source (default: file)
      source: { type: 'file', name: 'assets_list.json' } // type: 'file' | 'upload'
    };
  }
  const state = window.state;

  // ==== Constantes (BACK OK) ===============================================
  const ALL_TAGS_DEFAULT = [
    "Furniture","Bathroom","Kitchen","Electronics","Decoration","Lighting",
    "Meeting & School","Outdoor","Recreation & Gaming"
  ];
  const ALL_DIRECTIONS = ["front","back","left","right","up","down","unknow"];
  const COLOR_FAMILIES = {
    red:"#FF0000",maroon:"#800000",crimson:"#DC143C",coral:"#FF7F50",
    blue:"#0000FF",navy:"#000080",teal:"#008080",cyan:"#00FFFF",
    light_blue:"#ADD8E6",yellow:"#FFFF00",gold:"#FFD700",green:"#00FF00",
    lime:"#00FF00",forest_green:"#228B22",olive:"#808000",brown:"#A52A2A",
    chocolate:"#D2691E",saddlebrown:"#8B4513",orange:"#FFA500",purple:"#800080",
    magenta:"#FF00FF",fuchsia:"#FF00FF",pink:"#FFC0CB",hot_pink:"#FF69B4",
    grey:"#808080",dark_grey:"#A9A9A9",light_grey:"#D3D3D3",black:"#000000",
    white:"#FFFFFF",beige:"#F5F5DC",tan:"#D2B48C"
  };

  // ==== Categories (English labels stored; English examples shown) =========
  const CATEGORY_LIST = [
    { value: 'Architecture & Buildings', examples: 'walls, roofs, houses, offices, shops…' },
    { value: 'Furniture & Decoration', examples: 'chairs, tables, lamps, rugs, paintings…' },
    { value: 'Equipment & Objects', examples: 'computers, machines, tools, vending machines…' },
    { value: 'Nature & Landscape', examples: 'trees, plants, rocks, water, sky, weather…' },
    { value: 'Infrastructure & Outdoor', examples: 'roads, bridges, sidewalks, fences, benches, fountains…' },
    { value: 'Characters & Avatars', examples: 'NPCs, sprites, costumes, accessories…' },
    { value: 'Vehicles & Transport', examples: 'cars, bikes, boats, planes…' },
    { value: 'Signage & UI', examples: 'signs, posters, icons, arrows, wayfinding…' },
    { value: 'Interactive Elements', examples: 'doors, buttons, terminals, arcade cabinets…' },
    { value: 'Lighting & VFX', examples: 'streetlights, torches, neon lights, particles, light halos…' },
    { value: 'Sound & Music', examples: 'sound effects, ambiences, background music' },
    { value: 'Special / Thematic', examples: 'festive, seasonal, cultural, futuristic, medieval…' },
  ];

  // ==== Helpers =============================================================
  const $  = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));

  function debounce(key, fn, delay=150){
    clearTimeout(state.debounceTimers[key]);
    state.debounceTimers[key] = setTimeout(fn, delay);
  }
  function patchText(el, text){ if (el && el.textContent !== String(text)) el.textContent = String(text); }
  function setHidden(el, hidden){ if (el) el.style.display = hidden ? 'none' : ''; }

  const hexToRgb = (hex) => {
    if (!hex) return null;
    const short = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
    hex = hex.replace(short, (_,r,g,b)=>r+r+g+g+b+b);
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return m ? { r:parseInt(m[1],16), g:parseInt(m[2],16), b:parseInt(m[3],16)} : null;
  };
  const closestColorFamily = (hex) => {
    const rgb = hexToRgb(hex); if (!rgb) return "unknown";
    let min = Infinity, best = "unknown";
    for (const [name, hex2] of Object.entries(COLOR_FAMILIES)){
      const c = hexToRgb(hex2); if (!c) continue;
      const d = (rgb.r-c.r)**2 + (rgb.g-c.g)**2 + (rgb.b-c.b)**2;
      if (d < min){ min = d; best = name; }
    }
    return best;
  };
  const formatBytes = (bytes, decimals = 2) => {
    const n = Number(bytes);
    if (!n || n <= 0) return '';
    const k = 1024, dm = decimals < 0 ? 0 : decimals, sizes = ['Bytes','KB','MB','GB','TB'];
    const i = Math.floor(Math.log(n) / Math.log(k));
    return parseFloat((n / Math.pow(k,i)).toFixed(dm)) + ' ' + sizes[i];
  };
  function escapeHtml(str){
    return String(str).replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
  }

  // NEW: use dist32 when toggle is ON
  function pathForDisplay(p){
    if (!state.useProcessedDir) return p;
    return String(p).replace(/^dist\//, 'dist32/');
  }

  /* ========= Notifications (toasts) ========= */
  function showNotification(type, message){
    const container = $('#notifications');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type==='error'?'warn':type==='info'?'info':'success'}`;
    toast.innerHTML = `<div class="title">${type==='error'?'Error':'Updated'}</div><div class="meta">${escapeHtml(message||'')}</div>`;
    const dismiss = () => {
      toast.style.animation = 'toast-out .15s ease-in forwards';
      setTimeout(()=> toast.remove(), 160);
    };
    toast.addEventListener('click', dismiss);
    container.appendChild(toast);
    setTimeout(dismiss, 3000);
  }
  function showToast(msg, type='info'){ showNotification(type, msg); }

  /* ========= Dropdown infra ========= */
  function setupGlobalDropdownCloser(){
    document.addEventListener('click', (e) => {
      $$('.color-options-list[aria-hidden="false"], .tags-list-container[aria-hidden="false"], .category-options-list[aria-hidden="false"]').forEach(p=>{
        const path = e.composedPath ? e.composedPath() : [];
        if (path.includes(p) || (p.previousElementSibling && path.includes(p.previousElementSibling))) return;
        p.setAttribute('aria-hidden','true');
        const parentSelect = p.closest('[data-component="color-select"]');
        if (parentSelect) parentSelect.setAttribute('aria-expanded','false');
        const parentCat = p.closest('[data-component="category-select"]');
        if (parentCat) parentCat.setAttribute('aria-expanded','false');
      });
    }, { capture:true });
  }
  function togglePanel(panel, ownerSelect){
    const opened = panel.getAttribute('aria-hidden') === 'false';
    $$('.color-options-list, .tags-list-container, .category-options-list').forEach(p=>{ if (p !== panel) p.setAttribute('aria-hidden','true'); });
    if (ownerSelect) ownerSelect.setAttribute('aria-expanded', opened ? 'false' : 'true');
    panel.setAttribute('aria-hidden', opened ? 'true' : 'false');
  }
  function makePanelInteractive(panel){
    panel.addEventListener('click', (e)=> e.stopPropagation());
    panel.addEventListener('mousedown', (e)=> e.stopPropagation());
    panel.addEventListener('pointerdown', (e)=> e.stopPropagation());
  }

  /* ========= Counts & Filters metadata ========= */
  function recalcCountsAndTags(){
    const tagsCount = {};
    const dirCount  = {};
    const colCount  = {};
    const jsonTags  = new Set();

    for (const asset of state.data.collection){
      (asset.tags||[]).forEach(t => { jsonTags.add(t); tagsCount[t]=(tagsCount[t]||0)+1; });
      dirCount[asset.direction] = (dirCount[asset.direction]||0)+1;
      const fam = closestColorFamily(asset.color);
      colCount[fam] = (colCount[fam]||0)+1;
    }

    state.availableTags = [...new Set([...ALL_TAGS_DEFAULT, ...jsonTags])].sort();
    state.counts = { tags:tagsCount, direction:dirCount, color:colCount };

    refreshDirectionOptionCounts();
    refreshColorOptionCounts();
  }

  function populateFilters(){
    const sel = $('#filter-direction');
    if (sel){
      sel.innerHTML = `<option value="">All directions</option>`;
      for (const d of ALL_DIRECTIONS){
        const count = state.counts.direction[d]||0;
        const opt = document.createElement('option');
        opt.value = d;
        opt.textContent = `${d} (${count})`;
        sel.appendChild(opt);
      }
    }
    patchText($('#tags-count'), String(state.availableTags.length));
    patchText($('#direction-count'), String(ALL_DIRECTIONS.length));
    patchText($('#color-count'), String(Object.keys(COLOR_FAMILIES).length));
  }

  /* ========= Utils for Validate / Export ========= */
  function slugify(s){
    return String(s||'')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '-')           // spaces -> dashes
        .replace(/[^a-z0-9\-_]+/g, '')  // remove unsafe
        .replace(/-+/g, '-')            // dedupe -
        .replace(/^[-_]+|[-_]+$/g,'');  // trim - _
  }
  function buildFilename(asset){
    const name = slugify(asset.name || asset.imagePath.split('/').pop().replace(/\.[^.]+$/, ''));
    const dir  = slugify(asset.direction || '');
    const col  = slugify(closestColorFamily(asset.color || '') || '');
    const parts = [name, dir, col].filter(Boolean);
    return (parts.join('_') || 'asset') + '.png';
  }
  function downloadJSON(filename, data){
    const blob = new Blob([JSON.stringify(data, null, 2)], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  /* ========= Tags inputs ========= */
  function createTagsInput({container, initial = [], onChange}) {
    if (!container) return;

    let input = container.querySelector('input');
    if (!input) {
      input = document.createElement('input');
      input.type = 'text';
      input.placeholder = 'Add tags…';
      container.appendChild(input);
    }

    let list = container.querySelector('.tags-list-container');
    if (!list) {
      list = document.createElement('div');
      list.className = 'tags-list-container';
      container.appendChild(list);
    }

    list.innerHTML = `<input type="text" class="tags-search" placeholder="Search tags…" aria-label="Search tags">
                      <div class="tags-list-scroll"></div>`;
    const search = list.querySelector('.tags-search');
    const scroll = list.querySelector('.tags-list-scroll');
    makePanelInteractive(list);

    function currentTags() {
      return Array.from(container.querySelectorAll('.tag-pill')).map(p => p.firstChild.textContent.trim());
    }

    function addTagPill(tag) {
      const pill = document.createElement('span');
      pill.className = 'tag-pill';
      pill.innerHTML = `<span>${tag}</span><span class="remove-tag" aria-label="Remove tag" role="button" tabindex="0">x</span>`;
      pill.querySelector('.remove-tag').addEventListener('click',(e)=>{
        e.stopPropagation();
        pill.remove();
        if (onChange) onChange(currentTags());
      });
      container.insertBefore(pill, input);
    }

    function renderSuggestions(q='') {
      scroll.innerHTML = '';
      const cur = new Set(currentTags());
      const suggestions = (state.availableTags||[]).filter(t => t.toLowerCase().includes(q.toLowerCase()));
      for (const t of suggestions) {
        const item = document.createElement('div');
        item.className = 'tags-list-item';
        if (cur.has(t)) item.classList.add('selected');
        item.textContent = `${t} (${state.counts?.tags?.[t] || 0})`;
        item.addEventListener('click', (e)=>{
          e.stopPropagation();
          if (!cur.has(t)) addTagPill(t);
          if (onChange) onChange(currentTags());
        });
        scroll.appendChild(item);
      }
    }

    search.addEventListener('input', ()=> renderSuggestions(search.value));
    renderSuggestions('');

    input.addEventListener('keydown', (e)=>{
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        const raw = (input.value || '').trim();
        if (raw) {
          raw.split(',').map(s=>s.trim()).filter(Boolean).forEach(v=>{
            const cur = new Set(currentTags());
            if (!cur.has(v)) addTagPill(v);
          });
          input.value = '';
          if (onChange) onChange(currentTags());
        }
      }
      if (e.key === 'Backspace' && !input.value) {
        const pills = container.querySelectorAll('.tag-pill');
        if (pills.length) {
          pills[pills.length-1].remove();
          if (onChange) onChange(currentTags());
        }
      }
    });

    input.addEventListener('blur', ()=>{
      const raw = (input.value || '').trim();
      if (raw) {
        raw.split(',').map(s=>s.trim()).filter(Boolean).forEach(v=>{
          const cur = new Set(currentTags());
          if (!cur.has(v)) addTagPill(v);
        });
        input.value = '';
        if (onChange) onChange(currentTags());
      }
    });

    // seed
    (initial||[]).forEach(t => addTagPill(t));
  }

  function createSimpleTagsInput(root, initial=[], onChange=()=>{}){
    if (!root) return;
    let input = root.querySelector('input');
    if (!input){
      input = document.createElement('input');
      input.type = 'text';
      input.placeholder = 'Add a tag…';
      root.appendChild(input);
    }

    function current(){ return Array.from(root.querySelectorAll('.simple-pill')).map(p=>p.dataset.value); }
    function add(tag){
      const t = String(tag||'').trim(); if(!t) return;
      if(current().includes(t)) return;
      const pill = document.createElement('span');
      pill.className='simple-pill'; pill.dataset.value=t;
      pill.innerHTML = `${t} <button type="button" aria-label="Remove tag">&times;</button>`;
      pill.querySelector('button').addEventListener('click',()=>{ pill.remove(); onChange(current()); });
      root.insertBefore(pill, input);
      onChange(current());
    }
    (initial||[]).forEach(add);
    input.addEventListener('keydown', (e)=>{
      if (e.key==='Enter' || e.key===','){
        e.preventDefault(); input.value.split(',').forEach(add); input.value='';
      }
    });
    input.addEventListener('blur', ()=>{
      if (input.value.trim()){ input.value.split(',').forEach(add); input.value=''; }
    });
    return { add, current };
  }

  /* ========= Color select ========= */
  function createColorSelect(root, { initialHex='', allowAll=false, onChange, showCounts=true }){
    if (!root) return { setValue(){}, refreshCounts(){} };
    // Inject structure if needed (bulk dynamic)
    if (!root.querySelector('.selected-color-display')){
      root.innerHTML = `
        <div class="selected-color-display" tabindex="0">
          <div class="color-swatch"></div><span class="color-name"></span><span class="color-hex"></span><div class="dropdown-arrow"></div>
        </div>
        <div class="color-options-list" role="listbox" aria-hidden="true"></div>
      `;
    }
    root.setAttribute('data-component','color-select');
    const display = root.querySelector('.selected-color-display');
    const panel = root.querySelector('.color-options-list');
    const swatch = root.querySelector('.color-swatch');
    const nameEl = root.querySelector('.color-name');
    const hexEl  = root.querySelector('.color-hex');
    makePanelInteractive(panel);

    function setValue(hex, label, { silent=false } = {}){
      swatch.style.backgroundColor = hex || 'transparent';
      nameEl.textContent = label || (hex ? closestColorFamily(hex) : (allowAll ? 'All Colors' : 'Leave unchanged'));
      hexEl.textContent = hex || '';
      root.dataset.hex = hex || '';
      if (!silent && typeof onChange === 'function') onChange(root.dataset.hex);
    }
    function buildOptions(){
      panel.innerHTML = '';
      if (allowAll){
        const countAll = Object.values(state.counts.color).reduce((a,b)=>a+b,0);
        const opt = document.createElement('div');
        opt.className='color-option'; opt.dataset.value='';
        opt.innerHTML = `<div class="color-swatch"></div>
                         <span class="co-name">All Colors</span>
                         ${showCounts ? `<span class="co-count">(${countAll||0})</span>` : ''}`;
        opt.addEventListener('click', (e)=>{ e.stopPropagation(); setValue('', 'All Colors'); togglePanel(panel, root); });
        panel.appendChild(opt);
      }
      for (const [fam, hex] of Object.entries(COLOR_FAMILIES)){
        const count = state.counts.color[fam] || 0;
        const opt = document.createElement('div');
        opt.className='color-option'; opt.dataset.value=hex; opt.dataset.name=fam;
        opt.innerHTML = `<div class="color-swatch" style="background:${hex}"></div>
                         <span class="co-name">${fam}</span>
                         <span class="color-hex">${hex}</span>
                         ${showCounts ? `<span class="co-count">(${count})</span>` : ''}`;
        opt.addEventListener('click', (e)=>{
          e.stopPropagation(); setValue(hex, fam); togglePanel(panel, root);
        });
        panel.appendChild(opt);
      }
    }
    function refreshCounts(){
      panel.querySelectorAll('.color-option').forEach(opt=>{
        const fam = opt.dataset.name;
        const span = opt.querySelector('.co-count');
        if (!showCounts || !span) return;
        if (!fam){
          const countAll = Object.values(state.counts.color).reduce((a,b)=>a+b,0);
          span.textContent = `(${countAll||0})`;
        } else {
          span.textContent = `(${state.counts.color[fam]||0})`;
        }
      });
    }

    buildOptions();
    setValue(initialHex, initialHex ? closestColorFamily(initialHex) : (allowAll ? 'All Colors' : 'Leave unchanged'), { silent:true });

    display.addEventListener('click', (e)=>{ e.stopPropagation(); togglePanel(panel, root); });
    display.addEventListener('keydown', (e)=>{ if (e.key==='Enter' || e.key===' ') { e.preventDefault(); togglePanel(panel, root); } });

    return { setValue, refreshCounts };
  }

  /* ========= Category select ========= */
  function createCategorySelect(root, { initialValue='', onChange } = {}){
    if (!root) return { setValue(){}, get value(){ return '' } };
    root.setAttribute('data-component','category-select');
    root.setAttribute('aria-haspopup','listbox');
    root.setAttribute('aria-expanded','false');

    if (!root.querySelector('.selected-category-display')){
      root.innerHTML = `
        <div class="selected-category-display" tabindex="0">
          <span class="category-name"></span>
          <div class="dropdown-arrow"></div>
        </div>
        <div class="category-options-list" role="listbox" aria-hidden="true"></div>
      `;
    }
    const display = root.querySelector('.selected-category-display');
    const panel   = root.querySelector('.category-options-list');
    makePanelInteractive(panel);

    function setValue(val, { silent=false } = {}){
      const v = val || '';
      const label = v || 'Select category';
      const nameEl = display.querySelector('.category-name');
      if (nameEl) nameEl.textContent = label;
      root.dataset.value = v;
      if (!silent && typeof onChange === 'function') onChange(v);
    }

    function buildOptions(){
      panel.innerHTML = '';
      const none = document.createElement('div');
      none.className = 'category-option';
      none.setAttribute('role','option');
      none.dataset.value = '';
      none.innerHTML = `<div class="cat-title">Leave unchanged</div>`;
      none.addEventListener('click', (e)=>{ e.stopPropagation(); setValue(''); panel.setAttribute('aria-hidden','true'); root.setAttribute('aria-expanded','false'); });
      panel.appendChild(none);

      CATEGORY_LIST.forEach(cat=>{
        const opt = document.createElement('div');
        opt.className = 'category-option';
        opt.setAttribute('role','option');
        opt.dataset.value = cat.value;
        opt.innerHTML = `
          <div class="cat-title">${cat.value}</div>
          <div class="cat-examples">${cat.examples}</div>
        `;
        opt.addEventListener('click', (e)=>{
          e.stopPropagation();
          setValue(cat.value);
          panel.setAttribute('aria-hidden','true');
          root.setAttribute('aria-expanded','false');
        });
        panel.appendChild(opt);
      });
    }

    function openClose(){
      const isOpen = panel.getAttribute('aria-hidden') === 'false';
      panel.setAttribute('aria-hidden', isOpen ? 'true' : 'false');
      root.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
    }

    display.addEventListener('click', (e)=>{ e.stopPropagation(); openClose(); });
    display.addEventListener('keydown', (e)=>{ if (e.key==='Enter' || e.key===' '){ e.preventDefault(); openClose(); }});

    buildOptions();
    setValue(initialValue, { silent:true });
    return {
      setValue,
      get value(){ return root.dataset.value || ''; }
    };
  }

  /* ========= Cards ========= */
  function buildAssetCard(asset){
    const card = document.createElement('div');
    card.className='asset-card';
    card.dataset.imagePath = asset.imagePath;
    card.tabIndex = 0;

    const imageContainer = document.createElement('div');
    imageContainer.className='image-container';
    imageContainer.style.position = imageContainer.style.position || 'relative';

    const img = new Image();
    img.decoding = 'async';
    img.loading = 'lazy';
    img.alt = asset.name || '';

    const details = document.createElement('div');
    details.className='image-details';

    imageContainer.appendChild(img);
    imageContainer.appendChild(details);

    // --- Grid overlay (visual only) ----------------------------------------
    const overlay = document.createElement('div');
    overlay.className = 'grid32-overlay';
    overlay.style.position = 'absolute';
    overlay.style.inset = '0';
    overlay.style.pointerEvents = 'none';

    const canvas = document.createElement('canvas');
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    overlay.appendChild(canvas);

    imageContainer.appendChild(overlay);
    // -----------------------------------------------------------------------

    card.appendChild(imageContainer);

    const filename = asset.imagePath.split('/').pop() || '';
    let sizeText = '';
    let dimsText = '';
    let loadedOk = false;

    const renderDetails = () => {
      if (!loadedOk) {
        details.innerHTML = `<small><strong>${filename}</strong> — Loading…</small>`;
        return;
      }
      details.innerHTML = `<small><strong>${filename}</strong> — ${dimsText}${sizeText ? ' — ' + sizeText : ''}</small>`;
    };

    const onLoad = () => {
      loadedOk = true;
      dimsText = `${img.naturalWidth}×${img.naturalHeight}px`;
      renderDetails();
      // draw grid when loaded
      setupAndDrawGrid();
    };
    const onError = () => {
      loadedOk = false;
      details.innerHTML = `<small><strong>${filename}</strong> — Failed to load</small>`;
    };
    img.addEventListener('load', onLoad, { once:true });
    img.addEventListener('error', onError, { once:true });

    // HEAD for file size (respects toggle)
    (async () => {
      try {
        const r = await fetch(pathForDisplay(asset.imagePath), { method: 'HEAD' });
        const size = r.ok ? Number(r.headers.get('content-length') || 0) : 0;
        sizeText = size ? formatBytes(size) : '';
        if (loadedOk) renderDetails();
      } catch {}
    })();

    img.src = pathForDisplay(asset.imagePath);
    if (img.complete) {
      if (img.naturalWidth > 0) onLoad(); else onError();
    } else {
      renderDetails();
    }

    // Name
    const nameGroup = document.createElement('div');
    nameGroup.className='form-group';
    nameGroup.innerHTML = `<label>Name</label><input type="text" class="editable-field" value="${asset.name||''}" />`;
    const nameInput = nameGroup.querySelector('input');
    nameInput.addEventListener('click', e=>e.stopPropagation());
    nameInput.addEventListener('change', (e)=> updateAsset(asset.imagePath, 'name', e.target.value));
    card.appendChild(nameGroup);

    // Tags
    const tagsGroup = document.createElement('div');
    tagsGroup.className='form-group';
    tagsGroup.innerHTML = `
      <label class="tags-label">Tags</label>
      <div class="tags-input-container" data-component="tags-input">
        <input type="text" placeholder="Add tags…"/>
        <div class="tags-list-container" role="listbox" aria-hidden="true"></div>
      </div>`;
    const tagsContainer = tagsGroup.querySelector('.tags-input-container');
    createTagsInput({
      container: tagsContainer,
      initial: asset.tags || [],
      onChange: (tags) => updateAsset(asset.imagePath, 'tags', tags)
    });
    card.appendChild(tagsGroup);

    // Direction
    const dirGroup = document.createElement('div');
    dirGroup.className='form-group';
    dirGroup.innerHTML = `<label class="direction-label">Direction</label><select class="editable-field"></select>`;
    const dirSelect = dirGroup.querySelector('select');
    for (const d of ALL_DIRECTIONS){
      const opt = document.createElement('option');
      opt.value=d;
      const c = state.counts.direction[d] || 0;
      opt.textContent = `${d} (${c})`;
      if (asset.direction===d) opt.selected = true;
      dirSelect.appendChild(opt);
    }
    dirSelect.addEventListener('click', e=>e.stopPropagation());
    dirSelect.addEventListener('change', (e)=> updateAsset(asset.imagePath, 'direction', e.target.value));
    card.appendChild(dirGroup);

    // Color
    const colorGroup = document.createElement('div');
    colorGroup.className='form-group';
    colorGroup.innerHTML = `<label class="color-label">Color</label>
      <div class="custom-color-select" data-component="color-select" aria-haspopup="listbox" aria-expanded="false">
        <div class="selected-color-display" tabindex="0">
          <div class="color-swatch"></div><span class="color-name"></span><span class="color-hex"></span><div class="dropdown-arrow"></div>
        </div>
        <div class="color-options-list" role="listbox" aria-hidden="true"></div>
      </div>`;
    const colorSelectRoot = colorGroup.querySelector('[data-component="color-select"]');
    const colorSelectCtl = createColorSelect(colorSelectRoot, {
      initialHex: asset.color,
      allowAll: false,
      onChange: (hex)=> updateAsset(asset.imagePath, 'color', hex),
      showCounts: true
    });
    card.appendChild(colorGroup);

    // Secondary Color (NEW)
    const sColorGroup = document.createElement('div');
    sColorGroup.className='form-group';
    sColorGroup.innerHTML = `<label class="color-label">Secondary Color</label>
      <div class="custom-color-select" data-component="color-select" aria-haspopup="listbox" aria-expanded="false">
        <div class="selected-color-display" tabindex="0">
          <div class="color-swatch"></div><span class="color-name"></span><span class="color-hex"></span><div class="dropdown-arrow"></div>
        </div>
        <div class="color-options-list" role="listbox" aria-hidden="true"></div>
      </div>`;
    const sColorSelectRoot = sColorGroup.querySelector('[data-component="color-select"]');
    const sColorSelectCtl = createColorSelect(sColorSelectRoot, {
      initialHex: asset.secondaryColor || '',
      allowAll: false,
      onChange: (hex)=> updateAsset(asset.imagePath, 'secondaryColor', hex),
      showCounts: true
    });
    card.appendChild(sColorGroup);

    // Category (NEW)
    const catGroup = document.createElement('div');
    catGroup.className='form-group';
    catGroup.innerHTML = `<label class="category-label">Category</label>
      <div class="custom-category-select" aria-haspopup="listbox" aria-expanded="false"></div>`;
    const catRoot = catGroup.querySelector('.custom-category-select');
    const catCtl = createCategorySelect(catRoot, {
      initialValue: Array.isArray(asset.category) ? (asset.category[0] || '') : (asset.category || ''),
      onChange: (val)=> updateAsset(asset.imagePath, 'category', val)
    });
    card.appendChild(catGroup);

    // Selection
    card.addEventListener('click', (evt)=>{
      const interactive = evt.target.closest('input, select, .tags-input-container, [data-component="color-select"], .custom-category-select, .category-options-list');
      if (interactive) return;
      card.classList.toggle('selected');
      updateSelectionUI();
    });

    state.cardsByPath.set(asset.imagePath, { el: card, refs: { nameInput, dirSelect, colorSelectCtl, sColorSelectCtl, catCtl } });

    // ---- Responsive grid drawing (visual only) ----
    function setupAndDrawGrid(){
      let rows = 0, cols = 0;
      if (Array.isArray(asset.collisionGrid) && asset.collisionGrid.length > 0 && Array.isArray(asset.collisionGrid[0])) {
        rows = asset.collisionGrid.length;
        cols = asset.collisionGrid[0].length;
      } else {
        cols = Math.max(1, Math.ceil(img.naturalWidth  / 32));
        rows = Math.max(1, Math.ceil(img.naturalHeight / 32));
      }

      function draw(){
        const rw = img.clientWidth;
        const rh = img.clientHeight;
        if (!rw || !rh) return;

        const dpr = window.devicePixelRatio || 1;
        canvas.width  = Math.max(1, Math.floor(rw * dpr));
        canvas.height = Math.max(1, Math.floor(rh * dpr));
        const ctx = canvas.getContext('2d');
        canvas.style.width = rw + 'px';
        canvas.style.height = rh + 'px';

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0,0,rw,rh);

        const cellW = rw / cols;
        const cellH = rh / rows;

        // Fill red for cells marked 1 in collisionGrid (if any)
        if (Array.isArray(asset.collisionGrid) && asset.collisionGrid.length === rows) {
          ctx.fillStyle = 'rgba(255,0,0,0.25)';
          for (let y=0; y<rows; y++){
            const row = asset.collisionGrid[y] || [];
            for (let x=0; x<cols; x++){
              if (row[x] === 1){
                const fx = Math.round(x * cellW);
                const fy = Math.round(y * cellH);
                const fw = Math.round((x+1) * cellW) - fx;
                const fh = Math.round((y+1) * cellH) - fy;
                ctx.fillRect(fx, fy, fw, fh);
              }
            }
          }
        }

        // Grid lines
        ctx.strokeStyle = 'rgba(0,0,0,.25)';
        ctx.lineWidth = 1;
        for (let i = 0; i <= cols; i++){
          const x = Math.round(i * cellW) + 0.5;
          ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, rh); ctx.stroke();
        }
        for (let j = 0; j <= rows; j++){
          const y = Math.round(j * cellH) + 0.5;
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(rw, y); ctx.stroke();
        }
      }

      draw();
      new ResizeObserver(draw).observe(img);
    }

    return card;
  }

  function renderPage({ reset=false } = {}){
    const container = $('#container');
    if (!container) return;

    if (reset){
      container.innerHTML = '';
      state.cardsByPath.clear();
      state.pagination.page = 0;
      state.pagination.renderedCount = 0;
      state.pagination.loading = false;
    }

    const list = state.renderList || [];
    const BATCH = 60;
    let i = state.pagination.renderedCount = 0;

    function step(){
      const frag = document.createDocumentFragment();
      const end = Math.min(i + BATCH, list.length);
      for (; i < end; i++){
        const asset = list[i];
        frag.appendChild(buildAssetCard(asset));
      }
      container.appendChild(frag);
      patchText($('#assets-count-title'), `${list.length} items`);
      if (i < list.length){
        requestAnimationFrame(step);
      } else {
        state.pagination.renderedCount = list.length;
      }
    }
    step();
  }

  /* ========= Filtering ========= */
  function readFilterTags(){
    const c = $('#filter-tags-container');
    if (!c) return [];
    const pills = c.querySelectorAll('.tag-pill');
    return Array.from(pills).map(p=>p.firstChild.textContent.trim());
  }
  function computeFilteredList(){
    const nameQ = (state.filter.name||'').toLowerCase();
    const tags = readFilterTags();
    const direction = state.filter.direction;
    const colorHex = state.filter.colorHex;
    const colorFamily = colorHex ? closestColorFamily(colorHex) : '';

    const out = [];
    for (const asset of (state.data.collection||[])){
      const nameOk = !nameQ || (asset.name||'').toLowerCase().includes(nameQ) || (asset.imagePath||'').toLowerCase().includes(nameQ);
      const tagsOk = tags.length===0 || tags.every(t => (asset.tags||[]).includes(t));
      const dirOk  = !direction || asset.direction === direction;
      const colOk  = !colorFamily || closestColorFamily(asset.color) === colorFamily;
      if (nameOk && tagsOk && dirOk && colOk) out.push(asset);
    }
    return out;
  }
  function filterAssets(){
    state.renderList = computeFilteredList();
    renderPage({ reset:true });
  }

  /* ========= Data updates ========= */
  function updateAsset(imagePath, field, value){
    const asset = (state.data.collection||[]).find(a => a.imagePath === imagePath);
    if (!asset) return;
    asset[field] = value;

    const fileLabel = asset.name || (asset.imagePath.split('/').pop() || 'item');
    const fieldLabel = (field.charAt(0).toUpperCase() + field.slice(1));
    showNotification('info', `${fieldLabel} updated on "${fileLabel}"`);

    recalcCountsAndTags();
    populateFilters();
    pushJSON();
    filterAssets();
  }
  function pushJSON(){
    // Don't push if current source is an uploaded local JSON (avoid overwriting server file)
    if (state.source.type === 'file') {
      fetch(API_URL, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify(state.data)
      }).catch(err=> console.error('Error updating JSON:', err));
    }
  }

  /* ========= Modal (bulk) ========= */
  function setupModal(){
    const modal = $('#bulkEditModal');
    if (!modal) return { open(){}, close(){} };

    const closeBtn = modal.querySelector('.close-btn');
    const cancelBtn = $('#close-modal-btn');
    const saveBtn = $('#save-bulk-btn');
    const title = $('#bulkEditTitle');

    const dirSelect = $('#modal-direction');
    if (dirSelect){
      dirSelect.innerHTML = `<option value="">Leave unchanged</option>`;
      for (const d of ALL_DIRECTIONS){
        const opt = document.createElement('option');
        opt.value=d; opt.textContent=d; dirSelect.appendChild(opt);
      }
    }

    createTagsInput({ container: $('#modal-tags-container'), initial: [], onChange: ()=>{} });
    createColorSelect($('#modal-color-select'), { initialHex:'', allowAll:true, onChange: ()=>{}, showCounts:true });

    // Secondary Color (bulk)
    const modalBody = modal.querySelector('.modal-body') || modal;
    const sColorRow = document.createElement('div');
    sColorRow.className = 'bulk-row';
    sColorRow.innerHTML = `<label>Secondary Color</label><div id="modal-scolor-select" class="custom-color-select" aria-haspopup="listbox" aria-expanded="false"></div>`;
    modalBody.appendChild(sColorRow);
    createColorSelect($('#modal-scolor-select'), { initialHex:'', allowAll:true, onChange:()=>{}, showCounts:true });

    // Category (bulk)
    const catRow = document.createElement('div');
    catRow.className = 'bulk-row';
    catRow.innerHTML = `<label>Category</label><div id="modal-category-select" class="custom-category-select" aria-haspopup="listbox" aria-expanded="false"></div>`;
    modalBody.appendChild(catRow);
    createCategorySelect($('#modal-category-select'), { initialValue:'', onChange:()=>{} });

    function open(){
      const count = $$('.asset-card.selected').length;
      patchText(title, `Edit ${count} Assets`);
      $('#modal-name').value = '';
      $('#modal-tags-container')?.querySelectorAll('.tag-pill')?.forEach(p=>p.remove());
      if (dirSelect) dirSelect.value = '';

      const resetColor = (rootSel, defaultLabel) => {
        const root = $(rootSel);
        if (root){
          root.dataset.hex = '';
          const name = root.querySelector('.color-name');
          const sw = root.querySelector('.color-swatch');
          if (name) name.textContent = defaultLabel;
          if (sw) sw.style.background = 'transparent';
        }
      };
      resetColor('#modal-color-select','Leave unchanged');
      resetColor('#modal-scolor-select','Leave unchanged');

      const cRoot = $('#modal-category-select');
      if (cRoot){
        cRoot.dataset.value = '';
        const n = cRoot.querySelector('.category-name');
        if (n) n.textContent = 'Select category';
      }
      modal.setAttribute('aria-hidden','false');
    }
    function close(){ modal.setAttribute('aria-hidden','true'); }

    closeBtn?.addEventListener('click', close);
    closeBtn?.addEventListener('keydown', (e)=>{ if(e.key==='Enter'||e.key===' ') close(); });
    cancelBtn?.addEventListener('click', close);
    window.addEventListener('click', (e)=>{ if(e.target===modal) close(); });

    saveBtn?.addEventListener('click', ()=>{
      const selected = $$('.asset-card.selected');
      const newName = $('#modal-name')?.value?.trim() || '';
      const newTags = Array.from($('#modal-tags-container')?.querySelectorAll('.tag-pill')||[]).map(p=>p.firstChild.textContent.trim());
      const newDir = $('#modal-direction')?.value || '';
      const newColor = $('#modal-color-select')?.dataset?.hex || '';
      const newSColor = $('#modal-scolor-select')?.dataset?.hex || '';
      const newCategory = $('#modal-category-select')?.dataset?.value || '';
      if (!selected.length) return close();
      if (!confirm(`Are you sure you want to edit ${selected.length} assets?`)) return;

      for (const card of selected){
        const path = card.dataset.imagePath;
        if (newName)  updateAsset(path, 'name', newName);
        if (newTags.length) updateAsset(path, 'tags', newTags);
        if (newDir)   updateAsset(path, 'direction', newDir);
        if (newColor) updateAsset(path, 'color', newColor);
        if (newSColor) updateAsset(path, 'secondaryColor', newSColor);
        if (newCategory) updateAsset(path, 'category', newCategory);
      }
      showToast('Bulk edit applied.','success');
      close();
    });

    return { open, close };
  }

  /* ========= Toolbar ========= */
  function updateSelectionUI(){
    const n = $$('.asset-card.selected').length;
    setHidden($('#select-all-btn'), n>0);
    setHidden($('#deselect-btn'), n===0);
    setHidden($('#bulk-edit-btn'), n===0);
    setHidden($('#validate-btn'), n===0);
    setHidden($('#update-colors-btn'), n===0);
    patchText($('#selected-count'), String(n));
  }

  function setupToolbar(modalCtl){
    // NEW: JSON loaders
    injectJsonControls();

    // NEW: Processing controls (header menu) with backward compatibility
    const toggle = $('#menu-use-processed') || $('#use-processed-dir');
    if (toggle){
      toggle.addEventListener('change', ()=>{
        state.useProcessedDir = toggle.checked;
        renderPage({ reset:true });
      });
    }
    const gridBtn = $('#menu-resize-btn') || $('#resize-grid-btn');
    if (gridBtn){
      gridBtn.addEventListener('click', async ()=>{
        try{
          showToast('Processing PNGs to dist32…','info');
          const r = await fetch(`${API_URL}/resize_to_grid_to_dir`, { method:'POST' });
          const data = await r.json().catch(()=>({}));
          if (r.ok){
            showToast(`Done: ${data.processed||0} files → dist32`,'success');
            if (state.useProcessedDir) renderPage({ reset:true });
          } else {
            showToast(data.message||'Server error','error');
          }
        } catch(e){ showToast(String(e),'error'); }
      });
    }

    $('#select-all-btn')?.addEventListener('click', ()=>{
      $$('.asset-card').forEach(c=>c.classList.add('selected'));
      updateSelectionUI();
    });
    $('#deselect-btn')?.addEventListener('click', ()=>{
      $$('.asset-card.selected').forEach(c=>c.classList.remove('selected'));
      updateSelectionUI();
    });
    $('#bulk-edit-btn')?.addEventListener('click', ()=> modalCtl.open());

    // Validate Selection (with target folder prompt)
    $('#validate-btn')?.addEventListener('click', async ()=>{
      const selectedPaths = $$('.asset-card.selected').map(c=>c.dataset.imagePath);
      if (!selectedPaths.length){
        alert('Select at least 1 asset.');
        return;
      }

      const folderName = prompt('Folder name to create inside "validate-elements":','new-pack');
      if (folderName === null) return; // cancel
      const cleanFolder = (folderName || '').trim();
      if (!cleanFolder){
        alert('Please enter a valid folder name.');
        return;
      }

      const selectedAssets = (state.data.collection||[]).filter(a => selectedPaths.includes(a.imagePath));
      const items = selectedAssets.map(a => ({
        imagePath: a.imagePath,
        name: a.name || '',
        tags: a.tags || [],
        direction: a.direction || '',
        color: a.color || '',
        secondaryColor: a.secondaryColor || '',
        category: a.category || '',
        newFilename: buildFilename(a)
      }));

      // JSON subset
      const subset = {
        collectionName: (state.data.collectionName || ''),
        tags: state.data.tags || [],
        collection: selectedAssets
      };

      // Server: create validate-elements/<folderName> + copy images + JSON
      let serverOk = false;
      try{
        const res = await fetch(`${API_URL}/validate_selection`, {
          method: 'POST',
          headers: { 'Content-Type':'application/json' },
          body: JSON.stringify({
            baseDir: 'validate-elements',
            subDir: cleanFolder,
            items,
            json: subset
          })
        });
        if (!res.ok){
          const txt = await res.text().catch(()=> '');
          throw new Error(txt || `Server error ${res.status}`);
        }
        const out = await res.json().catch(()=> ({}));
        serverOk = true;
        showNotification('success', `Saved ${items.length} item(s) to validate-elements/${cleanFolder}`);
        console.log('Validate server response:', out);
      }catch(err){
        console.error(err);
        showNotification('error', `Server validate failed: ${err.message}`);
      }

      // Client fallback
      const clientName = `${cleanFolder || 'validated'}-selection.json`;
      downloadJSON(clientName, subset);

      if (!serverOk){
        alert('Server validate failed. A local JSON export has been downloaded.');
      }
    });

    $('#update-colors-btn')?.addEventListener('click', ()=>{
      if (!confirm("Are you sure you want to update the colors of all assets? This action is irreversible.")) return;
      fetch(`${API_URL}/update_colors`, { method:'POST', headers:{'Content-Type':'application/json'} })
          .then(r=>{ if(!r.ok) throw new Error('Color update failed.'); return r.json(); })
          .then(d=>{ alert(d.message||'Colors updated'); loadAssets(); })
          .catch(err=> alert(`Error: ${err.message}`));
    });
  }

  /* ========= JSON Switcher (Upload / Reset) ========= */
  function injectJsonControls(){
    let host = $('#json-controls');
    if (!host){
      const header = document.querySelector('.header') || document.body;
      host = document.createElement('div');
      host.id = 'json-controls';
      host.className = 'group';
      host.style.marginLeft = 'auto';
      host.innerHTML = `
        <input type="file" id="json-upload" accept="application/json" style="display:none" />
        <button id="btn-load-json" class="btn">Load JSON</button>
        <button id="btn-reset-json" class="btn ghost" title="Reload default assets_list.json">Reset to default</button>
        <span id="json-source-label" class="muted" style="margin-left:8px; font-size:.9rem;"></span>
      `;
      header.appendChild(host);
    }

    const fileInput = $('#json-upload');
    const btnLoad   = $('#btn-load-json');
    const btnReset  = $('#btn-reset-json');
    const label     = $('#json-source-label');

    const updateLabel = () => {
      const t = state.source.type === 'upload' ? `Loaded: ${state.source.name}` : `Source: ${state.source.name}`;
      patchText(label, t);
    };

    btnLoad?.addEventListener('click', () => fileInput?.click());
    fileInput?.addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      try{
        const text = await file.text();
        const json = JSON.parse(text);
        applyExternalJSON(json, file.name);
        showToast(`JSON loaded (${file.name})`, 'success');
      }catch(err){
        console.error(err);
        showToast('Invalid JSON file','error');
      } finally {
        fileInput.value = '';
      }
    });

    btnReset?.addEventListener('click', () => {
      state.source = { type:'file', name: 'assets_list.json' };
      ASSETS_FILE = 'assets_list.json';
      loadAssets();
      updateLabel();
    });

    updateLabel();
  }

  function normalizeDataStructure(data){
    const out = {
      collectionName: String(data.collectionName || ''),
      tags: Array.isArray(data.tags) ? data.tags.slice() : [],
      collection: Array.isArray(data.collection) ? data.collection.slice() : []
    };
    out.collection.forEach(a => {
      a.imagePath = String(a.imagePath || '');
      a.name = String(a.name || '');
      a.tags = Array.isArray(a.tags) ? a.tags.slice() : [];
      a.direction = String(a.direction || '');
      a.color = String(a.color || '');
      a.secondaryColor = String(a.secondaryColor || '');
      if (Array.isArray(a.category)) a.category = a.category[0] || '';
      a.category = String(a.category || '');
      a.newFilename = String(a.newFilename || '');
    });
    return out;
  }

  function applyExternalJSON(jsonObj, filename='uploaded.json'){
    const data = normalizeDataStructure(jsonObj);
    state.data = data;
    state.source = { type:'upload', name: filename };
    recalcCountsAndTags();
    populateFilters();
    state.renderList = state.data.collection.slice();
    renderPage({ reset:true });
    updateSelectionUI();
    patchText($('#main-title'), state.data.collectionName || 'Assets Collection');
    const nameInput = $('#collection-name');
    if (nameInput) nameInput.value = state.data.collectionName || '';
  }

  /* ========= Filters wiring ========= */
  function setupFilters(){
    $('#filter-name')?.addEventListener('input', ()=>{
      debounce('filter-name', ()=>{
        state.filter.name = $('#filter-name').value || '';
        filterAssets();
      });
    });
    $('#filter-direction')?.addEventListener('change', ()=>{
      state.filter.direction = $('#filter-direction').value || '';
      filterAssets();
    });

    const ftags = $('#filter-tags-container');
    if (ftags){
      createTagsInput({
        container: ftags,
        initial: [],
        onChange: ()=> filterAssets()
      });
    }

    const colorRoot = $('#filter-color-select');
    if (colorRoot){
      createColorSelect(colorRoot, {
        initialHex: '',
        allowAll: true,
        onChange: (hex)=> { state.filter.colorHex = hex || ''; filterAssets(); },
        showCounts: true
      });
    }
  }

  /* ========= Refresh option counts in cards ========= */
  function refreshDirectionOptionCounts(){
    state.cardsByPath.forEach(({refs})=>{
      const sel = refs?.dirSelect;
      if (!sel) return;
      Array.from(sel.options).forEach(opt=>{
        const d = opt.value;
        const c = state.counts.direction[d] || 0;
        const label = `${d} (${c})`;
        if (opt.textContent !== label) opt.textContent = label;
      });
    });
  }
  function refreshColorOptionCounts(){
    state.cardsByPath.forEach(({refs})=>{
      refs?.colorSelectCtl?.refreshCounts?.();
    });
    const filterCtlRoot = $('#filter-color-select');
    if (filterCtlRoot){
      const panel = filterCtlRoot.querySelector('.color-options-list');
      panel?.querySelectorAll('.color-option').forEach(opt=>{
        const fam = opt.dataset.name;
        const span = opt.querySelector('.co-count');
        if (!span) return;
        if (!fam){
          const countAll = Object.values(state.counts.color).reduce((a,b)=>a+b,0);
          span.textContent = `(${countAll||0})`;
        } else {
          span.textContent = `(${state.counts.color[fam]||0})`;
        }
      });
    }
  }

  /* ========= Load & Bootstrap (+ loader) ========= */
  async function loadAssets(){
    try{
      const r = await fetch(`${ASSETS_FILE}?t=${Date.now()}`);
      if (!r.ok) throw new Error('Failed to load assets');
      const raw = await r.json();
      state.data = normalizeDataStructure(raw);
      state.source = { type:'file', name: ASSETS_FILE };

      document.title = state.data.collectionName || 'Assets Collection';
      patchText($('#main-title'), document.title);
      const nameInput = $('#collection-name');
      if (nameInput) nameInput.value = state.data.collectionName || '';

      recalcCountsAndTags();
      populateFilters();

      state.renderList = state.data.collection.slice();
      renderPage({ reset:true });
      updateSelectionUI();
    } catch(err){
      console.error(err);
      const c = $('#container');
      if (c) c.innerHTML = `<p>Error: Could not load data. Ensure "${ASSETS_FILE}" is present.</p>`;
    } finally {
      $('#loader')?.remove();
    }
  }

  function setupGlobalMetadata(){
    const nameInput = $('#collection-name');
    if (nameInput){
      nameInput.value = state.data.collectionName || '';
      nameInput.addEventListener('change', (e)=>{
        state.data.collectionName = e.target.value || '';
        document.title = state.data.collectionName || 'Assets Collection';
        patchText($('#main-title'), document.title);
        pushJSON();
      });
    }

    const simple = $('#global-tags-simple');
    if (simple){
      createSimpleTagsInput(simple, state.data.tags||[], (tags)=>{
        state.data.tags = tags; pushJSON();
      });
    }
  }

  function init(){
    setupGlobalDropdownCloser();
    setupFilters();
    const modalCtl = setupModal();
    setupToolbar(modalCtl);
    setupGlobalMetadata();
    loadAssets();
  }

  document.addEventListener('DOMContentLoaded', init);

  // Inline styles for category & json controls
  (function ensureCategoryStyles(){
    if (document.getElementById('cat-style')) return;
    const st = document.createElement('style');
    st.id = 'cat-style';
    st.textContent = `
      .custom-category-select { position: relative; }
      .selected-category-display { display:flex; align-items:center; justify-content:space-between; border:1px solid #e6e8ef; border-radius:8px; padding:6px 10px; background:#fff; cursor:pointer; }
      .category-options-list { position:absolute; top:100%; left:0; right:0; z-index:30; max-height:240px; overflow:auto; background:#fff; border:1px solid #e6e8ef; border-radius:10px; margin-top:6px; box-shadow:0 8px 24px rgba(0,0,0,.12); padding:6px; display:none; }
      [data-component="category-select"][aria-expanded="true"] .category-options-list { display:block; }
      .category-option { padding:8px 10px; border-radius:8px; cursor:pointer; }
      .category-option:hover { background:#f8fafc; }
      .category-option .cat-title { font-weight:600; font-size:.95rem; }
      .category-option .cat-examples { font-size:.8rem; opacity:.7; margin-top:2px; }

      #json-controls .btn { margin-left: 6px; }
      #json-controls .muted { color:#70757a; }
    `;
    document.head.appendChild(st);
  })();

})();