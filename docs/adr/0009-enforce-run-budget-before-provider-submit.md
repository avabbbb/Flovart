# Provider 提交前强制 Run Budget

每个 ProductionRun 必须在开始前获得 Run Budget，Runtime 在提交可能计费的 Provider Job 前创建 Cost Reservation，并把预留、确认、估算、释放和退款写入不可变 Usage Ledger。硬上限不能由 Director Skill、重试或 Autonomous 模式突破；价格未知或需要提高上限时进入 System Gate。提交结果不明确时进入 Submission Unknown，保留预留且禁止自动重提，直到通过 Provider 查询、幂等信息或用户确认完成对账。
