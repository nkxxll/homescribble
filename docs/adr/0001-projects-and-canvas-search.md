# ADR 0001: Projects organize canvases within the local workspace

- Date: 2026-10-16
- Status: Accepted

## Context

Homescribble previously presented a flat library of independently saved canvases. Related drawings need to be grouped into named projects while remaining individually discoverable. The user confirmed that a canvas belongs to at most one project, may remain outside projects, and must survive deletion of its project.

## Decision

Add a `projects` table with a UUID, title, and modification timestamp. Add a nullable `canvases.projectId` foreign key with `ON DELETE SET NULL`, indexed for membership queries. Enable SQLite foreign keys on each store connection. Migration 2 runs transactionally and leaves existing canvases unassigned, preserving their scenes, embedded images, revisions, and timestamps. Project titles use the existing trimmed 1–120 character validation; duplicate names are permitted because identity is the UUID.

The dashboard supports creating, renaming, opening, and deleting projects. Each project has a reloadable `/project/:id` page showing its canvases. Creating a canvas there assigns it to that project. A project selector on each canvas card supports assigning, moving, and removing membership. The home page continues to show all canvases, with project names on their cards. Duplicating a canvas preserves its project; recovering an unsaved draft creates an unassigned canvas, avoiding dependence on a project that may have been deleted.

Canvas membership changes use the existing revision-checked update operation. Concurrent stale writes fail with a conflict instead of silently replacing newer changes. Autosave requests omit `projectId`, preserving current membership. Deleting a project only clears membership through the foreign key: it does not change canvas scenes or revisions, so pending drawing saves can still succeed. Project renames use last-write-wins, consistent with the single-user scope and without involving drawing revisions.

Search returns separate project and canvas collections using trimmed, case-insensitive literal title substrings. Search always covers the entire workspace, including when initiated from a project page; the UI states this scope. A project matching by title does not implicitly match all its canvases, and a matching canvas does not implicitly match its project. Results identify their type, and canvas results show project context. Empty search restores the current page's normal listing. Empty results are explicit.

The dashboard filters its already-loaded metadata, preserving the existing instant search behavior. `GET /api/search?q=...` exposes the same semantics for API consumers. Both exclude drawing scene payloads. A database full-text index is unnecessary for this small local workspace; search does not inspect text inside drawings.

## API

- `GET /api/projects`: list projects with canvas counts.
- `POST /api/projects`: create a project with `{ title }`.
- `GET /api/projects/:id`: get project metadata and count.
- `PUT /api/projects/:id`: rename with `{ title }`.
- `DELETE /api/projects/:id`: delete the project and retain its canvases.
- Existing canvas create/update endpoints accept `projectId` (UUID or `null`); updates require the current `revision`.
- Canvas responses and summaries include `projectId`; omitted membership on update preserves its value.
- `GET /api/search?q=...`: return `{ projects, canvases }` metadata collections.

## Alternatives and consequences

A many-to-many join table would permit a canvas in several projects but is outside the requested model. Hierarchical folders would introduce nesting and navigation rules without a current need. Cascading deletion was explicitly rejected because organization should not remove drawings.

SQLite enforces valid membership and keeps project removal atomic. Existing database backups include the new table and column automatically. Metadata search remains linear in workspace size, and project timestamps represent creation/renaming rather than child drawing activity. The UI refreshes after mutations; changes made in another tab appear on reload. Membership changes can cause an already-open editor to report a revision conflict on its next save, retaining the established draft-recovery behavior.

## Verification

Store tests cover migration from version 1, repeated opening, persistent membership, counts, title validation, invalid project references, atomic failed updates, stale revisions, movement/unassignment, project deletion, and searches across both entity types. Cypress covers project creation, canvas creation within projects, duplication, moving canvases, project-page reloads, global search, project renaming/deletion, and preservation of drawings. Existing drawing and recovery checks remain in the smoke suite.
