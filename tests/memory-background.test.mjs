import test from 'node:test';
import assert from 'node:assert/strict';

const listeners = {};
const events = (name) => ({
  addListener: (fn) => {
    listeners[name] = fn;
  },
});
const stored = {},
  alarms = new Map(),
  discarded = [];
let access = false,
  tabs = [];
const base = {
  active: false,
  highlighted: false,
  pinned: false,
  audible: false,
  incognito: false,
  discarded: false,
  autoDiscardable: true,
  status: 'complete',
  url: 'https://example.com/',
  lastAccessed: Date.now() - 7200000,
};
globalThis.chrome = {
  runtime: {
    id: 'test',
    getURL: (path) => `chrome-extension://test/${path}`,
    onMessage: events('message'),
    onInstalled: events('installed'),
    onStartup: events('startup'),
  },
  permissions: { contains: async () => access, onRemoved: events('removed') },
  storage: {
    local: {
      get: async (key) => ({ [key]: stored[key] }),
      set: async (values) => Object.assign(stored, values),
    },
  },
  alarms: {
    clear: async (name) => alarms.delete(name),
    get: async (name) => alarms.get(name),
    create: async (name, value) => alarms.set(name, value),
    onAlarm: events('alarm'),
  },
  tabs: {
    query: async () => tabs.map((tab) => ({ ...tab })),
    get: async (id) => ({ ...tabs.find((tab) => tab.id === id) }),
    discard: async (id) => {
      discarded.push(id);
      const tab = tabs.find((tab) => tab.id === id);
      tab.discarded = true;
      return { ...tab };
    },
  },
};
await import('../extension/scripts/memory-background.js');
const sender = { id: 'test', url: 'chrome-extension://test/newtab.html' };
const request = (type, config) =>
  new Promise((resolve) => listeners.message({ type, config }, sender, resolve));

test('non-Error API rejections still return a response and leave the queue usable', async () => {
  const contains = chrome.permissions.contains;
  chrome.permissions.contains = () => Promise.reject(undefined);
  try {
    assert.deepEqual(await request('memory:sleep'), {
      ok: false,
      error: 'The memory action could not be completed.',
    });
  } finally {
    chrome.permissions.contains = contains;
  }
  assert.equal((await request('memory:status')).ok, true);
});

test('rejects messages from outside the extension and requires access to enable sleeping', async () => {
  assert.equal(
    listeners.message(
      { type: 'memory:sleep' },
      { id: 'other', url: 'https://example.com' },
      () => {},
    ),
    undefined,
  );
  const response = await request('memory:save', { enabled: true });
  assert.equal(response.ok, false);
  assert.equal(alarms.size, 0);
  assert.equal((await request('memory:sleep')).value.unavailable, true);
});
test('manual sleeping rechecks tabs and honors exclusions even with automatic mode off', async () => {
  access = true;
  discarded.length = 0;
  tabs = [
    { ...base, id: 1 },
    { ...base, id: 2, pinned: true },
    { ...base, id: 3, audible: true },
    { ...base, id: 4, url: 'https://sub.protected.test/' },
    { ...base, id: 5, active: true },
  ];
  await request('memory:save', {
    enabled: false,
    keepRecent: 0,
    excludedHosts: ['protected.test'],
  });
  assert.equal((await request('memory:sleep')).value.slept, 1);
  assert.deepEqual(discarded, [1]);
  assert.equal(alarms.size, 0);
  assert.equal(stored.memoryLastRun.slept, 1);
});
test('automatic runs use a bounded batch and alarms stop when disabled or access is removed', async () => {
  tabs = Array.from({ length: 15 }, (_, i) => ({ ...base, id: i + 10 }));
  discarded.length = 0;
  await request('memory:save', { enabled: true, keepRecent: 0, excludedHosts: [] });
  assert.equal(alarms.get('lumen-memory-sweep').periodInMinutes, 1);
  listeners.alarm({ name: 'lumen-memory-sweep' });
  await request('memory:status');
  assert.equal(discarded.length, 10);
  assert.equal(stored.memoryLastRun.manual, false);
  await request('memory:save', { enabled: false });
  assert.equal(alarms.size, 0);
  await request('memory:save', { enabled: true });
  access = false;
  listeners.removed({ permissions: ['tabs'] });
  const status = (await request('memory:status')).value;
  assert.equal(status.config.enabled, false);
  assert.equal(alarms.size, 0);
});
