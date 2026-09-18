// RouterHost — 顶层路由容器
// HashRouter 兼容 Tauri / Cloudflare Pages 子路径 / GitHub Pages / Vercel
// /      → 重定向到 /app
// /app   → Workflow 主应用 (App.tsx)
import React, { useEffect } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useWorkflowStore } from './components/workflow/store';
import { useProductionProjectionAdapter } from './components/workflow/useProductionProjectionAdapter';
import { useWorkflowWorkspaceAdapter } from './components/workflow/useWorkflowWorkspaceAdapter';
import { useUpdaterStore } from './stores/useUpdaterStore';
import { bootstrapLocalAgentConnection } from './services/agentConnectionBootstrap';

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
  }, []);

  return (
    <ErrorBoundary>
      <HashRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/app" replace />} />
          <Route path="/app" element={<App />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </HashRouter>
    </ErrorBoundary>
  );
}
