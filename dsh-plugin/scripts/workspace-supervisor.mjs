const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

function sameSession(left, right) {
  return Boolean(left && right && left.url === right.url && left.token === right.token)
}

/**
 * Owns exactly one launcher-created Workspace Operator.
 *
 * An already healthy Operator is borrowed and never controlled. An owned
 * Operator is restarted with bounded backoff, but its URL/token contract may
 * not change because those values were injected into the running Harness.
 */
export class WorkspaceSupervisor {
  constructor({
    readConfig,
    probe,
    spawnWorkspace,
    delay = sleep,
    now = () => Date.now(),
    readinessAttempts = 50,
    readinessPollMs = 200,
    restartDelays = [250, 750, 1500],
    maxRestarts = 3,
    restartWindowMs = 60_000,
    onEvent = () => {},
  }) {
    this.readConfig = readConfig
    this.probe = probe
    this.spawnWorkspace = spawnWorkspace
    this.delay = delay
    this.now = now
    this.readinessAttempts = readinessAttempts
    this.readinessPollMs = readinessPollMs
    this.restartDelays = restartDelays.length ? restartDelays : [0]
    this.maxRestarts = maxRestarts
    this.restartWindowMs = restartWindowMs
    this.onEvent = onEvent
    this.state = 'idle'
    this.ownership = null
    this.config = null
    this.child = null
    this.stopping = false
    this.restartTimes = []
    this.restartCount = 0
    this.recovery = null
    this.failureReported = false
    this.failure = new Promise(resolve => { this.resolveFailure = resolve })
  }

  snapshot() {
    return {
      state: this.state,
      ownership: this.ownership,
      config: this.config,
      restarts: this.restartCount,
    }
  }

  waitForFailure() {
    return this.failure
  }

  async start() {
    if (this.state !== 'idle') throw new Error('Workspace Supervisor 只能启动一次。')
    this.state = 'starting'
    const existingConfig = this.readConfig()
    const existingHealth = await this.probe(existingConfig)
    if (existingHealth) {
      if (existingHealth.serviceMode !== 'workspace-only') {
        this.state = 'failed'
        throw new Error(`端口 ${new URL(existingConfig.url).port || '17372'} 正被旧 Flovart Agent 占用。请先关闭它，再由 Harness 启动 Workspace Operator。`)
      }
      this.config = existingConfig
      this.ownership = 'external'
      this.state = 'running'
      this.emit('borrowed')
      return { config: this.config, ownership: this.ownership }
    }

    try {
      this.ownership = 'owned'
      this.config = await this.launchOwned(null)
      this.state = 'running'
      this.emit('started')
      return { config: this.config, ownership: this.ownership }
    } catch (error) {
      this.state = 'failed'
      throw error
    }
  }

  async stop() {
    if (this.state === 'stopped') return
    this.stopping = true
    this.state = 'stopped'
    const child = this.child
    this.child = null
    if (this.ownership === 'owned' && child?.exitCode === null) child.kill()
    if (this.recovery) await this.recovery.catch(() => {})
    this.emit('stopped')
  }

  async launchOwned(expectedConfig) {
    const child = this.spawnWorkspace()
    this.child = child
    let spawnError = null
    const captureSpawnError = error => { spawnError = error }
    child.once('error', captureSpawnError)

    try {
      for (let attempt = 0; attempt < this.readinessAttempts; attempt += 1) {
        if (spawnError) throw spawnError
        if (child.exitCode !== null) throw new Error(`Workspace Operator 提前退出（退出码 ${child.exitCode}）。`)
        await this.delay(this.readinessPollMs)
        const config = this.readConfig()
        const health = await this.probe(config)
        if (!health) continue
        if (health.serviceMode !== 'workspace-only') throw new Error('Workspace Operator 启动后返回了错误的服务模式。')
        if (expectedConfig && !sameSession(expectedConfig, config)) {
          throw new Error('Workspace Operator 重启后改变了会话 URL 或 Token；Harness 无法安全复用旧连接。')
        }
        child.off('error', captureSpawnError)
        this.watchOwned(child)
        return config
      }
      throw new Error(`Workspace Operator 在 ${Math.ceil(this.readinessAttempts * this.readinessPollMs / 1000)} 秒内未就绪。`)
    } catch (error) {
      child.off('error', captureSpawnError)
      if (child.exitCode === null) child.kill()
      if (this.child === child) this.child = null
      throw error
    }
  }

  watchOwned(child) {
    let handled = false
    const exited = reason => {
      if (handled) return
      handled = true
      this.handleOwnedExit(child, reason)
    }
    child.once('error', error => exited(error))
    child.once('exit', code => exited(new Error(`Workspace Operator 意外退出（退出码 ${code ?? 1}）。`)))
  }

  handleOwnedExit(child, reason) {
    if (this.child !== child) return
    this.child = null
    if (this.stopping) return
    this.state = 'recovering'
    this.emit('recovering', reason)
    this.recovery = this.recover(reason)
      .catch(error => this.reportFailure(error))
      .finally(() => { this.recovery = null })
  }

  async recover(initialError) {
    let lastError = initialError
    while (!this.stopping) {
      const cutoff = this.now() - this.restartWindowMs
      this.restartTimes = this.restartTimes.filter(timestamp => timestamp >= cutoff)
      if (this.restartTimes.length >= this.maxRestarts) {
        throw new Error(`Workspace Operator 自动恢复失败：${lastError instanceof Error ? lastError.message : String(lastError)}`)
      }
      const delayIndex = Math.min(this.restartTimes.length, this.restartDelays.length - 1)
      await this.delay(this.restartDelays[delayIndex])
      if (this.stopping) return
      this.restartTimes.push(this.now())
      this.restartCount += 1
      try {
        await this.launchOwned(this.config)
        this.state = 'running'
        this.emit('restarted')
        return
      } catch (error) {
        lastError = error
      }
    }
  }

  reportFailure(error) {
    if (this.failureReported || this.stopping) return
    this.failureReported = true
    this.state = 'failed'
    const failure = error instanceof Error ? error : new Error(String(error))
    this.emit('failed', failure)
    this.resolveFailure(failure)
  }

  emit(kind, error = null) {
    this.onEvent({ kind, error, ...this.snapshot() })
  }
}
