# PROJECT_BRIEF.md

TEMPLATE_CUSTOMISED: true

## Project name

Rotom Table — Live Play Sprint 1 local prediction and scoped concurrency wave.

## Project type

Full-stack Nuxt 3 application with server-side SQLite persistence, Vue UI, TypeScript shared models, durable HTTP/SSE live-play command flow, IndexedDB outbox recovery, three.js map/token rendering, and Vitest coverage.

## Project goal

Implement the Live Play Sprint 1 work described by `BUILD_TICKETS.md` (`001` through `014`), refreshed from `tickets.md`. The finished wave should make high-frequency live-play token movement and facing feel immediate while preserving the existing server-authoritative model, durable replay/recovery behavior, profile validation, revision checks, and idempotency guarantees.

## Audience

- Rotom Table maintainers and operators.
- GMs running live-play maps with multiple clients.
- Players moving or turning controlled tokens during live sessions.
- Future autonomous or human contributors maintaining live-play command, prediction, reconciliation, and map rendering code.

## Success criteria

The work is successful when:

- Every ticket in `BUILD_TICKETS.md` for `001` through `014` is marked `DONE`.
- `scripts/quality-gate.sh` passes on the final branch.
- Client-side scope conflict utilities conservatively classify independent and conflicting live-play scopes.
- Live-play command state tracks multiple pending operations by `opId` instead of relying on one global saving lock.
- Transport/pending status remains visible without blocking unrelated safe commands.
- Scope-aware blocking allows unrelated token commands to overlap while preserving stricter recovery, reconciliation, abandonment, and non-concurrent command gates.
- Local prediction builders and overlay state make `moveToken` and `turnToken` render immediately on the originating client.
- Authoritative HTTP/SSE acceptances are idempotent, remove matching predictions, and prefer accepted patches over whole-map replacement on hot-path commands.
- Rejected predicted token actions roll back only the affected scope and surface a concise, non-modal correction notice.
- Same-token rapid movement avoids sending obsolete unsent destinations while preserving stable `opId` and body data once sent.
- Token-level pending/correction affordances communicate prediction state without making the whole table feel blocked.
- Regression coverage locks in scoped concurrency behavior and prediction rollback behavior.
- A concise manual live-play feel smoke checklist documents instant local prediction versus authoritative acceptance.
- The top-level `AUTOMATION_STATUS` in `BUILD_TICKETS.md` is set to `DONE` when the final ticket is complete.

## Non-goals

The autonomous build must not spend time on:

- Replacing the existing HTTP/SSE live-play transport with WebSockets.
- Weakening server authority, profile validation, revision checks, idempotency, durable realtime replay, or outbox recovery.
- Optimistically executing complex or hidden-information rule outcomes such as `resolveMove`, capture, shop checkout, inventory transfers, encounter spawn, random effects, movement logs, or attack-of-opportunity side effects.
- Removing the durable IndexedDB outbox; the goal is to reduce its perceived latency impact, not bypass it.
- Rewriting map storage, campaign data formats, token rendering, or command APIs beyond the ticketed live-play prediction/concurrency changes.
- Public authentication or hardening Rotom Table into a public multi-tenant service.
- Production runtime edits, direct server rebuilds, direct deployment, or production data mutation.
- Unrelated UI redesigns, unrelated encounter/spawn behavior changes, unrelated trainer-sheet behavior changes, unrelated inventory behavior changes, or speculative live-play features.
- Closing, commenting on, or editing GitHub issues unless the user explicitly requests it.

## Technology preferences

Preferred stack:

- language: TypeScript, with existing Python/Bash helpers only where already appropriate;
- framework: Nuxt 3 and Vue 3;
- rendering: existing three.js map/token rendering and Vue map page components;
- persistence/realtime: existing SQLite live-play storage, HTTP command endpoints, SSE realtime events, and durable IndexedDB outbox patterns;
- testing: Vitest, Vue Test Utils/happy-dom where applicable, targeted composable/page/server tests, and existing test helpers;
- package manager: npm with Node.js 24 from `.nvmrc`;
- CI: existing GitHub Actions CI plus local `scripts/quality-gate.sh`.

Hard constraints:

- Follow the repository `AGENTS.md` production deployment boundaries and live-play-only instruction.
- Keep campaign/private data, `.env` files, databases, generated runtime files, and secrets out of commits.
- Keep ticket scope narrow: implement only the lowest-numbered `TODO` ticket in each autonomous cycle.
- Preserve the server-authoritative command model: predictions are local visual overlays only and must not be treated as durable authoritative state.
- Preserve recovery and reconciliation blockers when command safety is uncertain.
- Keep prediction patches local-only; do not persist them or send them as authoritative patches.

Flexible choices:

- File names, helper names, and exact component/composable test locations may differ from ticket suggestions when they fit existing architecture better.
- Tests can be targeted when a full end-to-end browser workflow is impractical, as long as the ticket acceptance criteria are meaningfully covered.
- `moveToken` and `turnToken` same-token interaction rules may follow the conservative scope helper behavior as long as the behavior is explicit and tested.

## Architecture expectations

Use existing Rotom Table boundaries:

```text
shared live-play scope/prediction utilities -> map-editor live-play command composable -> editable-map authoritative patch/reconciliation handling -> Vue map page/token rendering -> docs/tests
```

Expected patterns:

- Scope conflict helpers should be pure, side-effect free, and conservative for unknown or broad scopes.
- Pending command state should be keyed by stable `opId` and include request path, command type, base revision, scopes, body, and lifecycle state.
- Local predictions should be layered over authoritative map state and cleaned up idempotently when HTTP and SSE terminal results arrive in either order.
- Accepted hot-path command responses should apply authoritative patches where safe, falling back to full-map adoption or reconciliation only when needed.
- Recovery, reconnect/replay-gap reconciliation, Prepare Map gates, and explicitly non-concurrent commands should remain stricter than ordinary scoped token movement/facing commands.
- UI changes should make prediction status honest and token-scoped without reintroducing a global page-level input lock for unrelated commands.

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

Update existing README/docs/copy only when a ticket changes or exposes user-facing behavior, setup, architecture, operations, limitations, or terminology. The final smoke-note ticket should add a concise live-play feel checklist that distinguishes instant local prediction from authoritative server acceptance.

## Safety and security constraints

Do not include:

- real secrets, credentials, access tokens, private keys, or real `.env` files;
- private campaign data or production data dumps;
- internal/private hostnames or URLs;
- destructive automation;
- direct production app-runtime edits, rebuilds, restarts, or deployment steps;
- arbitrary shell/code execution features unrelated to the project.

## Agent behaviour notes

- `BUILD_TICKETS.md` is the authoritative local autonomous queue for this Live Play Sprint 1 wave.
- Work one ticket per autonomous cycle, in numeric order; build ticket numbers follow the suggested sprint order from `tickets.md`.
- Keep each commit focused on the selected ticket and use a conventional commit message.
- Do not update ticket statuses beyond the selected ticket. The only exception is the final ticket #014, which may set `AUTOMATION_STATUS: DONE` after all Live Play Sprint 1 tickets are complete and the final quality gate passes.
- Do not create, close, merge, or comment on pull requests/issues from inside an autonomous ticket run unless a future ticket explicitly asks for it.
