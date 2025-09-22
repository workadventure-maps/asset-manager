import { state } from './state.js';
import { togglePanel } from './dropdowns.js';

function pillHtml(text){
    return `
    <span class="inline-flex items-center gap-1 rounded-full border border-gray-300 bg-gray-50 px-2 py-0.5 text-xs text-gray-700">
      ${text}
      <button class="ml-1 text-gray-500 hover:text-gray-700" aria-label="Remove">×</button>
    </span>
  `;
}

export function createSimpleTagsInput(root, initial, onChange){
    function add(valueRaw){
        const value = String(valueRaw||'').trim();
        if (!value) return;
        const existing = Array.from(root.querySelectorAll('.tag-pill')).map(p=>p.dataset.value);
        if (existing.includes(value)) return;
        const wrapper = document.createElement('span');
        wrapper.className = 'tag-pill';
        wrapper.dataset.value = value;
        wrapper.innerHTML = pillHtml(value);
        wrapper.querySelector('button').addEventListener('click',()=>{ wrapper.remove(); onChange?.(current()); });
        root.insertBefore(wrapper, root.querySelector('input'));
        onChange?.(current());
    }
    function current(){ return Array.from(root.querySelectorAll('.tag-pill')).map(p=>p.dataset.value); }
    const input = root.querySelector('input');
    (initial||[]).forEach(add);
    input.addEventListener('keydown', (e)=>{
        if (e.key==='Enter' || e.key===','){ e.preventDefault(); input.value.split(',').forEach(add); input.value=''; }
    });
    input.addEventListener('blur', ()=>{ if (input.value.trim()){ input.value.split(',').forEach(add); input.value=''; } });
    root._simpleTagsCtl = { add, current, setAll: (arr)=>{ root.querySelectorAll('.tag-pill').forEach(p=>p.remove()); (arr||[]).forEach(v=>add(v)); } };
    return root._simpleTagsCtl;
}

export function buildTagsPicker(root, { role='filter', onChange }){
    const container = root.querySelector('.tags-input-container');
    const listPanel = root.querySelector('.tags-list-container');
    const input = container.querySelector('input');

    listPanel?.setAttribute('aria-hidden','true');
    listPanel?.classList.add('hidden');

    function row(label, count){
        const el = document.createElement('div');
        el.className = 'flex items-center gap-2 px-3 py-2 hover:bg-gray-50 cursor-pointer text-sm';
        el.innerHTML = `
      <span>${label}</span>
      ${typeof count === 'number' ? `<span class="ml-auto text-xs text-gray-500">(${count})</span>` : ''}
    `;
        return el;
    }

    function renderList(){
        if (!listPanel) return;
        listPanel.innerHTML = '';

        if (role === 'filter'){
            const rowMissing = row('No tags');
            rowMissing.addEventListener('click', ()=>{
                const pills = Array.from(container.querySelectorAll('.tag-pill'));
                const hasMissing = pills.some(p => p.dataset?.special === 'no-tags');
                if (hasMissing){
                    pills.filter(p => p.dataset?.special === 'no-tags').forEach(p=>p.remove());
                    state.filters.missingTags = false;
                } else {
                    const wrapper = document.createElement('span');
                    wrapper.className = 'tag-pill';
                    wrapper.dataset.special = 'no-tags';
                    wrapper.innerHTML = pillHtml('No tags');
                    wrapper.querySelector('button').addEventListener('click',()=>{
                        wrapper.remove(); state.filters.missingTags = false;
                        onChange(Array.from(container.querySelectorAll('.tag-pill')).filter(p=>!p.dataset.special).map(p=>p.dataset.value || p.textContent.trim()));
                    });
                    container.insertBefore(wrapper, input);
                    state.filters.missingTags = true;
                }
                onChange(Array.from(container.querySelectorAll('.tag-pill')).filter(p=>!p.dataset.special).map(p=>p.dataset.value || p.textContent.trim()));
                togglePanel(listPanel, root.closest('[data-component="tags-input"]'));
            });
            listPanel.appendChild(rowMissing);
        }

        state.availableTags.forEach(tag=>{
            const count = state.counts.tags[tag] || 0;
            const r = row(tag, count);
            r.addEventListener('click',()=>{
                const existing = Array.from(container.querySelectorAll('.tag-pill')).map(p=>p.dataset.value || p.textContent.trim());
                if (!existing.includes(tag)){
                    const wrapper = document.createElement('span');
                    wrapper.className = 'tag-pill';
                    wrapper.dataset.value = tag;
                    wrapper.innerHTML = pillHtml(tag);
                    wrapper.querySelector('button').addEventListener('click',()=>{
                        wrapper.remove();
                        onChange(Array.from(container.querySelectorAll('.tag-pill')).map(p=>p.dataset.value || p.textContent.trim()));
                    });
                    container.insertBefore(wrapper, input);
                    onChange(Array.from(container.querySelectorAll('.tag-pill')).map(p=>p.dataset.value || p.textContent.trim()));
                }
                togglePanel(listPanel, root.closest('[data-component="tags-input"]'));
            });
            listPanel.appendChild(r);
        });
    }
    renderList();

    input.addEventListener('focus', ()=> togglePanel(listPanel, root.closest('[data-component="tags-input"]')));
    input.addEventListener('keydown', (e)=>{
        if (e.key==='Enter' && input.value.trim()){
            const v = input.value.trim();
            const wrapper = document.createElement('span');
            wrapper.className = 'tag-pill';
            wrapper.dataset.value = v;
            wrapper.innerHTML = pillHtml(v);
            wrapper.querySelector('button').addEventListener('click',()=>{
                wrapper.remove();
                onChange(Array.from(container.querySelectorAll('.tag-pill')).map(p=>p.dataset.value || p.textContent.trim()));
            });
            container.insertBefore(wrapper, input);
            input.value = '';
            onChange(Array.from(container.querySelectorAll('.tag-pill')).map(p=>p.dataset.value || p.textContent.trim()));
        }
    });

    root.addEventListener('click', (e)=>{ e.stopPropagation(); togglePanel(listPanel, root.closest('[data-component="tags-input"]')); });

    return {
        setTags: (tags=[])=>{
            container.querySelectorAll('.tag-pill').forEach(p=>p.remove());
            tags.forEach(t=>{
                const wrapper = document.createElement('span');
                wrapper.className = 'tag-pill';
                wrapper.dataset.value = t;
                wrapper.innerHTML = pillHtml(t);
                wrapper.querySelector('button').addEventListener('click',()=>{
                    wrapper.remove();
                    onChange(Array.from(container.querySelectorAll('.tag-pill')).map(p=>p.dataset.value || p.textContent.trim()));
                });
                container.insertBefore(wrapper, input);
            });
        },
        current: () => Array.from(container.querySelectorAll('.tag-pill')).map(p=>p.dataset.value || p.textContent.trim())
    };
}

/* ---------- NOUVEAU : Multi-category picker (pills + légendes) ---------- */
export function buildCategoryPicker(root, { options=[], values=[], label='Pick category…', onChange }){
    // Structure DOM attendue dans root :
    // <div class="category-select">
    //   <div class="tags-input-container" data-component="tags-input">
    //     <input type="text" placeholder="..." readonly />
    //   </div>
    //   <div class="tags-list-container hidden" aria-hidden="true"></div>
    // </div>
    const container = root.querySelector('.tags-input-container');
    const listPanel = root.querySelector('.tags-list-container');
    const input = container.querySelector('input');

    // pas de saisie libre
    input.setAttribute('readonly', 'readonly');
    input.classList.add('cursor-pointer');
    input.placeholder = label || 'Pick category…';

    listPanel?.setAttribute('aria-hidden','true');
    listPanel?.classList.add('hidden');

    function currentValues(){
        return Array.from(container.querySelectorAll('.tag-pill')).map(p=>p.dataset.value);
    }
    function addPill(v){
        const existing = currentValues();
        if (existing.includes(v)) return;
        const wrapper = document.createElement('span');
        wrapper.className = 'tag-pill';
        wrapper.dataset.value = v;
        wrapper.innerHTML = pillHtml(v);
        wrapper.querySelector('button').addEventListener('click',()=>{
            wrapper.remove();
            onChange?.(currentValues());
        });
        container.insertBefore(wrapper, input);
        onChange?.(currentValues());
    }

    function renderList(){
        if (!listPanel) return;
        listPanel.innerHTML = '';

        // Option "No category" => clear all
        const clearRow = document.createElement('div');
        clearRow.className = 'px-3 py-2 hover:bg-gray-50 cursor-pointer text-sm';
        clearRow.innerHTML = `<div class="font-medium">No category</div>`;
        clearRow.addEventListener('click', ()=>{
            container.querySelectorAll('.tag-pill').forEach(p=>p.remove());
            onChange?.([]);
            togglePanel(listPanel, root.closest('[data-component="tags-input"]'));
        });
        listPanel.appendChild(clearRow);

        // options avec légende
        options.forEach(opt=>{
            const row = document.createElement('div');
            row.className = 'px-3 py-2 hover:bg-gray-50 cursor-pointer';
            row.innerHTML = `
        <div class="text-sm">${opt.label}</div>
        <div class="text-xs text-gray-500 mt-0.5">${opt.hint || ''}</div>
      `;
            row.addEventListener('click', ()=>{
                addPill(opt.label);
                togglePanel(listPanel, root.closest('[data-component="tags-input"]'));
            });
            listPanel.appendChild(row);
        });
    }
    renderList();

    // init values
    (values||[]).forEach(v => addPill(v));

    input.addEventListener('focus', ()=> togglePanel(listPanel, root.closest('[data-component="tags-input"]')));
    root.addEventListener('click', (e)=>{ e.stopPropagation(); togglePanel(listPanel, root.closest('[data-component="tags-input"]')); });

    return {
        setValues: (arr=[])=>{
            container.querySelectorAll('.tag-pill').forEach(p=>p.remove());
            (arr||[]).forEach(v=> addPill(v));
        },
        current: currentValues
    };
}