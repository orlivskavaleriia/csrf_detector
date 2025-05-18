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

// Функція для перевірки кукі
function auditCookies() {
  const cookies = document.cookie.split(';').map(cookie => {
    const [name, value] = cookie.trim().split('=');
    return { name, value };
  });

  const cookieAudit = {
    total: cookies.length,
    secure: 0,
    httpOnly: 0,
    sameSite: {
      strict: 0,
      lax: 0,
      none: 0,
      unspecified: 0
    }
  };

  // Отримуємо детальну інформацію про кукі через chrome.cookies API
  return new Promise(resolve => {
    chrome.cookies.getAll({}, cookies => {
      cookies.forEach(cookie => {
        if (cookie.secure) cookieAudit.secure++;
        if (cookie.httpOnly) cookieAudit.httpOnly++;
        
        switch (cookie.sameSite) {
          case 'strict': cookieAudit.sameSite.strict++; break;
          case 'lax': cookieAudit.sameSite.lax++; break;
          case 'none': cookieAudit.sameSite.none++; break;
          default: cookieAudit.sameSite.unspecified++;
        }
      });
      resolve(cookieAudit);
    });
  });
}

// Розширена функція аудиту форм
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
      hasSameOriginAction: new URL(form.action, window.location.href).origin === window.location.origin,
      hasContentType: form.enctype === 'multipart/form-data' || form.enctype === 'application/x-www-form-urlencoded',
      inputs: [],
      securityHeaders: {
        hasContentSecurityPolicy: false,
        hasXFrameOptions: false,
        hasXContentTypeOptions: false
      }
    };

    // Перевіряємо всі поля форми
    form.querySelectorAll('input').forEach(input => {
      const inputData = {
        name: input.name,
        type: input.type,
        required: input.required,
        hasAutocomplete: input.hasAttribute('autocomplete'),
        hasPattern: input.hasAttribute('pattern'),
        hasMinLength: input.hasAttribute('minlength'),
        hasMaxLength: input.hasAttribute('maxlength')
      };

      formData.inputs.push(inputData);

      // Перевіряємо наявність CSRF токена
      if (input.name.toLowerCase().includes('csrf') || 
          input.name.toLowerCase().includes('token')) {
        formData.hasCsrfToken = true;
      }
    });

    // Перевіряємо заголовки безпеки
    const metaTags = document.getElementsByTagName('meta');
    for (const meta of metaTags) {
      if (meta.httpEquiv === 'Content-Security-Policy') {
        formData.securityHeaders.hasContentSecurityPolicy = true;
      }
      if (meta.httpEquiv === 'X-Frame-Options') {
        formData.securityHeaders.hasXFrameOptions = true;
      }
      if (meta.httpEquiv === 'X-Content-Type-Options') {
        formData.securityHeaders.hasXContentTypeOptions = true;
      }
    }

    formAudit.push(formData);
  });

  return formAudit;
}

// Розширена функція аудиту AJAX запитів
function auditAjaxRequests() {
  const requests = [];
  
  // Перехоплюємо всі XHR запити
  const originalXHR = window.XMLHttpRequest;
  window.XMLHttpRequest = function() {
    const xhr = new originalXHR();
    const originalOpen = xhr.open;
    const originalSetRequestHeader = xhr.setRequestHeader;
    
    xhr.open = function() {
      const requestData = {
        type: 'XHR',
        url: arguments[1],
        method: arguments[0],
        timestamp: Date.now(),
        headers: {},
        security: {
          isSameOrigin: new URL(arguments[1], window.location.href).origin === window.location.origin,
          hasCsrfToken: false,
          hasSecureProtocol: arguments[1].startsWith('https://')
        }
      };

      xhr.setRequestHeader = function(header, value) {
        requestData.headers[header] = value;
        if (header.toLowerCase() === 'x-csrf-token' || 
            header.toLowerCase().includes('csrf') || 
            header.toLowerCase().includes('token')) {
          requestData.security.hasCsrfToken = true;
        }
        return originalSetRequestHeader.apply(this, arguments);
      };

      requests.push(requestData);
      return originalOpen.apply(this, arguments);
    };
    
    return xhr;
  };

  // Перехоплюємо всі fetch запити
  const originalFetch = window.fetch;
  window.fetch = function() {
    const requestData = {
      type: 'FETCH',
      url: arguments[0],
      method: arguments[1]?.method || 'GET',
      timestamp: Date.now(),
      headers: arguments[1]?.headers || {},
      security: {
        isSameOrigin: new URL(arguments[0], window.location.href).origin === window.location.origin,
        hasCsrfToken: false,
        hasSecureProtocol: arguments[0].startsWith('https://')
      }
    };

    // Перевіряємо заголовки на наявність CSRF токена
    if (arguments[1]?.headers) {
      for (const [header, value] of Object.entries(arguments[1].headers)) {
        if (header.toLowerCase() === 'x-csrf-token' || 
            header.toLowerCase().includes('csrf') || 
            header.toLowerCase().includes('token')) {
          requestData.security.hasCsrfToken = true;
        }
      }
    }

    requests.push(requestData);
    return originalFetch.apply(this, arguments);
  };

  return requests;
}

// Оновлений обробник повідомлення для запуску аудиту
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'RUN_CSRF_AUDIT') {
    Promise.all([
      auditForms(),
      auditAjaxRequests(),
      auditCookies()
    ]).then(([forms, requests, cookies]) => {
      const auditResults = {
        forms,
        requests,
        cookies,
        timestamp: Date.now(),
        url: window.location.href,
        securityScore: calculateSecurityScore(forms, requests, cookies)
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
    });

    return true; // Важливо для асинхронної відповіді
  }
});

// Функція для розрахунку загального показника безпеки
function calculateSecurityScore(forms, requests, cookies) {
  let score = 0;
  const maxScore = 100;

  // Оцінка форм (40% від загального балу)
  const formScore = forms.reduce((acc, form) => {
    let formPoints = 0;
    if (form.hasCsrfToken) formPoints += 2;
    if (form.hasSecureMethod) formPoints += 1;
    if (form.hasSecureAction) formPoints += 1;
    if (form.hasSameOriginAction) formPoints += 1;
    if (form.hasContentType) formPoints += 1;
    if (form.securityHeaders.hasContentSecurityPolicy) formPoints += 1;
    if (form.securityHeaders.hasXFrameOptions) formPoints += 1;
    if (form.securityHeaders.hasXContentTypeOptions) formPoints += 1;
    return acc + formPoints;
  }, 0) / (forms.length || 1) * 0.4;

  // Оцінка запитів (30% від загального балу)
  const requestScore = requests.reduce((acc, request) => {
    let requestPoints = 0;
    if (request.security.hasCsrfToken) requestPoints += 2;
    if (request.security.isSameOrigin) requestPoints += 1;
    if (request.security.hasSecureProtocol) requestPoints += 1;
    return acc + requestPoints;
  }, 0) / (requests.length || 1) * 0.3;

  // Оцінка кукі (30% від загального балу)
  const cookieScore = (
    (cookies.secure / cookies.total) * 0.5 +
    (cookies.httpOnly / cookies.total) * 0.5 +
    (cookies.sameSite.strict / cookies.total) * 0.5
  ) * 0.3;

  return Math.round((formScore + requestScore + cookieScore) * maxScore);
}
