# Campaign onboarding policy matrix

- Matrix: `onboarding-campaign-policy-matrix-v1`
- Date: 2026-08-16
- Structured source: [`data/onboarding/campaign-policy-matrix.json`](../../data/onboarding/campaign-policy-matrix.json)
- Plan: P9-005

## Principle

Campaign variation is **explicit, versioned policy** (`CampaignOnboardingPolicy`, P9-011) — never hidden conditionals, GM prose, or code branches. The matrix freezes which creation rules may vary per campaign, the canonical constraint that bounds each knob, the policy field that will own it, and the shipped default.

Two deliberate non-knobs are recorded so their fixedness is auditable:

- **Trainer stat budget** — canonical `Level + 9`; house-ruled budgets are out of alpha scope.
- **Approval** — always explicit GM review in alpha; auto-approve does not exist.

## Knobs

| Knob | Area | Canonical bound | Shipped default |
| --- | --- | --- | --- |
| Starting Trainer level | trainer | 1..50 | 1 |
| Starting money | trainer | ≥0; canonical baseline via DATA-ONB-002 | canonical baseline |
| Feature/Edge source restrictions | trainer | canonical ID/tag lists | all permitted |
| Milestone collection (higher-level) | trainer | canonical milestone structure | during onboarding |
| Starter count | pokemon | 1..6 | 1 |
| Starter pool | pokemon | exact Pokédex row IDs | any-canonical |
| Starter level | pokemon | 1..100 + XP alignment | 5 (product default) |
| Move sources at creation | pokemon | canonical compatibility | level-up only |
| Starter held items | pokemon | canonical item custody | none |
| Caught-ball metadata | pokemon | items.json identity | standard ball |
| Starting Loyalty | pokemon | DATA-ONB-004 baseline, bounded | canonical baseline |
| Stage restriction | pokemon | pokedex stage data, fail closed | unrestricted |
| Trainer item package | package | canonical item identities | empty |
| Trainer equipment package | package | Plan 8 equipment authority | empty |
| Starter held-item package | package | canonical item custody | none |
| Unresolved-choice policy | workflow | hard rules never deferrable | all required resolved |
| Folder destinations | workflow | valid folder paths | `players/<profile>` |

## Versioning rules

1. Published policy versions are immutable; editing produces a new version (P9-023).
2. Every draft binds to exactly one policy version and never migrates silently.
3. Policy values that reference canonical entities store canonical IDs plus source fingerprints so a later data change is detectable, not silent.
4. Shipped defaults are product policy values, editable before publication; they are never presented as PTU authority.
5. Unknown policy schema versions fail closed (P9-011).
