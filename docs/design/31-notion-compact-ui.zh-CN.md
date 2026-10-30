# Notion 式紧凑扁平分层 UI 改造清单

> 状态：**Checklist**（2026-10-30）。依据：LibTV/RHTV 用户视频抽帧观察（画布、侧栏对话框、弹层）与 Flovart 当前代码扫描。本文只列改造项，尚未实施。

## 1. 目标规范

| 维度 | 现状 | 目标 |
| --- | --- | --- |
| 层级 | 「pressable 3D drop」（`--isl-drop*` 2–5px）+ 软阴影 | 只用 3 层：画布底 `--isl-surface` / 面板 `--isl-card` / 浮层（仅浮层保留 `--isl-shadow-sm`） |
| 边框 | `border-[1.5px]`、`border-2` | 统一 1px `--isl-border`；强调用背景色而非加粗 |
| 圆角 | `rounded-2xl/3xl`、pill chip | 控件 6px、面板 8px、弹窗 10px；参考已有 `.isl-pop .isl-chip { border-radius: 6px }` |
| 字重 | `font-extrabold` 标题 | 标题 600、正文 400、辅助 12px `--isl-ink-soft` |
| 密度 | `p-4`、`py-2.5`、`mb-6` | 行高 28–32px，控件内边距 `px-2 py-1`，分组间距 12px |
| 交互 | 按压位移/抬起 | hover 只换背景 `bg-black/5`（暗色 `white/6`），无 transform |
| 强调色 | mint 多处使用 | mint 仅用于主操作、选中态、进度 |

## 2. 方案选择

- 方案 1（**采用**）：先改 token，再按文件清理硬编码类。改动面最小，暗色主题自动跟随。
- 方案 2：只逐组件重写。效果不一致，遗漏多。
- 方案 3：新增「紧凑主题」开关。双份样式长期维护成本高。

## 3. 清单

### P0 Token（`styles/index.css`）

- [x] `--isl-drop-sm / --isl-drop / --isl-drop-lg` 先置 0，全仓确认无引用后已删除变量定义。（2026-10-30 已实施）
- [x] `--isl-shadow` / `--isl-shadow-lg` 降为轻量浮层阴影（亮/暗主题）。（2026-10-30 已实施）
- [x] `--isl-r-lg` 收紧到 10px（`.isl-shell` 使用）；现有 `--isl-r-sm` 6px / `--isl-r` 8px 已满足控件与面板，不再新增 `--isl-r-md`。（2026-10-30 已实施）
- [x] `.isl-chip` 默认圆角改 6px（`var(--isl-r-sm)`）；`.isl-pop .isl-chip` 两条重复规则已合并为一条。（2026-10-30 已实施）
- [x] 画布残留硬编码重阴影收敛到 `--isl-shadow-sm / --isl-shadow / --isl-shadow-lg`：节点卡片、选中态、连接点、连线气泡、标题编辑、项目确认框、右侧面板。视频控件等深色媒体上的浮层阴影保留（保证可读性）。（2026-10-30 已实施）
- [x] 画布 chip 合并：`.workflow-node__anchor-chip` / `.workflow-config__chip` / `.local-folder-chip` 共享一条基类规则（布局、边框、字号、hover/active），各自只保留尺寸与圆角。（2026-10-30 已实施）
- [ ] `index.css` 内 10 处 drop/shadow 引用逐项确认：面板去阴影，浮层保留 sm。

### P0 画布与工作流

- [ ] `styles/workflow.css`（6 处 drop/shadow）：节点卡片改 1px 边框 + 选中态 mint 描边，去抬起。
- [ ] `components/workflow/InfiniteWorkflow.tsx`（1 处）、`WorkflowSidebar.tsx`（rounded-2xl 1、border-2 1、shadow 1）。
- [ ] `styles/generation.css`（1 处）。
- [ ] 工具栏 popover（含自动截帧/分离开关）行高 28px，checkbox 与文字同行。

### P1 设置与提示栏

- [ ] `components/SettingsPanel.tsx`：17 处 `rounded-2xl/3xl` → 8px；7 处 `font-extrabold` → `font-semibold`；`sectionPanelClass` 的 `border-[1.5px]` → 1px；标签页 `py-2.5 / mb-6` → `py-1.5 / mb-4`。
- [ ] `components/PromptBar.tsx`：rounded-2xl 2、粗边框 3、extrabold 2。
- [ ] `components/settings/UserScriptAdapterSection.tsx`：rounded 1、粗边框 1。
- [ ] 新增「用量」页（`TokenUsageSection.tsx`）已按目标规范实现，可作参照。

### P1 素材库（Studio）

- [ ] `studio/AssetLibraryBrowser.tsx`：粗边框 11、shadow 3、rounded 1。
- [ ] `studio/BatchManageModal.tsx`：粗边框 7。
- [ ] `studio/FolderTree.tsx`：粗边框 3、shadow 1；树行高 28px、展开箭头 12px。
- [ ] `studio/DeleteFolderDialog.tsx`（2）、`assetLibraryShared.tsx`（1）、`StudioMediaBrowser.tsx`（1）、`StudioTopMenu.tsx`（1）、`AssetReferencePicker.tsx`（rounded 2、extrabold 1）。

### P2 表格

- [ ] `components/table/TableWorkspace.tsx`（1 处 shadow）：表头 sticky + 1px 底线，行 hover 只变背景。

## 4. 验收

- `rg -c "rounded-(2xl|3xl)|border-\[1\.5px\]|border-2\b|font-extrabold" components` 结果为 0（浮层例外需注释说明）。
- 亮/暗主题各截图：画布、设置、素材库、工具栏 popover。
- 现有 UI 测试与 `tsc --noEmit` 全部通过；无 `data-testid` 变更。

## 5. 当前扫描基线（2026-10-30）

| 模式 | 合计 | 主要文件 |
| --- | --- | --- |
| `rounded-2xl/3xl` | 24 | SettingsPanel 17 |
| `border-[1.5px]` / `border-2` | 32 | AssetLibraryBrowser 11、BatchManageModal 7 |
| drop / shadow | 24 | index.css 10、workflow.css 6 |
| `font-extrabold` | 10 | SettingsPanel 7 |
