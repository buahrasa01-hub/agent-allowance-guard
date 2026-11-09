// Screenshot demo.html (live testnet state) via CDP against a headless Chromium.
// Usage: node shot.mjs <chromePort> <outPng>
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const port = process.argv[2] || '9333';
const out = process.argv[3] || 'demo-screenshot.png';
const base = `http://127.0.0.1:${port}`;

async function main() {
  const targets = await (await fetch(`${base}/json/list`)).json();
  const page = targets.find(t => t.type === 'page') || targets[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const send = (method, params = {}) => new Promise((res, rej) => {
    const i = ++id;
    pending.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) rej(new Error(JSON.stringify(m.error))); else res(m.result);
    }
  });
  await send('Page.enable');
  await send('Runtime.enable');
  const pageUrl = process.env.PAGE_URL || new URL('./demo.html', import.meta.url).href;
  await send('Page.navigate', { url: pageUrl });
  // wait until the live read settles: sample banner hidden AND owner populated
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 500));
    const ev = await send('Runtime.evaluate', {
      expression: `JSON.stringify({owner: document.getElementById('owner')?.textContent || '', banner: getComputedStyle(document.getElementById('sampleBanner')).display})`,
      returnByValue: true,
    });
    try {
      const s = JSON.parse(ev.result?.value || '{}');
      if (s.owner && s.owner !== '…' && s.banner === 'none') break;
    } catch {}
  }
  await new Promise(r => setTimeout(r, 800));
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log('saved', out);
  ws.close();
  process.exit(0);
}
main().catch(e => { console.error('FAIL', e.message); process.exit(1); });
