import React from 'react';
import { OfflineNotice } from './OfflineNotice';
import '../styles/chrome.css';

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
}) => {
  // 画布视图下顶栏浮在画布上（styles/chrome.css），两侧面板按 --topbar-h 让位，所以量出顶栏实际高度（窄屏会折成两行）。
  const rootRef = React.useRef<HTMLDivElement>(null);
  const topbarRef = React.useRef<HTMLDivElement>(null);
  React.useLayoutEffect(() => {
    const bar = topbarRef.current;
    const root = rootRef.current;
    if (!bar || !root || typeof ResizeObserver === 'undefined') return;
    const sync = () => root.style.setProperty('--topbar-h', `${Math.round(bar.getBoundingClientRect().height)}px`);
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);
  return (
  <div
    ref={rootRef}
    className="app-shell theme-aware relative flex w-full min-h-0 flex-col overflow-hidden font-sans"
    style={{ backgroundColor: themeBackground }}
    onDragOver={onDragOver}
    onDrop={onDrop}
  >
    <div ref={topbarRef} className="app-shell__topbar">{topBar}</div>
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
};
