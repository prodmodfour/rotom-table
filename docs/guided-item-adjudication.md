# Guided item adjudication

Rotom Table uses one durable, bounded adjudication queue for reviewed item mechanics that cannot be inferred deterministically. The supported v1 set is Energy Powder, Energy Root, Heal Powder, Revival Herb, Poultices, and Re-Breather.

## Lifecycle

1. A controlled user declares an eligible offer.
2. Consumables are reserved by the existing item-operation journal. Re-Breather declarations bind one exact active equipment instance and current owner/campaign-clock revisions.
3. Declaration creates one `item_guided_requests` row at revision 0. No HP, condition, Loyalty, action, capability, clock, or inventory mutation occurs yet.
4. The authenticated GM sees only canonical facts and server-issued radio outcomes on **Campaign → Guided item adjudication**.
5. Acceptance atomically resumes the reserved item operation or applies the exact Re-Breather transition, records the decision, updates affected revisions, and publishes role-safe realtime invalidations.
6. Cancellation is mechanically inert and releases any consumable reservation.

Terminal requests are immutable at revision 1. A repeated identical operation returns the stored result; changed payload under an operation ID is rejected.

## Bounded outcomes

Repulsive medicines and Poultices permit `record-no-loyalty-change`; Pokémon targets additionally permit `lower-loyalty-by-one`. The GM cannot supply a numeric delta or freeform mechanic. Trainer targets never receive a Loyalty decrease.

Re-Breather permits only the server-issued action for its current state:

- `ready` → GM acceptance activates `Gilled` for 60 authoritative campaign minutes;
- `active` → campaign-clock reconciliation changes it to `depleted` at expiry;
- `depleted` → GM acceptance starts a confirmed open-air refill;
- `refilling` → campaign-clock reconciliation returns it to `ready` after 5 minutes.

Activation is a Standard Action when encounter action authority exists. The state and grant are recomputed from exact Trainer-head or Pokémon-held custody. Source loss, stale definitions, suppression, broken equipment, changed revisions, or stale campaign time fail closed.

## HTTP API

`GET /api/items/guided`

- Authenticated GM with no owner query: pending GM queue.
- Controlled owner: `ownerKind=trainer|pokemon&ownerSlug=<slug>&profileId=<profile>` returns only that owner's requests and Re-Breather offers.

`POST /api/items/guided`

Accepts one strict `command` plus optional `profileId` and `clientId`:

- `declare-re-breather` binds owner kind, owner slug, owner revision, and offer ID;
- `resolve` binds request ID, expected revision, and one projected option ID;
- `cancel` binds request ID and expected revision.

Unknown fields and malformed identities are rejected before use-case execution.

## Recovery and privacy

The browser retains exactly one profile/scope-bound POST command in session storage while transport status is uncertain. In that state exact retry is the only mutation: refresh, cancellation, and competing decisions are disabled. A definitive 4xx clears the command as a conflict; a successful exact replay clears it as accepted.

Public and owner projections omit source rows, inventory/equipment instance IDs, operation IDs, hashes, decision principals, private Loyalty receipts, notes, and raw lifecycle evidence. Realtime publishes a GM-only invalidation and one sheet-access invalidation containing safe request identity/status only. Setup saves cannot forge `serverPrivate.itemGuidedLoyalty` or Re-Breather serialized authority.
