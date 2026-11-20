"""纸剪定格最小模板：一条命令出片。纸张贴图 → 逐帧渲染 → 合成配乐音效 → 编码 MP4。
用法（在模板目录下）：
  python -X utf8 build.py                 全流程（14 秒的示例约 1–2 分钟）
  python -X utf8 build.py --resume        接着上次没渲染完的帧
  python -X utf8 build.py --only-audio    只重做配乐音效并重新编码
  可选 --workers 3（并行无头浏览器数，默认 2）
成片：out/video.mp4（1920×1080，24fps，H.264 + AAC）。只用本机：Python（numpy、Pillow、imageio_ffmpeg）+ Node + 本机 Edge 无头；不联网。"""
import os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
PY = [sys.executable, '-X', 'utf8']


def run(cmd):
    print('\n>>', ' '.join(str(c) for c in cmd), flush=True)
    subprocess.run(cmd, check=True, cwd=HERE)


def main(argv):
    workers = argv[argv.index('--workers') + 1] if '--workers' in argv else '2'
    if '--only-audio' not in argv:
        if not os.path.exists(os.path.join(HERE, 'out', 'tex', 'paper.png')): run(PY + ['textures.py'])
        cmd = ['node', 'render.js', '--workers', workers]
        if '--resume' in argv: cmd.append('--resume')
        run(cmd)
    run(PY + ['audio.py'])
    run(PY + ['mux.py'])
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
