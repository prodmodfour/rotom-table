#!/usr/bin/env python3
"""Build a searchable PTU rules index into a JSON cache."""

import json
import os
import re
import sys

REPO_ROOT = os.path.join(os.path.dirname(__file__), "..")
BOOKS_DIR = os.path.join(REPO_ROOT, "books", "markdown")
CORE_DIR = os.path.join(BOOKS_DIR, "core")
HOUSE_RULES_DIR = os.path.join(REPO_ROOT, "house_rules")
CACHE_DIR = os.path.join(os.path.dirname(__file__), "data")

RULE_SPECS = [
    {
        "name": "Player Turns",
        "path": os.path.join(HOUSE_RULES_DIR, "player_turns.md"),
        "whole_file": True,
        "category": "House Rule",
        "aliases": ["Full Contact Battles", "player turns house rule"],
    },
    {
        "name": "3-TM/Tutor Move Limit",
        "path": os.path.join(CORE_DIR, "05-pokemon.md"),
        "start": "However, no more \nthan 3 of a Pokémon’s Moves may be from TMs and \nMove Tutors",
        "end": "Unlike Pokémon, Trainers have no limit to the number",
        "category": "Pokémon Rule",
        "aliases": ["TM Limit", "Tutor Move Limit", "TM/Tutor Limit"],
    },
    {
        "name": "Tutor Points",
        "path": os.path.join(CORE_DIR, "05-pokemon.md"),
        "start": "Tutor Points",
        "end": "Evolution",
        "trim_heading": True,
        "category": "Pokémon Rule",
        "aliases": ["TP", "Pokemon Tutor Points"],
    },
    {
        "name": "Loyalty",
        "path": os.path.join(CORE_DIR, "05-pokemon.md"),
        "start": "A Trainer’s Pokémon does not exist in a vacuum.",
        "end": "Breeding Pokémon",
        "category": "Pokémon Rule",
        "aliases": ["Pokemon Loyalty", "Changing Loyalty"],
    },
    {
        "name": "Capture Rate",
        "path": os.path.join(CORE_DIR, "05-pokemon.md"),
        "start": "Calculating Capture Rates",
        "end": "## Page 215",
        "trim_heading": True,
        "category": "Capture Rule",
        "aliases": ["Capture Rates", "Calculating Capture Rates", "Capture Roll"],
    },
    {
        "name": "Basic Capabilities",
        "path": os.path.join(CORE_DIR, "06-playing-the-game.md"),
        "start": "Basic Capabilities",
        "end": "Jumping Capabilities",
        "trim_heading": True,
        "category": "General Rule",
        "aliases": ["Capabilities"],
    },
    {
        "name": "Power",
        "path": os.path.join(CORE_DIR, "06-playing-the-game.md"),
        "start": "Power",
        "end": "## Page 223",
        "trim_heading": True,
        "category": "General Rule",
        "aliases": ["Heavy Lifting", "Drag Weight", "Staggering Weight"],
    },
    {
        "name": "Jumping Capabilities",
        "path": os.path.join(CORE_DIR, "06-playing-the-game.md"),
        "start": "Jumping Capabilities",
        "end": "Movement Capabilities",
        "trim_heading": True,
        "category": "General Rule",
        "aliases": ["Jump", "Long Jump", "High Jump"],
    },
    {
        "name": "Movement Capabilities",
        "path": os.path.join(CORE_DIR, "06-playing-the-game.md"),
        "start": "Movement Capabilities",
        "end": "Throwing Range",
        "trim_heading": True,
        "category": "General Rule",
        "aliases": ["Overland", "Swim", "Sky", "Burrow", "Levitate", "Teleporter"],
    },
    {
        "name": "Throwing Range",
        "path": os.path.join(CORE_DIR, "06-playing-the-game.md"),
        "start": "Throwing Range",
        "end": "## Page 224",
        "trim_heading": True,
        "category": "General Rule",
        "aliases": ["Poké Ball Throwing Range", "Poke Ball Throwing Range"],
    },
    {
        "name": "Pokémon Switching",
        "path": os.path.join(CORE_DIR, "07-combat.md"),
        "start": "Pokémon Switching",
        "end": "## Page 231",
        "trim_heading": True,
        "category": "Combat Rule",
        "aliases": ["Switching"],
    },
    {
        "name": "Combat Stages",
        "path": os.path.join(CORE_DIR, "07-combat.md"),
        "start": "Combat Stages",
        "end": "## Page 237",
        "trim_heading": True,
        "category": "Combat Rule",
        "aliases": ["CS", "Accuracy Combat Stages", "Evasion Combat Stages"],
    },
    {
        "name": "Tick of Hit Points",
        "path": os.path.join(CORE_DIR, "07-combat.md"),
        "start": "Tick of Hit Points: Some effects use this term.",
        "end": "Damage Formula",
        "category": "Combat Rule",
        "aliases": ["Tick", "HP Tick", "Tick Value"],
    },
    {
        "name": "Type Effectiveness",
        "path": os.path.join(CORE_DIR, "07-combat.md"),
        "start": "Type Effectiveness",
        "end": "## Page 240",
        "trim_heading": True,
        "category": "Combat Rule",
        "aliases": ["Type Chart"],
    },
    {
        "name": "Struggle Attacks",
        "path": os.path.join(CORE_DIR, "07-combat.md"),
        "start": "Struggle Attacks",
        "end": "Combat Maneuvers",
        "trim_heading": True,
        "category": "Combat Rule",
        "aliases": ["Struggle"],
    },
    {
        "name": "Combat Maneuvers",
        "path": os.path.join(CORE_DIR, "07-combat.md"),
        "start": "Combat Maneuvers",
        "end": "Maneuver: Push",
        "trim_heading": True,
        "category": "Combat Rule",
        "aliases": ["Maneuvers"],
    },
    {
        "name": "Push",
        "path": os.path.join(CORE_DIR, "07-combat.md"),
        "start": "Maneuver: Push",
        "end": "Maneuver: Sprint",
        "trim_heading": True,
        "category": "Combat Maneuver",
        "aliases": ["Push Maneuver"],
    },
    {
        "name": "Sprint",
        "path": os.path.join(CORE_DIR, "07-combat.md"),
        "start": "Maneuver: Sprint",
        "end": "Maneuver: Trip",
        "trim_heading": True,
        "category": "Combat Maneuver",
        "aliases": ["Sprint Maneuver"],
    },
    {
        "name": "Trip",
        "path": os.path.join(CORE_DIR, "07-combat.md"),
        "start": "Maneuver: Trip",
        "end": "Maneuver: Intercept Melee",
        "trim_heading": True,
        "category": "Combat Maneuver",
        "aliases": ["Trip Maneuver"],
    },
    {
        "name": "Intercept Melee",
        "path": os.path.join(CORE_DIR, "07-combat.md"),
        "start": "Maneuver: Intercept Melee",
        "end": "## Page 244",
        "trim_heading": True,
        "category": "Combat Maneuver",
        "aliases": ["Intercept"],
    },
    {
        "name": "Grapple",
        "path": os.path.join(CORE_DIR, "07-combat.md"),
        "start": "Maneuver: Grapple",
        "end": "## Page 246",
        "trim_heading": True,
        "category": "Combat Maneuver",
        "aliases": ["Grapple Maneuver"],
    },
    {
        "name": "Status Afflictions",
        "path": os.path.join(CORE_DIR, "07-combat.md"),
        "start": "Status Afflictions",
        "end": "Persistent Afflictions",
        "trim_heading": True,
        "category": "Combat Rule",
        "aliases": ["Status Conditions"],
    },
    {
        "name": "Persistent Afflictions",
        "path": os.path.join(CORE_DIR, "07-combat.md"),
        "start": "Persistent Afflictions",
        "end": "## Page 247",
        "trim_heading": True,
        "category": "Combat Rule",
        "aliases": ["Persistent Conditions"],
    },
    {
        "name": "Volatile Afflictions",
        "path": os.path.join(CORE_DIR, "07-combat.md"),
        "start": "Volatile Afflictions",
        "end": "## Page 248",
        "trim_heading": True,
        "category": "Combat Rule",
        "aliases": ["Volatile Conditions"],
    },
    {
        "name": "Other Afflictions",
        "path": os.path.join(CORE_DIR, "07-combat.md"),
        "start": "Other Afflictions",
        "end": "## Page 249",
        "trim_heading": True,
        "category": "Combat Rule",
        "aliases": ["Other Conditions"],
    },
    {
        "name": "Resting",
        "path": os.path.join(CORE_DIR, "07-combat.md"),
        "start": "Resting\nSleep and extended rests can help restore the Hit Points",
        "end": "Extended Rests are rests that are at least 4 continuous",
        "trim_heading": True,
        "category": "Recovery Rule",
        "aliases": ["Natural Healing", "Rest"],
    },
    {
        "name": "Extended Rests",
        "path": os.path.join(CORE_DIR, "07-combat.md"),
        "start": "Extended Rests are rests that are at least 4 continuous",
        "end": "Pokémon Centers",
        "category": "Recovery Rule",
        "aliases": ["Extended Rest", "Pokemon Centers"],
    },
    {
        "name": "Poké Balls",
        "path": os.path.join(CORE_DIR, "09-gear-and-items.md"),
        "start": "Poké Balls",
        "end": "Pokédex",
        "trim_heading": True,
        "category": "Item Rule",
        "aliases": ["Throwing Poké Balls", "Capture Roll", "Poke Balls", "Throwing Poke Balls"],
    },
    {
        "name": "Using Items",
        "path": os.path.join(CORE_DIR, "09-gear-and-items.md"),
        "start": "Using Items",
        "end": "Basic Restoratives",
        "trim_heading": True,
        "category": "Item Rule",
        "aliases": ["Item Use", "Applying Items"],
    },
    {
        "name": "TMs and HMs",
        "path": os.path.join(CORE_DIR, "09-gear-and-items.md"),
        "start": "TMs and HMs",
        "end": "TM Chart",
        "trim_heading": True,
        "category": "Item Rule",
        "aliases": ["Technical Machines", "Hidden Machines", "TM", "HM"],
    },
]


def _normalize_key(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", text.lower())


def _clean_rule_text(text: str, heading_to_trim: str | None = None) -> str:
    text = text.replace("\u00ad", "")
    text = re.sub(r"(\w)-\s*\n\s*(\w)", r"\1\2", text)
    text = re.sub(r"(?m)^## Page .*?$", "", text)
    text = re.sub(r"(?m)^(Pokémon|Playing the Game|Combat|Gear and Items|Indices and Reference)\s*$", "", text)
    text = re.sub(r"(?m)^\d+\s*$", "", text)
    text = text.strip()
    if heading_to_trim:
        lines = [line.rstrip() for line in text.splitlines()]
        while lines and not lines[0].strip():
            lines.pop(0)
        if lines and _normalize_key(lines[0]) == _normalize_key(heading_to_trim):
            lines.pop(0)
        text = "\n".join(lines).strip()
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _extract_text(spec: dict) -> str:
    with open(spec["path"], "r", encoding="utf-8") as file:
        text = file.read()

    if spec.get("whole_file"):
        chunk = text
    else:
        start_index = text.index(spec["start"])
        chunk = text[start_index:]
        if spec.get("end"):
            end_index = chunk.index(spec["end"])
            chunk = chunk[:end_index]

    return _clean_rule_text(chunk, spec["name"] if spec.get("trim_heading") else None)


def parse_rules(verbose: bool = False) -> dict[str, dict]:
    rules: dict[str, dict] = {}

    for spec in RULE_SPECS:
        path = spec["path"]
        if not os.path.exists(path):
            continue
        text = _extract_text(spec)
        if not text:
            continue
        name = spec["name"]
        if name in rules:
            if verbose:
                print(f"  [shadowed] {name}: skipped lower-priority duplicate from {path}")
            continue
        rules[name] = {
            "name": name,
            "category": spec.get("category", "Rule"),
            "text": text,
            "aliases": spec.get("aliases", []),
            "source": os.path.relpath(path, REPO_ROOT),
        }
        if verbose:
            print(f"  + {name} ← {path}")

    return rules


def build_cache(verbose: bool = False):
    os.makedirs(CACHE_DIR, exist_ok=True)
    print("Parsing rules (house rules → official reference order)...")
    rules = parse_rules(verbose=verbose)
    out_path = os.path.join(CACHE_DIR, "rules.json")
    with open(out_path, "w", encoding="utf-8") as file:
        json.dump(rules, file, indent=2, ensure_ascii=False)
    print(f"Wrote {len(rules)} rules to {out_path}")
    return rules


if __name__ == "__main__":
    build_cache(verbose="--verbose" in sys.argv or "-v" in sys.argv)
