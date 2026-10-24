import type { Canvas, Scene, Summary } from './shared';
import type { CanvasEventHub } from './events';
import type { openStore } from './store';

export type Store = ReturnType<typeof openStore>;
export type MutationSource = 'rest' | 'mcp';

export class CanvasNotFoundError extends Error {
  readonly code = 'canvas_not_found';
  constructor(readonly canvasId: string) { super('Canvas not found'); }
}

export class CanvasConflictError extends Error {
  readonly code = 'revision_conflict';
  constructor(readonly canvasId: string, readonly expectedRevision: number, readonly current: Canvas) {
    super(`Canvas revision conflict: expected ${expectedRevision}, current ${current.revision}`);
  }
}

export class CanvasValidationError extends Error {
  readonly code = 'validation_error';
  constructor(message: string, readonly details?: unknown) { super(message); }
}

export class CanvasService {
  constructor(readonly store: Store, private events: CanvasEventHub) {}

  list(filters: { projectId?: string; title?: string } = {}): Summary[] {
    const title = filters.title?.trim().toLowerCase();
    return this.store.list().filter(canvas =>
      (filters.projectId === undefined || canvas.projectId === filters.projectId) &&
      (!title || canvas.title.toLowerCase().includes(title))
    );
  }

  get(canvasId: string): Canvas {
    const canvas = this.store.get(canvasId);
    if (!canvas) throw new CanvasNotFoundError(canvasId);
    return canvas;
  }

  create(title: string, scene?: Scene, projectId: unknown = null): Canvas {
    try { return this.store.create(title, scene, projectId); }
    catch (error) { throw this.validation(error); }
  }

  update(canvasId: string, expectedRevision: number, changes: { title?: unknown; scene?: unknown; projectId?: unknown }, source: MutationSource): Canvas {
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw new CanvasValidationError('expectedRevision must be a non-negative integer');
    let result: ReturnType<Store['update']>;
    try { result = this.store.update(canvasId, { ...changes, revision: expectedRevision }); }
    catch (error) { throw this.validation(error); }
    if (result.status === 404) throw new CanvasNotFoundError(canvasId);
    if (result.status === 409) throw new CanvasConflictError(canvasId, expectedRevision, result.body.current);
    const canvas = result.body as Canvas;
    if (source === 'mcp') this.events.publish({ canvasId, revision: canvas.revision });
    return canvas;
  }

  mutate(canvasId: string, expectedRevision: number, mutation: (scene: Scene) => Scene, source: MutationSource = 'mcp'): Canvas {
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw new CanvasValidationError('expectedRevision must be a non-negative integer');
    let result: ReturnType<Store['mutate']>;
    try { result = this.store.mutate(canvasId, expectedRevision, mutation); }
    catch (error) { throw this.validation(error); }
    if (result.status === 404) throw new CanvasNotFoundError(canvasId);
    if (result.status === 409) throw new CanvasConflictError(canvasId, expectedRevision, result.body.current);
    const canvas = result.body as Canvas;
    if (source === 'mcp') this.events.publish({ canvasId, revision: canvas.revision });
    return canvas;
  }

  private validation(error: unknown) {
    return error instanceof CanvasValidationError ? error : new CanvasValidationError(error instanceof Error ? error.message : 'Invalid canvas');
  }
}
