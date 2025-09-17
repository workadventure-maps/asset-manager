(() => {
  const API_URL = 'http://localhost:8000';
  const ASSETS_FILE = 'assets_list.json';

  const ALL_TAGS_DEFAULT = ["Furniture","Bathroom","Kitchen","Electronics","Decoration","Lighting","Meeting & School","Outdoor","Recreation & Gaming"];
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

  const state = {
    data: { collectionName: '', tags: [], collection: [] },
    availableTags: [],
    counts: { tags:{}, direction:{}, color:{} },
    cardsByPath: new Map(),
    filter: { name:'', tags:[], direction:'', colorHex:'' },
    debounceTimers: {},
    // Infinite scroll
    pagination: { batchSize: 50, page: 0, loading: false, renderedCount: 0 },
    renderList: [] // liste d'assets filtrés
  };

  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));
  const debounce = (key, fn, delay=150) => { clearTimeout(state.debounceTimers[key]); state.debounceTimers[key] = setTimeout(fn, delay); };

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
  function patchText(el, text){ if(el && el.textContent !== text) el.textContent = text; }
  function setHidden(el, hidden){ if(!el) return; el.style.display = hidden ? 'none' : ''; }

  /* ========= Utils for Validate ========= */
  function slugify(s){
    return String(s||'')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')        // spaces -> dashes
      .replace(/[^a-z0-9\-_]+/g, '') // remove unsafe
      .replace(/-+/g, '-')          // dedupe -
      .replace(/^[-_]+|[-_]+$/g,''); // trim - _
  }
  function buildFilename(asset){
    const name = slugify(asset.name || asset.imagePath.split('/').pop().replace(/\.[^.]+$/, ''));
    const dir  = slugify(asset.direction || '');
    const col  = slugify(closestColorFamily(asset.color || '') || '');
    return `${name}_${dir}_${col}.png`;
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
  function escapeHtml(str){
    return String(str).replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
  }

  /* ========= Dropdown infra ========= */
  function setupGlobalDropdownCloser(){
    document.addEventListener('click', (e) => {
      $$('.color-options-list[aria-hidden="false"], .tags-list-container[aria-hidden="false"]').forEach(p=>{
        const path = e.composedPath ? e.composedPath() : [];
        if (path.includes(p) || (p.previousElementSibling && path.includes(p.previousElementSibling))) return;
        p.setAttribute('aria-hidden','true');
        const parentSelect = p.closest('[data-component="color-select"]');
        if (parentSelect) parentSelect.setAttribute('aria-expanded','false');
      });
    }, { capture:true });
  }
  function togglePanel(panel, ownerSelect){
    const opened = panel.getAttribute('aria-hidden') === 'false';
    $$('.color-options-list, .tags-list-container').forEach(p=>{ if (p !== panel) p.setAttribute('aria-hidden','true'); });
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
    sel.innerHTML = `<option value="">All directions</option>`;
    for (const d of ALL_DIRECTIONS){
      const count = state.counts.direction[d]||0;
      const opt = document.createElement('option');
      opt.value = d; opt.textContent = `${d} (${count})`; sel.appendChild(opt);
    }
    patchText($('#tags-count'), String(state.availableTags.length));
    patchText($('#direction-count'), String(ALL_DIRECTIONS.length));
    patchText($('#color-count'), String(Object.keys(COLOR_FAMILIES).length));
  }

  /* ========= Tags inputs ========= */
  function createTagsInput({container, initial=[], onChange}){
    const list = container.querySelector('.tags-list-container');
    const input = container.querySelector('input');

    list.innerHTML = `<input type="text" class="tags-search" placeholder="Search tags…" aria-label="Search tags">
                      <div class="tags-list-scroll"></div>`;
    const search = list.querySelector('.tags-search');
    const scroll = list.querySelector('.tags-list-scroll');
    makePanelInteractive(list);

    function currentTags(){ return Array.from(container.querySelectorAll('.tag-pill')).map(p=>p.firstChild.textContent.trim()); }

    function renderSuggestions(q=''){
      scroll.innerHTML = '';
      const cur = new Set(currentTags());
      const suggestions = state.availableTags.filter(t => t.toLowerCase().includes(q.toLowerCase()));
      for (const t of suggestions){
        const item = document.createElement('div');
        item.className='tags-list-item';
        if (cur.has(t)) item.classList.add('selected');
        item.textContent = `${t} (${state.counts.tags[t]||0})`;
        item.addEventListener('click', (e)=>{
          e.stopPropagation();
          if (!cur.has(t)) addTagPill(t);
          hideList(); input.value = '';
          onChange?.(currentTags());
        });
        scroll.appendChild(item);
      }
    }

    function showList(){ togglePanel(list); list.setAttribute('aria-hidden','false'); renderSuggestions(''); }
    function hideList(){ list.setAttribute('aria-hidden','true'); }

    function addTagPill(tag){
      const pill = document.createElement('span');
      pill.className='tag-pill'; pill.innerHTML = `<span>${tag}</span><span class="remove-tag" aria-label="Remove tag" role="button" tabindex="0">x</span>`;
      pill.querySelector('.remove-tag').addEventListener('click',(e)=>{
        e.stopPropagation(); pill.remove(); onChange?.(currentTags());
      });
      container.insertBefore(pill, input);
    }

    initial.forEach(addTagPill);

    input.addEventListener('focus', ()=> { list.setAttribute('aria-hidden','false'); renderSuggestions(''); });
    input.addEventListener('input', ()=> renderSuggestions(input.value));
    input.addEventListener('keydown', (e)=>{
      if (e.key === 'Enter' && input.value.trim()){
        const val = input.value.trim();
        addTagPill(val); input.value = ''; hideList(); onChange?.(currentTags());
      }
    });
    input.addEventListener('click', (e)=> e.stopPropagation());

    return { showList, hideList, currentTags, addTagPill };
  }

  function createSimpleTagsInput(root, initial=[], onChange){
    const input = root.querySelector('input');
    function current(){ return Array.from(root.querySelectorAll('.simple-pill')).map(p=>p.dataset.value); }
    function add(tag){
      const t = tag.trim(); if(!t) return;
      if(current().includes(t)) return;
      const pill = document.createElement('span');
      pill.className='simple-pill'; pill.dataset.value=t;
      pill.innerHTML = `${t} <button type="button" aria-label="Remove tag">&times;</button>`;
      pill.querySelector('button').addEventListener('click',()=>{ pill.remove(); onChange?.(current()); });
      root.insertBefore(pill, input);
      onChange?.(current());
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

  /* ========= Color select (init silencieuse pour éviter la boucle) ========= */
  function createColorSelect(root, { initialHex='', allowAll=false, onChange, showCounts=true }){
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
    // init silencieuse — ne déclenche pas onChange/updateAsset
    setValue(initialHex, initialHex ? closestColorFamily(initialHex) : (allowAll ? 'All Colors' : 'Leave unchanged'), { silent:true });

    display.addEventListener('click', (e)=>{ e.stopPropagation(); togglePanel(panel, root); });
    display.addEventListener('keydown', (e)=>{ if (e.key==='Enter' || e.key===' ') { e.preventDefault(); togglePanel(panel, root); } });

    return { setValue, refreshCounts };
  }

  /* ========= Cards ========= */
  function buildAssetCard(asset){
    const card = document.createElement('div');
    card.className='asset-card';
    card.dataset.imagePath = asset.imagePath;
    card.tabIndex = 0;

    // Image + détails
    const imageContainer = document.createElement('div');
    imageContainer.className='image-container';
    const img = new Image();
    img.decoding = 'async';
    img.loading = 'lazy';
    img.alt = asset.name || '';
    const details = document.createElement('div');
    details.className='image-details';
    imageContainer.appendChild(img);
    imageContainer.appendChild(details);
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
    };
    const onError = () => {
      loadedOk = false;
      details.innerHTML = `<small><strong>${filename}</strong> — Failed to load</small>`;
    };
    img.addEventListener('load', onLoad, { once:true });
    img.addEventListener('error', onError, { once:true });

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

    // Direction (options avec compteurs)
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

    // Color (dropdown custom avec compteurs)
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

    // Toggle sélection
    card.addEventListener('click', (evt)=>{
      const interactive = evt.target.closest('input, select, .tags-input-container, [data-component="color-select"]');
      if (interactive) return;
      card.classList.toggle('selected');
      updateSelectionUI();
    });

    state.cardsByPath.set(asset.imagePath, { el: card, refs: { nameInput, dirSelect, colorSelectCtl } });
    return card;
  }

  /* ========= Render with infinite scroll ========= */
  function resetPagination(){
    state.pagination.page = 0;
    state.pagination.renderedCount = 0;
    state.pagination.loading = false;
  }

  function renderPage({ reset=false } = {}){
    const container = $('#container');
    if (reset){
      container.innerHTML = '';
      state.cardsByPath.clear();
      resetPagination();
    }
    const { batchSize, page } = state.pagination;
    const end = Math.min((page+1)*batchSize, state.renderList.length);
    for (let i = state.pagination.renderedCount; i < end; i++){
      const asset = state.renderList[i];
      container.appendChild(buildAssetCard(asset));
    }
    state.pagination.renderedCount = end;
    patchText($('#assets-count-title'), `${state.renderList.length} items`);
  }

  function handleScroll(){
    if (state.pagination.loading) return;
    const nearBottom = window.innerHeight + window.scrollY >= document.body.offsetHeight - 400;
    if (!nearBottom) return;
    if (state.pagination.renderedCount >= state.renderList.length) return;
    state.pagination.loading = true;
    state.pagination.page += 1;
    requestAnimationFrame(()=>{
      renderPage({ reset:false });
      state.pagination.loading = false;
    });
  }

  /* ========= Filtering ========= */
  function readFilterTags(){
    const pills = $('#filter-tags-container').querySelectorAll('.tag-pill');
    return Array.from(pills).map(p=>p.firstChild.textContent.trim());
  }

  function computeFilteredList(){
    const nameQ = state.filter.name.toLowerCase();
    const tags = readFilterTags();
    const direction = state.filter.direction;
    const colorHex = state.filter.colorHex;
    const colorFamily = colorHex ? closestColorFamily(colorHex) : '';

    const out = [];
    for (const asset of state.data.collection){
      const nameOk = !nameQ || (asset.name||'').toLowerCase().includes(nameQ);
      const tagsOk = tags.length===0 || tags.every(t => (asset.tags||[]).includes(t));
      const dirOk = !direction || asset.direction === direction;
      const colOk = !colorFamily || closestColorFamily(asset.color) === colorFamily;
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
    const asset = state.data.collection.find(a => a.imagePath === imagePath);
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
    fetch(API_URL, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify(state.data)
    }).catch(err=> console.error('Error updating JSON:', err));
  }

  /* ========= Modal (bulk) ========= */
  function setupModal(){
    const modal = $('#bulkEditModal');
    const closeBtn = modal.querySelector('.close-btn');
    const cancelBtn = $('#close-modal-btn');
    const saveBtn = $('#save-bulk-btn');
    const title = $('#bulkEditTitle');

    const dirSelect = $('#modal-direction');
    dirSelect.innerHTML = `<option value="">Leave unchanged</option>`;
    for (const d of ALL_DIRECTIONS){
      const opt = document.createElement('option');
      opt.value=d; opt.textContent=d; dirSelect.appendChild(opt);
    }

    createTagsInput({ container: $('#modal-tags-container'), initial: [], onChange: ()=>{} });
    createColorSelect($('#modal-color-select'), { initialHex:'', allowAll:true, onChange: ()=>{}, showCounts:true });

    function open(){
      const count = $$('.asset-card.selected').length;
      patchText(title, `Edit ${count} Assets`);
      $('#modal-name').value = '';
      $('#modal-tags-container').querySelectorAll('.tag-pill').forEach(p=>p.remove());
      $('#modal-direction').value = '';
      $('#modal-color-select').dataset.hex = '';
      $('#modal-color-name').textContent = 'Leave unchanged';
      $('#modal-color-swatch').style.backgroundColor = 'transparent';
      modal.setAttribute('aria-hidden','false');
    }
    function close(){ modal.setAttribute('aria-hidden','true'); }

    closeBtn.addEventListener('click', close);
    closeBtn.addEventListener('keydown', (e)=>{ if(e.key==='Enter'||e.key===' ') close(); });
    cancelBtn.addEventListener('click', close);
    window.addEventListener('click', (e)=>{ if(e.target===modal) close(); });

    saveBtn.addEventListener('click', ()=>{
      const selected = $$('.asset-card.selected');
      const newName = $('#modal-name').value.trim();
      const newTags = Array.from($('#modal-tags-container').querySelectorAll('.tag-pill')).map(p=>p.firstChild.textContent.trim());
      const newDir = $('#modal-direction').value;
      const newColor = $('#modal-color-select').dataset.hex || '';
      if (!selected.length) return close();
      if (!confirm(`Are you sure you want to edit ${selected.length} assets?`)) return;

      for (const card of selected){
        const path = card.dataset.imagePath;
        const updates = {};
        if (newName)  updates.name = newName;
        if (newTags.length) updates.tags = newTags;
        if (newDir)   updates.direction = newDir;
        if (newColor) updates.color = newColor;

        for (const [k,v] of Object.entries(updates)){
          updateAsset(path, k, v); // déclenche aussi les toasts
        }
      }
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
    $('#select-all-btn').addEventListener('click', ()=>{
      $$('.asset-card').forEach(c=>c.classList.add('selected'));
      updateSelectionUI();
    });
    $('#deselect-btn').addEventListener('click', ()=>{
      $$('.asset-card.selected').forEach(c=>c.classList.remove('selected'));
      updateSelectionUI();
    });
    $('#bulk-edit-btn').addEventListener('click', ()=> modalCtl.open());

    // Validate Selection: copy/rename on server + client JSON export
    $('#validate-btn').addEventListener('click', async ()=>{
      const selectedPaths = $$('.asset-card.selected').map(c=>c.dataset.imagePath);
      if (!selectedPaths.length){
        alert('Select at least 1 asset.');
        return;
      }
      if (!confirm(`Validate ${selectedPaths.length} assets? Files will be copied/renamed and a JSON will be created.`)) return;

      const selectedAssets = state.data.collection.filter(a => selectedPaths.includes(a.imagePath));
      const items = selectedAssets.map(a => ({
        imagePath: a.imagePath,
        name: a.name || '',
        tags: a.tags || [],
        direction: a.direction || '',
        color: a.color || '',
        newFilename: buildFilename(a)
      }));

      // Envoi serveur
      let serverOk = false;
      try{
        const res = await fetch(`${API_URL}/validate_selection`, {
          method: 'POST',
          headers: { 'Content-Type':'application/json' },
          body: JSON.stringify({ targetDir: 'validate elements', items })
        });
        if (!res.ok){
          const txt = await res.text().catch(()=> '');
          throw new Error(txt || `Server error ${res.status}`);
        }
        const out = await res.json().catch(()=> ({}));
        serverOk = true;
        showNotification('success', `Validated ${items.length} item(s) on server`);
        console.log('Validate server response:', out);
      }catch(err){
        console.error(err);
        showNotification('error', `Server validate failed: ${err.message}`);
      }

      // Export JSON client (toujours, pour traçabilité)
      const subset = {
        collectionName: (state.data.collectionName || '') + ' — validated',
        tags: state.data.tags || [],
        collection: selectedAssets
      };
      downloadJSON('validated-selection.json', subset);

      if (!serverOk){
        alert('Server validate failed. A local JSON export has been downloaded.');
      }
    });

    $('#update-colors-btn').addEventListener('click', ()=>{
      if (!confirm("Are you sure you want to update the colors of all assets? This action is irreversible.")) return;
      fetch(`${API_URL}/update_colors`, { method:'POST', headers:{'Content-Type':'application/json'} })
        .then(r=>{ if(!r.ok) throw new Error('Color update failed.'); return r.json(); })
        .then(d=>{ alert(d.message||'Colors updated'); loadAssets(); })
        .catch(err=> alert(`Error: ${err.message}`));
    });
  }

  /* ========= Filters wiring ========= */
  function setupFilters(){
    $('#filter-name').addEventListener('input', ()=>{
      debounce('filter-name', ()=>{
        state.filter.name = $('#filter-name').value || '';
        filterAssets();
      });
    });
    $('#filter-direction').addEventListener('change', ()=>{
      state.filter.direction = $('#filter-direction').value || '';
      filterAssets();
    });

    createTagsInput({
      container: $('#filter-tags-container'),
      initial: [],
      onChange: ()=> filterAssets()
    });

    createColorSelect($('#filter-color-select'), {
      initialHex: '',
      allowAll: true,
      onChange: (hex)=> { state.filter.colorHex = hex || ''; filterAssets(); },
      showCounts: true
    });
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
      state.data = await r.json();

      document.title = state.data.collectionName || 'Assets Collection';
      patchText($('#main-title'), document.title);
      $('#collection-name').value = state.data.collectionName || '';

      for (const a of (state.data.collection||[])){
        a.tags = a.tags || [];
        a.direction = a.direction || '';
        a.color = a.color || '';
      }

      recalcCountsAndTags();
      populateFilters();

      // initial list visible
      state.renderList = state.data.collection.slice();
      renderPage({ reset:true });

      updateSelectionUI();
      window.addEventListener('scroll', handleScroll, { passive:true });
    }catch(err){
      console.error(err);
      $('#container').innerHTML = `<p>Error: Could not load data. Ensure "assets_list.json" is present.</p>`;
    } finally {
      $('#loader')?.remove();
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

  function setupGlobalMetadata(){
    const nameInput = $('#collection-name');
    nameInput.value = state.data.collectionName || '';
    nameInput.addEventListener('change', (e)=>{
      state.data.collectionName = e.target.value;
      document.title = state.data.collectionName || 'Assets Collection';
      patchText($('#main-title'), document.title);
      pushJSON();
    });

    createSimpleTagsInput($('#global-tags-simple'), state.data.tags||[], (tags)=>{
      state.data.tags = tags; pushJSON();
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();