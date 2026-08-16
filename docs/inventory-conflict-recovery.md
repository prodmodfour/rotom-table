# Inventory conflict and recovery

P8-068 makes stale inventory state and uncertain mutation results explicit System workflows. Recovery applies to Trainer and shared inventory actions, item use, equipment custody, Extended Actions, and Trainer exploration item commands. It never grants mechanics or repairs custody from the browser.

## State boundaries

### Uncertain result

A request is uncertain when the browser cannot prove whether the server accepted it—for example, a connection drops after submission or a success response is malformed. Before dispatch, the browser retains the exact schema-v1 command or declaration. While uncertainty remains:

- every competing inventory mutation in that Trainer or shared-inventory scope is locked;
- cancellation, source switching, manual inventory edits, and refresh cannot replace the command;
- only **Retry exact action/use/command** may submit a mutation;
- retry sends the same operation identity, actor Profile, source, destination, quantity, choices, and revisions;
- reconnecting changes presentation only and never submits automatically; and
- an accepted replay adopts authoritative resources and cannot apply the mutation twice.

The recovery card deliberately says what is known: the original action is retained, its terminal result is not yet known, and no new command will be created. It does not claim that items moved, remained, were lost, or were consumed before the server returns terminal evidence.

A terminal 4xx response clears only that exact retained payload. A network failure, 5xx response, malformed success payload, tab reload, or browser restart keeps it.

### Conflict

A conflict means current authority no longer matches the local selection or another client resolved the retained command. Common causes include:

- stale source or destination revision;
- a moved, merged, removed, or replaced row;
- changed quantity, metadata, equipment state, or target state;
- a pending item reservation or reusable-item lock;
- a Profile or ownership change; and
- another tab accepting or definitively rejecting the retained command.

The only recovery action is **Reload authoritative inventory**. This first reloads the Trainer or group document, discards stale local selection, and then requests fresh server-issued offers. Reload is non-mutating. It never replays the rejected command, searches by item name, substitutes a nearby row, or patches quantity locally.

Reserved rows remain visible. Server projections expose current unreserved quantity and safe textual unavailable reasons; row controls show reservation text rather than relying on a disabled button tooltip.

## Offline and reconnect behavior

The System card listens to browser `online` and `offline` signals:

- offline exact retry remains visible but disabled with “Available after reconnection.”;
- returning online changes the status to ready for explicit retry;
- no listener calls a mutation endpoint; and
- an explicit click remains required even when realtime evidence suggests another client changed the inventory.

Browser connectivity is only presentation evidence. The server response remains terminal authority.

## Cross-tab and restart coordination

Strict pending payloads are mirrored in same-tab session storage and origin-local durable storage. They remain Profile- and inventory-scope-bound and are parsed through their existing command contracts on every read.

A private origin-local scope lock permits one unresolved mutation flow per Trainer or shared inventory. A second Equip, Give, Transfer, Split, Merge, Discard, Use, equipment, Extended Action, or exploration command fails before network dispatch while another exact command owns that scope. The lock and payload are not capabilities and never cross the API boundary.

Open tabs receive `storage` events. The matching flow enters uncertainty and can retry the same exact payload when the same Profile is selected. If another tab clears that payload after a terminal result, waiting tabs transition to conflict and must reload authoritative inventory. They do not assume whether the other tab accepted or rejected it.

A browser restart restores the strict payload from durable origin-local storage and remirrors it into the active tab. Raw commands, operation IDs, Profile IDs, stable row IDs, instance IDs, revisions, hashes, and lock records are never rendered.

## Profile switching

A recovered player command remains bound to the Profile that created it. With another Profile selected, recovery stays blocking and exact retry is disabled. Selecting the original Profile re-enables the same retained command; no replacement is generated.

## Operator procedure

When a user reports an uncertain inventory action:

1. Keep the affected inventory open and do not edit the row elsewhere.
2. Restore connectivity if the card says offline.
3. Select the same player Profile that began the action.
4. Choose the explicit exact-retry control once.
5. On accepted replay, allow returned authoritative documents and realtime events to converge.
6. On a definitive conflict, choose authoritative reload and make a new decision from current offers only.

For a cross-tab warning, finish recovery in either tab, then reload authority in every other waiting tab. Do not clear browser storage, edit SQLite/JSON, replay a newly built command, or manually adjust quantity.

Malformed local recovery evidence is removed and never submitted. If strict evidence is unavailable, the UI fails closed into reconciliation; operators repair only through existing reviewed server recovery/correction paths.

Run the bounded certification with:

```bash
npm run check:complete-play-loop-inventory-recovery
```

## Visual and accessibility contract

The selected target is `.pi/artifacts/ui-mockups/inventory-conflict-recovery/v002.png`, scored 10/10.

Recovery is a matte System card with an amber uncertainty or danger conflict signal spine. Warning, connection, shield, and lock icons accompany text, so state does not rely on colour. The heading receives focus on state changes, enabled controls use the cyan focus outline, controls are at least 44 pixels high, and desktop inventory/recovery columns reflow to one column without horizontal page overflow.

The machine-readable contract is `data/complete-play-loop/inventory-conflict-recovery.v1.json`.
