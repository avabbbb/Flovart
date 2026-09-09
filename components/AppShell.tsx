import React from 'react';
import { OfflineNotice } from './OfflineNotice';

interface AppShellProps {
  topBar?: React.ReactNode;
  bottomDock?: React.ReactNode;
  leftSidebar?: React.ReactNode;
  main: React.ReactNode;
  rightSidebar?: React.ReactNode;
  themeBackground: string;
  overlays?: React.ReactNode;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
}

export const AppShell: React.FC<AppShellProps> = ({
  topBar,
  bottomDock,
  leftSidebar,
  main,
  rightSidebar,
  themeBackground,
  overlays,
  onDragOver,
  onDrop,
}) => (
  <div
    className="app-shell theme-aware relative flex w-full min-h-0 flex-col overflow-hidden font-sans"
    style={{ backgroundColor: themeBackground }}
    onDragOver={onDragOver}
    onDrop={onDrop}
  >
    <div className="app-shell__topbar">{topBar}</div>
    <div className="app-shell__workspace">
      <div className="app-shell__offline"><OfflineNotice /></div>
      <div
        className="app-shell__content"
        data-sidebar-layout={leftSidebar || rightSidebar ? 'with-sidebars' : 'main-only'}
      >
        {leftSidebar && <div className="app-shell__left-sidebar">{leftSidebar}</div>}
        <div className="app-shell__main">{main}</div>
        {rightSidebar && <div className="app-shell__right-sidebar">{rightSidebar}</div>}
      </div>
    </div>
    {bottomDock && <div className="pointer-events-none absolute inset-x-0 bottom-4 z-40 flex justify-center px-4">{bottomDock}</div>}
    {overlays}
  </div>
);
