# Flovart 远景：三条产品线（探索）

状态：远景草案（2026-11-15）。这是方向探索，不是 current truth，不改变 [00 总体设计](../design/00-overview.md) 与 [14 Creative Hosts](../design/14-creative-hosts.md) 的现行优先级（Resolve 仍是第一宿主）。任何一条线进入实施前，先写独立计划并通过评审。

## 0. 初衷

Flovart 想做的是**嵌入艺术创作工作流的插件系统**，而不是又一个“对话框 + 生成按钮”。现有的很多 Photoshop AI 插件只是简单对话：Agent 看不到全部图层与工作区，也不能直接在时间线 / 图层上操作，没有真正辅助传统工作。

核心主张：

- Agent 读取**完整工程上下文**（图层、合成、关键帧、标记、素材），而不只是一张截图或一段提示词。
- Agent 的输出是**可编辑的工程改动**（图层、关键帧、轨道片段），不是一段烤死的成片。
- 每一步可撤销、可比较、可回溯；创意、审美与最终选择留在创作者手里。
- 终极目标：用 GenAI 与 LLM 辅助 After Effects 这类专业工作，例如**静止系 MAD**。

## 1. 三条产品线

三条线共用同一个 Flovart Runtime（命令注册表、Artifact Store、pipeline run / trace、CLI / MCP / Skill / DSH 投影），面向不同人群，不建立第二套任务、素材或 Provider 系统。

| 线 | 面向 | 形态 | 已有基础 | 计划 |
| --- | --- | --- | --- | --- |
| **A. 截图 + 录制** | 所有人 | 省内存的 Rust 截图 / 录屏伴生工具，可单独安装；反推、发送到画布、Agent 剪辑为可插拔模块 | 浏览器扩展导入路径、`capture.ui` | [录制与剪辑 Hub 计划](recordly-capture-hub.md)（H2 净室自研，Apache-2.0） |
| **B. 视频逆向 + Agent 辅助制作** | 偏程序员 / Agent 用户 | 逆向（全能助手）为主场：拆解参考视频、规划分镜、处理素材，Agent 用 ffmpeg / Remotion / 生成工具做出片，评审 → 定向修补 → 重渲染 | [16 Agent 视频流水线](../design/16-agent-video-pipeline.md) P0 已实现 | 16 号文档 P1–P2 |
| **C. 创作者 UXP 插件** | 偏创作者 | 在 Photoshop / After Effects 内运行的面板 + 宿主桥：读取工程快照，执行结构化、可撤销的图层与时间线操作 | [14 Creative Hosts](../design/14-creative-hosts.md)（AE 现为 CEP / ExtendScript，Experimental，暂停扩张） | 待写（本文 §3 为输入） |

## 2. 线 C 的时机（2026-11-15 按 Adobe 官方路线核对）

- Photoshop、Premiere、InDesign 已有生产可用的 UXP。
- After Effects：UXP 插件 MAX 2026 公测，2027 Q2 GA（含 Hybrid 插件）；CEP 2028-12 默认关闭，2029-12 起新版不再包含；ExtendScript 不受影响。AE UXP API 覆盖项目、图层、属性、字体、导入，并有撤销组（`beginUndoGroup` / `endUndoGroup`）。
- 已有开源参考 adb-mcp（Photoshop / Premiere / InDesign，UXP 插件经本机代理接 MCP；UXP 不能监听端口），没有 AE。
- 结论（待核实）：14 号文档里 AE 的 CEP 路线需要在 UXP GA 前迁移；新功能不再建在 CEP 上。AE UXP 公测版对关键帧、表达式、标记的实际覆盖须先读 API 参考并真机验证，不足时 ExtendScript 兜底。

## 3. 线 C 草图：静止系 MAD

~~~text
音频 → 节拍 / 段落分析 → 写成 AE 合成标记
静帧素材 → 生成或拆分前中后景图层
Agent 读取工程快照 → 按节拍排镜、推拉摇移、视差、字幕动画 → 写入可编辑关键帧（一个撤销组）
创作者在 AE 里改任意一帧 → 下一轮 Agent 读到并保留人的改动
~~~

架构：AE / PS 内 UXP 面板（人审核面）→ 本机 Flovart Runtime（中转与命令注册表）→ 任意 Agent（CLI / MCP / DSH）。宿主桥只做投影：导出快照、执行已登记的操作，失败时如实报 gap。

## 4. 与现有文档的关系

- 线 A 的 §0.5“录制截图是本体”只指线 A 这款伴生工具的形态，不代表 Flovart 整体定位。
- 三条线若被接受为对外定位，需先改 00 总体设计的产品一句话与 surface 说明；线 C 被接受时同步改 14 号文档的宿主优先级。
- 改名讨论（见录制 Hub 计划 §7）应能同时承载三条线，尤其是“进入专业工具”。

## 5. 待决问题

1. 三条线的先后顺序与资源分配。
2. 线 C 首个宿主：AE（UXP 公测中，最贴近终极目标）还是 PS（UXP 成熟，验证“读全部图层”更快）。
3. 线 C 与 Resolve 第一宿主的关系：并行还是 Resolve 纵向切片跑通后再开。
4. 静止系 MAD 的最小验收：素材数、时长、需要哪些 AE 能力。
