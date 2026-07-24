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

`shared/abilityAutomation/results.ts` enforces this split at the wire boundary. Public accepted results contain only operation/resolution/map identities, one revision transition, terminal outcome, and a generic presentation key. Public pending results add only phase, timestamps, and outstanding-window count—never ability, actor, responder, option, roll, trace, or read identity. Authorized views add bounded ability identity and operation counts or one opaque response window. `server/domain/abilityAutomation/results.ts` performs role/responder authorization and strips private recipient IDs, effect operation IDs, principal lists, state plans, reads, rolls, and traces before strict parsing.

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

`server/domain/abilityAutomation/registry.ts` is the only production AbilitySpec lookup. Registration code is duplicate-checked but does not make an ability executable: lookup succeeds only when the canonical manifest row is complete and its `abilityspec-v1` version, definition hash, and source module exactly match the evaluated registration. Missing or mismatched selected registrations fail startup/checking; blocked rows resolve to `null` even if migration code exists. Clients never select runtime metadata.

`server/domain/abilityAutomation/context.ts` detaches the map, sheets, actor, source, selected targets, sides, encounter effects/history, effective-ability projection, private item scope, runtime capabilities, and rules provenance before eligibility runs. Participant and private-item revisions enter one deduplicated read set; every later sheet/effective-ability/group-inventory query records its consulted revision. Conflicting reads fail closed. All reachable data and query facades are frozen, while private lookup maps remain inaccessible. A separate adapter projects only the closed handler snapshot and five read-recording pure queries.

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

## Frequency declarations

`shared/abilityAutomation/frequency.ts` parses all 483 source strings without inferring action economy. `Static` and `At-Will` have no spend count; `Scene`/`Daily` default to one and preserve explicit `xN`; the action/timing suffix is retained verbatim for the action parser. The two `Special` abilities require source-hash-bound entries in `data/ability-automation/frequency-exceptions.json`: Illusion has separate at-will mark/dismiss and once-per-round guise clauses, while Receiver has two independently once-per-scene clauses. Unreviewed Special text, At-Will counts, invalid bounds, stale source text, and unused exception rows fail closed.

`shared/abilityAutomation/actionEconomy.ts` then models no-cost passive/triggered behavior and Standard, Shift, Swift, Free, Full, Extended, and Special costs with Normal, Priority, Interrupt, or Reaction timing. Every Interrupt and Reaction consumes the same `interrupt-reaction` availability pool regardless of its base action cost. Six source-hash-bound rows in `action-exceptions.json` enumerate Comatose, Illusion, Memory Wipe, Sap Sipper, Strange Tempo, and Vicious rather than guessing from `Move Action`, `Special`, or missing suffixes. Action variants are stable reviewed branch IDs.

`shared/abilityAutomation/resources.ts` stores Scene usage in the map encounter envelope and Daily usage on the lasting Pokémon/trainer sheet. Each bounded entry is keyed by its authoritative owner (scene placement or lasting sheet), stable effective-ability identity (base abilities normalize independently of placement), canonical ability, and reviewed frequency clause; retained operation IDs make retries idempotent and cannot be reused across resources. `server/domain/abilityAutomation/usage.ts` plans revision-checked payments without mutation, refuses stale scene/day lifecycle keys or exhausted uses, and can merge a fresh payment with disjoint effects into one atomic state change. Only explicit authoritative scene/day transition helpers clear a ledger. At-Will actions produce no resource write.

`shared/abilityAutomation/timingResources.ts` adds monotonic round/turn windows, bounded delayed-reavailability records, and scene-long receipts to encounter state. Receipts retain the original spend or ready sequence, so a retry remains exact even after its old window reset. `server/domain/abilityAutomation/timing.ts` plans once-per-window and cooldown payments, rejects cursor regression and cross-resource operation reuse, resets Scene and timing state together, and strictly reconciles persisted state after restart/reconnect. `timing-constraints.json` source-binds the two explicit canonical limits—Harvest once per turn and Illusion once per round—rather than scanning effect prose at runtime. Generic cooldown support is closed and bounded for reviewed future definitions; no canonical cooldown is asserted by this catalog.

`server/domain/abilityAutomation/effectiveAbilities.ts` projects canonical abilities in one deterministic precedence order: sheet base, transformation snapshot, encounter-ordered grant/copy/replace/swap layers, then the union of listed/all suppressions. Replaced entries remain in the private authoritative projection with explicit reason codes while only active entries satisfy eligibility. Inactive, nonapplicable, and noncanonical labels cannot become native abilities. `protections.json` source-binds the four exceptional policies for Huge Power / Pure Power, Multitype, Sorcery, and Splendorous Rider; protected copy/transform/swap attempts fail closed and protected abilities ignore disabling. The immutable context derives this projection from server-owned sheets and encounter effects by default; its recovery override has a strict closed shape.

`shared/abilityAutomation/passiveProviders.ts` defines the closed passive vocabulary for stat, damage, accuracy, evasion, immunity, movement, side, and field domains. Attributes and stacking groups are explicit stable IDs; operations are bounded numeric transforms or grant/deny facts. Groups must agree on `stack`, `highest`, `lowest`, `priority`, `union`, or `exclusive` policy, with deterministic priority and code-point identity tie-breaks. Numeric application remains ordered and bounded. `server/domain/abilityAutomation/passiveProviders.ts` authorizes every provider against an active effective-ability instance before aggregation, so suppressed, spoofed, and absent sources cannot contribute.

`shared/abilityAutomation/parameters.ts` defines lasting sheet-owned ability instance IDs and ordered canonical option IDs; display labels never carry mechanics. `parameter-definitions.json` source-binds Color Theory's server-rolled color, Serpent’s Mark's inherited/server-rolled pattern, and Type Strategist's sheet choice. Definitions and instance data are versioned, bounded, detached, and exact-shape validated. `server/domain/abilityAutomation/parameterAcquisition.ts` materializes a new Color Theory roll at the authorized setup-save boundary, ignores client-authored roll values, and preserves the accepted lasting instance on later saves. Missing required data leaves the effective ability inactive with `ability.parameters.missing`; legacy names such as `Type Strategist (Fire)` are not parsed. Unparameterized legacy rows retain an explicit compatibility instance until saved with stable instance data.

`shared/abilityAutomation/durations.ts` owns bounded lifecycle links from an ability instance to its effect payload. The closed duration kinds are source/target turn, round, scene, source presence, source ability, target presence, weather, terrain, and exact until-triggered. `server/domain/abilityAutomation/effectLifecycle.ts` reduces typed authoritative boundary/snapshot events, decrements counters, and removes expired payload effects plus lifecycle ownership in one encounter revision. Restart recovery reconciles presence, active ability instances, weather, and terrain deterministically. Explicit scene transition expires all encounter-local ability lifecycles before resetting Scene and timing resources.

`shared/abilityAutomation/ownedState.ts` stores marks, bounded counters, token pools, modes, and forms in one strict encounter-owned envelope. Every entry has an optimistic version, source ability/owner linkage, linked targets, lifecycle policy, and create/last-operation ancestry. `server/domain/abilityAutomation/ownedState.ts` validates closed commands, hashes their exact JSON, retains scene receipts, rejects conflicting retries and stale versions, authorizes the active source ability and targets, and plans one revision-checked encounter update. Presence, source-ability, target, scene, and restart cleanup are deterministic. The immutable context and pure handler port expose read-only bounded queries; normal scene transition clears this state atomically with other ability resources.

`server/domain/abilityAutomation/recovery.ts` exports a strict private recovery bundle containing the complete encounter envelope, lasting Daily ledgers, and pending private results with trace, roll ledger, response window, responder principals, and opaque JSON continuation cursor. A deterministic SHA-256 detects backup corruption; it is not a substitute for storage access control or encryption. Import verifies ruleset, map revision, trace/roll identity, and exact runtime version/hash/module before reconciling timing, presence, source ability, weather, terrain, and owned state. Reconnect callers retain the private result and must use the existing authorization projector; raw bundles must never be sent to table clients. Normal SQLite map/sheet JSON export preserves these fields because they are part of the canonical documents.

`shared/abilityAutomation/events.ts` is the closed private event grammar consumed by ability routing. It carries only accepted server facts in seven families: action, HP, condition, combat stage, item, field, and lifecycle. Each payload has exact fields and outcome arithmetic/invariants; batches require unique IDs plus monotonic sequence, map revision, and captured time. Target and tag order remains semantic. These events may contain private HP, ownership, or ability-instance facts and are never public realtime DTOs. Later routing tickets may extend the versioned vocabulary with reviewed move/damage details rather than accepting arbitrary event metadata.

`server/domain/abilityAutomation/subscriptionRouter.ts` matches only validated event kinds and closed checkpoints against subscriptions from exact manifest-selected runtimes. It walks current effective ability instances in stable placement/canonical/instance order, rejects definition drift, evaluates only version-matched registered predicate semantics, and sorts routes by priority then code-point identity. Missing or throwing predicate evaluators fail closed. Routing results and diagnostics are private eligibility data, not responder/public projections.

The `move` event family records canonical move identity and definition hash, declaration/use checkpoint, canonical elemental type, Physical/Special/Status class, normalized range bounds/kind, an explicit closed keyword set, reviewed semantic branch IDs, and separate declared/attacked/hit/missed/critical target identities. Target subset and terminal-outcome invariants fail closed. `ability-move-fact` is a version-matched AbilitySpec predicate over timing, type, class, any/all keywords, user relation, and owner target outcome; both its parser and evaluator are registered in production. Move facts must come from accepted server resolution data—never range/effect prose or browser labels.

The `strike` family separates accuracy and damage checkpoints per strike. It binds move/runtime operation, strike index/count, attacker/defender, melee/ranged/area context, contact, directness, type/class, critical and effectiveness facts, and exact rolled/post-defense/reduction/prevention/temporary-HP/HP loss arithmetic. Impossible critical, immune, contact, and prevention combinations fail closed. `ability-strike-fact` filters these private packets by owner role, strike position, outcome, contact, critical, effectiveness, prevention, and minimum actual loss; its versioned parser/evaluator are production-registered.

The `hp` family is emitted from accepted reducer outcomes and records current/max/full HP, temporary HP, requested/applied amount, Injuries, the derived half-full-HP Massive Damage threshold, Injury application, faint/revive transition, source operation, and stable application identity. Arithmetic and transition flags are recomputed during parsing. `ability-hp-fact` filters subject/actor role, change kind, fainting, Massive Damage, Injury/temporary-HP direction, thresholds, and actual applied amount. `abilityEventReceipts` persists event/application hashes in encounter state; exact retries emit no second event while changed reuse fails closed, and scene transition clears the bounded receipt ledger.

Condition events distinguish apply/remove/save/cure/reset/transfer attempts from applied, prevented, no-op, succeeded, failed, and transferred outcomes. They retain before/after presence, exact save roll, transfer counterpart, source placement/ability/effect/operation, prevention reasons, and application identity. Combat Stage and raw stat events retain requested versus applied deltas, bounds, cap/prevention/reset/transfer outcome, layer, and source provenance with validated arithmetic. `ability-condition-fact` and `ability-value-change-fact` provide versioned source/owner/outcome/direction filters; their parser/evaluator pairs are production-registered. Their application IDs use the same replay receipt boundary as HP events.

Movement events are emitted at authoritative `pre-step` and accepted `post-step` checkpoints. Each packet binds the immutable origin-first path, exact step, cumulative/total distance, voluntary/forced/teleport/swap mode, before/after grounding, canonical adjacency and terrain snapshots, and ordered entered/exited zone facts with hazard/terrain/zone source provenance. Path cells, final distance, source identities, and self-adjacency are validated. `ability-movement-fact` filters owner-relative mover/source/adjacency, checkpoint, mode, first/final step, grounding transition, terrain transition, zone kind/direction, and minimum step distance. Movement application receipts make each checkpoint retry-safe.

Presence events distinguish send-out, recall, and atomic switch facts with outgoing/incoming placement and cell identities, side, initiative revision, and accepted application identity. Initiative events preserve ordered before/after lists, active placements, affected placement, round/turn clocks, and consecutive resource revisions for roll/insert/remove/reorder/delay/advance/reset changes; membership, order, and clock claims are cross-validated. Scene, round, turn, presence, and effective-ability lifecycle facts remain the reset source for lifecycle reducers. Production-registered `ability-presence-fact`, `ability-initiative-fact`, and `ability-lifecycle-fact` predicates route these events by owner relation, position/clock transition, boundary, and ordinal. The subscription router then orders simultaneous sources by priority, canonical ability, placement, instance, and subscription IDs.

Item packets cover inventory and held-item add/remove/use/consume/equip/unequip/transfer/drop/pickup/trade outcomes. They retain stable item-resource identity, requested/applied quantity, before/after owner and slot, consecutive resource revisions, source ability/operation, prevention, and application identity; partial, prevented, and no-op claims are validated independently. Field packets cover weather, terrain, room, and hazard application/refresh/removal/expiry with zone identity, before/after presence, layer, duration, field revision, source, prevention, and retry identity. `ability-item-fact` and `ability-field-fact` are production-registered filters over resource, owner/source, outcome, quantity, presence, and layer.

Every subscription now declares whether it is guarded once per causal chain. The trigger-chain coordinator consumes the shared event/trigger/depth budgets, orders simultaneous routes by priority and stable source identity, executes child events depth-first, preserves exact runtime version/hash/module ancestry, and permits pass only for optional triggers. It suppresses an ancestor route cycle and a repeated once-per-chain guard with distinct terminal reason codes; event identities cannot repeat. All pending and terminal trigger facts are exposed only as detached, deeply frozen private snapshots.

Activated declarations use short-lived, map-revision-bound server offers. A private offer enumerates reviewed token, self, side, area, field, cell, direction, type, stat, move, ability, item, and branch options with exact mechanical references, runtime identity, and SHA-256 integrity. The client intent echoes only offer identity/hash and ordered stable option IDs. Resolution rechecks lifetime, revision, actor/ability/mode/runtime identity, declaration order, cardinality, and option membership before recovering private mechanics. Controller projection strips placement, cell, move, ability, and item references and exposes only option IDs and presentation keys.

An optional trigger suspends as a strict private `PendingAbilityResolution`. The durable record binds the causal trigger and reviewed runtime, passable response owners, legal option/operation IDs, complete map/sheet/inventory read set, audit trace, exact roll ledger, timestamps, request hash, and a versioned AbilitySpec phase/operation cursor with prior choices. Persistence revalidates every post-reservation revision inside the store transaction. Exact operation retries return the same record; changed reuse and duplicate resolution IDs fail closed. No arbitrary continuation patch or callback field is accepted.

Interrupt and Reaction variants arbitrate at an exact event checkpoint. Interrupt windows are before-checkpoint and Reactions after-checkpoint; within each timing, priority then canonical ability, owner, instance, subscription, and window IDs determine order. Both action kinds spend the same owner-wide `interrupt-reaction` encounter ledger once per authoritative round. The spend is atomic and receipt-backed, resets only on monotonic round/scene transitions, and survives recovery. Pass closes only the current optional window, spends nothing, and resumes at the next deterministic priority. Checkpoint information tables are disclosure maxima, never authorization grants.

A durable pending saga wraps each private pending resolution with an optimistic version and causal audit receipts. It supports owner selection/pass/cancel, GM force-pass and read-validated recovery, system expiry/conflict/commit, and exact command retry. Selection alone enters `resuming`; a separate system commit makes it terminal. Expiry cannot run before the stored deadline, mandatory administrative actions require their exact role, stale versions/CAS writes conflict, and no command can mutate a terminal saga. Every receipt binds the original chain, trigger, and event and is replay-validated against its action/status transition.

Response projection is authorization-first and surface-specific. Eligible HTTP responders receive only opaque option IDs and presentation keys; hidden ability/source/target, other owners, operations, reads, rolls, traces, and causal IDs are omitted. GM views may include ability and owner identity only through an audited callback, while effect programs and rolls remain withheld. Source acknowledgements are generic, map/SSE state exposes only an aggregate pending count, and public combat logs/replay use a terminal outcome allowlist with no mechanic identities. Ineligible and malformed viewers receive one generic denial. Legacy pending-result projection also redacts ability identity from non-GM responders.

`ability-targeting` is the closed targeting policy for direct, footprint-adjacent, and area ability choices. The server resolver combines reviewed self/ally/enemy/same-side rules, authorized willingness declarations, complete-footprint PTU distance, cardinal face adjacency, injected server visibility, voxel/placement/Barrier line of sight, and Burst/Close Blast/Cone/Line/Ranged Blast geometry. Requested placement IDs can only narrow the server candidate set. Free-aim centers and directions come from hash-bound offer options, map bounds are applied, and every excluded requested/geometry candidate receives private reason evidence.

`ability-check` defines bounded check, save, and opposed-contest dice, modifiers, threshold comparison, reroll trigger/selection, and reviewed reroll source budgets. The server random stream owns every draw and charges the causal roll budget. Attempts have stable IDs and exact parent-roll/source ancestry; replace/highest/lowest selection never reorders attempts. Submitted reroll source IDs must come from reviewed, hash-bound choices, source-use and total limits are enforced, and success/failure triggers fail closed. Condition/save events can reference the selected roll while the complete private ledger remains in trace/recovery state.

## Reuse specs, operations, and handlers correctly

Prefer declarative AbilitySpec data when subscriptions, targeting, predicates, costs, and operations fit closed schemas. Reuse MoveSpec selectors, expressions, effect operations, reducers, encounter effects, and planners only when semantics match exactly.

The current adapter is `server/domain/abilityAutomation/sharedKernelExtensions.ts` plus `effectKernel.ts`. It registers the shared selector and predicate/expression grammars and an ability-native `shared-effect` wrapper. The wrapper retains `{ kind: "ability", id }` provenance and the enclosing AbilitySpec phase; a temporary parser-only phase/source translation is never returned, traced, or persisted. Move-only usage/history mutations are rejected. Recipient sets resolve from the ability context in authoritative map order, and compatible Combat Stage effects use the same cap-aware reducer and revisioned state-plan builder. Unsupported geometry or operation families fail closed until their owning machinery ticket adapts them; they are never approximated through a synthetic move intent.

`server/domain/abilityAutomation/statePlan.ts` joins that typed state plan with the complete deduplicated context read set, exact runtime identity, private trace, and exact roll ledger. Every map/sheet/group-inventory write must have a matching read at the same expected revision, and every authoritative roll must occur exactly once in the trace. The commit API enters one store-supplied physical transaction, checks every consulted resource—including read-only resources—before any write, applies all typed map/encounter/sheet/inventory changes, and stores trace/roll evidence in that same transaction. A stale or missing read raises a conflict before state or audit is applied.

`shared/abilityAutomation/performanceBudgets.ts` and `server/domain/abilityAutomation/executionBudget.ts` bound each causal chain before allocation grows: per-event fan-out and triggers, total events/triggers, nested depth and child executions, operations, per-operation and total recipients, rolls, choices, and trace events. Child executions share parent counters. The context wraps its random ledger and shared-effect planner with the same budget; later routers/windows consume the event/trigger/choice counters. Negative, fractional, over-canonical, or exhausted budgets fail closed, and synthetic maximum checks have a CI wall-time guard.

Add a reusable typed primitive when multiple abilities need a missing concept. A primitive owns parsing, limits, pure evaluation/reduction, trace behavior, state ownership, and tests.

Use a registered handler only for bounded contextual calculation that cannot reasonably fit the expression/query language. A handler:

- receives detached frozen context and narrow query/read-set interfaces;
- performs no repository access, persistence, networking, clock access, unseeded randomness, or ID generation;
- emits only strictly parsed typed operations and sanitized trace entries; and
- is deterministic for the same snapshot and roll ledger.

Never use a handler to bypass a missing reusable primitive or execute canonical prose.

`server/domain/abilityAutomation/handlers/registry.ts` is the handler boundary. Registrations contain exactly stable ID, positive version, and synchronous function; production starts empty. Execution supplies only a detached frozen identity/event snapshot and five closed pure query methods. It supplies no repository, persistence API, clock, ID generator, network client, random source, or generic query escape hatch. Query implementations own read recording and every structured result is detached, bounded, and frozen before the handler sees it.

A handler may return only canonically ordered `{ phase, operation }` entries accepted by a registered closed operation parser plus bounded scalar predicate/target/calculation trace evidence. Output is strict JSON and is detached, limit-checked, and frozen. Version mismatch, thrown calculation, malformed query results, unknown operation kinds, phase reversal, callbacks, and oversized output fail closed without exposing thrown private detail. Reviewed handler modules are statically checked for ambient I/O, time, and randomness APIs.

## Event and reaction rules

Events are server-internal facts emitted after accepted reducers/use cases establish them. Every event has a stable ID, source operation, optional causal parent, reason code, exact kind, and bounded payload.

`shared/abilityAutomation/trace.ts` owns the private immutable audit trace. It is pinned to resolution ID, canonical ability/mode, AbilitySpec version/hash/source module, ruleset/source hash, and contiguous causal ancestry. Strict sequenced events cover phase transitions, effective/suppressed eligibility, subscription matching, private choices, roll-ledger entries, operations, prevention, lifecycle, and child abilities. Events cannot occur outside the active phase, phases cannot repeat or move backward, roll IDs cannot repeat, and direct-child depth must match ancestry. Persisted traces are validated by deterministic replay of these invariants.

Ability randomness uses `server/domain/abilityAutomation/random.ts`, an ability-owned facade over the shared bounded entropy kernel. The server supplies entropy, every request has a stable parent effect and optional stable roll ID, exact draws/modifiers/results are frozen in the private ledger, and finite test streams fail on missing or unused draws. `AuthoritativeAbilityContext` owns the random ledger and ancestry; clients never submit either.

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

## Ability-created encounter entities

Abilities that create anchors, decoys, objects, or subordinate creatures use the versioned
`abilityEntities` encounter document. These entities are encounter facts, not Pokémon or trainer
sheets: they have stable entity IDs, explicit controller/side data, map footprint and occupancy,
targetability, movement policy, optional bounded HP/DR, source ability provenance, typed duration,
and a closed kind-specific payload. The strict JSON parser rejects unknown fields, malformed
cross-field combinations, duplicate IDs, unordered tags, and unbounded documents.

Entity commands are optimistic and receipt-backed. Create, move, damage, control-transfer, and
remove operations bind an operation ID to the complete command hash; exact retries return the
recorded outcome while changed reuse fails closed. Authoritative planning verifies the active source
ability, owner/controller, map bounds, movement range, and blocking-footprint collisions before
emitting one revisioned encounter-state plan. Entity targeting is explicit, and entity lifecycle is
advanced by the same turn, round, scene, presence, source-ability, field, and trigger events used by
ability effects. Scene end therefore removes these temporary non-sheet entities and preserves no
orphaned sheet data.

## Ability movement and displacement

Ability movement never accepts a browser-authored path, distance, collision result, or checkpoint
decision. A closed server command selects only reviewed shift, straight displacement, teleport, or
atomic swap mechanics. Normal and forced movement reuse the authoritative movement oracle and its
terrain, footprint, capability, distance, and occupancy facts. Teleports reuse the same endpoint
oracle while deliberately skipping route traversal; swaps validate both endpoint relocations and
the final pair of footprints before producing one map revision plan.

Every resolved path is converted to ordered movement lifecycle facts before placement state can be
committed. If a pre-step Interrupt/Reaction opens, planning returns a pending checkpoint with no
committable relocation; the durable response saga owns continuation. Up-to displacement truncates
at the first obstruction, while full-distance displacement fails closed. Active anchor entities may
explicitly prevent voluntary, forced, teleport, or swap movement, and blocking ability-created
entities participate in route and endpoint validation. Successful plans atomically replace typed
placement state, lifecycle encounter state when changed, and the bounded movement audit log.

## Forms, disguise, illusion, copy, and transformation

Volatile forms use immutable `abilityTransformations` snapshots rather than rewriting a sheet. A
snapshot binds its source ability and operation, affected placement, typed duration, mechanical
projection, and presentation projection. Copy and full-transformation snapshots also capture the
source placement/revision and hash the complete copy base together with the copied mechanics.
There is intentionally no update command: changed source sheets cannot retroactively alter copied
abilities, moves, types, footprint, weight, or capability tags. Removal and lifecycle expiry are the
only post-creation transitions, and exact command retries are receipt-backed.

Disguise and illusion snapshots are required to have mechanically neutral projections. Presentation
is split into a public masked identity and optional private truth with an explicit owner/GM reveal
policy. The default public view contains no mechanic, source placement, source ability, canonical
ability, or private-presentation fields. Effective-ability projection consumes only hash-validated
mechanical snapshots in encounter order; copied instance IDs, definition hashes, source identity,
and parameter selections stay frozen even if the source later changes. Source presence, source
ability, target presence, field duration, scene cleanup, and recovery use the common lifecycle
machinery.

## Combat providers

Damage, Damage Base, move type, STAB, Accuracy, and critical changes use closed combat-provider
records. Every provider names an active effective ability instance, source placement, actor/target
subject relation, reviewed move/type/class/keyword/STAB predicate, stacking group/policy, priority,
and one typed effect. Unknown fields and operations, contradictory predicates, unsafe values,
duplicate IDs, incompatible stacking, and inactive sources fail closed.

Resolution order is semantic: move type, STAB, Damage Base, staged damage, Accuracy, then critical.
A type replacement therefore changes type-based STAB and can satisfy later predicates. Standard
STAB is applied before DB providers. Damage modifiers retain pre-type, post-type, and final stage
order; target effectiveness is recomputed from authoritative target types after type providers.
Accuracy distinguishes a numeric modifier from automatic hit, and critical providers consume the
separate natural critical roll rather than conflating it with Accuracy ancestry. Every applied,
shadowed, out-of-scope, or predicate-false provider produces a deterministic private trace entry.

Immunity, resistance, vulnerability, protection, and bypass use a separate closed defense-provider
grammar. Defensive effects match reviewed move ID, type, keyword, damage class, or effect category
and carry an explicit protection tag. Bypass never means “ignore abilities” implicitly: it must name
both the exact defense kind and protection tag. Resolution applies bypass first, then protection,
immunity, resistance, and vulnerability. PTU effectiveness adjustments remain ordered additive
steps; type-chart immunity is retained unless a separate reviewed core policy handles it. A
condition or movement protection does not masquerade as damage immunity, and every bypassed or
shadowed provider remains visible in the private audit trace. Server wrappers authorize each source
against effective ability instances and recompute the base multiplier from authoritative target
types rather than accepting it from a client.

HP providers consume authoritative current/max HP, temporary HP, and Injury pools. Their fixed order
is prevention, damage reduction, temporary-HP absorption, HP loss/floor, target Injury, drain and
healing modifiers, recoil, then source Injury. Direct HP loss explicitly bypasses DR; temporary HP
absorption or bypass is also explicit. Drain and recoil declare both their arithmetic basis and an
`on-hit`, `on-damage`, or `always` trigger, so immunity and zero-damage outcomes cannot accidentally
fire a side effect. Healing is capped by max HP, temporary HP uses non-stacking highest-result
semantics, fraction arithmetic floors deterministically, and Injury triggers distinguish always,
faint, and Massive Damage. Provider traces retain attempted/applied deltas and every suppression or
stacking decision; server wrappers discard supplied pool copies and rebuild them from authoritative
tokens and sheets.

Stat providers reuse the authorized passive-provider envelope and placement scopes. Resolution
modifies raw Attack, Special Attack, Defense, Special Defense, Speed, and HP first; applies integer,
clamped Combat Stages next; then derives final stats, capped Physical/Special/Speed Evasion, and
Initiative from effective Speed. Movement providers apply before Speed-CS movement adjustment,
while Teleporter is explicitly not altered by that adjustment. Movement traits use grant/deny union
semantics. Numeric groups retain stack/highest/lowest/priority/exclusive behavior and deterministic
provider order. The server adapter rebuilds all bases, stages, Evasion bonuses, movement speeds, and
traits from the authoritative token and rejects inactive provider instances.

Condition providers use stable condition IDs and an explicit apply/cure/transfer fact. Their order is
prevention and eligible server-owned saves, reflection, the base mutation, linked add/remove cures,
then transfers. Save providers embed strict check definitions; the server enumerates only eligible
stacking winners before consuming entropy, retains exact roll/reroll ancestry, and rejects supplied
results for unrequested saves. Reflection declares whether the original target retains the condition,
and transfer always records both endpoints. Condition sets are deduplicated and canonically ordered,
while every prevention, failed/passed save, cure, reflection, no-op, and transfer is traced. The
server adapter reconstructs effective conditions from authoritative tokens and authorizes all source
ability instances before any roll or mutation plan can proceed.

Move providers project a sheet movelist through replacement, grant, typed mutation, Connection,
disable, and nested-use phases. Every sheet/granted/replacement/nested move carries an exact
production MoveSpec v2 version, definition hash, and source module; legacy runtimes and stale hashes
fail closed. Mutations can alter reviewed type, DB, AC, class, frequency, range, and keyword fields
without replacing runtime identity, and retain ordered provider provenance. Replacement precedes
grant and mutation, while disable is final, so no later phase silently re-enables a move.

Nested-use providers create declarations only; they do not execute a move inside projection. The
server re-resolves the exact move runtime, applies explicit target and cost policy, checks the
provider-local maximum depth, and consumes the shared causal child budget before move orchestration
can run. Missing move-instance targets are traced as no-ops, duplicate grants/replacements reject,
and priority/exclusive conflicts fail closed.

Item providers reuse the shared authoritative item-reference, choice, interpreter, mutation, and
transaction planner. Ability records contain no item display-name mechanics: reviewed requirements
load exact held, target, inventory, group-inventory, or map-ground references and revisions.
Give/steal/swap, drop/throw, consume/destroy/restore, suppression, Berry/food storage and digestion,
and the explicit ground-item `pickup` action compile into the same bounded physical mutation union.
Pickup requires one authoritative map-ground reference and an empty held-item destination; it cannot
be forged by sending an item ID. All consulted sheet/map/group revisions commit atomically, consumed
item identities remain private, and provider/source/owner/recipient authorization occurs before
interpretation. Ability operation IDs are deterministically adapted to the live-play mutation
identity boundary without losing provider provenance.

Field providers wrap only validated shared `field`, `hazard`, and typed temporary-effect operations,
with source-bound provider IDs and explicit selected recipients. The server reuses global
weather/Terrain/room replacement, layered hazard/pledge geometry, battlefield-zone mutation, and
Vortex lifecycle reducers. Hazard cells come only from server-resolved bounded cell sets or reviewed
blast/line geometry; providers cannot carry browser coordinates. Global zones remain authoritative
and legacy field arrays are renderer projections. Weather replacement, Terrain consumption,
room timing, ownership/side transfer, suppression, cleanup, Vortex immunity/escape state, and zone
stacking therefore retain existing deterministic semantics. All changed encounter and field lanes
join one map revision plan, and inactive sources or unselected recipients fail before reduction.

The live ability menu is a controller-only projection embedded atomically in live-table snapshot
schema v2. Each row is bound to the map revision, effective ability instance, semantic-manifest
status, exact selected runtime, mode kind, and public targeting cardinality. Sheet text can add
presentation but cannot make a row invocable. Static and triggered modes remain non-invocable;
blocked, assisted, suppressed, parameter-incomplete, and runtime-drift rows stay visible with
accessible status badges. Activated rows first request a private, hash-bound declaration offer.
Only opaque option IDs plus controller-safe placement/cell/type/etc. hints cross the client boundary;
the submitted intent contains stable IDs, never predicates, relationships, ranges, item ownership,
or mechanics. Exact intent retries retain object identity in the client and are idempotent in the
server operation store. Accepted results use the redacted result contract and force an authoritative
snapshot reconciliation. Private offers and accepted audits are stored in dedicated SQLite tables;
changed request/intent reuse, stale revisions, inactive instances, and unauthorized actors fail
closed. The first direct execution adapter accepts only reviewed handler-free, precondition-free,
cost-free shared Combat Stage operations; every other operation shape remains explicitly rejected
until its closed adapter is wired rather than falling back to legacy client mutations.

Relationship providers derive ally/enemy/self membership, same-side sets, bounded auras, and
cardinal/all adjacency from authoritative placement sides and footprints. Interception creates an
owned optional response offer and never changes the target before acceptance. Optional redirection
also remains an offer; simultaneous mandatory redirects select one deterministic priority winner
and retain shadow evidence. Move type/keyword/area predicates, range, LOS, protected relation, and
actor distance are explicit provider data rather than inferred prose. Public projections expose no
offer or provider identity; responders see only offers they own, while GM recovery may inspect all.
The resulting offers feed the existing durable reaction arbitration and shared availability layers.

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

A `configuration` mode is reserved for an explicit choice inside an otherwise automatic Static ability (for example, Forecast under concurrent weather). It may issue a durable typed offer but cannot spend an action or frequency resource, and it must be exposed only while the choice is actually ambiguous. Ordinary Static providers remain passive and never gain a use button. Forest Lord tree origins require a map voxel tagged `fully-grown-tree` (or both `tree` and `fully-grown`); the server revalidates that authored cell on activation and Move use.

AA-072 Gardener targets only voxels tagged `yielding-plant`; permanent bounded `aa072Gardener` map metadata records soil quality and the last campaign-day application so offers and resumed execution can revalidate the same plant. Gluttony's effective-ability provider projects limits of three simultaneous Food Buffs, three Food Buff uses per Scene, and two refreshments per half hour. Existing authoritative digestion seams enforce the first two limits, retain legacy one-slot fields during migration, record Scene uses as stacks on an opaque sheet-bound marker, and open an owner-only durable choice when a Move could consume more than one stored buff. Those choices retain a one-based storage occurrence so duplicate canonical item IDs still consume the exact issued slot. Refreshment-item interoperability remains part of the separate unassessed interaction dimension until a generic live-play refreshment-use command exists. Gorilla Tactics records its accepted +10 damage and exclusive previously-used-Move allow-list as Scene effects; the triggering Move receives the same ordered damage modifier before those effects are committed. Grass Pelt uses the standard non-stacking Temporary Hit Point maximum and honors authoritative Temporary HP prevention while still paying its accepted Swift/Scene costs.

AA-073 Grassy Surge uses the native global-field lifecycle and compatibility projection rather than writing display terrain directly. Grim Neigh, Gulp Missile, and Heat Mirage reuse durable Move response windows, reconstruct their effective owners on resume, and pay their Free Action and finite Scene resources only after acceptance. Gulp Missile exposes Stockpile as an authoritative Connection Move, stores one scene-bounded armed marker, reconstructs its AC 4 Physical retaliation from the sealed roll ledger, applies exactly one even/odd branch, and consumes the marker after the next positive damaging hit even if its owner Faints. Guts, Haunt, Handyman, and Heatproof are effective-ability providers: suppression removes their Attack-stage projection, Last Chance damage, second held-item slot/affected-item choice, Fire resistance, and Burn-loss prevention authority. Hay Fever derives its Burst or Close Blast cells, weather gate, Type exclusions, HP markers, and trigger facts from server state. Harvest binds a server-owned coin result to the exact Berry Digestion trade, retains the buff on heads or Sunny Weather, records a sheet-bound once-per-turn marker, and records tails as a scene stop marker. No Harvest roll or retention survives effective-ability suppression.

AA-074 applies Heavy Metal and both Huge Power identities before Combat Stages from exact effective abilities; the legacy Huge Power doubles only Nature/Vitamin-adjusted Base Attack, while the current Huge Power / Pure Power bonus follows level scaling and the protection catalog prevents suppression. Hustle contributes its errata Accuracy penalty and ordered Damage Roll bonus, and Hyper Cutter blocks negative Attack-stage writes at the reducer boundary. Heliovolt opens a resumable Swift response after any Electric Move use, including a miss, and installs one-round Evasion plus actor-scoped Sunny Weather rather than changing global weather. Helper requires a reviewed single-Ally Move and grants ordered Accuracy and `skill-check` encounter modifiers through the end of the user’s next turn. Honey Thief replaces Bug Bite’s compatibility self-trade with a hit-target Digestion trade and grants one non-stacking Tick of Temporary HP only after that authoritative steal. Horde Break is attached to typed School Form → Solo Form operations as an optional Free response that clears persistent and volatile Status Conditions. Hunger Switch requires a no-cost Full Belly/Hangry choice before the user can resolve a Move each turn; the selected form marker drives effective-only Accuracy or Damage modifiers until the next turn start. Hydration offers only current authoritative conditions, pays Swift plus Scene atomically, and omits only its frequency payment in actor-resolved Rainy Weather. Honey Paws exposes a no-cost configuration only while the user holds Honey: its one-shot, scene-bounded preparation must match the same effective ability instance at the item mutation boundary before Honey is stored in a separate Leftovers-equivalent slot.

AA-075 makes Hypnotic’s Hypnosis and Imposter’s Transform available through effective-ability Connection overlays, with automatic-hit and Free-Interrupt rules revalidated by the server. Ice Body, Ice Face, Ice Scales, Illuminate, Immunity, and Infiltrator execute at their exact healing, Temporary HP/form, Special-resistance, Accuracy/Blindsense, poison-application, Stealth, hazard, Blessing, and Substitute boundaries. Ice Shield accepts only one-to-three contiguous authoritative cells with an adjacent segment and creates reviewed typed barriers. Ignition Boost is a resumable adjacent-Ally reaction that adds exactly +5 to the triggering Fire damage and permits at most one benefit. Illusion stores Focus-bounded creature or object marks and active appearance durably, but projects them only to rendering; a damaging hit removes the projection without changing any mechanical token facts. Innards Out reconstructs its optional Free-Action window across resume, resists every successful strike of the triggering attack, totals actual real-HP loss after Temporary HP and mitigation, and applies twice that total to one server-bounded foe within two meters even if the user Faints.

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
- **Static ability button:** an automatic provider is incorrectly offered as an active command; only a no-cost, ambiguity-gated `configuration` mode may collect explicit Static rules text choices.
- **Stale partial write:** a consulted resource is absent from the read set or writes are not in one transaction.
- **Private prompt leak:** public state exposes hidden ability identity, ownership, options, rolls, or sheet details.
- **State duplication:** the same use, mark, mode, or copied ability is independently owned by sheet and encounter state.

Keep blocked rows honest until the missing contract exists. False completeness is worse than visible work remaining.
