# ADR 0003: Browser-rendered canvas thumbnails with a persistent cache

Status: Accepted

## Context

The dashboard's decorative canvas cards do not help identify drawings by their contents. Excalidraw already supplies an export renderer that supports its fonts, embedded images, text, bindings, and sketch styles. Downloading every full scene on every dashboard visit would be wasteful, especially for scenes with embedded images. A server renderer would require a browser or a separate drawing implementation.

## Decision

Render missing thumbnails in the dashboard with Excalidraw's `exportToBlob` and store the results in a separate SQLite `canvas_thumbnails` table. Thumbnail creation is derived work: it does not advance the canvas revision, update its edited timestamp, or participate in autosave/recovery.

The canvas list includes a nullable `thumbnailRevision`, without scene contents or image bytes. Cards with a thumbnail use `/api/canvases/:id/thumbnail?revision=:thumbnailRevision`. Versioned responses are privately cacheable and immutable; unversioned responses support ETag revalidation. The first accepted upload wins until invalidation, so the same versioned URL always identifies the same bytes.

For cards approaching the viewport, the dashboard fetches missing scenes and exports a WebP image (PNG is also accepted if the browser falls back). The export fits all nondeleted elements with padding, uses the scene's background, and ignores the editor camera and dark-mode preference. The longest edge is at most 720 pixels, with a minimum of one pixel on the other edge. At most two generation jobs run concurrently, including their fetch and upload. Unmounted cards cancel queued and network work.

Uploads send the source revision with the binary image. The server checks the revision and inserts the thumbnail in one transaction, rejecting outdated or deleted canvases. If a concurrent edit wins during rendering, the browser refetches and retries once. Uploads accept PNG/WebP signatures only and enforce a 2 MB limit while reading the body. Failed previews keep the card available to open the drawing.

The same store transactions that persist REST and MCP mutations invalidate thumbnails when nondeleted elements, referenced image data, or background color change. Renames, project moves, camera changes, drawing-tool settings, and unused images retain the cache. Duplicated canvases generate their own cache entries. Deletion cascades to the thumbnail row. The cache is part of the normal database backup and can also be rebuilt from saved scenes.

Dashboard navigation, tab focus, and returning to a visible tab refresh metadata. Completed browser saves also refresh an open dashboard, covering navigation away while a save is still in flight. MCP edits appear when the dashboard next refreshes. Thumbnail generation after editor saves is unnecessary for correctness and is left as a possible optimization.

## Consequences

Existing drawings gain previews when browsed, without a separate migration backfill or a new runtime dependency. A first visit may show a placeholder briefly; later visits load the cached images. The dashboard needs a browser to fill missing cache entries, and the previews represent the persisted scene rather than unsaved local drafts. Extremely dispersed content can still look small because the default preview includes the whole drawing; choosing a frame or custom crop can be added later.

## Verification

Backend tests cover migration, cache retention/invalidation, stale uploads, deletion, metadata payload size, image validation, HTTP caching, restart persistence, and backup restoration. Browser tests check actual pixels for text/shapes/images, an edit during upload, MCP invalidation, cache reuse across reload and server restart, empty and extreme aspect ratios, failure fallback, and bounded lazy generation. The existing browser suite exercises the surrounding autosave, recovery, project, and MCP behavior.
