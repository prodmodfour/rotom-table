# Pokémon Progression Redesign

_Last updated: 2026-07-29_

This document records the current design decisions for replacing PTU Pokémon level progression and Base Stat Relations, together with the associated change in play model. Deferred systems are identified explicitly but are not designed here.

## Goals

- Compress Pokémon levels from **1–100** to **1–20**.
- Remove Base Stat Relations and their associated bookkeeping.
- Make species, Nature, evolution, and vitamins determine a Pokémon's natural stat growth.
- Remove freely allocated level-up stat points.
- Let weaker Pokémon families level faster and stronger Pokémon families level slower.
- Make a meaningful level advantage improve survivability without making it an absolute immunity.
- Reframe play as a single- or multiplayer video game tabletop in which Pokémon, rather than Trainers, are the mechanical combat actors.
- Remove Trainer Classes, Features, Edges, Orders, and PTU Training rather than converting them.

## Play model and removed PTU subsystems

The game uses a **single- or multiplayer video game tabletop** interpretation of PTU. Trainers remain narrative and player-facing characters, but they do not participate in the combat action economy.

### Trainers in battle

- Trainers are not combat entities and are not interactable battle-map entities.
- Trainers do not enter initiative, receive turns, or take combat actions.
- Trainers cannot be selected as mechanical targets or otherwise participate as combatants.
- A Trainer may still have a visual representation on the battle map, but that representation has no mechanical presence.
- PTU Orders and the Trainer role as an Order-issuing entity are removed.
- Pokémon are the mechanical actors controlled during battle.

### Removed character-option systems

- Trainer Classes are removed wholesale.
- Trainer Features and Trainer Edges are removed wholesale.
- Pokémon Edges are removed wholesale.
- These systems are not being converted into the compressed progression system and will not receive one-for-one replacements.

### Training

PTU's Training system is removed. A new out-of-combat **Training** system will be designed in the future, but it will have no mechanical lineage or required compatibility with PTU Training. Its design is deferred and outside the scope of this document. None of the progression rules in this document assume benefits from that future system.

## Natural stats

For each stat, define its Growth Base:

```text
Growth Base
  = Species Base Stat
  + Nature adjustment
  + net Vitamin adjustment
```

The natural stat at a given level is:

```text
Raw Natural Stat
  = Growth Base × (1 + 0.1 × (Level − 1))

Usable Natural Stat
  = floor(Raw Natural Stat)
```

The exact fixed-point form is:

```text
Usable Natural Stat
  = floor(Growth Base × (Level + 9) / 10)
```

### Consequences

- At Level 1, the natural stat equals its Growth Base.
- Each level adds an exact hidden increment equal to `0.1 × Growth Base`.
- At Level 20, a natural stat is approximately `2.9 × Growth Base`.
- The usable value is rounded down, but fractional progress is retained internally.
- Fractional progress is derived from Growth Base and Level rather than stored as mutable floating-point state.
- There is no Added Stat Point budget and no trained stat allocation.

## Modifier behavior

### Nature

Nature modifies the Growth Base before multiplication. Its effect therefore scales retroactively with natural growth.

### Vitamins and stat suppressants

Net Vitamin adjustment is part of the Growth Base. Applying or removing one recalculates all natural growth at the Pokémon's current level, regardless of when it was applied.

### Removed Features and Edges

Features and Edges are removed, so they supply no stat bonuses and never enter the natural-growth multiplier. The future out-of-combat Training system is not assumed to modify natural growth; if its eventual design introduces any stat effects, those effects must define their interaction separately.

Other surviving non-multiplying bonuses are applied after natural growth.

## Max HP

The `HP Stat` is the usable, rounded-down natural HP stat:

```text
HP Stat
  = floor(HP Growth Base × (Level + 9) / 10)
```

Pokémon Max HP is:

```text
Max HP
  = 10 + Level + (3 × HP Stat)
```

The terms have distinct roles:

- `3 × HP Stat` supplies species-driven durability and includes retroactive Nature and vitamin growth.
- `Level` supplies universal combat hardiness, guarantees at least 1 Max HP of growth per level, and helps low-HP species benefit from faster leveling.
- `10` supplies the fixed starting buffer.

This formula preserves the representative nine-attack benchmark: a Level 15 target with HP Growth Base 8 has HP Stat 19 and 82 Max HP.

## Evolution and forms

- Evolution replaces the Species Base Stats.
- Nature and vitamins are reapplied to the evolved species.
- Natural stats are fully recalculated at the Pokémon's current level.
- No historical per-level stat-growth state is retained.
- Temporary forms may change the current natural-stat projection when they replace the effective species stats.
- Temporary forms do not change the Pokémon's experience-speed category.

### Evolution timing and other Pokémon-level gates

Every valid positive Pokémon-level threshold on the old 1–100 scale is compressed by the same five-to-one mapping:

```text
Compressed Level Gate
  = ceil(Old Level Gate / 5)
```

For example:

| Old gate | Compressed gate |
|---:|---:|
| 5 | 1 |
| 10 | 2 |
| 15 | 3 |
| 20 | 4 |
| 25 | 5 |
| 30 | 6 |
| 40 | 8 |
| 50 | 10 |
| 100 | 20 |

Additional policies:

- A zero, absent, or non-level evolution requirement remains non-level-gated; zero is not converted into a new Level 1 requirement.
- Item, move-knowledge, gender, loyalty, location, time, and other non-level evolution conditions remain unchanged.
- When a rule combines a level gate with another condition, only the level threshold is compressed.
- Inclusive and exclusive wording such as “at least,” “above,” or “below” is retained around the converted threshold.
- Level-range endpoints are converted independently.
- Move-learning schedules follow the dedicated move-progression rules below.
- Trainer-level gates are outside this Pokémon-level conversion.
- Invalid source thresholds outside the old Level 1–100 range must be corrected rather than converted or silently clamped. The current Gurdurr Pokédex entry's parsed `min_level: 250` is one such source-data defect.

## Experience-speed categories

Experience speed is family-wide and permanent.

The classification score is the evolutionary family's innate Base Stat Total:

```text
BST = HP + Attack + Defense + Special Attack + Special Defense + Speed
```

Only innate species Base Stats contribute to this score. Nature, vitamins, temporary forms, and other non-species modifiers do not affect it; the removed Feature, Edge, and PTU Training systems contribute nothing.

Families are divided by their reviewed BST percentile:

- Bottom third: **Fast**
- Middle third: **Normal**
- Top third: **Slow**

### Classification policies

- Use the highest innate BST among all of the family's final stable evolutionary branches to determine its category.
- Every member and branch of that family uses the resulting category, including weaker final branches. This prevents a stronger branch from receiving a faster curve because the family also contains a weaker option.
- Temporary forms and Mega Evolutions are not stable branches, do not enter this comparison, and do not change experience speed.
- Evolution and branch selection do not change an individual Pokémon's experience curve.
- Identical BSTs always receive the same category, even when a tie crosses a percentile boundary. The resulting groups therefore need not contain exactly one-third of families.
- Category assignments are frozen per ruleset version so adding Pokédex entries does not silently reclassify existing families.
- Regional families may be classified separately when their stable growth profiles materially differ.

## Experience curves

Normal progression uses a smoothed approximation of the current PTU experience curve while retaining approximately the same total campaign XP.

For Level `L`:

```text
r = (L − 1) / 19

NormalXP(L)
  = round(20,515 × (0.04r + 0.96r^2.4))

FastXP(L)
  = floor(0.8 × NormalXP(L))

SlowXP(L)
  = ceil(1.25 × NormalXP(L))
```

Fast and Slow therefore use reciprocal scale factors around Normal because `0.8 × 1.25 = 1`. They have different Level 20 totals rather than converging to one shared cap.

The frozen cumulative thresholds are:

| Level | Fast | Normal | Slow |
|---:|---:|---:|---:|
| 1 | 0 | 0 | 0 |
| 2 | 48 | 60 | 75 |
| 3 | 140 | 175 | 219 |
| 4 | 291 | 364 | 455 |
| 5 | 512 | 641 | 802 |
| 6 | 812 | 1,016 | 1,270 |
| 7 | 1,198 | 1,498 | 1,873 |
| 8 | 1,676 | 2,095 | 2,619 |
| 9 | 2,252 | 2,816 | 3,520 |
| 10 | 2,932 | 3,666 | 4,583 |
| 11 | 3,721 | 4,652 | 5,815 |
| 12 | 4,624 | 5,780 | 7,225 |
| 13 | 5,644 | 7,055 | 8,819 |
| 14 | 6,786 | 8,483 | 10,604 |
| 15 | 8,054 | 10,068 | 12,585 |
| 16 | 9,452 | 11,815 | 14,769 |
| 17 | 10,983 | 13,729 | 17,162 |
| 18 | 12,652 | 15,815 | 19,769 |
| 19 | 14,460 | 18,075 | 22,594 |
| 20 | 16,412 | 20,515 | 25,644 |

Consequences of the selected curves:

- Normal retains the old progression's approximate 20,500-XP campaign scale.
- Successive level costs increase smoothly without the old chart's abrupt breakpoints.
- Fast reaches Level 20 at 16,412 XP; Slow reaches it at 25,644 XP.
- At equal earned XP, the tiers ordinarily differ by one to three levels during the middle of progression.
- The level gap supplies both different natural-stat multipliers and directional Level DR.
- Once all tiers reach Level 20, experience speed no longer offsets the stronger natural stats of high-BST families.

## Level-up move progression

The target cadence is **one new level-up move at every Pokémon level from 1 through 20**.

- A species with exactly 20 level-up moves receives one move at each level.
- A species whose level-up move pool contains fewer than 20 moves is exempt from the every-level requirement. Its list is not padded merely to reach 20 moves.
- Short move pools preserve the shape of their existing 1–100 schedule, fitted to the compressed 1–20 scale:

```text
Compressed Move Level
  = max(1, ceil(Old Move Level / 5))
```

- This mapping preserves intentional early or late learning, gaps, and same-level move clusters in short pools. It does not stretch every species' final move to Level 20.
- The retained moves in a full 20-move pool preserve their existing relative order and are assigned one per level from Level 1 through Level 20.
- Pools containing more than 20 moves are rare and are accepted as exceptions rather than culled as part of this progression redesign. They retain their moves and use the same compressed-level mapping, which may place multiple moves at one level.
- Any broader thematic move-pool cull is a separate content-design effort and is not required by this progression redesign.

## Level-difference Damage Reduction

The selected Level Difference Damage Reduction multiplier is `1`.

For each qualifying damage instance:

```text
Level Difference
  = max(0, Defender Level − Attacker Level)

Level DR
  = Level Difference
```

Therefore:

- A higher-level defender receives Damage Reduction equal to the positive level difference.
- No Level DR applies when both combatants have the same level.
- No Level DR applies when the attacker has the higher level.

Level Difference DR behaves exactly like ordinary PTU Damage Reduction in every respect:

- It is added to all other applicable Damage Reduction unless a specific source prohibits stacking.
- It is subtracted after the relevant Defense or Special Defense stat and before type effectiveness.
- A successful nonimmune attack still deals at least 1 damage.
- Effects that ignore, reduce, or penetrate ordinary Damage Reduction interact identically with Level Difference DR.
- Double Strike and Five Strike first consolidate their hits into one final Damage Base, so Level Difference DR is subtracted once from the resulting damage calculation.
- Critical-hit damage is added before defenses, and Level Difference DR is subtracted once from the combined critical damage.
- Genuinely separate attacks or damage resolutions each apply Level Difference DR separately.
- Area attacks apply one shared damage roll, but each target subtracts its own Level Difference DR once.
- Effects that say a target loses Hit Points or set its Hit Points directly are not damage and bypass Level Difference DR, just as they bypass ordinary Damage Reduction. This includes standard Burn, Poison, Vortex, recoil, Counter, Mirror Coat, and Metal Burst HP loss.
- For recurring and reflected effects, the effect's normal PTU wording controls: ordinary Physical or Special damage uses Level Difference DR, while Hit Point loss does not.

PTU's term `Direct Damage` means ordinary damage dealt by Physical or Special Moves; it is therefore eligible for Level Difference DR unless an effect explicitly ignores Damage Reduction. It should not be confused with effects that directly remove Hit Points.

## Selected combined ruleset

```text
Level range:                 1–20
Natural growth per level:    0.1 × Growth Base per stat
Usable-stat rounding:        floor, with exact fractional progress retained
Trained level-up stats:      none
Max HP:                      10 + Level + (3 × HP Stat)
Experience speed:            family-wide BST terciles using ×0.8 / ×1 / ×1.25 XP curves
Level Difference DR:         ordinary PTU DR equal to max(0, defender level − attacker level)
Trainer combat role:         none; Pokémon are the mechanical battle actors
Removed PTU systems:         Classes, Features, Edges, Orders, and Training
```

## Balance benchmark

For the representative benchmark discussed during design:

- four relevant attacks occur per round;
- the target is five compressed levels above the attackers;
- attacks hit and use neutral effectiveness;
- no critical hits, healing, or unusual action-economy effects intervene;
- the target is defeated after approximately nine attacks.

Nine attacks correspond to **two complete rounds plus one additional attack** for a four-attacker party. A five-level difference in the compressed system represents approximately a 25-level difference in the old system.

This nine-attack result is the current durability benchmark for a major level-disadvantage encounter.

## Deferred work outside this redesign

The future out-of-combat Training system remains to be designed in a separate effort. It is not a replacement implementation of PTU Training and is not an unresolved dependency of the progression rules finalized here.
