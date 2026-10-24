import { expect, test } from 'bun:test';
import { CanvasService } from '../src/canvas-service';
import { CanvasEventHub } from '../src/events';
import { createMcpEndpoint } from '../src/mcp';
import { openStore } from '../src/store';

async function call(endpoint: (request: Request) => Promise<Response>, body: unknown) {
  const response = await endpoint(new Request('http://127.0.0.1:3000/mcp', { method: 'POST', headers: { Host: '127.0.0.1:3000', 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify(body) }));
  const text = await response.text();
  const payload = response.headers.get('content-type')?.includes('text/event-stream') ? text.split('\n').find(line => line.startsWith('data: '))?.slice(6) : text;
  return { response, body: JSON.parse(payload || '{}') };
}

test('MCP initializes, discovers the bounded tool catalog, and performs revision-checked calls', async () => {
  const store = openStore(':memory:');
  const service = new CanvasService(store, new CanvasEventHub());
  const endpoint = createMcpEndpoint(service);
  try {
    const initialized = await call(endpoint, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } });
    expect(initialized.response.status).toBe(200);
    expect(initialized.body.result.serverInfo.name).toBe('homescribble');
    const listed = await call(endpoint, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    expect(listed.body.result.tools.map((tool: any) => tool.name)).toEqual(['list_canvases', 'get_canvas', 'create_canvas', 'add_elements', 'update_elements', 'delete_elements']);
    const created = await call(endpoint, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'create_canvas', arguments: { title: 'MCP canvas' } } });
    const data = created.body.result.structuredContent.data;
    expect(data.revision).toBe(0);
    const added = await call(endpoint, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'add_elements', arguments: { canvasId: data.id, expectedRevision: 0, elements: [{ id: 'box', type: 'rectangle', x: 0, y: 0, width: 50, height: 30 }] } } });
    expect(added.body.result.structuredContent.data.revision).toBe(1);
    const stale = await call(endpoint, { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'delete_elements', arguments: { canvasId: data.id, expectedRevision: 0, elementIds: ['box'] } } });
    expect(stale.body.result.isError).toBe(true);
    expect(stale.body.result.structuredContent.error).toMatchObject({ code: 'revision_conflict', currentRevision: 1 });
    expect(service.get(data.id).scene.elements[0].isDeleted).toBe(false);
  } finally { store.db.close(); }
});

test('MCP rejects foreign hosts and origins, invalid JSON, and unsupported methods', async () => {
  const store = openStore(':memory:');
  const endpoint = createMcpEndpoint(new CanvasService(store, new CanvasEventHub()));
  try {
    const badHost = await endpoint(new Request('http://evil.test/mcp', { method: 'POST', headers: { Host: 'evil.test', 'Content-Type': 'application/json' }, body: '{}' }));
    expect(badHost.status).toBe(403);
    const badOrigin = await endpoint(new Request('http://127.0.0.1:3000/mcp', { method: 'POST', headers: { Host: '127.0.0.1:3000', Origin: 'http://evil.test', 'Content-Type': 'application/json' }, body: '{}' }));
    expect(badOrigin.status).toBe(403);
    const invalid = await endpoint(new Request('http://127.0.0.1:3000/mcp', { method: 'POST', headers: { Host: '127.0.0.1:3000', 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: '{' }));
    expect(invalid.status).toBe(400);
    const unsupported = await call(endpoint, { jsonrpc: '2.0', id: 1, method: 'made/up', params: {} });
    expect(unsupported.body.error.code).toBe(-32601);
  } finally { store.db.close(); }
});
