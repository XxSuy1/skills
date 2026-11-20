---
name: paper-cut-video
description: 「纸剪定格」风格的演示/宣传视频制作方法：天蓝底纸、奶白手剪纸片、和纸胶带、12 格/秒定格动感、合成配乐音效，一条命令出 1920×1080 MP4。用户说"做个纸剪风/定格风视频""做一支同风格的片子""给纸剪风视频改字幕/加片头片尾/调配乐"时使用。自带可直接运行的最小模板 template/，本 skill 是风格规范 + 改片流程。
---

# 纸剪定格视频

风格示例见 [assets/style-keyframes.jpg](assets/style-keyframes.jpg)（模板示例片的关键帧）。**先看这张图再动手，风格以它为准。**

做法一句话：**浏览器里用 DOM/CSS/SVG 把每一秒"摆"成一张张纸，无头 Edge 逐帧截图 → numpy 现场合成配乐音效 → ffmpeg 编码。** 全程离线，只用 Python（numpy、Pillow、imageio_ffmpeg）和 Node。

## 什么时候用
- 做同风格的新片，或改已有的纸剪风片子（改字幕、换段落、加片头片尾、调配乐）。
- 不适合：真人实拍、需要联网素材、需要复杂 3D 的片子。

## 先问清（缺一个就问，不要猜）
1. 讲什么、给谁看、多长（本风格擅长 1–3 分钟）。
2. 有没有真实录屏/截图要嵌进去（真实产品画面要用真实素材，不要伪造平台界面）。
3. 要不要配乐（默认要，现场合成，无版权问题）。
4. 画面里不能出现账号名、手机号、昵称——录屏和截图入片前先检查，必要时打码。

## 风格铁律（详见 [references/style-spec.md](references/style-spec.md)）
- **纸**：底是天蓝纸（`#9fd8ef`），纸片是奶白/黄油/珊瑚/薄荷/淡紫/蜜桃，墨色字 `#2d2547`；每张纸有纤维纹理、手剪边或撕边、右下方向的投影，光从左上来。
- **动感**：纸片进出场按 **12 格/秒** 定格（`q12`），镜头推拉按 24 格/秒平滑；边缘每秒 8 次轻微"沸腾"抖动；进场用"预备—滑行—过冲—落定"。
- **字**：标题用华文琥珀（`STHupo`），正文微软雅黑粗体；字幕 ≤20 字，`【】` 里的字加黄色记号笔底；字号宁大勿小。
- **声音**：F 大调 120BPM，一小节 2 秒，段落切换落在小节线上；拨弦/马林巴/钟琴/圆润贝斯；音效（纸滑、落、撕、胶带、打字、点击、叮）全合成；音效响时配乐让 3dB。
- **转场只用**：`cover`（纸盖过来）、`drop`（纸从上落下）、`tear`（撕开）、`flipup`（线圈本上翻）、`pageturn`。
- **收尾**：结尾要有一个高潮落点（"啪"一弹 + 纸屑）和一声清脆的"叮"，配乐自然衰减，不硬切；末尾用余弦淡出兜底。
- 不用 emoji 当图；不出现任何联网依赖。

## 做一支新片（用 [template/](template/)）
1. 把 `template/` 复制到新目录，先 `python -X utf8 build.py` 跑通 14 秒示例（约 40 秒）。
2. **分镜**：改 `shots.json`（`duration` 取 2 的倍数；`rows` 每行一条字幕，`seq` 对应段落 id）。
3. **画面**：改 `film.js` 里的 `seqDef({id,t0,t1,cam,draw,sfx})`，用现成部件（`P` 纸片、`tape`、`sticker`、`subtitle`、`cloud`、`confetti`…）摆画面，转场登记在 `TR` 里。
4. **声音**：改 `audio.py` 的 `compose()`；音效在各段落的 `sfx(add)` 里按名字登记。
5. **出片**：`build.py`（`--resume` 接着渲染、`--only-audio` 只重做声音）。
6. 接口签名见 [references/engine-api.md](references/engine-api.md)，命令与踩坑见 [references/pipeline.md](references/pipeline.md)，改法详见 [template/README.md](template/README.md)。

## 改现有片子的常见操作
| 要做的事 | 怎么做 |
|---|---|
| 改字幕/时间 | 改 `shots.json`，`build.py` |
| 只改配乐 | `build.py --only-audio` |
| **在结尾追加一段** | 另做那段的帧；`AUDIO_EXTRA=<秒>`（取 2 的倍数）让配乐在原结尾前一小节接着往下走，别用另一条音轨硬拼；两段帧用 ffmpeg `concat` 滤镜一次编码 |
| 改总长 | 改 `shots.json` 的 `duration`，再改 `film.js` 对应段落和 `audio.py` 里的 `HIT` 等秒数 |

## 模板没有的扩展
真实录屏嵌入（把屏幕录像帧贴进纸片/电脑屏）、像素风光标动画、纸钟/铅笔/电脑屏/键帽等道具，模板里没有。需要时参照 `references/engine-api.md` 的"扩展"一节自行实现，数据格式已在那里写明。
