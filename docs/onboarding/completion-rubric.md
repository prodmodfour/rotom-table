# Onboarding completion rubric

- Rubric: `onboarding-completion-rubric-v1`
- Date: 2026-08-16
- Structured source: [`data/onboarding/completion-rubric.json`](../../data/onboarding/completion-rubric.json)
- Plan: P9-007

## Rule states

Every creation rule row (from the P9-003/P9-004 inventories, extended by the P9-015 catalog) carries exactly one state:

| State | Meaning | Allowed at final closure? |
| --- | --- | --- |
| `complete` | Structured authority + server validation + guided UI + evidence + tests | yes |
| `guided` | Enforced and explained; part of authority is a catalog-bound app-owned derivation | yes, only with source fingerprint |
| `campaign-policy` | Deliberately variable; canonical bounds + versioned policy value | yes |
| `warning` | Validated, non-blocking, intentional table variation | yes, only if intentional |
| `blocked` | Missing/ambiguous structured authority (open DATA-ONB defect) | **no — zero permitted** |
| `not-applicable` | Structurally excluded for the branch | yes, only if derived structurally |

## Workflow branches

`default-level-1` (first playable slice, gate P9-060) → `multiple-starters` (P9-050) → `higher-level-start` (P9-092) → `existing-intake` (P9-070). A rule's state is tracked per branch where behavior differs.

## Acceptance predicates

Final acceptance (P9-091/P9-100) requires all of:

1. **No hidden mandatory step** — every legal-build requirement is an explicit guided decision with completion state.
2. **No unresolved blocker** — zero `blocked` rows, zero open DATA-ONB defects.
3. **No out-of-band repair** — no route to ready-for-play needs raw IDs, JSON, SQLite, or ad hoc sheet repair (product rule 15).
4. **No client-downgraded severity** — hard violations block everywhere; server re-checks at submit/approve (product rule 7).
5. **No orphan option** — every selectable option has a stable server-re-authorizable ID (product rule 6).
6. **No silent not-applicable** — branch exclusions are structural catalog conditions, not hidden UI.

The P9-091 coverage certifier consumes this rubric: coverage rows bind rule → state → evidence → tests, and the quality gate fails when a row regresses (P9-020).
