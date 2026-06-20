# Flovart 项目清理计划

## 📋 可以清理的文件和目录

### 1. ⚠️ 高优先级清理（历史遗留文档）

#### docs/ 目录下的过期文档
```bash
# 重构相关的历史文档（已完成，可归档或删除）
docs/FINAL_REPORT.md                      # 重构完成报告 (2026-06-09)
docs/KONVA_MIGRATION_GUIDE.md             # Konva 迁移指南（如已完成迁移）
docs/REFACTORING_SUMMARY_2026-06-09.md    # 重构总结
docs/REFACTORING_QUICKSTART.md            # 重构快速开始

# 内部开发文档（可考虑移到 docs/dev/）
docs/PHASE2_RUNTIME_API.md                # Phase2 运行时 API
docs/NODE_CANVAS_REFERENCE_UI_PRD.md      # Canvas PRD
docs/API_KEY_UPGRADE_PLAN.md              # API Key 升级计划
```

**建议操作**：
- 如果这些重构已完成，可以删除或移到 `docs/archive/` 归档目录
- 如果还需要参考，建议移到 `docs/dev/archive/`

---

### 2. 🗂️ 空目录

```bash
docs/dev/           # 空目录
docs/deployment/    # 空目录（我们刚创建的，还未填充内容）
```

**建议操作**：
- `docs/dev/` 可以用来存放内部开发文档
- `docs/deployment/` 保留，后续填充 Docker/Extension 部署指南
- 或者暂时删除空目录，等需要时再创建

---

### 3. 📁 未追踪的文件

```bash
utils/canvasEdges.ts    # 未追踪的工具文件
docker/                 # Docker 相关文件已移动，需要 git add
.workbuddy/            # WorkBuddy 工作目录（可能需要加入 .gitignore）
```

**建议操作**：
- `utils/canvasEdges.ts` - 检查是否需要，如需要则 `git add`
- `docker/` - 已移动 Dockerfile，需要提交
- `.workbuddy/` - 添加到 `.gitignore`

---

### 4. 🧪 测试文件（可选清理）

```bash
tests/ 目录包含 30+ 个测试文件
```

**当前状态**：保留所有测试文件  
**建议**：
- 如果某些测试对应的功能已删除，可以删除对应的测试文件
- 建议保留，测试覆盖是好事

---

### 5. 📦 缓存和构建产物（已被 .gitignore）

```bash
.npm-cache/                # NPM 缓存（已在 .gitignore）
dist/                      # 构建产物
dist-extension/            # 扩展构建产物
node_modules/              # 依赖
```

**状态**：这些已被 `.gitignore` 正确忽略，无需额外处理

---

### 6. 📚 可以整理的文档

#### 用户协议类（已在根目录）
```bash
docs/PRIVACY_POLICY.md      # 隐私政策（根目录已有 PRIVACY_POLICY.md）
docs/TERMS_OF_SERVICE.md    # 使用条款（根目录已有 TERMS_OF_SERVICE.md）
```

**建议**：检查是否重复，保留一份即可

#### 其他文档
```bash
docs/logo-mj-prompts.md     # Logo MJ 提示词（设计资源，可移到 docs/design/）
docs/DOCKER_GUIDE.md        # Docker 指南（可移到 docs/deployment/docker.md）
docs/功能文档.md             # 功能文档（可能与新的 docs/overview/features.md 重复）
```

---

## 🎯 推荐清理步骤

### 第一步：清理空目录和未追踪文件
```bash
# 检查并删除空目录
rmdir docs/dev 2>/dev/null || true

# 添加 .workbuddy 到 .gitignore
echo ".workbuddy/" >> .gitignore

# 检查 utils/canvasEdges.ts 是否需要
# 如果需要：git add utils/canvasEdges.ts
# 如果不需要：rm utils/canvasEdges.ts

# 提交 docker 目录
git add docker/
```

### 第二步：归档历史文档
```bash
# 创建归档目录
mkdir -p docs/archive

# 移动过期文档
git mv docs/FINAL_REPORT.md docs/archive/
git mv docs/KONVA_MIGRATION_GUIDE.md docs/archive/
git mv docs/REFACTORING_SUMMARY_2026-06-09.md docs/archive/
git mv docs/REFACTORING_QUICKSTART.md docs/archive/
```

### 第三步：整理文档结构
```bash
# 检查是否有重复的协议文档
diff docs/PRIVACY_POLICY.md PRIVACY_POLICY.md
diff docs/TERMS_OF_SERVICE.md TERMS_OF_SERVICE.md
# 如果内容一致，删除 docs/ 下的副本

# 移动设计资源
mkdir -p docs/design
git mv docs/logo-mj-prompts.md docs/design/

# 移动 Docker 指南
git mv docs/DOCKER_GUIDE.md docs/deployment/docker.md
```

### 第四步：检查功能文档重复
```bash
# 对比新旧功能文档
diff docs/功能文档.md docs/overview/features.md
# 如果新文档已覆盖旧文档内容，删除旧的
```

---

## ⚠️ 注意事项

1. **删除前备份**：可以先创建 `docs/archive/` 目录存放历史文档
2. **检查引用**：删除前搜索是否有其他文件引用这些文档
3. **Git 历史**：即使删除，Git 历史中仍可找回
4. **分批清理**：建议分多次 commit，方便回滚

---

## 📊 预计清理效果

- **文档数量**：从 14 个根文档减少到 ~8 个核心文档
- **目录结构**：更清晰的分类（overview/progress/deployment/archive）
- **项目整洁度**：显著提升

---

## 🔍 后续检查命令

```bash
# 查看未追踪文件
git status --short | grep "^?"

# 查看已删除但未提交的文件
git status --short | grep "^ D"

# 查看大文件
find . -type f -size +1M | grep -v node_modules | grep -v .git

# 查看临时文件
find . -name "*.log" -o -name "*.tmp" -o -name "*.bak" | grep -v node_modules
```

---

**清理建议严格度**：中等
**执行前建议**：先 `git commit` 当前工作，再开始清理，方便回滚
