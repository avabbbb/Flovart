import { Image as ImageIcon, Video as VideoIcon, Music as AudioIcon, X } from 'lucide-react';
import { useMemo } from 'react';
import type { SeedanceReferences, WorkflowNode } from './types';

export interface SeedanceSlotPickerProps {
  nodes: WorkflowNode[];
  value: SeedanceReferences;
  onChange: (refs: SeedanceReferences) => void;
}

type SlotKind = 'image' | 'video' | 'audio';

interface SlotConfig {
  kind: SlotKind;
  max: number;
  label: string;
  acceptTypes: WorkflowNode['type'][];
  icon: typeof ImageIcon;
}

const SLOT_CONFIGS: SlotConfig[] = [
  { kind: 'image', max: 9, label: '参考图', acceptTypes: ['image'], icon: ImageIcon },
  { kind: 'video', max: 3, label: '参考视频', acceptTypes: ['video'], icon: VideoIcon },
  { kind: 'audio', max: 3, label: '参考音频', acceptTypes: ['audio'], icon: AudioIcon },
];

function nodeMatchesSlot(node: WorkflowNode, slot: SlotConfig): boolean {
  return slot.acceptTypes.includes(node.type) && Boolean(node.metadata.href || node.metadata.storageKey);
}

function getRefsArray(value: SeedanceReferences, kind: SlotKind): string[] {
  if (kind === 'image') return value.imageRefs;
  if (kind === 'video') return value.videoRefs;
  return value.audioRefs;
}

function setRefsArray(value: SeedanceReferences, kind: SlotKind, arr: string[]): SeedanceReferences {
  if (kind === 'image') return { ...value, imageRefs: arr };
  if (kind === 'video') return { ...value, videoRefs: arr };
  return { ...value, audioRefs: arr };
}

export function SeedanceSlotPicker({ nodes, value, onChange }: SeedanceSlotPickerProps) {
  const nodeById = useMemo(() => {
    const map = new Map<string, WorkflowNode>();
    for (const node of nodes) map.set(node.id, node);
    return map;
  }, [nodes]);

  const handleSlotChange = (kind: SlotKind, index: number, nodeId: string) => {
    const arr = [...getRefsArray(value, kind)];
    if (nodeId) arr[index] = nodeId;
    else arr.splice(index, 1);
    onChange(setRefsArray(value, kind, arr.filter(Boolean)));
  };

  const handleClearSlot = (kind: SlotKind, index: number) => {
    const arr = [...getRefsArray(value, kind)];
    arr.splice(index, 1);
    onChange(setRefsArray(value, kind, arr.filter(Boolean)));
  };

  return (
    <div className="workflow-seedance-picker" data-workflow-overlay onPointerDown={event => event.stopPropagation()}>
      <div className="workflow-seedance-picker__header">
        <span>12 槽位参考输入</span>
        <span className="workflow-seedance-picker__count">
          {value.imageRefs.length + value.videoRefs.length + value.audioRefs.length}/12
        </span>
      </div>
      {SLOT_CONFIGS.map(slot => {
        const refs = getRefsArray(value, slot.kind);
        const candidates = nodes.filter(node => nodeMatchesSlot(node, slot));
        const Icon = slot.icon;
        return (
          <div key={slot.kind} className="workflow-seedance-picker__group">
            <div className="workflow-seedance-picker__group-label">
              <Icon size={11} />
              <span>{slot.label}</span>
              <span className="workflow-seedance-picker__group-count">{refs.length}/{slot.max}</span>
            </div>
            <div className="workflow-seedance-picker__slots">
              {Array.from({ length: slot.max }, (_, index) => {
                const nodeId = refs[index];
                const node = nodeId ? nodeById.get(nodeId) : undefined;
                const filled = Boolean(node);
                return (
                  <div key={index} className={`workflow-seedance-picker__slot ${filled ? 'is-filled' : ''}`}>
                    {filled && node ? (
                      <>
                        {slot.kind === 'image' && node.metadata.href ? (
                          <img src={node.metadata.href} alt={node.title} className="workflow-seedance-picker__thumb" />
                        ) : (
                          <span className="workflow-seedance-picker__name" title={node.title}>{node.title}</span>
                        )}
                        <button
                          type="button"
                          className="workflow-seedance-picker__clear"
                          aria-label="清空"
                          onClick={() => handleClearSlot(slot.kind, index)}
                        >
                          <X size={10} />
                        </button>
                      </>
                    ) : (
                      <select
                        aria-label={`${slot.label} ${index + 1}`}
                        value=""
                        onChange={event => handleSlotChange(slot.kind, index, event.target.value)}
                      >
                        <option value="">+ 槽位 {index + 1}</option>
                        {candidates
                          .filter(candidate => !Object.values(value).flat().includes(candidate.id))
                          .map(candidate => (
                            <option key={candidate.id} value={candidate.id}>{candidate.title}</option>
                          ))}
                      </select>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      {value.audioRefs.length > 0 && value.imageRefs.length === 0 && value.videoRefs.length === 0 && (
        <p className="workflow-seedance-picker__warn">参考音频不能单独使用，请至少添加一张参考图或参考视频。</p>
      )}
    </div>
  );
}
