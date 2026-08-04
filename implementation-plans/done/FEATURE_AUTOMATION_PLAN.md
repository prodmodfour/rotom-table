# Feature Automation Implementation Plan

`PLAN_STATUS: DONE`

`CURRENT_TICKET: NONE`

`BLOCKED_BY: NONE`

## Goal

Implement complete, server-authoritative automation for every canonical Trainer Feature in `data/reference/features.json`, including General Features, Class and Branch Features, Orders, Training Features, Stratagems, Weapon Features, Ranked and Gift Features, AP Bind/Drain mechanics, triggered effects, passive providers, permanent grants, tutoring, capture, crafting, research, social, travel, and other campaign operations.

Features are the broadest rules catalog in this sequence. They may define character-building structure, grant other rules, modify a Trainer, command or train Pokémon, create actions, subscribe to encounter events, or operate over hours and days. The implementation must cover all of those roles without reducing “Feature automation” to an oversized button menu.

This file is the durable implementation ledger for Feature automation. It begins only after Capabilities and both Edge families are complete, so Feature grants and dependencies have stable authoritative owners.

## Canonical scope and baseline

- Canonical source: `data/reference/features.json`
- Current Git blob SHA at plan creation: `4e0b22c15ecea225b061086f403bca49658608b1`
- Current parser: `ptu-data/parse_features_edges.py`
- Current source hierarchy includes errata, Trainer Classes, and Skills/Edges/Features source material.
- Current reference shape includes name, tags, prerequisites, frequency, trigger, target, condition, effect, and optional `className`.
- Current sheet owner: `TrainerSheet.features`, with separate `TrainerSheet.classes`, `orders`, `trainingFeature`, choices, notes, and frequency overrides.
- Current parser output visibly requires a full source-boundary and class-context audit before it can be frozen; merged effects, misplaced class ownership, errata transitions, ranked clauses, and inline section text must fail closed rather than becoming mechanics.
- Exact count, SHA-256, canonical order, class/branch directory, tag taxonomy, source-byte hashes, duplicate policy, and parser adjudications must be frozen by FA-001 through FA-004.
- Existing Orders, training, class choices, sheet derivations, capture actions, item flows, Move/Ability helpers, and exact-name hooks are migration inputs only.
- Every source row remains in scope even when it is primarily character-building, narrative, out-of-combat, GM-adjudicated, or grants another rule rather than directly changing encounter state.

## Non-negotiable rules

1. **Every frozen Feature row is in scope.** General, Class, Branch, Orders, Training, Stratagem, Weapon, Ranked, Gift, crafting, research, social, and campaign Features all require an authoritative implementation role.
2. **No runtime prose interpretation.** Canonical text becomes strict specs, grants, providers, choices, subscriptions, campaign operations, or bounded handlers.
3. **Feature taxonomy is not UI taxonomy.** Tags and class ownership drive rules and provenance; they do not mandate separate permanent panels.
4. **Character-building and live mechanics are distinct.** Class membership, prerequisites, ranks, choices, and grants are validated separately from encounter declarations.
5. **One effective Feature projection.** Sheet instances, classes, ranks, grants, replacement, suppression, retraining, and temporary effects resolve deterministically.
6. **AP is authoritative.** Max, current, spent, bound, drained, temporary, payment timing, release, rest, retry, and nested costs are server-owned.
7. **Orders and Training validate relationships.** Trainer control, team membership, command range, targets, active training, scenes, and linked profiles are derived from current authority.
8. **Permanent grants retain provenance.** Moves, Abilities, Capabilities, Edges, Features, skills, stats, and recipes can be reconciled under retraining or source loss.
9. **Canonical GM discretion is typed.** The server constrains legal judgement shape and persistence; the authorised GM supplies only the choice the rule delegates.
10. **Campaign operations are first-class.** Tutoring, crafting, research, camp, medical care, travel, social, contest, and downtime effects use authoritative resources and lifecycle.
11. **Atomicity and exact retry apply.** Multi-sheet, team, inventory, shop, campaign, and encounter writes commit atomically or through durable sagas.
12. **Privacy is role- and target-aware.** Hidden builds, private Features, chosen specialisations, eligible recipients, research results, and GM overrides are projected safely.
13. **Generic presentation only.** Actions, passives, contextual affordances, choices, reasons, explanations, pending responses, and accepted outcomes use the shared automation contract.
14. **Interaction honesty.** Base Feature completion and interactions with Moves, Abilities, Capabilities, Edges, Items, conditions, terrain, capture, and campaign systems are certified separately.
15. **No hidden manual debt.** A complicated Feature may use a typed adjudication or durable workflow, but a “complete” manifest row cannot rely on prose-only execution.

## Semantic completion contract

A Feature row may be marked `complete` only when all applicable clauses satisfy the following:

- canonical identity, tags, class/branch ownership, ranks, repeatability, prerequisites, choices, frequency, action type, AP cost, trigger, target, condition, duration, reset, and source provenance are encoded;
- the Feature instance stores stable typed choices for type, stat, skill, move, ability, edge, feature, class branch, weapon, recipe, Pokémon, or other canonical selections;
- acquisition and class progression validation explain eligibility and retain explicit GM overrides without rewriting source rules;
- passive and static effects automatically participate in every owning query and do not become invocable actions;
- activated, Priority, Interrupt, Reaction, Orders, and contextual actions validate effective ownership, AP/frequency/action resources, targets, relationships, range, geometry, and prerequisites on the server;
- trigger subscriptions consume typed accepted events at exact timing checkpoints and are deterministic under nesting;
- Orders, Training, team, and Pokémon-targeted effects validate roster/profile control, current map placement, side, willingness, command range, and scene state;
- permanent grants and replacements are idempotent, provenance-bound, and reconciled under retraining or source loss;
- campaign operations validate time, location, tools, money, inventory, recipes, skill checks, targets, and lasting state;
- all randomness and checks are server-owned, bounded, injected for tests, and retained in a replay-safe ledger;
- all consulted map, sheet, group inventory, shop, campaign, reference, history, and object revisions join the read set;
- all writes commit atomically or through an explicit durable pending/adjudication saga;
- reconnect, exact retry, stale conflicts, pass, cancellation, expiry, abandonment, recovery, rest, retraining, and source loss are tested where applicable;
- executable scenarios cover every branch, rank, target variation, cap, prevention, no-op, choice, lifecycle, and direct interaction required by the Feature’s own text;
- the semantic manifest points to reviewed runtime/hash/source evidence and has no blocker, limitation, manual step, or hidden interaction exclusion;
- generic public, owner, GM, and diagnostic presentation is downstream of accepted mechanics.

## Target architecture

```text
canonical Feature catalog
  -> repaired frozen source + class/tag directory
  -> strict Feature semantic manifest
  -> typed FeatureInstanceData and class progression state
  -> effective Feature projection
  -> passive provider / grant / event subscription / FeatureSpec v1 action
  -> authoritative Feature context and shared mechanical kernel
  -> complete read-set state plan
  -> atomic commit or durable pending/campaign saga
  -> generic accepted presentation and contribution explanation
```

Feature ownership layers:

```text
Trainer class and feature sheet instances
  + ranked and repeated instances
  + permanent grants from classes/features/edges/items
  + temporary encounter Feature effects
  - replacements, suppression, retraining, and source loss
  = authoritative effective Feature view
```

## Feature family policy

The frozen manifest assigns one or more roles while preserving source tags:

- `class-anchor`
- `branch-anchor`
- `ranked-progression`
- `passive-provider`
- `permanent-grant`
- `activated-action`
- `orders-action`
- `training-operation`
- `stratagem`
- `weapon-provider`
- `triggered-automatic`
- `triggered-optional`
- `interrupt-reaction`
- `contextual-affordance`
- `campaign-operation`
- `crafting-or-research`
- `gm-adjudicated`
- `classification-only`

A Feature can combine roles. Tags alone never substitute for reviewed semantics.

## AP and frequency policy

- AP state remains a versioned Trainer-sheet resource with explicit max, available, spent, bound, drained, and temporary components.
- Payment phases are source-reviewed: declaration, after target choice, after trigger acceptance, after success, after rest, or other exact checkpoints.
- Bound AP has a typed owner, effect identity, release conditions, and source-loss policy.
- Drained AP has a typed recovery boundary and cannot be restored by browser edits during live play.
- Temporary AP has an expiry and cannot pay costs that canonical rules disallow.
- Feature usage supports At-Will, EOT, Scene xN, Daily xN, one-time, per-target, per-round, per-turn, and reviewed special frequencies.
- Exact retries reuse payment and usage evidence.

## Build and class progression policy

- Class, Branch, Feature, and rank prerequisites use a strict expression model.
- The normal GM sheet editor remains authorable but stores explicit override provenance for unmet prerequisites.
- Class anchors establish class identity; Branch selections use stable specialisation data, not display-name suffixes.
- Ranked Features use one canonical instance with rank state unless source semantics require independent instances.
- Dependent Features and permanent grants are enumerated before retraining or removal.
- Character-building validation never becomes a hidden runtime prerequisite parser.

## Plan update protocol

- Ticket states are `TODO`, `IN_PROGRESS`, `DONE`, or `BLOCKED`.
- `CURRENT_TICKET` names the lowest-numbered active unfinished ticket.
- Only one ticket is `IN_PROGRESS` unless a decision-log entry permits safe parallel work.
- Mark a ticket `DONE` only after focused tests and all applicable Feature checkers pass.
- FA-006 must generate exact nonempty class-aware cohort rosters for FA-070 through FA-099 before cohort implementation.
- If the frozen count requires additional cohort tickets, insert them before FA-100 rather than increasing cohort size beyond the reviewed limit.
- New reusable machinery belongs to the earliest unfinished owning ticket; add a ticket before implementing out-of-plan semantics.
- Update progress from executable manifest reports after every cohort.
- Set `PLAN_STATUS: DONE` only after every frozen row and interaction is certified, legacy production execution is retired, and `scripts/quality-gate.sh` passes.

## Progress snapshot

- Plan tickets: **110 DONE / 110 total**
- Frozen canonical inventory: **444 Features; SHA-256 `27d0f2bee4db96ebfb0c431cce9ea5222fe3d2d9fe9ead32507c46b51a9d77c4`**
- Frozen class/branch directory: **40 class families and 40 class anchors**
- Complete Feature rows: **444**
- Assisted rows: **0**
- Blocked/unimplemented rows: **0**
- Interaction status: **certified across Move, Maneuver, Ability, Capability, Edge, Item, condition, terrain, capture, and campaign domains**
- Production runtime: **strict typed projection, providers, grants, event routing, AP/frequency settlement, state plans, and campaign workflows**
- Blocking dependency: **none**

## Tickets

### Phase 1 — Source repair, catalog governance, and honest coverage

- [x] **FA-001 — Freeze the canonical Feature inventory and SHA-256** — `DONE`
- [x] **FA-002 — Freeze the class, branch, tag, rank, and source directory** — `DONE`
- [x] **FA-003 — Audit parser boundaries, class context, merged prose, and errata precedence** — `DONE`
- [x] **FA-004 — Add source-hash-bound adjudications for every catalog defect** — `DONE`
- [x] **FA-005 — Define the Feature semantic manifest and completion schema** — `DONE`
- [x] **FA-006 — Add deterministic class-aware manifest and cohort seeders** — `DONE`
  - Create nonempty cohorts of at most 16 rows, keep class families together where practical, and write exact names into FA-070 through FA-099.
- [x] **FA-007 — Define Feature requirement, evidence, dependency, and interaction catalogs** — `DONE`
- [x] **FA-008 — Add coverage, completeness, link, source, budget, and plan checks** — `DONE`
- [x] **FA-009 — Record the Feature runtime ADR, threat model, contributor guide, and baseline audit** — `DONE`

### Phase 2 — Feature identities, instances, classes, choices, and prerequisites

- [x] **FA-010 — Define canonical Feature IDs, aliases, versions, and source tags** — `DONE`
- [x] **FA-011 — Define strict `FeatureInstanceData`** — `DONE`
- [x] **FA-012 — Define class and branch instance state** — `DONE`
- [x] **FA-013 — Define ranked, repeatable, Gift, and nested-choice instances** — `DONE`
- [x] **FA-014 — Replace name suffixes, notes, and ad hoc fields with typed choices** — `DONE`
- [x] **FA-015 — Build the complete Feature prerequisite expression model** — `DONE`
  - Cover level, skills, stats, classes, branches, Features, Edges, Capabilities, Moves, Abilities, items, tutor points, milestones, and logical alternatives.
- [x] **FA-016 — Add authoritative eligibility and progression explanations** — `DONE`
- [x] **FA-017 — Add GM override records and authorization** — `DONE`
- [x] **FA-018 — Add class/Feature add, rank, branch, retrain, replace, and remove workflows** — `DONE`
- [x] **FA-019 — Add migration, round-trip, dependency, and malformed-instance tests** — `DONE`

### Phase 3 — Effective projection, FeatureSpec runtime, AP, and state planning

- [x] **FA-020 — Define deterministic effective Feature projection** — `DONE`
- [x] **FA-021 — Define strict `FeatureSpec v1`** — `DONE`
- [x] **FA-022 — Add spec normalization, validation, hashing, registry, and pure handlers** — `DONE`
- [x] **FA-023 — Build immutable authoritative Feature context** — `DONE`
- [x] **FA-024 — Add Feature trace, roll ledger, causal ancestry, and budgets** — `DONE`
- [x] **FA-025 — Add complete read-set and atomic state-plan integration** — `DONE`
- [x] **FA-026 — Rebuild AP payment, Bind, Drain, temporary AP, and release semantics** — `DONE`
- [x] **FA-027 — Add Feature frequency, cooldown, once, and lifecycle ledgers** — `DONE`
- [x] **FA-028 — Add durable Feature choices, reactions, adjudications, and campaign sagas** — `DONE`
- [x] **FA-029 — Add restart, backup, export, exact retry, abandonment, and recovery** — `DONE`

### Phase 4 — Passive providers, permanent grants, and derived Trainer mechanics

- [x] **FA-030 — Complete stat, HP, Evasion, initiative, Damage Reduction, and Combat Stage providers** — `DONE`
- [x] **FA-031 — Complete skill rank, skill bonus, substitution, category, and assisted-check providers** — `DONE`
- [x] **FA-032 — Complete movement, capability, size, reach, weapon, and equipment providers** — `DONE`
- [x] **FA-033 — Complete Accuracy, damage, Damage Base, critical, type, STAB, and immunity providers** — `DONE`
- [x] **FA-034 — Complete condition, save, cure, injury, healing, temporary HP, and rest providers** — `DONE`
- [x] **FA-035 — Complete Move, Maneuver, Ability, Capability, Edge, and Feature grants** — `DONE`
- [x] **FA-036 — Complete move-list replacement, tutoring, connection, frequency, and usage changes** — `DONE`
- [x] **FA-037 — Complete inventory, money, item, equipment, recipe, and held-item providers** — `DONE`
- [x] **FA-038 — Add provenance-bound grant reconciliation and source-loss policy** — `DONE`
- [x] **FA-039 — Add ordered contribution explanations and provider property tests** — `DONE`

### Phase 5 — Orders, Training, team control, and Pokémon-targeted Features

- [x] **FA-040 — Define authoritative Orders declarations and target relationships** — `DONE`
- [x] **FA-041 — Complete normal, Priority, Interrupt, and Reaction Orders timing** — `DONE`
- [x] **FA-042 — Complete Training Feature application, replacement, and Extended Rest lifecycle** — `DONE`
- [x] **FA-043 — Complete Trainer-to-Pokémon range, command, side, willingness, and roster queries** — `DONE`
- [x] **FA-044 — Complete team, active party, boxed Pokémon, send-out, recall, and switch interactions** — `DONE`
- [x] **FA-045 — Complete trainer action sharing, Pokémon action modification, and nested execution** — `DONE`
- [x] **FA-046 — Complete marks, cheered/trained states, auras, side effects, and scene resources** — `DONE`
- [x] **FA-047 — Complete Experience, Tutor Point, loyalty, inheritance, and training operations** — `DONE`
- [x] **FA-048 — Add multi-Trainer, competing Orders, and ownership-transfer semantics** — `DONE`
- [x] **FA-049 — Add team-scale atomicity, privacy, retry, and multi-client tests** — `DONE`

### Phase 6 — Trigger routing, combat actions, Stratagems, and Weapon Features

- [x] **FA-050 — Add typed Feature event subscriptions and deterministic ordering** — `DONE`
- [x] **FA-051 — Complete declaration, hit, miss, critical, damage, contact, and effectiveness triggers** — `DONE`
- [x] **FA-052 — Complete HP, injury, condition, stage, save, faint, and recovery triggers** — `DONE`
- [x] **FA-053 — Complete movement, adjacency, interception, terrain, hazard, and zone triggers** — `DONE`
- [x] **FA-054 — Complete item, capture, switch, initiative, turn, round, scene, and rest triggers** — `DONE`
- [x] **FA-055 — Complete activated combat Features and authoritative targeting** — `DONE`
- [x] **FA-056 — Complete Stratagem binding, ownership, activation, and cleanup** — `DONE`
- [x] **FA-057 — Complete Weapon Feature moves, slots, handedness, disarm, and equipment state** — `DONE`
- [x] **FA-058 — Add nested trigger cycle prevention, priority, and causal budgets** — `DONE`
- [x] **FA-059 — Add durable optional triggers, pass, force-pass, expiry, and GM recovery** — `DONE`

### Phase 7 — Capture, items, crafting, research, social, and campaign operations

- [x] **FA-060 — Complete Capture Feature rolls, modifiers, stacks, throws, and species-family history** — `DONE`
- [x] **FA-061 — Complete Restorative, medical, clinic, injury, and care workflows** — `DONE`
- [x] **FA-062 — Complete crafting, scrap, recipes, tools, Apricorn, food, and equipment workflows** — `DONE`
- [x] **FA-063 — Complete research, Pokédex, identification, fossil, technology, and education workflows** — `DONE`
- [x] **FA-064 — Complete camp, travel, weather, wilderness, scouting, and environment workflows** — `DONE`
- [x] **FA-065 — Complete social, disposition, charm, intimidation, command, and information workflows** — `DONE`
- [x] **FA-066 — Complete contests, fashion, performance, beauty, and non-combat scene workflows** — `DONE`
- [x] **FA-067 — Complete extended-time, daily, weekly, one-time, and campaign lifecycle state** — `DONE`
- [x] **FA-068 — Add typed GM adjudication for open-ended canonical clauses** — `DONE`
- [x] **FA-069 — Add campaign-operation atomicity, audit, rollback, and recovery tests** — `DONE`

### Phase 8 — Canonical Feature cohorts

Each cohort is generated by FA-006 from the frozen catalog. Cohorts contain at most 16 rows, keep a class family together where that does not exceed the limit, and otherwise follow canonical identity order. Empty slots are prohibited; if fewer than 30 cohorts are required, unused tickets are removed before this phase starts. If more are required, additional tickets are inserted before FA-100.

- [x] **FA-070 — Canonical Feature cohort 01** — `DONE`
  - Frozen roster: Cheerleader, Moment of Action, Cheers, Inspirational Support, Bring It On!, Go, Fight, Win!, Keep Fighting!, Medic, Front Line Healer, Medical Techniques, I’m a Doctor, Proper Care, Stay With Us!, Field Clinic, Nurse
- [x] **FA-071 — Canonical Feature cohort 02** — `DONE`
  - Frozen roster: Affliction Techniques, Gotta Catch ‘Em All, Mixed Power, Incandescence, Ace Trainer, Perseverance, Elite Trainer, Critical Moment, Top Percentage, Signature Technique, Champ in the Making, Capture Specialist, Advanced Capture Techniques, Captured Momentum, Catch Combo
- [x] **FA-072 — Canonical Feature cohort 03** — `DONE`
  - Frozen roster: False Strike, Relentless Pursuit, Commander, Mobilize, Leadership, Battle Conductor, Complex Orders, Tip the Scales, Scheme Twist, Coordinator, Decisive Director, Adaptable Performance, Flexible Preparations, Innovation, Nuanced Performance
- [x] **FA-073 — Canonical Feature cohort 04** — `DONE`
  - Frozen roster: Reliable Performance, Hobbyist, Dilettante, Dabbler, Look and Learn, Mentor, Lessons, Expand Horizons, Guidance, Move Tutor, Egg Tutor, Lifelong Learning, Changing Viewpoints, Empowered Development, Corrective Learning
- [x] **FA-074 — Canonical Feature cohort 05** — `DONE`
  - Frozen roster: Versatile Teachings, Cheer Brigade, Gleeful Interference, Duelist, Expend Momentum, Effective Methods, Directed Focus, Type Methodology, Duelist’s Manual, Seize The Moment, Enduring Soul, Staying Power, Shrug Off, Awareness, Resilience
- [x] **FA-075 — Canonical Feature cohort 06** — `DONE`
  - Frozen roster: Not Yet!, Vim and Vigor, Juggler, Bounce Shot, Juggling Show, Round Trip, Tag In, Emergency Release, First Blood, Rider, Ramming Speed, Conqueror’s March, Ride as One, Lean In, Cavalier’s Reprisal
- [x] **FA-076 — Canonical Feature cohort 07** — `DONE`
  - Frozen roster: Overrun, Taskmaster, Quick Healing, Savage Strike, Strike of the Whip, Pain Resistance, Press On!, Desperate Strike, Deadly Gambit, Trickster, Bag of Tricks, Stacked Deck, Flourish, Encore Performance, Sleight
- [x] **FA-077 — Canonical Feature cohort 08** — `DONE`
  - Frozen roster: Stat Ace, Focus, Stat Link, Stat Training, Stat Maneuver, Stat Mastery, Stat Embodiment, Stat Stratagem, Style Flourish, Style Entrainment, Beautiful Ballet, Fabulous Max, Enticing Beauty, Style Expert, Cool Conduct
- [x] **FA-078 — Canonical Feature cohort 09** — `DONE`
  - Frozen roster: Rule of Cool, Action Hero Stunt, Cute Cuddle, Gleeful Steps, Let’s Be Friends!, Smart Scheme, Calculated Assault, Learn From Your Mistakes, Tough Tumble, Macho Charge, Endurance, Type Ace, Type Refresh, Move Sync, Insectoid Utility
- [x] **FA-079 — Canonical Feature cohort 10** — `DONE`
  - Frozen roster: Iterative Evolution, Chitin Shield, Disruption Order, Clever Ruse, Sneak Attack, Devious, Black-Out Strike, Tyrant’s Roar, Highlander, Unconquerable, This Will Not Stand, Lockdown, Overload, Shocking Speed, Chain Lightning
- [x] **FA-080 — Canonical Feature cohort 11** — `DONE`
  - Frozen roster: Fairy Lights, Arcane Favor, Fey Trance, Fairy Rite, Close Quarters Mastery, Brawler, Face Me Whelp, Smashing Punishment, Brightest Flame, Trail Blazer, Fan The Flames, Celerity, Gale Strike, Zephyr Shield, Tornado Charge
- [x] **FA-081 — Canonical Feature cohort 12** — `DONE`
  - Frozen roster: Ghost Step, Haunting Curse, Vampirism, Boo!, Foiling Foliage, Sunlight Within, Enduring Bloom, Cross-Pollinate, Mold the Earth, Desert Heart, Earthroil, Upheaval, Glacial Ice, Polar Vortex, Arctic Zeal
- [x] **FA-082 — Canonical Feature cohort 13** — `DONE`
  - Frozen roster: Deep Cold, Extra Ordinary, Plainly Perfect, New Normal, Simple Improvements, Potent Venom, Debilitate, Miasma, Corrosive Blight, Psionic Sponge, Mindbreak, Psychic Resonance, Force of Will, Gravel Before Me, Bigger and Boulder
- [x] **FA-083 — Canonical Feature cohort 14** — `DONE`
  - Frozen roster: Tough as Schist, Gneiss Aim, Polished Shine, Iron Grit, Assault Armor, True Steel, Flood!, Fishbowl Technique, Fountain of Life, Aqua Vortex, Chef, Hits the Spot, Culinary Appreciation, Accentuated Taste, Complex Aftertaste
- [x] **FA-084 — Canonical Feature cohort 15** — `DONE`
  - Frozen roster: Dietician, Dumplings, Tasty Snacks, Meal Planner, Hearty Meal, Bait Mixer, Preserves, Leftovers, Vitamins, Chronicler, Archival Training, Archive Tutor, Targeted Profiling, Observation Party, Cinematic Analysis
- [x] **FA-085 — Canonical Feature cohort 16** — `DONE`
  - Frozen roster: Fashionista, Dashing Makeover, Style is Eternal, Accessorize, Parfumier, Versatile Wardrobe, Dress to Impress, Contest Trends, Basic Fashion, Practical Fashion, Focused Fashion, Incense Maker, Researcher, Breadth of Knowledge, Live and Learn
- [x] **FA-086 — Canonical Feature cohort 17** — `DONE`
  - Frozen roster: Instant Analysis, Echoes of the Future, Restorative Science, Super Cures, Hyper Cures, Performance Enhancers, Apothecary, Patch Cure, Medicinal Blend, Crystal Artificer, Crystal Resonance, Rainbow Light, Fistful of Force, Type Booster, Type Brace
- [x] **FA-087 — Canonical Feature cohort 18** — `DONE`
  - Frozen roster: Focus Gem, Chakra Crystal, Rainbow Gem, Plate Crafter, Seed Bag, Top Tier Berries, Herb Lore, Chemist, Chemical Warfare, Caustic Chemistry, Playing God, Enhancers, Climatology, Climate Control, Weather Systems
- [x] **FA-088 — Canonical Feature cohort 19** — `DONE`
  - Frozen roster: Extreme Weather, Witch Hunter, Psionic Analysis, Mental Resistance, Immutable Mind, Fossil Restoration, Ancient Heritage, Genetic Memory, Prehistoric Bond, Pusher, This One’s Special, I Know It, Skill Trainer, Re-Balancing, Survivalist, Natural Fighter
- [x] **FA-089 — Canonical Feature cohort 20** — `DONE`
  - Frozen roster: Trapper, Wilderness Guide, Terrain Talent, Adaptive Geography, Athlete, Training Regime, Coaching, Adrenaline Rush, Athletic Moves, Dancer, Dance Form, Beguiling Dance, Dance Practice, Choreographer, Power Pirouette
- [x] **FA-090 — Canonical Feature cohort 21** — `DONE`
  - Frozen roster: Passing Waltz, Hunter, Pack Tactics, Surprise!, Hunter’s Reflexes, Finisher, Don’t Look Away, Pack Master, Martial Artist, Martial Training, My Kung-Fu is Stronger, Martial Achievement, Second Strike, Wrestlemania, Heightened Intensity
- [x] **FA-091 — Canonical Feature cohort 22** — `DONE`
  - Frozen roster: Pummeling Momentum, Bend Like the Willow, Soft Landing, Whirlwind Strikes, Musician, Musical Ability, Mt. Moon Blues, Cacophony, Noise Complaint, Voice Lessons, Power Chord, Provocateur, Push Buttons, Quick Wit, Mixed Messages
- [x] **FA-092 — Canonical Feature cohort 23** — `DONE`
  - Frozen roster: Powerful Motivator, Play Them Like a Fiddle, Enchanting Gaze, Rogue, Cutthroat, Dirty Fighting, Unexpected Attacks, Underhanded Tactics, Street Fighter, Scoundrel’s Strike, Roughneck, Menace, Mettle, Malice, Fearsome Display
- [x] **FA-093 — Canonical Feature cohort 24** — `DONE`
  - Frozen roster: Cruel Gaze, Tough as Nails, Tumbler, Aerialist, Quick Gymnastics, Flip Out, Death From Above, Quick Reflexes, Burst of Speed, Aura Guardian, Aura Reader, The Power of Aura, Sword of Body and Soul, Ambient Aura, Aura Mastery
- [x] **FA-094 — Canonical Feature cohort 25** — `DONE`
  - Frozen roster: Channeler, Shared Senses, Battle Synchronization, Spirit Boost, Power Conduit, Pain Dampening, Soothing Connection, Hex Maniac, Hex Maniac Studies, Diffuse Pain, Malediction, Grand Hex, Ninja, Ninja’s Arsenal, Poison Weapons
- [x] **FA-095 — Canonical Feature cohort 26** — `DONE`
  - Frozen roster: Genjutsu, Utility Drop, Weightless Step, Kinjutsu, Oracle, Divination, Unveiled Sight, Small Prophecies, Mark of Vision, Two-Second Preview, Prescience, Sage, Sacred Shield, Mystic Defense, Sage’s Benediction
- [x] **FA-096 — Canonical Feature cohort 27** — `DONE`
  - Frozen roster: Lay on Hands, Highly Responsive to Prayers, Divine Wind, Telekinetic, PK Alpha, PK Omega, Power of the Mind, PK Combat, Telekinetic Burst, Psionic Overload, Telepath, Honed Mind, Telepathic Awareness, Thought Detection, Telepathic Warning
- [x] **FA-097 — Canonical Feature cohort 28** — `DONE`
  - Frozen roster: Mental Assault, Suggestion, Warper, Space Distortion, Warping Ground, Strange Energy, Farcast, Warped Transmission, Reality Bender, Command Versatility, Press, Quick Switch, Species Savant, Tutoring, Commander’s Voice
- [x] **FA-098 — Canonical Feature cohort 29** — `DONE`
  - Frozen roster: Focused Command, Agility Training, Brutal Training, Focused Training, Inspired Training, Ravager Orders, Marksman Orders, Trickster Orders, Guardian Orders, Precision Orders, Blur, Defender, Dive, Fighter’s Versatility, Multi-Tasking
- [x] **FA-099 — Canonical Feature cohort 30 and cross-source closure audit** — `DONE`
  - Frozen roster: Signature Move, Type Expertise, Walk It Off, First Aid Expertise, Let Me Help You With That, Poké Ball Crafter, PokéManiac, Psionic Sight, Skill Monkey

### Phase 9 — Whole-catalog certification, migration, and release

- [x] **FA-100 — Enforce strict frozen-row semantic closure** — `DONE`
- [x] **FA-101 — Run whole-catalog conformance and property suites** — `DONE`
- [x] **FA-102 — Certify Move, Maneuver, Ability, Capability, and Edge interactions** — `DONE`
- [x] **FA-103 — Certify Item, inventory, capture, shop, and campaign interactions** — `DONE`
- [x] **FA-104 — Certify class, branch, rank, prerequisite, grant, and retraining graphs** — `DONE`
- [x] **FA-105 — Shadow and migrate existing Orders, Training, and Feature-derived behaviour** — `DONE`
- [x] **FA-106 — Complete security, privacy, backup, restart, and recovery validation** — `DONE`
- [x] **FA-107 — Enforce catalog-scale offer, provider, trigger, and graph performance budgets** — `DONE`
- [x] **FA-108 — Complete contributor, operator, build-validation, and manual-QA documentation** — `DONE`
- [x] **FA-109 — Run production-like multi-client, progression, encounter, and downtime acceptance** — `DONE`
- [x] **FA-110 — Retire legacy Feature execution and record final automation acceptance** — `DONE`
  - Require all Feature checks, typecheck, tests, build, `scripts/quality-gate.sh`, zero undocumented semantic debt, and then unblock `ENCOUNTER_UI_UX_PLAN.md`.

## Decision log

- **2026-07-26 — Feature automation follows Edge automation.** Features grant, require, replace, or modify Edges and Capabilities; those contracts must already be stable.
- **2026-07-26 — Source repair is a release blocker.** The current large parser output cannot be treated as canonical mechanics until class context, merged prose, errata, and ranked blocks are source-hash audited.
- **2026-07-26 — Preserve class structure without making class structure the UI.** Class, Branch, Ranked, Orders, and other tags remain rules metadata; the generic action and resolution surfaces present what the user can do.
- **2026-07-26 — Treat AP as an authoritative cross-feature resource.** Bind, Drain, temporary AP, nested payment, and recovery must be atomic and replay-safe.
- **2026-07-26 — Treat downtime and non-combat Features as real product workflows.** Crafting, medicine, research, training, capture, travel, social, and contest mechanics are implemented through campaign operations or typed adjudication.

- **2026-08-04 — Final Feature automation acceptance.** The repaired 444-row app-owned catalog, 40-family directory, 30 cohorts, 774 scenario requirements, strict instances, native registry, AP/frequency state, provider/grant closure, event and team routing, campaign plans, recovery, generic presentation, and fail-closed migration passed focused and catalog conformance validation.
