# Campaign advancement attention detection

P8-084 adds fresh, read-only advancement detectors on top of the P8-083 campaign attention schema. Detection never edits a sheet, increments Level, allocates a Stat Point, or selects a Move, Ability, evolution, Feature, Edge, class, or skill rank.

## Authoritative inputs

The detector accepts complete current sheet records with exact revisions and one non-negative campaign minute. It reads only app-owned canonical authorities:

- `data/reference/pokemonExperienceChart.json` for Pokémon Experience thresholds;
- `data/reference/rules.json` for Pokémon and Trainer Stat Point budgets;
- `data/reference/pokedex.json` plus reviewed effective Poké Edge authority for Base Relations and Realized Potential; and
- immutable `encounter_settlement_attention_sources` linked to settlement history facts for event-backed level crossings.

A batch is capped at 10,000 sheets, 10,000 settlement sources, and 10,000 resulting items. Duplicate sheet authorities, duplicate projected identities, malformed revisions, invalid campaign minutes, or a capped/truncated read fail closed.

## Detection policy

### Newly reached levels

A canonical Experience total that implies a higher Level than the current Pokémon sheet creates blocking `level-threshold` work. The required decision is `repair-advancement`; the detector does not write the inferred Level.

When atomic settlement already applied a crossed level, its immutable `level-threshold` source creates normal `allocate-advancement` work. That event-backed source is the only basis for saying a choice is newly legal after a synchronized write. The generic item directs review without guessing which Move, Ability, evolution, or other build choice became legal. P8-085 and P8-086 enumerate those exact bounded choices from fresh authority.

A tracked Experience total below the sheet Level is invalid rather than interpreted as a level-down instruction.

### Unspent Stat Points

For a Pokémon, spent points are the six non-negative integral `stats.*.added` values. The budget is the canonical Level-based budget plus any reviewed Realized Potential grant. For a Trainer, spent points are the six non-negative integral `stats.*.levelUp` values and the canonical Level-based budget includes the ten Level-1 creation points. An exact structured Attack/Special Attack milestone row may extend that budget only by its currently earned reviewed amount; partial fields, wrong totals, future tiers, and stale scheduled amounts are invalid.

A positive remainder creates normal `unspent-advancement` work with an explicit allocation decision and an authority-bound sheet route. The item does not contain the budget, amount spent, amount remaining, or current stats; the destination must reload and reauthorize the sheet.

### Invalid advancement

Blocking `invalid-advancement` work is created for unsupported species authority, invalid Level or Experience values, malformed or negative point values, arithmetic overflow, overspend, a stale Level/Experience relationship, invalid Base Relations, or unavailable canonical calculation authority. No invalid value is normalized into a write.

A valid sheet at its exact budget produces no sheet-derived item. Open immutable settlement sources remain independently visible until their authoritative workflow resolves them.

## Stable identity and privacy

Sheet-derived item identity is stable by sheet kind, slug, and reason. Its source-event identity changes with the exact sheet revision, and the item, decision, action, and route all bind that revision. Realtime consumers can therefore update one item rather than append duplicate local rows.

Items contain reason enums and authority pointers only. They copy no Experience total, Level, species data, stats, allocation amounts, sheet names, build choices, private notes, Profile evidence, or operation command. Role/Profile-safe projection and realtime convergence remain ordered work in P8-089.
