# Platform Modernisation and Automation Presentation Contract Implementation Plan

`PLAN_STATUS: QUEUED`

`CURRENT_TICKET: APC-001`

`BLOCKED_BY: ABILITY_AUTOMATION_PLAN.md — PLAN_STATUS: DONE`

## Goal

First, move Rotom Table from its final Nuxt 3 baseline to a supported, production-validated Nuxt 4 platform and add the focused linting, Nuxt integration-test, browser-test, and accessibility-test packages needed for the next implementation waves.

Second, create one source-agnostic, server-authoritative interaction and presentation contract for Moves, Maneuvers, Abilities, Capabilities, Edges, Features, Orders, Items, Capture actions, and system actions before further rules catalogs are automated.

The contract must let later automation expose actions, passive contributions, contextual affordances, authorised choices, pending responses, accepted outcomes, explanations, and recovery state without creating one permanent UI panel or command shape per rules chapter. This is a platform and domain-contract initiative, not the encounter UI redesign itself.

This file is the durable implementation ledger for the complete initiative between `ABILITY_AUTOMATION_PLAN.md` and `CAPABILITY_AUTOMATION_PLAN.md`. No ticket in this file starts until Ability automation has completed its existing final acceptance ticket.

## Scope and baseline

### Current platform baseline

- Runtime target: Node.js 24.
- Framework declaration: `nuxt: ^3.17.0`.
- Current lockfile resolution at plan revision: Nuxt `3.21.2`.
- Current build/runtime stack includes Nuxt, Nitro experimental WebSockets, Vite, Vue, Three.js, strict TypeScript, Vitest, Vue Test Utils, `happy-dom`, and `fake-indexeddb`.
- Application source is explicitly rooted at `src/`; `server/`, `shared/`, `public/`, campaign data, and runtime storage remain project-root concerns.
- `nuxt.config.ts` includes custom `srcDir`, `serverDir`, public-path handling, development/production build directories, persisted-data watcher exclusions, public trainer-sprite assets, and Nitro WebSocket configuration.
- Existing CI runs `npm ci`, typecheck, unit/integration tests, and build, but has no first-party Nuxt test project, lint gate, real-browser acceptance suite, or automated accessibility scan.
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

- Plan tickets: **0 DONE / 90 total**
- Accepted Nuxt 4 version: **not migrated**
- Lint gate: **not installed**
- Nuxt-runtime test project: **not installed**
- Playwright acceptance: **not installed**
- Axe-assisted checks: **not installed**
- Shared contract version: **not created**
- Migrated action sources: **0**
- Migrated pending interaction sources: **0**
- Legacy source-specific UI dependencies: **baseline audit pending**
- Blocking dependency: **Ability automation final acceptance**

## Tickets

### Phase 1 — Nuxt 4 baseline, migration, and production validation

- [ ] **APC-001 — Freeze the final Nuxt 3 platform baseline** — `TODO`
  - Record exact Node, npm, Nuxt, Nitro, Vite, Vue, TypeScript, Vitest, Three.js, and lockfile versions; capture typecheck, test, build, built-server, private-host, route, asset, WebSocket, and Three.js smoke results before changing dependencies.
- [ ] **APC-002 — Produce a repository-specific Nuxt 4 migration audit** — `TODO`
  - Inventory custom `srcDir`, root directories, aliases, public assets, build directories, watcher exclusions, modules, auto-imports, middleware, plugins, `ClientOnly`, head configuration, Nitro WebSockets, and deployment assumptions against the current official Nuxt 4 upgrade guide.
- [ ] **APC-003 — Upgrade to the latest stable Nuxt 4.x baseline** — `TODO`
  - Upgrade from Nuxt 3 to the latest stable Nuxt 4.x available at execution, no lower than 4.5.0; update the lockfile, run `nuxt prepare`, and record every direct and transitive major platform change relevant to the app.
- [ ] **APC-004 — Reconcile Nuxt 4 directory, alias, and public-asset behaviour** — `TODO`
  - Preserve `src/`, root `server/`, root `shared/`, root `public/`, trainer sprites, campaign paths, and test aliases; remove obsolete overrides only after route and asset tests prove the default is equivalent.
- [ ] **APC-005 — Audit Nuxt 4 data-fetching and reactivity semantics** — `TODO`
  - Review every `useFetch`, `useAsyncData`, lazy variant, shared key, dedupe, immediate option, reset, and nested mutation for shallow-ref and key-consistency changes; add explicit `deep` handling only where mutation is intentional.
- [ ] **APC-006 — Audit component naming, hydration, and client-only rendering** — `TODO`
  - Validate normalized component names, tests using component identity, dynamic pages, teleport/dialog behaviour, theme bootstrap, Three.js `ClientOnly` fallback, SSR output, hydration warnings, and browser-only APIs.
- [ ] **APC-007 — Validate Nitro WebSocket, realtime, and command recovery on Nuxt 4** — `TODO`
  - Exercise connect, heartbeat, publish, duplicate delivery, reconnect, reconciliation, replay gaps, pending Move/Ability response, exact retry, correction, and graceful shutdown using the supported Nuxt 4/Nitro path.
- [ ] **APC-008 — Validate persistence, campaign storage, assets, and private hosting** — `TODO`
  - Exercise SQLite migrations/WAL, `ROTOM_CAMPAIGN_ROOT`, hosted-write gates, imports/exports/backups, public and trainer assets, production build/start, reverse-proxy/WebSocket assumptions, health endpoint, and process restart.
- [ ] **APC-009 — Resolve Nuxt 4 typecheck, test, build, and runtime regressions** — `TODO`
  - Fix migrations rather than hiding them behind broad compatibility flags; retain narrow temporary opt-outs only with a removal ticket, test, owner, and decision-log entry.
- [ ] **APC-010 — Record Nuxt 4 migration acceptance and rollback closure** — `TODO`
  - Require final baseline comparison, production-like smoke, no unexplained hydration or deprecation warnings, updated operator/developer docs, and an explicit decision to close the Nuxt 3 rollback window.

### Phase 2 — Nuxt-aware linting, testing, browser acceptance, and accessibility tooling

- [ ] **APC-011 — Add `@nuxt/eslint` and `eslint`** — `TODO`
  - Use the first-party Nuxt flat configuration, generate project-aware rules, and avoid introducing an unrelated formatter or styled framework.
- [ ] **APC-012 — Establish a correctness-first lint policy and scripts** — `TODO`
  - Add `lint` and `lint:fix`; cover Vue/Nuxt correctness, unused code, imports, promises, equality, unreachable branches, and justified suppressions while deferring mass stylistic churn.
- [ ] **APC-013 — Add lint to CI and the quality gate** — `TODO`
  - Run lint before typecheck, expose useful annotations, define generated/private path exclusions narrowly, and prevent autonomous work from bypassing the gate.
- [ ] **APC-014 — Add `@nuxt/test-utils` and split Vitest projects** — `TODO`
  - Preserve the fast Node project for pure domain tests and add a Nuxt runtime project for auto-imports, app plugins, route context, middleware, runtime config, hydration-sensitive components, and IndexedDB-aware integration.
- [ ] **APC-015 — Migrate representative Nuxt-dependent tests to the Nuxt project** — `TODO`
  - Cover authentication/profile routes, page composition, composables requiring Nuxt context, client/server projections, runtime endpoints, and component focus without moving pure automation suites into the slower environment.
- [ ] **APC-016 — Add `@playwright/test` and a built-server browser harness** — `TODO`
  - Test the production Nitro build by default, provide deterministic campaign fixtures, browser storage isolation, trace/video/screenshot capture, and a local developer command.
- [ ] **APC-017 — Add GM/player multi-context Playwright acceptance fixtures** — `TODO`
  - Cover login/profile selection, two-client convergence, token movement, reviewed Move execution, pending Ability response, reconnect, private-option redaction, core route loading, and real IndexedDB/storage behaviour.
- [ ] **APC-018 — Add `@axe-core/playwright` to representative settled states** — `TODO`
  - Scan navigation, sheets, reference pages, dialogs, action surfaces, target choices, pending responses, errors, and recovery states; document exclusions and require manual follow-up for defects axe cannot judge.
- [ ] **APC-019 — Define browser matrix, visual baseline, artifact, and CI cadence policy** — `TODO`
  - Run focused Chromium acceptance on pull requests, define when Firefox/WebKit and visual screenshots run, control animation/time/network nondeterminism, retain failure artifacts, and keep the automation cohort loop affordable.
- [ ] **APC-020 — Record platform-tooling acceptance and dependency governance** — `TODO`
  - Require lint, pure tests, Nuxt tests, Playwright, axe, typecheck, build, production smoke, dependency/licence/security review, documentation, and explicit deferral of `reka-ui` to `EUX-015` before contract work begins.

### Phase 3 — Governance, inventory, and architecture

- [ ] **APC-021 — Inventory every live-play action and presentation source** — `TODO`
  - Produce a checked-in machine-readable inventory of commands, option builders, overlays, pending views, result shapes, logs, VFX, and recovery surfaces.
- [ ] **APC-022 — Freeze the interaction-role taxonomy** — `TODO`
  - Define closed roles for passive, activated, contextual, automatic, optional, reaction, choice, spatial, campaign, and diagnostic behaviour.
- [ ] **APC-023 — Freeze the source-kind and provenance contract** — `TODO`
  - Define canonical source references for Move, Maneuver, Ability, Capability, Edge, Feature, Order, Item, Capture, and system actions.
- [ ] **APC-024 — Define the presentation privacy matrix** — `TODO`
  - Specify public, actor-owner, responder-owner, GM, and diagnostic visibility for offers, choices, rolls, reasons, traces, and outcomes.
- [ ] **APC-025 — Define contract limits and abuse budgets** — `TODO`
  - Bound offers, options, text, affected recipients, contribution rows, nested decisions, result changes, and realtime payload size.
- [ ] **APC-026 — Record the interaction/presentation ADR** — `TODO`
  - Lock authority, state ownership, versioning, privacy, compatibility, and why source kind cannot dictate UI structure.
- [ ] **APC-027 — Add a durable contributor guide** — `TODO`
  - Document how a new rule source chooses roles, offers, choices, reasons, accepted facts, tests, and presentation metadata.
- [ ] **APC-028 — Add plan-consistency and schema-link checks** — `TODO`
  - Fail when source inventories, schemas, adapters, docs, generated indexes, and plan progress disagree.
- [ ] **APC-029 — Create canonical cross-source acceptance fixtures** — `TODO`
  - Check in representative duels, crowds, boss phases, private choices, nested reactions, spatial actions, reconnects, and corrections.

### Phase 4 — Shared source, offer, and participant contracts

- [ ] **APC-030 — Define `RuleSourceRef` and canonical display identity** — `TODO`
- [ ] **APC-031 — Define versioned `EncounterActionOffer`** — `TODO`
  - Include actor, source, interaction role, timing, costs, availability, targeting summary, usage, and bounded presentation.
- [ ] **APC-032 — Define passive and derived-state summaries** — `TODO`
  - Represent effective passive facts without manufacturing invocable actions.
- [ ] **APC-033 — Define contextual affordance summaries** — `TODO`
  - Represent actions available only because of current participants, terrain, objects, shops, inventory, or campaign context.
- [ ] **APC-034 — Define participant presentation references** — `TODO`
  - Safely project names, portraits, side accents, sheet kind, and public status without exposing hidden sheets or control IDs.
- [ ] **APC-035 — Define timing and action-cost presentation** — `TODO`
  - Normalize Standard, Shift, Swift, Free, Full, Extended, Priority, Interrupt, Reaction, AP, frequency, and resource labels.
- [ ] **APC-036 — Define targeting and spatial-requirement summaries** — `TODO`
  - Distinguish participant, side, item, move, cell, area, direction, destination, path, and no-target declarations.
- [ ] **APC-037 — Define usage and resource summaries** — `TODO`
  - Project remaining uses, scene/daily state, AP, action budgets, cooldowns, once flags, and safe reset labels.
- [ ] **APC-038 — Define source-agnostic action grouping and ordering** — `TODO`
  - Provide stable categories and priorities independent of rules-book taxonomy.
- [ ] **APC-039 — Add strict parsers, normalizers, hashes, and fixtures** — `TODO`
  - Reject ambiguous IDs, unsafe copy, oversized fields, and incompatible schema versions.

### Phase 5 — Availability, reasons, and contribution explanations

- [ ] **APC-040 — Define the closed availability-reason catalog** — `TODO`
- [ ] **APC-041 — Separate public reasons from private and diagnostic evidence** — `TODO`
- [ ] **APC-042 — Add action-economy and timing reasons** — `TODO`
- [ ] **APC-043 — Add frequency, usage, cooldown, and once-limit reasons** — `TODO`
- [ ] **APC-044 — Add target, range, relationship, visibility, and geometry reasons** — `TODO`
- [ ] **APC-045 — Add condition, suppression, item, form, capability, and source-loss reasons** — `TODO`
- [ ] **APC-046 — Add ownership, profile-control, side, and permission reasons** — `TODO`
- [ ] **APC-047 — Define ordered contribution explanations** — `TODO`
  - Explain totals, substitutions, caps, prevention, immunity, and effective sources using typed rows rather than prose parsing.
- [ ] **APC-048 — Add redacted contribution projections** — `TODO`
  - Preserve understandable outcomes while hiding private abilities, items, features, edges, or GM-only facts.
- [ ] **APC-049 — Add reason and explanation conformance/property tests** — `TODO`

### Phase 6 — Choices, pending interactions, and exact response semantics

- [ ] **APC-050 — Define the closed choice-kind catalog** — `TODO`
  - Cover participant, side, mode, branch, type, stat, skill, move, ability, capability, feature, edge, item, cell, area, direction, destination, and path choices.
- [ ] **APC-051 — Define versioned `EncounterChoiceOffer` and option identity** — `TODO`
- [ ] **APC-052 — Define safe option presentation and previews** — `TODO`
  - Support participant, reference, item, side, and spatial previews without making them authoritative.
- [ ] **APC-053 — Define selection cardinality, ordering, defaults, and confirmation** — `TODO`
- [ ] **APC-054 — Define decline, pass, cancel, expiry, and forced resolution** — `TODO`
- [ ] **APC-055 — Define pending interaction public summaries** — `TODO`
- [ ] **APC-056 — Define owner-authorised pending views** — `TODO`
- [ ] **APC-057 — Define GM recovery and correction views** — `TODO`
- [ ] **APC-058 — Bind exact response identity to retry/reconnect/replay** — `TODO`
- [ ] **APC-059 — Add nested and competing choice ordering tests** — `TODO`

### Phase 7 — Accepted outcomes, history, VFX, and accessibility presentation

- [ ] **APC-060 — Define `AcceptedEncounterPresentation`** — `TODO`
- [ ] **APC-061 — Define typed change facts** — `TODO`
  - Cover HP, temporary HP, injury, condition, stage, movement, resource, usage, item, effect, zone, form, side, placement, and scene changes.
- [ ] **APC-062 — Define outcome and prevention facts** — `TODO`
  - Cover used, triggered, accepted, declined, hit, miss, critical, immune, prevented, redirected, expired, corrected, and abandoned outcomes.
- [ ] **APC-063 — Define causal grouping for nested actions** — `TODO`
  - Preserve parent/child order without exposing private trace internals.
- [ ] **APC-064 — Define action-splash and headline projection** — `TODO`
- [ ] **APC-065 — Define generic VFX and reduced-motion hints** — `TODO`
  - Keep visual hints downstream and non-mechanical.
- [ ] **APC-066 — Define event-feed and history projection** — `TODO`
  - Replace combat-log prose as the primary machine-readable presentation source.
- [ ] **APC-067 — Define screen-reader announcements and urgency** — `TODO`
- [ ] **APC-068 — Define correction, rollback, and reconciliation presentation** — `TODO`
- [ ] **APC-069 — Add deterministic presentation replay tests** — `TODO`

### Phase 8 — Migrate existing sources and remove bespoke seams

- [ ] **APC-070 — Adapt MoveSpec v2 offers and accepted results** — `TODO`
- [ ] **APC-071 — Adapt AbilitySpec v1 active, passive, trigger, and pending results** — `TODO`
- [ ] **APC-072 — Adapt Maneuver actions and contested checks** — `TODO`
- [ ] **APC-073 — Adapt Orders and trainer-to-Pokémon actions** — `TODO`
- [ ] **APC-074 — Adapt movement, send-out, recall, and switching** — `TODO`
- [ ] **APC-075 — Adapt items, Poké Balls, capture, and inventory actions** — `TODO`
- [ ] **APC-076 — Adapt initiative, scenes, field effects, hazards, and direct table actions** — `TODO`
- [ ] **APC-077 — Adapt pending move/ability responses and recovery** — `TODO`
- [ ] **APC-078 — Publish one versioned client capability bundle** — `TODO`
  - Replace parallel move/ability/source capability payloads with a role-appropriate encounter bundle.
- [ ] **APC-079 — Remove production dependence on raw context-menu metadata** — `TODO`

### Phase 9 — Realtime, security, scale, and release acceptance

- [ ] **APC-080 — Integrate offer/presentation projection with snapshots and patches** — `TODO`
- [ ] **APC-081 — Integrate accepted presentation with durable realtime rows** — `TODO`
- [ ] **APC-082 — Validate replay gaps, reconnect, duplicate delivery, and tab echo handling** — `TODO`
- [ ] **APC-083 — Complete privacy, authorization, and malformed-input testing** — `TODO`
- [ ] **APC-084 — Benchmark catalog-scale offer and explanation projection** — `TODO`
- [ ] **APC-085 — Add contract debug inspectors without player leakage** — `TODO`
- [ ] **APC-086 — Complete API, schema, contributor, and operator documentation** — `TODO`
- [ ] **APC-087 — Run multi-client accessibility and reduced-motion acceptance** — `TODO`
- [ ] **APC-088 — Run all canonical encounter fixtures through the generic contract** — `TODO`
- [ ] **APC-089 — Retire superseded source-specific presentation contracts** — `TODO`
- [ ] **APC-090 — Record final acceptance and unblock capability automation** — `TODO`
  - Require lint, pure Vitest, Nuxt-runtime tests, Playwright, axe checks, focused contract suites, typecheck, build, production smoke, contract checkers, `scripts/quality-gate.sh`, and zero undocumented legacy dependencies.

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
