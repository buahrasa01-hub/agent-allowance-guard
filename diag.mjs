// Diagnose the demo page's live RPC read inside Chrome via CDP.
const port = process.argv[2] || '9333';
const url = process.argv[3] || 'http://127.0.0.1:8931/demo.html';
const base = `http://127.0.0.1:${port}`;
const targets = await (await fetch(`${base}/json/list`)).json();
const page = targets.find(t => t.type === 'page') || targets[0];
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
await new Promise(r => ws.addEventListener('open', r, { once: true }));
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } });
await send('Page.enable'); await send('Runtime.enable');
await send('Page.navigate', { url });
await new Promise(r => setTimeout(r, 6000));
const ev = await send('Runtime.evaluate', {
  expression: `(async () => {
    const out = { href: location.href, banner: getComputedStyle(document.getElementById('sampleBanner')).display, owner: document.getElementById('owner')?.textContent };
    try {
      const res = await fetch('https://rpc.testnet.near.org', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({jsonrpc:'2.0', id:'x', method:'query', params:{request_type:'call_function', finality:'final', account_id:'guard.aag7734b.testnet', method_name:'get_owner', args_base64:'e30='}}) });
      out.fetchStatus = res.status;
      out.fetchBody = (await res.text()).slice(0, 200);
    } catch (e) { out.fetchError = String(e); }
    return JSON.stringify(out);
  })()`,
  awaitPromise: true, returnByValue: true,
});
console.log(ev.result?.value || JSON.stringify(ev));
ws.close(); process.exit(0);
