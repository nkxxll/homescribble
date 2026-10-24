import type { Scene } from './shared';

export const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;
export type Thumbnail = { revision: number; mimeType: string; data: Uint8Array };

// Camera position, theme, and the current drawing tool do not affect the
// full-content, light-mode export used by cards.
export function thumbnailSceneKey(scene: Scene) {
  const elements = scene.elements.filter(element => !element.isDeleted);
  const fileIds = [...new Set(elements.filter(element => element.type === 'image').map(element => element.fileId))].sort();
  return JSON.stringify({
    elements,
    background: scene.appState.viewBackgroundColor || '#ffffff',
    files: fileIds.map(id => scene.files[id]?.dataURL),
  });
}

export function validateThumbnail(mimeType: string, data: Uint8Array) {
  if (!data.length || data.length > MAX_THUMBNAIL_BYTES) throw new Error('Thumbnail must be between 1 byte and 2 MB');
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => data[index] === byte);
  const webp = new TextDecoder().decode(data.subarray(0, 4)) === 'RIFF' && new TextDecoder().decode(data.subarray(8, 12)) === 'WEBP';
  if (!((mimeType === 'image/png' && png) || (mimeType === 'image/webp' && webp))) throw new Error('Thumbnail must be a PNG or WebP image');
}
