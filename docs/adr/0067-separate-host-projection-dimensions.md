# ADR 0067：分离 Agent Identity、Distribution Target 与 Runtime Binding

> 历史架构决策。DeepSeek Harness 的 `dsh-native` / Native Draft 方案已由
> [ADR 0063](0063-dsh-browser-workflow-authority.md) 和 Flovart Link 2.0
> 取代；本文保留维度拆分的背景，不是当前 DSH 执行边界。

## 状态

部分保留（DSH 执行面已被取代）

## 背景

`init --host` 与 `director.bind --host` 曾把 Agent 身份、IDE、安装位置和运行时会话绑定压在同一个枚举里。这样每增加一种宿主，就会同时污染安装、发现、运行时和 Workflow 业务语义；`command.list` / `command.schema` 也容易被误当成模型工具面。

当前需要同时吸收 OpenDesign 的 PATH 自动发现/选择体验与 Infinite Canvas 的本地 Agent 启动/Skill 引导方式，但不能把某个 Host 的产品逻辑带入 Workflow Core。

## 决策

Flovart 将这些概念作为独立维度维护：

- **Agent Identity**：Codex、CodeBuddy Code、Claude Code、OpenCode、Pi、DeepSeek Harness，以及未来的 WorkBuddy。
- **IDE Host**：Cursor、Windsurf、VS Code 等编辑器承载环境。
- **Distribution Target**：`project-skill`、`codex-skill`、`codebuddy-code-skill`、`claude-code-skill`、`opencode-skill`、`dsh-plugin` 等安装投影。
- **Runtime Surface**：`cli`、`browser-workflow`、`skill-mediated` 等执行表面。
- **Director Runtime Binding**：只有已实现会话绑定的 Agent Identity 才映射到内部 `runtimeHostKind`。

`host.list` 只做本机 PATH 可执行文件发现，不扫描登录文件、不读取 OAuth/API Key；UI picker 只保存后续任务偏好，不隐式切换 Director Binding。`command.list` 与 `command.schema` 保留为 CLI bootstrap/discovery/debug 能力，不作为内置 Agent 的重复工具集合。

内置 Agent 的稳定模型工具面固定为：

```text
status
workflow.inspect
workflow.selection.get
workflow.apply
workflow.node.run
```

旧 granular `workflow.*`、Runtime/Production 命令仍可作为 CLI compatibility adapter，但必须进入已有 Dispatcher、Draft Authority、WorkflowExecutor 或 Production Runtime，不能产生第二套 Workflow 业务实现。

Codex 是当前 professional golden path；DeepSeek Harness 通过 Browser-only contextual Plugin
加入同一可见 Workflow authority；CodeBuddy Code、Claude Code、OpenCode、Pi 通过 Skill + CLI
contract 兼容。WorkBuddy 通过独立 Connector artifact 接入，不能要求用户执行 `director.bind`。

## 结果

- Host discovery、安装投影和 Runtime binding 可以分别演进。
- Workflow Core、Provider、PromptBar 不需要认识具体 Host。
- 新 Coding Agent 优先通过 Distribution Adapter + stable CLI contract 接入，而不是扩张 Core enum。
- WorkBuddy 与 CodeBuddy Code 的定位不会再被一个 `host` 字段混为同一运行时语义。

## 验收

- Registry 测试确认五个维度可独立读取，WorkBuddy 不在 Director Binding 中。
- PATH discovery 测试确认 planned WorkBuddy 不被探测，且不读取 auth 状态。
- Agent tool 测试确认模型只看到五个稳定命令，`command.list/schema` 不出现在模型工具面。
- Codex 的 inspect → apply → run 作为当前专业路径继续做真实 CLI/浏览器验收。
