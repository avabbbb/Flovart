# Flovart × Editorial Collage Film Prototype

> PROTOTYPE — 结论确认后删除 TUI，或把验证通过的 manifest/状态逻辑吸收到正式 CLI。

## 要回答的问题

一个 15 秒编辑拼贴短片，能否只用一份 `film.json`，完成 Flovart 命令映射、本地 mock 镜头渲染和成片验证，并证明整个 dry-run 没有读取 API Key、没有调用 Provider、费用为零？

## 运行

```bash
npm run prototype:vox-film
```

交互界面依次按 `p`、`r`、`v`，或按 `a` 跑完整流程。无人值守验证：

```bash
npm run prototype:vox-film -- --auto
```

产物位于 `.flovart/prototypes/vox-film-dry-run/`，该目录已被 Git 忽略，可以随时删除。

## 判断标准

- `film.json` 能表达 15 秒叙事、风格、镜头、旁白、音乐意图和两个确认门。
- 命令计划必须直接读取当前 `COMMAND_REGISTRY`，不能假设不存在的 Flovart 命令已经实现。
- `final.mp4` 必须含 H.264 视频、音频轨，时长约 15 秒。
- `verification.json` 必须证明 Provider 调用为 0、费用为 0，并列出生产缺口。
