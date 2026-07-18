import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('shadow runtime facade', () => {
    let tempDir = '';

    beforeEach(() => {
        tempDir = mkdtempSync(join(tmpdir(), 'flovart-shadow-'));
        process.env.FLOVART_SHADOW_STATE_FILE = join(tempDir, 'state.json');
    });

    afterEach(() => {
        delete process.env.FLOVART_SHADOW_STATE_FILE;
        if (tempDir) {
            rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('keeps Workflow graph state alive without browser runtime', async () => {
        const { createShadowRuntimeFacade } = await import('../tools/flovart/shadow-runtime.js');
        const runtime = createShadowRuntimeFacade();
        const dispatch = (command: string, args: Record<string, unknown> = {}) => runtime.workflow.dispatch({ id: crypto.randomUUID(), command, args, source: 'cli' });

        const created = await dispatch('workflow.project.create', { title: '短片工作流' });
        const projectId = created.result.projectId;
        const image = await dispatch('workflow.node.create', { projectId, id: 'ref-1', type: 'image', title: '参考图', x: 10, y: 20 });
        const video = await dispatch('workflow.node.create-connected', { projectId, id: 'main-1', type: 'video', title: '主镜头', fromNodeId: 'ref-1', x: 50, y: 70 });

        expect(image).toMatchObject({ ok: true, result: { nodeId: 'ref-1', shadow: true } });
        expect(video).toMatchObject({ ok: true, result: { nodeId: 'main-1', shadow: true } });

        await dispatch('workflow.node.update', { projectId, nodeId: 'main-1', patch: { title: '主镜头改名', metadata: { prompt: '参考 @参考图 生成镜头运动' } } });
        await dispatch('workflow.select', { projectId, ids: ['main-1'] });
        const inspected = await dispatch('workflow.inspect', { projectId });

        expect(inspected).toMatchObject({
            ok: true,
            result: {
                title: '短片工作流',
                selectedNodeIds: ['main-1'],
                nodes: expect.arrayContaining([expect.objectContaining({ id: 'main-1', title: '主镜头改名' })]),
                connections: [expect.objectContaining({ fromNodeId: 'ref-1', toNodeId: 'main-1' })],
            },
        });
    });
});
