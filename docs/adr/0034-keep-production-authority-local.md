# V1 将成片制作权威保留在用户本机

Flovart V1 由本机 Desktop Runtime 独占 Production Authority，负责 ProductionRun、审批、预算、ProviderAttempt、Artifact 和 Provider 凭据；云端 Skill Hub 只负责 Production Skill Package 的发布、检索、下载、评测、认证与撤销，不保存用户 API Key、不提交 Provider Job，也不承接成片运行。这样保留现有本地优先和 BYOK 边界，并避免在 V1 同时承担云端秘密托管、计费争议、媒体队列恢复和跨租户隔离；未来若提供托管制作，应作为新的运行模式单独决策，而不是让同一个 ProductionRun 在本机与云端之间隐式漂移。
