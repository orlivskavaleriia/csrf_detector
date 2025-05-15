// content.js

// 1) Інжекція або оновлення CSRF-токена у форму
function generateToken(len=32) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({length: len})
    .map(()=>chars[Math.floor(Math.random()*chars.length)])
    .join('');
}
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

// 2) Перехоплюємо submit форм
document.addEventListener('submit', e => {
  const form = e.target;
  if (!(form instanceof HTMLFormElement)) return;
  ensureCSRFToken();  // на всяк випадок
  const actionOrigin = new URL(form.action || location.href).origin;
  const pageOrigin   = location.origin;
  if (actionOrigin !== pageOrigin) {
    e.preventDefault();
    if (confirm(`Форма відправляється на ${actionOrigin}. Продовжити?`)) {
      form.submit();
    }
  }
}, true);

// 3) Перехоплюємо fetch
(function(){
  const origFetch = window.fetch;
  window.fetch = async (input, init={}) => {
    const url = (typeof input === 'string') ? input : input.url;
    const destOrigin = new URL(url, location.href).origin;
    if (location.origin !== destOrigin) {
      if (!confirm(`Fetch до ${destOrigin}. Продовжити?`)) {
        return Promise.reject(new Error('CSRF fetch blocked'));
      }
    }
    return origFetch(input, init);
  };
})();

// 4) Перехоплюємо XMLHttpRequest
(function(){
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {
    const destOrigin = new URL(url, location.href).origin;
    if (location.origin !== destOrigin) {
      if (!confirm(`XHR до ${destOrigin}. Продовжити?`)) {
        this.abort();
        return;
      }
    }
    origOpen.apply(this, arguments);
  };
})();
