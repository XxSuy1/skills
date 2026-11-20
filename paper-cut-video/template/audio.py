"""纸剪定格 · 最小模板的配乐与音效：全部用 numpy 现场合成（不下载素材），按 out/events.json 对点混音。
用法：python -X utf8 audio.py [--events out/events.json] [--out out/mix.wav]
配乐：F 大调 120BPM，一小节 2 秒，总长取 shots.json 的 duration（取 2 的倍数，段落切换都落在小节线上）。
  乐器：拨弦（Karplus-Strong 尤克里里）、马林巴、钟琴、圆润贝斯、柔和铺底、鼓组。
  编曲：开头轻（铺底 + 马林巴琶音）→ 中段加贝斯、扫弦、底鼓、沙锤 → 最后"一击"（镲 + 底鼓 + F 大和弦）后延音渐弱。
音效库 25 种（纸滑/落/撕/翻、胶带、打字、点击、叮、finale…），在 film.js 的 sfx(add) 里按名字调用。
想改曲子：改下面的 compose()；想加音效：在 sfx_bank() 里加一个函数并登记到 SFX_GAIN。
追加片尾段：AUDIO_EXTRA=<秒> 让配乐在原结尾前一小节接着往下走（见 skill 的 pipeline.md）。"""
import functools, json, math, os, sys, wave
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
OUTD = os.path.join(HERE, 'out')
SR = 44100
DUR = float(json.load(open(os.path.join(HERE, 'shots.json'), encoding='utf-8'))['duration'])
EXTRA = float(os.environ.get('AUDIO_EXTRA', '0'))
TAG0 = DUR - 2.0
DUR = DUR + EXTRA
BPM = 120.0
BEAT = 60.0 / BPM          # 0.5 秒
BAR = BEAT * 4             # 2 秒
rng = np.random.default_rng(160)


def mtof(m): return 440.0 * 2 ** ((m - 69) / 12.0)
def t_(n): return np.arange(n) / SR


def env_adsr(n, a=0.005, d=0.1, s=0.6, r=0.2, hold=None):
    t = t_(n); e = np.ones(n)
    a_n = max(1, int(a * SR)); e[:a_n] = np.linspace(0, 1, a_n)
    hold = (n / SR - r) if hold is None else hold
    dmask = (t >= a) & (t < a + d); e[dmask] = 1 - (1 - s) * (t[dmask] - a) / d
    e[(t >= a + d)] = s
    rmask = t >= hold; e[rmask] = s * np.clip(1 - (t[rmask] - hold) / max(r, 1e-3), 0, 1)
    return e


def fft_filter(x, lo=None, hi=None, slope=1.0):
    """简单的 FFT 带通（平滑边缘），用于短音效。"""
    n = len(x); X = np.fft.rfft(x); f = np.fft.rfftfreq(n, 1 / SR); g = np.ones_like(f)
    if lo: g *= 1 / (1 + (lo / np.maximum(f, 1)) ** (2 * slope))
    if hi: g *= 1 / (1 + (f / hi) ** (2 * slope))
    return np.fft.irfft(X * g, n)


def onepole_lp(x, cutoff):
    """时变一阶低通（cutoff 可为数组），逐样本循环，只用于短音效。"""
    y = np.zeros_like(x); c = np.broadcast_to(np.asarray(cutoff, dtype=float), x.shape)
    a = 1 - np.exp(-2 * np.pi * c / SR); s = 0.0
    for i in range(len(x)):
        s += a[i] * (x[i] - s); y[i] = s
    return y


def norm(x, peak=0.9):
    m = np.max(np.abs(x)) + 1e-9
    return x * (peak / m)


# ---------------------------------------------------------------- 乐器
@functools.lru_cache(maxsize=None)
def pluck(freq, dur, bright=0.55, decay=0.9965, seed=0):
    """Karplus-Strong 拨弦；按整数延迟生成后重采样到准确音高。"""
    r = np.random.default_rng(seed)
    N = max(2, int(round(SR / freq))); f0 = SR / N
    n = int(dur * SR * freq / f0) + N + 2
    out = np.zeros(n)
    burst = r.uniform(-1, 1, N)
    k = max(1, int(1 + (1 - bright) * 6))
    burst = np.convolve(burst, np.ones(k) / k, mode='same')   # 拨片越软，起音越暗
    out[:N] = burst
    for s in range(N, n, N):
        e = min(s + N, n)
        prev = out[s - N:e - N]
        prev2 = np.concatenate(([out[s - N - 1] if s - N - 1 >= 0 else 0.0], out[s - N:e - N - 1]))
        out[s:e] = decay * 0.5 * (prev + prev2)
    pos = np.arange(int(dur * SR)) * (freq / f0)
    y = np.interp(pos, np.arange(n), out)
    y *= env_adsr(len(y), a=0.002, d=0.05, s=1.0, r=0.06)
    return y


@functools.lru_cache(maxsize=None)
def marimba(freq, dur=1.2, vel=1.0):
    n = int(dur * SR); t = t_(n)
    y = (np.sin(2 * np.pi * freq * t) * np.exp(-t * 3.2) + 0.32 * np.sin(2 * np.pi * freq * 3.93 * t) * np.exp(-t * 11)
         + 0.1 * np.sin(2 * np.pi * freq * 9.24 * t) * np.exp(-t * 26))
    click = rng.normal(0, 1, n) * np.exp(-t * 400) * 0.12
    y = (y + fft_filter(click, 800, 6000)) * np.minimum(1, t / 0.002)
    return y * vel


@functools.lru_cache(maxsize=None)
def glock(freq, dur=2.0, vel=1.0):
    n = int(dur * SR); t = t_(n)
    y = (np.sin(2 * np.pi * freq * t) * np.exp(-t * 1.6) + 0.42 * np.sin(2 * np.pi * freq * 2.76 * t) * np.exp(-t * 3.8)
         + 0.2 * np.sin(2 * np.pi * freq * 5.40 * t) * np.exp(-t * 7) + 0.08 * np.sin(2 * np.pi * freq * 8.93 * t) * np.exp(-t * 12))
    return y * np.minimum(1, t / 0.0015) * vel


@functools.lru_cache(maxsize=None)
def bass(freq, dur, vel=1.0):
    n = int(dur * SR); t = t_(n)
    ph = 2 * np.pi * freq * t
    y = np.sin(ph) + 0.28 * np.sin(2 * ph) + 0.08 * np.sin(3 * ph)
    y = np.tanh(1.4 * y) * np.exp(-t * 2.2) * env_adsr(n, a=0.006, d=0.05, s=1, r=0.08)
    return y * vel


def pad(freqs, dur, vel=1.0):
    return _pad(tuple(round(f, 3) for f in freqs), round(dur, 3)) * vel


@functools.lru_cache(maxsize=None)
def _pad(freqs, dur):
    """柔和铺底：每个音 3 根略去谐的锯齿（前 10 个谐波），左右声道去谐不同，慢起慢收。"""
    n = int(dur * SR); t = t_(n); L = np.zeros(n); R = np.zeros(n)
    for f in freqs:
        for det, side in ((-0.11, 0), (0.0, 2), (0.12, 1)):
            ff = f * 2 ** (det / 12)
            w = sum(np.sin(2 * np.pi * ff * k * t + k) / k ** 1.3 for k in range(1, 7))
            if side in (0, 2): L += w
            if side in (1, 2): R += w
    e = env_adsr(n, a=0.5, d=0.3, s=0.85, r=0.8)
    trem = 1 + 0.06 * np.sin(2 * np.pi * 0.35 * t)
    return np.stack([L * e * trem, R * e * trem], 1) / max(1, len(freqs))


def kick(vel=1.0):
    n = int(0.35 * SR); t = t_(n)
    f = 48 + 95 * np.exp(-t * 28)
    ph = 2 * np.pi * np.cumsum(f) / SR
    y = np.sin(ph) * np.exp(-t * 9) + 0.25 * fft_filter(rng.normal(0, 1, n) * np.exp(-t * 220), 1500, 6000)
    return np.tanh(1.6 * y) * vel


def clap(vel=1.0):
    n = int(0.3 * SR); t = t_(n); x = rng.normal(0, 1, n)
    e = np.zeros(n)
    for k, o in enumerate((0, 0.011, 0.022)):
        m = t >= o; e[m] += np.exp(-(t[m] - o) * (180 if k < 2 else 26)) * (0.8 if k < 2 else 1.0)
    return fft_filter(x * e, 900, 5200) * 1.4 * vel


def shaker(vel=1.0):
    n = int(0.11 * SR); t = t_(n)
    e = np.minimum(1, t / 0.018) * np.exp(-np.maximum(0, t - 0.018) * 45)
    return fft_filter(rng.normal(0, 1, n) * e, 5000, 13000) * 0.9 * vel


def wood(freq=1750, vel=1.0):
    n = int(0.09 * SR); t = t_(n)
    y = np.sin(2 * np.pi * freq * t) * np.exp(-t * 70) + 0.5 * np.sin(2 * np.pi * freq * 1.52 * t) * np.exp(-t * 95)
    return y * vel


def snap(vel=1.0):
    n = int(0.12 * SR); t = t_(n)
    y = fft_filter(rng.normal(0, 1, n) * np.exp(-t * 90), 1800, 7000) + 0.5 * np.sin(2 * np.pi * 2200 * t) * np.exp(-t * 120)
    return y * vel


def _tail(n, secs):
    """末尾 secs 秒余弦淡出（长音收尾不被截断出"咔"声）。"""
    e = np.ones(n); k = min(n, int(secs * SR))
    if k > 1: e[n - k:] = .5 * (1 + np.cos(np.linspace(0, np.pi, k)))
    return e


def crash(dur=2.6, vel=1.0):
    """镲：高通噪声 + 几根不谐和的金属泛音，长衰减。"""
    n = int(dur * SR); t = t_(n)
    y = fft_filter(rng.normal(0, 1, n), 3500, 15000) * np.exp(-t * 1.9)
    y = y + sum(a * np.sin(2 * np.pi * f * t + f) * np.exp(-t * d) for f, a, d in ((3150, .10, 2.6), (4730, .08, 3.0), (6320, .06, 3.4), (8870, .05, 4.0)))
    return y * np.minimum(1, t / .002) * _tail(n, .6) * vel


def hat(vel=1.0):
    n = int(.13 * SR); t = t_(n)
    return fft_filter(rng.normal(0, 1, n), 7000, 15000) * np.exp(-t * 38) * vel


def tom(freq, vel=1.0):
    n = int(.4 * SR); t = t_(n)
    f = freq * (1 + .45 * np.exp(-t * 28))
    y = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 8) + fft_filter(rng.normal(0, 1, n), 800, 5000) * np.exp(-t * 90) * .3
    return np.tanh(1.3 * y) * vel


def sub(freq, dur, vel=1.0):
    n = int(dur * SR); t = t_(n)
    return np.sin(2 * np.pi * freq * t) * np.exp(-t * 1.1) * np.minimum(1, t / .006) * _tail(n, 1.2) * vel


def chord_ring(freqs, dur, tau=2.0):
    """收尾的延音和弦：和铺底同一种去谐锯齿，但起音快（20ms）、按指数慢慢变弱，最后 1.5 秒淡到零。"""
    n = int(dur * SR); t = t_(n); L = np.zeros(n); R = np.zeros(n)
    for f in freqs:
        for det, side in ((-0.09, 0), (0.0, 2), (0.1, 1)):
            ff = f * 2 ** (det / 12)
            w = sum(np.sin(2 * np.pi * ff * k * t + k) / k ** 1.5 for k in range(1, 6))
            if side in (0, 2): L += w
            if side in (1, 2): R += w
    e = np.minimum(1, t / .02) * np.exp(-t / tau) * _tail(n, 1.5)
    return np.stack([L * e, R * e], 1) / max(1, len(freqs))


def swell(dur=1.2, vel=1.0):
    n = int(dur * SR); t = t_(n)
    x = rng.normal(0, 1, n) * (t / dur) ** 2.2
    return fft_filter(x, 3000, 12000) * vel


# ---------------------------------------------------------------- 配乐
class Track:
    def __init__(self, dur):
        self.buf = np.zeros((int(dur * SR) + SR * 3, 2))

    def add(self, at, sig, vol=1.0, pan=0.0):
        i = int(round(at * SR))
        if i >= len(self.buf): return
        if sig.ndim == 1:
            l, r = math.cos((pan + 1) * math.pi / 4), math.sin((pan + 1) * math.pi / 4)
            sig = np.stack([sig * l, sig * r], 1) * math.sqrt(2)
        n = min(len(sig), len(self.buf) - i)
        self.buf[i:i + n] += sig[:n] * vol


CH = {  # 和弦：(低音 MIDI, 和弦音)
    'F': (41, [60, 65, 69]), 'C/E': (40, [60, 64, 67]), 'Dm': (38, [62, 65, 69]), 'Bb': (46, [62, 65, 70]),
    'C': (36, [60, 64, 67]), 'Am': (45, [60, 64, 69]), 'Gm': (43, [62, 67, 70]), 'Csus': (36, [60, 65, 67]), 'Bbmaj7': (46, [62, 65, 69])}
PROG_A = ['F', 'C/E', 'Dm', 'Bb']
PROG_B = ['Dm', 'Bb', 'F', 'C']
PROG_E = ['Bb', 'C', 'F', 'F']
MOTIF_1 = [(0, 69, 1), (2, 72, 1), (3, 74, .5), (4, 72, 1), (6, 69, 1)]
MOTIF_2 = [(0, 67, 1), (2, 69, 1), (4, 65, 2)]


def compose():
    """最小编曲：按小节循环 F–C/E–Dm–Bb。0–5 秒开场轻；5–10 秒加贝斯/扫弦/底鼓/沙锤；10 秒"一击"，之后延音和弦 + 马林巴琶音收尾。"""
    mus = Track(DUR)
    HIT = 10.0
    for b in range(int(DUR / BAR)):
        t0 = b * BAR; chord = PROG_A[b % 4]; root, tri = CH[chord]
        intro, groove, outro = t0 < 5, 5 <= t0 < HIT, t0 >= HIT
        mus.add(t0, pad([mtof(m - 12) for m in tri] + [mtof(root + 12)], BAR + .6), .085 * (.5 if intro else .38 if groove else .3))
        if groove:
            for pos, d in ((0, 1.5), (1.5, .5), (2, 1), (3, .5), (3.5, .5)):
                mus.add(t0 + pos * BEAT, bass(mtof(root + (12 if pos == 3.5 else 0)), d * BEAT + .05), .22 if pos == 0 else .16)
            for si, (pos, dr) in enumerate(((0, 'd'), (1, 'd'), (1.5, 'u'), (2.5, 'u'), (3, 'd'), (3.5, 'u'))):
                notes = tri + [tri[0] + 12]
                if dr == 'u': notes = notes[::-1]
                for j, m in enumerate(notes):
                    mus.add(t0 + pos * BEAT + j * .011, pluck(mtof(m), .45, bright=.6 if dr == 'd' else .45, seed=(b * 31 + j + int(pos * 4)) % 5), (.13 if dr == 'd' else .09) * (1 if pos in (0, 2) else .8), pan=-.25 + j * .05)
            for beat in range(4):
                if beat in (0, 2): mus.add(t0 + beat * BEAT, kick(), .32)
                if beat in (1, 3): mus.add(t0 + beat * BEAT, clap(), .2, pan=.05)
            for s16 in range(16): mus.add(t0 + s16 * BEAT / 4 + (.018 if s16 % 2 else 0), shaker(), .06 if s16 % 2 else .1, pan=.35)
            for pos, m, d in [MOTIF_1, MOTIF_2][b % 2]: mus.add(t0 + pos * BEAT / 2, glock(mtof(m + 12), 1.6), .2, pan=.15)
        else:   # 开场和收尾：马林巴琶音
            arp = tri + [tri[1] + 12, tri[2] + 12, tri[1] + 12]
            for k in range(4): mus.add(t0 + k * BEAT, marimba(mtof(arp[k % len(arp)]), 1.0), (.12 if intro else .1) * (1.1 if k == 0 else .85), pan=.3)
    # "一击"：镲 + 底鼓 + 贝斯 + 超低音 + 宽音域 F 大和弦 + 钟琴和弦 + 延音和弦，之后只剩和弦慢慢变弱
    mus.add(HIT - 1.4, swell(1.4), .15)
    mus.add(HIT, crash(3.6), .26, pan=-.1); mus.add(HIT, kick(), .46)
    mus.add(HIT, bass(mtof(41), 3.2), .3); mus.add(HIT, sub(mtof(29), 4.0), .2)
    for j, m in enumerate((53, 57, 60, 65, 69, 72, 77)):
        y = pluck(mtof(m), 5.6, bright=.6, decay=.997, seed=900 + j)
        mus.add(HIT + j * .012, y * _tail(len(y), 2.0), .12, pan=-.3 + j * .1)
    for j, m in enumerate((77, 81, 84, 89)): mus.add(HIT + .02 + j * .03, glock(mtof(m), 4.0), .1, pan=-.2 + j * .13)
    mus.add(HIT, chord_ring([mtof(m) for m in (53, 57, 60, 65, 69, 72)], 6.0, tau=3.0), .27)
    if EXTRA:   # 追加段：Dm–Bb–F 三小节，从原结尾前一小节起，末小节落回主音 F
        for i, chord in enumerate(['Dm', 'Bb', 'F']):
            t0 = TAG0 + i * BAR; root, tri = CH[chord]
            mus.add(t0, pad([mtof(m - 12) for m in tri] + [mtof(root + 12)], BAR + .6), .085 * .55)
            mus.add(t0, bass(mtof(root), BEAT * 2), .16); mus.add(t0 + 2 * BEAT, bass(mtof(root + 7), BEAT * 2), .12)
            arp = tri + [tri[1] + 12, tri[2] + 12, tri[1] + 12]
            for k in range(4): mus.add(t0 + k * BEAT, marimba(mtof(arp[k % len(arp)]), 1.0), .13 * (1.1 if k == 0 else .85), pan=.3)
        mus.add(TAG0 + 2 * BAR, glock(mtof(77), 3.4), .15, pan=.1)
        mus.add(TAG0 + 2 * BAR, chord_ring([mtof(m) for m in (53, 57, 60, 65, 69, 72)], 4.0, tau=2.2), .2)
    return mus


# ---------------------------------------------------------------- 音效
def place(n, sig, at):
    y = np.zeros(n); i = int(at * SR); k = min(len(sig), n - i)
    if k > 0: y[i:i + k] = sig[:k]
    return y


def sfx_bank():
    B = {}
    def add(name, fn, variants=3):
        B[name] = [norm(fn(np.random.default_rng(sum(map(ord, name)) * 101 + v)), .9) for v in range(variants)]

    def swish(r):
        n = int(.34 * SR); t = t_(n); x = r.normal(0, 1, n)
        e = np.sin(np.pi * np.clip(t / .34, 0, 1)) ** 1.6
        return onepole_lp(fft_filter(x, 900, None), 2500 + 4000 * np.sin(np.pi * t / .34)) * e
    def slide(r):
        n = int(.55 * SR); t = t_(n); x = r.normal(0, 1, n)
        grain = 1 + .5 * np.interp(t, np.linspace(0, .55, 40), r.uniform(-1, 1, 40))
        e = np.minimum(1, t / .06) * np.exp(-np.maximum(0, t - .32) * 9)
        return fft_filter(x, 500, 4500) * e * grain
    def land(r):
        n = int(.22 * SR); t = t_(n)
        thump = np.sin(2 * np.pi * (70 + 60 * np.exp(-t * 40)) * t) * np.exp(-t * 32)
        slap = fft_filter(r.normal(0, 1, n), 1800, 7000) * np.exp(-t * 85)
        return thump * .9 + slap * .55
    def flip(r):
        n = int(.5 * SR); t = t_(n); x = fft_filter(r.normal(0, 1, n), 700, 6500); e = np.zeros(n)
        for k, o in enumerate(np.cumsum([0, .06, .05, .045, .04, .05])):
            m = t >= o; e[m] += np.exp(-(t[m] - o) * 60) * (.6 + .1 * k)
        e += np.sin(np.pi * np.clip(t / .5, 0, 1)) * .25
        return x * e + place(n, land(r), .38) * .3
    def tear(r):
        n = int(.6 * SR); t = t_(n); imp = np.zeros(n)
        rate = 1400 * np.sin(np.pi * np.clip(t / .6, 0, 1)) ** .7
        idx = np.nonzero(r.uniform(0, 1, n) < rate / SR)[0]; imp[idx] = r.uniform(.3, 1, len(idx)) * r.choice([-1, 1], len(idx))
        crackle = fft_filter(np.convolve(imp, np.exp(-np.arange(60) / 8), mode='same'), 1200, 8000)
        bed = fft_filter(r.normal(0, 1, n), 600, 4000) * .25 * np.sin(np.pi * np.clip(t / .6, 0, 1))
        return crackle + bed
    def tape(r):
        n = int(.24 * SR); t = t_(n); imp = np.zeros(n)
        idx = np.nonzero(r.uniform(0, 1, n) < 2600 / SR * (t < .16))[0]; imp[idx] = r.uniform(.4, 1, len(idx))
        rip = fft_filter(np.convolve(imp, np.exp(-np.arange(40) / 5), mode='same'), 900, 6000)
        return rip + place(n, land(r), .17) * .35
    def pop(r):
        n = int(.12 * SR); t = t_(n)
        f = 380 + 700 * (1 - np.exp(-t * 60))
        return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 38) * np.minimum(1, t / .002)
    def pat(r):
        n = int(.12 * SR); t = t_(n)
        return np.sin(2 * np.pi * 150 * t) * np.exp(-t * 45) * .8 + fft_filter(r.normal(0, 1, n), 1500, 6000) * np.exp(-t * 120) * .35
    def tick(r): return wood(1900 + r.uniform(-60, 60), 1.0)
    def scribble(r):
        n = int(.75 * SR); t = t_(n); x = fft_filter(r.normal(0, 1, n), 2200, 7500)
        strokes = .55 + .45 * np.abs(np.sin(2 * np.pi * (7.5 + r.uniform(-1, 1)) * t)) ** 1.5
        return x * strokes * np.minimum(1, t / .03) * np.exp(-np.maximum(0, t - .6) * 25)
    def typek(r):
        n = int(.06 * SR); t = t_(n)
        return fft_filter(r.normal(0, 1, n), 2500, 9000) * np.exp(-t * 260) + np.sin(2 * np.pi * r.uniform(260, 340) * t) * np.exp(-t * 120) * .5
    def key(r):
        n = int(.14 * SR); t = t_(n); y = typek(r)
        y = np.concatenate([y, np.zeros(n - len(y))]) * 1.0
        up = np.zeros(n); o = int(.07 * SR); up[o:o + len(typek(r))] = typek(r) * .55
        return y + up + np.sin(2 * np.pi * 180 * t) * np.exp(-t * 60) * .45
    def click(r):
        n = int(.05 * SR); t = t_(n)
        return fft_filter(r.normal(0, 1, n), 3000, 11000) * np.exp(-t * 400) + np.sin(2 * np.pi * 4200 * t) * np.exp(-t * 300) * .4
    def grab(r):
        n = int(.16 * SR); t = t_(n)
        return fft_filter(r.normal(0, 1, n), 1500, 6000) * np.minimum(1, t / .04) * np.exp(-t * 22) * .6
    def drop(r):
        n = int(.16 * SR); t = t_(n)
        y = np.sin(2 * np.pi * 120 * t) * np.exp(-t * 40) * .7; c = click(r); y[:len(c)] += c * .5
        return y
    def ding(r):
        n = int(1.4 * SR); t = t_(n); y = np.zeros(n)
        for k, (m, o) in enumerate(((84, 0), (88, .085))):
            f = mtof(m); tt = np.clip(t - o, 0, None); on = t >= o
            mod = np.sin(2 * np.pi * f * 3.5 * tt) * 2.2 * np.exp(-tt * 6)
            y += on * np.sin(2 * np.pi * f * tt + mod) * np.exp(-tt * 3.2) * (1 if k else .8)
        return y
    def chime(r):
        n = int(2.2 * SR); y = np.zeros(n)
        for k, m in enumerate((84, 88, 91, 96)):
            g = glock(mtof(m), 1.8); o = int(k * .09 * SR); y[o:o + len(g)] += g[:n - o] * (.8 + .05 * k)
        return y
    def score(r):
        n = int(.5 * SR); y = np.zeros(n)
        for k, m in enumerate((79, 86)):
            g = glock(mtof(m + 12), .4); o = int(k * .07 * SR); y[o:o + len(g)] += g[:n - o]
        return y + np.concatenate([pop(r), np.zeros(n - len(pop(r)))]) * .5
    def card(r):
        n = int(.18 * SR); t = t_(n)
        return fft_filter(r.normal(0, 1, n), 1500, 7000) * np.sin(np.pi * np.clip(t / .12, 0, 1)) * (t < .12) + np.concatenate([click(r) * .6, np.zeros(n - len(click(r)))])
    def snip(r):
        n = int(.32 * SR); t = t_(n); y = np.zeros(n)
        for o, g in ((0, .8), (.13, 1.0)):
            tt = np.clip(t - o, 0, None); on = t >= o
            y += on * g * sum(a * np.sin(2 * np.pi * f * tt) * np.exp(-tt * d) for f, a, d in ((3150, 1, 70), (5120, .6, 90), (7400, .35, 120)))
        shear = fft_filter(r.normal(0, 1, n), 2500, 9000) * np.exp(-((t - .08) / .045) ** 2) * .5
        return y + shear
    def wifi_off(r):
        n = int(.5 * SR); t = t_(n)
        f = np.where(t < .16, mtof(79), mtof(72))
        return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 4) * env_adsr(n, .005, .05, .8, .2)
    def paper_fall(r):
        n = int(.8 * SR); t = t_(n); x = fft_filter(r.normal(0, 1, n), 800, 5000)
        flutter = .5 + .5 * np.abs(np.sin(2 * np.pi * (9 - 5 * t) * t))
        return x * flutter * np.sin(np.pi * np.clip(t / .8, 0, 1)) * .8
    def stamp(r):
        n = int(.3 * SR); t = t_(n)
        return np.tanh(2 * np.sin(2 * np.pi * (60 + 80 * np.exp(-t * 50)) * t) * np.exp(-t * 18)) + fft_filter(r.normal(0, 1, n), 700, 5000) * np.exp(-t * 40) * .6
    def finale(r):
        """落版时清脆的一声"叮"（三角铁式：F7 主音 + 不谐和泛音 + 敲击瞬态），底下垫一串很轻的 F 大三和弦钟琴。"""
        n = int(2.8 * SR); t = t_(n); f = mtof(101)
        y = (np.sin(2 * np.pi * f * t) * np.exp(-t * 2.0) + .45 * np.sin(2 * np.pi * f * 2.76 * t) * np.exp(-t * 4.5)
             + .22 * np.sin(2 * np.pi * f * 5.4 * t) * np.exp(-t * 8))
        y = y + fft_filter(r.normal(0, 1, n), 6000, None) * np.exp(-t * 500) * .35
        for k, m in enumerate((89, 93, 96)):
            g = glock(mtof(m), 2.6); o = int((.03 + k * .045) * SR); y[o:o + len(g)] += g[:n - o] * .35
        return y * np.minimum(1, t / .001) * _tail(n, .8)
    def whoosh(r):
        n = int(.6 * SR); t = t_(n); x = r.normal(0, 1, n)
        return onepole_lp(x, 400 + 5000 * np.sin(np.pi * np.clip(t / .6, 0, 1)) ** 2) * np.sin(np.pi * np.clip(t / .6, 0, 1)) ** 1.5

    for name, fn in (('swish', swish), ('slide', slide), ('paper_land', land), ('flip', flip), ('tear', tear), ('tape', tape), ('pop', pop),
                     ('pat', pat), ('tick', tick), ('scribble', scribble), ('type', typek), ('key', key), ('click', click), ('grab', grab),
                     ('drop', drop), ('ding', ding), ('chime', chime), ('score', score), ('card', card), ('snip', snip), ('wifi_off', wifi_off),
                     ('paper_fall', paper_fall), ('stamp', stamp), ('whoosh', whoosh), ('finale', finale)):
        add(name, fn, 1 if name in ('ding', 'chime', 'score', 'wifi_off', 'finale') else 4)
    return B


SFX_GAIN = {'swish': .32, 'slide': .38, 'paper_land': .5, 'flip': .45, 'tear': .5, 'tape': .32, 'pop': .3, 'pat': .3, 'tick': .22, 'scribble': .26,
            'type': .26, 'key': .42, 'click': .32, 'grab': .22, 'drop': .3, 'ding': .36, 'chime': .38, 'score': .34, 'card': .3, 'snip': .55,
            'wifi_off': .22, 'paper_fall': .3, 'stamp': .55, 'whoosh': .26, 'finale': .42}


def reverb(x, secs=1.3, wet=.14, seed=5):
    """简单的立体声卷积混响（指数衰减噪声脉冲），让配乐和音效像在同一个房间。"""
    r = np.random.default_rng(seed); n = int(secs * SR); t = t_(n)
    out = np.zeros_like(x)
    for c in range(2):
        ir = r.normal(0, 1, n) * np.exp(-t * 5.0 / secs); ir[:int(.012 * SR)] *= np.linspace(0, 1, int(.012 * SR))
        ir = fft_filter(ir, 200, 7000); ir /= np.sqrt(np.sum(ir ** 2))
        L = len(x[:, c]) + n; N = 1 << (L - 1).bit_length()
        y = np.fft.irfft(np.fft.rfft(x[:, c], N) * np.fft.rfft(ir, N), N)[:len(x)]
        out[:, c] = y
    return x * (1 - wet) + out * wet * 2.2


def write_wav(path, x):
    x = np.clip(x, -1, 1)
    with wave.open(path, 'wb') as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((x * 32767).astype('<i2').tobytes())


def main(argv):
    ev_path = os.path.join(OUTD, 'events.json'); out = os.path.join(OUTD, 'mix.wav')
    for i, a in enumerate(argv):
        if a == '--events': ev_path = argv[i + 1]
        if a == '--out': out = argv[i + 1]
    events = json.load(open(ev_path, encoding='utf-8'))
    os.makedirs(os.path.dirname(out), exist_ok=True)
    print('合成配乐…')
    mus = compose().buf[:int(DUR * SR) + SR]
    print('合成音效…')
    bank = sfx_bank()
    fx = Track(DUR); count = {}
    for e in events:
        name = e['name']
        if name not in bank: print('  缺音效', name); continue
        k = count.get(name, 0); count[name] = k + 1
        fx.add(e['t'], bank[name][k % len(bank[name])], SFX_GAIN[name] * e.get('vol', 1), pan=e.get('pan', 0) + ((k % 3) - 1) * .12)
    fxb = fx.buf[:len(mus)]
    # 侧链压低：音效响的时候配乐让一让（约 -3dB），释放平滑
    envl = np.abs(fxb).max(1); k = int(.03 * SR); envl = np.convolve(envl, np.ones(k) / k, mode='same')
    duck = 1 - .3 * np.clip(envl / .25, 0, 1); sm = int(.18 * SR); duck = np.convolve(duck, np.ones(sm) / sm, mode='same')
    music = reverb(mus, 1.6, .18) * duck[:, None]
    mix = music * .95 + reverb(fxb, .9, .08)
    # 首尾淡入淡出：最后 2 秒（追加段时 3 秒）余弦淡出兜底，不硬切
    fi = int(.4 * SR); fo = int((3.0 if EXTRA else 2.0) * SR); end = int(DUR * SR)
    mix[:fi] *= np.linspace(0, 1, fi)[:, None]
    mix[end - fo:end] *= (.5 * (1 + np.cos(np.linspace(0, np.pi, fo))))[:, None]
    mix = np.tanh(mix[:end] / .9 * 1.1) * .9        # 软限幅
    mix = norm(mix, 10 ** (-1.0 / 20))              # 峰值 -1 dBFS
    write_wav(out, mix)
    print('写出', out, '%.1f 秒' % (len(mix) / SR), '音效 %d 个' % sum(count.values()), 'RMS %.1f dBFS' % (20 * np.log10(np.sqrt(np.mean(mix ** 2)) + 1e-9)))


if __name__ == '__main__':
    main(sys.argv[1:])
