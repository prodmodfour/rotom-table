# PROJECT_BRIEF.md

TEMPLATE_CUSTOMISED: true

## Project name

Rotom Table — Live Play Sprint 2 prediction hardening and debug wave.

## Project type

Full-stack Nuxt 3 application with server-side SQLite persistence, Vue UI, TypeScript shared models, durable HTTP/SSE live-play command flow, IndexedDB outbox recovery, three.js map/token rendering, and Vitest coverage.

## Project goal

Implement the Live Play Sprint 2 work described by `BUILD_TICKETS.md` (`001` through `015`), refreshed from `sprint-2.md`. The finished wave should harden the Sprint 1 local-prediction model under real table pressure: out-of-order HTTP/SSE terminal results, reconnects and replay gaps, remote accepted patches while local predictions are pending, repeated same-token input, status-check recovery, user-visible correction paths, and narrowly scoped prediction coverage for additional low-risk token feedback.

## Audience

- Rotom Table maintainers and operators.
- GMs running live-play maps with multiple clients.
- Players moving, turning, or making simple token-facing edits during live sessions.
- Future autonomous or human contributors maintaining live-play command, prediction, reconciliation, recovery, and map rendering code.

## Success criteria

The work is successful when:

- Every ticket in `BUILD_TICKETS.md` for `001` through `015` is marked `DONE`.
- `scripts/quality-gate.sh` passes on the final branch.
- Command lifecycle tracing records built, predicted, enqueued, sent, HTTP/SSE terminal, patch adoption, confirmation, rejection, rollback, and uncertainty events without logging private command payloads by default.
- A query-flagged latency debug panel helps maintainers distinguish client prediction, outbox, HTTP, SSE, patch adoption, and reconciliation timing while staying hidden in normal play.
- Incoming authoritative patches are compared against pending local predictions with conservative conflict detection.
- Accepted remote patches can be adopted while local predictions are pending by temporarily rolling back predictions, applying authoritative state, and reapplying only safe non-conflicting predictions.
- SSE-first and HTTP-first terminal delivery are both idempotent, including stale replay and conflicting late rejection cases for the same `opId`.
- Reconnect, replay-gap, and snapshot recovery clear or suspend presentation-only predictions without overwriting the freshly loaded authoritative snapshot.
- Command-status checks can resolve accepted, rejected, and unknown pending predictions without resending or duplicating local predictions.
- Same-token coalesced movement rebuilds queued superseding moves from the latest authoritative map revision before send.
- Additional low-risk token feedback, such as simple HP HUD state and condition pending indicators, remains local presentation metadata and never mutates cached sheet documents as authoritative state.
- Correction notices for predicted actions are deduplicated and have a bounded lifetime.
- Chaos/integration coverage exercises multi-client prediction, scoped concurrency, out-of-order terminals, reconnect recovery, and deterministic final authoritative map state.
- Operator smoke notes cover the Sprint 2 hardening scenarios and clearly distinguish local prediction from authoritative acceptance, reconciliation, and recovery.
- The top-level `AUTOMATION_STATUS` in `BUILD_TICKETS.md` is set to `DONE` when the final ticket is complete.

## Non-goals

The autonomous build must not spend time on:

- Replacing the existing HTTP/SSE live-play transport with WebSockets.
- Weakening server authority, profile validation, revision checks, idempotency, authorised realtime replay, or durable outbox recovery.
- Predicting complex or hidden-information rule outcomes such as `resolveMove`, capture, shop checkout, encounter spawn, random effects, movement logs, attack-of-opportunity side effects, broad sheet edits, or move automation side effects.
- Making local predictions durable authoritative state. Prediction state remains presentation-only and must be discarded or rebuilt from authoritative state.
- Implementing broad CRDT/document merging. Conflicts remain tabletop-domain scoped.
- Mutating cached Pokémon/trainer sheet documents as prediction for HP or condition feedback.
- Removing the durable IndexedDB outbox; the goal is to reduce perceived latency and improve recovery, not bypass durable delivery.
- Rewriting map storage, campaign data formats, token rendering, or command APIs beyond the ticketed live-play prediction hardening changes.
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
- Preserve the server-authoritative command model: predictions are local visual/presentation overlays only and must not be treated as durable authoritative state.
- Preserve recovery, reconnect/replay-gap reconciliation, abandonment, and Prepare Map blockers when command safety is uncertain.
- Keep prediction patches local-only; do not persist them or send them as authoritative patches.
- Redact command bodies, private profile IDs, sheet payloads, and sensitive resource details from debug tracing and latency UI.

Flexible choices:

- File names, helper names, hook names, and exact component/composable test locations may differ from ticket suggestions when they fit existing architecture better.
- Tests can be targeted when a full end-to-end browser workflow is impractical, as long as the ticket acceptance criteria are meaningfully covered.
- Adoption hooks may be implemented as paired before/after callbacks or as an equivalent focused coordinator if the call order and failure behavior are testable.
- Additional HP or condition prediction paths may be limited to existing token HUD/presentation affordances and should no-op when the current UI has no safe local representation.

## Architecture expectations

Use existing Rotom Table boundaries:

```text
shared live-play scope/conflict/prediction utilities -> map-editor live-play command composable -> editable-map authoritative patch/adoption/reconciliation handling -> Vue map page/token presentation/debug panels -> docs/tests
```

Expected patterns:

- Command lifecycle tracing should be in-memory, keyed by `opId`, readonly to callers, and safe for tests and optional debug UI without logging command bodies by default.
- Scope and prediction-conflict helpers should be pure, side-effect free, framework-free, and conservative for unknown or broad scopes.
- Pending command state should stay keyed by stable `opId` and include request path, command type, base revision, scopes, body metadata, prediction state, and lifecycle state.
- Local predictions should be layered over authoritative map state and cleaned up idempotently when HTTP, SSE, or status-check terminal results arrive in any order.
- Authoritative patch adoption should apply accepted server patches to clean authoritative state, then reapply only safe non-conflicting pending predictions.
- Conflicting predictions should roll back through the existing correction/rejection or reconciliation path rather than merging divergent local and remote state.
- Accepted hot-path command responses and realtime events should prefer authoritative patches where safe, falling back to full-map adoption or reconciliation only when needed.
- Reconnect/replay-gap recovery and authoritative snapshot reloads should discard presentation-only predictions and preserve only durable outbox/status-resolution needs.
- UI changes should make prediction, correction, latency, and token-scoped pending state honest without reintroducing a global page-level input lock for unrelated commands.

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

Update existing README/docs/copy only when a ticket changes or exposes user-facing behavior, setup, architecture, operations, limitations, or terminology. The final smoke-note ticket should add or refresh a concise live-play prediction-hardening checklist covering remote patch rebase, out-of-order terminal responses, reconnect/gap prediction clearing, status-check resolution, and correction-notice deduping.

## Safety and security constraints

Do not include:

- real secrets, credentials, access tokens, private keys, or real `.env` files;
- private campaign data or production data dumps;
- internal/private hostnames or URLs;
- destructive automation;
- direct production app-runtime edits, rebuilds, restarts, or deployment steps;
- arbitrary shell/code execution features unrelated to the project.

## Agent behaviour notes

- `BUILD_TICKETS.md` is the authoritative local autonomous queue for this Live Play Sprint 2 wave.
- Work one ticket per autonomous cycle, in numeric order; build ticket numbers follow the suggested sprint order from `sprint-2.md`.
- Keep each commit focused on the selected ticket and use a conventional commit message.
- Do not update ticket statuses beyond the selected ticket. The only exception is the final ticket #015, which may set `AUTOMATION_STATUS: DONE` after all Live Play Sprint 2 tickets are complete and the final quality gate passes.
- Do not create, close, merge, or comment on pull requests/issues from inside an autonomous ticket run unless a future ticket explicitly asks for it.
