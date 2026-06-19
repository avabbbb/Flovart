import { Download, Pencil, Plus, Trash2, Upload, Workflow } from 'lucide-react';
import { useRef, useState } from 'react';
import { downloadWorkflowProjects, parseWorkflowProjectFile } from './projectTransfer';
import { useWorkflowStore } from './store';

export function WorkflowProjectList({ compact = false }: { compact?: boolean }) {
  const projects = useWorkflowStore(state => state.projects);
  const activeProjectId = useWorkflowStore(state => state.activeProjectId);
  const createProject = useWorkflowStore(state => state.createProject);
  const importProjects = useWorkflowStore(state => state.importProjects);
  const setActiveProject = useWorkflowStore(state => state.setActiveProject);
  const renameProject = useWorkflowStore(state => state.renameProject);
  const deleteProjects = useWorkflowStore(state => state.deleteProjects);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const deletingProject = projects.find(project => project.id === deleteId);

  const beginRename = (id: string, title: string) => {
    setEditingId(id);
    setDraft(title);
  };
  const finishRename = () => {
    if (editingId) renameProject(editingId, draft);
    setEditingId(null);
  };

  return (
    <aside className={compact ? 'workflow-projects is-compact' : 'workflow-projects'}>
      <div className="workflow-projects__header">
        <div><Workflow size={16} /><strong>Workflow</strong></div>
        <div className="workflow-projects__actions">
          <button type="button" aria-label="导入工作流" title="导入工作流" onClick={() => importInput.current?.click()}><Upload size={15} /></button>
          <button type="button" aria-label="导出全部工作流" title="导出全部工作流" disabled={!projects.length} onClick={() => { void downloadWorkflowProjects(projects).catch(error => setNotice(error instanceof Error ? error.message : '导出失败')); }}><Download size={15} /></button>
          <button type="button" aria-label="新建工作流" title="新建工作流" onClick={() => createProject()}><Plus size={16} /></button>
          <input ref={importInput} hidden type="file" accept=".json,.workflow.json,application/json" onChange={event => {
            const file = event.target.files?.[0];
            event.currentTarget.value = '';
            if (!file) return;
            void parseWorkflowProjectFile(file).then(imported => {
              importProjects(imported);
              setNotice(`已导入 ${imported.length} 个工作流`);
            }).catch(error => setNotice(error instanceof Error ? error.message : '导入失败'));
          }} />
        </div>
      </div>
      {notice && <div className="workflow-projects__notice" role="status"><span>{notice}</span><button type="button" aria-label="关闭提示" onClick={() => setNotice(null)}>×</button></div>}
      <div className="workflow-projects__list">
        {projects.length === 0 && <p>还没有工作流，创建一个开始。</p>}
        {projects.map(project => (
          <div key={project.id} className={project.id === activeProjectId ? 'workflow-project is-active' : 'workflow-project'}>
            {editingId === project.id ? (
              <input value={draft} autoFocus onChange={event => setDraft(event.target.value)} onBlur={finishRename} onKeyDown={event => { if (event.key === 'Enter') finishRename(); }} />
            ) : (
              <button type="button" className="workflow-project__open" onClick={() => setActiveProject(project.id)}>{project.title}</button>
            )}
            {!compact && <button type="button" aria-label={`重命名 ${project.title}`} onClick={() => beginRename(project.id, project.title)}><Pencil size={13} /></button>}
            {!compact && <button type="button" aria-label={`删除 ${project.title}`} onClick={() => setDeleteId(project.id)}><Trash2 size={13} /></button>}
          </div>
        ))}
      </div>
      {deletingProject && <div className="workflow-projects__confirm" role="dialog" aria-modal="true" aria-label="删除工作流确认">
        <strong>删除“{deletingProject.title}”？</strong>
        <p>节点、连线和本地媒体会一起移除，此操作不能撤销。</p>
        <div><button type="button" onClick={() => setDeleteId(null)}>取消</button><button type="button" className="is-danger" onClick={() => { deleteProjects([deletingProject.id]); setDeleteId(null); }}>删除</button></div>
      </div>}
    </aside>
  );
}
