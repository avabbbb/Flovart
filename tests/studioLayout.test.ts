import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('studio layout contracts', () => {
  it('keeps status in the shared top menu', () => {
    const app = source('App.tsx');

    expect(app).not.toContain('compact-prompt-dock');
    expect(app).not.toContain('<DiagnosticBar');
    expect(app).not.toContain("openLegalModal('terms')");
  });

  it('uses one shared menu model instead of per-surface callback sets', () => {
    const app = source('App.tsx');

    expect(app.match(/<StudioTopMenu model={studioMenuModel} \/>/g)).toHaveLength(1);
    expect(app).not.toContain('onToggleTheme=');
    expect(app).not.toContain('onToggleLanguage=');
  });

  it('mounts the three surfaces and keeps the built-in assistant in the global drawer', () => {
    const app = source('App.tsx');

    expect(app).toContain('<WorkflowWorkspace');
    expect(app).toContain('<TableWorkspace');
    // Agent is a dedicated local-agent connection surface; the built-in
    // assistant remains in the right drawer beside Canvas/Table.
    expect(app).toContain('<AgentConnectionsPage');
    expect(app).toContain('<FlovartAgentPanel');
    expect(app).toContain('<AgentDrawerEmptyState');
    expect(app).toContain('<StudioRightDrawer');
    expect(app).not.toContain("activeView === 'workflow' ? (");
    expect(app).not.toContain('React Flow 故事板 + Agent SKILL 即将上线');
  });

  it('positions sliding drawers inside the workspace instead of the viewport', () => {
    for (const path of ['components/workflow/WorkflowSidebar.tsx', 'components/studio/StudioRightDrawer.tsx']) {
      const file = source(path);
      expect(file, path).not.toMatch(/theme-aware fixed/);
      expect(file, path).toMatch(/theme-aware/);
    }
    // The right drawer docks (reflows) on desktop instead of overlaying the
    // canvas — a selected node can never render underneath it.
    expect(source('components/studio/StudioRightDrawer.tsx')).toContain("docked ? 'relative' : 'absolute'");
  });

  it('uses the compact panel shell for the Workflow right drawer', () => {
    const workflowPanel = source('components/studio/StudioRightDrawer.tsx');

    expect(workflowPanel).toContain('isl-panel compact-right-panel');
    expect(workflowPanel).not.toContain("boxShadow: 'var(--isl-shadow-lg)'");
  });

  it('does not squeeze nested Agent picker and mode buttons into the legacy composer width', () => {
    const workflowStyles = source('styles/workflow.css');

    expect(workflowStyles).toContain('.workflow-agent__composer > button { width: 34px;');
    expect(workflowStyles).not.toContain('.workflow-agent__composer button { width: 34px;');
  });

  it('keeps Workflow overlays inside the measured canvas container without drawer math', () => {
    const app = source('App.tsx');
    const workspace = source('components/workflow/WorkflowWorkspace.tsx');
    const workflow = source('components/workflow/InfiniteWorkflow.tsx');
    const toolbar = source('components/workflow/WorkflowToolbar.tsx');
    const workflowStyles = source('styles/workflow.css');

    expect(workflowStyles).toContain('.workflow-toolbar__add-menu { position: absolute; bottom: calc(100% + 6px);');
    expect(app).not.toContain('rightPanelInset=');
    expect(workspace).not.toContain('rightPanelInset');
    expect(workflow).not.toContain('rightPanelInset');
    expect(toolbar).not.toContain('rightInset');
    expect(workflow).toContain('const workflowWidth = Math.max(360, rootSize?.width || 1000);');
    expect(workflow).toContain('const promptWorkflowWidth = workflowWidth;');
    expect(workflow).toContain('Math.max(72, 56 + 28 * project.viewport.k)');
    expect(workflow).toContain('const dockSafeTop = rootHeight - 60;');
    expect(workflowStyles.match(/overflow: clip/g)?.length).toBeGreaterThanOrEqual(2);
  });
  it('uses one responsive layout system for shell, drawer, toolbar, and Table', () => {
    const adaptive = source('styles/adaptive.css');
    const workflowStyles = source('styles/workflow.css');
    const tableStyles = source('styles/table.css');
    const drawer = source('components/studio/StudioRightDrawer.tsx');

    expect(adaptive).toContain('container: app-shell / inline-size;');
    expect(adaptive).toContain('container: studio-workspace / inline-size;');
    expect(adaptive).toContain('container: studio-surface / inline-size;');
    expect(adaptive).toContain('container: workflow-space / inline-size;');
    expect(adaptive).toContain('container: assistant-drawer / inline-size;');
    expect(adaptive).toContain('@container assistant-drawer (width <= 360px)');
    expect(adaptive).toContain('--workflow-control-size: clamp(32px, 4cqi, 36px);');
    expect(workflowStyles).not.toContain('workflow-toolbar--inset');
    expect(tableStyles).toContain('@container studio-surface (width <= 900px)');
    expect(drawer).toContain("data-docked={docked ? 'true' : 'false'}");
  });

});
