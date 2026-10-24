import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { emptyScene, validTitle, validateScene, type Canvas, type Project, type Scene, type Summary } from './shared';
import { thumbnailSceneKey, validateThumbnail, type Thumbnail } from './thumbnail-data';
export function openStore(path: string) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });
  db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
  db.transaction(() => {
    db.exec('CREATE TABLE IF NOT EXISTS migrations (version INTEGER PRIMARY KEY)');
    if (!db.query('SELECT version FROM migrations WHERE version=1').get()) {
      db.exec('CREATE TABLE canvases (id TEXT PRIMARY KEY, title TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, updatedAt TEXT NOT NULL, scene TEXT NOT NULL); INSERT INTO migrations VALUES (1)');
    }
    if (!db.query('SELECT version FROM migrations WHERE version=2').get()) {
      db.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY, title TEXT NOT NULL, updatedAt TEXT NOT NULL);
        ALTER TABLE canvases ADD COLUMN projectId TEXT REFERENCES projects(id) ON DELETE SET NULL;
        CREATE INDEX canvases_projectId ON canvases(projectId);
        INSERT INTO migrations VALUES (2)`);
    }
    if (!db.query('SELECT version FROM migrations WHERE version=3').get()) {
      db.exec(`CREATE TABLE canvas_thumbnails (
        canvasId TEXT PRIMARY KEY REFERENCES canvases(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL, mimeType TEXT NOT NULL, data BLOB NOT NULL
      ); INSERT INTO migrations VALUES (3)`);
    }
  })();
  const get = (id: string): Canvas | null => {
    const row = db.query('SELECT * FROM canvases WHERE id=?').get(id) as any;
    return row ? { ...row, scene: JSON.parse(row.scene) } : null;
  };
  const getProject = (id: string) => db.query('SELECT p.*, (SELECT COUNT(*) FROM canvases WHERE projectId=p.id) AS canvasCount FROM projects p WHERE p.id=?').get(id) as Project | null;
  const validProject = (id: unknown): string | null => {
    if (id === null) return null;
    if (typeof id !== 'string' || !getProject(id)) throw new Error('Project not found');
    return id;
  };
  const list = () => db.query(`SELECT c.id,c.title,c.revision,c.updatedAt,c.projectId,t.revision AS thumbnailRevision
    FROM canvases c LEFT JOIN canvas_thumbnails t ON t.canvasId=c.id ORDER BY c.updatedAt DESC,c.id`).all() as Summary[];
  const getThumbnail = (id: string) => db.query('SELECT revision,mimeType,data FROM canvas_thumbnails WHERE canvasId=?').get(id) as Thumbnail | null;
  const saveThumbnail = db.transaction((id: string, revision: number, mimeType: string, data: Uint8Array) => {
    const current = db.query('SELECT revision FROM canvases WHERE id=?').get(id) as { revision: number } | null;
    if (!current) return { status: 404 as const };
    if (!Number.isInteger(revision) || revision < 0) throw new Error('Thumbnail revision required');
    if (current.revision !== revision) return { status: 409 as const };
    validateThumbnail(mimeType, data);
    // First writer wins: a revision URL must always identify the same bytes.
    db.query('INSERT OR IGNORE INTO canvas_thumbnails (canvasId,revision,mimeType,data) VALUES (?,?,?,?)').run(id, revision, mimeType, data);
    return { status: 200 as const, revision: getThumbnail(id)!.revision };
  });
  const invalidateThumbnail = (id: string, previous: Scene, next: Scene) => {
    if (thumbnailSceneKey(previous) !== thumbnailSceneKey(next)) db.query('DELETE FROM canvas_thumbnails WHERE canvasId=?').run(id);
  };
  const listProjects = () => db.query('SELECT p.*, (SELECT COUNT(*) FROM canvases WHERE projectId=p.id) AS canvasCount FROM projects p ORDER BY updatedAt DESC, id').all() as Project[];
  const create = (title: string, scene = emptyScene(), projectId: unknown = null) => {
    const id = crypto.randomUUID();
    db.query('INSERT INTO canvases (id,title,revision,updatedAt,scene,projectId) VALUES (?, ?, 0, ?, ?, ?)').run(id, validTitle(title), new Date().toISOString(), JSON.stringify(validateScene(scene)), validProject(projectId));
    return get(id)!;
  };
  const update = db.transaction((id: string, body: any) => {
    const current = get(id);
    if (!current) return { status: 404 as const, body: { error: 'Canvas not found' } };
    if (!Number.isInteger(body.revision)) throw new Error('Revision required');
    if (current.revision !== body.revision) return { status: 409 as const, body: { error: 'This canvas changed in another tab.', current } };
    const title = body.title === undefined ? current.title : validTitle(body.title);
    const scene = body.scene === undefined ? current.scene : validateScene(body.scene);
    const projectId = body.projectId === undefined ? current.projectId : validProject(body.projectId);
    db.query('UPDATE canvases SET title=?,scene=?,projectId=?,revision=revision+1,updatedAt=? WHERE id=?').run(title, JSON.stringify(scene), projectId, new Date().toISOString(), id);
    invalidateThumbnail(id, current.scene, scene);
    return { status: 200 as const, body: get(id)! };
  });
  const mutate = db.transaction((id: string, expectedRevision: number, mutation: (scene: Scene) => unknown) => {
    const current = get(id);
    if (!current) return { status: 404 as const, body: { error: 'Canvas not found' } };
    if (current.revision !== expectedRevision) return { status: 409 as const, body: { error: 'This canvas changed in another tab.', current } };
    const previousKey = thumbnailSceneKey(current.scene);
    const scene = validateScene(mutation(current.scene));
    db.query('UPDATE canvases SET scene=?,revision=revision+1,updatedAt=? WHERE id=?').run(JSON.stringify(scene), new Date().toISOString(), id);
    if (previousKey !== thumbnailSceneKey(scene)) db.query('DELETE FROM canvas_thumbnails WHERE canvasId=?').run(id);
    return { status: 200 as const, body: get(id)! };
  });
  return { db, get, create, list, getProject, listProjects, update, mutate, getThumbnail, saveThumbnail,
    createProject: (title: unknown) => {
      const id = crypto.randomUUID();
      db.query('INSERT INTO projects VALUES (?, ?, ?)').run(id, validTitle(title), new Date().toISOString());
      return getProject(id)!;
    },
    renameProject: (id: string, title: unknown) => {
      db.query('UPDATE projects SET title=?,updatedAt=? WHERE id=?').run(validTitle(title), new Date().toISOString(), id);
      return getProject(id);
    },
    removeProject: (id: string) => db.query('DELETE FROM projects WHERE id=?').run(id),
    // Match literal title substrings consistently, including Unicode and SQL wildcard characters.
    search: (query: string) => {
      const term = query.trim().toLowerCase();
      return { projects: listProjects().filter(p => p.title.toLowerCase().includes(term)), canvases: list().filter(c => c.title.toLowerCase().includes(term)) };
    },
    remove: (id: string) => db.query('DELETE FROM canvases WHERE id=?').run(id),
  };
}
