import type { Canvas, Scene } from './shared';
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch('/api' + path, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  const body = await response.json();
  if (!response.ok) throw Object.assign(new Error(body.error || 'Request failed'), { status: response.status });
  return body;
}
export type Draft = { key: string; id: string; revision: number; scene: Scene; title: string; version: number };
let dbPromise: Promise<IDBDatabase>;
function database() {
  return dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('homescribble-recovery', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('drafts', { keyPath: 'key' });
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
  });
}
export async function drafts(): Promise<Draft[]> {
  const db = await database();
  return new Promise((resolve, reject) => { const req = db.transaction('drafts').objectStore('drafts').getAll(); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
}
async function writeDraft(draft: Draft | null, key: string) {
  const db = await database();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction('drafts', 'readwrite');
    if (draft) tx.objectStore('drafts').put(draft); else tx.objectStore('drafts').delete(key);
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  });
}
export async function discardDraft(key: string) { await writeDraft(null, key); }
export type SaveStatus = 'Saved' | 'Saving' | 'Offline' | 'Save failed' | 'Conflict';
const sessions = new Map<string, SaveSession>();
let tabId = sessionStorage.getItem('homescribble-tab') || crypto.randomUUID();
sessionStorage.setItem('homescribble-tab', tabId);
// Duplicated browser tabs clone sessionStorage. A document-lifetime lock prevents
// them from sharing the same recovery key and overwriting each other's drafts.
const tabReady = new Promise<void>(resolve => {
  if (!navigator.locks) { resolve(); return; }
  const claim = () => {
    void navigator.locks.request(`homescribble-tab:${tabId}`, { ifAvailable: true }, lock => {
      if (!lock) { tabId = crypto.randomUUID(); sessionStorage.setItem('homescribble-tab', tabId); claim(); return; }
      resolve();
      return new Promise<void>(() => {});
    }).catch(() => resolve());
  };
  claim();
});
export class SaveSession {
  status: SaveStatus = 'Saved';
  message = '';
  version = 0;
  savedVersion = 0;
  busy = false;
  conflict = false;
  private localQueue = Promise.resolve();
  private timer?: ReturnType<typeof setTimeout>;
  private firstDirty = 0;
  private listeners = new Set<() => void>();
  private remoteListeners = new Set<(scene: Scene) => void>();
  key: string;
  scene: Scene;
  title: string;
  revision: number;
  fingerprint: string;
  constructor(public id: string, canvas: Canvas, draft?: Draft) {
    this.key = `${tabId}:${id}`;
    this.scene = draft?.scene || canvas.scene; this.title = draft?.title || canvas.title;
    this.revision = draft?.revision ?? canvas.revision;
    this.fingerprint = JSON.stringify(this.scene);
    if (draft) { this.version = 1; void this.persist(); this.status = 'Saving'; if (canvas.revision !== draft.revision) { this.conflict = true; this.status = 'Conflict'; } else this.schedule(); }
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  subscribeRemote = (listener: (scene: Scene) => void) => { this.remoteListeners.add(listener); return () => { this.remoteListeners.delete(listener); }; };
  emit() { this.listeners.forEach(f => f()); }
  draft(): Draft { return { key: this.key, id: this.id, scene: this.scene, title: this.title, revision: this.revision, version: this.version }; }
  persist() {
    const snapshot = this.draft();
    this.localQueue = this.localQueue.catch(() => {}).then(() => writeDraft(snapshot, this.key));
    this.localQueue.catch(() => { this.message = 'Local recovery storage is unavailable. Keep this tab open until saved.'; this.emit(); });
    return this.localQueue;
  }
  change(scene: Scene, title = this.title) {
    const fingerprint = JSON.stringify(scene);
    if (fingerprint === this.fingerprint && title === this.title) return;
    this.scene = scene; this.title = title; this.fingerprint = fingerprint; this.version++;
    void this.persist();
    if (!this.conflict) { this.status = navigator.onLine ? 'Saving' : 'Offline'; this.schedule(); }
    this.emit();
  }
  schedule(delay?: number) {
    this.firstDirty ||= Date.now();
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), delay ?? Math.max(0, Math.min(1000, 5000 - (Date.now() - this.firstDirty))));
  }
  async flush() {
    if (this.busy || this.conflict || this.version === this.savedVersion) return;
    clearTimeout(this.timer); this.busy = true; this.status = navigator.onLine ? 'Saving' : 'Offline'; this.emit();
    const version = this.version;
    const scene = this.scene; const title = this.title;
    try {
      // Recovery writes are ordered, as are server writes. Images are committed in the same SQLite row.
      await this.persist().catch(() => {});
      const canvas = await api<Canvas>(`/canvases/${this.id}`, { method: 'PUT', body: JSON.stringify({ revision: this.revision, scene, title }), signal: AbortSignal.timeout(15000) });
      this.revision = canvas.revision; this.savedVersion = version; this.firstDirty = 0;
      if (this.version === version) {
        this.localQueue = this.localQueue.catch(() => {}).then(() => writeDraft(null, this.key));
        await this.localQueue;
        this.status = this.version === version ? 'Saved' : 'Saving'; this.message = '';
      } else { await this.persist(); this.status = 'Saving'; }
    } catch (error: any) {
      if (error.status === 409 || error.status === 404) { this.conflict = true; this.status = 'Conflict'; this.message = 'The server copy changed or was deleted. Your draft is preserved. Save it as a new canvas to keep both versions.'; }
      else { this.status = !navigator.onLine || error instanceof TypeError ? 'Offline' : 'Save failed'; this.message = 'Your edits are kept on this device. Retrying automatically.'; }
    } finally {
      this.busy = false; this.emit();
      if (!this.conflict && this.version !== this.savedVersion) this.schedule(this.status === 'Saving' ? 0 : 3000);
    }
  }
  async recoverCopy() {
    const version = this.version;
    const copy = await api<Canvas>('/canvases', { method: 'POST', body: JSON.stringify({ title: `${this.title.slice(0, 108)} (recovered)`, scene: this.scene }) });
    await this.localQueue.catch(() => {});
    if (this.version === version) { await writeDraft(null, this.key); this.savedVersion = version; sessions.delete(this.id); }
    return copy;
  }
  async receiveRemoteRevision(committedRevision?: number) {
    if (committedRevision !== undefined && committedRevision <= this.revision) return;
    if (committedRevision !== undefined && (this.busy || this.version !== this.savedVersion || this.conflict)) {
      this.conflict = true; this.status = 'Conflict';
      this.message = 'This canvas changed through MCP while you had local work. Your draft is preserved. Save it as a new canvas to keep both versions.';
      this.emit(); return;
    }
    // A reconnect is only evidence that events may have been missed. Let an
    // in-flight browser save finish before comparing authoritative revisions,
    // otherwise its committed response could be mistaken for a remote edit.
    if (committedRevision === undefined && this.busy) {
      setTimeout(() => void this.receiveRemoteRevision(), 100);
      return;
    }
    try {
      const canvas = await api<Canvas>(`/canvases/${this.id}`);
      if (canvas.revision <= this.revision) return;
      if (this.busy && committedRevision === undefined) {
        setTimeout(() => void this.receiveRemoteRevision(), 100);
        return;
      }
      if (this.busy || this.version !== this.savedVersion) {
        this.conflict = true; this.status = 'Conflict';
        this.message = 'This canvas changed through MCP while you had local work. Your draft is preserved. Save it as a new canvas to keep both versions.';
        this.emit(); return;
      }
      this.scene = canvas.scene; this.title = canvas.title; this.revision = canvas.revision; this.fingerprint = JSON.stringify(canvas.scene);
      this.status = 'Saved'; this.message = '';
      this.remoteListeners.forEach(listener => listener(canvas.scene)); this.emit();
    } catch (error: any) {
      if (error.status === 404) {
        this.conflict = true; this.status = 'Conflict'; this.message = 'The server copy was deleted. Your local canvas is preserved in this tab.'; this.emit();
      }
    }
  }
}
const opening = new Map<string, Promise<SaveSession>>();
export function openSession(id: string): Promise<SaveSession> {
  const pending = opening.get(id);
  if (pending) return pending;
  const promise = loadSession(id).finally(() => opening.delete(id));
  opening.set(id, promise);
  return promise;
}
async function loadSession(id: string) {
  await tabReady;
  const existing = sessions.get(id);
  if (existing && existing.version !== existing.savedVersion) return existing;
  const local = (await drafts().catch(() => [] as Draft[])).filter(d => d.id === id);
  const recoveryKey = new URLSearchParams(location.search).get('recover');
  const draft = local.find(d => d.key === `${tabId}:${id}`) || local.find(d => d.key === recoveryKey);
  let canvas: Canvas;
  try { canvas = await api<Canvas>(`/canvases/${id}`); }
  catch (error: any) {
    if (!draft) throw error;
    canvas = { id, projectId: null, title: draft.title, scene: draft.scene, revision: error.status === 404 ? -1 : draft.revision, updatedAt: '' };
  }
  const session = new SaveSession(id, canvas, draft); sessions.set(id, session); return session;
}
window.addEventListener('online', () => sessions.forEach(s => void s.flush()));
window.addEventListener('beforeunload', event => {
  if ([...sessions.values()].some(s => s.version !== s.savedVersion)) { event.preventDefault(); event.returnValue = ''; }
});
document.addEventListener('visibilitychange', () => { if (document.hidden) sessions.forEach(s => void s.flush()); });
