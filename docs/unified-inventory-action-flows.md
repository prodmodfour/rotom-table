# Unified inventory action flows

P8-063 connects Trainer inventory **Use**, **Equip**, **Give**, **Transfer**, and **Inspect** controls—and both directions of shared-group transfer—to the schema-v1 action anatomy defined by P8-061. The interface contract routes intent; it does not grant mechanics, custody, compatibility, or authorization. P8-064 extends the same projection, adapter journal, decision component, and recovery boundary with **Split**, **Merge**, and **Discard** as documented in [Inventory split, merge, and discard](inventory-stack-actions.md).

## Projection

`GET /api/inventory/actions` accepts exactly one scope. `trainerSlug=…` reloads the controlled Trainer, linked Pokémon, group inventory, current equipment states, and current sheet item offers. `groupSlug=…` reloads the group document plus only the Trainers controlled by the authenticated GM or selected player profile, then emits group-to-Trainer and Trainer-to-group offers. Each action advertises:

- one opaque source choice with safe container, section, presentation-row, item, and quantity labels;
- authenticated/source/custody/mechanics checks;
- exact source and destination revision requirements;
- bounded destination options and unavailable reasons;
- exact quantity policy;
- reversible or correctable consequences;
- confirmation anatomy and the existing owning handoff.

The response never contains row IDs, serialized equipment identities, downstream operation IDs, Profile IDs, hashes, ownership evidence, private notes, or raw provenance. Opaque IDs map intent only and are never commit authority.

## Owning handoffs

- **Use** opens the existing sheet-item target/choice decision and continues through its declaration and item-operation journal. No duplicate use planner exists.
- **Equip** delegates to the existing equipment operation with one exact inventory source and one current compatible Trainer slot. Items with reviewed configuration enumerate bounded slot/configuration destinations; the client never authors configuration JSON.
- **Give** delegates to the same equipment operation with one selected linked Pokémon Held Item destination and, when required, one server-issued reviewed configuration.
- **Transfer** delegates to the existing Trainer-to-group or group-to-Trainer transaction with a stable source row and bounded quantity. Both directions now use the same opaque declaration and atomic adapter receipt.
- **Inspect** is app-relative navigation and changes no campaign state.

At submit time, `POST /api/inventory/actions/execute` recomputes the current projection and requires the declaration to match its offer, action, source, destination, quantity, confirmation, and every revision requirement exactly. The owning use case then reauthorizes current control, custody, reviewed compatibility, unreserved quantity, and affected revisions before mutation.

## Atomic results and replay

Schema v40 adds `inventory_action_operations`; schema v41 preserves its rows while extending the action-kind constraint to Split, Merge, and Discard:

1. The server binds an operation ID to the canonical declaration hash, authenticated principal, affected Trainer, and private downstream command before mutation; a group-scoped retry must also match the command’s exact group scope.
2. Equipment handoffs retain their existing replay-safe equipment journal. The private adapter command locks the reviewed equipment and configuration-definition hashes; drift leaves the source mechanically inert and pending. If the adapter response is interrupted after commit, exact retry recovers that accepted result.
3. Transfer acceptance writes the inventory-action receipt inside the same transaction as both inventory mutations. A receipt failure rolls back both documents.
4. Reusing an operation ID with changed declaration bytes, another principal, another Trainer, or another group scope fails closed.
5. Accepted sheets and group inventories are stored as immutable recovery evidence. Exact replay after process restart returns those resources with `exactReplay: true` and cannot move the item twice.

The browser retains one exact declaration while the result is uncertain. P8-068 mirrors the strict Profile-bound payload into same-tab session storage and origin-local durable storage, coordinates the matching flow across tabs, and applies one Trainer- or group-scope recovery lock. Exact retry is the only mutation path; reconnect never submits automatically. Refresh, cancellation, source switching, manual editing, and competing item/equipment/inventory mutations remain unavailable. A definitive 4xx clears only the matching retry payload. See [Inventory conflict and recovery](inventory-conflict-recovery.md).

## Local and realtime adoption

An accepted response contains every affected authoritative sheet and group inventory. The open Trainer or group surface adopts its returned document instead of applying a local quantity patch. Existing persisted realtime events invalidate other authorized Trainer, Pokémon, sheet-library, and group-inventory clients after commit. Player responses pass through existing sheet and group privacy projections.

## Interaction

The accepted target is [`.pi/artifacts/ui-mockups/unified-inventory-action-flows/v002.png`](../.pi/artifacts/ui-mockups/unified-inventory-action-flows/v002.png), scored 10/10.

The desktop inventory stays a 60/40 workspace and collapses to one column. A compact rectangular row strip uses one anatomy for Use, Equip, Give, Transfer, and Inspect. The group inventory no longer opens its old bespoke transfer dialog: a group-row action or safe Trainer-source selector opens the same inline decision component. Equip/Give/Transfer decisions show, in order:

1. exact safe source;
2. bounded destination;
3. quantity when variable;
4. consequences;
5. the source/destination revision recheck;
6. Cancel and one committed action.

Native radio and number controls, visible cyan focus, textual unavailable reasons, non-colour checked state, matte surfaces, flat semantic colours, and 44px controls preserve keyboard, touch, contrast, and narrow-screen behavior.
