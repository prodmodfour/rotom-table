# Battle Contest runtime

## Status

Battle Contest is a **native** Contest variant after the ordered P11-065 through P11-080 cohort certified its dual-engine blend contract, two-Trainer setup and Introductions, atomic handoff into the existing live Encounter authority, source-bound accepted-Move Appeals, canonical Effects, per-Pokémon Voltage and lifecycle consequences, post-KO replacement scoring, authoritative endings, single-spend/randomness convergence, coordinated recovery, combined settlement, joined liveplay cockpit, and deterministic minimum/maximum fixture matrix. Native activation changes only the reviewed canonical completion state; it does not add another mechanics engine or relax any source, privacy, retry, or transaction boundary.

Runtime mechanics read only app-owned canonical JSON. Documentary books and migration inputs are provenance, never runtime authority.

## Two-Trainer setup

The GM can create a Battle Contest from the existing Contest Workshop with one fixed Contest type. Setup then accepts exactly two distinct Trainer teams under ordinary sheet and controller authority:

- the first accepted team declares 3–6 distinct, independently eligible Pokémon;
- its count becomes the immutable shared `declaredPokemonPerTrainer` while either team remains enrolled;
- `roundBudget` is server-derived as exactly twice that count, producing 6–12 rounds;
- the opposing team must declare exactly the same Pokémon count;
- a selected player profile must currently control the Trainer and every enrolled Pokémon, reusing existing controller consent authority;
- GM control remains an explicit GM-authorised controller choice;
- Pokémon combined through Letter Press or disassembled as Zygarde cells fail existing independent-actor eligibility;
- duplicate Trainers, duplicate Pokémon, a third team, client-authored round budgets, and Contest rotation orders fail closed.

Removing the only accepted team resets the declaration so a new first team may establish another legal size. Removing one of two teams preserves the shared declaration for the remaining team. Locking setup transitions to Introduction only when both complete equal teams are present, with no roll or resource spend during setup.

Public setup projections expose only the derived count/budget and sanitized Trainer/team display identity. Sheet slugs, profile IDs, providers, pools, operation IDs, hashes, diagnostics, and GM notes remain outside public and player projections. GM authority retains exact snapshots needed to edit setup.

The accepted two-frame target storyboard is `.pi/artifacts/ui-storyboards/battle-contest-setup/`: first-team state `f01-gm-first-team/v002.png` scored 10/10, ready state `f02-gm-ready/v002.png` scored 9/10, and the flow continuity review passed with no hard failure.

## Trainer-team Introductions

After setup locks, each Trainer makes exactly one ordinary canonical social-Skill Introduction. The Trainer's frozen Skill rank and retained Trainer-owned Introduction providers assemble the roll. Pokémon-only abilities, held accessories, grooming state, and other arbitrary roster-member providers are not unioned across the team.

Each successful die generates a Contest Stat Die into one `teamDicePools` authority owned by that Trainer's entry:

- generated dice are written once at team level and are never copied into the three-through-six Pokémon preparation pools;
- any enrolled Pokémon on that exact team may later spend the shared dice;
- a replay-safe `battle-trainer-team` receipt records the acting Pokémon, operation, per-stat spend, and contiguous before/after pool state;
- an exact operation retry returns the original receipt, while changed identity, changed dice, overspend, an opponent Pokémon, or a discontinuous receipt chain fails closed;
- restarting Introductions removes only the superseded Introduction contributions and retains immutable roll provenance.

Battle Introductions assign no Contest letter, position, or turn order and grant no Standard matching Appeal. After both Trainers are accepted, the document remains in Introduction until the GM uses the dedicated Encounter-link handoff; ordinary `start-performance` is rejected atomically.

Public projections retain only sanitized team identity and stage state. The GM sees both exact pools; an owning controller sees only their own team authority, never the opponent pool. Sheet/provider identities, operation IDs, diagnostics, GM notes, and exact roll journals remain outside public history and opponent views.

The accepted storyboard is `.pi/artifacts/ui-storyboards/battle-contest-introductions/`: pending frame `f01-gm-first-introduction/v002.png` and ready frame `f02-gm-pools-ready/v001.png` both scored 10/10; the flow continuity review passed with no hard failure.

## Linked Encounter creation

After both Introductions are accepted, the GM may issue exactly one `create-battle-encounter` command. The command contains only ordinary Contest identity, revision, operation identity, and client identity. It cannot carry a map slug, Encounter identity, placement, deployed Pokémon choice, Scene, initiative, side, reserve, or turn-order claim.

The shared coordinator re-reads the Contest and every enrolled ordinary sheet, then obtains document-local plans from existing authorities:

1. the immutable link identity, derived Encounter identity, unique map slug, and SHA-256 of the exact accepted two-team roster snapshots are server-derived;
2. a new setup-planned battlefield receives two normal Encounter sides, both Trainers, and the first accepted roster Pokémon from each team; the other Pokémon remain unplaced ready reserves;
3. the existing Scene lifecycle authority starts one Scene and applies any ordinary Scene-start sheet effects;
4. `initiativeOrderIdsForPlacements` derives the ordinary current-Speed order across the four deployed combatants, with Round 1 and its first placement active;
5. an active `trainer-duel` `EncounterDocument` records both Trainers in its cast and all 6–12 Pokémon in ordinary reserve authority, including the two deployed entries;
6. the same parsed opening binding is written to `ContestDocument.battle.encounter` and `EncounterDocument.battleContest`, and the Contest advances from Introduction to Battle Performance with no Contest letter or turn cursor; and
7. the map is published in `live-play` interaction mode, so every later placement, switch, initiative, and Scene mutation must use certified liveplay commands rather than whole-map setup writes.

Map creation, interaction mode, Scene-start sheet writes, Encounter creation, both copies of immutable link evidence, Contest revision/operation, and durable realtime rows commit in one SQLite transaction. The coordinator re-reads the exact Encounter document, binding, roster placements, sides, Scene, active initiative, and live interaction mode before commit. Any missing sheet, stale sheet read, duplicate derived authority, malformed plan, persistence failure, or re-read mismatch rolls back every map, mode, sheet, Encounter, Contest, operation, and realtime write.

An exact operation retry returns the original Contest result without creating another map, Encounter, Scene, reserve roster, initiative state, or realtime batch. Reusing the operation identity with changed input fails closed. Relinking under a second operation is unavailable after the immutable transition.

Role-safe Contest projections expose only the linked cockpit destination (`encounterId` and map slug), opening round, deployed count, and ready-reserve count. Roster hashes, link IDs, Scene identities, exact initiative order, sheet slugs/revisions, providers, operation identities, diagnostics, pools, and GM notes remain absent from public and opponent projections. GM and owning-controller Workshop views retain their already-authorised team pools; spectators receive no pool object.

The accepted two-frame target storyboard is `.pi/artifacts/ui-storyboards/battle-contest-encounter-link/`: ready-to-link frame `f01-gm-ready-to-link/v002.png` and accepted-link frame `f02-gm-linked/v002.png` passed autonomous review, and the continuity/contact-sheet review found no hard failure.

## Blend boundary

`battle-contest-blend:v1` joins, but does not merge, the existing engines:

- `ContestDocument` owns rosters, team Contest Dice, appeal scoring, per-Pokémon Voltage, placements, and Contest settlement.
- `EncounterDocument` owns encounter identity, its linked battlefield, lifecycle, and reserves.
- The linked map owns accepted combat mechanics, including Move resources, results, initiative, encounter history, switches, and knockouts.
- The blend link is coordination evidence only. It owns no combat, dice, scoring, or reward semantics.

The strict shared contract is `shared/contests/battleBlend.ts`; its reviewed machine-readable policy is `data/deferred-closure/battle-contest-blend-contract.v1.json`.

## Immutable link

A link has one `battle-contest-link:v1:<stable-id>`, one Contest ID, one Encounter ID, one linked map slug, and the setup roster hash. Relinking is rejected. Performance cannot begin until the linked authorities and roster fingerprint agree.

The coordinator may persist link evidence. The Contest engine cannot write Encounter documents or maps, and the Encounter engine cannot write Contest documents. Structural write-plan validation rejects a cross-boundary write with `battle-contest.cross-document-write`.

## Server-derived handoffs

Only persisted accepted liveplay operations and matching typed encounter history may produce handoffs. No client endpoint accepts a handoff, roll, hit, knockout, switch, or scoring claim.

The closed handoff union is:

1. `accepted-move`
2. `knockout`
3. `switch`
4. `turn-start`
5. `round-boundary`
6. `encounter-ended`

Each fact has a stable handoff ID, accepted source-result ID, complete source-result SHA-256, and scoring-relevant typed payload. Its handoff SHA-256 covers canonical fact JSON but excludes the refreshable revision read set. This permits a fact to be re-derived at a newer unrelated map revision without changing its identity or evidence.

Accepted Move facts retain the exact resolution, completion event and order, Scene/round, actor placement, canonical Move identity and spec version, action economy, provenance, targets, semantic outcome, and branch selections. Encounter authority classifies the source as `pokemon-move`, `struggle-attack`, or `combat-maneuver`; Contest policy excludes the latter two. Missing or unbound source authority fails closed.

## Accepted Move Appeal Rolls

Every newly accepted primary `resolveMove` result now records one bounded declaration/completion row in the map-owned typed encounter history. This Encounter-engine transition does not read or write a Contest. It preserves the existing action-resource and consecutive-Move authorities rather than applying either a second time.

`scoreBattleContestAcceptedMoveUseCase` is the server-only causal coordinator ingress; the public Contest command endpoint rejects its internal command kind. Its input names only the Contest revision, persisted liveplay operation, matching resolution, and optional Trainer-team Contest Dice spend. It accepts no client-authored map, result, roll, hit, actor, target, Scene, round, Move, or initiative material.

Before a roll, the coordinator proves all of the following from stored authority:

- the operation is accepted on the immutable linked map and its command is exactly `resolveMove`;
- the command actor/Move, accepted `move.state` patch, mechanics-free accepted presentation, patch-owned typed history row, and current map history row all bind the same operation, resolution, actor, canonical Move, runtime version, targets, and outcome;
- the current map Scene and map/EncounterDocument/Contest revisions still match one read set;
- the actor placement is a Pokémon currently placed on the matching immutable Battle side; and
- the enrolled Contest snapshot contains exactly one available app-owned canonical Contest option for that Move.

A miss still produces its ordinary Appeal Roll because the Move was performed. The Contest engine assembles and journals the roll from the frozen Move Contest type/effect, fixed Contest type, and optional shared Trainer-team dice. Any enrolled Pokémon on the acting team may spend that pool; the Appeal and pool receipt share the deterministic Contest operation identity. Struggle Attacks produce an immutable `canonical-exclusion` receipt with no roll or spend. Combat-maneuver operations cannot satisfy the accepted-Move source contract and never enter scoring.

## Battle Contest Effects and Pokémon Voltage

P11-070 replaces the former pre-Effect compatibility behavior for newly consumed Moves. It reuses the same handler-backed catalog and Appeal scorer as ordinary Contests for all 22 reviewed Effect identities; the Battle variant row carries the exact supported inventory and an `unknownEffectPolicy` of `reject`. Catalog drift or an accepted Move without a reviewed handler fails closed rather than parsing rule prose or silently choosing ordinary stage adjacency.

Battle adjacency comes only from current linked-map placements. Every enrolled opposing Pokémon presently on the field is an adjacent Effect/assembly target, from one through the six-member roster bound. The Contest Appeal stores the opposing Trainer-team identity plus exact internal performer targets and the map revision used by the handoff receipt. Those performer targets are stripped from public and owner-opponent Appeal projections.

The shared handler is supplied explicit Battle target scopes:

- actor Voltage targets only the acting Pokémon;
- adjacent Voltage targets every opposing on-field Pokémon independently, with canonical zero/five caps;
- Sabotage and Tease assign indirect Fumble once to the opposing Trainer-team score;
- Saving Grace protects the same active Pokémon for the accepted Encounter round, and a multi-active team is protected from indirect team Fumble only when every targeted active Pokémon has protection;
- Get Ready applies to the same Pokémon in the next Encounter round; Reliable reads that Pokémon's previous accepted Move; and all round-relative checks use the persisted Encounter round; and
- Center of Attention uses the existing ordinary center scoring table exactly when typed Encounter history proves that the acting Pokémon is a post-KO replacement on its first acting turn.

P11-071 makes `performerVoltages` an exact zero-through-five ledger for every enrolled Battle Pokémon while the legacy shared-team `voltage` field remains zero. Appeal assembly reads only the accepted acting Pokémon and exact opposing on-field performer list; reserves retain their own values without contributing. Canonical actor, adjacent, terminal, and Attention Grabber transitions are reconciled in Appeal order against immutable consequence evidence. Any altered target, starting value, assembly, consequence, terminal value, or final ledger fails document validation.

Spectators receive display names and current per-Pokémon values only. They do not receive performer IDs, sheet slugs, option/provider IDs, adjacent performer identities, team pools, journals, operation IDs, or handoff hashes. Owners additionally receive exact authority only for their own entry; GMs receive full Contest authority, and handoff/source hashes remain diagnostic-only. Historical P11-069 Appeals with empty adjacency remain readable as explicitly legacy pre-Effect evidence and are never retroactively re-scored.

The Contest write adds exactly one Appeal journal entry (or exclusion), one source-bound handoff receipt, an optional contiguous team-pool spend, one revision, one operation result, and durable Contest realtime rows. It never writes the EncounterDocument, linked map, Scene, initiative, liveplay operation, combat resource, or sheet. The coordinator re-reads the EncounterDocument, whole map, and accepted operation before the Contest write; changed authority or an injected Contest/realtime failure leaves the Contest, receipt, roll, pool, operation, and realtime log unchanged while preserving the already accepted Encounter Move for retry.

Exact replay uses the deterministic operation ID derived from Contest/source-operation/resolution identity and returns the original journaled result without rerolling or spending again. Changed spend under that operation conflicts. Public accepted-Appeal projections omit Contest operation IDs, dice-journal IDs, correction IDs, handoff/source identities, and hashes; full handoff receipts are diagnostic-only.

## KO, damage-over-time, and recall Voltage

P11-072 consumes only typed map-owned `move-ko`, `lifecycle-ko`, `switch`, and `recall` history established by persisted accepted liveplay operations. The server-only `applyBattleContestVoltageLifecycleUseCase` accepts only a Contest revision, root operation ID, and exact history event ID. It reconstructs the command hash, accepted patch, current history row, active Scene and round, immutable teams, source/target placements, and current opposing active Pokémon. Cause, actor, recipient, delta, Move identity, Feature provider, and exception are never accepted from a client.

The Contest-owned consequence policy is exact and capped from zero through five:

- an opposing Pokémon knocked out by an accepted attack grants **+2 Voltage** to the attacking Pokémon;
- a `direct-hp` lifecycle loss that crosses positive HP to zero records a typed damage-over-time KO and grants **+2 Voltage** to the knocked-out team’s single opposing active Pokémon;
- recalling a Pokémon removes **2 Voltage**, including a zero floor; and
- Baton Pass, U-Turn, Volt Switch, and a typed reviewed `feature:Quick Switch` or `feature:Round Trip` provider preserve the recalled Pokémon’s Voltage.

Accepted primary native and legacy Moves emit immutable KO history from server-observed HP transitions. Initiative lifecycle operations emit a separate causal KO event carrying the exact triggering round and effect operation, so residual KOs are not inferred from final HP. Switch history retains a nullable server-authored Feature provider; historical rows normalize it to null, unknown providers receive no exception, and runtime display prose is never parsed.

Each consequence advances the Contest by one revision and appends one ordered per-Pokémon lifecycle entry, one `lifecycle-applied` handoff receipt, one public-safe history line, one operation result, and `contest.voltage.changed` realtime events. Exact retries return the original evidence without another delta; changed material conflicts. Document validation replays every transition against prior Appeals and lifecycle entries, including caps, exception identity, source order, and final Pokémon ledgers. Spectator, owner, and ordinary GM projections omit lifecycle source IDs, providers, operations, placements, and hashes; only the diagnostic projection carries raw lifecycle evidence. The coordinator writes no Encounter or sheet authority.

## Post-KO replacement Center of Attention

P11-073 derives replacement status from typed Encounter facts rather than Contest state or client claims. An authoritative Pokémon recall/delete records the fainted placement and side, a later same-side send-out pairs with exactly one unused `move-ko` or `lifecycle-ko`, and the first accepted `turn-start` for that replacement closes the relation with its exact Encounter round and turn. Ambiguous KOs, missing sides, unmatched recalls, ordinary switches, and unrelated send-outs create no replacement authority.

When an accepted Move is scored, the server reconstructs the operation-owned `move.state` patch and current linked-map history. The `accepted-move` handoff carries bounded replacement evidence only when the Move actor, current turn actor, completion round, replacement placement, KO event, send-out event, and first-turn event all agree in both authorities. No scoring endpoint accepts a Center flag, replacement identity, KO, side, round, or turn from a client.

The Contest engine passes that derived boolean into the same `scoreContestAppealResults` function used by ordinary Contests. On the first acting turn, each ordinary result uses the canonical center table—including its one-result Fumble behavior and Effect-specific scoring interactions. Later acting turns use the normal table. The accepted Appeal stores the public-safe `centerOfAttention` result, while KO/send-out/turn event identities remain only in transient hashed handoff material and never enter public, owner, or ordinary GM projections. Document validation recomputes Appeal and Fumble deltas from immutable journal results and rejects a changed Center flag.

Presence events and their bounded history are Encounter-owned map writes. Appeal dice, score, receipt, revision, operation, and realtime rows remain Contest-owned writes. Exact accepted-Move retries return the original center-scored Appeal without another roll or spend, and a changed source relation changes the handoff hash and conflicts.

## Battle end conditions

P11-074 ends a linked Battle Contest through the server-only `endBattleContestUseCase`. Its request identifies only the Contest revision, one persisted liveplay operation, and one typed source-result event. It accepts no client-authored condition, round, HP, score, placement, winner, Scene, map, or mechanics material.

The two canonical end paths are source-bound independently:

- **Round budget exhausted:** an accepted `nextInitiative` operation must carry exactly one initiative patch whose Encounter state and current map history contain the same completed `round-end` plus following `round-start`. The completed round must equal the immutable setup-derived budget and the resulting initiative must be the next round.
- **One Trainer's entire roster knocked out:** the source must be one accepted typed Move or lifecycle KO with canonical ancestry. Its target must belong to exactly one immutable Battle team, and a same-transaction read of every enrolled Pokémon sheet must show that the target's complete team is at zero HP or below. A single KO while a reserve remains conscious does not end the Contest.

The Contest engine then moves Performance to Settling exactly once, sets the ending Encounter round, uses each Trainer team's accumulated **Appeal points without subtracting Fumble**, and reuses the ordinary journaled placement tie resolver. The highest Appeal-point total is placement 1. One `contest-ended` handoff receipt and matching public-safe history row bind the source; document reconciliation rejects missing, duplicate, changed, or score-forged terminal evidence.

The coordinator re-reads the Contest, Encounter Document, whole linked map, source operation, and—for roster knockout endings—every Pokémon sheet before commit. It writes only the Contest document, placement tie journal when needed, Contest operation, and `contest.performance.completed` realtime rows. Encounter and sheet authority remain unchanged. Exact retries neither retally nor reroll; changed source material conflicts. Public and owner projections expose final scores and placements but never HP reads, source operation/event IDs, read sets, handoff hashes, Scene identity, or private team authority.

## Single-spend and convergent randomness

P11-075 adds a mandatory read-only accounting reconciliation before any accepted-Move Contest consequence commits. `assertBattleContestSingleSpendConvergence` compares the exact persisted Encounter operation and Move patch with the candidate Contest document and handoff receipt; it calls neither engine and writes neither authority.

For every accepted primary Move, acceptance now requires:

- exactly one persisted `move.state` patch and one source-bound Contest receipt;
- exactly one map frequency increment for EOT, Scene, or Daily Moves (and, for Daily Moves, exactly one authoritative Pokémon-sheet `moveUsage` write reference), while untracked frequencies gain no usage;
- exactly one increment of the Move's canonical Encounter action resource;
- one immutable hash of the Encounter roll ledger and its natural draw count;
- exactly one Contest Appeal and its operation-bound roll lineage for an ordinary Pokémon Move, or zero Appeal/rolls for a canonical Struggle exclusion;
- zero or one Trainer-team Contest Dice receipt whose stat-by-stat spend equals the Appeal exactly; and
- one canonical convergence digest over both engines' immutable journal material.

A first delivery must add exactly one Contest revision, receipt, Appeal/roll lineage, and optional pool spend. A duplicate handoff returns the original receipt and convergence digest without drawing randomness. An operation retry after reconnect is served from durable operation state and likewise performs no roll or spend. Changed frequency/action deltas, missing or extra receipts, changed Contest random lineage, duplicate team-pool spends, or a mismatched handoff fail with `battle-contest.accounting-divergence` before the Contest write. Existing command-hash, source-result hash, document replay, and final whole-authority rereads remain additional independent gates.

The proof deliberately does not copy Encounter rolls or resources into public Contest state. Encounter operation/roll/frequency/action authority stays in the linked map and operation store; Contest Appeal, dice, spend, and receipt authority stays in `ContestDocument`. Public, owner, and ordinary GM projections continue to omit both engines' operation IDs, journal IDs, source hashes, and convergence material.

## Revision and idempotency coupling

Immediately before Contest commit, the coordinator re-reads and validates:

- immutable link identities;
- exact Contest revision;
- exact EncounterDocument revision;
- exact linked-map encounter revision; and
- exact encounter Scene identity.

A stale read commits no score, spend, journal, receipt, operation, or realtime row. Stable conflict codes distinguish the stale authority:

- `battle-contest.contest-revision-stale`
- `battle-contest.encounter-document-revision-stale`
- `battle-contest.encounter-revision-stale`
- `battle-contest.encounter-scene-stale`

Contest operations retain ordinary operation-ID plus canonical-command-hash idempotency. The Contest document also records one receipt keyed by handoff ID, source-result ID, and handoff SHA-256. An exact duplicate returns the original receipt with no reroll, Contest Dice spend, encounter resource spend, or revision. Reusing an identity with changed fact material fails with `battle-contest.handoff-conflict`.

## Atomicity policy

An ordinary Move-to-Appeal transition is deliberately causal:

1. The Encounter engine atomically accepts the Move and spends encounter resources.
2. The coordinator derives and revalidates an immutable handoff.
3. The Contest engine atomically commits scoring, Contest Dice, journals, receipt, operation result, and realtime evidence.

A later Contest failure never rolls back an already accepted encounter action. It leaves one unconsumed fact for exact retry. The encounter is not replayed and its resources are not spent twice.

A transition that genuinely needs both engines—link activation, terminal reconciliation, or a bounded correction—must first obtain document-local plans from each engine. A shared coordinator then commits all owned plans in one database transaction or commits none. This is not a distributed two-phase commit, and neither engine calls the other engine's repository.

## Interruption, restart, correction, and cancellation

Once a Battle Contest is linked, pause, resume, bounded correction, and cancellation are no longer Contest-only mutations. The coordinator loads the current Contest document, Encounter document, linked map revision, and active Scene; verifies the immutable binding and the complete prior recovery-receipt sequence; and obtains one local plan from each document owner. Both plans append the same immutable recovery receipt, advance their own revision exactly once, and commit with the Contest operation and both realtime records in one SQLite transaction. A failure at either document write rolls back both revisions, both receipt copies, Contest history, operation state, and publication.

A pause changes `ContestDocument.paused` to true and the linked Encounter document lifecycle from `active` to `paused`. A resume performs the exact inverse without changing round, initiative, placements, accepted Appeals, journals, resources, or scores. New live-play commands against that map fail before map planning while the linked pair is paused. Exact retries of operations accepted before the pause are looked up before this gate, so uncertain clients can still learn their durable result without replaying mechanics. A server process restart reconstructs the same state from the two persisted receipt sequences; no in-memory continuation token or random state is needed. Already accepted Encounter facts may finish their server-owned Contest handoff while paused, preventing an in-flight accepted Move from becoming orphan authority, but the pause gate admits no new map mutation.

A non-cancellation correction requires both documents already paused. Appeal, Fumble, Trainer-team Contest Dice, whole-roster controller, and exact-Pokémon Voltage corrections remain bounded by the existing canonical validators and preserve journaled dice. Battle Voltage corrections must name one enrolled Pokémon performer and replay in history order with accepted Appeal and KO/recall Voltage evidence. Corrections at Settling recompute Battle placement from Appeal points only; Fumble remains visible but never enters the Battle final score. Each correction increments the Encounter document as a coordination write even though it does not rewrite Encounter mechanics, making the exact read boundary durable in both authorities.

Cancellation closes Contest scoring, clears unresolved Contest scope, and leaves the linked Encounter at a safe paused boundary in the same transaction. No later map command is accepted except the existing GM encounter-end command; the Encounter Director may then advance only from paused to completed and from completed to archived. It cannot independently reactivate a Battle-linked Encounter or bypass the coordinator. The immutable link and matching receipts remain for audit rather than being detached or repaired manually.

Every recovery receipt binds the operation, link, Contest before/after revisions, Encounter-document before/after revisions, current map revision, active Scene, lifecycle before/after, optional exact correction target, canonical intent digest, and timestamp. The full receipt is diagnostic-only. Public and owner projections receive only safe history wording and current lifecycle/score state. A missing, reordered, changed, or one-sided receipt fails closed as `battle-contest.recovery-orphaned`; stale Contest, Encounter-document, map, Scene, lifecycle, no-op, and correction-without-pause cases use distinct stable `battle-contest.recovery-*` conflicts.

The Phase 1 dual-engine fixtures remain executable recovery baselines: stale Contest and Encounter revisions write nothing, an exact duplicate handoff applies once, and an injected cross-document failure leaves both linked revisions and all scoring/reward/history evidence unchanged.

## Combined Battle settlement

P11-077 extends the existing Contest reward settlement and Finish Encounter settlement rather than adding a third reward engine. Once one source-bound Battle ending has assigned Appeal-only placements, `prepare-settlement` obtains the exact current Encounter settlement draft and atomic plan under the immutable Battle link. A private `battleCoordination` preview binds the Contest reward package, Encounter settlement identity and expected revision, opaque Encounter operation, plan SHA-256, link, map, and preparing Contest operation. The ordinary Finish Encounter ingress rejects a Battle-linked Encounter, so a GM cannot commit Encounter consequences or rewards separately and leave Contest rewards pending.

The reviewed Battle settlement policy applies the ordinary Contest Experience formula to the team placement and each declared Pokémon's own Level. Every 3–6 Pokémon on both immutable rosters receives that canonical amount, including a declared reserve that did not take a combat turn. Every declared Pokémon on the winning team receives the configured Ribbon, while one Trainer result records the complete team. Declared money goes to the winning Trainer and an explicitly targeted item may name only an enrolled Trainer. Encounter-owned HP, Injury, condition, capture, inventory, objective, stake, phase, temporary-state, and cleanup consequences remain in the existing Encounter plan. Non-null Battle stakes close from the source-bound Contest ending with fixed server-owned outcome evidence rather than another client decision.

At commit, the coordinator reconstructs the exact prepared Encounter plan and reauthorizes its complete current read set. It rejects stale Contest, Encounter, map, Scene, campaign-clock, sheet, inventory, settlement, or plan authority before rewards. It also rejects a pre-existing Contest result or Ribbon without a matching combined receipt as orphan evidence. The existing Encounter settlement repository applies its Encounter/map/sheet/group/history/attention/realtime plan, then the existing Contest reward writer applies Experience, Ribbons, Trainer results, money, and items against the resulting current sheet revisions. Both nested local plans remain inside one outer SQLite transaction. The Contest engine receives the accepted combined receipt only after all final Contest sheet revisions and hashes are known, then commits the terminal Contest document, operation, and realtime rows. An exception after Encounter writes, after Contest reward writes, after either document, after either operation, or before commit rolls back every consequence, reward, sheet revision, history/attention row, operation, receipt, and realtime row.

The accepted coordination receipt retains the exact Encounter result digest and revisions plus every final Contest sheet revision/hash. It is private diagnostic authority. Public, owner, and ordinary GM settlement summaries expose placement, score, per-roster-member Experience amounts, Ribbon flags, declared prizes, target contestant identity, and progression-review count only. They omit Trainer/Pokémon sheet slugs, attention IDs, Encounter settlement IDs, operation IDs, plan/result hashes, final sheet hashes, and combined receipt material.

An exact `commit-settlement` retry first resolves the durable Contest operation, then verifies the accepted coordination receipt against the durable Encounter settlement operation and result. It returns the original completed projection without another Experience award, Ribbon, Trainer result, money/item grant, Encounter consequence, sheet revision, history row, attention source, random draw, or realtime event. Changed command material conflicts; a missing or mismatched journal/receipt fails closed rather than attempting repair. The Phase 1 `dual-engine-interrupted-settlement` fixture is therefore realized with zero Contest rewards, zero Encounter rewards, zero sheet writes, and zero history rows after an injected pre-commit interruption.

## Joined liveplay cockpit

P11-078 keeps the existing Encounter Workspace as the only tactical surface and joins a role-safe Battle Contest projection to its decision/history rail. The persistent scoreboard shows both Trainer teams' Appeal totals and all six declared Pokémon's public Voltage, including ready reserves without implying that they are deployed. A GM receives value-only summaries for both Trainer-team dice pools; a competing owner receives only their own value-only pool; a spectator receives no pool object or placeholder. Provider contributors, sheets, placements, source/result identities, operation IDs, link evidence, hashes, and diagnostics never enter the joined response.

After each map revision or Contest realtime event, the cockpit asks the server to reconstruct the earliest unconsumed typed handoff from persisted accepted Encounter operations and exact map-owned history. Server-owned KO, recall, exclusion, and terminal consequences can synchronize without client-authored mechanics. An ordinary accepted Pokémon Move with remaining team dice creates one blocking choice showing the accepted Pokémon and Move plus five bounded 0–3 allocation controls. Only the GM or that whole-roster controller may submit; every other projection receives the explicit wait state “{Trainer} is choosing Contest Dice.” The client sends only the Encounter lookup, expected Contest revision, and five stat amounts. The coordinator supplies source operation/result/resolution identities privately, reruns all existing handoff validation, and invokes the existing Contest scoring use case.

The central live-play command executor checks the same persisted authority after durable exact-retry lookup and before new Encounter planning. While any unconsumed Battle handoff exists, a new map command fails with `Contest Appeal must settle before the next Encounter action.` This closes the response-time race between a Move's accepted map event and the next client refresh. The original accepted Move can still be retried from the durable operation store. Once scoring and any automatic follow-up handoffs converge, the action dock and initiative controls reopen without a page refresh. A stale visible initiative order may be refreshed once from the server-returned authoritative precondition under a new operation identity; no client order is invented.

A score request whose response is lost retains the exact expected revision and allocation locally. Retrying it verifies the already accepted receipt and stored Contest command, returns the current role-safe projection with `exactRetry: true`, and performs no roll, spend, score, revision, or realtime write. A changed allocation or a decision that now belongs to another controller conflicts. Contest realtime subscription updates GM, acting-owner, opposing-owner, and spectator clients from the same durable result; the UI never applies an optimistic score.

On desktop the Contest rail remains beside the tactical stage and the blocking Decision uses the stage's existing decision layer. At narrow widths the existing Battle/Participants/Decisions navigation remains keyboard-sized, while a compact stage summary retains both team scores and all six Voltage values immediately above the wait/decision card. Every status combines text and shape with color, focus moves to the new decision heading, plus/minus and commit targets meet the 44-pixel policy, reduced-motion behavior is inherited, and ordinary Encounter controls expose their disabled state while the choice is pending.

## Native activation and final certification

P11-080 activates `battle` only after the complete P11-065–P11-079 predecessor chain and final executable certification agree. `contestVariantIsNative('battle')` and the ordinary Workshop native filter now recognize the row directly; the temporary structured-setup exception is removed. The reviewed activation migration changes only `variants.battle.completionState` from `structured` to `native`, binds exact before/after bytes and hashes, and retains every structured semantics field unchanged.

Final certification resolves every cohort authority and evidence hash through contiguous accepted successors. It combines the four deterministic 3/6-Pokémon fixtures with role-structural projection checks, GM/owner/opponent/spectator production convergence, the existing 250 ms projection budget, persisted realtime delivery, handoff and combined-settlement exact retries, single-spend accounting, restart recovery, and zero extra Contest or Encounter consequences. Any missing cohort, stale fixture, private-field leak, duplicate result, non-native canonical row, or reintroduced structured-only gate fails the certification.

## Deterministic Battle fixtures

P11-079 adds `data/contests/battle-contest-scenarios.v1.json`, generated byte-for-byte by `scripts/generate_battle_contest_fixtures.ts`. Its four seeded scenarios cross minimum and maximum team sizes (three and six Pokémon per Trainer) with both terminal paths (round-budget exhaustion and a complete roster knockout). Every scenario starts through the ordinary Battle setup, Introduction, and Encounter-link commands, then invokes the existing accepted-Move Appeal, Voltage lifecycle, and Battle end functions. The generator contains no second scorer, Voltage reducer, placement resolver, or Encounter simulator.

The fixture scripts include ordinary recalls, Baton Pass and U-Turn exceptions, attack and damage-over-time knockouts, reserve send-outs, accepted Moves, one complete terminal handoff, and the immutable roster-size-times-two round budget. Expected evidence pins each accepted roll and Appeal delta, Trainer-team Appeal total, per-Pokémon zero-through-five Voltage, team-pool remainder, lifecycle transition, complete knocked-out roster, Appeal-only final score, placement, winner, receipt counts, terminal round, and a unique canonical evidence digest. A final knockout that establishes the all-roster terminal condition is consumed by the terminal coordinator; prior nonterminal knockouts exercise the separate Voltage lifecycle handoff exactly as liveplay does.

The fixture file records exact SHA-256 fingerprints for canonical Contest and Move data plus the accepted P11-078 predecessor. Tests resolve each recorded hash only through contiguous accepted successor edges. `npm run check:battle-contest-fixtures` reruns all four scenarios against current authority and fails unless the generated bytes match exactly; reviewed authority changes require explicit regeneration and successor evidence rather than silent expectation edits.

## Privacy

Public and owner projections never include source-result hashes, handoff hashes, recovery receipt IDs or intent hashes, operation hashes, exact read sets, provider identities, diagnostics, or an opponent's private Contest Dice plan. The GM may receive link health and pending-handoff counts; exact hashes remain diagnostic-only.

## Acceptance

P11-065 focused contract tests prove strict linkage and all six handoff shapes, canonical hashing, exact stale-side error codes, exact retry/conflict behavior, and the no-cross-document-write rule. P11-068 focused binding, runtime, projection, component, and liveplay evidence covers minimum and maximum rosters, current-Speed initiative, active Scene and live-mode creation, exact retry, client-forgery rejection, role privacy, and injected Encounter/Contest write rollback. P11-069 runtime and contract tests cover accepted success and miss scoring, canonical Struggle/maneuver exclusion, exact team-pool custody, immutable source/result hashing, server-only ingress, stale re-read rejection, exact replay without reroll, and Contest/realtime rollback without Encounter mutation. P11-070/P11-071 tests cover the complete 22-handler inventory, singular and plural linked-map adjacency, direct and indirect target scopes, Attention Grabber transfer, Saving Grace protection, terminal effects, canonical consequence forgery rejection, exact roster ledgers, active-only assembly, and spectator/owner/GM privacy. P11-072 adds accepted attack-KO and Hail lifecycle-KO liveplay journeys, capped/floored recall transitions, all reviewed exception identities, typed Feature-provider propagation, source/retry conflict rejection, ledger forgery rejection, and projection sanitization. P11-073 adds an accepted attack-KO → recall → reserve send-out → first-turn Move journey, lifecycle-KO replacement pairing, canonical center-table scoring, later-turn expiry, exact retry, score-forgery rejection, and source-identity projection privacy. P11-074 adds deterministic six-round exhaustion and accepted final-team-KO journeys, incomplete-roster rejection, Appeal-only winner tallying, terminal receipt/history reconciliation, exact retry, server-only ingress, and projection redaction. P11-075 binds tracked and untracked frequency, action, Encounter-roll, Contest-roll, team-dice, receipt, duplicate-delivery, and reconnect evidence into one runtime convergence gate; deliberately altered frequency or action journals fail before acceptance. P11-076 adds mirrored cross-document recovery receipts, atomic pause/resume and cancellation, restart reconstruction, exact-Pokémon and score correction replay, a linked-map interruption gate with accepted-operation retry precedence, injected second-write rollback, and Phase 1 stale/duplicate/interrupted fixture certification. P11-077 adds source-hash-bound all-roster Experience/Ribbon policy, exact prepared/accepted combined receipts, blocked independent Encounter settlement, one transaction across both existing settlement engines, final sheet-hash evidence, role-safe reward summaries, exact dual-journal retries, and injected post-reward rollback with no partial rewards, consequences, histories, operations, or realtime rows. P11-078 adds the joined Encounter cockpit, persisted-handoff discovery and command gate, server-only synchronization, 0–3 controller allocation, role-distinct value-only pool projections, exact allocation retry, realtime convergence, compact mobile scoreboard, and production-liveplay evidence for GM, acting owner, spectator, keyboard focus, 320-pixel reflow, zero serious/critical Axe findings, and 100 joined projections inside the existing 250 ms Contest budget. P11-079 adds four byte-reproducible minimum/maximum Battle scenarios covering both terminal paths, ordinary and exempt switches, all Voltage lifecycle rules, exact Appeal totals, complete roster evidence, Appeal-only placements, and source-fingerprint drift rejection while reusing the production engines exclusively. P11-080 binds all sixteen ordered Battle cohort certificates, reruns every fixture and focused dual-engine acceptance surface, certifies privacy/realtime/performance/multi-client/exact-retry guarantees, removes the temporary structured setup gate, and activates the canonical Battle row as native.
