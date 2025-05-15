// background.js (MV3 + Declarative Net Request + CSRF Audit + Auto-update policies)

// Константи та налаштування

const COLOR_MAP = {
  green:  '#2ecc71',
  yellow: '#f1c40f',
  red:    '#e74c3c'
};

// URL до raw-файлу з правилами на GitHub
const POLICY_URL = 'https://raw.githubusercontent.com/your-org/your-repo/main/csrf_rules.json';

// Ідентифікатор дзвінка для оновлення політик
const POLICY_ALARM = 'updatePolicies';

// Початкові налаштування — можуть змінюватися в popup
let settings = {
  autoBlock:      true,
  trustedDomains: []
};

// 1) Завантаження / оновлення налаштувань

chrome.storage.local.get(
  ['autoBlock', 'trustedDomains'],
  data => {
    if (typeof data.autoBlock === 'boolean')
      settings.autoBlock = data.autoBlock;
    if (Array.isArray(data.trustedDomains))
      settings.trustedDomains = data.trustedDomains;
  }
);

chrome.storage.onChanged.addListener(changes => {
  if (changes.autoBlock)
    settings.autoBlock = changes.autoBlock.newValue;
  if (changes.trustedDomains)
    settings.trustedDomains = changes.trustedDomains.newValue;
});

// 2) Логування подій

function logEvent(event) {
  chrome.storage.local.get({ eventHistory: [] }, data => {
    data.eventHistory.push(event);
    chrome.storage.local.set({ eventHistory: data.eventHistory });
  });
}

function logBlockedRequest(url) {
  chrome.storage.local.get({ blockedRequests: [] }, data => {
    data.blockedRequests.push({ url, timestamp: Date.now() });
    chrome.storage.local.set({ blockedRequests: data.blockedRequests });
  });
}

// 3) Аналіз заголовків (не блокуємо)
//    — оновлює бейдж та журнал подій

function analyzeHeaders(details) {
  const hdrs = {};
  for (const h of details.requestHeaders || [])
    hdrs[h.name.toLowerCase()] = h.value;

  const urlObj      = new URL(details.url);
  const targetOrigin = urlObj.origin;
  let risk = 'green';

  if (hdrs.origin) {
    if (hdrs.origin !== targetOrigin) risk = 'red';
  } else if (hdrs.referer) {
    try {
      if (new URL(hdrs.referer).origin !== targetOrigin) risk = 'red';
    } catch {
      risk = 'red';
    }
  } else {
    risk = 'red';
  }

  // Якщо довірений домен, зменшуємо рівень ризику
  if (risk === 'red' && settings.trustedDomains.includes(urlObj.hostname))
    risk = 'yellow';

  // Оновлюємо бейдж
  chrome.action.setBadgeText({ text: risk[0].toUpperCase() });
  chrome.action.setBadgeBackgroundColor({ color: COLOR_MAP[risk] });

  // Лог події
  logEvent({
    url:       details.url,
    risk,
    timestamp: Date.now()
  });
}

chrome.webRequest.onBeforeSendHeaders.addListener(
  analyzeHeaders,
  { urls: ['<all_urls>'] },
  ['requestHeaders', 'extraHeaders']
);

// 4) Динамічне блокування через DNR

async function blockUrlDynamically(url, ruleId = Date.now() % 100000) {
  if (!settings.autoBlock) return;

  const rule = {
    id:       ruleId,
    priority: 1,
    action:   { type: 'block' },
    condition: {
      urlFilter:    url,
      resourceTypes: ['xmlhttprequest']
    }
  };

  await chrome.declarativeNetRequest.updateDynamicRules({
    addRules:    [rule],
    removeRuleIds: []
  });

  logBlockedRequest(url);
}

// 5) Автоматичне оновлення політик CSRF

// Завантажити й застосувати нові правила з GitHub
async function updatePolicies() {
  try {
    const resp = await fetch(POLICY_URL, { cache: 'no-store' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const rules = await resp.json(); // масив chrome.declarativeNetRequest.Rule

    // Видаляємо всі наші правила в діапазоні 1000–1999
    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    const toRemove = existing
      .filter(r => r.id >= 1000 && r.id < 2000)
      .map(r => r.id);

    // Оновлюємо правила
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: toRemove,
      addRules:      rules
    });

    console.log(`CSRF policies updated: ${rules.length} rules`);
    chrome.storage.local.set({ lastPolicyUpdate: Date.now() });
  } catch (e) {
    console.error('Failed to update CSRF policies:', e);
  }
}

// При встановленні/оновленні розширення — налаштовуємо alarm
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.clear(POLICY_ALARM, () => {
    // Запустити одразу й потім кожні 24 години
    chrome.alarms.create(POLICY_ALARM, {
      when:          Date.now(),
      periodInMinutes: 24 * 60
    });
  });
});

// При спрацюванні alarm — оновлюємо політики
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === POLICY_ALARM) {
    updatePolicies();
  }
});

// Перший запуск при старті воркера
updatePolicies();

// 6) Обробка повідомлень з popup.js / content.js

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Bot тепер блокуємо URL негайно
  if (msg.action === 'blockNow' && msg.url) {
    blockUrlDynamically(msg.url, msg.ruleId);
  }

  // Збереження результатів аудиту CSRF
  if (msg.type === 'CSRF_AUDIT') {
    const url  = sender.tab?.url || 'unknown';
    const host = (new URL(url).hostname) || 'unknown';
    const key  = `audit_${host}_${Date.now()}`;
    chrome.storage.local.set({ [key]: msg.payload });
  }
});
