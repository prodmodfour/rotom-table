# Campaign Trainer choice attention

P8-086 detects unresolved Trainer Features, Classes, Edges, Skill Edges, rank milestones, milestone alternatives, and malformed build evidence. Detection is read-only. It never chooses a Class, Feature, Edge, Skill, Stat route, or prerequisite override.

## Canonical authority

`Trainer Advancement Choices` in `data/reference/rules.json` is the only runtime progression policy. `scripts/migrate_trainer_advancement_choices.py` installs it from the accepted, source-hash-bound review record `scripts/reviewed-data/trainer-advancement-choices.v1.json`. Book excerpts are provenance only and are never parsed at runtime.

The reviewed rule binds:

- four paid Features and one free Training Feature at Level 1, then one paid Feature at each odd Level from 3;
- four Edges at Level 1, one Edge at each even Level, and restricted bonus Skill Edges at Levels 2, 6, and 12;
- the four-Class-Feature limit;
- exact canonical Feature and Edge instance parsers, typed subchoices, ranks, and acquisition sources;
- the Level 5, 10, 20, 30, and 40 alternatives; and
- exact structured resolution fields. Freeform notes never resolve a choice.

The canonical migration follows the Pokémon advancement rule as a separate exact successor. Earlier per-record mechanics remain unchanged.

## Complete current-sheet detection

Projection requires an explicitly complete current sheet read, exact non-negative revisions, one campaign minute, unique sheet identities, and at most 10,000 sheets. Only Trainer sheets are considered.

Paid Feature counts come from ready canonical instances in `features`, `classes`, and legacy `orders` ownership collections. Feature, Edge, or GM grants and the free Training Feature do not consume paid entitlement. Ranked Features count their exact reviewed rank; non-ranked Features cannot claim a higher rank. Duplicate or unresolved instance identity, missing required typed choices, projection overflow, unsupported Training identity, and more than four Class Features fail closed.

Edge counts come from ready canonical Trainer Edge instances. The detector validates acquisition, rank, stable identity, and required choices. `bonusSkillEdges` is explicit structured evidence: it cannot exceed the reached Level thresholds or the current number of canonical Skill Edge instances. Missing expected bonus evidence remains actionable rather than being inferred from prose or a Skill label.

`remainingFeatures` and `remainingEdges`, when present, are bounded explicit pending counters. They may add work but cannot authorize an acquisition or suppress a canonical deficit.

## Milestone alternatives

For an Attack/Special Attack route, a milestone row must contain all three numeric fields: `stats`, `attack`, and `spAttack`. Attack plus Special Attack must equal the exact currently earned amount for that tier. Level 5 begins with two retroactive points and grows at Levels 6, 8, and 10; later Stat routes grow only at their reviewed scheduled even Levels. Partial, future, over-allocated, under-allocated, or stale rows are invalid. Exact selected milestone points extend P8-084's Trainer Stat budget, so unallocated points remain visible there.

General Feature and two-Edge alternatives require exact current canonical instances beyond baseline entitlement. A bounded assignment check covers every reached milestone. Missing evidence stays pending; contradictory evidence—such as both a Stat route and an extra Feature for the only reached tier—fails closed. A zero-immediate Stat route at Level 10, 20, 30, or 40 must still be represented by an explicit all-zero structured row. Notes resolve nothing.

Prerequisite planning beyond the existing canonical instance validators remains guided. The detector does not mine prerequisite prose, enumerate an unsafe partial option list, or silently choose the nearest legal build.

## Projection and privacy

One unresolved Trainer produces one `trainer-advancement` item with current sheet authority and an owner action to `/sheets/trainers/<slug>?attention=trainer-build`. Malformed authority is blocking; ordinary outstanding choices are normal. The internal detector distinguishes free Training, Feature/Class, Feature configuration, Edge, Edge configuration, Skill rank, and milestone work, while the attention item copies none of those private build details.

The item contains no Trainer name, Class, Feature, Edge, Skill, option, Stat amount, milestone route, note, prerequisite text, Profile evidence, operation ID, or automation provenance. The destination must reload current authority and provide bounded choices. P8-089 adds role/Profile-safe API and realtime projection; P8-090 renders the campaign continuation dashboard.
