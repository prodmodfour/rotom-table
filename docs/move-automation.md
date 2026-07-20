# Move automation contributor guide

This guide describes the server-authoritative live-play engine. Move prose, UI notes, and registry membership are not completion evidence.

## Authority model

A client declares only the actor, canonical move, reviewed target-selection envelope, map revision, conflict scopes, and operation ID. The server selects the runtime from `data/move-automation/manifest.json`, loads authoritative map/sheet/resource snapshots, draws rolls, evaluates rules, reduces typed operations, validates the complete read set, and atomically commits the result. Never accept damage, rolls, effect payloads, item identities, resource spends, or arbitrary patches from the browser.

Important locations:

- `shared/moveAutomation/`: strict schemas, expressions, selectors, effects, resources, pending sagas, and limits.
- `server/domain/moveAutomation/specs/`: reviewed MoveSpec v2 definitions.
- `server/domain/moveAutomation/handlers/`: registered pure contextual calculations.
- `server/domain/moveAutomation/registry.ts`: runtime registrations selected by the manifest.
- `server/domain/moveAutomation/reducers/`: typed operation reducers.
- `data/move-automation/manifest.json`: one semantic row per canonical move.
- `data/move-automation/scenario-requirements.json`: requirement-tag to evidence-class rules.
- `tests/fixtures/moveAutomation/` and `tests/server/`: evidence metadata and executable scenarios.

## Choose a spec or handler

Prefer a declarative MoveSpec when targeting, costs, predicates, branches, rolls, and operations can be expressed with existing closed schemas. A spec should show canonical phase order directly and use stable operation IDs.

Use a registered handler only when an operation value depends on authoritative runtime context that the bounded expression language cannot represent, such as a server-owned history aggregate or a canonical candidate tie. A handler:

1. receives frozen context and pure query/read-set interfaces;
2. performs no I/O, persistence, clock access, ID generation, or unseeded randomness;
3. returns only strictly parsed typed operations and sanitized trace entries;
4. remains deterministic for the same snapshot and roll ledger.

Do not add a handler to avoid defining a reusable primitive. If several moves need the same capability, add the typed schema/query/reducer first and keep move definitions declarative.

## Author one move

1. Read the canonical record in `data/reference/moves.json` and identify every branch, trigger, target relationship, immunity rule, cost phase, lifecycle boundary, and persistent effect.
2. Search existing specs/builders and reducers. Reuse a primitive only when its semantics match exactly.
3. Add a MoveSpec v2 definition with canonical ID, targeting, costs, phased operations, and presentation tags. Register a handler reference only if needed.
4. Add the registration to `REVIEWED_MOVE_SPEC_V2_REGISTRATIONS`. Duplicate or unknown canonical IDs fail startup validation.
5. Add only implemented capability IDs from `data/move-automation/capabilities.json`. A capability tag is a contract, not a keyword. Unknown, planned, or partially implemented capabilities cannot promote a move.
6. Add executable focused tests for hit, miss, immunity, cap, lifecycle, replay, stale-resource, and every move-specific branch that applies.
7. Add a stable scenario ID under `tests/fixtures/moveAutomation/` and map it in `conformanceEvidence`. Requirement tags must resolve through `scenario-requirements.json`; each required evidence class must be covered or explicitly and validly not applicable.
8. Validate the spec with the exact manifest capabilities and ruleset provenance. Copy the resulting SHA-256 definition hash and source module into the manifest runtime row. The hash changes whenever normalized semantics change.
9. Set `baseStatus: complete` only when runtime, capabilities, executable evidence, hash, provenance, and every canonical clause agree and `blockerCodes`, `limitations`, and `manualSteps` are empty. Use `assisted` or `blocked` otherwise.
10. Regenerate/check menu status and run the focused and strict gates below.

## Branch and interaction evidence

Evidence must assert mechanics, not merely that a definition parses. Include the authoritative input and resulting operation/state behavior for each declared branch. Typical classes include hit/miss/critical/immunity, ally/enemy/self targeting, optional/pass choices, retry, stale conflict, lifecycle trigger/cleanup, and multi-resource conflict. Durable-choice tests must prove stable option IDs, authorization, exact-body retry, no reroll on resume, and atomic final commit.

`interactionStatus: partial` requires explicit `unsupportedInteractionIds`. Do not hide an exclusion in prose. `interactionStatus: complete` is valid only after the reviewed interaction matrix passes. A prose comment, automation note, manual click, or animation demonstration cannot satisfy semantic evidence.

## Runtime selection and migration

The manifest is the only production runtime selector. All 776 canonical rows now select MoveSpec v2, and the production runtime registry is built with no legacy execution sources. A retained v1 definition or fingerprint cannot become executable merely because its source still exists. Explicit test-only migration registries may load a legacy definition for deterministic parity and backup-compatibility checks, but they are never passed to production planning or persistence.

Development shadow planning may compare two immutable, equally seeded plans, but only the manifest-selected plan may reach persistence. Shadow diagnostics contain hashes/counts only and are disabled in production. New accepted operations write only the current MoveSpec result and canonical encounter state. Historical accepted-result and backup readers remain available for the documented compatibility window; they do not restore v1 runtime selection or create old-format writes. Deployment rollback uses the normal prior application release and existing backup procedure—no private campaign state is deleted or rewritten as part of runtime retirement.

Never change production app files directly. Repository fixes are deployed through the project GitHub path. Never use private campaign data as a code fixture.

## Common failures

- **Definition hash mismatch:** validate the normalized spec with the row's exact capability list and ruleset provenance, then update the hash intentionally.
- **Unknown capability/evidence code:** use the closed catalogs; do not invent a tag in one manifest row.
- **Operation source/phase error:** a source operation must exist earlier in canonical phase order and support the requested outcome selector.
- **Recipient/immunity error:** actor-only effects must not claim target immunity; target effects must explicitly honor or narrowly bypass type/passive immunity.
- **Replay rerolls or double spends:** persist the roll ledger and phase costs in the pending record; retries reuse the exact command body and terminal operation.
- **Stale partial write:** every consulted resource must enter the read set and every physical write must be inside the same transaction/CAS boundary.
- **Private prompt leak:** public summaries contain counts and stable IDs only; options, ownership, rolls, sheets, and choices require the authorized response endpoint.
- **Manual debt on complete row:** complete rows cannot contain blockers, limitations, manual steps, or missing scenarios.

## Required commands

Use the smallest focused loop first:

```sh
npx vitest run tests/server/<focused>.test.ts
npm run typecheck
npm run check:move-automation -- --report
npm run check:move-automation-menu-status
```

Before promotion or merge:

```sh
npm run check:move-automation-complete
npm run check:move-automation-budgets
npm test
npm run build
bash scripts/quality-gate.sh
```

The strict checker requires exactly the frozen canonical catalog, one row per move in canonical order, valid runtime links/hashes, zero semantic debt, and resolvable evidence. The server semantic-completeness test additionally validates every registered MoveSpec against its manifest row. Removing evidence, changing a hash, adding manual debt, or introducing an unknown/duplicate implementation must fail the quality gate.
