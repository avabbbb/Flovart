import type { Element } from '../types';

export type CanvasElementType = Element['type'];

export interface CanvasElementDefinition<TType extends CanvasElementType = CanvasElementType> {
  type: TType;
  label: string;
  visibleInMenu: boolean;
  canSource: boolean;
  canTarget: boolean;
  canGenerate: boolean;
  canBeReferenced: boolean;
  canAcceptReferences: boolean;
  defaultSize?: { width: number; height: number };
}

export const canvasElementDefinitions: Record<CanvasElementType, CanvasElementDefinition> = {
  image: {
    type: 'image',
    label: 'Image',
    visibleInMenu: true,
    canSource: true,
    canTarget: true,
    canGenerate: true,
    canBeReferenced: true,
    canAcceptReferences: true,
    defaultSize: { width: 512, height: 512 },
  },
  video: {
    type: 'video',
    label: 'Video',
    visibleInMenu: true,
    canSource: true,
    canTarget: true,
    canGenerate: true,
    canBeReferenced: true,
    canAcceptReferences: true,
    defaultSize: { width: 640, height: 360 },
  },
  text: {
    type: 'text',
    label: 'Text',
    visibleInMenu: true,
    canSource: true,
    canTarget: false,
    canGenerate: false,
    canBeReferenced: true,
    canAcceptReferences: false,
    defaultSize: { width: 320, height: 160 },
  },
  shape: {
    type: 'shape',
    label: 'Shape',
    visibleInMenu: true,
    canSource: false,
    canTarget: false,
    canGenerate: false,
    canBeReferenced: true,
    canAcceptReferences: false,
    defaultSize: { width: 180, height: 120 },
  },
  path: {
    type: 'path',
    label: 'Path',
    visibleInMenu: false,
    canSource: false,
    canTarget: false,
    canGenerate: false,
    canBeReferenced: false,
    canAcceptReferences: false,
  },
  arrow: {
    type: 'arrow',
    label: 'Arrow',
    visibleInMenu: true,
    canSource: false,
    canTarget: false,
    canGenerate: false,
    canBeReferenced: false,
    canAcceptReferences: false,
  },
  line: {
    type: 'line',
    label: 'Line',
    visibleInMenu: true,
    canSource: false,
    canTarget: false,
    canGenerate: false,
    canBeReferenced: false,
    canAcceptReferences: false,
  },
  group: {
    type: 'group',
    label: 'Group',
    visibleInMenu: false,
    canSource: false,
    canTarget: false,
    canGenerate: false,
    canBeReferenced: false,
    canAcceptReferences: false,
  },
};

export function getElementDefinition(type: CanvasElementType): CanvasElementDefinition {
  return canvasElementDefinitions[type];
}

export function elementCanSource(element: Pick<Element, 'type'> | null | undefined): boolean {
  return !!element && canvasElementDefinitions[element.type]?.canSource === true;
}

export function elementCanTarget(element: Pick<Element, 'type'> | null | undefined): boolean {
  return !!element && canvasElementDefinitions[element.type]?.canTarget === true;
}

export function getMenuElementDefinitions(): CanvasElementDefinition[] {
  return Object.values(canvasElementDefinitions).filter((definition) => definition.visibleInMenu);
}
