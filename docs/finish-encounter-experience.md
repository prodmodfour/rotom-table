# Finish Encounter

`P8-082` connects the encounter workspace to the versioned settlement authorities from P8-071 through P8-081. It is the only guided path that finishes an encounter. The legacy encounter-end command remains a lower-level lifecycle surface; it is not allowed to apply settlement rewards or terminalize an Encounter Document independently.

## GM workflow

1. Open **Director → System → Finish Encounter**.
2. The server performs one current authority read and returns either a blocked review, a ready review, or the already accepted summary.
3. Review persistent consequences, rewards and exact destinations, structured outcomes, temporary cleanup, and non-blocking follow-up work.
4. Resolve the first blocking task in the encounter or Director and load a fresh review. A blocked response never contains a commit command.
5. Check **“I reviewed this settlement and understand it cannot be partly applied.”**
6. Choose **Finish encounter** once. The client durably retains the exact server-authored command before submitting it.
7. Continue from the accepted summary. The workspace refreshes from the committed map revision and settlement realtime event.

Players never receive the Director entry point, the Finish Encounter decision layer, private settlement evidence, or a commit command.

## Authority and preparation

`server/useCases/prepareFinishEncounter.ts` reconstructs the review from current app-owned authority only:

- the active or paused Encounter Document and linked map revision;
- every current participant sheet, with affiliation only from explicit placement `sideId` and Pokémon ownership only from one exact same-side Trainer roster link;
- the campaign clock and current shared inventory document;
- pending move and item-operation repositories;
- accepted capture operations plus exact Profile, species-acquisition, roster, caught-Ball, and source-hash evidence;
- the existing Encounter Settlement Document reward lines and allocations;
- current objective, clock, phase, stake, consequence, and cleanup authority.

Names, prose, tags, and presentation labels never create mechanics. Preparation refreshes authority references but does not invent reward facts. With one eligible Pokémon, unallocated Experience can resolve to that exact participant. With several Pokémon, an existing participant, Pokémon, or side allocation is required; the server blocks instead of guessing across allies or opponents. Loot defaults only to a current shared inventory, or to the sole current Trainer when no shared inventory exists. Unsupported item custody, ambiguous captures, truncated source reads, stale revisions, active outcomes, and incomplete cleanup remain blocking.

Legacy global field lanes are materialized through the reviewed battlefield-zone adapter before cleanup planning. This lets round-, turn-, and encounter-duration fields participate in exhaustive cleanup while scene-scoped state remains untouched.

## Atomic commit

The browser receives only this strict schema-v1 command:

- operation identity;
- settlement identity;
- expected settlement revision;
- server-owned plan SHA-256;
- `confirmed: true`.

It never authors sheet, inventory, map, outcome, cleanup, history, or attention patches. `server/useCases/finishEncounter.ts` rebuilds the exact plan from the operation timestamp and current authority, verifies the plan hash and expected revision, and delegates to the P8-080 atomic repository transaction. That transaction applies rewards, captures, consequences, cleanup, Encounter Document completion, immutable history, follow-up attention seeds, and the terminal settlement revision together. Any stale read or write drift rolls back every write.

Accepted replay is principal-bound and deterministic across restart. A reused operation identity with another command, another principal, or another operation journal fails closed.

## Recovery and multiple tabs

The client stores one strict pending record and an operation-bound local-storage scope lock per encounter. Another tab cannot replace a retained command intentionally, and cleanup removes a record or lock only when it belongs to the exact operation being resolved.

- Network interruption enters **uncertain**; it never sends a second declaration automatically.
- **Check server** asks the GM-only operation-status route about the exact retained command.
- **Retry exact command** is enabled only online and is always an explicit action.
- **Discard and review current** is enabled only after a successful status check proves that the server has no accepted result.
- Reconnect and realtime events refresh reads but never replay retained mutation intent.
- A 409 removes only that stale exact command and requires a fresh explicit review and confirmation.

## Presentation and privacy

`shared/encounterSettlement/finish.ts` is a strict, deeply frozen, schema-v1 projection. It exposes safe labels, counts, actions, summaries, app-relative continuation links, and opaque commit material only to the GM caller. It omits source rows, Profile identities, revisions, hashes, receipts, allocation identities, private notes, and provider evidence from rendered content.

The blocking decision layer stays inside the encounter workspace shell and follows the accepted target in `.pi/artifacts/ui-mockups/finish-encounter-experience/v001.png`:

- matte table surfaces, mint readiness, cyan focus, red commitment, and amber non-blocking work;
- one primary commit action and a sticky explicit confirmation;
- a six-step keyboard rail and focusable scroll region;
- initial dialog-title focus, trapped Tab navigation, Escape/Back focus restoration, and reduced motion;
- controls at least 44 px high;
- no horizontal scrolling at 320 px or at the equivalent 200% reflow width;
- a CSS-only responsive reflow without replacing semantic regions and lists.

## Certification

Focused automated coverage includes:

- `tests/server/finishEncounter.test.ts`
- `tests/server/finishEncounterRoutes.test.ts`
- `tests/shared/finishEncounterView.test.ts`
- `tests/utils/encounterSettlementOperationStorage.test.ts`
- `tests/composables/encounter/useFinishEncounter.test.ts`
- `tests/components/encounterFinishExperience.test.ts`
- `tests/components/encounterWorkspaceDirector.test.ts`
- `tests/e2e/finish-encounter.spec.ts`
- `tests/data/completePlayLoopFinishEncounterExperience.test.ts`

The production-liveplay browser journey creates a trainer duel, reviews XP and shared money without opening a sheet or inventory, commits once, verifies persistent HP/injury/condition state, verifies XP and money, verifies round-field and initiative cleanup, checks player privacy and Axe, and captures desktop and 320 px evidence under `.pi/artifacts/ui-validation/finish-encounter/`. It also reflows the accepted experience at an effective 160 CSS px to represent 200% zoom from 320 px.
