# Breeding GM and player guide

## Purpose and access

The Breeding Workshop at `/breeding` is the campaign-scoped place to review Breeding Projects, Eggs, consent requests, and hatches. It is liveplay-only. It is not a map, encounter, inventory, or Pokémon-sheet substitute.

- **Players** must select a current Profile. They can use only Trainer sheets linked to that Profile.
- **GMs** use current campaign authority and do not select or impersonate a player Profile.
- A Trainer slug, Project ID, Egg ID, cursor, visible card, or browser state never grants access by itself.
- If a Profile link is stale, the Workshop may show only a safe unavailable context. Ask the GM to repair the Profile/Trainer link; do not recreate the Trainer from browser data.

The server rebuilds authority on every request. Reloading may remove choices that became stale. That is expected and prevents a browser from applying old mechanics.

## Lifecycle at a glance

1. Select the destination Trainer and Breeder Trainer.
2. Select exactly two current parent Pokémon.
3. Review compatibility guidance, consent requirements, campaign settings, and server-issued choices.
4. Confirm Project creation. This does not create an Egg or advance time.
5. Accumulate 240 campaign minutes.
6. Resolve the server-owned Breeder check at DC 12.
7. After success, accumulate another 240 campaign minutes.
8. Produce one accepted Egg through the authoritative Project transaction.
9. Accumulate Egg incubation through campaign time and approved providers.
10. Begin the hatch, resolve any GM-only special review, choose Box or an available team slot, and complete the atomic child reveal.

The minimum ordinary Project timeline before Egg production is 480 campaign minutes. Browser time, real-world waiting, scenes, maps, encounters, time zones, and page reloads do not count.

## Player workflow

### Select a Trainer context

Choose a Profile first, then open the Workshop. The Trainer selector contains only current Profile-linked contexts. Changing Profile or Trainer clears stale wizard, consent, transfer, and hatch state and requests a fresh server projection.

A player without a selected Profile sees a safe Profile-required state and no Trainer facts. A missing linked Trainer is displayed only as unavailable; it does not expose campaign-wide Trainer information.

### Create a Project

Open the Project wizard and complete the four steps:

1. **Destination** — the Trainer that will own the Project and resulting Egg.
2. **Breeder** — the Trainer whose current Breeder authority is checked by the server.
3. **Parents** — zero to two current Pokémon sheet/revision selectors from the authorized roster.
4. **Review** — timeline, safe compatibility status, required consent, and current server choices.

Unavailable parents remain visible only with bounded recovery reasons. The browser does not calculate Egg Groups, maturity, parent roles, traits, or compatibility. A complete pair still requires final server validation.

Nature, Ability, and Gender choice authority depends on the current effective Breeder contribution. The server may issue opaque choices; select only those currently shown. Below the required rank, a trait remains server-random. Dilettante, maturity, and parent-role review also use server-issued options. Selecting an option is non-mutating. **Confirm and create project** is a separate explicit action.

A same-owner accepted Project begins at zero credited minutes. A cross-owner Project begins in an awaiting-consent state and cannot resolve the other owner's private mechanics before consent.

### Review progress and recovery

Project and Egg cards show campaign-minute progress, exact status, bounded history, and safe available actions. A pending operation is shown as **system recovery**, not a game choice. Use refresh and wait for current authority. Do not create a second Project, change selectors to force a retry, or ask an operator to edit progress.

Exact retry means submitting the same selector intent after reconnect. It does not reroll, recreate an offer, duplicate time, or republish a result.

### Grant or revoke Project consent

A participating parent owner sees only their own parent contribution and the consent request needed for the current Project revision. Granting consent is positive, Profile-bound, Trainer-bound, parent-revision-bound, scope-bound, and campaign-time-bound.

- Grant only if the displayed parent and contribution are yours.
- Revocation before Egg acceptance blocks later production through the audited lifecycle path.
- A changed Project or parent revision requires fresh consent.
- Prior consent, browser acknowledgement, GM authority, or public visibility does not count.

### Offer or accept an Egg gift

Egg transfer uses a separate two-party agreement:

1. the current source owner confirms a `source-gift` offer;
2. the current recipient independently confirms `recipient-acceptance`;
3. an authorized participant completes the transfer after both remain current.

Project consent cannot replace transfer consent. GM authority substitutes for neither participant. Ownership changes only after the atomic server result; do not rely on an optimistic card change. Incubation and the accepted offspring blueprint remain unchanged by transfer.

### Hatch an Egg

A ready Egg presents a fresh hatch flow:

1. inspect current state;
2. select one opaque Box or team destination option and explicitly begin;
3. if special review triggers, wait for the GM;
4. explicitly complete and reveal the child.

Box remains available. Team is available only below the six-Pokémon limit and reports remaining capacity without exposing roster identities. The special d100 is persisted before use. A result of 1 or 100 does not automatically mean Shiny and does not change Nature.

Completion atomically creates one child sheet, adds exactly one Box/team link, settles the Egg, records lineage and first Species acquisition, applies any exactly-once Dex Exp reward, and publishes restricted refreshes. Follow the accepted child link; never create a placeholder child manually.

## GM workflow

### Campaign oversight

GMs may enumerate the bounded campaign Trainer directory and view GM Project/Egg cards for one selected owner context. GM views may contain current mechanics needed for adjudication, but routine notifications and public/owner projections remain private.

Use GM diagnostics only to identify bounded status and policy classes. Do not copy private parent, provider, roll, consent, Profile, command, read-set, receipt, or hash data into player chat or shared displays.

### Advance campaign time

Campaign time is the only lifecycle clock. Advance it through the authoritative campaign-clock operation. A long skip processes at most 100 due Eggs per deterministic page; continue at the same target minute until `hasMoreDueEggs` is false. Do not split credit manually or edit Project/Egg JSON.

Each Project and Egg uses its last applied clock revision/minute. Paused intervals are auditable and receive skipped rather than credited minutes. Overflow beyond an Egg's readiness threshold is retained in its incubation segment; it does not produce extra lifecycle credit.

### Resolve checks and reviewed choices

The ordinary Project sequence is 240 initial minutes, one server-owned d20 Breeder check against DC 12, then 240 additional minutes after success. Persisted offers and rolls are reused on retry. Use only current GM options supplied by the server for maturity, role, hatch special, duration, or source review.

GM overrides are durable, bounded, operation-bound evidence. They do not permit the GM to fabricate player consent, alter accepted offspring facts, bypass current references, or write directly to an aggregate.

### Alternate Egg sources

Fossil, GM-authored, mysterious, campaign-gift, imported, and Playing God Eggs use reviewed server operations and the ordinary Egg/incubation/hatch pipeline. They do not create inventory Eggs or pre-hatch Pokémon sheets. Imported provenance must remain source-hash- and review-bound. Legacy map metadata remains quarantine-only.

### Hatch special review

Only a current GM sees the persisted total, canonical trigger class, and three current opaque special options. Choose one option and confirm. Do not infer a hidden result, redraw the d100, alter Nature, or apply a manual child patch. If the operation is pending, recover the exact command under current GM authority.

### Consent limits

A GM may create reviewed cross-owner setup, inspect safe status, recover authorized operations, or cancel a Project through the audited path. A GM cannot grant, revoke, or manufacture either participant's Project or Egg-transfer consent. If consent is disputed, preserve the audit and stop progression; do not edit consent rows.

## Status and error guidance

- **400 Bad Request** — request shape, selector combination, or Profile context is malformed. Reload and use current controls.
- **403 Forbidden** — current role/Profile/Trainer authority does not permit the request. Do not probe other IDs.
- **409 Conflict** — a revision, option, consent, reference, operation, or dependency changed. Reload the authorized projection; do not mutate the old request.
- **413 Payload Too Large** — a Breeding POST exceeded the strict 32 KiB UTF-8 JSON envelope. The UI should never need to send mechanics or documents.
- **429 Too Many Requests** — wait for `Retry-After`, then retry the same selector intent. Rate admission does not advance campaign time or settle an operation.
- **Recovery state** — an operation has durable phase-one evidence. Refresh or use the authorized recovery action; never create a competing command.

## Shared-table privacy

On a shared display, use player/public presentation rather than GM diagnostics. Player views structurally omit participating-parent identity, private mechanics, evidence, raw operation data, and hidden options. Privacy is enforced by server schemas, not CSS. Browser storage retains only selected Profile presentation; it must not retain Project IDs, Egg IDs, consent, choices, mechanics, or operation payloads.

## Actions that are never valid

Neither a player nor a GM may:

- count wall-clock time as breeding or incubation progress;
- use a map token, inventory row, sheet flag, legacy field, or local storage as Egg authority;
- submit a command, roll, read set, receipt, provider evidence, or resolved mechanic through a Workshop API;
- create or link a child before accepted hatch completion;
- infer Species acquisition from a roster or edit `dexExp` directly;
- redraw on retry, replace an operation ID, or delete pending evidence;
- edit a Project, Egg, consent, lineage, acquisition, or archive row to resolve an incident.

For incidents, follow `docs/breeding/operator-guide.md`. API consumers should use `docs/breeding/api-reference.md`.
