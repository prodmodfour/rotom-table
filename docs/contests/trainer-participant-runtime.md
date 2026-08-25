# Trainer Participant Contest runtime

## Authority boundary

`data/reference/contests.json` is the only runtime source for the structured `trainer-participant` row. The row layers a participant format over one canonical base variant (`standard`, `supercontest`, `festival`, or `rotation`); it does not create a second base-chart or lifecycle authority.

`ContestDocumentV1.participantVariantId` is therefore either `null` for an ordinary Pokémon-only Contest or `trainer-participant`. The base `variantId` continues to own charts, fixed or rolled Contest type policy, Festival behavior, and Rotation team size.

## P11-053 installed behavior

Each Trainer Participant entry snapshots:

- the existing contestant Trainer sheet slug and exact repository revision;
- one discriminated Trainer performer with the same slug and revision;
- the base variant's ordinary Pokémon performer set (one Pokémon, or three through five for Rotation);
- the existing GM or selected-profile controller identity; and
- the Trainer's ordinary movelist as role-internal performer options.

The Trainer performer does not introduce another sheet record, revision counter, controller, roll service, or Contest dice authority. Its five `dicePools` are exact empty compatibility containers.

A selected profile must currently control the enrolled Trainer and every enrolled Pokémon through the existing profile links. Missing sheets, missing profiles, incomplete control, duplicate Trainer/Pokémon identities, mismatched Trainer performer revisions, cross-kind fields, non-Pokémon Rotation order entries, and unknown participant formats fail before a Contest or operation write.

Trainer Moves are snapshotted from the authoritative Trainer movelist. Canonical Moves with defined Contest identity are available; unknown, created, or weapon Moves remain explicitly unavailable with `contest.move-identity-missing`. Trainer appeal execution revalidates that fail-closed policy on every declaration.

## P11-054 shared Contest dice authority

The canonical `trainer-pokemon-entry` pool is shared **by reference**, not copied. Each Pokémon retains its one authoritative preparation pool and the paired Trainer retains empty pools. An active Trainer or that exact Pokémon spends against the Pokémon pool through `spendTrainerParticipantSharedDice`; this makes combat-stat, Poffin, Style Expert, and other accepted preparation contributions available to either member without creating parallel authority. Rotation keeps each Pokémon's own pool and its existing shared Introduction pool. A paired spend depletes Rotation's team pool first and then the selected Pokémon pool, preserving the base variant's `own-preparation-plus-shared-introduction-shared-first` policy.

Every non-zero paired spend appends one immutable `sharedDiceSpendJournal` receipt. The receipt binds:

- one Contest operation, acting performer, and exact paired Pokémon performer;
- the canonical `trainer-pokemon-entry` source policy;
- complete per-stat spend vectors;
- separate Pokémon and Rotation-team allocations; and
- exact before/after remaining vectors for both sources.

Receipt IDs derive from operation IDs. Duplicate receipt/operation IDs, changed exact-retry input, an actor outside the pair, overspend, non-shared-first allocation, missing appeal evidence, or an appeal spend without exactly one receipt fails closed. Whole-Contest depletion survives terminal cleanup. Current-sheet provider refresh can deactivate a lost Feature contribution once while retaining its frozen provenance and already accepted spend.

The canonical paired Feature target policy is validated at catalog load. The shared primitive accepts either the Trainer or Pokémon as the active spender, including a pool carrying Style Expert's Poffin-equivalent dice. Coordinator rerolls and the ordinary intervention runtime consume the same shared authority; no alternate Feature resource ledger exists.

## P11-055 canonical method policies

Every new Trainer Participant command explicitly chooses `participantMethodId: simultaneous | alternating`. A legacy P11-053/P11-054 setup document normalizes to `participantMethodId: null`; the GM must select one through the replay-safe `set-participant-method` setup command before setup may lock. Ordinary Contests reject method authority. The selected ID is public Contest format information, while the existing role projections continue to protect sheet and pool details.

The source-bound scheduler implements only the two canonical rows:

- **Simultaneous:** each entry accepts two appeals per base-Contest round, one Trainer and one Pokémon. With no accepted member, both are legal so the controller chooses the first; after that acceptance, only the paired member is legal. A repeated member or third appeal fails closed. Voltage scope is `per-performer`, adjacency addresses both performers of an adjacent entry, and only the two canonical cross-performer effect policies are admitted.
- **Alternating:** each entry accepts one appeal per base-Contest round. With no prior accepted turn, either member is legal because no alternation predecessor exists. Every later entry round requires the other member exactly. Voltage and adjacency scope are `shared-entry`, and no cross-performer exception is admitted.

The scheduler returns the exact appeal count, legal next member kinds, round-complete state, Voltage scope, adjacency scope, and cross-performer allowlist. It rejects unknown methods, invalid member kinds, overfilled rounds, duplicate Simultaneous members, and broken Alternating sequences. Appeal execution and paired Voltage/adjacency consume those validated scopes directly without inferring extra semantics from prose.

The setup page presents the two methods as 44px semantic buttons in a labelled fieldset, announces the accepted command through the existing live status region, exposes the chosen method in the public header, and disables setup lock while a legacy document has no choice. This was an exact mechanical extension of the existing Workshop primitives with no open visual hierarchy decision, so no generated mockup was required.

## P11-056 Trainer introduction authority

Trainer Participant entries now traverse the base Contest's existing Introduction stage. This is one entry-level Introduction, not a second parallel roll: `ContestIntroductionStateV1.performerId` binds it to the entry's exact enrolled Trainer performer, while `introductionSkillDice` remains the enrollment-time snapshot from the ordinary Trainer skill authority. The controller chooses one of Charm, Command, Guile, Intimidate, or Intuition through the existing command; the server owns every d6, Introduction/bonus journal row, success count, matching-type bonus, accepted history row, private owner evidence row, and letter tie roll.

Generated Contest Stat dice join the already shared pair authority. Standard, Supercontest, and Festival entries write Introduction contributions only to the paired Pokémon pool that the Trainer may share by reference. Rotation writes them only to the base variant's team Introduction pool. Trainer compatibility pools remain exactly empty. This preserves Style Expert/preparation provenance, whole-Contest depletion, and Rotation shared-first spending without copying any dice.

After every entry accepts, the existing deterministic score/tie authority assigns unique letters and projects the same public lifecycle, letter, and generic accepted history as an ordinary Contest. GM and the exact owner retain their existing complete Introduction state and private evidence; spectators do not receive performer IDs, roll results, Skill ranks, pool details, or owner-only evidence. Restart removes only generated contributions, resets letters and accepted state, retains the exact Trainer performer binding, and preserves immutable superseded journals.

Schema-v1 compatibility backfills `performerId` to the exact Trainer performer only for a Trainer Participant entry and to `null` for ordinary entries, then reparses all cross-references. A forged Pokémon/unrelated actor, missing Trainer actor, changed-input retry, stale revision, overspend-shaped pool copy, or incomplete lineup fails before write. Exact retry returns the accepted document and journal without another roll, contribution, history row, revision, operation, or realtime event.

## P11-057 Trainer appeal authority

Alternating Trainer Participant entries now enter Performance and may choose either paired member for the first entry turn. After acceptance, the source-bound method scheduler requires the other kind on that entry's next chart turn and continues exact Trainer/Pokémon alternation across rounds and Festival heats. Owner projections expose `ownLegalPerformerIds`; a single legacy-style `ownCurrentPerformerId` is emitted only when exactly one performer is legal. Command authorization remains the existing snapshotted entry controller authority.

Trainer options are enrollment-time snapshots of the ordinary Trainer sheet's real Move list. A defined Move must resolve through the app-owned Move catalog (or an explicit created-Move Contest identity) before it can be offered. Unknown/created Moves without an identity fail with `contest.move-identity-missing`. The twelve capability-owned weapon Moves are retained as visible unavailable options with `weapon-move-no-canonical-contest-identity` and the source-bound safe reason; they never borrow a Pokémon Move identity or documentary semantics. Persisted appeals cross-check the exact enrolled performer, available option, label, Contest type, effect, and method sequence.

Accepted Trainer appeals reuse the ordinary server authority unchanged: Contest type matching/opposition, base/effect/Voltage/Voice/accepted bonus assembly, server d6 journal, center scoring, Appeal and Fumble tables, canonical effect consequences, repetition rules, chart adjacency, immutable ledger/history, CAS, operations, and realtime publication. The active Trainer spends by reference from the exact paired Pokémon preparation pool; Rotation binds the round-locked Pokémon and depletes its separate Introduction team pool first. Trainer compatibility pools remain empty and every spend keeps the actor plus paired-Pokémon receipt.

Alternating Voltage and adjacency are entry-shared exactly as declared by the reviewed method row. Get Ready is the one persistent base effect that must not be consumed by the intervening partner: its multiplier is derived from that same performer's previous accepted appeal and applies only when that performer returns. The partner receives ordinary base dice. Full performance completion preserves the ordinary `Appeal - Fumble` score and deterministic placement authority, then stops in `settling` before any reward preview or sheet write.

Exact retries return the committed roll, score, effect, spend, history, and projection without rerolling or rewriting. Changed-input reuse, stale revision, wrong controller, wrong turn, repeated performer kind, unavailable Move, forged option fields, or forged method order fail before randomness and persistence. Standard and Rotation runtime evidence covers Trainer/Pokémon alternation, shared-pool spending, real/unknown/weapon Move offers, same-performer Get Ready, scoring, projections, recovery, and the reward gate; ordinary Supercontest and Festival chart/type pipelines remain inherited.

## P11-058 paired Voltage and adjacency authority

Both reviewed methods now enter Performance. Alternating continues to use the existing `contestant.voltage` shared-entry authority and one appeal at each chart cursor. Simultaneous fixes that compatibility scalar at zero and persists an exact `performerVoltages` map keyed by every enrolled Trainer/Pokémon performer. The first legal member appeal leaves the entry's round/turn cursor in place; only the exact partner's accepted appeal completes that chart turn. A complete three-entry base Contest therefore has nine chart cursors and eighteen immutable appeals—not eighteen positions. Strict reads reconcile each performer's start/end Voltage and every consequence through accepted history, reject missing/extra map keys, reject duplicate member appeals, and permit at most one open first-member appeal at the current cursor.

Start-of-turn Voltage dice, actor effects, Saving Grace, Double Time, Seen Nothing Yet, and other Voltage consumers read and mutate only the exact Simultaneous actor. Alternating and ordinary play retain their shared scalar unchanged. Adjacency is still computed once from the base entry letter and position chart; a Simultaneous Voltage effect fans out to the Trainer plus active Pokémon of every adjacent entry. Rotation binds only that round's locked Pokémon and never touches inactive teammates. Consequence receipts carry an exact `performerId` for nonzero Simultaneous Voltage and `null` for shared Appeal/Fumble or ordinary/Alternating effects, so actor, adjacent pair, cap, and history replay remain independently checkable.

The two reviewed cross-performer permissions use the optional `partnerEffectTargetPerformerId` declaration field and immutable appeal receipt. A first-member Get Ready may target the same-turn partner; the target receives the doubled base exactly once, while an untargeted Get Ready remains with its original performer for that performer's next appeal. Attention Grabber may credit stolen adjacent Voltage to the active partner; the appealing performer's before/after Voltage then remains unchanged and the exact partner consequence carries the capped gain. Other effects, wrong entries, inactive Rotation Pokémon, self-targets, late Get Ready transfers, changed targets on retry, or forged multiplier/recipient evidence fail closed.

Center of Attention, turn order, adjacency, Appeal/Fumble scoring, and final placement remain entry-level base-chart authority. Simultaneous pair members therefore share center/adjacent entry identities while retaining separate Voltage. Owner action projections derive both legal initial performers, then only the required partner; no duplicate position is invented. Because the existing shared-entry `voltage-delta` correction has no performer field, it is deliberately unavailable for Simultaneous rather than guessing a recipient; failed correction attempts write no receipt, operation, revision, or event.

## P11-059 normal integration authority

The complete ordinary 44-row Contest integration inventory applies without a second paired registry. Trainer Features and Edges are snapshotted on the Trainer performer; an appeal or intervention combines only that selected performer's providers with the paired Trainer's Feature providers. Pokémon Abilities and equipped items remain bound to the exact Pokémon provider and cannot be borrowed by its Trainer. Introduction-only providers are combined at entry scope because the canonical Introduction belongs to the Trainer/Pokémon entry.

Every selectable pre-appeal intervention binds `targetPerformerId` to one currently legal member. Post-appeal Coordinator, Style Flourish, and Contest Fashion rerolls bind the exact accepted performer and appeal. Beautiful and Contest Fashion usage is performer-scoped; Trainer Feature usage remains entry-scoped. Fashion Designer charges the exact Pokémon's ordinary campaign-day Ability ledger, while Reliable Performance and Style Flourish charge the ordinary Trainer AP/Feature ledger. Exact retries return the accepted operation without a second roll or charge, and a failed Contest write rolls the ordinary resource write back in the same transaction. Provider withdrawal, wrong-member targets, stale revisions, changed operation input, and unavailable timing fail before mutation.

## P11-060 role-safe paired projections

Public score rows identify the active Trainer plus round-locked Pokémon and expose their separate Simultaneous Voltage values without sheet slugs, provider IDs, pools, controller details, or private Move plans. The pair retains one entry letter, stage position, Appeal, Fumble, and score. Alternating projects the shared entry Voltage on both identity summaries. Rotation never exposes inactive private team planning through the active public pair.

The exact owner receives only its own complete contestant snapshot and current legal performer IDs. Before a Simultaneous first appeal those IDs contain both members; after acceptance they contain only the required partner. GM/diagnostic projections receive the same exact current legal-performer authority plus all enrolled snapshots; only diagnostic projection receives dice journals and contributor indexing. Public, owner, and GM projections therefore share public accepted outcomes while preserving structurally separate planning and authority fields.

## P11-061 placement and settlement

Trainer Participant Performance now advances from `settling` through the ordinary two-step preview/commit settlement. Placement remains entry-level `Appeal - Fumble` with the existing server tie rolls. Standard, Supercontest, and Festival award the entry's paired Pokémon according to the ordinary placement/significance formula. Rotation computes the ordinary team total and distributes it across the enrolled Pokémon exactly as the base variant requires. The Trainer performer never receives Pokémon Experience.

The winner's enrolled Pokémon receive the existing Ribbon provenance when the locked policy enables it; each Trainer receives one ordinary Contest result receipt naming its enrolled Pokémon. Declared money and items use the existing winning/target Trainer policy. The commit updates Contest, Trainer sheets, Pokémon sheets, operation receipt, progression-attention IDs, and realtime events in one database transaction. Exact retry cannot duplicate Experience, Ribbon, result, money, item, attention, revision, or event writes; any sheet conflict rolls every candidate write back and leaves the preview recoverable.

## P11-062 paired liveplay cockpit

The liveplay Contest cockpit presents the active entry as a Trainer/Pokémon pair with one stage position and separate Voltage. When both members are legal, a keyboard-operable decision surface asks “Choose who appeals first” for Simultaneous play (or identifies the current performer choice for Alternating), then reveals only the selected member's private legal Move offers. Shared Contest dice appear once from the paired Pokémon/team authority. Get Ready and Attention Grabber expose the exact optional partner target, and all interventions submit the selected or accepted `targetPerformerId`.

Accepted rerolls stay in an explicit pending window, unavailable Moves retain a textual reason, selected state uses text and icon in addition to colour, and the right rail remains a role-safe public scoreboard/journal. The matte Live Encounter surface uses the versioned encounter tokens, 44px controls, visible cyan focus, finite/reduced motion policy, and single-column mobile reflow. Target-state design evidence and its autonomous 10/10 review remain local under `.pi/artifacts/ui-mockups/trainer-participant-contest-cockpit/`.

## P11-063 deterministic variant matrix

`data/contests/trainer-participant-variant-matrix.v1.json` covers Standard, Supercontest, Festival, and Rotation at three, four, and five contestants for both Simultaneous and Alternating: 24 seeded scenarios. It binds canonical Contest and Move source hashes and records letters, exact accepted-appeal counts, Festival heat progression, Supercontest type rolls, performer-kind sequences, placements, per-entry settlement, and a hash of immutable journal/ledger/history/settlement evidence. The generator reproduces both the archived ordinary 18-scenario matrix and this paired matrix byte-for-byte; drift fails the fixture check.

## P11-064 native activation

The app-owned canonical `trainer-participant` row is `native`. All four compatible base variants and both methods traverse setup, Introduction, Performance, intervention windows, placement, settlement, completion, recovery, projections, and liveplay UI without a participant-specific progression gate. Unknown participant IDs, missing methods, unsupported providers, missing Contest Move identities, ambiguous Simultaneous Voltage corrections, and malformed persisted evidence remain fail-closed. Runtime code reads only app-owned canonical JSON and typed contracts; no rules prose is parsed.

## Compatibility and recovery

Schema-v1 development documents created before the participant extension are normalized on read to `participantVariantId: null`, `performerKind: pokemon`, and `introduction.performerId: null`. Accepted P11-053 Trainer Participant setup documents receive `sharedContestDicePoolScope: trainer-pokemon-entry`, an empty `sharedDiceSpendJournal`, `participantMethodId: null`, and the exact enrolled Trainer introduction actor without relocating or duplicating Pokémon pools or inventing a method choice. All normalized documents then pass through the same exact parser; new cross-kind or unknown fields remain rejected.

Contest repository CAS, command hashing, transaction boundaries, and exact operation replay are unchanged. An accepted enrollment retry returns the existing receipt without re-enrolling or requiring a second sheet read, and later exact shared-spend retries return the accepted journal receipt without a second depletion.
