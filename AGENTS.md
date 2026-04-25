

## Just Commands

List available recipes:
```
just             # same as `just default`
just default
```

List/inspect encounter tables:
```
just encounter                              # list regions
just encounter thickerby_vale               # list tables in a region
just encounter thickerby_vale forest        # show the table entries
```

Roll encounters and auto-generate PTU stat blocks:
```
just encounter thickerby_vale forest 3                   # writes to generated_pokemon/forest_3/
just encounter thickerby_vale forest 3 preview           # stream to stdout, no files
just encounter thickerby_vale forest 3 "" custom_output  # writes to custom_output/forest_3/
just encounter --clear                                   # wipe generated_pokemon/*/
just encounter --clear custom_output                     # wipe custom_output/*/
```

Lookup PTU reference data (quote names with spaces):
```
just pokemon "<pokemon name>"
just ability "<ability name>"
just move "<move name>"
just capability "<capability name>"
just condition "<condition name>"
just item "<item name>"
just rule "<rule name>"
```

Rebuild the lookup caches used by capability/condition/item/rule:
```
just rebuild-reference-cache
```

Generate a specific Pokémon directly:
```
./scripts/pokegen.sh --species Cutiefly --level 6
./scripts/pokegen.sh --species Pelipper --level 30 --nature Adamant
```

`pokegen` only stats a species you name — `--species` and `--level` are
both required. Species selection (type theme, gen, legendary/evolved,
etc.) lives upstream: encounter tables, Helix rank loadouts, or your
own judgement. Pick the mon the story calls for and pass it in.

> ⚠️ `pokegen.sh` `cd`s into `ptu-data/` before invoking `cli.py`, so any
> relative `--output-dir` resolves relative to `ptu-data/`, not
> `$PWD`. Always pass an absolute path to `--output-dir` (e.g.
> `--output-dir "$(pwd)/session_notes/.../pokemon"`). Omit the flag entirely
> to use the default `generated_pokemon/` target.
