// RouterHost — 顶层路由容器
// HashRouter 兼容 Tauri / Cloudflare Pages 子路径 / GitHub Pages / Vercel
// /         → ToC 社区类 Landing Page
// /business → ToB SaaS 类 Landing Page
// /app      → Workflow 主应用 (App.tsx)
// /enterprise/* → 企业后台
import React, { Suspense, useEffect } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useWorkflowStore } from './components/workflow/store';
import { useProductionProjectionAdapter } from './components/workflow/useProductionProjectionAdapter';
import { useWorkflowWorkspaceAdapter } from './components/workflow/useWorkflowWorkspaceAdapter';
import { useUpdaterStore } from './stores/useUpdaterStore';

const EnterpriseApp = React.lazy(() => import('./components/enterprise/EnterpriseApp'));
const ToCLanding = React.lazy(() => import('./components/landing/ToCLanding'));
const ToBLanding = React.lazy(() => import('./components/landing/ToBLanding'));
const PromptsPage = React.lazy(() => import('./components/community/PromptsPage').then(module => ({ default: module.PromptsPage })));
const FlovartHome = React.lazy(() => import('./components/home/FlovartHome'));

export function RouterHost() {
  const projects = useWorkflowStore(state => state.projects);
  const activeProjectId = useWorkflowStore(state => state.activeProjectId);
  const activeProject = projects.find(project => project.id === activeProjectId) || projects[0] || null;
  useWorkflowWorkspaceAdapter(activeProject);
  useProductionProjectionAdapter(activeProject?.id || null);

  useEffect(() => {
    useUpdaterStore.getState().autoCheckOnStartup();
  }, []);

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
          <Route
            path="/app/home"
            element={
              <Suspense fallback={<div className="flex h-screen items-center justify-center text-sm" style={{ color: '#a8a49c' }}>加载中...</div>}>
                <FlovartHome />
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
