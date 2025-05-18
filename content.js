console.log("CSRF Defender content script loaded");

// 1) Інжектимо файл page_inject.js у DOM сторінки,
//    щоб виконатись у «page context» і обійти CSP.
(function(){
  const s = document.createElement('script');
  s.src = chrome.runtime.getURL('page_inject.js');
  (document.head || document.documentElement).appendChild(s);
  s.onload = () => s.remove();
})();

// 2) Інжекція CSRF-токена у всі <form> 
function generateToken(len = 32) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: len })
    .map(() => chars[Math.floor(Math.random() * chars.length)])
    .join('');
}
function ensureCSRFToken() {
  document.querySelectorAll('form').forEach(form => {
    let inp = form.querySelector('input[name="csrf-token"]');
    if (!inp) {
      inp = document.createElement('input');
      inp.type  = 'hidden';
      inp.name  = 'csrf-token';
      inp.value = generateToken();
      form.prepend(inp);
    }
  });
}
document.addEventListener('submit', e => {
  const form = e.target;
  if (!(form instanceof HTMLFormElement)) return;
  ensureCSRFToken();
  const dest = new URL(form.action || location.href).origin;
  if (dest !== location.origin) {
    e.preventDefault();
    console.log("CSRF Defender → intercept form submit to", dest);
    const allow = confirm(
      `⚠️ CSRF Defender:\nФорма відправляється на ${dest} (інший домен).\nПродовжити?`
    );
    window.postMessage({ source:'csrf-defender', url: form.action||location.href, allowed: allow }, '*');
    if (allow) form.submit();
  }
}, true);

// 3) Ловимо відповіді із page_inject.js
window.addEventListener('message', event => {
  if (event.source !== window || event.data.source!=='csrf-defender') return;
  chrome.runtime.sendMessage({
    type: 'CSRF_WARN',
    url:  event.data.url,
    level: event.data.allowed ? 'yellow' : 'red'
  });
});
