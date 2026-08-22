# Pokémon Contest player and GM guide

## Prepare

Open a Pokémon sheet or the Contest Workshop preparation panel.

- **Contest dice** derive from current combat stats, capped by canonical preparation rules. Combat stages do not count.
- **Poffins** permanently add one die to a selected Contest stat. The server verifies level allowance, Grace, exact inventory custody, and idempotency before consuming one item.
- **Groomer** records same-campaign-day care only when the Trainer has Groomer and a Groomer’s Kit.
- **Flexible Preparations** temporarily moves one or two Poffin-derived dice for the current campaign day.
- **Poffin Mixer** consumes one reviewed berry and $500 to make two Poffins.
- **Contest Trends** crafts Contest Accessory ($750), Contest Fashion ($500), or Fancy Clothes ($2500); configure/equip the resulting item through ordinary inventory controls.
- A GM can bind a canonical Contest type/effect to a Feature-created Move. Unbound custom Moves fail closed.

The sheet lists each die’s source and lifetime Poffin use. Legacy free-form `contestStats` text is description only.

## Create and enroll

The GM opens **Contests** from campaign navigation, creates a hall activity, and chooses:

- Standard, Supercontest, Festival, or Rotation;
- fixed Contest type where the variant uses one;
- significance multiplier, ribbon flag, and a declared prize package.

Enroll three through five unique Trainers and Pokémon. A profile controller must own the enrolled Trainer and every Pokémon. Rotation teams contain one distinct Pokémon per round and use the canonical shared team-dice cap.

A prize must be explicitly declared—even an empty prize—before settlement preview.

## Introduction

Each controller chooses Charm, Command, Guile, Intimidate, or Intuition. The server reads the Trainer’s current rank and rolls all base and bonus dice. Grace permits the Skill roll to generate any stat. Groomer follows that Skill-roll stat; Fancy Clothes and Playing God use their configured stats; Contest Accessory and Juggling Show each expose an independent stat choice for their own bonus roll. Ugly applies to every Introduction die. Accepted rolls generate Contest dice, while a Standard Contest’s matching Appeal bonus follows the selected Skill’s canonical mapped stat. Source-level roll evidence stays owner/GM-only; aggregate acceptance and letters are public. Ties use journaled server coin rolls.

The GM may restart introductions. Previous dice evidence remains immutable while its generated contribution is rolled back exactly.

## Performance

The stage view shows canonical position, adjacency, center of attention, round, turn, Appeal, Fumble, score, and Voltage. The active controller:

1. selects an offered real Move;
2. reviews type/effect and unavailable reasons;
3. spends at most three remaining Contest dice;
4. reviews the assembled contributors;
5. submits once to server authority.

Scores do not move optimistically. Accepted results show ordered dice, contributors, score/fumble deltas, and Voltage. Contest appeals never spend battle Move frequencies.

If Coordinator, Style Flourish, or Contest Fashion can reroll an accepted appeal, turn advancement pauses. Use the offered reroll or choose **Keep result and continue**. Coordinator rerolls the entire Appeal Roll; Style Flourish and Contest Fashion reroll eligible ones.

## Variants

- **Standard:** fixed type and normal matching introduction bonus.
- **Supercontest:** every round’s type comes from a journaled d6; six rerolls within a bounded server budget.
- **Festival:** lowest performers leave between heats; Appeal carries, Fumble resets, and the final three settle once for the whole event.
- **Rotation:** each team preselects a distinct performer per round, keeps each Pokémon’s prepared pools plus shared Introduction dice, may spend at most twice the team count across the whole Contest, and splits earned experience in roster order.

Trainer Participant and Battle Contest are intentionally not selectable in Plan 10.

## GM controls and settlement

The GM can pause/resume, apply bounded Appeal/Fumble/Voltage/pool corrections, reassign a controller to an owning profile, or cancel. Corrections create receipts and never edit dice journals. Score corrections during settlement recompute placements and invalidate a stale preview.

Settlement preview lists placement, experience, ribbon, money, and items. Commit is one SQLite transaction. On success, Trainer Contest history, Pokémon experience, ribbons, money, and inventory update together. Level-up and move/evolution choices are detected by ordinary campaign-attention workflows.

If the outcome is uncertain, use **Retry exact command**. Do not submit a new operation ID until the original outcome is known.