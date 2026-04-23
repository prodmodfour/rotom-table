#!/usr/bin/env python3
"""Parse PTU 1.05 abilities from the indices-and-reference chapter into a JSON cache."""

import json
import os
import re

MARKDOWN_DIR = os.path.join(
    os.path.dirname(__file__), "..", "books", "markdown"
)
# Source files listed in priority order, **highest first**. Each subsequent file
# is treated as an older layer that only fills in abilities the higher-priority
# files don't already define — i.e. newer generation supplements patch over the
# PTU 1.05 core, which is the oldest base layer.
SOURCE_FILES = [
    os.path.join(MARKDOWN_DIR, "arceus_references.md"),            # Legends: Arceus (2022)
    os.path.join(MARKDOWN_DIR, "swsh_-_armor_crown_references.md"), # SwSh + DLCs   (2019–2020)
    os.path.join(MARKDOWN_DIR, "sumo_references.md"),               # Sun/Moon      (2016–2018)
    os.path.join(MARKDOWN_DIR, "errata-3.md"),                      # Feb 2016 playtest / errata 3
    os.path.join(MARKDOWN_DIR, "errata-2.md"),                      # Sept 2015 playtest / errata 2
    os.path.join(MARKDOWN_DIR, "core", "10-indices-and-reference.md"),  # PTU 1.05 core (base)
]
CACHE_DIR = os.path.join(os.path.dirname(__file__), "data")

# Manual name fix-ups for known casing inconsistencies in source material.
NAME_FIXUPS = {
    "Weird power": "Weird Power",
}


def _parse_blocks(text: str) -> dict[str, dict]:
    abilities: dict[str, dict] = {}
    blocks = re.split(r"^Ability: ", text, flags=re.MULTILINE)

    for block in blocks[1:]:
        lines = block.strip().splitlines()
        if not lines:
            continue

        name = lines[0].strip()
        name = NAME_FIXUPS.get(name, name)
        ability = {"name": name}

        # Second line is typically the frequency
        if len(lines) > 1:
            freq_line = lines[1].strip()
            if re.match(r"^(Static|Scene|At-Will|Daily|EOT|EoT|1/Round)", freq_line):
                ability["frequency"] = freq_line

        body = "\n".join(lines[1:])

        # Trigger
        m = re.search(r"^Trigger[:\s]+(.+)", body, re.MULTILINE)
        if m:
            ability["trigger"] = m.group(1).strip()

        # Effect — grab everything after "Effect:" until end of this block
        m = re.search(r"^Effect:\s*(.+(?:\n(?!Ability:|Move:|Bonus:|Trigger:).+)*)", body, re.MULTILINE)
        if m:
            effect = m.group(1).strip()
            effect = re.sub(r"\s*\n\s*", " ", effect)
            ability["effect"] = effect

        abilities[name] = ability

    return abilities


def parse_abilities(verbose: bool = False) -> dict[str, dict]:
    """Parse abilities from all source files in priority order (first wins)."""
    abilities: dict[str, dict] = {}
    provenance: dict[str, str] = {}  # ability name -> source file that supplied it

    for path in SOURCE_FILES:
        if not os.path.exists(path):
            continue
        with open(path, "r", encoding="utf-8") as f:
            text = f.read()
        label = os.path.basename(path)
        added = 0
        shadowed = 0
        for name, ability in _parse_blocks(text).items():
            if name not in abilities:
                abilities[name] = ability
                provenance[name] = label
                added += 1
            else:
                shadowed += 1
                if verbose:
                    print(f"  [shadowed] {name}: kept {provenance[name]}, dropped {label}")
        print(f"  {label}: +{added} new, {shadowed} shadowed by higher-priority source")

    return abilities


def build_cache(verbose: bool = False):
    os.makedirs(CACHE_DIR, exist_ok=True)
    print("Parsing abilities (priority: newest supplement → core)...")
    abilities = parse_abilities(verbose=verbose)
    out_path = os.path.join(CACHE_DIR, "abilities.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(abilities, f, indent=2, ensure_ascii=False)
    print(f"Wrote {len(abilities)} abilities to {out_path}")
    return abilities


if __name__ == "__main__":
    import sys
    build_cache(verbose="--verbose" in sys.argv or "-v" in sys.argv)
