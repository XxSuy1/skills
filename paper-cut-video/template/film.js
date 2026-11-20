/* 纸剪定格 · 最小模板合成器
   逐帧确定性渲染：window.renderAt(t) 画出第 t 秒的画面；window.__events() 给出全片音效时间表。
   约定：纸片进出场按 12 格/秒定格（q12），镜头推拉按 24 格/秒平滑；光从左上来，影子落在右下。
   本模板只保留：纸片 P、胶带 tape、贴纸字 sticker、云、纸屑、板块标签、作品便签、字幕、提示词纸条、四种转场。
   不含：真实录屏嵌入、像素光标、纸钟/铅笔/电脑屏/键帽等道具（需要时自行扩展）。 */
'use strict';
const W = 1920, H = 1080;
const TEX = '/out/tex/';   // 纸张贴图（textures.py 生成）
const C = { sky: '#9fd8ef', skyD: '#5fb3dc', skyP: '#d6f1fb', butter: '#ffd66b', butterD: '#f0b23a', coral: '#ff8e7a', coralD: '#e0604c',
  mint: '#93e0be', mintD: '#3db487', lilac: '#c7b9fb', lilacD: '#8d78e6', peach: '#ffcaa8', cream: '#fff6e6', paper: '#fffdf8',
  ink: '#2d2547', inkS: '#5f5880', navy: '#2c3352', navyL: '#414a73', steel: '#c9d2df' };
let SH = null; let IMGS = [];
const stage = document.getElementById('stage');

/* ---------------- 数学与随机 ---------------- */
const clamp = (x, a, b) => x < a ? a : x > b ? b : x, lerp = (a, b, u) => a + (b - a) * u, seg = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
const q12 = t => Math.floor(t * 12 + 1e-6) / 12;
const eIO = u => u < .5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2, eOut = u => 1 - Math.pow(1 - u, 3), eIn = u => u * u * u;
const eSine = u => -(Math.cos(Math.PI * u) - 1) / 2;
function spring(u, f, d) { f = f || 1.5; d = d || 6.5; if (u <= 0) return 0; if (u >= 1) return 1; return 1 - Math.exp(-d * u) * Math.cos(2 * Math.PI * f * u); }
function backOut(u, s) { s = s == null ? 1.3 : s; u = clamp(u, 0, 1) - 1; return 1 + (s + 1) * u * u * u + s * u * u; }
// 预备—滑行—过冲—落定：先往反方向缩一点，再滑过去略冲过头，最后停稳
function antic(u, dip) { dip = dip == null ? .07 : dip; if (u <= 0) return 0; if (u < .15) return -dip * Math.sin(Math.PI * u / .15); return backOut((u - .15) / .85, 1.25); }
function rng(seed) { let s = (seed >>> 0) || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
function boil(id, t, a) { const k = Math.floor(t * 8 + 1e-6) % 3, r = rng(id * 977 + k * 13 + 5); a = a == null ? 1 : a; return { x: (r() - .5) * 1.2 * a, y: (r() - .5) * 1.2 * a, r: (r() - .5) * .3 * a }; }
function hex2rgb(h) { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
function shade(h, k) { const c = hex2rgb(h).map(v => Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k)); return 'rgb(' + c.join(',') + ')'; }
function rgba(h, a) { return 'rgba(' + hex2rgb(h).join(',') + ',' + a + ')'; }

/* ---------------- DOM 小工具 ---------------- */
function D(cls, css, parent, html) { const d = document.createElement('div'); if (cls) d.className = cls; if (css) d.style.cssText = css; if (html != null) d.innerHTML = html; if (parent) parent.appendChild(d); return d; }
const SVGNS = 'http://www.w3.org/2000/svg';
function S(tag, attrs, parent) { const e = document.createElementNS(SVGNS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; }
const MC = document.createElement('canvas').getContext('2d');
function measure(text, font, ls) { MC.font = font; MC.letterSpacing = (ls || 0) + 'px'; return MC.measureText(text).width; }
const F_DISP = '"STHupo","Microsoft YaHei",sans-serif', F_BOLD = '"Microsoft YaHei","Noto Sans SC",sans-serif';

/* ---------------- 纸片外形：手剪边 / 撕边 / 圆 ---------------- */
const POLY = {};
function vnoise(r, n) { const v = []; for (let i = 0; i <= n + 2; i++) v.push(r() * 2 - 1); return x => { const i = Math.floor(x), f = x - i, g = f * f * (3 - 2 * f); return v[i] + (v[i + 1] - v[i]) * g; }; }
function shape(w, h, o) {
  const sides = o.sides || 'cccc', rad = o.r == null ? 10 : o.r, amp = o.amp == null ? 1 : o.amp;
  const key = [Math.round(w), Math.round(h), o.seed, rad, sides, amp, o.circle ? 1 : 0].join('|');
  if (POLY[key]) return POLY[key];
  const str = pts => 'polygon(' + pts.map(p => p[0].toFixed(1) + 'px ' + p[1].toFixed(1) + 'px').join(',') + ')';
  let face, fr = null;
  if (o.circle) {
    const r = rng(o.seed * 7 + 3), pts = [], n = 120, nz = vnoise(r, 12);
    for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2, d = 1 + nz(i / n * 12) * .006 * amp; pts.push([w / 2 + Math.cos(a) * w / 2 * d, h / 2 + Math.sin(a) * h / 2 * d]); }
    face = str(pts);
  } else {
    const build = grow => {
      const pts = [], cs = [[0, 0], [w, 0], [w, h], [0, h]];
      for (let s = 0; s < 4; s++) {
        const a = cs[s], b = cs[(s + 1) % 4], type = sides[s], pt = sides[(s + 3) % 4], nt = sides[(s + 1) % 4];
        let dx = b[0] - a[0], dy = b[1] - a[1]; const L = Math.hypot(dx, dy); dx /= L; dy /= L; const nx = dy, ny = -dx;
        const r = rng(o.seed * 7919 + s * 131 + (type === 't' && grow ? 977 : 0));
        const ra = (type !== 't' && pt !== 't') ? rad * (0.85 + 0.3 * r()) : 0, rb = (type !== 't' && nt !== 't') ? rad : 0;
        if (ra > 0) {
          const cx = a[0] + dx * ra - nx * ra, cy = a[1] + dy * ra - ny * ra, a0 = Math.atan2(-dy, -dx);
          for (let k = 0; k <= 5; k++) { const th = a0 + Math.PI / 2 * k / 5; pts.push([cx + Math.cos(th) * ra, cy + Math.sin(th) * ra]); }
        } else pts.push([a[0], a[1]]);
        const s0 = ra, s1 = L - rb;
        if (type === 'c') {
          const n = Math.max(1, Math.round((s1 - s0) / 90));
          for (let k = 1; k < n; k++) { const sp = s0 + (s1 - s0) * k / n, d = (r() * 2 - 1) * 1.3 * amp; pts.push([a[0] + dx * sp + nx * d, a[1] + dy * sp + ny * d]); }
        } else if (type === 't') {
          const n1 = vnoise(r, Math.ceil(L / 70) + 2), n2 = vnoise(r, Math.ceil(L / 22) + 2);
          for (let sp = s0 + 3.5; sp < s1; sp += 3.5) {
            const d = amp * (-2.6 + 2.4 * (0.62 * n1(sp / 70) + 0.28 * n2(sp / 22) + 0.1 * (r() * 2 - 1))) + (grow || 0);
            pts.push([a[0] + dx * sp + nx * d, a[1] + dy * sp + ny * d]);
          }
        }
      }
      return pts;
    };
    face = str(build(0));
    if (sides.indexOf('t') >= 0) fr = str(build(2.6 * amp));
  }
  return (POLY[key] = { face, fr });
}
function shadowCSS(e, op) {
  if (!e) return 'none';
  const c = 'rgba(22,44,80,', k = op == null ? 1 : op;
  return 'drop-shadow(0 0.7px 0.9px ' + c + (0.36 * k).toFixed(3) + ')) drop-shadow(' + (1.7 * e).toFixed(1) + 'px ' + (2.9 * e).toFixed(1) + 'px ' + (3.4 * e).toFixed(1) + 'px ' + c + ((0.12 + 0.022 * e) * k).toFixed(3) + '))';
}
/* 一张纸：o = {x,y,w,h,rot,color,seed,sides,r,amp,elev,circle,tf,op,core,curl,grad} → {wrap, face} */
function P(parent, o) {
  const wrap = D('pp', 'left:' + o.x.toFixed(1) + 'px;top:' + o.y.toFixed(1) + 'px;width:' + o.w + 'px;height:' + o.h + 'px;transform:' + (o.tf || '') + ' rotate(' + (o.rot || 0).toFixed(3) + 'deg)' + (o.op != null ? ';opacity:' + o.op : '') + (o.origin ? ';transform-origin:' + o.origin : ''), parent);
  const sh = D('pp-sh', 'filter:' + shadowCSS(o.elev == null ? 2 : o.elev, o.shOp), wrap);
  const sp = shape(o.w, o.h, { seed: o.seed || 1, r: o.r, sides: o.sides, amp: o.amp, circle: o.circle });
  const col = o.color || C.paper;
  D('pp-l', 'clip-path:' + sp.face + ';background:' + shade(col, -0.2) + ';transform:translate(0.7px,1.4px)', sh);
  if (sp.fr) D('pp-l', 'clip-path:' + sp.fr + ';background:' + (o.core || '#fffaf1'), sh);
  const sd = o.seed || 1, grad = o.grad || 'linear-gradient(158deg,rgba(255,255,255,.17) 0%,rgba(255,255,255,0) 42%,rgba(30,40,80,0) 72%,rgba(30,40,80,.05) 100%)';
  const curl = o.curl ? ',linear-gradient(315deg,rgba(255,255,255,.4) 0,rgba(255,255,255,.12) 26px,rgba(0,0,0,0) 70px)' : '';
  const face = D('pp-l pp-face', 'clip-path:' + sp.face + ';background-color:' + col + ';background-image:' + grad + curl + ',url(' + TEX + 'paper.png);background-size:100% 100%' + (curl ? ',100% 100%' : '') + ',1024px 1024px;background-position:0 0' + (curl ? ',0 0' : '') + ',' + (-(sd * 137) % 1024) + 'px ' + (-(sd * 251) % 1024) + 'px', sh);
  return { wrap, face, sh };
}
/* 和纸胶带：中心 (x,y)，长 w，锯齿两端，半透明 */
function tape(parent, x, y, w, rot, color, seed, pat) {
  const h = 38, r = rng(seed * 31 + 7), pts = [];
  for (let k = 0; k <= 8; k++) pts.push([(k % 2 ? 4.5 : 0) + r() * 1.2, h * k / 8]);
  const right = []; for (let k = 0; k <= 8; k++) right.push([w - (k % 2 ? 4.5 : 0) - r() * 1.2, h * k / 8]);
  const poly = 'polygon(' + pts.reverse().concat(right).map(p => p[0].toFixed(1) + 'px ' + p[1].toFixed(1) + 'px').join(',') + ')';
  const pattern = pat === 'dot' ? 'radial-gradient(circle,rgba(255,255,255,.6) 2.6px,rgba(255,255,255,0) 3.2px)' :
    pat === 'stripe' ? 'repeating-linear-gradient(-45deg,rgba(255,255,255,.38) 0 7px,rgba(255,255,255,0) 7px 16px)' : 'linear-gradient(rgba(255,255,255,.1),rgba(255,255,255,0))';
  const el = D('pp', 'left:' + (x - w / 2) + 'px;top:' + (y - h / 2) + 'px;width:' + w + 'px;height:' + h + 'px;transform:rotate(' + rot + 'deg);filter:drop-shadow(0 1px 1.4px rgba(22,44,80,.2))', parent);
  D('pp-l', 'clip-path:' + poly + ';opacity:.84;background-color:' + color + ';background-image:linear-gradient(rgba(255,255,255,.22),rgba(255,255,255,0) 40%,rgba(0,0,0,.04)),' + pattern + ',url(' + TEX + 'paper.png);background-size:100% 100%,' + (pat === 'dot' ? '16px 16px' : '100% 100%') + ',1024px 1024px', el);
  return el;
}
/* 贴纸字：SVG 文字，圆角白边 + 投影。o = {x,y,text,size,font:'disp'|'bold',fill,stroke,sw,anchor,lh,ls,rot,op,tf,hl} */
function sticker(parent, o) {
  const disp = o.font !== 'bold', fam = disp ? F_DISP : F_BOLD, wt = disp ? 400 : 700, ls = o.ls || 0;
  const lines = String(o.text).split('\n'), size = o.size, lh = o.lh || size * 1.2, sw = o.sw == null ? Math.round(size * 0.16) : o.sw;
  let mw = 0; lines.forEach(l => { mw = Math.max(mw, measure(l, wt + ' ' + size + 'px ' + fam, ls)); });
  const pad = sw + 8, w = Math.ceil(mw + pad * 2), h = Math.ceil(lh * (lines.length - 1) + size * 1.25 + pad * 2);
  const left = o.anchor === 'middle' ? o.x - w / 2 : o.anchor === 'end' ? o.x - w + pad : o.x - pad;
  const box = D('pp', 'left:' + left.toFixed(1) + 'px;top:' + (o.y - pad).toFixed(1) + 'px;width:' + w + 'px;height:' + h + 'px;transform:' + (o.tf || '') + ' rotate(' + (o.rot || 0) + 'deg)' + (o.op != null ? ';opacity:' + o.op : '') + ';filter:' + (o.shadow === false ? 'none' : shadowCSS(o.elev || 1.6)), parent);
  const svg = S('svg', { width: w, height: h, viewBox: '0 0 ' + w + ' ' + h }, box);
  const tx = o.anchor === 'middle' ? w / 2 : o.anchor === 'end' ? w - pad : pad, anc = o.anchor || 'start';
  const mk = (layer) => {
    lines.forEach((l, i) => {
      const t = S('text', { x: tx, y: pad + size * 0.98 + i * lh, 'text-anchor': anc, 'font-family': fam, 'font-weight': wt, 'font-size': size, 'letter-spacing': ls }, svg);
      if (layer === 'back') { t.setAttribute('fill', o.stroke || '#fffaf0'); t.setAttribute('stroke', o.stroke || '#fffaf0'); t.setAttribute('stroke-width', sw * 2); t.setAttribute('stroke-linejoin', 'round'); t.setAttribute('stroke-linecap', 'round'); }
      else { t.setAttribute('fill', o.fill || C.ink); }
      // 【】标记的字换成强调色
      if (layer === 'front' && o.hl && l.indexOf('【') >= 0) {
        t.textContent = '';
        l.split(/(【[^】]*】)/).forEach(part => {
          if (!part) return;
          const span = S('tspan', {}, t);
          if (part[0] === '【') { span.textContent = part.slice(1, -1); span.setAttribute('fill', o.hl); } else span.textContent = part;
        });
      } else t.textContent = l.replace(/[【】]/g, '');
    });
  };
  if (sw > 0) mk('back');
  mk('front');
  return box;
}
function textW(text, size, disp, ls) { return measure(String(text).replace(/[【】]/g, ''), (disp ? 400 : 700) + ' ' + size + 'px ' + (disp ? F_DISP : F_BOLD), ls); }

function camAt(keys, lt) {
  if (!keys || !keys.length) return { x: 960, y: 540, s: 1 };
  if (lt <= keys[0][0]) return { x: keys[0][1], y: keys[0][2], s: keys[0][3] };
  for (let i = 1; i < keys.length; i++) if (lt <= keys[i][0]) {
    const a = keys[i - 1], b = keys[i], u = eIO((lt - a[0]) / (b[0] - a[0]));
    return { x: lerp(a[1], b[1], u), y: lerp(a[2], b[2], u), s: lerp(a[3], b[3], u) };
  }
  const k = keys[keys.length - 1]; return { x: k[1], y: k[2], s: k[3] };
}
function toScreen(cam, x, y) { return [960 + (x - cam.x) * cam.s, 540 + (y - cam.y) * cam.s]; }
/* 场景容器：底纸 bg（视差 0.25）、装饰 deco（视差 0.55）、世界 world（镜头）、界面 ui（不随镜头） */
function makeScene(parent, cam, bgTone) {
  const root = D('scene', '', parent);
  const p1 = .25, s1 = 1 + (cam.s - 1) * p1;
  const bg = D('abs', 'width:2400px;height:1350px;left:-240px;top:-135px;transform-origin:1200px 675px;transform:translate(' + (-(cam.x - 960) * p1 * cam.s).toFixed(1) + 'px,' + (-(cam.y - 540) * p1 * cam.s).toFixed(1) + 'px) scale(' + s1.toFixed(4) + ');background:url(' + TEX + 'sky.jpg)' + (bgTone ? ';filter:' + bgTone : ''), root);
  const p2 = .55, s2 = 1 + (cam.s - 1) * p2;
  const deco = D('full', 'transform-origin:960px 540px;transform:translate(' + (-(cam.x - 960) * p2 * cam.s).toFixed(1) + 'px,' + (-(cam.y - 540) * p2 * cam.s).toFixed(1) + 'px) scale(' + s2.toFixed(4) + ')', root);
  const world = D('full', 'transform-origin:0 0;transform:translate(960px,540px) scale(' + cam.s.toFixed(4) + ') translate(' + (-cam.x).toFixed(2) + 'px,' + (-cam.y).toFixed(2) + 'px)', root);
  const ui = D('full', '', root);
  return { root, bg, deco, world, ui, cam };
}

/* ---------------- 常用纸片部件 ---------------- */
// 云朵（白纸剪的，几个圆叠成）
function cloud(parent, x, y, s, seed, t, tone) {
  const g = D('pp', 'left:' + x + 'px;top:' + y + 'px;width:' + (260 * s) + 'px;height:' + (120 * s) + 'px', parent);
  const b = boil(seed, t, .7); g.style.transform = 'translate(' + b.x + 'px,' + b.y + 'px)';
  const r = rng(seed); const col = tone || '#fbfeff';
  const parts = [[0, 50, 120, 70], [55, 12, 120, 108], [130, 30, 110, 90], [170, 58, 90, 62]];
  const sh = D('pp-sh', 'filter:' + shadowCSS(1.4, .8), g);
  parts.forEach((p, i) => { const sp = shape(p[2] * s, p[3] * s, { seed: seed + i, circle: true }); D('pp-l', 'left:' + p[0] * s + 'px;top:' + p[1] * s + 'px;width:' + p[2] * s + 'px;height:' + p[3] * s + 'px;clip-path:' + sp.face + ';background:' + col + ' url(' + TEX + 'paper.png) ' + (-seed * 70 % 1024) + 'px 0/1024px', sh); });
  D('pp-l', 'left:' + 20 * s + 'px;top:' + 80 * s + 'px;width:' + 230 * s + 'px;height:' + 40 * s + 'px;border-radius:' + 20 * s + 'px;background:' + col + ' url(' + TEX + 'paper.png) 0 0/1024px', sh);
  return g;
}
// 打孔纸屑（小圆点），慢慢漂
function confetti(parent, t, seed, n, area) {
  const r = rng(seed), cols = [C.butter, C.coral, C.mint, '#ffffff', C.lilac, C.peach];
  for (let i = 0; i < n; i++) {
    const x = area[0] + r() * area[2], y = area[1] + r() * area[3], s = 14 + r() * 22, c = cols[Math.floor(r() * cols.length)], sp = .4 + r() * .6, kind = r();
    const b = boil(seed * 50 + i, t, 1.2), tq = q12(t);
    const yy = y + Math.sin(tq * sp * 1.3 + i) * 6, xx = x + Math.cos(tq * sp + i * 2) * 5;
    const sh = shape(s, s, { seed: seed + i * 3, circle: kind < .7, r: 3, sides: 'cccc' });
    D('pp', 'left:' + (xx + b.x) + 'px;top:' + (yy + b.y) + 'px;width:' + s + 'px;height:' + (kind < .7 ? s : s * .5) + 'px;transform:rotate(' + (r() * 80 - 40 + b.r * 20) + 'deg);filter:' + shadowCSS(1, .7) + ';', parent).innerHTML =
      '<div class="pp-l" style="clip-path:' + sh.face + ';background:' + c + ' url(' + TEX + 'paper.png) 0 0/1024px"></div>';
  }
}
// 板块标签（左上角）：大字 + 小字
function sectionTab(ui, lt, title, sub, color, seed, textCol) {
  const u = seg(q12(lt), .15, .7), y = lerp(-160, 0, antic(u, .1));
  if (u <= 0) return;
  const tw = textW(title, 42, true, 2), sw2 = sub ? textW(sub, 22, false) : 0, w = Math.max(tw, sw2) + 60;
  const b = boil(seed, lt, .8);
  const p = P(ui, { x: 50 + b.x, y: 28 + y + b.y, w, h: sub ? 102 : 78, rot: -2 + b.r, color, seed, sides: 'cccc', r: 12, elev: 2.2 });
  D('abs', 'left:30px;top:12px;font:400 42px ' + F_DISP + ';letter-spacing:2px;color:' + (textCol || C.ink) + ';white-space:nowrap', p.face, title);
  if (sub) D('abs', 'left:31px;top:63px;font:700 22px ' + F_BOLD + ';color:' + (textCol ? 'rgba(255,255,255,.92)' : C.inkS) + ';white-space:nowrap', p.face, sub);
  tape(ui, 56 + w * .5 + b.x, 30 + y + 4, 120, 4, '#ffffff', seed + 3, 'stripe');
}
/* 作品卡便签（右上角，界面层）：作品名 + 年级 */
function workNote(ui, lt, inT, outT, title, sub, extra, color, seed) {
  const tq = q12(lt), u = seg(tq, inT, inT + .4), out = seg(tq, outT - .17, outT);
  if (u <= 0 || out >= 1) return;
  const tw = Math.max(textW(title, 40, true, 1), textW(sub, 25, false)) + 58, w = Math.max(280, tw), x = 1880 - w, y = 34, b = boil(seed, lt, .8);
  const note = P(ui, { x: x + out * 260 + b.x, y: y - out * 160 + (1 - spring(u)) * -90 + b.y, w, h: extra ? 178 : 146, rot: 2.4 + b.r + out * 18, color, seed, sides: 'cccc', r: 6, elev: 2.8, op: 1 - out, curl: true });
  D('abs', 'left:28px;top:24px;font:400 40px ' + F_DISP + ';letter-spacing:1px;color:' + C.ink + ';white-space:nowrap', note.face, title);
  D('abs', 'left:30px;top:88px;font:700 25px ' + F_BOLD + ';color:' + C.ink + ';opacity:.72;white-space:nowrap', note.face, sub);
  if (extra) D('abs', 'left:30px;top:128px;font:700 22px ' + F_BOLD + ';color:' + C.ink + ';opacity:.5;white-space:nowrap', note.face, extra);
  tape(ui, x + w / 2 + out * 260, y + 2 - out * 160 + (1 - spring(u)) * -90, 116, -5, '#ffffff', seed + 1, 'stripe').style.opacity = 1 - out;
}
/* 字幕纸条：贴上去（略过冲），换下一条时被揭走 */
function subtitle(ui, text, lt, dur, idx, nextSame, start, noExit) {
  if (!text) return;
  const tq = q12(lt), size = 54;
  const tw = textW(text, size, false, 1), w = Math.ceil(tw + 112), h = 100, x = 960 - w / 2, y = 1080 - 34 - h;
  const s0 = start == null ? .3 : start, inU = seg(tq, s0, s0 + .33), out = (nextSame || noExit) ? 0 : seg(tq, dur - .17, dur);
  if (inU <= 0 || out >= 1) return;
  const rot0 = idx % 2 ? .7 : -.6, sc = lerp(1.12, 1, spring(inU, 1.4, 7)), rot = rot0 + (1 - spring(inU)) * (idx % 2 ? 3 : -3) + out * 7;
  const op = inU < .1 ? .0 : 1;
  const p = P(ui, { x: x + out * 60, y: y - out * 30, w, h, rot, color: C.cream, seed: 400 + idx, sides: 'ctct', amp: 1.2, r: 6, elev: 3, tf: 'scale(' + sc.toFixed(4) + ')', op: op * (1 - out) });
  const parts = text.split(/(【[^】]*】)/).map(s => s[0] === '【' ? '<span style="background:linear-gradient(transparent 58%,' + rgba(C.butter, .95) + ' 58%,' + rgba(C.butter, .95) + ' 92%,transparent 92%);padding:0 2px">' + s.slice(1, -1) + '</span>' : s).join('');
  D('abs', 'left:0;top:0;width:' + w + 'px;height:' + h + 'px;display:flex;align-items:center;justify-content:center;font:700 ' + size + 'px ' + F_BOLD + ';letter-spacing:1px;color:' + C.ink + ';white-space:nowrap;padding-top:2px', p.face, parts);
  tape(ui, x + 26 + out * 60, y + 10 - out * 30, 92, -32 + rot, C.coral, 500 + idx, 'dot').style.opacity = (1 - out);
}
/* 提示词纸条：逐字打出 + 光标 */
function promptStrip(parent, text, lt, t0, cps, x, y, w, seed, label) {
  if (lt < t0 - .3) return;
  const u = seg(q12(lt), t0 - .3, t0 + .05), size = 36;
  const n = Math.floor(clamp((lt - t0 - .15) * cps, 0, text.length));
  const lab = label || '老师输入', lw = textW(lab, 26, false) + 34;
  const p = P(parent, { x, y: y + (1 - spring(u)) * 40, w, h: 84, rot: -.5, color: '#ffffff', seed, sides: 'cccc', r: 14, elev: 2.6, op: u > 0 ? 1 : 0 });
  const tag = D('abs', 'left:20px;top:20px;height:44px;padding:0 17px;border-radius:22px;background:' + C.coral + ';color:#fff;font:700 26px/44px ' + F_BOLD + ';white-space:nowrap', p.face, lab);
  const caret = (Math.floor(lt * 2.4) % 2 === 0 || n < text.length) ? '<span style="display:inline-block;width:4px;height:40px;background:' + C.coralD + ';vertical-align:-7px;margin-left:3px;border-radius:2px"></span>' : '';
  D('abs', 'left:' + (20 + lw + 14) + 'px;top:0;height:84px;line-height:84px;font:700 ' + size + 'px ' + F_BOLD + ';color:' + C.ink + ';white-space:nowrap', p.face, text.slice(0, n) + caret);
  return p;
}

function rowSubtitles(sc, seq, t) {
  const rows = SH.rows.filter(r => r.seq === seq), i = rows.findIndex(r => t >= r.t0 && t < r.t1 + .001);
  if (i < 0) return;
  const r = rows[i], nx = rows[i + 1];
  // 段落第一条等转场完再贴（.55 秒），段落最后一条跟着整页一起被换走
  subtitle(sc.ui, r.sub, t - r.t0, r.t1 - r.t0, SH.rows.indexOf(r), nx && nx.sub === r.sub, i === 0 && TR[seq] ? .55 : .3, !nx);
}


function drawSeq(parent, s, t) {
  const lt = t - s.t0, cam = s.cam(lt);
  const sc = makeScene(parent, cam);
  s.draw(sc, lt, t);
  return sc;
}
function tornPoly(seed, horizontal, at, amp, side) {   // 一条撕开的分界线把画面分成两半
  const r = rng(seed), pts = [], n1 = vnoise(r, 40), n2 = vnoise(r, 140);
  for (let x = -60; x <= 1980; x += 6) { const y = at + (x - 960) * .18 + amp * (.7 * n1((x + 60) / 52) + .3 * n2((x + 60) / 15)); pts.push([x, y]); }
  const poly = side < 0 ? [[-60, -200]].concat(pts, [[1980, -200]]) : [[-60, 1300]].concat(pts, [[1980, 1300]]);
  return 'polygon(' + poly.map(p => p[0].toFixed(1) + 'px ' + p[1].toFixed(1) + 'px').join(',') + ')';
}
function transition(type, u, a, b, t, tEnd) {
  // 新一页"已经摆好"：进场的画面按转场结束那一刻来画，转场完了接上，不会出现空页
  const tb = Math.max(t, tEnd);
  if (type === 'cover' || type === 'drop') {
    drawSeq(stage, a, t);
    t = tb;
    const k = 1 - antic(clamp(u / .85, 0, 1), .03);
    const holder = D('full', '', stage);
    const sh = D('full', 'filter:' + shadowCSS(6), holder);
    const inner = D('full', '', sh);
    const off = type === 'cover' ? 'translateX(' + (k * 2000).toFixed(1) + 'px) rotate(' + (k * 4) + 'deg)' : 'translateY(' + (k * -1200).toFixed(1) + 'px) rotate(' + (k * -3) + 'deg)';
    inner.style.transform = off; inner.style.transformOrigin = '50% 50%';
    const sp = shape(1920, 1080, { seed: 999, sides: type === 'cover' ? 'cctc' : 'cctc', amp: 3, r: 0 });
    const clip = D('full', 'clip-path:' + (type === 'cover' ? tornEdgeLeft(991) : tornEdgeBottom(992)) + ';overflow:hidden', inner);
    drawSeq(clip, b, t);
    return;
  }
  if (type === 'tear') {
    drawSeq(stage, b, tb);
    const k = Math.pow(q12(clamp(u, 0, 1) * .8) / .8, 1.7);
    [-1, 1].forEach(side => {
      const sh = D('full', 'filter:' + shadowCSS(4 + k * 6), stage);
      const piece = D('full', 'transform-origin:' + (side < 0 ? '0 0' : '100% 100%') + ';transform:translate(' + (side * k * 260) + 'px,' + (side * k * 900) + 'px) rotate(' + (side * k * 9) + 'deg)', sh);
      const fr = D('full', 'clip-path:' + tornPoly(77, true, 560, 26 + 2, side) + ';background:#fffaf1', piece);
      fr.style.transform = 'translateY(' + (side * -3) + 'px)';
      const clip = D('full', 'clip-path:' + tornPoly(77, true, 560, 26, side) + ';overflow:hidden', piece);
      drawSeq(clip, a, t);
    });
    return;
  }
  if (type === 'flipup' || type === 'pageturn') {
    drawSeq(stage, b, tb);
    const k = Math.pow(clamp(q12(u * .8) / .8, 0, 1), 1.5), ang = k * 105;
    const pers = D('full', 'perspective:2600px;perspective-origin:' + (type === 'flipup' ? '50% 0%' : '0% 50%'), stage);
    // 掀起的纸在下面投影
    D('full', 'background:linear-gradient(' + (type === 'flipup' ? '180deg' : '90deg') + ',rgba(20,40,70,' + (.35 * Math.sin(k * Math.PI)).toFixed(3) + '),rgba(20,40,70,0) ' + (20 + k * 60) + '%)', stage);
    const page = D('full', 'transform-origin:' + (type === 'flipup' ? '50% 0' : '0 50%') + ';transform:' + (type === 'flipup' ? 'rotateX(' + ang + 'deg)' : 'rotateY(' + (-ang) + 'deg)') + ';backface-visibility:hidden;overflow:hidden', pers);
    drawSeq(page, a, t);
    D('full', 'background:rgba(255,255,255,' + (k * .5).toFixed(3) + ')', page);
    if (type === 'flipup') { // 顶上的线圈装订
      const ring = D('full', '', stage);
      for (let i = 0; i < 14; i++) D('abs', 'left:' + (90 + i * 134) + 'px;top:-14px;width:22px;height:46px;border-radius:11px;border:6px solid #8f9bb3;background:transparent;filter:' + shadowCSS(1), ring);
    }
  }
}
function tornEdgeLeft(seed) {
  const r = rng(seed), n1 = vnoise(r, 30), n2 = vnoise(r, 100), pts = [];
  for (let y = 0; y <= 1080; y += 6) pts.push([10 + 9 * (.7 * n1(y / 40) + .3 * n2(y / 11)), y]);
  return 'polygon(' + pts.map(p => p[0].toFixed(1) + 'px ' + p[1] + 'px').join(',') + ',2400px 1080px,2400px 0px)';
}
function tornEdgeBottom(seed) {
  const r = rng(seed), n1 = vnoise(r, 50), n2 = vnoise(r, 160), pts = [];
  for (let x = 0; x <= 1920; x += 6) pts.push([x, 1070 + 9 * (.7 * n1(x / 40) + .3 * n2(x / 11))]);
  return 'polygon(0px -400px,' + pts.map(p => p[0] + 'px ' + p[1].toFixed(1) + 'px').join(',') + ',1920px -400px)';
}


/* ================= 段落：照着这三个改成你自己的片子 ================= */
const SEQS = [];
function seqDef(o) { SEQS.push(o); }
const SFX = []; function sfx(t, name, vol, pan) { SFX.push({ t: +t.toFixed(3), name, vol: vol == null ? 1 : vol, pan: pan || 0 }); }
const TR = { points: ['cover', .75], end: ['drop', .75] };   // 进入该段落的转场：cover / drop / tear / flipup / pageturn
const PRE = .3;                                              // 转场在段落开始前 0.3 秒就开始

/* —— 段落 1：标题纸片落下，胶带贴上，一行字一行字冒出来 —— */
seqDef({ id: 'title', t0: 0, t1: 5,
  cam: lt => ({ x: 960, y: 540 + 6 * eIO(seg(lt, 0, 5)), s: 1 + .035 * eIO(seg(lt, 0, 5)) }),
  draw(sc, lt, t) {
    const tq = q12(lt);
    cloud(sc.deco, 60, 110, 1.2, 11, lt); cloud(sc.deco, 1540, 70, 1.05, 12, lt); cloud(sc.deco, 1380, 860, .8, 13, lt);
    confetti(sc.deco, lt, 3, 9, [80, 60, 1760, 950]);
    const u = seg(tq, -.1, .6), dy = (1 - antic(u, .06)) * -820, rot = -1.6 + (1 - antic(u)) * 6;
    const card = P(sc.world, { x: 300, y: 230 + dy, w: 1320, h: 470, rot, color: C.cream, seed: 21, sides: 'cccc', r: 18, elev: 3.4, curl: true });
    tape(sc.world, 960, 236 + dy, 230, -3, C.butter, 21, 'stripe');
    const l1 = seg(tq, .62, .9), l2 = seg(tq, .92, 1.2);
    if (l1 > 0) sticker(card.face, { x: 92, y: 66, text: '一句话，', size: 100, fill: C.ink, sw: 0, tf: 'scale(' + lerp(1.18, 1, spring(l1, 1.3, 7)) + ')', ls: 2 });
    if (l2 > 0) sticker(card.face, { x: 92, y: 216, text: '做一支【纸剪风】视频', size: 100, fill: C.ink, hl: C.coralD, sw: 0, tf: 'scale(' + lerp(1.18, 1, spring(l2, 1.3, 7)) + ')', ls: 2 });
    sectionTab(sc.ui, lt, '最小模板', 'paper-cut-video', C.peach, 70);
    rowSubtitles(sc, 'title', t);
  },
  sfx(add) { add(.12, 'swish', .7); add(.4, 'paper_land', .9); add(.45, 'tape', .6); add(.66, 'pop', .55); add(.96, 'pop', .6); }
});

/* —— 段落 2：三张纸卡依次弹进来（弹簧 + 定格），每张一个"啪" —— */
seqDef({ id: 'points', t0: 5, t1: 10,
  cam: lt => ({ x: 960, y: 540, s: 1 + .03 * eIO(seg(lt, 0, 5)) }),
  draw(sc, lt, t) {
    const tq = q12(lt), cols = [C.coral, C.mint, C.lilac], words = ['纸片', '定格', '配乐'], subs = ['手剪边 + 投影', '12 格/秒', '现场合成'];
    cloud(sc.deco, 1500, 90, 1.0, 21, lt); cloud(sc.deco, 80, 800, .9, 22, lt);
    confetti(sc.deco, lt, 7, 7, [60, 60, 1800, 960]);
    for (let i = 0; i < 3; i++) {
      const u = seg(tq, .5 + i * .45, .95 + i * .45), b = boil(30 + i, lt, .8);
      if (u <= 0) continue;
      const x = 160 + i * 580, y = 300 + (1 - spring(u, 1.3, 7)) * -500 + b.y;
      const p = P(sc.world, { x: x + b.x, y, w: 520, h: 420, rot: [-2.2, 1.4, -.8][i] + (1 - spring(u)) * 6, color: C.cream, seed: 40 + i, sides: 'cctc', r: 14, elev: 3, curl: i === 1 });
      D('abs', 'left:0;top:60px;width:100%;text-align:center;font:400 128px ' + F_DISP + ';color:' + shade(cols[i], -.28), p.face, words[i]);
      D('abs', 'left:0;top:260px;width:100%;text-align:center;font:700 40px ' + F_BOLD + ';color:' + C.inkS, p.face, subs[i]);
      tape(sc.world, x + 260, y + 6, 130, [-4, 3, -2][i], cols[i], 50 + i, i % 2 ? 'dot' : 'stripe');
    }
    sectionTab(sc.ui, lt, '三样东西', '纸片 · 动感 · 声音', C.butter, 71);
    rowSubtitles(sc, 'points', t);
  },
  sfx(add) { add(.5, 'paper_land', .8); add(.95, 'paper_land', .8); add(1.4, 'paper_land', .8); for (let i = 0; i < 3; i++) add(.55 + i * .45, 'tape', .5); }
});

/* —— 段落 3：落版，彩色字砖一块块拍上去，收尾"叮" —— */
seqDef({ id: 'end', t0: 10, t1: 14,
  cam: lt => ({ x: 960, y: 540, s: 1 + .03 * eIO(seg(lt, 0, 4)) }),
  draw(sc, lt, t) {
    const tq = q12(lt), name = '纸剪定格', cs = [C.coral, C.butter, C.mint, C.lilac];
    cloud(sc.deco, 60, 120, 1.1, 31, lt); cloud(sc.deco, 1560, 740, .9, 32, lt);
    confetti(sc.deco, lt, 9, 10, [60, 60, 1800, 960]);
    for (let i = 0; i < name.length; i++) {
      const u = seg(tq, .3 + i * .22, .6 + i * .22), b = boil(60 + i, lt, .8);
      if (u <= 0) continue;
      const x = 960 - 2 * 210 + i * 210 + b.x, y = 330 + (1 - spring(u, 1.3, 7)) * -420 + b.y;
      const p = P(sc.world, { x, y, w: 190, h: 220, rot: [-3, 2, -1.5, 3][i] + (1 - spring(u)) * 8, color: cs[i], seed: 80 + i, sides: 'cccc', r: 18, elev: 3 });
      D('abs', 'left:0;top:34px;width:100%;text-align:center;font:400 130px ' + F_DISP + ';color:' + (i % 2 ? C.ink : '#fff'), p.face, name[i]);
    }
    const u2 = seg(tq, 1.5, 1.9);
    if (u2 > 0) {
      const w = Math.ceil(textW('你的名字 · 示例', 40, false, 1)) + 80, p = P(sc.world, { x: 960 - w / 2, y: 640 + (1 - spring(u2)) * 60, w, h: 84, rot: -1.2, color: C.paper, seed: 99, sides: 'ctct', r: 6, elev: 2.4 });
      D('abs', 'left:0;top:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;font:700 40px ' + F_BOLD + ';letter-spacing:1px;color:' + C.ink, p.face, '你的名字 · 示例');
      tape(sc.world, 960 - w / 2 + 40, 646 + (1 - spring(u2)) * 60, 100, -30, C.coral, 98, 'dot');
    }
    rowSubtitles(sc, 'end', t);
  },
  sfx(add) { for (let i = 0; i < 4; i++) add(.35 + i * .22, 'pop', .6); add(.5, 'paper_land', .6); add(1.55, 'pat', .5); add(1.9, 'finale', 1); }
});

/* ---------------- 主入口 ---------------- */
function fx(t) {   // 全片统一叠加：暗角、暖光、胶片颗粒（逐格轮换）
  D('full vig', '', stage); D('full warm', '', stage);
  const k = Math.floor(t * 12) % 4;
  D('full', 'background:url(' + TEX + 'grain' + k + '.png) 0 0/1920px 1080px;opacity:.5', stage);
}
window.renderAt = async function (t) {
  IMGS = []; stage.innerHTML = '';
  let done = false;
  for (let i = 1; i < SEQS.length; i++) {
    const s = SEQS[i], tr = TR[s.id]; if (!tr) continue;
    const T0 = s.t0 - PRE, T1 = T0 + tr[1];
    if (t >= T0 && t < T1) { transition(tr[0], (t - T0) / tr[1], SEQS[i - 1], s, t, T1); done = true; break; }
  }
  if (!done) { let s = SEQS[0]; for (const x of SEQS) if (t >= x.t0) s = x; drawSeq(stage, s, t); }
  fx(t);
  return true;
};
window.__events = function () {
  SFX.length = 0;
  SEQS.forEach(s => { const add = (lt, n, v, p) => sfx(s.t0 + lt, n, v, p); if (s.sfx) s.sfx(add); });
  SH.rows.forEach((r, i) => {   // 字幕纸条贴上去的轻拍声
    if (!r.sub) return; const prev = SH.rows[i - 1];
    if (prev && prev.sub === r.sub && prev.seq === r.seq) return;
    const first = !prev || prev.seq !== r.seq;
    sfx(r.t0 + (first && TR[r.seq] ? .57 : .32), 'pat', .35);
  });
  SEQS.forEach(s => { const tr = TR[s.id]; if (tr) sfx(s.t0 - PRE + .02, { cover: 'slide', drop: 'slide', tear: 'tear', flipup: 'flip', pageturn: 'flip' }[tr[0]], .8); });
  return SFX.sort((a, b) => a.t - b.t);
};
(async function init() {
  SH = await (await fetch('shots.json')).json();
  await document.fonts.load('400 100px STHupo'); await document.fonts.load('700 50px "Microsoft YaHei"');
  window.__ready = true;
  const m = location.hash.match(/t=([\d.]+)/); if (m) window.renderAt(parseFloat(m[1]));
})();
