# Inventory receipts and history

P8-067 adds a read-only, privacy-safe activity view beside Trainer and shared inventory. Inventory remains the authority and primary workspace; history explains accepted changes and never authorizes or repairs a mutation.

## What appears

The schema-v1 projection supports these structured categories:

- purchase;
- transfer;
- item use;
- equipment change;
- guided outcome;
- settlement award;
- discard; and
- GM correction.

Only committed terminal records appear. Pending, rejected, abandoned, interrupted, and rolled-back attempts do not become receipts. Existing authoritative journals are projected directly, so valid earlier terminal records are readable without a lossy history backfill.

A logical action appears once:

- an inventory action delegated to equipment execution is represented by the equipment operation;
- an item-backed guided request decorates the item-use receipt instead of adding a second receipt;
- a transfer affecting both Trainer and shared documents is one transfer receipt in each relevant scope;
- replaying the same checkout or operation does not add another receipt; and
- settlement integration must provide one durable private source key per award line.

History is not mutation authority. No command, recovery, transfer, item, equipment, shop, or settlement path reads a history receipt to decide mechanics or custody.

## Privacy and authorization

`GET /api/inventory/history` accepts exactly one scope:

```text
/api/inventory/history?trainerSlug=<slug>&profileId=<selected-player-profile>&limit=20
/api/inventory/history?groupSlug=main&profileId=<selected-player-profile>&limit=20
```

The default limit is 20 and the maximum is 50.

A GM may read either scope. A player may read Trainer history only when the selected Profile controls that exact Trainer. Authenticated players may read shared history, but item receipt audiences remain filtered: public facts are shared; owner facts require current ownership; GM facts remain GM-only.

The public contract contains only category, accepted time, a readable headline, a safe item label and quantity, generic custody labels, and bounded audience-filtered outcome text. It deliberately excludes:

- operation, request, stable row, inventory-instance, and equipment-instance identities;
- Profile identities and delegation evidence;
- revisions, hashes, commands, plans, raw evidence, and provenance;
- private notes and configuration JSON; and
- GM-only facts from player responses.

Malformed source records, conflicting duplicate source identities, unsupported shapes, or expansion beyond the strict projection contract fail closed. The API does not return a partial best-effort history.

## Interaction behavior

The inventory activity panel follows `.pi/artifacts/ui-mockups/inventory-receipts-history/v005.png`:

- inventory is primary in a roughly 60/40 desktop layout;
- activity is quieter and ordered newest first;
- category icons always have category text;
- timestamps use semantic `<time>` elements;
- the Refresh history control is at least 44 pixels high and has a visible keyboard focus ring;
- accepted receipts remain visible while refresh is in progress or fails; and
- narrow layouts reflow to inventory first, then activity, without page-level horizontal overflow.

Loading, accepted-empty, error/retry, refresh, and truncated-result states all have textual copy and do not rely on colour.

## Operations and troubleshooting

If expected activity is missing:

1. Confirm the underlying operation reached its authoritative terminal accepted or corrected state.
2. Confirm the requested scope was an affected resource in that journal.
3. Confirm the player selected the correct Profile for Trainer history.
4. Refresh history after the authoritative inventory has converged.
5. Inspect server logs for the generic projection conflict response. Do not expose or paste private journal payloads into player-facing UI.

Do not repair missing history by inserting a parallel receipt, searching inventory by item name, replaying a mechanical command, or editing inventory from the history panel. Repair the authoritative source journal only through its reviewed recovery path.

## Future settlement integration

P8-076 must adapt terminal settlement award lines through `InventoryHistorySettlementAwardSource`. Each line needs a stable private `sourceKey`, accepted timestamp, safe item and destination labels, quantity, and bounded details. The source key is used only for deduplication and deterministic ordering; it is never included in the public projection.

The machine-readable contract is `data/complete-play-loop/inventory-history.v1.json`.
