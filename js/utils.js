export const $  = sel => document.querySelector(sel);
export const $$ = sel => Array.from(document.querySelectorAll(sel));

export function debounce(state, key, fn, delay=150) {
    clearTimeout(state.debounceTimers[key]);
    state.debounceTimers[key] = setTimeout(fn, delay);
}

export function hexToRgb(hex) {
    if (!hex) return null;
    const short = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
    hex = hex.replace(short, (_,r,g,b)=>r+r+g+g+b+b);
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return m ? { r:parseInt(m[1],16), g:parseInt(m[2],16), b:parseInt(m[3],16)} : null;
}

export function formatBytes(bytes, decimals = 2) {
    const n = Number(bytes);
    if (!n || n <= 0) return '';
    const k = 1024, dm = decimals < 0 ? 0 : decimals, sizes = ['Bytes','KB','MB','GB','TB'];
    const i = Math.floor(Math.log(n) / Math.log(k));
    return parseFloat((n / Math.pow(k,i)).toFixed(dm)) + ' ' + sizes[i];
}