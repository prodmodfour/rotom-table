# PROJECT_BRIEF.md

TEMPLATE_CUSTOMISED: true

## Project name

Rotom Table — Live Play Sprint 4 authoritative batch workflow wave.

## Project type

Full-stack Nuxt 3 application with server-side SQLite persistence, Vue UI, TypeScript shared models, durable HTTP/SSE live-play command flow, IndexedDB outbox recovery, three.js map/token rendering, and Vitest coverage.

## Project goal

Implement the Live Play Sprint 4 work described by `BUILD_TICKETS.md` (`001` through `019`), refreshed from `sprint-4.md`. The finished wave should turn common multi-click live-play workflows into single server-authoritative batch commands: clearing hazards, clearing field effects, editing terrain voxels, editing hazard cells, showing honest batch pending/recovery state, proving chaos/retry behavior, and documenting operator smoke paths.

The core rule for this sprint is: one user intention should become one authoritative transaction whenever the UI presents it as one action. Batch commands must preserve the Sprint 1–3 live-play authority model: explicit validation, `opId` idempotency, revision checks, conflict scopes, authorised realtime replay, durable outbox recovery, accepted patches, and graceful presentation-only presence behavior.

## Audience

- Rotom Table maintainers and operators.
- GMs running live-play maps with multiple clients.
- Players using live-play hazard, terrain, field-effect, targeting, and movement tools during sessions.
- Future autonomous or human contributors maintaining live-play command authority, batching, realtime delivery, map rendering, and privacy boundaries.

## Success criteria

The work is successful when:

- Every ticket in `BUILD_TICKETS.md` for `001` through `019` is marked `DONE`.
- `scripts/quality-gate.sh` passes on the final branch.
- Current sequential live-play workflows are audited in `docs/live-play-batch-workflows.md`, with command routes, authority scopes, conflict scopes, expected patches, local-prediction safety, and Sprint 4/later/not-worth-batching classification.
- Shared batch guardrails define tested maximum payload sizes and pure validation helpers for bounded arrays, unique cells, field-effect operations, terrain voxels, hazard cells, and token IDs.
- `clearHazards`, `clearFieldEffects`, `editTerrainVoxels`, and `editHazards` command contracts strictly validate payload modes, reject unknown durable-state fields, and construct conservative conflict scopes.
- Every accepted batch command commits all authoritative effects in one SQLite transaction, appends durable realtime rows before commit, publishes only after commit, and returns/stores one terminal result keyed by `opId`.
- Retrying the exact same batch command body and `opId` returns the stored terminal result without duplicating effects or realtime events.
- Stale, conflicting, hidden, unauthorised, invalid, oversized, or contradictory batch payloads reject clearly and without partial authoritative writes.
- Accepted patches update changed hazards, field effects, terrain, or hazard cells precisely enough for clients to reconcile without whole-map replacement when practical.
- API routes, result validation, operation status, and `useLivePlayCommands` dispatchers support batch command enqueue/send/accept/reject/retry/recovery through the durable outbox.
- Existing live-play clear-all hazards and clear-all field-effects UI actions send exactly one authoritative command request while setup/edit behavior remains unchanged.
- Live-play terrain and hazard brush workflows coalesce strokes into bounded batch commands or split/reject safely when limits are exceeded.
- Batch pending and recovery UI gives safe summaries such as “Clearing 12 hazards…” without exposing full payloads or private data, and unrelated scoped commands remain interactive.
- Chaos tests cover conflicts, stale revisions, duplicate terminals, lost HTTP responses, status/retry recovery, HTTP/SSE ordering, and final authoritative convergence.
- Operator docs explain that batch commands are authoritative transactions, not client-side macros, and include GM/two-player smoke steps for clear hazards, clear field effects, terrain brush, hazard brush, rejection, retry/status, and reconnect.
- The top-level `AUTOMATION_STATUS` in `BUILD_TICKETS.md` is set to `DONE` when the final ticket is complete.

## Non-goals

The autonomous build must not spend time on:

- Replacing HTTP/SSE command transport or presence transport.
- Sending authoritative gameplay commands through presence transport.
- Making clients authoritative for batched changes.
- Using whole-map saves for live-play batch workflows.
- Introducing broad CRDT/document merging.
- Building a general-purpose scripting engine for arbitrary command lists.
- Batching hidden-information or random-result workflows unless the server already resolves the authoritative result deterministically.
- Making local prediction cover complex batch side effects in this sprint.
- Removing existing single-item commands; keep them as primitives and compatibility paths.
- Weakening Sprint 1–3 server authority, revision checks, idempotency, durable outbox recovery, authorised realtime replay, prediction reconciliation, or ephemeral presence privacy boundaries.
- Public authentication or hardening Rotom Table into a public multi-tenant service.
- Production runtime edits, direct server rebuilds, direct deployment, or production data mutation.
- Unrelated UI redesigns, unrelated encounter/spawn behavior changes, unrelated trainer-sheet behavior changes, unrelated inventory behavior changes, or speculative live-play features.
- Closing, commenting on, or editing GitHub issues unless the user explicitly requests it.

## Technology preferences

Preferred stack:

- language: TypeScript, with existing Python/Bash helpers only where already appropriate;
- framework: Nuxt 3 and Vue 3;
- rendering: existing three.js map/token rendering and Vue map page components;
- persistence/realtime: existing SQLite live-play storage, HTTP command endpoints, SSE realtime events, durable IndexedDB outbox patterns, and transient non-durable presence delivery from Sprint 3 where relevant;
- batching: narrow, explicit, server-authoritative command types rather than generic arbitrary command lists;
- testing: Vitest, Vue Test Utils/happy-dom where applicable, targeted shared/composable/page/server/integration tests, and existing test helpers;
- package manager: npm with Node.js 24 from `.nvmrc`;
- CI: existing GitHub Actions CI plus local `scripts/quality-gate.sh`.

Hard constraints:

- Follow the repository `AGENTS.md` production deployment boundaries and live-play-only instruction.
- Keep campaign/private data, `.env` files, databases, generated runtime files, and secrets out of commits.
- Keep ticket scope narrow: implement only the lowest-numbered `TODO` ticket in each autonomous cycle.
- Preserve the server-authoritative command model: clients may request bounded batches, but the server validates authority, revisions, scopes, permissions, map bounds, and payload shape before mutating state.
- Every batch command must have a bounded payload size.
- Every accepted batch command must commit all effects in one SQLite transaction or reject without partial authoritative writes.
- Every accepted batch command must append durable realtime rows before commit and publish only after commit.
- Every batch result must be idempotent by `opId`; retrying the exact same body returns the stored terminal result without duplicating effects.
- Batch patches should describe changed resources precisely enough for clients to reconcile without full-map replacement when practical.
- If a batch would touch hidden, unauthorised, stale, invalid, or conflicting resources, prefer rejecting the batch with a clear reason over applying a partial subset.
- Preserve role/profile/map visibility checks for all command routes, presence snapshots, heartbeats, pings, intent, and transient events.
- Redact or reject command bodies, private profile IDs, sheet payloads, arbitrary records, over-large strings, unknown durable-state fields, access-gate data, and sensitive resource details from batch contracts, presence contracts, debug UI, recovery UI, and logs.

Flexible choices:

- File names, helper names, hook names, and exact component/composable test locations may differ from ticket suggestions when they fit existing architecture better.
- Tests can be targeted when a full end-to-end browser workflow is impractical, as long as the ticket acceptance criteria are meaningfully covered.
- Accepted patches may reuse existing patch shapes where they safely describe final authoritative state.
- Large brush strokes may split into bounded chunks or reject with clear UI copy, according to the safest fit for existing command/outbox behavior.
- Visual treatments for batch pending/recovery state may be subtle, low-noise alternatives to the suggested labels if users can still understand operation progress.

## Architecture expectations

Use existing Rotom Table boundaries:

```text
shared batch command contracts/parsers -> scope/revision/idempotency helpers -> server command executor SQLite transaction + durable realtime rows -> API routes/result validation/status -> map-editor live-play command composable + IndexedDB outbox -> Vue map page/menu/brush UI -> docs/tests
```

Expected patterns:

- Batch schema helpers should be pure, strict, framework-free where practical, and shared by server, client, and tests.
- Server identity and authority should come from authenticated role/profile/map context; client-supplied authority fields should be ignored, rejected, or overwritten.
- Command bodies should carry stable `opId`, map slug, command type, base revision, conservative conflict scopes, and bounded payloads.
- Server executors should validate every affected resource before mutation, then apply the accepted batch atomically.
- Terminal command results should be stored/reused by `opId` and validated against the submitted command body for type, map slug, scopes, and operation identity.
- Durable realtime events should remain authoritative replay data; transient presence remains non-durable table-feel state and must not become a command transport.
- Client dispatchers should reuse patch-first accepted-response handling, existing recovery/status behavior, and scope-aware blockers.
- Complex batch side effects should not be locally predicted in this sprint beyond existing preview/pending/correction affordances.
- UI loops that previously sent many individual live-play commands for one user intention should be replaced only after the corresponding command contract, server executor, route, client dispatcher, and tests are in place.
- Privacy/access tests should be added before or alongside any ticket that expands what batch or recovery payloads can carry or render.

## Quality expectations

Expected quality gates:

- shell syntax checks for Bash automation scripts;
- build-loop regression tests from the autonomous build template;
- secret and generated/private-file guardrails;
- `npm ci` using Node.js 24 from `.nvmrc`;
- `npm run typecheck --if-present`;
- `npm test --if-present`;
- `npm run build --if-present`.

Each ticket should also run targeted verification commands from `BUILD_TICKETS.md` when practical before the full quality gate.

## Documentation expectations

Update existing README/docs/copy when a ticket changes or exposes user-facing behavior, setup, architecture, operations, limitations, or terminology. Sprint 4 documentation should keep `docs/live-play-batch-workflows.md`, `docs/live-play-authority.md`, and `docs/private-vps-live-play-smoke.md` aligned with authoritative batch transactions, payload bounds, fallback behavior for oversized strokes, retry/status recovery, reconnect behavior, and the distinction between server-side batch commands and client-side macros.

## Safety and security constraints

Do not include:

- real secrets, credentials, access tokens, private keys, or real `.env` files;
- private campaign data or production data dumps;
- internal/private hostnames or URLs;
- destructive automation;
- direct production app-runtime edits, rebuilds, restarts, or deployment steps;
- arbitrary shell/code execution features unrelated to the project.

## Agent behaviour notes

- `BUILD_TICKETS.md` is the authoritative local autonomous queue for this Live Play Sprint 4 wave.
- Work one ticket per autonomous cycle, in numeric order; build ticket numbers follow the suggested sprint order from `sprint-4.md`.
- Keep each commit focused on the selected ticket and use a conventional commit message.
- Do not update ticket statuses beyond the selected ticket. The only exception is the final ticket #019, which may set `AUTOMATION_STATUS: DONE` after all Live Play Sprint 4 tickets are complete and the final quality gate passes.
- Do not create, close, merge, or comment on pull requests/issues from inside an autonomous ticket run unless a future ticket explicitly asks for it.
