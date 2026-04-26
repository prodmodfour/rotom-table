#!/usr/bin/env python3
"""
PTU 1.05 Pokémon Generator CLI

Generate a single PTU stat block as a ``CharacterSheet`` JSON file that
the Nuxt ``/sheets`` UI can pick up. Random-pool rolling lives upstream
(encounter tables, GM choice); this tool just stats what you tell it to.

Usage:
  python cli.py --species NAME --level N [options]

Options:
  --species NAME       Species to generate (required, case-insensitive)
  --level N            Level (required)
  --nature NAME        Force a specific nature (e.g. Adamant)
  --shiny-odds N       Shiny chance in percent (default: 0)
  --rebuild-cache      Force rebuild of data cache from markdown sources
  --output-dir DIR     Where to write the generated .json sheet
                       (default: <repo>/data/sheets/wild)
  --slug-prefix PFX    Prefix added to the generated sheet's ``slug``
                       (e.g. ``wild-forest-3``) so batch runs don't
                       clobber each other in the global slug map.
                       Defaults to the leaf name of --output-dir.
  --nickname NAME      Override the sheet ``nickname``. Defaults to
                       the species name.
  -h, --help           Show this help message

Examples:
  python cli.py --species Charmander --level 5
  python cli.py --species Pelipper --level 30 --nature Adamant
  python cli.py --species Houndour --level 18 \\
                --output-dir ../data/sheets/wild/forest_3 \\
                --slug-prefix wild-forest-3
"""

import argparse
import json
import os
import re
import sys

# Ensure we can import sibling modules
sys.path.insert(0, os.path.dirname(__file__))

from parse_pokedex import build_cache as build_pokedex_cache
from parse_moves import build_cache as build_moves_cache
from parse_abilities import build_cache as build_abilities_cache
from generator import generate_pokemon
from sheet_emitter import to_character_sheet

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
# Default lands inside the Nuxt sheet tree so freshly-generated mons
# show up in /sheets without any extra plumbing.
OUTPUT_DIR = os.path.join(
    os.path.dirname(__file__), "..", "data", "sheets", "wild"
)


def load_or_build(name: str, builder):
    path = os.path.join(DATA_DIR, f"{name}.json")
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    else:
        print(f"Cache not found for {name}, building...")
        return builder()


def sanitize_filename(name: str) -> str:
    return re.sub(r"[^\w\-. ]", "", name).strip().replace(" ", "_")


def slugify(value: str) -> str:
    """kebab-case slug: lowercase, alnum + dashes, collapse runs."""
    out = re.sub(r"[^a-zA-Z0-9]+", "-", value).strip("-").lower()
    return out or "sheet"


def main():
    parser = argparse.ArgumentParser(
        description="PTU 1.05 Pokémon Generator",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__
    )
    parser.add_argument("--species", type=str, required=True,
                        help="Species to generate (required)")
    parser.add_argument("--level", type=int, required=True,
                        help="Level (required)")
    parser.add_argument("--nature", type=str, help="Force a nature (e.g. Adamant)")
    parser.add_argument("--shiny-odds", type=float, default=0.0, help="Shiny chance %% (default: 0)")
    parser.add_argument("--rebuild-cache", action="store_true", help="Force rebuild data cache")
    parser.add_argument("--output-dir", type=str, default=OUTPUT_DIR,
                        help=f"Where to write the generated .json sheet (default: {OUTPUT_DIR})")
    parser.add_argument("--slug-prefix", type=str, default=None,
                        help="Prefix added to the sheet ``slug`` for global "
                             "uniqueness (default: leaf of --output-dir)")
    parser.add_argument("--nickname", type=str, default=None,
                        help="Override the sheet ``nickname`` (default: species name)")

    args = parser.parse_args()

    # Build or load caches
    if args.rebuild_cache:
        pokedex = build_pokedex_cache()
        moves_list = build_moves_cache()
        abilities_list = build_abilities_cache()
        # Reload as the builders return raw lists/dicts but also write JSON
        pokedex_path = os.path.join(DATA_DIR, "pokedex.json")
        moves_path = os.path.join(DATA_DIR, "moves.json")
        abilities_path = os.path.join(DATA_DIR, "abilities.json")
        with open(pokedex_path) as f:
            pokedex = json.load(f)
        with open(moves_path) as f:
            moves_db = json.load(f)
        with open(abilities_path) as f:
            abilities_db = json.load(f)
    else:
        pokedex = load_or_build("pokedex", build_pokedex_cache)
        moves_db = load_or_build("moves", build_moves_cache)
        abilities_db = load_or_build("abilities", build_abilities_cache)

    # If pokedex is a list (from builder), it's already good; moves/abilities are dicts
    if isinstance(moves_db, list):
        moves_db = {m["name"]: m for m in moves_db}
    if isinstance(abilities_db, list):
        abilities_db = {a["name"]: a for a in abilities_db}

    # Look up the requested species (exact match, case-insensitive).
    matches = [p for p in pokedex if p["species"].lower() == args.species.lower()]
    if not matches:
        print(f"Error: Species '{args.species}' not found in pokedex.", file=sys.stderr)
        sys.exit(1)
    entry = matches[0]

    required_fields = ["types", "base_stats", "abilities", "capabilities", "skills", "level_up_moves"]
    missing_fields = [field for field in required_fields if field not in entry]
    if missing_fields:
        print(
            f"Error: Species '{args.species}' has placement data in pokedex.json but lacks PTU stat data ({', '.join(missing_fields)}).",
            file=sys.stderr,
        )
        sys.exit(1)

    # Create output directory
    output_dir = args.output_dir
    os.makedirs(output_dir, exist_ok=True)

    # Generate
    poke = generate_pokemon(
        entry, args.level, moves_db, abilities_db,
        nature=args.nature, shiny_odds=args.shiny_odds
    )

    # Pick a collision-safe filename of the form
    # ``[shiny_]<species>_lv<level>_<n>.json`` so repeat runs into the same
    # --output-dir don't clobber earlier files.
    shiny_prefix = "shiny_" if poke["shiny"] else ""
    base = f"{shiny_prefix}{sanitize_filename(poke['species'])}_lv{poke['level']}".lower()
    n = 1
    while True:
        fname = f"{base}_{n}.json"
        out_path = os.path.join(output_dir, fname)
        if not os.path.exists(out_path):
            break
        n += 1

    # Slug must be globally unique across data/sheets/**/*.json so the
    # ``characterSheetsBySlug`` Map doesn't drop one. The caller (the
    # encounter API or `just encounter`) hands us a per-batch prefix; if
    # nothing was supplied, fall back to the leaf name of --output-dir.
    prefix = args.slug_prefix
    if not prefix:
        prefix = slugify(os.path.basename(os.path.normpath(output_dir)))
    else:
        prefix = slugify(prefix)
    slug = f"{prefix}-{slugify(base)}-{n}"

    sheet = to_character_sheet(poke, slug=slug, nickname=args.nickname)

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(sheet, f, indent=2, ensure_ascii=False)
        f.write("\n")

    print(f"  → {out_path}")
    print(f"    {poke['species']} Lv.{poke['level']} | {poke['nature_label']} | {'/'.join(poke['types'])} | {'♦ Shiny' if poke['shiny'] else ''}")
    print(f"\nGenerated 1 Pokémon sheet in {output_dir}/")


if __name__ == "__main__":
    main()
