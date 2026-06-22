import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('studio layout contracts', () => {
  it('removes the legacy Canvas bottom menu after moving status to the top menu', () => {
    const app = source('App.tsx');

    expect(app).not.toContain('compact-prompt-dock');
    expect(app).not.toContain('<DiagnosticBar');
    expect(app).not.toContain("openLegalModal('terms')");
  });

  it('uses one shared menu model instead of per-surface callback sets', () => {
    const app = source('App.tsx');

    expect(app.match(/<StudioTopMenu model={studioMenuModel} \/>/g)).toHaveLength(2);
    expect(app).not.toContain('onSwitchToCanvas=');
    expect(app).not.toContain('onToggleTheme=');
    expect(app).not.toContain('onToggleLanguage=');
  });

  it('positions sliding drawers inside the workspace instead of the viewport', () => {
    for (const path of [
      'components/WorkspaceSidebar.tsx',
      'components/RightPanel.tsx',
      'components/workflow/WorkflowSidebar.tsx',
      'components/studio/StudioRightDrawer.tsx',
    ]) {
      const file = source(path);
      expect(file, path).not.toMatch(/theme-aware fixed/);
      expect(file, path).toMatch(/theme-aware absolute/);
    }
  });

  it('uses the Canvas compact panel shell for the Workflow right drawer', () => {
    const canvasPanel = source('components/RightPanel.tsx');
    const workflowPanel = source('components/studio/StudioRightDrawer.tsx');

    expect(canvasPanel).toContain('isl-panel compact-right-panel');
    expect(workflowPanel).toContain('isl-panel compact-right-panel');
    expect(workflowPanel).not.toContain("boxShadow: 'var(--isl-shadow-lg)'");
  });
});
