import { state, ALL_DIRECTIONS } from './state.js';
import { $, debounce } from './utils.js';
import { buildTagsPicker } from './tags.js';
import { createColorSelect } from './colors.js';
import { recalcCountsAndTags, closestColorFamily } from './data.js';
import { renderPage } from './render.js';

export function computeFilteredList(){
    const q = (state.filters.name||'').toLowerCase();
    const selectedTags = new Set(state.filters.tags||[]);
    const direction = state.filters.direction || '';
    const colorFamily = state.filters.colorFamily || '';

    const wantMissing = {
        tags: !!state.filters.missingTags,
        color: !!state.filters.missingColor,
        direction: !!state.filters.missingDirection,
    };
    const anyMissingFilter = wantMissing.tags || wantMissing.color || wantMissing.direction;

    const out = [];
    for (const asset of state.data.collection){
        const nameOk = !q || (asset.name||'').toLowerCase().includes(q);
        const tagsOk = selectedTags.size === 0 || (Array.isArray(asset.tags) && [...selectedTags].every(t => asset.tags.includes(t)));
        const dirOk = !direction || asset.direction === direction;

        const fam = asset.color ? closestColorFamily(asset.color) : 'transparent';
        const colOk = !colorFamily || fam === colorFamily;

        let missingOk = true;
        if (anyMissingFilter){
            missingOk = false;
            if (wantMissing.tags && (!asset.tags || asset.tags.length === 0)) missingOk = true;
            if (wantMissing.color && (!asset.color || asset.color === '')) missingOk = true;
            if (wantMissing.direction && (!asset.direction || asset.direction === '')) missingOk = true;
        }

        if (nameOk && tagsOk && dirOk && colOk && missingOk) out.push(asset);
    }
    return out;
}

export function filterAssets(){
    state.renderList = computeFilteredList();
    renderPage({ reset:true });
}

export function populateFilters(){
    recalcCountsAndTags();

    // Direction select: No direction (1er), All directions (2e), puis liste
    const sel = $('#filter-direction');
    sel.innerHTML = '';
    const optMissing = document.createElement('option');
    optMissing.value = '__missing__';
    optMissing.textContent = 'No direction';
    sel.appendChild(optMissing);
    const optAll = document.createElement('option');
    optAll.value = '';
    optAll.textContent = 'All directions';
    sel.appendChild(optAll);
    for (const d of ALL_DIRECTIONS){
        const count = state.counts.direction[d]||0;
        const opt = document.createElement('option');
        opt.value = d; opt.textContent = `${d} (${count})`; sel.appendChild(opt);
    }
    sel.addEventListener('change', (e)=>{
        const v = e.target.value || '';
        if (v === '__missing__'){
            state.filters.direction = '';
            state.filters.missingDirection = true;
        } else {
            state.filters.direction = v;
            state.filters.missingDirection = false;
        }
        filterAssets();
    });

    // Tags picker (avec "No tags" + counts)
    buildTagsPicker($('#filter-tags-select'), {
        role:'filter',
        onChange: (tags) => { state.filters.tags = tags; filterAssets(); }
    });

    // Color picker: "No color" en tête
    const colorCtlRoot = $('#filter-color-select');
    createColorSelect(colorCtlRoot, { initialHex:'', allowAll:true, includeNoColor:true, onChange:(value)=>{
            if (value === '__NO_COLOR__'){
                state.filters.colorFamily = '';
                state.filters.missingColor = true;
            } else if (!value){
                state.filters.missingColor = false;
                state.filters.colorFamily = '';
            } else {
                state.filters.missingColor = false;
                state.filters.colorFamily = value; // soit famille choisie, soit hex s'il y en avait un
            }
            filterAssets();
        }});

    // name
    $('#filter-name').addEventListener('input', (e)=>{
        state.filters.name = e.target.value || '';
        debounce(state, 'filter', filterAssets, 150);
    });
}