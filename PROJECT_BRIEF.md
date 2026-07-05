# PROJECT_BRIEF.md

TEMPLATE_CUSTOMISED: true

## Project name

Rotom Table — Live Play Token Motion Sprint 5.

## Project type

Nuxt 3 and Vue 3 live-play application with TypeScript shared models, three.js/isometric map and token rendering, server-side SQLite persistence, durable HTTP/SSE live-play command flow, IndexedDB outbox recovery, and Vitest coverage.

## Project goal

Implement the Live Play Sprint 5 work described by `BUILD_TICKETS.md` (`LP-S5-001` through `LP-S5-017`). The finished sprint should make token movement look and feel smooth without weakening the server-authoritative live-play model.

The core rule for this sprint is: **token motion is presentation only; authoritative map state remains the truth.** Movement animation should bridge previous and current rendered positions through explicit runtime motion tracks, predictable durations, path-aware interpolation, correction/replacement policies, and reduced-motion support. It must not change command authority, durable state, replay semantics, conflict handling, or hidden-information boundaries.

## Audience

- Rotom Table maintainers and operators.
- GMs and players using live-play maps with Pokémon tokens.
- Future autonomous or human contributors maintaining live-play command flow, token rendering, motion affordances, and operator smoke docs.

## Success criteria

The work is successful when:

- Every ticket in `BUILD_TICKETS.md` for `LP-S5-001` through `LP-S5-017` is marked `DONE`.
- `scripts/quality-gate.sh` passes on the final branch.
- Current token movement presentation is documented well enough to guide the sprint.
- Token movement uses explicit presentation motion tracks instead of only generic render-state center lerp.
- Motion curve, duration, interpolation, replacement, cancellation, path, elevation, correction, and reduced-motion policies are covered by focused tests where practical.
- New render objects spawn at their first authoritative center without animating from origin or another token.
- Local predicted movement starts immediately and does not stutter when the matching authoritative confirmation arrives.
- Remote accepted movement animates smoothly for observing clients when practical.
- Rapid repeated same-token destinations replace active motion without visible snapback.
- Known movement paths animate through waypoints when available and fall back safely when unavailable.
- Elevation changes, facing updates, shadows, HUD elements, pings, presence overlays, targeting affordances, HP bars, cages, proxies, and camera focus remain visually coherent during motion.
- Rejected predictions and reconciliation snapshots follow clear correction/snap policies.
- Reduced-motion users get shortened or snapped movement with clear state changes.
- Optional debug tooling helps distinguish command latency from animation smoothness without leaking private token information.
- Operator docs include a movement-smoothness smoke checklist for GM and player-browser review.
- Motion polish does not change authoritative map state, command dispatch, revision checks, idempotency, recovery, replay authorization, conflict scopes, or network transport.
- The top-level `AUTOMATION_STATUS` in `BUILD_TICKETS.md` is set to `DONE` when the final ticket is complete.

## Non-goals

The autonomous build must not spend time on:

- Changing live-play command authority, `opId` idempotency, revision checks, conflict scopes, durable outbox recovery, or authorised realtime replay.
- Making animation state authoritative or durable campaign state.
- Delaying server command dispatch until animation finishes.
- Making accepted authoritative state wait for animation before becoming the source of truth.
- Reintroducing a global live-play input lock while tokens animate.
- Replacing HTTP/SSE command transport or Sprint 3 presence transport.
- Requiring new art assets, skeletal animation, or a broad VFX rewrite.
- Animating hidden/private token information to unauthorized clients.
- Changing unrelated Pokémon placement rules, targeting rules, combat automation, encounter behavior, trainer sheets, inventory behavior, saved map schemas, or unrelated map renderer behavior.
- Public authentication or hardening Rotom Table into a public multi-tenant service.
- Production runtime edits, direct server rebuilds, direct deployment, or production data mutation.
- Closing, commenting on, or editing GitHub issues unless the user explicitly requests it.

## Technology preferences

Preferred stack:

- language: TypeScript, with existing Python/Bash helpers only where already appropriate;
- framework: Nuxt 3 and Vue 3;
- rendering: existing three.js isometric map/token rendering utilities;
- live-play flow: existing HTTP/SSE command and replay architecture with IndexedDB outbox recovery;
- testing: Vitest, Vue Test Utils/happy-dom where applicable, focused pure motion utility tests, renderer state tests, and existing integration helpers;
- package manager: npm with Node.js 24 from `.nvmrc`;
- CI: existing GitHub Actions CI plus local `scripts/quality-gate.sh`.

Hard constraints:

- Follow the repository `AGENTS.md` production deployment boundaries and live-play-only instruction.
- Keep campaign/private data, `.env` files, databases, generated runtime files, and secrets out of commits.
- Keep ticket scope narrow: implement only the lowest-numbered `TODO` ticket in each autonomous cycle.
- Keep motion state presentation-only, runtime-only, and non-serializable.
- Preserve server-authoritative map state as the source of truth.
- Preserve existing command dispatch, revision checks, idempotency, outbox recovery, authorised realtime replay, prediction reconciliation, and presence privacy boundaries.
- Do not introduce saved map schema or network contract changes unless a selected ticket explicitly requires a narrow, reviewed extension.
- Do not animate token information that the current user is not authorised to see.
- Preserve token picking, hover, HP bars, shadows, cages, pings, presence attention, targeting overlays, and camera focus throughout motion work.
- Do not introduce new dependencies for motion work unless there is no practical in-repo alternative.

Flexible choices:

- Exact helper names, file locations, and resolver names may differ from ticket suggestions when they fit the existing renderer architecture better.
- Motion tracks may be modelled with plain objects or small helper factories as long as they remain runtime-only and testable.
- Duration and easing values may be tuned as long as they remain deterministic, bounded, accessible, and covered by tests.
- Reduced-motion policy may snap or heavily shorten motion, using existing settings where available.
- Path-aware movement should fall back to direct movement when preview paths are unavailable or invalid.
- Debug metrics should stay optional/debug-only and avoid private token names or hidden-state leaks.

## Architecture expectations

Use existing Rotom Table boundaries:

```text
live-play command/prediction/reconciliation flow -> visible placement changes -> token motion planning utilities -> renderer-owned runtime motion tracks -> animation frame sampling -> token render object/HUD synchronization -> optional debug metrics -> operator smoke docs
```

Expected patterns:

- Keep authoritative placement state and presentation motion state separate.
- Prefer pure utility modules for easing, duration, interpolation, track sampling, replacement, path segmentation, and correction policies so tests can validate motion without full browser rendering.
- Start motion tracks only for placement movement, not for sheet/HUD-only updates such as HP, conditions, or combat stages.
- New/spawned tokens should appear at their authoritative center unless a selected ticket explicitly adds spawn animation.
- Replacing an active same-token movement should start from the sampled current position to avoid snapback.
- Render continuation should run while motion tracks are active and stop once they complete.
- HUD elements, shadows, cages, proxies, overlays, and camera focus should follow the sampled center consistently.
- Explicit turn commands should remain responsive while move-token animations use a tested facing policy.
- Reconciliation snapshot adoption should avoid replaying stale local intent over fresh authoritative state.
- Reduced-motion and performance safeguards should be centralised in motion planning rather than scattered through renderer code.
- Documentation should repeatedly distinguish presentation animation from authoritative position.

## Quality expectations

Expected quality gates:

- shell syntax checks for Bash automation scripts;
- build-loop regression tests from the autonomous build template;
- secret and generated/private-file guardrails;
- `npm ci` using Node.js 24 from `.nvmrc`;
- `npm run typecheck --if-present`;
- `npm test --if-present`;
- `npm run build --if-present`.

Each ticket should also run targeted verification commands for the changed motion utilities, renderer utilities, page/composable watchers, or docs where practical before the full quality gate.

## Documentation expectations

Update existing README/docs/copy when a ticket changes or exposes user-facing behavior, renderer architecture, debug tooling, smoke steps, limitations, or terminology. Sprint 5 should introduce and maintain `docs/live-play-token-motion.md` as the movement-presentation reference, and should update `docs/private-vps-live-play-smoke.md` or related operator docs with token-motion smoke coverage by the end of the sprint.

## Safety and security constraints

Do not include:

- real secrets, credentials, access tokens, private keys, or real `.env` files;
- private campaign data or production data dumps;
- internal/private hostnames or URLs;
- destructive automation;
- direct production app-runtime edits, rebuilds, restarts, or deployment steps;
- arbitrary shell/code execution features unrelated to the project;
- private or hidden token details in debug metrics, logs, docs examples, or tests.

## Agent behaviour notes

- `BUILD_TICKETS.md` is the authoritative local autonomous queue for Live Play Sprint 5.
- Work one ticket per autonomous cycle, in numeric order; build ticket numbers follow the suggested order from the Sprint 5 planning document.
- Keep each commit focused on the selected ticket and use a conventional commit message.
- Do not update ticket statuses beyond the selected ticket. The only exception is the final ticket `LP-S5-017`, which may set `AUTOMATION_STATUS: DONE` after all Sprint 5 tickets are complete and the final quality gate passes.
- Do not create, close, merge, or comment on pull requests/issues from inside an autonomous ticket run unless a future ticket explicitly asks for it.
