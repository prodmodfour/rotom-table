# PROJECT_BRIEF.md

TEMPLATE_CUSTOMISED: true

## Project name

Rotom Table — Live Play Sprint 3 ephemeral presence and table-feel wave.

## Project type

Full-stack Nuxt 3 application with server-side SQLite persistence, Vue UI, TypeScript shared models, durable HTTP/SSE live-play command flow, IndexedDB outbox recovery, three.js map/token rendering, and Vitest coverage.

## Project goal

Implement the Live Play Sprint 3 work described by `BUILD_TICKETS.md` (`001` through `018`), refreshed from `sprint-3.md`. The finished wave should make live play feel more like a shared LAN tabletop by adding ephemeral presence, connected-participant display, token attention, map pings, shared targeting/measurement intent, GM attention requests, and debug/ops coverage while preserving the Sprint 1–2 server-authoritative command model.

Presence and intent state is presentation-only. It must be short-lived, display-safe, non-durable, and unable to grant token control, mutate campaign state, bypass profile/map visibility checks, replace command routes, or block normal gameplay commands when presence transport fails.

## Audience

- Rotom Table maintainers and operators.
- GMs running live-play maps with multiple clients.
- Players coordinating movement, target selection, pings, and attention during live sessions.
- Future autonomous or human contributors maintaining live-play command authority, ephemeral presence, realtime delivery, map rendering, and privacy boundaries.

## Success criteria

The work is successful when:

- Every ticket in `BUILD_TICKETS.md` for `001` through `018` is marked `DONE`.
- `scripts/quality-gate.sh` passes on the final branch.
- Shared presence contracts strictly parse and sanitize display-safe participant summaries, selected/hovered token IDs, intent state, pings, and client timestamps/sequences.
- Server-side presence is kept in process-local memory with TTL expiry and without SQLite writes, campaign file writes, durable realtime rows, or map/sheet document mutation.
- Presence snapshot and heartbeat/update routes reuse existing role/profile/map visibility checks and never leak hidden-map, raw profile, sheet, command-body, access-gate, hostname, or secret data.
- Transient presence updates can be broadcast over the existing realtime surface without advancing durable sequence numbers, while HTTP snapshot/heartbeat remains a fallback.
- The map page has a single client presence composable for snapshots, heartbeats, transient updates, local expiry, tab-visibility throttling, own-state updates, error state, and transport freshness.
- Connected participants render compactly with display-safe labels, accents, freshness, and high-level intent.
- Local token selection and hover publish presence only for visible tokens, and remote token attention renders without changing token-control permissions or obscuring local pending/correction state.
- Players and GMs can place short-lived map pings that expire locally and never change map revision or durable realtime history.
- Targeting, measurement, and movement intent can be published and rendered without exposing hidden move details, sheet payloads, or unsafe target lists.
- GM attention requests are GM-only, player-safe, and never force disruptive camera movement unless an explicit preference allows it.
- Presence privacy, access, failure, degradation, profile-switch, stale-expiry, and transport-loss tests prove presence improves feel but never becomes a gameplay dependency.
- The latency debug panel can optionally show presence freshness metrics in debug mode without weakening command trace redaction.
- Operator docs explain the non-authoritative presence boundary and include smoke steps for three-client presence, pings, intent, hidden-map access, reconnect, and presence failure.
- The top-level `AUTOMATION_STATUS` in `BUILD_TICKETS.md` is set to `DONE` when the final ticket is complete.

## Non-goals

The autonomous build must not spend time on:

- Replacing authoritative HTTP live-play command routes with WebSockets.
- Sending authoritative gameplay commands through the presence transport.
- Making presence, pings, hover, selection, target previews, camera focus, or intent durable campaign state.
- Letting presence state grant token control, bypass profile validation, bypass map visibility checks, or alter command authorisation.
- Storing private profile payloads, sheet data, command bodies, access-gate data, internal/private hostnames, credentials, tokens, or secrets in presence events.
- Making local presence failure block normal gameplay commands.
- Building broad voice, video, or chat features.
- Implementing batch workflows; that belongs in a later sprint after presence/table-feel work lands.
- Weakening Sprint 1–2 server authority, revision checks, idempotency, durable outbox recovery, authorised realtime replay, or prediction reconciliation.
- Public authentication or hardening Rotom Table into a public multi-tenant service.
- Production runtime edits, direct server rebuilds, direct deployment, or production data mutation.
- Unrelated UI redesigns, unrelated encounter/spawn behavior changes, unrelated trainer-sheet behavior changes, unrelated inventory behavior changes, or speculative live-play features.
- Closing, commenting on, or editing GitHub issues unless the user explicitly requests it.

## Technology preferences

Preferred stack:

- language: TypeScript, with existing Python/Bash helpers only where already appropriate;
- framework: Nuxt 3 and Vue 3;
- rendering: existing three.js map/token rendering and Vue map page components;
- persistence/realtime: existing SQLite live-play storage, HTTP command endpoints, SSE realtime events, durable IndexedDB outbox patterns, plus transient non-durable presence delivery where practical;
- testing: Vitest, Vue Test Utils/happy-dom where applicable, targeted composable/page/server tests, and existing test helpers;
- package manager: npm with Node.js 24 from `.nvmrc`;
- CI: existing GitHub Actions CI plus local `scripts/quality-gate.sh`.

Hard constraints:

- Follow the repository `AGENTS.md` production deployment boundaries and live-play-only instruction.
- Keep campaign/private data, `.env` files, databases, generated runtime files, and secrets out of commits.
- Keep ticket scope narrow: implement only the lowest-numbered `TODO` ticket in each autonomous cycle.
- Preserve the server-authoritative command model: presence is local/ephemeral presentation state only and must not be treated as durable authoritative state.
- Presence transport must degrade gracefully; command dispatch remains governed by existing command/reconciliation blockers, not by presence freshness.
- Preserve role/profile/map visibility checks for all presence snapshots, heartbeats, pings, intent, and transient events.
- Redact or reject command bodies, private profile IDs, sheet payloads, arbitrary records, over-large strings, unknown durable-state fields, access-gate data, and sensitive resource details from presence contracts, debug UI, and logs.

Flexible choices:

- File names, helper names, hook names, and exact component/composable test locations may differ from ticket suggestions when they fit existing architecture better.
- Tests can be targeted when a full end-to-end browser workflow is impractical, as long as the ticket acceptance criteria are meaningfully covered.
- Transient presence may be snapshot- or delta-shaped as long as reconnecting clients rebuild from snapshot/heartbeat rather than durable replay.
- Multi-process presence delivery may degrade gracefully in this sprint if the in-memory registry remains safe and process-local.
- Visual treatments for participants, token attention, pings, targeting, and GM attention may be subtle, low-noise alternatives to the suggested rings, badges, reticles, text, or focus affordances.

## Architecture expectations

Use existing Rotom Table boundaries:

```text
shared presence contract/parsers -> server access + process-local presence registry -> HTTP snapshot/heartbeat routes + transient realtime delivery -> map-editor presence composable -> Vue map page/presence panel/isometric renderers -> docs/tests
```

Expected patterns:

- Presence schema helpers should be pure, strict, framework-free where practical, and shared by server, client, and tests.
- Server identity should come from authenticated role/profile/map context; client-supplied identity fields should be ignored, rejected, or overwritten.
- Presence registry state should be keyed by map slug plus realtime principal/client context, sanitized on write, TTL-pruned on list/update, and removable on disconnect/profile context change when possible.
- Snapshot and heartbeat routes should be read/presentation APIs with no cacheable private responses and no authoritative command result semantics.
- Transient realtime presence events should be unsequenced/non-durable, delivered only to currently authorised viewers, and never appended to the durable live-play event log.
- Client presence should maintain readonly entries, own presence state, pings, freshness metrics, non-blocking error state, local TTL expiry, hidden-tab throttling, and clear boundaries from live-play command dispatch.
- UI components should render display-safe participant labels, token attention, pings, and intent while preserving local interaction priority and existing pending/correction affordances.
- Privacy/access tests should be added before or alongside visual polish whenever a ticket expands what presence can carry or render.

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

Update existing README/docs/copy only when a ticket changes or exposes user-facing behavior, setup, architecture, operations, limitations, or terminology. The final documentation ticket should add or refresh concise live-play authority and private VPS smoke notes covering ephemeral presence, pings, token attention, intent, GM attention, hidden-map/profile privacy, reconnect, degradation, and the non-authoritative boundary.

## Safety and security constraints

Do not include:

- real secrets, credentials, access tokens, private keys, or real `.env` files;
- private campaign data or production data dumps;
- internal/private hostnames or URLs;
- destructive automation;
- direct production app-runtime edits, rebuilds, restarts, or deployment steps;
- arbitrary shell/code execution features unrelated to the project.

## Agent behaviour notes

- `BUILD_TICKETS.md` is the authoritative local autonomous queue for this Live Play Sprint 3 wave.
- Work one ticket per autonomous cycle, in numeric order; build ticket numbers follow the suggested sprint order from `sprint-3.md`.
- Keep each commit focused on the selected ticket and use a conventional commit message.
- Do not update ticket statuses beyond the selected ticket. The only exception is the final ticket #018, which may set `AUTOMATION_STATUS: DONE` after all Live Play Sprint 3 tickets are complete and the final quality gate passes.
- Do not create, close, merge, or comment on pull requests/issues from inside an autonomous ticket run unless a future ticket explicitly asks for it.
