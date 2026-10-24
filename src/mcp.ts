import { createMcpHandler, hostHeaderValidationResponse, McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { CanvasConflictError, CanvasNotFoundError, CanvasService, CanvasValidationError } from './canvas-service';
import { addElements, deleteElements, updateElements, type ElementInput, type ElementPatch } from './scene-mutations';

const toolOutput = z.object({
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: z.object({ code: z.string(), message: z.string(), currentRevision: z.number().int().optional(), details: z.unknown().optional() }).optional(),
});
const elementInput = z.object({
  id: z.string().optional(), type: z.enum(['rectangle', 'diamond', 'ellipse', 'text', 'line', 'arrow', 'freedraw', 'frame']),
  x: z.number(), y: z.number(), width: z.number().optional(), height: z.number().optional(), angle: z.number().optional(),
  text: z.string().optional(), points: z.array(z.tuple([z.number(), z.number()])).optional(), name: z.string().optional(),
  strokeColor: z.string().optional(), backgroundColor: z.string().optional(), fillStyle: z.string().optional(), strokeWidth: z.number().optional(),
  strokeStyle: z.string().optional(), roughness: z.number().optional(), opacity: z.number().optional(), groupIds: z.array(z.string()).optional(),
  frameId: z.string().nullable().optional(), roundness: z.unknown().optional(), link: z.string().nullable().optional(), locked: z.boolean().optional(),
  fontSize: z.number().optional(), fontFamily: z.number().optional(), textAlign: z.string().optional(), verticalAlign: z.string().optional(),
  lineHeight: z.number().optional(), containerId: z.string().nullable().optional(), autoResize: z.boolean().optional(),
  startBinding: z.object({ elementId: z.string(), focus: z.number().optional(), gap: z.number().optional() }).nullable().optional(),
  endBinding: z.object({ elementId: z.string(), focus: z.number().optional(), gap: z.number().optional() }).nullable().optional(),
  startArrowhead: z.string().nullable().optional(), endArrowhead: z.string().nullable().optional(),
  pressures: z.array(z.number()).optional(), simulatePressure: z.boolean().optional(),
}).strict();

function success(data: unknown, summary: string) {
  return { content: [{ type: 'text' as const, text: summary }], structuredContent: { ok: true, data } };
}

function failure(error: unknown) {
  let body: { code: string; message: string; currentRevision?: number; details?: unknown };
  if (error instanceof CanvasConflictError) body = { code: error.code, message: error.message, currentRevision: error.current.revision };
  else if (error instanceof CanvasNotFoundError) body = { code: error.code, message: error.message };
  else if (error instanceof CanvasValidationError) body = { code: error.code, message: error.message, details: error.details };
  else body = { code: 'internal_error', message: 'The operation failed' };
  return { isError: true, content: [{ type: 'text' as const, text: `${body.code}: ${body.message}` }], structuredContent: { ok: false, error: body } };
}

export function createHomescribbleMcp(service: CanvasService, baseUrl: string) {
  const server = new McpServer({ name: 'homescribble', version: '0.1.0' }, {
    instructions: 'Inspect a canvas before editing it. Pass its current revision as expectedRevision. On revision_conflict, read the canvas again and do not retry blindly.',
    maxToolInputElements: 2_000,
    cacheHints: { 'tools/list': { ttlMs: 60_000, cacheScope: 'private' } },
  });
  const urlFor = (id: string) => `${baseUrl}/canvas/${encodeURIComponent(id)}`;

  server.registerTool('list_canvases', {
    title: 'List canvases', description: 'List canvas metadata without scene contents, optionally filtering by exact project ID or title substring.',
    inputSchema: z.object({ projectId: z.string().optional(), title: z.string().optional() }).strict(), outputSchema: toolOutput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async filters => {
    try { const canvases = service.list(filters).map(canvas => ({ ...canvas, url: urlFor(canvas.id) })); return success({ canvases }, `Found ${canvases.length} canvas${canvases.length === 1 ? '' : 'es'}.`); }
    catch (error) { return failure(error); }
  });

  server.registerTool('get_canvas', {
    title: 'Get canvas', description: 'Return a complete persisted Excalidraw scene, its current revision, metadata, and browser URL.',
    inputSchema: z.object({ canvasId: z.string().min(1) }).strict(), outputSchema: toolOutput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ canvasId }) => {
    try { const canvas = service.get(canvasId); return success({ ...canvas, url: urlFor(canvas.id) }, `Read “${canvas.title}” at revision ${canvas.revision}.`); }
    catch (error) { return failure(error); }
  });

  server.registerTool('create_canvas', {
    title: 'Create canvas', description: 'Create a named empty canvas, optionally within an existing project.',
    inputSchema: z.object({ title: z.string().min(1).max(120), projectId: z.string().nullable().optional() }).strict(), outputSchema: toolOutput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ title, projectId }) => {
    try { const canvas = service.create(title, undefined, projectId); return success({ id: canvas.id, title: canvas.title, projectId: canvas.projectId, revision: canvas.revision, url: urlFor(canvas.id) }, `Created “${canvas.title}” at revision 0.`); }
    catch (error) { return failure(error); }
  });

  server.registerTool('add_elements', {
    title: 'Add elements', description: 'Normalize and atomically append up to 100 Excalidraw elements while preserving the rest of the scene.',
    inputSchema: z.object({ canvasId: z.string().min(1), expectedRevision: z.number().int().nonnegative(), elements: z.array(elementInput).min(1).max(100) }).strict(), outputSchema: toolOutput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ canvasId, expectedRevision, elements }) => {
    try { const canvas = service.mutate(canvasId, expectedRevision, scene => addElements(scene, elements as ElementInput[])); return success({ canvasId, revision: canvas.revision, elements: elements.map((element, index) => canvas.scene.elements[canvas.scene.elements.length - elements.length + index]?.id), url: urlFor(canvasId) }, `Added ${elements.length} element${elements.length === 1 ? '' : 's'}; canvas is now revision ${canvas.revision}.`); }
    catch (error) { return failure(error); }
  });

  server.registerTool('update_elements', {
    title: 'Update elements', description: 'Atomically patch mutable fields on up to 100 existing elements. IDs and element types cannot change.',
    inputSchema: z.object({ canvasId: z.string().min(1), expectedRevision: z.number().int().nonnegative(), updates: z.array(z.object({ id: z.string().min(1), patch: z.record(z.string(), z.unknown()) }).strict()).min(1).max(100) }).strict(), outputSchema: toolOutput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ canvasId, expectedRevision, updates }) => {
    try { const canvas = service.mutate(canvasId, expectedRevision, scene => updateElements(scene, updates as ElementPatch[])); return success({ canvasId, revision: canvas.revision, elementIds: updates.map(update => update.id), url: urlFor(canvasId) }, `Updated ${updates.length} element${updates.length === 1 ? '' : 's'}; canvas is now revision ${canvas.revision}.`); }
    catch (error) { return failure(error); }
  });

  server.registerTool('delete_elements', {
    title: 'Delete elements', description: 'Atomically soft-delete up to 100 elements and repair affected bindings.',
    inputSchema: z.object({ canvasId: z.string().min(1), expectedRevision: z.number().int().nonnegative(), elementIds: z.array(z.string().min(1)).min(1).max(100) }).strict(), outputSchema: toolOutput,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, async ({ canvasId, expectedRevision, elementIds }) => {
    try { const canvas = service.mutate(canvasId, expectedRevision, scene => deleteElements(scene, elementIds)); return success({ canvasId, revision: canvas.revision, elementIds, url: urlFor(canvasId) }, `Deleted ${elementIds.length} element${elementIds.length === 1 ? '' : 's'}; canvas is now revision ${canvas.revision}.`); }
    catch (error) { return failure(error); }
  });
  return server;
}

export function createMcpEndpoint(service: CanvasService) {
  const handler = createMcpHandler(ctx => createHomescribbleMcp(service, ctx.requestInfo ? new URL(ctx.requestInfo.url).origin : 'http://127.0.0.1:3000'), {
    legacy: 'stateless', responseMode: 'auto', maxRequestBodySize: 1024 * 1024,
    onerror: error => console.error('MCP request failed:', error.message),
  });
  return async (request: Request) => {
    const hostRejected = hostHeaderValidationResponse(request, ['127.0.0.1', 'localhost', '[::1]']);
    if (hostRejected) return hostRejected;
    const origin = request.headers.get('origin');
    if (origin && origin !== new URL(request.url).origin) return Response.json({ error: 'Origin rejected' }, { status: 403 });
    let operation = 'unknown';
    if (request.method === 'POST') {
      try { const body = await request.clone().json() as any; operation = body?.method === 'tools/call' ? `tools/call:${body?.params?.name ?? 'unknown'}` : String(body?.method ?? 'unknown'); } catch { /* The SDK returns the protocol parse error. */ }
    }
    const started = performance.now();
    const response = await handler.fetch(request);
    console.info(`MCP ${request.method} ${operation} -> ${response.status} (${Math.round(performance.now() - started)}ms)`);
    return response;
  };
}
