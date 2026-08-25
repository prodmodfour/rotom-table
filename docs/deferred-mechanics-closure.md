# Deferred mechanics closure

Rotom Table supports the remaining PTU core mechanics closed by Plan 11 through ordinary liveplay authority. This is not a second rules engine: equipment and Moves use the Encounter runtime, item actions use the equipment/item runtime, Skill Checks use one journaled server document, and both added Contest formats use the existing Contest authority.

## Closed surfaces

| Surface | Current liveplay behavior |
| --- | --- |
| Ranged weapons | Weighted Rope, Slingshot, Throwing Hammers, Hunting Bow, Super Lucky Throwing Stars, and Twin-Needled Bow provide native server-validated range, line of sight, accuracy, damage, usage, accepted history, and exact retry while validly equipped. |
| Weapon Moves | Backswing, Cheap Shot, Double Swipe, Wounding Strike, Bleed!, Bash!, Pierce!, Gouge, Titanic Slam, Bullseye, Deadly Strike, and Triple Threat use the ordinary rank, equipment, action, target, Move, resource, roll, and commit gates. They remain outside the frozen Pokémon Move catalog and cannot borrow Contest identity. |
| Item actions | Light Shield and Heavy Shield ready; Shock Collar activates; Glue Cannon and Hand Net attack; Weighted Nets throw and pull; Old Rod, Good Rod, and Super Rod create bounded fishing adjudication; Snag Machine conversion uses bounded GM adjudication. Every action has native or guided commit, custody, receipt, recovery, and projection behavior. |
| Generic Skill Checks | A GM requests one canonical skill from one through 32 Trainer or Pokémon subjects under a DC or opposed policy. Subjects respond through their own profile authority. The server resolves and journals every d6, modifier, result, correction, operation, and history fact. |
| Trainer Participant Contests | A Trainer and Pokémon enter as one Contest entry under Simultaneous or Alternating policy, sharing the reviewed Pokémon Contest-dice pool while retaining performer-scoped legality, Voltage, history, and role projections. Standard, Supercontest, Festival, and Rotation bases are supported. |
| Battle Contests | Exactly two Trainers declare equal teams of three through six Pokémon and one fixed Contest type. One real Encounter supplies initiative, accepted Moves, KOs, recalls, replacements, and terminal facts; one Contest document owns Appeal, per-Pokémon Voltage, placement, and rewards. |

All twelve supplemental weapon Moves, six ranged profiles, eleven item actions, the Skill Check surface, and both Contest variants are included in this closure. The machine-readable row inventory is `data/deferred-closure/closure-inventory.v1.json`. Runtime identity comes only from app-owned `data/reference/*.json`; documentary books and parser inputs are provenance, never runtime fallback.

## Player workflow

1. Select the Profile that controls the acting Trainer or Pokémon.
2. In an Encounter, choose only a server-offered ranged attack, weapon Move, or item action. Review range, target, action cost, equipment source, and unavailable reason before submission.
3. For a Skill Check, respond only to the request shown for your controlled subject. The browser never rolls or supplies a result.
4. In a Trainer Participant Contest, choose the offered legal Trainer or Pokémon performer and spend only the projected shared dice.
5. In a Battle Contest, continue acting through the Encounter Workspace. When your team owns a pending accepted-Move Appeal, allocate zero through three visible team dice; opponents and spectators receive a wait state, not your pool.
6. If delivery becomes uncertain, retain and retry the exact command. Reload when source, target, roster, or revision changes.

Public and opponent views never receive sheets, Profile IDs, providers, dice journals, private plans, source hashes, placements, handoff receipts, or combined settlement authority.

## GM workflow

### Encounter equipment and item actions

Equip the exact item on the ordinary sheet, place its owner on the live map, and use the Encounter Action Dock. The server determines Wielder rank, hands, minimum/maximum range, line of sight, legal target, resources, rolls, effects, and history. Do not approximate an unavailable action with a direct HP, inventory, effect, or map edit.

Fishing and Snag conversion create bounded private adjudication. Review the request in Campaign work, accept or cancel its issued outcome, and let the terminal receipt apply source disposition. No hook table, species generation, or narrative outcome is inferred by this closure.

### Generic Skill Checks

From the Encounter Director, choose one through 32 current subjects, a canonical skill for each, a public label and private prompt, DC preset/explicit DC or opposed policy, visibility, concealment, modifier, and expiry. Subjects accept or decline. Resolve only after current authority says the check is ready. Public views receive pending counts and permitted aggregate results; subject views receive only their own authority.

### Trainer Participant Contests

Create an ordinary compatible base Contest, select **Trainer Participant**, choose Simultaneous or Alternating, and enroll three through five controlled Trainer/Pokémon pairs. Run the existing Introduction, Performance, intervention, placement, and settlement stages. The Trainer does not receive Pokémon Experience.

### Battle Contests

Create **Battle**, select one Contest type, enroll exactly two distinct Trainers with equal rosters of three through six Pokémon, complete both Introductions, then create/link the Encounter from the Contest workflow. Run combat in the Encounter Workspace. Accepted Pokémon Moves drive Appeal; Struggle Attacks and maneuvers do not. End only on the accepted round boundary at twice the roster size or when one immutable roster is fully at zero HP. Battle placement uses Appeal only. Use the combined settlement: every declared Pokémon receives Contest Experience and every winning team member receives the configured Ribbon. Independent **Finish Encounter** is intentionally blocked for a linked Battle Encounter.

## Contributor authority map

| Concern | Authority |
| --- | --- |
| Closure rows and proof | `data/deferred-closure/closure-inventory.v1.json`, `completion-rubric.v1.json`, `successor-chain.v1.json` |
| Ranged/equipment grants | `data/complete-play-loop/equipment-grants.v1.json`, `shared/itemAutomation/equipment.ts`, Encounter presentation and Move planning |
| Supplemental weapon Moves | `shared/capabilityAutomation/weaponMoves.ts`, reviewed Move handlers/specs, ordinary Encounter command executor |
| Item lifecycle | equipment-action and guided-request repositories/use cases plus role-safe Encounter presentations |
| Skill Checks | `shared/skillChecks/*`, `server/domain/skillChecks/*`, `server/useCases/*SkillCheck*`, schema-v50 repositories |
| Contests | `data/reference/contests.json`, `shared/contests/*`, `server/domain/contests/*`, existing Contest repository/use cases |
| Battle coordination | typed handoffs and receipts in `shared/contests/battle*.ts`; each engine plans its own mutation and the coordinator commits shared transactions |

Do not parse effect prose, create another dice/settlement/realtime engine, trust a browser-authored result, or expose a private document then redact it in the client. Unknown identity, source drift, malformed history, stale reads, and unsupported mechanics fail closed. Exact retries return stored results and add no roll, spend, effect, history, operation, reward, or realtime row.

When a reviewed mutable surface supersedes frozen evidence, add one contiguous accepted edge to `data/deferred-closure/successor-chain.v1.json`; never rewrite historical acceptance data in place.

## Operator workflow

The current application schema is 50. Startup applies contiguous migrations, refuses future versions without writing, and stores Plan 11 equipment-action state (v47), fishing declarations (v48), Snag conversion state (v49), and generic Skill Checks (v50). Trainer Participant and Battle data remain in the existing Contest tables introduced at v46.

Use the stopped-service, closed-SQLite backup procedure in [Private VPS backups](private-vps-backups.md). After restore, verify a representative Skill Check, readied shield/net effect, and linked Battle Contest when present; restart and reconnect GM plus an authorised owner. Never repair SQLite or JSON manually.

Run bounded closure gates before final repository validation:

```bash
npm run check:deferred-closure-golden-journeys
npm run check:deferred-closure-migrations
npm run check:deferred-closure-backup-restore
npm run check:deferred-closure-accessibility
npm run check:deferred-closure-performance
npm run check:deferred-closure-privacy
npm run check:deferred-closure-docs
```

For uncertainty, preserve the exact command and query/retry its operation status. Reconnect reloads server projections. Post-commit realtime publication failure never authorizes replaying a mutation with changed material.

## Detailed references

- [Complete Play Loop contributor guide](complete-play-loop-contributor-guide.md)
- [Complete Play Loop operator guide](complete-play-loop-operator-guide.md)
- [Complete Play Loop GM guide](complete-play-loop-gm-guide.md)
- [Complete Play Loop player guide](complete-play-loop-player-guide.md)
- [Skill Check recovery and campaign history](skill-check-recovery-and-campaign-history.md)
- [Trainer Participant Contest runtime](contests/trainer-participant-runtime.md)
- [Battle Contest runtime](contests/battle-contest-runtime.md)
- [Deferred Mechanics Closure golden journeys](deferred-mechanics-golden-journeys.md)
- [Deferred Mechanics Closure storage upgrades](deferred-mechanics-storage-upgrades.md)
