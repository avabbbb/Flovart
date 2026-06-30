# 模块 06 — 导演台(3D 构图)

> LibTV 导演台: 3D 场景构图节点，用于预演机位/角色站位/调度
> 日期: 2026-06-29

---

## 1. LibTV 导演台功能

### 1.1 定位
导演台是一个 3D 构图节点，在生成前预演:
- 角色站位
- 相机机位
- 镜头角度
- 群众阵列

### 1.2 3D 模型库

| 模型类型 | 说明 |
|---------|------|
| 人体素模 | 低多边形人体模型，可摆姿势 |
| 几何模型 | 方块/球体/圆柱等，代表道具/建筑 |
| 群众阵列 | 多个人体素模排列，代表人群 |
| 本地上传 | 用户上传 GLB/GLTF 模型 |

### 1.3 相机机位
- 3D 空间内放置虚拟相机
- 调整: 位置 / 朝向 / 焦距 / 光圈
- 截图: 从虚拟相机视角截取 2D 画面
- 截图可导出为 image 节点

### 1.4 角色姿势控制
- 人体素模可摆姿势
- 关节点拖拽(类似 Mixamo / Blender)
- 预设姿势库(站/坐/跑/跳等)

### 1.5 全景图设置
- 3D 场景可设为全景背景
- 720° 环绕查看

### 1.6 快捷键

| 键 | 功能 |
|----|------|
| V | 移动工具 |
| R | 旋转工具 |
| S | 缩放工具 |
| X | 删除选中 |
| T | 切换相机视角 |
| Y | 切换俯视 |
| Q | 切换透视/正交 |

---

## 2. Flovart 现状

### 2.1 完全无 3D 能力 ❌
- 无 3D 渲染引擎
- 无导演台节点
- 无虚拟相机
- 无人体素模

### 2.2 可复用基础
- 无直接可复用(3D 是全新领域)

---

## 3. 实现方案

### 3.1 技术选型

| 选项 | 优劣 |
|------|------|
| **three.js** | 最成熟，React 生态有 @react-three/fiber，但体积大(~600KB) |
| **Babylon.js** | 功能全，但更重 |
| **CSS 3D Transform** | 极轻量但能力有限，无法做复杂 3D |

**建议**: `@react-three/fiber` + `@react-three/drei` (three.js 的 React 封装)

### 3.2 导演台节点类型
```ts
// types.ts 新增
export type WorkflowNodeType = '...' | 'director';  // 第 7 种

export interface DirectorScene {
  models: DirectorModel[];
  cameras: DirectorCamera[];
  background?: 'panorama' | 'solid' | 'gradient';
  panoramaUrl?: string;
}

export interface DirectorModel {
  id: string;
  kind: 'human' | 'geometry' | 'crowd' | 'custom';
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  pose?: DirectorPose;       // 人体姿势
  customUrl?: string;        // 自定义模型 URL
  geometry?: 'box' | 'sphere' | 'cylinder';
}

export interface DirectorCamera {
  id: string;
  position: [number, number, number];
  lookAt: [number, number, number];
  fov: number;
  focalLength: number;
  aperture: number;
}

export interface DirectorPose {
  // 简化: 预设姿势 ID
  preset: 'stand' | 'sit' | 'run' | 'jump' | 'custom';
  joints?: Record<string, [number, number, number]>;  // custom 时关节角度
}
```

### 3.3 导演台编辑器

新建 `components/workflow/DirectorStageEditor.tsx`:
- **3D 视口**: @react-three/fiber Canvas
- **左侧栏**: 模型库(人体素模/几何/群众/上传)
- **右侧栏**: 属性面板(选中模型的 position/rotation/scale/pose)
- **顶部工具栏**: V/R/S/X/T/Y/Q 快捷键
- **相机面板**: 添加虚拟相机 + 截图按钮

### 3.4 人体素模
```tsx
// 用 three.js 基础几何体组装低多边形人体
// 头(球) + 躯干(盒) + 四肢(圆柱)
// 关节点用 Group 嵌套，可旋转
```
- 预设姿势: stand/sit/run/jump → 关节角度预设
- 自定义: 拖拽关节 Group 的 rotation

### 3.5 相机截图
```ts
// 从 three.js 相机渲染 → toDataURL
function captureCameraView(gl: WebGLRenderer, camera: Camera): string {
  gl.render(scene, camera);
  return gl.domElement.toDataURL('image/png');
}
// 截图 → 创建 image 节点
```

### 3.6 截图 → 生成
- 导演台截图(image 节点) → 可连线到 image/video 生成节点
- 作为构图参考图注入 prompt

---

## 4. 优先级

| 子项 | 优先级 | 理由 |
|------|--------|------|
| director 节点类型 + 数据结构 | P2 | 整体 P2 |
| three.js 3D 视口 | P2 | 技术门槛高 |
| 人体素模 + 预设姿势 | P2 | |
| 虚拟相机 + 截图 | P2 | |
| 几何模型 + 群众阵列 | P2 | |
| 本地模型上传 | P3 | |
| 全景背景 | P3 | |
| 快捷键 V/R/S/X/T/Y/Q | P2 | |

---

## 5. 风险

1. **three.js 体积大** — 增加 ~600KB bundle。需动态 import，仅在用导演台时加载。
2. **3D 交互复杂度高** — 拖拽/旋转/缩放/关节调节，开发量大。
3. **人体素模姿势系统** — 自定义关节角度是复杂工程，建议先只做预设姿势。
4. **整体建议最后做** — 导演台是锦上添花，非核心链路。优先级最低。

---

模块 06 分析完。
