import React from 'react';

interface State { hasError: boolean; error: Error | null }

export class ErrorBoundary extends React.Component<React.PropsWithChildren, State> {
    state: State = { hasError: false, error: null };

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, info: React.ErrorInfo) {
        console.error('[ErrorBoundary]', error, info.componentStack);
    }

    handleRecover = () => this.setState({ hasError: false, error: null });
    handleReload = () => window.location.reload();

    render() {
        if (this.state.hasError) {
            return (
                <div style={{ display: 'flex', minHeight: 'var(--app-height)', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, background: '#111', color: '#eee', fontFamily: 'system-ui, sans-serif' }}>
                    <h2 style={{ margin: 0 }}>渲染出错了</h2>
                    <p style={{ maxWidth: 480, textAlign: 'center', opacity: 0.7, fontSize: 14 }}>
                        {this.state.error?.message || '未知错误'}
                    </p>
                    <div style={{ display: 'flex', gap: 12 }}>
                        <button onClick={this.handleRecover} style={{ padding: '8px 20px', borderRadius: 6, border: '1px solid #555', background: 'transparent', color: '#eee', cursor: 'pointer' }}>
                            尝试恢复
                        </button>
                        <button onClick={this.handleReload} style={{ padding: '8px 20px', borderRadius: 6, border: 'none', background: '#7c3aed', color: '#fff', cursor: 'pointer' }}>
                            刷新页面
                        </button>
                    </div>
                </div>
            );
        }
        return this.props.children;
    }
}
