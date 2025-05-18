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

// Функція для аудиту форм на сторінці
function auditForms() {
  const forms = document.querySelectorAll('form');
  const formAudit = [];

  forms.forEach((form, index) => {
    const formData = {
      id: index,
      action: form.action,
      method: form.method,
      hasCsrfToken: false,
      hasSecureMethod: form.method.toUpperCase() === 'POST',
      hasSecureAction: form.action.startsWith('https://'),
      inputs: []
    };

    // Перевіряємо всі поля форми
    form.querySelectorAll('input').forEach(input => {
      formData.inputs.push({
        name: input.name,
        type: input.type,
        required: input.required
      });

      // Перевіряємо наявність CSRF токена
      if (input.name.toLowerCase().includes('csrf') || 
          input.name.toLowerCase().includes('token')) {
        formData.hasCsrfToken = true;
      }
    });

    formAudit.push(formData);
  });

  return formAudit;
}

// Функція для аудиту AJAX запитів
function auditAjaxRequests() {
  const requests = [];
  
  // Перехоплюємо всі XHR запити
  const originalXHR = window.XMLHttpRequest;
  window.XMLHttpRequest = function() {
    const xhr = new originalXHR();
    const originalOpen = xhr.open;
    
    xhr.open = function() {
      requests.push({
        type: 'XHR',
        url: arguments[1],
        method: arguments[0],
        timestamp: Date.now()
      });
      return originalOpen.apply(this, arguments);
    };
    
    return xhr;
  };

  // Перехоплюємо всі fetch запити
  const originalFetch = window.fetch;
  window.fetch = function() {
    requests.push({
      type: 'FETCH',
      url: arguments[0],
      method: arguments[1]?.method || 'GET',
      timestamp: Date.now()
    });
    return originalFetch.apply(this, arguments);
  };

  return requests;
}

// Обробник повідомлення для запуску аудиту
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'RUN_CSRF_AUDIT') {
    const auditResults = {
      forms: auditForms(),
      requests: auditAjaxRequests(),
      timestamp: Date.now(),
      url: window.location.href
    };

    // Зберігаємо результати аудиту
    chrome.storage.local.get({ auditHistory: [] }, ({ auditHistory }) => {
      auditHistory.push(auditResults);
      chrome.storage.local.set({ auditHistory });
    });

    // Відправляємо результати в background.js
    chrome.runtime.sendMessage({
      type: 'AUDIT_RESULTS',
      data: auditResults
    });

    sendResponse({ success: true });
  }
});
