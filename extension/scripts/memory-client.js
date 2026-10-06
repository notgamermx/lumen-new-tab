const $ = (id) => document.getElementById(id);
let busy = false;
async function request(type, config) {
  const result = await chrome.runtime.sendMessage({ type, config });
  if (!result?.ok)
    throw new Error(
      result?.error || 'The memory service is unavailable. Reload the extension and try again.',
    );
  return result.value;
}
function message(text, error = false) {
  $('memory-result').textContent = text;
  $('memory-result').classList.toggle('error', error);
}
function render(status) {
  const { config, connected } = status;
  $('memory-enabled').checked = config.enabled && connected;
  $('memory-timeout').value = config.timeoutMinutes;
  $('memory-recent').value = config.keepRecent;
  if (document.activeElement !== $('memory-exclusions'))
    $('memory-exclusions').value = config.excludedHosts.join('\n');
  $('memory-connect').hidden = connected;
  $('memory-disconnect').hidden = !connected;
  for (const id of [
    'memory-enabled',
    'memory-timeout',
    'memory-recent',
    'memory-exclusions',
    'memory-save-exclusions',
    'memory-sleep',
  ])
    $(id).disabled = busy || !connected;
  $('memory-counts').textContent = connected
    ? `${status.sleeping} sleeping · ${status.eligible} eligible · ${status.total} tabs`
    : 'Tab access is off.';
  $('memory-state').textContent =
    config.enabled && connected ? 'Automatic sleeping is on.' : 'Automatic sleeping is off.';
}
async function refresh() {
  try {
    render(await request('memory:status'));
  } catch (error) {
    message(error.message, true);
  }
}
async function action(task) {
  if (busy) return;
  busy = true;
  for (const el of document.querySelectorAll(
    '#panel-memory button, #panel-memory input, #panel-memory select, #panel-memory textarea',
  ))
    el.disabled = true;
  try {
    await task();
  } catch (error) {
    message(error.message, true);
  } finally {
    busy = false;
    $('memory-connect').disabled =
      $('memory-disconnect').disabled =
      $('memory-refresh').disabled =
        false;
    await refresh();
  }
}
function configFromControls() {
  return {
    enabled: $('memory-enabled').checked,
    timeoutMinutes: Number($('memory-timeout').value),
    keepRecent: Number($('memory-recent').value),
    excludedHosts: $('memory-exclusions').value,
  };
}
$('memory-connect').addEventListener('click', () => {
  // Request must happen directly inside the user's click handler.
  const grant = chrome.permissions.request({ permissions: ['tabs'] });
  action(async () => {
    message(
      (await grant)
        ? 'Tab access enabled. Choose whether to use automatic sleeping.'
        : 'Tab access was not enabled.',
    );
  });
});
$('memory-disconnect').addEventListener('click', () =>
  action(async () => {
    await request('memory:save', { ...configFromControls(), enabled: false });
    await chrome.permissions.remove({ permissions: ['tabs'] });
    message('Tab access removed. Automatic sleeping is off.');
  }),
);
for (const id of ['memory-enabled', 'memory-timeout', 'memory-recent'])
  $(id).addEventListener('change', () =>
    action(async () => {
      await request('memory:save', configFromControls());
      message('Memory settings saved.');
    }),
  );
$('memory-save-exclusions').addEventListener('click', () =>
  action(async () => {
    await request('memory:save', configFromControls());
    message('Protected websites saved.');
  }),
);
$('memory-sleep').addEventListener('click', () =>
  action(async () => {
    message('Sleeping eligible background tabs…');
    const result = await request('memory:sleep');
    message(
      result.unavailable
        ? 'Enable tab access first.'
        : `${result.slept} ${result.slept === 1 ? 'tab' : 'tabs'} put to sleep.${result.remaining ? ` ${result.remaining} more eligible; run again for the next batch.` : ''}${result.skipped ? ` ${result.skipped} skipped by the browser or protections.` : ''}`,
    );
  }),
);
$('memory-refresh').addEventListener('click', refresh);
document.querySelector('[data-panel=memory]').addEventListener('click', refresh);
chrome.storage.onChanged.addListener((changes, area) => {
  if (
    area === 'local' &&
    (changes.memoryConfig || changes.memoryLastRun) &&
    !$('panel-memory').hidden
  )
    refresh();
});
