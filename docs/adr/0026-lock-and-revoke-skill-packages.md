# 锁定并分级撤销 Skill Package

Production Skill 以不可变 Package 并排安装，ProductionSpec Revision 固定 Skill ID、精确版本、Package SHA-256 与 Trust Tier，不接受 `latest` 或 SemVer 范围。`flovart.lock` 可以同时保存一个 Skill 的多个历史 Skill Lock Entry；新版本只成为新 ProductionSession 的偏好，不替换已有 Spec、Run 或 Handoff。Local Draft 参与生产前必须生成 Skill Snapshot，不能直接执行持续变化的作者工作目录。安装和更新必须预览来源、作者、许可证、Hash、兼容性、Commands、Capabilities、Permissions、Gates、Eval、已知问题和 Manifest 差异；更新始终并排安装，Alias 只由用户本地显式启用并执行冲突检查。

撤销针对精确版本与 Hash，分为 `advisory`、`block_new` 和 `critical`：advisory 仅警告；block_new 禁止创建新的 ProductionSession 或 ProductionRun，但允许已有 Run 完成；critical 允许已提交 Provider Job 完成对账，但阻止任何新的 ProviderAttempt 提交。Runtime 执行已缓存的已知撤销；离线且撤销信息过期时显示警告但不强制连接 Hub。Hub 不能远程删除本地 Package 或 Artifact，垃圾回收也不能删除仍被 Spec、Run、Lock 或 Handoff 引用的版本。
