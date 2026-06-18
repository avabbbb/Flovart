import { Pencil, Plus, Trash2, Workflow } from 'lucide-react';
import { useState } from 'react';
import { useWorkflowStore } from './store';

export function WorkflowProjectList({ compact = false }: { compact?: boolean }) {
  const projects = useWorkflowStore(state => state.projects);
  const activeProjectId = useWorkflowStore(state => state.activeProjectId);
  const createProject = useWorkflowStore(state => state.createProject);
  const setActiveProject = useWorkflowStore(state => state.setActiveProject);
  const renameProject = useWorkflowStore(state => state.renameProject);
  const deleteProjects = useWorkflowStore(state => state.deleteProjects);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

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
        <button type="button" aria-label="新建工作流" onClick={() => createProject()}><Plus size={16} /></button>
      </div>
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
            {!compact && <button type="button" aria-label={`删除 ${project.title}`} onClick={() => deleteProjects([project.id])}><Trash2 size={13} /></button>}
          </div>
        ))}
      </div>
    </aside>
  );
}
