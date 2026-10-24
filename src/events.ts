export type CanvasEvent = { canvasId: string; revision: number };

export class CanvasEventHub {
  private listeners = new Map<string, Set<(event: CanvasEvent) => void>>();

  subscribe(canvasId: string, listener: (event: CanvasEvent) => void) {
    const listeners = this.listeners.get(canvasId) ?? new Set();
    listeners.add(listener);
    this.listeners.set(canvasId, listeners);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) this.listeners.delete(canvasId);
    };
  }

  publish(event: CanvasEvent) {
    for (const listener of this.listeners.get(event.canvasId) ?? []) listener(event);
  }
}
