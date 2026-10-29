import React from 'react';
import { exportCrashLog, recordCrash } from '../utils/crashLog';

type State = { error: Error | null; copied: boolean };

export class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null, copied: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    recordCrash({
      kind: 'react',
      message: error.name + ': ' + error.message,
      stack: (error.stack ?? '') + ' | component stack: ' + (info.componentStack ?? ''),
    });
  }

  private copyDiagnostics = async () => {
    try {
      await navigator.clipboard.writeText(exportCrashLog());
      this.setState({ copied: true });
    } catch {
      this.setState({ copied: false });
    }
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role='alert' data-testid='app-error-boundary' style={{ padding: 32, fontFamily: 'system-ui, sans-serif', maxWidth: 560, margin: '10vh auto' }}>
        <h1 style={{ fontSize: 20, marginBottom: 12 }}>Flovart 遇到了问题 / Something went wrong</h1>
        <p style={{ marginBottom: 16, opacity: 0.8 }}>你的画布已保存在本地。可以重新加载，或复制诊断信息发给我们。Your canvas is saved locally. Reload, or copy diagnostics to share with us.</p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type='button' onClick={() => window.location.reload()}>重新加载 / Reload</button>
          <button type='button' onClick={this.copyDiagnostics}>{this.state.copied ? '已复制 / Copied' : '复制诊断信息 / Copy diagnostics'}</button>
        </div>
      </div>
    );
  }
}
