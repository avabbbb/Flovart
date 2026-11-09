import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StudioRightDrawer } from "../components/studio/StudioRightDrawer";
import { DrawerChromeCollapse, DrawerChromeTabs } from "../components/studio/drawerChrome";

const TABS = [
  { id: "agent", label: "对话", icon: undefined },
  { id: "history", label: "历史", icon: undefined },
];

function renderDrawer(activeTab: string, onTabChange = vi.fn(), onOpenChange = vi.fn()) {
  render(
    <StudioRightDrawer
      open
      onOpenChange={onOpenChange}
      outerGap={0}
      width={360}
      minWidth={280}
      maxWidth={640}
      onWidthChange={vi.fn()}
      flush
      activeTab={activeTab}
      onTabChange={onTabChange}
      inlineChromeTabs={["agent"]}
      tabs={TABS}
    >
      <header data-testid="child-header">
        <DrawerChromeTabs />
        <DrawerChromeCollapse />
      </header>
    </StudioRightDrawer>,
  );
  return { onTabChange, onOpenChange };
}

describe("StudioRightDrawer inline chrome", () => {
  it("hands tabs and collapse to the child header so the header is one row", () => {
    const { onTabChange, onOpenChange } = renderDrawer("agent");
    const header = screen.getByTestId("child-header");
    const collapse = screen.getAllByTitle("收起右侧面板");
    expect(collapse).toHaveLength(1);
    expect(header).toContainElement(collapse[0]);
    expect(document.querySelector(".compact-right-panel__quicktabs")).toBeNull();
    expect(screen.getByRole("tab", { name: "对话" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("tab", { name: "历史" }));
    expect(onTabChange).toHaveBeenCalledWith("history");
    fireEvent.click(collapse[0]);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("keeps its own tab row for tabs that are not inline", () => {
    renderDrawer("history");
    const header = screen.getByTestId("child-header");
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    const collapse = screen.getAllByTitle("收起右侧面板");
    expect(collapse).toHaveLength(1);
    expect(header).not.toContainElement(collapse[0]);
  });
});
