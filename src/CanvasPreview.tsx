import { useEffect, useRef, useState } from 'react';
import { exportToBlob, getNonDeletedElements } from '@excalidraw/excalidraw';
import { api } from './saving';
import { normalizeSceneDimensions } from './scene-dimensions';
import type { Canvas, Summary } from './shared';

// Include fetching and uploading in the limit, so a large library cannot
// download every embedded image or render every drawing at once.
let active = 0;
const queue: (() => void)[] = [];
function schedule<T>(task: () => Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const start = () => {
      signal.removeEventListener('abort', cancel);
      if (signal.aborted) { reject(signal.reason); return; }
      active++;
      void task().then(resolve, reject).finally(() => { active--; queue.shift()?.(); });
    };
    const cancel = () => { const index = queue.indexOf(start); if (index !== -1) queue.splice(index, 1); reject(signal.reason); };
    if (signal.aborted) { reject(signal.reason); return; }
    if (active < 2) start();
    else { queue.push(start); signal.addEventListener('abort', cancel, { once: true }); }
  });
}

function thumbnailUrl(id: string, revision: number) {
  return `/api/canvases/${encodeURIComponent(id)}/thumbnail?revision=${revision}`;
}

async function generateThumbnail(id: string, signal: AbortSignal): Promise<string> {
  // A save or MCP edit may land during export. Refetch once on conflict rather
  // than publishing an old rendering or retrying indefinitely while drawing.
  for (let attempt = 0; attempt < 2; attempt++) {
    signal.throwIfAborted();
    const canvas = await api<Canvas>(`/canvases/${encodeURIComponent(id)}`, { signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]) });
    const scene = await normalizeSceneDimensions(canvas.scene);
    signal.throwIfAborted();
    const blob = await exportToBlob({
      elements: getNonDeletedElements(scene.elements),
      appState: { viewBackgroundColor: canvas.scene.appState.viewBackgroundColor || '#ffffff', exportBackground: true, exportWithDarkMode: false, exportEmbedScene: false },
      files: canvas.scene.files,
      getDimensions: (width: number, height: number) => {
        const scale = Math.min(1, 720 / Math.max(width, height));
        return { width: Math.max(1, Math.ceil(width * scale)), height: Math.max(1, Math.ceil(height * scale)), scale };
      },
      exportPadding: 24,
      mimeType: 'image/webp', quality: 0.85,
    });
    signal.throwIfAborted();
    const response = await fetch(thumbnailUrl(id, canvas.revision), {
      method: 'PUT', headers: { 'Content-Type': blob.type }, body: blob,
      signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
    });
    if (response.status === 409) continue;
    if (!response.ok) throw new Error('Preview unavailable');
    const saved = await response.json() as { revision: number };
    return thumbnailUrl(id, saved.revision);
  }
  throw new Error('Canvas is still changing');
}

export function CanvasPreview({ canvas, tint, onOpen }: { canvas: Summary; tint: number; onOpen: () => void }) {
  const button = useRef<HTMLButtonElement>(null);
  const [visible, setVisible] = useState(false);
  const [generated, setGenerated] = useState<string>();
  const [failed, setFailed] = useState(false);
  const [cacheFailed, setCacheFailed] = useState(false);
  const { id, revision, thumbnailRevision } = canvas;
  const cached = thumbnailRevision !== null && !cacheFailed ? thumbnailUrl(id, thumbnailRevision) : undefined;

  useEffect(() => {
    if (!button.current) return;
    if (!('IntersectionObserver' in window)) { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: '200px' });
    observer.observe(button.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || cached) return;
    const controller = new AbortController();
    setGenerated(undefined); setFailed(false);
    void schedule(() => generateThumbnail(id, controller.signal), controller.signal)
      .then(url => { if (!controller.signal.aborted) setGenerated(url); })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [id, revision, visible, cached]);

  const source = cached || generated;
  return <button ref={button} className={`canvas-preview tint-${tint}${source ? ' has-thumbnail' : ''}`} aria-label={`Open ${canvas.title}`} onClick={onOpen}>
    {source ? <img src={source} alt="" loading="lazy" decoding="async" onError={() => {
      if (cached) setCacheFailed(true);
      else { setGenerated(undefined); setFailed(true); }
    }} /> : <span className="preview-placeholder"><span className="paper-mark" aria-hidden="true">✎</span><span className="preview-caption">{failed ? 'Preview unavailable' : 'Preparing preview…'}</span></span>}
    <span className="open-label">Open canvas ↗</span>
  </button>;
}
