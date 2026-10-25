import { exportToCanvas, FONT_FAMILY, restoreElements } from '@excalidraw/excalidraw';
import type { Scene } from './shared';

/** Browser-only: text measurement must happen after Excalidraw registers and
 * loads its font faces (document.fonts.ready alone doesn't initiate loading).
 * 0.18.1 has no public font loader; its public canvas export awaits that loader.
 * Use a disposable 1px export of text only, avoiding image loads and large canvases.
 */
export async function normalizeSceneDimensions(scene: Scene): Promise<Scene> {
  const text = scene.elements.filter(element => element.type === 'text' && !element.isDeleted);
  if (text.length) {
    await exportToCanvas({
      elements: structuredClone(text), files: {},
      getDimensions: () => ({ width: 1, height: 1, scale: 1 }),
    });
    // Excalidraw logs and swallows font load failures. Retry through FontFaceSet
    // so unavailable fonts don't silently produce persisted fallback metrics.
    await Promise.all(text.map(element => {
      const family = Object.entries(FONT_FAMILY).find(([, id]) => id === element.fontFamily)?.[0] || 'Excalifont';
      const fallback = family === 'Excalifont' ? ', Xiaolai, "Segoe UI Emoji"' : ', "Segoe UI Emoji"';
      return document.fonts.load(`16px "${family}"${fallback}`, element.originalText || element.text || ' ');
    }));
  }
  return {
    ...scene,
    // Restore may mutate nested binding/point data. Never mutate the session's
    // current snapshot while awaiting fonts or rendering an independent preview.
    elements: restoreElements(structuredClone(scene.elements), null, { repairBindings: true, refreshDimensions: true }),
  };
}
