# 引擎 API（`template/film.js`）

页面是 `film.html`（1920×1080 固定舞台）。`render.js` 对每一帧调用 `window.renderAt(t)` 后截图；`window.__events()` 返回全片音效时间表。**画面是 t 的纯函数**：同一个 t 永远画出同一帧，所以可多进程并行、可抽查任意时间点。

## 分镜数据 `shots.json`
```
{ "duration": 166, "fps": 24, "compareSpan": [34,62],
  "rows": [ { "id":"1.2","t0":4,"t1":10,"seq":"ta-open","sub":"字幕≤20字，【强调】",
              "foot":{"name":"ta-open","fit":"stretch"} },
            { "id":"4.1","t0":..,"t1":..,"seq":"demo","sub":"…",
              "foot":{"name":"clip1","map":[[行内秒,作品秒],[..,..]]} } ],
  "markSfx": {"match:flip1":["card",0.02,0.6]} }
```
- `rows` 是时间线上的一行行镜头/字幕；同一 `seq`（段落）的多行共用一幕画面，字幕在行间切换。
- `foot.map` 是"行内秒 → 素材录像秒"分段线性映射（可快进/慢放/跳过等待）；`fit:"stretch"` 把整段素材拉伸铺满该行。
- `markSfx`：录像里 `mark` 事件（如"翻开第一张牌"）→ 要触发的音效 `[名, 延迟秒, 音量]`。
- **总长以 `duration` 为准**，`build/render/audio/mux/keyframes` 都从这里读。

## 段落 `seqDef`
```js
seqDef({ id:'open', t0:0, t1:4,
  cam: lt => ({x:960, y:540, s:1+.035*eIO(seg(lt,0,4))}),   // 镜头；lt = 段内秒
  draw(sc, lt, t) {                                         // sc = {bg, deco, world, ui}
    cloud(sc.deco, 60,110,1.2, 11, lt);                     // 装饰层（视差 .55）
    const card = P(sc.world, {x:300,y:250,w:1320,h:470,rot:-1.6,color:C.cream,seed:21,sides:'cccc',r:18,elev:3.4,curl:true});
    tape(sc.world, 960,256,230,-3,C.butter,21,'stripe');
    sticker(card.face, {x:92,y:66,text:'要花【几个小时】？',size:100,hl:C.coralD,sw:0});
    rowSubtitles(sc, 'open', t);                            // 字幕（ui 层，不随镜头）
  },
  sfx(add){ add(.12,'swish',.7); add(.4,'paper_land',.9); } // 段内秒 → 音效名 → 音量
});
```
- 四层：`bg` 底纸（视差 .25）、`deco` 装饰（.55）、`world` 世界（跟镜头）、`ui` 界面（不跟镜头：标签、字幕、提示词）。
- 动画先 `const tq = q12(lt)`，再用 `seg(tq,a,b)` 取 0–1 进度，配 `antic`/`spring`/`backOut`。
- 段落之间的转场在 `TR` 表里登记：`TR = { 'ta-guide': ['drop', .75], compare: ['tear', .85], ... }`，转场在段落 `t0` 前 `PRE=0.3` 秒开始；进场的新页按转场结束那一刻画好，不会空页。

## 部件签名
| 函数 | 作用 |
|---|---|
| `P(parent,{x,y,w,h,rot,color,seed,sides,r,amp,elev,circle,tf,op,core,curl,grad})` | 一张纸 → `{wrap,face,sh}`，内容往 `face` 里放；`sides` 四个字符，每边 `c`（手剪）或 `t`（撕边） |
| `tape(parent,x,y,w,rot,color,seed,'stripe'\|'dot')` | 和纸胶带，中心定位，锯齿两端，半透明 |
| `sticker(parent,{x,y,text,size,font,fill,stroke,sw,anchor,hl,ls,rot,tf})` | 白描边 + 投影的贴纸字，`\n` 换行，`【】` 换强调色 |
| `subtitle(ui,text,lt,dur,idx,nextSame,start,noExit)` | 字幕纸条（贴上去/揭走） |
| `promptStrip(parent,text,lt,t0,cps,x,y,w,seed,label)` | 提示词纸条，逐字打出 + 光标 |
| `sectionTab(ui,lt,title,sub,color,seed,textCol)` | 左上板块标签 |
| `workNote(ui,lt,inT,outT,title,sub,extra,color,seed)` | 右上便签 |
| `cloud / confetti` | 装饰（云朵、纸屑） |
| `makeScene / camAt / toScreen` | 场景容器与镜头换算 |
| 工具 | `q12 eIO eOut eIn eSine spring backOut antic rng boil lerp clamp seg shade rgba D S measure textW` |

## 扩展：真实录屏素材格式（模板未包含，需自行实现）
`footage/<名>/0001.jpg…` + `timeline.json`：`{frames:[[文件,页面时间],…], end, css:[宽,高], events:[{t,type:'click'|'key'|'down'|'up'|'mark',x,y,label}]}`。`capture.js` 和 `import_footage.py` 产出同一格式，所以真录屏和无头录制可混用。

## 音效时间表
`__events()` = 各段落 `sfx(add)` 的结果 + 字幕"啪"一声 + 录像里的按键/点击/拖动/`markSfx` + 转场音（cover/drop→slide、tear→tear、flipup/pageturn→flip）。`render.js` 写到 `out/events.json`，`audio.py` 读它混音。直接往一份 `events-*.json` 里追加 `{t,name,vol,pan}` 再 `audio.py --events <文件> --out <wav>`。

> 模板只含上表中的部件。纸钟、铅笔、电脑屏、键帽、像素光标、真实录屏嵌入属于扩展，上面"真实录屏素材格式"是为扩展预留的数据约定。
