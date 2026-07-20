# Ability automation contributor guide

Ability automation is an in-progress server-authoritative live-play initiative. The canonical denominator is 483 abilities; current progress and the only ordered implementation queue live in [`ABILITY_AUTOMATION_PLAN.md`](../ABILITY_AUTOMATION_PLAN.md). A menu badge, helper function, name-based move hook, or existing browser transaction is not completion evidence.

Read [ADR 011](adrs/011-authoritative-ability-automation-runtime.md) before changing runtime behavior. The MoveSpec guide remains relevant for shared mechanical operations, but AbilitySpec owns different declaration, frequency, passive, and event-subscription semantics.

## Authority model

A client may declare an actor, canonical ability, reviewed target/branch intent, stable choice IDs, command identity, and revision/conflict metadata. The server selects the manifest runtime, resolves the current effective abilities, checks action/frequency resources, derives legal recipients and responders, owns rolls, reduces typed operations, validates the complete read set, and commits atomically or persists a durable wait.

Never accept trigger eligibility, rolls, modifiers, legal targets, frequency spends, effect programs, or arbitrary patches from a browser.

### Threat and privacy boundary

Privacy is default-deny. Viewer privileges are additive, but each asset is projected only through an applicable authorized role; being a map participant alone never grants hidden ability, copied-source, suppression, eligibility, responder, option, roll, sheet, trace, or private-log data.

- Base/effective ability identity, copy provenance, and suppression state remain server-private except for bounded GM or source-controller projections.
- Eligibility is evaluated before response projection. An eligible responder receives only their authorized prompt and opaque stable options; response principals and effect programs never enter public map state.
- Ineligible participants receive at most an existence-only generic pending summary. Denials use generic reason families and cannot become a hidden-state oracle.
- The raw roll ledger, private reads, and full trace remain private. Terminal public outcomes do not retroactively publish the secret source unless a reviewed publication rule says so.
- Public combat logs use an allowlist independent of private audit records. Observability exposes bounded aggregate labels and counts, not ability names, principals, option IDs, rolls, sheets, or traces.
- Unauthenticated access receives none of these assets. GM projections are authorized and auditable; operational access is aggregate-only.

The closed policy and reciprocal threat/asset links are enforced by `shared/abilityAutomation/privacy.ts` and `data/ability-automation/privacy-matrix.json`.

Important locations:

- `ABILITY_AUTOMATION_PLAN.md`: ordered tickets, progress snapshot, decisions, and 483-name cohort assignment.
- `data/reference/abilities.json`: immediate canonical prose authority.
- `data/ability-automation/ruleset.json`: frozen count, source hash, canonicalization, source hierarchy, and homebrew boundary.
- `data/ability-automation/source-adjudications.json`: source-hash-bound repairs for known PDF/parser losses.
- `data/ability-automation/manifest.json`: one truthful semantic row per canonical ability.
- `data/ability-automation/legacy-baseline.json`: immutable source-linked snapshot of partial pre-AbilitySpec behavior fragments; never completion evidence.
- `data/ability-automation/privacy-matrix.json`: default-deny threat, asset, audience, disclosure, and control policy.
- `data/ability-automation/capabilities.json`: closed mechanic dependency graph.
- `data/ability-automation/scenario-requirements.json`: closed requirement-to-evidence mapping.
- `shared/abilityAutomation/`: strict ruleset, manifest, capability, and evidence contracts; later AbilitySpec/event/intent wire schemas.
- `server/domain/abilityAutomation/`: future reviewed specs, handlers, interpreter adapters, event routing, and planning.
- `tests/shared/`, `tests/server/`, and future `tests/fixtures/abilityAutomation/`: contract and executable conformance evidence.

## Legacy isolation and migration

`data/ability-automation/legacy-baseline.json` is a frozen audit, not a runtime registry and not completion evidence. Pre-AbilitySpec transactions may be reached only through:

- `src/utils/abilityAutomationLegacyCompatibility.ts` for the live-play client panel;
- `server/domain/abilityAutomation/legacyCompatibility.ts` for authoritative table actions.

`server/domain/abilityAutomation/runtimeSelection.ts` accepts only manifest-certified `abilityspec-v1` registrations. It has no legacy input or fallback. To retire a legacy fragment, add and certify its native AbilitySpec behavior, route production execution to the native selector, remove the compatibility call, and retain the baseline entry as historical migration evidence.

## Work from the plan

1. Read this guide, ADR 011, and `ABILITY_AUTOMATION_PLAN.md`.
2. Work on the lowest unfinished ticket unless the user explicitly changes priority.
3. Set that ticket to `IN_PROGRESS` and keep `CURRENT_TICKET` synchronized.
4. Implement only the ticket's contract. Add reusable machinery when the ticket calls for it; do not pre-implement later cohorts speculatively.
5. Run focused tests and the applicable ability checks.
6. Mark the ticket `DONE` only after those checks pass, update the progress snapshot, and advance `CURRENT_TICKET`.
7. Run `npm run check:ability-automation-plan`; it fails on ticket, cohort, manifest, hash, or snapshot drift.

The plan's AA-060–AA-100 cohorts cover all 483 canonical identities exactly once in code-point order. Do not move an ability between cohorts without updating both its plan membership and manifest rollout cohort through an intentional reviewed change.

## Read canonical rules safely

Use `data/reference/abilities.json` as the immediate authority and consult its checked-in upstream section when wording or PDF extraction is suspicious. Production code never interprets either source at runtime.

If source text is missing or demonstrably truncated:

1. locate the canonical checked-in source section;
2. determine source priority under `data/ability-automation/ruleset.json`;
3. add a bounded entry to `source-adjudications.json` with exact source path, section anchor, source SHA-256, fields, and reason;
4. update the parser to consume the reviewed adjudication rather than embedding a second value;
5. update the immediate catalog and ruleset source hash intentionally; and
6. run source, ruleset, manifest, parser, and plan checks.

Do not silently fill a field from memory, a wiki, generated prose, or an untracked web source.

## AbilitySpec v1 envelope

`shared/abilityAutomation/spec.ts` owns the strict immutable envelope. Every spec declares canonical identity and behavior version; one or more named `static`, `activated`, or `triggered` modes; typed subscription headers; mode-linked targeting, preconditions, and costs; ordered phase blocks containing effect operations; an optional registered handler ID; and mechanics-independent presentation lookup metadata.

The canonical ability phases are `eligibility`, `reserve`, `pay`, `target`, `pre-effect`, `effect`, `after-effect`, `schedule`, and `cleanup`. Every declaration references a stable mode ID. Selectors, predicates, costs, and operations are bounded syntax-only JSON objects at this layer; their dedicated closed parsers must validate semantics before registration. The envelope rejects callbacks, class instances, getters, sparse arrays, symbols, cycles, non-finite numbers, unknown fields, unknown mode references, duplicate declaration IDs, and per-family or aggregate limit overflow, then detaches and deeply freezes the result.

Presentation keys never authorize disclosure and handlers never expand the envelope: both remain subject to manifest selection, privacy projection, strict handler registration, definition hashing, and execution budgets.

`server/domain/abilityAutomation/validateSpec.ts` performs definition validation. Extension objects are executable only after a reviewed parser registered by family and `kind` accepts their exact closed shape; unknown selectors, predicates, costs, and operations fail closed. Validation enforces mode/reference, targeting, cost-phase, and canonical phase-order invariants. Normalization sorts only set-like presentation tags, capability IDs, and used extension references. Mode, subscription, targeting, precondition, cost, phase, operation, and nested mechanic array order remains authored and hash-bearing.

The SHA-256 definition material includes hash-format version, ability ruleset ID, canonicalization version, canonical source-data hash, dependency-closed capability IDs, used extension parser versions, registered handler identity/version, and the normalized spec. A change to rules provenance or reviewed executable code therefore requires an intentional manifest hash update.

## Choose the correct runtime mode

An ability can own more than one mode.

### Static provider

Use a Static provider for automatic calculations, immunities, grants, defaults, or restrictions. Providers resolve from the effective-ability projection and participate in explicit priority and stacking groups. They are not manually invokable.

Evidence normally includes `mode.static`, plus mechanic-specific requirements. Suppression or source-loss behavior must be exercised or explicitly reviewed as not applicable.

### Activated declaration

Use an activated declaration when a controller deliberately spends an action or chooses to use the ability. The server owns target candidates, range, branch options, affordability, and frequency payment. Extend the strict ability intent only with bounded stable choices; never add a generic payload field.

Evidence normally includes `mode.activated`, `mechanic.usage` for finite resources, `recovery.retry`, and applicable target/mechanic tags.

### Triggered subscription

Use a triggered subscription when canonical text reacts to a game fact. Subscribe to a typed accepted event at an explicit checkpoint. Do not scan logs, compare browser snapshots, or call a prompt from a component watcher.

Mandatory deterministic triggers can resolve immediately. Optional triggers, Interrupts, and Reactions use durable authorized response windows. Evidence normally includes `mode.triggered`; durable windows also require choice/pass, reconnect, retry, authorization/redaction, and priority evidence where applicable.

### Mixed ability

Model each clause. A Bonus paragraph may be Static while the primary effect is activated or triggered. Do not flatten one clause into a log note or hide it in presentation metadata.

## Reuse specs, operations, and handlers correctly

Prefer declarative AbilitySpec data when subscriptions, targeting, predicates, costs, and operations fit closed schemas. Reuse MoveSpec selectors, expressions, effect operations, reducers, encounter effects, and planners only when semantics match exactly.

Add a reusable typed primitive when multiple abilities need a missing concept. A primitive owns parsing, limits, pure evaluation/reduction, trace behavior, state ownership, and tests.

Use a registered handler only for bounded contextual calculation that cannot reasonably fit the expression/query language. A handler:

- receives detached frozen context and narrow query/read-set interfaces;
- performs no repository access, persistence, networking, clock access, unseeded randomness, or ID generation;
- emits only strictly parsed typed operations and sanitized trace entries; and
- is deterministic for the same snapshot and roll ledger.

Never use a handler to bypass a missing reusable primitive or execute canonical prose.

## Event and reaction rules

Events are server-internal facts emitted after accepted reducers/use cases establish them. Every event has a stable ID, source operation, optional causal parent, reason code, exact kind, and bounded payload.

When adding a subscription:

- choose the exact checkpoint before or after the relevant state transition;
- include only facts already authoritative at that checkpoint;
- derive eligibility from current effective abilities and authoritative queries;
- join every consulted map, sheet, inventory, or pending resource to the read set;
- define simultaneous-trigger priority and stable tie-breaking;
- prevent duplicate handling of the same event/source/ability chain;
- preserve causal ancestry for child events; and
- enforce fan-out and nesting budgets.

A pass declines only the current optional window. It does not consume a Reaction unless canonical rules say the ability was used, and it cannot reopen the same checkpoint without a new permitted causal fact.

## Frequency and state ownership

- Scene, round, turn, cooldown, modes, marks, counters, and temporary grants belong to map encounter state.
- Daily use and lasting character changes belong to the relevant sheet.
- Shared inventory remains a separate revisioned resource.
- Full suspended state belongs to pending-resolution storage; map state receives only a bounded public summary.

Action and frequency payment must be planned, revision-checked, and committed with the effect or explicitly reviewed pre-window state. Exact retries reuse the original operation/result. Reset behavior is driven by accepted game events, not wall-clock timers or component lifecycle.

## Author and promote one ability

For a cohort ability:

1. Read every canonical field, including Trigger, Effect, Bonus, Special, connections, branches, and exceptions.
2. Identify all runtime modes, event checkpoints, costs, targets, relationships, choices, rolls, durations, source-loss rules, resets, and direct interactions.
3. Reuse implemented capability primitives or add narrowly required reusable machinery in the selected ticket.
4. Author and validate one immutable AbilitySpec v1 definition or a spec plus bounded handler.
5. Register it once in the server registry and link the exact version/hash/source in the manifest.
6. Add only capability codes whose catalog status is `implemented`. Suggested tags are planning hints, not claims.
7. Add executable scenarios for every required class selected by the ability's reviewed requirement tags.
8. Test immediate or suspended atomicity, full read sets, retry, replay, stale conflicts, lifecycle, authorization, and redaction where applicable.
9. Set `baseStatus: complete` only when blockers, limitations, manual steps, and missing evidence are empty.
10. Keep broad interaction status separate and list known unsupported interaction IDs explicitly.

A typed durable human choice can be complete. A browser prompt, GM reminder, log sentence, or manual sheet edit cannot.

## Evidence

Requirement tags and evidence classes are closed by `scenario-requirements.json`. The manifest parser rejects unknown tags/classes and requires each selected requirement's classes to be covered by executable scenarios or a reviewed not-applicable reason.

Assertions must prove mechanics rather than parsing. Depending on the ability, cover:

- effective vs suppressed/absent provider;
- eligible vs ineligible trigger;
- accepted vs rejected declaration;
- finite use spent, exhausted, and reset;
- self/ally/enemy/area relationships;
- choice, pass, Interrupt priority, reconnect, and exact retry;
- hit/miss/critical/immunity and modifier order;
- condition, stage, HP, item, movement, field, or form application and prevention/cleanup;
- caps/no-ops, threshold branches, and source loss;
- stale multi-resource conflict with no partial write;
- hidden-state redaction; and
- nested event cycle/depth behavior.

Scenario IDs alone are not evidence. Every evidence mapping must point to an executable assertion.

## Required commands

During ordinary work:

```sh
npm run check:ability-automation
npm run check:ability-automation-links
npm run check:ability-automation-plan
npm run check:ability-automation-budgets
npm run typecheck
npx vitest run <focused tests>
```

For a machine-readable status report:

```sh
npm run audit:ability-automation
```

The strict closure command is expected to remain red until all rows are genuinely complete:

```sh
npm run check:ability-automation-complete
```

Before sharing a completed ticket or phase, run:

```sh
bash scripts/quality-gate.sh
```

The quality gate runs non-strict ability metadata, budgets, and plan consistency during migration. It must not bypass the existing strict completed Move automation checks.

## Common failures

- **Source hash mismatch:** catalog bytes changed without reviewed provenance and plan updates.
- **Plan drift:** ticket status, current ticket, counts, cohort names, rollout IDs, or source hash are stale.
- **Unknown capability:** a manifest claim/blocker/suggestion does not resolve to the closed capability graph.
- **Planned capability on a complete row:** the checker forbids claiming completion before machinery is implemented.
- **Missing evidence class:** a requirement tag selected a class with no scenario or reviewed not-applicable reason.
- **Runtime source missing:** the manifest points outside `server/domain/abilityAutomation/` or to a nonexistent module.
- **Trigger replay:** the same accepted event opens or applies an ability twice.
- **Client trigger authority:** a component or browser transaction decides eligibility or effects.
- **Static ability button:** an automatic provider is incorrectly offered as an active command.
- **Stale partial write:** a consulted resource is absent from the read set or writes are not in one transaction.
- **Private prompt leak:** public state exposes hidden ability identity, ownership, options, rolls, or sheet details.
- **State duplication:** the same use, mark, mode, or copied ability is independently owned by sheet and encounter state.

Keep blocked rows honest until the missing contract exists. False completeness is worse than visible work remaining.
