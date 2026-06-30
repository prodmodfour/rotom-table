# PROJECT_BRIEF.md

TEMPLATE_CUSTOMISED: true

## Project name

Rotom Table — shops and live-play checkout autonomous build wave.

## Project type

Full-stack Nuxt 3 application with server-side SQLite persistence, Vue UI, TypeScript shared models, live-play command processing, realtime sync, and Vitest coverage.

## Project goal

Implement the Shops with Live-Play Integration work described by `BUILD_TICKETS.md` (`SHOPS-001` through `SHOPS-035`). The finished feature should let GMs create reusable campaign shop tables, let players browse open player-visible shopfronts, and process purchases through server-authoritative live-play checkout commands with idempotency, durable retry/outbox behavior, revision checks, scoped authority, atomic persistence, and realtime convergence.

## Audience

- Rotom Table maintainers and operators.
- GMs configuring trusted private campaign shops.
- Players buying items during live play from eligible shopfronts.
- Future autonomous or human contributors continuing the live-play architecture.

## Success criteria

The work is successful when:

- Every ticket in `BUILD_TICKETS.md` for `SHOPS-001` through `SHOPS-035` is marked `DONE`.
- `scripts/quality-gate.sh` passes on the final branch.
- Shop catalog/state is stored as campaign-level SQLite state, not as map metadata, trainer sheets, or group inventory data.
- GM shop create/save/delete flows use revision-checked setup/maintenance saves.
- Player checkout is implemented only through live-play commands, not plain last-writer-wins mutations.
- Checkout operation IDs are idempotent so double-clicks, retries, reloads, and uncertain HTTP results do not double-charge or duplicate items.
- Checkout can atomically update shop stock, trainer money/inventory, and group inventory money/inventory according to shop configuration.
- Player trainer payment/delivery is limited to trainer sheets linked to the selected player profile.
- Finite stock is decremented by checkout while unlimited stock remains unchanged.
- Other open clients converge through realtime update handling after shop edits and purchases.
- Maintenance export/backup flows include shop table data.
- Documentation explains shop state ownership, live-play command boundaries, map shop interfaces, idempotency, authorization, stock behavior, realtime convergence, and export/backup behavior.
- The top-level `AUTOMATION_STATUS` in `BUILD_TICKETS.md` is set to `DONE` when the final ticket is complete.

## Non-goals

The autonomous build must not spend time on:

- Public authentication or hardening Rotom Table into a public multi-tenant service.
- Production runtime edits, direct server rebuilds, direct deployment, or production data mutation.
- Storing shop catalog, prices, or stock in map metadata, group inventory documents, or fake trainer sheets.
- Bypassing the live-play command boundary for checkout.
- Unrelated UI redesigns, unrelated trainer-sheet behavior changes, unrelated group inventory behavior changes, or speculative commerce features.
- Closing, commenting on, or editing GitHub issues unless the user explicitly requests it.

## Technology preferences

Preferred stack:

- language: TypeScript, with existing Python/Bash helpers only where already appropriate;
- framework: Nuxt 3 and Vue 3;
- rendering: existing three.js map rendering where relevant; shop table state should not be owned by map rendering;
- database: existing SQLite live-play storage patterns;
- testing: Vitest, Vue Test Utils/happy-dom where applicable, targeted server/use-case tests, and existing test helpers;
- package manager: npm with Node.js 24 from `.nvmrc`;
- CI: existing GitHub Actions CI plus local `scripts/quality-gate.sh`.

Hard constraints:

- Follow the repository `AGENTS.md` production deployment boundaries and live-play-only instruction.
- Preserve existing GM/player trusted-table access assumptions; do not present them as public authentication.
- Keep campaign/private data, `.env` files, databases, generated runtime files, and secrets out of commits.
- Keep ticket scope narrow: implement only the lowest-numbered `TODO` ticket in each autonomous cycle.

Flexible choices:

- File names, component names, and exact route file names may differ from ticket suggestions when they fit existing architecture better.
- Tests can be targeted when a full end-to-end browser workflow is impractical, as long as the ticket acceptance criteria are meaningfully covered.

## Architecture expectations

Use existing Rotom Table boundaries:

```text
shared/src types and utilities -> server use cases/storage/API routes -> Vue composables/components/pages -> docs/tests
```

Expected patterns:

- Shared shop models and pure helpers should live in existing shared/type utility locations that can be imported by both app and server code.
- SQLite migrations and repositories should follow existing storage versioning, transaction, JSON clone/stringify, revision, stale-update, and operation-history conventions.
- API routes should use existing actor/access/writable-campaign helpers and route constant patterns.
- Checkout should reuse or extend existing live-play command, scope, outbox, idempotency, and realtime patterns rather than inventing parallel behavior.
- Shop pages should reuse existing inventory item, trainer sheet, group inventory, profile-link, and realtime primitives where they fit cleanly.
- Map shop interfaces may reference shop documents but must not own shop catalog, price, or stock state.

## Quality expectations

Expected quality gates:

- shell syntax checks for Bash automation scripts;
- build-loop regression tests from the autonomous build template;
- secret and generated/private-file guardrails;
- `npm ci` using Node.js 24 from `.nvmrc`;
- `npm run typecheck --if-present`;
- `npm test --if-present`;
- `npm run build --if-present`.

Each ticket should also run targeted tests for its area when practical before the full quality gate.

## Documentation expectations

Required docs during this wave:

- Update existing architecture/feature docs when behavior, setup, data ownership, realtime, backup/export, live-play command scope, or map-interface behavior changes.
- The final ticket must add `docs/shops.md`, link it from an appropriate architecture or feature doc, and document the current shop workflow and boundaries.
- Keep documentation honest about trusted-table GM/player access and production deployment boundaries.

## Safety and security constraints

Do not include:

- real secrets, credentials, access tokens, private keys, or real `.env` files;
- private campaign data or production data dumps;
- internal/private hostnames or URLs;
- destructive automation;
- direct production app-runtime edits, rebuilds, restarts, or deployment steps;
- arbitrary shell/code execution features unrelated to the project.

## Agent behaviour notes

- `BUILD_TICKETS.md` is the authoritative local autonomous queue; `tickets (1).md` is the imported source specification.
- Work one ticket per autonomous cycle, in numeric order.
- Keep each commit focused on the selected ticket and use a conventional commit message.
- Do not update ticket statuses beyond the selected ticket. The only exception is the final ticket #035, which may set `AUTOMATION_STATUS: DONE` after all shop tickets are complete and the final quality gate passes.
- Do not create, close, merge, or comment on pull requests/issues from inside an autonomous ticket run unless a future ticket explicitly asks for it.
