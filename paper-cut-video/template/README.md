# 纸剪定格 · 最小模板

**自包含、可直接跑**的一套：14 秒示例（标题落下 → 三张纸卡弹入 → 字砖落版），自带转场、字幕、配乐音效。复制整个文件夹到任何地方就能用，不依赖项目其它目录。

## 跑起来
```
cd <模板目录>
python -X utf8 build.py            # 贴图 → 逐帧渲染 → 配乐音效 → 编码；示例约 40 秒
```
成片 `out/video.mp4`（1920×1080，24fps，H.264 + AAC）。`out/` 是产物目录，不用进 git（已有 `.gitignore`）。
环境：Windows + 本机 Edge（无头）+ Node + Python（numpy、Pillow、imageio_ffmpeg）；系统要有"华文琥珀"和"微软雅黑"。不联网。

## 文件
| 文件 | 干什么 |
|---|---|
| `shots.json` | 分镜：总长 `duration`（取 2 的倍数）和每条字幕 `rows` |
| `film.js` | 合成器：纸片/胶带/贴纸字/云/纸屑/字幕/转场部件 + **三个示例段落 `seqDef`**（改这里做你的片子） |
| `film.html` | 1920×1080 舞台壳 |
| `render.js` + `harness.js` | 无头 Edge 逐帧截图（多进程），同时写 `out/events.json` 音效时间表 |
| `textures.py` | 纸张纤维贴图、天蓝底纸、胶片颗粒 |
| `audio.py` | 现场合成配乐 + 25 种音效，按 `events.json` 混音 |
| `mux.py` | 帧 + 音频 → MP4（色彩范围、码率都配好） |
| `build.py` | 一条命令串起来；`--resume`、`--only-audio`、`--workers N` |

## 改成你自己的片子（四步）
1. **改 `shots.json`**：`duration` 改成你的总长（2 的倍数）；`rows` 每行一条字幕，`seq` 填段落 id；字幕 ≤20 字，`【】` 里的字加黄色记号笔底。
2. **改 `film.js` 里的 `seqDef`**：每个段落一个 `{id,t0,t1,cam,draw,sfx}`。`draw` 里用 `P`/`tape`/`sticker`/`cloud`/`confetti`/`sectionTab`/`rowSubtitles` 摆画面，动画用 `q12`（定格）+ `seg`（进度）+ `antic/spring/backOut`（缓动）。`sfx(add)` 里按"段内秒 + 音效名 + 音量"登记音效。
3. **登记转场**：`TR = { 段落id: ['cover'|'drop'|'tear'|'flipup'|'pageturn', 秒数] }`，第一个段落不需要。
4. **改配乐**：`audio.py` 的 `compose()`（和弦 `PROG_A`、各段落乐器）。`HIT` 是高潮落点（"一击"），要和画面的落版对上；总长改了，`compose()` 里的 `5`、`HIT` 等秒数跟着改。

调试：`node render.js --times 2,6.5 --out out/stills` 只渲染几个时间点；浏览器里也可直接打开 `film.html#t=6.5`（需要用静态服务从模板目录起，端口随意）。

## 小提醒
- **新段落一开始最好就有东西在画面上**（云、纸屑、标签）：转场里新页是"按转场结束那一刻"画好的，段落内元素若 0.5 秒后才出现，转场中途会看到一片空天空。
- 真实录屏嵌入、像素光标、纸钟/铅笔/电脑屏/键帽等道具不在模板里，需要时自行扩展（数据约定见 skill 的 `references/engine-api.md`）。
- 追加片尾段、让配乐无缝接上：`AUDIO_EXTRA=<秒> python -X utf8 audio.py`，细节见 skill 的 `references/pipeline.md`。
