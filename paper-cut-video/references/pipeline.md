# 流程命令与踩坑（在 `template/` 目录下执行）

## 一条命令
```
python -X utf8 build.py                  # 贴图 → 渲染 → 配乐 → 编码（14 秒示例约 40 秒）
python -X utf8 build.py --resume         # 接着渲染没完成的帧
python -X utf8 build.py --only-audio     # 只重做配乐音效并重新编码
```
可选 `--workers 3`（并行无头浏览器数，默认 2）。

## 分步
| 步骤 | 命令 | 产物 |
|---|---|---|
| 贴图 | `python -X utf8 textures.py` | `out/tex/` |
| 渲染 | `node render.js --workers 3` | `out/frames/*.jpg`、`out/events.json` |
| 抽查几帧 | `node render.js --times 2,6.5 --out out/stills` | 单帧 |
| 声音 | `python -X utf8 audio.py [--events f.json --out x.wav]` | `out/mix.wav` |
| 编码 | `python -X utf8 mux.py [--frames --audio --out --bitrate]` | `out/video.mp4` |

## 环境
- Windows + 本机 Edge（无头）+ Node + Python（numpy、Pillow、imageio_ffmpeg）。本机没有系统 ffmpeg 也行，用 `imageio_ffmpeg.get_ffmpeg_exe()`。
- 字体依赖系统有"华文琥珀"和"微软雅黑"。换机器先抽查一帧。
- 产物都在 `out/`（不进 git）。

## 验收（不要只说"好了"）
1. 抽 5–8 个关键时间点看帧（开场、转场中、字幕换条、高潮、结尾）。
2. 音频：逐秒量响度，接缝处不能有掉下去再突然拉起。
3. 用 ffmpeg 探一下成片：1920×1080、24fps、yuv420p(tv, bt709)、AAC 44.1k、总长与 `duration` 一致。
4. 画面里没有账号名/手机号/昵称。

## 踩过的坑
- **在结尾追加一段，配乐不要另起炉灶**：高潮的延音和弦衰减完后再接新音乐会像两首歌。做法：`AUDIO_EXTRA=秒数`（取 2 的倍数，对齐小节），追加段配乐从原结尾前一小节接着走（Dm–Bb–F，末小节落回主音 F 并长延音），再用新一份 `events-*.json` 追加音效。追加后逐秒量响度验证没有空档。
- **JPEG 帧是全范围色彩**：编码一定带 `scale=in_range=pc:out_range=tv:out_color_matrix=bt709`，否则成片偏灰/偏亮。
- **两段帧一次编码**：用 ffmpeg `concat` 滤镜接两个图片序列，不要先各自编成 mp4 再拼（二次有损）。
- **从上一段最后一帧交叉淡入**：新段第一帧用上一段最后一帧与新底纸 `blend`，转场才不跳。
- **总长一改，几处要一起改**：`shots.json` 的 `duration`、`film.js` 对应段落、`audio.py` 的 `HIT` 等秒数；`mux.py` 会校验帧数。
- 同名帧直接覆盖即可；新一版帧数比旧版少时会残留旧帧，编码时用明确的帧数。
- 取景真实桌面录屏时：别把聊天窗口/其它悬浮窗录进去；账号名用模糊块打码；侧栏有账号的裁掉。
- 新段落一开始最好就有东西在画面上（云、纸屑、标签）：转场里新页是"按转场结束那一刻"画好的，否则中途会看到一片空天空。
