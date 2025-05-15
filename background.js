// background.js

const COLOR_MAP = {
  green:  '#2ecc71',
  yellow: '#f1c40f',
  red:    '#e74c3c'
};

let settings = { autoBlock: true, trustedDomains: [] };
const pageStatus = {};  // tabId → 'green'|'yellow'|'red'

// Завантажуємо налаштування
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

// Лог подій
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
