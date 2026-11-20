/* 逐帧渲染成片画面。在模板目录下运行：
   node render.js [--from 0] [--to <shots.json 的 duration>] [--fps 24] [--workers 2] [--out out/frames] [--resume]
   node render.js --times 2,6.5 --out out/stills          只渲染几个时间点（自查用）
   每帧调用 film.html 里的 renderAt(t) 后截图（JPEG 95）；同时把全片音效时间表写到 out/events.json。 */
const fs = require('fs'), path = require('path');
const { spawn } = require('child_process');
const { withBrowser, root } = require('./harness');
const A = {}; const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) { const k = argv[i].slice(2); A[k] = (argv[i + 1] && !argv[i + 1].startsWith('--')) ? argv[++i] : true; }
const DUR = JSON.parse(fs.readFileSync(path.join(__dirname, 'shots.json'), 'utf8')).duration;
const fps = +(A.fps || 24), from = +(A.from || 0), to = +(A.to || DUR), out = path.resolve(root, A.out || 'out/frames');
const workers = +(A.workers || 1);
fs.mkdirSync(out, { recursive: true });
const PAGE = 'film.html';

async function renderRange(a, b, tag) {
  await withBrowser({ dir: 'out/_edge' }, async br => {
    await br.open(PAGE, 'window.__ready===true');
    if (A.events || tag === 'main') {
      const ev = await br.eval('JSON.stringify(window.__events())');
      fs.writeFileSync(path.resolve(root, 'out/events.json'), ev);
      console.log('events', JSON.parse(ev).length);
    }
    const t0 = Date.now(); let n = 0;
    const list = [];
    if (A.times) String(A.times).split(',').forEach(x => list.push(['still_' + String(x).replace('.', '_') + '.jpg', +x]));
    else for (let f = Math.round(a * fps); f < Math.round(b * fps); f++) list.push([String(f).padStart(5, '0') + '.jpg', f / fps]);
    for (const [name, t] of list) {
      const file = path.join(out, name);
      if (A.resume && fs.existsSync(file) && fs.statSync(file).size > 1000) continue;
      await br.eval('window.renderAt(' + (t + 1e-4) + ')');
      const r = await br.send('Page.captureScreenshot', { format: 'jpeg', quality: 95 });
      fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
      n++;
      if (n % 120 === 0) console.log(tag, 'frame', name, ((Date.now() - t0) / n).toFixed(0) + 'ms/帧');
    }
    console.log(tag, 'done', n, 'frames', ((Date.now() - t0) / 1000).toFixed(0) + 's');
  });
}

(async () => {
  if (A.worker) { await renderRange(from, to, 'w' + A.worker); return; }
  if (A.times || workers <= 1) { await renderRange(from, to, 'main'); return; }
  // 多进程：先由主进程写 events.json，再按时间段分给 N 个无头浏览器
  const span = (to - from) / workers, procs = [];
  for (let w = 0; w < workers; w++) {
    const a = from + span * w, b = w === workers - 1 ? to : from + span * (w + 1);
    const args = [__filename, '--worker', String(w + 1), '--from', a.toFixed(4), '--to', b.toFixed(4), '--fps', String(fps), '--out', path.relative(root, out)];
    if (A.resume) args.push('--resume');
    if (w === 0) args.push('--events');
    if (w) await new Promise(r => setTimeout(r, 4000));   // 错开启动，免得几个浏览器同时加载
    procs.push(new Promise((res, rej) => { const p = spawn(process.execPath, args, { stdio: 'inherit', cwd: __dirname }); p.on('exit', c => c ? rej(Error('worker ' + w + ' exit ' + c)) : res()); }));
  }
  await Promise.all(procs);
  console.log('all workers done');
})().catch(e => { console.error(e); process.exit(1); });
