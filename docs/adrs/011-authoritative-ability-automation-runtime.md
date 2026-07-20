# ADR 011: Authoritative ability-automation runtime

Date: 2026-07-09

Status: Accepted; implementation in progress

## Context

Rotom Table has useful ability behavior in several places: sheet-derived passive modifiers, condition and immunity helpers, weather and move hooks, a small active `useAbility` transaction registry, and several durable post-move follow-ups. Those paths improve play, but they do not form a complete semantic runtime. Some execute in browser-oriented helpers, some are coupled to a specific move phase, and registry presence does not prove that every frequency, trigger, target, duration, reset, choice, or special clause is represented.

The frozen canonical ability source contains 483 distinct abilities. They include Static providers, declared actions, event-triggered Free Actions, Interrupts and Reactions, mixed passive/active abilities, finite Scene and Daily resources, source-linked effects, forms, copied abilities, held-item operations, movement, battlefield objects, and choices that cannot safely be reduced to a single target button.

Abilities also differ from moves in an important way: many are not declared actions. They observe accepted game facts and may alter a move before it resolves, react after an outcome, contribute a passive calculation, or schedule state for a later lifecycle boundary. Treating every ability as a move or as a browser macro would lose timing, authority, privacy, and recovery guarantees.

This decision extends [ADR 009](009-server-authoritative-profile-play.md) and [ADR 010](010-move-automation-runtime.md). ADR 009 owns the live-play command boundary. ADR 010 owns the typed mechanical kernel and durable resolution principles. This ADR defines the separate ability envelope, event model, frequency state, and completion contract.

## Decision

Rotom Table will implement abilities through a **versioned, server-interpreted `AbilitySpec` runtime** with bounded pure handlers for genuine contextual outliers. AbilitySpec will reuse compatible MoveSpec selectors, predicates, expressions, typed effect operations, reducers, state planning, traces, roll ledgers, and pending-response storage. It will not pretend that an ability declaration is a move declaration.

The canonical catalog and initiative ledger are frozen in:

- `data/reference/abilities.json`
- `data/ability-automation/ruleset.json`
- `data/ability-automation/manifest.json`
- `data/ability-automation/capabilities.json`
- `data/ability-automation/scenario-requirements.json`
- `ABILITY_AUTOMATION_PLAN.md`

Exactly one manifest row tracks each canonical ability. A source-data or count change requires an intentional provenance revision rather than silently changing the denominator.

### Runtime modes

One ability may declare one or more reviewed modes:

- **Static provider:** contributes automatically from the current effective-ability projection. It is never exposed as a manual use action.
- **Activated declaration:** begins from a strict `useAbility` intent, validates action and frequency resources, derives legal targeting/options on the server, and resolves immediately or suspends at a durable choice.
- **Triggered subscription:** matches one or more typed accepted encounter events. Eligibility is derived from the event plus current authoritative state; optional use becomes an authorized durable window.

A mixed ability can combine modes. For example, a Bonus paragraph may be Static while the main effect has a finite triggered action. Each mode remains explicit data and contributes to the reviewed definition hash.

### AbilitySpec envelope

AbilitySpec is immutable, JSON-only reviewed data. Its closed envelope will identify:

- canonical ability ID and behavior version;
- runtime modes and typed event subscriptions;
- targeting declarations and stable choice branches;
- predicates and preconditions;
- action, frequency, round, turn, or special costs;
- ordered execution phases and typed effect operations;
- optional registered handler identity; and
- mechanics-independent presentation metadata.

Specs cannot contain callbacks, source code, natural-language programs, arbitrary patches, repositories, clocks, ambient randomness, or client-authored mechanics. Normalization, aggregate limits, rules provenance, handler identity, and mechanic-bearing order contribute to a SHA-256 definition hash selected by the manifest.

### Effective-ability projection

The server resolves one deterministic effective projection before testing eligibility or applying providers. The projection starts from authoritative sheet abilities and applies reviewed grants, copies, replacements, transformations, and suppressions in defined order. Uncopyable or undisableable clauses are explicit policy, not name checks scattered across consumers.

A suppressed or replaced ability cannot contribute a passive provider or open a trigger. Source-linked state records source identity and cleans up only at its reviewed lifecycle boundary. Copy and transformation behavior uses immutable snapshots so later mutation cannot retroactively change the copied base.

### Frequency and action resources

Static is a mode, not a spendable frequency. At-Will, Scene/Scene xN, Daily/Daily xN, once-per-round, once-per-turn, cooldown, and exceptional use pools are typed server-owned resources.

- Encounter-local Scene, round, turn, and cooldown state belongs to versioned encounter state.
- Lasting Daily use belongs to the authoritative sheet.
- Standard, Shift, Swift, Free, Full, Priority, Interrupt, and Reaction availability uses authoritative encounter action resources.
- Extended and Special actions use explicit reviewed semantics rather than being coerced into a browser note.
- Interrupt and Reaction share availability where the rules require it.

Payment is atomic with immediate resolution or with the explicitly reviewed pre-window portion of a suspended resolution. Exact retries cannot spend again. Scene, encounter, rest, round, and turn resets are typed accepted lifecycle transitions.

### Typed events and trigger routing

Ability triggers consume a closed server-internal event vocabulary. Events are emitted from accepted reducers and use cases, never submitted as trigger conclusions by a browser. Applicable facts include move declaration and outcomes, hit/damage/critical context, HP and faint transitions, condition and Combat Stage changes, movement steps, send-out/recall/switch, turn/round/scene transitions, fields, and items.

Each event has stable identity, source operation, causal parent, reason code, and a bounded exact payload. The router:

1. loads the current effective-ability projection;
2. finds reviewed subscriptions for the event kind and checkpoint;
3. evaluates eligibility through frozen queries and records every consulted resource;
4. orders simultaneous triggers by reviewed timing, priority, source identity, and stable operation identity;
5. resolves mandatory deterministic effects or persists optional authorized windows; and
6. emits child events with causal ancestry and cycle/depth budgets.

Replay of an accepted event cannot create a second trigger. One causal chain cannot reopen the same guarded trigger unless the reviewed definition explicitly permits it.

### Choices, Interrupts, and Reactions

Human participation is compatible with semantic completion only through durable server-owned windows. A pending ability stores reviewed runtime identity, triggering event, completed trace and rolls, read set, legal stable options, response ownership, frequency/action reservation, causal ancestry, and resume cursor.

Public map state contains only bounded summaries. Eligible participants and authorized GMs retrieve private response views. Clients return resolution/window/option/operation IDs, never an effect payload. Pass, force-pass, cancellation, expiry, stale conflict, abandonment, and GM correction are typed terminal or continuation paths.

Interrupt and Reaction timing is attached to exact authoritative checkpoints. UI component timing does not decide whether an ability can interrupt a move, movement step, switch, or other action.

### Authority and atomicity

The browser may submit actor identity, canonical ability identity, reviewed target/branch intent, stable option IDs, command identity, and revision/conflict metadata. It may not submit:

- trigger eligibility;
- current effective abilities;
- legal target or responder lists;
- action/frequency affordability;
- rolls, check totals, or random outcomes;
- modifiers, damage, healing, or operation definitions;
- final state or arbitrary patches; or
- runtime kind, version, hash, or source module.

Immediate ability resolution produces one typed state plan. Every consulted map, sheet, inventory, pending row, and other revision joins the read set. Persistence validates that read set and commits all physical writes, operation status, accepted events, and durable realtime rows in one SQLite transaction. Stale work applies nothing.

### State ownership

| State | Authoritative owner |
|---|---|
| Base abilities, permanent choices, Daily use, HP, injuries, lasting character facts, held/personal inventory | Pokémon or trainer sheet |
| Scene/round/turn use, cooldowns, temporary grants/suppression, modes, marks, counters, source-linked effects, typed public pending summaries | Versioned map encounter state |
| Shared campaign inventory | Separate revisioned group-inventory resource |
| Full suspended ability state, private options, rolls, reads, and trace | Durable pending-resolution storage |
| Specs, handlers, manifest status, capabilities, evidence, and provenance | Versioned repository data/code |
| Animation, hover, menus, transient banners, and timing polish | Browser presentation only |

An ability-created anchor, decoy, wall, or subordinate entity uses a typed bounded encounter representation. It does not become an arbitrary placement or untracked prose log.

### Semantic completion and interactions

A manifest row is `complete` only when every clause of that ability is represented by authoritative mechanics or a typed durable human choice, all applicable branches have executable evidence, the runtime hash and provenance match, and blocker/debt/manual-step arrays are empty.

Base completion includes interactions directly required by the ability's own text—for example, a named connected move, held-item selection, weather dependency, or suppression exception. Broad ecosystem certification remains a separate interaction status. Known unsupported move, item, feature, condition, form, or other combinations must be explicit stable IDs; they cannot be hidden behind a complete base claim.

### Migration

Existing ability helpers are migration inputs, not alternate production authority. During migration they may be exercised through explicit compatibility or shadow paths on immutable snapshots. Only the manifest-selected plan may persist. There will be no dual write and no fallback from a missing AbilitySpec to browser transaction logic.

Production legacy ability execution is retired only after all 483 rows are complete, whole-catalog conformance passes, existing supported flows have been adjudicated, and release acceptance is recorded. Historical readers may remain for a bounded compatibility window; they do not select new execution.

## Consequences

- Implementing an ability usually means authoring reviewed data and evidence, not adding another name-based `if` to UI code.
- Move and ability behavior share one bounded mechanical kernel while retaining separate declaration and lifecycle envelopes.
- Accepted actions become the only source of trigger events, improving replay and concurrency behavior.
- Static abilities no longer need manual activation UI merely to be visible as automated.
- Frequency, trigger ordering, copied/suppressed abilities, and pending responses become inspectable structured state.
- The migration is intentionally incremental: honest blocked rows are preferable to false automation claims.

## Rejected alternatives

### Parse ability prose at runtime

Rejected. Prose is ambiguous, unbounded, difficult to version, and unsafe as executable authority.

### Treat every ability as a `useAbility` button

Rejected. Static providers and event-triggered Interrupts would occur at the wrong time, hidden information would leak, and refresh/replay could change outcomes.

### Keep independent name-based hooks in each move or component

Rejected. Distributed hooks cannot provide complete trigger ordering, source suppression, frequency payment, read sets, or catalog-scale evidence.

### Client-generated trigger events or effect transactions

Rejected. A browser cannot authoritatively know hidden abilities, current revisions, legal responders, complete targets, or atomic multi-resource effects.

### One database transaction held open for a response

Rejected. Human response time is unbounded. Durable suspension with revision revalidation is the accepted model.

### Mark existing helpers complete by registry count

Rejected. A useful modifier or follow-up may cover only one clause, one timing, or one interaction. Completion requires reviewed semantics and executable scenarios.

## Conformance checklist

An ability implementation conforms only if reviewers can answer yes to every applicable question:

- Is runtime selection canonical, manifest-owned, versioned, and hash-checked?
- Are prose and browser data non-executable?
- Is the ability's mode—Static, activated, triggered, or mixed—explicit?
- Does the server own effective-ability projection, eligibility, targets, costs, rolls, effects, and trigger ordering?
- Are finite uses and action resources paid and reset by authoritative reducers?
- Does every accepted trigger derive from a typed accepted event with stable causal identity?
- Are nested triggers bounded and replay-idempotent?
- Does every human wait use an authorized durable window and stable option IDs?
- Are hidden abilities, eligibility, options, rolls, and sheets redacted from ineligible views?
- Does every consulted resource join the atomically validated read set?
- Does each durable fact have one owner under the state table?
- Can executable evidence prove every branch claimed as complete?
- Are unsupported ecosystem interactions explicit and separate?
- Can presentation fail or replay without changing mechanics?

If any required answer is no, the row remains assisted or blocked.
