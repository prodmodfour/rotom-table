# PROJECT_BRIEF.md

TEMPLATE_CUSTOMISED: true

## Project name

Rotom Table — group inventory autonomous build wave.

## Project type

Full-stack Nuxt 3 application with server-side SQLite persistence, Vue UI, TypeScript shared models, and Vitest coverage.

## Project goal

Implement the Rotom Table group/party inventory feature described by GitHub issues #27 through #44, using one autonomous build ticket per issue. The finished feature should provide campaign-level shared inventory state, GM direct editing, GM/player trainer transfer flows, realtime sync, maintenance export support, and documentation consistent with the app's trusted-table live-play model.

## Audience

- Rotom Table maintainers and operators.
- GMs and players using a trusted private campaign table.
- Future autonomous or human contributors continuing the live-play architecture.

## Success criteria

The work is successful when:

- Every ticket in `BUILD_TICKETS.md` for issues #27-#44 is marked `DONE`.
- `scripts/quality-gate.sh` passes on the final branch.
- Group inventory data is stored as campaign-level SQLite state, not as map metadata or a fake trainer sheet.
- GM direct edits and transfer mutations are revision-checked and do not overwrite stale authoritative data.
- Players can transfer inventory only for trainer sheets linked to their selected profile.
- Other open clients converge through realtime update handling after saves and transfers.
- Export/backup flows include group inventory state.
- Documentation explains current behaviour and the deferred live-play command boundary.
- The top-level `AUTOMATION_STATUS` in `BUILD_TICKETS.md` is set to `DONE` when the final issue ticket is complete.

## Non-goals

The autonomous build must not spend time on:

- Public authentication or hardening Rotom Table into a public multi-tenant service.
- Production runtime edits, direct server rebuilds, direct deployment, or production data mutation.
- In-map item consumption or new live-play command scopes unless a later ticket explicitly asks for them.
- Unrelated UI redesigns, unrelated trainer-sheet behaviour changes, or speculative inventory features.
- Closing, commenting on, or editing GitHub issues unless the user explicitly requests it.

## Technology preferences

Preferred stack:

- language: TypeScript, with existing Python/Bash helpers only where already appropriate.
- framework: Nuxt 3 and Vue 3.
- rendering: existing three.js map rendering where relevant; group inventory UI should not touch map rendering unless explicitly required.
- database: existing SQLite live-play storage patterns.
- testing: Vitest, Vue Test Utils/happy-dom where applicable, targeted server/use-case tests, and existing test helpers.
- package manager: npm with Node.js 24 from `.nvmrc`.
- CI: existing GitHub Actions CI plus local `scripts/quality-gate.sh`.

Hard constraints:

- Follow the repository `AGENTS.md` production deployment boundaries and live-play-only instruction.
- Preserve existing GM/player trusted-table access assumptions; do not present them as public authentication.
- Keep campaign/private data, `.env` files, databases, generated runtime files, and secrets out of commits.
- Keep ticket scope narrow: implement only the lowest-numbered `TODO` ticket in each autonomous cycle.

Flexible choices:

- File names and component names may differ from issue suggestions when they fit existing architecture better.
- Tests can be targeted when a full end-to-end browser workflow is impractical, as long as the ticket acceptance criteria are meaningfully covered.

## Architecture expectations

Use existing Rotom Table boundaries:

```text
shared/src types and utilities -> server use cases/storage/API routes -> Vue composables/components/pages -> docs/tests
```

Expected patterns:

- Shared inventory models and pure helpers should live in an existing shared/type utility location that can be imported by both app and server code.
- SQLite migrations and repositories should follow existing storage versioning, transaction, JSON clone/stringify, revision, and stale-update conventions.
- API routes should use existing actor/access/writable-campaign helpers and route constant patterns.
- UI components should preserve trainer inventory behaviour while extracting reusable primitives for group inventory.
- Realtime updates should reuse existing channel/event/client-id patterns where they fit cleanly.

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

- Update existing architecture/feature docs when behaviour, setup, data ownership, realtime, backup/export, or live-play boundaries change.
- The final issue ticket must document the group inventory workflow and future live-play command boundary, then link that doc from an appropriate existing documentation entry point.
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

- `BUILD_TICKETS.md` is the authoritative local autonomous queue; GitHub issues #27-#44 provide traceability.
- Work one ticket per autonomous cycle, in numeric order.
- Keep each commit focused on the selected ticket and use a conventional commit message.
- Do not update ticket statuses beyond the selected ticket. The only exception is the final issue ticket #44, which may set `AUTOMATION_STATUS: DONE` after all issue tickets are complete and the final quality gate passes.
- Do not create, close, merge, or comment on pull requests/issues from inside an autonomous ticket run unless a future ticket explicitly asks for it.
