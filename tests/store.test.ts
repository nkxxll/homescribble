import { test, expect } from 'bun:test';
import { openStore } from '../src/store';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
test('scene and images survive reopen, revision conflicts, duplication, and backup restoration', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'homescribble-'));
  const path = join(dir, 'main.sqlite');
  const store = openStore(path);
  const scene = { elements: [{ id: 'image-1', type: 'image', fileId: 'asset-1' }], appState: { viewBackgroundColor: '#ffeecc', selectedElementIds: { secret: true } }, files: { 'asset-1': { id: 'asset-1', mimeType: 'image/png', dataURL: 'data:image/png;base64,aGVsbG8=', created: 1 } } };
  const canvas = store.create('Image canvas', scene);
  expect(canvas.scene.appState).not.toHaveProperty('selectedElementIds');
  expect(store.update(canvas.id, { revision: 0, title: 'Updated' }).status).toBe(200);
  expect(store.update(canvas.id, { revision: 0, title: 'Stale overwrite' }).status).toBe(409);
  expect(() => store.update(canvas.id, { revision: 1, scene: { ...scene, files: {} } })).toThrow('Missing image');
  await Bun.write(join(dir, 'backup.sqlite'), store.db.serialize());
  store.db.close();
  const reopened = openStore(path);
  expect(reopened.get(canvas.id)?.title).toBe('Updated');
  expect(reopened.get(canvas.id)?.scene.files).toEqual(scene.files);
  const copy = reopened.create('Copy', reopened.get(canvas.id)!.scene);
  expect(copy.id).not.toBe(canvas.id); expect(copy.scene).toEqual(reopened.get(canvas.id)!.scene);
  const restored = openStore(join(dir, 'backup.sqlite'));
  expect(restored.get(canvas.id)).toEqual(reopened.get(canvas.id));
  reopened.remove(canvas.id); expect(reopened.get(canvas.id)).toBeNull();
  reopened.db.close(); restored.db.close(); rmSync(dir, { recursive: true });
});

test('projects organize canvases, search both types, and preserve drawings on deletion', () => {
  const store = openStore(':memory:');
  try {
    const project = store.createProject('Kitchen ideas');
    const other = store.createProject('Garden');
    const first = store.create('Kitchen plan', undefined, project.id);
    const second = store.create('Lighting', undefined, project.id);
    const loose = store.create('Kitchen loose sketch');
    expect(store.getProject(project.id)?.canvasCount).toBe(2);
    expect(store.search(' KITCHEN ').projects.map(p => p.id)).toEqual([project.id]);
    expect(store.search('kitchen').canvases.map(c => c.id).sort()).toEqual([first.id, loose.id].sort());
    expect(store.search('missing')).toEqual({ projects: [], canvases: [] });
    expect(() => store.createProject('  ')).toThrow();
    expect(() => store.create('Invalid', undefined, 'missing')).toThrow('Project not found');
    expect(() => store.update(first.id, { revision: 0, projectId: 'missing', title: 'Bad' })).toThrow();
    expect(store.get(first.id)).toEqual(first);
    expect(store.update(first.id, { revision: 0, projectId: other.id }).status).toBe(200);
    expect(store.update(first.id, { revision: 0, projectId: null }).status).toBe(409);
    // Autosaves omit projectId and must preserve the latest membership.
    expect(store.update(first.id, { revision: 1, title: 'Updated drawing' }).status).toBe(200);
    expect(store.get(first.id)?.projectId).toBe(other.id);
    expect(store.update(first.id, { revision: 2, projectId: null }).status).toBe(200);
    expect(store.get(first.id)?.projectId).toBeNull();
    store.renameProject(project.id, 'Renamed project');
    expect(store.search('renamed').projects[0]?.id).toBe(project.id);
    store.removeProject(project.id);
    expect(store.get(second.id)).toEqual({ ...second, projectId: null });
    expect(store.update(second.id, { revision: second.revision, title: 'Still editable' }).status).toBe(200);
    expect(store.get(second.id)?.projectId).toBeNull();
    expect(store.getProject(other.id)?.canvasCount).toBe(0);
  } finally { store.db.close(); }
});

test('version one databases migrate without losing drawings and projects persist on reopen', async () => {
  const { Database } = await import('bun:sqlite');
  const dir = mkdtempSync(join(tmpdir(), 'homescribble-migration-'));
  const path = join(dir, 'old.sqlite');
  const legacy = new Database(path);
  legacy.exec('CREATE TABLE migrations (version INTEGER PRIMARY KEY); INSERT INTO migrations VALUES (1); CREATE TABLE canvases (id TEXT PRIMARY KEY, title TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, updatedAt TEXT NOT NULL, scene TEXT NOT NULL)');
  const scene = { elements: [], appState: {}, files: {} };
  legacy.query('INSERT INTO canvases VALUES (?, ?, ?, ?, ?)').run('legacy', 'Original', 7, '2026-10-16', JSON.stringify(scene));
  legacy.close();
  const store = openStore(path);
  expect(store.get('legacy')).toEqual({ id: 'legacy', title: 'Original', revision: 7, updatedAt: '2026-10-16', scene, projectId: null });
  const project = store.createProject('Persistent');
  store.update('legacy', { revision: 7, projectId: project.id });
  store.db.close();
  const reopened = openStore(path);
  try {
    expect(reopened.get('legacy')?.projectId).toBe(project.id);
    expect(reopened.getProject(project.id)?.canvasCount).toBe(1);
    expect(reopened.db.query('SELECT version FROM migrations').all()).toHaveLength(3);
  } finally { reopened.db.close(); rmSync(dir, { recursive: true }); }
});
