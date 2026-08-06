# Breeding operator guide

## Current rollout state

The Breeding Workshop shell and non-mutating Project wizard are available at `/breeding`, and the durable server runtime through BR-069 is operational. Remaining Project and Egg controls are introduced incrementally by BR-072 through BR-078; do not describe the Workshop as the complete workflow until the implementation ledger is complete. Do not represent edits to `eggMoves`, `inheritedMoves`, Gender, Nature, Abilities, `babyTemplate`, inventory, or map metadata as a completed breeding or hatch operation.

The authoritative readiness command is:

```bash
npm run check:breeding-automation-plan
```

A release may claim complete breeding support only when:

```bash
npm run check:breeding-automation-complete
scripts/quality-gate.sh
```

both pass from the current source/build and the plan is archived with all 90 requirements covered.

## Workshop shell triage

The `/breeding` shell requires a role and reads `/api/breeding/workshop`. A player without a selected Profile should see the Profile-required state rather than a Trainer list. A selected player sees only Profile-linked Trainers; a GM sees current campaign Trainers. Stale player links are marked unavailable without exposing any replacement owner or lifecycle facts.

For a load or integrity error, verify authentication, Profile existence and links, campaign-clock availability, and the active campaign database, then use Retry. Do not bypass a projection hash or security-policy mismatch. Trainer selection and pagination are presentation inputs only; the server must re-authorize them on every request. See [workshop.md](workshop.md) for the state and privacy matrix.

The **Start a project** action opens the transient BR-071 wizard. Destination, Breeder, and parent selections trigger fresh server projections; they do not create a durable draft. A player can select only Profile-authorised contexts and destination-roster parents. A GM cross-owner pair is labelled as requiring owner review, not accepted consent. The review timeline is 240 campaign minutes, a DC 12 Breeder check, and 240 more campaign minutes after success. If a pair becomes stale or unavailable, retry or reselect it; do not edit revisions or bypass the unavailable state. The disabled final action and “No project has been created” message are intentional until the server-owned choice and confirmation flow is completed.

## Governance health

The non-strict checker verifies:

- all frozen source bytes, SHA-256 values, and Git blobs;
- ruleset and dependent definition-hash links;
- closed source adjudications;
- plan/current-ticket/progress consistency;
- scenario coverage state and dependency gates;
- synthetic fixture privacy and canonical species references;
- required checker and evidence artifacts.

A hash failure is not repaired by editing the expected hash alone. Determine whether the source change is intended, review its semantic impact, create or update the source-bound migration/adjudication, then update every dependent definition and test.

## Source-gap handling

Expected unavailable categories include incomplete species rows, missing Egg Groups or hatch durations, malformed family targets, unknown Ability labels, the unresolved `Facade` Move identity, Portable Reanimation Machine identity, and the absence of a canonical facility registry. BR-065 does recognize the exact app-owned `Reanimation Machine`; a GM-designated fossil source is an audited inventory-row/unit fact rather than a new free-text item identity.

Operators must not fill these gaps from a website, wiki, PDF, markdown species page, parser output, or client request. Use a reviewed app-owned migration or leave the operation unavailable.

## Runtime operations after rollout

Normal health checks will cover:

- campaign clock revision and last advancement identity;
- projects by lifecycle state and stale consent count;
- Eggs by lifecycle state and source kind;
- pending special adjudications;
- operation collisions, retries, and recoverable uncertain responses;
- parent/source-loss diagnostics that do not mutate accepted Eggs;
- acquisition-history uniqueness and Egg-child link consistency;
- realtime publication lag after committed events.

All diagnostics are aggregate-only or hash/trace-only unless the operator also has GM authority. Do not copy private project or Egg documents into tickets or logs.

## Initial-time progress incidents

The initial Breeding Project phase requires exactly 240 cumulative campaign minutes. Diagnose progress from the Project's accumulated minutes and last applied campaign-clock revision/minute, never from wall time, process uptime, map state, or a user's browser. A later observed clock minute is not evidence that paused time accrued.

An interruption preserves credited work and skips the paused interval. Resume begins at a new durable checkpoint. If an operation fails before terminal settlement, Project, operation-evidence, and realtime rows roll back together while the phase-1 operation remains pending. Resume only through the explicit recovery path with the identical command, complete read set, authorization receipt, and segment authority. Do not issue a replacement operation merely to credit the same interval, and do not edit accumulated minutes directly.

A terminal operation without its immutable read-set/authorization pair, a Project checkpoint ahead of the campaign clock, a parent revision moving backward, or the same clock revision naming a different minute is an integrity incident. Stop Project mutations and preserve the database for bounded diagnostics. Exact retries must not increment progress, revision, or realtime sequence.

## Breeder Edge handoff incidents

Resolve Breeder permission only through the current stored Trainer and campaign clock. The handoff must find exactly one effective unsuppressed Trainer `Breeder` instance, an exact current Profile-control record or synchronous authenticated GM verifier, and the reviewed `edge.breeder.request.v1` delegation. Direct acquisition requires at least Novice Pokémon Education. A `Dilettante`-granted instance instead requires the BR-061 Feature handoff and one server-owned command-bound General Education or Perception selection; the selected current rank and total become the effective Skill application because Dilettante waives the Edge's Skill prerequisite and substitutes every mandated rank/check. Never copy a choice, instance ID, rank, skill total, effective projection, dependency row, or hash from a browser or earlier Trainer revision. The output is server-private operation authority, not a Workshop projection or realtime payload.

A missing, duplicate, unresolved, suppressed, malformed, stale, or source-drifted Edge is an authority rejection. Below-Novice is an additional rejection for direct acquisition. Missing, invalid, or asynchronous Dilettante selection/evidence fails closed. A provider exception or Promise must fail before mutation; the handoff must create no operation, roll, Project, Egg, or realtime row. Do not substitute a GM override for an existing-but-invalid Edge. Campaign-shared service claims remain unavailable; Feature grants must not be flattened into direct Trainer Edges. Edge automation supplies only permission and reviewed contribution identities—campaign time, persisted d20, DC 12, and Project outcomes remain `breeding.v1` authority.

## Feature provider handoff incidents

Rebuild Feature contributions from the current stored Trainer, campaign minute, effective unsuppressed Feature projection, and exact Profile/GM access. Each accepted Feature must be parameter-complete and match its canonical reference record, native runtime definition, modifier-inventory contribution IDs, checkpoint, and effective projection hash. Use only the generated self-hashed provider snapshots; never recreate a Feature effect from prose or accept submitted values, dependencies, facility names, or instance IDs.

At project creation, `Dilettante` contributes only when its current selected Edge is `Breeder`; use the composite resolver so its source instance and mandated-Skill choice remain bound. At Egg acceptance, a `Playing God` handoff exposes only potential artificial-Egg parameters. Execute it only through the BR-067 artificial-Egg operation, which rechecks $3500, exact Chemistry Set custody, current rank, offers, and rolls atomically; never spend from the handoff itself. A `This One’s Special, I Know It` handoff does not itself consume one of the rank-bounded uses or force a hatch result; without exact persisted consumption authority the hatch reducer fails closed. BR-065 is the only owner of Fossil Restoration and Prehistoric Bond execution, and only for its authoritative fossil reducer; post-hatch learning remains reserved for BR-068. No canonical facility registry exists, so any nonempty facility claim is an authority rejection.

An effective relevant Feature with missing required parameters, an unresolved matching identity, stale Trainer/control/clock evidence, a suppressed provider, a canonical/runtime/hash mismatch, an invalid typed value, or a Promise/exception is a fail-closed incident. Verify no operation, sheet, roll, Project, Egg, inventory write, or realtime event was created. Handoff documents are server-private and must not appear in normal responses, logs, exports, local persistence, or realtime payloads.

## Breeder check incidents

A Project receives at most one Breeder DC 12 check. Confirm the Project was `check-ready`, the operation read the exact Project and campaign-clock revisions, current parent revisions and consent, and the current effective `Breeder` dependency. Direct authority uses Pokémon Education; Dilettante authority must retain its current hash-bound General Education or Perception application. Do not accept a submitted Skill choice, die, skill total, difficulty class, or replacement check identity.

The check d20 is committed before resolution. If phase 2 fails, a pending operation with its authority and roll is expected; resume the exact operation so it reuses that roll. Never delete the roll, draw a replacement, or start a new operation merely because the first response was uncertain. A pending duplicate without explicit recovery must execute nothing. A terminal retry must draw nothing and publish nothing.

A success starts additional time at the check's campaign minute with zero accumulated additional minutes. A failure terminally records `breeding.project-terminal.check-failed`; do not revive it by editing status. More than one roll for the check operation, more than one check for a Project, an accepted operation without its check-to-roll link, or duplicated-column/JSON disagreement is an integrity incident.

## Additional-time progress incidents

Additional progress requires the Project's exact successful check row and current campaign-clock, parent, consent, and operation authority. Never enter progress, a checkpoint, or a readiness minute manually. A missing or changed check, parent drift after the check, expired/revoked consent, or same clock revision with another minute must settle as stale or unavailable without changing the Project.

For a newly reauthorized cross-owner Project, `creditedFromCampaignMinute` begins at the later of the prior durable checkpoint and the current consent grant. The skipped gap earns no progress even though the Project records the command's later clock checkpoint. At 240 cumulative additional minutes, verify `readyToProduceAtCampaignMinute` is the exact threshold inside the final segment; it can be earlier than the command's through minute. Progress above 240, backward checkpoints, or a client-selected continuity start is an integrity incident.

On phase-2 failure, retain the pending reservation and resume only the exact command and authority. The failed transaction must leave no Project revision, operation evidence, terminal result, or realtime row. Exact terminal replay must not accrue again or publish. Owner/GM progress output must contain only status, required/accumulated/remaining minutes, and readiness minute.

## Egg-acceptance snapshot incidents

Before Egg production, verify the Project is `ready-to-produce` and the operation reads the exact Project, successful check, two parent revisions, Breeder Trainer revision, campaign clock, provider dependencies, app references, campaign options, and any current cross-owner consent. Parent drift after the check is stale authority. Do not repair it by editing a Project ref or snapshot. A GM override does not satisfy missing consent.

The provider snapshot must contain only typed reviewed modifier-inventory contributions. Every row needs matching dependency and receipt evidence, and the complete snapshot needs its system attestation. Missing attestation, an unknown contribution, a free-text value, an unregistered facility, or provider details not in the read set is an integrity rejection—not a manual-entry prompt.

The full option snapshot must match the Project creation hash; all app-owned reference and compiled-definition hashes must be current at acceptance. Source drift before commit requires a fresh reviewed command. Once the Egg transaction accepts the snapshot, later source, parent, or provider changes cannot rewrite it. A generated snapshot shown before the Egg transaction commits is not accepted authority and must not be archived or presented as an Egg.

Inspect only the bounded owner/GM summary in ordinary support. Raw parent, Breeder, consent, provider, option, read-set, command, and hash details are diagnostic/GM authority. Missing, extra, reordered, or changed accepted-definition hashes; nested hash disagreement; or an Egg that does not retain the accepted parent/Breeder facts is an integrity incident.

## Offspring-production resolution incidents

Every requested offspring roll must already be a durable `breeding_rolls` row before its reducer runs. Verify one gap-free operation-local ordinal sequence in command-declared order, exact command and Project revision hashes, the Egg-acceptance campaign minute, and the closed production source-hash set. The family uses d20, Nature uses ordered 2d6, Gender uses d100, and Ability uses a uniform index whose die sides exactly equal the resolved Species' sorted Basic Ability count. Never accept submitted totals, reorder persisted rolls, fill a missing row, or draw a replacement after an uncertain response.

A selected trait or family option must resolve to exactly one active revision-zero Project offer for the operation actor. Check target revision, Pokémon Education rank, issued and expiry campaign minutes, and canonical value authority. Expiry is strict: an offer is invalid when the settlement minute equals its expiry. A roll and a choice for the same fact, an option not declared by the command, an ambiguous option ID, or a free-text replacement is an integrity rejection. Consumption is a single revision-one successor and must occur with Egg production; do not mark an offer consumed merely because a preview displayed it.

Inspect inheritance only through bounded GM diagnostics. Each candidate must match a frozen parent's effective known-Move evidence and a compiled child Egg-Move or machine-compatible pathway. Parent edits after acceptance cannot add or remove candidates. A parentless source row in normal breeding, unknown Move identity, changed source hash, or source evidence that no longer matches the BR-046 snapshot is an integrity incident, not an invitation to infer from editable `eggMoves` or `inheritedMoves`.

When a child reaches Levels 20, 30, …, 100, settle only the next contiguous checkpoint prefix through `recordPokemonInheritanceLearning.ts`. The player submits server-issued option IDs, never a Move row or provenance. Levels 20–29 enforce frequency at most Scene and Damage Base at most 9; Level 30 onward is unrestricted. An illegal selection records an empty checkpoint and remains eligible later. Append into an open natural slot, rebind an already known Move, or require one occupied replacement option when all six slots are full. Exact retries may return a later child revision but never insert another record, consume another offer, or republish.

The prepared resolution record is not an Egg and must not be presented, exported, or restored as one. If BR-048 rolls back, consumed-offer successors, Project mutation, Egg insert, terminal result, and realtime rows must all be absent; durable pre-reduction rolls remain bound to the pending operation for exact recovery. Owner/GM normal output contains no Species, traits, Move candidates, rolls, offers, option values, parents, commands, or hashes.

## Atomic Egg-production incidents

A successful production operation has exactly one terminal `egg-produced` result, one Project revision successor, and one revision-zero Egg with reciprocal Project/Egg IDs and the same campaign minute. The Egg begins `incubating` at zero progress with the current clock revision/minute, no pause, no special roll, no child, and `automaticShiny: false`. The Project must retain its successful check and immutable parent/Breeder/ruleset facts. A second Egg, a ready Project without its accepted Egg, or mismatched production times is an integrity incident.

Before recovery, distinguish phase 1 from phase 2. A pending operation may legitimately retain immutable authority evidence and a gap-free prefix of complete rolls. Never delete or redraw that prefix. Resume the exact command so the server draws only missing ordinals. After any phase-2 failure, verify there is no Egg, Project successor, consumed offer, terminal result, or realtime row. If any of those exists without all the others, stop mutations and preserve the database; do not complete the set manually.

For cross-owner production, confirm the exact consent record remains active and strictly before expiry inside settlement. GM override is not consent. A selected offer remains revision zero until the Egg transaction; its consumed revision one must name the same operation, command hash, option, and campaign minute. An offer consumed without an Egg, or an Egg committed while its selected offer remains active, is an atomicity violation.

Egg refresh events never target `participating-owner`; only the Project refresh can notify that audience. Normal mutation responses expose no traits, inheritance, parent/Trainer/Profile facts, consent, rolls, offers, or hashes. BR-048 production accepts fixed-average hatch duration only. Do not emulate random duration, facility, item, or provider modifiers by editing the Egg; BR-050 executes only audited base-rate incubation, and provider effects remain gated on their owning source-specific reducers.

## Project interruption and operation recovery

Use ordinary cancellation only for the current Project owner. It terminally advances an active Project to `cancelled` and does not erase check, progress, parent, or Breeder facts. Consent is unusable at exact expiry equality. An `expired` Project must cite at least one current read-set-bound cross-owner grant that reached that campaign minute. `abandoned` and `conflicted` are GM recovery outcomes, not labels to edit directly. No terminal Project can later produce an Egg.

A consenting parent owner may revoke only their own current Project/parent grant while still controlling the owner Trainer. The active consent settles to revision one and the active Project receives a same-status checkpoint revision atomically. Paused or skipped consent time is never recovered by changing the grant. Revocation after Egg production may settle the audit row but must not revise the Project, Egg, parents, or blueprint. An active-looking expired grant is historical only; current usability always evaluates campaign time.

On reconnect, inspect the bounded GM pending-operation snapshot. `authorityEvidencePresent: false` can be legitimate after rollback before phase-2 evidence insertion; persisted rolls are never a reason to redraw. Choose exactly one recovery action:

- `inspect` records an audit without changing the target;
- `resume` dispatches the exact stored target command through its owning server use case;
- `abandon` atomically rejects a pending target as `breeding.operation.abandoned` without deleting evidence or rolls;
- `retry-publication` republishes only persisted rows associated with a terminal accepted result and never changes that result.

A recovery callback failure leaves the recovery command pending. Resume that exact recovery operation. If the target settled before a crash, recovery recognizes the original pending identity and must not dispatch it again. Never call a recovery dispatcher from inside another transaction, settle a target manually, delete phase-one evidence, or synthesize realtime payloads. The reconnect projection intentionally omits payloads, scopes, receipts, hashes, and private mechanics.

## Incubation incidents

Campaign time is the only incubation clock. For each accepted advance, verify the prior Egg checkpoint, exact current campaign-clock revision/minute, one base-rate dependency attestation, an Egg revision increment of one, and one immutable segment row. The segment must satisfy `elapsed = credited + skipped + overflow` and `accumulated after = accumulated before + credited`. Progress never exceeds the frozen target. Overflow is audit evidence only; it is not carried into another Egg or interval.

When an advance crosses the target, the Egg must become `ready` in the same transaction. `readyAtCampaignMinute` is the exact threshold minute, which may precede the operation's settlement minute after a long skip. Do not substitute `statusChangedAtCampaignMinute`, wall time, a browser timer, encounter rounds, or map state for that threshold. A ready Egg without target progress and a ready operation, or target progress on an incubating Egg, is an integrity incident.

Pause only through the audited pause command. Pausing credits the valid prefix through the current checkpoint; elapsed time while already paused is skipped. Resume establishes a new durable checkpoint and never recovers skipped time. Parent or Breeder loss, storage, transfer, source disappearance, disconnect, and process restart do not pause incubation. A pause requested after the target was already reached must be rejected and settled through an advance instead.

The current executable incubation modes are exact base rate and one authoritative continuous Egg Warmer item rate. The latter requires one current quantity-backed Trainer inventory unit assigned to one through four unique Eggs including the target and credits progress at 2:1. Egg Warmer Capability use is a separate command-bound operation: it persists one d10, credits `total × 60` target-equivalent campaign minutes, and enforces a 1,440-campaign-minute source cooldown. Never apply either effect from a label or handoff alone. All other non-empty facilities, Features, Abilities, Moves, Natures, or overrides remain invalid at the incubation checkpoint.

Normal progress queries are owner/GM only and contain totals, basis points, pause/readiness, clock checkpoints, and available actions. A participating parent owner is not an Egg viewer. Never diagnose incubation by returning the Egg blueprint, parents, consent, providers, rolls, command/read-set payloads, or hashes. Refresh rows remain bounded post-commit signals and exact retries are publication-silent.

If Egg, segment, terminal result, and all refresh rows did not commit together, preserve the pending operation and invoke exact recovery. Do not insert a missing segment, revise progress, or republish by hand. Campaign backup and restore must retain every accepted segment and cross-link it to its command, result, and Egg revision.

## GM readiness corrections

Use `mark-egg-ready` only for a reviewed GM adjudication or incubation correction. It requires the current unpaused incubating Egg, current campaign clock, one closed reason (`breeding.egg-ready.gm-adjudication` or `breeding.egg-ready.incubation-correction`), and one self-targeted command-bound GM recovery override. Do not place explanations in a free-text reason, act through owner control, backdate the command, or patch `status`, totals, or readiness fields.

A valid correction changes status to `ready` and records `gm-mark-ready` at the current campaign minute. It must leave target minutes, accumulated minutes, and the last applied incubation clock checkpoint unchanged, and it creates no incubation segment. Resume a paused Egg with a separate audited pause operation before correction. A second correction, reverse correction, or manual return to `incubating` is unavailable.

The Egg successor, accepted `egg-ready` result, and four refresh rows must commit together. On failure, retain the phase-one reservation/read-set/receipt and resume only that exact authority. Exact retry must be revision- and publication-silent. In a campaign backup, the ready operation must resolve to its typed correction command, closed reason, accepted result, correction minute, and Egg revision; otherwise stop mutations and preserve the database.

Owners may see the generic GM readiness kind, but the typed correction reason and authority evidence are GM-only. Never expose the override, command, read set, receipt, hashes, blueprint, parents, or provider details in a readiness response or realtime payload.

## Campaign-clock Egg batches

Prepare a clock batch only from the server discovery result. Its command scopes must begin with the current clock and then contain the exact first due page, ordered by Egg ID with each current revision. The page is capped at 100 Eggs. Never omit an inconvenient Egg, append an owner-selected Egg, reorder scopes, include a Project, or reuse discovery after the clock or an Egg changes.

A forward target advances the clock once; an equal target is an audited no-op used to finish a later due page. Each Egg receives a deterministic child `advance-egg-incubation` operation and the ordinary BR-050 reducer. Unpaused downtime earns campaign minutes, paused downtime is wholly skipped, threshold readiness retains its exact minute, and overflow remains child-segment evidence only. Browser closure, process restart, map state, encounter rounds, and wall time remain irrelevant.

Do not expect one transaction for the whole page. The parent clock commits first, and each child commits its Egg, segment, result, and refresh rows in its own top-level transaction. If a child fails, preserve the accepted parent, complete child prefix, and pending current child. Resume the same parent command with current GM recovery authority; terminal children must replay silently and only the pending child may continue. If the result reports more due Eggs, issue a fresh equal-target parent command for the next page.

A parent accepted with a missing deterministic child, a child targeting a different clock revision/minute, duplicate progress, repeated publication, or an accepted child without its segment is an integrity incident. Stop mutations and preserve the database. Complete backups require every parent Egg scope to link to its exact terminal child; pending batches must be recovered before backup.

Batch output is GM-only and coarse. Do not expose blueprint, species/trait, parent/Breeder/Profile, consent, provider, command, read-set, receipt, or hash data. Owners receive only their ordinary Egg refresh and private incubation query; participating owners are not Egg audiences.

## Egg lifecycle policy

Treat hatch readiness as an Egg-document fact. `incubating` is not ready; only `ready` may enter a first hatch workflow. `awaiting-special-adjudication` and `hatching` already belong to one hatch operation, and settled Eggs cannot restart. A readiness or transfer eligibility boolean is not authorization—hatch offers, destination checks, actor control, and blockers remain separate server decisions.

A transfer reduction is valid only before any hatch operation on an `incubating` or `ready` Egg, with an exact current Egg scope/ruleset, a different destination Trainer, and monotonic campaign time. It preserves status-change time, source, snapshots, blueprint, all incubation fields, special state, hatch/child/terminal fields, and creation time. Never combine progress, pause, readiness, or special settlement with transfer, and never call the pure reducer outside `transferPokemonEggOwnership.ts`.

For a gift, obtain `source-gift` consent from current Profile control of the source Trainer, then obtain one linked `recipient-acceptance` from current Profile control of the named destination Trainer. Both must name the same current Egg revision, participants, and expiry; equality is already expired. Do not use GM override, map ownership, a prior Profile link, or a lifecycle projection as either consent. Before execution, inspect the command for exactly one current Egg scope and the two exact revision-zero consent scopes. The use case re-resolves both Trainer controls even when an authenticated GM executes the transfer.

A successful transfer consumes both consent records and changes only Egg owner, revision, update minute, and operation identity. The former and new owner receive restricted refresh signals, never consent records or Egg mechanics. If phase 2 fails, leave the pending reservation and use exact recovery; do not manually consume consent, change ownership, or replay publication. A terminal exact retry must report the stored transferred projection without new rows. Treat an accepted result lacking both consumed consents, the owner successor, or all durable refresh rows as an integrity incident.

Moving an Egg into or out of campaign storage does not mutate or pause it. Losing, changing, renaming, moving, trading, or deleting a parent, Breeder, Project, or accepted origin source does not rewrite the Egg, revoke readiness, or block hatching; report it as a GM diagnostic against the frozen snapshot. Pre-acceptance source loss still belongs to the Project workflow.

No canonical facility registry exists. Removing a facility preserves base-rate incubation. BR-061 confirms the canonical facility registry is empty. A claimed facility—even with well-formed evidence—is unavailable and confers no rate, duration, readiness, or hatch effect. Never alias an item or free-text location into facility authority.

Lifecycle output is coarse owner/GM data only. Do not expose source-loss details, facility evidence, traits, parents, Breeder, Profiles, consent, commands, read sets, receipts, or hashes.

## Hatch offers and owner destinations

Project a hatch offer only through `projectPokemonEggHatchOffer.ts` with one exact current `begin-hatch` Egg scope. The destination Trainer must still own the Egg. Owners need current Profile control of that exact Trainer revision; GMs need a synchronous current campaign-principal verifier. The server must load and recheck the campaign clock, authoritative Egg, app reference snapshot, and owner Trainer sheet. Do not accept a participant owner's parent access, map control, a prior lifecycle projection, an old offer, or a client roster count as authority.

A ready Egg receives box and team choices for its owner. Box remains available; team requires fewer than six active Pokémon. If the team is full, return `breeding.hatch-offer.team-full` for team and direct the caller to box. If the Egg is not ready, hatch already started, hatched, cancelled, or invalidated, apply the lifecycle blocker to both destinations before checking capacity. Accepted parent/Breeder/source loss, storage, or facility removal must not manufacture another blocker.

Offers expire at campaign-minute equality. Consumption must regenerate the current offer and match its offer ID, definition hash, and operation ID exactly. Changed Egg/Trainer revisions, clock minute, actor/control evidence, references, destination, or command bytes require a fresh offer. An unavailable offer cannot be confirmed. Projection and confirmation do not reserve an operation, roll hatch-special, change the Egg, create a sheet, link a roster, or publish realtime events; those transitions belong to later hatch tickets.

Return only the bounded owner/GM projection. Trainer roster identities, offspring traits, lineage, source diagnostics, control evidence, command payload/hash, reference/policy hashes, read sets, receipts, rolls, and providers are incident evidence, not client output. The opaque generic offer hash is the sole declaration integrity token exposed by this flow.

## Hatch-special rolls and adjudication

A first accepted `begin-hatch` has exactly one `hatch-special-d100` row for the Egg. Confirm ordinal zero, exact command/Egg revision, one value from 1 through 100, the current campaign minute, and the closed source-hash set. Never delete, edit, import over, or redraw this row. If phase 2 fails, the ready Egg may coexist with a pending operation and its durable roll; resume that exact operation. A second operation must not receive another Egg roll.

Totals 2–99 are normal and move the Egg to `hatching`. Totals 1 and 100 create a pending bounded GM workflow and move the Egg to `awaiting-special-adjudication`. Neither total means Shiny. Do not add a Shiny option, free-text mechanics, a provider effect, or an unreviewed configured table. The current three classifications are nonmechanical campaign significance, distinctive appearance, and distinctive temperament; any lasting mechanics require their owning reviewed integration.

Resolve a triggered result only through current authenticated GM authority and one option from the exact active offer. The consumed offer, resolved adjudication, `hatching` Egg successor, accepted result, and four refresh rows must commit together. A partially consumed offer, resolved adjudication with a pending Egg, changed outcome ID, missing original roll, or duplicated realtime publication is an integrity incident. Preserve the database and recover the pending operation; never patch the records individually.

For rollback testing, a fault before terminal settlement must leave the Egg at its prior revision, no fresh offer/adjudication or realtime rows, and exactly one persisted roll. Resume must use that roll. Exact retry after acceptance must keep Egg, offer, and adjudication revisions and event count unchanged. Campaign backups must include and cross-link the original begin command, single roll, deterministic offer/adjudication when triggered, GM resolution command, and current Egg state.

Owner output must not contain the roll, trigger, option inventory, or offer/adjudication identities. GM output may contain those bounded audit facts but still excludes commands, read sets, receipts, hashes, roster/Profile/control/consent facts, blueprint, lineage, and provider payloads. `participating-owner` remains forbidden for Egg realtime access.

## Complete child-sheet construction

Before child persistence, verify that the Egg is `hatching`, has no child or terminal result, and has a terminal `normal` or `resolved` special state. The `complete-hatch` command must name the current Egg revision, exact owner Trainer destination, Pokémon allocation namespace, matching Species acquisition, and one origin ID. A ready, adjudication-pending, already hatched, stale, foreign-destination, or enriched request must not produce a candidate.

The BR-056 plan is deterministic and server-private. Confirm that its Species, Nature, Ability, Gender, Level, Experience, level-up Moves, and compatibility Egg Moves reproduce the frozen blueprint through current app-owned identities. A newborn must start at full formula HP with Shiny false, no applied Moves, and no Poké Edges. The plan must contain no storage-owned slug, folder, revision, creation time, or update time; only the initialized-sheet repository assigns them during BR-057's transaction.

Do not create a blank sheet and save it again. Do not patch a failed child row. Do not treat compatibility `eggMoves` as lineage evidence. If current canonical data or the frozen Species definition disagree, stop and repair authority through a reviewed migration. Baby Template children require the exact frozen BR-067 private authority and must recover through Level-derived overlays without editing Species data. Starting Levels 20 or higher now create every reached inheritance checkpoint during the ordinary hatch transaction; verify the origin contains a gap-free prefix and the child has typed permanent provenance for every learned result.

A retained plan is acceptable only when exact replay from the same Egg and command is byte-equivalent. It has no client projection and must not enter logs, realtime rows, operation results, or browser state. BR-057 must insert the complete revision-zero child, lineage, Trainer link, Egg successor, result, and refresh rows in its caller-owned transaction or leave all of them absent.

## Complete and recover a hatch

Submit only the exact current `complete-hatch` command, BR-056 plan, reference snapshot, read set, and receipt. Confirm that the destination is unchanged from the accepted begin-hatch command. Team has six slots; box has no team-capacity blocker. Do not substitute a different Trainer, Species-acquisition scope, child slug, folder, plan, or current clock. Owner commands require current Profile control in addition to the original receipt evidence; GM commands require current authenticated campaign authority.

One successful settlement must show all of the following together: an initialized revision-zero Pokémon sheet; exactly one new Trainer roster link; one `hatched` Egg successor naming that child; one immutable origin linking the settled Egg and child; one accepted operation result; and six persisted restricted refresh rows. If `(owner Trainer, child Species)` had no history at the read checkpoint, the same transaction must insert one `hatch` acquisition naming this Egg and add exactly one `dexExp`; reward plus roster linkage advances the Trainer twice. If history already existed, preserve its original source, Egg/operation, campaign minute, and Trainer facts, grant zero Experience, and advance the Trainer only for roster linkage.

Never infer history from `dexExp`, current team, box contents, a child sheet, Pokédex UI, or a deleted/released roster entry. History survives roster removal. A present read-set fact followed by a new insert, an absent fact followed by no reward, a changed first-source record, or more than one Experience point is a transaction failure and must roll the hatch attempt back.

## Audit cross-source Species acquisition

Capture, evolution, destination trade, reviewed migration, and GM review use the same history and reward rule as hatch. For a successful capture, verify the accepted live-play operation, target and any companion additions, Trainer/Pokémon revisions, history/reward, source settlement, operation result, and restricted sheet events committed together. A miss or failed capture must have no source settlement. For setup evolution, verify one canonical before/after Species change and exactly one current owner. For a destination roster addition, current storage must show exactly one owner; duplicate claims are rejection, not a repairable warning. Roster removal is release and must not delete or rewrite history.

The private source-operation row must agree with its self-hashed evidence, deterministic operation ID, unique source-event identity, campaign minute, Trainer/Species key, acquisition definition hash, outcome, reward amount, and Trainer revision arithmetic. `first-acquisition-rewarded` means exactly one point and one reward revision; `already-acquired` means zero. A terminal retry may report the persisted one-point historical settlement but must apply zero now and append no realtime rows.

Migration and GM-reviewed acquisitions are server-operated review workflows, not setup forms or public API commands. Require a current exact review record binding the source artifact, reviewer authority, Trainer revision, canonical Species, campaign minute, and integration-policy hash. Never infer missing legacy history. If review authority cannot be rebuilt synchronously, leave the acquisition unavailable. A logical review ID reused with different evidence is an integrity collision.

For schema v27, verify the row-preserving acquisition-table rebuild, source-operation table, composite history foreign key, and byte-equivalent application/offline SQL hashes before opening writes. On collision, malformed authority, unknown Species, reward overflow, partial history/reward/source state, or a dangling source operation, stop writes and preserve the database. Do not patch `dexExp`, delete history, synthesize a breeding operation, or republish sheet events by hand.

If fault injection or a process failure leaves the operation pending, verify that there is no child row, lineage origin, acquisition row, Trainer revision, Egg successor, or realtime row from that attempt. Resume the same operation ID with the same read set, receipt, and child plan. Never issue a new hatch operation to work around a pending reservation and never manually delete a collision suffix. A terminal exact retry must return the stored settlement without another sheet, Trainer update, Egg revision, origin, event, or publication; owners must present current control of the now-updated Trainer.

Treat any partial accepted hatch as an integrity incident. Preserve the campaign database, stop Workshop writes, and run repository, foreign-key, archive, operation-link, and realtime checks. Do not repair only the visible roster or Egg field: accepted authority is valid only when every transactional link is present.

For a concurrent attempt, let the first committed operation remain authoritative. A second command prepared from the old Egg/Trainer revision should fail before reservation. If it had already become pending before the winner committed, resume that exact pending identity with current owner/GM authority; it must settle stale with no child, reward, Trainer mutation, Egg revision, lineage, or event. Do not abandon or delete it merely to clear a queue unless the normal stale recovery itself is unavailable and an audited recovery operation authorizes abandonment.

After process restart, reopen the same campaign database and resume retained evidence; never regenerate the plan, command identity, or timestamps from browser state. After a realtime replay gap, request a complete current snapshot. Do not replay the hatch to replace pruned event rows. Publisher outages leave the six rows durable for ordinary replay, while retention gaps intentionally return no partial event page.

## BR-062 provider operations

For an Egg Warmer item segment, verify the current owner Trainer revision, one exact inventory row and unit ordinal, and a canonical assignment of one through four unique Egg IDs including the target. A missing item, reduced quantity, changed owner, duplicate assignment, fifth Egg, or stale Trainer revision removes the 2× rate. Never infer custody from an item label or retain the multiplier after authority disappears.

For an Egg Warmer Capability use, verify the source Pokémon revision, one effective unsuppressed Capability instance, the current Egg and campaign clock, and the latest accepted or pending use by that source. Cooldown is unavailable before `generatedAtCampaignMinute + 1,440` and available at equality. A phase-2 failure may leave the exact pending operation and its one d10; resume it instead of drawing again. The immutable target never changes—the credited hours advance accumulated progress and may cross readiness once.

For Serpent’s Mark, inspect only the two ordered current parent sheets before Egg acceptance. Each applicable Arbok must have one parameter-ready reviewed pattern. One applicable parent or two equal patterns use no provider roll; two different patterns require one d2. Once accepted, later parent changes cannot rewrite the Egg. Child evidence remains server-private.

Hatch duration must match the frozen campaign policy. Reject missing or extra rolls, client percentages, expired GM offers, values outside one-half through twice the canonical average, and any duration override without its designated authority. Core newborn Loyalty and Tutor Points come from current app-owned rule evidence and are not editable request fields. Chemistry Set custody executes only through the BR-067 Playing God reducer. Parental Bond and Marsupial execute only at the reviewed hatch/relationship checkpoints. Reanimation Machine custody executes only through the BR-065 fossil creation transaction; a handoff or label alone still has no effect.

## BR-063 parent/source changes

Classify changes only from exact server-observed before/after sheet facts and current reference-snapshot hashes. Before the check, evolution, folder movement, and retraining require an explicit interruption: preserve already credited time, refresh to the strictly newer same-slug/same-owner parent revision, rerun compatibility/providers, and obtain fresh revision-bound consent. Never patch `parentRefs` directly or credit the interrupted interval.

A rename, trade, deletion, or source-reference update cannot be repaired by an alias, roster inference, GM override, or consent. Cancel and recreate the active Project, unless a reviewed source-hash-bound migration exists. After a successful check, every parent/source change blocks further accrual and production; preserve prior credit for audit, but do not refresh the immutable post-check refs.

After Egg acceptance, report source continuity loss without mutating anything. The frozen parent snapshots and blueprint remain authoritative even if no live parent sheet exists. Incubation continues in its explicit paused/active state, readiness remains, and hatch remains status-derived. Do not rename snapshot slugs, update Species/Move/provider facts, reverse progress, or require a parent lookup. Settled and terminal Projects remain closed.

## BR-065 fossil-created Egg incidents

Begin only from a current authenticated GM designation of one exact source Trainer inventory row and quantity-backed unit. Rebuild the source document, campaign clock, app references, campaign options, and Feature handoff. Require exactly one current effective unsuppressed parameter-ready `Paleontologist`, current Novice-or-better Pokémon Education or Survival, and one distinct exact Reanimation Machine row/unit. A held-slot string, item label without exact row custody, stale revision, duplicate/unresolved Edge, suppressed provider, asynchronous callback, or non-GM actor must fail before reservation or source mutation.

Inspect every trait through the operation-bound active offers. Species, Nature, primary Basic Ability, Gender, optional canonical inheritance Moves, optional Advanced Ability, tied highest-stat result, and GM duration cannot be free text. A fossil Egg starts at Level 10, has no parents or Breeder, and inherits nothing unless the frozen campaign policy permits an explicit list of at most nine canonical Moves. Fixed duration has no roll; random duration has exactly one persisted 50–200 percentage roll; GM duration has exactly one matching offer. Missing, duplicate, expired, wrong-command, or extraneous choices/rolls are integrity failures.

`Fossil Restoration` applies only from its current effective typed Feature contribution and current Novice Pokémon Education. It spends two Tutor Points and freezes the other Basic Ability, or one bounded current Advanced Ability only when the Species has one Basic Ability. `Prehistoric Bond` additionally requires current Restoration and Expert Pokémon Education. Compute its highest Base Stat after the frozen Nature adjustment; do not ask for a choice when the maximum is unique, and accept only the exact tied-stat offer otherwise. The resulting Held Item includes its frozen effect and fossil-revived restriction. If the per-Egg Baby Template policy is enabled, require exactly one current command-bound fossil decline/application offer and its frozen value hash.

A successful settlement decrements exactly one designated fossil unit, leaves the Reanimation Machine quantity unchanged, consumes only selected offers, inserts one ordinary revision-zero `source.kind = fossil` Egg, settles one operation, and appends six restricted refresh rows. All phase-2 effects must commit together. A retained random roll or offer beside a pending reservation is expected after a phase-1 interruption; resume the exact operation rather than redraw or redesignate. A terminal retry publishes nothing. If later Trainer or Egg revisions make the original creation projection historical, the terminal result remains authoritative and no creation mechanics rerun.

After acceptance, do not require the source fossil, machine, Paleontologist, or Feature to remain present. Their loss is a continuity diagnostic, not an incubation pause or hatch blocker. The fossil Egg uses the same campaign-clock progress, readiness, hatch-special, child-sheet, lineage, first-Species reward, and completion operations as every other accepted Egg. Never create a fossil-specific hatch command or patch the child sheet to apply Restoration/Bond.

## BR-066 GM-source Egg incidents

Start from one current authenticated GM, an exact owner Trainer revision, and exactly one closed origin: `gm-authored`, `mysterious`, `campaign-gift`, or `imported`. Confirm that the source embedded in the command contains the matching typed reason and authoritative provenance self-hash. A historical three-field GM source may still be read from an existing Egg, but it is never valid creation authority. Do not accept a custom reason, client provenance category, imported document, or source label.

For `imported`, require the configured synchronous server resolver to return the same reviewed source system, source record identity/hash, and import-receipt hash at or before the current campaign checkpoint. Missing resolver output, a Promise, stale review evidence, or any mismatch is a hard authority failure. Keep those details private. `campaign-gift` means the GM directly created the Egg for its initial owner; a later Trainer-to-Trainer gift must use BR-064's two linked positive consents and must not rewrite the origin.

Verify that every Species, Nature, current Basic Ability, Gender, optional inheritance Move, base duration, GM duration target, and optional Baby Template value is a selected active command-bound offer. The resulting ordinary `source.kind = gm` Egg is parentless, Breeder-free, Level 1, and has no implicit inheritance. Provider traits remain null except for forced Marsupial on Kangaskhan. Reject missing or extra selections and any random roll unless the frozen campaign duration policy requires exactly one persisted percentage roll.

A fresh phase-2 settlement consumes selected offers, inserts one revision-zero Egg, settles one operation, and appends four payload-free Egg refresh rows in one transaction; it does not revise the owner Trainer. After an injected failure, confirm there is no Egg, consumed offer, terminal result, or event, then resume the exact pending operation with retained offers and roll. Never redraw. Terminal retry is silent. Owner-facing creation output must hide provenance kind, import status, record identities, and hashes; only GM output may include the coarse provenance classification. Continue all accepted origins through the ordinary campaign-clock and hatch pipeline.

## BR-067 Baby Template, Marsupial, and Playing God incidents

When the per-Egg Baby Template campaign policy is active, issue choices only from the server helper against the exact frozen option snapshot. The offer must include decline and one or more canonical adult-size percentages, the reviewed GM-authority evidence ID, and the policy-bound value hash. Do not recreate an offer from a browser value. At save or Experience change, preserve the private self-hashed authority, reject a lower Level, and derive the active mirror and remaining penalties. Never modify Species JSON to represent either penalty or recovery.

A Kangaskhan Egg must carry forced Marsupial penalty 5 and cannot also select the campaign template. Before hatch, verify one current owner-rostered Level-25-or-higher mother, no existing pouch claims, one effective Marsupial handoff, and any optional current Parental Bond handoff. The hatch transaction must create the child and write the same pouch record to both sheets. A missing counterpart, duplicate claimant, different share percentage, stale revision, or malformed private authority is corruption and must stop mutation. At Level 25, clear both durable records and all transient map mirrors together.

Do not apply Marsupial command or pouch protection to ordinary optional-template Pokémon. A Marsupial baby cannot act unless Parental Bond is currently effective. With effective Parental Bond it may leave, deploy or recall independently, and act; the durable mother relationship remains, its voluntary 10-metre tether and 10 Damage Reduction still apply, and conscious-mother pouch targeting or capture protection does not. A label or retained hatch handoff does not replace current effective Ability authority.

For Playing God, require current effective Feature parameters, exact Chemistry Set custody, at least $3500, and exact Expert/Master Technology Education rank. Persist required Gender/duration rolls before reduction, consume exactly five or six upgrade offers, deduct $3500 atomically, and leave the tool untouched. On failure, verify money, Egg, offers, operation, and events rolled back, then resume the same operation and rolls. Do not create a second artificial hatch path.

## Recovery principles

1. Retry the exact command with the same operation ID and bytes.
2. If the operation exists, return its stored result; do not reroll.
3. If the operation ID has a different command hash, treat it as a collision and investigate.
4. On stale revision, reload the caller's authorized projection before any new command.
5. On reconnect or replay gap, replace local state from an authoritative projection.
6. Never fix a partial-looking hatch by manually creating or linking a child. A valid hatch is atomic; an invalid partial state is a storage incident.
7. Preserve accepted Egg snapshots even when parents are renamed, evolved, traded, or deleted.

## Consent incidents

For a disputed cross-owner project, inspect the consent audit for project ID, parent slug/revision, owner Trainer, consenting profile, scopes, grant/expiry/revocation campaign minutes, operation ID, and command hash. Browser selection, public visibility, or a prior project is not consent.

Revoke only through the authoritative operation. Revocation before Egg acceptance blocks production. Revocation after acceptance does not rewrite the Egg; escalate narrative disputes to the GM while preserving audit evidence.

## Backup and restore

Use only the versioned digest-bearing campaign export. Restore into isolated state first. Validation must reject missing rulesets, duplicate operation IDs with contradictory commands, duplicate Egg-child links, dangling project/Egg/Trainer references, duplicate acquisition keys, and invalid revisions before accepting authority.

After restore, run repository consistency, exact-retry, projection privacy, and checker validation. Do not trigger rerolls or reconstruct lineage from sheet fields.

## Rollback

Rollback disables new Workshop mutations while preserving reads, projects, Eggs, operation receipts, consent, acquisition history, and child links. It never re-enables map metadata or legacy sheet fields as Egg authority. In-flight commands reconcile through stored operation results.

## Escalation evidence

Collect only:

- checker output;
- ruleset/source/provider definition hashes;
- aggregate kind, hashed ID, revision, and lifecycle state;
- operation kind, hashed operation ID, command/result hash match status;
- migration version and invariant failure code;
- bounded timestamps/campaign-clock revisions;
- sanitized stack traces.

Do not collect raw parent sheets, consent profile IDs, trait options, rolls, notes, exports, cookies, tokens, or campaign databases in routine diagnostics.
