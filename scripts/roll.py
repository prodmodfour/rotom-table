#!/usr/bin/env python3
"""Roll on encounter tables.

Usage:
    roll.py <region> <table> <count>   # roll <count> times
    roll.py <region> <table>           # show the table
    roll.py <region>                   # list tables in a region
    roll.py                            # list regions

Tables are JSON files in encounter_tables/<region>/<table>.json with shape:
    {
      "name": str,
      "min_level": int,
      "max_level": int,
      "entries": [[ceiling, species], ...]
    }
"""

import json
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "encounter_tables"


def list_regions():
    if not ROOT.is_dir():
        return []
    return sorted(p.name for p in ROOT.iterdir() if p.is_dir())


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


def roll(entries, min_level, max_level):
    r = random.randint(1, 100)
    level = random.randint(min_level, max_level)
    for ceiling, species in entries:
        if r <= ceiling:
            return r, species, level


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
            print(f"  {region}")
        sys.exit(0)

    if not args:
        print("Usage: roll.py <region> <table> [count]")
        print("       roll.py <region> <table>   # show table")
        print()
        regions = list_regions()
        if regions:
            print("Regions:")
            for region in regions:
                print(f"  {region}")
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
        prev = 0
        for ceiling, species in table["entries"]:
            span = f"{prev + 1:>3d}-{ceiling:<3d}" if ceiling > prev + 1 else f"    {ceiling:<3d}"
            pct = ceiling - prev
            print(f"  {span}  ({pct:>2d}%)  {species}")
            prev = ceiling
        sys.exit(0)

    count = int(args[2])
    print(f"--- {table['name']} (Lv {lv_range}) ---")
    for _ in range(count):
        r, species, level = roll(table["entries"], table["min_level"], table["max_level"])
        print(f"{species} (Lv {level})")


if __name__ == "__main__":
    main()
