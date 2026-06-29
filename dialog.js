/* dialog.js — elegant replacements for alert / confirm / prompt */
(() => {
  const style = document.createElement('style');
  style.textContent = `
    .dlg-backdrop{
      position:fixed;inset:0;z-index:9000;
      background:rgba(17,24,39,.45);backdrop-filter:blur(2px);
      display:flex;align-items:center;justify-content:center;
      opacity:0;transition:opacity .15s ease;
    }
    .dlg-backdrop.dlg-visible{opacity:1}
    .dlg-box{
      background:#fff;border:1px solid #e5e8f0;border-radius:16px;
      box-shadow:0 24px 60px rgba(16,24,40,.22);
      padding:24px;width:90%;max-width:420px;
      transform:translateY(10px) scale(.97);transition:transform .15s ease,opacity .15s ease;
      opacity:0;
    }
    .dlg-backdrop.dlg-visible .dlg-box{transform:translateY(0) scale(1);opacity:1}
    .dlg-icon{font-size:1.6rem;margin-bottom:8px;line-height:1}
    .dlg-title{font-size:1rem;font-weight:700;color:#1f2430;margin:0 0 6px}
    .dlg-msg{font-size:.9rem;color:#4b5160;line-height:1.55;margin:0 0 20px;white-space:pre-wrap}
    .dlg-input{
      width:100%;padding:9px 12px;font-size:.9rem;
      border:1px solid #d3d8e4;border-radius:8px;outline:none;
      margin-bottom:16px;box-sizing:border-box;
      transition:border-color .15s,box-shadow .15s;
    }
    .dlg-input:focus{border-color:#4f46e5;box-shadow:0 0 0 3px rgba(79,70,229,.18)}
    .dlg-actions{display:flex;justify-content:flex-end;gap:8px}
    .dlg-btn{
      appearance:none;border-radius:8px;padding:8px 18px;
      font-size:.88rem;font-weight:600;cursor:pointer;border:1px solid #d3d8e4;
      background:#f7f8fb;color:#1f2430;transition:background .12s,border-color .12s;
    }
    .dlg-btn:hover{background:#eef0f5;border-color:#c5cad6}
    .dlg-btn.dlg-primary{background:#4f46e5;color:#fff;border-color:#4f46e5}
    .dlg-btn.dlg-primary:hover{background:#4338ca;border-color:#4338ca}
    .dlg-btn.dlg-danger{background:#dc2626;color:#fff;border-color:#dc2626}
    .dlg-btn.dlg-danger:hover{background:#b91c1c;border-color:#b91c1c}
  `;
  document.head.appendChild(style);

  function makeBackdrop(){
    const bd = document.createElement('div');
    bd.className = 'dlg-backdrop';
    document.body.appendChild(bd);
    requestAnimationFrame(() => bd.classList.add('dlg-visible'));
    return bd;
  }

  function close(bd){
    bd.classList.remove('dlg-visible');
    bd.addEventListener('transitionend', () => bd.remove(), { once: true });
  }

  const ICONS = { info: 'ℹ️', success: '✅', error: '❌', warning: '⚠️', confirm: '💬', prompt: '✏️' };

  /* ── alert ──────────────────────────────────────────────────────────── */
  function dlgAlert(message, { title = '', type = 'info' } = {}){
    return new Promise(resolve => {
      const bd = makeBackdrop();
      bd.innerHTML = `
        <div class="dlg-box" role="alertdialog" aria-modal="true">
          <div class="dlg-icon">${ICONS[type] || ICONS.info}</div>
          ${title ? `<p class="dlg-title">${title}</p>` : ''}
          <p class="dlg-msg">${message}</p>
          <div class="dlg-actions">
            <button class="dlg-btn dlg-primary" id="dlg-ok">OK</button>
          </div>
        </div>`;
      const ok = bd.querySelector('#dlg-ok');
      ok.focus();
      const done = () => { close(bd); resolve(); };
      ok.addEventListener('click', done);
      bd.addEventListener('keydown', e => { if (e.key === 'Escape' || e.key === 'Enter') done(); });
    });
  }

  /* ── confirm ─────────────────────────────────────────────────────────── */
  function dlgConfirm(message, { title = '', confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false } = {}){
    return new Promise(resolve => {
      const bd = makeBackdrop();
      bd.innerHTML = `
        <div class="dlg-box" role="dialog" aria-modal="true">
          <div class="dlg-icon">${ICONS.confirm}</div>
          ${title ? `<p class="dlg-title">${title}</p>` : ''}
          <p class="dlg-msg">${message}</p>
          <div class="dlg-actions">
            <button class="dlg-btn" id="dlg-cancel">${cancelLabel}</button>
            <button class="dlg-btn ${danger ? 'dlg-danger' : 'dlg-primary'}" id="dlg-ok">${confirmLabel}</button>
          </div>
        </div>`;
      const ok     = bd.querySelector('#dlg-ok');
      const cancel = bd.querySelector('#dlg-cancel');
      ok.focus();
      const done = v => { close(bd); resolve(v); };
      ok.addEventListener('click',     () => done(true));
      cancel.addEventListener('click', () => done(false));
      bd.addEventListener('keydown', e => {
        if (e.key === 'Escape') done(false);
        if (e.key === 'Enter')  done(true);
      });
    });
  }

  /* ── prompt ──────────────────────────────────────────────────────────── */
  function dlgPrompt(message, { title = '', defaultValue = '', placeholder = '' } = {}){
    return new Promise(resolve => {
      const bd = makeBackdrop();
      bd.innerHTML = `
        <div class="dlg-box" role="dialog" aria-modal="true">
          <div class="dlg-icon">${ICONS.prompt}</div>
          ${title ? `<p class="dlg-title">${title}</p>` : ''}
          <p class="dlg-msg">${message}</p>
          <input class="dlg-input" id="dlg-input" type="text" value="${defaultValue.replace(/"/g,'&quot;')}" placeholder="${placeholder}">
          <div class="dlg-actions">
            <button class="dlg-btn" id="dlg-cancel">Cancel</button>
            <button class="dlg-btn dlg-primary" id="dlg-ok">OK</button>
          </div>
        </div>`;
      const input  = bd.querySelector('#dlg-input');
      const ok     = bd.querySelector('#dlg-ok');
      const cancel = bd.querySelector('#dlg-cancel');
      input.focus();
      input.select();
      const done = v => { close(bd); resolve(v); };
      ok.addEventListener('click',     () => done(input.value));
      cancel.addEventListener('click', () => done(null));
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter')  { e.preventDefault(); done(input.value); }
        if (e.key === 'Escape') done(null);
      });
      bd.addEventListener('keydown', e => { if (e.key === 'Escape') done(null); });
    });
  }

  window.Dialog = { alert: dlgAlert, confirm: dlgConfirm, prompt: dlgPrompt };
})();
