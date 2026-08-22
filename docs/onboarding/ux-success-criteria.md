# Onboarding UX success criteria

- Contract: `onboarding-ux-success-v1`
- Date: 2026-08-16
- Structured source: [`data/onboarding/ux-success-criteria.json`](../../data/onboarding/ux-success-criteria.json)
- Plan: P9-008

## Policy

Guided onboarding is accepted by measurable outcomes, not screenshot preference. Ten release-gated criteria cover player flow, GM flow, durability, safety, handoff, accessibility, performance, and privacy. Targets are fixed now, before implementation, and are not retroactively weakened.

All measurement is **aggregate-only**: durations, counts, and pass/fail. No campaign identities, character names, private choices, comments, or draft payloads may be captured by any metric (matching the encounter workspace metrics precedent).

## Criteria

| Criterion | Target | Gate |
| --- | --- | --- |
| Time to first valid Trainer preview | median ≤20 min, p90 ≤40 min | P9-090 |
| Required decisions (default path) | ≤30, one primary decision at a time | P9-040/P9-060 |
| Validation recovery | 100% issue links land on owning decision; ≤2 navigations | P9-085 |
| Resume fidelity | 100% exact-decision restore | P9-086/P9-087 |
| GM review effort | median ≤10 min, zero raw-ID/JSON steps | P9-053 |
| Atomic commit reliability | 0 partial packages, 0 duplicates | P9-096 |
| Time to first encounter action | ≤5 min from approval, zero manual relinking | P9-097 |
| Accessibility | zero serious Axe violations, full keyboard scripts, 44×44 targets | P9-090 |
| Catalog scale | list ops p95 ≤100ms, validation p95 ≤250ms | P9-089 |
| Privacy | 0 cross-profile disclosures | P9-088/P9-093 |

Baseline note: the current manual journey has no comparable baseline because most steps happen outside any measurable workflow (GM memory, verbal review). The audit (P9-001) stands as the qualitative baseline.
