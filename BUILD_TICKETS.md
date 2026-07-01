# BUILD_TICKETS.md

AUTOMATION_STATUS: NOT_DONE

Ticket statuses:

* TODO — not done
* DONE — done

The build loop must select the lowest-numbered TODO ticket. Each ticket below maps to one Shops with Live-Play Integration implementation ticket from `tickets (1).md`.

Autonomous cycle rules for every ticket: implement only the selected ticket, run `scripts/quality-gate.sh`, update only the selected ticket status, commit with a conventional commit message, and leave the working tree clean. The final ticket (#035) may also set `AUTOMATION_STATUS: DONE` after all shop tickets are complete.

---

## 001 — SHOPS-001: Add shop document types and normalizers

Status: DONE

### Goal
Introduce the shared shop document model without adding persistence, routes, or UI.

### Scope
- Add `src/types/shop.ts` or an equivalent shared type file.
- Define:
  - `SHOP_TABLE_ROW_ID_PREFIX`
  - `ShopTableDocument`
  - `ShopEntry`
  - `ShopPaymentSourceKind`
  - `ShopDeliveryTargetKind`
  - `ShopStockValue`
- Include document fields:
  - `slug`
  - `revision`
  - `updatedAt`
  - `name`
  - `folder?`
  - `description?`
  - `playerVisible`
  - `open`
  - `allowedPaymentSources`
  - `allowedDeliveryTargets`
  - `entries`
  - `gmNotes?`
- Include entry fields:
  - `id`
  - `itemName`
  - `section`
  - `price`
  - `stock`
  - `maxPerPurchase?`
  - `playerDescription?`
  - `gmNotes?`
  - `tags?`
- Add normalizers that:
  - trim names/descriptions/notes;
  - allocate stable row IDs;
  - coerce price to a safe non-negative integer;
  - coerce finite stock to a safe non-negative integer;
  - preserve `stock: null` as unlimited;
  - default `playerVisible` to false;
  - default `open` to false;
  - default payment/delivery sources to trainer-only;
  - reject or normalize unknown section keys to the existing inventory section model.

### Acceptance criteria
- Unit tests cover empty input, partial legacy input, invalid price, finite stock, unlimited stock, duplicate row IDs, and default source rules.
- `npm run typecheck` passes.
- No SQLite, API, route, or UI code is added.

### Depends on
None.

---

## 002 — SHOPS-002: Add shop SQLite migration

Status: DONE

### Goal
Create durable storage for shop table documents.

### Scope
- Add a storage migration that increments `LATEST_STORAGE_SCHEMA_VERSION`.
- Create:

```sql
CREATE TABLE IF NOT EXISTS shop_tables (
  slug TEXT PRIMARY KEY,
  document_json TEXT NOT NULL,
  revision INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

- Do not add purchase operation storage yet; that is a separate live-play ticket.

### Acceptance criteria
- Migration versions remain contiguous.
- Fresh database migration creates `shop_tables`.
- Upgrade from the previous schema creates `shop_tables` without touching existing tables.
- Existing storage migration tests still pass.

### Depends on
- SHOPS-001

---

## 003 — SHOPS-003: Add shop table repository

Status: DONE

### Goal
Add the server-side repository for normalized shop table persistence.

### Scope
- Add `server/storage/shopTableRepository.ts`.
- Implement:
  - `get(slug)`
  - `list()`
  - `create(input)`
  - `replaceSetupShop(input)`
  - `deleteDocument(slug)`
  - `allocateSlug(base)`
  - `applyLivePlayUpdate(input)`
- Follow existing repository conventions:
  - JSON clone/stringify helpers;
  - authority fields on returned documents;
  - `revision` and `updatedAt` injection;
  - revision-checked setup saves;
  - live-play update returning `applied | stale` rather than overwriting.

### Acceptance criteria
- Repository tests cover create, list, get, rename/slug allocation if supported, setup save, no-op semantic save, stale setup save, live-play update, and delete.
- Normalization is applied before persistence.
- No HTTP routes or UI are added.

### Depends on
- SHOPS-001
- SHOPS-002

---

## 004 — SHOPS-004: Add shop route constants and list/load APIs

Status: DONE

### Goal
Expose shop discovery and loading to browser clients.

### Scope
- Add `SHOP_API_PATHS` to `src/utils/apiRoutes.ts`:
  - `list`
  - `load`
  - `create`
  - `save`
  - `deleteShop`
  - `checkout`
- Add `GET /api/shops/list`.
- Add `GET /api/shops/load`.
- GM list/load sees all shops.
- Player list/load sees only shops with `playerVisible === true` and `open === true`.
- Guests follow existing auth behavior.

### Acceptance criteria
- API tests cover GM list/load, player filtering, player hidden-shop rejection, player closed-shop rejection, missing shop, and invalid slug.
- Responses include authoritative `revision` and `updatedAt`.
- No mutation routes or UI are added.

### Depends on
- SHOPS-003

---

## 005 — SHOPS-005: Add GM create/save/delete APIs

Status: DONE

### Goal
Allow GMs to manage shop tables through revision-checked API routes.

### Scope
- Add `POST /api/shops/create`.
- Add `POST /api/shops/save`.
- Add `POST /api/shops/delete`.
- Require GM role and writable campaign mode.
- Save accepts `slug`, `expectedRevision`, `document`, and `clientId`.
- Delete rejects stale revisions if an expected revision is supplied.

### Acceptance criteria
- GM can create, save, and delete shops.
- Player and guest mutation attempts are rejected.
- Stale saves are rejected without changing storage.
- Save returns the authoritative document.
- Create/save/delete tests cover normalization, no-op saves, and conflict errors.

### Depends on
- SHOPS-004

---

## 006 — SHOPS-006: Include shops in SQLite export and maintenance paths

Status: DONE

### Goal
Ensure shop table data is not dropped by maintenance export/backup flows.

### Scope
- Update SQLite export scripts to include `shop_tables` under an appropriate export path such as `data/shops/`.
- Include revision and updatedAt in exported documents.
- Update import/maintenance helpers only if they contain hard-coded table assumptions.

### Acceptance criteria
- Export tests include at least one shop document.
- Existing map, sheet, group inventory, and realtime export tests still pass.
- No API or UI behavior changes are added.

### Depends on
- SHOPS-002
- SHOPS-003

---

## 007 — SHOPS-007: Add shop navigation and page shell

Status: DONE

### Goal
Add routes where GMs manage shops and players browse shops.

### Scope
- Add app route constants for:
  - `/shops`
  - `/shops/[slug]`
  - `/shops/[slug]/edit`
- Add primary navigation item `Shops`, visible to GM and players.
- Add `src/pages/shops/index.vue` shell with loading, empty, and error states.
- Add `src/pages/shops/[slug].vue` shell for the player-facing shopfront.
- Add `src/pages/shops/[slug]/edit.vue` or an equivalent GM edit route shell.

### Acceptance criteria
- GM and player navigation show Shops.
- `/shops` renders for GM and player roles.
- GM edit route is not available to players.
- No real shop rendering or mutation is added yet.

### Depends on
- SHOPS-004

---

## 008 — SHOPS-008: Add GM shop library page

Status: DONE

### Goal
Let GMs browse and create shop tables from `/shops`.

### Scope
- Load all shops for GM users.
- Render shop cards/rows with name, slug, open/closed badge, visible/hidden badge, entry count, and updated time.
- Add create-shop action wired to `POST /api/shops/create`.
- Navigate to GM edit route after create.

### Acceptance criteria
- GM sees all shops, including closed and hidden shops.
- Create button creates a normalized shop and navigates to edit.
- Player view is not changed by this ticket.
- Tests cover empty list, populated list, and create success/error.

### Depends on
- SHOPS-005
- SHOPS-007

---

## 009 — SHOPS-009: Add player shop library page

Status: DONE

### Goal
Let players browse open, visible shops from `/shops`.

### Scope
- Load player-filtered shop list.
- Render only player-visible/open shops returned by the API.
- Show closed/hidden shops as absent, not disabled.
- Link to `/shops/[slug]` for player shopfront.

### Acceptance criteria
- Player sees only open visible shops.
- Empty state explains that no shops are currently open.
- GM-only controls are not visible to players.
- Tests cover player-visible filtering and navigation.

### Depends on
- SHOPS-004
- SHOPS-007

---

## 010 — SHOPS-010: Add reusable shop entry editor table

Status: DONE

### Goal
Add a GM-facing editor component for shop entries.

### Scope
- Add a component such as `ShopEntryTable.vue`.
- Support editing:
  - item name;
  - inventory section;
  - price;
  - stock mode: unlimited or finite;
  - finite stock count;
  - max per purchase;
  - player description;
  - GM notes;
  - tags.
- Reuse existing item reference/autocomplete patterns where practical.
- Add add/remove row controls.

### Acceptance criteria
- Component tests cover row add, row remove, price editing, unlimited stock, finite stock, and section selection.
- The component mutates only the passed shop draft or emits explicit update events consistently with project patterns.
- No route save behavior is added in this ticket.

### Depends on
- SHOPS-001

---

## 011 — SHOPS-011: Add GM shop editor page

Status: DONE

### Goal
Let GMs edit full shop table documents.

### Scope
- Load the authoritative shop document in the edit route.
- Render fields:
  - name;
  - description;
  - playerVisible;
  - open;
  - allowed payment sources;
  - allowed delivery targets;
  - entries;
  - GM notes.
- Save through `POST /api/shops/save` with `expectedRevision`.
- Delete through `POST /api/shops/delete`.
- Handle stale save by showing a reload/refresh conflict message.

### Acceptance criteria
- GM can edit and save shop metadata and entries.
- Save adopts the authoritative returned document.
- Stale save does not overwrite the server document.
- Player cannot access the editor.
- Tests cover save success, save conflict, delete success, and delete failure.

### Depends on
- SHOPS-005
- SHOPS-010

---

## 012 — SHOPS-012: Add read-only player shopfront

Status: DONE

### Goal
Render a shopfront where players can inspect items before checkout exists.

### Scope
- Load `/api/shops/load` for the selected shop slug.
- Render name, description, open state, entries, price, stock, max per purchase, and player description.
- Do not show GM notes.
- Show disabled buy controls with a placeholder label until live-play checkout lands.

### Acceptance criteria
- Player can view an open visible shop.
- Hidden/closed shops are rejected or redirected with a clear message.
- GM can preview the player-facing shopfront.
- Tests cover visible entry rendering and GM-note redaction.

### Depends on
- SHOPS-004
- SHOPS-007

---

## 013 — SHOPS-013: Add shop checkout payload and live-play scope types

Status: DONE

### Goal
Define live-play command types/scopes for shopping without implementing checkout yet.

### Scope
- Extend shared live-play command types with:
  - `SHOP_CHECKOUT` command type;
  - `LivePlayShopScope`;
  - `LivePlayGroupInventoryScope` if it does not already exist;
  - checkout payload and result interfaces.
- Suggested scopes:

```ts
interface LivePlayShopScope {
  readonly kind: 'shop'
  readonly shopSlug: string
  readonly field: 'stock' | 'purchase'
}

interface LivePlayGroupInventoryScope {
  readonly kind: 'groupInventory'
  readonly slug: string
  readonly field: 'money' | 'inventory'
}
```

- Suggested payload:

```ts
interface ShopCheckoutPayload {
  readonly shopSlug: string
  readonly shopRevision: number
  readonly paymentSource:
    | { readonly kind: 'groupInventory'; readonly slug: string; readonly revision: number }
    | { readonly kind: 'trainer'; readonly slug: string; readonly revision: number }
  readonly deliveryTarget:
    | { readonly kind: 'groupInventory'; readonly slug: string; readonly revision: number }
    | { readonly kind: 'trainer'; readonly slug: string; readonly revision: number }
  readonly lines: readonly { readonly entryId: string; readonly quantity: number }[]
  readonly origin?:
    | { readonly kind: 'shopPage' }
    | { readonly kind: 'mapInterface'; readonly mapSlug: string; readonly interfaceId: string; readonly actorPlacementId?: string }
}
```

### Acceptance criteria
- Existing live-play command tests still pass.
- Type tests or unit tests cover valid/invalid shop checkout command envelopes.
- This ticket does not add server apply logic or client UI.

### Depends on
- SHOPS-001

---

## 014 — SHOPS-014: Add shop live-play operation history storage

Status: DONE

### Goal
Provide durable idempotency for shop checkout commands.

### Scope
- Add a migration for a shop checkout operation table, or generalize existing live-play operation storage if that is cleaner and commit-sized.
- Store:
  - `op_id` or `purchase_id`;
  - `shop_slug`;
  - command hash;
  - command JSON;
  - result JSON;
  - result revision;
  - created time.
- Same operation ID + same command returns the original terminal result.
- Same operation ID + different command is rejected.

### Acceptance criteria
- Tests cover first accepted result, duplicate accepted result, duplicate rejected result, and same ID with different command.
- Storage does not require a map slug for shop-page-origin checkout.
- Existing map live-play operation storage remains unchanged unless intentionally generalized with compatibility tests.

### Depends on
- SHOPS-002
- SHOPS-013

---

## 015 — SHOPS-015: Extract reusable live-play command idempotency helpers

Status: DONE

### Goal
Avoid duplicating hash/result/idempotency logic between map live-play commands and shop checkout commands.

### Scope
- Extract pure helpers for:
  - canonical command hashing;
  - duplicate command comparison;
  - accepted/rejected terminal result normalization;
  - operation ID validation;
  - result validation helpers where they are not map-specific.
- Keep map live-play command behavior unchanged.

### Acceptance criteria
- Existing map live-play command tests pass unchanged.
- New helper tests cover same-command and changed-command hashing.
- No shop checkout application logic is added in this ticket.

### Depends on
- SHOPS-014

---

## 016 — SHOPS-016: Add pure shop checkout calculation helpers

Status: DONE

### Goal
Implement the domain logic for checkout without persistence or API side effects.

### Scope
- Add helpers that:
  - validate positive line quantities;
  - reject missing entries;
  - reject insufficient finite stock;
  - enforce max-per-purchase;
  - calculate total price;
  - decrement finite stock;
  - leave unlimited stock unchanged;
  - subtract money from a payment document;
  - merge purchased rows into a trainer or group inventory target;
  - treat equipment as whole-row delivery if needed by the section model.
- Reuse group inventory transfer/merge helpers where practical.

### Acceptance criteria
- Unit tests cover unlimited stock, finite stock decrement, insufficient stock, max per purchase, multi-line totals, insufficient money, group payment, trainer payment, group delivery, trainer delivery, and no input mutation.
- No SQLite, API, live-play executor, or UI code is added.

### Depends on
- SHOPS-001
- SHOPS-013

---

## 017 — SHOPS-017: Add server-side checkout command parser and scope validation

Status: DONE

### Goal
Validate shop checkout live-play command envelopes before applying them.

### Scope
- Parse and validate `SHOP_CHECKOUT` commands.
- Validate expected scopes from payload:
  - shop purchase/stock scope;
  - group inventory money/inventory scope when group source/target is used;
  - trainer sheet money/inventory scope when trainer source/target is used.
- Reject unknown scopes, missing required scopes, wrong shop slugs, wrong trainer slugs, and malformed payloads.

### Acceptance criteria
- Tests cover valid command, missing shop scope, missing payment scope, missing delivery scope, extra invalid scope, invalid quantity, invalid entry ID, and malformed origin.
- No persistence or checkout apply logic is added.

### Depends on
- SHOPS-013

---

## 018 — SHOPS-018: Add GM shop checkout live-play use case

Status: DONE

### Goal
Allow GM actors to run checkout through the live-play command boundary.

### Scope
- Add a server use case such as `executeShopCheckoutCommandUseCase`.
- For GM actors:
  - read shop, group inventory, and/or trainer sheets required by the payload;
  - validate revisions;
  - apply pure checkout helpers;
  - persist all changed documents in one SQLite transaction;
  - store terminal operation result;
  - return authoritative changed shop/group/trainer documents.
- Publish no realtime yet; that is a separate ticket.

### Acceptance criteria
- Successful GM checkout updates shop stock and the payment/delivery documents atomically.
- Stale shop revision rejects without changing money, stock, or inventory.
- Stale payment/delivery revision rejects without changing money, stock, or inventory.
- Duplicate operation ID with same command returns stored result without double-applying.
- Duplicate operation ID with changed command rejects.
- Tests prove rollback if a later document write fails.

### Depends on
- SHOPS-003
- SHOPS-014
- SHOPS-015
- SHOPS-016
- SHOPS-017

---

## 019 — SHOPS-019: Add player authorization to shop checkout live-play use case

Status: DONE

### Goal
Allow player checkout only when the selected profile is authorized for the requested payment/delivery targets.

### Scope
- For player actors:
  - require selected player profile;
  - require shop `open === true`;
  - require shop `playerVisible === true`;
  - enforce `allowedPaymentSources`;
  - enforce `allowedDeliveryTargets`;
  - allow trainer payment only for profile-linked trainer sheets;
  - allow trainer delivery only for profile-linked trainer sheets;
  - allow group payment/delivery only when the shop explicitly allows group source/target.
- Preserve unrestricted GM behavior from SHOPS-018.

### Acceptance criteria
- Player with linked trainer can buy using trainer money into trainer inventory.
- Player cannot use an unlinked trainer as payment source or delivery target.
- Player cannot buy from closed or hidden shops.
- Player cannot use group funds or group delivery unless the shop allows it.
- Profileless player is rejected clearly.
- GM behavior remains unchanged.

### Depends on
- SHOPS-018

---

## 020 — SHOPS-020: Add checkout API route for live-play command dispatch

Status: DONE

### Goal
Expose shop checkout as a live-play command route.

### Scope
- Add `POST /api/shops/checkout`.
- Accept a full `SHOP_CHECKOUT` command envelope plus `clientId`/`profileId` as required by existing auth conventions.
- Delegate to `executeShopCheckoutCommandUseCase`.
- Return a terminal live-play command result shape plus authoritative document updates.
- Do not accept plain non-command checkout payloads.

### Acceptance criteria
- Route rejects non-command payloads.
- GM checkout works through the route.
- Player checkout works through the route when authorized.
- Duplicate operation behavior matches the use case.
- HTTP errors map cleanly to invalid/conflict/forbidden/not found states.

### Depends on
- SHOPS-019

---

## 021 — SHOPS-021: Add shop checkout realtime event publication

Status: DONE

### Goal
Keep other clients synchronized after shop checkout commits.

### Scope
- Publish durable realtime updates after successful checkout commits.
- Publish:
  - updated shop document when stock changes;
  - updated group inventory when group money or group inventory changes;
  - updated trainer sheet when trainer money or trainer inventory changes;
  - shop list summary update when relevant.
- Include client ID for echo handling.
- Ensure realtime events are appended only after the transaction succeeds.

### Acceptance criteria
- Checkout publishes the correct events for trainer-only purchase.
- Checkout publishes the correct events for group payment and group delivery.
- Failed checkout publishes no update events.
- Replayed/duplicate checkout does not publish duplicate state-changing events unless the existing event log dedupe contract intentionally coalesces them.
- Tests cover event shape and access rules.

### Depends on
- SHOPS-020

---

## 022 — SHOPS-022: Add client-side shop checkout command builder

Status: DONE

### Goal
Build valid `SHOP_CHECKOUT` live-play commands from the shopfront UI.

### Scope
- Add helpers for creating checkout op IDs.
- Build command envelopes with:
  - schema version;
  - op ID;
  - command type;
  - payload;
  - scopes;
  - client ID;
  - player profile ID when applicable.
- Include origin `{ kind: 'shopPage' }` for page-origin purchases.
- Validate local cart state before dispatching.

### Acceptance criteria
- Unit tests cover group payment/group delivery scopes, trainer payment/trainer delivery scopes, mixed group/trainer scopes, empty cart rejection, and invalid quantity rejection.
- No API call is performed in this ticket.

### Depends on
- SHOPS-013
- SHOPS-020

---

## 023 — SHOPS-023: Add durable shop checkout outbox support

Status: TODO

### Goal
Give shop checkout the same user-safety properties as live-play commands: no silent loss on reload or uncertain HTTP results.

### Scope
- Either extend the existing live-play command outbox to support shop-scoped commands, or add a shop-specific outbox that reuses the same patterns.
- Persist request path, command body, actor auth context, operation ID, and send/uncertain state.
- Support:
  - enqueue before send;
  - claim for send;
  - mark uncertain;
  - retry;
  - acknowledge terminal response;
  - list pending entries for the current auth context.
- Avoid requiring a map slug for shop-page-origin commands.

### Acceptance criteria
- Tests cover enqueue, claim, terminal acknowledgement, uncertain retry, auth-context filtering, and duplicate tab claim prevention.
- Existing map live-play outbox tests still pass.
- No UI is added in this ticket.

### Depends on
- SHOPS-020
- SHOPS-022

---

## 024 — SHOPS-024: Add client checkout composable

Status: TODO

### Goal
Provide a UI-facing command runner for shop checkout.

### Scope
- Add `useShopCheckoutCommands` or integrate shop checkout into an existing live-play command composable cleanly.
- Expose:
  - `status`;
  - `lastError`;
  - `checkout`;
  - pending outbox entries;
  - retry/abandon/check operations if supported by the chosen outbox pattern.
- Use the durable outbox from SHOPS-023.
- Adopt authoritative response updates into local shop/group/trainer state.

### Acceptance criteria
- Composable tests cover successful checkout, rejected checkout, stale rejection, duplicate click guard, uncertain HTTP result, and retry.
- The composable does not optimistically mutate money, stock, or inventory before a terminal accepted response.

### Depends on
- SHOPS-021
- SHOPS-023

---

## 025 — SHOPS-025: Add cart and checkout UI to player shopfront

Status: TODO

### Goal
Let players and GMs purchase items from the shopfront through the live-play checkout command.

### Scope
- Add quantity selector per item.
- Add cart summary with total price.
- Add payment source selector:
  - eligible linked trainer sheets;
  - group inventory when allowed.
- Add delivery target selector:
  - eligible linked trainer sheets;
  - group inventory when allowed.
- Dispatch checkout through the live-play checkout composable.
- Disable checkout while a command is in flight.
- Show accepted/rejected/uncertain/retry states.

### Acceptance criteria
- Player can buy into a linked trainer inventory with trainer money.
- Player cannot select unlinked trainer sheets.
- Player sees group options only when the shop allows them.
- GM can buy using any valid source/target exposed by the shop config.
- Double-clicking Buy sends only one active command.
- Tests cover successful checkout and at least one authorization failure.

### Depends on
- SHOPS-012
- SHOPS-024

---

## 026 — SHOPS-026: Consume shop/group/trainer realtime updates on shop pages

Status: TODO

### Goal
Keep open shopfronts and shop editor pages synchronized with authoritative updates.

### Scope
- Subscribe to shop realtime channels for the loaded shop.
- Subscribe to group inventory and affected trainer sheet channels where the page already has those documents loaded.
- Ignore stale events by revision.
- Ignore or reconcile local echo events based on client ID.
- Show a non-blocking notice when another client changes shop stock while the user has a cart open.

### Acceptance criteria
- A second client sees shop stock update after checkout.
- A second client sees group inventory money/inventory update after checkout.
- Stale realtime events do not overwrite newer local documents.
- Cart UI responds gracefully when stock changes below the selected quantity.

### Depends on
- SHOPS-021
- SHOPS-025

---

## 027 — SHOPS-027: Add map shop interface document model

Status: TODO

### Goal
Represent shop access points on maps without storing shop catalog state in map metadata.

### Scope
- Add a map metadata or map document field for shop interfaces, such as:

```ts
interface MapShopInterface {
  readonly id: string
  readonly shopSlug: string
  readonly label: string
  readonly position?: { x: number; y: number; z: number }
  readonly interactionRangeMeters?: number
  readonly playerVisible?: boolean
}
```

- Normalize shop interface entries with stable IDs.
- Keep the referenced shop document authoritative for prices, stock, and open/closed state.

### Acceptance criteria
- Map normalization preserves valid shop interfaces.
- Invalid shop interface rows are dropped or normalized predictably.
- Tests cover empty, partial, duplicate ID, and invalid shop slug input.
- No UI or live-play command behavior is added.

### Depends on
- SHOPS-001

---

## 028 — SHOPS-028: Add GM map UI for shop interfaces

Status: TODO

### Goal
Let GMs place or configure shop interfaces on a map.

### Scope
- Add GM-only map UI for creating/removing/editing shop interface records.
- Let the GM choose from existing shop tables.
- Let the GM edit label, position/range if supported, and player visibility.
- Persist through existing map setup/edit save or through live-play map metadata commands, depending on the current map mode conventions.

### Acceptance criteria
- GM can add a shop interface referencing an existing shop.
- GM can remove or change the referenced shop.
- Player users cannot edit shop interfaces.
- Tests cover add/remove/edit behavior.

### Depends on
- SHOPS-004
- SHOPS-027

---

## 029 — SHOPS-029: Add map-origin shopfront launcher for players

Status: TODO

### Goal
Let players open a shopfront from a live map shop interface.

### Scope
- Render a map-side button/panel/list for nearby or visible shop interfaces.
- When opened from the map, launch the same shopfront UI with origin:
  - `kind: 'mapInterface'`
  - `mapSlug`
  - `interfaceId`
  - optional `actorPlacementId`
- Do not duplicate the shopfront implementation; reuse the `/shops/[slug]` shopfront components where practical.

### Acceptance criteria
- Player can open an open/visible shop from the map interface UI.
- Closed or hidden shops are not offered to players.
- GM can preview/open any mapped shop interface.
- Checkout commands built from this UI include map-interface origin.

### Depends on
- SHOPS-025
- SHOPS-028

---

## 030 — SHOPS-030: Validate map-origin checkout server-side

Status: TODO

### Goal
Ensure map-launched shop checkout is authorized against the live map context.

### Scope
- When checkout payload origin is `mapInterface`:
  - load the map;
  - verify the interface exists and references the same shop slug;
  - verify the map is accessible to the actor;
  - verify the shop is open/player-visible for player actors;
  - when `actorPlacementId` is present, verify token control for players;
  - if range is enabled, verify the actor token is within the interface range.
- GM actors bypass player token-control checks but still validate map/interface existence.

### Acceptance criteria
- Player checkout from a valid map interface succeeds.
- Player checkout with wrong shop slug/interface mismatch is rejected.
- Player checkout from an inaccessible map is rejected.
- Player checkout with uncontrolled actor token is rejected.
- Range validation succeeds/fails deterministically in tests.
- Page-origin checkout behavior remains unchanged.

### Depends on
- SHOPS-019
- SHOPS-029

---

## 031 — SHOPS-031: Add live-play accepted/rejected realtime result handling for shop checkout

Status: TODO

### Goal
Let checkout commands participate in the same accepted/rejected/recovered-by-realtime UX as other live-play commands.

### Scope
- Publish or consume accepted command events for shop checkout operations.
- Allow the originating client to recover when realtime accepted result arrives before HTTP completes.
- Ensure outbox entries are acknowledged when a terminal realtime/HTTP result is validated.
- Surface rejected command reasons consistently in the shopfront UI.

### Acceptance criteria
- Test where realtime accepted result arrives before HTTP response and the UI recovers without duplicate application.
- Test rejected terminal result removes/acknowledges the durable outbox entry.
- Test stale local state triggers reload/reconciliation instead of applying invalid patches.

### Depends on
- SHOPS-023
- SHOPS-024
- SHOPS-026

---

## 032 — SHOPS-032: Add shop checkout audit log display for GMs

Status: TODO

### Goal
Give GMs enough visibility to debug purchases without exposing noisy internals to players.

### Scope
- Store a bounded purchase log on the shop document metadata or in a separate audit table, depending on existing project conventions.
- Include timestamp, actor role/profile summary, payment source, delivery target, purchased lines, and total.
- Display recent purchases on GM shop editor page.
- Do not expose GM audit details to players.

### Acceptance criteria
- Successful checkout records one audit entry.
- Duplicate/replayed operation does not create duplicate audit entries.
- GM editor displays recent audit entries.
- Player shopfront does not display audit logs.

### Depends on
- SHOPS-018
- SHOPS-021

---

## 033 — SHOPS-033: Add integration tests for concurrent checkout and stock conflicts

Status: TODO

### Goal
Prove live-play checkout behaves correctly under concurrency.

### Scope
- Add server/integration tests for:
  - two clients buying the last finite-stock item;
  - stale shop revision conflict;
  - stale group inventory revision conflict;
  - stale trainer sheet revision conflict;
  - duplicate operation retry;
  - different command with same op ID.

### Acceptance criteria
- Only one last-stock purchase succeeds.
- Failed concurrent purchase does not subtract money or deliver items.
- Operation result storage remains deterministic.
- Realtime events match successful committed operations only.

### Depends on
- SHOPS-021

---

## 034 — SHOPS-034: Add end-to-end player shopping test harness

Status: TODO

### Goal
Cover the happy path from player shopfront UI to authoritative live-play checkout persistence.

### Scope
- Use the existing test style/harnesses to simulate:
  - GM creates/open shop;
  - player profile has linked trainer;
  - player opens shop;
  - player buys an item with trainer money;
  - trainer inventory updates;
  - shop finite stock updates;
  - realtime update reaches another client.

### Acceptance criteria
- End-to-end test passes without relying on arbitrary timers.
- Test asserts no duplicate purchase on double-click.
- Test asserts player cannot buy with unlinked trainer.

### Depends on
- SHOPS-025
- SHOPS-026
- SHOPS-031
- SHOPS-033

---

## 035 — SHOPS-035: Document shops, checkout, and live-play boundaries

Status: TODO

### Goal
Document the shop model and the live-play integration rules for future contributors.

### Scope
- Add `docs/shops.md`.
- Link it from `docs/architecture.md`.
- Document:
  - shop tables as campaign SQLite state;
  - GM shop editing as setup/maintenance save;
  - player checkout as live-play command;
  - shop scopes, group inventory scopes, and trainer sheet scopes;
  - payment/delivery authorization;
  - map shop interfaces;
  - operation idempotency;
  - finite vs unlimited stock;
  - realtime convergence;
  - export/backup behavior.

### Acceptance criteria
- Documentation names the authoritative tables and routes.
- Documentation warns not to store shop catalog/stock in map metadata, group inventory, or fake trainer sheets.
- Documentation explains that map shop interfaces reference shops but do not own shop state.
- No code behavior changes are included.

### Depends on
- SHOPS-034

### Completion marker

- After this ticket scope is complete, verify tickets 001-034 are `DONE`, run `scripts/quality-gate.sh`, mark ticket 035 `DONE`, and set the top-level line to `AUTOMATION_STATUS: DONE` in the same commit.

---
