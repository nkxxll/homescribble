# ADR 0002: Homescribble owns a native MCP endpoint

- Date: 2026-10-23
- Status: Accepted

## Context

Homescribble already owns the authoritative representation of a canvas: its UUID, project membership, Excalidraw scene and embedded files, SQLite revision, autosave queue, conflict behavior, recovery draft, backups, and local browser URL. We want Codex, OpenCode, and Claude Code to draw objects on those same canvases through MCP.

Existing Excalidraw MCP servers solve adjacent problems. The official Excalidraw MCP renders an MCP App and maintains its own diagram/checkpoint lifecycle. Other community servers pair MCP tools with their own editor, process, and scene store. Running one of them beside Homescribble would create a second canvas identity and persistence authority. Reverse-proxying that process to `/mcp` would make the URL look integrated without making its state, revisions, recovery, or backups part of Homescribble.

The key requirement is therefore not merely an Excalidraw-shaped tool. It is safe mutation of Homescribble's existing canvases.

## Decision

Implement a native, stateless Streamable HTTP MCP endpoint at `/mcp` in the existing Bun web server.

The endpoint exposes a deliberately small set of typed canvas and element tools. MCP handlers call the same in-process canvas service as the REST API. That service performs validation, revision checks, atomic SQLite commits, and post-commit invalidation events. It remains the single mutation boundary regardless of whether a write began in the browser API or an MCP client.

MCP mutations require the revision returned by a prior read. Homescribble rejects stale calls rather than attempting an implicit merge. A clean open editor adopts committed MCP changes after an SSE invalidation; an editor with unsaved work retains its draft and enters the existing conflict flow.

The server remains loopback-only and authless, consistent with Homescribble's single-user local deployment. Host and Origin validation are required to reduce DNS-rebinding and cross-origin browser risk. Exposing the MCP endpoint outside the machine is not part of this decision.

## Why we are building the endpoint

- **One source of truth:** MCP edits must update the same SQLite row and revision that the browser edits.
- **Existing safety guarantees:** Autosave serialization, stale-write rejection, image validation, recovery drafts, and backups must continue to apply.
- **Stable canvas identity:** Agents should operate on Homescribble canvas IDs and return URLs the user can open directly.
- **No synchronization bridge:** An external server would require bidirectional replication and conflict rules between two scene stores. That is more code and a larger failure surface than a thin native protocol adapter.
- **One local process and port:** The existing start commands should be sufficient; users should not have to supervise a sidecar or reverse proxy.
- **A constrained tool surface:** Homescribble can expose only the operations appropriate for its data model and omit arbitrary files, networking, canvas deletion, and other unnecessary capabilities.

This is an entire MCP protocol endpoint, but not a second drawing application. The protocol adapter is new; Excalidraw rendering, scene storage, and persistence remain existing Homescribble responsibilities.

## Alternatives considered

### Run the official Excalidraw MCP unchanged

This is the best option for producing an independent interactive diagram inside an MCP-App-capable client. It does not target a Homescribble canvas or share Homescribble's SQLite revisions and recovery behavior, so it does not meet the core requirement.

### Run a community live-canvas MCP server as a sidecar

Some projects already offer element CRUD and a browser editor. Adopting one would add another runtime, lifecycle, scene authority, and security/update dependency. A reverse proxy could place it at `/mcp`, but synchronizing its scene with Homescribble would still require a custom bridge and conflict policy.

### Add a stdio-only adapter

Stdio is simple for one local client, but every client would start or configure a separate process. It would not satisfy the single-web-server `/mcp` goal and would make shared access to the already-running application less direct.

### Let agents call the REST API directly

The REST API lacks MCP tool discovery, schemas, annotations, standardized results, and client integration. Giving each agent custom instructions would duplicate an informal contract and provide poorer input validation and approval UX.

### Replace the stored scene wholesale

A single `put_scene` tool would be easy to implement but would make accidental data loss more likely and force models to round-trip every element and embedded file. Bounded element-level operations preserve unrelated content and produce smaller, more reviewable calls.

## Consequences

Positive consequences:

- MCP and browser edits share persistence, validation, revisions, backups, and canvas URLs.
- The feature runs with the existing Bun process and local-only operational model.
- Typed, bounded tools are easier to test and safer than arbitrary scene replacement.
- Future local clients can connect through the same standard endpoint.

Costs and risks:

- Homescribble now maintains an MCP-facing compatibility surface and SDK dependency.
- Excalidraw element normalization and binding repair require careful tests as the Excalidraw library evolves.
- Live invalidation introduces another concurrency path in the editor.
- An authless write endpoint is acceptable only while the server remains bound to loopback; any remote deployment must revisit authentication, authorization, CSRF/DNS-rebinding defenses, TLS, auditing, and tool scope.
- Models can still make undesirable valid edits. Revision checks prevent stale overwrites, not bad intent; client approvals and backups remain important.

## Implementation and verification

The detailed tool contracts, sequencing, synchronization rules, security boundaries, tests, and acceptance criteria are defined in the [native MCP implementation plan](../mcp-implementation-plan.md).

## References

- [Official Excalidraw MCP](https://github.com/excalidraw/excalidraw-mcp)
- [MCP TypeScript SDK server guidance](https://ts.sdk.modelcontextprotocol.io/server)

