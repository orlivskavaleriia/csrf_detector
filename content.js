// content.js
console.log("content.js loaded");

// Генерація / перевірка CSRF-токена
function generateToken(len = 32) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: len })
    .map(() => chars[Math.floor(Math.random() * chars.length)])
    .join('');
}
function isValidCSRF(token) {
  return /^[A-Za-z0-9]{16,}$/.test(token);
}

// Додаємо або оновлюємо CSRF-токен у всіх формах
function ensureCSRFToken() {
  document.querySelectorAll('form').forEach(form => {
    let inp = form.querySelector('input[name="csrf-token"]');
    if (inp) {
      if (!isValidCSRF(inp.value)) inp.value = generateToken();
    } else {
      inp = document.createElement('input');
      inp.type = 'hidden';
      inp.name = 'csrf-token';
      inp.value = generateToken();
      form.appendChild(inp);
    }
  });
}

// Встановлюємо MutationObserver, щоби ловити динамічно додані форми
function initObserver() {
  const body = document.body;
  if (!body) return;
  new MutationObserver(muts => {
    muts.forEach(m => {
      m.addedNodes.forEach(n => {
        if (
          n.nodeType === Node.ELEMENT_NODE &&
          (n.matches('form') || n.querySelector('form'))
        ) {
          ensureCSRFToken();
        }
      });
    });
  }).observe(body, { childList: true, subtree: true });
}

// Ініціалізація при завантаженні сторінки
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    ensureCSRFToken();
    initObserver();
  });
} else {
  ensureCSRFToken();
  initObserver();
}

// Відповідь на Scan Forms
chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (req.action === 'getForms') {
    const forms = [];
    document.querySelectorAll('form').forEach(f => {
      const inputs = {};
      f.querySelectorAll('input,select,textarea').forEach(i => {
        inputs[i.name] = i.value || '';
      });
      forms.push({ action: f.action, method: f.method, inputs });
    });
    sendResponse({ forms });
  }
});

// --- Новий функціонал аудиту ---
(function(){
  let auditForms = [];
  let auditRequests = [];

  function runAudit() {
    // 1) Збір усіх форм
    auditForms = Array.from(document.querySelectorAll('form')).map(form => {
      const action = form.action || location.href;
      const method = (form.method || 'GET').toUpperCase();
      const tokens = Array.from(form.querySelectorAll('input[type="hidden"]'))
        .filter(i => /csrf|token/i.test(i.name))
        .map(i => i.name);
      return { action, method, hasToken: tokens.length > 0, tokenNames: tokens };
    });

    // 2) Пере­визначення fetch
    const originalFetch = window.fetch;
    auditRequests = [];
    window.fetch = async (input, init = {}) => {
      const method = (init.method || 'GET').toUpperCase();
      const headers = new Headers(init.headers);
      const hasHeader = headers.has('X-CSRF-Token') || headers.has('X-XSRF-TOKEN');
      auditRequests.push({ url: input.toString(), method, hasHeader });
      return originalFetch(input, init);
    };

    // 3) Пере­визначення XMLHttpRequest
    const origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
      this.addEventListener('readystatechange', function() {
        if (this.readyState === 1) {
          const h = this.getRequestHeader && (
            this.getRequestHeader('X-CSRF-Token') ||
            this.getRequestHeader('X-XSRF-TOKEN')
          );
          auditRequests.push({ url, method, hasHeader: !!h });
        }
      });
      return origOpen.apply(this, arguments);
    };

    // 4) Надіслати результати в background
    chrome.runtime.sendMessage({
      type: 'CSRF_AUDIT',
      payload: { forms: auditForms, requests: auditRequests }
    });
  }

  // Слухаємо команду з popup.js
  chrome.runtime.onMessage.addListener((msg, sender, resp) => {
    if (msg.type === 'RUN_CSRF_AUDIT') {
      runAudit();
    }
  });
})();