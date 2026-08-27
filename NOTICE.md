# Notice

Rotom Table is an unofficial, non-commercial fan-made tabletop utility for private Pokémon Tabletop United campaign play.

## Fan-project and ownership boundary

This repository is not an official Pokémon product and is not affiliated with, endorsed by, sponsored by, or approved by The Pokémon Company, Nintendo, Game Freak, Creatures, or the Pokémon Tabletop United authors or publishers.

Pokémon-related and Pokémon Tabletop United-related names, images, rules terms, concepts, characters, creatures, sprites, reference text, and other third-party materials belong to their respective owners. The fan-project posture and attribution in this notice do **not** by themselves grant permission to copy or redistribute those materials.

## Rotom Table license scope

The repository `LICENSE` applies only to original Rotom Table application code, project-specific documentation, original visual assets, and original tooling. It does not grant rights to Pokémon/PTU material, third-party media, font software, dependency code, trademarks, endorsement, or private campaign data.

The project-authored RT favicon, CSS type and damage-class badges, CSS live-play saving indicator, and procedural voxel-water painter are original Rotom Table work within that limited grant. They replaced 29 images whose upstream source and permission could not be established.

## PTU-derived data and documentary material

The canonical runtime reference JSON under `data/reference/`, `shared/ruleset/natures.ts`, and the retained `books/` and `ptu-data/` documentary/provenance trees contain or describe PTU-derived names, facts, rules, or text. They remain outside the Rotom Table license grant. Retention records the owner's source-distribution decision; it is not a claim of ownership or legal clearance.

Production runtime is forbidden from reading the documentary trees. See `books/README.md`, `ptu-data/README.md`, and `docs/fan-project-notice.md`.

## Third-party sprites and media

The source distribution retains the following third-party Pokémon-related media with provenance and uncertainty disclosed:

- **Item artwork:** PokéSprite-derived files under `public/item-sprites/`, indexed by `data/itemSpriteManifest.json`. Source and project notice: <https://github.com/msikma/pokesprite> and <https://github.com/msikma/pokesprite/blob/master/license.md>.
- **Pokémon sprites:** files under `public/sprites/`, with per-row remote URLs in `data/pokemonSpriteManifest.json` and `data/pokemonBackSpriteManifest.json`; source hosts include Pokémon Database and Pokémon Showdown. See <https://pokemondb.net/sprites> and <https://github.com/smogon/sprites#license>.
- **Derived Pokémon presentations:** `public/spritesheets/` and `public/profile-sprites/pokemon/` are generated from the retained Pokémon sprite files. Their derivative status does not create new rights in the source artwork.
- **Trainer artwork:** `trainer_sizes/sprites/` comes from the Pokémon Showdown trainer index. `trainer_sizes/sprite_manifest.json` records the remote URL and artist where supplied for each row; `docs/media-attribution.md` provides the family-level credit index. See <https://play.pokemonshowdown.com/sprites/trainers/> and <https://pokemonshowdown.com/credits>.
- **Edited Trainer profiles — accepted risk:** `public/profile-sprites/trainers/` contains 1,460 cropped/rescaled derivatives generated from the Trainer source set. That editing conflicts with the source index's do-not-edit warning. The owner explicitly declined recommendation 5 (removal or replacement) and accepted this identified distribution risk for 1.0. Attribution and disclosure do not resolve or waive the underlying uncertainty.
- **Screenshots:** tracked release, compatibility, and visual-regression screenshots are Rotom-generated captures and may depict retained third-party sprites. They do not expand the Rotom Table license grant over depicted material.

Most retained Pokémon/item/Trainer artwork does not carry an explicit redistribution license in this repository's provenance record. See `data/release-readiness/media-asset-inventory.v1.json` for the content-bound inventory and exact counts.

## Fonts and software dependencies

Rotom Table embeds Atkinson Hyperlegible, EB Garamond, and JetBrains Mono through Fontsource. The font binaries remain under the SIL Open Font License 1.1 and their copyright notices are preserved in `public/THIRD_PARTY_NOTICES.txt`.

The same generated notice bundle indexes every exact `package-lock.json` npm dependency and embeds all root license/notice texts present in the installed lock-bound packages. Python sprite-helper dependencies are exact-version pinned as a complete six-package graph in `requirements.txt` and are indexed there as well.

Third-party licenses apply to their respective components only and do not place Pokémon/PTU material under those licenses. The machine-readable dependency inventory is `data/release-readiness/dependency-license-report.v1.json`.
