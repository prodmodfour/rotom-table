# ADR 014: Authoritative Feature automation runtime

- Status: Accepted
- Date: 2026-08-04

## Context

Trainer Features combine build progression, class branches, AP resources, passive providers, grants, Orders, Training, triggers, combat declarations, crafting, tutoring, research, and campaign workflows. Historic sheets stored names and prose-derived helper fields, while the parser baseline contained merged field boundaries and incorrect errata class context.

## Decision

1. Keep `data/reference/features.json` as the sole runtime source and repair it only through a hash-guarded reviewed migration.
2. Freeze all 444 identities, source hashes, class ownership, prerequisites, choices, roles, frequency/payment metadata, grants, campaign operations, cohorts, and scenarios in app-owned automation artifacts.
3. Persist strict `FeatureInstanceData`; legacy or malformed rows are diagnostic-only until normalized.
4. Resolve one effective Feature projection across direct Features, classes, Orders, Training, grants, suppression, ranks, and source loss.
5. Execute through a hash-bound native registry. Server code owns AP, frequency, accepted trigger events, targets, randomness, resource settlement, retries, and atomic plans.
6. Represent canonical open-ended judgement as bounded durable adjudication, never as browser-authored mechanics.
7. Project all UI offers and explanations from accepted/effective mechanics through the generic encounter presentation contract.

## Consequences

- Runtime code does not parse Feature prose.
- Permanent grants are virtual and provenance-bound.
- Unknown source rows and missing choices cannot affect mechanics.
- Documentary parser/book drift cannot silently change play.
- Adding or changing a Feature requires regenerating artifacts, reviewing source adjudication, adding scenarios, and passing the strict checker.
