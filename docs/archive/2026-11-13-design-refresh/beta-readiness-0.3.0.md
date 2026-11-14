# 0.3.0 内测就绪汇总

> **已归档（2026-11-13）**：一次性 / 已完成文档，不是 current truth。归档原因见本目录 [README](README.md)。

更新：2026-11-06。线上：flovart.avabbbb.com（main f771465，标签 v0.3.0 指向 5f2d8d1）。

## 内测上线标准对照

| 标准 | 状态 | 证据 |
| --- | --- | --- |
| 画布不丢数据 | 通过 | 单写入标签页（writerLock）、保存失败常驻提示 + 重试/导出 |
| Agent 不崩、可中断 | 通过 | 孤立 toolCall 补结果、停止释放确认卡、批量删除需确认 |
| 密钥安全 | 通过 | keyVault v2 派生不依赖 UA，解密失败保留密文 |
| 媒体工具可用 | 通过 | 分离音频、截取帧在 Chrome 多线程与单线程均实测通过；ffmpeg core npmmirror→jsdelivr→unpkg 回退 |
| 未完成功能不暴露 | 通过 | 逆向工作台、登录/注册为占位；离线模式、武侠模板已删 |
| 自动化验证 | 通过 | tsc；vitest 264 文件 1621 通过 1 跳过；vite build |
| 线上一致 | 通过 | 线上 bundle 与本地构建一致，COOP same-origin / COEP credentialless |

## 阻塞项

无硬阻塞。是否正式内测上线等 2026-11-07 实际试用反馈。

## 风险与修复优先级

- P1：GitHub Dependabot 22 个告警（1 critical、7 high），需确认是否在生产依赖链上。
- P1：ffmpeg core 首选第三方镜像 npmmirror，无 SRI；已有 jsdelivr/unpkg 回退。长期：自建 R2/对象存储托管（Pages 单文件 25 MiB 上限放不下 31MB wasm）。
- P2：主 bundle 2.7MB（gzip 876KB），首屏偏慢；可按路由/面板拆分。
- P2：Safari/Firefox 非 crossOriginIsolated 时走单线程 ffmpeg，功能正常但更慢（未在这两个浏览器实测）。
- P2：中国大陆网络下 CDN 可达性未实测，试用时观察分离音频首次加载时间。

## 插件上架计划

见 docs/plans/immersive-translate-benchmark.md。摘要：内测保持免登录 + BYOK；插件单一价值「网页素材一键送进画布」；先 Chrome/Edge/Firefox 未公开发布，权限最小化；商业化（Pro 托管额度 + 云同步）待账号与支付体系。

## 0.3.0 之后

- DSH M1（docs/plans/dsh-workbench.md），作者姓名与邮箱待确认。
- 按试用反馈继续打磨画布/Agent。
