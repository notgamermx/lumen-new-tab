import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdtemp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

const root = process.cwd();
await mkdir(path.join(root, 'test-results'), { recursive: true });
const profile = await mkdtemp(path.join(root, 'test-results', 'edge-profile-'));
const browser = spawn(
  process.env.BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  [
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    `--disable-extensions-except=${path.join(root, 'extension')}`,
    `--load-extension=${path.join(root, 'extension')}`,
    'about:blank',
  ],
  { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] },
);
browser.stderr.on('data', (chunk) => {
  const value = chunk.toString();
  if (/ERROR|DevTools/.test(value)) console.log(value.slice(0, 1500));
});
browser.on('exit', (code) => console.log('Browser exit:', code));
let ws, closeBrowser;
try {
  let port;
  for (let i = 0; i < 80; i++) {
    try {
      port = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0];
      break;
    } catch {
      await delay(250);
    }
  }
  assert.ok(port, 'Browser started');
  const target = await (
    await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })
  ).json();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  let sequence = 0;
  const pending = new Map(),
    errors = [];
  ws.onclose = (event) => {
    for (const p of pending.values())
      p.reject(new Error(`Debug connection closed: ${event.code} ${event.reason}`));
  };
  ws.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) {
      const p = pending.get(message.id);
      pending.delete(message.id);
      message.error ? p.reject(new Error(message.error.message)) : p.resolve(message.result);
    } else if (message.method === 'Runtime.exceptionThrown')
      errors.push(
        message.params.exceptionDetails.text +
          ': ' +
          message.params.exceptionDetails.exception?.description,
      );
  };
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  closeBrowser = () => send('Browser.close');
  const run = async (expression) => {
    const result = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails)
      throw new Error(
        result.exceptionDetails.exception?.description || result.exceptionDetails.text,
      );
    return result.result.value;
  };
  const until = async (expression) => {
    for (let i = 0; i < 80; i++) {
      if (await run(expression)) return;
      await delay(100);
    }
    throw new Error(`Timed out: ${expression}`);
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send('Page.navigate', { url: 'edge://newtab' });
  await delay(2000);
  let url = await run('location.href');
  if (!url.startsWith('chrome-extension://')) {
    // Edge's headless new-tab route may not activate an unpacked override. Load the actual extension resource.
    const preferences = JSON.parse(
      await readFile(path.join(profile, 'Default', 'Preferences'), 'utf8'),
    );
    const entries = Object.entries(preferences.extensions?.settings || {});
    const match = entries.find(
      ([, value]) =>
        value.path &&
        path.resolve(value.path).toLowerCase() === path.join(root, 'extension').toLowerCase(),
    );
    if (!match) throw new Error('Unpacked extension was not registered. Current URL: ' + url);
    await send('Page.navigate', { url: `chrome-extension://${match[0]}/newtab.html` });
  }
  await until("document.getElementById('clock')?.textContent.length > 0");
  console.log('Extension loaded:', await run('location.href'));
  await until("document.getElementById('scene-name').textContent === 'Northern lights'");
  const shot = async (name) => {
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    await writeFile(path.join(root, 'test-results', name), Buffer.from(data, 'base64'));
  };
  await shot('preview.png');
  await run("document.getElementById('customize').click()");
  assert.equal(await run("document.getElementById('settings').open"), true);
  await run(
    "document.querySelector('[data-scene=dusk]').click(); const b=document.getElementById('brightness'); b.value=62; b.dispatchEvent(new Event('input')); document.getElementById('hour24').click();",
  );
  await send('Page.reload');
  await until("document.getElementById('scene-name')?.textContent === 'Golden hour'");
  assert.equal(await run("document.getElementById('brightness').value"), '62');
  assert.equal(await run("document.getElementById('hour24').checked"), true);
  console.log('PASS: preset, brightness and time format persist after reload');
  await run(
    "document.getElementById('customize').click(); document.querySelector('[data-scene=ocean]').click(); document.getElementById('showClock').click(); document.getElementById('showSearch').click();",
  );
  assert.equal(
    await run(
      "document.getElementById('clock-line').hidden && document.getElementById('search').hidden && !document.getElementById('shortcuts').hidden && !document.getElementById('date').hidden",
    ),
    true,
  );
  await run(
    "document.getElementById('showClock').click(); document.getElementById('showSearch').click(); document.getElementById('engine').value='duckduckgo'; document.getElementById('engine').dispatchEvent(new Event('input'));",
  );
  assert.equal(await run("document.getElementById('search').action"), 'https://duckduckgo.com/');
  console.log('PASS: visibility toggles and search engine');
  await shot('settings.png');
  const imageData = await run(
    "(() => {const c=document.createElement('canvas');c.width=320;c.height=180;const x=c.getContext('2d');x.fillStyle='#47785a';x.fillRect(0,0,320,180);return c.toDataURL('image/png').split(',')[1]})()",
  );
  await writeFile(
    path.join(root, 'test-results', 'test-image.png'),
    Buffer.from(imageData, 'base64'),
  );
  const upload = async (filename) => {
    const { root: doc } = await send('DOM.getDocument');
    const { nodeId } = await send('DOM.querySelector', { nodeId: doc.nodeId, selector: '#upload' });
    await send('DOM.setFileInputFiles', {
      nodeId,
      files: [path.join(root, 'test-results', filename)],
    });
  };
  await upload('test-image.png');
  await until("document.getElementById('scene-name').textContent === 'test-image.png'");
  await send('Page.reload');
  await until("document.getElementById('photo')?.naturalWidth === 320");
  console.log('PASS: uploaded image survives reload');
  await run("document.getElementById('customize').click()");
  await writeFile(path.join(root, 'test-results', 'broken.mp4'), 'invalid-video');
  await upload('broken.mp4');
  await until("document.getElementById('upload-status').classList.contains('error')");
  assert.equal(await run("document.getElementById('scene-name').textContent"), 'test-image.png');
  console.log('PASS: invalid video rejected; previous wallpaper retained');
  const videoData = await run(`(async () => {
    const c=document.createElement('canvas');c.width=160;c.height=90;const x=c.getContext('2d');
    const stream=c.captureStream(10);const recorder=new MediaRecorder(stream,{mimeType:'video/webm'});const chunks=[];
    recorder.ondataavailable=e=>chunks.push(e.data);
    const done=new Promise(resolve=>recorder.onstop=resolve);recorder.start();
    for(let i=0;i<12;i++){x.fillStyle=i%2?'#47785a':'#112244';x.fillRect(0,0,160,90);await new Promise(r=>setTimeout(r,100));}
    recorder.stop();await done;stream.getTracks().forEach(t=>t.stop());
    return await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.readAsDataURL(new Blob(chunks,{type:'video/webm'}));});
  })()`);
  await writeFile(
    path.join(root, 'test-results', 'test-video.webm'),
    Buffer.from(videoData, 'base64'),
  );
  await upload('test-video.webm');
  await until("document.getElementById('scene-name').textContent === 'test-video.webm'");
  await until("document.getElementById('video').currentTime > 0");
  assert.equal(
    await run("document.getElementById('video').muted && document.getElementById('video').loop"),
    true,
  );
  await run(
    "document.getElementById('close-settings').click(); document.getElementById('pause').click()",
  );
  assert.equal(await run("document.getElementById('video').paused"), true);
  await run("document.getElementById('pause').click()");
  await until("!document.getElementById('video').paused");
  await send('Page.reload');
  await until("document.getElementById('video')?.currentTime > 0");
  console.log('PASS: video upload, muted loop, pause/resume and persistence');
  const extensionUrl = await run('location.href');
  const { targetId: secondTarget } = await send('Target.createTarget', { url: extensionUrl });
  const { sessionId } = await send('Target.attachToTarget', {
    targetId: secondTarget,
    flatten: true,
  });
  await send('Page.bringToFront', {}, sessionId);
  await until("document.hidden && document.getElementById('video').paused");
  const secondRun = async (expression) =>
    (
      await send(
        'Runtime.evaluate',
        { expression, returnByValue: true, awaitPromise: true },
        sessionId,
      )
    ).result.value;
  for (
    let i = 0;
    i < 40 && !(await secondRun("document.getElementById('video')?.currentTime > 0"));
    i++
  )
    await delay(100);
  assert.equal(await secondRun("document.getElementById('video').paused"), false);
  await send('Page.bringToFront');
  await until("!document.hidden && !document.getElementById('video').paused");
  console.log('PASS: hidden tab pauses video and foreground resumes it');
  await run(
    "document.getElementById('customize').click(); document.querySelector('[data-scene=aurora]').click(); document.getElementById('use-saved').click();",
  );
  assert.equal(await run("document.getElementById('scene-name').textContent"), 'test-video.webm');
  await run("document.getElementById('remove-saved').click()");
  await until("document.getElementById('saved-media').hidden");
  for (
    let i = 0;
    i < 40 && !(await secondRun("document.getElementById('saved-media').hidden"));
    i++
  )
    await delay(100);
  assert.equal(
    await secondRun(
      "document.getElementById('saved-media').hidden && document.getElementById('scene-name').textContent === 'Northern lights'",
    ),
    true,
  );
  await send('Target.closeTarget', { targetId: secondTarget });
  console.log('PASS: wallpaper removal synchronizes across open new tabs');
  await send('Page.reload');
  await until(
    "document.documentElement.dataset.ready === 'true' && document.getElementById('scene-name')?.textContent === 'Northern lights'",
  );
  assert.equal(await run("document.getElementById('saved-media').hidden"), true);
  console.log('PASS: saved wallpaper reuse and deletion');
  await run(`
    window.setControl = (id, value) => { const el=document.getElementById(id); if(el.type==='checkbox') el.checked=value; else el.value=value; el.dispatchEvent(new Event('input')); };
    document.getElementById('customize').click();
    document.querySelector('[data-panel=appearance]').click();
    document.querySelector('[data-look=editorial]').click();
    setControl('accent','#b5a1ff');setControl('textColor','#fff2df');setControl('glass',25);
    setControl('layout','right');setControl('vertical','bottom');setControl('clockSize',160);
    setControl('searchStyle','pill');setControl('font','serif');
    document.querySelector('[data-panel=widgets]').click();
    setControl('name','Alex');setControl('greeting-input','Welcome back, {name}.');
    setControl('seconds',true);setControl('timezone','Asia/Kolkata');
    document.querySelector('[data-panel=wallpapers]').click();
    setControl('speed','0.5');setControl('fit','contain');setControl('positionX',25);setControl('positionY',70);setControl('saturation',130);setControl('overlay',20);
  `);
  assert.equal(await run("document.getElementById('greeting').textContent"), 'Welcome back, Alex.');
  assert.equal(await run("document.getElementById('video').playbackRate"), 0.5);
  assert.equal(
    await run("getComputedStyle(document.getElementById('photo')).objectFit"),
    'contain',
  );
  await send('Page.reload');
  await until("document.getElementById('greeting')?.textContent === 'Welcome back, Alex.'");
  assert.equal(
    await run(
      "document.body.dataset.layout === 'right' && document.body.dataset.font === 'serif' && document.getElementById('seconds').checked && document.getElementById('timezone').value === 'Asia/Kolkata'",
    ),
    true,
  );
  assert.equal(await run("document.getElementById('clock').textContent.split(':').length"), 3);
  assert.equal(await run("document.documentElement.style.getPropertyValue('--accent')"), '#b5a1ff');
  assert.equal(
    await run("getComputedStyle(document.getElementById('photo')).objectPosition"),
    '25% 70%',
  );
  console.log(
    'PASS: typography, colors, layout, greeting, seconds, timezone and wallpaper controls persist',
  );
  await run(`document.getElementById('customize').click();document.querySelector('[data-panel=links]').click();
    document.getElementById('link-label').value='My music';document.getElementById('link-url').value='open.spotify.com';document.getElementById('link-icon').value='♫';document.getElementById('link-form').requestSubmit();`);
  assert.equal(await run("document.querySelectorAll('#shortcuts a').length"), 4);
  assert.equal(
    await run("document.querySelector('#shortcuts a:last-child').href"),
    'https://open.spotify.com/',
  );
  await run(
    "document.querySelectorAll('#link-list .link-row')[3].querySelector('[data-action=up]').click();document.querySelectorAll('#link-list .link-row')[2].querySelector('[data-action=edit]').click();document.getElementById('link-label').value='Music & podcasts';document.getElementById('link-form').requestSubmit();",
  );
  assert.equal(
    await run("document.querySelectorAll('#shortcuts .link-name')[2].textContent"),
    'Music & podcasts',
  );
  await run(
    "document.getElementById('link-label').value='Bad link';document.getElementById('link-url').value='javascript:alert(1)';document.getElementById('link-form').requestSubmit();",
  );
  assert.equal(await run("document.querySelectorAll('#shortcuts a').length"), 4);
  assert.equal(await run("document.getElementById('link-error').textContent.length > 0"), true);
  await run(
    "document.getElementById('newTabLinks').click();document.getElementById('linkStyle').value='tiles';document.getElementById('linkStyle').dispatchEvent(new Event('input'));document.querySelector('#link-list .link-row [data-action=remove]').click();",
  );
  await send('Page.reload');
  await until(
    "document.querySelectorAll('#shortcuts a').length === 3 && document.querySelector('#shortcuts a').target === '_blank'",
  );
  assert.equal(
    await run("document.querySelectorAll('#shortcuts .link-name')[1].textContent"),
    'Music & podcasts',
  );
  console.log('PASS: add, edit, reorder, delete and persist shortcuts; reject unsafe URLs');
  await run("document.getElementById('focus').click()");
  assert.equal(await run("getComputedStyle(document.querySelector('main')).display"), 'none');
  await send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Escape',
    code: 'Escape',
    windowsVirtualKeyCode: 27,
  });
  assert.equal(await run("document.body.classList.contains('wallpaper-only')"), false);
  await run(
    "document.getElementById('customize').click();document.querySelector('[data-panel=appearance]').click();",
  );
  await shot('appearance.png');
  await run("document.getElementById('reset-style').click()");
  assert.equal(
    await run(
      "document.body.dataset.font === 'modern' && document.getElementById('name').value === '' && document.querySelectorAll('#shortcuts a').length === 3 && document.getElementById('saturation').value === '130'",
    ),
    true,
  );
  console.log('PASS: wallpaper-only mode, Escape recovery and scoped reset');
  await run(
    "document.querySelector('[data-look=editorial]').click();document.getElementById('name').value='Alex';document.getElementById('name').dispatchEvent(new Event('input'));document.getElementById('close-settings').click();",
  );
  await shot('customized.png');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await run("document.getElementById('customize').click()");
  assert.equal(await run('document.documentElement.scrollWidth <= innerWidth'), true);
  await shot('mobile.png');
  for (const panel of ['wallpapers', 'appearance', 'widgets', 'links']) {
    await run(`document.querySelector('[data-panel=${panel}]').click()`);
    assert.equal(
      await run(
        "document.getElementById('settings').scrollWidth <= document.getElementById('settings').clientWidth",
      ),
      true,
      `${panel} panel fits narrow width`,
    );
  }
  console.log('PASS: narrow layout');
  assert.deepEqual(errors, []);
  console.log('PASS: no uncaught JavaScript exceptions');
  await send('Browser.close');
} finally {
  if (ws?.readyState === WebSocket.OPEN && closeBrowser)
    await Promise.race([closeBrowser().catch(() => {}), delay(2000)]);
  ws?.close();
  browser.kill();
}
