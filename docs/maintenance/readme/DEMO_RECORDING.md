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
Repo commit:            3919fa9 + 未提交改动（见本文件末尾“依赖的改动”）
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

录制过程中发现并修复了一个真实缺陷，详见 `README_CLAIM_AUDIT.md`：

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

## Demo B — local-assets

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

## 复现性检查

- [x] Demo A：用记录的 commit + 上述命令可重放到同样的终态（三图层 + 两条连线）
- [x] 画面中出现的状态与 `SUPPORT_MATRIX.md` 一致（未把 Experimental 说成 Stable）
- [x] Demo A 无暂停/拼接造成的动作来源伪造
- [x] Demo A GIF 1.83 MB < 10 MB，README 加载无压力
- [ ] Demo B / C 待录
