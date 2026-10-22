export type Scene = { elements: any[]; appState: Record<string, any>; files: Record<string, any> };
export type Canvas = { id: string; title: string; projectId: string | null; revision: number; updatedAt: string; scene: Scene };
export type Project = { id: string; title: string; updatedAt: string; canvasCount: number };
export type Summary = Omit<Canvas, 'scene'>;
export const emptyScene = (): Scene => ({ elements: [], appState: { viewBackgroundColor: '#ffffff' }, files: {} });
const settings = ['viewBackgroundColor', 'scrollX', 'scrollY', 'zoom', 'gridSize', 'gridModeEnabled', 'theme', 'currentItemStrokeColor', 'currentItemBackgroundColor', 'currentItemFillStyle', 'currentItemStrokeWidth', 'currentItemStrokeStyle', 'currentItemRoughness', 'currentItemOpacity', 'currentItemFontFamily', 'currentItemFontSize', 'currentItemTextAlign', 'currentItemStartArrowhead', 'currentItemEndArrowhead'];
export function sceneFrom(elements: readonly any[], state: Record<string, any>, files: Record<string, any>): Scene {
  return { elements: [...elements], appState: Object.fromEntries(settings.filter(k => state[k] !== undefined).map(k => [k, state[k]])), files };
}
export function validateScene(value: any): Scene {
  if (!value || !Array.isArray(value.elements) || !value.appState || typeof value.appState !== 'object' || !value.files || typeof value.files !== 'object') throw new Error('Invalid scene');
  for (const el of value.elements) {
    if (!el || typeof el.id !== 'string' || typeof el.type !== 'string') throw new Error('Invalid element');
    if (el.type === 'image' && !el.isDeleted && el.fileId && !value.files[el.fileId]) throw new Error('Missing image data');
  }
  for (const [id, file] of Object.entries(value.files) as [string, any][]) {
    if (!file || file.id !== id || typeof file.dataURL !== 'string' || !/^data:image\/(png|jpeg|gif|webp|svg\+xml);base64,/.test(file.dataURL)) throw new Error('Invalid image');
  }
  return sceneFrom(value.elements, value.appState, value.files);
}
export function validTitle(value: unknown) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 120) throw new Error('Title must contain 1–120 characters');
  return value.trim();
}
