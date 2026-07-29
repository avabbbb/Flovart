# 以轻量 npm Bootstrapper 分发 Agent Toolkit

`npx flovart` 只分发并启动轻量 TUI、CLI 和安装引导，不再通过 `git clone` 把完整 Flovart 源码当作普通用户的安装产物。用户执行安装动作后，Agent Bootstrapper 从官方 Release 下载与自身兼容的 Runtime Release Bundle；该 Bundle 使用精确版本和完整性清单标识，包含已构建 WebUI、本地 Runtime 与所需宿主组件，并安装到用户级版本目录。普通安装只要求可运行 `npx` 的 Node.js 环境，不要求 Git、Go、PostgreSQL 或 Docker。

Agent Bootstrapper 必须在启用新版本前验证 Release 来源、清单和文件哈希，并保留可回退的上一版本；CLI 与 Runtime 的兼容关系由 Release Manifest 固定，不能在每次启动时暗中追随 `latest`。Runtime Release Bundle 和 Desktop Edition 同时按平台捆绑一份固定、受校验的 Agent Node Runtime，专门运行 PI Agent 与 Flovart Node 宿主；正式安装启动 Agent 时只使用 Bundle 内的 Node，不读取用户 PATH，也不要求用户自行满足 PI 的 Node 版本。这个运行时随 Flovart Release 原子升级和回退，代价是增加安装体积，以换取 Node ABI、PI 依赖与诊断环境可复现。源码贡献者另行显式克隆仓库并使用 Source Development Mode；正式安装命令不提供隐式源码回退，避免把编译环境、开发 Compose 和用户运行环境再次混在一起。

安装完成后的标准入口是 `flovart start`：它创建一个 Local Workbench Session，按依赖顺序启动本地 Runtime、已构建 WebUI、TUI 与用户选择的 Coding Agent，并在退出时按顺序回收本次启动的子进程。Runtime、WebUI 和 Agent 仍提供显式独立子命令用于日志检查与故障隔离，但不要求普通用户用多个终端拼装正常启动流程。

Desktop Edition 和 Agent Toolkit 通过当前用户范围的 Local Runtime Registry 协调共存。`flovart start` 发现身份可信且协议兼容的 Desktop Runtime 时直接附着复用；没有兼容 Runtime 时才启动自身 Bundle 中的 Runtime，因此纯 `npx` 路径不依赖 Desktop EXE。发现记录必须包含协议与发行版本，并使用当前用户可读的会话凭据完成 loopback 鉴权；CLI 不能仅凭固定端口或进程名称信任任意 localhost 服务。不兼容版本允许并存，但必须使用隔离端口和明确状态提示，不能暗中接管彼此的进程或项目锁。

首次 `npx flovart install` 成功后，Agent Bootstrapper 在当前用户目录安装 User CLI Launcher 并配置用户级 PATH，使后续标准命令为 `flovart start`，而不是要求 `npm install -g` 或每次重新执行 `npx`。该操作不得要求管理员权限；如果 PATH 更新失败，安装器必须显示可复制的 Launcher 绝对路径，并保留 `npx flovart start` 与 `npx flovart doctor` 作为可用回退和修复入口。
