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

    it('keeps atomic canvas state alive without browser runtime', async () => {
        const { createShadowRuntimeFacade } = await import('../tools/flovart/shadow-runtime.js');
        const runtime = createShadowRuntimeFacade();

        const refResult = await runtime.element.create({
            id: 'ref-1',
            type: 'image',
            name: '参考图',
            x: 10,
            y: 20,
        });
        const mainResult = await runtime.element.create({
            id: 'main-1',
            type: 'video',
            name: '主镜头',
            x: 50,
            y: 70,
        });

        expect(refResult.ok).toBe(true);
        expect(mainResult.ok).toBe(true);

        const promptResult = await runtime.element.updatePrompt({
            elementId: 'main-1',
            textPrompt: '参考 @参考图 生成镜头运动',
        });
        expect(promptResult.ok).toBe(true);
        expect(promptResult.generationState.promptPayload.resolvedReferences).toEqual([
            { token: '@参考图', targetElementId: 'ref-1', targetType: 'image' },
        ]);

        const slotResult = await runtime.element.assignSlot({
            elementId: 'main-1',
            targetElementId: 'ref-1',
            slotRole: 'first_frame',
        });
        expect(slotResult.ok).toBe(true);

        const igniteResult = await runtime.element.ignite({ elementId: 'main-1' });
        expect(igniteResult.ok).toBe(true);
        expect(igniteResult.shadow).toBe(true);

        const inspectResult = await runtime.canvas.inspect();
        expect(inspectResult.ok).toBe(true);
        expect(inspectResult.media).toHaveLength(2);
        expect(inspectResult.jobs).toHaveLength(1);
        expect(inspectResult.shadow).toBe(true);

        const selectResult = await runtime.canvas.select(['main-1']);
        expect(selectResult).toMatchObject({ ok: true, selectedElementIds: ['main-1'], shadow: true });

        const updateResult = await runtime.canvas.updateElement('main-1', { name: '主镜头改名', x: 88, type: 'text' });
        expect(updateResult.ok).toBe(true);
        expect(updateResult.element.name).toBe('主镜头改名');
        expect(updateResult.element.x).toBe(88);
        expect(updateResult.element.type).toBe('video');

        const removeResult = await runtime.canvas.removeElement('ref-1');
        expect(removeResult).toMatchObject({ ok: true, removed: 1, shadow: true });

        const finalInspect = await runtime.canvas.inspect();
        expect(finalInspect.media).toHaveLength(1);
    });
});
