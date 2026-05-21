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
    // Editing
    editingElement: { id: string; text: string } | null;
    setEditingElement: React.Dispatch<React.SetStateAction<{ id: string; text: string } | null>>;
    // Cropping
    croppingState: { elementId: string; originalElement: ImageElement; cropBox: Rect } | null;
    setCroppingState: React.Dispatch<React.SetStateAction<{ elementId: string; originalElement: ImageElement; cropBox: Rect } | null>>;
    // Inpaint
    setInpaintState: React.Dispatch<React.SetStateAction<{ targetImageId: string; maskPoints: Point[]; promptVisible: boolean } | null>>;
    setInpaintPrompt: React.Dispatch<React.SetStateAction<string>>;
    // Mask
    maskEditingId: string | null;
    paintMask: (x: number, y: number) => void;
    // Context menu
    contextMenu: { x: number; y: number; elementId: string | null } | null;
    setContextMenu: React.Dispatch<React.SetStateAction<{ x: number; y: number; elementId: string | null } | null>>;
    // Board management
    updateActiveBoard: (updater: (board: Board) => Board) => void;
    setElements: (updater: (prev: Element[]) => Element[], commit?: boolean) => void;
    commitAction: (updater: (prev: Element[]) => Element[]) => void;
    // Helpers
    getDescendants: (id: string, els: Element[]) => Element[];
    onElementDoubleClick?: (element: Element) => void;
}

export function useCanvasInteraction(params: UseCanvasInteractionParams) {
    const {
        elements, zoom, panOffset,
        activeTool, setActiveTool, drawingOptions, wheelAction,
        selectedElementIds, setSelectedElementIds,
        editingElement, setEditingElement,
        croppingState, setCroppingState,
        setInpaintState, setInpaintPrompt,
        maskEditingId, paintMask,
        contextMenu, setContextMenu,
        updateActiveBoard, setElements, commitAction,
        getDescendants,
        onElementDoubleClick,
    } = params;

    // --- Interaction-only state ---
    const [selectionBox, setSelectionBox] = useState<Rect | null>(null);
    const [alignmentGuides, setAlignmentGuides] = useState<Guide[]>([]);
    const [lassoPath, setLassoPath] = useState<Point[] | null>(null);

    // --- Interaction refs ---
    const interactionMode = useRef<string | null>(null);
    const startPoint = useRef<Point>({ x: 0, y: 0 });
    const currentDrawingElementId = useRef<string | null>(null);
    const resizeStartInfo = useRef<{ originalElement: ImageElement | ShapeElement | TextElement | VideoElement; startCanvasPoint: Point; handle: string; shiftKey: boolean } | null>(null);
    const cropStartInfo = useRef<{ originalCropBox: Rect; startCanvasPoint: Point } | null>(null);
    const dragStartElementPositions = useRef<Map<string, { x: number; y: number } | Point[]>>(new Map());
    const cachedStaticSnap = useRef<{ v: Set<number>; h: Set<number> } | null>(null);
    const dragRafBatcher = useRef<RafBatcher<Point> | null>(null);
    const elementsRef = useRef(elements);
    const svgRef = useRef<SVGSVGElement>(null);
    const editingTextareaRef = useRef<HTMLTextAreaElement>(null);
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
        // Layer mask painting intercept
        if (maskEditingId && e.button === 0) {
            const pt = getCanvasPoint(e.clientX, e.clientY);
            paintMask(pt.x, pt.y);
            interactionMode.current = 'mask-paint' as any;
            e.preventDefault();
            return;
        }
        if (editingElement) return;
        if (contextMenu) setContextMenu(null);

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

        if (croppingState) {
             if (handleName) {
                 interactionMode.current = `crop-${handleName}`;
                 cropStartInfo.current = { originalCropBox: { ...croppingState.cropBox }, startCanvasPoint: canvasStartPoint };
             }
             return;
        }
         if (activeTool === 'text') {
            const newText: TextElement = {
                id: generateId(), type: 'text', name: 'Text',
                x: canvasStartPoint.x, y: canvasStartPoint.y,
                width: 150, height: 40,
                text: "Text", fontSize: 24, fontColor: drawingOptions.strokeColor
            };
            setElements(prev => [...prev, newText]);
            setSelectedElementIds([newText.id]);
            setEditingElement({ id: newText.id, text: newText.text });
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
                if (e.detail === 2) {
                    const doubleClickedElement = elements.find(el => el.id === selectableElementId);
                    if (doubleClickedElement?.type === 'text') {
                         setEditingElement({ id: doubleClickedElement.id, text: doubleClickedElement.text });
                         return;
                    }
                    if (doubleClickedElement) {
                        onElementDoubleClick?.(doubleClickedElement);
                        return;
                    }
                }
                if (!e.shiftKey && !selectedElementIds.includes(selectableElementId)) {
                     setSelectedElementIds([selectableElementId]);
                } else if (e.shiftKey) {
                    setSelectedElementIds(prev => 
                        prev.includes(selectableElementId) ? prev.filter(id => id !== selectableElementId) : [...prev, selectableElementId]
                    );
                }
                interactionMode.current = 'dragElements';
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
                setSelectedElementIds([]);
                interactionMode.current = 'selectBox';
                setSelectionBox({ x: canvasStartPoint.x, y: canvasStartPoint.y, width: 0, height: 0 });
            }
        }
    };

    const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
        // Layer mask painting intercept
        if (interactionMode.current === ('mask-paint' as any)) {
            const pt = getCanvasPoint(e.clientX, e.clientY);
            paintMask(pt.x, pt.y);
            return;
        }
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

        if (interactionMode.current.startsWith('crop-')) {
            if (!croppingState || !cropStartInfo.current) return;
            const handle = interactionMode.current.split('-')[1];
            const { originalCropBox, startCanvasPoint: cropStartPoint } = cropStartInfo.current;
            let { x, y, width, height } = { ...originalCropBox };
            const { originalElement } = croppingState;
            const dx = point.x - cropStartPoint.x;
            const dy = point.y - cropStartPoint.y;

            if (handle.includes('r')) { width = originalCropBox.width + dx; }
            if (handle.includes('l')) { width = originalCropBox.width - dx; x = originalCropBox.x + dx; }
            if (handle.includes('b')) { height = originalCropBox.height + dy; }
            if (handle.includes('t')) { height = originalCropBox.height - dy; y = originalCropBox.y + dy; }
            
            if (x < originalElement.x) {
                width += x - originalElement.x;
                x = originalElement.x;
            }
            if (y < originalElement.y) {
                height += y - originalElement.y;
                y = originalElement.y;
            }
            if (x + width > originalElement.x + originalElement.width) {
                width = originalElement.x + originalElement.width - x;
            }
            if (y + height > originalElement.y + originalElement.height) {
                height = originalElement.y + originalElement.height - y;
            }

            if (width < 1) {
                width = 1;
                if (handle.includes('l')) { x = originalCropBox.x + originalCropBox.width - 1; }
            }
            if (height < 1) {
                height = 1;
                if (handle.includes('t')) { y = originalCropBox.y + originalCropBox.height - 1; }
            }

            setCroppingState(prev => prev ? { ...prev, cropBox: { x, y, width, height } } : null);
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
                // Defer the heavy snap + position work to the next animation frame.
                // Only the latest pointer position is kept; earlier moves are dropped.
                if (!dragRafBatcher.current) {
                    dragRafBatcher.current = createRafBatcher<Point>(latestPoint => {
                        const dx = latestPoint.x - startCanvasPoint.x;
                        const dy = latestPoint.y - startCanvasPoint.y;
                
                        const movingElementIds = Array.from(dragStartElementPositions.current.keys());
                        const movingElements = elementsRef.current.filter(el => movingElementIds.includes(el.id));
                        const snapThresholdCanvas = SNAP_THRESHOLD / zoom;

                        let finalDx = dx;
                        let finalDy = dy;
                        let activeGuides: Guide[] = [];

                        const getSnapPoints = (bounds: Rect) => ({
                            v: [bounds.x, bounds.x + bounds.width / 2, bounds.x + bounds.width],
                            h: [bounds.y, bounds.y + bounds.height / 2, bounds.y + bounds.height],
                        });

                        // Use cached snap points computed at drag start
                        const staticSnapPoints = cachedStaticSnap.current ?? { v: new Set<number>(), h: new Set<number>() };
                
                        let bestSnapX = { dist: Infinity, val: finalDx, guide: null as Guide | null };
                        let bestSnapY = { dist: Infinity, val: finalDy, guide: null as Guide | null };
                
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
                                        bestSnapX = { dist, val: staticP - p, guide: { type: 'v', position: staticP, start: movingBounds.y, end: movingBounds.y + movingBounds.height }};
                                    }
                                });
                            });
                            movingSnapPoints.h.forEach(p => {
                                staticSnapPoints.h.forEach(staticP => {
                                    const dist = Math.abs((p + finalDy) - staticP);
                                    if (dist < snapThresholdCanvas && dist < bestSnapY.dist) {
                                        bestSnapY = { dist, val: staticP - p, guide: { type: 'h', position: staticP, start: movingBounds.x, end: movingBounds.x + movingBounds.width }};
                                    }
                                });
                            });
                        });
                
                        if (bestSnapX.guide) { finalDx = bestSnapX.val; activeGuides.push(bestSnapX.guide); }
                        if (bestSnapY.guide) { finalDy = bestSnapY.val; activeGuides.push(bestSnapY.guide); }
                
                        setAlignmentGuides(activeGuides);

                        setElements(prev => prev.map(el => {
                            if (movingElementIds.includes(el.id)) {
                                const startPos = dragStartElementPositions.current.get(el.id);
                                if (!startPos) return el;
                        
                                if (el.type !== 'path' && el.type !== 'arrow' && el.type !== 'line') {
                                    return { ...el, x: (startPos as Point).x + finalDx, y: (startPos as Point).y + finalDy };
                                }
                        
                                if (el.type === 'path') {
                                    const startPoints = startPos as Point[];
                                    const newPoints = startPoints.map(p => ({ x: p.x + finalDx, y: p.y + finalDy }));
                                    const updatedEl: PathElement = { ...el, points: newPoints };
                                    return updatedEl;
                                } else if (el.type === 'arrow' || el.type === 'line') {
                                    const startPoints = startPos as [Point, Point];
                                    const newPoints: [Point, Point] = [
                                        { x: startPoints[0].x + finalDx, y: startPoints[0].y + finalDy },
                                        { x: startPoints[1].x + finalDx, y: startPoints[1].y + finalDy },
                                    ];
                                    const updatedEl = { ...el, points: newPoints };
                                    return updatedEl;
                                }
                            }
                            return el;
                        }), false);
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
        // Layer mask painting intercept
        if (interactionMode.current === ('mask-paint' as any)) {
            interactionMode.current = null;
            return;
        }
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
                // Check if lasso is drawn ON TOP of a single selected image → trigger inpaint mode
                const singleImg = selectedElementIds.length === 1
                    ? elements.find(el => el.id === selectedElementIds[0] && el.type === 'image') as ImageElement | undefined
                    : undefined;
                if (singleImg) {
                    const imgBounds = getElementBounds(singleImg, elements);
                    const lassoCenter: Point = {
                        x: lassoPath.reduce((s, p) => s + p.x, 0) / lassoPath.length,
                        y: lassoPath.reduce((s, p) => s + p.y, 0) / lassoPath.length,
                    };
                    const isOnImage = lassoCenter.x >= imgBounds.x && lassoCenter.x <= imgBounds.x + imgBounds.width
                        && lassoCenter.y >= imgBounds.y && lassoCenter.y <= imgBounds.y + imgBounds.height;
                    if (isOnImage) {
                        // Enter inpaint mode
                        setInpaintState({ targetImageId: singleImg.id, maskPoints: [...lassoPath], promptVisible: true });
                        setInpaintPrompt('');
                        setLassoPath(null);
                        interactionMode.current = null;
                        currentDrawingElementId.current = null;
                        setSelectionBox(null);
                        resizeStartInfo.current = null;
                        cropStartInfo.current = null;
                        setAlignmentGuides([]);
                        dragStartElementPositions.current.clear();
                        return; // early exit — don't clear selection
                    }
                }
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
                 commitAction(els => els); // This effectively commits the current state to history
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
        if (croppingState || editingElement) { e.preventDefault(); return; }
        e.preventDefault();
        const { clientX, clientY, deltaX, deltaY, ctrlKey } = e;

        if (ctrlKey || wheelAction === 'zoom') {
            const zoomFactor = 1.05;
            const oldZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
            const newZoom = deltaY < 0 ? oldZoom * zoomFactor : oldZoom / zoomFactor;
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
        getCanvasPoint,
        getSelectableElement,
        // Interaction-only state
        selectionBox,
        setSelectionBox,
        alignmentGuides,
        lassoPath,
        // Refs needed by parent
        svgRef,
        editingTextareaRef,
        elementsRef,
        interactionMode,
        previousToolRef,
        spacebarDownTime,
    };
}
