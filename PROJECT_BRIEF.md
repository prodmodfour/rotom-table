# PROJECT_BRIEF.md

TEMPLATE_CUSTOMISED: true

## Project name

Rotom Table — encounter generation and spawn reliability autonomous build wave.

## Project type

Full-stack Nuxt 3 application with server-side SQLite persistence, Vue UI, TypeScript shared models, three.js map/spawn placement behavior, and Vitest coverage.

## Project goal

Implement the encounter generation/spawn bug-fix work described by `BUILD_TICKETS.md` (`001` through `010`). The finished wave should make server-side encounter count defaults match the UI, clarify that encounter counts are roll slots rather than guaranteed generated Pokémon, and harden spawn persistence/placement against folder collisions, provisional slug leakage, duplicate placement IDs, and unresolved existing map placements.

## Audience

- Rotom Table maintainers and operators.
- GMs generating encounters and spawning them directly onto maps during live play.
- Players who see generated/spawned Pokémon results during live sessions.
- Future autonomous or human contributors maintaining encounter generation and spawn placement code.

## Success criteria

The work is successful when:

- Every ticket in `BUILD_TICKETS.md` for `001` through `010` is marked `DONE`.
- `scripts/quality-gate.sh` passes on the final branch.
- Raw encounter generation/spawn API calls that omit `count`, `countMin`, and `countMax` default to three encounter slots, while explicit invalid counts still fail.
- Encounter generation UI/copy consistently describes requested values as encounter slots, not guaranteed generated Pokémon/files.
- Spawn folder collisions persist sheets, result placements, and map placements with slugs derived from the final allocated folder.
- Spawn results expose enough final slug/folder identity to avoid confusing provisional generator labels with persisted records.
- Spawn placement ID allocation retries recoverable duplicate IDs before failing a generated Pokémon.
- Existing unresolved map placements reserve conservative occupied space so new spawns do not overlap broken or temporarily missing tokens.
- Tests cover the server defaults, slot wording, folder/slug collision behavior, duplicate placement ID retry behavior, and unresolved-placement occupancy behavior.
- The top-level `AUTOMATION_STATUS` in `BUILD_TICKETS.md` is set to `DONE` when the final ticket is complete.

## Non-goals

The autonomous build must not spend time on:

- Rewriting the encounter table format, random encounter math, Pokémon sheet generation pipeline, or map renderer beyond the ticketed fixes.
- Changing API contracts beyond the explicit default-count behavior and result copy/identity improvements requested in the tickets.
- Adding new spawn UI features unrelated to the documented result clarity fix.
- Public authentication or hardening Rotom Table into a public multi-tenant service.
- Production runtime edits, direct server rebuilds, direct deployment, or production data mutation.
- Unrelated UI redesigns, unrelated trainer-sheet behavior changes, unrelated inventory behavior changes, or speculative encounter/spawn features.
- Closing, commenting on, or editing GitHub issues unless the user explicitly requests it.

## Technology preferences

Preferred stack:

- language: TypeScript, with existing Python/Bash helpers only where already appropriate;
- framework: Nuxt 3 and Vue 3;
- rendering: existing three.js map rendering where relevant;
- persistence: existing SQLite live-play storage and map placement patterns;
- testing: Vitest, Vue Test Utils/happy-dom where applicable, targeted server/use-case tests, and existing test helpers;
- package manager: npm with Node.js 24 from `.nvmrc`;
- CI: existing GitHub Actions CI plus local `scripts/quality-gate.sh`.

Hard constraints:

- Follow the repository `AGENTS.md` production deployment boundaries and live-play-only instruction.
- Keep campaign/private data, `.env` files, databases, generated runtime files, and secrets out of commits.
- Keep ticket scope narrow: implement only the lowest-numbered `TODO` ticket in each autonomous cycle.
- Preserve existing map/spawn data ownership boundaries; fixes should align generated sheets, persisted sheets, result placements, and map placements rather than creating parallel state.

Flexible choices:

- File names, helper names, and exact component test locations may differ from ticket suggestions when they fit existing architecture better.
- Tests can be targeted when a full end-to-end browser workflow is impractical, as long as the ticket acceptance criteria are meaningfully covered.

## Architecture expectations

Use existing Rotom Table boundaries:

```text
shared/client utility constants -> server request/use-case helpers -> storage/map placement persistence -> Vue composables/components/pages -> docs/tests
```

Expected patterns:

- Shared encounter defaults and pure helpers should live where both client and server code can import them without cyclic dependencies.
- Spawn persistence should keep repository/storage authority over final folder allocation, revisions, timestamps, and persisted sheet slugs.
- Map placement helpers should keep renderer and server collision behavior aligned, including conservative handling for unresolved existing placements.
- UI copy changes should be small, focused, and backed by tests where practical.

## Quality expectations

Expected quality gates:

- shell syntax checks for Bash automation scripts;
- build-loop regression tests from the autonomous build template;
- secret and generated/private-file guardrails;
- `npm ci` using Node.js 24 from `.nvmrc`;
- `npm run typecheck --if-present`;
- `npm test --if-present`;
- `npm run build --if-present`.

Each ticket should also run the targeted verification commands listed in `BUILD_TICKETS.md` when practical before the full quality gate.

## Documentation expectations

Update existing README/docs/copy only when a ticket changes or exposes user-facing behavior, setup, architecture, operations, limitations, or terminology. The final verification ticket should clean up any remaining encounter generation documentation that conflicts with slots-vs-generated-Pokémon behavior.

## Safety and security constraints

Do not include:

- real secrets, credentials, access tokens, private keys, or real `.env` files;
- private campaign data or production data dumps;
- internal/private hostnames or URLs;
- destructive automation;
- direct production app-runtime edits, rebuilds, restarts, or deployment steps;
- arbitrary shell/code execution features unrelated to the project.

## Agent behaviour notes

- `BUILD_TICKETS.md` is the authoritative local autonomous queue for this encounter generation/spawn wave.
- Work one ticket per autonomous cycle, in numeric order.
- Keep each commit focused on the selected ticket and use a conventional commit message.
- Do not update ticket statuses beyond the selected ticket. The only exception is the final ticket #010, which may set `AUTOMATION_STATUS: DONE` after all encounter generation/spawn tickets are complete and the final quality gate passes.
- Do not create, close, merge, or comment on pull requests/issues from inside an autonomous ticket run unless a future ticket explicitly asks for it.
