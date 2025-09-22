import { closestColorFamily } from './data.js';
import { state, COLOR_FAMILIES } from './state.js';
import { makePanelInteractive, togglePanel } from './dropdowns.js';

export function createColorSelect(
    root,
    {
        initialHex = '',
        allowAll = false,          // true = Filtre ; false = Card
        onChange,
        showCounts = true,
        includeNoColor = false
    }
){
    const display = root.querySelector('.selected-color-display');
    const panel   = root.querySelector('.color-options-list');
    const swatch  = root.querySelector('.color-swatch');
    const nameEl  = root.querySelector('.color-name');
    const hexEl   = root.querySelector('.color-hex');

    makePanelInteractive(panel); // aria-hidden + hidden

    /** Màj de l’entête (au-dessus de la liste) */
    function setValue(hex, name, { silent=false } = {}){
        if (hex === 'transparent') {
            swatch.style.background = 'transparent';
            swatch.style.outline = '1px dashed #999';
            nameEl.textContent = name || 'Transparent';
            hexEl.textContent = '';
            root.dataset.hex = 'transparent';
        } else if (hex) {
            swatch.style.background = hex;
            swatch.style.outline = '';
            nameEl.textContent = name || closestColorFamily(hex);
            hexEl.textContent = String(hex).toUpperCase();
            root.dataset.hex = hex;
        } else {
            swatch.style.background = '';
            swatch.style.outline = '';
            nameEl.textContent = name || (allowAll ? 'All Colors' : 'Leave unchanged');
            hexEl.textContent = '';
            root.dataset.hex = '';
        }
        if (!silent && typeof onChange === 'function') onChange(root.dataset.hex);
    }

    function makeRowContainer(){
        const row = document.createElement('div');
        row.className = 'flex items-center gap-2 px-3 py-2 hover:bg-gray-50 cursor-pointer text-sm';
        return row;
    }
    function makeSwatch({ hex, transparent=false }){
        const box = document.createElement('div');
        box.className = 'h-5 w-5 rounded border border-gray-300';
        if (transparent){
            box.style.background = 'transparent';
            box.classList.add('border-dashed');
        } else if (hex){
            box.style.background = hex;
        }
        return box;
    }
    function makeRight(bits){
        const right = document.createElement('span');
        right.className = 'ml-auto flex items-center gap-2';
        bits.filter(Boolean).forEach(b => right.appendChild(b));
        return right;
    }
    function makeText(txt, cls=''){
        const span = document.createElement('span');
        if (cls) span.className = cls;
        span.textContent = txt;
        return span;
    }

    function addRow({ hex, label, count, isTransparent=false, showHex=true, onPick }){
        const row = makeRowContainer();
        const s   = makeSwatch({ hex, transparent:isTransparent });
        const lab = makeText(label);
        const rbits = [];
        if (showHex && hex && !isTransparent) rbits.push(makeText(String(hex).toUpperCase(), 'text-xs text-gray-500'));
        if (typeof count === 'number')        rbits.push(makeText(String(count), 'text-xs text-gray-500'));
        row.appendChild(s);
        row.appendChild(lab);
        row.appendChild(makeRight(rbits));
        row.addEventListener('click', (e)=>{ e.stopPropagation(); onPick?.(); });
        panel.appendChild(row);
    }

    function buildOptions(){
        if (!panel) return;
        panel.innerHTML = '';

        // Filtre : "No color"
        if (allowAll && includeNoColor){
            addRow({
                hex: '',
                label: 'No color',
                isTransparent: true,
                showHex: false,
                onPick: ()=>{
                    root.dataset.special = 'no-color';
                    setValue('', 'No color');
                    togglePanel(panel, root);
                    onChange?.('__NO_COLOR__');
                }
            });
        }

        // Filtre : "All Colors"
        if (allowAll){
            const countAll = Object.values(state.counts.color).reduce((a,b)=>a+b,0);
            addRow({
                hex: '#f5f5f5',
                label: 'All Colors',
                count: countAll,
                showHex: false,
                onPick: ()=>{
                    root.dataset.special = '';
                    setValue('', 'All Colors');
                    togglePanel(panel, root);
                }
            });
        }

        // Transparent
        addRow({
            hex: '',
            label: 'Transparent',
            count: state.counts.color['transparent'] || 0,
            isTransparent: true,
            showHex: false,
            onPick: ()=>{
                root.dataset.special = '';
                setValue('transparent', 'Transparent');
                togglePanel(panel, root);
            }
        });

        // Familles : carré rempli + nom + hexa + (count)
        const familiesFromCounts = Object.keys(state.counts.color).filter(k=>k!=='transparent');
        const allFamilies = [...new Set([...familiesFromCounts, ...Object.keys(COLOR_FAMILIES)])];

        allFamilies.forEach(fam=>{
            const hex = COLOR_FAMILIES[fam];
            if (!hex) return; // sécurité
            const count = state.counts.color[fam] || 0;

            addRow({
                hex,
                label: fam,
                count,
                showHex: true,
                onPick: ()=>{
                    root.dataset.special = '';
                    if (allowAll){
                        // Filtre : visuel = hex, valeur = "famille"
                        setValue(hex, fam);
                        togglePanel(panel, root);
                        onChange?.(fam);
                    } else {
                        // Card : visuel + storage = hex
                        setValue(hex, fam);
                        togglePanel(panel, root);
                        onChange?.(hex);
                    }
                }
            });
        });
    }

// Build + initial
    buildOptions();

// Initial: si on nous passe une famille -> afficher sa couleur + le nom
    const initialIsFamily = initialHex && !String(initialHex).startsWith('#') && COLOR_FAMILIES[initialHex];

    if (initialIsFamily) {
        // ex: "red" -> swatch rouge, libellé "red"
        setValue(COLOR_FAMILIES[initialHex], initialHex, { silent:true });
    } else if (initialHex && String(initialHex).startsWith('#')) {
        // ex: "#FF0000" -> swatch rouge, libellé = famille "red" (au lieu de "Selected")
        const fam = closestColorFamily(initialHex) || 'Selected';
        setValue(initialHex, fam, { silent:true });
    } else {
        // état neutre
        setValue('', allowAll ? 'All Colors' : 'Leave unchanged', { silent:true });
    }
    // Interactions
    display?.addEventListener('click', (e)=>{ e.stopPropagation(); togglePanel(panel, root); });
    display?.addEventListener('keydown', (e)=>{ if (e.key==='Enter'||e.key===' ') { e.preventDefault(); togglePanel(panel, root); } });
    panel?.addEventListener('click', (e)=> e.stopPropagation());

    return { setValue };
}