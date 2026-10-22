# Homescribble MVP plan

## Product goal

Build a premium drawing app with a Bun backend, a React frontend, and the Excalidraw library.

The MVP focuses on one promise: create a canvas, draw, and reliably find your work saved when you return.

## Open decisions

- **Audience:** Personal use with one private workspace, or multiple users with private accounts?
  - the only user is me on this machine so there is no need for idm or auth in any way
- **Billing:** Does premium mean a polished app with billing later, or paid subscriptions in the MVP?
  - n/a
- **Hosting:** Where should the application run? Are there existing infrastructure preferences?
  - only localhost
- **Database:** Proposed starting point is SQLite on persistent storage for a small, single-server MVP. Consider PostgreSQL if multiple server instances are expected.
  - sqlite only single only local
- **Authentication:** If accounts are required, choose the sign-in method and account-registration policy.
  - no auth
- **Scope:** Confirm whether the proposed deferred features below can wait until after the MVP.
  - only local first then will iterate but the app will say local in the future with only one user

These decisions are provisional until discussed. Ask for clarification when a decision materially affects the product or architecture.

## 1. Application foundation

- Use TypeScript throughout.
- Use Bun as the backend runtime and package manager.
- Scaffold the React frontend and Bun backend with `bun init --react`.
- Use Bun's built-in frontend bundler and development server, together with `@excalidraw/excalidraw`.
- Expose a small HTTP API from the Bun backend.
- Keep frontend, backend, and shared validation/types in one repository.

### Setup commands

Run manually from the repository root:
`the setup was already done manually by me`

```bash
bun init --react
bun add @excalidraw/excalidraw
bun dev
```

The initializer creates the React application and API server and installs the template dependencies. These commands are documented here only; they have not been executed as part of planning.

## 2. Canvas experience

- Build a dashboard to create, list, rename, duplicate, and delete canvases.
- Give each canvas a dedicated URL.
- Provide a full-screen editor with the canvas title, dashboard navigation, and save status.
- Preserve Excalidraw's drawing tools and import/export capabilities.

## 3. Persistent storage

- Store canvas metadata, scene elements, supported editor settings, and embedded images.
- Persist only the editor settings needed to restore the drawing experience; exclude transient UI state.
- Track a revision number for each canvas.
- Add ownership and authorization if the MVP supports multiple users.
- Finalize SQLite versus PostgreSQL after settling deployment requirements.

## 4. Dependable autosave

- Load saved scenes through Excalidraw's `initialData`.
- Capture edits through `onChange`, which supplies elements, app state, and files.
- Save after approximately one second of inactivity, with periodic saves during continuous drawing.
- Keep a local recovery copy in IndexedDB while server saves are pending.
- Show accurate save states: Saving, Saved, Offline, and Save failed.
- Retry transient failures and preserve unsaved work across reloads.
- Serialize saves per canvas and track pending edits so older requests cannot replace newer content.
- Use revision checks to prevent two tabs or devices silently overwriting each other. Preserve the local draft when a conflict occurs and provide a recovery path.
- Save embedded images durably before marking the corresponding scene saved.
- Keep pending saves and recovery data associated with the correct canvas when navigating between canvases.

## 5. Verification and acceptance criteria

- Drawings and pasted images survive page reloads and server restarts.
- Offline edits recover and sync after reconnecting.
- Slow or failed requests cannot overwrite newer changes.
- Switching canvases during a pending save keeps each canvas's content separate.
- Concurrent edits from different tabs or devices surface a conflict without silently losing work.
- Save status reports Saved only after the server confirms persistence of the relevant scene and images.
- If accounts are included, users can access only their own canvases.
- Use focused backend tests and browser-level tests for persistence, recovery, authorization, and save races.

## 6. Deployment readiness

- Provide a production build and environment configuration.
- Add database migrations and health checks.
- Configure persistent storage and automated backups.
- Test the backup restoration procedure.
- Document local setup and deployment.

## Proposed scope after the MVP

- Real-time collaboration.
- Teams and shared workspaces.
- Folders.
- Public sharing.
- Version-history UI.
- Billing, unless paid subscriptions are explicitly required for the MVP.

## Implementation order

1. Resolve audience, billing, hosting, database, and authentication decisions.
2. Scaffold the frontend, backend, and shared types.
3. Integrate the Excalidraw editor and verify scene/image round trips.
4. Implement canvas persistence and ownership where applicable.
5. Implement autosave, local recovery, retries, and revision conflicts.
6. Build the dashboard and complete canvas management flows.
7. Verify acceptance criteria and prepare deployment documentation.

## References

- [Bun React setup](https://bun.sh/guides/ecosystem/react)
- [Excalidraw integration API](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/props/)
- [Bun SQLite documentation](https://bun.sh/docs/runtime/sqlite)
