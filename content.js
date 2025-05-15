// content.js
console.log("CSRF Defender content script loaded");

// Генерація CSRF-токена
function generateToken(len = 32) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: len })
    .map(() => chars[Math.floor(Math.random() * chars.length)])
    .join('');
}

// Інжекція токена у всі форми
function ensureCSRFToken() {
  document.querySelectorAll('form').forEach(form => {
    let inp = form.querySelector('input[name="csrf-token"]');
    if (!inp) {
      inp = document.createElement('input');
      inp.type = 'hidden';
      inp.name = 'csrf-token';
      inp.value = generateToken();
      form.prepend(inp);
    }
  });
}

// Перехоплення submit форм
document.addEventListener('submit', e => {
  const form = e.target;
  if (!(form instanceof HTMLFormElement)) return;

  // Додаємо токен у форму, якщо він буде потрібним на сервері
  ensureCSRFToken();

  const destOrigin = new URL(form.action || location.href).origin;
  const srcOrigin  = location.origin;
  if (destOrigin !== srcOrigin) {
    e.preventDefault();

    const msg = `Форма відправляється на ${destOrigin} (інший домен).\nМожлива CSRF-атака.\nПродовжити?`;
    const allowed = confirm(msg);

    // Повідомляємо background про рішення
    chrome.runtime.sendMessage({
      type:  'CSRF_WARN',
      url:   form.action || location.href,
      level: allowed ? 'yellow' : 'red'
    });

    if (allowed) {
      form.submit();
    }
    // якщо не allowed і settings.autoBlock — просто не відправляємо
  }
}, true);

// Перехоплення fetch
(function(){
  const origFetch = window.fetch;
  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const destOrigin = new URL(url, location.href).origin;
    const srcOrigin = location.origin;

    // Якщо крос-доменний запит
    if (destOrigin !== srcOrigin) {
      const headers = new Headers(init.headers||{});
      const hasToken = headers.has('X-CSRF-Token') || headers.has('csrf-token');
      if (!hasToken) {
        const msg = `Fetch до ${destOrigin} без CSRF-токена.\nМожлива CSRF-атака.\nПродовжити?`;
        const allowed = confirm(msg);

        chrome.runtime.sendMessage({
          type:  'CSRF_WARN',
          url:   url,
          level: allowed ? 'yellow' : 'red'
        });

        if (!allowed) {
          return Promise.reject(new Error('CSRF fetch blocked'));
        }
      }
    }

    return origFetch(input, init);
  };
})();

// Перехоплення XMLHttpRequest
(function(){
  const origOpen = XMLHttpRequest.prototype.open;
  const origSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

  XMLHttpRequest.prototype.open = function(method, url) {
    this._csrf_dest = new URL(url, location.href).origin;
    return origOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function(body) {
    const destOrigin = this._csrf_dest;
    const srcOrigin  = location.origin;
    if (destOrigin && destOrigin !== srcOrigin) {
      const msg = `XHR до ${destOrigin} (інший домен).\nМожлива CSRF-атака.\nПродовжити?`;
      const allowed = confirm(msg);

      chrome.runtime.sendMessage({
        type:  'CSRF_WARN',
        url:   this._csrf_dest,
        level: allowed ? 'yellow' : 'red'
      });

      if (!allowed) {
        return this.abort();
      }
    }
    return XMLHttpRequest.prototype.send.apply(this, arguments);
  };
})();
