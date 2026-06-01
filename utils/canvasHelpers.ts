import type { Element, ImageElement, PathElement, Point, Board } from '../types';

export const generateId = () => `id_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

export type Rect = { x: number; y: number; width: number; height: number };
export type Guide = { type: 'v' | 'h'; position: number; start: number; end: number };
export const SNAP_THRESHOLD = 5; // pixels in screen space

export const getElementBounds = (element: Element, allElements: Element[] = []): { x: number; y: number; width: number; height: number } => {
    if (element.type === 'group') {
        const children = allElements.filter(el => el.parentId === element.id);
        if (children.length === 0) {
            return { x: element.x, y: element.y, width: element.width, height: element.height };
        }
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        children.forEach(child => {
            const bounds = getElementBounds(child, allElements);
            minX = Math.min(minX, bounds.x);
            minY = Math.min(minY, bounds.y);
            maxX = Math.max(maxX, bounds.x + bounds.width);
            maxY = Math.max(maxY, bounds.y + bounds.height);
        });
        return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }
    if (element.type === 'image' || element.type === 'shape' || element.type === 'text' || element.type === 'video') {
        return { x: element.x, y: element.y, width: element.width, height: element.height };
    }
    if (element.type === 'arrow' || element.type === 'line') {
        const { points } = element;
        const minX = Math.min(points[0].x, points[1].x);
        const maxX = Math.max(points[0].x, points[1].x);
        const minY = Math.min(points[0].y, points[1].y);
        const maxY = Math.max(points[0].y, points[1].y);
        return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }
    const { points } = element;
    if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
    let minX = points[0].x, maxX = points[0].x;
    let minY = points[0].y, maxY = points[0].y;
    for (const p of points) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
    }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
};

export const isPointInPolygon = (point: Point, polygon: Point[]): boolean => {
    let isInside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i].x, yi = polygon[i].y;
        const xj = polygon[j].x, yj = polygon[j].y;
        const intersect = ((yi > point.y) !== (yj > point.y)) &&
            (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
        if (intersect) isInside = !isInside;
    }
    return isInside;
};

export const rasterizeElement = (element: Exclude<Element, ImageElement>): Promise<{ href: string; mimeType: 'image/png' }> => {
    return new Promise((resolve, reject) => {
        const bounds = getElementBounds(element);
        if (bounds.width <= 0 || bounds.height <= 0) {
            return reject(new Error('Cannot rasterize an element with zero or negative dimensions.'));
        }

        const padding = 10;
        const svgWidth = bounds.width + padding * 2;
        const svgHeight = bounds.height + padding * 2;
        
        const offsetX = -bounds.x + padding;
        const offsetY = -bounds.y + padding;

        let elementSvgString = '';
        
        switch (element.type) {
            case 'path': {
                const pointsWithOffset = element.points.map(p => ({ x: p.x + offsetX, y: p.y + offsetY }));
                const pathData = pointsWithOffset.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
                elementSvgString = `<path d="${pathData}" stroke="${element.strokeColor}" stroke-width="${element.strokeWidth}" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="${element.strokeOpacity || 1}" />`;
                break;
            }
            case 'shape': {
                const shapeProps = `transform="translate(${element.x + offsetX}, ${element.y + offsetY})" fill="${element.fillColor}" stroke="${element.strokeColor}" stroke-width="${element.strokeWidth}"`;
                if (element.shapeType === 'rectangle') elementSvgString = `<rect width="${element.width}" height="${element.height}" rx="${element.borderRadius || 0}" ry="${element.borderRadius || 0}" ${shapeProps} />`;
                else if (element.shapeType === 'circle') elementSvgString = `<ellipse cx="${element.width/2}" cy="${element.height/2}" rx="${element.width/2}" ry="${element.height/2}" ${shapeProps} />`;
                else if (element.shapeType === 'triangle') elementSvgString = `<polygon points="${element.width/2},0 0,${element.height} ${element.width},${element.height}" ${shapeProps} />`;
                break;
            }
            case 'arrow': {
                 const [start, end] = element.points;
                 const angle = Math.atan2(end.y - start.y, end.x - start.x);
                 const headLength = element.strokeWidth * 4;

                 const arrowHeadHeight = headLength * Math.cos(Math.PI / 6);
                 const lineEnd = {
                     x: end.x - arrowHeadHeight * Math.cos(angle),
                     y: end.y - arrowHeadHeight * Math.sin(angle),
                 };

                 const headPoint1 = { x: end.x - headLength * Math.cos(angle - Math.PI / 6), y: end.y - headLength * Math.sin(angle - Math.PI / 6) };
                 const headPoint2 = { x: end.x - headLength * Math.cos(angle + Math.PI / 6), y: end.y - headLength * Math.sin(angle + Math.PI / 6) };
                 elementSvgString = `
                    <line x1="${start.x + offsetX}" y1="${start.y + offsetY}" x2="${lineEnd.x + offsetX}" y2="${lineEnd.y + offsetY}" stroke="${element.strokeColor}" stroke-width="${element.strokeWidth}" stroke-linecap="round" />
                    <polygon points="${end.x + offsetX},${end.y + offsetY} ${headPoint1.x + offsetX},${headPoint1.y + offsetY} ${headPoint2.x + offsetX},${headPoint2.y + offsetY}" fill="${element.strokeColor}" />
                 `;
                break;
            }
            case 'line': {
                 const [start, end] = element.points;
                 elementSvgString = `<line x1="${start.x + offsetX}" y1="${start.y + offsetY}" x2="${end.x + offsetX}" y2="${end.y + offsetY}" stroke="${element.strokeColor}" stroke-width="${element.strokeWidth}" stroke-linecap="round" />`;
                break;
            }
            case 'text': {
                 elementSvgString = `
                    <foreignObject x="${offsetX}" y="${offsetY}" width="${element.width}" height="${element.height}">
                        <div xmlns="http://www.w3.org/1999/xhtml" style="font-size: ${element.fontSize}px; color: ${element.fontColor}; width: 100%; height: 100%; word-break: break-word; font-family: sans-serif; padding:0; margin:0; line-height: 1.2;">
                            ${element.text.replace(/\n/g, '<br />')}
                        </div>
                    </foreignObject>
                 `;
                 elementSvgString = elementSvgString.replace(`x="${offsetX}"`, `x="${element.x + offsetX}"`).replace(`y="${offsetY}"`, `y="${element.y + offsetY}"`);
                break;
            }
            case 'video':
            case 'group': {
                elementSvgString = '';
                break;
            }
        }

        const fullSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}">${elementSvgString}</svg>`;
        
        const img = new Image();
        img.crossOrigin = "anonymous";
        const svgDataUrl = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(fullSvg)))}`;

        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = svgWidth;
            canvas.height = svgHeight;
            const ctx = canvas.getContext('2d');
            if (ctx) {
                ctx.drawImage(img, 0, 0);
                resolve({ href: canvas.toDataURL('image/png'), mimeType: 'image/png' });
            } else {
                reject(new Error('Could not get canvas context.'));
            }
        };
        img.onerror = (err) => {
            reject(new Error(`Failed to load SVG into image: ${err}`));
        };
        img.src = svgDataUrl;
    });
};

export const rasterizeElements = (elementsToRasterize: Exclude<Element, ImageElement>[]): Promise<{ href: string; mimeType: 'image/png', width: number, height: number }> => {
    return new Promise((resolve, reject) => {
        if (elementsToRasterize.length === 0) {
            return reject(new Error("No elements to rasterize."));
        }

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        elementsToRasterize.forEach(element => {
            const bounds = getElementBounds(element);
            minX = Math.min(minX, bounds.x);
            minY = Math.min(minY, bounds.y);
            maxX = Math.max(maxX, bounds.x + bounds.width);
            maxY = Math.max(maxY, bounds.y + bounds.height);
        });

        const combinedWidth = maxX - minX;
        const combinedHeight = maxY - minY;

        if (combinedWidth <= 0 || combinedHeight <= 0) {
            return reject(new Error('Cannot rasterize elements with zero or negative dimensions.'));
        }

        const padding = 10;
        const svgWidth = combinedWidth + padding * 2;
        const svgHeight = combinedHeight + padding * 2;
        
        const elementSvgStrings = elementsToRasterize.map(element => {
            const offsetX = -minX + padding;
            const offsetY = -minY + padding;

            let elementSvgString = '';
            switch (element.type) {
                 case 'path': {
                    const pointsWithOffset = element.points.map(p => ({ x: p.x + offsetX, y: p.y + offsetY }));
                    const pathData = pointsWithOffset.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
                    elementSvgString = `<path d="${pathData}" stroke="${element.strokeColor}" stroke-width="${element.strokeWidth}" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="${element.strokeOpacity || 1}" />`;
                    break;
                 }
                case 'shape': {
                    const shapeProps = `transform="translate(${element.x + offsetX}, ${element.y + offsetY})" fill="${element.fillColor}" stroke="${element.strokeColor}" stroke-width="${element.strokeWidth}"`;
                    if (element.shapeType === 'rectangle') elementSvgString = `<rect width="${element.width}" height="${element.height}" rx="${element.borderRadius || 0}" ry="${element.borderRadius || 0}" ${shapeProps} />`;
                    else if (element.shapeType === 'circle') elementSvgString = `<ellipse cx="${element.width/2}" cy="${element.height/2}" rx="${element.width/2}" ry="${element.height/2}" ${shapeProps} />`;
                    else if (element.shapeType === 'triangle') elementSvgString = `<polygon points="${element.width/2},0 0,${element.height} ${element.width},${element.height}" ${shapeProps} />`;
                    break;
                }
                case 'arrow': {
                     const [start, end] = element.points;
                     const angle = Math.atan2(end.y - start.y, end.x - start.x);
                     const headLength = element.strokeWidth * 4;

                     const arrowHeadHeight = headLength * Math.cos(Math.PI / 6);
                     const lineEnd = {
                        x: end.x - arrowHeadHeight * Math.cos(angle),
                        y: end.y - arrowHeadHeight * Math.sin(angle),
                     };

                     const headPoint1 = { x: end.x - headLength * Math.cos(angle - Math.PI / 6), y: end.y - headLength * Math.sin(angle - Math.PI / 6) };
                     const headPoint2 = { x: end.x - headLength * Math.cos(angle + Math.PI / 6), y: end.y - headLength * Math.sin(angle + Math.PI / 6) };
                     elementSvgString = `
                        <line x1="${start.x + offsetX}" y1="${start.y + offsetY}" x2="${lineEnd.x + offsetX}" y2="${lineEnd.y + offsetY}" stroke="${element.strokeColor}" stroke-width="${element.strokeWidth}" stroke-linecap="round" />
                        <polygon points="${end.x + offsetX},${end.y + offsetY} ${headPoint1.x + offsetX},${headPoint1.y + offsetY} ${headPoint2.x + offsetX},${headPoint2.y + offsetY}" fill="${element.strokeColor}" />
                     `;
                    break;
                }
                 case 'line': {
                     const [start, end] = element.points;
                     elementSvgString = `<line x1="${start.x + offsetX}" y1="${start.y + offsetY}" x2="${end.x + offsetX}" y2="${end.y + offsetY}" stroke="${element.strokeColor}" stroke-width="${element.strokeWidth}" stroke-linecap="round" />`;
                    break;
                 }
                case 'text': {
                     elementSvgString = `
                        <foreignObject x="${element.x + offsetX}" y="${element.y + offsetY}" width="${element.width}" height="${element.height}">
                            <div xmlns="http://www.w3.org/1999/xhtml" style="font-size: ${element.fontSize}px; color: ${element.fontColor}; width: 100%; height: 100%; word-break: break-word; font-family: sans-serif; padding:0; margin:0; line-height: 1.2;">
                                ${element.text.replace(/\n/g, '<br />')}
                            </div>
                        </foreignObject>
                     `;
                    break;
                }
                case 'video':
                case 'group': {
                    elementSvgString = '';
                    break;
                }
            }
            return elementSvgString;
        }).join('');

        const fullSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}">${elementSvgStrings}</svg>`;
        
        const img = new Image();
        img.crossOrigin = "anonymous";
        const svgDataUrl = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(fullSvg)))}`;

        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = svgWidth;
            canvas.height = svgHeight;
            const ctx = canvas.getContext('2d');
            if (ctx) {
                ctx.drawImage(img, 0, 0);
                resolve({ 
                    href: canvas.toDataURL('image/png'), 
                    mimeType: 'image/png',
                    width: svgWidth,
                    height: svgHeight
                });
            } else {
                reject(new Error('Could not get canvas context.'));
            }
        };
        img.onerror = (err) => {
            reject(new Error(`Failed to load SVG into image: ${err}`));
        };
        img.src = svgDataUrl;
    });
};

export const rasterizeMask = (
    maskPaths: PathElement[],
    baseImage: ImageElement
): Promise<{ href: string; mimeType: 'image/png' }> => {
    return new Promise((resolve, reject) => {
        const { width, height, x: imageX, y: imageY } = baseImage;
        if (width <= 0 || height <= 0) {
            return reject(new Error('Base image has invalid dimensions.'));
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return reject(new Error('Could not get canvas context for mask.'));
        }

        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, width, height);

        ctx.strokeStyle = 'white';
        ctx.fillStyle = 'white';
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        maskPaths.forEach(path => {
            ctx.lineWidth = path.strokeWidth;
            ctx.beginPath();
            
            if (path.points.length === 1) {
                const point = path.points[0];
                ctx.arc(point.x - imageX, point.y - imageY, path.strokeWidth / 2, 0, 2 * Math.PI);
                ctx.fill();
            } else if (path.points.length > 1) {
                const startPoint = path.points[0];
                ctx.moveTo(startPoint.x - imageX, startPoint.y - imageY);
                for (let i = 1; i < path.points.length; i++) {
                    const point = path.points[i];
                    ctx.lineTo(point.x - imageX, point.y - imageY);
                }
                ctx.stroke();
            }
        });

        resolve({ href: canvas.toDataURL('image/png'), mimeType: 'image/png' });
    });
};

export const createNewBoard = (name: string): Board => {
    const id = generateId();
    return {
        id,
        name,
        elements: [],
        history: [[]],
        historyIndex: 0,
        panOffset: { x: 0, y: 0 },
        zoom: 1,
        canvasBackgroundColor: '#FFFFFF',
    };
};

export const THEME_PALETTES = {
    light: {
        appBackground: '#f1ede3',
        canvasBackground: '#f4f1ea',
        uiBgColor: 'rgba(250, 249, 246, 0.92)',
        buttonBgColor: '#19c8b9',
    },
    dark: {
        appBackground: '#131210',
        canvasBackground: '#15140f',
        uiBgColor: 'rgba(32, 31, 29, 0.94)',
        buttonBgColor: '#3ad9c9',
    },
} as const;
