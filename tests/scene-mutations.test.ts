import { describe, expect, test } from 'bun:test';
import { addElements, deleteElements, MAX_ELEMENTS_PER_CALL, updateElements } from '../src/scene-mutations';
import { emptyScene } from '../src/shared';

describe('scene element mutations', () => {
  test('normalizes supported elements with safe metadata and defaults', () => {
    const scene = addElements(emptyScene(), [
      { id: 'box', type: 'rectangle', x: 10, y: 20, width: 100, height: 50 },
      { id: 'label', type: 'text', x: 20, y: 30, text: 'Hello', containerId: 'box' },
      { id: 'arrow', type: 'arrow', x: 0, y: 0, points: [[0, 0], [50, 20]], endBinding: { elementId: 'box' } },
    ]);
    expect(scene.elements).toHaveLength(3);
    expect(scene.elements[0]).toMatchObject({ id: 'box', type: 'rectangle', version: 1, isDeleted: false, groupIds: [] });
    expect(scene.elements[1]).toMatchObject({ text: 'Hello', originalText: 'Hello', fontSize: 20 });
    expect(scene.elements[0].boundElements).toEqual(expect.arrayContaining([{ id: 'label', type: 'text' }, { id: 'arrow', type: 'arrow' }]));
  });

  test('rejects collisions, invalid geometry, oversized batches, and unsupported types without changing input', () => {
    const original = addElements(emptyScene(), [{ id: 'box', type: 'rectangle', x: 0, y: 0, width: 10, height: 10 }]);
    const snapshot = structuredClone(original);
    expect(() => addElements(original, [{ id: 'box', type: 'ellipse', x: 0, y: 0, width: 10, height: 10 }])).toThrow('Duplicate element id');
    expect(() => addElements(original, [{ type: 'rectangle', x: NaN, y: 0, width: 10, height: 10 }])).toThrow('finite');
    expect(() => addElements(original, [{ type: 'image', x: 0, y: 0, width: 10, height: 10 }])).toThrow('Unsupported');
    expect(() => addElements(original, Array.from({ length: MAX_ELEMENTS_PER_CALL + 1 }, (_, i) => ({ id: `r${i}`, type: 'rectangle', x: i, y: 0, width: 1, height: 1 })))).toThrow('1–100');
    expect(original).toEqual(snapshot);
  });

  test('whitelists patches, increments versions, and repairs bindings after soft deletion', () => {
    let scene = addElements(emptyScene(), [
      { id: 'box', type: 'rectangle', x: 0, y: 0, width: 100, height: 100 },
      { id: 'arrow', type: 'arrow', x: 10, y: 10, points: [[0, 0], [20, 20]], startBinding: { elementId: 'box' } },
    ]);
    scene = updateElements(scene, [{ id: 'box', patch: { x: 25, backgroundColor: '#eee' } }]);
    expect(scene.elements[0]).toMatchObject({ x: 25, version: 2, backgroundColor: '#eee' });
    expect(() => updateElements(scene, [{ id: 'box', patch: { id: 'other' } }])).toThrow('cannot be updated');
    expect(() => updateElements(scene, [{ id: 'box', patch: { type: 'diamond' } }])).toThrow('cannot be updated');
    scene = deleteElements(scene, ['box']);
    expect(scene.elements[0]).toMatchObject({ isDeleted: true, version: 3, boundElements: null });
    expect(scene.elements[1]).toMatchObject({ startBinding: null, version: 2 });
  });
});
