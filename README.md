# Homescribble

A private drawing workspace for one person on one machine. React + Excalidraw, served by Bun with SQLite persistence. No accounts, billing, or cloud services. The server binds to `127.0.0.1`.

## Run locally

```sh
bun install
bun dev
```

Open http://127.0.0.1:3000. Create canvases, draw, import/export Excalidraw files and images, rename, duplicate, and delete from the dashboard. Each canvas has a dedicated `/canvas/:id` URL. Excalidraw fonts are served locally.

## Projects and search

Create a project from the dashboard to group related canvases. Open it to view its drawings or create a canvas directly inside it. Use the **Project** selector on any canvas card to move it to a project or choose **No project**. Duplicates stay in the same project. Deleting a project keeps all its canvases.

Search finds projects and individual canvases by title across the entire workspace, including from a project page. Projects have dedicated `/project/:id` URLs. See [ADR 0001](docs/adr/0001-projects-and-canvas-search.md) for the storage, search, and deletion decisions.

## Production

```sh
bun run build
bun start
```

Bun serves the prebuilt frontend from `dist` in production mode. Keep the source and installed dependencies alongside the server. Environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Loopback HTTP port |
| `DATABASE_PATH` | `data/homescribble.sqlite` | Persistent database location |
| `BACKUP_DIR` | `data/backups` | Automatic snapshot directory |
| `BACKUP_DISABLED` | unset | Set `1` only to disable automatic backups |

`GET /api/health` verifies database connectivity. Migrations run transactionally at startup. Scenes, supported editor settings, and embedded image data are committed atomically with full SQLite synchronization. Requests are limited to 30 MiB. Keep the `data` directory on persistent local storage. Do not expose this unauthenticated app through a public proxy.

## Save and recovery behavior

Autosave waits one second after editing and saves at least every five seconds during continuous editing when no request is in flight. Each canvas has its own serialized save queue. “Saved” means the server confirmed the relevant scene and images. Failed requests retry every three seconds; network requests time out after fifteen seconds.

Pending work is stored in IndexedDB and offered on the dashboard after reloading. A conflict preserves the draft and offers **Save draft as new canvas** or **Download draft**, without overwriting the server copy. The browser warns before leaving with pending edits. If browser storage is unavailable, keep the tab open until the server saves. Browser recovery is not a backup: clearing website data removes pending drafts. Use the same localhost hostname/port to retain access to its browser storage.

## Backups and restoration

The running server snapshots SQLite on startup and every 24 hours. Snapshots include committed WAL contents and images. Backups are retained until you remove them; copy important snapshots to another disk.

```sh
bun run backup /absolute/path/to/backup.sqlite
```

To restore, stop the server, preserve the entire current database directory (including any `-wal` and `-shm` files), then copy a snapshot to a **new** database path and start with `DATABASE_PATH=/absolute/path/to/restored.sqlite bun start`. Check `/api/health` and open a canvas before adopting the restored database. Do not copy a live main database file alone or combine a restored snapshot with old WAL files. The backend test verifies a snapshot by opening it independently and comparing its saved scene and image data.

## Verification

```sh
bun run typecheck
bun test tests
bun run build
bun run test:smoke
```

Cypress builds the frontend and starts a production server on port 3101 with its own temporary database, cleans it up afterward, and runs actual drawing and dashboard interactions plus recovery, retry, revision-conflict, navigation, and delayed-request checks. Screenshots are saved under `cypress/screenshots`. Backend tests exercise database reopening, atomic validation, stale revisions, and backup restoration. No test suite proves the absence of all bugs; these checks cover the specified MVP persistence paths.
