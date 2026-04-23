#!/usr/bin/env python3
"""Parse PTU 1.05 conditions and afflictions into a JSON cache."""

import json
import os
import re
import sys

MARKDOWN_DIR = os.path.join(os.path.dirname(__file__), "..", "books", "markdown")
SOURCE_FILES = [
    os.path.join(MARKDOWN_DIR, "arceus_references.md"),
    os.path.join(MARKDOWN_DIR, "swsh_-_armor_crown_references.md"),
    os.path.join(MARKDOWN_DIR, "sumo_references.md"),
    os.path.join(MARKDOWN_DIR, "errata-3.md"),
    os.path.join(MARKDOWN_DIR, "errata-2.md"),
    os.path.join(MARKDOWN_DIR, "core", "07-combat.md"),
]
CACHE_DIR = os.path.join(os.path.dirname(__file__), "data")

ALIASES = {
    "Burned": ["Burn"],
    "Frozen": ["Freeze"],
    "Poisoned": ["Poison"],
    "Paralysis": ["Paralyzed", "Paralyze"],
    "Rage": ["Enraged"],
    "Infatuation": ["Infatuated"],
    "Flinch": ["Flinched"],
}


def _clean_text(text: str) -> str:
    text = text.replace("\u00ad", "")
    text = re.sub(r"(\w)-\s*\n\s*(\w)", r"\1\2", text)
    text = re.sub(r"(?m)^## Page .*?$", "", text)
    text = re.sub(r"(?m)^Combat\s*$", "", text)
    text = re.sub(r"(?m)^\d+\s*$", "", text)
    return text.strip()


def _normalize_block(text: str) -> str:
    text = _clean_text(text)
    text = text.replace("»»", "•")
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    normalized = " ".join(lines)
    return re.sub(r"\s+", " ", normalized).strip()


def _extract_named_blocks(section: str, names: list[str]) -> dict[str, str]:
    pattern = re.compile(r"(?m)^(" + "|".join(re.escape(name) for name in names) + r"):\s*")
    matches = list(pattern.finditer(section))
    blocks: dict[str, str] = {}
    for index, match in enumerate(matches):
        name = match.group(1)
        block_start = match.end()
        block_end = matches[index + 1].start() if index + 1 < len(matches) else len(section)
        blocks[name] = _normalize_block(section[block_start:block_end])
    return blocks


def _parse_core_conditions(text: str) -> dict[str, dict]:
    conditions: dict[str, dict] = {}

    persistent_section = text[text.index("Persistent Afflictions"):text.index("## Page 247")]
    persistent_names = ["Burned", "Frozen", "Paralysis", "Poisoned"]
    persistent_blocks = _extract_named_blocks(persistent_section, persistent_names)
    for name, effect in persistent_blocks.items():
        conditions[name] = {
            "name": name,
            "category": "Persistent Affliction",
            "effect": effect,
            "aliases": ALIASES.get(name, []),
        }

    poison_block = persistent_blocks.get("Poisoned", "")
    badly_poisoned = re.search(r"When Badly Poisoned, (.+?) Note:", poison_block)
    if badly_poisoned:
        conditions["Badly Poisoned"] = {
            "name": "Badly Poisoned",
            "category": "Persistent Affliction",
            "effect": re.sub(r"\s+", " ", badly_poisoned.group(1)).strip(),
            "aliases": [],
        }

    volatile_section = text[text.index("Volatile Afflictions"):text.index("## Page 248")]
    volatile_names = [
        "Bad Sleep",
        "Confused",
        "Cursed",
        "Disabled",
        "Rage",
        "Flinch",
        "Infatuation",
        "Sleep",
        "Suppressed",
    ]
    volatile_blocks = _extract_named_blocks(volatile_section, volatile_names)
    for name, effect in volatile_blocks.items():
        conditions[name] = {
            "name": name,
            "category": "Volatile Affliction",
            "effect": effect,
            "aliases": ALIASES.get(name, []),
        }

    other_section = text[text.index("Other Afflictions"):text.index("## Page 249")]
    other_names = [
        "Fainted",
        "Blindness",
        "Total Blindness",
        "Slowed",
        "Stuck",
        "Trapped",
        "Tripped",
        "Vulnerable",
    ]
    other_blocks = _extract_named_blocks(other_section, other_names)
    for name, effect in other_blocks.items():
        conditions[name] = {
            "name": name,
            "category": "Other Affliction",
            "effect": effect,
            "aliases": ALIASES.get(name, []),
        }

    return conditions


def _parse_from_source(path: str, text: str) -> dict[str, dict]:
    if os.path.basename(path) == "07-combat.md":
        return _parse_core_conditions(text)
    return {}


def parse_conditions(verbose: bool = False) -> dict[str, dict]:
    conditions: dict[str, dict] = {}
    provenance: dict[str, str] = {}

    for path in SOURCE_FILES:
        if not os.path.exists(path):
            continue
        with open(path, "r", encoding="utf-8") as file:
            text = file.read()
        label = os.path.basename(path)
        parsed = _parse_from_source(path, text)
        added = 0
        shadowed = 0
        for name, condition in parsed.items():
            if name not in conditions:
                conditions[name] = condition | {"source": label}
                provenance[name] = label
                added += 1
            else:
                shadowed += 1
                if verbose:
                    print(f"  [shadowed] {name}: kept {provenance[name]}, dropped {label}")
        if parsed or verbose:
            print(f"  {label}: +{added} new, {shadowed} shadowed by higher-priority source")

    return conditions


def build_cache(verbose: bool = False):
    os.makedirs(CACHE_DIR, exist_ok=True)
    print("Parsing conditions (priority: newest supplement → core)...")
    conditions = parse_conditions(verbose=verbose)
    out_path = os.path.join(CACHE_DIR, "conditions.json")
    with open(out_path, "w", encoding="utf-8") as file:
        json.dump(conditions, file, indent=2, ensure_ascii=False)
    print(f"Wrote {len(conditions)} conditions to {out_path}")
    return conditions


if __name__ == "__main__":
    build_cache(verbose="--verbose" in sys.argv or "-v" in sys.argv)
