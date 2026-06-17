# 开发计划

## 已完成 ✅

- [X] 无限画布 + 基础设计工具
- [X] 多 Provider BYOK 系统（12+ Provider）
- [X] AI 文生图 / 图生图 / 文生视频
- [X] Multi-Agent 协作群聊（含历史子视图 + 日志持久化）
- [X] 滤镜/调色/图层蒙版
- [X] AI 局部重绘 / 扩图
- [X] 用量监控 + Key 批量管理
- [X] 浏览器扩展 MVP（v1.2.0）
- [X] Docker 部署
- [X] Tauri 2 桌面端（Win / macOS / Linux）
- [X] 在线 Demo（GitHub Pages）
- [X] 第三方 API 聚合端点全兼容（自动 baseUrl 裁剪、/chat/completions 降级、多图片格式解析）
- [X] SSE 流式图片反推提示词 + 取消
- [X] App.tsx 模块化拆分（hooks 抽离：`useCanvasInteraction` / `useGeneration` / `useApiKeys` / `useToast`）
- [X] Agent-Native CLI（`tools/flovart/cli.js`，30+ 确定性命令）
- [X] CLI 工具桥（`tools/flovart/cli.js`） + SKILL.md（Claude Code / OpenCode / Codex 直接驱动）
- [X] 图层拖拽排序 + 实时 drop indicator
- [X] 双击图层聚焦 / 三击空白适配视图
- [X] Tactile Shell AC 视觉语言（tab bar / 图层卡片 / 弹窗 / 页脚统一）
- [X] 紧凑化页脚（4 chip：使用条款 / 隐私政策 / 主题 / 语言切换）
- [X] **Canvas ↔ Workflow 双工作区切换**（底栏切换按钮 + 独立底栏 UI）
- [X] **Workflow 亮暗主题适配**（白天模式浅色背景 + 深色模式深色背景）

## 进行中 🚧

- [ ] Chrome / Edge 商店上架
- [ ] 扩展端服务凭据加密存储 + 跨设备同步
- [ ] Tauri 自动更新通道（Updater plugin 已接入，待签发测试版）
- [ ] 节点流可视化编辑器迭代（多选 / 折叠 / 模板导入）
- [ ] 第三方端点适配规则扩充（中转站 / 企业内网网关 / 自定义鉴权）

## 规划中 📝

- [ ] **LangGraph.js Agent 编排** — 节点流背后的运行时换成 LangGraph，支持自定义 Skills（类 GPTs）
- [ ] **AI 短剧一键流水线** — Brief → Storyboard → 镜头分镜 → 视频成片
- [ ] **多画板 / 多页面** — Workspace 间共享同一画布集合
- [ ] **实时协作（CRDT）** — 多人编辑同一画布，光标 / 选区同步
- [ ] **画布性能优化** — 针对 >500 元素场景的渲染优化
- [ ] **插件市场** — Provider / 节点 / 模板可打包分发
- [ ] **移动端适配** — 触屏手势 + 简化版 Toolbar
- [ ] **桌面端系统集成** — 系统托盘 / 全局快捷键 / 文件拖入
