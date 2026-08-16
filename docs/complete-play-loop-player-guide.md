# Complete Play Loop player guide

## Acquire and move items

Shop checkout shows the exact payment source, destination, quantities, and accepted receipt. Use its next actions to inspect, equip, use, give, or transfer current delivered rows. A next action reloads authority; it is not a durable capability.

Inventory actions always identify a visible source location and consequence:

- **Use** applies current structured mechanics.
- **Equip / Unequip** moves one whole serialized item and adds or withdraws its provider.
- **Give / Take / Transfer** moves custody between authorised Trainer and shared inventory destinations.
- **Split / Merge** changes stack shape without changing total quantity.
- **Discard** is irreversible and requires explicit confirmation.
- **Inspect** is read-only.
- **Request adjudication** creates bounded GM work and reserves a consumable source when required.

Choose one exact source when duplicate names exist. Rotom Table never substitutes another row by name. A selected row is marked with text and `aria-current`, not colour alone.

## Equipment

Equipment cards distinguish custody from effective mechanics. A whole item is effective only when its current definition, owner, slot, configuration, compatibility, and activity are valid. Source loss, incompatibility, transformation, lifecycle expiry, or unequip withdraws contributions immediately.

Effective-value inspectors show Base, named sources, and Final. They do not expose private serialized configuration. If an item becomes incompatible, use the available equipment action or ask the GM to review; do not edit a held-item name or derived value manually.

## Use items in an encounter

Open the item action from the current Action Dock or inventory row. Review:

- exact source and remaining quantity;
- action/resource cost;
- legal target;
- HP, condition, stage, duration, or other consequence;
- irreversible consumption;
- any bounded choice.

Submit only from an idle or saved state. Pending resolution reserves the source. Accepted use changes all affected sheets, resources, inventory, history, and realtime projections together. Poké Ball throws use one exact row; the server rolls and binds consumption, capture outcome, roster/Box destination, target state, and map placement in one receipt.

## Resolve Campaign work

Campaign shows resume work first, then one recommended action and grouped follow-up. Player views contain only work owned by the selected Profile's current Trainer, team, or Box authority. Move, Ability, Evolution, Trainer advancement, treatment, naming, roster, and equipment workflows load current legal choices at their destination; the dashboard itself never chooses for you.

Next day is GM-only. After advancement and treatment decisions are resolved, the GM reviews a fresh preflight and the dashboard reloads remaining work.

## Recover safely

When a command times out or the connection drops:

1. Leave the retained command in place.
2. Restore connectivity.
3. Use **Check status**. Going online does not retry.
4. If accepted, close the recovery card and reload current authority.
5. If no accepted result exists, explicitly retry the exact command or discard it.
6. If the row, target, choice, or revision changed, reload and declare again.

Another tab may hold the same inventory scope. Finish or recover that command before starting a competing flow. Never fix a conflict by editing quantity, equipment text, HP, rewards, or history.

## Accessibility

Inventory stays a semantic table and becomes labelled cards through CSS at narrow widths. Large sections page 80 rows with complete row counts. Tabs support Arrow/Home/End; row controls and choices support Enter/Space; Escape returns focus. Controls target about 44 pixels, reduced motion is honoured, and 320-pixel reflow has no horizontal page scroll.
