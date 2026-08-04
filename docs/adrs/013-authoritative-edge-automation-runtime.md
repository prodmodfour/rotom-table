# ADR 013: Authoritative Edge automation runtime

- Status: Accepted
- Date: 2026-07-28

## Context

Trainer Edges and Poké Edges previously shared free-form sheet rows, exact-name helpers, and occasional browser derivations. Their owners, acquisition currencies, repeatability, choices, lifecycle, and effects differ. Interpreting canonical prose during play would make clients authoritative and make retries, source loss, and audits unreliable.

The Breeder Trainer Edge also crosses into a durable breeding aggregate that cannot safely be simulated by editing Egg Move fields or inventory rows.

## Decision

1. Freeze Trainer and Poké Edge catalogs independently under `data/reference/` and hash-guard both.
2. Give every acquired Edge a strict family-qualified identity, stable instance ID, typed choices, rank, acquisition provenance, and optional GM override evidence.
3. Resolve one deterministic effective Edge set before any mechanic executes. Unknown and malformed rows never execute.
4. Bind all 81 rows to reviewed, hash-stable native declarations. Effect prose is presentation/source evidence only.
5. Keep passive providers passive. Only explicit canonical actions or contextual operations become offers.
6. Make Move, Ability, Capability, and other permanent grants source-bound projections rather than unexplained copied values.
7. Validate acquisition separately from runtime effects. Canonical prerequisite failures require a current, GM-authored override; they do not change the mechanic.
8. Make every triggered, contextual, inventory, training, and lifecycle result a server plan over authoritative snapshots and commit it with revision/exact-retry guarantees.
9. Permit one closed delegation: `Breeder` may request `breeding.v1` through `edge.breeder.request.v1`. The breeding subsystem exclusively owns projects, Eggs, offspring, lineage, inheritance, incubation, and hatching.
10. Project Edge facts, actions, choices, unavailable reasons, and accepted outcomes through the generic encounter presentation contract.

## Threat model

The runtime rejects or neutralizes:

- client-supplied canonical effects, grants, rolls, costs, eligibility, or inventory outcomes;
- family confusion between same-named Trainer and Poké rules;
- unknown identities, malformed typed data, duplicate instance IDs, invalid cardinality, unsafe strings, and stale prerequisite overrides;
- repeated choices or ranks beyond canonical limits;
- arbitrary cross-character targets without current control/ownership evidence;
- stale map/sheet revisions, duplicate operations, partial multi-resource writes, and replay after source loss;
- source drift or attempts to make books/parser output runtime authority;
- hidden build data leaking through public projections;
- delegations that manufacture downstream state or return fake success.

## Consequences

The implementation has more explicit metadata and validation, but all mechanical contributions are explainable and reversible by source. Legacy rows remain readable for migration while no longer granting execution authority when unresolved. Breeding can evolve independently without creating a second owner for Egg state.
