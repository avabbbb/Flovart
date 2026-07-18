# 标准化 Director Skill Package

Director Skill Package 使用跨 Agent 的精炼 `SKILL.md` 作为导演工作流入口，并使用独立 `flovart.skill.yaml` 声明包 ID 与版本、Runtime/ProductionSpec 兼容性、Interaction Commands、Runtime Capability Requirement、Permissions、Director Gates、ProductionSpec Extension Schema 和 Eval 入口。Package 可以按需包含 `agents/openai.yaml`、`schemas/`、`references/`、`scripts/`、`assets/`、`examples/` 与 `evals/`；详细创意知识放 references，可复用输出资源放 assets，scripts 只能包含声明输入输出、无网络、无秘密且不调用任意外部二进制的 Deterministic Skill Script。安装包不包含 README、安装指南或 Changelog，Hub 页面从 Manifest 与示例生成。

官方 Flovart Skill Creator 同时提供 `create` 与 `import` 路径，并按 scaffold、validate、零费用 dry-run、eval、pack、publish 顺序工作。导入 VOX 等现有 Skill 时保留叙事、风格、提示词和审批知识，把直接 API 调用、API Key、硬编码模型和 ffmpeg 执行分别迁移为 Runtime Capability、Keyring、Validated Profile 和受控组装能力；迁移报告必须列出直接网络、秘密、Shell/二进制、私有执行阶段、未声明命令、Schema、Eval、许可证与资源来源问题。
