import { CanvasValidationError } from './canvas-service';
import { validateScene, type Scene } from './shared';

export const MAX_ELEMENTS_PER_CALL = 100;
export const MAX_SCENE_ELEMENTS = 10_000;
export const MAX_TEXT_LENGTH = 10_000;
const TYPES = new Set(['rectangle', 'diamond', 'ellipse', 'text', 'line', 'arrow', 'freedraw', 'frame']);
const COMMON_PATCHES = new Set([
  'x', 'y', 'width', 'height', 'angle', 'strokeColor', 'backgroundColor', 'fillStyle', 'strokeWidth', 'strokeStyle',
  'roughness', 'opacity', 'groupIds', 'frameId', 'roundness', 'link', 'locked', 'points', 'startBinding', 'endBinding',
  'startArrowhead', 'endArrowhead', 'text', 'originalText', 'fontSize', 'fontFamily', 'textAlign', 'verticalAlign',
  'lineHeight', 'containerId', 'autoResize', 'pressures', 'simulatePressure', 'lastCommittedPoint', 'name',
]);
const BASE_PATCHES = new Set(['x', 'y', 'width', 'height', 'angle', 'strokeColor', 'backgroundColor', 'fillStyle', 'strokeWidth', 'strokeStyle', 'roughness', 'opacity', 'groupIds', 'frameId', 'roundness', 'link', 'locked']);
const TYPE_PATCHES: Record<string, Set<string>> = {
  rectangle: new Set(), diamond: new Set(), ellipse: new Set(),
  frame: new Set(['name']),
  text: new Set(['text', 'originalText', 'fontSize', 'fontFamily', 'textAlign', 'verticalAlign', 'lineHeight', 'containerId', 'autoResize']),
  line: new Set(['points', 'startBinding', 'endBinding', 'startArrowhead', 'endArrowhead', 'lastCommittedPoint']),
  arrow: new Set(['points', 'startBinding', 'endBinding', 'startArrowhead', 'endArrowhead', 'lastCommittedPoint']),
  freedraw: new Set(['points', 'pressures', 'simulatePressure', 'lastCommittedPoint']),
};

export type ElementInput = Record<string, unknown> & { id?: string; type: string; x: number; y: number };
export type ElementPatch = { id: string; patch: Record<string, unknown> };

const nonce = () => crypto.getRandomValues(new Uint32Array(1))[0]! || 1;
function fail(message: string, details?: unknown): never { throw new CanvasValidationError(message, details); }
const finite = (value: unknown, field: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${field} must be a finite number`);
  return value;
};
const clone = <T>(value: T): T => structuredClone(value);

function id(value: unknown, field = 'id'): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) fail(`${field} must contain 1–128 letters, numbers, underscores, or hyphens`);
  return value;
}

function positive(value: unknown, field: string): number {
  const result = finite(value, field);
  if (result <= 0 || result > 100_000) fail(`${field} must be greater than 0 and at most 100000`);
  return result;
}

function points(value: unknown, field: string, minimum = 2): [number, number][] {
  if (!Array.isArray(value) || value.length < minimum || value.length > 10_000) fail(`${field} must contain ${minimum}–10000 points`);
  return value.map((point: unknown, index: number) => {
    if (!Array.isArray(point) || point.length !== 2) fail(`${field}[${index}] must be an [x, y] pair`);
    return [finite(point[0], `${field}[${index}][0]`), finite(point[1], `${field}[${index}][1]`)] as [number, number];
  });
}

function binding(value: unknown, field: string) {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== 'object') fail(`${field} must be null or a binding object`);
  const binding = value as Record<string, unknown>;
  return { elementId: id(binding.elementId, `${field}.elementId`), focus: finite(binding.focus ?? 0, `${field}.focus`), gap: finite(binding.gap ?? 0, `${field}.gap`) };
}

function common(input: ElementInput, type: string) {
  const now = Date.now();
  const element: Record<string, any> = {
    id: input.id ? id(input.id) : crypto.randomUUID(), type,
    x: finite(input.x, 'x'), y: finite(input.y, 'y'), width: 0, height: 0, angle: finite(input.angle ?? 0, 'angle'),
    strokeColor: input.strokeColor ?? '#1b1b1f', backgroundColor: input.backgroundColor ?? 'transparent',
    fillStyle: input.fillStyle ?? 'solid', strokeWidth: finite(input.strokeWidth ?? 2, 'strokeWidth'),
    strokeStyle: input.strokeStyle ?? 'solid', roughness: finite(input.roughness ?? 1, 'roughness'),
    opacity: finite(input.opacity ?? 100, 'opacity'), groupIds: clone(input.groupIds ?? []), frameId: input.frameId ?? null,
    roundness: input.roundness ?? null, seed: nonce(), version: 1, versionNonce: nonce(), isDeleted: false,
    boundElements: null, updated: now, link: input.link ?? null, locked: input.locked ?? false,
  };
  if (typeof element.strokeColor !== 'string' || typeof element.backgroundColor !== 'string') fail('Element colors must be strings');
  if (!Array.isArray(element.groupIds) || element.groupIds.some((groupId: unknown) => typeof groupId !== 'string')) fail('groupIds must be an array of strings');
  if (element.frameId !== null) element.frameId = id(element.frameId, 'frameId');
  return element;
}

// Server fallback only: exact font metrics and wrapping are repaired in the browser.
function estimateTextDimensions(text: string, fontSize: number, lineHeight: number) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  return {
    width: Math.max(1, Math.min(100_000, Math.max(...lines.map(line => Array.from(line).length)) * fontSize * 0.6)),
    height: Math.max(1, Math.min(100_000, lines.length * fontSize * lineHeight)),
  };
}

function normalize(input: ElementInput) {
  if (!input || typeof input !== 'object' || !TYPES.has(input.type)) fail(`Unsupported element type: ${String(input?.type)}`);
  const element = common(input, input.type);
  if (['rectangle', 'diamond', 'ellipse', 'frame'].includes(input.type)) {
    element.width = positive(input.width, 'width'); element.height = positive(input.height, 'height');
    if (input.type === 'frame') { element.name = typeof input.name === 'string' ? input.name.slice(0, 120) : null; element.strokeColor = input.strokeColor ?? '#bbb'; }
  } else if (input.type === 'text') {
    if (typeof input.text !== 'string' || !input.text.length || input.text.length > MAX_TEXT_LENGTH) fail(`text must contain 1–${MAX_TEXT_LENGTH} characters`);
    const text = input.text;
    const fontSize = positive(input.fontSize ?? 20, 'fontSize');
    element.text = text; element.originalText = text; element.fontSize = fontSize; element.fontFamily = input.fontFamily ?? 1;
    element.textAlign = input.textAlign ?? 'left'; element.verticalAlign = input.verticalAlign ?? 'top'; element.lineHeight = input.lineHeight ?? 1.25;
    element.containerId = input.containerId == null ? null : id(input.containerId, 'containerId'); element.autoResize = input.autoResize ?? true;
    const estimate = estimateTextDimensions(text, fontSize, positive(element.lineHeight, 'lineHeight'));
    element.width = input.width === undefined ? estimate.width : positive(input.width, 'width');
    element.height = input.height === undefined ? estimate.height : positive(input.height, 'height');
  } else {
    const normalizedPoints = points(input.points, 'points');
    element.points = normalizedPoints;
    element.width = input.width === undefined ? Math.max(1, ...normalizedPoints.map(point => Math.abs(point[0]))) : positive(input.width, 'width');
    element.height = input.height === undefined ? Math.max(1, ...normalizedPoints.map(point => Math.abs(point[1]))) : positive(input.height, 'height');
    if (input.type === 'arrow' || input.type === 'line') {
      element.lastCommittedPoint = null; element.startBinding = binding(input.startBinding, 'startBinding'); element.endBinding = binding(input.endBinding, 'endBinding');
      element.startArrowhead = input.startArrowhead ?? null; element.endArrowhead = input.type === 'arrow' ? (input.endArrowhead ?? 'arrow') : (input.endArrowhead ?? null);
    } else {
      element.pressures = Array.isArray(input.pressures) ? input.pressures.map((p, i) => finite(p, `pressures[${i}]`)) : [];
      element.simulatePressure = input.simulatePressure ?? true; element.lastCommittedPoint = null;
    }
  }
  return element;
}

function validateBatch(items: unknown[], noun: string) {
  if (!Array.isArray(items) || items.length < 1 || items.length > MAX_ELEMENTS_PER_CALL) fail(`${noun} must contain 1–${MAX_ELEMENTS_PER_CALL} items`);
}

function bump(element: Record<string, any>) {
  element.version = (Number.isInteger(element.version) ? element.version : 0) + 1;
  element.versionNonce = nonce(); element.updated = Date.now();
}

function repairBindings(elements: Record<string, any>[], alreadyChanged: Set<string>) {
  const before = new Map(elements.map(element => [element.id, JSON.stringify({ frameId: element.frameId, boundElements: element.boundElements, startBinding: element.startBinding, endBinding: element.endBinding, containerId: element.containerId })]));
  const live = new Map(elements.filter(element => !element.isDeleted).map(element => [element.id, element]));
  for (const element of elements) {
    if (element.isDeleted) { element.boundElements = null; continue; }
    if (element.frameId && (!live.has(element.frameId) || live.get(element.frameId)?.type !== 'frame')) element.frameId = null;
    if (element.type === 'arrow' || element.type === 'line') {
      for (const key of ['startBinding', 'endBinding'] as const) if (element[key] && !live.has(element[key].elementId)) element[key] = null;
    }
    if (element.type === 'text' && element.containerId && !live.has(element.containerId)) element.containerId = null;
    const preserved = Array.isArray(element.boundElements) ? element.boundElements.filter((bound: any) => bound && bound.type !== 'arrow' && bound.type !== 'text') : [];
    element.boundElements = preserved.length ? preserved : null;
  }
  const addBound = (targetId: string | undefined, value: { id: string; type: string }) => {
    const target = targetId && live.get(targetId); if (!target) return;
    const values = Array.isArray(target.boundElements) ? target.boundElements : [];
    if (!values.some((bound: any) => bound.id === value.id && bound.type === value.type)) values.push(value);
    target.boundElements = values;
  };
  for (const element of live.values()) {
    if (element.type === 'arrow' || element.type === 'line') {
      addBound(element.startBinding?.elementId, { id: element.id, type: 'arrow' });
      addBound(element.endBinding?.elementId, { id: element.id, type: 'arrow' });
    }
    if (element.type === 'text' && element.containerId) addBound(element.containerId, { id: element.id, type: 'text' });
  }
  for (const element of elements) {
    const after = JSON.stringify({ frameId: element.frameId, boundElements: element.boundElements, startBinding: element.startBinding, endBinding: element.endBinding, containerId: element.containerId });
    if (!alreadyChanged.has(element.id) && before.get(element.id) !== after) bump(element);
  }
}

function finish(scene: Scene, elements: Record<string, any>[], changed: Set<string>) {
  if (elements.length > MAX_SCENE_ELEMENTS) fail(`A canvas may contain at most ${MAX_SCENE_ELEMENTS} elements`);
  repairBindings(elements, changed);
  return validateScene({ elements, appState: scene.appState, files: scene.files });
}

export function addElements(scene: Scene, inputs: ElementInput[]): Scene {
  validateBatch(inputs, 'elements');
  const elements = clone(scene.elements);
  const ids = new Set(elements.map(element => element.id));
  for (const input of inputs) {
    const element = normalize(input);
    if (ids.has(element.id)) fail(`Duplicate element id: ${element.id}`, { id: element.id });
    ids.add(element.id); elements.push(element);
  }
  return finish(scene, elements, new Set(elements.slice(scene.elements.length).map(element => element.id)));
}

export function updateElements(scene: Scene, patches: ElementPatch[]): Scene {
  validateBatch(patches, 'updates');
  const elements = clone(scene.elements) as Record<string, any>[];
  const byId = new Map(elements.map(element => [element.id, element]));
  const seen = new Set<string>();
  for (const item of patches) {
    const elementId = id(item?.id);
    if (seen.has(elementId)) fail(`Duplicate update id: ${elementId}`); seen.add(elementId);
    const element = byId.get(elementId);
    if (!element || element.isDeleted) fail(`Element not found: ${elementId}`, { id: elementId });
    if (!item.patch || typeof item.patch !== 'object' || Array.isArray(item.patch)) fail(`patch for ${elementId} must be an object`);
    for (const [key, value] of Object.entries(item.patch)) {
      if (key === 'id' || key === 'type' || key === 'version' || key === 'versionNonce' || key === 'updated' || key === 'isDeleted' || key === 'boundElements' || !COMMON_PATCHES.has(key)) fail(`Field cannot be updated: ${key}`, { id: elementId, field: key });
      if (!BASE_PATCHES.has(key) && !TYPE_PATCHES[element.type]?.has(key)) fail(`Field ${key} cannot be updated on a ${element.type}`, { id: elementId, field: key });
      if (['x', 'y', 'angle', 'strokeWidth', 'roughness', 'opacity', 'fontSize', 'lineHeight'].includes(key)) finite(value, key);
      if (['width', 'height'].includes(key)) positive(value, key);
      if (key === 'text' || key === 'originalText') {
        if (element.type !== 'text' || typeof value !== 'string' || !value.length || value.length > MAX_TEXT_LENGTH) fail(`text must contain 1–${MAX_TEXT_LENGTH} characters`);
      }
      if (key === 'points') points(value, 'points');
      if (key === 'startBinding' || key === 'endBinding') element[key] = binding(value, key);
      else if (key === 'containerId' || key === 'frameId') element[key] = value == null ? null : id(value, key);
      else element[key] = clone(value);
    }
    if ('text' in item.patch && !('originalText' in item.patch)) element.originalText = element.text;
    if (element.type === 'text' && ['text', 'fontSize', 'fontFamily', 'lineHeight'].some(key => key in item.patch)) {
      const estimate = estimateTextDimensions(element.text, positive(element.fontSize, 'fontSize'), positive(element.lineHeight, 'lineHeight'));
      if (!('width' in item.patch) && element.autoResize && !element.containerId) element.width = estimate.width;
      if (!('height' in item.patch)) element.height = estimate.height;
    }
    bump(element);
  }
  return finish(scene, elements, seen);
}

export function deleteElements(scene: Scene, elementIds: string[]): Scene {
  validateBatch(elementIds, 'elementIds');
  const elements = clone(scene.elements) as Record<string, any>[];
  const byId = new Map(elements.map(element => [element.id, element]));
  const seen = new Set<string>();
  for (const value of elementIds) {
    const elementId = id(value);
    if (seen.has(elementId)) fail(`Duplicate element id: ${elementId}`); seen.add(elementId);
    const element = byId.get(elementId);
    if (!element || element.isDeleted) fail(`Element not found: ${elementId}`, { id: elementId });
    element.isDeleted = true; bump(element);
  }
  return finish(scene, elements, seen);
}
