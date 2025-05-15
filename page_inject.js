// page_inject.js
console.log("CSRF Defender → page context override loaded");

// --- Fetch override ---
;(function(){
  const origFetch = window.fetch;
  window.fetch = function(input, init = {}) {
    const url = typeof input === 'string' ? input : input.url;
    const dest = new URL(url, location.href).origin;
    if (dest !== location.origin) {
      console.log("CSRF Defender → intercept fetch to", url);
      const allow = confirm(
        `⚠️ CSRF Defender:\nFetch до ${url}\nМожлива CSRF-атака. Продовжити?`
      );
      window.postMessage({ source:'csrf-defender', url, allowed: allow }, '*');
      if (!allow) {
        return Promise.reject(new Error('CSRF fetch blocked'));
      }
    }
    return origFetch.apply(this, arguments);
  };
})();

// --- XHR override ---
;(function(){
  const origOpen = window.XMLHttpRequest.prototype.open;
  const origSend = window.XMLHttpRequest.prototype.send;

  window.XMLHttpRequest.prototype.open = function(method, url) {
    this._csrfDest = new URL(url, location.href).origin;
    return origOpen.apply(this, arguments);
  };
  window.XMLHttpRequest.prototype.send = function(body) {
    const dest = this._csrfDest;
    if (dest && dest !== location.origin) {
      console.log("CSRF Defender → intercept XHR to", dest);
      const allow = confirm(
        `⚠️ CSRF Defender:\nXHR до ${dest}\nМожлива CSRF-атака. Продовжити?`
      );
      window.postMessage({ source:'csrf-defender', url: dest, allowed: allow }, '*');
      if (!allow) {
        return this.abort();
      }
    }
    return origSend.apply(this, arguments);
  };
})();
