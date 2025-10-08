(() => {
  const API_URL = 'http://localhost:8000';
  const ASSETS_FILE = 'assets_list.json';

  const $  = (s, r=document)=> r.querySelector(s);
  const $$ = (s, r=document)=> Array.from(r.querySelectorAll(s));

  const state = {
    data: { collectionName:'', tags:[], collection:[] },
  };

  // Collisions travaille sur les images actuelles (pas de dist32 ici)
  function pathForDisplay(p){ return p; }

  function ensureCollisionGrid(asset, cols, rows){
    if (!asset.collisionGrid) {
      asset.collisionGrid = Array.from({length: rows}, ()=> Array.from({length: cols}, ()=>0));
    } else {
      // Harmonise si la taille a changé
      if (asset.collisionGrid.length !== rows || (asset.collisionGrid[0]||[]).length !== cols){
        const ng = Array.from({length: rows}, ()=> Array.from({length: cols}, ()=>0));
        for (let y=0; y<rows; y++){
          for (let x=0; x<cols; x++){
            ng[y][x] = (asset.collisionGrid[y] && typeof asset.collisionGrid[y][x] === 'number') ? asset.collisionGrid[y][x] : 0;
          }
        }
        asset.collisionGrid = ng;
      }
    }
  }
  function removeCollisionGrid(asset){
    if ('collisionGrid' in asset) delete asset.collisionGrid;
  }

  let pushTimer = null;
  function pushJSONDebounced(){ clearTimeout(pushTimer); pushTimer = setTimeout(pushJSON, 250); }
  async function pushJSON(){
    try{
      await fetch(API_URL, {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify(state.data)
      });
    }catch(e){ console.error('Persist JSON failed:', e); }
  }

  // Construit une card avec image + overlay + grille cliquable + depthOffset slider
  function buildCard(asset){
    const card = document.createElement('div'); card.className='card';

    // Zone d’aperçu (image + overlays)
    const preview = document.createElement('div'); preview.className='preview';
    const wrap = document.createElement('div'); wrap.className='img-wrap';

    const img = new Image(); img.decoding='async'; img.loading='lazy'; img.alt = asset.name || '';
    img.src = pathForDisplay(asset.imagePath);
    wrap.appendChild(img);

    const overlay = document.createElement('div'); overlay.className='grid32-overlay';
    const canvas  = document.createElement('canvas'); overlay.appendChild(canvas);
    const hit     = document.createElement('div'); hit.className='grid32-hitlayer';

    // Slider vertical depthOffset (à droite)
    const depthWrap = document.createElement('div'); depthWrap.className = 'depth-slider';
    depthWrap.innerHTML = `
      <input class="depth-range" type="range" min="0" max="0" value="0" step="1" aria-label="Depth offset">
      <div class="depth-badge">0</div>
    `;
    const depthInput = depthWrap.querySelector('.depth-range');
    const depthBadge = depthWrap.querySelector('.depth-badge');
    depthInput.classList.add('vertical');                // WebKit/Blink
    depthInput.setAttribute('orient','vertical');        // Firefox

    wrap.appendChild(overlay);
    wrap.appendChild(hit);
    wrap.appendChild(depthWrap);
    preview.appendChild(wrap);
    card.appendChild(preview);

    // Corps de card minimal (titre + switch + alert)
    const body = document.createElement('div'); body.className='body';
    const title = document.createElement('div'); title.innerHTML = `<span class="badge">${asset.name || (asset.imagePath.split('/').pop()||'')}</span>`;
    body.appendChild(title);

    // Switch Floating object
    const floatWrap = document.createElement('label'); floatWrap.className='switch';
    floatWrap.innerHTML = `<input type="checkbox" class="float-switch"><span>Floating object</span>`;
    const floatInput = floatWrap.querySelector('input');
    body.appendChild(floatWrap);

    // Alerte multiples de 32
    const warn = document.createElement('div'); warn.className='warn'; warn.style.display='none';
    warn.textContent = 'Image size is not a multiple of 32px (width/height).';
    body.appendChild(warn);

    card.appendChild(body);

    // Toute la logique est confinée dans ce handler => pas de variable qui s’échappe
    img.addEventListener('load', ()=> {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      const cols = Math.floor(w / 32);
      const rows = Math.floor(h / 32);
      const ok = (w % 32 === 0) && (h % 32 === 0);
      warn.style.display = ok ? 'none' : 'block';

      // ------ Depth slider init ------
      // Slider = 0..hauteur image. Valeur stockée = -sliderValue.
      depthInput.max = String(h);
      if (typeof asset.depthOffset === 'number') {
        const v = Math.max(0, Math.min(h, -asset.depthOffset));
        depthInput.value = String(v);
        depthBadge.textContent = String(-v);
      } else {
        depthInput.value = '0';
        depthBadge.textContent = '0';
      }
      const applyDepth = () => {
        const v = Number(depthInput.value|0);
        depthBadge.textContent = String(-v);
        if (v === 0) {
          if ('depthOffset' in asset) { delete asset.depthOffset; pushJSONDebounced(); }
        } else {
          asset.depthOffset = -v;
          pushJSONDebounced();
        }
      };
      depthInput.addEventListener('input', applyDepth);

      // État initial du switch : coché si pas de collisionGrid
      floatInput.checked = !asset.collisionGrid;

      // Prépare la grille cliquable
      hit.innerHTML = '';
      hit.style.gridTemplateColumns = `repeat(${cols||1}, 1fr)`;
      hit.style.gridTemplateRows    = `repeat(${rows||1}, 1fr)`;
      hit.style.pointerEvents = ok ? 'auto' : 'none';
      floatInput.disabled = !ok;

      // Si non floating et image OK => assure la matrice
      if (!floatInput.checked && ok){
        ensureCollisionGrid(asset, cols, rows);
      }

      // Remplit les cellules selon collisionGrid
      const getVal = (x,y) =>
          (asset.collisionGrid && asset.collisionGrid[y] && typeof asset.collisionGrid[y][x] === 'number')
              ? asset.collisionGrid[y][x] : 0;

      for (let y=0; y<rows; y++){
        for (let x=0; x<cols; x++){
          const cell = document.createElement('div');
          cell.className = 'cell';
          if (ok && getVal(x,y) === 1) cell.classList.add('selected');
          cell.addEventListener('click', (e)=>{
            e.stopPropagation();
            if (!ok) return;

            // 1) si on est "floating", on crée la grille AVANT de lire/écrire
            if (floatInput.checked){
              floatInput.checked = false;
              ensureCollisionGrid(asset, cols, rows);
            }

            // 2) par sécurité, si pour une raison X la grille a été supprimée, on la recrée
            if (!asset.collisionGrid) ensureCollisionGrid(asset, cols, rows);
            if (!asset.collisionGrid[y]) asset.collisionGrid[y] = Array.from({length: cols}, ()=>0);

            const cur  = getVal(x,y);
            const next = cur ? 0 : 1;
            asset.collisionGrid[y][x] = next;
            if (next) cell.classList.add('selected'); else cell.classList.remove('selected');

            // 3) si plus aucune case sélectionnée → on supprime la clé ET on recoche le switch
            const any = asset.collisionGrid && asset.collisionGrid.some(row => row && row.some(v => v === 1));
            if (!any) {
              removeCollisionGrid(asset);
              floatInput.checked = true;                 // ✅ remet en mode "floating"
            }

            pushJSONDebounced();
          });
          hit.appendChild(cell);
        }
      }

      // Dessine le quadrillage exactement à la taille RENDUE
      function layoutOverlay(){
        const rw = img.clientWidth;
        const rh = img.clientHeight;

        overlay.style.width = rw + 'px';
        overlay.style.height = rh + 'px';
        hit.style.width = rw + 'px';
        hit.style.height = rh + 'px';

        // Canvas HiDPI pour traits nets
        const dpr = window.devicePixelRatio || 1;
        canvas.width  = Math.max(1, Math.floor(rw * dpr));
        canvas.height = Math.max(1, Math.floor(rh * dpr));
        canvas.style.width = rw + 'px';
        canvas.style.height = rh + 'px';

        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0,0,rw,rh);
        ctx.strokeStyle = 'rgba(0,0,0,.25)';
        ctx.lineWidth = 1;

        const cellW = rw / (cols||1);
        const cellH = rh / (rows||1);

        // Lignes verticales
        for (let i=0; i<=cols; i++){
          const x = Math.round(i * cellW) + 0.5; // alignement pixel
          ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, rh); ctx.stroke();
        }
        // Lignes horizontales
        for (let j=0; j<=rows; j++){
          const y = Math.round(j * cellH) + 0.5;
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(rw, y); ctx.stroke();
        }

        // Le slider prend EXACTEMENT la hauteur rendue de l'image
        depthWrap.style.height = rh + 'px';
        depthInput.style.height = '100%';
      }

      layoutOverlay();
      // Reste calée si la card se redimensionne
      const ro = new ResizeObserver(()=> layoutOverlay());
      ro.observe(img);

      // Switch "Floating object" => crée/supprime collisionGrid
      floatInput.addEventListener('change', ()=>{
        if (floatInput.checked){
          // flottant : on supprime la grille et la sélection
          removeCollisionGrid(asset);
          $$('.cell', hit).forEach(c=> c.classList.remove('selected'));
        } else if (ok) {
          ensureCollisionGrid(asset, cols, rows);
        }
        pushJSONDebounced();
      });
    });

    img.addEventListener('error', ()=> {
      warn.style.display = 'block';
      warn.textContent = 'Failed to load image.';
    });

    return card;
  }

  async function loadData(){
    const r = await fetch(`${ASSETS_FILE}?t=${Date.now()}`);
    if (!r.ok) throw new Error('assets_list.json not found');
    state.data = await r.json();

    $('#meta')?.replaceChildren(document.createTextNode(`${state.data.collection?.length||0} assets`));

    const grid = $('#cards'); grid.innerHTML='';
    for (const asset of (state.data.collection || [])){
      const card = buildCard(asset);
      grid.appendChild(card);
    }
  }

  document.addEventListener('DOMContentLoaded', loadData);
})();