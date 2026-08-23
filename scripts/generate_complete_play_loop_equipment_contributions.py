#!/usr/bin/env python3
"""Generate reviewed equipment-derived contribution definitions.

This generator never parses effect prose. Every contribution, condition, cap,
and deferred ownership below is an explicit adjudication bound to exact
app-owned item and equipment-definition hashes.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
ITEMS_PATH = ROOT / "data/reference/items.json"
EQUIPMENT_PATH = ROOT / "data/complete-play-loop/equipment-definitions.v1.json"
GRANTS_PATH = ROOT / "data/complete-play-loop/equipment-grants.v1.json"
OUTPUT_PATH = ROOT / "data/complete-play-loop/equipment-contributions.v1.json"
CATALOG_SHA256 = "842256900ab540c7cdb22c1663d8bb7c89966b8d225cff1a1c5f175ae1e915ef"
EQUIPMENT_CATEGORIES = {
    "Held Item", "Weapon", "Hand Equipment", "Head Equipment",
    "Body Equipment", "Feet Equipment", "Accessory Item",
}
POKEMON_TYPES = [
    "Bug", "Dark", "Dragon", "Electric", "Fairy", "Fighting", "Fire",
    "Flying", "Ghost", "Grass", "Ground", "Ice", "Normal", "Poison",
    "Psychic", "Rock", "Steel", "Water",
]


def stable_json(value: Any) -> str:
    if isinstance(value, dict):
        return "{" + ",".join(
            json.dumps(key, ensure_ascii=False, separators=(",", ":")) + ":" + stable_json(value[key])
            for key in sorted(value)
        ) + "}"
    if isinstance(value, list):
        return "[" + ",".join(stable_json(entry) for entry in value) + "]"
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def sha256(value: Any) -> str:
    return hashlib.sha256(stable_json(value).encode("utf-8")).hexdigest()


def fixed(*ids: str) -> dict[str, Any]:
    return {"kind": "fixed", "ids": list(ids)}


def configured(field: str, *, array: bool = False) -> dict[str, Any]:
    return {"kind": "configuration-array" if array else "configuration", "field": field}


def predicate(kind: str, **values: Any) -> dict[str, Any]:
    return {"kind": kind, **values}


def contribution(
    contribution_id: str,
    metric: str,
    target: dict[str, Any],
    operation: str,
    value: float,
    *,
    cap: float | None = None,
    predicates: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    return {
        "contributionId": contribution_id,
        "metric": metric,
        "target": target,
        "operation": operation,
        "value": value,
        "cap": cap,
        "predicates": predicates or [],
    }


CONTRIBUTIONS: dict[str, list[dict[str, Any]]] = {
    "Light Armor": [contribution("equipment.light-armor.damage-reduction", "damage-reduction", fixed("all"), "add", 5)],
    "Heavy Armor": [
        contribution("equipment.heavy-armor.damage-reduction", "damage-reduction", fixed("all"), "add", 10),
        contribution("equipment.heavy-armor.speed-default-stage", "combat-stage-default", fixed("spd"), "set", -1),
    ],
    "Stealth Clothes": [contribution("equipment.stealth-clothes.stealth", "skill-check-modifier", fixed("stealth"), "add", 4, cap=4)],
    "Sunglasses": [contribution("equipment.sunglasses.social-skills", "skill-check-modifier", fixed("charm", "guile", "intimidate"), "add", 1, cap=3)],
    "Snow Boots": [contribution(
        "equipment.snow-boots.overland", "capability-value", fixed("overland"), "add", -1,
        predicates=[predicate("environment", environmentId="ice-or-deep-snow")],
    )],
    "Running Shoes": [
        contribution("equipment.running-shoes.athletics", "skill-check-modifier", fixed("athletics"), "add", 2, cap=3),
        contribution("equipment.running-shoes.overland", "capability-value", fixed("overland"), "add", 1),
    ],
    "Flippers": [
        contribution(
            "equipment.flippers.swim", "capability-value", fixed("swim"), "add", 2,
            predicates=[predicate("environment", environmentId="fully-submerged")],
        ),
        contribution("equipment.flippers.overland", "capability-value", fixed("overland"), "add", -2),
    ],
    "Light Shield": [contribution("equipment.light-shield.evasion", "evasion", fixed("physical", "special", "speed"), "add", 2)],
    "Heavy Shield": [contribution("equipment.heavy-shield.evasion", "evasion", fixed("physical", "special", "speed"), "add", 2)],
    "Focus": [contribution("equipment.focus.stat", "stat-after-stages", configured("statId"), "add", 5)],
    "Bright Powder": [contribution("equipment.bright-powder.speed-evasion", "evasion", fixed("speed"), "add", 2)],
    "Choice Item": [contribution("equipment.choice-item.default-stage", "combat-stage-default", configured("statId"), "set", 2)],
    "Eviolite": [contribution("equipment.eviolite.stats", "stat-after-stages", configured("boostedStatIds", array=True), "add", 5)],
    "Expert Belt": [contribution(
        "equipment.expert-belt.super-effective-damage", "direct-damage", fixed("all"), "add", 5,
        predicates=[predicate("effectiveness", effectivenessId="super-effective")],
    )],
    "Helmet": [contribution(
        "equipment.helmet.critical-damage-reduction", "damage-reduction", fixed("all"), "add", 15,
        predicates=[predicate("critical-hit")],
    )],
    "Iron Ball": [contribution("equipment.iron-ball.speed", "stat-after-stages", fixed("spd"), "multiply-floor", 0.5)],
    "Lagging Item": [contribution("equipment.lagging-item.default-stage", "combat-stage-default", configured("statId"), "set", -4)],
    "Lax Incense": [contribution("equipment.lax-incense.evasion", "evasion", fixed("physical", "special", "speed"), "add", 1)],
    "Life Orb": [contribution("equipment.life-orb.direct-damage", "direct-damage", fixed("all"), "add", 5)],
    "Luck Incense": [contribution("equipment.luck-incense.accuracy", "accuracy-roll", fixed("all"), "add", 1)],
    "Quick Claw": [contribution("equipment.quick-claw.initiative", "initiative", fixed("all"), "add", 10)],
    "Razor Claw": [contribution("equipment.razor-claw.critical-range", "critical-range", fixed("all"), "add", 1)],
    "Stat Boosters": [
        contribution(
            "equipment.stat-boosters.default-stage", "combat-stage-default", configured("statId"), "set", 1,
            predicates=[predicate("configuration-in", field="statId", values=["atk", "def", "satk", "sdef", "spd"])],
        ),
        contribution(
            "equipment.stat-boosters.evasion", "evasion", fixed("physical", "special", "speed"), "add", 1,
            predicates=[predicate("configuration-equals", field="statId", value="evasion")],
        ),
        contribution(
            "equipment.stat-boosters.accuracy", "accuracy-roll", fixed("all"), "add", 1,
            predicates=[predicate("configuration-equals", field="statId", value="accuracy")],
        ),
    ],
    "Metal Powder": [
        contribution(
            "equipment.metal-powder.defense-stage", "combat-stage-default", fixed("def"), "set", 2,
            predicates=[predicate("owner-untransformed")],
        ),
        contribution(
            "equipment.metal-powder.special-defense-stage", "combat-stage-default", fixed("sdef"), "set", 2,
            predicates=[predicate("owner-untransformed")],
        ),
    ],
    "Rare Leek": [contribution("equipment.rare-leek.critical-range", "critical-range", fixed("all"), "add", 2)],
    "Pink Pearl": [
        contribution(
            "equipment.pink-pearl.psychic-damage", "direct-damage", fixed("all"), "add", 5,
            predicates=[predicate("move-type", typeId="Psychic")],
        ),
        contribution(
            "equipment.pink-pearl.spoink-special-attack-stage", "combat-stage-default", fixed("satk"), "set", 1,
            predicates=[predicate("owner-species", speciesIds=["Spoink"])],
        ),
    ],
}

for type_id in POKEMON_TYPES:
    booster = f"{type_id} Type Booster"
    brace = f"{type_id} Type Brace"
    CONTRIBUTIONS[booster] = [contribution(
        f"equipment.{type_id.lower()}-type-booster.damage", "direct-damage", fixed("all"), "add", 5,
        predicates=[predicate("move-type", typeId=type_id)],
    )]
    CONTRIBUTIONS[brace] = [contribution(
        f"equipment.{type_id.lower()}-type-brace.damage-reduction", "damage-reduction", fixed("all"), "add", 15,
        predicates=[predicate("move-type", typeId=type_id)],
    )]

CONTRIBUTIONS["Type Plate"] = [
    contribution(
        "equipment.type-plate.damage", "direct-damage", fixed("all"), "add", 5,
        predicates=[predicate("move-type-configuration", field="typeId")],
    ),
    contribution(
        "equipment.type-plate.damage-reduction", "damage-reduction", fixed("all"), "add", 15,
        predicates=[predicate("move-type-configuration", field="typeId")],
    ),
]

P8_047_ITEMS = {
    "Kitchen Knife", "Baseball Bat", "Weighted Rope", "Slingshot", "Survival Knife",
    "Quarterstaff", "Throwing Hammers", "Hunting Bow", "Honed Claws", "Meteor Masher",
    "Super Lucky Throwing Stars", "Twin-Needled Bow", "Dark Vision Goggles", "Re-Breather",
    "Jungle Boots", "Old Rod", "Good Rod", "Super Rod", "Glue Cannon", "Hand Net",
    "Weighted Nets", "Light Shield", "Heavy Shield", "Wonder Launcher", "Snag Machine",
    "Mega Ring", "Shock Collar", "Type Gem", "Mega Stone", "Thick Club", "Snow Boots",
}
P8_048_ITEMS = {
    "Big Root", "Choice Item", "Everstone", "Eviolite", "Expert Belt", "Flame Orb",
    "Focus Band", "Focus Sash", "Full Incense", "Go-Goggles", "Iron Ball", "King’s Rock",
    "Life Orb", "Razor Claw", "Razor Fang", "Safety Goggles", "Shell Bell", "Toxic Orb",
    "Winter Cloak", "Metal Powder", "Rare Leek", "Thick Club", "Pink Pearl", "Gas Mask",
    "Helmet", "Re-Breather",
}
REFERENCE_ONLY_ITEMS = {"Fancy Clothes", "Contest Accessory", "Contest Fashion"}


def reviewed_grant_final_states(grants: list[dict[str, Any]], canonical_id: str) -> list[dict[str, str]]:
    result: list[dict[str, str]] = []
    for grant in grants:
        kind = grant.get("kind")
        if kind == "action":
            state = grant.get("finalState")
        elif kind in {"weapon-profile", "move"}:
            state = "native" if grant.get("executionStatus") == "native" else "deferred"
        elif kind in {"capability", "ability"}:
            state = "passive"
        else:
            raise RuntimeError(f"Unknown grant kind for {canonical_id}: {kind}")
        if state not in {"native", "guided", "passive"}:
            raise RuntimeError(f"Equipment grant {grant.get('grantId')} is not final for {canonical_id}")
        result.append({"grantId": grant["grantId"], "kind": kind, "finalState": state})
    return result


def build_document() -> dict[str, Any]:
    raw = ITEMS_PATH.read_bytes()
    if hashlib.sha256(raw).hexdigest() != CATALOG_SHA256:
        raise RuntimeError("Canonical item catalog changed; review equipment contributions before regeneration")
    items: dict[str, dict[str, Any]] = json.loads(raw)
    equipment_document = json.loads(EQUIPMENT_PATH.read_text(encoding="utf-8"))
    equipment_definitions = {entry["canonicalItemId"]: entry for entry in equipment_document["definitions"]}
    grants_document = json.loads(GRANTS_PATH.read_text(encoding="utf-8"))
    if grants_document.get("schemaVersion") != 1 or grants_document.get("ticket") != "P8-047":
        raise RuntimeError("Equipment grants are not the reviewed registry")
    grants_by_item = {entry["canonicalItemId"]: entry.get("grants", []) for entry in grants_document["definitions"]}
    expected_ids = [
        canonical_id for canonical_id, item in items.items()
        if EQUIPMENT_CATEGORIES.intersection(item.get("categories", []))
    ]
    definitions: list[dict[str, Any]] = []
    for canonical_id in expected_ids:
        equipment_definition = equipment_definitions.get(canonical_id)
        if not equipment_definition:
            raise RuntimeError(f"Missing equipment definition for {canonical_id}")
        contributions = CONTRIBUTIONS.get(canonical_id, [])
        grant_final_states = reviewed_grant_final_states(grants_by_item.get(canonical_id, []), canonical_id)
        deferred: list[str] = []
        if canonical_id in P8_047_ITEMS and not grant_final_states:
            deferred.append("P8-047")
        if canonical_id in P8_048_ITEMS:
            deferred.append("P8-048")
        if canonical_id in REFERENCE_ONLY_ITEMS:
            deferred.append("reference-only-contest-workflow")
        if not contributions and not grant_final_states and not deferred:
            deferred.append("P8-048")
        definitions.append({
            "canonicalItemId": canonical_id,
            "canonicalRecordSha256": equipment_definition["canonicalRecordSha256"],
            "equipmentDefinitionSha256": sha256(equipment_definition),
            "contributions": contributions,
            "grantFinalStates": grant_final_states,
            "deferredMechanics": deferred,
        })
    unknown = set(CONTRIBUTIONS) - set(expected_ids)
    if unknown:
        raise RuntimeError(f"Contribution adjudications reference unknown equipment: {sorted(unknown)}")
    return {
        "schemaVersion": 1,
        "ticket": "P8-046",
        "catalogSha256": CATALOG_SHA256,
        "equipmentDefinitionsSha256": hashlib.sha256(EQUIPMENT_PATH.read_bytes()).hexdigest(),
        "equipmentGrantsSha256": hashlib.sha256(GRANTS_PATH.read_bytes()).hexdigest(),
        "definitionCount": len(definitions),
        "contributingItemCount": sum(1 for entry in definitions if entry["contributions"]),
        "classificationPolicy": {
            "status": "reviewed",
            "runtimeProseParsing": False,
            "unknownOrStalePolicy": "fail-closed-no-contribution",
            "inactiveOrSuppressedPolicy": "no-contribution",
            "deferredMechanicsRemainInert": True,
            "finalGrantMechanicsAreNotDeferred": True,
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
            raise SystemExit("equipment-contributions.v1.json is stale; regenerate it")
        return
    OUTPUT_PATH.write_text(rendered, encoding="utf-8")


if __name__ == "__main__":
    main()
