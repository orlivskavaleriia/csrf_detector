// background.js

const COLOR_MAP = {
  green:  '#2ecc71',
  yellow: '#f1c40f',
  red:    '#e74c3c'
};

let settings = {
  autoBlock: true,
  trustedDomains: [],
  tokenUrl: ''        // endpoint для отримання CSRF-токена
};
let csrfToken = null;
const pageStatus = {};  // tabId → 'green'|'yellow'|'red'

// ——————————————————————————————————————————————————————————
// Додана функція для блокування URL через DNR
async function blockUrlWithDNR(ruleId, url) {
  const rule = {
    id: ruleId,
    priority: 1,
    action: { type: 'block' },
    condition: {
      urlFilter: url,
      resourceTypes: ['xmlhttprequest']
    }
  };
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [ruleId],
      addRules: [rule]
    });
    console.log(`DNR rule updated: [${ruleId}] block ${url}`);
  } catch (e) {
    console.error('Error updating DNR rules:', e);
  }
}
// ——————————————————————————————————————————————————————————

// 1) Завантажуємо налаштування разом із tokenUrl
function loadSettings() {
  chrome.storage.local.get(
    ['autoBlock', 'trustedDomains', 'tokenUrl'],
    data => {
      if (typeof data.autoBlock === 'boolean') settings.autoBlock = data.autoBlock;
      if (Array.isArray(data.trustedDomains)) settings.trustedDomains = data.trustedDomains;
      if (typeof data.tokenUrl === 'string')   settings.tokenUrl   = data.tokenUrl;
    }
  );
}

// 2) Підтягуємо CSRF-токен із сервера
async function fetchCsrfToken() {
  if (!settings.tokenUrl) return;
  try {
    const resp = await fetch(settings.tokenUrl, { credentials: 'include' });
    if (resp.ok) {
      const payload = await resp.json();
      csrfToken = payload.csrfToken;  // сервер має повертати { csrfToken: "…" }
      chrome.storage.local.set({ csrfToken });
      console.log('CSRF token updated:', csrfToken);
    } else {
      console.warn('Не вдалося отримати CSRF-токен, статус', resp.status);
    }
  } catch (err) {
    console.error('Помилка при fetchCsrfToken():', err);
  }
}

// 3) Валідація Origin/Referer та X-CSRF-Token на HTTP-рівні
chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    // Пропускаємо запити самого розширення
    if (details.initiator && details.initiator.startsWith('chrome-extension://')) {
      return { requestHeaders: details.requestHeaders };
    }

    const urlObj       = new URL(details.url);
    const originHeader = details.requestHeaders.find(h => h.name.toLowerCase() === 'origin')?.value;
    const refererHeader= details.requestHeaders.find(h => h.name.toLowerCase() === 'referer')?.value;
    const tokenHeader  = details.requestHeaders.find(h => h.name === 'X-CSRF-Token')?.value;

    let verdict = 'green';

    // Перевіряємо домен запиту
    if (
      originHeader &&
      originHeader !== urlObj.origin &&
      !settings.trustedDomains.includes(urlObj.origin)
    ) {
      verdict = 'red';
    }
    // Якщо Origin відсутній — дивимося на Referer
    else if (
      (!originHeader || originHeader === 'null') &&
      refererHeader &&
      !refererHeader.startsWith(urlObj.origin) &&
      !settings.trustedDomains.includes(urlObj.origin)
    ) {
      verdict = 'red';
    }

    // Перевірка CSRF-токена
    if (verdict === 'green') {
      if (!tokenHeader || tokenHeader !== csrfToken) {
        verdict = 'red';
      }
    }

    // Реагуємо на результат
    if (verdict === 'red') {
      // позначаємо чи блокуємо
      updateBadge(details.tabId, 'red');
      logEvent({ type: 'blocked', url: details.url, level: 'red', time: Date.now() });

      if (settings.autoBlock) {
        // замість return { cancel: true } — блокуємо через DNR
        blockUrlWithDNR(1, details.url);
      }

    } else if (verdict === 'yellow') {
      updateBadge(details.tabId, 'yellow');
      logEvent({ type: 'warned', url: details.url, level: 'yellow', time: Date.now() });
    }

    return { requestHeaders: details.requestHeaders };
  },
  { urls: ["<all_urls>"] },
  ["blocking", "requestHeaders"]
);

// 4) При встановленні та запуску розширення — зчитати налаштування і підхопити токен
chrome.runtime.onInstalled.addListener(() => {
  loadSettings();
  fetchCsrfToken();
});
chrome.runtime.onStartup.addListener(() => {
  loadSettings();
  fetchCsrfToken();
});

// 5) Слідкуємо за зміною налаштувань у Popup
chrome.storage.onChanged.addListener(changes => {
  if (changes.tokenUrl    || changes.trustedDomains) loadSettings();
  if (changes.csrfToken) csrfToken = changes.csrfToken.newValue;
});

// 6) Оновлення іконки/баджа
function updateBadge(tabId, level) {
  pageStatus[tabId] = level;
  chrome.action.setBadgeText({
    text: level === 'green' ? '' : level.charAt(0).toUpperCase(),
    tabId
  });
  chrome.action.setBadgeBackgroundColor({
    color: COLOR_MAP[level],
    tabId
  });
}

// 7) Логування подій — ваш існуючий код
function logEvent(msg) {
  // … реалізація логування
}

chrome.tabs.onRemoved.addListener(tabId => {
  delete pageStatus[tabId];
});
