import { PanelRightClose } from "lucide-react";
import { createContext, useContext } from "react";
import type { StudioDrawerTab } from "./StudioRightDrawer";

// 右侧抽屉的标签与收起按钮。抽屉把它们交给子级顶栏渲染，整个头部只占一行；未提供时为 null，两个组件都不渲染。
export interface DrawerChrome {
  tabs: StudioDrawerTab[];
  activeTab: string;
  onTabChange: (id: string) => void;
  onCollapse: () => void;
}

export const DrawerChromeContext = createContext<DrawerChrome | null>(null);

export function DrawerChromeTabs() {
  const chrome = useContext(DrawerChromeContext);
  if (!chrome || chrome.tabs.length < 2) return null;
  return (
    <span className="isl-tabbar isl-tabbar--ac drawer-chrome-tabs" role="tablist">
      {chrome.tabs.map(tab => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={chrome.activeTab === tab.id}
          className={"isl-tab" + (chrome.activeTab === tab.id ? " isl-tab--active" : "")}
          onClick={() => chrome.onTabChange(tab.id)}
          title={tab.label}
        >
          {tab.label}
        </button>
      ))}
    </span>
  );
}

export function DrawerChromeCollapse() {
  const chrome = useContext(DrawerChromeContext);
  if (!chrome) return null;
  return (
    <button type="button" className="isl-icon-btn drawer-chrome-collapse" onClick={chrome.onCollapse} title="收起右侧面板" aria-label="收起右侧面板">
      <PanelRightClose size={15} />
    </button>
  );
}
