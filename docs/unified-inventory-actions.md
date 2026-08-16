# Unified inventory actions

P8-061 defines one safe action anatomy for Trainer and group inventory. The machine-readable interface contract is `data/complete-play-loop/unified-inventory-actions.v1.json`; the strict shared runtime types and parsers are in `shared/itemAutomation/inventoryActions.ts`.

The contract covers:

- use;
- equip and unequip;
- give and take;
- transfer;
- split and merge;
- discard;
- inspect; and
- guided adjudication.

It is an **interface and routing contract only**. It does not grant item mechanics, ownership, custody, compatibility, quantity, destination, or mutation authority. Existing item, equipment, transfer, stack, and guided use cases remain the owning mutation boundaries.

## One offer anatomy

Every server-issued action offer contains:

1. **Action and handoff** — the visible action plus the existing owning subsystem. Inspect is app-relative navigation; every other action is a command.
2. **Safe source** — an opaque offer-local source selection and user-readable container, section, presentation row, item, quantity, and stack/whole-item form. The selection and row label are never the row, serialized-item, operation, Profile, or provenance authority identity.
3. **Authority checks** — authenticated-role and bounded source/destination/target/custody checks. An action cannot be enabled while any advertised check is unsatisfied.
4. **Exact revisions** — current opaque source requirements, plus current requirements attached to each destination option.
5. **Quantity policy** — no quantity, one fixed value, a bounded current range, or the exact whole current stack.
6. **Destination policy** — none, optional, one required bounded current option, or a server-determined destination.
7. **Consequences** — safe text identifying inventory consumption or reservation, movement, equipment custody, stack changes, discard, mechanics, or guided settlement, including whether each is reversible, correctable, or irreversible.
8. **Confirmation** — ordinary action submission, a separate exact irreversible confirmation, deferred bounded GM settlement, or none.
9. **Availability** — one stable safe reason whenever the action is disabled.

The contract deliberately omits row IDs, serialized instance IDs, operation IDs, Profile IDs, definition hashes, ownership evidence, private notes, and provenance.

## Declaration boundary

A mutation declaration carries only:

- one opaque operation ID;
- the current offer and action;
- the offer-local source selection;
- one quantity;
- an optional bounded destination;
- the exact destructive confirmation when required; and
- the complete expected source and selected-destination revision set.

`validateInventoryActionDeclarationAgainstOffer()` rejects changed sources, unavailable actions or destinations, quantity drift, partial whole-item/whole-stack operations, confirmation drift, missing or added revisions, and stale revision values.

Matching an offer is not commit authorization. The handoff use case must reload every mapped resource, reauthorize the authenticated principal, resolve canonical item or equipment definitions, validate current custody and destination rules, and use its existing atomic journal, compare-and-swap writes, terminal replay, privacy projection, and after-commit realtime publication.

## Handoffs

| Action | Owning handoff |
|---|---|
| Use | Item operation |
| Equip, unequip, give, take | Equipment operation |
| Transfer | Existing inventory transfer |
| Split, merge, discard | Inventory stack operation introduced in P8-064 |
| Inspect | App-relative navigation only |
| Guided adjudication | Existing guided adjudication journal |

P8-062 populates exact safe source choices as documented in [`inventory-source-selection.md`](inventory-source-selection.md). P8-063’s executable Use/Equip/Give/Transfer adapters, replay journal, authoritative response adoption, and bounded decision surface are documented in [`unified-inventory-action-flows.md`](unified-inventory-action-flows.md). P8-064 through P8-066 continue adapting stack operations, group use, and checkout results without creating competing mechanics.
