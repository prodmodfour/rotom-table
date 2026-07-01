# Shops and live-play checkout

Shops are reusable campaign shop tables with server-authoritative checkout. They are part of the live-play architecture: GMs prepare shop documents with revision-checked setup saves, while purchases run only through a `shopCheckout` live-play command.

## Runtime authority and storage

SQLite is the runtime authority for shop state.

- `shop_tables` stores each `ShopTableDocument` plus the authoritative `revision` and `updated_at` columns.
- `shop_checkout_ops` stores terminal checkout operation history: `op_id`, `shop_slug`, command hash, command JSON, result JSON, result revision, and creation time.
- `realtime_events` stores durable shop, trainer sheet, group inventory, and terminal checkout result events that are published only after commit.
- `maps` may contain `shopInterfaces[]`, but those entries are references only.
- Trainer money/inventory remains in trainer documents in `sheets` with `kind='trainer'`.
- Shared party money/inventory remains in `group_inventories`.

Do **not** store shop catalog, prices, stock, purchase logs, or open/closed state in map metadata, group inventory documents, trainer sheets, fake trainer sheets, or transient realtime events. JSON under `data/shops/` is an explicit maintenance export/interchange shape only, not runtime fallback authority.

## Shop document shape

A shop table document contains:

- identity and authority: `slug`, `revision`, `updatedAt`, `name`, optional `folder`;
- presentation: optional `description`, `playerVisible`, `open`;
- checkout policy: `allowedPaymentSources`, `allowedDeliveryTargets`;
- catalog rows: `entries[]`;
- GM-only metadata: optional `gmNotes` and bounded `purchaseLog` audit entries.

Each entry contains a stable `id`, `itemName`, trainer-inventory `section`, non-negative integer `price`, `stock`, optional `maxPerPurchase`, optional player description, optional GM notes, and optional tags. `stock: null` means unlimited stock. A number means finite stock and is decremented by accepted checkout.

Normalizers trim strings, allocate stable row IDs, coerce prices and finite stock to safe non-negative integers, default new shops to hidden/closed, default payment and delivery policy to trainer-only, and normalize sections to the existing trainer inventory section model.

## Routes and browser surfaces

Authoritative shop API routes are:

| Route | Purpose | Authority boundary |
| --- | --- | --- |
| `GET /api/shops/list` | List shops. GMs receive all shops; players receive only open and player-visible shops. | SQLite read from `shop_tables`. |
| `GET /api/shops/load?slug=<shop>` | Load one shop. Player loads reject hidden or closed shops. | SQLite read from `shop_tables`. |
| `POST /api/shops/create` | GM creates a normalized shop. | Setup/maintenance mutation. |
| `POST /api/shops/save` | GM saves a full shop document with `slug`, `expectedRevision`, `document`, and optional `clientId`. | Revision-checked setup/maintenance mutation. |
| `POST /api/shops/delete` | GM deletes a shop, optionally with `expectedRevision`. | Revision-checked setup/maintenance mutation. |
| `POST /api/shops/checkout` | Dispatch a `shopCheckout` live-play command. Plain non-command checkout payloads are rejected. | Live-play command mutation. |

Browser routes are:

- `/shops` — GM shop library or player open-shop library;
- `/shops/<slug>/edit` — GM editor for metadata, policy, entries, and recent audit entries;
- `/shops/<slug>` — player-facing shopfront used by both players and GM preview/purchases.

Player-facing reads and realtime delivery redact `gmNotes`, entry GM notes, and `purchaseLog`. The GM editor displays recent purchases to help debug table play.

## GM setup/maintenance edits

GM shop create/save/delete is not live checkout. It is preparation and maintenance:

1. The route requires GM role and writable campaign mode.
2. Saves include `expectedRevision` and are rejected when the stored shop changed first.
3. The repository normalizes the submitted document before persistence.
4. Successful changed saves produce authoritative documents with updated `revision` and `updatedAt`.

Do not use setup saves for player purchases, stock decrement, payment, or delivery. Those effects must cross the live-play command boundary below.

## Checkout command boundary

Checkout is represented by `LIVE_PLAY_COMMAND_TYPES.SHOP_CHECKOUT`, whose wire value is `shopCheckout`. The route body is a full live-play command envelope with `schemaVersion: 1`, an `opId`, `type: 'shopCheckout'`, `scopes`, `payload`, `clientId`, and for player requests a selected `profileId`.

The payload names the shop and expected revisions for every mutable participant:

```ts
{
  shopSlug: string,
  shopRevision: number,
  paymentSource: { kind: 'trainer' | 'groupInventory', slug: string, revision: number },
  deliveryTarget: { kind: 'trainer' | 'groupInventory', slug: string, revision: number },
  lines: { entryId: string, quantity: number }[],
  origin?: { kind: 'shopPage' } | {
    kind: 'mapInterface',
    mapSlug: string,
    interfaceId: string,
    actorPlacementId?: string,
  },
}
```

Accepted checkout runs in one SQLite transaction: it verifies revisions, validates stock and cart limits, subtracts money, delivers inventory rows, decrements finite stock, records the terminal operation result, appends the GM audit entry, and appends durable realtime rows. If any state write fails or any revision is stale, no money, inventory, stock, audit entry, or state-changing realtime update is committed; rejected commands may still store a terminal rejection and publish a terminal rejected event for idempotent recovery.

## Required checkout scopes

The submitted scopes must match the payload exactly:

- shop scopes:
  - `{ kind: 'shop', shopSlug, field: 'purchase' }`
  - `{ kind: 'shop', shopSlug, field: 'stock' }`
- payment source scope:
  - trainer payment: `{ kind: 'sheet', sheetKind: 'trainer', sheetSlug, field: 'money' }`
  - group payment: `{ kind: 'groupInventory', slug, field: 'money' }`
- delivery target scope:
  - trainer delivery: `{ kind: 'sheet', sheetKind: 'trainer', sheetSlug, field: 'inventory' }`
  - group delivery: `{ kind: 'groupInventory', slug, field: 'inventory' }`

Unknown scopes, missing required scopes, mismatched slugs, and malformed quantities are rejected before checkout is applied.

## Payment and delivery authorization

GM actors can use any valid payment source and delivery target supported by existing documents.

Player actors are more restricted:

- a selected player profile is required;
- the shop must be `open` and `playerVisible`;
- `allowedPaymentSources` must include the requested payment source kind;
- `allowedDeliveryTargets` must include the requested delivery target kind;
- trainer payment is allowed only for trainer sheets linked to the selected profile;
- trainer delivery is allowed only for trainer sheets linked to the selected profile;
- group inventory payment or delivery is offered and accepted only when the shop explicitly allows `groupInventory` for that side.

This is still Rotom Table's trusted-table role/profile model, not public authentication.

## Stock, prices, and delivery behavior

Checkout lines must have positive integer quantities and reference existing entries. Multiple lines for the same entry are aggregated for validation.

- Finite `stock` values are decremented by accepted checkout and reject when insufficient.
- Unlimited `stock: null` remains unchanged.
- `maxPerPurchase` is enforced after aggregation.
- Total price is the safe integer sum of `entry.price * quantity` for all lines.
- Payment documents must have enough money for the total.
- Purchased rows are merged into trainer or group inventory using the existing inventory transfer model; equipment-style rows remain whole-row delivery where the inventory section requires it.

The UI does not optimistically mutate money, stock, or inventory before a terminal accepted result.

## Idempotency and durable outbox

Checkout operation IDs use the existing live-play `op_...` ID format. The `shop_checkout_ops` table records each terminal result with the exact command body and hash. Retrying the same `opId` with the same command returns the stored terminal result without applying effects twice. Reusing an `opId` with different command material or a different shop is rejected as an idempotency conflict.

The browser journals checkout sends in the durable live-play command outbox before HTTP dispatch. Shop checkout outbox rows store the request path (`/api/shops/checkout`), exact body, actor auth context, `shopSlug`, `opId`, attempts, lease/claim state, and uncertain/terminal status. Shop-page checkout does not require a map slug. Retries resend the exact same command body and operation ID, making reloads, double-clicks, and uncertain HTTP results safe.

Duplicate/replayed accepted operations do not create duplicate purchases or duplicate GM audit entries.

## Realtime convergence

Accepted checkout appends durable realtime rows after the transaction has all state changes ready and publishes them only after commit:

- `shop:<slug>` receives the complete updated shop document;
- `shops` receives the updated shop list summary;
- `group-inventory:<slug>` receives updated group inventory documents when group money or inventory changed;
- `sheet:trainer:<slug>` and the sheet-list channels receive updated trainer sheets when trainer money or inventory changed;
- `shop:<slug>` also receives a terminal `live-play-command-accepted` event for the checkout operation.

Rejected stored checkout results append a terminal `live-play-command-rejected` event without document updates. Terminal shop events let the originating outbox acknowledge the operation even when realtime arrives before HTTP completes.

Clients use `clientId` for echo handling, ignore stale revisions, apply only complete authoritative documents, and reload/reconcile when a terminal accepted event is older than the locally loaded shop state. If another client lowers finite stock below a cart quantity, the shopfront clamps the cart and shows a non-blocking notice.

Shop realtime access is evaluated server-side from current shop visibility. Players receive shop updates only when the shop is open and player-visible; trainer and group inventory updates retain their own access rules instead of being broadcast to every shop viewer.

## Map shop interfaces

Maps can expose shop access points through `shopInterfaces[]` in the map document. Each interface stores only:

- stable map-local `id`;
- referenced `shopSlug`;
- display `label`;
- optional map `position`;
- optional `interactionRangeMeters`;
- optional `playerVisible` flag.

The referenced shop document remains authoritative for catalog, price, stock, policy, visibility, audit log, and open/closed state. Map interfaces must not copy or cache that commerce state.

GMs manage interfaces from the map admin UI while using the normal revision-checked map setup/edit save. Players cannot edit interfaces. The live map launcher offers players only interfaces marked player-visible whose referenced shop is also open and player-visible; GMs can preview/open any mapped interface.

When checkout origin is `{ kind: 'mapInterface' }`, the server reloads the map, verifies the interface exists, verifies it references the same shop slug, checks map access, and still applies normal shop authorization. For player actors, an `actorPlacementId` is required when the interface has a range or when the origin supplies one; the placement must be controlled by the selected player profile and within `interactionRangeMeters` when a range is configured. GM actors bypass player token-control/range checks but still validate the map and interface.

## Export, backup, and restore

Shop tables are included in SQLite JSON export:

```sh
npm run export:sqlite-json -- --output /safe/export/path
```

The export writes shop documents under `data/shops/`, preserves folder paths, and includes authoritative `revision` and `updatedAt` values so maintenance backups do not drop checkout-critical stock metadata.

For operational backups, back up the SQLite database plus WAL sidecars (`rotom-table.sqlite`, `rotom-table.sqlite-wal`, `rotom-table.sqlite-shm`) together with remaining campaign JSON such as player profiles, encounter tables, reference overrides, and intentional export copies. Do not restore or deploy shop fixes by copying JSON over production runtime state or editing production app files directly; change repository code/data through the normal project path and use SQLite import/export/backup workflows intentionally.
