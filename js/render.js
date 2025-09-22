import { state } from './state.js';
import { $ } from './utils.js';
import { buildAssetCard } from './cards.js';

export function renderPage({ reset=false } = {}){
    const cont = $('#container');
    if (reset){
        cont.innerHTML = '';
        state.page = 0;
    }
    const start = state.page * state.pageSize;
    const slice = state.renderList.slice(start, start + state.pageSize);
    const frag = document.createDocumentFragment();
    slice.forEach(a => frag.appendChild(buildAssetCard(a)));
    cont.appendChild(frag);
    $('#assets-count-title').textContent = `(${state.renderList.length})`;
}

export function setupInfiniteScroll(){
    const observer = new IntersectionObserver(entries=>{
        if (entries.some(e=> e.isIntersecting)){
            if ((state.page+1)*state.pageSize < state.renderList.length){
                state.page++;
                renderPage();
            }
        }
    });
    observer.observe(document.body);
}