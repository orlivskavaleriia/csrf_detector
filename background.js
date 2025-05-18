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

// Константи для оновлення політик
const POLICY_UPDATE_INTERVAL = 24 * 60 * 60 * 1000; // 24 години
const POLICY_SERVER_URL = 'https://your-policy-server.com/policies';

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

// Функція для валідації заголовків та токенів
async function validateRequestHeaders(details) {
  const urlObj = new URL(details.url);
  const originHeader = details.requestHeaders.find(h => h.name.toLowerCase() === 'origin')?.value;
  const refererHeader = details.requestHeaders.find(h => h.name.toLowerCase() === 'referer')?.value;
  const tokenHeader = details.requestHeaders.find(h => h.name === 'X-CSRF-Token')?.value;

  // Перевірка Origin
  if (originHeader && originHeader !== urlObj.origin && !settings.trustedDomains.includes(urlObj.origin)) {
    return { valid: false, reason: 'INVALID_ORIGIN' };
  }

  // Перевірка Referer якщо Origin відсутній
  if ((!originHeader || originHeader === 'null') && 
      refererHeader && 
      !refererHeader.startsWith(urlObj.origin) && 
      !settings.trustedDomains.includes(urlObj.origin)) {
    return { valid: false, reason: 'INVALID_REFERER' };
  }

  // Перевірка CSRF токена
  if (!tokenHeader || tokenHeader !== csrfToken) {
    return { valid: false, reason: 'INVALID_TOKEN' };
  }

  return { valid: true };
}

// Видалено chrome.webRequest.onBeforeSendHeaders для сумісності з Manifest V3
// Усі перевірки та блокування тепер мають виконуватись через declarativeNetRequest або контент-скрипти

// Додаю простий listener для перевірки активації Service Worker
chrome.runtime.onInstalled.addListener(() => {
  console.log('Service Worker активний!');
});

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
function logEvent(e) {
  chrome.storage.local.get({ eventHistory: [] }, ({ eventHistory }) => {
    eventHistory.push(e);
    chrome.storage.local.set({ eventHistory });
  });
}

// Отримуємо сигнали з content.js
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!sender.tab) return;
  const tabId = sender.tab.id;

  if (msg.type === 'CSRF_WARN') {
    // msg.level: 'yellow' або 'red'
    pageStatus[tabId] = msg.level;

    // Оновлюємо бейдж для вкладки
    chrome.action.setBadgeText({ tabId, text: msg.level === 'red' ? '!' : '?' });
    chrome.action.setBadgeBackgroundColor({ tabId, color: COLOR_MAP[msg.level] });

    // Лог
    logEvent({
      type:    msg.level === 'red' ? 'blocked' : 'warned',
      url:     msg.url,
      level:   msg.level,
      time:    Date.now()
    });
  }
});

// При закритті вкладки чистимо статус
chrome.tabs.onRemoved.addListener(tabId => {
  delete pageStatus[tabId];
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'GET_COOKIES') {
    chrome.cookies.getAll({ url: msg.url }, cookies => {
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
    return true;
  }
});