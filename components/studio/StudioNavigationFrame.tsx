import React from 'react';
import type { CanvasView } from '../../types';
import './StudioNavigationFrame.css';

export interface StudioNavigationProject {
  id: string;
  title: string;
}

interface StudioNavigationFrameProps {
  language: 'en' | 'zho';
  canvasView: CanvasView;
  projects: StudioNavigationProject[];
  activeProjectId: string | null;
  children: React.ReactNode;
}

// The workflow switcher, the Canvas / Table / Agent tabs and Settings all live
// in StudioTopMenu. This frame only hosts the stage and the status footer, so
// every navigation action has exactly one entry point.
export const StudioNavigationFrame: React.FC<StudioNavigationFrameProps> = ({
  language,
  canvasView,
  projects,
  activeProjectId,
  children,
}) => {
  const isChinese = language === 'zho';
  const activeProject = projects.find(project => project.id === activeProjectId);
  const viewLabel = canvasView === 'spatial' ? (isChinese ? '画布' : 'Canvas') : canvasView === 'table' ? 'Table' : 'Agent';

  return (
    <div className='studio-navigation-frame'>
      <div className='studio-navigation-frame__body'>
        <div className='studio-navigation-frame__content'>
          <section className='studio-navigation-frame__stage'>
            {children}
          </section>
        </div>

        <footer className='studio-navigation-frame__status' aria-label={isChinese ? '工作区状态' : 'Workspace status'}>
          <span>{viewLabel}</span>
          <span className='studio-navigation-frame__status-separator' aria-hidden='true' />
          <span className='studio-navigation-frame__status-project'>{activeProject?.title || (isChinese ? '未选择工作流' : 'No workflow selected')}</span>
          <span className='studio-navigation-frame__status-fill' />
          <span>{isChinese ? '本地优先' : 'Local-first'}</span>
        </footer>
      </div>
    </div>
  );
};
