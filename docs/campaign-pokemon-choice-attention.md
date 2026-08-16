# Campaign Pokémon choice attention

P8-085 projects event-bound Move, Ability, Evolution, form, and post-evolution work into the strict P8-083 attention model. Detection is read-only. It never learns or replaces a Move, selects an Ability, evolves a Pokémon, chooses a form, reallocates stats, or changes equipment.

## Reviewed canonical authority

`Pokémon Advancement Choices` in `data/reference/rules.json` is the only runtime policy. It was installed by `scripts/migrate_pokemon_advancement_choices.py` from the accepted, source-hash-bound review record at `scripts/reviewed-data/pokemon-advancement-choices.v1.json`. Runtime code never parses book text.

The structured rule binds:

- natural Move candidates to exact `pokedex.level_up_moves` rows strictly above the immutable pre-award Level and at or below the post-award Level;
- the six active-Move limit and reviewed Cluster Mind extension;
- Ability ordinals and legal tiers at Levels 1, 20, and 40;
- optional next-stage level Evolution, exact destination-stage identity, exclusion of reviewed item-transition pairs, and fail-closed conditional branches;
- explicit form choice only when more than one complete canonical branch remains; and
- post-item-Evolution stat, Move, Ability-mapping, and inactive-equipment policy.

The migration ledger retains the prior Exploration Items successor and records this rule as a separate exact chained successor. Canonical `pokedex.json`, `moves.json`, `abilities.json`, and structured rule records are hash-pinned evidence.

## Complete source reads

Projection requires explicit completeness for current sheets, settlement attention sources, immutable settlement history facts, and item-operation records. Each source is capped at 10,000 rows. Missing facts, missing sheets, duplicate identities, future campaign times, stale revisions, malformed source lifecycles, malformed canonical rows, unsupported options, and partial item-operation evidence fail closed.

A `level-threshold` source must match exactly one immutable `experience-award` fact from the same settlement and operation. The fact must contain only a positive amount and an increasing Level range. The source revision may not be newer than the current sheet, and its Level-after value may not exceed current sheet authority.

## Decision policy

### Natural Moves

Every still-open level event is checked against the exact current species. Missing event-bound natural Moves create one stable `move-learning` item per Pokémon. At the active-Move limit it is urgent because an explicit replacement is required; below the limit it is normal. The attention item contains no Move identity or replacement option. Its authority-bound action points to the sheet Move workflow, which must reload and re-enumerate canonical choices.

An exact canonical active row at the current sheet revision suppresses that opportunity. This covers server-preserved item-controlled rows, breeding permanent-Move rows, and accepted current sheet resolution without treating the attention item as mutation authority. A resolved settlement attention source suppresses its entire event.

### Abilities

Crossing Level 20 requests the second Ability from Basic or Advanced options. Crossing Level 40 requests the third from Basic, Advanced, or High options. Exact current canonical natural Ability rows and immutable item-Evolution mappings satisfy ordinals. If a required ordinal has no complete current option set, projection fails closed. Options and Ability names are not copied into attention items.

### Evolution and forms

Only an event-bound, positive minimum Level on the next exact evolutionary stage is considered. Reviewed item-transition pairs are handled by the existing item workflow, not duplicated as level Evolution. Any relevant candidate with a conditional field or malformed destination makes generic level Evolution unavailable rather than partially offering a branch. One complete candidate creates `evolution-choice`; multiple complete canonical candidates create `form-choice`. Evolution remains optional and no destination identity is copied into the item.

Accepted item-form operations already contain their exact selected form and Ability evidence, so they do not create duplicate generic form work.

### Post-evolution review

The latest private item-Evolution application is validated against current canonical hashes and current locked Ability mappings. Open stat allocation, missing bounded Move opportunities, or equipment that remains inactive creates `post-evolution-review`. The source event is accepted item-operation authority with its exact campaign minute. Missing or legacy operation context fails closed. Completed current state clears the item; immutable application history remains untouched.

## Identity, privacy, and follow-up

There is at most one item per Pokémon and decision reason. Item identity remains stable across unrelated revisions; source event and all action/decision authority bind the current read. Items expose no species, Move, Ability, form, destination, stat budget, equipment identity, operation ID, Profile evidence, private plan, or canonical option list. The server must reauthorize all options before any future command.

P8-089 supplies role/Profile-safe API and realtime projection. P8-090 renders these authority-bound links in the campaign continuation dashboard. P8-085 intentionally does not introduce client-local bookkeeping or automatic build selection.
