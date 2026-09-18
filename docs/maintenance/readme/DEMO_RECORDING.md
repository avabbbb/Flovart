# Demo recording record

每条进入 README 的录屏，都在这里留一条可复现记录。没有记录 = 这条证据不可复现 = 不得进 README。

---

## Demo A — agent-operations-live-workflow

```text
File:        pic/readme/agent-operations-live-workflow.gif   (README embed)
Master:      pic/readme/agent-operations-live-workflow.mp4
Still:       pic/readme/agent-operations-final-state.png
Status:      已录制（2026-09-16）
```

```text
Recording date:         2026-09-16
Repo commit:            1a1abdd（README 与素材）+ 66ac1f7（bootstrap 探测预算修复）
                        —— 录制时这两部分还在工作区未提交；现已按同样内容提交并推送
Branch:                 main

Host / agent:           无具名宿主的独立会话（WorkBuddy 上的外部 Agent 直接驱动 Flovart CLI）
                        —— 不是 Codex / WorkBuddy Connector 的对话 tracer
Host version:           n/a
Host auth state:        n/a
Flovart launch cmd:     node tools/flovart/cli.js start --source --web --web-port=0 --agent-port=0 --no-open
Node version:           22.22.2
OS:                     Windows 11
Capture tool:           Playwright 1.60.0 launchPersistentContext + recordVideo
Browser:                Chromium 151.0.7922.34
                        （H:/PlaywrightCache/chromium-1234/chrome-win64/chrome.exe）
Capture resolution:     1440 × 900

Fixture / project:
  project name:         Product Launch Video（由 workflow.project.create 创建）
  seeded nodes:         无，全部由 CLI 现场创建
  seeded assets:        无
  provider used:        none —— 本次没有执行 workflow.node.run，没有调用任何模型服务

Steps（真实执行顺序，未重排、未拼接）:
  1. 启动本地栈（web + agent，动态端口，--no-open）
  2. 用一次性 bootstrap token 让托管 Chromium 成为 workspace writer
  3. workflow.project.create --title "Product Launch Video" --idempotency-key demo-project-create-1
  4. workflow.node.create --type image --title "Reference 01" ... （idempotency-key demo-node-create-1）
  5. workflow.node.create --type image --title "Reference 02" ...
  6. workflow.node.create --type video --title "Shot 01" ...
  7. workflow.connect Reference 01 → Shot 01
  8. workflow.connect Reference 02 → Shot 01

后处理（可复现）:
  源时间轴 15.0s → 28.5s，setpts=0.6667*PTS（1.5×），fps=12，scale=1120:-2，palettegen/paletteuse
  成片：9.0s / 1120×700 / GIF 1.83 MB / MP4 298 KB
  未做任何逐帧修图，未插入非本次运行的画面。

Secrets redacted:
  [x] 已扫描 cli 记录：无 API key / token / bootstrap URL / 私有端点
  [x] 使用一次性临时 profile 与临时 TEMP 根，录制后清理

Claims demonstrated:
  - CLI 操作（project/node/connect）能作用于真实可见的 Browser Workflow
  - 画布随操作实时更新（节点出现、连线出现）
  - 浏览器可作为 workspace writer，状态显示「已准备」
  - 写入操作有 revision 与 idempotency-key 约束（返回 previousRevision / revision / applied）

Claims NOT demonstrated（不要在宣传里延伸）:
  - 具名 Coding Agent（Codex / WorkBuddy Connector）自身的对话与工具调用过程
  - workflow.node.run 与真实 Provider 生成、计费、取消语义
  - AE / PR / Resolve 原生效果
  - 首次接触用户的全自动安装（本轮仍需 bootstrap 握手与建项目步骤）

Support Matrix status of what was used:
  Stable CLI surface（status / ensure / workflow.* 五项）+ Browser-bound Workflow authority
  —— 均为 Stable contract；未升级任何 Host / Provider 状态。
```

### 依赖的改动（否则这段录屏无法产生）

录制过程中发现并修复了一个真实缺陷，详见 `README_CLAIM_AUDIT.md`（修复提交：`66ac1f7`）：

```text
services/agentConnectionBootstrap.ts
  /hosts 在冷机上一次要 3–4 秒，而 bootstrap 的默认请求预算是 1200ms，
  导致认证探测总是被 abort → 重试 8 次全失败 → 浏览器永远无法成为 workspace writer。
  现在只给 /hosts 这一步放宽到 8000ms，/health 保持 1200ms。
```

### 复现方法

```bash
# 抓取脚本是一次性本地工具（不进 build、不提交）
node .tmp/capture-demo.mjs
# 输出：.tmp/demo-capture/run-*/ 内的 webm 原始录像、分步截图与 CLI 记录
```

---

## Hero — external-agent live workflow (README 顶部主图)

```text
File:        artifacts/hero-codex.gif   (README embed, 4.4 MB, 55 s @880 px)
Masters:     artifacts/hero-codex.webm / .mp4  (8.97 MB, ~355 s @1440×900)
Status:      已录制（2026-09-18）
```

```text
Recording date:         2026-09-18
Branch:                 main

Host / agent:           WorkBuddy codebuddy（外部 Agent，模型 hy4-preview-f）
                        —— record-hero.mjs --agent codebuddy 驱动；Codex 路径
                        因账号配额被限未用（同脚本 --agent codex 可重跑）
Host auth state:        WorkBuddy 内嵌 CLI，已登录免费档
Flovart launch cmd:     复用本地栈（web 127.0.0.1:37522 / agent 127.0.0.1:17373）
Node version:           24.14.0（录制脚本）；codebuddy 内嵌 node 22.22.2
OS:                     Windows 11
Capture tool:           Playwright 1.60.0 launchPersistentContext + recordVideo
Browser:                Chrome for Testing（托管 Chromium）
Capture resolution:     1440 × 900

Fixture / project:
  project name:         Hero Demo <tag>（record-hero.mjs 每次新建唯一项目，
                        保证录制画布聚焦且 lease 绑定该项目）
  seeded nodes:         无 —— 全部由 codebuddy 经 flovart:cli 现场创建
  provider used:        none —— 仅建节点与连线，未执行 workflow.node.run，
                        未调用任何付费模型服务

Steps（真实执行顺序，未重排、未拼接）:
  1. record-hero.mjs 发现并连接本地 web（37522）+ agent（17373），
     用一次性 bootstrap token 让托管 Chromium 成为 workspace writer
  2. 新建唯一 'Hero Demo <tag>' 项目（fresh create 设 activeProjectId，
     聚焦录制画布并绑定 lease；project.use 无法切换已绑定 lease）
  3. spawn codebuddy：读 .agents/skills/flovart/SKILL.md → ensure →
     inspect → workflow.node.create ×3（video，x=0/480/960）→
     create-connected ×2（Shot1→Shot2→Shot3），全程 --agent-identity
     workbuddy + 唯一 --idempotency-key + --project-id
  4. 画布 DOM 校验出现 3 个节点元素，record-hero 做一次真实鼠标拖拽
  5. 停止录制，写 artifacts/hero-codex.webm + .mp4；转码得 .gif

Transcript:             .tmp/hero-codebuddy-trial.jsonl（73 events / 70 tool_use）
DOM 校验:               录制画布 3 个节点元素（canvasNodeCount=3）
```

```text
录制侧踩到并修复的真实缺陷（与本产物同批）:
  - scripts/codex-session-browser.mjs 的常驻 promise 在 Node ≥21 触发
    'unsettled top-level await' 直接退出 → 改为 setInterval + stdin.resume
    保活（不再依赖未决 await）
  - ~/.flovart/web.json 指向死端口（stale ephemeral port）导致
    session-browser 超时 → record-hero.mjs 多候选探测 + 修正 web.json
```

```text
Recording integrity notes:
  - record-hero.mjs 在最终图非 3 节点 + 2 连线时以非零退出，
    本次退出码 0 → 录制内容自证
  - 无任何 workflow.node.run / 付费提交；画面未出现密钥
  —— 均为 Stable contract；未升级任何 Host / Provider 状态
```


```text
File:        pic/readme/local-assets.mp4 / .gif
Status:      未记录（未录制）
```

必须额外记录：

```text
Asset fixtures used:      <本地生成的测试图/视频，不得使用用户私人素材>
Storage boundary shown:   local-first（不得出现上传到云的暗示 UI）
```

---

## Demo C — reference-workflow

```text
File:        pic/readme/reference-workflow.mp4 / .gif
Status:      未记录（未录制）
```

必须额外记录：

```text
Provider state:           Fake Provider fixture | 真实 BYOK | 只到输入/契约为止
If Fake Provider:         画面中必须可辨认是 fixture，不得让观众以为是 Seedance 等真实付费服务已生成
If only inputs/contract:  明确停在「参考输入与 Workflow 契约已形成」，不剪出生成结果
```

---

## Demo D — feature-tour（画布与图片节点操作）

```text
Files:       pic/readme/features/*.gif     (README embed)
Masters:     pic/readme/features/*.mp4
Raw:         artifacts/features/raw/*.webm  (gitignore；仅本地保留，便于离线重编码)
Status:      已录制（2026-09-18），一条片段 = 一个操作
Driver:      scripts/record-feature-clips.mjs
```

```text
Recording date:         2026-09-18
Repo commit:            af98429（录制时 scripts/record-feature-clips.mjs 尚未提交）
Branch:                 main

Host / agent:           本组是「人操作 UI」路径，不由 Agent 驱动。
                        例外：features/agent-cli-live.gif 展示外部 Agent 的 typed CLI
                        操作落到可见画布 —— 仍不是任何具名宿主的对话 tracer
Host version:           n/a
Host auth state:        n/a
Flovart launch cmd:     复用已在运行的本地栈（web 127.0.0.1:37522 / agent 127.0.0.1:17373），
                        与 Demo A 相同；录制脚本不自行拉起服务
Node version:           22.22.2
OS:                     Windows 11
Capture tool:           Playwright 1.60.0 launchPersistentContext + recordVideo
Browser:                Chrome for Testing 148.0.7778.96
                        （H:/PlaywrightCache/chromium-1223/chrome-win64/chrome.exe）
Capture resolution:     1440 × 900（窗口 1464 × 980）

Fixture / project:
  fixture media:        全部本地生成，未使用任何用户素材。
                        脚本内 PLATE_HTML 由 Chromium 截图为 1280×720 plate.png，
                        再用 ffmpeg 派生 plate.mp4（8s，带静音立体声轨）与 tone.m4a（8s）。
                        由临时本地 HTTP server 提供（带 CORS/CORP 头，供画布直接渲染）。
  project name:         每条片段各自新建 "<片段名> Demo <runTag>"，由
                        workflow.project.create 现场创建
  seeded nodes:         由 CLI workflow.node.create 现场创建，metadata.href 指向本地 fixture
  seeded assets:        无
  provider used:        none —— 本组全部为 local-transform / 纯前端操作，未调用任何模型服务

Steps（每条片段同一条链路，未重排、未拼接）:
  1. 启动可见 Chromium，用一次性 bootstrap token 使其成为 workspace writer
  2. CLI 新建项目，并用 workflow.node.create 播入带 fixture 媒体的节点
  3. 真实鼠标点选节点 → 节点工具栏出现 → 点击对应工具按钮
  4. 在面板中确认真实参数（裁剪 / 旋转 / 宫格行列 / 调色）
  5. 操作提交，结果落到画布

后处理（可复现）:
  裁剪窗口由录制时打的时间标记自动计算（点选前 1.2s → 结果渲染后 0.6s），不是手工试出来的
  MP4 母版: libx264 crf 23 / yuv420p / faststart / -an
  GIF: fps=9, scale=820:-2:flags=lanczos, palettegen max_colors=112, paletteuse dither=none
       （GIF 从 MP4 母版再编码，可用 `--regif --gif-scale/--gif-fps/--gif-colors` 重调而不重录）
  成片 6–11s，单条 0.26–1.27 MB，整组 11 条共 7.5 MB
  无逐帧修图，未插入非本次运行的画面

素材清单（11 条，全部已产出并抽帧核对；体积为最终 GIF）:
  canvas-add-node    638 KB   画布：添加节点菜单
  canvas-connect     333 KB   画布：拖出连线
  canvas-drag        276 KB   画布：拖动节点
  canvas-tidy        263 KB   画布：一键整理
  canvas-prompt      745 KB   画布：在节点上写提示词
  crop               871 KB   图片：裁剪
  rotate            1034 KB   图片：旋转镜像
  split-grid        1000 KB   图片：宫格切分
  filter             944 KB   图片：图片调色
  agent-cli-live    1264 KB   外部 Agent：CLI 操作实时落到画布
  agent-open-panel   303 KB   外部 Agent：打开 Agent 界面

Secrets redacted:
  [x] 画面仅含本地 127.0.0.1 端口与本地 fixture 端口，无 API key / token / 私有端点
  [x] 每条片段使用一次性临时 profile，录制后尽力清理

Claims demonstrated:
  - 画布：工具栏新增节点、拖动节点、连接节点、一键整理画布、在节点上直接写提示词
  - 图片节点本地操作：裁剪、旋转镜像、宫格切分、图片调色 —— 真实 UI 完成并产出结果节点
  - 外部 Agent 的 typed CLI 操作会实时反映到可见画布（agent-cli-live 一条）

Claims NOT demonstrated（不要在宣传里延伸）:
  - 任何 Provider 生成能力：本组未配置任何模型服务；图片生成、高清放大、移除背景、
    拆分图层、图片编辑/扩图均未录制
  - 视频与音频处理：见下方「已知阻塞」
  - 多选打组/对齐：见下方「未捕获」
  - AE / PR / Resolve 原生效果、云同步

Support Matrix status of what was used:
  Stable CLI surface（status / ensure / workflow.*）+ Browser-bound Workflow authority
  —— 未升级任何 Host / Provider 状态
```

### 视频与音频本地工具：缺陷已修复，片段待补录（2026-09-18）

录制视频片段时发现视频/音频类操作全部不可用（视频剪辑、音视频分离、导出首/尾帧、提取指定帧、
视频拼接、音频截取、音频变速、人声伴奏分离）。根因是**三个叠加的缺陷**，现已修复：

```text
缺陷 1（core 构建类型不匹配）
  @ffmpeg/ffmpeg 的 classes.js 固定以 `new Worker(url, { type: 'module' })` 创建模块 worker，
  模块 worker 里没有 importScripts，因此 worker.js 必然走
  `self.createFFmpegCore = (await import(coreURL)).default` 这条分支。
  原代码把 core 指向 `@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js`，umd 构建没有默认导出，
  取到 undefined 就抛 ERROR_IMPORT_FAILURE（面板显示 "failed to import ffmpeg-core.js"，
  画布操作卡片显示 "Failed to fetch"）。
  worker.js 只有“未显式传 coreURL”时才会把 /umd/ 改写成 /esm/，而应用传的是 blob URL，
  所以这条兜底不生效。
  → 修复：core 改用 /dist/esm 构建。实测 https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm/
    ffmpeg-core.js 末尾为 `export default createFFmpegCore;`

缺陷 2（多线程包选错）
  多线程分支向 @ffmpeg/core 索取 ffmpeg-core.worker.js，但该文件只存在于 @ffmpeg/core-mt
  （@ffmpeg/core 的 umd 与 esm 目录都是 404）。
  → 修复：多线程分支 baseURL 改为 @ffmpeg/core-mt@0.12.6/dist/esm

缺陷 3（Vite 依赖预打包破坏 worker 路径）—— 这才是"静默卡死"的原因
  @ffmpeg/ffmpeg 被预打包进 node_modules/.vite/deps/@ffmpeg_ffmpeg.js 后，其类内
  `new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })` 会解析到
  /node_modules/.vite/deps/worker.js —— 该 chunk 不会生成（实测 404），
  而真实文件 /node_modules/@ffmpeg/ffmpeg/dist/esm/worker.js 是 200。
  worker 起不来 → 没有消息回来 → ffmpeg.load() 的 promise 永不 settle → 工具静默卡死。
  → 修复：vite.config.ts 的 optimizeDeps.exclude 加入 '@ffmpeg/ffmpeg' 与 '@ffmpeg/util'
```

验证方式（不依赖录制 harness）：在一个同源的跨域隔离页面里动态 import 应用自己的
`/services/ffmpegClient.ts` 并调用 `getFFmpeg()`，实测：

```text
crossOriginIsolated = true
isMultiThreadAvailable() = true
getFFmpeg()  → 16177ms 加载成功，ff.loaded = true
ff.writeFile + ff.listDir → 文件系统可读写
ff.exec(['-version']) → 正常返回
```

`npx tsc --noEmit` 通过。

**尚未完成的收尾**：这 8 条片段的端到端录屏还没补。录制时应用无法挂载——
`services/dockCrewClient.ts` 仍 import 已被删除的 `components/dock/protocol`
（同一批删除还包括 `components/dock/*`、`components/enterprise/panels/*`、
`components/AgentThinkingPanel.tsx`、`styles/dock.css`），vite 报 import-analysis 错误、
页面 500，因此无法进入画布操作。这属于当时的在途清理，与 ffmpeg 修复无关，未在本轮改动。
该 import 恢复后即可用下面命令补录：

```bash
bash .tmp/with-web.sh node scripts/record-feature-clips.mjs \
  --clip video-trim,video-av-split,extract-last-frame,extract-first-frame,extract-frame-at,video-merge,audio-trim,audio-speed,audio-stem-split --keep-raw
```

脚本已内置 ffmpeg 预热：录制动作前先在同一页面调用应用自己的 `getFFmpeg()` 完成冷启动，
避免把 ~16s 的 core 下载当成"操作过程"录进去。**该预热会在补录的登记里明确标注。**


### 未捕获：多选打组 / 对齐

`canvas-group-align` 未录成：Shift+点击与框选（应用确实实现了选择框）都没能让工具栏
出现对齐与打组动作，`WorkflowNodeToolbar` 的对齐区始终未渲染。已在脚本中记为
`DEFERRED`。若后续补录，注意框选起点必须落在真正的空白画布上。

### 依赖的改动

本轮修复了两个产品文件（这是让视频/音频工具可用所必需的，不是顺带重构）：

```text
services/ffmpegClient.ts   core 改用 /dist/esm；多线程分支改指 @ffmpeg/core-mt
vite.config.ts             optimizeDeps.exclude 加入 @ffmpeg/ffmpeg 与 @ffmpeg/util
```

`npx tsc --noEmit` 通过。真实 Provider 与宿主内行为未改变——本次只修了 core 的加载路径。

上一轮（Demo D 首次录制时）那处指向 `@ffmpeg/core-mt` 的试改曾因"未能让功能真正可用"被完整回退；
后来定位到真正的第三处缺陷（Vite 依赖预打包）后一并修复，原先的回退不再适用。

### 复现方法

```bash
# 前置：本地栈已在运行（与 scripts/record-hero.mjs 相同）
node scripts/record-feature-clips.mjs --list          # 查看片段目录与阻塞标记
node scripts/record-feature-clips.mjs --clip all      # 录制全部可运行片段
node scripts/record-feature-clips.mjs --clip crop --keep-raw   # 单条 + 保留原始 webm
# 输出：pic/readme/features/<key>.gif + .mp4
```

---

## 复现性检查

- [x] Demo A：用记录的 commit + 上述命令可重放到同样的终态（三图层 + 两条连线）
- [x] 画面中出现的状态与 `SUPPORT_MATRIX.md` 一致（未把 Experimental 说成 Stable）
- [x] Demo A 无暂停/拼接造成的动作来源伪造
- [x] Demo A GIF 1.83 MB < 10 MB，README 加载无压力
- [x] Demo D：`--clip <key>` 可重放；输出为真实操作提交的录像，未逐帧修图
- [x] Demo D：全部 fixture 为本地生成，未使用用户素材；画面无密钥、无私有端点
- [x] Demo D：单条 GIF 0.26–1.27 MB，整组 11 条共 7.5 MB
- [ ] Demo D：视频/音频类片段待 `services/ffmpegClient.ts` 能加载 core 后补录
- [ ] Demo D：多选打组/对齐（`canvas-group-align`）待框架选/多选行为后补录
- [ ] Demo D：缩放与撤销（`canvas-zoom`）因本地服务探测超时未录，可单独重跑
- [ ] Demo B / C 待录
