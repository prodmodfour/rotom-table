# ADR 012: Server-authoritative Capability automation runtime

- Status: Accepted
- Date: 2026-07-27

## Context

PTU Capabilities mix valued movement, passive physical and sensory facts, combat providers, contextual actions, forms, mounts, fusion, crafting, time, information, and explicit GM judgement. Earlier code scattered exact-name checks across sheet rendering, movement, and Struggle helpers. It had no closed inventory, effective source projection, durable usage state, replay identity, or generic contextual presentation.

Treating every Capability as a button would be incorrect. Treating narrative or campaign-time clauses as manual would also violate live-play authority and make reconnect/retry behavior unknowable.

## Decision

1. `data/reference/capabilities.json` is the sole canonical runtime catalog. Generated metadata freezes all 83 identities and source provenance.
2. Runtime prose is never interpreted. Each row maps to a strict native definition with reviewed semantic tags, action specs, source-effect hash, and deterministic definition hash.
3. One effective projection combines species, Trainer formulas, sheet overrides, reviewed Move/Ability/Feature/Edge grants, forms/links, and encounter effects while retaining provenance and suppressions.
4. Passive clauses extend the existing movement, Move, creature-rule, HP, inventory, and lifecycle queries. They are not invocable actions.
5. Activated clauses appear only as source-owned contextual offers through the accepted Encounter Presentation contract. The client supplies bounded selections; the server owns legality, costs, rolls, and writes.
6. Consequential execution is idempotent and atomic in SQLite. Exact retries replay the stored result; operation-ID drift, stale revisions, and stale offers fail closed.
7. Temporary modes and links are encounter state. Lasting usage and campaign transformations are sheet state. Pending GM decisions and operation audits have dedicated SQLite tables.
8. Genuine source-delegated judgement uses a hash-bound, expiring, GM-only adjudication request and exact resume path. When the judgement is part of an in-flight Move (Explosion/Self-Destruct Loyalty), the existing durable Move-response window keeps all Move consequences in one deferred transaction. Accepted choices are retained as state; there is no legacy/manual execution fallback.
9. Ambiguous world resources are explicit map metadata (`capabilityContexts`, willing-target identities, eggs, synchronized Keystones, and devices), never inferred from browser text.
10. Existing movement, Struggle, form, item, realtime, and atomic mutation infrastructure is reused rather than forked.

## Consequences

### Positive

- The canonical count and source drift are mechanically enforceable.
- Players cannot forge rolls, targets, cooldowns, item outputs, or GM choices.
- Reconnect and retries preserve one result and one set of writes.
- Capability source loss can fail closed because modes and links retain their source instance.
- Passive and contextual behavior remains visible through one generic UX contract.
- Daily/weekly/24-hour/two-week rules use explicit lifecycle identities.

### Costs

- World-dependent actions require GM-authored typed context metadata.
- Capability integration touches existing mechanical queries rather than remaining in one isolated module.
- Long-duration state requires campaign-day advancement instead of wall-clock guesses.
- New acquisition sources must be added to the reviewed grant catalog before they can affect mechanics.

## Rejected alternatives

- **Universal “Use Capability” menu:** loses passive/contextual distinctions and leaks unavailable actions.
- **Client-side resolution:** permits forged geometry, rolls, inventory, and cooldowns.
- **Runtime prose parsing:** unstable under wording changes and impossible to certify exhaustively.
- **Free-form GM notes as execution:** not bounded, replayable, or stateful.
- **A parallel capability movement/inventory engine:** duplicates mature authority and creates divergent rules.
- **Editing production runtime directly:** violates the repository’s GitHub deployment path and production-like workspace boundary.

## Verification

`scripts/check_capability_automation.ts` verifies frozen source hashes, 83 manifest/runtime rows, native handler binding, scenario closure, source adjudications, definition hashes, required artifacts, and plan completion. Focused tests cover identity/parameters, projection precedence, durable state and time, mechanics, SQLite replay/adjudication, movement/Move interactions, and command authorization. The project quality gate invokes the completion checker before release.
