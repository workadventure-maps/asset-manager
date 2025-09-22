import { state, COLOR_FAMILIES, ALL_DIRECTIONS } from './state.js';

export function closestColorFamily(hex) {
    if (!hex) return 'transparent';
    if (hex === 'transparent') return 'transparent';
    const toRgb = (h) => {
        const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(h);
        return m ? { r:parseInt(m[1],16), g:parseInt(m[2],16), b:parseInt(m[3],16)} : null;
    };
    const rgb = toRgb(hex); if (!rgb) return "unknown";
    let min = Infinity, best = "unknown";
    for (const [name, hex2] of Object.entries(COLOR_FAMILIES)){
        const c = toRgb(hex2); if (!c) continue;
        const d = (rgb.r-c.r)**2 + (rgb.g-c.g)**2 + (rgb.b-c.b)**2;
        if (d < min){ min = d; best = name; }
    }
    return best;
}

export function recalcCountsAndTags(){
    const tagsCount = {};
    const dirCount = {};
    const colCount = { transparent: 0 };
    const jsonTags = new Set();

    for (const a of state.data.collection){
        (a.tags||[]).forEach(t=>{
            tagsCount[t] = (tagsCount[t]||0)+1;
            jsonTags.add(t);
        });
        const d = (a.direction||'').trim();
        if (ALL_DIRECTIONS.includes(d)) dirCount[d] = (dirCount[d]||0)+1;
        const fam = a.color ? closestColorFamily(a.color) : 'transparent';
        colCount[fam] = (colCount[fam]||0)+1;
    }

    state.availableTags = [...new Set([...jsonTags])].sort(); // pas d’auto-merge avec tags de collection
    state.counts = { tags:tagsCount, direction:dirCount, color:colCount };
}

export function pushJSON(){
    fetch('http://localhost:8000', {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify(state.data)
    }).catch(()=>{});
}