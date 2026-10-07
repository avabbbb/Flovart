# 模块：Table

> 状态：**Current truth**（主体仍为设计目标）。总纲见[总体设计](00-overview.md)。

## 1. 职责

Table 是结构化的批量媒体处理视图：选择输入 → 处理 → 输出。它维护自己的局部处理图与历史，**不是第二份 Workflow 权威**；结果只能通过显式“提交”回到 Workflow 或素材库。

## 2. 当前状态

- 已实现：`components/table/TableWorkspace.tsx` 的入口、空状态与英文副本；Assistant drawer 可在 Table 旁打开。
- 设计目标：最小“输入 → 处理 → 输出”节点图；之后按真实需求逐项加入人物抠图、深度 / 结构参考、风格化、视频批处理、故事版。不一次建全。

## 3. 数据规则

- Table 与 Workflow 之间只用明确的素材引用和导入交接，不隐式双写同一节点。
- 提交前列出将新增 / 替换的项；默认新增。
- 大文件处理必须有进度、取消和内存上限；取消后由用户决定保留或丢弃已完成部分。

## 4. 交互要点

- 布局：source rail / preview / tools 用 `clamp()` 与 container query 重排；窄容器时 rail 与 tools 堆叠。
- 主滚动容器是当前媒体 / 工具内容区。
- 处理工具列表来自工具注册表，与 Canvas 共用同一套能力声明，不各自维护模型偏好。

## 5. 验证

Table 回归测试（`tableWorkspace`）；提交前后 Workflow 状态一致性；大文件取消与内存。
