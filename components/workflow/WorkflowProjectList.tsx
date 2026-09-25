import { Download, Pencil, Plus, Trash2, Upload, Workflow } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { downloadWorkflowProjects, parseWorkflowProjectFile } from './projectTransfer';
import { useWorkflowStore } from './store';
import { displayError } from '../../services/displayError';
import { useWorkspaceStore } from '../../stores/useWorkspaceStore';

export function WorkflowProjectList({ compact = false }: { compact?: boolean }) {
  const language = useWorkspaceStore(state => state.language);
  const copy = language === 'en'
    ? {
      import: 'Import workflow', exportAll: 'Export all workflows', create: 'New workflow', closeNotice: 'Dismiss notice',
      empty: 'No workflows yet. Create one to get started.', importFailed: 'Import failed', exportFailed: 'Export failed',
      imported: (count: number) => `Imported ${count} workflow${count === 1 ? '' : 's'}`,
      rename: (title: string) => `Rename ${title}`, delete: (title: string) => `Delete ${title}`,
      deleteTitle: (title: string) => `Delete “${title}”?`,
      deleteDescription: 'Nodes, connections, and local media will be removed. This action cannot be undone.',
      cancel: 'Cancel', confirmDelete: 'Delete',
    }
    : {
      import: '导入工作流', exportAll: '导出全部工作流', create: '新建工作流', closeNotice: '关闭提示',
      empty: '还没有工作流，创建一个开始。', importFailed: '导入失败', exportFailed: '导出失败',
      imported: (count: number) => `已导入 ${count} 个工作流`,
      rename: (title: string) => `重命名 ${title}`, delete: (title: string) => `删除 ${title}`,
      deleteTitle: (title: string) => `删除“${title}”？`,
      deleteDescription: '节点、连线和本地媒体会一起移除，此操作不能撤销。',
      cancel: '取消', confirmDelete: '删除',
    };
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
  const deleteTriggerRef = useRef<HTMLElement | null>(null);
  const deleteCancelRef = useRef<HTMLButtonElement>(null);
  const deleteDialogRef = useRef<HTMLDivElement>(null);
  const deletingProject = projects.find(project => project.id === deleteId);

  useEffect(() => {
    if (!deletingProject) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => deleteCancelRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setDeleteId(null);
        return;
      }
      if (event.key !== 'Tab') return;
      const items = Array.from(deleteDialogRef.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') || []);
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || !deleteDialogRef.current?.contains(document.activeElement))) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !deleteDialogRef.current?.contains(document.activeElement))) {
        event.preventDefault(); first?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKeyDown);
      const target = deleteTriggerRef.current?.isConnected ? deleteTriggerRef.current : previousFocus;
      if (target?.isConnected) target.focus();
    };
  }, [deletingProject?.id]);

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
          <button type="button" aria-label={copy.import} title={copy.import} onClick={() => importInput.current?.click()}><Upload size={15} /></button>
          <button type="button" aria-label={copy.exportAll} title={copy.exportAll} disabled={!projects.length} onClick={() => { void downloadWorkflowProjects(projects).catch(error => setNotice(displayError(error, copy.exportFailed))); }}><Download size={15} /></button>
          <button type="button" aria-label={copy.create} title={copy.create} onClick={() => createProject()}><Plus size={16} /></button>
          <input ref={importInput} hidden type="file" accept=".json,.workflow.json,application/json" onChange={event => {
            const file = event.target.files?.[0];
            event.currentTarget.value = '';
            if (!file) return;
            void parseWorkflowProjectFile(file).then(imported => {
              importProjects(imported);
              setNotice(copy.imported(imported.length));
            }).catch(error => setNotice(displayError(error, copy.importFailed)));
          }} />
        </div>
      </div>
      {notice && <div className="workflow-projects__notice" role="status"><span>{notice}</span><button type="button" aria-label={copy.closeNotice} onClick={() => setNotice(null)}>×</button></div>}
      <div className="workflow-projects__list">
        {projects.length === 0 && <p>{copy.empty}</p>}
        {projects.map(project => (
          <div key={project.id} className={project.id === activeProjectId ? 'workflow-project is-active' : 'workflow-project'}>
            {editingId === project.id ? (
              <input value={draft} autoFocus onChange={event => setDraft(event.target.value)} onBlur={finishRename} onKeyDown={event => { if (event.key === 'Enter') finishRename(); }} />
            ) : (
              <button type="button" className="workflow-project__open" onClick={() => setActiveProject(project.id)}>{project.title}</button>
            )}
            {!compact && <button type="button" aria-label={copy.rename(project.title)} onClick={() => beginRename(project.id, project.title)}><Pencil size={13} /></button>}
            {!compact && <button type="button" aria-label={copy.delete(project.title)} onClick={event => { deleteTriggerRef.current = event.currentTarget; setDeleteId(project.id); }}><Trash2 size={13} /></button>}
          </div>
        ))}
      </div>
      {deletingProject && <div ref={deleteDialogRef} className="workflow-projects__confirm" role="alertdialog" aria-modal="true" aria-labelledby="workflow-delete-dialog-title" aria-describedby="workflow-delete-dialog-description" tabIndex={-1}>
        <strong id="workflow-delete-dialog-title">{copy.deleteTitle(deletingProject.title)}</strong>
        <p id="workflow-delete-dialog-description">{copy.deleteDescription}</p>
        <div><button ref={deleteCancelRef} type="button" onClick={() => setDeleteId(null)}>{copy.cancel}</button><button type="button" className="is-danger" onClick={() => { deleteProjects([deletingProject.id]); setDeleteId(null); }}>{copy.confirmDelete}</button></div>
      </div>}
    </aside>
  );
}
