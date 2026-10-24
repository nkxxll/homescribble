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

## MCP setup

Homescribble exposes a local Streamable HTTP MCP endpoint at:

```text
http://127.0.0.1:3000/mcp
```

The endpoint lets coding agents list and inspect canvases, create canvases, and perform bounded revision-checked element edits against the same SQLite data used by the browser. See [ADR 0002](docs/adr/0002-native-mcp-endpoint.md) for why the endpoint is part of Homescribble instead of a separate Excalidraw MCP process.

Start Homescribble before connecting a client:

```sh
bun dev
```

Keep Homescribble bound to `127.0.0.1`. The endpoint has no authentication and must not be exposed through a public tunnel or reverse proxy.

### Codex

Add the endpoint with the Codex CLI:

```sh
codex mcp add homescribble --url http://127.0.0.1:3000/mcp
codex mcp list
```

The CLI and IDE extension share MCP configuration. The equivalent `~/.codex/config.toml` entry is:

```toml
[mcp_servers.homescribble]
url = "http://127.0.0.1:3000/mcp"
```

See the [official Codex MCP setup example](https://developers.openai.com/learn/docs-mcp).

### OpenCode

Add and verify the remote endpoint:

```sh
opencode mcp add homescribble --url http://127.0.0.1:3000/mcp
opencode mcp list
```

If the installed OpenCode release uses the interactive form, run `opencode mcp add`, choose **Remote**, name it `homescribble`, and enter the same URL. No OAuth or request headers are required for the loopback server. See the [OpenCode MCP server guide](https://dev.opencode.ai/docs/mcp-servers/).

### Claude Code

From the project directory, add the server with Claude Code's default local scope (private to you and available in this project) and verify it:

```sh
claude mcp add --transport http homescribble http://127.0.0.1:3000/mcp
claude mcp list
```

Inside Claude Code, run `/mcp` to inspect the connection. Add `--scope user` before the server name if the connection should be available in every project:

```sh
claude mcp add --transport http --scope user homescribble http://127.0.0.1:3000/mcp
```

This setup targets Claude Code. Claude and Claude Desktop custom web connectors are cloud-connected products and should not be pointed at, or used as a reason to publish, this unauthenticated loopback service. See [Anthropic's remote MCP guidance](https://support.anthropic.com/en/articles/11503834-building-custom-integrations-via-remote-mcp-servers).

### Connection check

With Homescribble running, ask the client to list the tools from `homescribble`, then list available canvases. If discovery fails, confirm that the application health check succeeds at `http://127.0.0.1:3000/api/health`, the MCP URL ends in `/mcp`, and the client is running on the same machine.

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

Cypress builds the frontend and starts a production server on port 3101 with its own temporary database, cleans it up afterward, and runs actual drawing and dashboard interactions plus recovery, retry, revision-conflict, MCP invalidation, navigation, and delayed-request checks. Screenshots are saved under `cypress/screenshots`. Backend tests exercise database reopening, atomic validation, MCP negotiation and tools, scene invariants, stale revisions, and backup restoration. No test suite proves the absence of all bugs; these checks cover the specified persistence paths.
