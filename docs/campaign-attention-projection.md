# Campaign attention role and Profile projection

P8-089 turns the P8-083–P8-088 detector outputs into one strict, privacy-safe campaign snapshot. `GET /api/campaign/attention` is the only client-facing read boundary. It authenticates the current role, resolves the selected Player Profile on the server, reads all detector authority in one bounded SQLite transaction, and returns a schema-v1 projection.

## Complete snapshot authority

The loader reads at most 10,000 rows from each authority collection:

- current Pokémon and Trainer sheet documents;
- hash-bound Player Profiles;
- immutable encounter-settlement history and attention sources;
- item-operation records;
- Pokémon Eggs, breeding origins, and breeding operations;
- current Skill Check documents; and
- the current campaign clock.

Before any repository hydration, SQLite counts each table and rejects overflow. Identity rows are read deterministically and then reloaded through their strict owning repositories. A missing row, duplicate identity, malformed canonical document, changed selected Profile, incomplete declaration, future authority, or divergent provider result fails the whole projection. A partial queue is never returned.

The detector universe is selected from authority rather than names or folders. A character sheet is campaign-relevant only when current structured authority connects it to a Player Profile, a `player: true` sheet, a Trainer roster, a settlement attention source, an immutable capture fact, or an Egg/lineage record. The selection closes transitively across exact Trainer team and Box slugs. Saved wild or NPC encounter Pokémon do not become advancement or recovery work merely because they exist in the sheet table.

All seven providers run from that same snapshot: settlement seeds, advancement, Pokémon choices, Trainer choices, recovery, Skill Checks, and roster/ownership/equipment. Pending Skill Checks create one GM observation plus one owner response item for each exact snapshotted subject controller still awaiting a response. Ready checks and checks with a declined response create urgent GM review. Accepted, cancelled, and timed-out checks create no open attention. Byte-equal duplicate identities are collapsed because capture and level sources intentionally feed more than one detector. A duplicate identity with different content is authority corruption and fails closed. The merged queue is capped at 10,000 and sorted by urgency, entity, reason, creation minute, and stable identity.

## Role policy

The API response contains only current open items. Resolution removes an item from the next complete snapshot rather than asking the browser to maintain a second local tombstone list.

- **GM** receives all open GM and owner items for campaign-wide orchestration.
- **Player with a selected Profile** receives only `owner` items bound to an exact Trainer directly linked by that Profile, a directly linked Pokémon, a Pokémon in a valid current team/Box roster of a linked Trainer, or an exact Skill Check controller snapshot.
- **Player without a selected Profile** receives a valid empty owner snapshot.

Indirect roster access is fail-closed. A malformed, duplicate, over-limit, or team/Box-overlapping roster grants no Pokémon attention access. Public-sheet or map visibility does not grant campaign-decision ownership. Non-sheet owner items require an unambiguous authority. Skill Check owner items are first matched against the exact snapshotted controller Profile, then projected with a neutral campaign entity so the Profile ID never crosses the owner response boundary.

Every decision and legal action must repeat the item’s exact authority. Divergent action authority blocks the projection. The owner response contains no Profile ID or display name. Its snapshot identity includes a one-way hash of Profile authority so a Profile update cannot be confused with a byte-equal stale context.

## Snapshot and realtime reconciliation

`CampaignAttentionProjectionV1` contains:

- one stable content-addressed snapshot identity;
- `gm` or `owner` scope;
- current campaign minute;
- up to 10,000 unique, open, deterministically ordered items; and
- exact urgency counts.

The strict shared parser rejects unknown fields, malformed identities, terminal rows, duplicate rows, wrong order, summary drift, GM rows in owner scope, and future campaign minutes.

The client reconciliation helper uses a principal-context key and monotonically increasing request generation. Only the latest request for the unchanged principal may replace state. A complete response replaces the prior array atomically, so additions, updates, and clears need no client-created rows or local tombstones. Byte-identical snapshot replays preserve the accepted object and cannot duplicate items.

Existing authorized `sheets` events trigger reloads for sheet, equipment, capture, hatch, item, and campaign-day changes. The dedicated `campaign-attention` channel carries payload-minimal invalidation events for authority changes that do not necessarily produce a sheet event. Profile updates and committed Skill Check operations publish one GM-scoped event and one event for each affected exact Profile. The access descriptor is enforced server-side and stripped from the wire; the event payload contains only schema version and registered cause, never a Profile identity or Skill Check identity. Transient invalidations are hints only: publication failure does not alter a committed operation, while reconnect and replay-gap recovery always reload the complete HTTP snapshot.

P8-090 consumes this contract to render the continuation dashboard. It must not merge detector rows locally, infer ownership from labels, or preserve an item that disappeared from a newer complete snapshot.
