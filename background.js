// background.js (MV3 + DNR + CSRF Audit + Auto-update with fallback)+

// Константи
const COLOR_MAP = {
  green:  '#2ecc71',
  yellow: '#f1c40f',
  red:    '#e74c3c'
};

// ваше raw-посилання на csf_rules.json у GitHub
const POLICY_URL  = 'https://raw.githubusercontent.com/orlivskavaleriia/csrf_detector/main/csrf_rules.json';
const POLICY_ALARM = 'updatePolicies';

// Налаштування (зберігаємо у chrome.storage)
let settings = { autoBlock: true, trustedDomains: [] };

chrome.storage.local.get(
  ['autoBlock','trustedDomains'],
  ({ autoBlock, trustedDomains }) => {
    if (typeof autoBlock === 'boolean')      settings.autoBlock      = autoBlock;
    if (Array.isArray(trustedDomains))      settings.trustedDomains = trustedDomains;
  }
);
chrome.storage.onChanged.addListener(changes => {
  if (changes.autoBlock)      settings.autoBlock      = changes.autoBlock.newValue;
  if (changes.trustedDomains) settings.trustedDomains = changes.trustedDomains.newValue;
});

// Логування
function logEvent(e) {
  chrome.storage.local.get({ eventHistory: [] }, ({ eventHistory }) => {
    eventHistory.push(e);
    chrome.storage.local.set({ eventHistory });
  });
}

function logBlocked(url) {
  chrome.storage.local.get({ blockedRequests: [] }, ({ blockedRequests }) => {
    blockedRequests.push({ url, timestamp: Date.now() });
    chrome.storage.local.set({ blockedRequests });
  });
}

// 1) Аналіз заголовків (onBeforeSendHeaders)
function analyzeHeaders({ url, requestHeaders }) {
  const hdrs = {};
  (requestHeaders||[]).forEach(h => hdrs[h.name.toLowerCase()] = h.value);

  const origin = hdrs.origin;
  const referer = hdrs.referer;
  const { hostname, origin: target } = new URL(url);
  let risk = 'green';

  if (origin) {
    if (origin !== target) risk = 'red';
  } else if (referer) {
    try { if (new URL(referer).origin !== target) risk = 'red'; }
    catch { risk = 'red'; }
  } else {
    risk = 'red';
  }

  if (risk === 'red' && settings.trustedDomains.includes(hostname)) {
    risk = 'yellow';
  }

  chrome.action.setBadgeText({ text: risk[0].toUpperCase() });
  chrome.action.setBadgeBackgroundColor({ color: COLOR_MAP[risk] });
  logEvent({ url, risk, timestamp: Date.now() });
}

chrome.webRequest.onBeforeSendHeaders.addListener(
  analyzeHeaders,
  { urls: ['<all_urls>'] },
  ['requestHeaders','extraHeaders']
);

// 2) Динамічне блокування (DNR)
async function blockNow(url, ruleId = Date.now() % 100000) {
  if (!settings.autoBlock) return;
  const rule = {
    id: ruleId,
    priority: 1,
    action: { type: 'block' },
    condition: { urlFilter: url, resourceTypes: ['xmlhttprequest'] }
  };
  await chrome.declarativeNetRequest.updateDynamicRules({
    addRules: [rule], removeRuleIds: []
  });
  logBlocked(url);
}

// 3) Оновлення політик із GitHub + fallback
async function applyRules(rules) {
  // видалимо старі правила 1000–1999
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const toRemove = existing.filter(r => r.id >= 1000 && r.id < 2000).map(r => r.id);

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: toRemove,
    addRules:      rules
  });
  chrome.storage.local.set({ lastPolicyUpdate: Date.now() });
  console.log(`Applied ${rules.length} CSRF rules`);
}

async function loadLocalRules() {
  try {
    const resp = await fetch(chrome.runtime.getURL('csrf_rules.json'));
    const rules = await resp.json();
    await applyRules(rules);
    console.warn('⚠️ Fallback: loaded local csrf_rules.json');
  } catch (e) {
    console.error('Fallback loadLocalRules failed:', e);
  }
}

async function updatePolicies() {
  try {
    const resp = await fetch(POLICY_URL, { cache: 'no-store' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const rules = await resp.json();
    await applyRules(rules);
  } catch (e) {
    console.error('Failed to fetch remote CSRF policies:', e);
    await loadLocalRules();
  }
}

// alarm на оновлення раз на добу
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.clear(POLICY_ALARM, () => {
    chrome.alarms.create(POLICY_ALARM, {
      when: Date.now(),
      periodInMinutes: 24 * 60
    });
  });
});
chrome.alarms.onAlarm.addListener(a => {
  if (a.name === POLICY_ALARM) updatePolicies();
});
// перший старт
updatePolicies();

// 4) Обробник повідомлень
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.action === 'blockNow' && msg.url) {
    blockNow(msg.url, msg.ruleId);
  }
  if (msg.type === 'CSRF_AUDIT') {
    const tabUrl = sender.tab?.url || '';
    const host   = tabUrl ? new URL(tabUrl).hostname : 'unknown';
    const key    = `audit_${host}_${Date.now()}`;
    chrome.storage.local.set({ [key]: msg.payload });
  }
});
