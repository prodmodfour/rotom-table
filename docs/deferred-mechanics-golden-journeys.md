# Deferred Mechanics Closure golden journeys

P11-081 certifies three deterministic trusted-table campaign lineages in `data/deferred-closure/integrated-golden-journeys-certification.v1.json`. The lineages are integration acceptance, not a second gameplay engine. Each phase calls or verifies the production authority already owned by equipment custody, Move execution, equipment actions, generic Skill Checks, Encounters, Contests, settlement, and Campaign continuation.

## Journey boundary

Every lineage follows the same ordered handoff:

1. load a seeded campaign and current role authority;
2. resolve exact equipped-item custody;
3. make a server-authoritative ranged attack;
4. execute a source- and rank-gated weapon Move;
5. commit a native or guided equipment action;
6. request, respond to, and resolve a generic Skill Check;
7. continue the Encounter from persisted accepted facts;
8. run a native Trainer Participant or Battle Contest;
9. settle through the existing Encounter and Contest authorities; and
10. load Campaign continuation from fresh persisted authority.

The three campaigns partition all 24 P11-009 mechanics fixtures exactly once: six ranged profiles, seven supplemental weapon Moves, and eleven item actions. They also exercise both native Contest variants, all five existing settlement fixtures, GM and owner authority, opposing-owner isolation, and spectator-safe output. Campaign seeds choose fixture data and feed server-owned deterministic random sources only. A browser never submits a roll, score, damage result, Appeal result, placement, reward, or continuation outcome.

## Authority and retry policy

An accepted receipt or persisted operation is the only input to the next phase. No phase edits another subsystem's document directly. Battle Contest coordination continues to use typed handoffs and the existing combined settlement transaction; ordinary Encounters and Trainer Participant Contests continue to use their existing settlement paths. Persisted realtime publication occurs only after commit.

An exact retry returns the original result and adds no roll, spend, map or sheet mutation, Appeal, Voltage transition, reward, history row, operation row, or realtime row. Changed material remains a conflict. Journey setup may create deterministic seed authority before the first runtime command, but no direct database or JSON repair is allowed after execution begins.

## Privacy

The journey gate reuses structurally distinct GM, current-owner, opposing-owner, and spectator projections. Public and spectator output excludes equipment instance custody, source hashes, sheets, roll journals, private Skill Check prompts and modifiers, Contest planning, team dice, Battle handoff authority, settlement diagnostics, and private rewards. Owners receive only their controlled authority; one owner cannot inspect another owner's sheets, pools, or operation evidence.

## Running the gate

Run the bounded integration command:

```bash
npm run check:deferred-closure-golden-journeys
```

The command verifies exact fixture partitioning, source fingerprints, inventory-row coverage, deterministic Contest outcomes, settlement and continuation handoffs, privacy, exact retries, and representative production runtime suites. It requires no local-host fallback and does not permit direct storage repair.
