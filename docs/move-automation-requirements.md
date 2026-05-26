# Move automation requirements

Requirements-gathering notes for adding **Use Move** to the map token context menu.

## Requested flow

1. User right-clicks a controllable token on a map.
2. Context menu includes **Use Move**.
3. The move submenu lists only moves with an automated script.
4. User chooses a move.
5. The move resolves through an on-map flow: single-target overlay, AoE confirmation overlay, or immediate self/field resolution.
6. The automated flow applies accepted state changes: HP, combat stages, positions, statuses, hazards, weather/terrain/rooms, frequencies, delayed effects, and log entries.

## `moves.json` audit

Source inspected: `data/reference/moves.json`.

Raw file has **762** dictionary entries. One entry is rulebook explanatory text, not a move:

- `The first line contains the Name of the Move. This`

`data/ptuReference.ts` already filters moves to the 18 canonical Pokémon types, leaving the expected **761 valid moves**.

Valid move field audit:

| Item | Count / notes |
| --- | ---: |
| Valid moves | 761 |
| Damage classes | 293 Physical, 204 Special, 260 Status, 3 Static, 1 missing (`Mat Block`) |
| Frequencies | 239 EOT, 157 At-Will, 147 Scene x2, 126 Scene, 50 Daily x2, 37 Daily, 3 Static, 1 See Text (`Curse`), 1 Daily x3 (`Shadow Force`) |
| Moves with damage base / roll | 473 |
| Moves without damage base / roll | 288 |
| AC values | 366 at AC 2, 82 at AC 4, 48 at AC 3, 27 at AC 5, 16 at AC 6, 5 at AC 7, 3 at AC 9, 2 at AC 10, 210 null/missing, plus `Bestow` = `--`, `Nature Power` = `See Effect` |
| Unique raw `range` strings | 215 |
| Unique comma-split range atoms | 98 |
| Missing/empty `range` | `Tailwind`, `Bind`, `Wrap`, `Clamp` |
| Empty/missing effect text | 28 moves |
| Literal `None`/`None.` effect text | 62 moves |

Range keywords are not clean enough to parse blindly. Examples: `Interupt`, `Set Up`, `Melee 1`, `1 Target.`, `Double Strike; or 6`, and missing ranges on static moves. The scripts should use the app-owned PTU move record for display/prefill, but each move's automation must be hand-authored and covered explicitly.

High-level mechanics found across all 761 valid moves, for component planning only:

| Mechanic family | Approx. moves | Examples / implications |
| --- | ---: | --- |
| Moves with no secondary effect text | 90 | Most are plain attacks, but some are status/setup rows; all may still carry keyword behavior such as Recoil, Exhaust, Set-Up, Five Strike, Double Strike, Priority. |
| Area or multi-target targeting | ~202 | Burst, Cone, Line, Blast, Field, Weather, Blessing, Hazard, all-adjacent. Needs target/cell selection and per-target resolution. |
| Combat stage changes or swaps | ~180 | Standard +/- CS, all-stat changes, stat swaps, reset stages, stage-triggered DB. |
| Status / volatile / special conditions | ~154 | Sleep, Burn, Freeze, Paralysis, Poison, Confusion, Trapped, Stuck, Vortex, Cursed, Enraged, Slowed, Vulnerable, etc. |
| Movement / positioning | ~118 | Dash, Pass, Push, pull, teleport, switch/replacement, recall, forced movement, airborne/underground setup moves. |
| Healing / HP manipulation | ~101 | Percent heals, ticks, drain, recoil, self-KO, fixed HP loss, delayed Wish/Leech Seed/Aqua Ring effects. |
| Priority / timing / setup / delayed actions | ~98 | Priority, Set-Up, Execute, Exhaust, Swift/Free/Full Action, next-turn effects, end-of-round attacks. |
| Interrupts / reactions / shields / triggers | ~69 | Protect-like shields, Counter/Mirror Coat/Bide/Mat Block/Wide Guard, trigger windows before or after damage. |
| Field state | ~61 | Weather, Terrain, Gravity, Trick/Magic/Wonder Room, Tailwind, Defog, Court Change. |
| Hazards / barriers / vortexes | ~23 | Spikes, Toxic Spikes, Sticky Web, Stealth Rock, Barrier, Smokescreen, Whirlpool/Fire Spin/etc. |
| Inventory / held items | ~21 | Bestow, Fling, Natural Gift, Knock Off, Thief, Switcheroo, Embargo, Corrosive Gas, Techno Blast. |
| Random sub-effects | ~29 | Dire Claw/Tri Attack status rolls, Magnitude, Present, Acupressure, Metronome, Assist. |
| Copy / move-list mutation | ~10 | Sketch, Mimic, Mirror Move, Copycat, Assist, Metronome, Instruct, Transform. |

These groupings are **not** a proposed generic parser. They are only the reusable automation primitives the hand-authored move scripts will call.

## Current app integration points

- `components/IsometricGrid.client.vue` already owns the right-click token context menu and existing dialogs for **Modify HP**, **Change combat stages**, and **Deal damage**.
- `pages/maps/[slug].vue` already resolves placements to source Pokémon/trainer sheets and can persist HP and combat stage edits back to sheets.
- `SpawnedPokemon` currently includes HP, combat stats, defender types, combat stages, position, sheet kind, and sheet slug. It does **not** include a resolved move list.
- `TabletopMapV2` currently persists terrain, placements, lights, and initiative only. There is no combat-effect state for statuses, hazards, weather, rooms, move history, frequency usage, or delayed triggers.

## Core requirements

### Move script model

- There must be exactly one script entry for each of the 761 valid canonical moves.
- A missing script for any canonical move should fail a coverage check.
- Each script may reuse shared automation steps, but the script itself is move-specific and owns branching/edge cases.
- Scripts must be versioned so saved logs can be interpreted after script changes.
- Homebrew/custom moves on a sheet must be explicitly automated before they appear in the token move menu.

Suggested shape:

```ts
interface MoveScript {
  moveName: string
  version: number
  run(ctx: MoveAutomationContext): AsyncGenerator<MoveStep, MoveResult, MoveStepInput>
}
```

The important requirement is not the exact TypeScript API; it is that scripts are explicit, testable, and composable.

### Automation UX

- Always make the canonical move card data available: type, class, frequency, AC, DB/roll, range, and full effect text.
- Use map-native target overlays, area confirmations, and immediate self/field resolution instead of a manual resolver modal.
- Ask only context-relevant questions; do not force users through irrelevant generic fields.
- Support branching choices, e.g. `Curse` Ghost vs non-Ghost, `Pollen Puff` attack vs heal, `Thunderous Kick` Fighting vs once-per-scene Electric.
- Support multi-target resolution where each target may hit, miss, crit, resist, trigger a different secondary effect, or receive different damage.
- Support GM override on any computed value.
- Provide an undoable transaction summary before applying changes.

### Required state model additions

Move automation needs persistent encounter state beyond current sheet/map fields:

- Per-token statuses: persistent, volatile, coats, blessings affecting the token, temporary HP, DR/accuracy/damage modifiers, type/form overrides.
- Per-map state: weather, terrain, room/global field conditions, Tailwind-like side conditions, hazards/barriers/smoke with geometry and ownership.
- Per-token/per-move counters: Stockpile, Trump Count, Fury Cutter chain, Rollout/Ice Ball chain, Perish Count, Double Team activations, Substitute HP, move frequency usage.
- Encounter history: last move used, previous round usage, damage taken this round, targets damaged this round, allies fainted recently, CS gained/lost since last turn.
- Trigger queue: interrupts/reactions/shields, delayed end-of-round/next-turn effects, beginning-of-turn ticks.

### Damage and accuracy requirements

The existing **Deal damage** modal is a useful primitive but insufficient by itself. Move scripts need to control:

- Accuracy check, evasion source, AC overrides, cannot-miss, miss effects, effect ranges, critical ranges.
- Damage Base changes from context: weather, terrain, HP %, injuries, weight class, loyalty, status, previous moves, positive CS, Stockpile, etc.
- Alternate offensive/defensive stats: Body Press, Foul Play, Shell Side Arm, Photon Geyser, Secret Sword, Psyshock/Psystrike, Electro Ball.
- Type overrides and special type chart rules: Weather Ball, Terrain Pulse, Revelation Dance, Techno Blast, Hidden Power, Thousand Arrows.
- Fixed HP-loss moves: Seismic Toss, Night Shade, Dragon Rage, Sonic Boom, Psywave, Super Fang, Nature's Madness, Endeavor, Metal Burst.
- Recoil, drain, self-HP costs, self-KO, minimum damage, immunity handling, crit handling, STAB/DB bonuses if the campaign wants those automated.

### Permissions and visibility

- **Use Move** should only appear for controllable tokens, matching current movement/HP permissions.
- Player-controlled tokens can use their own scripts; GM can control all tokens and override results.
- Effects that should be hidden from players need an explicit GM-only/private log option.

### Logging and undo

Every completed move should create a structured encounter log entry:

- user, move, script version, targets/areas, rolls, branch choices, applied state changes, skipped/manual changes.
- Undo should revert the whole move transaction where possible.
- Failed/cancelled automation runs should not mutate state unless explicitly confirmed.

### Testing / coverage

- Registry coverage test: 761/761 valid moves have scripts.
- Each script has at least a smoke test that runs through its map flow with canned inputs.
- Complex scripts get scenario tests for every branch.
- Golden audit should assert the canonical move count remains 761 after filtering the junk explanatory entry.

## Open questions

1. Should automation apply state directly, or should every mutation require a final GM confirmation?
2. Do we want to track full PTU action economy/frequency usage now, or only log warnings initially?
3. Where should persistent combat state live: inside `TabletopMapV2`, a separate encounter document, or sheet-local fields?
4. How detailed should hazard/barrier geometry be on the voxel map?
5. Should players be able to resolve their own damage/statuses, or should the GM approve player move results?
6. What is the expected source of truth for statuses and temporary effects on sheets outside a map encounter?
7. Should move automation account for abilities/features/items immediately, or should first pass expose manual modifiers for them?
8. How should custom/homebrew sheet moves be scripted before they can appear in the automated move menu?

## Current implementation guardrails

The map now has **Use Move** without a manual resolver modal. The token move menu shows all sheet moves, but unautomated/homebrew moves are greyed out and disabled until scripted.

Canonical automation must come only from `EXPLICIT_MOVE_AUTOMATION_SCRIPTS` in `src/utils/moveAutomation.ts` (or future per-move modules imported into that registry). The coverage tool fails while any canonical move lacks an explicit script:

```bash
npm run check:move-automation
```

Until the explicit registry is complete, unregistered moves remain visible but disabled in the map move menu instead of falling back to manual resolution.

## Recommended next implementation area

1. Add explicit script modules in small reviewed batches.
2. Run `npm run check:move-automation` in CI once the explicit registry is expected to be complete.
3. Implement small reviewed areas of deliberately varied explicit scripts: plain attacks, status-only moves, multi-target area attacks, shields/interrupts, weather/terrain moves, and copy/random moves.
4. Continue until every canonical move has a reviewed explicit script.
