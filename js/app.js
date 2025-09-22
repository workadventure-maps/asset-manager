import { state } from './state.js';
import { $, $$ } from './utils.js';
import { setupGlobalDropdownCloser } from './dropdowns.js';
import { recalcCountsAndTags } from './data.js';
import { createSimpleTagsInput } from './tags.js';
import { populateFilters, filterAssets, computeFilteredList } from './filters.js'; // ⬅️ import computeFilteredList
import { renderPage, setupInfiniteScroll } from './render.js';
import { setupBulkEditModal } from './bulkEdit.js';
import { showNotification } from './notifications.js';

function updateSelectionButtons(){
    $('#selected-count').textContent = String(state.selected.size);
    $('#deselect-btn').classList.toggle('hidden', state.selected.size === 0);
    $('#validate-btn').classList.toggle('hidden', state.selected.size === 0);
    $('#bulk-edit-btn').classList.toggle('hidden', state.selected.size === 0);
}

// Applique/retire la classe de sélection sur les cartes actuellement visibles
function syncVisibleCardsSelectionStyles(){
    document.querySelectorAll('.asset-card').forEach(card=>{
        const path = card.dataset.imagePath;
        if (state.selected.has(path)){
            card.classList.add('selected','border-green-500','bg-green-50');
        } else {
            card.classList.remove('selected','border-green-500','bg-green-50');
        }
    });
}

async function init(){
    setupGlobalDropdownCloser();

    try {
        const res = await fetch('assets_list.json');
        const data = await res.json();
        state.data = data;

        // titre
        document.title = state.data.collectionName || 'Assets Collection';
        $('#main-title').textContent = document.title;

        // collection name
        const nameInput = $('#collection-name');
        nameInput.value = state.data.collectionName || '';
        nameInput.addEventListener('change', (e)=>{
            state.data.collectionName = e.target.value;
            document.title = state.data.collectionName || 'Assets Collection';
            $('#main-title').textContent = document.title;
        });

        // Global Tags (collection-level only)
        createSimpleTagsInput($('#global-tags-simple'), state.data.tags||[], (tags)=>{
            state.data.tags = tags;
        });

        recalcCountsAndTags();
        populateFilters();

        // search by name (live filter)
        $('#filter-name').addEventListener('input', (e)=>{
            state.filters.name = e.target.value || '';
            filterAssets();
            // Conserver la sélection et resynchroniser le style des cartes visibles
            syncVisibleCardsSelectionStyles();
            updateSelectionButtons();
        });

        // render initial
        state.renderList = state.data.collection.slice();
        renderPage({ reset:true });
        setupInfiniteScroll();

        // === SELECTION CONTROLS (corrigés) ===

        // SELECT ALL : prend TOUT l'ensemble filtré (pas seulement rendu)
        $('#select-all-btn').addEventListener('click', ()=>{
            const allFiltered = computeFilteredList();    // ⬅️ set complet basé sur les filtres en cours
            state.selected = new Set(allFiltered.map(a => a.imagePath));
            syncVisibleCardsSelectionStyles();           // applique le style aux cartes déjà montées
            updateSelectionButtons();
        });

        // DESELECT ALL : vide tout
        $('#deselect-btn').addEventListener('click', ()=>{
            state.selected.clear();
            syncVisibleCardsSelectionStyles();
            updateSelectionButtons();
        });

        setupBulkEditModal();

        // Lorsqu'on scrolle et que de nouvelles cartes se montent,
        // elles se stylent automatiquement car cards.js lit state.selected à la création.
        // En complément, on resynchronise au "scroll" pour couvrir certains cas extrêmes.
        document.addEventListener('scroll', ()=>{
            // petit rafraîchissement opportuniste
            syncVisibleCardsSelectionStyles();
        }, { passive:true });

    } catch (e){
        console.error(e);
        showNotification('error', 'Failed to load assets JSON');
    }
}

document.addEventListener('DOMContentLoaded', init);