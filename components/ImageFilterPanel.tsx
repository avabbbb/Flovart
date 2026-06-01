import React, { useCallback, useState } from 'react';
import type { ImageFilters } from '../types';
import { DEFAULT_IMAGE_FILTERS } from '../types';

interface FilterSliderDef {
  key: keyof ImageFilters;
  label: string;
  icon: string;
  min: number;
  max: number;
  step: number;
  unit: string;
}

const FILTER_SLIDERS: FilterSliderDef[] = [
  { key: 'brightness',  label: '亮度',   icon: '☀️', min: 0,    max: 200, step: 1, unit: '%' },
  { key: 'contrast',    label: '对比度', icon: '◐',  min: 0,    max: 200, step: 1, unit: '%' },
  { key: 'saturate',    label: '饱和度', icon: '🎨', min: 0,    max: 200, step: 1, unit: '%' },
  { key: 'temperature', label: '色温',   icon: '🌡️', min: -100, max: 100, step: 1, unit: '' },
  { key: 'hueRotate',   label: '色相',   icon: '🔄', min: 0,    max: 360, step: 1, unit: '°' },
  { key: 'sharpen',     label: '锐化',   icon: '🔍', min: 0,    max: 100, step: 1, unit: '%' },
  { key: 'blur',        label: '模糊',   icon: '💧', min: 0,    max: 20,  step: 0.5, unit: 'px' },
  { key: 'grayscale',   label: '灰度',   icon: '⬛', min: 0,    max: 100, step: 1, unit: '%' },
  { key: 'sepia',       label: '复古',   icon: '📜', min: 0,    max: 100, step: 1, unit: '%' },
  { key: 'opacity',     label: '透明度', icon: '👁️', min: 0,    max: 100, step: 1, unit: '%' },
];

interface ImageFilterPanelProps {
  filters: Partial<ImageFilters>;
  onChange: (filters: Partial<ImageFilters>) => void;
  onClose: () => void;
  onReset: () => void;
}

export const ImageFilterPanel: React.FC<ImageFilterPanelProps> = ({
  filters,
  onChange,
  onClose,
  onReset,
}) => {
  const [expandedGroup, setExpandedGroup] = useState<'basic' | 'color' | 'effect'>('basic');

  const getValue = useCallback(
    (key: keyof ImageFilters) => filters[key] ?? DEFAULT_IMAGE_FILTERS[key],
    [filters]
  );

  const handleChange = useCallback(
    (key: keyof ImageFilters, value: number) => {
      const defaultVal = DEFAULT_IMAGE_FILTERS[key];
      const next = { ...filters };
      if (value === defaultVal) {
        delete next[key];
      } else {
        next[key] = value;
      }
      onChange(next);
    },
    [filters, onChange]
  );

  const isModified = Object.keys(filters).length > 0;

  const groups: { id: 'basic' | 'color' | 'effect'; label: string; keys: (keyof ImageFilters)[] }[] = [
    { id: 'basic',  label: '基础调整', keys: ['brightness', 'contrast', 'sharpen', 'blur'] },
    { id: 'color',  label: '色彩',     keys: ['saturate', 'temperature', 'hueRotate'] },
    { id: 'effect', label: '效果',     keys: ['grayscale', 'sepia', 'opacity'] },
  ];

  return (
    <div
      className="image-filter-panel"
      style={{
        width: 260,
        background: 'var(--isl-card)',
        borderRadius: 'var(--isl-r)',
        boxShadow: '0 0.375rem 1.25rem rgba(0,0,0,0.14)',
        border: '1.5px solid var(--isl-border)',
        overflow: 'hidden',
        userSelect: 'none',
      }}
      onMouseDown={e => e.stopPropagation()}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px',
          borderBottom: '1px solid var(--isl-border)',
        }}
      >
        <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--isl-ink)' }}>🎨 图片调色</span>
        <div style={{ display: 'flex', gap: 6 }}>
          {isModified && (
            <button
              onClick={onReset}
              title="重置所有调整"
              style={{
                background: 'none',
                border: '1.5px solid var(--isl-border-strong)',
                borderRadius: 'var(--isl-r-sm)',
                padding: '2px 8px',
                fontSize: 11,
                cursor: 'pointer',
                color: 'var(--isl-coral-deep)',
                fontWeight: 700,
              }}
            >
              重置
            </button>
          )}
          <button
            onClick={onClose}
            className="isl-icon-btn h-6 w-6"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Groups */}
      <div style={{ maxHeight: 380, overflowY: 'auto', padding: '4px 0' }}>
        {groups.map(group => {
          const sliders = FILTER_SLIDERS.filter(s => group.keys.includes(s.key));
          const isExpanded = expandedGroup === group.id;
          const groupModified = sliders.some(s => filters[s.key] !== undefined);

          return (
            <div key={group.id}>
              <button
                onClick={() => setExpandedGroup(isExpanded ? group.id : group.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  width: '100%',
                  padding: '8px 14px',
                  background: isExpanded ? 'var(--isl-surface-2)' : 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 700,
                  color: 'var(--isl-ink)',
                }}
                onMouseDown={() => setExpandedGroup(group.id)}
              >
                <span>
                  {group.label}
                  {groupModified && <span style={{ color: 'var(--isl-mint-deep)', marginLeft: 4 }}>●</span>}
                </span>
                <span style={{ transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>▾</span>
              </button>

              {isExpanded && (
                <div style={{ padding: '4px 14px 8px' }}>
                  {sliders.map(slider => {
                    const val = getValue(slider.key);
                    const def = DEFAULT_IMAGE_FILTERS[slider.key];
                    const modified = val !== def;
                    const pct = ((val - slider.min) / (slider.max - slider.min)) * 100;

                    return (
                      <div key={slider.key} style={{ marginBottom: 8 }}>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            marginBottom: 3,
                          }}
                        >
                          <span style={{ fontSize: 11, fontWeight: 600, color: modified ? 'var(--isl-mint-deep)' : 'var(--isl-ink-soft)' }}>
                            {slider.icon} {slider.label}
                          </span>
                          <span style={{ fontSize: 11, fontFamily: 'monospace', minWidth: 40, textAlign: 'right' }}>
                            {slider.key === 'temperature' && val > 0 ? '+' : ''}{val}{slider.unit}
                          </span>
                        </div>
                        <div style={{ position: 'relative', height: 18, display: 'flex', alignItems: 'center' }}>
                          <input
                            type="range"
                            min={slider.min}
                            max={slider.max}
                            step={slider.step}
                            value={val}
                            onChange={e => handleChange(slider.key, parseFloat(e.target.value))}
                            onDoubleClick={() => handleChange(slider.key, def)}
                            title="双击重置"
                            style={{
                              width: '100%',
                              height: 4,
                              appearance: 'none',
                              background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${pct}%, #d1d5db ${pct}%, #d1d5db 100%)`,
                              borderRadius: 2,
                              outline: 'none',
                              cursor: 'pointer',
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

/** 将 ImageFilters 对象转为 CSS filter 字符串 + SVG filter id */
export function buildCssFilter(filters: Partial<ImageFilters> | undefined): string {
  if (!filters || Object.keys(filters).length === 0) return '';
  const f = { ...DEFAULT_IMAGE_FILTERS, ...filters };
  const parts: string[] = [];
  if (f.brightness !== 100) parts.push(`brightness(${f.brightness / 100})`);
  if (f.contrast !== 100)   parts.push(`contrast(${f.contrast / 100})`);
  if (f.saturate !== 100)   parts.push(`saturate(${f.saturate / 100})`);
  if (f.hueRotate !== 0)    parts.push(`hue-rotate(${f.hueRotate}deg)`);
  if (f.blur > 0)           parts.push(`blur(${f.blur}px)`);
  if (f.opacity !== 100)    parts.push(`opacity(${f.opacity / 100})`);
  if (f.grayscale > 0)      parts.push(`grayscale(${f.grayscale / 100})`);
  if (f.sepia > 0)          parts.push(`sepia(${f.sepia / 100})`);
  return parts.join(' ');
}

/** 生成色温对应的 SVG feColorMatrix values（用在 <defs> 中） */
export function temperatureMatrix(temp: number): string {
  // temp: -100 (cold/blue) to +100 (warm/orange)
  const t = temp / 100;
  const r = 1 + t * 0.3;
  const b = 1 - t * 0.3;
  return `${r} 0 0 0 0  0 1 0 0 0  0 0 ${b} 0 0  0 0 0 1 0`;
}

/** 生成锐化对应的 SVG feConvolveMatrix */
export function sharpenKernel(amount: number): string {
  // amount: 0–100
  const a = amount / 100;
  const center = 1 + 4 * a;
  const edge = -a;
  return `0 ${edge} 0  ${edge} ${center} ${edge}  0 ${edge} 0`;
}
