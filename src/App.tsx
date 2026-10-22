import { useEffect, useMemo, useState } from 'react';
import { Excalidraw, MainMenu } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import { api, drafts, discardDraft, openSession, type SaveSession } from './saving';
import { sceneFrom, type Canvas, type Summary, type Project } from './shared';
import './index.css';

function go(path: string) { history.pushState({}, '', path); window.dispatchEvent(new PopStateEvent('popstate')); }
function Brand() { return <span className="brand"><span className="brand-icon">h.</span> homescribble<span className="local-tag">LOCAL</span></span>; }
export function App() {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => { const update = () => setPath(location.pathname); window.addEventListener('popstate', update); return () => window.removeEventListener('popstate', update); }, []);
  const id = /^\/canvas\/([^/]+)$/.exec(path)?.[1];
  const projectId = /^\/project\/([^/]+)$/.exec(path)?.[1];
  return id ? <Editor key={id} id={id} /> : <Dashboard key={projectId || 'all'} projectId={projectId} />;
}
function Dashboard({ projectId }: { projectId?: string }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [items, setItems] = useState<Summary[]>([]);
  const [recovery, setRecovery] = useState<{ key: string; id: string; title: string }[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  async function refresh() {
    try { const [canvases, projects] = await Promise.all([api<Summary[]>('/canvases'), api<Project[]>('/projects')]); setItems(canvases); setProjects(projects); setError(''); } catch (e: any) { setError(e.message); }
    try { setRecovery(await drafts()); } catch { /* Server canvases remain available if browser storage is disabled. */ }
    setLoading(false);
  }
  useEffect(() => { void refresh(); }, []);
  async function action(fn: () => Promise<void>) { setBusy(true); try { await fn(); } catch (e: any) { setError(e.message); } finally { setBusy(false); } }
  const project = projects.find(p => p.id === projectId);
  const term = search.trim().toLowerCase();
  const visibleProjects = projects.filter(p => p.title.toLowerCase().includes(term));
  const visibleCanvases = items.filter(c => term ? c.title.toLowerCase().includes(term) : !projectId || c.projectId === projectId);
  return <div className="dashboard">
    <header className="dashboard-header"><Brand /><span className="privacy"><span className="green-dot" /> Your space. On your machine.</span></header>
    <main>
      <div className="intro"><div><p className="eyebrow">A LITTLE SPACE FOR BIG IDEAS</p><h1>{project?.title || (projectId ? 'Project' : 'Make room for a thought.')}</h1><p className="subtitle">Sketch it out. Connect the dots. Pick up where you left off.</p></div><div className="create-actions"><button className="secondary" disabled={busy || loading} onClick={() => { const title = prompt('Project name'); if (title) void action(async () => { const p = await api<Project>('/projects', { method: 'POST', body: JSON.stringify({ title }) }); go(`/project/${p.id}`); }); }}>＋ New project</button><button className="primary" disabled={busy || loading || (!!projectId && !project)} onClick={() => action(async () => { const c = await api<Canvas>('/canvases', { method: 'POST', body: JSON.stringify({ title: 'Untitled canvas', projectId: projectId || null }) }); go(`/canvas/${c.id}`); })}>＋ New canvas</button></div></div>
      {error && <div role="alert" className="notice">{error} <button onClick={refresh}>Try again</button></div>}
      {recovery.length > 0 && <div className="notice">Unsynced drafts on this device: {recovery.map((d, i) => <span key={i}><button onClick={() => go(`/canvas/${d.id}?recover=${encodeURIComponent(d.key)}`)}>{d.title} →</button><button aria-label={`Discard draft ${d.title}`} onClick={() => { if (confirm(`Discard the local recovery draft for “${d.title}”? Unsynced edits in this draft will be lost.`)) void action(async () => { await discardDraft(d.key); await refresh(); }); }}>Discard draft</button></span>)}</div>}
      {projectId && <nav className="project-navigation"><button onClick={() => go('/')}>← All canvases and projects</button>{project && <span>{project.title} · {project.canvasCount} canvases</span>}</nav>}
      {!loading && projectId && !project && <p role="alert">Project not found. Its canvases may now be outside projects.</p>}
      <div className="library-heading"><h2>{term ? 'Search results' : project ? 'Project canvases' : 'Your workspace'}</h2><input aria-label="Search projects and canvases" placeholder="Search projects and canvases…" value={search} onChange={e => setSearch(e.target.value)} /></div>
      {term && <p className="search-hint">Searching all projects and canvases in your workspace.</p>}
      {!loading && (!projectId || term) && <section aria-label="Projects"><h2 className="section-title">Projects <span>{visibleProjects.length}</span></h2><div className="project-grid">
        {visibleProjects.map(p => <article className="project-card" key={p.id}>
          <button className="canvas-title" onClick={() => go(`/project/${p.id}`)}>{p.title}</button><p>Project · {p.canvasCount} {p.canvasCount === 1 ? 'canvas' : 'canvases'}</p>
          <div className="card-actions"><button disabled={busy} onClick={() => { const title = prompt('Project name', p.title); if (title) void action(async () => { await api(`/projects/${p.id}`, { method: 'PUT', body: JSON.stringify({ title }) }); await refresh(); }); }}>Rename project</button><button disabled={busy} onClick={() => { if (confirm(`Delete project “${p.title}”? Its canvases will be kept outside projects.`)) void action(async () => { await api(`/projects/${p.id}`, { method: 'DELETE' }); await refresh(); }); }}>Delete project</button></div>
        </article>)}
      </div>{!term && projects.length === 0 && <p>Create a project to organize related drawings.</p>}</section>}
      <h2 className="section-title">Canvases <span>{visibleCanvases.length}</span></h2>
      {loading ? <p>Opening your workspace…</p> : <div className="canvas-grid">
        {visibleCanvases.map((c, i) => <article className="canvas-card" key={c.id}>
          <button className={`canvas-preview tint-${i % 3}`} aria-label={`Open ${c.title}`} onClick={() => go(`/canvas/${c.id}`)}><span className="paper-mark">✎</span><span className="open-label">Open canvas ↗</span></button>
          <div className="card-details"><span className="canvas-kind">Canvas · {projects.find(p => p.id === c.projectId)?.title || 'No project'}</span><button className="canvas-title" onClick={() => go(`/canvas/${c.id}`)}>{c.title}</button><p>Edited {new Date(c.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</p><div className="card-actions">
            <button disabled={busy} onClick={() => { const title = prompt('Canvas name', c.title); if (title) void action(async () => { await api(`/canvases/${c.id}`, { method: 'PUT', body: JSON.stringify({ title, revision: c.revision }) }); await refresh(); }); }}>Rename</button>
            <button disabled={busy} onClick={() => action(async () => { await api(`/canvases/${c.id}/duplicate`, { method: 'POST' }); await refresh(); })}>Duplicate</button>
            <button disabled={busy} onClick={() => { if (confirm(`Delete “${c.title}”? This cannot be undone.`)) void action(async () => { await api(`/canvases/${c.id}`, { method: 'DELETE' }); await refresh(); }); }}>Delete</button>
          </div><label className="project-select">Project<select aria-label={`Project for ${c.title}`} value={c.projectId || ''} disabled={busy} onChange={e => { const projectId = e.target.value || null; void action(async () => { await api(`/canvases/${c.id}`, { method: 'PUT', body: JSON.stringify({ projectId, revision: c.revision }) }); await refresh(); }); }}><option value="">No project</option>{projects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}</select></label></div>
        </article>)}
      </div>}
      {!loading && !term && visibleCanvases.length === 0 && (!projectId || project) && <div className="empty"><div>✧</div><h2>Every idea starts with a blank canvas.</h2><p>Create your first canvas and see where it takes you.</p></div>}
      {!loading && term && visibleCanvases.length === 0 && visibleProjects.length === 0 && <p>No projects or canvases match your search.</p>}
      <footer><span>Made for the beautifully unfinished.</span><span>Private by default · Saved locally</span></footer>
    </main>
  </div>;
}
function Editor({ id }: { id: string }) {
  const [session, setSession] = useState<SaveSession>();
  const [error, setError] = useState('');
  const initialData = useMemo(() => session?.scene, [session]);
  const [, render] = useState(0);
  useEffect(() => { let active = true; let unsubscribe: (() => void) | undefined; void openSession(id).then(s => { if (active) { setSession(s); unsubscribe = s.subscribe(() => render(n => n + 1)); } }).catch(e => setError(e.message)); return () => { active = false; unsubscribe?.(); }; }, [id]);
  if (!session) return <div className="loading"><button onClick={() => go('/')}>← All canvases</button><p role={error ? 'alert' : undefined}>{error || 'Opening your canvas…'}</p></div>;
  return <div className="editor-shell">
    <header className="editor-header"><button className="back-button" onClick={() => { void session.flush(); go('/'); }}>← <span>All canvases</span></button><span className="divider" /><input aria-label="Canvas title" maxLength={120} value={session.title} onChange={e => session.change(session.scene, e.target.value)} onBlur={() => { if (!session.title.trim()) session.change(session.scene, 'Untitled canvas'); }} /><span role="status" data-testid="save-status" className={`save-status status-${session.status.replace(' ', '-')}`}>{session.status === 'Saved' ? '✓ ' : '● '}{session.status}</span></header>
    {(session.message || session.status === 'Conflict') && <div className="editor-notice" role="alert">{session.message || 'This canvas changed elsewhere. Your local draft is preserved.'} {session.conflict ? <button onClick={async () => { try { const c = await session.recoverCopy(); go(`/canvas/${c.id}`); } catch (e: any) { setError(e.message); } }}>Save draft as new canvas</button> : <button onClick={() => void session.flush()}>Retry now</button>}<button onClick={() => { const url = URL.createObjectURL(new Blob([JSON.stringify({ type: 'excalidraw', version: 2, source: 'homescribble', ...session.scene })], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = `${session.title}.excalidraw`; a.click(); URL.revokeObjectURL(url); }}>Download draft</button></div>}
    {error && <div role="alert">{error}</div>}
    <div className="drawing-surface"><Excalidraw initialData={initialData} onChange={(elements, state, files) => session.change(sceneFrom(elements, state, files))}>
      <MainMenu><MainMenu.DefaultItems.LoadScene /><MainMenu.DefaultItems.SaveToActiveFile /><MainMenu.DefaultItems.Export /><MainMenu.DefaultItems.SaveAsImage /><MainMenu.DefaultItems.ClearCanvas /><MainMenu.DefaultItems.ToggleTheme /><MainMenu.DefaultItems.ChangeCanvasBackground /></MainMenu>
    </Excalidraw></div>
  </div>;
}
