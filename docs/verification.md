# Homescribble verification

Verified on 2026-10-16 with Bun 1.3.14, Cypress 16.2.0, and headless Electron 146 on macOS.

## Results

- `bun run typecheck`: passed.
- `bun test tests`: passed, 3 tests and 33 assertions covering database reopening, scene/image durability, stale revision rejection, validation rollback, duplication, deletion, and backup restoration.
- `bun run build`: passed.
- `bun run test:smoke`: **10 passed, 0 failed, 0 skipped** (56 seconds of test execution).

The Cypress command builds the production frontend, starts a loopback server against a temporary SQLite database, and removes that test database afterward. It does not delete the user's application database.

## Browser scenarios

1. Create a canvas through the dashboard, draw a rectangle with pointer events, persist it, reload its dedicated URL, rename, duplicate, search, and delete.
2. Block save requests and report offline state; verify the rectangle is in IndexedDB before reload, restore its title and scene, reconnect, and verify server persistence.
3. Delay a save response while making newer edits; verify the latest edit wins after serialized saves.
4. Navigate to a second canvas while the first save is pending; verify both canvases retain their own titles.
5. Advance the server revision through a second-client API write, edit the stale browser scene, verify conflict and draft recovery across reload, and save a separate recovered canvas without replacing the server version.
6. Import an Excalidraw file containing an embedded PNG, reload, stop and restart the actual server, reload again, and verify image data and its element reference.
7. Paste a PNG via a browser ClipboardEvent, reload, verify identical embedded data, and assert that its colored pixels render on the editor canvas.
8. Keep typing continuously longer than the autosave deadline; verify a save occurs before typing stops and the final title is persisted.
9. Return HTTP 503 for saves, verify Save failed and unchanged server content, then restore the endpoint and retry successfully.

Screenshots are available in `cypress/screenshots/smoke.cy.ts/`. The dashboard and pasted-image screenshots were visually inspected.

## Projects verification

The project browser scenario creates a project and a canvas inside it, verifies separate project/canvas search results through the UI and API, reloads a project URL in production, duplicates a canvas, removes and restores project membership, renames the project, and deletes it while retaining both drawings across reload. Search from inside a project also finds unassigned canvases elsewhere in the workspace.

Store tests additionally verify migration from a version 1 database without changing existing drawings, membership persistence after reopening, counts, invalid project references, validation rollback, revision conflicts, and preserving membership during autosaves. Project deletion clears membership without changing the drawing revision or blocking a pending save.

Type checking, all store tests, the production build, and all ten browser scenarios passed after the feature changes. Cypress's Electron process could not launch inside the sandbox (exit 134); the suite passed when run with approved sandbox escalation against its temporary test database. The updated dashboard screenshot was visually inspected.

See [ADR 0001](adr/0001-projects-and-canvas-search.md) for the accepted design.

## Thumbnail verification (2026-10-24)

- `bun run typecheck`: passed.
- `bun test tests`: 15 passed, 112 assertions, including thumbnail migration, invalidation through REST/MCP, stale uploads, cache retention, deletion, persistence, backup restoration, and HTTP caching/validation.
- Production build: passed as part of Cypress setup.
- Existing browser smoke spec: 12 passed, including autosave, recovery, navigation, projects, images, and MCP edits.
- New thumbnail browser spec: 4 passed. It verifies drawing/text/image pixels, cache reuse without scene downloads across reload and a real server restart, MCP invalidation, a real edit racing an upload, empty and extreme aspect ratios, fallback on failure, offscreen deferral, and at most two concurrent scene downloads.

The thumbnail screenshot in `cypress/screenshots/thumbnails.cy.ts/canvas-card-thumbnails.png` was visually inspected. The browser tests ran outside the sandbox using the existing temporary-database setup because Electron exits with code 134 inside the sandbox. See [ADR 0003](adr/0003-canvas-thumbnails.md) for the accepted design.

## Scope of confidence

These tests cover the MVP's principal persistence and recovery contracts. They are not proof that all possible bugs are absent. Revision conflict tests simulate a second writer through the API; they do not automate two independent browser windows. The suite does not simulate power loss, a full disk, browser eviction of IndexedDB, or every browser engine. An offline test keeps the frontend server reachable while blocking scene writes; this app is not a service-worker-backed offline installation. Server snapshots run at startup and every 24 hours while the process is running; backup restoration is verified separately by reopening a serialized snapshot and comparing data.
