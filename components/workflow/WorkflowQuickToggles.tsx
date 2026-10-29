import { Grid2X2, Magnet, Map, Spline } from 'lucide-react';
import type React from 'react';

interface WorkflowQuickTogglesProps {
  language: string;
  minimapOpen: boolean;
  onToggleMinimap: () => void;
  snapEnabled: boolean;
  onToggleSnap: () => void;
  edgesVisible: boolean;
  onToggleEdges: () => void;
  gridOn: boolean;
  onToggleGrid: () => void;
}

// 画布左下角常驻开关：与工具条「画布控制」菜单共用同一份状态。
export function WorkflowQuickToggles(props: WorkflowQuickTogglesProps) {
  const en = props.language === 'en';
  const items: Array<{ id: string; label: string; on: boolean; icon: React.ReactNode; onClick: () => void }> = [
    { id: 'minimap', label: en ? 'Minimap' : '小地图', on: props.minimapOpen, icon: <Map size={15} />, onClick: props.onToggleMinimap },
    { id: 'snap', label: en ? 'Snap to grid' : '对齐磁吸', on: props.snapEnabled, icon: <Magnet size={15} />, onClick: props.onToggleSnap },
    { id: 'edges', label: en ? 'Connections' : '连线', on: props.edgesVisible, icon: <Spline size={15} />, onClick: props.onToggleEdges },
    { id: 'grid', label: en ? 'Grid' : '网格', on: props.gridOn, icon: <Grid2X2 size={15} />, onClick: props.onToggleGrid },
  ];
  return (
    <nav
      className='workflow-quick-toggles'
      aria-label={en ? 'Canvas toggles' : '画布开关'}
      data-workflow-overlay
      data-testid='workflow-quick-toggles'
      onPointerDown={event => event.stopPropagation()}
    >
      {items.map(item => (
        <button
          key={item.id}
          type='button'
          className={'workflow-quick-toggle' + (item.on ? ' is-active' : '')}
          aria-pressed={item.on}
          aria-label={item.label}
          title={item.label}
          data-testid={'workflow-quick-toggle-' + item.id}
          onClick={item.onClick}
        >
          {item.icon}
        </button>
      ))}
    </nav>
  );
}
