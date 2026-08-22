#!/usr/bin/env python3
"""Generate reviewed equipment compatibility definitions.

The generator never parses effect prose. Slot exceptions, handedness, owner
restrictions, prerequisites, configuration, and exclusivity below are an
explicit reviewed adjudication bound to exact app-owned item record hashes.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
ITEMS_PATH = ROOT / "data/reference/items.json"
OUTPUT_PATH = ROOT / "data/complete-play-loop/equipment-definitions.v1.json"
CATALOG_SHA256 = "842256900ab540c7cdb22c1663d8bb7c89966b8d225cff1a1c5f175ae1e915ef"
EQUIPMENT_CATEGORIES = {
    "Held Item", "Weapon", "Hand Equipment", "Head Equipment",
    "Body Equipment", "Feet Equipment", "Accessory Item",
}

TWO_HANDED_WEAPONS = {
    "Baseball Bat", "Slingshot", "Quarterstaff", "Hunting Bow",
    "Meteor Masher", "Twin-Needled Bow",
}
TWO_HANDED_HAND_EQUIPMENT = {
    "Old Rod", "Good Rod", "Super Rod", "Glue Cannon", "Hand Net",
    "Weighted Nets", "Wonder Launcher",
}
SHIELDS = {"Light Shield", "Heavy Shield"}

TRAINER_HELD_SLOT_OPTIONS: dict[str, list[list[str]]] = {
    "Expert Belt": [["accessory"]],
    "Flame Orb": [["offHand"]],
    "Focus Band": [["accessory"]],
    "Focus Sash": [["accessory"]],
    "Go-Goggles": [["head"]],
    "Iron Ball": [["mainHand"], ["offHand"]],
    "King’s Rock": [["head"]],
    "Life Orb": [["offHand"]],
    "Quick Claw": [["accessory"]],
    "Razor Fang": [["accessory"]],
    "Safety Goggles": [["head"], ["accessory"]],
    "Shell Bell": [["accessory"]],
    "Shock Collar": [["accessory"]],
    "Stat Boosters": [["accessory"]],
    "Toxic Orb": [["offHand"]],
    "Winter Cloak": [["accessory"]],
    "Type Gem": [["offHand"], ["accessory"]],
    "Type Plate": [["accessory"]],
}

POKEMON_TYPES = [
    "Bug", "Dark", "Dragon", "Electric", "Fairy", "Fighting", "Fire",
    "Flying", "Ghost", "Grass", "Ground", "Ice", "Normal", "Poison",
    "Psychic", "Rock", "Steel", "Water",
]
STAT_IDS = ["hp", "atk", "def", "satk", "sdef", "spd"]
BATTLE_STAT_IDS = ["atk", "def", "satk", "sdef", "spd"]
CONTEST_STAT_IDS = ["beauty", "cool", "cute", "smart", "tough"]


def stable_json(value: Any) -> str:
    if isinstance(value, dict):
        return "{" + ",".join(
            json.dumps(key, ensure_ascii=False, separators=(",", ":")) + ":" + stable_json(value[key])
            for key in sorted(value)
        ) + "}"
    if isinstance(value, list):
        return "[" + ",".join(stable_json(entry) for entry in value) + "]"
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def owner_rule(owner_kind: str, slot_options: list[list[str]]) -> dict[str, Any]:
    return {"ownerKind": owner_kind, "slotOptions": slot_options}


def configuration(configuration_id: str, fields: list[dict[str, Any]]) -> dict[str, Any]:
    return {"configurationId": configuration_id, "fields": fields}


def enum_field(key: str, values: list[str], *, count: int | None = None) -> dict[str, Any]:
    if count is None:
        return {"key": key, "kind": "enum", "required": True, "values": values}
    return {
        "key": key, "kind": "distinct-enum-array", "required": True,
        "values": values, "count": count,
    }


def equipment_configuration(canonical_id: str) -> dict[str, Any] | None:
    if canonical_id == "Focus":
        return configuration("equipment.focus.v1", [enum_field("statId", STAT_IDS)])
    if canonical_id == "Fancy Clothes":
        return configuration("equipment.fancy-clothes.v1", [enum_field("contestStatId", CONTEST_STAT_IDS)])
    if canonical_id == "Choice Item":
        return configuration("equipment.choice-item.v1", [enum_field("statId", BATTLE_STAT_IDS)])
    if canonical_id == "Contest Fashion":
        return configuration("equipment.contest-fashion.v1", [enum_field("contestStatId", CONTEST_STAT_IDS)])
    if canonical_id == "Lagging Item":
        return configuration("equipment.lagging-item.v1", [enum_field("statId", BATTLE_STAT_IDS)])
    if canonical_id == "Stat Boosters":
        return configuration("equipment.stat-boosters.v1", [
            enum_field("statId", ["atk", "def", "satk", "sdef", "spd", "evasion", "accuracy"]),
        ])
    if canonical_id == "Eviolite":
        return configuration("equipment.eviolite.v1", [
            {"key": "familyAnchorSpeciesId", "kind": "evolution-family-anchor", "required": True},
            enum_field("boostedStatIds", STAT_IDS, count=2),
        ])
    if canonical_id == "Mega Stone":
        return configuration("equipment.mega-stone.v1", [
            {"key": "baseSpeciesId", "kind": "owner-species", "required": True},
            {"key": "megaFormSpeciesId", "kind": "canonical-mega-form", "required": True},
        ])
    if canonical_id in {"Type Gem", "Type Plate"}:
        return configuration(f"equipment.{canonical_id.lower().replace(' ', '-')}.v1", [
            enum_field("typeId", POKEMON_TYPES),
        ])
    if canonical_id == "Hand Net":
        return configuration("equipment.hand-net.v1", [
            {"key": "durabilityMaximum", "kind": "integer-enum", "required": True, "values": [50, 100, 200]},
        ])
    if canonical_id == "Weighted Nets":
        return configuration("equipment.weighted-nets.v1", [
            {"key": "durabilityMaximum", "kind": "integer-enum", "required": True, "values": [50, 80, 150]},
        ])
    return None


def trainer_held_options(canonical_id: str) -> list[list[str]] | None:
    if canonical_id.endswith(" Type Booster") or canonical_id.endswith(" Type Brace"):
        return [["accessory"]]
    return TRAINER_HELD_SLOT_OPTIONS.get(canonical_id)


def rules_for(canonical_id: str, categories: set[str]) -> list[dict[str, Any]]:
    if "Weapon" in categories:
        trainer_options = [["mainHand", "offHand"]] if canonical_id in TWO_HANDED_WEAPONS else [["mainHand"], ["offHand"]]
        return [
            owner_rule("trainer", trainer_options),
            owner_rule("pokemon", [["held"]]),
        ]
    if "Hand Equipment" in categories:
        if canonical_id in TWO_HANDED_HAND_EQUIPMENT:
            return [owner_rule("trainer", [["mainHand", "offHand"]])]
        if canonical_id in SHIELDS:
            return [owner_rule("trainer", [["offHand"], ["mainHand", "offHand"]])]
        return [owner_rule("trainer", [["mainHand"], ["offHand"]])]
    if canonical_id == "Focus":
        return [owner_rule("trainer", [["mainHand"], ["offHand"], ["head"], ["accessory"]])]
    rules: list[dict[str, Any]] = []
    if "Body Equipment" in categories:
        rules.append(owner_rule("trainer", [["body"]]))
    if "Head Equipment" in categories:
        rules.append(owner_rule("trainer", [["head"]]))
    if "Feet Equipment" in categories:
        rules.append(owner_rule("trainer", [["feet"]]))
    if "Accessory Item" in categories:
        rules.append(owner_rule("trainer", [["accessory"]]))
    if "Held Item" in categories:
        rules.append(owner_rule("pokemon", [["held"]]))
        trainer_options = trainer_held_options(canonical_id)
        if trainer_options:
            rules.append(owner_rule("trainer", trainer_options))
    if canonical_id == "Re-Breather":
        rules.append(owner_rule("pokemon", [["held"]]))
    return rules


def prerequisites_for(canonical_id: str, categories: set[str]) -> list[dict[str, Any]]:
    prerequisites: list[dict[str, Any]] = []
    if "Weapon" in categories:
        prerequisites.append({
            "kind": "capability", "ownerKind": "pokemon", "canonicalId": "Wielder",
        })
    if canonical_id == "Wonder Launcher":
        prerequisites.append({
            "kind": "trainer-skill-any", "ownerKind": "trainer",
            "skillIds": ["medicineEd", "techEd"], "minimumRankValue": 5,
        })
    if canonical_id == "Eviolite":
        prerequisites.append({"kind": "pokemon-not-fully-evolved", "ownerKind": "pokemon"})
    species_restrictions = {
        "Metal Powder": ["Ditto"],
        "Rare Leek": ["Farfetch’d"],
        "Thick Club": ["Cubone", "Marowak"],
    }
    if canonical_id in species_restrictions:
        prerequisites.append({
            "kind": "pokemon-species", "ownerKind": "pokemon",
            "speciesIds": species_restrictions[canonical_id],
        })
    return prerequisites


def definition_for(canonical_id: str, item: dict[str, Any]) -> dict[str, Any]:
    categories = set(item.get("categories", []))
    exclusivity = ["focus"] if canonical_id == "Focus" else []
    return {
        "canonicalItemId": canonical_id,
        "canonicalRecordSha256": sha256_text(stable_json(item)),
        "ownerRules": rules_for(canonical_id, categories),
        "prerequisites": prerequisites_for(canonical_id, categories),
        "exclusivityFamilies": exclusivity,
        "configuration": equipment_configuration(canonical_id),
    }


def build_document() -> dict[str, Any]:
    raw = ITEMS_PATH.read_bytes()
    if hashlib.sha256(raw).hexdigest() != CATALOG_SHA256:
        raise RuntimeError("Canonical item catalog hash changed; review equipment definitions before regeneration")
    items: dict[str, dict[str, Any]] = json.loads(raw)
    definitions = [
        definition_for(canonical_id, item)
        for canonical_id, item in items.items()
        if EQUIPMENT_CATEGORIES.intersection(item.get("categories", []))
    ]
    for definition in definitions:
        if not definition["ownerRules"]:
            raise RuntimeError(f"Equipment definition {definition['canonicalItemId']} has no owner rule")
    return {
        "schemaVersion": 1,
        "ticket": "P8-043",
        "catalogSha256": CATALOG_SHA256,
        "definitionCount": len(definitions),
        "classificationPolicy": {
            "status": "reviewed",
            "runtimeProseParsing": False,
            "definitionSource": "explicit adjudications in scripts/generate_complete_play_loop_equipment_definitions.py",
            "unknownOrStalePolicy": "fail-closed-no-equip",
        },
        "slotPolicy": {
            "wholeItemMayOccupyMultipleSlots": True,
            "twoHandedSlots": ["mainHand", "offHand"],
            "pokemonHeldSlot": "held",
            "occupiedSlotConflict": "reject-before-inventory-movement",
        },
        "definitions": definitions,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    rendered = json.dumps(build_document(), ensure_ascii=False, indent=2) + "\n"
    if args.check:
        if not OUTPUT_PATH.exists() or OUTPUT_PATH.read_text(encoding="utf-8") != rendered:
            raise SystemExit("equipment-definitions.v1.json is stale; regenerate it")
        return
    OUTPUT_PATH.write_text(rendered, encoding="utf-8")


if __name__ == "__main__":
    main()
