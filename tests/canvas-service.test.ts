import { expect, test } from 'bun:test';
import { CanvasConflictError, CanvasService } from '../src/canvas-service';
import { CanvasEventHub } from '../src/events';
import { addElements } from '../src/scene-mutations';
import { openStore } from '../src/store';

test('service commits an MCP batch once, preserves files, publishes after commit, and rejects stale writes', () => {
  const store = openStore(':memory:');
  const events = new CanvasEventHub();
  const service = new CanvasService(store, events);
  try {
    const scene = { elements: [{ id: 'image', type: 'image', fileId: 'asset' }], appState: { viewBackgroundColor: '#abc' }, files: { asset: { id: 'asset', dataURL: 'data:image/png;base64,aA==' } } };
    const canvas = service.create('Durable', scene);
    const received: unknown[] = [];
    events.subscribe(canvas.id, event => received.push({ event, storedRevision: store.get(canvas.id)?.revision }));
    const changed = service.mutate(canvas.id, 0, current => addElements(current, [{ id: 'box', type: 'rectangle', x: 1, y: 2, width: 3, height: 4 }]));
    expect(changed.revision).toBe(1);
    expect(changed.scene.files).toEqual(scene.files);
    expect(received).toEqual([{ event: { canvasId: canvas.id, revision: 1 }, storedRevision: 1 }]);
    expect(() => service.mutate(canvas.id, 0, current => current)).toThrow(CanvasConflictError);
    expect(store.get(canvas.id)?.revision).toBe(1);
  } finally { store.db.close(); }
});

test('service rolls back the entire batch when final scene validation fails', () => {
  const store = openStore(':memory:');
  const service = new CanvasService(store, new CanvasEventHub());
  try {
    const canvas = service.create('Atomic');
    expect(() => service.mutate(canvas.id, 0, scene => ({ ...scene, elements: [{ id: 'bad' }] } as any))).toThrow('Invalid element');
    expect(store.get(canvas.id)).toEqual(canvas);
  } finally { store.db.close(); }
});
