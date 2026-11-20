"""生成纸张质感贴图（只用 numpy + Pillow，不联网）。
输出到 out/tex/：
  paper.png   1024² 无缝叠加纹理：细颗粒 + 低频斑驳 + 纸纤维（白色亮纤维、少量暗纤维），盖在彩色纸片上
  sky.jpg     2400×1350 天蓝底纸（含斑驳与纤维），镜头推拉时有余量
  grain0-3.png  960×540 胶片颗粒（逐格轮换，统一画面质感）
用法：python -X utf8 textures.py"""
import math, os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out', 'tex')
rng = np.random.default_rng(20261112)


def periodic_noise(h, w, beta, seed):
    """无缝的 1/f^beta 噪声（FFT 生成，天然首尾相接），归一到 [-1, 1]。"""
    r = np.random.default_rng(seed)
    fy = np.fft.fftfreq(h)[:, None]
    fx = np.fft.rfftfreq(w)[None, :]
    f = np.sqrt(fx * fx + fy * fy)
    f[0, 0] = 1
    spec = (r.normal(size=f.shape) + 1j * r.normal(size=f.shape)) / f ** beta
    spec[0, 0] = 0
    n = np.fft.irfft2(spec, s=(h, w))
    n -= n.mean()
    return n / (np.abs(n).max() + 1e-9)


def fibers(size, count, seed, light=True, ss=2):
    """画纸纤维：随机弯曲短线，四周环绕绘制保证无缝。返回 [0,1] 的强度图。"""
    r = np.random.default_rng(seed)
    S = size * ss
    im = Image.new('L', (S, S), 0)
    d = ImageDraw.Draw(im)
    for _ in range(count):
        x, y = r.uniform(0, S), r.uniform(0, S)
        ang = r.uniform(0, math.pi * 2)
        L = r.uniform(4, 20) * ss
        bend = r.normal(0, 0.35)
        steps = 10
        pts = []
        for k in range(steps + 1):
            u = k / steps
            a = ang + bend * (u - 0.5)
            pts.append((x + math.cos(a) * L * u, y + math.sin(a) * L * u))
        width = max(1, int(round(r.uniform(0.4, 0.9) * ss)))
        val = int(r.uniform(110, 255))
        for ox in (-S, 0, S):
            for oy in (-S, 0, S):
                d.line([(px + ox, py + oy) for px, py in pts], fill=val, width=width)
    im = im.resize((size, size), Image.LANCZOS).filter(ImageFilter.GaussianBlur(0.35))
    return np.asarray(im, dtype=np.float32) / 255.0


def paper_overlay(size=1024):
    grain = rng.normal(size=(size, size)).astype(np.float32)
    grain = np.asarray(Image.fromarray(((grain * 0.18 + 0.5).clip(0, 1) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.55)), dtype=np.float32) / 255 - 0.5
    mott = periodic_noise(size, size, 1.6, 11)
    mid = periodic_noise(size, size, 1.0, 12)
    fl = fibers(size, 1500, 13)
    fd = fibers(size, 500, 14)
    f = grain * 0.20 + mott * 0.045 + mid * 0.02 + fl * 0.16 - fd * 0.07
    rgb = np.where(f > 0, 255, 38).astype(np.uint8)
    a = (np.clip(np.abs(f), 0, 1) * 255).astype(np.uint8)
    out = np.dstack([rgb, rgb, np.where(f > 0, 255, 52).astype(np.uint8), a])
    Image.fromarray(out, 'RGBA').save(os.path.join(OUT, 'paper.png'), optimize=True)


def sky(w=2400, h=1350):
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    u, v = xx / w, yy / h
    top = np.array([174, 224, 244], np.float32)       # 左上偏亮（光从左上来）
    bot = np.array([128, 200, 232], np.float32)
    t = np.clip(0.35 * u + 0.65 * v, 0, 1)[..., None]
    base = top * (1 - t) + bot * t
    m = periodic_noise(h, w, 1.7, 21)[..., None]
    m2 = periodic_noise(h, w, 1.0, 22)[..., None]
    g = rng.normal(size=(h, w, 1)).astype(np.float32)
    col = base * (1 + m * 0.035 + m2 * 0.012) + g * 2.2
    # 纤维（用 1024 贴图平铺，避免巨图画线太慢）
    fl = fibers(1024, 1300, 23)
    fd = fibers(1024, 400, 24)
    tile_l = np.tile(fl, (math.ceil(h / 1024), math.ceil(w / 1024)))[:h, :w][..., None]
    tile_d = np.tile(fd, (math.ceil(h / 1024), math.ceil(w / 1024)))[:h, :w][..., None]
    col = col + tile_l * 11 - tile_d * 6
    Image.fromarray(np.clip(col, 0, 255).astype(np.uint8)).save(os.path.join(OUT, 'sky.jpg'), quality=94)


def film_grain():
    for k in range(4):
        n = rng.normal(size=(540, 960)).astype(np.float32)
        a = (np.clip(np.abs(n) * 0.06, 0, 1) * 255).astype(np.uint8)
        c = np.where(n > 0, 255, 0).astype(np.uint8)
        Image.fromarray(np.dstack([c, c, c, a]), 'RGBA').save(os.path.join(OUT, 'grain%d.png' % k), optimize=True)


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    paper_overlay()
    sky()
    film_grain()
    print('textures ->', OUT)
