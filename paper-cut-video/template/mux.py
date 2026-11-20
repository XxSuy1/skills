"""把逐帧画面（24fps JPEG）和混音合成成片 MP4（H.264 + AAC，1080p）。
用法：python -X utf8 mux.py [--frames out/frames] [--audio out/mix.wav] [--out out/video.mp4] [--bitrate 6.8M]
ffmpeg 用 imageio_ffmpeg 自带的二进制（本机没有系统 ffmpeg），不联网。"""
import json, os, subprocess, sys, wave
import imageio_ffmpeg

ROOT = os.path.dirname(os.path.abspath(__file__))
A = {'frames': 'out/frames', 'audio': 'out/mix.wav',
     'out': 'out/video.mp4', 'bitrate': '6.8M', 'fps': '24'}
argv = sys.argv[1:]
for i, a in enumerate(argv):
    if a.startswith('--') and i + 1 < len(argv): A[a[2:]] = argv[i + 1]
FF = imageio_ffmpeg.get_ffmpeg_exe()
frames = os.path.join(ROOT, A['frames']); audio = os.path.join(ROOT, A['audio']); out = os.path.join(ROOT, A['out'])
files = sorted(f for f in os.listdir(frames) if f.endswith('.jpg'))
fps = int(A['fps'])
DUR = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'shots.json'), encoding='utf-8'))['duration']
need = int(round(DUR * fps))          # 总长取 shots.json 的 duration
missing = [i for i in range(need) if '%05d.jpg' % i not in set(files)]
if missing:
    print('缺帧 %d 个，例如 %s；先补渲染（node render.js --resume）' % (len(missing), missing[:5])); sys.exit(1)
with wave.open(audio, 'rb') as w:
    adur = w.getnframes() / w.getframerate()
print('画面 %d 帧 = %.2f 秒，音频 %.2f 秒' % (need, need / fps, adur))
cmd = [FF, '-y', '-framerate', str(fps), '-start_number', '0', '-i', os.path.join(frames, '%05d.jpg'), '-i', audio,
       '-frames:v', str(need),
       # JPEG 帧是全范围色彩，统一转成播放器通用的 TV 范围 yuv420p（BT.709）
       '-vf', 'scale=in_range=pc:out_range=tv:out_color_matrix=bt709:flags=lanczos,format=yuv420p', '-color_range', 'tv',
       '-c:v', 'libx264', '-preset', 'slow', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-r', str(fps),
       '-b:v', A['bitrate'], '-maxrate', '9M', '-bufsize', '14M', '-g', str(fps * 2), '-tune', 'animation',
       '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
       '-c:a', 'aac', '-b:a', '192k', '-ar', '44100', '-t', '%.3f' % (need / fps), '-movflags', '+faststart', out]
subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
size = os.path.getsize(out) / 1024 / 1024
probe = subprocess.run([FF, '-i', out], capture_output=True, text=True, encoding='utf-8', errors='replace').stderr
info = [l.strip() for l in probe.splitlines() if 'Duration' in l or 'Stream #' in l]
print('成片', out, '%.1f MB' % size)
print('\n'.join(info))
