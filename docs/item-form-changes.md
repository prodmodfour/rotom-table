# Item-driven form changes

P8-056 implements the reviewed Mega Evolution family as an encounter-scoped, server-authoritative item workflow. No other franchise form item is inferred.

## Runtime authority

Runtime mechanics come only from:

- `data/reference/rules.json` → `Item-Driven Form Changes`
- `data/reference/items.json` → `Mega Ring` and `Mega Stone`
- `data/reference/pokedex.json`
- `data/reference/abilities.json`
- generated certification `data/complete-play-loop/item-form-changes.v1.json`

The reviewed migration input and book excerpts are provenance, not runtime inputs. `python3 scripts/migrate_item_form_change_mechanics.py --check` and `python3 scripts/generate_complete_play_loop_item_form_changes.py --check` verify the accepted hashes and the registry of 50 forms across 48 species.

## Setup

1. Equip the owning Trainer with one active **Mega Ring**.
2. Equip the owned Pokémon with one active **Mega Stone** configured to that Pokémon's exact reviewed base species and Mega form.
3. For Rayquaza only, an effective **Delta Evolution** capability plus **Dragon Ascent** replaces the Stone requirement; the linked Trainer's exact active Ring is still required.
4. Start a Scene and initiative. Mega Evolution is offered only on the owning Trainer's or target Pokémon's active turn.

A player must control the acting participant and the Trainer who owns the Ring. Ambiguous owners, Rings, Stones, configurations, forms, or Abilities fail closed.

## Acceptance and effects

The encounter decision previews the selected form, Types, Ability, non-HP Stat deltas, Swift Action cost, Scene duration, and automatic reversal. Nothing changes until acceptance.

Acceptance atomically:

- spends one Swift Action;
- records the Trainer's one Mega Evolution use for the Scene;
- applies reviewed non-HP Stat deltas, Type replacement when declared, and the reviewed Ability;
- updates an existing initiative value by the reviewed Speed delta;
- retains sheet identity, species, customization, history, Moves, ownership, current HP, and maximum-HP authority;
- journals private immutable source and rule evidence; and
- saves and publishes one new map revision.

If the reviewed Ability would duplicate an effective Ability, the decision requires one exact opaque choice from distinct canonical natural Abilities. The server recomputes that choice at declaration and commit.

## Lifecycle

The accepted form survives ordinary Ring/Stone suppression, including Magic Room, for the remainder of the Scene. Fainting suppresses Ability effectiveness through normal Ability rules but does not rewrite or discard the accepted form identity. Equipment custody operations cannot remove, transfer, replace, or orphan the exact Ring or Stone while it backs an active Mega Evolution. Move-driven item planning excludes those exact sources, and mutation reduction rejects stale or forged removal attempts.

Ending the Scene removes the temporary form once, reverses its initiative Speed delta, unlocks its equipment, and publishes the resulting map revision. The schema can represent persistent forms, but no reviewed item currently authorizes a persistent trigger.

## Privacy, reconnect, and replay

Players receive curated public form consequences—form name, effective Types, Ability, Stat changes, and duration. They never receive equipment instance IDs, operation IDs, revisions, source hashes, or accepted provenance. A reconnect rebuilds the same public projection from durable authority.

Operation IDs are principal-bound and command-hash-bound. An exact retry returns the stored result without spending another action or publishing another mutation. Changed input, stale map or sheet reads, forged offers, unavailable action economy, and concurrent map changes are rejected without partial writes.
