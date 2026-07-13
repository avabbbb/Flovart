import { useMemo, useState } from 'react';
import { Modal, Input, Select, Button, message } from 'antd';
import { Plus, Trash2, Upload } from 'lucide-react';
import { useWorkflowStore } from '../workflow/store';
import type { WorkflowProject } from '../workflow/types';
import { useAuth } from '../../hooks/useAuth';
import { publishCommunityWorkflow } from './communityStore';
import { COMMUNITY_CATEGORIES, type CommunityCategory } from '../landing/communityTypes';

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

const CATEGORY_OPTIONS = COMMUNITY_CATEGORIES.filter(cat => cat !== '全部').map(cat => ({ label: cat, value: cat }));

const GRADIENT_PRESETS = [
  { label: '青绿', value: 'linear-gradient(135deg, #1a1a2e 0%, #19c8b9 100%)' },
  { label: '粉紫', value: 'linear-gradient(135deg, #ff6a88 0%, #6a82fb 100%)' },
  { label: '深紫', value: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)' },
  { label: '暖橙', value: 'linear-gradient(135deg, #f5af19 0%, #f12711 100%)' },
  { label: '水墨', value: 'linear-gradient(135deg, #485563 0%, #29323c 100%)' },
  { label: '浅灰', value: 'linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%)' },
];

export function WorkflowUploadModal({ open, onClose, onSuccess }: Props) {
  const projects = useWorkflowStore(state => state.projects);
  const { user } = useAuth();

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<Exclude<CommunityCategory, '全部'>>('TV Show');
  const [gradient, setGradient] = useState(GRADIENT_PRESETS[0].value);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [loading, setLoading] = useState(false);

  const selectedProject: WorkflowProject | null = useMemo(
    () => projects.find(p => p.id === selectedProjectId) || null,
    [projects, selectedProjectId],
  );

  const handleAddTag = () => {
    const t = tagInput.trim();
    if (t && !tags.includes(t) && tags.length < 8) {
      setTags([...tags, t]);
      setTagInput('');
    }
  };

  const handleReset = () => {
    setSelectedProjectId(null);
    setTitle('');
    setDescription('');
    setCategory('TV Show');
    setGradient(GRADIENT_PRESETS[0].value);
    setTags([]);
    setTagInput('');
  };

  const handleSubmit = async () => {
    if (!selectedProject) {
      message.warning('请先选择一个本地工作流');
      return;
    }
    if (!title.trim()) {
      message.warning('请填写作品标题');
      return;
    }
    if (tags.length === 0) {
      message.warning('至少加一个标签，方便他人发现');
      return;
    }
    setLoading(true);
    try {
      const cleanProject: WorkflowProject = {
        ...selectedProject,
        title: title.trim(),
        agentSessions: [],
        activeAgentSessionId: null,
        selectedNodeIds: [],
      };
      await publishCommunityWorkflow({
        title: title.trim(),
        description: description.trim() || undefined,
        category,
        tags,
        gradient,
        workflowJson: cleanProject,
        author: { name: user?.username || '匿名创作者' },
      });
      message.success('发布成功，社区作品已上架');
      handleReset();
      onSuccess?.();
      onClose();
    } catch (e: any) {
      message.error(e?.message || '发布失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onCancel={() => { handleReset(); onClose(); }}
      title={
        <div className="flex items-center gap-2">
          <Upload size={16} />
          <span>发布工作流到社区</span>
        </div>
      }
      width={580}
      footer={null}
      centered
    >
      <div className="flex flex-col gap-4 py-2">
        <div>
          <div className="text-sm font-medium mb-2" style={{ color: '#a8a49c' }}>选择本地工作流</div>
          <Select
            placeholder="从已创建的本地工作流中选择一个"
            value={selectedProjectId ?? undefined}
            onChange={v => {
              setSelectedProjectId(v);
              const p = projects.find(p => p.id === v);
              if (p && !title.trim()) setTitle(p.title);
            }}
            options={projects.map(p => ({ label: `${p.title}（${p.nodes.length} 节点）`, value: p.id }))}
            style={{ width: '100%' }}
            notFoundContent={<span style={{ color: '#6b6862' }}>还没有本地工作流，请先创建一个</span>}
          />
        </div>

        <div className="flex gap-3">
          <Input
            placeholder="作品标题"
            value={title}
            onChange={e => setTitle(e.target.value)}
            className="flex-1"
          />
        </div>

        <Input.TextArea
          placeholder="作品简介（可选，说说创作思路和亮点）"
          value={description}
          onChange={e => setDescription(e.target.value)}
          rows={3}
        />

        <div className="flex items-center gap-3">
          <Select
            value={category}
            onChange={v => setCategory(v)}
            options={CATEGORY_OPTIONS}
            className="w-36"
          />
          <Select
            value={gradient}
            onChange={v => setGradient(v)}
            options={GRADIENT_PRESETS}
            className="flex-1"
          />
        </div>

        <div className="flex items-center gap-2">
          <Input
            placeholder="标签（回车添加，最多8个）"
            value={tagInput}
            onChange={e => setTagInput(e.target.value)}
            onPressEnter={handleAddTag}
            className="flex-1"
          />
          <Button onClick={handleAddTag}><Plus size={14} /></Button>
        </div>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {tags.map(t => (
              <span
                key={t}
                className="cursor-pointer rounded-md px-2 py-0.5 text-xs inline-flex items-center gap-1"
                style={{ background: 'rgba(25,200,185,0.14)', color: '#19c8b9' }}
                onClick={() => setTags(tags.filter(x => x !== t))}
              >
                #{t} <Trash2 size={10} />
              </span>
            ))}
          </div>
        )}

        <div className="text-xs px-3 py-2 rounded-md" style={{ background: 'rgba(255,255,255,0.04)', color: '#6b6862', lineHeight: 1.6 }}>
          发布后，其他用户可一键做同款克隆整条工作流到他们的项目列表；
          非公开的 API Key、模型配置不会随工作流导出，导入者需自备 Key 与模型。
        </div>

        <Button type="primary" block loading={loading} onClick={handleSubmit}>
          发布到社区
        </Button>
      </div>
    </Modal>
  );
}