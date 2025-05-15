// content.js
console.log("CSRF Defender content script loaded");

// 1) Інжекція захисного коду в сторінку:
(function(){
  const pageCode = `
    console.log("CSRF Defender → page context override loaded");
    (function(){
      // --- Fetch override ---
      const origFetch = window.fetch;
      window.fetch = function(input, init = {}) {
        const url = typeof input === 'string' ? input : input.url;
        const destOrigin = new URL(url, location.href).origin;
        if (destOrigin !== location.origin) {
          console.log("CSRF Defender → intercept fetch to", url);
          const allowed = confirm(
            "⚠️ CSRF Defender warning:\\nFetch до " + url +
            "\\nМожлива CSRF-атака. Продовжити?"
          );
          window.postMessage({ source: "csrf-defender", url, allowed }, "*");
          if (!allowed) {
            return Promise.reject(new Error("CSRF fetch blocked"));
          }
        }
        return origFetch.apply(this, arguments);
      };

      // --- XHR override ---
      const origOpen = window.XMLHttpRequest.prototype.open;
      window.XMLHttpRequest.prototype.open = function(method, url) {
        this._csrfDest = new URL(url, location.href).origin;
        return origOpen.apply(this, arguments);
      };
      const origSend = window.XMLHttpRequest.prototype.send;
      window.XMLHttpRequest.prototype.send = function(body) {
        const destOrigin = this._csrfDest;
        if (destOrigin && destOrigin !== location.origin) {
          console.log("CSRF Defender → intercept XHR to", destOrigin);
          const allowed = confirm(
            "⚠️ CSRF Defender warning:\\nXHR до " + destOrigin +
            "\\nМожлива CSRF-атака. Продовжити?"
          );
          window.postMessage({ source: "csrf-defender", url: destOrigin, allowed }, "*");
          if (!allowed) {
            return this.abort();
          }
        }
        return origSend.apply(this, arguments);
      };
    })();
  `;
  const script = document.createElement('script');
  script.textContent = pageCode;
  ;(document.head||document.documentElement).appendChild(script);
})();

// 2) Інжекція CSRF-токена у форми
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
  const destOrigin = new URL(form.action || location.href).origin;
  if (destOrigin !== location.origin) {
    e.preventDefault();
    console.log("CSRF Defender → intercept form submit to", form.action);
    const allowed = confirm(
      "⚠️ CSRF Defender warning:\\nФорма відправляється на " +
      destOrigin + "\\nМожлива CSRF-атака. Продовжити?"
    );
    window.postMessage({ source: "csrf-defender", url: form.action||location.href, allowed }, "*");
    if (allowed) form.submit();
  }
}, true);

// 3) Ловимо рішення confirm та шлемо в background
window.addEventListener('message', event => {
  if (event.source !== window || event.data.source !== "csrf-defender") return;
  const { url, allowed } = event.data;
  chrome.runtime.sendMessage({
    type:  'CSRF_WARN',
    url,
    level: allowed ? 'yellow' : 'red'
  });
});
