# Move-Pool Changelog

## Purpose

This document records the cumulative move-typing and move-distribution rules for the Level 1–20 redesign.

The process is iterative:

1. A redesign rule is added.
2. Every recorded rule is applied cumulatively to every move source in the authoritative `data/reference/pokedex.json` dataset.
3. The affected move-source and species/form entries are counted directly rather than estimated.

Distribution rules only retain or remove moves already present for a species unless a rule explicitly grants a move. Move-typing rules may also reclassify an existing move.

## Dataset conventions

- “Movepool” and “move distribution” include **all four move sources**: `level_up_moves`, `tm_hm_moves`, `egg_moves`, and `tutor_moves`.
- A “move-source entry” is one occurrence of a move in one of those source lists. If one Pokémon has the same move in two sources, those are two entries.
- Each Pokédex species or form entry is considered independently.
- Pokémon types come from the entry's `types` field.
- Move types come from the authoritative `data/reference/moves.json` data. A recorded redesign type change takes precedence in that rule and all later cumulative analyses.
- “Pokédex entry” means English main-series Pokédex flavor text. Side-game Browser descriptions or battle text do not qualify unless a rule explicitly says otherwise.
- A Pokémon “has a Dragon-type Mega Evolution” only when that species directly Mega Evolves into a form containing the Dragon type. Under the PTU Pokédex represented by this project, the non-Dragon species satisfying that exception are **Charizard**, **Ampharos**, and **Sceptile**. Their pre-evolutions do not directly Mega Evolve and therefore do not receive the exception.
- These analyses simulate the cumulative rules against canonical source data; they do not mutate `pokedex.json` while the rules are still being designed.

## Cumulative rules

### Rule 1: Dragon moves require a Dragon identity

Only a Dragon-type Pokémon or a Pokémon with a Dragon-type Mega Evolution may have Dragon-type moves from any move source.

Operationally, remove every Dragon-type move from all four of a Pokémon's move-source lists unless either:

1. `Dragon` appears in the Pokémon's own type list; or
2. the Pokémon is Charizard, Ampharos, or Sceptile.

This rule only permits an eligible Pokémon to retain Dragon moves it already has. It never grants a Dragon move.

### Rule 2: Growth is restricted to Grass types, with exceptions

**Growth becomes a Grass-type move** in the redesign. It may only appear in any move source for a Grass-type Pokémon or an explicitly recorded exception.

Operationally:

1. Treat Growth as Grass-type rather than Normal-type for this and all later cumulative rules.
2. Remove Growth from all move sources unless `Grass` appears in the Pokémon's own type list or the Pokémon is one of these exceptions:
   - Comfey;
   - Calyrex Ice Rider; or
   - Calyrex Shadow Rider.

This rule only permits an eligible Pokémon or exception to retain Growth when it is already present; it never grants Growth.

### Rule 3: Toxic requires Poison typing or explicit poison lore

Reduce Toxic's distribution across all move sources. A Pokémon may retain Toxic only when it already has the move and satisfies either of these conditions:

1. `Poison` appears in the Pokémon's own type list; or
2. the Pokémon is non-Poison-type but an English main-series Pokédex entry explicitly describes it producing, carrying as part of its body, secreting, spraying, injecting, or otherwise using poison, toxins, venom, or another poisonous substance.

The currently qualifying non-Poison Pokémon are:

- Butterfree;
- Parasect;
- Seadra;
- Wooper;
- Umbreon;
- Gligar;
- Houndoom;
- Shroomish;
- Breloom;
- Reuniclus;
- Frillish;
- Shelmet;
- Accelgor; and
- Turtonator.

This rule never grants Toxic to a Pokémon that does not already have it. Eligibility is species/form-specific; poison lore belonging only to an evolution, pre-evolution, alternate form, attached Pokémon, or commanded minion does not qualify the audited entry.

## Cumulative dataset impact

### After Rule 1

Rule 1 removes exactly **368 move-source entries from 205 species/form entries**:

| Move source | Entries removed |
|---|---:|
| Level-up | 49 |
| TM/HM | 65 |
| Egg | 29 |
| Tutor | 225 |
| **Total** | **368** |

### After Rule 2

The source dataset contains 64 Growth move-source entries across 60 species/form entries:

| Move source | Growth entries |
|---|---:|
| Level-up | 52 |
| TM/HM | 0 |
| Egg | 7 |
| Tutor | 5 |
| **Total** | **64** |

Of those entries, 60 belong to Grass-type Pokémon and 3 belong to the recorded exceptions. The remaining entry is Numel's Egg-move compatibility, which Rule 2 removes.

Rule 2 therefore removes exactly **1 Egg move entry from 1 species/form entry**. Numel was not affected by Rule 1, so Rules 1–2 cumulatively remove **369 move-source entries from 206 species/form entries**.

### After Rule 3

The source dataset contains 985 Toxic move-source entries across 953 species/form entries:

| Eligibility | Move-source entries retained/removed | Species/forms |
|---|---:|---:|
| Poison-type and retained | 100 | 72 |
| Non-Poison with qualifying lore and retained | 15 | 14 |
| Ineligible and removed | 870 | 867 |
| **Total** | **985** | **953** |

Shroomish accounts for two retained entries because it has Toxic in both its level-up and TM/HM sources. Each of the other 13 lore-qualified Pokémon has one retained TM/HM entry.

Rule 3's removals by source are:

| Move source | Toxic entries removed |
|---|---:|
| Level-up | 3 |
| TM/HM | 864 |
| Egg | 0 |
| Tutor | 3 |
| **Total** | **870** |

After applying Rules 1–3 cumulatively, exactly **1,239 move-source entries have been removed from 891 species/form entries**. The species/form count accounts for overlap between rules.

## Rule 3 research record

The Toxic lore audit used the English main-series flavor text in PokéAPI's `pokemon_species_flavor_text.csv`, pinned at repository commit [`f6918ad2938c70518129a98f0fcc392baff007ee`](https://github.com/PokeAPI/pokeapi/tree/f6918ad2938c70518129a98f0fcc392baff007ee). The [exact pinned CSV](https://raw.githubusercontent.com/PokeAPI/pokeapi/f6918ad2938c70518129a98f0fcc392baff007ee/data/v2/csv/pokemon_species_flavor_text.csv) was searched for poison-, toxin-, and venom-related language, then candidate meanings and form attribution were checked against form-separated Pokédex pages.

Qualifying non-Poison Pokémon and representative evidence:

| Pokémon | Representative main-series Pokédex evidence |
|---|---|
| [Butterfree](https://pokemondb.net/pokedex/butterfree#dex-flavor) | Red: “In battle, it flaps its wings at high speed to release highly toxic dust into the air.” |
| [Parasect](https://pokemondb.net/pokedex/parasect#dex-flavor) | Moon: “It scatters toxic spores from its mushroom cap.” |
| [Seadra](https://pokemondb.net/pokedex/seadra#dex-flavor) | Sword: “The spines on their backs secrete thicker and stronger poison.” |
| [Wooper](https://pokemondb.net/pokedex/wooper#dex-flavor) | Ruby: “On land, it coats its body with a gooey, toxic film.” |
| [Umbreon](https://pokemondb.net/pokedex/umbreon#dex-flavor) | Sun: “Its pores secrete a poisonous sweat, which it sprays at its opponent's eyes.” |
| [Gligar](https://pokemondb.net/pokedex/gligar#dex-flavor) | Legends: Arceus: it uses its stinger to inject prey with venom. |
| [Houndoom](https://pokemondb.net/pokedex/houndoom#dex-flavor) | Platinum: “The flames it breathes when angry contain toxins.” |
| [Shroomish](https://pokemondb.net/pokedex/shroomish#dex-flavor) | Sapphire: its spores are “so toxic, they make trees and weeds wilt.” |
| [Breloom](https://pokemondb.net/pokedex/breloom#dex-flavor) | HeartGold: “It scatters poisonous spores.” |
| [Reuniclus](https://pokemondb.net/pokedex/reuniclus#dex-flavor) | Shield: the liquid surrounding its body is “highly toxic to anything besides Reuniclus itself.” |
| [Frillish](https://pokemondb.net/pokedex/frillish#dex-flavor) | Ultra Moon: it uses “invisible poison spikes” to paralyze enemies. |
| [Shelmet](https://pokemondb.net/pokedex/shelmet#dex-flavor) | Black: “It can spit a sticky, poisonous liquid.” |
| [Accelgor](https://pokemondb.net/pokedex/accelgor#dex-flavor) | Sword: it “lobs poison at foes.” |
| [Turtonator](https://pokemondb.net/pokedex/turtonator#dex-flavor) | Moon: “It gushes fire and poisonous gases from its nostrils.” |

Important exclusions and false positives:

- Bellossom, Vespiquen, and Pyukumuku have Toxic as level-up moves but no qualifying main-series Pokédex text.
- Vespiquen's “poisonous needles” appear only in a *Pokémon Ranger: Shadows of Almia* Browser description, not a main-series Pokédex entry.
- Standard Dark/Ice Sneasel does not qualify. The venomous-claw text indexed at the species level for *Legends: Arceus* belongs specifically to Poison-type Hisuian Sneasel.
- Standard Slowbro and Slowking receive poison from Shellder; their entries do not attribute production or use of that poison to them. Their Galarian forms are considered separately and are Poison-type.
- Snorlax's entries describe resistance to or digestion of poison, not producing or using it.

## Impact history

| Rules applied | Move-source entries removed | Species/forms with removals |
|---:|---:|---:|
| 1 | 368 | 205 |
| 1–2 | 369 | 206 |
| 1–3 | 1,239 | 891 |
