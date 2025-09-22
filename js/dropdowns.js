export function setupGlobalDropdownCloser(){
    document.addEventListener('click', (e) => {
        document
            .querySelectorAll('.color-options-list[aria-hidden="false"], .tags-list-container[aria-hidden="false"]')
            .forEach(p=>{
                const path = e.composedPath ? e.composedPath() : [];
                // si on clique dans le panneau ou sur son bouton d'ouverture, ne pas fermer ici
                if (path.includes(p) || (p.previousElementSibling && path.includes(p.previousElementSibling))) return;
                p.setAttribute('aria-hidden','true');
                p.classList.add('hidden');
                const parentSelect = p.closest('[data-component="color-select"]');
                if (parentSelect) parentSelect.setAttribute('aria-expanded','false');
            });
    }, { capture:true });
}

export function togglePanel(panel, ownerSelect){
    const opened = panel.getAttribute('aria-hidden') === 'false';
    // Fermer les autres panneaux
    document.querySelectorAll('.color-options-list, .tags-list-container').forEach(p=>{
        if (p !== panel){
            p.setAttribute('aria-hidden','true');
            p.classList.add('hidden');
            const parent = p.closest('[data-component="color-select"]');
            if (parent) parent.setAttribute('aria-expanded','false');
        }
    });
    // Toggle du panneau courant
    if (ownerSelect) ownerSelect.setAttribute('aria-expanded', opened ? 'false' : 'true');
    panel.setAttribute('aria-hidden', opened ? 'true' : 'false');
    panel.classList.toggle('hidden', opened); // ouvert => visible, fermé => hidden
}

export function makePanelInteractive(panel){
    // État initial : caché
    panel.setAttribute('aria-hidden','true');
    panel.classList.add('hidden');
}