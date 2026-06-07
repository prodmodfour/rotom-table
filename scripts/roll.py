#!/usr/bin/env python3
"""Roll on encounter tables.

Usage:
    roll.py <region> <table> <count>   # roll <count> times
    roll.py <region> <table>           # show the table
    roll.py <region>                   # list tables in a region
    roll.py                            # list regions

Tables are JSON files in encounter_tables/<region>/<table>.json under ROTOM_CAMPAIGN_ROOT when set, otherwise under the app checkout, with shape:
    {
      "name": str,
      "min_level": int,
      "max_level": int,
      "entries": [
        {"weight": int, "species": str, "min_level": int, "max_level": int}
      ]
    }

Legacy entries are also accepted:
    [ceiling, species]
    [ceiling, species, min_level, max_level]
    {"ceiling": int, "species": str, "min_level": int, "max_level": int}

Every table also gets a default {"weight": 60, "species": "Nothing"} row unless
one already exists. Rolling Nothing means no Pokémon is found for that slot, so
counted rolls can print fewer Pokémon than requested.
"""

import json
import os
import random
import sys
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parent.parent


def configured_campaign_root():
    raw = os.environ.get("ROTOM_CAMPAIGN_ROOT", "").strip()
    if not raw:
        return APP_ROOT
    path = Path(raw).expanduser()
    if not path.is_absolute():
        path = APP_ROOT / path
    return path.resolve()


ROOT = configured_campaign_root() / "encounter_tables"
NOTHING_SPECIES = "Nothing"
DEFAULT_NOTHING_WEIGHT = 60


def list_regions():
    if not ROOT.is_dir():
        return []
    regions = set()
    for path in ROOT.rglob("*.json"):
        rel_parent = path.parent.relative_to(ROOT).as_posix()
        regions.add("" if rel_parent == "." else rel_parent)
    return sorted(regions)


def list_tables(region):
    region_dir = ROOT / region
    if not region_dir.is_dir():
        return []
    return sorted(p.stem for p in region_dir.glob("*.json"))


def load_table(region, key):
    path = ROOT / region / f"{key}.json"
    if not path.is_file():
        return None
    with path.open() as f:
        return json.load(f)


def coerce_level(value, fallback):
    try:
        return max(1, min(100, int(value)))
    except (TypeError, ValueError):
        return fallback


def coerce_weight(value, fallback=1):
    try:
        return max(1, int(value))
    except (TypeError, ValueError):
        return fallback


def coerce_ceiling(value, fallback=100):
    try:
        return max(1, min(100, int(value)))
    except (TypeError, ValueError):
        return fallback


def normalize_range(min_level, max_level, fallback_min, fallback_max):
    lo = coerce_level(min_level, fallback_min)
    hi = coerce_level(max_level, fallback_max)
    return (lo, hi) if lo <= hi else (hi, lo)


def is_nothing_species(species):
    return str(species or "").strip().lower() == NOTHING_SPECIES.lower()


def normalize_species(species):
    value = str(species or "").strip()
    return NOTHING_SPECIES if is_nothing_species(value) else value


def default_nothing_entry():
    return {"weight": DEFAULT_NOTHING_WEIGHT, "species": NOTHING_SPECIES}


def entry_species(entry):
    if isinstance(entry, dict):
        return entry.get("species", "")
    return entry[1] if len(entry) > 1 else ""


def entries_with_default_nothing(entries):
    if any(is_nothing_species(entry_species(entry)) for entry in entries):
        return list(entries)
    return [*entries, default_nothing_entry()]


def normalize_entry(entry, fallback_min, fallback_max, previous_ceiling=0):
    if isinstance(entry, dict):
        species = normalize_species(entry.get("species", ""))
        min_level, max_level = normalize_range(
            entry.get("min_level"),
            entry.get("max_level"),
            fallback_min,
            fallback_max,
        )
        if entry.get("weight") is not None:
            weight = coerce_weight(entry.get("weight"))
            return weight, species, min_level, max_level, previous_ceiling + weight

        ceiling = coerce_ceiling(entry.get("ceiling", 100))
        weight = coerce_weight(ceiling - previous_ceiling)
        return weight, species, min_level, max_level, ceiling

    ceiling = coerce_ceiling(entry[0])
    species = normalize_species(entry[1])
    min_level, max_level = normalize_range(
        entry[2] if len(entry) > 2 else None,
        entry[3] if len(entry) > 3 else None,
        fallback_min,
        fallback_max,
    )
    weight = coerce_weight(ceiling - previous_ceiling)
    return weight, species, min_level, max_level, ceiling


def sort_entries_by_weight(entries):
    return sorted(entries, key=lambda entry: (is_nothing_species(entry[1]), -entry[0]))


def normalize_entries(entries, min_level, max_level):
    normalized = []
    previous_ceiling = 0
    for raw_entry in entries_with_default_nothing(entries):
        weight, species, entry_min, entry_max, previous_ceiling = normalize_entry(
            raw_entry,
            min_level,
            max_level,
            previous_ceiling,
        )
        normalized.append((weight, species, entry_min, entry_max))
    return sort_entries_by_weight(normalized)


def roll(entries, min_level, max_level):
    normalized_entries = normalize_entries(entries, min_level, max_level)
    total_weight = sum(entry[0] for entry in normalized_entries)
    if total_weight < 1:
        return 1, NOTHING_SPECIES, None

    r = random.randint(1, total_weight)
    cumulative = 0
    last = None
    for weight, species, entry_min, entry_max in normalized_entries:
        cumulative += weight
        last = (species, entry_min, entry_max)
        if r <= cumulative:
            if is_nothing_species(species):
                return r, species, None
            return r, species, random.randint(entry_min, entry_max)
    if last:
        species, entry_min, entry_max = last
        if is_nothing_species(species):
            return r, species, None
        return r, species, random.randint(entry_min, entry_max)
    return r, NOTHING_SPECIES, None


def level_label(min_level, max_level):
    if min_level is None or max_level is None:
        return "—"
    return f"Lv {min_level}" if min_level == max_level else f"Lv {min_level}-{max_level}"


def percent_label(weight, total_weight):
    if total_weight <= 0:
        return "0%"
    percent = weight / total_weight * 100
    if percent.is_integer():
        return f"{int(percent)}%"
    digits = 1 if percent >= 10 else 2
    return f"{percent:.{digits}f}".rstrip("0").rstrip(".") + "%"


def print_region_tables(region):
    tables = list_tables(region)
    if not tables:
        print(f"No tables found for region '{region}'.")
        return
    print(f"Tables in '{region}':")
    for key in tables:
        table = load_table(region, key)
        lv = f"{table['min_level']}-{table['max_level']}"
        print(f"  {key:12s}  {table['name']} (Lv {lv})")


def main():
    args = sys.argv[1:]

    if args and args[0] in ("-h", "--help", "help"):
        print(__doc__.strip())
        print()
        print("Regions:")
        for region in list_regions():
            print(f"  {region or '.'}")
        sys.exit(0)

    if not args:
        print("Usage: roll.py <region> <table> [count]")
        print("       roll.py <region> <table>   # show table")
        print()
        regions = list_regions()
        if regions:
            print("Regions:")
            for region in regions:
                print(f"  {region or '.'}")
        else:
            print(f"No regions found in {ROOT}")
        sys.exit(0)

    region = args[0]
    if region not in list_regions():
        print(f"Unknown region '{region}'. Options: {', '.join(list_regions())}")
        sys.exit(1)

    if len(args) == 1:
        print_region_tables(region)
        sys.exit(0)

    key = args[1]
    table = load_table(region, key)
    if table is None:
        tables = list_tables(region)
        print(f"Unknown table '{key}' in '{region}'. Options: {', '.join(tables)}")
        sys.exit(1)

    lv_range = f"{table['min_level']}-{table['max_level']}"

    if len(args) <= 2:
        print(f"--- {table['name']} (Lv {lv_range}) ---")
        normalized_entries = normalize_entries(table["entries"], table["min_level"], table["max_level"])
        total_weight = sum(entry[0] for entry in normalized_entries)
        prev = 0
        for weight, species, entry_min, entry_max in normalized_entries:
            hi = prev + weight
            span = f"{prev + 1:>3d}-{hi:<3d}" if hi > prev + 1 else f"    {hi:<3d}"
            pct = percent_label(weight, total_weight)
            shown_min = None if is_nothing_species(species) else entry_min
            shown_max = None if is_nothing_species(species) else entry_max
            print(f"  {span}  (w {weight:>3d}, {pct:>6s})  {species:16s}  {level_label(shown_min, shown_max)}")
            prev = hi
        sys.exit(0)

    count = int(args[2])
    print(f"--- {table['name']} (Lv {lv_range}) ---")
    for _ in range(count):
        r, species, level = roll(table["entries"], table["min_level"], table["max_level"])
        if level is None:
            continue
        print(f"{species} (Lv {level})")


if __name__ == "__main__":
    main()
