import { $ } from './utils.js';

function escapeHtml(str){
    return String(str).replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
}

export function showNotification(type, message){
    const container = $('#notifications');
    if (!container) return;
    const toast = document.createElement('div');
    const tone = type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
        : type === 'error'   ? 'border-rose-200 bg-rose-50 text-rose-900'
            : 'border-gray-200 bg-white text-gray-900';
    toast.className = `rounded-lg shadow border px-3 py-2 flex items-start gap-2 ${tone}`;
    toast.innerHTML = `
    <span class="select-none">${ type==='success' ? '✅' : type==='error' ? '⚠️' : 'ℹ️' }</span>
    <div class="text-sm">${escapeHtml(message)}</div>
    <button class="ml-2 text-xs text-gray-500 hover:text-gray-700">Close</button>
  `;
    function dismiss(){ toast.style.opacity = '0'; setTimeout(()=> toast.remove(), 180); }
    toast.querySelector('button')?.addEventListener('click', dismiss);
    container.appendChild(toast);
    setTimeout(dismiss, 3000);
}