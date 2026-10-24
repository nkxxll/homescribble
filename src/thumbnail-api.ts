import type { Store } from './canvas-service';
import { MAX_THUMBNAIL_BYTES } from './thumbnail-data';

export async function thumbnailResponse(req: Request, id: string, store: Store): Promise<Response> {
  const json = (body: unknown, status: number) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
  const url = new URL(req.url);
  if (req.method === 'GET') {
    const thumbnail = store.getThumbnail(id);
    const requestedRevision = url.searchParams.get('revision');
    if (!thumbnail || (requestedRevision !== null && requestedRevision !== String(thumbnail.revision))) return json({ error: 'Thumbnail not found' }, 404);
    const etag = `"${id}:${thumbnail.revision}"`;
    const headers = {
      'Content-Type': thumbnail.mimeType,
      'Cache-Control': requestedRevision !== null ? 'private, max-age=31536000, immutable' : 'private, no-cache',
      'X-Content-Type-Options': 'nosniff', ETag: etag,
    };
    if (req.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
    return new Response(new Uint8Array(thumbnail.data), { headers });
  }
  if (req.method === 'PUT') {
    const rawRevision = url.searchParams.get('revision');
    if (!rawRevision || !/^\d+$/.test(rawRevision) || !Number.isSafeInteger(Number(rawRevision))) return json({ error: 'Thumbnail revision required' }, 400);
    if (Number(req.headers.get('content-length')) > MAX_THUMBNAIL_BYTES) return json({ error: 'Thumbnail exceeds 2 MB' }, 413);
    const reader = req.body?.getReader();
    if (!reader) return json({ error: 'Thumbnail image required' }, 400);
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_THUMBNAIL_BYTES) { await reader.cancel(); return json({ error: 'Thumbnail exceeds 2 MB' }, 413); }
      chunks.push(value);
    }
    const data = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
    try {
      const result = store.saveThumbnail(id, Number(rawRevision), req.headers.get('content-type') || '', data);
      if (result.status === 404) return json({ error: 'Canvas not found' }, 404);
      if (result.status === 409) return json({ error: 'Canvas changed while rendering thumbnail' }, 409);
      return json({ revision: result.revision }, 200);
    } catch (error) { return json({ error: error instanceof Error ? error.message : 'Invalid thumbnail' }, 400); }
  }
  return json({ error: 'Method not allowed' }, 405);
}
