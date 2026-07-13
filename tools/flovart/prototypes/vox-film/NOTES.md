# Prototype Notes

## 已验证结论

- `film.json` 足以统一承载选题、风格、镜头、旁白、音乐意图、确认门和输出规格。
- 从当前 `COMMAND_REGISTRY` 自动映射出的 17 个执行步骤中，12 个已有 CLI 原语可直接表达；命令边界可行，不需要合并 Canvas 与 Workflow。
- 本地 mock 成片通过验证：约 15 秒、1280×720、H.264 视频 + AAC 音频，Provider 调用 0、费用 0。
- 保留的接口：`createFilmManifest`、`createCommandPlan` 与显式阶段状态转换；正式实现时应吸收到 CLI 的 recipe/film 执行层。
- 需要补进正式 CLI 的原语：`generate.speech`、`generate.music`、`asset.materialize`、`film.render`、`film.verify`。
- 应删除的 throwaway 文件：本目录下的交互 TUI 与 mock renderer
