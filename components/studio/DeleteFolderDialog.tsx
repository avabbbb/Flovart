import { Modal, Button } from 'antd';
import { AlertTriangle, FolderInput, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { AssetFolder } from '../../types';

export type DeleteFolderMode = 'move' | 'delete-all';

export interface DeleteFolderDialogProps {
  open: boolean;
  folder: AssetFolder | null;
  itemCount: number;
  subfolderCount: number;
  onCancel: () => void;
  onConfirm: (mode: DeleteFolderMode) => void;
}

export function DeleteFolderDialog({ open, folder, itemCount, subfolderCount, onCancel, onConfirm }: DeleteFolderDialogProps) {
  const [mode, setMode] = useState<DeleteFolderMode>('move');
  if (!folder) return null;
  const displayName = folder.name || '未命名文件夹';
  const hasContent = itemCount > 0 || subfolderCount > 0;

  return (
    <Modal
      open={open}
      onCancel={onCancel}
      footer={null}
      centered
      width={460}
      destroyOnHidden
      maskClosable
    >
      <div className="flex flex-col gap-4 py-2">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 shrink-0 rounded-lg p-2" style={{ background: 'var(--isl-surface-2)' }}>
            <AlertTriangle size={18} style={{ color: 'var(--isl-amber)' }} />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-bold" style={{ color: 'var(--isl-ink)' }}>删除文件夹</h3>
            <p className="mt-1 text-xs" style={{ color: 'var(--isl-ink-soft)' }}>
              确认删除文件夹「{displayName}」{hasContent ? `（含 ${itemCount} 个素材${subfolderCount > 0 ? `、${subfolderCount} 个子文件夹` : ''}）` : ''}？请选择处理方式：
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setMode('move')}
            className="flex items-start gap-3 rounded-xl border-[1.5px] p-3 text-left transition-all"
            style={{
              borderColor: mode === 'move' ? 'var(--isl-mint)' : 'var(--isl-border)',
              background: mode === 'move' ? 'var(--isl-surface-2)' : 'transparent',
            }}
          >
            <FolderInput size={16} className="mt-0.5 shrink-0" style={{ color: 'var(--isl-mint-deep)' }} />
            <span className="min-w-0">
              <span className="block text-xs font-bold" style={{ color: 'var(--isl-ink)' }}>移动内容到未分类</span>
              <span className="mt-0.5 block text-[11px]" style={{ color: 'var(--isl-ink-soft)' }}>文件夹内的素材和子文件夹保留，仅解除归属关系</span>
            </span>
          </button>

          <button
            type="button"
            onClick={() => setMode('delete-all')}
            className="flex items-start gap-3 rounded-xl border-[1.5px] p-3 text-left transition-all"
            style={{
              borderColor: mode === 'delete-all' ? '#ef4444' : 'var(--isl-border)',
              background: mode === 'delete-all' ? 'rgba(239,68,68,0.08)' : 'transparent',
            }}
          >
            <Trash2 size={16} className="mt-0.5 shrink-0" style={{ color: '#ef4444' }} />
            <span className="min-w-0">
              <span className="block text-xs font-bold" style={{ color: mode === 'delete-all' ? '#ef4444' : 'var(--isl-ink)' }}>删除文件夹及所有内容</span>
              <span className="mt-0.5 block text-[11px]" style={{ color: 'var(--isl-ink-soft)' }}>永久删除文件夹内的全部素材和子文件夹，不可恢复</span>
            </span>
          </button>
        </div>

        {!hasContent && (
          <p className="text-[11px]" style={{ color: 'var(--isl-ink-ghost)' }}>此文件夹为空，直接删除即可。</p>
        )}

        <div className="flex items-center justify-end gap-2">
          <Button size="small" onClick={onCancel}>取消</Button>
          {hasContent ? (
            <Button
              size="small"
              danger={mode === 'delete-all'}
              type={mode === 'delete-all' ? 'primary' : 'default'}
              onClick={() => onConfirm(mode)}
            >
              {mode === 'delete-all' ? '永久删除' : '移动并删除文件夹'}
            </Button>
          ) : (
            <Button size="small" danger type="primary" onClick={() => onConfirm('move')}>删除</Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
