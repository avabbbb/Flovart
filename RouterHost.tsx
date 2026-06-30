// RouterHost — 顶层路由容器
// HashRouter 兼容 Tauri / Cloudflare Pages 子路径 / GitHub Pages / Vercel
// 现 App.tsx 作为 / 主路由（其内部 canvas/workflow 切换保持不变）
// /enterprise/* 走企业后台路由
import React, { Suspense } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';

const EnterpriseApp = React.lazy(() => import('./components/enterprise/EnterpriseApp'));

export function RouterHost() {
  return (
    <ErrorBoundary>
      <HashRouter>
        <Routes>
          <Route path="/" element={<App />} />
          <Route
            path="/enterprise/*"
            element={
              <Suspense fallback={<div className="flex h-screen items-center justify-center text-sm" style={{ color: 'var(--isl-ink-soft)' }}>加载企业后台...</div>}>
                <EnterpriseApp />
              </Suspense>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </HashRouter>
    </ErrorBoundary>
  );
}