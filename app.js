(() => {
  /* =============================
     Asset Manager - app.js (grid + collision highlights)
     ============================= */

  const API_URL = 'http://localhost:8000';
  let ASSETS_FILE = 'assets_list.json'; // <- can change if we reset after upload

  // Persistence of the active data source across page refreshes.
  const LS_SRC = 'assetmgr:source';        // 'file' | 'upload'
  const LS_CACHE = 'assetmgr:uploadCache'; // { json, name }
  function persistSource(t){ try{ localStorage.setItem(LS_SRC, t); }catch{} }
  function persistCache(c){ try{ localStorage.setItem(LS_CACHE, JSON.stringify(c)); }catch(e){ console.warn('Could not persist loaded JSON (too large?)', e); } }
  function readCache(){ try{ const s = localStorage.getItem(LS_CACHE); return s ? JSON.parse(s) : null; }catch{ return null; } }

  // ==== STATE (unique, defensive) ===========================================
  if (!window.state) {
    window.state = {
      data: { collectionName: '', tags: [], collection: [], compositions: [] },
      filtered: [],
      renderList: [],
      activeTab: 'assets',
      selection: new Set(),
      cardsByPath: new Map(),
      debounceTimers: {},
      // Infinite scroll (kept)
      pagination: { batchSize: 50, page: 0, loading: false, renderedCount: 0 },
      // filters
      filter: { name:'', tags:[], direction:'', colorHex:'', noTags:false, noColor:false, duplicatesOnly:false },
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
    "Furniture","Bathroom","Kitchen","Electronics","Bedroom","Office",
    "Plants","Food & Drink","Decoration","Transportation","Storage",
    "Walls & Doors","Signage","Lighting","Meeting & School","Outdoor",
    "Recreation & Gaming"
  ];
  const ALL_DIRECTIONS = ["front","back","left","right","up","down","unknow"];
  // Sentinel value used by the color filter to mean "assets without a color".
  const NO_COLOR = '__none__';
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
  const hexToHsl = (hex) => {
    const c = hexToRgb(hex); if (!c) return [0,0,0];
    const r=c.r/255, g=c.g/255, b=c.b/255;
    const max=Math.max(r,g,b), min=Math.min(r,g,b), d=max-min;
    let h=0, s=0, l=(max+min)/2;
    if (d){
      s = l>0.5 ? d/(2-max-min) : d/(max+min);
      switch(max){
        case r: h=((g-b)/d+(g<b?6:0)); break;
        case g: h=(b-r)/d+2; break;
        default: h=(r-g)/d+4;
      }
      h/=6;
    }
    return [h*360, s, l];
  };
  // Couleurs triées pour l'affichage : chromatiques par teinte (puis clair→foncé),
  // puis les achromatiques (gris/noir/blanc) du plus clair au plus foncé.
  const COLOR_FAMILIES_SORTED = Object.entries(COLOR_FAMILIES).sort((a,b)=>{
    const [ha,sa,la] = hexToHsl(a[1]);
    const [hb,sb,lb] = hexToHsl(b[1]);
    const ga = sa < 0.12, gb = sb < 0.12;
    if (ga !== gb) return ga ? 1 : -1;
    if (ga && gb) return lb - la;
    if (Math.abs(ha-hb) > 1) return ha - hb;
    return lb - la;
  });
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
  const nowISO = () => new Date().toISOString();
  function formatDate(iso){
    if (!iso) return '—';
    const d = new Date(iso);
    return isNaN(d) ? '—' : d.toLocaleString();
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
  function createTagsInput({container, initial = [], onChange, noTagsToggle = false}) {
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

      // Special "No tags" entry, first in the list (filter dropdown only).
      if (noTagsToggle){
        const count = (state.data.collection||[]).filter(a => (a.tags||[]).length === 0).length;
        const item = document.createElement('div');
        item.className = 'tags-list-item special';
        if (state.filter.noTags) item.classList.add('selected');
        item.textContent = `No tags (${count})`;
        item.addEventListener('click', (e)=>{
          e.stopPropagation();
          state.filter.noTags = !state.filter.noTags;
          filterAssets();
          renderSuggestions(search.value);
        });
        scroll.appendChild(item);
      }

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

    // Open the suggestions panel when the user focuses/clicks the tags field.
    function openList(){
      $$('.color-options-list, .tags-list-container, .category-options-list').forEach(p=>{
        if (p !== list) p.setAttribute('aria-hidden','true');
      });
      list.setAttribute('aria-hidden','false');
      renderSuggestions(search.value || '');
    }
    input.addEventListener('focus', openList);
    input.addEventListener('click', (e)=>{ e.stopPropagation(); openList(); });

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
  function createColorSelect(root, { initialHex='', allowAll=false, allowNone=false, onChange, showCounts=true }){
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
      const isNone = hex === NO_COLOR;
      swatch.classList.toggle('none', isNone);
      swatch.style.backgroundColor = (hex && !isNone) ? hex : 'transparent';
      nameEl.textContent = label || (isNone ? 'No color' : (hex ? closestColorFamily(hex) : (allowAll ? 'All Colors' : 'Leave unchanged')));
      hexEl.textContent = isNone ? '' : (hex || '');
      root.dataset.hex = hex || '';
      if (!silent && typeof onChange === 'function') onChange(root.dataset.hex);
    }
    function buildOptions(){
      panel.innerHTML = '';
      if (allowNone){
        const countNone = (state.data.collection||[]).filter(a=>!a.color).length;
        const opt = document.createElement('div');
        opt.className='color-option'; opt.dataset.value=NO_COLOR;
        opt.innerHTML = `<div class="color-swatch none"></div>
                         <span class="co-name">No color</span>
                         ${showCounts ? `<span class="co-count">(${countNone})</span>` : ''}`;
        opt.addEventListener('click', (e)=>{ e.stopPropagation(); setValue(NO_COLOR, 'No color'); togglePanel(panel, root); });
        panel.appendChild(opt);
      }
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
      for (const [fam, hex] of COLOR_FAMILIES_SORTED){
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
        if (opt.dataset.value === NO_COLOR){
          span.textContent = `(${(state.data.collection||[]).filter(a=>!a.color).length})`;
        } else if (!fam){
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

    // Dates (read-only)
    const datesEl = document.createElement('div');
    datesEl.className = 'asset-dates';
    datesEl.innerHTML = `<span title="Date added">＋ ${formatDate(asset.dateAdded)}</span>`
                      + `<span title="Last modified">✎ ${asset.dateModified ? formatDate(asset.dateModified) : '—'}</span>`;
    card.appendChild(datesEl);

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
      const ro = new ResizeObserver(draw);
      ro.observe(img);
      (state._observers || (state._observers = [])).push(ro);
    }

    return card;
  }

  /* ========= Composition cards ========= */
  function renderCompositionPreview(canvas, comp){
    const W = comp.canvasWidth  || 320;
    const H = comp.canvasHeight || 320;
    canvas.width  = W;
    canvas.height = H;
    const g = canvas.getContext('2d');
    g.imageSmoothingEnabled = false;
    const byId = new Map((state.data.collection||[]).filter(a=>a.id).map(a=>[a.id, a]));
    for (const layer of (comp.layers||[])){
      const asset = byId.get(layer.assetId);
      if (!asset?.imagePath) continue;
      const img = new Image();
      img.onload = ()=> g.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, layer.x, layer.y, img.naturalWidth, img.naturalHeight);
      img.src = pathForDisplay(asset.imagePath);
    }
  }

  function buildCompositionCard(comp){
    const card = document.createElement('div');
    card.className = 'asset-card composition-card';
    card.dataset.compositionId = comp.id || '';
    card.tabIndex = 0;

    const imageContainer = document.createElement('div');
    imageContainer.className = 'image-container';
    imageContainer.style.cssText = 'position:relative;background:#f3f4f8';

    const preview = document.createElement('canvas');
    preview.style.cssText = 'width:100%;height:100%;image-rendering:pixelated;display:block';
    imageContainer.appendChild(preview);

    const badge = document.createElement('div');
    badge.style.cssText = 'position:absolute;top:4px;right:4px;font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;background:#4f46e5;color:#fff;border-radius:999px;padding:2px 7px';
    badge.textContent = 'composition';
    imageContainer.appendChild(badge);

    card.appendChild(imageContainer);

    const details = document.createElement('div');
    details.className = 'image-details';
    const layerCount = (comp.layers||[]).length;
    const tagsStr = (comp.tags||[]).map(t=>`<span class="tag-chip">${t}</span>`).join('');
    details.innerHTML = `<small><strong>${comp.name||'(no name)'}</strong> — ${layerCount} layer${layerCount===1?'':'s'}</small>${tagsStr?`<div style="margin-top:4px;display:flex;flex-wrap:wrap;gap:3px">${tagsStr}</div>`:''}`;
    card.appendChild(details);

    // Lazy render
    const obs = new IntersectionObserver(entries=>{
      if (entries[0].isIntersecting){ renderCompositionPreview(preview, comp); obs.disconnect(); }
    }, { rootMargin:'200px' });
    obs.observe(card);
    (state._observers||(state._observers=[])).push(obs);

    card.addEventListener('click', ()=> { location.href = `/compose?id=${encodeURIComponent(comp.id || '')}`; });

    return card;
  }


  function renderPage({ reset=false } = {}){
    const container = $('#container');
    if (!container) return;

    if (reset){
      // Disconnect grid observers from the cards we're about to discard
      // (otherwise they pile up on every edit/filter and leak memory).
      (state._observers || []).forEach(o => { try { o.disconnect(); } catch {} });
      state._observers = [];
      container.innerHTML = '';
      state.cardsByPath.clear();
      state.pagination.page = 0;
      state.pagination.renderedCount = 0;
      state.pagination.loading = false;
    }

    const list = state.renderList || [];
    const BATCH = 60;
    let i = state.pagination.renderedCount = 0;

    // Group headers when showing duplicates.
    const grouped = state.filter.duplicatesOnly;
    let lastKey = null;
    const groupCounts = new Map();
    if (grouped){
      for (const a of list){ const k = dupKey(a); groupCounts.set(k, (groupCounts.get(k)||0)+1); }
    }

    function step(){
      const frag = document.createDocumentFragment();
      const end = Math.min(i + BATCH, list.length);
      for (; i < end; i++){
        const asset = list[i];
        if (grouped){
          const k = dupKey(asset);
          if (k !== lastKey){
            lastKey = k;
            frag.appendChild(buildDupGroupHeader(asset, groupCounts.get(k)||0));
          }
        }
        frag.appendChild(asset._isComposition ? buildCompositionCard(asset) : buildAssetCard(asset));
      }
      container.appendChild(frag);
      patchText($('#assets-count-title'), `(${(state.data.collection||[]).length})`);
      patchText($('#compositions-count-title'), `(${(state.data.compositions||[]).length})`);
      if (i < list.length){
        requestAnimationFrame(step);
      } else {
        state.pagination.renderedCount = list.length;
      }
    }
    step();
  }

  /* ========= Filtering ========= */
  // Duplicate grouping key: name + direction + color family.
  function dupKey(a){
    return `${(a.name||'').trim().toLowerCase()}|${a.direction||''}|${closestColorFamily(a.color)}`;
  }
  function buildDupGroupHeader(asset, count){
    const fam = closestColorFamily(asset.color);
    const hex = COLOR_FAMILIES[fam] || asset.color || '#000';
    const header = document.createElement('div');
    header.className = 'dup-group-header';
    header.innerHTML =
      `<span class="gh-swatch" style="background:${hex}"></span>
       <span class="gh-name">${escapeHtml(asset.name || '(no name)')}</span>
       <span class="gh-meta">${escapeHtml(asset.direction || '—')} · ${escapeHtml(fam)}</span>
       <span class="gh-badge">${count}</span>`;
    return header;
  }
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
    const noTags = state.filter.noTags;
    const noColor = state.filter.noColor;

    // Duplicates: assets sharing the same name + direction + color family.
    const dupOnly = state.filter.duplicatesOnly;
    let dupSet = null;
    if (dupOnly){
      const groups = new Map();
      for (const a of (state.data.collection||[])){
        const key = `${(a.name||'').trim().toLowerCase()}|${a.direction||''}|${closestColorFamily(a.color)}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(a.imagePath);
      }
      dupSet = new Set();
      for (const arr of groups.values()){
        if (arr.length > 1) arr.forEach(p => dupSet.add(p));
      }
    }

    const out = [];
    for (const asset of (state.data.collection||[])){
      const nameOk = !nameQ || (asset.name||'').toLowerCase().includes(nameQ);
      const tagsOk = tags.length===0 || tags.every(t => (asset.tags||[]).includes(t));
      const dirOk  = !direction || asset.direction === direction;
      const colOk  = !colorFamily || closestColorFamily(asset.color) === colorFamily;
      const noTagsOk  = !noTags  || (asset.tags||[]).length === 0;
      const noColorOk = !noColor || !asset.color;
      const dupOk = !dupOnly || dupSet.has(asset.imagePath);
      if (nameOk && tagsOk && dirOk && colOk && noTagsOk && noColorOk && dupOk) out.push(asset);
    }
    return out;
  }
  function filterAssets(){
    const q = (state.filter.name||'').toLowerCase();
    if (state.activeTab === 'compositions'){
      state.renderList = (state.data.compositions||[])
        .filter(c => !q || (c.name||'').toLowerCase().includes(q))
        .map(c => ({...c, _isComposition:true}));
    } else {
      state.renderList = computeFilteredList();
      if (state.filter.duplicatesOnly)
        state.renderList.sort((a,b)=> dupKey(a).localeCompare(dupKey(b)));
    }
    patchText($('#assets-count-title'), `(${(state.data.collection||[]).length})`);
    patchText($('#compositions-count-title'), `(${(state.data.compositions||[]).length})`);
    setHidden($('#fixed-buttons-container'), state.activeTab !== 'assets');
    renderPage({ reset:true });
  }

  // Tab switching
  document.addEventListener('click', e=>{
    const tab = e.target.closest('.index-tab');
    if (!tab) return;
    const name = tab.dataset.tab;
    if (!name || name === state.activeTab) return;
    state.activeTab = name;
    document.querySelectorAll('.index-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    filterAssets();
  });

  /* ========= Data updates ========= */
  // Debounced server push (avoids one POST per keystroke).
  function schedulePush(){ debounce('push-json', pushJSON, 400); }

  function updateAsset(imagePath, field, value, opts = {}){
    const asset = (state.data.collection||[]).find(a => a.imagePath === imagePath);
    if (!asset) return null;
    asset[field] = value;
    asset.dateModified = nowISO();
    if (!asset.dateAdded) asset.dateAdded = asset.dateModified;

    // In batch mode (bulk edit), the caller runs the side-effects once at the end.
    if (opts.batch) return asset;

    const fileLabel = asset.name || (asset.imagePath.split('/').pop() || 'item');
    const fieldLabel = (field.charAt(0).toUpperCase() + field.slice(1));
    showNotification('info', `${fieldLabel} updated on "${fileLabel}"`);

    // Update counts in place (refreshes existing cards/filters without rebuilding
    // the grid). We deliberately do NOT call filterAssets() here: re-rendering
    // would destroy the card being edited and steal focus mid-typing.
    recalcCountsAndTags();
    populateFilters();
    schedulePush();
    return asset;
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

    saveBtn?.addEventListener('click', async ()=>{
      const selected = $$('.asset-card.selected');
      const newName = $('#modal-name')?.value?.trim() || '';
      const newTags = Array.from($('#modal-tags-container')?.querySelectorAll('.tag-pill')||[]).map(p=>p.firstChild.textContent.trim());
      const newDir = $('#modal-direction')?.value || '';
      const newColor = $('#modal-color-select')?.dataset?.hex || '';
      const newSColor = $('#modal-scolor-select')?.dataset?.hex || '';
      const newCategory = $('#modal-category-select')?.dataset?.value || '';
      if (!selected.length) return close();
      if (!await Dialog.confirm(`Are you sure you want to edit ${selected.length} assets?`, { confirmLabel: 'Edit', danger: true })) return;

      for (const card of selected){
        const path = card.dataset.imagePath;
        if (newName)  updateAsset(path, 'name', newName, { batch:true });
        if (newTags.length) updateAsset(path, 'tags', newTags, { batch:true });
        if (newDir)   updateAsset(path, 'direction', newDir, { batch:true });
        if (newColor) updateAsset(path, 'color', newColor, { batch:true });
        if (newSColor) updateAsset(path, 'secondaryColor', newSColor, { batch:true });
        if (newCategory) updateAsset(path, 'category', newCategory, { batch:true });
      }
      // Run the heavy side-effects once, then re-render to reflect new values.
      recalcCountsAndTags();
      populateFilters();
      pushJSON();
      filterAssets();
      showToast(`Bulk edit applied to ${selected.length} asset(s).`,'success');
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
    setHidden($('#delete-btn'), n===0);
    patchText($('#selected-count'), String(n));
    patchText($('#delete-count'), String(n));
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

    const dupBtn = $('#check-duplicates-btn');
    if (dupBtn){
      dupBtn.addEventListener('click', ()=>{
        state.filter.duplicatesOnly = !state.filter.duplicatesOnly;
        dupBtn.classList.toggle('active', state.filter.duplicatesOnly);
        dupBtn.textContent = state.filter.duplicatesOnly ? 'Show all' : 'Check duplicates';
        filterAssets();
        if (state.filter.duplicatesOnly){
          const n = state.renderList.length;
          showToast(n ? `${n} duplicate asset(s) found` : 'No duplicates found', n ? 'info' : 'success');
        }
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

    // Delete selected assets from the JSON (images are kept on disk).
    $('#delete-btn')?.addEventListener('click', async ()=>{
      const selectedPaths = $$('.asset-card.selected').map(c=>c.dataset.imagePath);
      if (!selectedPaths.length) return;
      if (!await Dialog.confirm(`Remove ${selectedPaths.length} asset(s) from the JSON?\nThe image files are kept on disk.`, { confirmLabel: 'Delete', danger: true })) return;
      const set = new Set(selectedPaths);
      state.data.collection = (state.data.collection||[]).filter(a => !set.has(a.imagePath));
      recalcCountsAndTags();
      populateFilters();
      pushJSON();
      filterAssets();
      updateSelectionUI();
      showToast(`${selectedPaths.length} asset(s) removed from JSON`, 'success');
    });

    // ── Validate progress overlay ─────────────────────────────────────────────
    const validateOverlay = (() => {
      const el = document.createElement('div');
      el.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;align-items:center;justify-content:center';
      el.innerHTML = `
        <div style="background:#fff;border-radius:14px;padding:28px 32px;width:380px;box-shadow:0 20px 60px rgba(0,0,0,.25);text-align:center">
          <div id="vo-title" style="font-weight:700;font-size:1.05rem;margin-bottom:6px">Saving collection…</div>
          <div id="vo-sub" style="color:#6b7280;font-size:.88rem;margin-bottom:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;width:100%">Preparing…</div>
          <div style="background:#e5e8f0;border-radius:999px;height:8px;overflow:hidden">
            <div id="vo-bar" style="height:100%;width:0%;background:#4f46e5;border-radius:999px;transition:width .15s ease"></div>
          </div>
          <div id="vo-counter" style="color:#6b7280;font-size:.8rem;margin-top:8px">0 / 0</div>
        </div>`;
      document.body.appendChild(el);
      return {
        show(title='Saving collection…'){ el.style.display='flex'; el.querySelector('#vo-title').textContent=title; },
        hide(){ el.style.display='none'; },
        update(done, total, label=''){
          const pct = total ? Math.round(done/total*100) : 0;
          el.querySelector('#vo-bar').style.width = pct+'%';
          el.querySelector('#vo-counter').textContent = `${done} / ${total}`;
          if (label) el.querySelector('#vo-sub').textContent = label;
        },
      };
    })();

    // Validate Selection -> creates validated/<name>/ with the images + JSON.
    $('#validate-btn')?.addEventListener('click', async ()=>{
      const selectedPaths = $$('.asset-card.selected').map(c=>c.dataset.imagePath);
      if (!selectedPaths.length){
        await Dialog.alert('Select at least 1 asset.', { type: 'warning' });
        return;
      }

      const selectedAssets = (state.data.collection||[]).filter(a => selectedPaths.includes(a.imagePath));
      const items = selectedAssets.map(a => ({
        imagePath: a.imagePath,
        newFilename: buildFilename(a)
      }));
      const subset = {
        collectionName: (state.data.collectionName || ''),
        tags: state.data.tags || [],
        collection: selectedAssets
      };

      // Ask for the folder name
      const suggestion = (state.data.collectionName || '').trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\-_]/g, '') || '';
      let folderName = await Dialog.prompt('Folder name to create inside "validated":', { defaultValue: suggestion });
      while (folderName !== null){
        const clean = folderName.trim();
        if (!clean){
          folderName = await Dialog.prompt('Please enter a valid folder name:', { defaultValue: suggestion });
          continue;
        }

        // Step 1: check if dir exists, then prepare
        let overwrite = false;
        const checkRes = await fetch(`${API_URL}/list_versions?dir=${encodeURIComponent(clean)}`).catch(()=>null);
        const dirExists = checkRes && checkRes.status !== 404;
        if (dirExists){
          // list_versions returns 200 even for empty dirs, use it as existence check
          const doOver = await Dialog.confirm(
            `"validated/${clean}" already exists.\n\nOverwrite it and save the current version as a backup?`,
            { confirmLabel:'Overwrite & backup', cancelLabel:'Choose new name' }
          );
          if (!doOver){
            folderName = await Dialog.prompt('Choose a different name:', { defaultValue:`${clean}-2` });
            continue;
          }
          overwrite = true;
        }
        const prep = await fetch(`${API_URL}/validate_prepare`, {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ dir: clean, overwrite })
        });
        if (!prep.ok){
          const e = await prep.json().catch(()=>({}));
          showNotification('error', `Validate failed: ${e.message||prep.status}`);
          return;
        }

        // Step 2: copy files one by one
        validateOverlay.show();
        validateOverlay.update(0, items.length, 'Preparing…');
        const nameMap = {};
        let copied = 0;
        const errors = [];
        try{
          for (const item of items){
            validateOverlay.update(copied, items.length, item.imagePath.split('/').pop());
            // yield to the event loop so the browser can breathe between requests
            await new Promise(r => setTimeout(r, 0));
            try{
              const r = await fetch(`${API_URL}/validate_copy_file`, {
                method:'POST', headers:{'Content-Type':'application/json'},
                body: JSON.stringify({ dir: clean, imagePath: item.imagePath, newFilename: item.newFilename })
              });
              const out = await r.json().catch(()=>({}));
              if (!r.ok) throw new Error(out.message||`HTTP ${r.status}`);
              nameMap[item.imagePath] = out.destName;
              copied++;
            }catch(e){ errors.push(`${item.imagePath}: ${e.message}`); }
            validateOverlay.update(copied, items.length);
          }

          // Step 3: write JSON
          validateOverlay.update(copied, items.length, 'Writing JSON…');
          await new Promise(r => setTimeout(r, 0));
          try{
            const r = await fetch(`${API_URL}/validate_write_json`, {
              method:'POST', headers:{'Content-Type':'application/json'},
              body: JSON.stringify({ dir: clean, json: subset, nameMap })
            });
            if (!r.ok){ const e=await r.json().catch(()=>({})); throw new Error(e.message||`HTTP ${r.status}`); }
          }catch(e){ errors.push(`JSON: ${e.message}`); }
        } finally {
          validateOverlay.hide();
        }

        if (errors.length){
          showNotification('warning', `Saved ${copied}/${items.length} — ${errors.length} error(s)`);
        } else {
          showNotification('success', `Saved ${copied} image(s) + JSON to validated/${clean}`);
        }
        return;
      }
    });

  }

  /* ========= JSON Switcher (Collection dropdown + Upload) ========= */
  function injectJsonControls(){
    let host = $('#json-controls');
    if (!host){
      const target = document.querySelector('.topbar-right') || document.querySelector('.app-topbar') || document.body;
      host = document.createElement('div');
      host.id = 'json-controls';
      host.innerHTML = `
        <input type="file" id="json-upload" accept="application/json" hidden />
        <select id="collection-select" aria-label="Active collection">
          <option value="__default__">Default</option>
        </select>
        <button id="btn-load-json" class="menu-btn primary" title="Load a JSON collection">
          <span aria-hidden="true">⬆</span> Load JSON
        </button>
      `;
      target.appendChild(host);
    }

    const fileInput    = $('#json-upload');
    const btnLoad      = $('#btn-load-json');
    const collSelect   = $('#collection-select');

    // Populate the select from /list_collections (lazy: called on first focus/click)
    let _collectionsLoaded = false;
    async function loadCollectionsList(){
      if (_collectionsLoaded) return;
      try{
        const signal = AbortSignal.timeout ? AbortSignal.timeout(4000) : undefined;
        const r = await fetch(`${API_URL}/list_collections?t=${Date.now()}`, { signal });
        if (!r.ok) return;
        const data = await r.json();
        const cols = data.collections || [];
        while (collSelect.options.length > 1) collSelect.remove(1);
        for (const c of cols){
          const opt = document.createElement('option');
          opt.value = c.dir;
          opt.textContent = c.collectionName || c.dir;
          collSelect.appendChild(opt);
        }
        _collectionsLoaded = true;
        refreshSelect();
      }catch(e){
        // Server not running or unreachable — silently keep "Default" only.
      }
    }

    function refreshSelect(){
      if (state.source.type === 'file'){
        collSelect.value = '__default__';
      } else if (state.source.type === 'collection' && state.source.dir){
        collSelect.value = state.source.dir;
      }
      // 'upload' (local file): leave select as-is
    }
    state._refreshSourceSwitch = refreshSelect;

    // Load lazily on first interaction with the select.
    collSelect.addEventListener('focus', loadCollectionsList);
    collSelect.addEventListener('mousedown', loadCollectionsList);

    collSelect.addEventListener('change', async ()=>{
      const val = collSelect.value;
      if (val === '__default__'){
        state.source = { type:'file', name:'assets_list.json' };
        ASSETS_FILE = 'assets_list.json';
        await loadAssets();
      } else {
        // Load collection JSON directly from validated/<dir>/
        try{
          const r = await fetch(`validated/${val}/assets_list.json?t=${Date.now()}`);
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const json = await r.json();

          // Rewrite bare imagePaths using imageBase (set by server on validate)
          const base = (json.imageBase || `validated/${val}`).replace(/^\/+|\/+$/g, '');
          const coll = Array.isArray(json.collection) ? json.collection : [];
          coll.forEach(a => {
            if (a && a.imagePath){
              const name = String(a.imagePath).split('/').pop();
              a.imagePath = `${base}/${name}`;
            }
          });

          state.source = { type:'collection', dir: val, name: json.collectionName || val };
          applyExternalJSON(json, json.collectionName || val);
          showToast(`Collection "${json.collectionName || val}" loaded`, 'success');
        }catch(err){
          console.error(err);
          showToast(`Failed to load collection: ${err.message}`, 'error');
          collSelect.value = state.source.type === 'file' ? '__default__' : (state.source.dir || '__default__');
        }
      }
    });

    btnLoad?.addEventListener('click', () => fileInput?.click());
    fileInput?.addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      try{
        const text = await file.text();
        const json = JSON.parse(text);

        const coll = Array.isArray(json.collection) ? json.collection : [];
        const looksBare = coll.length && coll.every(a => a && a.imagePath && !String(a.imagePath).includes('/'));
        const suggested = json.imageBase ? String(json.imageBase) : (looksBare ? 'validated/' : '');
        const base = await Dialog.prompt(
          'Base path to prepend to image files (e.g. "validated/test-2").\nLeave empty to keep paths unchanged.',
          { defaultValue: suggested, placeholder: 'validated/my-pack' }
        );
        if (base !== null && base.trim()){
          const b = base.trim().replace(/^\/+|\/+$/g, '');
          coll.forEach(a => {
            if (a && a.imagePath){
              const name = String(a.imagePath).split('/').pop();
              a.imagePath = `${b}/${name}`;
            }
          });
        }

        state._uploadCache = { json: JSON.parse(JSON.stringify(json)), name: file.name };
        persistCache(state._uploadCache);
        applyExternalJSON(json, file.name);
        showToast(`JSON loaded (${file.name})`, 'success');
      }catch(err){
        console.error(err);
        showToast('Invalid JSON file','error');
      } finally {
        fileInput.value = '';
      }
    });

  }

  function normalizeDataStructure(data){
    const out = {
      collectionName: String(data.collectionName || ''),
      tags: Array.isArray(data.tags) ? data.tags.slice() : [],
      collection: Array.isArray(data.collection) ? data.collection.slice() : [],
      compositions: Array.isArray(data.compositions) ? data.compositions.slice() : [],
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
      // Stamp dateAdded if missing (backfills older JSONs); keep dateModified.
      a.dateAdded = String(a.dateAdded || '') || nowISO();
      a.dateModified = String(a.dateModified || '');
    });
    return out;
  }

  function applyExternalJSON(jsonObj, filename='uploaded.json'){
    const data = normalizeDataStructure(jsonObj);
    state.data = data;
    // Preserve source.type if already set to 'collection' by the caller.
    if (state.source.type !== 'collection'){
      state.source = { type:'upload', name: filename };
      persistSource('upload');
    }
    recalcCountsAndTags();
    populateFilters();
    populateGlobalTags();
    state.renderList = state.data.collection.slice();
    renderPage({ reset:true });
    updateSelectionUI();
    patchText($('#main-title'), state.data.collectionName || 'Assets Collection');
    const nameInput = $('#collection-name');
    if (nameInput) nameInput.value = state.data.collectionName || '';
    state._refreshSourceSwitch?.();
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
        onChange: ()=> filterAssets(),
        noTagsToggle: true
      });
    }

    const colorRoot = $('#filter-color-select');
    if (colorRoot){
      createColorSelect(colorRoot, {
        initialHex: '',
        allowAll: true,
        allowNone: true,
        onChange: (val)=> {
          if (val === NO_COLOR){ state.filter.noColor = true; state.filter.colorHex = ''; }
          else { state.filter.noColor = false; state.filter.colorHex = val || ''; }
          filterAssets();
        },
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
        if (opt.dataset.value === NO_COLOR){
          span.textContent = `(${(state.data.collection||[]).filter(a=>!a.color).length})`;
        } else if (!fam){
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
      persistSource('file');

      document.title = state.data.collectionName || 'Assets Collection';
      patchText($('#main-title'), document.title);
      const nameInput = $('#collection-name');
      if (nameInput) nameInput.value = state.data.collectionName || '';

      recalcCountsAndTags();
      populateFilters();
      populateGlobalTags();

      state.renderList = state.data.collection.slice();
      renderPage({ reset:true });
      updateSelectionUI();
      state._refreshSourceSwitch?.();
    } catch(err){
      console.error(err);
      const c = $('#container');
      if (c){
        c.innerHTML = `
          <div class="state-panel error">
            <div class="state-icon" aria-hidden="true">⚠️</div>
            <h3 class="state-title">Could not load the collection</h3>
            <p class="state-text">Make sure <code>${escapeHtml(ASSETS_FILE)}</code> exists and that the server is running.</p>
            <button type="button" class="state-btn" id="retry-load-btn">Retry</button>
          </div>`;
        $('#retry-load-btn')?.addEventListener('click', ()=> loadAssets());
      }
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

    populateGlobalTags();
  }

  // (Re)build the Global Tags input from state.data.tags. Called on every load
  // so tags coming from the JSON are actually displayed.
  function populateGlobalTags(){
    const root = $('#global-tags-simple');
    if (!root) return;
    // Clear existing pills + input so we don't stack duplicate listeners.
    root.querySelectorAll('.simple-pill, input').forEach(el => el.remove());
    let seeding = true; // avoid a server push while seeding initial tags
    createSimpleTagsInput(root, state.data.tags || [], (tags)=>{
      if (seeding) return;
      state.data.tags = tags; pushJSON();
    });
    seeding = false;
  }

  // Decide what to show on startup: the last loaded JSON (if the user was on
  // it before refresh) or the project-root assets_list.json.
  function bootstrapData(){
    const src = localStorage.getItem(LS_SRC);
    if (src === 'upload' && state._uploadCache){
      try{
        applyExternalJSON(JSON.parse(JSON.stringify(state._uploadCache.json)), state._uploadCache.name);
        $('#loader')?.remove();
        return;
      }catch(e){ console.error('Could not restore loaded JSON', e); }
    }
    loadAssets();
  }

  function init(){
    state._uploadCache = readCache(); // restore cached upload so the switch can show it
    setupGlobalDropdownCloser();
    setupFilters();
    const modalCtl = setupModal();
    setupToolbar(modalCtl);
    setupGlobalMetadata();
    // Honour ?tab= query param (e.g. redirect back from compose after edit)
    const urlTab = new URLSearchParams(location.search).get('tab');
    if (urlTab === 'compositions'){
      state.activeTab = 'compositions';
      document.querySelectorAll('.index-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'compositions'));
      history.replaceState(null, '', location.pathname);
    }
    bootstrapData();
  }

  document.addEventListener('DOMContentLoaded', init);

  // Inline styles for category & json controls
  (function ensureCategoryStyles(){
    if (document.getElementById('cat-style')) return;
    const st = document.createElement('style');
    st.id = 'cat-style';
    st.textContent = `
      .custom-category-select { position: relative; cursor:pointer; }
      .selected-category-display { display:flex; align-items:center; justify-content:space-between; border:1px solid var(--border-strong,#d3d8e4); border-radius:8px; padding:9px 12px; background:var(--surface,#fff); cursor:pointer; transition:border-color .15s, box-shadow .15s; }
      .selected-category-display:hover { border-color:var(--accent,#4f46e5); }
      [data-component="category-select"][aria-expanded="true"] .selected-category-display { border-color:var(--accent,#4f46e5); box-shadow:var(--ring,0 0 0 3px rgba(79,70,229,.22)); }
      .category-name { font-size:.95rem; }
      .category-options-list { position:absolute; top:calc(100% + 6px); left:0; right:0; z-index:30; max-height:280px; overflow:auto; background:var(--surface,#fff); border:1px solid var(--border,#e5e8f0); border-radius:10px; box-shadow:var(--shadow-lg,0 16px 40px rgba(16,24,40,.16)); padding:6px; display:none; }
      [data-component="category-select"][aria-expanded="true"] .category-options-list { display:block; }
      .category-option { padding:9px 11px; border-radius:8px; cursor:pointer; }
      .category-option:hover { background:var(--surface-2,#f7f8fb); }
      .category-option .cat-title { font-weight:600; font-size:.9rem; }
      .category-option .cat-examples { font-size:.78rem; color:var(--text-muted,#6b7280); margin-top:2px; }
    `;
    document.head.appendChild(st);
  })();

})();