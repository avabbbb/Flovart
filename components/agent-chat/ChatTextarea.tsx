import React, { useRef, useState, useEffect } from 'react';
import type { UserApiKey, ModelPreference, AICapability } from '../../types';

interface ChatTextareaProps {
  compactMode: boolean;
  userApiKeys: UserApiKey[];
  modelPreference: ModelPreference;
  disabled?: boolean;
  isRunning?: boolean;
  onSend: (text: string, attachments: Array<{ url: string; mimeType: string }>, textModel: string) => void;
  onStop?: () => void;
  /** Phase 1.3: 从画布 pop-bar "加入对话" 注入的附件，useEffect 合并后清空 */
  pendingAttachments?: Array<{ url: string; mimeType: string }>;
  onConsumeAttachments?: () => void;
}

const TEXT_CAPABILITY: AICapability = 'text';

const ChatTextarea: React.FC<ChatTextareaProps> = ({
  compactMode, userApiKeys, modelPreference, disabled, isRunning, onSend, onStop,
  pendingAttachments, onConsumeAttachments,
}) => {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<Array<{ url: string; mimeType: string }>>([]);
  const [selectedModel, setSelectedModel] = useState(modelPreference.textModel || '');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!selectedModel && modelPreference.textModel) setSelectedModel(modelPreference.textModel);
  }, [modelPreference.textModel]);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
  }, [text]);

  useEffect(() => {
    if (pendingAttachments && pendingAttachments.length > 0) {
      setAttachments(prev => [...prev, ...pendingAttachments]);
      onConsumeAttachments?.();
    }
  }, [pendingAttachments, onConsumeAttachments]);

  const textKeys = userApiKeys.filter(k => k.capabilities?.includes(TEXT_CAPABILITY) || k.capabilities?.includes('agent'));
  const availableModels = textKeys.length > 0
    ? textKeys.flatMap(k => (k.models?.length ? k.models : (k.customModels || []).map(id => ({ id, name: id }))))
    : [];
  const modelOptions = availableModels.length > 0
    ? availableModels
    : [{ id: modelPreference.textModel, name: modelPreference.textModel }].filter(m => m.id);

  const handleAddFiles = (files: FileList | File[]) => {
    const arr = Array.from(files);
    arr.forEach(file => {
      const reader = new FileReader();
      reader.onload = () => {
        const url = reader.result as string;
        setAttachments(prev => [...prev, { url, mimeType: file.type || 'image/png' }]);
      };
      reader.readAsDataURL(file);
    });
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageItems: DataTransferItem[] = [];
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) imageItems.push(item);
    }
    if (imageItems.length > 0) {
      e.preventDefault();
      imageItems.forEach(item => {
        const file = item.getAsFile();
        if (file) handleAddFiles([file]);
      });
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer?.files?.length) handleAddFiles(e.dataTransfer.files);
  };

  const removeAttachment = (idx: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== idx));
  };

  const canSend = text.trim().length > 0 && !isRunning && !disabled;

  const handleSend = () => {
    if (!canSend) return;
    onSend(text.trim(), attachments, selectedModel || modelPreference.textModel);
    setText('');
    setAttachments([]);
  };

  return (
    <div className="px-3.5 py-3" style={{ borderTop: '1.5px solid var(--isl-border)' }}>
      {attachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {attachments.map((att, i) => (
            <div key={i} className="relative">
              {att.mimeType.startsWith('image/') ? (
                <img src={att.url} alt="" className="h-12 w-12 rounded-lg object-cover" style={{ border: '1.5px solid var(--isl-border)' }} />
              ) : (
                <div className="flex h-12 w-12 items-center justify-center rounded-lg text-[10px]" style={{ background: 'var(--isl-surface-2)' }}>📎</div>
              )}
              <button
                type="button"
                onClick={() => removeAttachment(i)}
                className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold"
                style={{ background: 'var(--isl-coral)', color: '#fff' }}
              >×</button>
            </div>
          ))}
        </div>
      )}

      {modelOptions.length > 1 && (
        <div className="mb-2 flex items-center gap-1.5">
          <select
            value={selectedModel}
            onChange={e => setSelectedModel(e.target.value)}
            disabled={isRunning}
            className="flex-1 rounded-lg border-none px-2 py-1 text-[11px] outline-none"
            style={{ background: 'var(--isl-surface-2)', color: 'var(--isl-ink)' }}
          >
            {modelOptions.map(m => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </div>
      )}

      <div className="isl-well flex items-end gap-2 px-2 py-2">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*"
          multiple
          className="hidden"
          onChange={e => e.target.files && handleAddFiles(e.target.files)}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isRunning}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[14px] transition-colors disabled:opacity-40"
          style={{ color: 'var(--isl-ink-soft)' }}
          title="添加附件"
        >📎</button>
        <textarea
          ref={textareaRef}
          rows={1}
          className="min-h-8 max-h-32 min-w-0 flex-1 resize-none border-0 bg-transparent px-1 py-1.5 text-[13px] leading-relaxed outline-none"
          style={{ color: 'var(--isl-ink)' }}
          placeholder="告诉画布助手你想做什么…Enter 发送，Shift+Enter 换行"
          value={text}
          disabled={disabled}
          onPaste={handlePaste}
          onDrop={handleDrop}
          onDragOver={e => e.preventDefault()}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
        />
        {isRunning ? (
          <button type="button" onClick={onStop} className="isl-chip h-8 px-3 text-[12px]" style={{ background: 'var(--isl-coral-bg)', color: 'var(--isl-coral-deep)' }}>
            停止
          </button>
        ) : (
          <button type="button" onClick={handleSend} disabled={!canSend} className="isl-go h-8 px-3.5 text-[12px]">
            发送
          </button>
        )}
      </div>
      {compactMode && textKeys.length === 0 && (
        <div className="mt-1.5 text-[10px]" style={{ color: 'var(--isl-coral-deep)' }}>
          未配置文本模型 API Key，请在设置中添加。
        </div>
      )}
    </div>
  );
};

export default ChatTextarea;
