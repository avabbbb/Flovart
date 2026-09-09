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
import { useDeploymentStore } from './stores/useDeploymentStore';
import { bootstrapLocalAgentConnection } from './services/agentConnectionBootstrap';

const EnterpriseApp = React.lazy(() => import('./components/enterprise/EnterpriseApp'));
const PlatformAdminApp = React.lazy(() => import('./components/enterprise/PlatformAdminApp'));
const PromptsPage = React.lazy(() => import('./components/community/PromptsPage').then(module => ({ default: module.PromptsPage })));
const FlovartHome = React.lazy(() => import('./components/home/FlovartHome'));
const DockPage = React.lazy(() => import('./components/dock/DockPage').then(module => ({ default: module.DockPage })));

function EnterpriseRoute({ children }: { children: React.ReactNode }) {
  const profile = useDeploymentStore(state => state.profile);
  const initialized = useDeploymentStore(state => state.initialized);
  if (!initialized) return <div className="route-fallback text-sm" style={{ color: 'var(--isl-ink-soft)' }}>正在读取部署配置…</div>;
  return profile.capabilities.enterpriseAdmin ? children : <Navigate to="/app" replace />;
}

export function RouterHost() {
  const projects = useWorkflowStore(state => state.projects);
  const activeProjectId = useWorkflowStore(state => state.activeProjectId);
  const activeProject = projects.find(project => project.id === activeProjectId) || projects[0] || null;

  useEffect(() => {
    void bootstrapLocalAgentConnection().catch(error => {
      console.warn('Flovart Agent auto-bootstrap unavailable.', error);
    });
  }, []);

  useWorkflowWorkspaceAdapter(activeProject);
  useProductionProjectionAdapter(activeProject?.id || null);

  useEffect(() => {
    useUpdaterStore.getState().autoCheckOnStartup();
    void useDeploymentStore.getState().load();
  }, []);

  return (
    <ErrorBoundary>
      <HashRouter>
        <Routes>
          <Route
            path="/"
            element={
              <Suspense fallback={<div className="route-fallback text-sm" style={{ color: '#a8a49c' }}>加载中…</div>}>
                <FlovartHome />
              </Suspense>
            }
          />
          <Route
            path="/app/home"
            element={
              <Suspense fallback={<div className="route-fallback text-sm" style={{ color: '#a8a49c' }}>加载中…</div>}>
                <FlovartHome />
              </Suspense>
            }
          />
          <Route
            path="/dock"
            element={
              <Suspense fallback={<div className="route-fallback text-sm" style={{ color: '#a8a49c' }}>加载 Dock…</div>}>
                <DockPage embedded={window.parent !== window} />
              </Suspense>
            }
          />
          <Route path="/app" element={<App />} />
          <Route
            path="/prompts"
            element={
              <Suspense fallback={<div className="route-fallback text-sm" style={{ color: '#a8a49c' }}>加载中…</div>}>
                <PromptsPage />
              </Suspense>
            }
          />
          <Route
            path="/enterprise/platform"
            element={
              <EnterpriseRoute>
                <Suspense fallback={<div className="route-fallback text-sm">加载平台管理…</div>}>
                  <PlatformAdminApp />
                </Suspense>
              </EnterpriseRoute>
            }
          />
          <Route
            path="/enterprise/*"
            element={
              <EnterpriseRoute>
                <Suspense fallback={<div className="route-fallback text-sm" style={{ color: 'var(--isl-ink-soft)' }}>加载企业后台…</div>}>
                  <EnterpriseApp />
                </Suspense>
              </EnterpriseRoute>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </HashRouter>
    </ErrorBoundary>
  );
}
