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

  it('mounts the three product surfaces without restoring the old canvas placeholder', () => {
    const app = source('App.tsx');

    expect(app).toContain('<WorkflowWorkspace');
    expect(app).toContain('<TableWorkspace');
    expect(app).toContain('<AgentWorkspace');
    expect(app).not.toContain('React Flow 故事板 + Agent SKILL 即将上线');
  });

  it('positions sliding drawers inside the workspace instead of the viewport', () => {
    for (const path of ['components/workflow/WorkflowSidebar.tsx', 'components/studio/StudioRightDrawer.tsx']) {
      const file = source(path);
      expect(file, path).not.toMatch(/theme-aware fixed/);
      expect(file, path).toMatch(/theme-aware absolute/);
    }
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

  it('keeps Workflow overlays and controls inside their usable canvas region', () => {
    const workflow = source('components/workflow/InfiniteWorkflow.tsx');
    const toolbar = source('components/workflow/WorkflowToolbar.tsx');
    const workflowStyles = source('styles/workflow.css');

    expect(workflowStyles).toContain('.workflow-toolbar__add-menu { position: absolute; bottom: calc(100% + 6px);');
    expect(toolbar).toContain("style={constrained ? { left: `calc((100% - ${rightInset}px) / 2)` } : undefined}");
    expect(workflow).toContain('Math.max(72, 56 + 28 * project.viewport.k)');
    expect(workflow).toContain('const dockSafeTop = rootHeight - 60;');
    expect(workflowStyles.match(/overflow: clip/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
