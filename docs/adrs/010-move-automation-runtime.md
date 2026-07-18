# ADR 010: Authoritative move-automation runtime

Date: 2026-07-09

Status: Accepted

## Context

Rotom Table has an explicit move-automation registry, but registry presence does not prove that every clause of a move is automated. Some scripts still depend on operator notes or browser-local follow-ups, and many canonical moves have no explicit implementation. Expanding that registry without a semantic contract would make coverage counts misleading and could move rules authority into the browser.

Move resolution is also a concurrency boundary. A result may depend on the map, multiple sheets, inventory, allegiance, encounter effects, history, random rolls, and human responses. Retrying or resuming that result must not reroll, spend twice, or commit against a resource that changed after it was consulted.

This ADR extends [ADR 009](009-server-authoritative-profile-play.md). ADR 009 establishes server-authoritative profile commands for normal live play; this decision defines the rules runtime and completion standard for move automation within that command model.

## Decision

Rotom Table will use a **versioned, data-driven `MoveSpec` runtime interpreted by the server**, with a bounded registry of pure server handlers for genuine outliers. Clients submit intent and durable option identifiers. The server owns legality, targeting, randomness, mechanics, persistence, and final logs.

The canonical move catalog is tracked by a semantic manifest with exactly one record per canonical move. A move is not complete merely because it has a registry entry or produces a useful partial transaction. For the current frozen catalog, closure means 776 `complete`, zero `assisted`, and zero `blocked`; future catalog changes require an intentional ruleset/provenance revision rather than silently changing that denominator.

### Semantic completion

Each canonical move has one base status:

- **`complete`**: every canonical base-move rule branch is represented by authoritative mechanics or a typed, authorised, durable human choice, with executable scenario evidence.
- **`assisted`**: automation performs useful work but leaves at least one rule clause, timing decision, or non-durable follow-up to an operator.
- **`blocked`**: the runtime lacks a required reviewed capability, so the move cannot safely be offered as complete automation.

Human participation does not by itself make a move assisted. A choice remains compatible with `complete` only when the server defines the legal options, persists the response window, authorises who may answer it, accepts stable option IDs rather than mechanics payloads, and can resume it idempotently after reconnect or restart.

A move may be marked `complete` only when all of the following hold:

1. Every legal target branch and rules-text branch is encoded.
2. Target relationship, willingness, state, and immunity rules are checked by the server.
3. All rolls are server-owned, bounded, injected for tests, and recorded in a structured resolution ledger.
4. All durable changes either commit atomically or are represented by an explicit durable pending resolution.
5. Choices and reactions are typed, authorised, reconnect-safe, and idempotent.
6. No structured blocker, limitation, or manual rule step remains.
7. Reviewed scenarios cover each applicable branch and edge class, including hit, miss, critical, immunity, alternate branch, and choice behavior. Multi-resource and suspended moves also require retry, stale-resource, and reconnect evidence where applicable.
8. The semantic record identifies rules provenance, runtime and spec version/hash, capability tags, and scenario IDs.
9. Generic presentation can be derived from the accepted result without affecting mechanics.

Interaction coverage is tracked separately from base-move completion. Unsupported ability, item, feature, or other ecosystem combinations must be explicit; they must not be hidden inside a `complete` base-move claim. A directly referenced interaction required to execute the move's own canonical text is part of base completion and cannot be excluded this way.

### Ruleset boundary and provenance

Automation targets one frozen canonical ruleset and catalog. The exact ruleset identifier, normalized source-data hash, canonicalization policy, exclusions, and any verified supplement or errata sources belong in versioned repository data. A catalog or rules-source change requires deliberate provenance and semantic review; it must not silently alter runtime behavior.

The completion target concerns the canonical base-move catalog for that frozen ruleset. It does not promise bespoke animation choreography or complete automation of every unrelated ability, item, feature, or homebrew interaction. Homebrew and alternate namespaces must be explicit and cannot silently replace a canonical move.

Canonical prose is review input, not executable runtime input. Tooling may use prose to scaffold a draft or report likely capabilities, but a human-reviewed spec or handler and executable evidence are required before runtime selection or status promotion.

Reviewed mechanic capabilities live in the strict `data/move-automation/capabilities.json` catalog. Each stable capability code records its owning delivery phase, dependency codes, implementation status, and a canonical representative move. Authoritative manifest capability tags and blocker codes must resolve through that catalog; bootstrap `suggestedCapabilityTags` remain non-authoritative planning hints and are not treated as implemented mechanics.

### Runtime model

A `MoveSpec` is immutable, versioned, JSON-serializable data. It declares targeting, preconditions, costs, ordered phases, bounded predicates and expressions, typed effect operations, optional registered handler identity, and presentation metadata. It cannot contain callbacks, source strings, arbitrary patches, or client-authored executable data.

Before registration, the server fills syntax-only defaults, puts phases and set-like metadata in canonical order, validates every selector, predicate, operation, capability, and local operation/roll reference, and applies aggregate complexity limits. Its reviewed definition hash is SHA-256 over strict canonical JSON that includes the hash-format version and frozen ruleset provenance. Mechanic-bearing array order, such as operations within a phase, remains significant.

The server keeps legacy-v1 adapters and MoveSpec-v2 definitions in separate duplicate-checked registration sets. Both generations may coexist for migration and shadow comparison, but the semantic manifest selects exactly one reviewed version, definition hash, and source module for live resolution. Runtime lookup accepts only canonical move identity; client-submitted runtime kinds, specs, versions, or hashes are forbidden authority fields.

The interpreter:

- receives one immutable authoritative rules context;
- evaluates bounded selectors, predicates, and expressions in explicit phase order;
- requests randomness through an injected server-owned interface;
- emits typed effect operations, a complete resource read set, and a structured trace;
- produces a typed state-change plan rather than mutating repositories; and
- either finishes with a commit-ready plan or suspends at a typed durable response window.

Typed effect operations are the only normal way for specs and handlers to request mechanics. Every operation identifies its source, recipients, timing phase, and reason code. Unknown operation kinds and arbitrary state patches are rejected.

Expression evaluation bounds every intermediate number and derives stable audit node IDs from the reviewed root ID plus its AST path. Fractions are preserved by default; an integer consumer must select an explicit root-only floor, round, ceiling, or truncation policy so nested calculations are not repeatedly rounded. Scalar subject queries require exactly one authoritative placement, and boolean composition evaluates every reviewed branch in order for complete deterministic evidence. Damage stat selections name authoritative actor/target stats, explicitly state whether Combat Stages and condition/ability stage modifiers are honored or ignored, and may compare bounded alternatives; positive and negative Combat Stage totals are server-derived rather than client-supplied. Native-v2 contextual Damage Bases use this expression language rather than the legacy closed dynamic-rule union: each operation declares root rounding, inclusive minimum/maximum bounds, and whether canonical STAB is omitted, applied before bounds, or applied after bounds. The server evaluates that calculation separately for each authoritative recipient and records every expression node plus the final DB before selecting the damage dice formula. Power Trip is the native stage-scaling canary: it sums only the actor's positive authored Combat Stages, adds two DB per stage to DB 2, caps the contextual value at DB 20, and applies STAB after that cap without mutating a runtime script.

Damage arithmetic uses one deterministic pipeline with explicit stages for final Damage Base/roll, attack stat, defense stat, pre-type modifiers, type effectiveness, critical modifiers, post-damage modifiers, minimum damage, and final HP loss. Every applied modifier carries a stable ID, integer priority, authoritative source, stacking group, and trace reason; stage order, then priority and stable metadata, determines execution independently of provider iteration order. Critical dice remain canonical pre-type damage: the later critical trace stage replays them through the same type-effectiveness stage so rounding is identical and auditable.

A damage operation may derive its move type from a bounded scalar expression for each authoritative recipient. Reviewed type policy can replace a named defender-type relation, independently ignore immunity, resistance, or weakness, or set an exact final effectiveness multiplier; omission always honors the canonical chart and authoritative passive effects. Dynamic type also owns STAB selection for the native damage roll. Critical policy is likewise explicit: canonical or expanded natural-roll ranges, bounded natural-roll sets, guaranteed or prohibited criticals, and target-side prevention are resolved from the server roll and current target sheet. A prevention bypass must be reviewed operation data. Alternate attack and defense selections continue to state whether positive or negative Combat Stages are honored or ignored. Type, matchup, critical trigger, prevention source, and stage selections are retained in server audit evidence.

Multi-hit damage is a bounded high-level operation rather than multiplied Damage Base. It declares a fixed, direct-roll, or reviewed-table hit count; automatic, once-per-sequence, or per-hit accuracy (including reviewed stop-on-miss behavior); and an accuracy-derived, independent per-hit, or absent critical roll. Each successful strike runs the ordinary type, Damage Base, critical, and ordered damage pipeline, reduces HP into local sequence accumulators, then applies reviewed condition or Combat Stage follow-ups at explicit after-each or after-all trigger boundaries. Subsequent standard stat/condition calculations and knockout checks observe those accumulated changes. Resolution stops before further rolls when a strike knocks out its target. The ledger gives count, accuracy, critical, and damage draws stable sequence IDs, while the audit trace records every attempted strike, miss, effect outcome, aggregate damage, and early-stop reason. Retrying from the same authoritative snapshot and draw stream therefore cannot change the count or silently collapse/reorder rolls. Double Kick is the fixed two-strike canary with independent Accuracy Rolls and accuracy-derived criticals. The registered Five Strike family—Fury Attack, Fury Swipes, and Pin Missile—uses one shared reviewed 1d8 table program with one sequence Accuracy Roll, independent per-strike critical and damage rolls, early-knockout stopping, and an aggregate accepted-result summary; no member falls back to multiplied Damage Base or operator-finished strikes.

HP operations distinguish healing from direct HP change and never use suggestion labels as mechanics. Fixed, real/formula Max HP, current HP, missing HP, and bounded formula calculations use explicit root rounding and final-pool bounds; full healing uses the Injury-adjusted cap, while temporary HP, set, copy/equalize, simultaneous split/average, and two-recipient swap modes are separate typed branches. Copy sources, compound actor/target sets, and all mutated recipients are server-resolved selectors, and formula reads join the authoritative read set. Weather-dependent healing selects reviewed percentages from the authoritative map-weather query; a client cannot submit the healing amount. Healing cannot become loss through a restrictive bound. When healing and Daily usage independently change the same sheet, the native planner combines only disjoint typed fields observed at the same revision into one CAS write; overlapping ownership or divergent snapshots fail closed. Redistribution snapshots every requested final value and immunity decision before changing any recipient, preventing partial swaps or HP duplication. A later operation may derive a bounded amount from the selected pool actually removed by an earlier direct-HP operation, with prevented or upward changes contributing zero. Direct HP bypasses damage stats and weakness/resistance scaling while explicitly declaring whether canonical type immunity still applies. A hit-only direct-HP operation references an earlier server-owned accuracy d20, consumes only its authoritative hit recipients, and never enters the critical-hit pipeline. Secondary splash recipients may be derived from authoritative hit targets and cardinal footprint geometry; every inspected sheet-derived footprint joins the read set. Direct HP reduction explicitly chooses whether HP-marker Injuries are applied after the operation or ignored, and always declares that Massive Damage is `never`; only a damage operation can apply the normal Massive Damage threshold. Each recipient's calculation, bounds, prior/final pools, linked source, and Injury outcome are retained in the structured trace.

Drain and recoil reference one earlier authoritative damage operation and use effective HP plus temporary HP actually removed, never requested or client-reported damage. Every prevented or zero-damage recipient contributes zero. Multi-target links explicitly choose per-target or aggregate rounding, and their source-recipient breakdown is retained in audit evidence. Absorb is the native drain canary: it rounds half damage to the nearest integer, counts temporary HP removed, drains after a knockout, drains nothing on a miss or Sap Sipper immunity, and caps healing at the actor's current Injury-adjusted maximum. Fixed and real-Max-HP costs carry declaration, hit, damage, or completion timing; hit- and damage-timed costs fail closed when their authoritative trigger did not occur. An optional minimum-remaining-HP precondition rejects an unaffordable plan before persistence, while an explicit sacrifice sets the actor to zero and clears scene-local temporary HP. These linked target and actor changes remain one typed atomic plan.

Combat Stage operations distinguish one named stage, one concrete server-selected Stat, all five stage-bearing Stats, and every stage including Accuracy. Typed transforms cover cap-aware deltas, absolute set/reset, inversion, positive/negative clearing, source-preserving copy, two-recipient swap, explicitly rounded split, and source-to-destination transfer. Copy and transfer sources are resolved from authoritative selectors and join the sheet read set. Coupled redistribution snapshots every recipient before calculation; prevention of any requested delta leaves that stage unchanged for every participant, so a blocked swap, split, or transfer cannot duplicate or discard a source value. Per-stage trace results distinguish applied, capped/no-op, and prevented changes while retaining operation and source identity.

Condition operations cover persistent apply/remove, filtered clear, atomic source-to-recipient transfer, filtered replacement, and choices indexed only by an earlier server-owned roll. Cleanse filters use reviewed exact IDs or bounded major, minor, persistent, volatile, other, and status groups with explicit exclusions. An application either writes the persistent sheet layer or creates a typed source-linked encounter effect with game-event duration, resolved save timing, and replace/refresh/stack/independent-instance policy; it never flattens an encounter effect into a sheet. Transfer retains its source when the destination already has the condition or authoritative type, ability, allied-provider, side, or cell-effect immunity prevents receipt. Condition reductions query those immunity providers through the frozen rules context, include indirect sheet providers in the read set, and trace applied, removed, selected, prevented, capped, and no-op outcomes.

Before pure resolution runs, `buildAuthoritativeMoveRulesContext` detaches and recursively freezes the map, intent, sheets, actor, placement views, ruleset, and selected runtime definitions. Lookup maps and the accumulating resource read set remain private behind frozen query interfaces; randomness, one resolution time, and ID generation enter only through explicit server-injected seams.

Every random request has a stable roll ID and parent effect ID. Its bounded dice, uniform-integer, or reviewed-table formula, reason, natural results, modifiers, and final value are stored in the accepted resolution ledger. Tests may inject an exact finite draw stream; a missing or unused draw fails resolution, making changed draw counts explicit instead of silently shifting later outcomes.

Opposed checks and saving throws are typed check operations over authoritative recipients. A roll source is either a reviewed fixed formula, the participant's resolved sheet skill pool, one resolved stat added to a reviewed formula, or a bounded server-authored source choice. DCs and contextual modifiers use the expression evaluator. Automatic rerolls, kept-result policy, tie resolution, and success/failure branch IDs are explicit and bounded; every attempt remains in the roll ledger. A required source choice suspends before drawing, while an optional resource reroll records a provisional result and returns a typed non-committing resource-spend request. The client receives stable option IDs, never the hidden source definition or a submitted roll/modifier.

Branch operations select only reviewed later operation IDs. The server may choose one resolution-wide or per-recipient path from a bounded predicate, route each recipient through the exhaustive self/ally/enemy/unknown relationship result, or consume the final branch ID of an earlier authoritative check. Human branch options are mutually exclusive stable IDs; an optional effect uses an explicit empty pass path. A resolution-wide or target-specific choice returns a typed non-committing pending result whose public options omit the referenced mechanics. On an authorized durable response, the interpreter binds only the stable option ID to its reviewed path, records the selected/pass decision, and continues without executing unselected paths. Unselected paths do not roll, resolve recipients, enter the emitted plan, or mutate state.

A registered server handler is an audited escape hatch for calculations that cannot reasonably fit the bounded expression language. A handler must be explicitly named and versioned, receives only the immutable context, and may emit only the same bounded typed operations and trace entries as a spec. It cannot access repositories, network services, ambient clocks, ambient randomness, mutable globals, or browser state. Handler identity and version contribute to the reviewed runtime hash.

Legacy scripts may pass through a compatibility adapter during migration, but the semantic manifest—not a client request—selects the reviewed runtime. Compatibility does not waive the completion definition.

### Authority and atomicity

`resolveMove` remains the authoritative atomic command boundary for immediate moves. The client may submit actor and move identity, requested target or area intent, durable choice IDs, command identity, and expected revision metadata defined by strict shared contracts. It may not submit rolls, damage, legal-target conclusions, effect programs, scripts, final state, or a runtime selection.

For each resolution, the server must:

- resolve actor authority and current move eligibility;
- derive legal candidates and final recipients from authoritative state;
- own and record all random draws;
- record every authoritative map, sheet, inventory, or other resource value consulted, including read-only misses, immune candidates, and indirect providers;
- revision-check that complete read set inside the same transaction that applies the plan;
- write all affected resources, operation results, history, and durable realtime rows atomically; and
- publish only after commit.

A stale or rejected command applies no partial map, sheet, inventory, usage, history, lifecycle, operation-result, or realtime mutation. Read-only resources are revision-checked without no-op writes.

The `opId` idempotency contract covers immediate and suspended work. A duplicate declaration or response never rerolls, spends again, opens a second prompt, applies an operation twice, or replays accepted presentation twice. Realtime, HTTP, replay, and operation-status delivery converge on the same stored result.

Random requests and effect decisions are recorded in a structured trace. The trace identifies phase transitions, target inclusion or exclusion, predicate outcomes, rolls and modifiers, operation inputs/results, prevented effects, choices, ancestry, and reviewed rules/runtime hashes. Bounded wire summaries may redact private details, but prose logs are not the only audit evidence.

### State ownership

Rules state has one authoritative owner:

| State | Authoritative owner |
|---|---|
| HP, injuries, daily usage, lasting character state, held/personal inventory, and other persistent character facts | The relevant Pokémon or trainer sheet |
| Shared campaign inventory | Its separate campaign/group-inventory resource |
| Encounter sides, temporary effects, counters, zones, delayed work, turn resources, bounded history, and pending-interaction summaries | Versioned `encounterState` on the authoritative map |
| Full suspended interpreter state and response windows | Durable server pending-resolution storage, referenced only by bounded map-visible summaries |
| Move definitions, semantic status, provenance, and reviewed runtime selection | Versioned repository specs/handlers and semantic manifest |
| Presentation queue, animation timing, hover/target previews, and other transient table feel | Browser runtime only; never mechanics authority |

Persistent character facts are not copied into encounter state merely for convenience. Temporary encounter facts do not become untracked prose or browser refs. Shared inventory remains a separately revisioned resource and joins a move transaction only when the move actually consults or changes it.

Placements carry explicit side identity for relationship rules. Ally and enemy status is never inferred from player ownership, GM control, token type, or simple map presence. Unknown allegiance fails closed unless a reviewed rule explicitly permits an unaffiliated target.

Timing is driven by authoritative encounter and initiative transitions such as turn, round, movement, switch, KO, and scene events. Wall-clock timers do not advance game rules.

### Durable choices and reactions

A move that waits for a person uses a durable, resumable saga:

1. The server declares and validates the move from an authoritative snapshot.
2. It executes until a typed choice or reaction phase is reached.
3. It stores the pending resolution, completed trace and rolls, read set, legal stable options, ownership, and a bounded public summary.
4. It commits only explicitly declared pre-window costs or state; no database transaction remains open while a person decides.
5. An eligible participant submits a choice, reaction, or pass using resolution, window, option, and operation IDs—never an effect payload.
6. The server authorises the response, revalidates the relevant full read set, resumes deterministically, and either opens the next window or commits the final plan atomically.
7. Cancellation, game-event expiry, conflict, abandonment, and authorised GM correction are explicit audited terminal paths.

Reaction timing and priority are server-defined phases, not component timing. Pending details are visible only to eligible participants and authorised GMs. Refresh, reconnect, process restart, duplicate delivery, or a lost HTTP response must not change the legal options or apply the response twice.

GM intervention uses typed override, cancellation, force-pass, or correction commands with causal links and an audit trail. It is not hidden bookkeeping, raw database editing, or silent replacement of a newer document. Compensation uses reviewed inverse operations and current-value/revision checks; it never reruns original randomness.

### Presentation and VFX

Presentation is downstream of mechanics. A bounded summary in the durable accepted result contains enough actor, move, target, geometry, outcome, and operation identity for authorised clients to present the accepted move once after live delivery or reconnect.

Generic accepted-result VFX are sufficient for completion. Bespoke choreography is outside this automation scope. Transient animation hints may improve latency, but they cannot determine hit status, damage, recipients, movement, or any durable state. Missing, disabled, reduced-motion, delayed, or failed VFX never changes resolution.

## Consequences

- Coverage reports must derive from semantic manifest records and executable evidence, not registry counts.
- Adding a move usually means authoring reviewed data and scenarios; adding a reusable mechanic means extending the bounded operation/query kernel rather than embedding one-off browser behavior.
- Specs, handlers, parsers, interpreters, reducers, planners, and persistence orchestration remain separate responsibilities.
- Immediate multi-resource moves retain one atomic commit; human wait states use persisted sagas with explicit revalidation rather than long-lived database transactions.
- Existing partial scripts and browser-local prompts remain usable only when labelled assisted until they satisfy this decision.
- Presentation can evolve independently because accepted mechanics, traces, and state do not depend on renderer behavior.

## Rejected alternatives

### Runtime interpretation of rules prose

Rejected. Natural-language rules are ambiguous, difficult to bound, hard to version deterministically, and unsafe as executable input. Prose can assist authoring and review but cannot select or generate live mechanics at runtime.

### Browser macros or client-authored effect programs

Rejected. A browser loop, script, roll, damage value, legal-target list, or arbitrary effect payload bypasses server authority and cannot safely provide atomicity, privacy, revision validation, or idempotent recovery.

### Registry presence or automation notes as completion

Rejected. A script can exist while leaving timing, targets, persistent effects, inventory, or reactions to the operator. Free-form notes are not executable evidence and cannot satisfy `complete`.

### One unbounded universal scripting language

Rejected. Arbitrary callbacks or state patches make validation, auditing, resource planning, and safe migration impractical. Bounded data operations plus narrowly registered pure handlers keep exceptional logic reviewable.

### One database transaction held open for a human response

Rejected. Human response time is unbounded and cannot safely hold locks or an in-memory snapshot. Durable suspension plus revision revalidation provides explicit recovery and conflict behavior.

### Browser ownership of encounter state or reaction timing

Rejected. Local prompts and timers do not survive refresh, cannot enforce response ownership, and race with other clients. The server owns lifecycle events, windows, priority, and terminal state.

### Inferring allegiance from token ownership

Rejected. Player/GM control is an authorization fact, not a team relationship. Explicit encounter side identity is required for ally/enemy mechanics.

### VFX as a mechanics or completion requirement

Rejected. Renderer availability and bespoke animation coverage must not gate or influence authoritative rules. Only the accepted mechanical result is authoritative.

## Conformance checklist

A future move-automation design conforms to this ADR only if reviewers can answer **yes** to all applicable questions:

- Is the reviewed runtime selected by versioned server metadata rather than the client?
- Are canonical prose and browser data non-executable?
- Are selectors, expressions, operations, and any handler output typed and bounded?
- Does the server own legality, relationships, RNG, targets, effects, and final logs?
- Does planning expose every consulted resource and validate its revision at commit?
- Is immediate mutation atomic, idempotent by `opId`, and published only after commit?
- Is every human wait a typed, authorised, durable, resumable window with stable option IDs?
- Are timing and lifecycle driven by authoritative game events rather than wall-clock or component state?
- Does each durable fact have exactly one owner under the state-ownership table?
- Can structured trace and scenarios prove every branch claimed as `complete`?
- Are unsupported interactions explicit and separate from the base-move status?
- Can presentation fail or replay without changing or duplicating mechanics?

If any required answer is no, the design must be revised or the affected move must remain `assisted` or `blocked`.