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
ITEM_ACTION_MATRIX_PATH = ROOT / "data/deferred-closure/item-action-matrix.v1.json"
OUTPUT_PATH = ROOT / "data/complete-play-loop/equipment-grants.v1.json"
CATALOG_SHA256 = "842256900ab540c7cdb22c1663d8bb7c89966b8d225cff1a1c5f175ae1e915ef"
ITEM_ACTION_MATRIX_SHA256 = "1de4da8ae7fe2dd937b75975e6aa684339d8174c87ec088443acb37963518d83"
WEAPON_SOURCE_PATH = "books/markdown/core/09-gear-and-items.md"
WEAPON_SOURCE_SHA256 = "b700b95186df42500c49575d8e7f5396188809cb46cc22c3cb3df7b1e9f6b1e0"
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


WEAPON_CLASS_POLICIES: dict[str, dict[str, Any]] = {
    "small-melee": {
        "pokemonWielderSizePolicy": "small-only",
        "damageBaseBonus": 1,
        "accuracyCheckPenalty": 0,
        "rangeMinimumMeters": 0,
        "rangeMaximumMeters": None,
        "handsRequired": 1,
        "targetingPolicy": "melee",
        "weaponRangeReplacesSingleTargetMoveRange": False,
    },
    "large-melee": {
        "pokemonWielderSizePolicy": "medium-plus",
        "damageBaseBonus": 2,
        "accuracyCheckPenalty": 1,
        "rangeMinimumMeters": 0,
        "rangeMaximumMeters": None,
        "handsRequired": 2,
        "targetingPolicy": "melee",
        "weaponRangeReplacesSingleTargetMoveRange": False,
    },
    "short-range": {
        "pokemonWielderSizePolicy": "trainer-only",
        "damageBaseBonus": 0,
        "accuracyCheckPenalty": 0,
        "rangeMinimumMeters": 0,
        "rangeMaximumMeters": 4,
        "handsRequired": 1,
        "targetingPolicy": "ranged-line-of-sight",
        "weaponRangeReplacesSingleTargetMoveRange": True,
    },
    "long-range": {
        "pokemonWielderSizePolicy": "trainer-only",
        "damageBaseBonus": 1,
        "accuracyCheckPenalty": 1,
        "rangeMinimumMeters": 4,
        "rangeMaximumMeters": 12,
        "handsRequired": 2,
        "targetingPolicy": "ranged-line-of-sight",
        "weaponRangeReplacesSingleTargetMoveRange": True,
    },
}


def weapon(grant_id: str, weapon_class: str, *, reach: bool = False) -> dict[str, Any]:
    policy = WEAPON_CLASS_POLICIES.get(weapon_class)
    if policy is None:
        raise RuntimeError(f"Unknown reviewed weapon class: {weapon_class}")
    return {
        "grantId": grant_id,
        "kind": "weapon-profile",
        "weaponClass": weapon_class,
        **policy,
        # Core weapon attacks abstract ammunition and do not define a tracked
        # projectile recovery transaction. Runtime must not invent one.
        "ammunitionPolicy": "abstracted-no-tracked-consumption",
        "recoveryPolicy": "no-canonical-projectile-recovery",
        "allowsStab": False,
        "grantsReach": reach,
        "sourcePath": WEAPON_SOURCE_PATH,
        "sourceSha256": WEAPON_SOURCE_SHA256,
        "executionStatus": "native",
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
    *,
    final_state: str = "native",
) -> dict[str, Any]:
    if final_state not in {"native", "guided", "deferred"}:
        raise RuntimeError(f"Unsupported reviewed action final state: {final_state}")
    if (deferred_ticket is None) != (final_state != "deferred"):
        raise RuntimeError(f"Action {action_id} final state and deferred owner disagree")
    return {
        "grantId": grant_id,
        "kind": "action",
        "actionId": action_id,
        "label": label,
        "timing": timing,
        "interactionRole": role,
        "targetKind": target_kind,
        "executionStatus": "native" if deferred_ticket is None else "deferred",
        "finalState": final_state,
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
        move("equipment.throwing-hammers.bash", "Bash!", 4, True),
    ],
    "Hunting Bow": [
        weapon("equipment.hunting-bow.weapon", "long-range"),
        move("equipment.hunting-bow.pierce", "Pierce!", 4, True),
    ],
    "Honed Claws": [
        weapon("equipment.honed-claws.weapon", "small-melee"),
        move("equipment.honed-claws.wounding-strike", "Wounding Strike", 4, True),
        move("equipment.honed-claws.gouge", "Gouge", 6, True),
    ],
    "Meteor Masher": [
        weapon("equipment.meteor-masher.weapon", "large-melee"),
        move("equipment.meteor-masher.backswing", "Backswing", 4, True),
        move("equipment.meteor-masher.titanic-slam", "Titanic Slam", 6, True),
    ],
    "Super Lucky Throwing Stars": [
        weapon("equipment.super-lucky-throwing-stars.weapon", "short-range"),
        move("equipment.super-lucky-throwing-stars.bullseye", "Bullseye", 4, True),
        move("equipment.super-lucky-throwing-stars.deadly-strike", "Deadly Strike", 6, True),
    ],
    "Twin-Needled Bow": [
        weapon("equipment.twin-needled-bow.weapon", "long-range"),
        move("equipment.twin-needled-bow.double-swipe", "Double Swipe", 4, True),
        move("equipment.twin-needled-bow.triple-threat", "Triple Threat", 6, True),
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
            final_state="guided",
        ),
    ],
    # Plan 11 final states are rebound from the reviewed item-action matrix
    # during generation; executable guided declarations still use the native
    # equipment-action dispatcher while retaining their guided final state.
    "Old Rod": [action("equipment.old-rod.fish", "equipment.fishing.old-rod", "Fish with Old Rod", "extended", "contextual-affordance", "cell", None)],
    "Good Rod": [action("equipment.good-rod.fish", "equipment.fishing.good-rod", "Fish with Good Rod", "extended", "contextual-affordance", "cell", None)],
    "Super Rod": [action("equipment.super-rod.fish", "equipment.fishing.super-rod", "Fish with Super Rod", "extended", "contextual-affordance", "cell", None)],
    "Glue Cannon": [action("equipment.glue-cannon.attack", "equipment.glue-cannon.attack", "Fire Glue Cannon", "standard", "activated-action", "participant", None)],
    "Hand Net": [action("equipment.hand-net.attack", "equipment.hand-net.attack", "Use Hand Net", "standard", "activated-action", "participant", None)],
    "Weighted Nets": [
        action("equipment.weighted-nets.throw", "equipment.weighted-nets.throw", "Throw Weighted Net", "standard", "activated-action", "participant", None),
        action("equipment.weighted-nets.pull", "equipment.weighted-nets.pull", "Pull Weighted Net", "standard", "contextual-affordance", "participant", None),
    ],
    "Light Shield": [action("equipment.light-shield.ready", "equipment.light-shield.ready", "Ready Light Shield", "standard", "activated-action", "self", None)],
    "Heavy Shield": [action("equipment.heavy-shield.ready", "equipment.heavy-shield.ready", "Ready Heavy Shield", "standard", "activated-action", "self", None)],
    "Wonder Launcher": [action("equipment.wonder-launcher.apply", "equipment.wonder-launcher.apply", "Apply X-Item with Wonder Launcher", "standard", "activated-action", "participant", None)],
    "Snag Machine": [action("equipment.snag-machine.convert", "equipment.snag-machine.convert", "Prepare Snag Ball", "swift", "activated-action", "item", None)],
    "Mega Ring": [action("equipment.mega-ring.evolve", "equipment.mega-ring.evolve", "Mega Evolve", "swift", "contextual-affordance", "participant", None)],
    "Shock Collar": [action("equipment.shock-collar.activate", "equipment.shock-collar.activate", "Activate Shock Collar", "standard", "activated-action", "participant", None)],
    # The matching Move declaration now injects the private activate/pass
    # response and atomically consumes the exact source; no standalone action exists.
    "Type Gem": [],
    "Mega Stone": [action("equipment.mega-stone.evolve", "equipment.mega-stone.evolve", "Mega Evolve", "swift", "contextual-affordance", "self", None)],
}


def build_document() -> dict[str, Any]:
    raw = ITEMS_PATH.read_bytes()
    if hashlib.sha256(raw).hexdigest() != CATALOG_SHA256:
        raise RuntimeError("Canonical item catalog changed; review equipment grants before regeneration")
    matrix_raw = ITEM_ACTION_MATRIX_PATH.read_bytes()
    if hashlib.sha256(matrix_raw).hexdigest() != ITEM_ACTION_MATRIX_SHA256:
        raise RuntimeError("Reviewed item-action matrix changed; review final grant states before regeneration")
    matrix = json.loads(matrix_raw)
    if matrix.get("schemaVersion") != 1 or matrix.get("status") != "frozen" or matrix.get("ticket") != "P11-031":
        raise RuntimeError("Item-action final-state authority is not the reviewed P11-031 matrix")
    item_action_states = {
        row["actionId"]: (row["canonicalItemId"], row["finalState"])
        for row in matrix.get("rows", [])
    }
    if len(item_action_states) != 11 or any(state not in {"native", "guided"} for _, state in item_action_states.values()):
        raise RuntimeError("Item-action final-state authority must contain eleven unique final actions")
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
        grants = [dict(grant) for grant in GRANTS.get(canonical_id, [])]
        for grant in grants:
            if grant.get("kind") != "action" or grant.get("actionId") not in item_action_states:
                continue
            reviewed_item_id, final_state = item_action_states[grant["actionId"]]
            if reviewed_item_id != canonical_id or grant.get("executionStatus") != "native":
                raise RuntimeError(f"Reviewed item-action binding disagrees for {grant['actionId']}")
            grant["finalState"] = final_state
        definitions.append({
            "canonicalItemId": canonical_id,
            "canonicalRecordSha256": equipment_definition["canonicalRecordSha256"],
            "equipmentDefinitionSha256": sha256(equipment_definition),
            "grants": grants,
        })
    unknown = set(GRANTS) - set(expected_ids)
    if unknown:
        raise RuntimeError(f"Grant adjudications reference unknown equipment: {sorted(unknown)}")
    grants = [grant for definition in definitions for grant in definition["grants"]]
    bound_item_actions = {grant["actionId"] for grant in grants if grant.get("actionId") in item_action_states}
    if bound_item_actions != set(item_action_states):
        raise RuntimeError(f"Reviewed item-action grants are incomplete: {sorted(set(item_action_states) - bound_item_actions)}")
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
            "finalStateAuthorityPath": "data/deferred-closure/item-action-matrix.v1.json",
            "finalStateAuthoritySha256": ITEM_ACTION_MATRIX_SHA256,
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
