// content.js

console.log("CSRF Defender content script loaded");

// 1) Інжекція CSRF-токена у всі форми
function generateToken(len = 32) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: len })
    .map(() => chars[Math.floor(Math.random() * chars.length)])
    .join('');
}
function ensureCSRFToken() {
  document.querySelectorAll('form').forEach(form => {
    let inp = form.querySelector('input[name=\"csrf-token\"]');
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
  const destOrigin = new URL(form.action || location.href).origin;
  if (destOrigin !== location.origin) {
    e.preventDefault();
    const msg = `Форма відправляється на ${destOrigin}. Можлива CSRF-атака.\nПродовжити?`;
    const allowed = confirm(msg);
    window.postMessage({ type:'CSRF_DECISION', url: form.action || location.href, allowed }, '*');
    if (allowed) form.submit();
  }
}, true);

// 2) Інжекція коду в контекст сторінки для перехоплення fetch/XHR
(function(){
  function overrideCSRF() {
    // переозначуємо fetch
    const origFetch = window.fetch;
    window.fetch = async function(input, init = {}) {
      const url = typeof input === 'string' ? input : input.url;
      const destOrigin = new URL(url, location.href).origin;
      if (destOrigin !== location.origin) {
        const msg = `Fetch до ${destOrigin} без CSRF-токена. Можлива CSRF-атака.\nПродовжити?`;
        const allowed = confirm(msg);
        window.postMessage({ type:'CSRF_DECISION', url, allowed }, '*');
        if (!allowed) {
          return Promise.reject(new Error('CSRF fetch blocked'));
        }
      }
      return origFetch(input, init);
    };

    // переозначуємо XHR
    const origOpen = window.XMLHttpRequest.prototype.open;
    window.XMLHttpRequest.prototype.open = function(method, url) {
      this._csrf_dest = new URL(url, location.href).origin;
      return origOpen.apply(this, arguments);
    };
    const origSend = window.XMLHttpRequest.prototype.send;
    window.XMLHttpRequest.prototype.send = function(body) {
      const destOrigin = this._csrf_dest;
      if (destOrigin && destOrigin !== location.origin) {
        const msg = `XHR до ${destOrigin} без CSRF-токена. Можлива CSRF-атака.\nПродовжити?`;
        const allowed = confirm(msg);
        window.postMessage({ type:'CSRF_DECISION', url: destOrigin, allowed }, '*');
        if (!allowed) {
          return this.abort();
        }
      }
      return origSend.apply(this, arguments);
    };
  }

  // Інжектимо скрипт у сторінку
  const script = document.createElement('script');
  script.textContent = `(${overrideCSRF.toString()})();`;
  (document.head||document.documentElement).appendChild(script);
  script.remove();
})();

// 3) Збираємо рішення confirm та шлемо в background
window.addEventListener('message', event => {
  if (event.source !== window || !event.data || event.data.type !== 'CSRF_DECISION') return;
  chrome.runtime.sendMessage({
    type:  'CSRF_WARN',
    url:   event.data.url,
    level: event.data.allowed ? 'yellow' : 'red'
  });
});
