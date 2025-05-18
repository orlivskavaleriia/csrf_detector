document.addEventListener('DOMContentLoaded', () => {
  const menuBtn        = document.getElementById('menu-toggle');
  const drawer         = document.getElementById('drawer');
  const closeBtn       = document.getElementById('drawer-close');
  const mainContent    = document.querySelector('.main-content');
  const autoblockChk   = document.getElementById('autoblock-toggle');
  const indicator      = document.getElementById('indicator');
  const statusText     = document.getElementById('status-text');
  const scanBtn        = document.getElementById('scan-btn');
  const clearReqBtn    = document.getElementById('clear-requests');
  const clearFormBtn   = document.getElementById('clear-forms');
  const blockedReqList = document.getElementById('blocked-requests');
  const blockedFormList= document.getElementById('blocked-forms');
  const whitelistInput = document.getElementById('whitelist-input');
  const btnWhitelist   = document.getElementById('btn-whitelist');
  const trustedList    = document.getElementById('trusted-list');

  // Drawer toggle
  function toggleDrawer(open) {
    drawer.classList.toggle('open', open);
    mainContent.classList.toggle('blurred', open);
  }
  menuBtn.addEventListener('click', e => {
    e.stopPropagation();
    toggleDrawer(!drawer.classList.contains('open'));
  });
  closeBtn.addEventListener('click', () => toggleDrawer(false));
  document.addEventListener('click', e => {
    if (!drawer.contains(e.target) && !menuBtn.contains(e.target)) {
      toggleDrawer(false);
    }
  });

  // Load settings & initial render
  chrome.storage.local.get(['autoBlock','trustedDomains'], data => {
    const auto = data.autoBlock !== false;
    autoblockChk.checked = auto;
    renderStatus(auto);
    renderTrusted(data.trustedDomains || []);
  });
  loadBlockedRequests();
  loadBlockedForms();

  // Auto-block toggle
  autoblockChk.addEventListener('change', e => {
    const on = e.target.checked;
    chrome.storage.local.set({ autoBlock: on }, () => renderStatus(on));
  });

  // Scan forms
  scanBtn.addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'getForms' }, resp => {
        console.log('Forms:', resp.forms);
      });
    });
  });

  // Clear lists
  clearReqBtn.addEventListener('click', () => {
    chrome.storage.local.set({ blockedRequests: [] }, loadBlockedRequests);
  });
  clearFormBtn.addEventListener('click', () => {
    chrome.storage.local.set({ blockedForms: [] }, loadBlockedForms);
  });

  // Whitelist
  btnWhitelist.addEventListener('click', () => {
    const domain = whitelistInput.value.trim();
    if (!domain) return;
    chrome.storage.local.get({ trustedDomains: [] }, data => {
      const list = data.trustedDomains;
      if (!list.includes(domain)) {
        list.push(domain);
        chrome.storage.local.set({ trustedDomains: list }, () => {
          renderTrusted(list);
          whitelistInput.value = '';
        });
      }
    });
  });

  // Render helpers
  function renderStatus(on) {
    indicator.classList.toggle('active', on);
    indicator.classList.toggle('inactive', !on);
    statusText.textContent = on ? 'Захист активний' : 'Захист не активний';
  }
  function renderTrusted(list) {
  trustedList.innerHTML = '';
  if (!list.length) {
    const li = document.createElement('li');
    li.textContent = 'Немає довірених доменів';
    trustedList.appendChild(li);
  } else {
    list.forEach((domain, idx) => {
      const li = document.createElement('li');
      li.style.display = 'flex';
      li.style.alignItems = 'center';
      // текст домену
      const span = document.createElement('span');
      span.textContent = domain;
      // кнопка видалення
      const btn = document.createElement('button');
      btn.textContent = '×';
      btn.className = 'remove-btn';
      btn.addEventListener('click', () => {
        // витягаємо поточний масив, видаляємо цей домен, зберігаємо і рендеримо знову
        chrome.storage.local.get({ trustedDomains: [] }, data => {
          const newList = data.trustedDomains.filter(d => d !== domain);
          chrome.storage.local.set({ trustedDomains: newList }, () => {
            renderTrusted(newList);
          });
        });
      });
      li.appendChild(span);
      li.appendChild(btn);
      trustedList.appendChild(li);
    });
  }
}

  function loadBlockedRequests() {
    chrome.storage.local.get({ blockedRequests: [] }, data => {
      blockedReqList.innerHTML = '';
      if (!data.blockedRequests.length) {
        const li = document.createElement('li');
        li.textContent = 'Немає заблокованих запитів';
        blockedReqList.appendChild(li);
      } else {
        data.blockedRequests.forEach(item => {
          const li = document.createElement('li');
          li.textContent = `[${new Date(item.timestamp).toLocaleTimeString()}] ${item.url}`;
          blockedReqList.appendChild(li);
        });
      }
    });
  }
  function loadBlockedForms() {
    chrome.storage.local.get({ blockedForms: [] }, data => {
      blockedFormList.innerHTML = '';
      if (!data.blockedForms.length) {
        const li = document.createElement('li');
        li.textContent = 'Немає заблокованих форм';
        blockedFormList.appendChild(li);
      } else {
        data.blockedForms.forEach(item => {
          const li = document.createElement('li');
          li.textContent = item;
          blockedFormList.appendChild(li);
        });
      }
    });
  }
});

// Запустити аудит при кліку
document.getElementById('runAudit').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  console.log('Відправляю RUN_CSRF_AUDIT у вкладку', tab.id);
  chrome.tabs.sendMessage(tab.id, { type: 'RUN_CSRF_AUDIT' }, response => {
    console.log('Відповідь від контент-скрипта:', response);
  });
});

// Функція для оновлення таблиці звіту
function updateAuditTable() {
  chrome.storage.local.get(null, items => {
    const reports = Object.values(items)
      .filter((v, k) => k.startsWith && k.startsWith('audit_'));
    const rows = reports.map(rep =>
      rep.forms.map(f =>
        `<tr>
          <td>${f.action}</td>
          <td>${f.method}</td>
          <td>${f.hasToken ? '✔ ('+f.tokenNames.join(', ')+')' : '✖'}</td>
        </tr>`
      ).join('')
    ).join('');
    document.getElementById('audit-table').innerHTML = rows;
  });
}

// Слухаємо зміни в storage і оновлюємо таблицю
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') updateAuditTable();
});

// Експорт JSON
document.getElementById('export-json').addEventListener('click', () => {
  chrome.storage.local.get(null, items => {
    const blob = new Blob([JSON.stringify(items, null, 2)], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'csrf_audit.json'; a.click();
  });
});

// Ініціалізуємо таблицю при відкритті попапу
updateAuditTable();

// Функція для відображення результатів аудиту форм
function displayFormsAudit(forms) {
  const formsList = document.getElementById('formsList');
  formsList.innerHTML = '';

  forms.forEach(form => {
    const formElement = document.createElement('div');
    formElement.className = `form-item ${form.hasCsrfToken && form.hasSecureMethod ? 'secure' : 'insecure'}`;
    
    formElement.innerHTML = `
      <div class="form-header">
        <strong>Форма ${form.id + 1}</strong>
        <span class="status-badge ${form.hasCsrfToken ? 'success' : 'danger'}">
          ${form.hasCsrfToken ? 'Захищена' : 'Незахищена'}
        </span>
      </div>
      <div class="form-details">
        <p>Метод: ${form.method}</p>
        <p>URL: ${form.action}</p>
        <div class="security-indicators">
          <span class="indicator ${form.hasSecureMethod ? 'success' : 'warning'}">
            Безпечний метод: ${form.hasSecureMethod ? '✔' : '✖'}
          </span>
          <span class="indicator ${form.hasSecureAction ? 'success' : 'warning'}">
            Безпечний URL: ${form.hasSecureAction ? '✔' : '✖'}
          </span>
          <span class="indicator ${form.hasSameOriginAction ? 'success' : 'warning'}">
            Same Origin: ${form.hasSameOriginAction ? '✔' : '✖'}
          </span>
        </div>
        <div class="security-headers">
          <h4>Заголовки безпеки:</h4>
          <ul>
            <li>CSP: ${form.securityHeaders.hasContentSecurityPolicy ? '✔' : '✖'}</li>
            <li>X-Frame-Options: ${form.securityHeaders.hasXFrameOptions ? '✔' : '✖'}</li>
            <li>X-Content-Type-Options: ${form.securityHeaders.hasXContentTypeOptions ? '✔' : '✖'}</li>
          </ul>
        </div>
      </div>
      <div class="form-inputs">
        <strong>Поля форми:</strong>
        <ul>
          ${form.inputs.map(input => `
            <li>
              ${input.name} (${input.type})
              ${input.required ? '<span class="required">*</span>' : ''}
              <div class="input-security">
                ${input.hasAutocomplete ? '<span class="security-feature">autocomplete</span>' : ''}
                ${input.hasPattern ? '<span class="security-feature">pattern</span>' : ''}
                ${input.hasMinLength ? '<span class="security-feature">minlength</span>' : ''}
                ${input.hasMaxLength ? '<span class="security-feature">maxlength</span>' : ''}
              </div>
            </li>
          `).join('')}
        </ul>
      </div>
    `;

    formsList.appendChild(formElement);
  });
}

// Функція для відображення результатів аудиту запитів
function displayRequestsAudit(requests) {
  const requestsList = document.getElementById('requestsList');
  requestsList.innerHTML = '';

  requests.forEach(request => {
    const requestElement = document.createElement('div');
    requestElement.className = 'request-item';
    
    requestElement.innerHTML = `
      <div class="request-header">
        <strong>${request.type}</strong>
        <span class="timestamp">${new Date(request.timestamp).toLocaleTimeString()}</span>
      </div>
      <div class="request-details">
        <p>Метод: ${request.method}</p>
        <p>URL: ${request.url}</p>
        <div class="security-indicators">
          <span class="indicator ${request.security.hasCsrfToken ? 'success' : 'warning'}">
            CSRF Token: ${request.security.hasCsrfToken ? '✔' : '✖'}
          </span>
          <span class="indicator ${request.security.isSameOrigin ? 'success' : 'warning'}">
            Same Origin: ${request.security.isSameOrigin ? '✔' : '✖'}
          </span>
          <span class="indicator ${request.security.hasSecureProtocol ? 'success' : 'warning'}">
            HTTPS: ${request.security.hasSecureProtocol ? '✔' : '✖'}
          </span>
        </div>
      </div>
    `;

    requestsList.appendChild(requestElement);
  });
}

// Функція для відображення результатів аудиту кукі
function displayCookiesAudit(cookies) {
  const cookiesList = document.getElementById('cookiesList');
  if (!cookiesList) return;

  cookiesList.innerHTML = `
    <div class="cookies-summary">
      <h4>Загальна статистика кукі:</h4>
      <ul>
        <li>Всього кукі: ${cookies.total}</li>
        <li>Secure: ${cookies.secure} (${Math.round(cookies.secure/cookies.total*100)}%)</li>
        <li>HttpOnly: ${cookies.httpOnly} (${Math.round(cookies.httpOnly/cookies.total*100)}%)</li>
      </ul>
      <h4>SameSite атрибути:</h4>
      <ul>
        <li>Strict: ${cookies.sameSite.strict} (${Math.round(cookies.sameSite.strict/cookies.total*100)}%)</li>
        <li>Lax: ${cookies.sameSite.lax} (${Math.round(cookies.sameSite.lax/cookies.total*100)}%)</li>
        <li>None: ${cookies.sameSite.none} (${Math.round(cookies.sameSite.none/cookies.total*100)}%)</li>
        <li>Не вказано: ${cookies.sameSite.unspecified} (${Math.round(cookies.sameSite.unspecified/cookies.total*100)}%)</li>
      </ul>
    </div>
  `;
}

// Функція для відображення загального показника безпеки
function displaySecurityScore(score) {
  const scoreElement = document.getElementById('securityScore');
  if (!scoreElement) return;

  let scoreClass = 'low';
  if (score >= 80) scoreClass = 'high';
  else if (score >= 50) scoreClass = 'medium';

  scoreElement.innerHTML = `
    <div class="security-score ${scoreClass}">
      <h3>Загальний показник безпеки</h3>
      <div class="score-value">${score}/100</div>
      <div class="score-description">
        ${score >= 80 ? 'Високий рівень безпеки' : 
          score >= 50 ? 'Середній рівень безпеки' : 
          'Низький рівень безпеки'}
      </div>
    </div>
  `;
}

// Оновлений обробник результатів аудиту
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Отримано AUDIT_RESULTS у popup:', message);
  if (message.type === 'AUDIT_RESULTS') {
    // ... відображення результатів ...
  }
});

// Завантажуємо останні результати аудиту при відкритті popup
chrome.storage.local.get({ auditHistory: [] }, ({ auditHistory }) => {
  if (auditHistory.length > 0) {
    const lastAudit = auditHistory[auditHistory.length - 1];
    displayFormsAudit(lastAudit.forms);
    displayRequestsAudit(lastAudit.requests);
  }
});

function auditCookies() {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type: 'GET_COOKIES', url: location.href }, resolve);
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'GET_COOKIES') {
    const url = new URL(msg.url);
    chrome.cookies.getAll({ domain: url.hostname }, cookies => {
      // тут формуєте статистику по кукі
      const cookieAudit = {
        total: cookies.length,
        secure: cookies.filter(c => c.secure).length,
        httpOnly: cookies.filter(c => c.httpOnly).length,
        sameSite: {
          strict: cookies.filter(c => c.sameSite === 'Strict').length,
          lax: cookies.filter(c => c.sameSite === 'Lax').length,
          none: cookies.filter(c => c.sameSite === 'None').length,
          unspecified: cookies.filter(c => !c.sameSite).length
        }
      };
      sendResponse(cookieAudit);
    });
    // ВАЖЛИВО!
    return true;
  }
});