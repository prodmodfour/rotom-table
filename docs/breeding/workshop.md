# Breeding Workshop

The Breeding Workshop is the campaign-scoped presentation entry point for breeding and Egg lifecycle work. Its route is `/breeding`; the read API is `/api/breeding/workshop`. It is not a map, encounter, placement, scene, or initiative surface.

BR-070 establishes only the Workshop shell, ownership context, navigation, and safe loading/empty/error states. Project creation, explanations, choices, Egg cards, incubation controls, hatch controls, and later GM tools remain owned by BR-071 through BR-078.

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

The page uses the existing Rotom design-system tokens required by `DESIGN.md`. It provides one labelled page region, semantic headings, labelled Trainer selection, visible keyboard focus, 44-pixel minimum controls, status announcements, alerts for failures and unavailable contexts, and a visible retry action. Narrow layouts become one column, and reduced-motion preferences are honored.

## Operational checks

If the Workshop cannot load:

1. confirm an authenticated GM or player role;
2. for a player, confirm the selected Profile still exists and has intended Trainer links;
3. confirm the campaign clock and SQLite connection are available;
4. retry to force a current server projection;
5. treat security-policy or projection-hash mismatch as an integrity failure rather than rendering stale data.

The reviewed BR-070 contract is `data/breeding-automation/workshop-presentation-contract.json`. Focused evidence lives in the Workshop shared-contract, server-projection, API-route, component/accessibility, navigation, and Profile-route-guard tests named there.
