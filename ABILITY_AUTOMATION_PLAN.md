# Ability Automation Implementation Plan

`PLAN_STATUS: IN_PROGRESS`

`CURRENT_TICKET: AA-079`

## Goal

Implement complete, server-authoritative live-play automation for every canonical ability in `data/reference/abilities.json`, including all reusable machinery required by Static, activated, triggered, Interrupt, Reaction, field, movement, item, form, and persistent-state abilities.

This file is the durable implementation ledger for the ability initiative. It must be read before ability-automation work and updated whenever a ticket changes state. `BUILD_TICKETS.md` remains the completed historical Move automation queue and is not reused for this initiative.

## Frozen scope and baseline

- Canonical source: `data/reference/abilities.json`
- Frozen canonical count: **483 unique abilities**
- Current source SHA-256: `767c3e2ae45471c26ad97a07552c4b0417ed0e207827af8a59da3a73e81f4362`
- Canonical identity/order policy: source key identity, Unicode code-point ordering for generated inventories
- Frequency baseline:
  - 243 Static
  - 111 Scene
  - 30 Scene x2, plus one source-spelled `Scene x2- Swift Action`
  - 9 Scene x3
  - 56 At-Will
  - 23 Daily
  - 2 Daily x2
  - 2 Daily x3
  - 4 Daily x5
  - 2 Special
  - 0 records missing frequency or effect text
- 120 abilities have an explicit parsed Trigger.
- The seven initial parser/source gaps were resolved through reviewed, source-hash-bound adjudications in `data/ability-automation/source-adjudications.json`.
- Existing ability helpers and move interactions are migration inputs only. Registry presence, a menu badge, a browser transaction, or an exact-name reference does not prove semantic completion.

Changing the canonical catalog, count, canonicalization policy, or source hash requires an explicit ruleset/provenance revision and a corresponding update to this plan.

## Non-negotiable rules

1. **Live-play only.** Every completed ability must work through authoritative live-play commands or server-owned event processing. Browser-only and local-host-only mechanics do not count.
2. **Server authority.** Clients may submit intent and stable choice IDs only. They may not submit legal targets, trigger conclusions, rolls, modifiers, effect programs, resource spends, or state patches.
3. **No runtime prose interpretation.** Canonical prose is review input, never executable production input.
4. **Atomicity and complete read sets.** Immediate effects commit atomically across map, sheet, encounter, and inventory resources. Human waits use durable sagas with revision revalidation.
5. **Idempotency and replay.** Declaration, trigger, response, retry, reconnect, and replay must not reroll, double-spend, duplicate windows, or apply an effect twice.
6. **Privacy.** Public summaries reveal only bounded table-safe facts. Hidden sheets, abilities, eligible responders, options, rolls, and choices remain authorized views.
7. **One state owner.** Persistent character facts belong to sheets; temporary encounter facts belong to encounter state; full suspended state belongs to pending-resolution storage.
8. **Reusable machinery first.** Shared semantics become bounded schemas, queries, reducers, and planners. Registered pure handlers are reserved for genuine contextual outliers.
9. **Interaction honesty.** Base-ability completion and ecosystem interaction certification are separate dimensions. Unsupported move/item/feature combinations must be explicit.
10. **Production boundary.** Repository changes are deployed through GitHub. Do not modify the deployed production runtime or private campaign data directly.

## Semantic completion contract

An ability may be marked `complete` only when all applicable clauses satisfy all of the following:

- canonical frequency, action cost, trigger, target, range, relationship, timing, optionality, duration, reset, and special clauses are encoded;
- Static effects apply automatically from the authoritative effective-ability projection and cannot be manually invoked;
- activated abilities validate ownership, current effective ability, action/frequency resources, targets, and choices on the server;
- triggered abilities are detected from typed accepted events, ordered deterministically, and represented by an immediate deterministic effect or an authorized durable response window;
- ability suppression, replacement, copying, transformation, and source loss are resolved before eligibility and traced;
- all randomness and checks are server-owned, bounded, injected for tests, and retained in a roll ledger;
- all consulted resources join the read set and all writes commit atomically or through an explicit pending saga;
- reconnect, exact retry, stale conflict, pass, expiry, cancellation, and GM recovery behavior are tested where applicable;
- executable scenarios cover every applicable branch, prevention, cap/no-op, relation, lifecycle, and interaction required by the ability's own text;
- the manifest points to a reviewed runtime version/hash/source and has no blocker, limitation, or manual step;
- generic presentation is downstream of accepted mechanics and does not determine outcomes.

A typed human choice can still be `complete` when the server owns legal options, authorization, persistence, response identity, and deterministic resume behavior.

## Target architecture

```text
canonical ability catalog
  -> frozen ruleset + strict semantic manifest
  -> reviewed AbilitySpec v1 or bounded pure handler
  -> active declaration path and/or typed encounter-event router
  -> authoritative context + effective-ability projection
  -> shared typed selectors/predicates/expressions/effect reducers
  -> ability frequency/action/lifecycle reducers
  -> complete read-set state plan
  -> atomic commit or durable pending response
  -> bounded accepted result + authorized presentation
```

Ability automation should reuse MoveSpec v2 selectors, expressions, operations, reducers, encounter effects, history, and pending-response infrastructure when semantics match. Ability-specific envelopes and adapters must keep move declaration rules separate from ability frequency, event subscriptions, passive providers, and trigger ordering.

## Plan update protocol

- Ticket states are `TODO`, `IN_PROGRESS`, `DONE`, or `BLOCKED`.
- `CURRENT_TICKET` names the lowest-numbered active unfinished ticket.
- Before starting a ticket, set only that ticket to `IN_PROGRESS` and update `CURRENT_TICKET`.
- Mark a ticket `DONE` only after focused tests and the applicable strict checks pass.
- Record design decisions in the decision log, not as silent scope changes.
- Do not mark cohort tickets complete for parse-only placeholders, generic logs, or unreviewed heuristic translations.
- Add newly discovered machinery to the earliest applicable unfinished machinery ticket; if all applicable tickets are done, add a narrowly scoped new ticket before implementing it.
- After every cohort, update the progress snapshot from executable manifest/checker output.
- Set `PLAN_STATUS: DONE` only after all 483 canonical rows are complete, the final interaction/acceptance tickets are done, and `scripts/quality-gate.sh` passes.

## Progress snapshot

- Plan tickets: **78 DONE / 110 total**
- Canonical inventory: **483**
- Semantically complete: **228**
- Assisted: **0**
- Blocked/unimplemented: **255**
- Interaction status: **483 unassessed**
- Legacy baseline: **45 abilities with 55 partial fragments; 438 with no reviewed legacy fragment**
- Production runtime: **228 exact manifest-selected AbilitySpec v1 runtimes**; retained legacy paths remain explicit compatibility only

## Tickets

### Phase 1 — Governance, provenance, and honest coverage

- [x] **AA-001 — Freeze canonical scope and rules provenance** — `DONE`
  - Add a strict ability ruleset record for the 483-row catalog, source hash, canonicalization policy, source hierarchy, and explicit homebrew boundary.
  - Add executable validation proving count, identities, order, and hash.
- [x] **AA-002 — Adjudicate canonical source-data gaps** — `DONE`
  - Resolve the six missing frequencies and Transporter's missing effect from checked-in source material, record provenance, and add parser/reference regression tests.
- [x] **AA-003 — Add the ability semantic manifest and deterministic seeder** — `DONE`
  - Define one strict row per canonical ability with base status, interaction status, runtime reference, provenance, capabilities, debt, scenarios, review date, and rollout cohort.
- [x] **AA-004 — Add closed ability capability and evidence catalogs** — `DONE`
  - Define stable mechanic capabilities, dependencies, owning phases, requirement tags, evidence classes, and validation limits.
- [x] **AA-005 — Add coverage, completeness, link, budget, and plan-consistency commands** — `DONE`
  - Fail on catalog drift, duplicate/missing rows, false completion, bad hashes/links, missing evidence, plan drift, or exceeded complexity/performance budgets.
- [x] **AA-006 — Record the authoritative ability-runtime ADR and contributor guide** — `DONE`
  - Document completion semantics, state ownership, triggers, choices, handlers, interactions, migration, and required commands.
- [x] **AA-007 — Produce a reviewed baseline audit of existing ability behavior** — `DONE`
  - Map current helpers, passives, move hooks, follow-ups, weather hooks, client transactions, and unimplemented abilities without promoting any row from references alone.
- [x] **AA-008 — Define legacy isolation and migration contracts** — `DONE`
  - Keep old client/server ability helpers available only through explicit migration/compatibility boundaries until replaced; prevent accidental production fallback.
- [x] **AA-009 — Define ability threat model and privacy matrix** — `DONE`
  - Cover hidden abilities, copied/suppressed abilities, trigger eligibility, responder ownership, options, rolls, observability, and logs.

### Phase 2 — AbilitySpec runtime and authoritative planning

- [x] **AA-010 — Define strict AbilitySpec v1 envelope** — `DONE`
  - Add immutable JSON-only identity, mode, subscriptions, targeting, preconditions, costs, phases, operations, handler identity, and presentation metadata with aggregate limits.
- [x] **AA-011 — Add AbilitySpec normalization, validation, and definition hashing** — `DONE`
  - Canonicalize only set-like data, preserve mechanic order, validate closed extensions, and bind hashes to ability rules provenance.
- [x] **AA-012 — Add manifest-selected production registry** — `DONE`
  - Duplicate-check registrations and permit production lookup only through canonical manifest-selected runtime metadata.
- [x] **AA-013 — Add bounded pure ability-handler registry** — `DONE`
  - Restrict handlers to frozen context/query interfaces and strictly parsed operations/trace entries without I/O, ambient time, or ambient randomness.
- [x] **AA-014 — Build immutable authoritative ability context** — `DONE`
  - Resolve actor, source, targets, sides, map, sheets, effective abilities, encounter effects, items, capabilities, history, and private read-set queries.
- [x] **AA-015 — Adapt the shared typed effect kernel for abilities** — `DONE`
  - Reuse compatible selectors, predicates, expressions, operations, reducers, and state planning without pretending every ability is a move.
- [x] **AA-016 — Add ability trace, roll ledger, and causal ancestry** — `DONE`
  - Trace eligibility, suppression, subscriptions, choices, rolls, operations, prevention, lifecycle, nested causes, and reviewed runtime identity.
- [x] **AA-017 — Add ability state-plan/read-set integration** — `DONE`
  - Produce typed map/sheet/inventory/encounter plans and validate all consulted revisions in the same atomic commit boundary.
- [x] **AA-018 — Add nested execution and performance budgets** — `DONE`
  - Bound event fan-out, trigger count, nesting depth, operations, recipients, rolls, choices, and trace size.
- [x] **AA-019 — Define strict accepted and pending ability results** — `DONE`
  - Separate private mechanics from bounded public summaries and generic authorized presentation.

### Phase 3 — Frequency, actions, effective abilities, and lifecycle state

- [x] **AA-020 — Parse and model canonical ability frequencies** — `DONE`
  - Support Static, At-Will, Scene/Scene xN, Daily/Daily xN, and explicit exceptional frequency clauses as reviewed data.
- [x] **AA-021 — Model ability action economy** — `DONE`
  - Support Standard, Shift, Swift, Free, Full, Extended, Special, Priority, Interrupt, and Reaction costs and shared Interrupt/Reaction availability.
- [x] **AA-022 — Add authoritative scene/daily usage ledgers** — `DONE`
  - Own temporary scene usage in encounter state and lasting Daily usage on the sheet, with atomic payment and exact retry behavior.
- [x] **AA-023 — Add round/turn/cooldown limits and resets** — `DONE`
  - Support once-per-round/turn clauses, delayed reavailability, scene transitions, and encounter recovery.
- [x] **AA-024 — Add effective-ability projection and suppression semantics** — `DONE`
  - Resolve base, granted, copied, replaced, transformed, suppressed, and uncopyable/undisableable abilities in deterministic order.
- [x] **AA-025 — Add passive provider aggregation and stacking policy** — `DONE`
  - Define stable priority/stacking groups for stat, damage, accuracy, evasion, immunity, movement, and side/field providers.
- [x] **AA-026 — Add parameterized ability-instance data** — `DONE`
  - Represent sheet-authored choices and canonical parameters with validated stable identities rather than parsing display names during resolution.
- [x] **AA-027 — Add game-event duration lifecycle for ability effects** — `DONE`
  - Support turn, round, scene, source-presence, source-ability, target-presence, weather, terrain, and until-triggered durations.
- [x] **AA-028 — Add marks, counters, tokens, modes, and forms** — `DONE`
  - Model ability-owned encounter state with bounded identities, source linkage, lifecycle cleanup, and replay-safe updates.
- [x] **AA-029 — Add restart/reconnect/export/recovery semantics** — `DONE`
  - Preserve usages, effects, pending windows, modes, and causal state across process restart and supported backup formats.

### Phase 4 — Typed event subscriptions and trigger routing

- [x] **AA-030 — Expand the closed encounter-event vocabulary for abilities** — `DONE`
  - Add only typed facts needed for ability triggers, including action, HP, condition, stage, item, field, and lifecycle outcomes.
- [x] **AA-031 — Add deterministic event subscription and eligibility routing** — `DONE`
  - Match reviewed subscriptions against accepted events and current effective abilities without scanning prose or trusting clients.
- [x] **AA-032 — Cover move declaration/use/type/class/keyword events** — `DONE`
  - Expose authoritative move identity, type, class, range, keywords, targets, and semantic branches at reviewed checkpoints.
- [x] **AA-033 — Cover hit/miss/critical/damage/contact events** — `DONE`
  - Preserve strike index, melee/ranged/contact context, actual losses, effectiveness, prevention, and attacker/defender identities.
- [x] **AA-034 — Cover HP, temporary HP, injury, massive-damage, and faint events** — `DONE`
  - Emit typed before/after facts from accepted reducers and prevent derived-event duplication on replay.
- [x] **AA-035 — Cover Combat Stage, stat, condition, save, and cure events** — `DONE`
  - Distinguish attempted, applied, capped, prevented, reset, transferred, and source-specific outcomes.
- [x] **AA-036 — Cover movement, adjacency, terrain, hazard, and zone events** — `DONE`
  - Route pre-step and post-step facts with authoritative paths, distances, cells, forced movement, grounding, and source zones.
- [x] **AA-037 — Cover send-out, recall, switch, initiative, turn, round, and scene events** — `DONE`
  - Integrate triggers with existing lifecycle reducers and deterministic source ordering.
- [x] **AA-038 — Cover weather, terrain, room, item, inventory, and held-item events** — `DONE`
  - Emit typed add/remove/use/consume/drop/transfer facts with source/resource revisions.
- [x] **AA-039 — Add nested trigger ordering, cycle prevention, and causal budgets** — `DONE`
  - Define priority, simultaneous triggers, child events, once-per-causal-chain guards, recursion bounds, and deterministic pass behavior.

### Phase 5 — Intent, choices, reactions, geometry, and exceptional entities

- [x] **AA-040 — Extend ability declaration intent and targeting envelopes** — `DONE`
  - Support reviewed token, self, side, area, cell, direction, type, stat, move, ability, item, and branch choices through stable IDs.
- [x] **AA-041 — Add durable optional-trigger windows** — `DONE`
  - Persist trigger identity, legal options, ownership, read set, trace, rolls, and deterministic resume state.
- [x] **AA-042 — Add Interrupt/Reaction timing and priority arbitration** — `DONE`
  - Order competing windows at exact authoritative checkpoints and share availability correctly.
- [x] **AA-043 — Add pass, force-pass, cancellation, expiry, and GM recovery** — `DONE`
  - Make every terminal path typed, idempotent, causal, authorized, and auditable.
- [x] **AA-044 — Add authorized response views and redaction** — `DONE`
  - Prevent hidden ability, source, target, responder, option, sheet, and roll leakage in HTTP/SSE/replay/log surfaces.
- [x] **AA-045 — Complete ability targeting relationships, range, and geometry** — `DONE`
  - Reuse authoritative side, willingness, visibility, line, burst, cone, cardinal footprint, adjacency, and map-range queries.
- [x] **AA-046 — Complete ability randomness, checks, saves, and rerolls** — `DONE`
  - Use stable roll IDs, reviewed formulas/tables, exact draw accounting, typed source choices, and replay-safe ledgers.
- [x] **AA-047 — Add ability-created anchors, decoys, objects, and subordinate tokens** — `DONE`
  - Define bounded non-sheet entities, occupancy/targetability, control, source linkage, movement, and cleanup.
- [x] **AA-048 — Add ability movement and displacement planning** — `DONE`
  - Use the authoritative movement oracle for optional/forced movement, teleports, swaps, anchors, and interruption checkpoints.
- [x] **AA-049 — Add form, disguise, illusion, copy, and transformation snapshots** — `DONE`
  - Separate aesthetic/private presentation from mechanical projections and preserve immutable copy bases.

### Phase 6 — Reusable mechanical providers and user-facing integration

- [x] **AA-050 — Complete damage, Damage Base, type, STAB, Accuracy, and critical providers** — `DONE`
- [x] **AA-051 — Complete immunity, resistance, vulnerability, protection, and bypass providers** — `DONE`
- [x] **AA-052 — Complete HP, temporary HP, drain, recoil, injury, and damage-reduction providers** — `DONE`
- [x] **AA-053 — Complete stat, Combat Stage, evasion, initiative, and movement-speed providers** — `DONE`
- [x] **AA-054 — Complete condition, save, cure, prevention, reflection, and transfer providers** — `DONE`
- [x] **AA-055 — Complete move mutation, grant, connection, disable, replacement, and nested-use providers** — `DONE`
- [x] **AA-056 — Complete held-item, inventory, berry/food, pickup, drop, steal, and consume providers** — `DONE`
- [x] **AA-057 — Complete weather, terrain, room, hazard, vortex, zone, and battlefield providers** — `DONE`
- [x] **AA-058 — Complete ally, enemy, aura, side, adjacency, interception, and redirection providers** — `DONE`
- [x] **AA-059 — Replace the legacy ability UI/command boundary** — `DONE`
  - Drive menus, targeting, pending prompts, recovery, accepted results, and status badges from manifest-selected server capabilities; preserve passive non-invocation and accessibility.

### Phase 7 — Canonical ability cohorts

Each cohort must review every named ability against canonical text, implement all required branches using existing machinery or narrowly add reusable machinery, register a reviewed runtime, add executable conformance evidence, and promote only genuinely complete rows.

- [x] **AA-060 — Abominable through Anticipation** — `DONE`
  - Abominable; Absorb Force; Accelerate; Adaptability; Aerilate; Aftermath; Air Lock; Ambush; Analytic; Anchored; Anger Point; Anticipation
- [x] **AA-061 — Aqua Boost through Beast Boost** — `DONE`
  - Aqua Boost; Aqua Bullet; Arena Trap; Aroma Veil; Aura Break; Aura Storm; Bad Dreams; Ball Fetch; Battery; Battle Armor; Beam Cannon; Beast Boost
- [x] **AA-062 — Beautiful through Bone Wielder** — `DONE`
  - Beautiful; Berry Storage; Berserk; Big Pecks; Big Swallow; Blaze; Blessed Touch; Blow Away; Blur; Bodyguard; Bone Lord; Bone Wielder
- [x] **AA-063 — Brimstone through Cloud Nine** — `DONE`
  - Brimstone; Bulletproof; Bully; Cave Crasher; Celebrate; Chemical Romance; Cherry Power; Chilling Neigh; Chlorophyll; Clay Cannons; Clear Body; Cloud Nine
- [x] **AA-064 — Cluster Mind through Corrosion** — `DONE`
  - Cluster Mind; Color Change; Color Theory; Comatose; Combo Striker; Competitive; Compound Eyes; Confidence; Conqueror; Contrary; Copy Master; Corrosion
- [x] **AA-065 — Corrosive Toxins through Damp** — `DONE`
  - Corrosive Toxins; Cotton Down; Courage; Covert; Cruelty; Crush Trap; Cud Chew; Curious Medicine; Cursed Body; Cute Charm; Cute Tears; Damp
- [x] **AA-066 — Dancer through Defiant** — `DONE`
  - Dancer; Danger Syrup; Dark Art; Dark Aura; Dauntless Shield; Daze; Dazzling; Deadly Poison; Decoy; Deep Sleep; Defeatist; Defiant
- [x] **AA-067 — Defy Death through Download** — `DONE`
  - Defy Death; Delayed Reaction; Delivery Bird; Desert Weather; Designer; Diamond Defense; Dig Away; Dire Spore; Discipline; Disguise; Dodge; Download
- [x] **AA-068 — Dragon’s Maw through Electric Surge** — `DONE`
  - Dragon’s Maw; Dream Smoke; Dreamspinner; Drizzle; Drought; Drown Out; Dry Skin; Dust Cloud; Early Bird; Effect Spore; Eggscellence; Electric Surge
- [x] **AA-069 — Electrodash through Filter** — `DONE`
  - Electrodash; Emergency Exit; Empower; Enduring Rage; Enfeebling Lips; Exploit; Fabulous Trim; Fade Away; Fairy Aura; Fashion Designer; Fiery Crash; Filter
- [x] **AA-070 — Flame Body through Flying Fly Trap** — `DONE`
  - Flame Body; Flame Tongue; Flare Boost; Flash Fire; Flavorful Aroma; Flower Gift; Flower Power; Flower Veil; Fluffy; Fluffy Charge; Flutter; Flying Fly Trap
- [x] **AA-071 — Focus through Full Metal Body** — `DONE`
  - Focus; Forecast; Forest Lord; Forewarn; Fox Fire; Freezing Point; Friend Guard; Frighten; Frisk; Frostbite; Full Guard; Full Metal Body
- [x] **AA-072 — Fur Coat through Grass Pelt** — `DONE`
  - Fur Coat; Gale Wings; Galvanize; Gardener; Gentle Vibe; Giver; Glisten; Gluttony; Gooey; Gore; Gorilla Tactics; Grass Pelt
- [x] **AA-073 — Grassy Surge through Heatproof** — `DONE`
  - Grassy Surge; Grim Neigh; Gulp; Gulp Missile; Guts; Handyman; Harvest; Haunt; Hay Fever; Healer; Heat Mirage; Heatproof
- [x] **AA-074 — Heavy Metal through Hyper Cutter** — `DONE`
  - Heavy Metal; Heliovolt; Helper; Honey Paws; Honey Thief; Horde Break; Huge Power; Huge Power / Pure Power; Hunger Switch; Hustle; Hydration; Hyper Cutter
- [x] **AA-075 — Hypnotic through Innards Out** — `DONE`
  - Hypnotic; Ice Body; Ice Face; Ice Scales; Ice Shield; Ignition Boost; Illuminate; Illusion; Immunity; Imposter; Infiltrator; Innards Out
- [x] **AA-076 — Inner Focus through Keen Eye** — `DONE`
  - Inner Focus; Insomnia; Instinct; Interference; Intimidate; Intrepid Sword; Iron Barbs; Iron Fist; Juicy Energy; Justified; Kampfgeist; Keen Eye
- [x] **AA-077 — Klutz through Light Metal** — `DONE`
  - Klutz; Lancer; Landslide; Last Chance; Leaf Gift; Leaf Guard; Leaf Rush; Leafy Cloak; Leek Mastery; Levitate; Life Force; Light Metal
- [x] **AA-078 — Lightning Kicks through Magic Bounce** — `DONE`
  - Lightning Kicks; Lightning Rod; Limber; Line Charge; Liquid Ooze; Liquid Voice; Long Reach; Lullaby; Lunchbox; Mach Speed; Maelstrom Pulse; Magic Bounce
- [ ] **AA-079 — Magic Guard through Mind Mold** — `TODO`
  - Magic Guard; Magician; Magma Armor; Magnet Pull; Marvel Scale; Mega Launcher; Memory Wipe; Merciless; Migraine; Mimicry; Mimitree; Mind Mold
- [ ] **AA-080 — Mini-Noses through Moxie** — `TODO`
  - Mini-Noses; Minus; Miracle Mile; Mirror Armor; Missile Launch; Misty Surge; Mojo; Mold Breaker; Moody; Motor Drive; Mountain Peak; Moxie
- [ ] **AA-081 — Mud Dweller through Normalize** — `TODO`
  - Mud Dweller; Mud Shield; Multiscale; Multitype; Mummy; Natural Cure; Needles; Neuroforce; Neutralizing Gas; Nimble Strikes; No Guard; Normalize
- [ ] **AA-082 — Oblivious through Perception** — `TODO`
  - Oblivious; Odious Spray; Omen; Overcharge; Overcoat; Overgrow; Own Tempo; Pack Hunt; Parental Bond; Parry; Pastel Veil; Perception
- [ ] **AA-083 — Perish Body through Polycephaly** — `TODO`
  - Perish Body; Permafrost; Photosynthesis; Pickpocket; Pickup; Pixilate; Plus; Poison Heal; Poison Point; Poison Touch; Poltergeist; Polycephaly
- [ ] **AA-084 — Power Construct through Psionic Screech** — `TODO`
  - Power Construct; Power Spot; Power of Alchemy; Prankster; Pressure; Pride; Prime Fury; Prism Armor; Probability Control; Propeller Tail; Protean; Psionic Screech
- [ ] **AA-085 — Psychic Surge through Radiant Beam** — `TODO`
  - Psychic Surge; Pumpkingrab; Punk Rock; Pure Blooded; Pure Power; Queenly Majesty; Quick Cloak; Quick Curl; Quick Draw; Quick Feet; RKS System; Radiant Beam
- [ ] **AA-086 — Ragelope through Revelation** — `TODO`
  - Ragelope; Rain Dish; Rally; Rattled; Razor Edge; Receiver; Reckless; Refreshing Veil; Refrigerate; Regal Challenge; Regenerator; Revelation
- [ ] **AA-087 — Ripen through Sand Spit** — `TODO`
  - Ripen; Rivalry; Rock Head; Rocket; Root Down; Rough Skin; Run Away; Run Up; Sacred Bell; Sand Force; Sand Rush; Sand Spit
- [ ] **AA-088 — Sand Stream through Shadow Shield** — `TODO`
  - Sand Stream; Sand Veil; Sap Sipper; Schooling; Scrappy; Screen Cleaner; Seasonal; Sequence; Serene Grace; Serpent’s Mark; Shackle; Shadow Shield
- [ ] **AA-089 — Shadow Tag through Slow Start** — `TODO`
  - Shadow Tag; Shed Skin; Sheer Force; Shell Armor; Shell Cannon; Shell Shield; Shield Dust; Shields Down; Silk Threads; Simple; Skill Link; Slow Start
- [ ] **AA-090 — Slush Rush through Soul Heart** — `TODO`
  - Slush Rush; Sniper; Snow Cloak; Snow Warning; Snuggle; Sol Veil; Solar Power; Solid Rock; Sonic Courtship; Soothing Tone; Sorcery; Soul Heart
- [ ] **AA-091 — Soulstealer through Stall** — `TODO`
  - Soulstealer; Sound Lance; Soundproof; Speed Boost; Spike Shot; Spinning Dance; Spiteful Intervention; Splendorous Rider; Spray Down; Sprint; Stakeout; Stall
- [ ] **AA-092 — Stalwart through Sticky Smoke** — `TODO`
  - Stalwart; Stamina; Stance Change; Starlight; Starswirl; Static; Steadfast; Steam Engine; Steelworker; Stench; Sticky Hold; Sticky Smoke
- [ ] **AA-093 — Storm Drain through Sway** — `TODO`
  - Storm Drain; Strange Tempo; Strong Jaw; Sturdy; Suction Cups; Sumo Stance; Sun Blanket; Sunglow; Super Luck; Surge Surfer; Swarm; Sway
- [ ] **AA-094 — Sweet Veil through Thermosensitive** — `TODO`
  - Sweet Veil; Swift Swim; Symbiosis; Synchronize; Tangled Feet; Tangling Hair; Targeting System; Teamwork; Technician; Telepathy; Teravolt; Thermosensitive
- [ ] **AA-095 — Thick Fat through Toxic Boost** — `TODO`
  - Thick Fat; Thrust; Thunder Boost; Tingle; Tingly Tongue; Tinted Lens; Tochukaso; Tolerance; Tonguelash; Torrent; Tough Claws; Toxic Boost
- [ ] **AA-096 — Toxic Nourishment through Ugly** — `TODO`
  - Toxic Nourishment; Trace; Transistor; Transporter; Triage; Trinity; Truant; Turboblaze; Twisted Power; Type Aura; Type Strategist; Ugly
- [ ] **AA-097 — Unaware through Volt Absorb** — `TODO`
  - Unaware; Unbreakable; Unburden; Unnerve; Unseen Fist; Vanguard; Venom; Vicious; Victory Star; Vigor; Vital Spirit; Volt Absorb
- [ ] **AA-098 — Voodoo Doll through Weeble** — `TODO`
  - Voodoo Doll; Wallmaster; Wandering Spirit; Wash Away; Water Absorb; Water Bubble; Water Compaction; Water Veil; Wave Rider; Weak Armor; Weaponize; Weeble
- [ ] **AA-099 — Weird Power through Wonder Guard** — `TODO`
  - Weird Power; Whirlwind Kicks; White Flame; White Smoke; Wily; Wind Power; Windveiled; Winter’s Kiss; Wishmaster; Wistful Melody; Wobble; Wonder Guard
- [ ] **AA-100 — Wonder Skin through Zen Snowed** — `TODO`
  - Wonder Skin; Zen Mode; Zen Snowed

### Phase 8 — Whole-catalog certification, migration, and release

- [ ] **AA-101 — Enforce strict 483-row semantic closure** — `TODO`
  - Require exactly 483 complete base rows, zero assisted/blocked/unimplemented rows, valid hashes/links/provenance, and no manual debt.
- [ ] **AA-102 — Run whole-catalog conformance and property suites** — `TODO`
  - Cover deterministic replay, stale conflicts, exact retry, caps, immunity, lifecycle, trigger ordering, and bounded random/property inputs.
- [ ] **AA-103 — Certify the ability interaction matrix** — `TODO`
  - Review move, ability, item, feature, condition, weather, terrain, hazard, form, and capability interactions separately from base closure; record explicit unsupported IDs until complete.
- [ ] **AA-104 — Shadow and migrate existing ability behavior** — `TODO`
  - Compare existing supported flows against the authoritative runtime on immutable snapshots, adjudicate differences, and migrate without dual writes.
- [ ] **AA-105 — Complete observability, security, and privacy validation** — `TODO`
  - Emit bounded reason codes/counts/timings only; test authorization, hidden-state redaction, malformed inputs, fan-out limits, and abuse resistance.
- [ ] **AA-106 — Complete backup, export, restart, and recovery validation** — `TODO`
  - Exercise pending triggers, daily/scene resources, forms, marks, copied abilities, retries, and terminal maintenance-export behavior.
- [ ] **AA-107 — Enforce catalog-scale performance budgets** — `TODO`
  - Benchmark registry load, event routing, passive aggregation, common move resolution with abilities, worst bounded trigger fan-out, and pending resume.
- [ ] **AA-108 — Complete contributor, operator, and manual-QA documentation** — `TODO`
  - Document authoring, debugging, correction, privacy, live-play UX, recovery, interactions, and release checks.
- [ ] **AA-109 — Run production-like multi-client acceptance** — `TODO`
  - Validate GM/player/unauthorized views, active/passive/triggered abilities, simultaneous reactions, reconnect, restart, recovery, and no private-data retention.
- [ ] **AA-110 — Retire legacy production ability execution and record release acceptance** — `TODO`
  - Remove production fallback to ad hoc ability transactions/hooks, retain only explicit compatibility readers as needed, pass the final quality gate, and truthfully record deployment/observation dependencies.

## Decision log

- **2026-07-09 — Separate AbilitySpec from MoveSpec.** Reuse the typed mechanical kernel, but keep ability identity, frequency, subscriptions, passive projection, and trigger routing in an ability-owned envelope.
- **2026-07-09 — Track all 483 source-key abilities.** No ability is excluded merely because it is Static, primarily narrative, species-specific, trainer-facing, creates an object, or requires a human choice.
- **2026-07-09 — Treat existing automation as uncertified migration input.** Current passive helpers and five durable move follow-ups may be reused after semantic review but do not pre-complete manifest rows.
- **2026-07-09 — Separate base completion from interaction certification.** Every ability's own directly required clauses belong to base completion; broad ecosystem combinations are tracked independently and explicitly.
- **2026-07-09 — Resolve checked-in source gaps before cohort promotion.** Missing frequency/effect data cannot be guessed by production code or hidden as manual debt on a complete row.
- **2026-07-09 — Bind parser adjudications to exact checked-in source bytes.** PDF column-order losses are repaired through reviewed field overrides with source paths, section anchors, and SHA-256 digests; the parser fails if those sources drift.
- **2026-07-21 — Persist Delayed Reaction as exact direct-HP debt.** Halving occurs after canonical minimum damage, odd remainders are retained in bounded encounter effects, and lifecycle settlement bypasses later damage modifiers at the owner’s next turn end.
- **2026-07-21 — Reuse durable item choices for Delivery Bird.** A second held-item slot is effective-ability gated, and an otherwise ambiguous single-item Move operation opens an owner-authorized item window instead of accepting client item mechanics.
- **2026-07-21 — Apply Diamond Defense before both availability and hazard damage.** Stealth Rock resolves as Scene x2 before usage gating, and source-owned hazards calculate one Tick with the more effective authoritative Rock/Fairy profile.
- **2026-07-21 — Model defensive misses as dynamic recipient cancellation.** Disguise, Dodge, and Dig Away remove only the reviewed recipient from later hit effects while retaining triggering costs; Disguise and Dig Away additionally suppress that attack’s target-owned effects.
- **2026-07-22 — Generalize Drown Out across Sonic Moves.** One effective-ability-gated declaration Interrupt now cancels every foe Sonic Move while retaining the triggering action cost; Chatter no longer owns a bespoke cancellation path.
- **2026-07-22 — Keep AA-068 type and condition effects semantically ordered.** Dragon’s Maw applies its final effectiveness step after ordinary modifiers, Dry Skin separates Water immunity from hit-triggered healing, and Dream Smoke/Effect Spore conditions resolve independently of the triggering Move’s type immunity.
- **2026-07-22 — Revalidate and persist Dust Cloud targeting authority.** Burst 1 is a presentation choice only until the server confirms an effective Dust Cloud and Powder Move; the reviewed branch ID is retained in bounded pending state for deterministic continuation replay.
- **2026-07-22 — Encode Effect Spore as authoritative weighted die faces.** Repeated canonical condition IDs are accepted only for bounded random-choice face tables, preserving exact d6 bands without client-authored outcomes.
- **2026-07-24 — Keep AA-075 visual identity outside authoritative mechanics.** Illusion marks and active appearance survive reconnect as bounded ability-owned state and typed effects, but renderer projection never replaces the user's types, statistics, footprint, capabilities, movement, abilities, or Move rules token.
- **2026-07-24 — Track Ice Face through feature-owned Temporary HP evidence.** Ice Face form requires its non-dispellable ownership marker and a remaining pool; depletion or an unrelated replacement clears ownership, while battle start and Hail restoration explicitly establish it.
- **2026-07-24 — Run Infiltrator at exact authoritative boundaries.** Its Substitute bypass recognizes only the typed Substitute capability, responsive Blessing blocking names exact effect IDs without consuming charges, and normal/resumed movement executes zone entry so hazard immunity is observable as `ability-immune`.
- **2026-07-25 — Preserve AA-076 reaction semantics across multi-hit and nested execution.** Iron Barbs and Justified wait for authoritative hit evidence, Kampfgeist waits for actual typed damage, disjoint HP/stage writes merge into one sheet CAS, and a nested reaction retains its reviewed child phase through durable suspension and resume.
- **2026-07-25 — Apply AA-076 capacity and modifier rules from effective abilities.** Juicy Energy exposes and revalidates only regular or effective Honey Paws Berry Juice storage, while Inner Focus and Keen Eye filter only unwilling Initiative lowering, Accuracy penalties, and non-stat Evasion without erasing unrelated bonuses or Total Blindness.
