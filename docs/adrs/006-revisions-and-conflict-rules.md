# ADR 006: Revisions and conflict rules

Date: 2026-05-25

Status: Accepted

> Maintenance note: This ADR describes the legacy `/sessions` surface. Normal multiplayer play now uses persistent player profiles on `/maps/<slug>` and follows [ADR 009: Server-authoritative profile play](009-server-authoritative-profile-play.md).

## Context

live sessions use server-authoritative command envelopes instead of client autosaving whole map documents. Multiple GM and player browser clients can still act at nearly the same time, retry after transient network failures, or reconnect from stale local state. The server therefore needs deterministic rules for deciding when a command is new, duplicate, stale, conflicting, or safe to apply.

These rules must preserve the locked Live session shape: one GM-hosted session authority, WebSocket command/results/broadcast flow, session-local identity and permissions, local JSON snapshots plus optional event logs, and no generic shared-document editor or hosted database layer.

## Decision

Live session uses **server-owned monotonic revisions plus operation IDs** to decide command ordering and conflicts.

Each session has an authoritative revision for the current session/map state. Each command envelope includes a client-generated `opId`, the client's observed `baseRevision`, actor/client identity, command type, command payload, and enough resource scope information for the server to evaluate conflicts. The server validates and applies commands sequentially against the authoritative state it owns.

The core rules are:

- accepted commands increment the authoritative revision exactly once;
- rejected commands do not increment the revision;
- duplicate `opId` submissions are handled idempotently and never apply twice;
- commands with stale `baseRevision` values may apply only when the server can prove their touched resource scopes have not changed incompatibly;
- stale same-token or same-resource commands are rejected with the current authoritative state needed for reconciliation;
- GM commands generally take precedence over player commands, while still passing schema, permission, safety, and command-specific validation;
- player commands can only affect currently assigned and visible resources;
- reconnecting clients use their last seen revision to receive replay when available or a current snapshot when replay is unavailable or unsafe.

## Revision ownership

Revisions are owned by the GM-hosted server, not by browsers.

- A session starts with an initial revision from its initial authoritative snapshot.
- The server increments the revision after a command has passed validation, permission checks, conflict checks, and command-specific table rules, and after its effects have been applied to authoritative state.
- The accepted result, persisted snapshot/event entry, and broadcast patch/event all include the resulting revision.
- Rejections for invalid, unauthorized, stale, or conflicting commands include the current server revision.
- Duplicate handling returns the previous authoritative result or an equivalent duplicate acknowledgement without advancing the revision.
- Client timestamps and message arrival times from browsers are diagnostic only; they are not the authority for ordering state changes.

Later implementation may use one session-level revision with map/resource metadata, or explicit session and map revisions where useful. In either shape, live command application must expose a monotonic authoritative revision to clients and snapshots.

## `opId` idempotency

Every command submitted by a client includes an `opId` unique within the relevant session/client operation scope. The server records enough recently processed operation IDs to recognize retries after reconnects, dropped acknowledgements, or user/client resubmission.

When the same actor/client resubmits the same `opId`:

- if the original command was accepted, the server returns the same accepted result or a duplicate acknowledgement referencing the original resulting revision;
- if the original command was rejected, the server returns the same safe rejection category and current reconciliation data where appropriate;
- the command effects are not applied a second time;
- the authoritative revision does not advance because of the duplicate itself.

If an `opId` is reused with a materially different command envelope or payload, the server must reject it safely rather than guessing which intent was real. Reusing operation IDs as a way to edit commands is not supported.

## Stale and conflict handling

A command is stale when its `baseRevision` is older than the server's current authoritative revision. Stale does not automatically mean rejected: a token move based on revision 10 may still be safe at revision 12 if revisions 11 and 12 touched unrelated resources.

The server may accept a stale command across a revision gap only when it can prove all of the following:

1. the command is otherwise valid and authorized at the current state;
2. the command's resource scope is known;
3. no accepted command after the command's `baseRevision` changed the same resource scope or an incompatible broader scope;
4. any command-specific invariants still hold in the current authoritative state.

If the server lacks enough event history to prove safety, it must reject the command as stale or conflicting and provide the current revision plus relevant authoritative state. Reconnect snapshot fallback is preferred over speculative merges.

Same-resource stale commands are rejected. Examples include two moves for the same token, a token move after that token was deleted, two incompatible edits to the same sheet field, or an initiative advance based on an older initiative order.

Commands touching unrelated scopes may apply across small revision gaps when the available event history proves they are independent. The exact gap window is an implementation detail, but it must be bounded by retained event metadata and must fail closed when independence cannot be established.

## Resource conflict scopes

Each command type defines the resource scopes it touches. Later command contracts and validators must make those scopes explicit enough for server-side conflict checks. Initial Live session conflict lanes are:

| Scope | Conflict rule |
| --- | --- |
| Token identity, position, facing, spawn, delete, and send-out state | Same-token changes after `baseRevision` conflict. Token deletion conflicts with later token actions. GM spawn/delete may override by producing a newer authoritative revision; stale player commands against that token are rejected. |
| Sheet values such as HP, combat stages, conditions, move-use side effects, abilities, orders, and maneuvers | Same sheet or same table-action target conflicts when a later accepted command changed the relevant field or incompatible broad sheet state. |
| Initiative and round state | Initiative order, current turn, and round counters are one ordered lane unless later commands define narrower safe sub-scopes. Stale initiative advances are rejected rather than guessed. |
| Hazards, field effects, and terrain | Same hazard/effect or overlapping terrain cell/area changes conflict. Disjoint terrain or hazard scopes may apply across revision gaps when validators can prove they do not overlap. |
| Visibility, assignments, and controllable resources | GM-only changes take effect immediately at their accepted revision. Pending player commands are rechecked against current assignments and visibility and may become unauthorized even if they were allowed at `baseRevision`. |
| Map selection and session lifecycle | Broad session/map-scope changes require clients to refresh or reconnect. Stale commands against a previous selected map or ended session are rejected. |

These scopes are domain rules, not generic JSON merge paths. The server should compare command intent against authoritative resource state and recent accepted command metadata, not merge arbitrary client document patches.

## GM precedence

GM commands generally win because the GM is the table authority for a GM-hosted session. This does not mean GM commands bypass validation. A GM command can still be rejected if it is malformed, targets missing state, violates command-specific invariants, or uses an invalid duplicate `opId`.

GM precedence is expressed through authoritative server ordering:

- once a GM command is accepted, it advances the revision and becomes the current state;
- later player commands based on older revisions and touching the same affected resources are rejected as stale, conflicting, or unauthorized;
- a GM may issue a new valid command to override a previous player result, producing another revision and broadcast;
- browser client timestamps do not let a player command override a newer GM revision.

If a player command is already accepted before a GM override arrives, that player command remains part of the event history. The GM override is a new authoritative command rather than a hidden rewrite of history.

## Command results and reconnect behaviour

Accepted command results include the `opId`, accepted revision, actor, command type, affected scope, and patch/event data safe for the receiving clients. Rejections include the `opId`, current revision, a safe reason such as invalid, unauthorized, stale, or conflict, and current resource state when the client needs to reconcile.

Clients keep track of the highest revision they have seen. On reconnect, a client sends `lastSeenRevision` during the hello/reconnect handshake. The server may replay accepted events after that revision if it still has enough event history for that session and client visibility. Otherwise, the server sends the latest authoritative snapshot. A reconnect must never ask the client to infer current state from stale optimistic edits.

## Rejected alternatives

### Last-writer-wins whole-map autosave

Rejected for live sessions. It would let the last browser save overwrite newer authoritative state, hide same-resource conflicts, and make retries/reconnects ambiguous.

### Strict global revision equality for every command

Rejected as too conservative. Requiring every command's `baseRevision` to equal the current revision would reject safe independent actions, such as one player moving an assigned token while the GM adjusts an unrelated effect. Live session allows bounded cross-revision acceptance when resource scopes prove independence.

### Client-side timestamps or optimistic ordering as authority

Rejected. Browser clocks and network timing cannot be the source of truth for table state. Optimistic UI is allowed only as a preview that reconciles with server acks, rejections, and broadcasts.

### Generic document merge or CRDT conflict handling

Rejected for Live session concurrency. Rotom Table conflicts are table-domain conflicts involving permissions, visibility, token state, sheet rules, and GM authority. The server should evaluate typed commands, not merge arbitrary shared documents.

### Database locks or hosted transaction service

Rejected for Live session. The GM-hosted process can apply commands sequentially against in-memory authoritative state and persist local snapshots/events. Adding Postgres, Redis, Durable Objects, or another hosted transaction layer is outside the locked architecture.

## Consequences

- Shared contract work must define revision helpers, command `opId` fields, `baseRevision`, command result shapes, and resource scope metadata.
- Server state work must store current revision, recent processed `opId` results, and enough accepted event metadata to evaluate bounded revision gaps.
- Command validators must reject missing or invalid `baseRevision`, reused `opId` mismatches, unauthorized player actions, stale same-resource actions, and unsafe conflicts.
- Client session mode must reconcile optimistic state from acks, rejections, current resource data, authoritative patches, replay, or snapshot fallback.
- Tests must cover monotonic revision increments, duplicate accepted and rejected operations, stale same-resource rejection, safe unrelated-scope acceptance, GM override behaviour, permission changes across revisions, and reconnect fallback.
- Documentation must continue to explain that live sessions use server-authoritative revisions and domain command conflicts, not whole-map autosave or collaborative document merging.

## Validation notes

Reviewers can validate this ADR by checking that live-session work:

- increments revisions only for accepted authoritative commands;
- returns idempotent results for duplicate `opId` retries without reapplying effects;
- rejects stale same-token or same-resource commands with current authoritative state;
- permits bounded independent-scope commands across revision gaps only when safety can be proven;
- rechecks permissions and visibility against current state before applying player commands;
- treats GM overrides as newer authoritative commands rather than client-side document rewrites;
- uses replay or snapshot fallback for reconnect instead of trusting stale client state.
