import { describe, expect, it } from 'vitest';
import { clampExportScale, pdfFromJpeg, pickWorkflowExportNodes, workflowExportBounds, wrapCanvasText } from '../components/workflow/canvasExport';
import type { WorkflowNode } from '../components/workflow/types';

const node = (id: string, x: number, y: number, width = 100, height = 80, patch: Partial<WorkflowNode> = {}): WorkflowNode => ({
  id,
  type: 'text',
  title: id,
  position: { x, y },
  width,
  height,
  metadata: {},
  ...patch,
} as unknown as WorkflowNode);

describe('canvas export', () => {
  it('exports the visible selection, falling back to every visible node', () => {
    const nodes = [node('a', 0, 0), node('b', 200, 0, 100, 80, { isVisible: false }), node('c', 400, 0)];
    expect(pickWorkflowExportNodes(nodes, ['c']).map(item => item.id)).toEqual(['c']);
    expect(pickWorkflowExportNodes(nodes, []).map(item => item.id)).toEqual(['a', 'c']);
    expect(pickWorkflowExportNodes(nodes, ['b']).map(item => item.id)).toEqual(['a', 'c']);
  });

  it('computes padded bounds across nodes', () => {
    expect(workflowExportBounds([node('a', 10, 20), node('b', 300, -40, 50, 50)], 10)).toEqual({ x: 0, y: -50, width: 360, height: 160 });
    expect(workflowExportBounds([])).toBeNull();
  });

  it('clamps scale by total pixels and longest side', () => {
    expect(clampExportScale({ x: 0, y: 0, width: 400, height: 300 }, 2)).toBe(2);
    expect(clampExportScale({ x: 0, y: 0, width: 10000, height: 10000 }, 2)).toBeCloseTo(Math.sqrt(0.4), 5);
    expect(clampExportScale({ x: 0, y: 0, width: 100000, height: 100 }, 2)).toBeCloseTo(0.16384, 5);
  });

  it('wraps text per character for CJK and keeps paragraphs', () => {
    const measure = (text: string) => Array.from(text).length;
    expect(wrapCanvasText(measure, '一二三四五', 2)).toEqual(['一二', '三四', '五']);
    expect(wrapCanvasText(measure, 'ab' + String.fromCharCode(10) + 'c', 5)).toEqual(['ab', 'c']);
  });

  it('builds a single-page PDF blob around the JPEG bytes', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const pdf = pdfFromJpeg(jpeg, 200, 100, 150, 75);
    expect(pdf.type).toBe('application/pdf');
    expect(pdf.size).toBeGreaterThan(jpeg.length + 200);
  });
});
