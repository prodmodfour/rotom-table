# Breeding Workshop

The Breeding Workshop is the campaign-scoped presentation entry point for breeding and Egg lifecycle work. Its route is `/breeding`; the shell read API is `/api/breeding/workshop`, current Project/Egg cards load from `/api/breeding/workshop/activity`, the role-projected hatch workflow uses `POST /api/breeding/hatch`, the base non-mutating Project-wizard API is `POST /api/breeding/projects/wizard`, the explanation projection is `POST /api/breeding/projects/wizard/guidance`, and the current choice/confirmation API is `POST /api/breeding/projects/wizard/choices`. It is not a map, encounter, placement, scene, or initiative surface.

BR-070 establishes the Workshop shell, ownership context, navigation, and safe loading/empty/error states. BR-071 adds the transient Project wizard for destination, Breeder, parents, consent status, and campaign timeline. BR-072 adds closed compatibility and unavailable explanations, current source contributions, and bounded GM diagnostics. BR-073 adds rank-authority presentation, campaign settings, server-issued setup choices, explicit confirmation, and Project creation through the existing durable initial-progress path. BR-074 adds owner/GM Project and Egg cards with exact campaign progress, bounded lifecycle history, system recovery state, and transfer handoffs. BR-075 adds the role-projected hatch decision, private bounded GM special adjudication, accepted completion, and child reveal over the existing durable hatch authorities. BR-076 adds current team/Box destination choice, six-slot explanations, accepted roster linkage presentation, and child/Trainer navigation. BR-077 adds the private, recovery-safe cross-owner Project and Egg-transfer consent center. Final interaction acceptance remains owned by BR-078.

## Authority and ownership

Every request requires an authenticated campaign role. The server rebuilds the ownership directory from current SQLite authority on every load:

- a GM may view current campaign Trainer sheets;
- a player may view only Trainer links on the selected, current Player Profile;
- a player without a selected Profile receives a `profile-required` projection with no Trainer facts;
- a requested Trainer slug or pagination cursor never grants ownership;
- a foreign player selection is rejected;
- all repositories used to build one projection must share the Workshop database connection.

A Profile link whose Trainer has been removed remains visible only to that Profile as an unavailable context with a bounded reason. The server does not search rosters, maps, encounters, local storage, or editable fields to infer ownership.

## Projection boundary

The v1 projection is strict, closed, and self-hashed. It includes campaign minute, audience, pagination cursors, bounded Trainer presentation facts, and only `hasProjects` / `hasEggs` activity booleans. Pages contain at most 100 contexts in canonical Trainer-slug order.

The projection never includes project IDs, Egg IDs, Species, parents, lineage, consent, rolls, choices, offers, operation evidence, Profile IDs, private mechanics, or diagnostics. Both server and browser validate the current security-policy hash and exact projection digest. Digest validation detects response drift; it does not give browser state mechanic authority.

Inputs and outputs reject unknown fields, accessors, symbols, sparse arrays, non-plain objects, unsafe integers, malformed slugs, unbounded text, and contradictory availability or empty-state combinations.

## Project wizard boundary

The wizard accepts selectors, never authority claims: the selected Profile ID or `null`, destination and Breeder Trainer slugs, and zero to two Pokémon sheet slug/revision pairs. The server re-resolves the Profile, both Trainer contexts, current campaign clock, current campaign options, current rosters, Pokémon revisions, and the BR-020 parent-discovery projection. A requested slug, revision, or parent pair cannot establish ownership, mechanics, consent, compatibility, or campaign time.

For players, destination and Breeder must both be linked to the selected current Profile, and parent discovery is limited to the destination Trainer roster. A GM receives the bounded current campaign parent directory. Hidden, foreign, stale, duplicate, inaccessible, or ambiguous selections fail without enumerating private authority. The browser verifies the security-policy binding and exact self-hash before adopting the response.

The four steps are:

1. **Destination** — the current Trainer that will own the eventual Project and resulting Egg.
2. **Breeder** — the current Trainer that will be subject to server-owned Breeder authority at execution.
3. **Parents** — exactly two current visible sheet/revision selectors; unavailable entries are disabled.
4. **Review** — a non-mutating summary of the selected contexts, pair, consent status, and timeline.

Consent remains intentionally shallow in the wizard. A complete same-owner pair projects `not-required`; a GM cross-owner pair projects `review-required`; incomplete selection projects `selection-incomplete`. No consent record, acceptance, private cross-owner mechanic, or browser acknowledgement is projected by the wizard. Confirmed cross-owner setup may persist only an `awaiting-parent-consent` Project; it still stops before provider-dependent private parent mechanics or adjudications are resolved. BR-077's separate private consent center owns the positive grant.

The timeline is projected from server policy and uses only campaign time: 240 initial campaign minutes, one Breeder check at DC 12, then 240 additional campaign minutes after success before Egg production can proceed. The browser has no wall-clock, scene, map, or lifecycle authority.

The wizard keeps no local persistent authority. It uses one random opaque draft ID only to make confirmation replay-safe. Profile changes close it; destination, Breeder, and parent changes clear downstream options and request a fresh projection; errors offer retry; policy or digest mismatch rejects the response without adopting its facts.

## Compatibility guidance and diagnostics

The BR-072 guidance endpoint accepts exactly the BR-071 selector request and nests one exact current BR-071 wizard projection. It adds only presentation facts under a second security-bound self-hash:

- a closed app-owned catalog gives every parent-candidate and pair-preview reason a stable ID, severity, human summary, and recovery action;
- unavailable parent cards expose those explanations through keyboard-operable native disclosure controls;
- complete pairs show either their current safe blocker explanations or that final server validation is still required;
- source cards report current `Breeder` Trainer Edge and `Dilettante` Trainer Feature contribution status;
- an active direct Breeder source may expose only its mandated Skill ID, rank, and bounded check total;
- Dilettante is shown as an active upstream grant while the Breeder source remains `choice-required` until a later server-issued General Education or Perception choice;
- malformed, stale, asynchronous, ambiguous, or unavailable provider authority fails closed to a safe reason and never projects provider evidence or internal errors.

The catalog is presentation authority only. Compatibility remains owned by BR-020 discovery and current final validation; browser prose never recalculates Egg Groups, Gender roles, maturity, consent, or provider mechanics.

Only the GM audience receives diagnostics. Those diagnostics are bounded counts and enums: candidate availability counts, selected-parent count, same-owner/cross-owner topology, Breeder status, maturity policy, consent and preview status, the campaign-Workshop location policy, the empty facility-registry state, and the final-validation requirement. They contain no Trainer, Pokémon, Profile, Project, Egg, operation, provider, offer, consent-evidence, or hash identity. Owner projections carry `gmDiagnostics: null`. Cross-owner private mechanics are not resolved or exposed before consent.

## Current choices and explicit creation

The BR-073 endpoint accepts the wizard selectors, one opaque draft ID, a sorted set of opaque server option IDs, and an explicit `confirmed` boolean. Nature, Ability, Gender, rank, canonical values, campaign-option values, provider facts, controls, hashes, consent, and mechanics claims are wire-forbidden. Unknown, duplicate, stale, or unissued option IDs fail closed.

The response nests the exact current BR-072 guidance and adds:

- Nature choice authority at current Adept Pokémon Education, Ability at Expert, and Gender at Master;
- `random-only` below each rank and `unavailable` when current Breeder authority cannot be resolved;
- an explicit statement that all three canonical trait values resolve later at Egg production, not Project creation;
- safe labels for all 15 current campaign settings;
- two opaque General Education/Perception options when Dilettante currently grants Breeder;
- audited per-parent GM maturity confirmations when the current campaign policy requires them;
- two bounded complementary parent-role options only when canonical compatibility requires GM role adjudication;
- one closed confirmation state and, after success, only the new Project ID, revision, and status.

Selecting an option refreshes the complete self-hashed projection. Pressing **Confirm and create project** sends a separate explicit confirmation. The server then rebuilds authentication/Profile control, Trainer rosters and revisions, campaign clock/options, exact app-owned references, Breeder/Feature handoffs, authorization/overrides, adjudications, and BR-042 setup validation. It persists required review evidence before applying it and calls the existing `createBreedingProjectFromValidatedSetup` transaction. A ready same-owner Project starts at revision zero in `initial-time-in-progress`, with zero credited minutes at the exact campaign-clock checkpoint. Confirmation never advances the clock, performs the DC 12 roll, resolves offspring traits, or creates an Egg.

Exact retries return the same Project without another revision, adjudication, realtime row, publication, or random draw. A changed parent revision, campaign option, provider handoff, security/reference hash, or option identity requires fresh authority. Cross-owner confirmation creates only the reviewed waiting Project and cannot start campaign-time progress until every required BR-077 consent is current.

## Project and Egg activity cards

After the shell authorizes one selected Trainer, the BR-074 activity endpoint rebuilds that same Profile/Trainer or GM context against the current campaign database. Aggregate IDs are lookup results, never request authority. One response contains at most the 50 most recently updated owner Projects and 50 owner Eggs and explicitly reports truncation. It is security-bound, self-hashed, plain-JSON-only, and rejected by the browser before adoption on any shape, policy, or digest drift.

Project cards show human parent/Breeder labels, revision and exact status, combined progress against the reviewed 480 campaign minutes, current consent state, and bounded aggregate milestones. An owner can identify only their own parent; a participating parent's sheet identity is structurally null and rendered only as `Participating parent`. An authenticated GM may identify both current parent references for the selected owner's card. Neither card audience receives Profile IDs, operation IDs, hashes, rolls, providers, read sets, receipts, or consent records.

Egg cards show owner-authorized resolved Species, Nature, Ability, Gender, starting Level, source class, exact incubation progress/pause, revision/status, and bounded lifecycle/consumed-transfer milestones. Transfer presentation comes only from current Egg status/revision and durable consent rows. It exposes either a visible setup/review handoff or a concise unavailable reason. Opening setup is non-mutating and ownership never changes optimistically.

## Private consent center

BR-077 uses `POST /api/breeding/consent` for both its strict initial projection and explicit confirmed mutations. A player request must match the selected current Profile and one Profile-linked Trainer; a GM request carries no Profile selector. Requests contain only aggregate selectors, expected revisions, opaque consent selectors, destination Trainer selectors, and confirmation. Commands, read sets, receipts, scopes, consent claims, mechanics, provider evidence, rolls, and client-derived authority are rejected.

A participating parent owner sees only their own parent label, safe relationship, Project status, own consent state, expiry, and currently authorized grant or revoke action. The counterpart parent, destination owner, private mechanics, Profiles, evidence, and aggregate internals are structurally absent. The final required grant inserts one immutable current-revision consent and advances the exact waiting Project into `initial-time-in-progress` in one transaction. Revocation settles only that participant's grant through the existing lifecycle authority; a later grant requires the new Project revision and a new deterministic consent identity.

Egg gifting remains a distinct agreement. The source owner makes one `source-gift` offer and the recipient independently records one linked `recipient-acceptance`. Neither Project consent nor GM authority substitutes for either approval. Completion delegates to the BR-064 dual-consent transfer transaction and cannot change ownership optimistically. Participant revocation and campaign-time expiry settle an active transfer consent through the dedicated `settle-egg-transfer-consent` operation, preserving immutable terminal evidence and publication-silent exact retries.

A pending operation scope turns the matching Project or Egg consent card into an amber system-recovery state and disables every ordinary grant, revoke, cancel, accept, or transfer action. Normal users receive a safe authoritative refresh action, not a command payload or a second mutation. Notifications are bounded actionable counts and never include counterpart identity, choices, consent documents, or private mechanics. GM cards explain that setup/recovery authority cannot impersonate participant consent; the only GM Project action in this surface is an audited cancellation. Recovery is visually and semantically separate from a game decision.

## Hatch decision, special review, and child reveal

BR-075 opens a hatch flow only from a currently authorized Egg card. Its request contains the exact selected Profile or GM context, owner Trainer and Egg selectors, expected Egg revision, one closed intent, at most one current opaque destination option or special option ID, and explicit confirmation for every mutation. It cannot contain a command, destination kind/capacity claim, roll, trait, child patch, roster identity, read set, receipt, provider, or mechanics claim. The server rebuilds current role/Profile control, owner Trainer, Egg, campaign clock/options, app-owned references, hatch offers, complete read sets, and authorization receipts on each step.

The flow delegates rather than duplicating mechanics:

1. **Begin hatch** projects independent current Box and team offers in fixed order. Box remains available for a ready Egg; team is disabled at six active Pokémon and exposes only the remaining-slot count plus `breeding.hatch-offer.team-full`, never roster identities. The browser confirms one opaque option ID, and the server regenerates its exact destination authority before the established transaction persists one d100. Stale or unavailable selection draws nothing; retries never redraw.
2. **Special review** appears only when the persisted total triggers the established bounded workflow. Owners receive only a waiting state. A current GM receives the one roll total, canonical triggers, and exactly three opaque nonmechanical outcome options, then confirms one through the existing atomic adjudication settlement. Neither 1 nor 100 automatically means Shiny, and no option changes the resolved Nature.
3. **Complete and reveal** delegates to the existing atomic completion transaction. Child sheet allocation, exactly one accepted team/Box link, Egg settlement, lineage, Species-acquisition history/reward, terminal result, and restricted refresh rows commit together. The accepted reveal contains only child sheet lookup slug, Species/Nature/Ability/Gender/starting Level, accepted destination class, and hatch campaign minute.

The response is a strict current-security-bound, self-hashed projection verified before browser adoption. It exposes no operation, command, read-set, receipt, evidence, hash, lineage payload, acquisition outcome, Trainer roster identities, or Profile identity. A durable pending Egg operation replaces every game decision with one system-recovery message and refresh control. Exact accepted replay is publication-silent and returns current bounded presentation without rerunning the reducer.

The dialog has a labelled modal boundary, native destination and GM radio groups, disabled-state explanations, separate confirmation buttons, 44-pixel controls, visible focus, Escape close, status/error/transition announcements, a mobile bottom-sheet layout, and a reveal animation disabled by reduced-motion preference. Accepted reveal links use only the storage-owned child slug and currently authorized Trainer slug through existing sheet routes; those routes still recheck normal access and confer no authority.

## Presentation states

The shell has explicit paths for:

- initial loading;
- selected Profile required;
- no authorised Trainers;
- an available Trainer with no current project or Egg activity;
- a stale linked Trainer that is unavailable;
- failed requests with retry;
- paginated Trainer loading.

Changing Profile or Trainer clears stale pagination and asks the server for fresh authority. Pagination appends only a strictly parsed, hash-verified response. No Workshop authority is persisted in the browser.

## Accessibility and responsive behavior

The page uses the existing Rotom design-system tokens required by `DESIGN.md`. It provides labelled regions, semantic headings and ordered wizard steps, labelled Trainer selects and parent checkboxes, visible keyboard focus, 44-pixel minimum controls, selection/status announcements, alerts for failures and unavailable pairs, and visible retry and close actions. Narrow layouts wrap steps and collapse cards to one column, and reduced-motion preferences are honored.

## Operational checks

If the Workshop cannot load:

1. confirm an authenticated GM or player role;
2. for a player, confirm the selected Profile still exists and has intended Trainer links;
3. confirm the campaign clock and SQLite connection are available;
4. retry to force a current server projection;
5. treat security-policy or projection-hash mismatch as an integrity failure rather than rendering stale data.

The reviewed BR-070 shell contract is `data/breeding-automation/workshop-presentation-contract.json`, the BR-071 wizard contract is `data/breeding-automation/project-wizard-presentation-contract.json`, the BR-072 guidance contract is `data/breeding-automation/project-guidance-presentation-contract.json`, the BR-073 choice/creation contract is `data/breeding-automation/project-choices-presentation-contract.json`, the BR-074 card contract is `data/breeding-automation/workshop-activity-presentation-contract.json`, the BR-075 hatch-flow contract is `data/breeding-automation/hatch-workflow-presentation-contract.json`, the BR-076 destination contract is `data/breeding-automation/hatch-destination-presentation-contract.json`, and the BR-077 consent contract is `data/breeding-automation/consent-workflow-presentation-contract.json`. Focused evidence lives in the shared-contract, server-projection, current-reference, API-route, composable, component/accessibility, navigation, and Profile-route-guard tests named by those contracts.
