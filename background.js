// background.js

const COLOR_MAP = {
  green:  '#2ecc71',
  yellow: '#f1c40f',
  red:    '#e74c3c'
};

let settings = { autoBlock: true, trustedDomains: [] };

// Завантажуємо налаштування з storage
chrome.storage.local.get(
  ['autoBlock','trustedDomains'],
  data => {
    if (typeof data.autoBlock === 'boolean')
      settings.autoBlock = data.autoBlock;
    if (Array.isArray(data.trustedDomains))
      settings.trustedDomains = data.trustedDomains;
  }
);
chrome.storage.onChanged.addListener(changes => {
  if (changes.autoBlock)      settings.autoBlock      = changes.autoBlock.newValue;
  if (changes.trustedDomains) settings.trustedDomains = changes.trustedDomains.newValue;
});

// Лог подій у storage
function logEvent(e) {
  chrome.storage.local.get({ eventHistory: [] }, ({ eventHistory })=> {
    eventHistory.push(e);
    chrome.storage.local.set({ eventHistory });
  });
}

// 1) Аналізуємо заголовки (без блокування на цьому рівні)
chrome.webRequest.onBeforeSendHeaders.addListener(
  details => {
    const hdrs = {};
    (details.requestHeaders||[]).forEach(h=> hdrs[h.name.toLowerCase()]=h.value);
    const urlOrigin = new URL(details.url).origin;
    const originHdr = hdrs.origin;
    const referer   = hdrs.referer;
    let risk = 'green';

    if (originHdr) {
      if (originHdr !== urlOrigin) risk = 'red';
    } else if (referer) {
      try { if (new URL(referer).origin !== urlOrigin) risk = 'red'; }
      catch { risk = 'red'; }
    } else {
      risk = 'red';
    }

    // Белый список доменів → рівень “жовтий”
    const host = new URL(details.url).hostname;
    if (risk === 'red' && settings.trustedDomains.includes(host)) {
      risk = 'yellow';
    }

    // Оновлюємо бейдж
    chrome.action.setBadgeText({ text: risk[0].toUpperCase() });
    chrome.action.setBadgeBackgroundColor({ color: COLOR_MAP[risk] });

    // Лог
    logEvent({ url: details.url, risk, timestamp: Date.now() });

    // Сповіщаємо користувача, якщо високий ризик
    if (risk === 'red' && settings.autoBlock) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icon.png',
        title: 'Можлива CSRF-атака',
        message: `Запит до ${details.url} з іншого джерела.`,
        requireInteraction: false
      });
    }

    // Не блокуємо на цьому рівні — контент-скрипт поставить confirm
    return {};
  },
  { urls: ['<all_urls>'] },
  ['requestHeaders']
);
