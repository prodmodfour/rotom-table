#!/usr/bin/env python3
"""One-way reviewed repair for the app-owned PTU Feature reference.

The source guard intentionally accepts only the parser baseline or the exact
migrated result. Documentary markdown explains the reviewed corrections, but
runtime code never reads it.
"""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
FEATURES = ROOT / "data/reference/features.json"
BASELINE_SHA256 = "773cf202aad47548948a910c0a0059f456afaa2b090108721d6d531dea2a3397"
PREVIOUS_MIGRATION_SHA256 = {"307f30f73d11e68f89bf31798a38367e1a29ce7ffe17b303767900d4cde07133"}

REPAIRS: dict[str, dict[str, Any]] = {
    "Field Clinic": {
        "effect": "When the party Sets Up Camp, spend $200 of Medical Scrap to establish a Field Clinic. Members may spend $300 of Medical Scrap to create and apply a Bandage or use a First Aid Kit; Nurse may be activated for $300 without Draining AP; and listed Restoratives used there heal 5 additional Hit Points.",
    },
    "Mixed Power": {
        "prerequisites": "Level 10; at least 5 Level-Up Stat Points invested in both Attack and Special Attack",
        "cost": "2 Tutor Points",
        "effect": "The user gains the Twisted Power Ability.",
    },
    "Incandescence": {
        "effect": "While this Feature is Bound, the target gains the Mixed Power Poké Edge effect when using damaging Fire-Type attacks. If it already has Mixed Power, it adds its entire Attack and Special Attack Stats instead of one or the other. This does not stack with Twisted Power.",
    },
    "Captured Momentum": {
        "trigger": "You successfully Capture a Pokémon",
        "effect": "Choose one: you or your Pokémon gains +2 to its next Accuracy Roll during this combat; subtract your highest Acrobatics, Athletics, Stealth, Survival, Guile, or Perception Rank from your next Capture Roll during this combat; or gain 1 Temporary AP that expires after one full round.",
    },
    "Encore Performance": {
        "trigger": "Your Pokémon uses a Status-Class Move that does not target foes.",
        "effect": "Choose one: the Pokémon gains +1 Combat Stage in a Stat it has not raised this turn; gains a second Standard Action this round limited to an At-Will action that cannot trigger Encore Performance; places two additional Hazard units; extends triggering Weather by two turns; or gives the triggering Blessing one additional use.",
    },
    "Stat Ace": {
        "tags": ["Class", "Branch"],
        "prerequisites": "Ace Trainer or Style Expert; either 1 Pokémon with the chosen Stat at 15 or more, or 3 Pokémon with it at 20 or more; Novice Command or Focus",
        "frequency": "Static",
        "effect": "Your Pokémon have their Chosen Base Stat increased by +1, and by +1 more for every 10 Levels they have. They may ignore Base Relations while adding to that Stat and need not correct Stats due to this increase.",
    },
    "Style Flourish": {
        "trigger": "Your Pokémon uses a Move of your Chosen Type.",
        "effect": "Contest: re-roll all dice that result in 1, once per Contest. Battle: after the Move resolves, the target gains +1 Combat Stage in the Stat corresponding to your chosen Contest Type; a target can be affected only once per Scene.",
    },
    "Fabulous Max": {
        "trigger": "Your Pokémon uses a Beauty-Type Move.",
        "effect": "Contest: improve the Move's Contest alignment by one step, once per Contest. Battle: a Melee Move gains Burst 1, a ranged Move gains Blast 2, or an existing Burst, Blast, or Cone increases its size by 1; once per Pokémon per Scene.",
    },
    "Style Expert": {
        "tags": ["Class", "Branch"],
        "prerequisites": "Either 3 Pokémon with 3d6 in the chosen Contest Stat from Poffins, or Coordinator and 1 such Pokémon",
        "frequency": "Static",
        "effect": "Your Pokémon gain +2d6 to your chosen Contest Stat, counted as dice from Poffins.",
    },
    "Rule of Cool": {
        "trigger": "Your Pokémon uses a Cool-Type Move.",
        "effect": "Contest: improve the Move's Contest alignment by one step, once per Contest. Battle: increase the triggering Move's critical range by 3 and prevent Interrupt-keyword Moves from being activated in reaction; once per Pokémon per Scene.",
    },
    "Gleeful Steps": {
        "trigger": "Your Pokémon uses a Cute-Type Move.",
        "effect": "Contest: improve the Move's Contest alignment by one step, once per Contest. Battle: after the attack resolves, the triggering Pokémon may Shift up to half its Movement speed; once per Pokémon per Scene.",
    },
    "Calculated Assault": {
        "trigger": "Your Pokémon uses a Smart-Type Move.",
        "effect": "Contest: improve the Move's Contest alignment by one step, once per Contest. Battle: either the triggering Pokémon gains +1 Accuracy per ally that hit one of its targets this round, or allies gain +1 Accuracy against its targets until the end of its next turn; once per Pokémon per Scene.",
    },
    "Macho Charge": {
        "trigger": "Your Pokémon uses a Tough-Type Move.",
        "effect": "Contest: improve the Move's Contest alignment by one step, once per Contest. Battle: push all targets hit by the Move 3 meters away from the triggering Pokémon; once per Pokémon per Scene.",
    },
    "Type Ace": {
        "tags": ["Class", "Branch"],
        "prerequisites": "Either 2 different Pokémon of the Chosen Type, or Elemental Connection and 1 Pokémon of that Type; Novice Type-Linked Skill",
        "frequency": "At-Will – Extended Action",
        "target": "Your Pokémon with at least 2 Tutor Points remaining.",
        "effect": "The target loses 2 Tutor Points and learns the Last Chance or Type Strategist Ability for your Chosen Type. A Pokémon may be targeted only once by Type Ace.",
    },
    "Apothecary": {
        "frequency": "At-Will – Extended Action",
        "effect": "You may use any Apothecary Recipe for which you qualify.",
    },
    "Crystal Artificer": {
        "frequency": "At-Will – Extended Action",
        "effect": "You may use any Crystal Artificer Recipe for which you qualify.",
    },
    "Rainbow Light": {
        "condition": "You are wearing a Rainbow Gem.",
        "effect": "Create a Rainbow lasting one full round. While it persists, all Allies increase their Effect Range by 3.",
    },
    "Type Booster": {
        "prerequisites": "Crystal Artificer",
        "ingredients": "4 Shards of the same color",
        "effect": "Create a Type Booster of a Type associated with the Shards' color.",
    },
    "Type Brace": {
        "prerequisites": "Crystal Artificer",
        "ingredients": "4 Shards of the same color",
        "effect": "Create a Type Brace of a Type associated with the Shards' color.",
    },
    "Plate Crafter": {
        "prerequisites": "Rainbow Light, Expert Occult Education",
        "ingredients": "A Type Booster and Type Brace of the same Type",
        "effect": "Create a Type Plate matching the Type Booster and Type Brace used.",
    },
    "Power Conduit": {
        "target": "Channeled Pokémon",
        "effect": "Choose one: trade all Combat Stages for one Stat between two Channeled Pokémon; transfer a Coat between them; or give up one willing Channeled Pokémon's Scene or Daily Move use to refresh another's used Scene Move, once per Pokémon per Scene.",
    },
    "Farcast": {
        "trigger": "You use Teleport or activate the Teleporter Capability.",
        "effect": "Choose one: use Teleporter at three times its normal value, or bring one willing touching Pokémon or Trainer. Spend two uses to choose both.",
    },
}

CLASS_REPAIRS: dict[str, str | None] = {
    "Medic": "Medic",
    "Front Line Healer": "Medic",
    "Medical Techniques": "Medic",
    "I’m a Doctor": "Medic",
    "Proper Care": "Medic",
    "Stay With Us!": "Medic",
    "Field Clinic": None,
    "Nurse": None,
    "Affliction Techniques": "Researcher",
    "Gotta Catch ‘Em All": "Capture Specialist",
    "Mixed Power": None,
    "Incandescence": "Type Ace",
}

# Parser-overrun section labels retained no mechanical text.
EFFECT_SUFFIXES = (
    " Beauty Expert Features", " Cool Expert Features", " Cute Expert Features",
    " Smart Expert Features", " Tough Expert Features", " Dark Ace Features",
    " Electric Ace Features", " Fighting Ace Features", " Flying Ace Features",
    " Grass Ace Features", " Ice Ace Features", " Poison Ace Features",
    " Psychic Ace Features", " Rock Ace Features", " Water Ace Features",
    " Chef Recipes", " Fashionista Recipes", " Apothecary Research Field",
    " Artificer Recipes", " Chemistry Recipes", " Occultism Research Field",
)


def digest(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def migrate(rows: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    if len(rows) != 444:
        raise RuntimeError(f"Expected the reviewed 444-row baseline, found {len(rows)}")
    result = json.loads(json.dumps(rows, ensure_ascii=False))

    for name, patch in REPAIRS.items():
        if name not in result:
            raise RuntimeError(f"Missing reviewed Feature repair target: {name}")
        result[name].update(patch)

    # Recover structured recipe metadata that the documentary parser appended
    # to prerequisite or frequency text.
    for row in result.values():
        prerequisites = row.get("prerequisites") or ""
        split = re.match(r"^(.*?)(?:\s+(Cost|Ingredients?):\s*(.+))$", prerequisites)
        if split:
            row["prerequisites"] = split.group(1).strip()
            row["cost" if split.group(2) == "Cost" else "ingredients"] = split.group(3).strip()

        frequency = row.get("frequency") or ""
        split_frequency = re.match(r"^(.*?Action)\s+(Ingredients?|Effects?):\s*(.+)$", frequency)
        if split_frequency:
            row["frequency"] = split_frequency.group(1).strip()
            key = "ingredients" if split_frequency.group(2).startswith("Ingredient") else "effect"
            if key == "effect" and row.get("effect"):
                row[key] = f"{split_frequency.group(3).strip()} {row[key]}"
            else:
                row[key] = split_frequency.group(3).strip()

        effect = row.get("effect") or ""
        for suffix in EFFECT_SUFFIXES:
            if effect.endswith(suffix):
                row["effect"] = effect[:-len(suffix)].rstrip(" .") + "."
                break

    # Dumplings has two individually labelled ingredients rather than one
    # ordinary Ingredients line.
    result["Dumplings"].update({
        "frequency": "At-Will – Extended Action",
        "ingredients": [
            "Leftovers, Preserves, or a Snack made with Chef",
            "Leftovers or Preserves",
        ],
    })

    for name, class_name in CLASS_REPAIRS.items():
        if class_name is None:
            result[name].pop("className", None)
        else:
            result[name]["className"] = class_name
    result["Medic"]["tags"] = ["Class"]

    for name, row in result.items():
        row["name"] = name
        if row.get("effect") is None:
            raise RuntimeError(f"Reviewed migration left a null effect: {name}")
    return result


def main() -> None:
    raw = FEATURES.read_bytes()
    before = digest(raw)
    rows = json.loads(raw)
    migrated = migrate(rows)
    rendered = (json.dumps(migrated, ensure_ascii=False, indent=2) + "\n").encode()
    after = digest(rendered)
    if before not in {BASELINE_SHA256, after, *PREVIOUS_MIGRATION_SHA256}:
        raise RuntimeError(f"Unexpected Feature reference SHA-256: {before}")
    FEATURES.write_bytes(rendered)
    print(f"Features: {len(migrated)} ({after})")


if __name__ == "__main__":
    main()
