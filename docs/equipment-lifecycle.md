# Equipment lifecycle operations

Equipment lifecycle is server-authoritative liveplay state. This guide describes operation, not runtime rules authority. Runtime semantics come from app-owned reviewed JSON and strict command contracts; evidence notes are never parsed as mechanics.

## GM workflow

On a full-authority Trainer or Pokémon sheet, open **Inventory/Equipment → Review lifecycle** for an equipped whole item.

Choose exactly one change:

- **Apply durability damage** or **Restore durability** only appears for reviewed durability state.
- **Suppress** withdraws current equipment mechanics while preserving custody.
- **Deactivate** records a durable inactive source.
- **Narrative break** is the guided fallback when no reviewed numeric durability exists.
- **Restore activity** or **Repair narrative break** removes one exact durable source.

Add a concise evidence note and submit. The note records why the GM acted; it cannot select or alter mechanics. Nothing changes optimistically. A stale sheet, equipment revision, instance revision, no-op, malformed state, unsupported durability, or missing exact reason is rejected before commit.

If the result is uncertain, use **Retry exact command**. Do not create another change. Exact replay reuses the persisted command and cannot apply damage, repair, or reasons twice.

## Durability

Only `Hand Net` and `Weighted Nets` currently have reviewed numeric durability, bound to their selected `durabilityMaximum` configuration in `equipment-definitions.v1.json`.

The private serialized state is `equipmentDurability` schema v1 with safe-integer `current` and `maximum` values. A new reviewed item starts at its selected maximum. Damage clamps at zero and adds `equipment.breakage.durability`; restoration clamps at the same reviewed maximum and removes that reason after durability becomes positive.

Never invent durability for another item. Use guided narrative breakage when adjudication is required, or make no mutation.

## Source loss and suppression

Unequip, take, swap, expend, and other exact source loss withdraw future contributions, grants, and event subscriptions immediately. Encounter overlays such as Magic Room suppress effective queries without rewriting custody or durable activity.

Accepted durable effects and provider receipts survive later source loss and remain exact-replay evidence. Source loss does not retroactively erase an accepted result.

Activity and durability are serialized with the whole item and survive inventory return, transfer, and re-equip. Every custody or lifecycle change increments authoritative revisions.

## Privacy

Players receive activity status and safe reason codes only. Full instance identity, reason source identity, provenance, hashes, configuration values, operation evidence, and serialized durability remain server/GM-private. Lifecycle controls require a full GM-authority sheet and are not rendered from player projections.
