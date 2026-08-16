#!/usr/bin/env python3
"""Generate reviewed equipment-granted sources without parsing runtime prose."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
ITEMS_PATH = ROOT / "data/reference/items.json"
EQUIPMENT_PATH = ROOT / "data/complete-play-loop/equipment-definitions.v1.json"
OUTPUT_PATH = ROOT / "data/complete-play-loop/equipment-grants.v1.json"
CATALOG_SHA256 = "62b29a499c791d689f6efc99e04ed515a71336421352626749cf6cc7407982c8"
EQUIPMENT_CATEGORIES = {
    "Held Item", "Weapon", "Hand Equipment", "Head Equipment",
    "Body Equipment", "Feet Equipment", "Accessory Item",
}


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


def weapon(grant_id: str, weapon_class: str, *, reach: bool = False) -> dict[str, Any]:
    small = weapon_class == "small-melee"
    large = weapon_class == "large-melee"
    return {
        "grantId": grant_id,
        "kind": "weapon-profile",
        "weaponClass": weapon_class,
        "pokemonWielderSizePolicy": "small-only" if small else "medium-plus" if large else "trainer-only",
        "damageBaseBonus": 1 if small else 2 if large else 0,
        "accuracyCheckPenalty": 1 if large else 0,
        "grantsReach": reach,
        "executionStatus": "native" if small or large else "definition-missing",
    }


def move(grant_id: str, canonical_id: str, rank: int, native: bool) -> dict[str, Any]:
    return {
        "grantId": grant_id,
        "kind": "move",
        "canonicalId": canonical_id,
        "minimumCombatRank": rank,
        "trainerEligible": True,
        "pokemonWielderEligible": rank == 4,
        "executionStatus": "native" if native else "definition-missing",
    }


def capability(
    grant_id: str,
    canonical_id: str,
    parameter_label: str | None = None,
    activation: str = "while-equipped",
) -> dict[str, Any]:
    return {
        "grantId": grant_id,
        "kind": "capability",
        "canonicalId": canonical_id,
        "parameterLabel": parameter_label,
        "activation": activation,
    }


def ability(grant_id: str, canonical_id: str) -> dict[str, Any]:
    return {
        "grantId": grant_id,
        "kind": "ability",
        "canonicalId": canonical_id,
        "activation": "while-equipped",
    }


def action(
    grant_id: str,
    action_id: str,
    label: str,
    timing: str,
    role: str,
    target_kind: str,
    deferred_ticket: str | None,
) -> dict[str, Any]:
    return {
        "grantId": grant_id,
        "kind": "action",
        "actionId": action_id,
        "label": label,
        "timing": timing,
        "interactionRole": role,
        "targetKind": target_kind,
        "executionStatus": "native" if deferred_ticket is None else "deferred",
        "deferredTicket": deferred_ticket,
    }


GRANTS: dict[str, list[dict[str, Any]]] = {
    "Kitchen Knife": [weapon("equipment.kitchen-knife.weapon", "small-melee")],
    "Baseball Bat": [weapon("equipment.baseball-bat.weapon", "large-melee")],
    "Weighted Rope": [weapon("equipment.weighted-rope.weapon", "short-range")],
    "Slingshot": [weapon("equipment.slingshot.weapon", "long-range")],
    "Survival Knife": [
        weapon("equipment.survival-knife.weapon", "small-melee"),
        move("equipment.survival-knife.cheap-shot", "Cheap Shot", 4, True),
    ],
    "Quarterstaff": [
        weapon("equipment.quarterstaff.weapon", "large-melee", reach=True),
        move("equipment.quarterstaff.backswing", "Backswing", 4, True),
    ],
    "Throwing Hammers": [
        weapon("equipment.throwing-hammers.weapon", "short-range"),
        move("equipment.throwing-hammers.bash", "Bash!", 4, False),
    ],
    "Hunting Bow": [
        weapon("equipment.hunting-bow.weapon", "long-range"),
        move("equipment.hunting-bow.pierce", "Pierce!", 4, False),
    ],
    "Honed Claws": [
        weapon("equipment.honed-claws.weapon", "small-melee"),
        move("equipment.honed-claws.wounding-strike", "Wounding Strike", 4, True),
        move("equipment.honed-claws.gouge", "Gouge", 6, False),
    ],
    "Meteor Masher": [
        weapon("equipment.meteor-masher.weapon", "large-melee"),
        move("equipment.meteor-masher.backswing", "Backswing", 4, True),
        move("equipment.meteor-masher.titanic-slam", "Titanic Slam", 6, False),
    ],
    "Super Lucky Throwing Stars": [
        weapon("equipment.super-lucky-throwing-stars.weapon", "short-range"),
        move("equipment.super-lucky-throwing-stars.bullseye", "Bullseye", 4, False),
        move("equipment.super-lucky-throwing-stars.deadly-strike", "Deadly Strike", 6, False),
    ],
    "Twin-Needled Bow": [
        weapon("equipment.twin-needled-bow.weapon", "long-range"),
        move("equipment.twin-needled-bow.double-swipe", "Double Swipe", 4, True),
        move("equipment.twin-needled-bow.triple-threat", "Triple Threat", 6, False),
    ],
    "Dark Vision Goggles": [capability("equipment.dark-vision-goggles.darkvision", "Darkvision")],
    "Snow Boots": [capability("equipment.snow-boots.naturewalk", "Naturewalk", "Naturewalk (Tundra)")],
    "Jungle Boots": [capability("equipment.jungle-boots.naturewalk", "Naturewalk", "Naturewalk (Forest)")],
    "Full Incense": [ability("equipment.full-incense.stall", "Stall")],
    "Thick Club": [ability("equipment.thick-club.pure-power", "Pure Power")],
    # P8-059 owns the Standard-action declaration, bounded GM acceptance,
    # one-hour reservoir, and GM-confirmed five-minute open-air refill.
    "Re-Breather": [
        capability(
            "equipment.re-breather.gilled",
            "Gilled",
            activation="while-re-breather-active",
        ),
        action(
            "equipment.re-breather.activate",
            "equipment.re-breather.activate",
            "Activate Re-Breather",
            "standard",
            "activated-action",
            "self",
            None,
        ),
    ],
    "Old Rod": [action("equipment.old-rod.fish", "equipment.fishing.old-rod", "Fish with Old Rod", "extended", "contextual-affordance", "cell", "P8-057")],
    "Good Rod": [action("equipment.good-rod.fish", "equipment.fishing.good-rod", "Fish with Good Rod", "extended", "contextual-affordance", "cell", "P8-057")],
    "Super Rod": [action("equipment.super-rod.fish", "equipment.fishing.super-rod", "Fish with Super Rod", "extended", "contextual-affordance", "cell", "P8-057")],
    "Glue Cannon": [action("equipment.glue-cannon.attack", "equipment.glue-cannon.attack", "Fire Glue Cannon", "standard", "activated-action", "participant", "P8-092")],
    "Hand Net": [action("equipment.hand-net.attack", "equipment.hand-net.attack", "Use Hand Net", "standard", "activated-action", "participant", "P8-092")],
    "Weighted Nets": [
        action("equipment.weighted-nets.throw", "equipment.weighted-nets.throw", "Throw Weighted Net", "standard", "activated-action", "participant", "P8-092"),
        action("equipment.weighted-nets.pull", "equipment.weighted-nets.pull", "Pull Weighted Net", "standard", "contextual-affordance", "participant", "P8-092"),
    ],
    # Provider semantics are reviewed in P8-048; P8-050 owns the liveplay
    # action transport and multi-client certification for these standard actions.
    "Light Shield": [action("equipment.light-shield.ready", "equipment.light-shield.ready", "Ready Light Shield", "standard", "activated-action", "self", "P8-050")],
    "Heavy Shield": [action("equipment.heavy-shield.ready", "equipment.heavy-shield.ready", "Ready Heavy Shield", "standard", "activated-action", "self", "P8-050")],
    "Wonder Launcher": [action("equipment.wonder-launcher.apply", "equipment.wonder-launcher.apply", "Apply X-Item with Wonder Launcher", "standard", "activated-action", "participant", None)],
    "Snag Machine": [action("equipment.snag-machine.convert", "equipment.snag-machine.convert", "Prepare Snag Ball", "swift", "activated-action", "item", "P8-059")],
    "Mega Ring": [action("equipment.mega-ring.evolve", "equipment.mega-ring.evolve", "Mega Evolve", "swift", "contextual-affordance", "participant", None)],
    "Shock Collar": [action("equipment.shock-collar.activate", "equipment.shock-collar.activate", "Activate Shock Collar", "standard", "activated-action", "self", "P8-050")],
    # The matching Move declaration now injects the private activate/pass
    # response and atomically consumes the exact source; no standalone action exists.
    "Type Gem": [],
    "Mega Stone": [action("equipment.mega-stone.evolve", "equipment.mega-stone.evolve", "Mega Evolve", "swift", "contextual-affordance", "self", None)],
}


def build_document() -> dict[str, Any]:
    raw = ITEMS_PATH.read_bytes()
    if hashlib.sha256(raw).hexdigest() != CATALOG_SHA256:
        raise RuntimeError("Canonical item catalog changed; review equipment grants before regeneration")
    items: dict[str, dict[str, Any]] = json.loads(raw)
    equipment_document = json.loads(EQUIPMENT_PATH.read_text(encoding="utf-8"))
    equipment_definitions = {entry["canonicalItemId"]: entry for entry in equipment_document["definitions"]}
    expected_ids = [
        canonical_id for canonical_id, item in items.items()
        if EQUIPMENT_CATEGORIES.intersection(item.get("categories", []))
    ]
    definitions: list[dict[str, Any]] = []
    for canonical_id in expected_ids:
        equipment_definition = equipment_definitions.get(canonical_id)
        if not equipment_definition:
            raise RuntimeError(f"Missing equipment definition for {canonical_id}")
        definitions.append({
            "canonicalItemId": canonical_id,
            "canonicalRecordSha256": equipment_definition["canonicalRecordSha256"],
            "equipmentDefinitionSha256": sha256(equipment_definition),
            "grants": GRANTS.get(canonical_id, []),
        })
    unknown = set(GRANTS) - set(expected_ids)
    if unknown:
        raise RuntimeError(f"Grant adjudications reference unknown equipment: {sorted(unknown)}")
    grants = [grant for definition in definitions for grant in definition["grants"]]
    return {
        "schemaVersion": 1,
        "ticket": "P8-047",
        "catalogSha256": CATALOG_SHA256,
        "equipmentDefinitionsSha256": hashlib.sha256(EQUIPMENT_PATH.read_bytes()).hexdigest(),
        "definitionCount": len(definitions),
        "grantingItemCount": sum(1 for definition in definitions if definition["grants"]),
        "grantCount": len(grants),
        "classificationPolicy": {
            "status": "reviewed",
            "runtimeProseParsing": False,
            "missingDefinitionPolicy": "visible-unavailable-no-execution",
            "inactiveOrSuppressedPolicy": "withdraw-immediately",
            "acceptedDurableEffectsSurviveSourceLoss": True,
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
            raise SystemExit("equipment-grants.v1.json is stale; regenerate it")
        return
    OUTPUT_PATH.write_text(rendered, encoding="utf-8")


if __name__ == "__main__":
    main()
