import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CanvasService } from '../src/canvas-service';
import { CanvasEventHub } from '../src/events';
import { addElements } from '../src/scene-mutations';
import { emptyScene } from '../src/shared';
import { openStore } from '../src/store';
import { thumbnailResponse } from '../src/thumbnail-api';
import { MAX_THUMBNAIL_BYTES } from '../src/thumbnail-data';

const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV1sAAAAASUVORK5CYII=', 'base64'));

test('thumbnail storage leaves scene revisions alone and retains cached images through metadata and camera changes', () => {
  const store = openStore(':memory:');
  try {
    const canvas = store.create('Drawing');
    expect(store.list()[0]?.thumbnailRevision).toBeNull();
    expect(store.saveThumbnail(canvas.id, 0, 'image/png', png)).toEqual({ status: 200, revision: 0 });
    expect(store.get(canvas.id)).toEqual(canvas);
    expect(store.list()[0]).toMatchObject({ thumbnailRevision: 0 });
    expect(store.list()[0]).not.toHaveProperty('scene');
    expect(store.list()[0]).not.toHaveProperty('data');
    const project = store.createProject('Ideas');
    store.update(canvas.id, { revision: 0, title: 'Renamed', projectId: project.id });
    store.update(canvas.id, { revision: 1, scene: { ...canvas.scene, appState: { ...canvas.scene.appState, zoom: { value: 2 }, scrollX: 100, scrollY: -200, theme: 'dark', currentItemStrokeColor: '#ff0000' } } });
    expect(store.getThumbnail(canvas.id)?.revision).toBe(0);
    // Another renderer at the current revision cannot replace an immutable URL.
    expect(store.saveThumbnail(canvas.id, 2, 'image/png', png)).toEqual({ status: 200, revision: 0 });
    store.removeProject(project.id);
    expect(store.getThumbnail(canvas.id)?.revision).toBe(0);
    const copy = store.create('Copy', store.get(canvas.id)!.scene);
    expect(store.getThumbnail(copy.id)).toBeNull();
    store.remove(canvas.id);
    expect(store.getThumbnail(canvas.id)).toBeNull();
    expect(store.saveThumbnail(canvas.id, 2, 'image/png', png)).toEqual({ status: 404 });
  } finally { store.db.close(); }
});

test('REST scene changes and MCP mutations invalidate thumbnails atomically and reject delayed uploads', () => {
  const store = openStore(':memory:');
  const service = new CanvasService(store, new CanvasEventHub());
  try {
    const canvas = service.create('Changing');
    store.saveThumbnail(canvas.id, 0, 'image/png', png);
    const colored = service.update(canvas.id, 0, { scene: { ...canvas.scene, appState: { viewBackgroundColor: '#aabbcc' } } }, 'rest');
    expect(store.getThumbnail(canvas.id)).toBeNull();
    expect(store.saveThumbnail(canvas.id, 0, 'image/png', png)).toEqual({ status: 409 });
    store.saveThumbnail(canvas.id, colored.revision, 'image/png', png);
    expect(() => service.mutate(canvas.id, 1, scene => ({ ...scene, elements: [{ id: 'bad' }] } as any))).toThrow();
    expect(store.getThumbnail(canvas.id)?.revision).toBe(1);
    service.mutate(canvas.id, 1, scene => addElements(scene, [{ id: 'box', type: 'rectangle', x: 0, y: 0, width: 100, height: 50 }]));
    expect(store.getThumbnail(canvas.id)).toBeNull();
    expect(store.saveThumbnail(canvas.id, 1, 'image/png', png)).toEqual({ status: 409 });
  } finally { store.db.close(); }
});

test('embedded image replacements and deletion invalidate previews while unused images do not', () => {
  const store = openStore(':memory:');
  try {
    const file = { id: 'image', dataURL: 'data:image/png;base64,YQ==' };
    const scene = { elements: [{ id: 'picture', type: 'image', fileId: 'image' }], appState: {}, files: { image: file } };
    const canvas = store.create('Image', scene);
    store.saveThumbnail(canvas.id, 0, 'image/png', png);
    const files = { image: file, unused: { id: 'unused', dataURL: 'data:image/png;base64,Yg==' } };
    store.update(canvas.id, { revision: 0, scene: { ...scene, files } });
    expect(store.getThumbnail(canvas.id)?.revision).toBe(0);
    store.update(canvas.id, { revision: 1, scene: { ...scene, files: { image: { ...file, dataURL: 'data:image/png;base64,Yw==' } } } });
    expect(store.getThumbnail(canvas.id)).toBeNull();
    store.saveThumbnail(canvas.id, 2, 'image/png', png);
    store.update(canvas.id, { revision: 2, scene: { ...scene, elements: [{ ...scene.elements[0], isDeleted: true }] } });
    expect(store.getThumbnail(canvas.id)).toBeNull();
  } finally { store.db.close(); }
});

test('version two databases migrate and thumbnails survive a serialized backup restore', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'homescribble-thumbnails-'));
  const path = join(directory, 'main.sqlite');
  let store = openStore(path);
  try {
    const canvas = store.create('Backed up');
    store.db.exec('DROP TABLE canvas_thumbnails; DELETE FROM migrations WHERE version=3');
    store.db.close();
    store = openStore(path);
    expect(store.get(canvas.id)).toEqual(canvas);
    expect(store.list()[0]?.thumbnailRevision).toBeNull();
    store.saveThumbnail(canvas.id, 0, 'image/png', png);
    store.db.close();
    store = openStore(path);
    expect(store.getThumbnail(canvas.id)?.data).toEqual(png);
    const backupPath = join(directory, 'backup.sqlite');
    await Bun.write(backupPath, store.db.serialize());
    const restored = openStore(backupPath);
    try {
      const row = restored.getThumbnail(canvas.id)!;
      expect(row.revision).toBe(0); expect(row.mimeType).toBe('image/png');
      expect(new Uint8Array(row.data)).toEqual(png);
      expect(restored.get(canvas.id)?.scene).toEqual(emptyScene());
    } finally { restored.db.close(); }
  } finally { store.db.close(); rmSync(directory, { recursive: true }); }
});

test('thumbnail HTTP endpoint serves revisioned images, supports revalidation, and rejects bad uploads', async () => {
  const store = openStore(':memory:');
  const canvas = store.create('HTTP');
  const request = (suffix = '', init?: RequestInit) => thumbnailResponse(new Request(`http://localhost/api/canvases/${canvas.id}/thumbnail${suffix}`, init), canvas.id, store);
  try {
    expect((await request()).status).toBe(404);
    expect((await request('', { method: 'PUT', body: png })).status).toBe(400);
    expect((await request('?revision=0', { method: 'PUT', headers: { 'Content-Type': 'image/svg+xml' }, body: '<svg/>' })).status).toBe(400);
    expect((await request('?revision=0', { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: 'fake PNG' })).status).toBe(400);
    expect((await request('?revision=0', { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: new Uint8Array(MAX_THUMBNAIL_BYTES + 1) })).status).toBe(413);
    const saved = await request('?revision=0', { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: png });
    expect(saved.status).toBe(200); expect(await saved.json()).toEqual({ revision: 0 });
    const image = await request('?revision=0');
    expect(image.headers.get('content-type')).toBe('image/png');
    expect(image.headers.get('cache-control')).toContain('immutable');
    expect(image.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(png);
    expect((await request('?revision=0', { headers: { 'If-None-Match': image.headers.get('etag')! } })).status).toBe(304);
    expect((await request('?revision=1')).status).toBe(404);
    expect((await request('', { method: 'DELETE' })).status).toBe(405);
    store.update(canvas.id, { revision: 0, scene: { ...emptyScene(), appState: { viewBackgroundColor: '#ff0000' } } });
    expect((await request('?revision=0', { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: png })).status).toBe(409);
    expect((await request('?revision=0')).status).toBe(404);
    expect(store.getThumbnail(canvas.id)).toBeNull();
    store.remove(canvas.id);
    expect((await request('?revision=1', { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: png })).status).toBe(404);
  } finally { store.db.close(); }
});
