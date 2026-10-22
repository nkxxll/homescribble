import index from './index.html';
import { openStore } from './store';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
const store = openStore(process.env.DATABASE_PATH || 'data/homescribble.sqlite');
async function backup() {
  const dir = process.env.BACKUP_DIR || 'data/backups';
  mkdirSync(dir, { recursive: true });
  await Bun.write(`${dir}/${new Date().toISOString().replaceAll(':', '-')}.sqlite`, store.db.serialize());
}
if (process.env.BACKUP_DISABLED !== '1') {
  await backup();
  setInterval(() => void backup().catch(console.error), 24 * 60 * 60 * 1000).unref();
}
const production = process.env.NODE_ENV === 'production';
if (production && !(await Bun.file('dist/index.html').exists())) throw new Error('Run bun run build before bun start.');
const frontend = production ? async (req: Request) => {
  const pathname = new URL(req.url).pathname;
  if (pathname === '/' || /^\/(canvas|project)\/[^/]+$/.test(pathname)) return new Response(Bun.file('dist/index.html'), { headers: { 'Cache-Control': 'no-cache' } });
  const path = resolve('dist', '.' + pathname);
  if (!path.startsWith(resolve('dist') + '/')) return new Response(null, { status: 404 });
  const file = Bun.file(path);
  return await file.exists() ? new Response(file) : new Response(null, { status: 404 });
} : index;
const server = Bun.serve({
  hostname: '127.0.0.1', port: Number(process.env.PORT || 3000),
  maxRequestBodySize: 30 * 1024 * 1024,
  development: process.env.NODE_ENV !== 'production' && { hmr: true, console: true },
  routes: {
  '/*': frontend,
  '/fonts/*': async req => {
    const path = resolve('node_modules/@excalidraw/excalidraw/dist/prod', '.' + new URL(req.url).pathname);
    if (!path.startsWith(resolve('node_modules/@excalidraw/excalidraw/dist/prod/fonts') + '/')) return new Response(null, { status: 404 });
    const file = Bun.file(path);
    return await file.exists() ? new Response(file) : new Response(null, { status: 404 });
  },
  '/api/*': async req => {
    const url = new URL(req.url);
    const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
    if (req.headers.get('origin') && req.headers.get('origin') !== url.origin) return json({ error: 'Origin rejected' }, 403);
    try {
      if (url.pathname === '/api/health') { store.db.query('SELECT 1').get(); return json({ status: 'ok' }); }
      const parts = url.pathname.split('/');
      if (url.pathname === '/api/search' && req.method === 'GET') return json(store.search(url.searchParams.get('q') || ''));
      if (parts[2] === 'projects') {
        const id = parts[3];
        if (parts.length > 4) return json({ error: 'Not found' }, 404);
        if (!id && req.method === 'GET') return json(store.listProjects());
        if (!id && req.method === 'POST') return json(store.createProject((await req.json()).title), 201);
        if (!id) return json({ error: 'Method not allowed' }, 405);
        const project = store.getProject(id);
        if (!project) return json({ error: 'Project not found' }, 404);
        if (req.method === 'GET') return json(project);
        if (req.method === 'PUT') return json(store.renameProject(id, (await req.json()).title));
        if (req.method === 'DELETE') { store.removeProject(id); return json({ ok: true }); }
        return json({ error: 'Method not allowed' }, 405);
      }
      if (parts[2] !== 'canvases') return json({ error: 'Not found' }, 404);
      const id = parts[3];
      if (!id && req.method === 'GET') return json(store.list());
      if (!id && req.method === 'POST') { const body = await req.json(); return json(store.create(body.title, body.scene, body.projectId), 201); }
      if (!id) return json({ error: 'Method not allowed' }, 405);
      const canvas = store.get(id);
      if (!canvas) return json({ error: 'Canvas not found' }, 404);
      if (req.method === 'POST' && parts[4] === 'duplicate') return json(store.create(`${canvas.title.slice(0, 113)} (copy)`, canvas.scene, canvas.projectId), 201);
      if (req.method === 'GET') return json(canvas);
      if (req.method === 'PUT') { const result = store.update(id, await req.json()); return json(result.body, result.status); }
      if (req.method === 'DELETE') { store.remove(id); return json({ ok: true }); }
      return json({ error: 'Method not allowed' }, 405);
    } catch (error) { return json({ error: error instanceof Error ? error.message : 'Request failed' }, 400); }
  },
  },
});
console.log(`Homescribble running at ${server.url}`);
