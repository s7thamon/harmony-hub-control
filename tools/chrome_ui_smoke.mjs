#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

function arg(name, fallback = '') {
  const eq = process.argv.find((x) => x.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] || fallback) : fallback;
}

const port = Number(arg('port', '9230')) || 9230;
const hub = arg('hub', 'http://192.168.50.139:8080/');
const outDir = arg('out', path.join('diagnostics', 'chrome-ui-smoke'));

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function connectChrome() {
  let target;
  try {
    const created = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' });
    if (created.ok) target = await created.json();
  } catch {
    // Older Chrome builds may reject target creation; fall back to the first tab.
  }
  const targets = target ? [] : await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  target = target || targets.find((x) => x.type === 'page') || targets[0];
  if (!target?.webSocketDebuggerUrl) throw new Error(`no page target on Chrome DevTools port ${port}`);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  const events = [];
  let nextId = 1;
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.message || 'CDP error'} ${msg.error.data || ''}`.trim()));
      else resolve(msg.result || {});
      return;
    }
    if (msg.method) events.push(msg);
  });
  function send(method, params = {}) {
    const id = nextId++;
    ws.send(JSON.stringify({ id, method, params }));
    const ms = Number(params.timeout || 30000) + 10000;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP ${method} timed out after ${ms} ms`));
      }, ms);
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
    });
  }
  return { ws, send, events };
}

function eventText(events) {
  return events
    .filter((e) => ['Runtime.exceptionThrown', 'Runtime.consoleAPICalled', 'Log.entryAdded'].includes(e.method))
    .map((e) => {
      if (e.method === 'Runtime.consoleAPICalled') {
        return `${e.params.type}: ${(e.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ')}`;
      }
      if (e.method === 'Log.entryAdded') return `${e.params.entry.level}: ${e.params.entry.text}`;
      return `exception: ${e.params.exceptionDetails?.text || e.params.exceptionDetails?.exception?.description || 'unknown'}`;
    });
}

function failedNetwork(events) {
  return events
    .filter((e) => e.method === 'Network.responseReceived' && e.params?.response?.status >= 400)
    .map((e) => ({
      status: e.params.response.status,
      url: e.params.response.url,
    }));
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const cdp = await connectChrome();
  const send = cdp.send;
  await Promise.all([
    send('Page.enable'),
    send('Runtime.enable'),
    send('Log.enable'),
    send('Network.enable'),
  ]);
  const load = new Promise((resolve) => {
    const timer = setTimeout(resolve, 15000);
    const poll = setInterval(() => {
      const idx = cdp.events.findIndex((e) => e.method === 'Page.loadEventFired');
      if (idx >= 0) {
        clearInterval(poll);
        clearTimeout(timer);
        resolve();
      }
    }, 100);
  });
  await send('Page.navigate', { url: hub });
  await load;
  await wait(600);
  const eventStart = cdp.events.length;
  async function evaluate(expression, timeout = 30000) {
    const wrapped = `Promise.race([
      (${expression}),
      new Promise((_, reject) => setTimeout(() => reject(new Error('smoke evaluation timed out after ${timeout} ms')), ${timeout}))
    ])`;
    const result = await send('Runtime.evaluate', {
      expression: wrapped,
      awaitPromise: true,
      returnByValue: true,
      timeout: timeout + 5000,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || result.exceptionDetails.exception?.description || 'evaluation failed');
    }
    return result.result?.value;
  }
  const base = await evaluate(`(() => {
    const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const ids = [...document.querySelectorAll('[id]')].map((x) => x.id);
    const dupes = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
    const views = [];
    for (const btn of document.querySelectorAll('[data-view-target]')) {
      const view = btn.dataset.viewTarget;
      btn.click();
      const active = document.querySelector('[data-view].active')?.dataset.view || '';
      views.push({ view, active, ok: view === active });
    }
    const unlabeled = [...document.querySelectorAll('input,select,textarea')]
      .filter((el) => visible(el) && el.type !== 'hidden' && !el.closest('label') && !el.id)
      .map((el) => el.outerHTML.slice(0, 120));
    function rgb(s) {
      const m = String(s || '').match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/);
      return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [255,255,255];
    }
    function lum(c) {
      const a = c.map((v) => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
    }
    function bg(el) {
      for (let p = el; p; p = p.parentElement) {
        const c = getComputedStyle(p).backgroundColor;
        if (!/rgba\\(0, 0, 0, 0\\)|transparent/.test(c)) return c;
      }
      return 'rgb(255,255,255)';
    }
    const lowContrast = [...document.querySelectorAll('button,a.button')]
      .filter(visible)
      .map((el) => {
        const cs = getComputedStyle(el);
        const l1 = lum(rgb(cs.color)), l2 = lum(rgb(bg(el)));
        const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
        return { text: el.textContent.trim().replace(/\\s+/g, ' ').slice(0, 80), ratio: Math.round(ratio * 100) / 100 };
      })
      .filter((x) => x.ratio < 4.5);
    const overflow = [...document.querySelectorAll('button,a.button,input,select,textarea,.match,.queue-row')]
      .filter((el) => visible(el) && el.scrollWidth > el.clientWidth + 2)
      .map((el) => ({ tag: el.tagName.toLowerCase(), text: (el.value || el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 100), delta: el.scrollWidth - el.clientWidth }))
      .slice(0, 20);
    return { title: document.title, bodyLength: document.documentElement.outerHTML.length, duplicateIds: dupes, views, unlabeled, lowContrast, overflow };
  })()`);
  async function responsiveCheck(width, height) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
    await wait(300);
    return evaluate(`(() => {
      const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
      const views = [];
      for (const btn of document.querySelectorAll('[data-view-target]')) {
        const view = btn.dataset.viewTarget;
        btn.click();
        const active = document.querySelector('[data-view].active')?.dataset.view || '';
        views.push({ view, active, ok: view === active });
      }
      const overflow = [...document.querySelectorAll('button,a.button,input,select,textarea,.match,.queue-row,.menu-item,.panel,.setup-shell')]
        .filter((el) => visible(el) && el.scrollWidth > el.clientWidth + 3)
        .map((el) => ({ tag: el.tagName.toLowerCase(), cls: el.className || '', text: (el.value || el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 90), delta: el.scrollWidth - el.clientWidth }))
        .slice(0, 20);
      return { width: innerWidth, height: innerHeight, views, overflow };
    })()`);
  }
  const responsive = [];
  for (const [width, height] of [[390, 780], [768, 900], [1280, 900]]) {
    responsive.push(await responsiveCheck(width, height));
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await wait(300);
  const api = await evaluate(`(async () => {
    const out = {};
    for (const [name, url] of Object.entries({
      inventory: '/api/inventory',
      update: '/api/update-status',
      version: '/api/version',
      bluetoothText: '/api/bt-text-status'
    })) {
      try {
        const r = await fetch(url);
        out[name] = { ok: r.ok, status: r.status, json: await r.json() };
      } catch (e) {
        out[name] = { ok: false, error: String(e && e.message || e) };
      }
    }
    return out;
  })()`);
  const irSearch = await evaluate(`(async () => {
    showView('ir');
    document.querySelector('#irdbSource').value = 'all';
    document.querySelector('#irdbSearch').value = 'Pioneer VSX';
    await runIrdSearch();
    const results = document.querySelectorAll('#irdbResults .match').length;
    if (results) {
      document.querySelector('#irdbResults .match').click();
      await fetchIrdPath();
    }
    return {
      results,
      status: document.querySelector('#irdbStatus')?.textContent || '',
      log: document.querySelector('#irdbLog')?.textContent?.slice(-600) || '',
      previewRows: document.querySelectorAll('#irdbPreview label').length,
      importable: document.querySelectorAll('#irdbPreview input:not(:disabled)').length
    };
  })()`, 90000);
  const lgSearch = await evaluate(`(async () => {
    showView('ir');
    const out = {};
    for (const source of ['irdb', 'all']) {
      document.querySelector('#irdbSource').value = source;
      document.querySelector('#irdbSearch').value = 'LG C5';
      document.querySelector('#irdbPath').value = '';
      document.querySelector('#irdbPath').dataset.source = '';
      await runIrdSearch();
      const selectedPath = document.querySelector('#irdbPath')?.value || '';
      if (selectedPath) await fetchIrdPath();
      out[source] = {
        results: document.querySelectorAll('#irdbResults .match').length,
        status: document.querySelector('#irdbStatus')?.textContent || '',
        selectedPath,
        previewRows: document.querySelectorAll('#irdbPreview label').length,
        importable: document.querySelectorAll('#irdbPreview input:not(:disabled)').length,
        log: document.querySelector('#irdbLog')?.textContent?.slice(0, 700) || ''
      };
    }
    return out;
  })()`, 90000);
  const wizardFlow = await evaluate(`(async () => {
    showView('ir');
    showWizardPanel('device');
    const before = (await (await fetch('/api/inventory')).json()).deviceCount;
    document.querySelector('#newDeviceName').value = 'LG C5';
    document.querySelector('#newDeviceType').value = 'Television';
    document.querySelector('#newDeviceManufacturer').value = 'LG';
    document.querySelector('#newDeviceModel').value = 'C5';
    document.querySelector('#profileDeviceForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => {
      const started = Date.now();
      const poll = setInterval(() => {
        const panel = document.querySelector('.wizard-panel.active')?.dataset.panel;
        const q = document.querySelector('#irdbSearch')?.value || '';
        const status = document.querySelector('#irdbStatus')?.textContent || '';
        if ((panel === 'library' && q === 'LG C5' && status) || Date.now() - started > 45000) {
          clearInterval(poll);
          resolve();
        }
      }, 250);
    });
    const sourceAfterSave = document.querySelector('#irdbSource')?.value || '';
    document.querySelector('#irdbSource').value = 'irdb';
    document.querySelector('#irdbSource').dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const after = (await (await fetch('/api/inventory')).json()).deviceCount;
    return {
      before,
      after,
      activePanel: document.querySelector('.wizard-panel.active')?.dataset.panel || '',
      search: document.querySelector('#irdbSearch')?.value || '',
      source: document.querySelector('#irdbSource')?.value || '',
      selectedDevice: document.querySelector('#irdbDevice')?.value || '',
      status: document.querySelector('#irdbStatus')?.textContent || '',
      sourceAfterSave,
      profileStatus: document.querySelector('#profileStatus')?.textContent || ''
    };
  })()`, 90000);
  const lab = await evaluate(`(async () => {
    showView('lab');
    document.querySelector('#labSource').value = 'all';
    document.querySelector('#labPathFilter').value = 'Philips TV';
    document.querySelector('#labCommandFilter').value = 'power, off, volume';
    document.querySelector('#labMaxFiles').value = '30';
    document.querySelector('#labWorkers').value = '4';
    document.querySelector('#labMaxCommands').value = '80';
    document.querySelector('#labDryRun').checked = true;
    await labFindCandidates();
    await labScanBatch();
    return {
      candidates: document.querySelectorAll('#labCandidates .match').length,
      queued: lab.queue.length,
      dupes: lab.dupes || 0,
      status: document.querySelector('#labStatus')?.textContent || '',
      summary: document.querySelector('#labSummary')?.textContent || '',
      log: document.querySelector('#labLog')?.textContent?.slice(-900) || ''
    };
  })()`, 120000);
  const systemUi = await evaluate(`(async () => {
    showView('system');
    const checkbox = document.querySelector('input[name="cloudBlocker"]');
    let exported = '';
    try {
      const r = await fetch('/export/cloud');
      exported = (await r.text()).trim();
    } catch (e) {
      exported = 'fetch failed: ' + (e.message || e);
    }
    return {
      cloudBlockerControl: !!checkbox,
      cloudBlockerChecked: checkbox ? checkbox.checked : null,
      cloudExport: exported,
      text: document.querySelector('#view-system')?.innerText?.slice(0, 1200) || ''
    };
  })()`, 30000);
  const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const screenshotPath = path.join(outDir, `harmony-ui-${Date.now()}.png`);
  fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, 'base64'));
  const recentEvents = cdp.events.slice(eventStart);
  const report = {
    hub,
    timestamp: new Date().toISOString(),
    base,
    responsive,
    api,
    irSearch,
    lgSearch,
    wizardFlow,
    lab,
    systemUi,
    browserMessages: eventText(recentEvents),
    failedNetwork: failedNetwork(recentEvents),
    screenshotPath,
  };
  const reportPath = path.join(outDir, 'latest.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  cdp.ws.close();
}

main().catch((err) => {
  console.error(err.stack || err.message || err);
  process.exit(1);
});
