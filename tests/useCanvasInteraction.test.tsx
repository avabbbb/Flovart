import React, { useEffect, useState } from 'react';
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useCanvasInteraction } from '../hooks/useCanvasInteraction';
import type { Board, Element, Point, Tool, WheelAction } from '../types';
import type { Rect } from '../utils/canvasHelpers';

const createBoard = (overrides: Partial<Board> = {}): Board => ({
  id: 'board-1',
  name: 'Board 1',
  elements: [],
  history: [[]],
  historyIndex: 0,
  panOffset: { x: 0, y: 0 },
  zoom: 1,
  canvasBackgroundColor: '#ffffff',
  ...overrides,
});

function CanvasHarness({
  initialBoard = createBoard(),
  activeTool: initialTool = 'select',
  wheelAction = 'pan',
  onBoard,
  onCommit,
}: {
  initialBoard?: Board;
  activeTool?: Tool;
  wheelAction?: WheelAction;
  onBoard: (board: Board) => void;
  onCommit?: () => void;
}) {
  const [board, setBoard] = useState(initialBoard);
  const [activeTool, setActiveTool] = useState<Tool>(initialTool);
  const [selectedElementIds, setSelectedElementIds] = useState<string[]>([]);
  const [editingElement, setEditingElement] = useState<{ id: string; text: string } | null>(null);
  const [croppingState, setCroppingState] = useState<{ elementId: string; originalElement: any; cropBox: Rect } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; elementId: string | null } | null>(null);

  useEffect(() => {
    onBoard(board);
  }, [board, onBoard]);

  const interaction = useCanvasInteraction({
    elements: board.elements,
    zoom: board.zoom,
    panOffset: board.panOffset,
    activeTool,
    setActiveTool,
    drawingOptions: { strokeColor: '#111827', strokeWidth: 4 },
    wheelAction,
    selectedElementIds,
    setSelectedElementIds,
    editingElement,
    setEditingElement,
    croppingState,
    setCroppingState,
    setInpaintState: vi.fn(),
    setInpaintPrompt: vi.fn(),
    maskEditingId: null,
    paintMask: vi.fn(),
    contextMenu,
    setContextMenu,
    updateActiveBoard: updater => setBoard(prev => updater(prev)),
    setElements: (updater, commit = true) => {
      setBoard(prev => ({ ...prev, elements: updater(prev.elements) }));
      if (commit) onCommit?.();
    },
    commitAction: updater => {
      setBoard(prev => ({ ...prev, elements: updater(prev.elements) }));
      onCommit?.();
    },
    getDescendants: () => [],
  });

  return (
    <svg
      data-testid="canvas"
      ref={interaction.svgRef}
      onMouseDown={interaction.handleMouseDown}
      onMouseMove={interaction.handleMouseMove}
      onMouseUp={interaction.handleMouseUp}
      onWheel={interaction.handleWheel}
    >
      {board.elements.map(element => {
        if (element.type !== 'shape') return null;
        return (
          <g key={element.id} data-id={element.id} transform={`translate(${element.x}, ${element.y})`}>
            <rect width={element.width} height={element.height} />
          </g>
        );
      })}
    </svg>
  );
}

const mockCanvasRect = (svg: SVGSVGElement) => {
  vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({
    x: 10,
    y: 20,
    left: 10,
    top: 20,
    right: 810,
    bottom: 620,
    width: 800,
    height: 600,
    toJSON: () => ({}),
  } as DOMRect);
};

describe('useCanvasInteraction edge cases', () => {
  it('does not create draw elements from right-clicks', () => {
    let latestBoard = createBoard();
    const { getByTestId } = render(
      <CanvasHarness activeTool="rectangle" onBoard={board => { latestBoard = board; }} />,
    );
    const svg = getByTestId('canvas') as unknown as SVGSVGElement;
    mockCanvasRect(svg);

    fireEvent.mouseDown(svg, { button: 2, clientX: 100, clientY: 120 });

    expect(latestBoard.elements).toHaveLength(0);
  });

  it('removes accidental zero-size shapes instead of committing them', () => {
    let latestBoard = createBoard();
    const commitSpy = vi.fn();
    const { getByTestId } = render(
      <CanvasHarness activeTool="rectangle" onBoard={board => { latestBoard = board; }} onCommit={commitSpy} />,
    );
    const svg = getByTestId('canvas') as unknown as SVGSVGElement;
    mockCanvasRect(svg);

    fireEvent.mouseDown(svg, { button: 0, clientX: 100, clientY: 120 });
    fireEvent.mouseUp(svg, { button: 0, clientX: 100, clientY: 120 });

    expect(latestBoard.elements).toHaveLength(0);
    expect(commitSpy).not.toHaveBeenCalled();
  });

  it('keeps the cursor canvas point stable when wheel zooming inside an offset svg', () => {
    let latestBoard = createBoard({ zoom: 1, panOffset: { x: 100, y: 50 } });
    const { getByTestId } = render(
      <CanvasHarness initialBoard={latestBoard} wheelAction="zoom" onBoard={board => { latestBoard = board; }} />,
    );
    const svg = getByTestId('canvas') as unknown as SVGSVGElement;
    mockCanvasRect(svg);

    const cursor: Point = { x: 410, y: 320 };
    const canvasBefore = {
      x: (cursor.x - 10 - latestBoard.panOffset.x) / latestBoard.zoom,
      y: (cursor.y - 20 - latestBoard.panOffset.y) / latestBoard.zoom,
    };

    fireEvent.wheel(svg, { deltaY: -120, clientX: cursor.x, clientY: cursor.y, ctrlKey: true });

    const canvasAfter = {
      x: (cursor.x - 10 - latestBoard.panOffset.x) / latestBoard.zoom,
      y: (cursor.y - 20 - latestBoard.panOffset.y) / latestBoard.zoom,
    };

    expect(latestBoard.zoom).toBeGreaterThan(1);
    expect(canvasAfter.x).toBeCloseTo(canvasBefore.x, 5);
    expect(canvasAfter.y).toBeCloseTo(canvasBefore.y, 5);
  });

  it('commits meaningful line drawings', () => {
    let latestBoard = createBoard();
    const commitSpy = vi.fn();
    const { getByTestId } = render(
      <CanvasHarness activeTool="line" onBoard={board => { latestBoard = board; }} onCommit={commitSpy} />,
    );
    const svg = getByTestId('canvas') as unknown as SVGSVGElement;
    mockCanvasRect(svg);

    fireEvent.mouseDown(svg, { button: 0, clientX: 100, clientY: 120 });
    fireEvent.mouseMove(svg, { clientX: 180, clientY: 170 });
    fireEvent.mouseUp(svg, { button: 0, clientX: 180, clientY: 170 });

    expect(latestBoard.elements).toEqual([expect.objectContaining({ type: 'line' }) as Element]);
    expect(commitSpy).toHaveBeenCalledTimes(1);
  });

  it('keeps the final React transform after dragging an element', () => {
    Object.defineProperty(globalThis, 'CSS', {
      configurable: true,
      value: { escape: (value: string) => value },
    });
    let latestBoard = createBoard({
      elements: [{
        id: 'shape-1',
        type: 'shape',
        shapeType: 'rectangle',
        x: 100,
        y: 100,
        width: 120,
        height: 80,
        fillColor: '#38bdf8',
        strokeColor: '#111827',
        strokeWidth: 2,
      }],
    });
    const { getByTestId } = render(
      <CanvasHarness initialBoard={latestBoard} onBoard={board => { latestBoard = board; }} />,
    );
    const svg = getByTestId('canvas') as unknown as SVGSVGElement;
    mockCanvasRect(svg);
    const shape = svg.querySelector('[data-id="shape-1"]') as SVGGElement;

    fireEvent.mouseDown(shape, { button: 0, clientX: 130, clientY: 140 });
    fireEvent.mouseMove(svg, { clientX: 230, clientY: 190 });
    fireEvent.mouseUp(svg, { button: 0, clientX: 230, clientY: 190 });

    expect(latestBoard.elements[0]).toEqual(expect.objectContaining({ x: 200, y: 150 }));
    expect(svg.querySelector('[data-id="shape-1"]')?.getAttribute('transform')).toBe('translate(200, 150)');
  });
});
