# ADR 012: Server-authoritative encounter interaction and presentation contract

- Status: Accepted
- Date: 2026-07-28
- Owners: live-play authority and automation maintainers

## Context

Move and Ability automation introduced mechanically authoritative runtimes, but their client seams grew independently: token-menu metadata, capability bundles, pending-response payloads, move result summaries, Ability result keys, action splashes, VFX, and log prose. Repeating that pattern for Capabilities, Features, Edges, Items, Orders, and terrain would make source chapter names determine UI architecture and would invite clients to reconstruct legality from sheet text.

## Decision

Rotom Table has one versioned, strict, source-agnostic contract under `shared/encounterPresentation/`.

The authority chain is:

1. a source-owned runtime evaluates mechanics and state;
2. the server projects a role-specific, revision-bound `EncounterPresentationProjection`;
3. the client submits the exact `offerId`, actor, action, map, and revision in an `EncounterActionDeclarationIntent`;
4. `declareEncounterActionUseCase` reprojects and authorizes that exact offer before a compatibility workflow collects source-owned inputs;
5. the source-owned command use case independently reauthorizes and commits mechanics;
6. accepted mechanics become `AcceptedEncounterPresentation` facts and enter the same durable result/realtime row as the accepted operation;
7. snapshots recover bounded accepted history from those durable rows.

A declaration receipt is not a capability token and never grants mechanics authority. A state change between declaration and commit is rejected by the existing command revision and authorization checks.

`sourceKind` is provenance and reference metadata, not navigation. Interaction roles, choice kinds, action groups, timings, costs, availability reasons, contribution operations, outcomes, changes, VFX hints, and announcement priorities are closed catalogs.

## Privacy projections

| Projection | Offers | Pending data | Contributions/reasons | Diagnostics |
| --- | --- | --- | --- | --- |
| `public` | none | existence, count, safe prompt only | public rows; hidden rows collapse to “Private rule” | none |
| `actor-owner` | controlled actors | actor-authorized views only | private rows removed/redacted | none |
| `responder-owner` | controlled actors | exact authorized options and response identity | private rows removed/redacted | none |
| `gm` | all server-authorized table actions | options plus recovery actions | table-visible evidence | none |
| `diagnostic` | all | full diagnostic view | private rows retained | bounded diagnostics |

Ability accepted realtime is map-public. It preserves Ability provenance but uses the safe identity `private-ability` / “Ability”; hidden Ability and instance IDs remain in authorized source-owned responses only.

## Contract properties

- JSON-only, schema version 1, exact-field parsers, deep-detached and frozen outputs.
- Stable bounded IDs; deterministic stable JSON and SHA-256 fingerprints.
- One MiB maximum encoded projection/accepted payload, plus per-collection/text/depth/node limits.
- Unknown enums, duplicate IDs, bad cardinality, inconsistent map/revision identity, private rows in non-diagnostic projections, and malformed retry identities fail closed.
- Choices carry server-issued option IDs. Public pending summaries never carry options or responder identities.
- Accepted facts carry typed outcomes, changes, contribution explanations, causal order, accessible copy, history, correction links, and reduced-motion-aware VFX hints.
- VFX, announcements, headlines, and history are downstream presentation only and can be dropped without changing state.

## Compatibility and retirement

The snapshot wire contract contains only `encounterPresentation`; source-specific Ability capabilities are derived locally for old controls. Existing context-menu rows are decorative compatibility data and are filtered by generic server offers. The generic panel and declaration endpoint provide an action path that does not infer legality from those rows. Existing Move and Ability presentation shapes remain read adapters only for pre-contract durable rows and old visual components.

New automation must not add a source-specific snapshot bundle, executable client rule payload, or chapter-specific permanent action panel. Any new primitive requires a catalog/version decision, strict parser, privacy projection, budgets, fixtures, and browser accessibility evidence.

## Consequences

The seam adds projection work and temporary adapters, but source runtimes remain independently evolvable while clients gain one interaction vocabulary. Reconnect, duplicate delivery, corrections, history, accessibility, and VFX can be tested once across sources. Some legacy UI enrichment remains until the encounter redesign, but it cannot make an action legal or manufacture hidden choices.
