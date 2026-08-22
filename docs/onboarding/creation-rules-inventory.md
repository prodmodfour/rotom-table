# Canonical creation rules inventory — Trainer and starter Pokémon

- Inventories: `onboarding-trainer-creation-rules-v1`, `onboarding-pokemon-creation-rules-v1`
- Baseline commit: `ec672287`
- Date: 2026-08-16
- Structured sources:
  - [`data/onboarding/trainer-creation-rules-inventory.json`](../../data/onboarding/trainer-creation-rules-inventory.json)
  - [`data/onboarding/pokemon-creation-rules-inventory.json`](../../data/onboarding/pokemon-creation-rules-inventory.json)
- Plan: P9-003, P9-004

## Classification

Every starting decision is classified by its **authority kind**:

- `structured-reference` — app-owned structured data states the rule today (`data/reference/*.json`, automation catalogs under `data/feature-automation/`, `data/edge-automation/`).
- `code-derived` — an app-owned runtime formula or constant is the working authority (existing sheet derivations). The creation catalog (P9-015) binds these as derived contributions; they are not re-derived from prose.
- `campaign-policy` — canonically variable per campaign; owned by `CampaignOnboardingPolicy` (P9-011) with canonical identity for every referenced entity.
- `absent` — no structured authority exists; recorded as an explicit data defect that must be repaired through a reviewed, source-hash-bound migration **before** the owning runtime ticket. Runtime never interprets documentary prose.

## Trainer decisions (18)

| Decision | Authority | Source of truth |
| --- | --- | --- |
| Starting level | campaign-policy | policy + max level 50 (`trainerAdvancementChoiceMechanics`) |
| Base stats 10/5 | structured | `Stat Point Advancement` |
| Stat budget Level+9 | structured | `statPointFormulas.trainerLevelUp` |
| Max HP formula | code-derived | `computeTrainerFormulaMaxHp` |
| 17 skills + rank ladder | code-derived | `TRAINER_SKILLS`, `SKILL_RANK_TO_VALUE` |
| Skill rank caps by level | structured | `skillRankMaximums` (L1 Novice, background→Adept) |
| **Background composition** | **absent** | **DATA-ONB-001** |
| Free Training Feature | structured | `featureEntitlements.freeTraining*` |
| Feature slots (4 @ L1) | structured | `featureEntitlements` |
| Edge slots (4 @ L1) | structured | `edgeEntitlements` |
| Feature identities/prereqs | structured | `features.json` + 444 hash-bound expressions |
| Edge identities/prereqs | structured | `edges.json` + typed expressions |
| Classes + branches | structured | Class tag + `class-directory.json` |
| AP pool 5+⌊L/5⌋ | code-derived | `trainerDerived` |
| **Starting money** | **absent** | **DATA-ONB-002** |
| Starting inventory/equipment | campaign-policy | `items.json` identity + Plan 8 equipment authority |
| Capability defaults | code-derived | `trainerDerived` + `Basic Capabilities` |
| Milestone choices (L5+) | structured | `milestoneChoices` (higher-level starts) |

## Starter Pokémon decisions (18)

| Decision | Authority | Source of truth |
| --- | --- | --- |
| Species eligibility (pool) | campaign-policy | policy referencing exact Pokédex rows |
| Starting level | campaign-policy | policy + experience chart bounds |
| Forms | structured (+ defect note) | separate Pokédex rows; **DATA-ONB-003** freezes row identity |
| Base stats | structured | `pokedex.base_stats` |
| Added stats Level+10 | structured | `statPointFormulas.pokemonAdded` |
| Base Relations ordering | code-derived | rule text + existing violation detection |
| Nature | code-derived | `PTU_NATURES` (37 natures) |
| Ability (Basic @ L1) | structured | tiered species abilities + `abilityMilestones` |
| Starting Moves | structured | `level_up_moves` + `moveLearning` mechanics |
| Skills | structured | `pokedex.skills` |
| Capabilities/size/movement | structured | `pokedex.capabilities` + `capabilities.json` |
| Gender | structured | `male_pct`/`female_pct`/`genderless` |
| **Starting Loyalty** | **absent** | **DATA-ONB-004** |
| Tutor Points 1+⌊L/5⌋ | code-derived | `computePokemonTutorPointsEarned` |
| Held items | campaign-policy | policy + Plan 8 item authority |
| Team placement / limit 6 | code-derived | `TRAINER_TEAM_LIMIT` (client-only today; server enforcement owed) |
| Ownership provenance | code-derived | species-acquisition machinery; needs explicit onboarding source |
| Experience alignment | structured | `pokemonExperienceChart.json` |

## Data defects

| ID | Missing authority | Repair gate |
| --- | --- | --- |
| DATA-ONB-001 | Background composition (Adept/Novice/Pathetic pick counts) | before P9-034 |
| DATA-ONB-002 | Default starting money baseline | before P9-038 |
| DATA-ONB-003 | Starter pools must bind exact Pokédex row identity (form rows are rows, not variants) | catalog compilation P9-015 |
| DATA-ONB-004 | Default starting Loyalty | before P9-047 |

Each repair is a reviewed addition to `data/reference/rules.json` (or catalog freeze) bound to documentary provenance paths; runtime consumes only the structured result.

## Decisions that rely on GM memory or post-creation repair today

- Which species/forms/levels are legal starters (pool), how many starters, and any TM/tutor allowance at creation.
- Starting money and standard kit contents.
- Loyalty and caught-ball conventions.
- Whether higher-level starts collect milestone choices immediately or defer them.
- All of the above become explicit versioned policy in P9-005/P9-011; none may remain hidden conditionals.
