/* 纸剪定格模板用的无头 Edge 封装。
   区别：可设视口宽高和设备像素比（deviceScaleFactor），按扩展名给 Content-Type，可选慢放（虚拟时钟）。
   只在本机 127.0.0.1 起静态服务，不联网，用独立的临时用户目录，不碰用户自己的浏览器。 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const root = __dirname;   // 静态服务的根 = 模板目录；产物都在 out/
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.wav': 'audio/wav', '.mp4': 'video/mp4' };

/* 慢放垫片：页面里的 performance.now / Date.now / requestAnimationFrame / setTimeout / setInterval 都按 __RATE 缩放，
   CSS 动画另用 CDP Animation.setPlaybackRate。这样截图慢也能录到流畅的页面动画。 */
const SLOWMO = `(function(){
  var R=1, pn=performance.now.bind(performance), d0=Date.now(), p0=pn(), aR=p0, aV=p0;
  function virt(){ return aV + (pn()-aR)*R; }
  window.__virt = virt;
  window.__setRate = function(r){ aV = virt(); aR = pn(); R = r; };
  performance.now = virt;
  Date.now = function(){ return Math.round(d0 + (virt()-p0)); };
  var rAF = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = function(cb){ return rAF(function(){ cb(virt()); }); };
  var sT = window.setTimeout.bind(window), sI = window.setInterval.bind(window);
  window.setTimeout = function(fn, ms){ var a = [].slice.call(arguments, 2); return sT(function(){ if (typeof fn === 'function') fn.apply(null, a); }, (ms || 0) / R); };
  window.setInterval = function(fn, ms){ var a = [].slice.call(arguments, 2); return sI(function(){ if (typeof fn === 'function') fn.apply(null, a); }, Math.max(1, (ms || 0) / R)); };
})();`;

async function withBrowser(opts, run) {
  const o = Object.assign({ dir: 'out/_edge', width: 1920, height: 1080, dpr: 1, slowmo: false }, opts || {});
  const out = path.resolve(root, o.dir);
  if (!out.startsWith(root + path.sep)) throw Error('Output must be inside project');
  fs.mkdirSync(out, { recursive: true });
  const server = http.createServer((req, res) => {
    let file;
    try { file = path.resolve(root, '.' + decodeURIComponent(req.url.split('?')[0])); }
    catch (_) { res.writeHead(400); res.end(); return; }
    if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (error, body) => {
      res.writeHead(error ? 404 : 200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'max-age=3600' });
      res.end(error ? '' : body);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const profile = path.join(out, 'edge-' + process.pid + '-' + Date.now());
  fs.mkdirSync(profile);
  const browserPath = [process.env['PROGRAMFILES(X86)'], process.env.PROGRAMFILES].filter(Boolean)
    .map(p => path.join(p, 'Microsoft/Edge/Application/msedge.exe')).find(p => fs.existsSync(p));
  if (!browserPath) { server.close(); throw Error('Installed Edge not found'); }
  const browser = spawn(browserPath, ['--headless=new', '--disable-extensions', '--disable-gpu',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--force-color-profile=srgb',
    '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'],
    { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  const log = fs.createWriteStream(path.join(out, 'edge.log'));
  browser.stderr.pipe(log);
  let socket;
  const pending = new Map();
  const listeners = [];
  let nextId = 0;
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(Error('CDP timeout: ' + method)); }, 120000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  try {
    let port;
    for (let i = 0; i < 150; i++) {
      try { port = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; break; }
      catch (_) { await sleep(100); }
    }
    if (!port) throw Error('Headless Edge startup failed');
    const pages = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
    const page = pages.find(p => p.type === 'page');
    if (!page) throw Error('No browser page target');
    socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('WebSocket timeout')), 10000);
      socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timer); reject(Error('WebSocket failed')); }, { once: true });
    });
    socket.addEventListener('message', e => {
      const msg = JSON.parse(e.data), p = pending.get(msg.id);
      if (!p) { if (msg.method) listeners.forEach(f => f(msg)); return; }
      clearTimeout(p.timer); pending.delete(msg.id);
      if (msg.error) p.reject(Error(msg.method + ' ' + msg.error.message)); else p.resolve(msg.result);
    });
    const evaluate = async expression => {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails).slice(0, 800));
      return r.result.value;
    };
    await send('Page.enable');
    await send('Page.addScriptToEvaluateOnNewDocument', { source: "window.__errors=[];window.addEventListener('error',function(e){window.__errors.push(e.message);});" });
    if (o.slowmo) await send('Page.addScriptToEvaluateOnNewDocument', { source: SLOWMO });
    await send('Emulation.setDeviceMetricsOverride', { width: o.width, height: o.height, deviceScaleFactor: o.dpr, mobile: false });
    const api = { send, eval: evaluate, sleep, origin, out, opts: o, on: f => listeners.push(f),
      async open(relative, ready) {
        await send('Page.navigate', { url: origin + '/' + relative.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/') });
        for (let i = 0; i < 1200; i++) {
          await sleep(50);
          let ok = false;
          try { ok = await evaluate(ready || "document.readyState==='complete'"); } catch (_) { ok = false; }
          if (ok) { await sleep(150); return; }
        }
        throw Error('Page initialization failed: ' + await evaluate('JSON.stringify(window.__errors)'));
      },
      async shot(file, fmt, quality) {
        const p = { format: fmt || 'png' };
        if (p.format === 'jpeg') p.quality = quality || 92;
        const r = await send('Page.captureScreenshot', p);
        fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
      }
    };
    return await run(api);
  } finally {
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(Error('Browser closed')); }
    if (socket) socket.close();
    browser.kill(); server.close(); log.end();
  }
}
module.exports = { withBrowser, root, sleep };
