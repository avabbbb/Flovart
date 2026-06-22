import React from 'react';

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
    className="theme-aware relative w-screen h-screen flex flex-col overflow-hidden font-sans"
    style={{ backgroundColor: themeBackground }}
    onDragOver={onDragOver}
    onDrop={onDrop}
  >
    <div className="shrink-0">{topBar}</div>
    <div className="min-h-0 flex flex-1 relative">
      {leftSidebar && <div className="shrink-0">{leftSidebar}</div>}
      <div className="min-w-0 min-h-0 flex-1 relative flex flex-col">{main}</div>
      {rightSidebar && <div className="shrink-0">{rightSidebar}</div>}
    </div>
    {bottomDock && <div className="pointer-events-none absolute inset-x-0 bottom-4 z-40 flex justify-center px-4">{bottomDock}</div>}
    {overlays}
  </div>
);
