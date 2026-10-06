import { Landscape } from './scene.js';
import { mediaStore } from './storage.js';
import { defaults, normalize, safeUrl, engines, ranges, choices, flags } from './preferences.js';
import './memory-client.js';

const $ = (id) => document.getElementById(id);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const sceneNames = { aurora: 'Northern lights', dusk: 'Golden hour', ocean: 'Blue current' };
let settings = readSettings(),
  savedMedia,
  objectUrl,
  uploadBusy = false,
  mediaRevision = 0,
  toastTimer;
let renderedLinks = '',
  editingLink = -1;
const controlKeys = [
  ...flags,
  ...Object.keys(ranges),
  ...Object.keys(choices).filter((key) => key !== 'scene'),
  'accent',
  'textColor',
  'name',
  'greeting',
];
const control = (key) => $(key === 'greeting' ? 'greeting-input' : key);
const landscape = new Landscape($('landscape'));
function readSettings() {
  let value = {};
  try {
    value = JSON.parse(localStorage.getItem('lumen-settings') || '{}') || {};
  } catch {
    /* Use safe defaults. */
  }
  return normalize(value, reducedMotion);
}
function toast(message) {
  $('toast').textContent = message;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    $('toast').hidden = true;
  }, 5000);
}
function save() {
  try {
    localStorage.setItem('lumen-settings', JSON.stringify(settings));
  } catch {
    toast('Your browser could not save these settings. Free some device storage and try again.');
  }
}
function clock() {
  const now = new Date();
  const zone = settings.timezone === 'local' ? {} : { timeZone: settings.timezone };
  const parts = new Intl.DateTimeFormat(undefined, {
    ...zone,
    hour: '2-digit',
    minute: '2-digit',
    ...(settings.seconds ? { second: '2-digit' } : {}),
    hour12: !settings.hour24,
  }).formatToParts(now);
  $('clock').textContent = parts
    .filter((p) => p.type !== 'dayPeriod')
    .map((p) => p.value)
    .join('')
    .trim();
  $('clock').dateTime = now.toISOString();
  $('period').textContent = parts.find((p) => p.type === 'dayPeriod')?.value || '';
  $('date').textContent = new Intl.DateTimeFormat(undefined, {
    ...zone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(now);
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { ...zone, hour: 'numeric', hourCycle: 'h23' }).format(now),
  );
  const salutation =
    hour < 5 ? 'Hello' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  $('greeting').textContent = settings.greeting.trim()
    ? settings.greeting.replaceAll('{name}', settings.name.trim() || 'friend')
    : settings.name.trim()
      ? `${salutation}, ${settings.name.trim()}.`
      : salutation;
}
function syncMotion() {
  const playing = settings.motion && !document.hidden;
  landscape.setRunning(playing && settings.scene !== 'custom');
  if (playing && settings.scene === 'custom' && savedMedia?.kind === 'video') {
    $('video')
      .play()
      .catch(() => {
        if (!document.hidden && settings.motion)
          toast('Press the play button to start your wallpaper.');
      });
  } else $('video').pause();
  $('pause').textContent = settings.motion ? 'Ⅱ' : '▷';
  const label = settings.motion ? 'Pause wallpaper' : 'Play wallpaper';
  $('pause').setAttribute('aria-label', label);
  $('pause').title = label;
  $('pause').disabled = settings.scene === 'custom' && savedMedia?.kind === 'image';
}
function apply() {
  document.documentElement.style.setProperty('--brightness', settings.brightness / 100);
  document.documentElement.style.setProperty('--blur', `${settings.blur}px`);
  const root = document.documentElement;
  for (const [key, value] of Object.entries({
    saturation: settings.saturation / 100,
    overlay: settings.overlay / 100,
    accent: settings.accent,
    'widget-color': settings.textColor,
    'clock-size': `${settings.clockSize}px`,
    glass: settings.glass / 100,
    'position-x': `${settings.positionX}%`,
    'position-y': `${settings.positionY}%`,
    fit: settings.fit,
  }))
    root.style.setProperty(`--${key}`, value);
  for (const key of ['font', 'layout', 'vertical', 'linkStyle', 'searchStyle'])
    document.body.dataset[key] = settings[key];
  document.body.classList.toggle('with-seconds', settings.seconds);
  document.querySelector('header').hidden = !settings.showBrand;
  $('clock-line').hidden = !settings.showClock;
  $('date').hidden = !settings.showDate;
  $('greeting').hidden = !settings.showGreeting;
  $('clock-block').hidden = !settings.showClock && !settings.showDate && !settings.showGreeting;
  $('search').hidden = !settings.showSearch;
  $('shortcuts').hidden = !settings.showLinks;
  $('search').action = engines[settings.engine];
  for (const key of controlKeys) {
    const el = control(key);
    if (el.type === 'checkbox') el.checked = settings[key];
    else if (document.activeElement !== el) el.value = settings[key];
    if ($(key + '-value'))
      $(key + '-value').textContent =
        `${settings[key]}${['blur', 'clockSize'].includes(key) ? ' px' : '%'}`;
  }
  $('video').playbackRate = Number(settings.speed);
  landscape.speed = Number(settings.speed);
  renderLinks();
  for (const button of document.querySelectorAll('[data-scene]'))
    button.setAttribute('aria-pressed', String(button.dataset.scene === settings.scene));
  const custom = settings.scene === 'custom' && savedMedia;
  $('landscape').hidden = Boolean(custom);
  $('video').hidden = !custom || savedMedia.kind !== 'video';
  $('photo').hidden = !custom || savedMedia.kind !== 'image';
  if (!custom) landscape.setScene(settings.scene === 'custom' ? 'aurora' : settings.scene);
  $('scene-name').textContent = custom
    ? savedMedia.name
    : sceneNames[settings.scene] || sceneNames.aurora;
  $('saved-media').hidden = !savedMedia;
  $('use-saved').textContent = savedMedia
    ? `Use ${savedMedia.kind === 'video' ? 'saved video' : 'saved image'}`
    : 'Use saved wallpaper';
  clock();
  syncMotion();
}
function attachMedia(record) {
  $('video').pause();
  $('video').removeAttribute('src');
  $('video').load();
  $('photo').removeAttribute('src');
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = undefined;
  savedMedia = record;
  if (record) {
    objectUrl = URL.createObjectURL(record.blob);
    $(record.kind === 'video' ? 'video' : 'photo').src = objectUrl;
  }
}
function validateFile(file, kind) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const probe = document.createElement(kind === 'video' ? 'video' : 'img');
    const finish = (error) => {
      clearTimeout(timer);
      probe.onload = probe.onloadeddata = probe.onerror = null;
      probe.removeAttribute('src');
      if (kind === 'video') probe.load();
      URL.revokeObjectURL(url);
      error ? reject(error) : resolve();
    };
    const timer = setTimeout(
      () => finish(new Error('This file took too long to open. Try a smaller file.')),
      20000,
    );
    probe.onerror = () =>
      finish(
        new Error(
          'This file could not be played. Try an H.264 MP4, WebM, or a JPG/PNG/WebP image.',
        ),
      );
    if (kind === 'video') {
      probe.muted = true;
      probe.preload = 'auto';
      probe.onloadeddata = () => finish();
    } else probe.onload = () => finish();
    probe.src = url;
  });
}
function setUploadBusy(busy) {
  uploadBusy = busy;
  for (const el of [
    $('upload'),
    $('remove-saved'),
    $('use-saved'),
    ...document.querySelectorAll('[data-scene]'),
  ])
    el.disabled = busy;
  $('upload-label').textContent = busy ? 'Preparing your wallpaper…' : 'Choose a video or image';
}
$('upload').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file || uploadBusy) return;
  $('upload-status').classList.remove('error');
  setUploadBusy(true);
  try {
    const kind = /\.(mp4|webm)$/i.test(file.name)
      ? 'video'
      : /\.(jpe?g|png|webp)$/i.test(file.name)
        ? 'image'
        : null;
    if (!kind) throw new Error('Choose an MP4, WebM, JPG, PNG, or WebP file.');
    if (!file.size || file.size > 150 * 1024 * 1024)
      throw new Error('Choose a non-empty file smaller than 150 MB.');
    $('upload-status').textContent = 'Checking your file and saving it on this device…';
    await validateFile(file, kind);
    const record = { blob: file, kind, name: file.name };
    await mediaStore('put', record);
    mediaRevision++;
    attachMedia(record);
    settings.scene = 'custom';
    // A revision lets other open new tabs refresh a replaced custom wallpaper.
    settings.mediaUpdated = `${Date.now()}-${Math.random()}`;
    save();
    apply();
    $('upload-status').textContent = 'Wallpaper saved. It will be here on your next new tab.';
  } catch (error) {
    $('upload-status').textContent =
      error.name === 'QuotaExceededError'
        ? 'Not enough browser storage. Try a smaller file or free some device space.'
        : error.message || 'Could not save this file. Please try again.';
    $('upload-status').classList.add('error');
  } finally {
    setUploadBusy(false);
    event.target.value = '';
  }
});
for (const button of document.querySelectorAll('[data-scene]'))
  button.addEventListener('click', () => {
    settings.scene = button.dataset.scene;
    save();
    apply();
  });
$('use-saved').addEventListener('click', () => {
  if (savedMedia) {
    settings.scene = 'custom';
    save();
    apply();
  }
});
$('remove-saved').addEventListener('click', async () => {
  setUploadBusy(true);
  try {
    await mediaStore('delete');
    mediaRevision++;
    attachMedia(undefined);
    if (settings.scene === 'custom') settings.scene = 'aurora';
    settings.mediaUpdated = `${Date.now()}-${Math.random()}`;
    save();
    apply();
    $('upload-status').textContent = 'Saved wallpaper removed from this device.';
  } catch {
    toast('Could not remove the saved wallpaper. Please try again.');
  } finally {
    setUploadBusy(false);
  }
});
for (const key of controlKeys) {
  control(key).addEventListener('input', () => {
    const el = control(key);
    settings[key] =
      el.type === 'checkbox' ? el.checked : el.type === 'range' ? Number(el.value) : el.value;
    save();
    apply();
  });
}
function renderLinks() {
  const serialized = JSON.stringify([settings.links, settings.newTabLinks]);
  if (renderedLinks === serialized) return;
  renderedLinks = serialized;
  $('shortcuts').replaceChildren();
  $('link-list').replaceChildren();
  settings.links.forEach((link, index) => {
    const anchor = document.createElement('a');
    anchor.href = link.url;
    if (settings.newTabLinks) {
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
    }
    const icon = document.createElement('span');
    icon.textContent = link.icon || link.label[0].toUpperCase();
    const label = document.createElement('span');
    label.className = 'link-name';
    label.textContent = link.label;
    anchor.append(icon, label);
    $('shortcuts').append(anchor);
    const row = document.createElement('div');
    row.className = 'link-row';
    const title = document.createElement('span');
    title.textContent = link.label;
    title.title = link.url;
    row.append(title);
    for (const [action, symbol, description] of [
      ['up', '↑', 'Move up'],
      ['down', '↓', 'Move down'],
      ['edit', 'Edit', 'Edit'],
      ['remove', '×', 'Remove'],
    ]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = symbol;
      button.dataset.action = action;
      button.dataset.index = index;
      button.setAttribute('aria-label', `${description} ${link.label}`);
      button.disabled =
        (action === 'up' && index === 0) ||
        (action === 'down' && index === settings.links.length - 1);
      row.append(button);
    }
    $('link-list').append(row);
  });
}
function clearLinkEditor() {
  editingLink = -1;
  $('link-form').reset();
  $('link-form-title').textContent = 'Add a shortcut';
  $('save-link').textContent = 'Add shortcut';
  $('cancel-link').hidden = true;
  $('link-error').textContent = '';
}
$('link-list').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const index = Number(button.dataset.index),
    action = button.dataset.action;
  if (action === 'edit') {
    editingLink = index;
    const link = settings.links[index];
    $('link-label').value = link.label;
    $('link-url').value = link.url;
    $('link-icon').value = link.icon;
    $('link-form-title').textContent = 'Edit shortcut';
    $('save-link').textContent = 'Save shortcut';
    $('cancel-link').hidden = false;
    $('link-error').textContent = '';
    $('link-label').focus();
    return;
  }
  if (action === 'remove') settings.links.splice(index, 1);
  else {
    const next = index + (action === 'up' ? -1 : 1);
    if (next < 0 || next >= settings.links.length) return;
    [settings.links[index], settings.links[next]] = [settings.links[next], settings.links[index]];
  }
  clearLinkEditor();
  save();
  apply();
});
$('link-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const label = $('link-label').value.trim(),
    url = safeUrl($('link-url').value);
  if (!label || !url) {
    $('link-error').textContent = 'Enter a name and a valid http:// or https:// website.';
    return;
  }
  if (editingLink < 0 && settings.links.length >= 12) {
    $('link-error').textContent = 'You can add up to 12 shortcuts. Remove one to make space.';
    return;
  }
  const link = { label, url, icon: $('link-icon').value.trim() };
  if (editingLink < 0) settings.links.push(link);
  else settings.links[editingLink] = link;
  clearLinkEditor();
  save();
  apply();
});
$('cancel-link').addEventListener('click', clearLinkEditor);
for (const button of document.querySelectorAll('[data-panel]'))
  button.addEventListener('click', () => {
    for (const panel of document.querySelectorAll('.settings-panel'))
      panel.hidden = panel.id !== `panel-${button.dataset.panel}`;
    for (const item of document.querySelectorAll('[data-panel]'))
      item === button
        ? item.setAttribute('aria-current', 'page')
        : item.removeAttribute('aria-current');
    $('settings').scrollTop = 0;
  });
const looks = {
  calm: {
    font: 'modern',
    clockSize: 142,
    accent: '#c8ddac',
    textColor: '#f0f3ef',
    layout: 'center',
    vertical: 'center',
    glass: 6,
    linkStyle: 'minimal',
    searchStyle: 'soft',
  },
  editorial: {
    font: 'serif',
    clockSize: 130,
    accent: '#e5b38e',
    textColor: '#fff2df',
    layout: 'left',
    vertical: 'center',
    glass: 12,
    linkStyle: 'minimal',
    searchStyle: 'square',
  },
  terminal: {
    font: 'mono',
    clockSize: 110,
    accent: '#86efcb',
    textColor: '#c9ffe9',
    layout: 'center',
    vertical: 'center',
    glass: 16,
    linkStyle: 'tiles',
    searchStyle: 'soft',
  },
};
for (const button of document.querySelectorAll('[data-look]'))
  button.addEventListener('click', () => {
    Object.assign(settings, looks[button.dataset.look]);
    save();
    apply();
    toast('Preset applied.');
  });
$('reset-style').addEventListener('click', () => {
  const fresh = defaults(reducedMotion);
  for (const key of [
    'font',
    'clockSize',
    'accent',
    'textColor',
    'layout',
    'vertical',
    'glass',
    'linkStyle',
    'searchStyle',
    'showClock',
    'showSearch',
    'showDate',
    'showGreeting',
    'showLinks',
    'showBrand',
    'hour24',
    'seconds',
    'timezone',
    'name',
    'greeting',
    'engine',
    'newTabLinks',
  ])
    settings[key] = fresh[key];
  save();
  apply();
  toast('Appearance and widgets reset. Wallpaper and shortcuts kept.');
});
function focusMode(enabled) {
  document.body.classList.toggle('wallpaper-only', enabled);
  $('focus').setAttribute('aria-pressed', String(enabled));
  $('focus').setAttribute('aria-label', enabled ? 'Show widgets' : 'Show only wallpaper');
  $('focus').title = enabled ? 'Show widgets (Esc)' : 'Show only wallpaper';
}
$('focus').addEventListener('click', () =>
  focusMode(!document.body.classList.contains('wallpaper-only')),
);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !$('settings').open) focusMode(false);
});
$('pause').addEventListener('click', () => {
  settings.motion = !settings.motion;
  save();
  apply();
});
$('customize').addEventListener('click', () => $('settings').showModal());
$('close-settings').addEventListener('click', () => $('settings').close());
$('settings').addEventListener('click', (event) => {
  const rect = $('settings').getBoundingClientRect();
  if (
    event.target === $('settings') &&
    (event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom)
  )
    $('settings').close();
});
document.addEventListener('visibilitychange', () => {
  syncMotion();
  clock();
});
window.addEventListener('storage', async (event) => {
  if (event.key !== 'lumen-settings' || uploadBusy) return;
  const previousMedia = settings.mediaUpdated;
  clearLinkEditor();
  settings = readSettings();
  if (previousMedia === settings.mediaUpdated) {
    apply();
    return;
  }
  const revision = ++mediaRevision;
  try {
    const record = await mediaStore('get');
    if (revision === mediaRevision) attachMedia(record);
  } catch {
    toast('Could not refresh your saved wallpaper.');
  }
  apply();
});
$('video').addEventListener('error', () => {
  if ($('video').getAttribute('src'))
    toast('This video could not play. Choose another wallpaper in Customize.');
});
apply();
setInterval(() => {
  if (!document.hidden) clock();
}, 1000);
const initialRevision = mediaRevision;
try {
  const record = await mediaStore('get');
  if (initialRevision === mediaRevision) {
    attachMedia(record);
    if (settings.scene === 'custom' && !record) {
      settings.scene = 'aurora';
      save();
      toast('Your saved wallpaper is unavailable. Choose a new file in Customize.');
    }
    apply();
  }
} catch {
  toast('Local wallpaper storage is unavailable. You can still use the built-in landscapes.');
}
document.documentElement.dataset.ready = 'true';
