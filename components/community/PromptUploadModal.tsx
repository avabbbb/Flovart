import { useState } from 'react';
import { Modal, Input, Select, Button, message } from 'antd';
import { Plus, Trash2 } from 'lucide-react';
import { promptApi, PromptItem } from '../../services/promptApi';

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

const MODE_OPTIONS = [
  { label: '图片', value: 'image' },
  { label: '视频', value: 'video' },
  { label: '文本', value: 'text' },
];

export function PromptUploadModal({ open, onClose, onSuccess }: Props) {
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [mode, setMode] = useState<'image' | 'video' | 'text'>('image');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [items, setItems] = useState<PromptItem[]>([{ name: '', prompt: '', sort: 0 }]);
  const [loading, setLoading] = useState(false);

  const handleAddTag = () => {
    const t = tagInput.trim();
    if (t && !tags.includes(t) && tags.length < 5) {
      setTags([...tags, t]);
      setTagInput('');
    }
  };

  const handleAddItem = () => {
    setItems([...items, { name: '', prompt: '', sort: items.length }]);
  };

  const handleRemoveItem = (idx: number) => {
    setItems(items.filter((_, i) => i !== idx));
  };

  const handleItemChange = (idx: number, field: 'name' | 'prompt', value: string) => {
    setItems(items.map((it, i) => (i === idx ? { ...it, [field]: value } : it)));
  };

  const handleSubmit = async () => {
    if (!title.trim() || !slug.trim()) {
      message.warning('请填写标题和 Slug');
      return;
    }
    const validItems = items.filter((it) => it.name.trim() && it.prompt.trim());
    if (validItems.length === 0) {
      message.warning('至少填写一条提示词');
      return;
    }
    setLoading(true);
    try {
      await promptApi.create({
        slug: slug.trim(),
        title: title.trim(),
        description: description.trim(),
        mode,
        tags,
        items: validItems,
      });
      message.success('发布成功');
      handleReset();
      onSuccess?.();
      onClose();
    } catch (e: any) {
      message.error(e?.message || '发布失败');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setTitle('');
    setSlug('');
    setDescription('');
    setMode('image');
    setTags([]);
    setTagInput('');
    setItems([{ name: '', prompt: '', sort: 0 }]);
  };

  return (
    <Modal
      open={open}
      onCancel={() => { handleReset(); onClose(); }}
      title="分享提示词包"
      width={560}
      footer={null}
      centered
    >
      <div className="flex flex-col gap-4 py-2">
        <div className="flex gap-3">
          <Input
            placeholder="标题"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="flex-1"
          />
          <Input
            placeholder="slug (英文URL标识)"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            className="flex-1"
          />
        </div>
        <Select
          value={mode}
          onChange={(v) => setMode(v)}
          options={MODE_OPTIONS}
          className="w-32"
        />
        <Input.TextArea
          placeholder="描述（可选）"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
        />
        <div className="flex items-center gap-2">
          <Input
            placeholder="标签（回车添加，最多5个）"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onPressEnter={handleAddTag}
            className="flex-1"
          />
          <Button onClick={handleAddTag}>添加</Button>
        </div>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {tags.map((t) => (
              <span
                key={t}
                className="cursor-pointer rounded-md bg-blue-500/20 px-2 py-0.5 text-xs text-blue-300"
                onClick={() => setTags(tags.filter((x) => x !== t))}
              >
                {t} ×
              </span>
            ))}
          </div>
        )}

        <div className="space-y-3 border-t border-white/10 pt-3">
          <div className="text-sm font-medium">提示词条目</div>
          {items.map((item, idx) => (
            <div key={idx} className="rounded-lg border border-white/10 p-3">
              <div className="mb-2 flex items-center justify-between">
                <Input
                  placeholder="条目名称"
                  value={item.name}
                  onChange={(e) => handleItemChange(idx, 'name', e.target.value)}
                  className="flex-1"
                />
                {items.length > 1 && (
                  <button
                    className="ml-2 text-red-400 hover:text-red-300"
                    onClick={() => handleRemoveItem(idx)}
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
              <Input.TextArea
                placeholder="提示词内容"
                value={item.prompt}
                onChange={(e) => handleItemChange(idx, 'prompt', e.target.value)}
                rows={3}
              />
            </div>
          ))}
          <button
            className="inline-flex items-center gap-1 text-sm text-blue-400 hover:text-blue-300"
            onClick={handleAddItem}
          >
            <Plus size={14} /> 添加条目
          </button>
        </div>

        <Button type="primary" block loading={loading} onClick={handleSubmit}>
          发布提示词包
        </Button>
      </div>
    </Modal>
  );
}