// page_inject.js
// Виконується в контексті сторінки, обходить CSP та перехоплює POST-запити

console.log("CSRF Defender → page context override loaded");

;(function(){
  // Методи, які вважаємо «безпечними» (не змінюють стан)
  const SAFE = ['GET','HEAD','OPTIONS'];

  // --- Переозначення Fetch API ---
  const origFetch = window.fetch;
  window.fetch = function(input, init = {}) {
    const url    = (typeof input === 'string') ? input : input.url;
    const method = (init.method || 'GET').toUpperCase();
    const dest   = new URL(url, location.href).origin;

    // Якщо крос-доменний запит і метод не у SAFE → confirm
    if (dest !== location.origin && !SAFE.includes(method)) {
      const allow = confirm(
        `⚠️ CSRF Defender:\n` +
        `${method} ${url}\n` +
        `Виявлено крос-домений POST-запит.\n` +
        `Продовжити?`
      );
      // Сповіщення background про результат
      window.postMessage({ source:'csrf-defender', url, allowed: allow }, '*');
      if (!allow) {
        return Promise.reject(new Error('CSRF fetch blocked'));
      }
    }

    return origFetch.apply(this, arguments);
  };

  // --- Переозначення XMLHttpRequest ---
  const origOpen = window.XMLHttpRequest.prototype.open;
  const origSend = window.XMLHttpRequest.prototype.send;

  window.XMLHttpRequest.prototype.open = function(method, url) {
    this._csrfDest   = new URL(url, location.href).origin;
    this._csrfMethod = method.toUpperCase();
    return origOpen.apply(this, arguments);
  };

  window.XMLHttpRequest.prototype.send = function(body) {
    const dest   = this._csrfDest;
    const method = this._csrfMethod || 'GET';

    if (dest && dest !== location.origin && !SAFE.includes(method)) {
      const allow = confirm(
        `⚠️ CSRF Defender:\n` +
        `${method} ${dest}\n` +
        `Виявлено крос-домений POST-запит.\n` +
        `Продовжити?`
      );
      window.postMessage({ source:'csrf-defender', url: dest, allowed: allow }, '*');
      if (!allow) {
        return this.abort();
      }
    }

    return origSend.apply(this, arguments);
  };
})();
