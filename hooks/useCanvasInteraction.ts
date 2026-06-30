import { useRef, useState, useCallback } from 'react';
import type { Tool, Point, Element, ImageElement, PathElement, ShapeElement, TextElement, ArrowElement, LineElement, WheelAction, Board, VideoElement } from '../types';
import { generateId, getElementBounds, isPointInPolygon, SNAP_THRESHOLD, type Rect, type Guide } from '../utils/canvasHelpers';
import { createRafBatcher, type RafBatcher } from '../utils/rafBatcher';

const MIN_DRAW_DISTANCE_SCREEN = 3;

export interface UseCanvasInteractionParams {
    // Board state (readonly)
    elements: Element[];
    zoom: number;
    panOffset: Point;
    // Tool state
    activeTool: Tool;
    setActiveTool: React.Dispatch<React.SetStateAction<Tool>>;
    drawingOptions: { strokeColor: string; strokeWidth: number };
    wheelAction: WheelAction;
    // Selection
    selectedElementIds: string[];
    setSelectedElementIds: React.Dispatch<React.SetStateAction<string[]>>;
    // Context menu
    contextMenu?: { x: number; y: number; elementId: string | null } | null;
    setContextMenu?: React.Dispatch<React.SetStateAction<{ x: number; y: number; elementId: string | null } | null>>;
    // Board management
    updateActiveBoard: (updater: (board: Board) => Board) => void;
    setElements: (updater: (prev: Element[]) => Element[], commit?: boolean) => void;
    commitAction: (updater: (prev: Element[]) => Element[]) => void;
    // Helpers
    getDescendants: (id: string, els: Element[]) => Element[];
    onTripleClickEmpty?: () => void;
}

export function useCanvasInteraction(params: UseCanvasInteractionParams) {
    const {
        elements, zoom, panOffset,
        activeTool, setActiveTool, drawingOptions, wheelAction,
        selectedElementIds, setSelectedElementIds,
        contextMenu, setContextMenu,
        updateActiveBoard, setElements, commitAction,
        getDescendants,
        onTripleClickEmpty,
    } = params;

    // --- Interaction-only state ---
    const [selectionBox, setSelectionBox] = useState<Rect | null>(null);
    const [alignmentGuides, setAlignmentGuides] = useState<Guide[]>([]);
    const [lassoPath, setLassoPath] = useState<Point[] | null>(null);
    const [dragTick, setDragTick] = useState(0);

    // --- Interaction refs ---
    const interactionMode = useRef<string | null>(null);
    const startPoint = useRef<Point>({ x: 0, y: 0 });
    const currentDrawingElementId = useRef<string | null>(null);
    const resizeStartInfo = useRef<{ originalElement: ImageElement | ShapeElement | TextElement | VideoElement; startCanvasPoint: Point; handle: string; shiftKey: boolean } | null>(null);
    const cropStartInfo = useRef<{ originalCropBox: Rect; startCanvasPoint: Point } | null>(null);
    const dragStartElementPositions = useRef<Map<string, { x: number; y: number } | Point[]>>(new Map());
    const cachedStaticSnap = useRef<{ v: Set<number>; h: Set<number> } | null>(null);
    const dragRafBatcher = useRef<RafBatcher<Point> | null>(null);
    const lastDragOffsets = useRef<Map<string, { dx: number; dy: number }>>(new Map());
    const elementsRef = useRef(elements);
    const svgRef = useRef<SVGSVGElement>(null);
    const previousToolRef = useRef<Tool>('select');
    const spacebarDownTime = useRef<number | null>(null);
    elementsRef.current = elements;

    const getMinimumCanvasDistance = useCallback(() => MIN_DRAW_DISTANCE_SCREEN / Math.max(zoom || 1, 0.1), [zoom]);

    const removeCurrentDrawingElement = useCallback(() => {
        const elementId = currentDrawingElementId.current;
        if (!elementId) return;
        setElements(prev => prev.filter(el => el.id !== elementId), false);
    }, [setElements]);

    const isCurrentDrawingElementMeaningful = useCallback((): boolean => {
        const elementId = currentDrawingElementId.current;
        if (!elementId) return true;

        const element = elementsRef.current.find(el => el.id === elementId);
        if (!element) return false;

        const minDistance = getMinimumCanvasDistance();
        if (element.type === 'shape') {
            return element.width >= minDistance && element.height >= minDistance;
        }
        if (element.type === 'arrow' || element.type === 'line') {
            const [start, end] = element.points;
            return Math.hypot(end.x - start.x, end.y - start.y) >= minDistance;
        }
        if (element.type === 'path') {
            if (element.points.length < 2) return false;
            const first = element.points[0];
            return element.points.some(point => Math.hypot(point.x - first.x, point.y - first.y) >= minDistance);
        }
        return true;
    }, [getMinimumCanvasDistance]);

    // --- Helper: screen → canvas coords ---
    const getCanvasPoint = useCallback((screenX: number, screenY: number): Point => {
        if (!svgRef.current) return { x: 0, y: 0 };
        const svgBounds = svgRef.current.getBoundingClientRect();
        const xOnSvg = screenX - svgBounds.left;
        const yOnSvg = screenY - svgBounds.top;
        return {
            x: (xOnSvg - panOffset.x) / zoom,
            y: (yOnSvg - panOffset.y) / zoom,
        };
    }, [panOffset, zoom]);

    // --- Selectable element helper ---
    const getSelectableElement = (elementId: string, allElements: Element[]): Element | null => {
        const element = allElements.find(el => el.id === elementId);
        if (!element) return null;
        if (element.isLocked) return null;

        let current = element;
        while (current.parentId) {
            const parent = allElements.find(el => el.id === current.parentId);
            if (!parent) return current;
            if (parent.isLocked) return null;
            current = parent;
        }
        return current;
    };

    // --- Mouse handlers ---
    const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
        if (contextMenu) setContextMenu?.(null);

        if (e.button === 1) { // Middle mouse button for panning
            interactionMode.current = 'pan';
            startPoint.current = { x: e.clientX, y: e.clientY };
            e.preventDefault();
            return;
        }

        if (e.button !== 0) {
            return;
        }

        startPoint.current = { x: e.clientX, y: e.clientY };
        const canvasStartPoint = getCanvasPoint(e.clientX, e.clientY);

        const target = e.target as SVGElement;
        const handleName = target.getAttribute('data-handle');

         if (activeTool === 'text') {
            const newText: TextElement = {
                id: generateId(), type: 'text', name: 'Text',
                x: canvasStartPoint.x, y: canvasStartPoint.y,
                width: 150, height: 40,
                text: "Text", fontSize: 24, fontColor: drawingOptions.strokeColor
            };
            setElements(prev => [...prev, newText]);
            setSelectedElementIds([newText.id]);
            setActiveTool('select');
            return;
        }

        if (activeTool === 'pan') {
            interactionMode.current = 'pan';
            return;
        }
        
        if (handleName && activeTool === 'select' && selectedElementIds.length === 1) {
            interactionMode.current = `resize-${handleName}`;
            const element = elements.find(el => el.id === selectedElementIds[0]) as ImageElement | ShapeElement | TextElement | VideoElement;
            resizeStartInfo.current = {
                originalElement: { ...element },
                startCanvasPoint: canvasStartPoint,
                handle: handleName,
                shiftKey: e.shiftKey,
            };
            return;
        }

        if (activeTool === 'draw' || activeTool === 'highlighter') {
            interactionMode.current = 'draw';
            const newPath: PathElement = {
                id: generateId(),
                type: 'path', name: 'Path',
                points: [canvasStartPoint],
                strokeColor: drawingOptions.strokeColor,
                strokeWidth: drawingOptions.strokeWidth,
                strokeOpacity: activeTool === 'highlighter' ? 0.5 : 1,
                x: 0, y: 0 
            };
            currentDrawingElementId.current = newPath.id;
            setElements(prev => [...prev, newPath], false);
        } else if (activeTool === 'rectangle' || activeTool === 'circle' || activeTool === 'triangle') {
            interactionMode.current = 'drawShape';
            const newShape: ShapeElement = {
                id: generateId(),
                type: 'shape', name: activeTool.charAt(0).toUpperCase() + activeTool.slice(1),
                shapeType: activeTool,
                x: canvasStartPoint.x,
                y: canvasStartPoint.y,
                width: 0,
                height: 0,
                strokeColor: drawingOptions.strokeColor,
                strokeWidth: drawingOptions.strokeWidth,
                fillColor: 'transparent',
            }
            currentDrawingElementId.current = newShape.id;
            setElements(prev => [...prev, newShape], false);
        } else if (activeTool === 'arrow') {
            interactionMode.current = 'drawArrow';
            const newArrow: ArrowElement = {
                id: generateId(), type: 'arrow', name: 'Arrow',
                x: canvasStartPoint.x, y: canvasStartPoint.y,
                points: [canvasStartPoint, canvasStartPoint],
                strokeColor: drawingOptions.strokeColor, strokeWidth: drawingOptions.strokeWidth
            };
            currentDrawingElementId.current = newArrow.id;
            setElements(prev => [...prev, newArrow], false);
        } else if (activeTool === 'line') {
            interactionMode.current = 'drawLine';
            const newLine: LineElement = {
                id: generateId(), type: 'line', name: 'Line',
                x: canvasStartPoint.x, y: canvasStartPoint.y,
                points: [canvasStartPoint, canvasStartPoint],
                strokeColor: drawingOptions.strokeColor, strokeWidth: drawingOptions.strokeWidth
            };
            currentDrawingElementId.current = newLine.id;
            setElements(prev => [...prev, newLine], false);
        } else if (activeTool === 'erase') {
            interactionMode.current = 'erase';
        } else if (activeTool === 'lasso') {
            interactionMode.current = 'lasso';
            setLassoPath([canvasStartPoint]);
        } else if (activeTool === 'select') {
            const clickedElementId = target.closest('[data-id]')?.getAttribute('data-id');
            const selectableElement = clickedElementId ? getSelectableElement(clickedElementId, elementsRef.current) : null;
            const selectableElementId = selectableElement?.id;

            if (selectableElementId) {
                if (!e.shiftKey && !selectedElementIds.includes(selectableElementId)) {
                     setSelectedElementIds([selectableElementId]);
                } else if (e.shiftKey) {
                    setSelectedElementIds(prev => 
                        prev.includes(selectableElementId) ? prev.filter(id => id !== selectableElementId) : [...prev, selectableElementId]
                    );
                }
                interactionMode.current = 'dragElements';
                setDragTick(t => t + 1);
                const idsToDrag = new Set<string>();
                 if (selectableElement.type === 'group') {
                    idsToDrag.add(selectableElement.id);
                    getDescendants(selectableElement.id, elementsRef.current).forEach(desc => idsToDrag.add(desc.id));
                } else {
                    idsToDrag.add(selectableElement.id);
                }

                 const initialPositions = new Map<string, {x: number, y: number} | Point[]>();
                elementsRef.current.forEach(el => {
                    if (idsToDrag.has(el.id)) {
                         if (el.type !== 'path' && el.type !== 'arrow' && el.type !== 'line') {
                            initialPositions.set(el.id, { x: el.x, y: el.y });
                        } else {
                            initialPositions.set(el.id, el.points);
                        }
                    }
                });
                dragStartElementPositions.current = initialPositions;

                // Cache static snap points for the entire drag session
                const getSnapPts = (bounds: Rect) => ({
                    v: [bounds.x, bounds.x + bounds.width / 2, bounds.x + bounds.width],
                    h: [bounds.y, bounds.y + bounds.height / 2, bounds.y + bounds.height],
                });
                const snap = { v: new Set<number>(), h: new Set<number>() };
                elementsRef.current.forEach(el => {
                    if (!idsToDrag.has(el.id)) {
                        const bounds = getElementBounds(el);
                        getSnapPts(bounds).v.forEach(p => snap.v.add(p));
                        getSnapPts(bounds).h.forEach(p => snap.h.add(p));
                    }
                });
                cachedStaticSnap.current = snap;

            } else {
                if (e.detail === 3) {
                    onTripleClickEmpty?.();
                    return;
                }
                setSelectedElementIds([]);
                interactionMode.current = 'selectBox';
                setSelectionBox({ x: canvasStartPoint.x, y: canvasStartPoint.y, width: 0, height: 0 });
            }
        }
    };

    const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
        if (!interactionMode.current) return;
        const point = getCanvasPoint(e.clientX, e.clientY);
        const startCanvasPoint = getCanvasPoint(startPoint.current.x, startPoint.current.y);

        if (interactionMode.current === 'erase') {
            const eraseRadius = drawingOptions.strokeWidth / zoom;
            const idsToDelete = new Set<string>();

            elements.forEach(el => {
                if (el.type === 'path') {
                    for (let i = 0; i < el.points.length - 1; i++) {
                        const distance = Math.hypot(point.x - el.points[i].x, point.y - el.points[i].y);
                        if (distance < eraseRadius) {
                            idsToDelete.add(el.id);
                            return;
                        }
                    }
                }
            });

            if (idsToDelete.size > 0) {
                setElements(prev => prev.filter(el => !idsToDelete.has(el.id)), false);
            }
            return;
        }

        if (interactionMode.current.startsWith('resize-')) {
            if (!resizeStartInfo.current) return;
            const { originalElement, handle, startCanvasPoint: resizeStartPoint, shiftKey } = resizeStartInfo.current;
            let { x, y, width, height } = originalElement;
            const aspectRatio = originalElement.width > 0 && originalElement.height > 0
                ? originalElement.width / originalElement.height
                : 1;
            const dx = point.x - resizeStartPoint.x;
            const dy = point.y - resizeStartPoint.y;

            if (handle.includes('r')) { width = originalElement.width + dx; }
            if (handle.includes('l')) { width = originalElement.width - dx; x = originalElement.x + dx; }
            if (handle.includes('b')) { height = originalElement.height + dy; }
            if (handle.includes('t')) { height = originalElement.height - dy; y = originalElement.y + dy; }

            if (originalElement.type !== 'text' && !shiftKey) {
                if (handle.includes('r') || handle.includes('l')) {
                    height = width / aspectRatio;
                    if (handle.includes('t')) y = (originalElement.y + originalElement.height) - height;
                } else {
                    width = height * aspectRatio;
                    if (handle.includes('l')) x = (originalElement.x + originalElement.width) - width;
                }
            }

            if (width < 1) { width = 1; x = originalElement.x + originalElement.width - 1; }
            if (height < 1) { height = 1; y = originalElement.y + originalElement.height - 1; }

            setElements(prev => prev.map(el =>
                el.id === originalElement.id ? { ...el, x, y, width, height } : el
            ), false);
            return;
        }


        switch(interactionMode.current) {
            case 'pan': {
                const dx = e.clientX - startPoint.current.x;
                const dy = e.clientY - startPoint.current.y;
                updateActiveBoard(b => ({ ...b, panOffset: { x: b.panOffset.x + dx, y: b.panOffset.y + dy } }));
                startPoint.current = { x: e.clientX, y: e.clientY };
                break;
            }
            case 'draw': {
                if (currentDrawingElementId.current) {
                    setElements(prev => prev.map(el => {
                        if (el.id === currentDrawingElementId.current && el.type === 'path') {
                            return { ...el, points: [...el.points, point] };
                        }
                        return el;
                    }), false);
                }
                break;
            }
            case 'lasso': {
                setLassoPath(prev => (prev ? [...prev, point] : [point]));
                break;
            }
            case 'drawShape': {
                 if (currentDrawingElementId.current) {
                    setElements(prev => prev.map(el => {
                        if (el.id === currentDrawingElementId.current && el.type === 'shape') {
                            let newWidth = Math.abs(point.x - startCanvasPoint.x);
                            let newHeight = Math.abs(point.y - startCanvasPoint.y);
                            let newX = Math.min(point.x, startCanvasPoint.x);
                            let newY = Math.min(point.y, startCanvasPoint.y);
                            
                            if (e.shiftKey) {
                                if (el.shapeType === 'rectangle' || el.shapeType === 'circle') {
                                    const side = Math.max(newWidth, newHeight);
                                    newWidth = side;
                                    newHeight = side;
                                } else if (el.shapeType === 'triangle') {
                                    newHeight = newWidth * (Math.sqrt(3) / 2);
                                }
                                
                                if (point.x < startCanvasPoint.x) newX = startCanvasPoint.x - newWidth;
                                if (point.y < startCanvasPoint.y) newY = startCanvasPoint.y - newHeight;
                            }

                            return {...el, x: newX, y: newY, width: newWidth, height: newHeight};
                        }
                        return el;
                    }), false);
                }
                break;
            }
            case 'drawArrow': {
                if (currentDrawingElementId.current) {
                    setElements(prev => prev.map(el => {
                        if (el.id === currentDrawingElementId.current && el.type === 'arrow') {
                            return { ...el, points: [el.points[0], point] };
                        }
                        return el;
                    }), false);
                }
                break;
            }
            case 'drawLine': {
                if (currentDrawingElementId.current) {
                    setElements(prev => prev.map(el => {
                        if (el.id === currentDrawingElementId.current && el.type === 'line') {
                            return { ...el, points: [el.points[0], point] };
                        }
                        return el;
                    }), false);
                }
                break;
            }
            case 'dragElements': {
                if (!dragRafBatcher.current) {
                    dragRafBatcher.current = createRafBatcher<Point>(latestPoint => {
                        const dx = latestPoint.x - startCanvasPoint.x;
                        const dy = latestPoint.y - startCanvasPoint.y;
                
                        const movingElementIds = Array.from(dragStartElementPositions.current.keys());
                        const movingElements = elementsRef.current.filter(el => movingElementIds.includes(el.id));
                        const snapThresholdCanvas = SNAP_THRESHOLD / zoom;

                        let finalDx = dx;
                        let finalDy = dy;

                        const getSnapPoints = (bounds: Rect) => ({
                            v: [bounds.x, bounds.x + bounds.width / 2, bounds.x + bounds.width],
                            h: [bounds.y, bounds.y + bounds.height / 2, bounds.y + bounds.height],
                        });

                        const staticSnapPoints = cachedStaticSnap.current ?? { v: new Set<number>(), h: new Set<number>() };
                
                        let bestSnapX = { dist: Infinity, val: finalDx, guideVals: [] as { v: number; start: number; end: number }[] };
                        let bestSnapY = { dist: Infinity, val: finalDy, guideVals: [] as { h: number; start: number; end: number }[] };
                
                        movingElements.forEach(movingEl => {
                            const startPos = dragStartElementPositions.current.get(movingEl.id);
                            if (!startPos) return;

                            let movingBounds: Rect;
                            if (movingEl.type !== 'path' && movingEl.type !== 'arrow' && movingEl.type !== 'line') {
                                movingBounds = getElementBounds({...movingEl, x: (startPos as Point).x, y: (startPos as Point).y });
                            } else {
                                if (movingEl.type === 'arrow' || movingEl.type === 'line') {
                                    movingBounds = getElementBounds({...movingEl, points: startPos as [Point, Point]});
                                } else {
                                    movingBounds = getElementBounds({...movingEl, points: startPos as Point[]});
                                }
                            }

                            const movingSnapPoints = getSnapPoints(movingBounds);

                            movingSnapPoints.v.forEach(p => {
                                staticSnapPoints.v.forEach(staticP => {
                                    const dist = Math.abs((p + finalDx) - staticP);
                                    if (dist < snapThresholdCanvas && dist < bestSnapX.dist) {
                                        bestSnapX = { dist, val: staticP - p, guideVals: [{ v: staticP, start: movingBounds.y, end: movingBounds.y + movingBounds.height }] };
                                    }
                                });
                            });
                            movingSnapPoints.h.forEach(p => {
                                staticSnapPoints.h.forEach(staticP => {
                                    const dist = Math.abs((p + finalDy) - staticP);
                                    if (dist < snapThresholdCanvas && dist < bestSnapY.dist) {
                                        bestSnapY = { dist, val: staticP - p, guideVals: [{ h: staticP, start: movingBounds.x, end: movingBounds.x + movingBounds.width }] };
                                    }
                                });
                            });
                        });
                
                        if (bestSnapX.guideVals.length) finalDx = bestSnapX.val;
                        if (bestSnapY.guideVals.length) finalDy = bestSnapY.val;

                        // Update lastDragOffsets for final commit
                        const offsets = new Map<string, { dx: number; dy: number }>();
                        movingElementIds.forEach(id => offsets.set(id, { dx: finalDx, dy: finalDy }));
                        lastDragOffsets.current = offsets;
                
                        // DOM-based element transforms
                        const svgEl = svgRef.current;
                        if (svgEl) {
                            movingElementIds.forEach(id => {
                                const g = svgEl.querySelector(`[data-id="${CSS.escape(id)}"]`);
                                if (!(g instanceof SVGGElement)) return;
                                const el = elementsRef.current.find(e => e.id === id);
                                if (!el) return;
                                const startPos = dragStartElementPositions.current.get(id);
                                if (!startPos) return;

                                if (el.type === 'text' || el.type === 'shape') {
                                    const startP = startPos as Point;
                                    g.setAttribute('transform', `translate(${startP.x + finalDx}, ${startP.y + finalDy})`);
                                } else if (el.type === 'image' || el.type === 'video' || el.type === 'path' || el.type === 'arrow' || el.type === 'line' || el.type === 'group') {
                                    g.setAttribute('transform', `translate(${finalDx}, ${finalDy})`);
                                }
                            });
                        }

                        // DOM-based alignment guides
                        let guidesContainer = svgRef.current?.querySelector('#flv-drag-guides');
                        if (!guidesContainer && svgRef.current) {
                            guidesContainer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                            guidesContainer.setAttribute('id', 'flv-drag-guides');
                            svgRef.current.appendChild(guidesContainer);
                        }
                        if (guidesContainer) {
                            guidesContainer.innerHTML = '';
                            bestSnapX.guideVals.forEach(gv => {
                                const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                                line.setAttribute('x1', String(gv.v));
                                line.setAttribute('y1', String(gv.start));
                                line.setAttribute('x2', String(gv.v));
                                line.setAttribute('y2', String(gv.end));
                                line.setAttribute('stroke', 'red');
                                line.setAttribute('stroke-width', String(1 / zoom));
                                line.setAttribute('stroke-dasharray', `${4 / zoom} ${2 / zoom}`);
                                guidesContainer.appendChild(line);
                            });
                            bestSnapY.guideVals.forEach(gv => {
                                const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                                line.setAttribute('x1', String(gv.start));
                                line.setAttribute('y1', String(gv.h));
                                line.setAttribute('x2', String(gv.end));
                                line.setAttribute('y2', String(gv.h));
                                line.setAttribute('stroke', 'red');
                                line.setAttribute('stroke-width', String(1 / zoom));
                                line.setAttribute('stroke-dasharray', `${4 / zoom} ${2 / zoom}`);
                                guidesContainer.appendChild(line);
                            });
                        }
                    });
                }
                dragRafBatcher.current.schedule(point);
                break;
            }
             case 'selectBox': {
                const newX = Math.min(point.x, startCanvasPoint.x);
                const newY = Math.min(point.y, startCanvasPoint.y);
                const newWidth = Math.abs(point.x - startCanvasPoint.x);
                const newHeight = Math.abs(point.y - startCanvasPoint.y);
                setSelectionBox({ x: newX, y: newY, width: newWidth, height: newHeight });
                break;
            }
        }
    };
    
    const handleMouseUp = () => {
        if (interactionMode.current) {
            if (interactionMode.current === 'selectBox' && selectionBox) {
                const selectedIds: string[] = [];
                const { x: sx, y: sy, width: sw, height: sh } = selectionBox;
                
                elements.forEach(element => {
                    const bounds = getElementBounds(element, elements);
                    const { x: ex, y: ey, width: ew, height: eh } = bounds;
                    
                    if (sx < ex + ew && sx + sw > ex && sy < ey + eh && sy + sh > ey) {
                        const selectable = getSelectableElement(element.id, elements);
                        if(selectable) selectedIds.push(selectable.id);
                    }
                });
                setSelectedElementIds([...new Set(selectedIds)]);
            } else if (interactionMode.current === 'lasso' && lassoPath && lassoPath.length > 2) {
                // Normal lasso selection
                const selectedIds = elements.filter(el => {
                    const bounds = getElementBounds(el, elements);
                    const center: Point = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
                    return isPointInPolygon(center, lassoPath);
                }).map(el => getSelectableElement(el.id, elements)?.id).filter((id): id is string => !!id);
                setSelectedElementIds(prev => [...new Set([...prev, ...selectedIds])]);
                setLassoPath(null);
            } else if (['draw', 'drawShape', 'drawArrow', 'drawLine'].some(prefix => interactionMode.current?.startsWith(prefix))) {
                 if (isCurrentDrawingElementMeaningful()) {
                     commitAction(els => els);
                 } else {
                     removeCurrentDrawingElement();
                 }
            } else if (['dragElements', 'erase'].some(prefix => interactionMode.current?.startsWith(prefix)) || interactionMode.current.startsWith('resize-')) {
                  // Flush any pending RAF drag before committing to history
                  if (dragRafBatcher.current) {
                      dragRafBatcher.current.flush();
                 }
                 // Clear DOM element transforms before commit
                 if (interactionMode.current === 'dragElements') {
                     const svgEl = svgRef.current;
                     if (svgEl) {
                         lastDragOffsets.current.forEach((_, id) => {
                             const g = svgEl.querySelector(`[data-id="${CSS.escape(id)}"]`);
                             if (g) g.removeAttribute('transform');
                         });
                     }
                     // Clear DOM alignment guides
                     const guidesG = svgRef.current?.querySelector('#flv-drag-guides');
                     if (guidesG) guidesG.remove();
                      // Commit final positions via setElements (runs through the reducer for undo stack)
                      if (lastDragOffsets.current.size > 0) {
                          const finalDragOffsets = new Map(lastDragOffsets.current);
                          commitAction(prev => prev.map(el => {
                              const offset = finalDragOffsets.get(el.id);
                             if (!offset) return el;
                             if (el.type !== 'path' && el.type !== 'arrow' && el.type !== 'line') {
                                 return { ...el, x: el.x + offset.dx, y: el.y + offset.dy };
                             }
                             if (el.type === 'path') {
                                 return { ...el, points: (el as PathElement).points.map(p => ({ x: p.x + offset.dx, y: p.y + offset.dy })) };
                             }
                             return {
                                 ...el,
                                 points: (el as ArrowElement | LineElement).points.map(p => ({ x: p.x + offset.dx, y: p.y + offset.dy })) as [Point, Point],
                             };
                         }));
                     }
                     lastDragOffsets.current.clear();
                 } else {
                     commitAction(els => els);
                 }
            }
        }
        
        // Tear down drag RAF batcher and cached snap points
        if (dragRafBatcher.current) {
            dragRafBatcher.current.cancel();
            dragRafBatcher.current = null;
        }
        cachedStaticSnap.current = null;

        interactionMode.current = null;
        currentDrawingElementId.current = null;
        setSelectionBox(null);
        setLassoPath(null);
        resizeStartInfo.current = null;
        cropStartInfo.current = null;
        setAlignmentGuides([]);
        dragStartElementPositions.current.clear();
    };

    const handleWheel = (e: WheelEvent | React.WheelEvent<SVGSVGElement>) => {
        e.preventDefault();
        const { clientX, clientY, deltaX, deltaY, ctrlKey } = e;

        if (ctrlKey || wheelAction === 'zoom') {
            const oldZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
            const normalizedDelta = Math.max(-180, Math.min(180, deltaY));
            const zoomFactor = Math.pow(1.0016, -normalizedDelta);
            const newZoom = oldZoom * zoomFactor;
            const clampedZoom = Math.max(0.1, Math.min(newZoom, 10));

            const svgBounds = svgRef.current?.getBoundingClientRect();
            const mousePoint = svgBounds
                ? { x: clientX - svgBounds.left, y: clientY - svgBounds.top }
                : { x: clientX, y: clientY };
            const newPanX = mousePoint.x - (mousePoint.x - panOffset.x) * (clampedZoom / oldZoom);
            const newPanY = mousePoint.y - (mousePoint.y - panOffset.y) * (clampedZoom / oldZoom);

            updateActiveBoard(b => ({ ...b, zoom: clampedZoom, panOffset: { x: newPanX, y: newPanY }}));

        } else { // Panning (wheelAction === 'pan' and no ctrlKey)
            updateActiveBoard(b => ({ ...b, panOffset: { x: b.panOffset.x - deltaX, y: b.panOffset.y - deltaY }}));
        }
    };

    return {
        // Event handlers
        handleMouseDown,
        handleMouseMove,
        handleMouseUp,
        handleWheel,
        getSelectableElement,
        // Interaction-only state
        selectionBox,
        setSelectionBox,
        alignmentGuides,
        lassoPath,
        dragTick,
        lastDragOffsets,
        // Refs needed by parent
        elementsRef,
        interactionMode,
        previousToolRef,
        spacebarDownTime,
    };
}
