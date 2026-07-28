# Platform Modernisation and Automation Presentation Contract Implementation Plan

`PLAN_STATUS: DONE`

`CURRENT_TICKET: NONE`

`BLOCKED_BY: NONE — ABILITY_AUTOMATION_PLAN.md completed before this initiative`

## Goal

First, move Rotom Table from its final Nuxt 3 baseline to a supported, production-validated Nuxt 4 platform and add the focused linting, Nuxt integration-test, browser-test, and accessibility-test packages needed for the next implementation waves.

Second, create one source-agnostic, server-authoritative interaction and presentation contract for Moves, Maneuvers, Abilities, Capabilities, Edges, Features, Orders, Items, Capture actions, and system actions before further rules catalogs are automated.

The contract must let later automation expose actions, passive contributions, contextual affordances, authorised choices, pending responses, accepted outcomes, explanations, and recovery state without creating one permanent UI panel or command shape per rules chapter. This is a platform and domain-contract initiative, not the encounter UI redesign itself.

This file is the durable implementation ledger for the complete initiative between `ABILITY_AUTOMATION_PLAN.md` and `CAPABILITY_AUTOMATION_PLAN.md`. No ticket in this file starts until Ability automation has completed its existing final acceptance ticket.

## Scope and baseline

### Starting platform baseline (frozen by APC-001)

- Runtime target: Node.js 24.
- Framework declaration at plan start: `nuxt: ^3.17.0`.
- Lockfile resolution at plan start: Nuxt `3.21.2`.
- The starting build/runtime stack included Nuxt, Nitro experimental WebSockets, Vite, Vue, Three.js, strict TypeScript, Vitest, Vue Test Utils, `happy-dom`, and `fake-indexeddb`.
- Application source is explicitly rooted at `src/`; `server/`, `shared/`, `public/`, campaign data, and runtime storage remain project-root concerns.
- `nuxt.config.ts` includes custom `srcDir`, `serverDir`, public-path handling, development/production build directories, persisted-data watcher exclusions, public trainer-sprite assets, and Nitro WebSocket configuration.
- Baseline CI ran `npm ci`, typecheck, unit/integration tests, and build, but had no first-party Nuxt test project, lint gate, real-browser acceptance suite, or automated accessibility scan.
- The migration target is the latest stable Nuxt 4.x release available when APC-003 executes, with Nuxt 4.5.0 as the minimum accepted baseline recorded when this plan was written.
- Nuxt 5 compatibility flags, nightly channels, and experimental future-major behaviour are out of scope.

### Existing authoritative inputs

- MoveSpec v2 declarations and accepted/pending results.
- AbilitySpec v1 declarations, event subscriptions, passive providers, accepted/pending results, and authorised response views.
- Maneuver, Order, Poké Ball, item, movement, initiative, and direct table command paths.

### Existing temporary presentation inputs

- token context-menu option collections;
- move and ability capability bundles;
- move targeting overlays and pending response views;
- action splashes, move feedback, move VFX, combat-log metadata, and recovery panels.

### Required new shared outputs

- source-agnostic action offers;
- passive and contextual affordance summaries;
- typed choice offers and safe option presentation;
- unavailable-reason and contribution-explanation contracts;
- accepted encounter presentation facts;
- public, owner-private, GM-private, and diagnostic projections.

This plan does not replace the existing encounter page. It creates a supported platform and the complete stable seam that the later UI/UX plan will consume. No automation catalog may invent a bespoke client command or permanent panel merely because its source kind is new.

## Approved package additions

| Package | Timing in this plan | Purpose and constraints |
| --- | --- | --- |
| `nuxt@^4.5.0` or later stable Nuxt 4.x | APC-003 | Supported framework baseline; lockfile records the exact accepted version. |
| `@nuxt/eslint` | APC-011 | First-party Nuxt-aware flat ESLint configuration. |
| `eslint` | APC-011 | Lint engine used by local scripts and CI. |
| `@nuxt/test-utils` | APC-014 | Nuxt runtime component/composable tests and Nuxt-aware test configuration. |
| `@playwright/test` | APC-016 | Real-browser, built-server, multi-context, reconnect, privacy, and visual acceptance tests. |
| `@axe-core/playwright` | APC-018 | Automated accessibility checks inside selected Playwright scenarios. |
| `reka-ui` | Deferred to `EUX-015` | Approved unstyled accessibility primitive layer; do not install during this plan. It must be wrapped behind Rotom-owned components. |

The following are not approved by this plan without a new recorded decision and demonstrated need: a full styled UI framework, Tailwind migration, Pinia, XState, a general animation framework, a virtualisation library, or a security module with unreviewed defaults.

## Non-negotiable rules

1. **Ability automation finishes first.** No Nuxt, package, CI, test-harness, or contract change from this ledger may interrupt or share an active Ability automation implementation branch.
2. **Stable framework releases only.** Upgrade to the latest stable Nuxt 4.x available at execution; do not use nightly releases or opt into Nuxt 5 compatibility behaviour.
3. **Migration is isolated and reversible.** Capture a passing Nuxt 3 baseline, keep dependency/configuration commits reviewable, and retain a documented rollback point until production-like acceptance passes.
4. **Official integrations first.** Prefer Nuxt's ESLint and test utilities and Playwright's first-party runner over bespoke framework emulation.
5. **Do not rewrite the application to match defaults.** Existing `src/`, root `server/`, root `shared/`, root `public/`, campaign storage, and authority boundaries remain unless a migration test proves a change is required.
6. **Pure tests stay pure.** Domain reducers, parsers, planners, registries, and deterministic automation tests remain fast framework-independent Vitest tests; only Nuxt-dependent behaviour enters the Nuxt test project.
7. **Browser tests prove browser risks.** Multi-client convergence, reconnect, hydration, owner-private choices, focus, keyboard interaction, and Three.js startup require real-browser coverage.
8. **Accessibility automation is a floor.** Axe checks supplement, but never replace, keyboard, focus, screen-reader, reduced-motion, zoom, and manual task acceptance.
9. **Mechanics remain authoritative.** Presentation data never determines legal actors, targets, costs, rolls, branches, effects, or persistence.
10. **Intent and stable IDs only.** Clients submit exact offer, declaration, option, and response identities, never executable rule programs or state patches.
11. **One interaction vocabulary.** Equivalent choices use the same bounded contract regardless of whether the source is a Move, Ability, Capability, Edge, Feature, Item, or system action.
12. **Source is provenance, not navigation.** `sourceKind` supports references and filtering; it does not force a separate user workflow.
13. **Passives do not become buttons.** Passive providers and derived facts surface through participant state and explanations unless the canonical rule includes a declaration.
14. **Unavailable is explainable.** Important unavailable actions remain projectable with stable reason codes and concise safe labels.
15. **Privacy is projection-specific.** Public summaries, owner choices, GM recovery data, and diagnostics are distinct schemas, not fields hidden ad hoc in Vue.
16. **Accepted facts drive drama.** HP, conditions, movement, VFX, result copy, and history presentation derive from accepted mechanics, never optimistic guesses.
17. **Retry is exact.** Reconnect, replay, duplicate submit, and recovery reuse identities, rolls, spends, and terminal results.
18. **No raw internal labels.** Operation IDs, placement IDs, mode IDs, declaration IDs, hashes, and trace values are never the default player-facing copy.
19. **Accessibility is contractual.** Every visual cue has text, focus order, live-region priority, and reduced-motion-compatible presentation data.
20. **Compatibility is temporary and measured.** Adapters may bridge existing paths, but the final gate removes production UI dependence on source-specific legacy shapes.

## Completion contract

This plan is complete only when all of the following are true:

- Nuxt 4 is the supported application baseline and the exact accepted framework/toolchain versions are locked and documented;
- development, typecheck, tests, build, production start, private VPS smoke, Nitro WebSocket, SQLite, campaign-root, public-asset, and Three.js client-only flows pass on Nuxt 4;
- Nuxt 4 data-fetching, shallow-ref, component-name, path, hydration, head, and runtime compatibility risks have been audited and resolved without hidden opt-outs;
- Nuxt-aware ESLint is enforced locally and in CI without introducing an unreviewed mass formatting rewrite;
- pure Vitest and Nuxt-runtime test projects are separated and both pass;
- Playwright proves core GM/player, multi-context, reconnect, privacy, pending-response, and production-build journeys and retains useful failure artifacts;
- selected browser journeys run axe checks, while manual keyboard, focus, reduced-motion, zoom, and screen-reader acceptance remains documented;
- every normal live-play action source can be projected as an `EncounterActionOffer` or is explicitly classified as passive-only, contextual-only, system-only, or out-of-encounter;
- every human choice uses a closed choice kind with server-issued option IDs and authorised presentation;
- every pending interaction has public and authorised-private views, exact retry semantics, pass/cancel/expiry rules, and GM recovery where applicable;
- every unavailable offer has a stable reason code, safe label, source evidence, and optional diagnostic detail;
- every accepted operation can produce bounded structured presentation facts without parsing combat-log prose;
- passive calculations can expose ordered contributions and prevention evidence without leaking private rules;
- Moves, Maneuvers, Abilities, Orders, Items, Capture, movement, initiative, and direct table actions have migrated or have an explicit blocked migration ticket;
- realtime, snapshot, reconnect, replay-gap, correction, and recovery flows use the same projection contracts;
- component, API, Nuxt-runtime, and browser tests prove that public, player-owner, GM, and diagnostic views reveal only authorised information;
- the final platform and contract are documented, versioned, performance-bounded, and used by every later automation plan.

## Target architecture

```text
Node 24 + stable Nuxt 4 + supported Vite/Nitro
  -> Nuxt-aware lint and typecheck
  -> pure Vitest + Nuxt-runtime test projects
  -> Playwright browser acceptance + axe checks
  -> canonical rule sources + authoritative encounter state
  -> source-owned spec/runtime and legality
  -> source-agnostic offer / passive / contextual projection
  -> authorised choice or immediate intent
  -> authoritative plan, commit, or durable suspension
  -> accepted mechanics result
  -> structured encounter presentation facts
  -> role-specific UI projection
```

Testing layers:

```text
pure domain tests
  -> deterministic parsers, selectors, reducers, planners, repositories, contracts
Nuxt runtime tests
  -> auto-imports, plugins, middleware, routes, hydration-sensitive components
Playwright acceptance
  -> built server, browser storage, GM/player contexts, realtime, focus, keyboard
axe-assisted checks
  -> automated WCAG/ARIA defect detection on representative settled states
manual acceptance
  -> screen reader, reduced motion, zoom, tactical comprehension, production host
```

Core contract families:

```text
RuleSourceRef
EncounterActionOffer
EncounterPassiveSummary
EncounterContextualAffordance
EncounterChoiceOffer / EncounterChoiceOption
EncounterPendingInteractionView
EncounterAvailabilityReason
EncounterContributionExplanation
AcceptedEncounterPresentation
EncounterPresentationProjection
```

## Source and interaction classifications

Every catalog row or system action must resolve to one or more of these roles:

| Role | Meaning | Future primary UI home |
| --- | --- | --- |
| `passive-provider` | Always-on or conditional derived mechanic | Participant state / inspector |
| `activated-action` | User intentionally declares the rule | Action dock |
| `contextual-affordance` | Action exists only in a matching context | Relevant task or encounter surface |
| `triggered-automatic` | Server applies at an accepted event checkpoint | Result presentation / history |
| `triggered-optional` | Authorised participant may accept or pass | Resolution stack |
| `interrupt-reaction` | Time-sensitive competing response | Urgent resolution stack |
| `choice-only` | Rule modifies another action by a typed choice | Decision layer |
| `spatial-choice` | Exact cell, area, path, direction, or placement required | Tactical lens |
| `campaign-operation` | Crafting, training, rest, research, calendar, or maintenance | Workshop / sheet workflow |
| `diagnostic-only` | Provenance, trace, hashes, and recovery evidence | GM inspector |

A source may have several roles, but each role must have a stable owning runtime and presentation projection.

## Versioning, dependency, and compatibility policy

- Framework and tooling dependencies are installed in explicit, reviewable commits and recorded exactly in `package-lock.json`.
- `package.json` may retain compatible ranges, but release acceptance records the exact resolved versions.
- The Nuxt `compatibilityDate` is reviewed against observed behaviour; it is not advanced merely to silence warnings.
- `future.compatibilityVersion: 5` and equivalent future-major opt-ins remain disabled.
- Contracts are strict, JSON-only, explicitly versioned shared schemas.
- Unknown enum values, oversized arrays, unsafe text, ambiguous ownership, and duplicate stable IDs fail closed.
- Server projections may add optional fields only under documented compatibility rules.
- Clients must tolerate missing optional decorative fields but must reject unknown mechanic-bearing choice kinds.
- Existing move and ability result shapes remain available only through explicit adapters during migration.
- No compatibility adapter may infer legality from labels or reconstruct hidden options from public summaries.
- Any new runtime dependency requires a documented ownership purpose, browser/server boundary, bundle impact, licence review, security review, removal strategy, and reason existing platform APIs are insufficient.
- `reka-ui` remains deferred to the design-system implementation in `ENCOUNTER_UI_UX_PLAN.md`; this plan establishes the browser and accessibility harness that will validate its wrappers.

## Plan update protocol

- Ticket states are `TODO`, `IN_PROGRESS`, `DONE`, or `BLOCKED`.
- `CURRENT_TICKET` names the lowest-numbered active unfinished ticket.
- Only one ticket is `IN_PROGRESS` unless a decision-log entry explicitly permits parallel work.
- Mark a ticket `DONE` only after focused tests and the applicable strict checker pass.
- Upgrade/package tickets must update the dependency inventory, migration notes, and rollback record.
- Add a new interaction primitive only through the closed-catalog governance ticket; do not smuggle source-specific fields into generic payloads.
- Record platform, dependency, contract, and privacy decisions in the decision log.
- Set `PLAN_STATUS: DONE` only after APC-090 and `scripts/quality-gate.sh` pass.

## Progress snapshot

- Plan tickets: **90 DONE / 90 total**
- Accepted Nuxt 4 version: **4.5.1**
- Lint gate: **enforced with `@nuxt/eslint` 1.16.0 and ESLint 10.8.0**
- Nuxt-runtime test project: **passing (1 file / 4 tests)**
- Playwright acceptance: **passing (14 desktop/mobile Chromium tests)**
- Axe-assisted checks: **integrated into representative settled browser states**
- Shared contract version: **encounter presentation schema 1; live-table snapshot schema 3**
- Migrated action sources: **33 inventoried command sources plus passive/contextual projections**
- Migrated pending interaction sources: **Move and Ability**
- Legacy source-specific UI dependencies: **zero wire-level dependencies; two bounded local compatibility adapters remain**
- Blocking dependency: **none**

## Tickets

### Phase 1 — Nuxt 4 baseline, migration, and production validation

- [x] **APC-001 — Freeze the final Nuxt 3 platform baseline** — `DONE`
  - Record exact Node, npm, Nuxt, Nitro, Vite, Vue, TypeScript, Vitest, Three.js, and lockfile versions; capture typecheck, test, build, built-server, private-host, route, asset, WebSocket, and Three.js smoke results before changing dependencies.
- [x] **APC-002 — Produce a repository-specific Nuxt 4 migration audit** — `DONE`
  - Inventory custom `srcDir`, root directories, aliases, public assets, build directories, watcher exclusions, modules, auto-imports, middleware, plugins, `ClientOnly`, head configuration, Nitro WebSockets, and deployment assumptions against the current official Nuxt 4 upgrade guide.
- [x] **APC-003 — Upgrade to the latest stable Nuxt 4.x baseline** — `DONE`
  - Upgrade from Nuxt 3 to the latest stable Nuxt 4.x available at execution, no lower than 4.5.0; update the lockfile, run `nuxt prepare`, and record every direct and transitive major platform change relevant to the app.
- [x] **APC-004 — Reconcile Nuxt 4 directory, alias, and public-asset behaviour** — `DONE`
  - Preserve `src/`, root `server/`, root `shared/`, root `public/`, trainer sprites, campaign paths, and test aliases; remove obsolete overrides only after route and asset tests prove the default is equivalent.
- [x] **APC-005 — Audit Nuxt 4 data-fetching and reactivity semantics** — `DONE`
  - Review every `useFetch`, `useAsyncData`, lazy variant, shared key, dedupe, immediate option, reset, and nested mutation for shallow-ref and key-consistency changes; add explicit `deep` handling only where mutation is intentional.
- [x] **APC-006 — Audit component naming, hydration, and client-only rendering** — `DONE`
  - Validate normalized component names, tests using component identity, dynamic pages, teleport/dialog behaviour, theme bootstrap, Three.js `ClientOnly` fallback, SSR output, hydration warnings, and browser-only APIs.
- [x] **APC-007 — Validate Nitro WebSocket, realtime, and command recovery on Nuxt 4** — `DONE`
  - Exercise connect, heartbeat, publish, duplicate delivery, reconnect, reconciliation, replay gaps, pending Move/Ability response, exact retry, correction, and graceful shutdown using the supported Nuxt 4/Nitro path.
- [x] **APC-008 — Validate persistence, campaign storage, assets, and private hosting** — `DONE`
  - Exercise SQLite migrations/WAL, `ROTOM_CAMPAIGN_ROOT`, hosted-write gates, imports/exports/backups, public and trainer assets, production build/start, reverse-proxy/WebSocket assumptions, health endpoint, and process restart.
- [x] **APC-009 — Resolve Nuxt 4 typecheck, test, build, and runtime regressions** — `DONE`
  - Fix migrations rather than hiding them behind broad compatibility flags; retain narrow temporary opt-outs only with a removal ticket, test, owner, and decision-log entry.
- [x] **APC-010 — Record Nuxt 4 migration acceptance and rollback closure** — `DONE`
  - Require final baseline comparison, production-like smoke, no unexplained hydration or deprecation warnings, updated operator/developer docs, and an explicit decision to close the Nuxt 3 rollback window.

### Phase 2 — Nuxt-aware linting, testing, browser acceptance, and accessibility tooling

- [x] **APC-011 — Add `@nuxt/eslint` and `eslint`** — `DONE`
  - Use the first-party Nuxt flat configuration, generate project-aware rules, and avoid introducing an unrelated formatter or styled framework.
- [x] **APC-012 — Establish a correctness-first lint policy and scripts** — `DONE`
  - Add `lint` and `lint:fix`; cover Vue/Nuxt correctness, unused code, imports, promises, equality, unreachable branches, and justified suppressions while deferring mass stylistic churn.
- [x] **APC-013 — Add lint to CI and the quality gate** — `DONE`
  - Run lint before typecheck, expose useful annotations, define generated/private path exclusions narrowly, and prevent autonomous work from bypassing the gate.
- [x] **APC-014 — Add `@nuxt/test-utils` and split Vitest projects** — `DONE`
  - Preserve the fast Node project for pure domain tests and add a Nuxt runtime project for auto-imports, app plugins, route context, middleware, runtime config, hydration-sensitive components, and IndexedDB-aware integration.
- [x] **APC-015 — Migrate representative Nuxt-dependent tests to the Nuxt project** — `DONE`
  - Cover authentication/profile routes, page composition, composables requiring Nuxt context, client/server projections, runtime endpoints, and component focus without moving pure automation suites into the slower environment.
- [x] **APC-016 — Add `@playwright/test` and a built-server browser harness** — `DONE`
  - Test the production Nitro build by default, provide deterministic campaign fixtures, browser storage isolation, trace/video/screenshot capture, and a local developer command.
- [x] **APC-017 — Add GM/player multi-context Playwright acceptance fixtures** — `DONE`
  - Cover login/profile selection, two-client convergence, token movement, reviewed Move execution, pending Ability response, reconnect, private-option redaction, core route loading, and real IndexedDB/storage behaviour.
- [x] **APC-018 — Add `@axe-core/playwright` to representative settled states** — `DONE`
  - Scan navigation, sheets, reference pages, dialogs, action surfaces, target choices, pending responses, errors, and recovery states; document exclusions and require manual follow-up for defects axe cannot judge.
- [x] **APC-019 — Define browser matrix, visual baseline, artifact, and CI cadence policy** — `DONE`
  - Run focused Chromium acceptance on pull requests, define when Firefox/WebKit and visual screenshots run, control animation/time/network nondeterminism, retain failure artifacts, and keep the automation cohort loop affordable.
- [x] **APC-020 — Record platform-tooling acceptance and dependency governance** — `DONE`
  - Require lint, pure tests, Nuxt tests, Playwright, axe, typecheck, build, production smoke, dependency/licence/security review, documentation, and explicit deferral of `reka-ui` to `EUX-015` before contract work begins.

### Phase 3 — Governance, inventory, and architecture

- [x] **APC-021 — Inventory every live-play action and presentation source** — `DONE`
  - Produce a checked-in machine-readable inventory of commands, option builders, overlays, pending views, result shapes, logs, VFX, and recovery surfaces.
- [x] **APC-022 — Freeze the interaction-role taxonomy** — `DONE`
  - Define closed roles for passive, activated, contextual, automatic, optional, reaction, choice, spatial, campaign, and diagnostic behaviour.
- [x] **APC-023 — Freeze the source-kind and provenance contract** — `DONE`
  - Define canonical source references for Move, Maneuver, Ability, Capability, Edge, Feature, Order, Item, Capture, and system actions.
- [x] **APC-024 — Define the presentation privacy matrix** — `DONE`
  - Specify public, actor-owner, responder-owner, GM, and diagnostic visibility for offers, choices, rolls, reasons, traces, and outcomes.
- [x] **APC-025 — Define contract limits and abuse budgets** — `DONE`
  - Bound offers, options, text, affected recipients, contribution rows, nested decisions, result changes, and realtime payload size.
- [x] **APC-026 — Record the interaction/presentation ADR** — `DONE`
  - Lock authority, state ownership, versioning, privacy, compatibility, and why source kind cannot dictate UI structure.
- [x] **APC-027 — Add a durable contributor guide** — `DONE`
  - Document how a new rule source chooses roles, offers, choices, reasons, accepted facts, tests, and presentation metadata.
- [x] **APC-028 — Add plan-consistency and schema-link checks** — `DONE`
  - Fail when source inventories, schemas, adapters, docs, generated indexes, and plan progress disagree.
- [x] **APC-029 — Create canonical cross-source acceptance fixtures** — `DONE`
  - Check in representative duels, crowds, boss phases, private choices, nested reactions, spatial actions, reconnects, and corrections.

### Phase 4 — Shared source, offer, and participant contracts

- [x] **APC-030 — Define `RuleSourceRef` and canonical display identity** — `DONE`
- [x] **APC-031 — Define versioned `EncounterActionOffer`** — `DONE`
  - Include actor, source, interaction role, timing, costs, availability, targeting summary, usage, and bounded presentation.
- [x] **APC-032 — Define passive and derived-state summaries** — `DONE`
  - Represent effective passive facts without manufacturing invocable actions.
- [x] **APC-033 — Define contextual affordance summaries** — `DONE`
  - Represent actions available only because of current participants, terrain, objects, shops, inventory, or campaign context.
- [x] **APC-034 — Define participant presentation references** — `DONE`
  - Safely project names, portraits, side accents, sheet kind, and public status without exposing hidden sheets or control IDs.
- [x] **APC-035 — Define timing and action-cost presentation** — `DONE`
  - Normalize Standard, Shift, Swift, Free, Full, Extended, Priority, Interrupt, Reaction, AP, frequency, and resource labels.
- [x] **APC-036 — Define targeting and spatial-requirement summaries** — `DONE`
  - Distinguish participant, side, item, move, cell, area, direction, destination, path, and no-target declarations.
- [x] **APC-037 — Define usage and resource summaries** — `DONE`
  - Project remaining uses, scene/daily state, AP, action budgets, cooldowns, once flags, and safe reset labels.
- [x] **APC-038 — Define source-agnostic action grouping and ordering** — `DONE`
  - Provide stable categories and priorities independent of rules-book taxonomy.
- [x] **APC-039 — Add strict parsers, normalizers, hashes, and fixtures** — `DONE`
  - Reject ambiguous IDs, unsafe copy, oversized fields, and incompatible schema versions.

### Phase 5 — Availability, reasons, and contribution explanations

- [x] **APC-040 — Define the closed availability-reason catalog** — `DONE`
- [x] **APC-041 — Separate public reasons from private and diagnostic evidence** — `DONE`
- [x] **APC-042 — Add action-economy and timing reasons** — `DONE`
- [x] **APC-043 — Add frequency, usage, cooldown, and once-limit reasons** — `DONE`
- [x] **APC-044 — Add target, range, relationship, visibility, and geometry reasons** — `DONE`
- [x] **APC-045 — Add condition, suppression, item, form, capability, and source-loss reasons** — `DONE`
- [x] **APC-046 — Add ownership, profile-control, side, and permission reasons** — `DONE`
- [x] **APC-047 — Define ordered contribution explanations** — `DONE`
  - Explain totals, substitutions, caps, prevention, immunity, and effective sources using typed rows rather than prose parsing.
- [x] **APC-048 — Add redacted contribution projections** — `DONE`
  - Preserve understandable outcomes while hiding private abilities, items, features, edges, or GM-only facts.
- [x] **APC-049 — Add reason and explanation conformance/property tests** — `DONE`

### Phase 6 — Choices, pending interactions, and exact response semantics

- [x] **APC-050 — Define the closed choice-kind catalog** — `DONE`
  - Cover participant, side, mode, branch, type, stat, skill, move, ability, capability, feature, edge, item, cell, area, direction, destination, and path choices.
- [x] **APC-051 — Define versioned `EncounterChoiceOffer` and option identity** — `DONE`
- [x] **APC-052 — Define safe option presentation and previews** — `DONE`
  - Support participant, reference, item, side, and spatial previews without making them authoritative.
- [x] **APC-053 — Define selection cardinality, ordering, defaults, and confirmation** — `DONE`
- [x] **APC-054 — Define decline, pass, cancel, expiry, and forced resolution** — `DONE`
- [x] **APC-055 — Define pending interaction public summaries** — `DONE`
- [x] **APC-056 — Define owner-authorised pending views** — `DONE`
- [x] **APC-057 — Define GM recovery and correction views** — `DONE`
- [x] **APC-058 — Bind exact response identity to retry/reconnect/replay** — `DONE`
- [x] **APC-059 — Add nested and competing choice ordering tests** — `DONE`

### Phase 7 — Accepted outcomes, history, VFX, and accessibility presentation

- [x] **APC-060 — Define `AcceptedEncounterPresentation`** — `DONE`
- [x] **APC-061 — Define typed change facts** — `DONE`
  - Cover HP, temporary HP, injury, condition, stage, movement, resource, usage, item, effect, zone, form, side, placement, and scene changes.
- [x] **APC-062 — Define outcome and prevention facts** — `DONE`
  - Cover used, triggered, accepted, declined, hit, miss, critical, immune, prevented, redirected, expired, corrected, and abandoned outcomes.
- [x] **APC-063 — Define causal grouping for nested actions** — `DONE`
  - Preserve parent/child order without exposing private trace internals.
- [x] **APC-064 — Define action-splash and headline projection** — `DONE`
- [x] **APC-065 — Define generic VFX and reduced-motion hints** — `DONE`
  - Keep visual hints downstream and non-mechanical.
- [x] **APC-066 — Define event-feed and history projection** — `DONE`
  - Replace combat-log prose as the primary machine-readable presentation source.
- [x] **APC-067 — Define screen-reader announcements and urgency** — `DONE`
- [x] **APC-068 — Define correction, rollback, and reconciliation presentation** — `DONE`
- [x] **APC-069 — Add deterministic presentation replay tests** — `DONE`

### Phase 8 — Migrate existing sources and remove bespoke seams

- [x] **APC-070 — Adapt MoveSpec v2 offers and accepted results** — `DONE`
- [x] **APC-071 — Adapt AbilitySpec v1 active, passive, trigger, and pending results** — `DONE`
- [x] **APC-072 — Adapt Maneuver actions and contested checks** — `DONE`
- [x] **APC-073 — Adapt Orders and trainer-to-Pokémon actions** — `DONE`
- [x] **APC-074 — Adapt movement, send-out, recall, and switching** — `DONE`
- [x] **APC-075 — Adapt items, Poké Balls, capture, and inventory actions** — `DONE`
- [x] **APC-076 — Adapt initiative, scenes, field effects, hazards, and direct table actions** — `DONE`
- [x] **APC-077 — Adapt pending move/ability responses and recovery** — `DONE`
- [x] **APC-078 — Publish one versioned client capability bundle** — `DONE`
  - Replace parallel move/ability/source capability payloads with a role-appropriate encounter bundle.
- [x] **APC-079 — Remove production dependence on raw context-menu metadata** — `DONE`

### Phase 9 — Realtime, security, scale, and release acceptance

- [x] **APC-080 — Integrate offer/presentation projection with snapshots and patches** — `DONE`
- [x] **APC-081 — Integrate accepted presentation with durable realtime rows** — `DONE`
- [x] **APC-082 — Validate replay gaps, reconnect, duplicate delivery, and tab echo handling** — `DONE`
- [x] **APC-083 — Complete privacy, authorization, and malformed-input testing** — `DONE`
- [x] **APC-084 — Benchmark catalog-scale offer and explanation projection** — `DONE`
- [x] **APC-085 — Add contract debug inspectors without player leakage** — `DONE`
- [x] **APC-086 — Complete API, schema, contributor, and operator documentation** — `DONE`
- [x] **APC-087 — Run multi-client accessibility and reduced-motion acceptance** — `DONE`
- [x] **APC-088 — Run all canonical encounter fixtures through the generic contract** — `DONE`
- [x] **APC-089 — Retire superseded source-specific presentation contracts** — `DONE`
- [x] **APC-090 — Record final acceptance and unblock capability automation** — `DONE`
  - Require lint, pure Vitest, Nuxt-runtime tests, Playwright, axe checks, focused contract suites, typecheck, build, production smoke, contract checkers, `scripts/quality-gate.sh`, and zero undocumented legacy dependencies.

## Ticket evidence ledger

Every ticket is closed against checked-in source/test evidence. Aggregate clean-run counts, versions, the production-like smoke record, and the deployment boundary are in [release acceptance](../../docs/automation-presentation-contract/release-acceptance.md).

| Ticket | Evidence |
| --- | --- |
| APC-001 | `docs/automation-presentation-contract/nuxt-3-baseline.md` |
| APC-002 | `docs/automation-presentation-contract/nuxt-4-migration-audit.md` |
| APC-003 | `package.json`, `package-lock.json`, and Nuxt prepare in the final gate |
| APC-004 | `nuxt.config.ts`; route/public/trainer-asset browser and production-like HTTP smoke |
| APC-005 | Nuxt 4 risk audit, `tests/composables/useEditableMap.test.ts`, and the full pure suite |
| APC-006 | migration audit and `tests/e2e/encounter-presentation.spec.ts` |
| APC-007 | Playwright, realtime, replay, and chaos suites |
| APC-008 | production Playwright disposable campaign, local prodlike start/restart/health/assets, and release acceptance |
| APC-009 | clean typecheck, pure/Nuxt/browser suites, and production build in `scripts/quality-gate.sh` |
| APC-010 | release acceptance and rollback closure in the migration audit |
| APC-011 | `eslint.config.mjs`, `nuxt.config.ts`, and locked development dependencies |
| APC-012 | `eslint.config.mjs` and `lint`/`lint:fix` package scripts |
| APC-013 | `.github/workflows/ci.yml`, `scripts/quality-gate.sh`, and `tests/scripts/qualityGate.test.ts` |
| APC-014 | `vitest.config.ts`, `vitest.nuxt.config.ts`, and locked `@nuxt/test-utils` |
| APC-015 | `tests/nuxt/EncounterPresentationPanel.test.ts` (1 file / 4 passing tests) |
| APC-016 | `playwright.config.ts`, the E2E suite, and `test:e2e` package script |
| APC-017 | real GM/player, Three.js, movement, realtime, reconnect, privacy, and IndexedDB E2E cases |
| APC-018 | `@axe-core/playwright` E2E scans and accessibility CSS fixes |
| APC-019 | browser matrix/artifact policy in release acceptance and CI |
| APC-020 | dependency governance and final versions in release acceptance |
| APC-021 | `data/encounter-presentation/action-source-inventory.json` and generation/check scripts |
| APC-022 | closed interaction-role catalog in `shared/encounterPresentation/catalog.ts` |
| APC-023 | `RuleSourceRef` and closed source kinds in shared contracts/catalog |
| APC-024 | privacy matrix in contract docs and `shared/encounterPresentation/projection.ts` |
| APC-025 | contract bounds/validation and the projection performance suite |
| APC-026 | `docs/adrs/012-server-authoritative-encounter-presentation-contract.md` |
| APC-027 | `CONTRIBUTING.md` and encounter contract documentation |
| APC-028 | contract checker and `tests/scripts/qualityGate.test.ts` |
| APC-029 | canonical acceptance JSON and data-driven acceptance test |
| APC-030 | `RuleSourceRef` parser coverage in the shared contract suite |
| APC-031 | `EncounterActionOffer` contract and strict parser tests |
| APC-032 | passive contract, Capability/Ability projections, and server projection tests |
| APC-033 | contextual-affordance contract plus inventory/capture tests |
| APC-034 | participant refs, role projections, and privacy tests |
| APC-035 | timing/cost catalogs and offer parser tests |
| APC-036 | closed target/spatial contracts and canonical scenario coverage |
| APC-037 | usage/resource summaries and source projection tests |
| APC-038 | stable grouping/ordering in `buildProjection.ts` and deterministic tests |
| APC-039 | validation/identity/stable JSON/SHA-256 and malformed-input tests |
| APC-040 | closed availability-reason catalog |
| APC-041 | audience-aware reason projection and privacy tests |
| APC-042 | action-economy/timing reason catalog and conformance tests |
| APC-043 | frequency/usage/cooldown/once reasons and offer tests |
| APC-044 | target/range/relationship/visibility/geometry reasons and tests |
| APC-045 | condition/suppression/item/form/capability/source-loss reasons and tests |
| APC-046 | ownership/profile/side/permission reasons and role snapshot tests |
| APC-047 | ordered `EncounterContributionExplanation` rows in contracts/projection |
| APC-048 | private-contribution collapse coverage in server projection tests |
| APC-049 | reason/explanation parsing, uniqueness, bounds, and projection suites |
| APC-050 | closed encounter choice-kind catalog and strict tests |
| APC-051 | versioned choice/option IDs in contracts/validation |
| APC-052 | safe bounded option presentation and unknown-field tests |
| APC-053 | cardinality/order/default/confirmation validation and spatial scenarios |
| APC-054 | decline/pass/cancel/expiry/force policies and pending tests |
| APC-055 | public existence/count-only pending projections in `pendingAdapters.ts` |
| APC-056 | authorised Move/Ability response views and privacy assertions |
| APC-057 | GM cancel/force/recovery controls and server tests |
| APC-058 | exact interaction/window/retry/choice/option identities in parsers, APIs, and reconnect tests |
| APC-059 | nested boss/competing reaction scenarios and data-driven tests |
| APC-060 | accepted-presentation contract, validator, fixtures, and adapters |
| APC-061 | typed changes in contracts/adapters and command-pipeline tests |
| APC-062 | closed outcome/prevention facts and strict parser coverage |
| APC-063 | causal parent/group identities and nested fixture coverage |
| APC-064 | generic headline/action surface and Nuxt/browser tests |
| APC-065 | `EncounterVfxOverlay.vue`, runtime ingestion, reduced-motion hints, and E2E coverage |
| APC-066 | history contracts, replay implementation, and replay tests |
| APC-067 | announcement/live-region contracts and focus/browser tests |
| APC-068 | correction/rollback/reconciliation adapters and tests |
| APC-069 | deterministic replay tests plus duplicate/reload E2E coverage |
| APC-070 | Move offers/results and server projection/pipeline tests |
| APC-071 | Ability active/passive/pending/realtime adapters and tests |
| APC-072 | Maneuver projection/classification, inventory, and server tests |
| APC-073 | Order projection/classification, inventory, and server tests |
| APC-074 | movement/send-out/token offers and bounded context-menu adapter tests |
| APC-075 | item affordances/capture offers/results and capture tests |
| APC-076 | initiative/scene/field/hazard/terrain/direct action inventory, offers, and result adapters |
| APC-077 | Move/Ability pending adapters, response views, privacy, and recovery tests |
| APC-078 | snapshot schema 3 encounter bundle and load/sync tests |
| APC-079 | bounded legacy context-menu adapter and authority tests proving metadata cannot create actions |
| APC-080 | snapshot generation/load/sync and terminal presentation ingestion tests |
| APC-081 | durable accepted-command realtime integration and tests |
| APC-082 | replay/chaos/composable/E2E gap, reconnect, duplicate, and echo tests |
| APC-083 | strict malformed-input, revision, authorization, privacy, and unknown-field tests |
| APC-084 | 512-offer size/parse budget performance test |
| APC-085 | diagnostic-only inspector in the generic panel and Nuxt tests |
| APC-086 | ADR, API, contract, contributor, authority, QA, migration, and release docs |
| APC-087 | keyboard/focus/reduced-motion/mobile/axe E2E coverage and manual screen-reader/zoom runbook |
| APC-088 | all 14 canonical scenarios validated by the data-driven acceptance test |
| APC-089 | one wire snapshot bundle, checked inventory, migration audit, and bounded local compatibility adapters |
| APC-090 | clean final quality gate and complete release-acceptance record |

## Decision log

- **2026-07-26 — Place this initiative between Ability and Capability automation.** Ability automation finishes against its existing plan; the platform and generic seam are then stabilised before additional catalogs multiply framework and client-specific paths.
- **2026-07-26 — Upgrade to supported Nuxt 4 before further catalog automation.** The migration is intentionally delayed until Ability automation reaches final acceptance, then validated as an isolated platform project before contract or Capability work.
- **2026-07-26 — Add focused first-party quality tooling.** Nuxt ESLint, Nuxt Test Utils, Playwright, and axe-assisted checks are approved because they cover known correctness, browser, multiplayer, and accessibility risks without dictating the product's visual identity.
- **2026-07-26 — Defer Reka UI to design-system implementation.** It is approved as an unstyled accessibility primitive dependency for `EUX-015`, but installing it here would create unused runtime surface before the UI work begins.
- **2026-07-26 — Do not opt into Nuxt 5 early.** This ledger targets a stable Nuxt 4 baseline and records future-major evaluation as a later explicit decision.
- **2026-07-26 — Treat source kind as provenance rather than UI taxonomy.** A Feature action and a Move action may share the same action surface while remaining mechanically owned by separate runtimes.
- **2026-07-26 — Preserve non-button mechanics.** Passives, effective capabilities, substitutions, triggered effects, and campaign operations receive explicit roles rather than being forced into invocable menus.
- **2026-07-26 — Make structured accepted facts the presentation source of truth.** Logs and VFX remain projections of accepted mechanics, not alternative mechanics channels.
- **2026-07-26 — Defer the visual redesign, not the UX contracts.** This plan supplies a supported platform and stable data/interaction primitives; `ENCOUNTER_UI_UX_PLAN.md` later replaces the map-first experience.
- **2026-07-28 — Accept Nuxt 4.5.1 and close the active Nuxt 3 rollback window.** The exact Node/Nuxt/Nitro/Vite/Vue/tooling graph, migration audit, and historical rollback commit remain documented; no Nuxt 5 compatibility flag or migration escape hatch was required.
- **2026-07-28 — Publish one encounter presentation wire boundary.** Live-table snapshot schema 3 carries encounter presentation schema 1; source-specific capability shapes survive only as bounded local compatibility adapters that cannot create legality.
- **2026-07-28 — Accept the final contract and quality gate.** All 90 tickets are evidenced, 33 command sources and 14 canonical scenarios are checked, and the complete lint/typecheck/pure/Nuxt/browser/axe/build/production-like gate passes. Capability automation is unblocked.
