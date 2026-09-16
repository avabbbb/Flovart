# README Launch Pack — 本地 Agent 执行指令包

## 0. 这是什么

一份可直接执行的施工指令，目标是把 Flovart 的 GitHub 仓库首页从「写得很准」提升到「第一次点进来就懂、愿意 Star、愿意转发」。

执行者：本地 Agent。
验收者：项目所有者。

**这不是一次 README 重写。** 以当前 `README.md` / `README.zh-CN.md` 为基础做三件事：首屏重排、补真实动态视觉证据、把 GitHub 展示面补齐。

## 执行状态（2026-09-16）

| 项 | 状态 |
| --- | --- |
| W1 首屏重排 | 完成 —— roadmap 段已下沉到 `## Creative App Roadmap` |
| W2 信息架构收敛 + Quick Start 前移 | 完成 —— README 从 245 行降到 219 行，两个语言同构 |
| W3 修 4 个事实问题 | 完成（F1–F5 全部处理；F4 额外修了 `bundle-manager.js` / `dev-commands.js` 的同类文案） |
| W4 动态录屏 | **部分完成** —— 已有真实「CLI 操作 → 可见 Workflow」录屏；**具名 Coding Agent 对话版仍待补** |
| W5 次级 Demo（B / C） | 未做 |
| W6 社交预览 | 图已生成；**GitHub Settings 上传仍待人工** |
| W7 GitHub About + Topics | 完成（已通过 `gh api` 应用） |
| W8 素材审计 | 完成 |
| W9 `scripts/check-readme-contract.mjs` | 未做 |
| W10 渲染验收 | 部分完成（`docs:check` 通过；桌面/移动端渲染未逐档截图） |

W4 的录屏产出与免责边界见 [DEMO_RECORDING.md](./DEMO_RECORDING.md)；过程中修掉的两个真实缺陷见 [README_CLAIM_AUDIT.md](./README_CLAIM_AUDIT.md) 的 Round 2 一节。

## 1. 硬规则

1. **事实优先级：`当前实现 > README 声称`。** 任何文案不得高于现状。`SUPPORT_MATRIX.md` 是状态唯一事实来源，README 只引用不复制。
2. **不得伪造 Agent 证据。** 不许先录空画布、暂停、手动搭好、再继续录。可以缩放、裁切、加速、加字幕；不可以改变动作来源。
3. **不得把 `Experimental` / `Planned` / External Gate 写成 Stable。** 不得把假 Provider 结果呈现为真实付费 Provider 生成。
4. **本轮不新增架构抽象、不改业务逻辑。** 唯一例外：录 Demo 过程中发现 P0 产品缺陷（过程走不通），可以修，但必须在最终报告里单列。
5. **访问计数器三处必须逐字节一致，不得更换服务、不得改 theme：**
   `https://tally.yuki.sh/hits/flovart/readme.svg?theme=rule34`
   出现在 `README.md:38`、`README.zh-CN.md:38`、`README.en.md:14`。
6. **临时文件全部放 `.tmp/` 或 `artifacts/`**（`.gitignore` 已忽略），不进 C 盘 Temp，不用用户目录。测试结束清理 profile。
7. **`README.en.md` 是历史链接的 shim**（只有 logo + 计数器 + 一句指向 `README.md`）。不要把它改成第三份完整 README；只同步它引用的素材路径。

## 2. 现状审计（已核对，不要重复确认）

### 2.1 上一轮已完成，保持不动

| 文件 | 状态 |
| --- | --- |
| `docs/maintenance/readme/README_CLAIM_AUDIT.md` | 已建立，claim ↔ 代码证据对照 |
| `docs/maintenance/readme/README_GITHUB_METADATA.md` | 已有 description / topics / social preview 建议 |
| `docs/maintenance/readme/README_VISUAL_TODO.md` | 已有 Hero Demo 规格，但**从未执行** |
| `docs/maintenance/readme/README_ASSET_AUDIT.md` | 本轮新增 |
| `docs/maintenance/readme/DEMO_RECORDING.md` | 本轮新增 |
| `pic/readme/social-preview.png` | 本轮已生成，1280 × 640，约 335 KiB |

### 2.2 README 当前结构（英文 canonical）

`README.md` 现有序：

```text
Hero(logo + tagline + 描述 + CTA + badges + 计数器)
   ↑ 计数器之后、See the workspace 之前，插了一段 native-effects roadmap  ← 问题 1
See the workspace(Workflow.png + 两张 Skill 截图)
Why Flovart?
One workspace, two ways to create
What makes Flovart different?
What you can make
Production Skills
Bring your own models
Compatibility(11 行状态表)
Quick start            ← 在第 174 行，约全文 71% 处   ← 问题 2
Architecture
Local-first and security
Roadmap
Contributing / Acknowledgements / License
```

### 2.3 已核实的事实问题

| # | 位置 | 问题 | 证据 |
| --- | --- | --- | --- |
| F1 | `README.md:43` | native-effects roadmap 段落抢占首屏，新用户还没懂产品先读到未来计划 | 直接读文件 |
| F2 | `README.zh-CN.md:196` | 中文 README 链到了**英文**文档 `docs/overview/quick-start.en.md` | 同目录存在 `docs/overview/quick-start.md` |
| F3 | `README.md:192` | Quick Start 用 `start --source --web --open`，但 CLI 官方 Help 把 bootstrap 定义为 `ensure`；`docs/overview/quick-start.en.md:27-31` 又用 `status` / `start --open`。三处口径不一致 | `tools/flovart/core.js:60-78` |
| F4 | `tools/flovart/core.js:80-90` `SETUP_TEXT` | 面向用户的 setup 文本仍在教 `npx flovart-cli install` / `start` / `generate.image`。而 `README_CLAIM_AUDIT.md:24` 已记录 npm registry 查该包名返回 404 —— **Help 在教一条不存在于公开 registry 的路径** | 两条证据互相矛盾 |
| F5 | `README.md:68` | 「本 README 不伪造尚未具备的视觉证据」这句自我声明，在 Hero Demo 落地后必须改写成指向真实录屏 | — |

### 2.4 GitHub 远端实况（`gh` 2.89.0，已登录 `avabbbb`，scopes: gist / read:org / repo）

| 项 | 当前值 | 目标 |
| --- | --- | --- |
| About description | 旧中文长句，含「灵感来自 lovart」 | 见 W7 |
| Topics | `null`（空） | 见 W7 |
| Homepage | `https://avabbbb.github.io/Flovart/` | **已正确，不动** |
| Social preview | 未设置 | 上传 `pic/readme/social-preview.png` |

### 2.5 本机工具实况（实测，不要假设）

```text
ffmpeg      2025-08-04-git-9a32b86307-full_build-www.gyan.dev   ← 可用，含 palettegen/paletteuse
node        >= 22.19（package.json engines）
playwright  1.60.0（devDependency，已在 node_modules）
浏览器缓存   PLAYWRIGHT_BROWSERS_PATH = H:\PlaywrightCache
             实际存在 revision 1217 / 1228 / 1234
             但 playwright@1.60.0 默认找 chromium_headless_shell-1223 → 会报 Executable doesn't exist
             解法：launch 时显式 executablePath 指向 1234 的 chrome-headless-shell.exe
gh          2.89.0，已登录 avabbbb，可 PATCH repo metadata
```

**已知坑：`gh` 没有公开 API 上传 social preview。** 只能走 Settings 页面人工上传，见 W7。

## 3. 工作项

按顺序执行。每一项完成后自测再进下一项。

### W1 — 首屏重排（P0，不需要录屏，先做）

1. 把 `README.md:43` 整段 native-effects roadmap 从首屏移除，下沉到 `## Creative App Roadmap`（放在现有 `## Roadmap` 处，合并去重，见 W2）。
2. `README.zh-CN.md:43` 同步处理。
3. 首屏顺序固定为：

```text
Logo → Flovart → tagline → 2 行描述 → 语言切换 → 4 个 CTA → badges → 计数器 → 英雄视觉
```

4. tagline 与描述**不动**（见 W2）。Hero 之后紧接的应该是产品视觉，不是 roadmap。

验收：`README.md` 前 45 行内不出现 `native` / `AE` / `PR` / `effects` / `roadmap` 字样。

### W2 — 信息架构收敛 + Quick Start 前移

目标顺序（英文 canonical，中文同构）：

```text
1  Hero
2  Hero Demo（W4 产出后插入；未录完前先保留现有静态图）
3  Why Flovart?（收敛为 4 条，见下）
4  See it in action（Demo B / C，W5）
5  Quick start          ← 从第 174 行前移到这里
6  Core capabilities（合并现有 "What you can make" + "What makes Flovart different?"）
7  One Workflow, Human + Agent
8  Production Skills（压缩）
9  Bring your own models
10 Integrations / Compatibility（保留表格 + 一句指向 SUPPORT_MATRIX）
11 Architecture（mermaid 收敛，见 W3-F3 口径）
12 Local-first & security
13 Creative App Roadmap（W1 下沉的内容放这里）
14 Contributing / Acknowledgements / License
```

具体动作：

- **Why Flovart? 压成 4 条**，不要实现细节：
  1. One live workflow — human and agent edit the same visible state.
  2. Agent-native — structured Flovart operations, not screen scraping or mouse automation.
  3. BYOK image + video — bring your own providers, models and keys.
  4. Local-first visual control — assets, references and workflow state stay close to your workspace.
- **Production Skills 压到 6 行以内**：保留「Prompts store words / Production Skills store a way of working」这组对照 + 4 个 bullet + 一个链接。不要展开 marketplace。
- **Architecture 图收敛**：保留现在这张（Human / Agent → Link+CLI → Workflow → Provider / assets），并额外加一张**产品核心图**（放在 Why Flovart 附近）：

```text
Your Agent            Codex · WorkBuddy · Claude Code
      │
      ▼
Flovart Operations    inspect · select · apply · run
      │
      ▼
  Live Workflow  ──── Human
      │
      └──────────── Models
```

  说明：`Runtime` / `Lease` / `Projection` / `Bootstrap` / `MCP transport` **不得进 README 主图**，只留在架构文档。
- **重复的 caveat 收敛**：`Experimental` / `not certified` / `not a Stable claim` 现在在 `Bring your own models`、`Compatibility`、`Quick start`、`Architecture`、`Roadmap` 各说一次。保留 `Compatibility` 一处 + 表格下一句，其余删除。
- **正文长度目标：比现在减少 20–35%。** 不是 token KPI，是删重复；细节一律链出去。

**F3 口径统一（本项内一起改）：** 确定唯一一条 Quick Start 命令，三处（README × 2 语言 + `docs/overview/quick-start.en.md`）保持一致。建议：

```bash
git clone https://github.com/avabbbb/Flovart.git
cd Flovart
npm install
npm run flovart:cli -- ensure
npm run flovart:cli -- status --json
```

**前提：先实际跑一遍确认 `ensure` 与 `status` 在当前 HEAD 上可用**（`tools/flovart/core.js:60-78` 声明了这两个命令，但必须实测，不许照着 Help 抄）。若实测不可用，改用实测通过的那条，并把结论回写到 `README_CLAIM_AUDIT.md`。

验收：README 里同一件事只有一处说法；`grep -c "is Experimental"` 不再分散在 5 节。

### W3 — 修 4 个事实问题

| 项 | 动作 |
| --- | --- |
| F2 | `README.zh-CN.md:196` 链接改为 `docs/overview/quick-start.md`；同时检查全部中文 README 的相对链接是否都指向中文版文档 |
| F3 | 见 W2 末段 |
| F4 | 改 `tools/flovart/core.js:80-90` 的 `SETUP_TEXT`：删掉 `npx flovart-cli install` / `start` / `generate.image`，改为与 Quick Start 相同的源码路径 + `ensure` / `status` / `workflow.inspect`；最后一步验证从 `generate.image` 换成 `workflow.inspect`。同步检查 `HELP_TEXT`（`core.js:60-78`）是否还有同类残留 |
| F5 | Hero Demo 落地后改写 `README.md:68` / `README.zh-CN.md:68`，把「不伪造」声明换成指向 `pic/readme/hero-agent-workflow.gif` 与 `DEMO_RECORDING.md` |

改 `core.js` 后必须跑：`npm run test` 中与 CLI/help 相关的用例，以及 `npm run docs:check`。若 `README_CLAIM_AUDIT.md` 里引用了 `core.js:80-108` 行号，同步更新行号。

### W4 — Hero Demo（本轮最高优先级）

规格已在 `README_VISUAL_TODO.md`，本项把它执行掉。

**内容（10–15 秒连续真实路径）：**

```text
0–2s    本地 Agent（真实 Codex 或 WorkBuddy 会话）收到一句短 brief
2–4s    Flovart 打开绑定的 Workflow
4–8s    Agent 通过真实 CLI / stable operations 创建或连接节点
8–11s   同一张画布上真实出现变化
11–14s  人手用鼠标拖动其中一个节点，或改一处 Prompt
14–15s  最终 Workflow 停留
```

**必须证明的一件事：Agent 和人类改的是同一份可见 Workflow。**
只录终端输出不合格；只录鼠标手动操作不合格。

**采集参数：**

```text
主片     pic/readme/hero-agent-workflow.mp4   (1440×900 或 1280×800 采集，裁成干净画面)
内嵌     pic/readme/hero-agent-workflow.gif   (12–15 fps，宽 1000–1200 px，目标 < 8–12 MiB)
```

GIF 转码（本机 ffmpeg 已实测可用，参数按素材自行调，别机械照抄）：

```bash
mkdir -p .tmp/demo
# 1) 裁掉窗口边框 / 浏览器 chrome，只留产品画面（数值按实际画面调）
ffmpeg -i .tmp/demo/hero-master.mp4 -vf "crop=1280:800:0:60" -c:v libx264 -crf 16 -an .tmp/demo/hero-clean.mp4

# 2) 两遍调色板法出 GIF
ffmpeg -i .tmp/demo/hero-clean.mp4 -vf "fps=14,scale=1120:-1:flags=lanczos,palettegen=max_colors=224" -y .tmp/demo/palette.png
ffmpeg -i .tmp/demo/hero-clean.mp4 -i .tmp/demo/palette.png \
  -lavfi "fps=14,scale=1120:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4" \
  -loop 0 -y pic/readme/hero-agent-workflow.gif
```

**画面内禁止出现：** API Key、token、私有 endpoint、私人目录路径、私人项目名、浏览器收藏栏、无关通知。

**采集方案（按可行性择一，并在 `DEMO_RECORDING.md` 写明用的是哪个）：**

- **方案 A（首选）**：真实 Agent 会话 + 屏幕录制工具（OBS / ScreenToGif）。这是唯一能同时证明「真实 Agent」和「同一画布」的方案。
- **方案 B（备选，必须如实标注）**：仓库已有确定性浏览器捕获能力 —— `npm run test:browser:chrome`（Chrome for Testing、动态端口、`--no-open`、一次性 bootstrap、自动清场）；本机 Playwright 版本与浏览器 revision 不匹配时，用显式 `executablePath` 指向 `H:\PlaywrightCache\chromium_headless_shell-1234\...`。
  用 Playwright 录「真实 CLI 改 Workflow」是合法证据，但**它不是真实 Codex 会话**：放进 README 时必须标注为「CLI operation → live Workflow」而不是「Codex 完成了这件事」。

**做完立即填 `DEMO_RECORDING.md`。** 没有记录的 Demo 不得进 README。

### W5 — Demo B / Demo C

README 里动态视觉证据**总数不超过 3 条**。Hero 用 GIF，次级两个建议静态首帧 + 链接到 MP4，避免页面变重。

- **Demo B — Local assets → Canvas**（6–8 秒）：本地文件夹 → 浏览缩略图 → 选 3 个素材 → Add to Canvas → 画布出现节点。重点体现 local-first / 原始文件引用 / 可视化流程。**不得出现「上传到云」的暗示。**
- **Demo C — Reference-aware Workflow**（6–10 秒）：Image node → 连接为 reference / first frame → Video node → Inspector 显示 reference → 运行 / 结果状态。
  如果当前没有真实 Provider 认证：停在「参考输入与 Workflow 契约已形成」，或明确使用 local fixture；**不得靠剪辑造出一个像 Seedance 已生成的结果。**

同样填 `DEMO_RECORDING.md`。

### W6 — 社交预览（图已生成，只需上传）

`pic/readme/social-preview.png` 已由真实 `pic/WorkFlow.png` + `pic/LOGO_optimized.png` 合成，不是 AI 生成图。1280 × 640，约 335 KiB（GitHub 上限 1 MiB）。

上传是**人工步骤**，GitHub 没有公开 API：仓库页 → Settings → Social preview → Edit → Upload an image。上传后到 Twitter Card / Slack 里贴一次仓库链接确认渲染。

生成脚本：`.tmp/render-social-preview.mjs`（一次性本地工具，不进 build、不提交）。

**可选加固**：UI 改版后社交预览需要重画。如果你想让它长期可复现，把该脚本移到 `scripts/render-readme-social-preview.mjs`、在 `package.json` 加 `"readme:preview"`，并在 `README_ASSET_AUDIT.md` 里记录生成方式。不想加脚本就保持现状：按 W6 的构图描述手工重做也行。两条路都接受，但必须有一条被记录。

### W7 — GitHub About + Topics

用下面命令执行（`gh` 已登录且具备 `repo` scope）：

```bash
gh api -X PATCH repos/avabbbb/Flovart \
  -f description="Open-source agent-native visual production workspace where humans and coding agents edit the same live canvas — local-first, BYOK image/video models." \
  -f homepage="https://avabbbb.github.io/Flovart/"

gh api -X PUT repos/avabbbb/Flovart/topics \
  -f names[]=ai-agent -f names[]=agentic-ai -f names[]=generative-ai -f names[]=aigc \
  -f names[]=ai-image -f names[]=ai-video -f names[]=visual-workflow -f names[]=workflow-automation \
  -f names[]=infinite-canvas -f names[]=local-first -f names[]=byok -f names[]=codex \
  -f names[]=claude-code -f names[]=opencode -f names[]=creative-tools -f names[]=node-editor
```

约束：

- **不要加** `premiere-plugin` / `after-effects-plugin` / `davinci-resolve` —— 那些能力尚未认证。
- 执行前把旧 description 原文记到 `README_GITHUB_METADATA.md`，便于回滚。
- 执行后更新 `README_GITHUB_METADATA.md`：把「建议」改成「已应用 + 应用时间 + 旧值」。

### W8 — 素材审计

`README_ASSET_AUDIT.md` 已建立。补做它里面「需要本地 Agent 补充的动作」一节：全仓核对 3 个未引用资产，写回结论，**不删除**。

### W9 — README 一致性检查脚本

新增 `scripts/check-readme-contract.mjs`，参照现有 `scripts/check-docs-contract.mjs` 的写法。检查项：

```text
- README.md / README.zh-CN.md 的核心 section 标题集合一致
- 两文件引用的 pic/ 图片全部存在（解析 markdown 与 <img src>）
- README.en.md 的 shim 链接 (./README.md, ./README.zh-CN.md) 存在
- 三处计数器 URL 完全一致且等于 theme=rule34 那条
- SUPPORT_MATRIX.md 存在且被两文件引用
- README 中出现的相对链接目标文件存在
- 新增：pic/readme/hero-agent-workflow.gif 一旦被引用，则 DEMO_RECORDING.md 中 Demo A 的 Status 不得是「未记录」
```

接到 `package.json`（例如 `"readme:check"`）并加进 `.github/workflows/ci.yml`。**最后一条是防止未来「图没了 / 记录没填」的守门规则，别省略。**

### W10 — 渲染验收 + 最终报告

渲染检查（用 `npm run test:browser:chrome` 或本地截图，不要用默认浏览器）：

```text
GitHub 桌面 ~1440px
GitHub 桌面 ~1024px
移动端 ~390px
```

检查：GIF 不糊；不撑破 README；两列图片区在手机宽度不炸；英文 README 不出现中文；中文 README 不出现大段未翻译英文；badges 不过度换行；首屏 10 秒内能看懂；README 不是「文档目录感」。

跑通：`npm run docs:check`、`npm run readme:check`（W9 新增）、`git diff --check`。

## 4. 验收清单

```text
[ ] README.md 是英文 canonical，README.zh-CN.md 结构对齐
[ ] Hero 定位未变：Your coding agent, now with a visual production studio.
[ ] native-effects roadmap 已从首屏移到底部
[ ] 至少 1 条真实 Agent → Workflow 动态证据存在
[ ] 至少 1 条次级短演示存在
[ ] 没有任何伪造的 Host / Provider 证据
[ ] 计数器 URL 三处逐字节一致
[ ] Quick Start 出现在前半部
[ ] 重复 caveat 已收敛
[ ] SUPPORT_MATRIX.md 仍是唯一状态来源
[ ] GitHub About description 已更新
[ ] Topics 已应用（≤20，不含未认证宿主）
[ ] 1280×640 社交预览已生成并上传
[ ] README 相对链接全部可达
[ ] 图片全部可解析
[ ] docs:check / readme:check / git diff --check 通过
[ ] 桌面 + 移动端渲染可接受
[ ] 每一条录屏都有 DEMO_RECORDING.md 记录
```

## 5. 最终报告格式

不要只回「README 已更新」。按这个结构报：

```text
1.  信息架构 Before → After（列出两版 section 顺序）
2.  英文 README 具体改动（逐节）
3.  中文版对齐情况
4.  Hero Demo：真实路径 / 用了哪种采集方案 / commit / 演示了哪些 claim
5.  次级 Demo
6.  社交预览：文件、大小、是否已上传
7.  GitHub Description：旧值 → 新值
8.  Topics：实际应用值
9.  Claim 审计：README 声称 vs 实际，有没有被降级或删除的说法
10. 链接与图片校验结果
11. 最终渲染截图
12. 仍需人工在 GitHub Settings 完成的事项
13. 发现并修复的 P0 产品问题（如无，明确写「无」）
```

## 6. 本轮明确不做

- 不重写 README 定位，不发明新 tagline。
- 不做 AE / PR / Resolve 原生效果。
- 不新增 MCP / Bridge / Runtime 作为营销卖点；`MCP remains an optional projection` 一句留在架构节即可。
- 不重构 `AgentHostPicker` / `AgentWorkspace` —— 那是 G8 的范围，见下节。
- 不删除任何 `pic/` 旧资产。
- 不发版本、不打 tag、不推送。

## 7. 与 G8 的边界

README Launch Pack 与 G8（Zero-Setup External Agent Golden Path）是两条独立线。README 这轮**只做展示面**。

但两者有一个共享前提，值得在报告里点明：G8 里已核实存在的三处产品残留，会直接影响 README 能不能写「傻瓜式」：

```text
components/agent/AgentWorkspace.tsx:45,60-61   Agent 页默认仍是聊天占位（外部 Agent 优先 + [打开可选内置助手]）
components/agent/AgentHostPicker.tsx:111-139  UI 内仍硬编码 host 分支（workbuddy 下载 zip / dsh 提示未就绪 / 其余走 ensureHostReady）
tools/flovart/core.js:80-90                    SETUP_TEXT 仍教 npx flovart-cli generate.image（同 F4）
```

在这三处收敛之前，README **不要**承诺「用户不用碰任何配置」。目前 README 的说法保持克制是正确选择，本轮不要抬升它。
