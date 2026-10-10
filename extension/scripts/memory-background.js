import { normalizeMemory, selectCandidates, isEligible } from './memory-policy.js';

const alarmName = 'lumen-memory-sweep';
let queue = Promise.resolve();
function enqueue(task) {
  const result = queue.then(task);
  queue = result.catch(() => {});
  return result;
}
const hasAccess = () => chrome.permissions.contains({ permissions: ['tabs'] });
async function getConfig() {
  const { memoryConfig } = await chrome.storage.local.get('memoryConfig');
  return normalizeMemory(memoryConfig);
}
async function maintainAlarm() {
  const config = await getConfig();
  if (!config.enabled || !(await hasAccess())) {
    await chrome.alarms.clear(alarmName);
    return;
  }
  if (!(await chrome.alarms.get(alarmName)))
    await chrome.alarms.create(alarmName, { periodInMinutes: 1 });
}
async function getStatus() {
  const [config, connected, saved] = await Promise.all([
    getConfig(),
    hasAccess(),
    chrome.storage.local.get('memoryLastRun'),
  ]);
  const tabs = connected ? await chrome.tabs.query({ windowType: 'normal' }) : [];
  return {
    config,
    connected,
    total: tabs.length,
    sleeping: tabs.filter((tab) => tab.discarded).length,
    eligible: selectCandidates(tabs, config).length,
    lastRun: saved.memoryLastRun || null,
  };
}
async function sweep(manual = false) {
  const config = await getConfig();
  if (!(await hasAccess()) || (!manual && !config.enabled)) return { slept: 0, unavailable: true };
  const tabs = await chrome.tabs.query({ windowType: 'normal' });
  const candidates = selectCandidates(tabs, config);
  let slept = 0,
    skipped = 0;
  // A small batch avoids abruptly reloading a large browsing session later.
  for (const candidate of candidates.slice(0, 10)) {
    try {
      const current = await chrome.tabs.get(candidate.id);
      if (!isEligible(current, config)) {
        skipped++;
        continue;
      }
      const result = await chrome.tabs.discard(current.id);
      if (result?.discarded) slept++;
      else skipped++;
    } catch {
      skipped++;
    }
  }
  const result = {
    slept,
    skipped,
    remaining: Math.max(0, candidates.length - 10),
    at: Date.now(),
    manual,
  };
  if (manual || slept) await chrome.storage.local.set({ memoryLastRun: result });
  return result;
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (
    sender.id !== chrome.runtime.id ||
    !sender.url?.startsWith(chrome.runtime.getURL('')) ||
    !['memory:status', 'memory:save', 'memory:sleep'].includes(message?.type)
  )
    return;
  enqueue(async () => {
    if (message.type === 'memory:status') return getStatus();
    if (message.type === 'memory:sleep') return sweep(true);
    const config = normalizeMemory(message.config);
    if (config.enabled && !(await hasAccess()))
      throw new Error('Enable tab access before turning on automatic sleeping.');
    await chrome.storage.local.set({ memoryConfig: config });
    await maintainAlarm();
    return getStatus();
  }).then(
    (value) => respond({ ok: true, value }),
    (error) =>
      respond({ ok: false, error: error?.message || 'The memory action could not be completed.' }),
  );
  return true;
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === alarmName) enqueue(() => sweep()).catch(() => {});
});
chrome.runtime.onInstalled.addListener(() => enqueue(maintainAlarm));
chrome.runtime.onStartup.addListener(() => enqueue(maintainAlarm));
chrome.permissions.onRemoved.addListener((change) => {
  if (change.permissions.includes('tabs'))
    enqueue(async () => {
      const config = await getConfig();
      config.enabled = false;
      await chrome.storage.local.set({ memoryConfig: config });
      await maintainAlarm();
    });
});
enqueue(maintainAlarm).catch(() => {});
