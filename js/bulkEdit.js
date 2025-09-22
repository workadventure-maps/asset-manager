import { state } from './state.js';
import { $, $$ } from './utils.js';
import { createColorSelect } from './colors.js';
import { buildTagsPicker } from './tags.js';
import { recalcCountsAndTags, pushJSON } from './data.js';
import { showNotification } from './notifications.js';

export function setupBulkEditModal(){
    const modal = $('#bulkEditModal');
    const closeBtn = $('#close-modal-btn');
    const saveBtn = $('#save-bulk-btn');
    const modalTitle = $('#bulkEditTitle');

    function open(){
        modal.setAttribute('aria-hidden','false');
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        modal.querySelector('.modal-content').focus?.();
        modalTitle.textContent = `Edit ${state.selected.size} Assets`;
        $('#modal-name').value = '';
        $('#modal-direction').value = '';
        const colorCtl = createColorSelect($('#modal-color-select'), { initialHex:'', allowAll:false, onChange:()=>{} });
        colorCtl.setValue('', 'Leave unchanged', { silent:true });
    }
    function close(){
        modal.setAttribute('aria-hidden','true');
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }

    $('#bulk-edit-btn').addEventListener('click', open);
    modal.addEventListener('keydown', (e)=>{ if(e.key==='Escape') close(); });
    modal.addEventListener('click', (e)=>{ if(e.target === modal) close(); });

    closeBtn.addEventListener('click', close);

    saveBtn.addEventListener('click', ()=>{
        const selected = $$('.asset-card.selected');
        const newName = $('#modal-name').value.trim();
        const newTags = Array.from($('#modal-tags-select .tags-input-container .tag-pill')).map(p=>p.dataset.value || p.textContent.trim());
        const newDir = $('#modal-direction').value;
        const newColor = $('#modal-color-select').dataset.hex || '';
        if (!selected.length) return close();
        if (!confirm(`Are you sure you want to edit ${selected.length} assets?`)) return;

        const items = [];
        selected.forEach(card=>{
            const path = card.dataset.imagePath;
            const asset = state.data.collection.find(a=>a.imagePath===path);
            if (!asset) return;
            if (newName) asset.name = newName;
            if (newTags.length) asset.tags = newTags;
            if (newDir) asset.direction = newDir;
            if (newColor){ asset.color = (newColor==='transparent') ? '' : newColor; }
            items.push(asset);
        });

        recalcCountsAndTags();
        pushJSON();
        close();
        showNotification('success', `Updated ${items.length} asset(s)`);
    });

    buildTagsPicker($('#modal-tags-select'), { role:'modal', onChange:()=>{} });
}