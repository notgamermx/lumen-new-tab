import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp, cp } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

const root = process.cwd(),
  output = path.join(root, 'test-results');
await mkdir(output, { recursive: true });
const fixture = await mkdtemp(path.join(output, 'memory-extension-'));
await cp(path.join(root, 'extension'), fixture, { recursive: true });
const manifest = JSON.parse(await readFile(path.join(fixture, 'manifest.json'), 'utf8'));
// Grant tab access only to this isolated test fixture. Production keeps it optional.
manifest.permissions.push('tabs');
manifest.optional_permissions = [];
await writeFile(path.join(fixture, 'manifest.json'), JSON.stringify(manifest));
const profile = await mkdtemp(path.join(output, 'memory-profile-'));
let loads = 0;
const server = createServer((_request, response) => {
  loads++;
  response.writeHead(200, { 'content-type': 'text/html' });
  response.end('<!doctype html><title>Memory test</title><p>Local test page</p>');
});
await new Promise((resolve) => server.listen(0, resolve));
const httpPort = server.address().port;
const browser = spawn(
  process.env.BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  [
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    `--disable-extensions-except=${fixture}`,
    `--load-extension=${fixture}`,
    'about:blank',
  ],
  { windowsHide: true, stdio: 'ignore' },
);
let ws, send;
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
  const pending = new Map();
  ws.onmessage = ({ data }) => {
    const result = JSON.parse(data);
    if (!result.id) return;
    const task = pending.get(result.id);
    pending.delete(result.id);
    result.error ? task.reject(new Error(result.error.message)) : task.resolve(result.result);
  };
  ws.onclose = () => {
    for (const task of pending.values()) task.reject(new Error('Browser closed.'));
  };
  send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  const evaluate = async (expression, sessionId) => {
    const result = await send(
      'Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true, userGesture: true },
      sessionId,
    );
    if (result.exceptionDetails)
      throw new Error(
        result.exceptionDetails.exception?.description || result.exceptionDetails.text,
      );
    return result.result.value;
  };
  const until = async (expression) => {
    for (let i = 0; i < 80; i++) {
      if (await evaluate(expression)) return;
      await delay(100);
    }
    throw new Error(`Timed out: ${expression}`);
  };
  await send('Page.navigate', { url: 'edge://newtab' });
  await until("document.documentElement.dataset.ready === 'true'");
  const extensionUrl = await evaluate('location.href'),
    extensionId = new URL(extensionUrl).host;
  const initial = await evaluate("chrome.runtime.sendMessage({type:'memory:status'})");
  assert.equal(initial.ok, true);
  assert.equal(initial.value.config.enabled, false);
  assert.equal(await evaluate("chrome.alarms.get('lumen-memory-sweep')"), undefined);
  const ids = await evaluate(`(async () => {
    const old=await chrome.tabs.create({url:'http://127.0.0.1:${httpPort}/old',active:false});
    const pinned=await chrome.tabs.create({url:'http://127.0.0.1:${httpPort}/pinned',active:false,pinned:true});
    const protectedTab=await chrome.tabs.create({url:'http://localhost:${httpPort}/protected',active:false});
    const recent=await chrome.tabs.create({url:'http://127.0.0.1:${httpPort}/recent',active:false});
    const exempt=await chrome.tabs.create({url:'http://127.0.0.1:${httpPort}/exempt',active:false});
    await chrome.tabs.update(exempt.id,{autoDiscardable:false});
    return {old:old.id,pinned:pinned.id,protectedTab:protectedTab.id,recent:recent.id,exempt:exempt.id,main:(await chrome.tabs.getCurrent()).id};
  })()`);
  await until(
    `(async()=>{const tabs=await chrome.tabs.query({});return ${JSON.stringify(Object.values(ids))}.every(id=>tabs.find(t=>t.id===id)?.status==='complete')})()`,
  );
  await evaluate(
    "chrome.runtime.sendMessage({type:'memory:save',config:{enabled:false,timeoutMinutes:5,keepRecent:0,excludedHosts:['localhost']}})",
  );
  // Advance only fixture timestamps; discarding, pin state, URL exclusions, and reloading remain real browser operations.
  const { targetInfos } = await send('Target.getTargets');
  const worker = targetInfos.find(
    (info) =>
      info.type === 'service_worker' && info.url.startsWith(`chrome-extension://${extensionId}/`),
  );
  assert.ok(worker, 'Memory service worker is running');
  const { sessionId } = await send('Target.attachToTarget', {
    targetId: worker.targetId,
    flatten: true,
  });
  await evaluate(
    `(() => {const oldIds=new Set(${JSON.stringify([ids.old, ids.pinned, ids.protectedTab, ids.exempt])});const query=chrome.tabs.query.bind(chrome.tabs),get=chrome.tabs.get.bind(chrome.tabs);const age=t=>({...t,lastAccessed:oldIds.has(t.id)?Date.now()-3600000:t.lastAccessed});chrome.tabs.query=async(...args)=>(await query(...args)).map(age);chrome.tabs.get=async(...args)=>age(await get(...args));})()`,
    sessionId,
  );
  const result = await evaluate("chrome.runtime.sendMessage({type:'memory:sleep'})");
  assert.equal(result.ok, true);
  assert.equal(result.value.slept, 1);
  // Chromium may replace the tab ID when discarding. Find the retained tab by its fixture URL.
  ids.old = await evaluate(
    `chrome.tabs.query({}).then(tabs=>tabs.find(tab=>tab.url==='http://127.0.0.1:${httpPort}/old')?.id)`,
  );
  assert.ok(ids.old, 'Discarded tab remains in the tab strip');
  const states = await evaluate(
    `(async()=>{const tabs=await chrome.tabs.query({});return Object.fromEntries(${JSON.stringify(Object.entries(ids))}.map(([name,id])=>[name,tabs.find(t=>t.id===id).discarded]))})()`,
  );
  assert.equal(states.old, true);
  for (const key of ['pinned', 'protectedTab', 'recent', 'exempt', 'main'])
    assert.equal(states[key], false, `${key} stays awake`);
  const previousLoads = loads;
  await evaluate(`chrome.tabs.update(${ids.old},{active:true})`);
  await until(
    `(async()=>{const tab=await chrome.tabs.get(${ids.old});return !tab.discarded&&tab.status==='complete'})()`,
  );
  assert.ok(loads > previousLoads, 'Sleeping tab reloads when activated');
  await evaluate(`chrome.tabs.update(${ids.main},{active:true})`);
  console.log(
    'PASS: real tab discard, active/pinned/recent/site/non-discardable protections and reload on return',
  );
  await evaluate(
    "chrome.runtime.sendMessage({type:'memory:save',config:{enabled:true,timeoutMinutes:30,keepRecent:3}})",
  );
  assert.equal((await evaluate("chrome.alarms.get('lumen-memory-sweep')")).periodInMinutes, 1);
  await evaluate("chrome.runtime.sendMessage({type:'memory:save',config:{enabled:false}})");
  assert.equal(await evaluate("chrome.alarms.get('lumen-memory-sweep')"), undefined);
  console.log('PASS: automatic sleep creates its alarm; turning it off removes the alarm');
  await evaluate(
    "document.getElementById('customize').click();document.querySelector('[data-panel=memory]').click()",
  );
  await until("document.getElementById('memory-counts').textContent.includes('tabs')");
  await evaluate(`(() => {
    window.originalRemovePermission = chrome.permissions.remove;
    chrome.permissions.remove = async () => false;
    document.getElementById('memory-disconnect').click();
  })()`);
  await until(
    "document.getElementById('memory-result').classList.contains('error') && !document.getElementById('memory-enabled').disabled",
  );
  assert.equal(
    await evaluate("document.getElementById('memory-result').textContent"),
    'Tab access could not be removed. Automatic sleeping is off.',
  );
  assert.equal(await evaluate("document.getElementById('memory-disconnect').hidden"), false);
  await evaluate(
    'chrome.permissions.remove = window.originalRemovePermission; delete window.originalRemovePermission',
  );
  console.log('PASS: failed permission removal shows an error and restores usable controls');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  await writeFile(path.join(output, 'memory-panel.png'), Buffer.from(data, 'base64'));
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: false,
  });
  assert.equal(
    await evaluate(
      "document.getElementById('settings').scrollWidth <= document.getElementById('settings').clientWidth",
    ),
    true,
  );
  const narrow = await send('Page.captureScreenshot', { format: 'png' });
  await writeFile(path.join(output, 'memory-mobile.png'), Buffer.from(narrow.data, 'base64'));
  console.log('PASS: memory panel fits a narrow window');
} finally {
  if (ws?.readyState === WebSocket.OPEN && send)
    await Promise.race([send('Browser.close').catch(() => {}), delay(2000)]);
  ws?.close();
  browser.kill();
  server.close();
}
