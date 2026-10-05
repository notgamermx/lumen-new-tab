import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize, defaults, safeUrl } from '../extension/scripts/preferences.js';

test('upgrades old preferences without losing existing choices or hidden widgets', () => {
  const result = normalize({
    scene: 'custom',
    brightness: 62,
    showClock: false,
    showSearch: false,
    motion: false,
    mediaUpdated: 'previous-file',
  });
  assert.equal(result.scene, 'custom');
  assert.equal(result.brightness, 62);
  assert.equal(result.showClock, false);
  assert.equal(result.showDate, false);
  assert.equal(result.showGreeting, false);
  assert.equal(result.showLinks, false);
  assert.equal(result.mediaUpdated, 'previous-file');
  assert.equal(result.font, 'modern');
});
test('rejects executable URLs and credentials; accepts websites and adds https', () => {
  for (const value of [
    'javascript:alert(1)',
    'data:text/html,hi',
    'file:///C:/test',
    'https://user:pass@example.com',
    'not a url',
    '',
  ])
    assert.equal(safeUrl(value), null);
  assert.equal(safeUrl('example.com/test?q=hello'), 'https://example.com/test?q=hello');
  assert.equal(safeUrl('http://localhost:3000'), 'http://localhost:3000/');
});
test('validates persisted values and caps shortcuts', () => {
  const value = normalize({
    brightness: -20,
    blur: 100,
    clockSize: 999,
    speed: '99',
    timezone: 'no-zone',
    accent: 'red; display:none',
    links: [
      { label: 'bad', url: 'javascript:alert(1)' },
      { label: 'good', url: 'example.com' },
    ],
  });
  assert.equal(value.brightness, 20);
  assert.equal(value.blur, 16);
  assert.equal(value.clockSize, 180);
  assert.equal(value.speed, '1');
  assert.equal(value.timezone, 'local');
  assert.equal(value.accent, '#c8ddac');
  assert.deepEqual(value.links, [{ label: 'good', url: 'https://example.com/', icon: '' }]);
  assert.equal(
    normalize({ links: Array.from({ length: 20 }, () => ({ label: 'test', url: 'example.com' })) })
      .links.length,
    12,
  );
  assert.deepEqual(normalize(null), defaults());
});
test('preserves independent widget choices, empty links and reduced motion', () => {
  const result = normalize(
    {
      showClock: false,
      showDate: true,
      showGreeting: true,
      showSearch: false,
      showLinks: true,
      links: [],
    },
    true,
  );
  assert.equal(result.showDate, true);
  assert.equal(result.showLinks, true);
  assert.equal(result.motion, false);
  assert.deepEqual(result.links, []);
  assert.equal(normalize({ motion: true }, true).motion, true);
});
