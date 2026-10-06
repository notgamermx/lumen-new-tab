import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeMemory,
  normalizeHosts,
  isEligible,
  selectCandidates,
} from '../extension/scripts/memory-policy.js';
const now = 100000000;
const tab = {
  id: 1,
  active: false,
  highlighted: false,
  autoDiscardable: true,
  status: 'complete',
  url: 'https://example.com/',
  lastAccessed: now - 3600000,
};
const config = normalizeMemory({ keepRecent: 0 });

test('automatic sleeping is off by default and rules are bounded', () => {
  assert.equal(normalizeMemory().enabled, false);
  assert.equal(normalizeMemory({ timeoutMinutes: 0, keepRecent: 100 }).timeoutMinutes, 30);
  assert.equal(normalizeMemory({ keepRecent: 100 }).keepRecent, 3);
});
test('protects active, pinned, audible, selected, loading, capture and private tabs', () => {
  assert.equal(isEligible(tab, config, now), true);
  for (const patch of [
    { active: true },
    { highlighted: true },
    { pinned: true },
    { audible: true },
    { incognito: true },
    { discarded: true },
    { autoDiscardable: false },
    { status: 'loading' },
    { pendingUrl: 'https://next.example/' },
    { mutedInfo: { reason: 'capture' } },
    { splitViewId: 4 },
    { id: -1 },
  ])
    assert.equal(isEligible({ ...tab, ...patch }, config, now), false);
});
test('respects inactivity and refuses missing or untrusted tab metadata', () => {
  for (const patch of [
    { lastAccessed: now - 60000 },
    { lastAccessed: undefined },
    { lastAccessed: 0 },
    { url: undefined },
    { url: 'chrome://settings' },
    { url: 'file:///tmp/page' },
    { url: 'chrome-extension://id/newtab.html' },
  ])
    assert.equal(isEligible({ ...tab, ...patch }, config, now), false);
});
test('exclusions match hosts and subdomains without matching lookalike sites', () => {
  const protectedConfig = normalizeMemory({
    excludedHosts: 'https://example.com/path\n*.my-site.com\nexample.com\njavascript:alert(1)',
  });
  assert.deepEqual(protectedConfig.excludedHosts, ['example.com', 'my-site.com']);
  assert.equal(
    isEligible({ ...tab, url: 'https://sub.example.com/' }, protectedConfig, now),
    false,
  );
  assert.equal(isEligible({ ...tab, url: 'https://notexample.com/' }, protectedConfig, now), true);
  assert.equal(normalizeHosts(Array(150).fill('example.com')).length, 1);
});
test('keeps recent background tabs and sleeps oldest eligible tabs first', () => {
  const tabs = [
    tab,
    { ...tab, id: 2, lastAccessed: now - 7200000 },
    { ...tab, id: 3, lastAccessed: now - 10800000 },
  ];
  assert.deepEqual(
    selectCandidates(tabs, { ...config, keepRecent: 2 }, now).map((value) => value.id),
    [3],
  );
  assert.deepEqual(
    selectCandidates(tabs, config, now).map((value) => value.id),
    [3, 2, 1],
  );
});
