import { ArrowLeft, Languages, Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ModelPreference, UserApiKey } from '../../types';
import '../../styles/workflow.css';
import type { GenerationCapability, GenerationMode } from '../../services/generationCapabilities';
import { InfiniteWorkflow } from './InfiniteWorkflow';
import { WorkflowProjectList } from './WorkflowProjectList';
import { WorkflowGenerationCapabilitiesProvider, type WorkflowSharedMedia } from './WorkflowConfigPanel';
import { useWorkflowStore } from './store';
import type { WorkflowModelOptions } from './WorkflowNodePromptBar';
import { WorkflowAgentPanel } from './WorkflowAgentPanel';

export interface WorkflowWorkspaceProps {
  theme: 'light' | 'dark';
  language: 'en' | 'zho';
  onSwitchToCanvas: () => void;
  onToggleTheme?: () => void;
  onToggleLanguage?: () => void;
  resolveGenerationCapability?: (mode: GenerationMode, modelId?: string) => GenerationCapability;
  sharedMedia?: WorkflowSharedMedia[];
  onRunNode?: (projectId: string, nodeId: string) => Promise<void> | void;
  onStopNode?: (projectId: string, nodeId: string) => void;
  onSaveWorkflowMedia?: (projectId: string, nodeId: string) => void;
  t: (key: string, ...args: any[]) => string;
  userApiKeys: UserApiKey[];
  modelPreference: ModelPreference;
  dynamicModelOptions: WorkflowModelOptions;
  onOpenSettings?: () => void;
  onOpenAgent?: () => void;
}

export function WorkflowWorkspace({ theme, language, onSwitchToCanvas, onToggleTheme, onToggleLanguage, resolveGenerationCapability, sharedMedia, onRunNode, onStopNode, onSaveWorkflowMedia, t, userApiKeys, modelPreference, dynamicModelOptions, onOpenSettings, onOpenAgent }: WorkflowWorkspaceProps) {
  const [agentOpen, setAgentOpen] = useState(false);
  const hydrated = useWorkflowStore(state => state.hydrated);
  const projects = useWorkflowStore(state => state.projects);
  const activeProjectId = useWorkflowStore(state => state.activeProjectId);
  const setActiveProject = useWorkflowStore(state => state.setActiveProject);
  const createProject = useWorkflowStore(state => state.createProject);
  const updateProject = useWorkflowStore(state => state.updateProject);
  const activeProject = projects.find(project => project.id === activeProjectId) || null;

  useEffect(() => {
    if (hydrated && projects.length > 0 && !activeProjectId) setActiveProject(projects[0].id);
  }, [activeProjectId, hydrated, projects, setActiveProject]);

  if (!hydrated) return <div className="workflow-loading">正在加载 Workflow...</div>;

  return (
    <section className="workflow-workspace" data-theme={theme} data-language={language}>
      <WorkflowProjectList />
      <main className="workflow-workspace__main">
        <WorkflowGenerationCapabilitiesProvider resolve={resolveGenerationCapability} sharedMedia={sharedMedia}>
        {activeProject ? (
          <InfiniteWorkflow
            project={activeProject}
            updateProject={patch => updateProject(activeProject.id, patch)}
            onRunNode={nodeId => {
              if (onRunNode) void onRunNode(activeProject.id, nodeId);
              else updateProject(activeProject.id, {
                nodes: activeProject.nodes.map(node => node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: 'error', error: '生成适配器尚未连接' } } : node),
              });
            }}
            onStopNode={nodeId => onStopNode?.(activeProject.id, nodeId)}
            onSaveWorkflowMedia={nodeId => onSaveWorkflowMedia?.(activeProject.id, nodeId)}
            onOpenAgent={() => { setAgentOpen(true); onOpenAgent?.(); }}
            t={t}
            theme={theme}
            language={language}
            userApiKeys={userApiKeys}
            modelPreference={modelPreference}
            dynamicModelOptions={dynamicModelOptions}
            onOpenSettings={onOpenSettings}
          />
        ) : (
          <div className="workflow-empty">
            <h1>Workflow</h1>
            <p>使用节点组织提示词、参考素材和生成配置。</p>
            <button type="button" aria-label="新建工作流" onClick={() => createProject()}>新建工作流</button>
          </div>
        )}
        </WorkflowGenerationCapabilitiesProvider>
      </main>
      {activeProject && agentOpen && <WorkflowAgentPanel project={activeProject} onClose={() => setAgentOpen(false)} />}
      <div className="workflow-bottom-bar">
        <button type="button" onClick={onSwitchToCanvas}><ArrowLeft size={14} />Canvas</button>
        <span>{activeProject?.title || 'Workflow'}</span>
        {onToggleLanguage && <button type="button" aria-label="切换语言" onClick={onToggleLanguage}><Languages size={14} />{language === 'zho' ? 'EN' : '中'}</button>}
        {onToggleTheme && <button type="button" aria-label="切换主题" onClick={onToggleTheme}>{theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}</button>}
      </div>
    </section>
  );
}
