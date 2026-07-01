// RouterHost — 顶层路由容器
// HashRouter 兼容 Tauri / Cloudflare Pages 子路径 / GitHub Pages / Vercel
// /         → ToC 社区类 Landing Page
// /business → ToB SaaS 类 Landing Page
// /app      → 画布/工作流 主应用 (App.tsx)
// /enterprise/* → 企业后台
import React, { Suspense } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';

const EnterpriseApp = React.lazy(() => import('./components/enterprise/EnterpriseApp'));
const ToCLanding = React.lazy(() => import('./components/landing/ToCLanding'));
const ToBLanding = React.lazy(() => import('./components/landing/ToBLanding'));
const PromptsPage = React.lazy(() => import('./components/community/PromptsPage'));

export function RouterHost() {
  return (
    <ErrorBoundary>
      <HashRouter>
        <Routes>
          <Route
            path="/"
            element={
              <Suspense fallback={<div className="flex h-screen items-center justify-center text-sm" style={{ color: '#a8a49c' }}>加载中...</div>}>
                <ToCLanding />
              </Suspense>
            }
          />
          <Route
            path="/business"
            element={
              <Suspense fallback={<div className="flex h-screen items-center justify-center text-sm" style={{ color: '#a8a49c' }}>加载中...</div>}>
                <ToBLanding />
              </Suspense>
            }
          />
          <Route path="/app" element={<App />} />
          <Route
            path="/prompts"
            element={
              <Suspense fallback={<div className="flex h-screen items-center justify-center text-sm" style={{ color: '#a8a49c' }}>加载中...</div>}>
                <PromptsPage />
              </Suspense>
            }
          />
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