#!/usr/bin/env python3
"""Lookup PTU reference data caches and print markdown."""

import argparse
import difflib
import json
import os
import re
import sys
from typing import Callable

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PTU_DIR = os.path.join(REPO_ROOT, "ptu-data")
DATA_DIR = os.path.join(PTU_DIR, "data")
sys.path.insert(0, PTU_DIR)

from parse_pokedex import build_cache as build_pokedex_cache
from parse_abilities import build_cache as build_abilities_cache
from parse_moves import build_cache as build_moves_cache
from parse_capabilities import build_cache as build_capabilities_cache
from parse_conditions import build_cache as build_conditions_cache
from parse_items import build_cache as build_items_cache
from parse_rules import build_cache as build_rules_cache


BUILDERS: dict[str, tuple[str, Callable]] = {
    "pokemon": ("pokedex.json", build_pokedex_cache),
    "ability": ("abilities.json", build_abilities_cache),
    "move": ("moves.json", build_moves_cache),
    "capability": ("capabilities.json", build_capabilities_cache),
    "condition": ("conditions.json", build_conditions_cache),
    "item": ("items.json", build_items_cache),
    "rule": ("rules.json", build_rules_cache),
}


def load_or_build(kind: str):
    filename, builder = BUILDERS[kind]
    path = os.path.join(DATA_DIR, filename)
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as file:
            return json.load(file)
    return builder()


def normalize_key(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", text.lower())


def primary_name(entry: dict, kind: str) -> str:
    return entry["species"] if kind == "pokemon" else entry["name"]


def candidate_names(entry: dict, kind: str) -> list[str]:
    names = [primary_name(entry, kind)]
    for alias in entry.get("aliases", []):
        if alias not in names:
            names.append(alias)
    return names


def entry_text(entry: dict, kind: str) -> str:
    parts = candidate_names(entry, kind)
    for key in ("category", "categories", "sections", "effects", "notes", "text"):
        value = entry.get(key)
        if isinstance(value, str):
            parts.append(value)
        elif isinstance(value, list):
            parts.extend(str(item) for item in value)
    return " ".join(parts)


def score_entry(query: str, entry: dict, kind: str) -> float:
    query_lower = query.lower().strip()
    query_norm = normalize_key(query)
    names = candidate_names(entry, kind)
    lowered = [name.lower() for name in names]
    normalized = [normalize_key(name) for name in names]

    if query_lower in lowered:
        return 2000
    if query_norm in normalized:
        return 1900
    if any(name.startswith(query_lower) for name in lowered):
        return 1800
    if any(name.startswith(query_norm) for name in normalized):
        return 1700
    if any(query_lower in name for name in lowered):
        return 1600
    if any(query_norm in name for name in normalized):
        return 1500

    haystack_norm = normalize_key(entry_text(entry, kind))
    if query_norm and query_norm in haystack_norm:
        return 1200

    similarity = max((difflib.SequenceMatcher(None, query_norm, name).ratio() for name in normalized if name), default=0.0)
    return similarity * 100


def find_match(query: str, entries: list[dict], kind: str) -> tuple[dict | None, list[dict]]:
    ranked = sorted(entries, key=lambda entry: (-score_entry(query, entry, kind), primary_name(entry, kind)))
    if not ranked:
        return None, []
    top = ranked[0]
    top_score = score_entry(query, top, kind)
    if top_score < 70:
        return None, ranked[:8]
    if len(ranked) > 1:
        second_score = score_entry(query, ranked[1], kind)
        if top_score < 1900 and second_score >= top_score - 1:
            return None, ranked[:8]
    return top, ranked[:8]


def format_bullets(values: list[str]) -> str:
    return "\n".join(f"  - {value}" for value in values if value)


def format_move(move: dict) -> str:
    lines = [f"# {move['name']}"]
    if move.get("type"):
        lines.append(f"  - {move['type']}")
    if move.get("damage_class"):
        lines.append(f"  - {move['damage_class']}")
    if move.get("damage_base") is not None:
        lines.append(f"  - DB {move['damage_base']}")
    if move.get("damage_roll"):
        lines.append(f"  - {move['damage_roll']}")
    if move.get("frequency"):
        lines.append(f"  - {move['frequency']}")
    if move.get("ac") is not None:
        lines.append(f"  - AC {move['ac']}")
    if move.get("range"):
        lines.append(f"  - {move['range']}")
    if move.get("effect") and move["effect"].lower() != "none":
        lines.append(f"  - {move['effect']}")
    return "\n".join(lines)


def format_ability(ability: dict) -> str:
    lines = [f"# {ability['name']}"]
    if ability.get("frequency"):
        lines.append(f"  - {ability['frequency']}")
    if ability.get("trigger"):
        lines.append(f"  - Trigger - {ability['trigger']}")
    if ability.get("effect"):
        lines.append(f"  - {ability['effect']}")
    return "\n".join(lines)


def format_capability(entry: dict) -> str:
    lines = [f"# {entry['name']}", "  - Special Capability"]
    if entry.get("effect"):
        lines.append(f"  - {entry['effect']}")
    if entry.get("source"):
        lines.append(f"  - Source: {entry['source']}")
    return "\n".join(lines)


def format_condition(entry: dict) -> str:
    lines = [f"# {entry['name']}"]
    if entry.get("category"):
        lines.append(f"  - {entry['category']}")
    if entry.get("aliases"):
        lines.append(f"  - Aliases: {', '.join(entry['aliases'])}")
    if entry.get("effect"):
        lines.append(f"  - {entry['effect']}")
    if entry.get("source"):
        lines.append(f"  - Source: {entry['source']}")
    return "\n".join(lines)


def format_item(entry: dict) -> str:
    lines = [f"# {entry['name']}"]
    if entry.get("categories"):
        lines.append(f"  - Categories: {', '.join(entry['categories'])}")
    if entry.get("costs"):
        lines.append(f"  - Cost: {'; '.join(entry['costs'])}")
    for effect in entry.get("effects", []):
        lines.append(f"  - {effect}")
    if entry.get("notes"):
        lines.append("## Notes")
        lines.append(format_bullets(entry["notes"]))
    if entry.get("sections"):
        lines.append(f"  - Sections: {', '.join(entry['sections'])}")
    return "\n".join(lines)


def format_rule(entry: dict) -> str:
    lines = [f"# {entry['name']}"]
    if entry.get("category"):
        lines.append(f"  - {entry['category']}")
    if entry.get("aliases"):
        lines.append(f"  - Aliases: {', '.join(entry['aliases'])}")
    if entry.get("source"):
        lines.append(f"  - Source: {entry['source']}")
    lines.append("")
    lines.append(entry["text"])
    return "\n".join(lines).strip()


def format_pokemon(entry: dict) -> str:
    lines = [f"# {entry['species']}"]

    types = [str(pokemon_type) for pokemon_type in entry.get("types", []) if pokemon_type]
    if types:
        lines.append(f"  - {' / '.join(types)}")

    if entry.get("source_gen"):
        lines.append(f"  - Source: {entry['source_gen']}")

    summary_parts = []
    if entry.get("size"):
        summary_parts.append(f"Size {entry['size']}")
    if entry.get("width") is not None and entry.get("height") is not None:
        summary_parts.append(f"Sprite {entry['width']}m × {entry['height']}m")
    if entry.get("base") is not None:
        summary_parts.append(f"Base {entry['base']} × {entry['base']}")
    if entry.get("clearance") is not None:
        summary_parts.append(f"Clearance {entry['clearance']}m")
    if entry.get("weight") is not None:
        summary_parts.append(f"Weight {entry['weight']}")
    if "genderless" in entry:
        if entry.get("genderless"):
            summary_parts.append("Genderless")
        else:
            summary_parts.append(f"{entry.get('male_pct', 0):.0f}% M / {entry.get('female_pct', 0):.0f}% F")
    if summary_parts:
        lines.append(f"  - {' | '.join(summary_parts)}")

    if entry.get("evolution_stage") is not None or entry.get("evolutions_remaining") is not None:
        lines.append(
            f"  - Evolution Stage {entry.get('evolution_stage', '?')} | Evolutions Remaining {entry.get('evolutions_remaining', '?')}"
        )

    has_ptu_data = any(
        key in entry
        for key in ("base_stats", "abilities", "evolutions", "capabilities", "skills", "level_up_moves")
    )
    if not has_ptu_data:
        lines.extend([
            "",
            "## Available Data",
            format_bullets([
                "Placement data only. PTU stat data is not available in the cache yet.",
            ]),
        ])
        return "\n".join(lines)

    base_stats = entry.get("base_stats") or {}
    if base_stats:
        lines.extend([
            "",
            "## Base Stats",
            format_bullets([
                f"HP {base_stats['hp']}" if "hp" in base_stats else "",
                f"Attack {base_stats['atk']}" if "atk" in base_stats else "",
                f"Defense {base_stats['def']}" if "def" in base_stats else "",
                f"Special Attack {base_stats['spatk']}" if "spatk" in base_stats else "",
                f"Special Defense {base_stats['spdef']}" if "spdef" in base_stats else "",
                f"Speed {base_stats['spd']}" if "spd" in base_stats else "",
            ]),
        ])

    abilities = entry.get("abilities") or {}
    if abilities:
        lines.extend([
            "",
            "## Abilities",
            format_bullets([
                f"Basic: {', '.join(abilities.get('basic', [])) or 'None'}",
                f"Advanced: {', '.join(abilities.get('advanced', [])) or 'None'}",
                f"High: {', '.join(abilities.get('high', [])) or 'None'}",
            ]),
        ])

    evolutions = entry.get("evolutions") or []
    if evolutions:
        lines.extend([
            "",
            "## Evolution",
            format_bullets([
                f"Stage {e['stage']} - {e['species']}{f' (Minimum {e['min_level']})' if e.get('min_level') else ''}"
                for e in evolutions
            ]),
        ])

    capabilities = entry.get("capabilities") or {}
    if capabilities:
        lines.extend([
            "",
            "## Capabilities",
            format_bullets([
                f"Overland {capabilities['overland']}" if "overland" in capabilities else "",
                f"Sky {capabilities['sky']}" if "sky" in capabilities else "",
                f"Swim {capabilities['swim']}" if "swim" in capabilities else "",
                f"Levitate {capabilities['levitate']}" if "levitate" in capabilities else "",
                f"Burrow {capabilities['burrow']}" if "burrow" in capabilities else "",
                f"Jump {capabilities['jump']}" if "jump" in capabilities else "",
                f"Power {capabilities['power']}" if "power" in capabilities else "",
                *capabilities.get("other", []),
            ]),
        ])

    lines.extend([
        "",
        "## Skills",
        format_bullets([f"{name} {value}" for name, value in (entry.get("skills") or {}).items()] or ["None"]),
        "",
        "## Level-Up Moves",
        format_bullets([
            f"Lv {move['level']} - {move['name']} ({move['type']})"
            for move in entry.get("level_up_moves", [])
        ] or ["None"]),
    ])
    return "\n".join(lines)


FORMATTERS = {
    "pokemon": format_pokemon,
    "ability": format_ability,
    "move": format_move,
    "capability": format_capability,
    "condition": format_condition,
    "item": format_item,
    "rule": format_rule,
}


def coerce_entries(kind: str, data) -> list[dict]:
    if kind == "pokemon":
        return list(data)
    return list(data.values())


def main():
    parser = argparse.ArgumentParser(description="Lookup PTU cache entries")
    parser.add_argument("kind", choices=sorted(BUILDERS.keys()))
    parser.add_argument("query", nargs="+", help="Name to look up")
    args = parser.parse_args()

    kind = args.kind
    query = " ".join(args.query).strip()
    data = load_or_build(kind)
    entries = coerce_entries(kind, data)

    match, suggestions = find_match(query, entries, kind)
    if not match:
        print(f"No unique {kind} match for '{query}'.", file=sys.stderr)
        if suggestions:
            print("Closest matches:", file=sys.stderr)
            for suggestion in suggestions[:8]:
                print(f"  - {primary_name(suggestion, kind)}", file=sys.stderr)
        sys.exit(1)

    print(FORMATTERS[kind](match))


if __name__ == "__main__":
    main()
