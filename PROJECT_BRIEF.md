# PROJECT_BRIEF.md

TEMPLATE_CUSTOMISED: true

## Project name

Rotom Table — Move automation: full implementation ticket queue.

## Project type

Nuxt 3 and Vue 3 live-play application with TypeScript shared models, three.js/isometric map and token rendering, server-side SQLite persistence, durable HTTP/SSE live-play command flow, IndexedDB outbox recovery, and Vitest coverage.

## Project goal

Implement the refreshed work described by `BUILD_TICKETS.md` (`MA-001` through `MA-299`), generated from the supplied ticket planning file before that handoff file was removed.

Implement the work described by `BUILD_TICKETS.md` (`MA-001` through `MA-299`).

The core rule for refreshed queues is: **ticket work must remain scoped, tested, and compatible with Rotom Table's live-play production boundaries.**

## Audience

- Rotom Table maintainers and operators.
- GMs and players using live-play maps.
- Future autonomous or human contributors maintaining the refreshed feature area.

## Success criteria

The work is successful when:

- Every ticket in `BUILD_TICKETS.md` for `MA-001` through `MA-299` is marked `DONE`.
- `scripts/quality-gate.sh` passes on the final branch.
- The refreshed ticket queue is complete.
- Tests and quality gates pass.
- Documentation reflects the implemented behavior.
- The top-level `AUTOMATION_STATUS` in `BUILD_TICKETS.md` is set to `DONE` when the final ticket is complete.

## Non-goals

- Do not broaden the refreshed ticket queue into unrelated Rotom Table work.
- Do not change production runtime state or private campaign data.
- Do not weaken live-play authority, revision checks, idempotency, or recovery behavior.

## Technology preferences

Preferred stack:

- language: TypeScript, with existing Python/Bash helpers only where already appropriate;
- framework: Nuxt 3 and Vue 3;
- rendering: existing three.js/isometric map/token rendering utilities;
- live-play flow: existing HTTP/SSE command and replay architecture with IndexedDB outbox recovery;
- testing: Vitest, Vue Test Utils/happy-dom where applicable, focused utility tests, renderer state tests, and existing integration helpers;
- package manager: npm with Node.js 24 from `.nvmrc`;
- CI: existing GitHub Actions CI plus local `scripts/quality-gate.sh`.

Hard constraints:

- Follow the repository `AGENTS.md` production deployment boundaries and live-play-only instruction.
- Keep campaign/private data, `.env` files, databases, generated runtime files, and secrets out of commits.
- Keep ticket scope narrow: implement only the lowest-numbered `TODO` ticket in each autonomous cycle.
- Keep work scoped to the selected ticket.
- Preserve Rotom Table's live-play-only production boundaries.
- Keep runtime/generated/private data out of commits.
- Do not introduce new dependencies unless there is no practical in-repo alternative.

Flexible choices:

- Exact helper names, file locations, and resolver names may differ from ticket suggestions when they fit the existing architecture better.
- Tests should focus on deterministic utilities and integration boundaries where practical.
- Documentation should be updated when a ticket changes user-facing behavior, architecture, operations, or terminology.

## Architecture expectations

Use existing Rotom Table boundaries and keep the refreshed work aligned with the ticket queue:

```text
planning document -> BUILD_TICKETS.md queue -> scoped ticket implementation -> targeted validation -> quality gate -> conventional commit
```

Expected patterns:

- Keep each autonomous cycle focused on the lowest-numbered `TODO` ticket.
- Prefer pure helpers and narrow integration points so behavior can be tested without broad rewrites.
- Preserve live-play authority, privacy boundaries, and production deployment boundaries unless a selected ticket explicitly requires a reviewed change.
- Keep generated, runtime, and private data out of commits.

## Quality expectations

Expected quality gates:

- shell syntax checks for Bash automation scripts;
- build-loop regression tests from the autonomous build template;
- secret and generated/private-file guardrails;
- `npm ci` using Node.js 24 from `.nvmrc`;
- `npm run typecheck --if-present`;
- `npm test --if-present`;
- `npm run build --if-present`.

Each ticket should also run targeted verification commands for the changed utilities, components, pages, server code, or docs where practical before the full quality gate.

## Documentation expectations

Update existing README/docs/copy when a ticket changes or exposes user-facing behavior, renderer architecture, live-play behavior, operations, limitations, or terminology. Keep `BUILD_TICKETS.md` authoritative for autonomous execution.

## Safety and security constraints

Do not include:

- real secrets, credentials, access tokens, private keys, or real `.env` files;
- private campaign data or production data dumps;
- internal/private hostnames or URLs;
- destructive automation;
- direct production app-runtime edits, rebuilds, restarts, or deployment steps;
- arbitrary shell/code execution features unrelated to the project.

## Agent behaviour notes

- `BUILD_TICKETS.md` is the authoritative local autonomous queue for Move automation: full implementation ticket queue.
- Work one ticket per autonomous cycle, in numeric order; build ticket numbers follow the refreshed planning file's suggested order when present.
- Keep each commit focused on the selected ticket and use a conventional commit message.
- Do not update ticket statuses beyond the selected ticket. The only exception is the final ticket `MA-299`, which may set `AUTOMATION_STATUS: DONE` after all 279 refreshed tickets are complete and the final quality gate passes.
- Do not create, close, merge, or comment on pull requests/issues from inside an autonomous ticket run unless a future ticket explicitly asks for it.
