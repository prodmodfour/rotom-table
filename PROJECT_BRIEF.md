# PROJECT_BRIEF.md

TEMPLATE_CUSTOMISED: true

## Project name

Rotom Table — Token Cosmetic Improvements wave.

## Project type

Nuxt 3 and Vue 3 live-play application with TypeScript shared models, three.js/isometric map and token rendering, server-side SQLite persistence, durable HTTP/SSE live-play command flow, IndexedDB outbox recovery, and Vitest coverage.

## Project goal

Implement the Cosmetic Improvements work described by `BUILD_TICKETS.md` (`001` through `012`), refreshed from `docs/cosmetic-improvements.md`. The finished wave should make Pokémon tokens look more natural and three-dimensional while removing always-on cage clutter.

The core rule for this wave is: **the cage is tactical scaffolding, not the persistent 3D illusion.** Idle tokens should read as sprite + halo + contact shadow + subtle sprite isometric shading. Cages should appear only when tactically useful, such as hover, selection, pending/corrected feedback, and any targeting states that need extra clarity.

## Audience

- Rotom Table maintainers and operators.
- GMs and players using live-play maps with Pokémon tokens.
- Future autonomous or human contributors maintaining token rendering, map interaction affordances, and visual QA docs.

## Success criteria

The work is successful when:

- Every ticket in `BUILD_TICKETS.md` for `001` through `012` is marked `DONE`.
- `scripts/quality-gate.sh` passes on the final branch.
- Renderer comments or helper types make the token cosmetic layers explicit: sprite, contact shadow, cage volume/edges, and sprite isometric shading.
- Cage visibility is tracked separately from token layer visibility.
- Hiding the cage never hides the sprite, halo, contact shadow, or invisible picking proxy.
- Idle Pokémon tokens render without visible cage faces or cage edges.
- Hovered, selected, pending, corrected, and useful targeting states can still show cages as tactical affordances.
- Contact shadows remain the always-on grounding cue whenever tokens and shadows are visible.
- Normal sprites receive subtle persistent isometric shading that respects transparency, brightness, animation, crop, and facing lifecycle.
- Tactical cage face/edge opacity is re-tuned so the Pokémon sprite remains visually dominant.
- Unit coverage protects layer visibility, cage visibility resolution, and relevant style/shading helpers.
- Manual visual QA covers small/large Pokémon, terrain, interaction states, targeting, animation, mirroring, and theme-relevant scene checks.
- The top-level `AUTOMATION_STATUS` in `BUILD_TICKETS.md` is set to `DONE` when the final ticket is complete.

## Non-goals

The autonomous build must not spend time on:

- Changing Pokémon placement, movement, targeting rules, combat automation, encounter behavior, trainer sheets, inventory behavior, saved map data, or network payloads.
- Removing the invisible proxy mesh used for token picking.
- Removing contact shadows.
- Replacing existing sprite assets.
- Adding bespoke per-Pokémon art direction or per-species lighting rules.
- Building a new rendering engine or replacing three.js/isometric renderer architecture.
- Adding broad post-processing, global scene relighting, particle effects, or unrelated visual redesigns.
- Making local-hosting-only behavior; this is a live-play-only app.
- Weakening live-play command authority, revision checks, idempotency, durable outbox recovery, authorised realtime replay, prediction reconciliation, or presence privacy boundaries.
- Public authentication or hardening Rotom Table into a public multi-tenant service.
- Production runtime edits, direct server rebuilds, direct deployment, or production data mutation.
- Closing, commenting on, or editing GitHub issues unless the user explicitly requests it.

## Technology preferences

Preferred stack:

- language: TypeScript, with existing Python/Bash helpers only where already appropriate;
- framework: Nuxt 3 and Vue 3;
- rendering: existing three.js isometric map/token rendering utilities;
- assets: existing Pokémon sprite assets and current texture/animation loading paths;
- testing: Vitest, Vue Test Utils/happy-dom where applicable, targeted renderer utility tests, and existing test helpers;
- package manager: npm with Node.js 24 from `.nvmrc`;
- CI: existing GitHub Actions CI plus local `scripts/quality-gate.sh`.

Hard constraints:

- Follow the repository `AGENTS.md` production deployment boundaries and live-play-only instruction.
- Keep campaign/private data, `.env` files, databases, generated runtime files, and secrets out of commits.
- Keep ticket scope narrow: implement only the lowest-numbered `TODO` ticket in each autonomous cycle.
- Preserve existing token picking through the invisible proxy mesh.
- Preserve contact shadows as independent from cage visibility.
- Preserve existing sprite assets, sprite loading/disposal lifecycle, brightness controls, animation frame handling, crop handling, and facing/mirroring behavior unless a selected ticket explicitly requires a narrow renderer update.
- Preserve live-play gameplay authority and payload shapes; this wave is cosmetic/rendering-only.
- Do not change saved map schemas or network contracts for cosmetic cage/shading state unless explicitly requested in a future ticket.
- Do not introduce new dependencies for shader/material work unless there is no practical in-repo alternative.

Flexible choices:

- Exact helper names, file locations, and resolver names may differ from ticket suggestions when they fit the existing renderer architecture better.
- Cage visibility can be represented as a boolean or a small mode enum if the mode improves clarity without over-engineering.
- Sprite isometric shading can be implemented with a material shader hook, custom material helper, or equivalent existing sprite-material extension, as long as transparent pixels remain transparent and brightness controls still apply.
- Tests can focus on deterministic helper/layer/material state when pixel-perfect visual assertions are impractical.
- Manual visual QA may live in `docs/cosmetic-improvements.md` or a more appropriate renderer QA doc if one exists.
- Tactical targeting cage visibility should be added only where it improves clarity; reticles and existing overlays remain primary targeting UI.

## Architecture expectations

Use existing Rotom Table boundaries:

```text
token cosmetic layer semantics -> renderer-owned cage visibility state -> token layer visibility helper -> token style resolver/material opacity -> sprite isometric lighting constants/material hook -> map renderer integration -> targeted tests/manual visual QA docs
```

Expected patterns:

- Keep cosmetic state renderer-owned and presentation-only.
- Keep sprite, halo, contact shadow, proxy, cage volume, cage edges, and sprite shading as separate concerns.
- Prefer pure helper functions for cage visibility/style resolution so tests can protect the visual contract without requiring full browser rendering.
- Keep `paintPokemonRenderObjectStyle()` or any extracted style resolver focused on visual state, not gameplay authority.
- Keep cage geometry available for tactical states; hide render objects rather than deleting geometry for idle tokens.
- Keep contact shadow visibility tied to `layers.tokens && layers.shadows`, never to cage visibility.
- Apply sprite shading in the normal sprite material path so it clips to sprite alpha and avoids a rectangular overlay artifact.
- Ensure animation, crop, brightness, disposal, and facing updates continue through existing sprite lifecycle code.
- Update docs/comments when terminology changes from “cage as 3D cue” to “cage as tactical affordance.”

## Quality expectations

Expected quality gates:

- shell syntax checks for Bash automation scripts;
- build-loop regression tests from the autonomous build template;
- secret and generated/private-file guardrails;
- `npm ci` using Node.js 24 from `.nvmrc`;
- `npm run typecheck --if-present`;
- `npm test --if-present`;
- `npm run build --if-present`.

Each ticket should also run targeted verification commands for the changed renderer utilities/components where practical before the full quality gate.

## Documentation expectations

Update existing README/docs/copy when a ticket changes or exposes user-facing behavior, renderer architecture, visual QA steps, limitations, or terminology. This wave should keep `docs/cosmetic-improvements.md` aligned with the implemented renderer model, especially the distinction between tactical cages, persistent contact shadows, and persistent sprite isometric shading.

## Safety and security constraints

Do not include:

- real secrets, credentials, access tokens, private keys, or real `.env` files;
- private campaign data or production data dumps;
- internal/private hostnames or URLs;
- destructive automation;
- direct production app-runtime edits, rebuilds, restarts, or deployment steps;
- arbitrary shell/code execution features unrelated to the project.

## Agent behaviour notes

- `BUILD_TICKETS.md` is the authoritative local autonomous queue for this Token Cosmetic Improvements wave.
- `docs/cosmetic-improvements.md` is the planning/reference document for this wave; keep the build queue authoritative for autonomous execution.
- Work one ticket per autonomous cycle, in numeric order; build ticket numbers follow the suggested order from `docs/cosmetic-improvements.md`.
- Keep each commit focused on the selected ticket and use a conventional commit message.
- Do not update ticket statuses beyond the selected ticket. The only exception is the final ticket #012, which may set `AUTOMATION_STATUS: DONE` after all Cosmetic Improvements tickets are complete and the final quality gate passes.
- Do not create, close, merge, or comment on pull requests/issues from inside an autonomous ticket run unless a future ticket explicitly asks for it.
