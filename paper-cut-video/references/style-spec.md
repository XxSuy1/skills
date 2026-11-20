# 风格规范（从 film.js / audio.py / textures.py 提取，改风格以源码为准）

## 色板（`film.js` 里的 `C`）
| 名 | 值 | 用途 |
|---|---|---|
| sky / skyD / skyP | `#9fd8ef` / `#5fb3dc` / `#d6f1fb` | 天蓝底纸 / 深 / 浅 |
| butter / butterD | `#ffd66b` / `#f0b23a` | 黄油：胶带、记号笔底、卡片 |
| coral / coralD | `#ff8e7a` / `#e0604c` | 珊瑚：强调、下划线、胶带点点 |
| mint / mintD | `#93e0be` / `#3db487` | 薄荷：对勾、通过 |
| lilac / lilacD | `#c7b9fb` / `#8d78e6` | 淡紫 |
| peach | `#ffcaa8` | 蜜桃：标签 |
| cream / paper | `#fff6e6` / `#fffdf8` | 奶白纸片（主体） |
| ink / inkS | `#2d2547` / `#5f5880` | 墨色字 / 次要字 |
| navy / navyL / steel | `#2c3352` / `#414a73` / `#c9d2df` | 屏幕深色、金属 |

## 字体
- 展示字 `STHupo`（华文琥珀）→ 后备微软雅黑；用于标题、板块标签。
- 正文 `Microsoft YaHei` 粗体 → 后备 Noto Sans SC；字幕 54px、提示词 36px、标签小字 22–26px。
- 数字 `Bahnschrift`。
- 渲染前必须 `document.fonts.load` 这两款字体，否则首帧会回退字体。

## 纸的质感
- 贴图（`textures.py`，只用 numpy+Pillow）：`paper.png` 1024² 无缝叠加纹理（细颗粒 + 低频斑驳 + 纸纤维）、`sky.jpg` 2400×1350 天蓝底纸、`grain0-3.png` 胶片颗粒逐格轮换。
- 纸片外形（`shape()`）：四边各自选 `c`（手剪，微抖）、`t`（撕边，露出白芯）、圆；四角圆角带随机。
- 投影：近处一层小而实、远处一层大而虚，偏向右下；`elev` 越大纸越"高"。
- 全片叠加：暗角 `.vig`、左上暖光 `.warm`、胶片颗粒（soft-light，不透明度 .5）。
- 视差：底纸 0.25、装饰（云、纸屑）0.55、世界层 1.0；镜头是 `[秒, 中心x, 中心y, 缩放]` 关键帧，`eIO` 缓动。

## 动感
- 定格：`q12(t)` 把时间量化到 1/12 秒，纸片的位置、旋转、出场都用它；这是"手摆动画"的核心。
- 沸腾：`boil(id,t,amp)` 每 1/8 秒换一组 ±0.6px、小角度抖动，给所有纸片和纸屑。
- 缓动：`eIO`（三次缓入缓出）、`eOut`、`spring`（弹簧）、`backOut`（过冲）、`antic`（预备→滑行→过冲→落定，进场首选）。
- 进场惯例：字幕条贴上去略过冲（缩放 1.12→1）、换下一条时被揭走；标题纸片落下后胶带"啪"贴上；纸屑慢漂。

## 部件
云朵、纸屑、提示词纸条（逐字打出 + 光标）、板块标签、便签、字幕纸条（下方居中）、和纸胶带（stripe/dot 两种花纹）。API 见 `engine-api.md`。

## 声音
- 配乐（numpy 合成，无外部素材）：F 大调 120BPM；乐器 = Karplus-Strong 尤克里里、模态合成马林巴、钟琴、圆润贝斯、去谐锯齿铺底、鼓组（底鼓/拍手/沙锤/木鱼）。
- 编曲随画面：开场轻 → 中段加贝斯/扫弦/底鼓 → 高潮落点"一击"（镲 + 底鼓 + 宽音域和弦）→ 延音和弦渐弱。
- 音效库 25 种：swish、slide、paper_land、flip、tear、tape、pop、pat、tick、scribble、type、key、click、grab、drop、ding、chime、score、card、snip、wifi_off、paper_fall、stamp、whoosh、finale。
- 混音：音效响时配乐让 ≈3dB（侧链）；整体 reverb；首尾淡入淡出；软限幅；峰值 −1 dBFS。
- **段落切换都落在小节线上**（每 2 秒一小节）；要追加的段落时长取 2 秒的倍数，配乐才能无缝接。

## 编码
1920×1080、24fps、H.264 High、`-tune animation`、6.8Mbps（maxrate 9M）、AAC 192k/44.1k、BT.709 TV 范围。JPEG 帧是全范围，编码时必须 `scale=in_range=pc:out_range=tv`，否则偏灰。

## 字幕与文案
- 每条 ≤20 字，口语，一次只讲一件事；强调词用 `【】`。
- 真实产品画面只写"看得见的差别"，不写夸大的话。
- 中文全角标点，不用 emoji。
