#!/usr/bin/env python3
"""Generate the reviewed Complete Play Loop item-behaviour inventory.

This script classifies only app-owned structured item fields and an explicit,
reviewed category policy. It deliberately does not parse effect prose into
runtime mechanics. Executable semantics live in reviewed ItemSpecs.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
ITEMS_PATH = ROOT / "data/reference/items.json"
SPECS_PATH = ROOT / "data/complete-play-loop/specs.v1.json"
OUTPUT_PATH = ROOT / "data/complete-play-loop/item-inventory.v1.json"
CATALOG_SHA256 = "62b29a499c791d689f6efc99e04ed515a71336421352626749cf6cc7407982c8"
REPULSIVE_MEDICINES = {"Energy Powder", "Energy Root", "Heal Powder", "Revival Herb"}
PERMANENT_ADVANCEMENT_ITEMS = {
    "HP Up", "Protein", "Iron", "Calcium", "Zinc", "Carbos",
    "Heart Booster", "PP Up", "Rare Candy", "Stat Suppressants",
}
X_ITEM_DURATION = {
    "X Attack": "encounter-stage-state",
    "X Defend": "encounter-stage-state",
    "X Special": "encounter-stage-state",
    "X Sp. Def": "encounter-stage-state",
    "X Speed": "encounter-stage-state",
    "X Accuracy": "encounter-stage-state",
    "Dire Hit": "encounter",
    "Guard Spec": "five-target-turns",
}
FOOD_DURATION = {
    "Candy Bar": "instant-on-trade",
    "Honey": "instant-on-trade",
    "Leftovers": "encounter-after-trade",
    "Black Sludge": "encounter-after-trade",
    "Enriched Water": "instant",
    "Shuckle’s Berry Juice": "instant",
    "Super Soda Pop": "instant",
    "Sparkling Lemonade": "instant",
    "MooMoo Milk": "instant",
}

EQUIPMENT_CATEGORIES = {
    "Held Item", "Weapon", "Hand Equipment", "Head Equipment",
    "Body Equipment", "Feet Equipment", "Accessory Item",
}
CONSUMABLE_CATEGORIES = {
    "Medicine", "X-Item", "Vitamin", "Related Vitamin Item", "Refreshment Item",
    "Snack Item", "Herb", "Repellent", "Evolutionary Stone",
    "Evolutionary Keepsake", "Combat Item", "Poké Ball", "TM", "HM",
}
TOOL_CATEGORIES = {
    "Trainer Essential", "Pokémon Toolkit", "Gardening Item", "Crafting Item",
    "Crafting Kit", "Rope", "Apricorn",
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


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def primary_role(categories: set[str]) -> str:
    if categories & EQUIPMENT_CATEGORIES:
        return "equipment-provider"
    if "Poké Ball" in categories:
        return "capture-consumable"
    if categories & {"TM", "HM"}:
        return "move-learning"
    if categories & {"Evolutionary Stone", "Evolutionary Keepsake"}:
        return "evolution-trigger"
    if categories & {"Vitamin", "Related Vitamin Item"}:
        return "permanent-advancement"
    if categories & {"Medicine", "Herb"}:
        return "restorative"
    if "X-Item" in categories:
        return "temporary-combat-buff"
    if categories & {"Refreshment Item", "Snack Item"}:
        return "food-buff"
    if "Repellent" in categories:
        return "exploration-effect"
    if "Combat Item" in categories:
        return "combat-tool"
    if categories & TOOL_CATEGORIES:
        return "reusable-or-crafting-tool"
    return "guided-owned-item"


def contexts_for(role: str) -> list[str]:
    if role in {"restorative", "temporary-combat-buff", "combat-tool", "capture-consumable"}:
        return ["encounter", "sheet"]
    if role == "equipment-provider":
        return ["sheet", "encounter", "passive"]
    if role in {"move-learning", "permanent-advancement"}:
        return ["sheet", "campaign", "extended-action"]
    if role == "evolution-trigger":
        return ["sheet", "campaign"]
    if role in {"food-buff", "exploration-effect"}:
        return ["encounter", "campaign"]
    if role == "reusable-or-crafting-tool":
        return ["campaign", "workshop", "extended-action"]
    return ["campaign"]


def timing_for(role: str) -> str:
    if role == "equipment-provider":
        return "passive"
    if role in {"move-learning", "permanent-advancement", "reusable-or-crafting-tool"}:
        return "extended"
    return "standard"


def targets_for(role: str) -> list[str]:
    if role == "equipment-provider":
        return ["equipment-slot", "participant"]
    if role == "move-learning":
        return ["participant", "move"]
    if role == "evolution-trigger":
        return ["participant", "destination"]
    if role == "permanent-advancement":
        return ["participant", "stat"]
    if role in {"restorative", "temporary-combat-buff", "food-buff"}:
        return ["participant"]
    if role == "capture-consumable":
        return ["participant", "destination"]
    if role in {"combat-tool", "exploration-effect", "reusable-or-crafting-tool"}:
        return ["gm-adjudication"]
    return ["gm-adjudication"]


def consumption_for(role: str, categories: set[str]) -> dict[str, Any]:
    reusable = role != "evolution-trigger" and (
        bool(categories & EQUIPMENT_CATEGORIES) or bool(categories & TOOL_CATEGORIES) or "HM" in categories
    )
    phase = "never" if reusable else (
        "hit" if role == "capture-consumable" else
        "extended-action-completion" if role in {"move-learning", "permanent-advancement"} else
        "gm-adjudication" if role in {"combat-tool", "exploration-effect", "guided-owned-item", "reusable-or-crafting-tool"} else
        "accepted-use"
    )
    return {
        "quantity": 0 if reusable else 1,
        "phase": phase,
        "reservationRequiredWhenPending": not reusable,
        "reusable": reusable,
    }


def equipment_requirements(categories: set[str]) -> dict[str, Any] | None:
    if not categories & EQUIPMENT_CATEGORIES:
        return None
    slots: list[str] = []
    if "Held Item" in categories:
        slots.append("pokemon-held")
    if "Hand Equipment" in categories or "Weapon" in categories:
        slots.extend(["mainHand", "offHand"])
    if "Head Equipment" in categories:
        slots.append("head")
    if "Body Equipment" in categories:
        slots.append("body")
    if "Feet Equipment" in categories:
        slots.append("feet")
    if "Accessory Item" in categories:
        slots.append("accessory")
    return {
        "slots": list(dict.fromkeys(slots)),
        "requiresExplicitEffectiveState": True,
        "legacyNameOnlyStateIsNotAuthority": True,
    }


def current_support(canonical_id: str, categories: set[str], native_ids: set[str]) -> dict[str, Any]:
    if canonical_id in PERMANENT_ADVANCEMENT_ITEMS:
        return {
            "state": "native-runtime-wired",
            "authorities": [
                "data/reference/rules.json#Vitamins and Related Items",
                "data/complete-play-loop/specs.v1.json",
                "shared/itemAutomation/permanentAdvancement.ts",
                "server/domain/itemAutomation/permanentAdvancement.ts",
                "server/domain/itemAutomation/planner.ts",
                "server/domain/itemAutomation/reducer.ts",
                "server/useCases/manageItemExtendedAction.ts",
            ],
            "gaps": [],
        }
    if canonical_id == "First Aid Kit":
        return {
            "state": "native-runtime-wired",
            "authorities": [
                "server/domain/itemAutomation/registry.ts",
                "server/domain/itemAutomation/healing.ts",
                "server/domain/itemAutomation/ap.ts",
                "server/domain/itemAutomation/planner.ts",
                "server/domain/itemAutomation/reducer.ts",
                "shared/itemAutomation/nonEncounter.ts",
                "shared/itemAutomation/extendedActions.ts",
                "server/useCases/manageItemExtendedAction.ts",
                "server/storage/itemExtendedActionRepository.ts",
            ],
            "gaps": [],
        }
    if canonical_id == "Bandages":
        return {
            "state": "native-runtime-wired",
            "authorities": [
                "server/domain/itemAutomation/registry.ts",
                "shared/itemAutomation/medicalTreatments.ts",
                "server/domain/itemAutomation/medicalTreatments.ts",
                "server/domain/itemAutomation/planner.ts",
                "server/domain/itemAutomation/reducer.ts",
                "server/useCases/manageItemExtendedAction.ts",
                "server/useCases/advanceCampaignDay.ts",
            ],
            "gaps": [],
        }
    if canonical_id == "Poultices":
        return {
            "state": "reviewed-spec-fail-closed",
            "authorities": [
                "data/complete-play-loop/specs.v1.json#poulticePolicy",
                "data/reference/rules.json#Loyalty",
            ],
            "gaps": ["bounded GM Loyalty-attention receipt (P8-059)"],
        }
    if canonical_id == "Wonder Launcher":
        return {
            "state": "native-runtime-wired",
            "authorities": [
                "data/complete-play-loop/equipment-grants.v1.json",
                "server/domain/itemAutomation/equipmentDelivery.ts",
                "server/domain/itemAutomation/encounterOffers.ts",
                "server/domain/itemAutomation/planner.ts",
                "server/useCases/executeItemOperation.ts",
            ],
            "gaps": ["unreviewed Researcher-combined item identities remain fail-closed"],
        }
    if canonical_id == "Re-Breather":
        return {
            "state": "reviewed-action-fail-closed",
            "authorities": [
                "data/complete-play-loop/equipment-definitions.v1.json",
                "data/complete-play-loop/equipment-grants.v1.json",
                "server/domain/itemAutomation/equipmentCompatibility.ts",
            ],
            "gaps": ["bounded GM open-air refill adjudication (P8-059)"],
        }
    if canonical_id in {"Candy Bar", "Honey", "Leftovers", "Black Sludge"}:
        return {
            "state": "native-runtime-wired",
            "authorities": [
                "server/domain/itemAutomation/registry.ts",
                "server/domain/itemAutomation/digestionBuffs.ts",
                "server/domain/itemAutomation/digestionBuffTrade.ts",
                "server/domain/moveAutomation/itemEffectInterpreter.ts",
            ],
            "gaps": [],
        }
    if canonical_id in REPULSIVE_MEDICINES:
        return {
            "state": "reviewed-spec-fail-closed",
            "authorities": [
                "data/complete-play-loop/specs.v1.json",
                "data/reference/rules.json#Loyalty",
            ],
            "gaps": ["bounded GM Loyalty-attention receipt"],
        }
    if canonical_id in {"Bright Powder", "Luck Incense", "Quick Claw"}:
        return {
            "state": "explicit-passive-partial",
            "authorities": [
                "data/complete-play-loop/equipment-definitions.v1.json",
                "server/domain/itemAutomation/equipmentCompatibility.ts",
                "src/utils/sheetHeldItemEffects.ts",
            ],
            "gaps": ["atomic equipment commands", "server contribution projection", "source-loss receipt"],
        }
    if categories & {"Evolutionary Stone", "Evolutionary Keepsake"} and canonical_id in native_ids:
        authorities = [
            "data/complete-play-loop/evolution-items.v1.json",
            "server/domain/itemAutomation/evolution.ts",
            "server/domain/itemAutomation/planner.ts",
            "server/domain/itemAutomation/reducer.ts",
            "server/storage/sheetRepository.ts",
        ]
        if categories & EQUIPMENT_CATEGORIES:
            authorities.extend([
                "data/complete-play-loop/equipment-definitions.v1.json",
                "server/domain/itemAutomation/equipmentCompatibility.ts",
                "server/useCases/executeEquipmentOperation.ts",
            ])
        return {
            "state": "native-runtime-wired",
            "authorities": authorities,
            "gaps": [],
        }
    if categories & {"TM", "HM"} and canonical_id in native_ids:
        return {
            "state": "native-runtime-wired",
            "authorities": [
                "data/complete-play-loop/move-learning-items.v1.json",
                "server/domain/itemAutomation/moveLearning.ts",
                "server/domain/itemAutomation/planner.ts",
                "server/domain/itemAutomation/reducer.ts",
                "server/useCases/manageItemExtendedAction.ts",
            ],
            "gaps": [],
        }
    if categories & EQUIPMENT_CATEGORIES:
        return {
            "state": "native-compatibility-wired",
            "authorities": [
                "data/complete-play-loop/equipment-definitions.v1.json",
                "server/domain/itemAutomation/equipmentDefinitionRegistry.ts",
                "server/domain/itemAutomation/equipmentCompatibility.ts",
            ],
            "gaps": [
                "atomic equipment commands (P8-044)",
                "derived contributions and granted actions (P8-046/P8-047)",
                "passive providers and source lifecycle (P8-048/P8-049)",
            ],
        }
    if canonical_id in native_ids:
        return {
            "state": "native-runtime-wired",
            "authorities": [
                "server/domain/itemAutomation/registry.ts",
                "server/useCases/executeItemOperation.ts",
                "server/domain/itemAutomation/presentation.ts",
            ],
            "gaps": [],
        }
    if "Poké Ball" in categories:
        return {
            "state": "specialized-live-play-partial",
            "authorities": ["server/useCases/applyThrowPokeballCommand.ts"],
            "gaps": ["stable source-row identity", "shared item receipt"],
        }
    return {
        "state": "reference-visible-only",
        "authorities": ["data/reference/items.json"],
        "gaps": ["reviewed ItemSpec", "server operation", "action projection", "recovery"],
    }


def main() -> None:
    raw_catalog = ITEMS_PATH.read_bytes()
    if hashlib.sha256(raw_catalog).hexdigest() != CATALOG_SHA256:
        raise SystemExit("Canonical item catalog fingerprint drifted; review before regenerating.")
    items: dict[str, dict[str, Any]] = json.loads(raw_catalog)
    specs = json.loads(SPECS_PATH.read_text())
    native_ids = {row["canonicalId"] for row in specs["specs"]}
    evolution_ids = {
        row["canonicalId"] for row in specs["specs"]
        if row.get("effect", {}).get("kind") == "evolve-pokemon"
    }

    rows = []
    for canonical_id, item in items.items():
        if item.get("name") != canonical_id:
            raise SystemExit(f"Canonical item key/name mismatch: {canonical_id}")
        categories = set(item.get("categories", []))
        role = (
            "permanent-advancement" if canonical_id in PERMANENT_ADVANCEMENT_ITEMS else
            "evolution-trigger" if canonical_id in evolution_ids else
            primary_role(categories)
        )
        cost_values = item.get("costs", [])
        defects: list[dict[str, str]] = []
        if not cost_values:
            defects.append({"field": "costs", "kind": "missing", "runtimePolicy": "fail-closed"})
        if not item.get("effects"):
            defects.append({"field": "effects", "kind": "missing", "runtimePolicy": "fail-closed"})
        medical_bandage_like = canonical_id in {"Bandages", "Poultices"}
        rows.append({
            "canonicalId": canonical_id,
            "recordSha256": sha256_text(stable_json(item)),
            "effectSha256": sha256_text("\n".join(item.get("effects", []))),
            "aliases": item.get("aliases", []),
            "categories": item.get("categories", []),
            "sections": item.get("sections", []),
            "behaviorInventory": {
                "mechanicalRole": role,
                "contexts": ["campaign", "sheet", "extended-action"] if canonical_id == "First Aid Kit" or medical_bandage_like else contexts_for(role),
                "timing": "extended" if medical_bandage_like else timing_for(role),
                "targets": ["participant"] if canonical_id == "First Aid Kit" or medical_bandage_like else targets_for(role),
                "actionCost": ({
                    "kind": "ap-drain",
                    "amount": 1,
                    "recovery": "extended-rest",
                    "requiresExtendedAction": True,
                    "canonicalAcquisitionCostLabels": cost_values,
                } if canonical_id == "First Aid Kit" else {
                    "kind": "extended-time" if medical_bandage_like else ("none" if timing_for(role) == "passive" else ("extended-time" if timing_for(role) == "extended" else "standard-action")),
                    "amount": 1 if medical_bandage_like or timing_for(role) != "passive" else 0,
                    "canonicalAcquisitionCostLabels": cost_values,
                }),
                "consumption": ({
                    "quantity": 1,
                    "phase": "extended-action-completion",
                    "reservationRequiredWhenPending": False,
                    "reusable": False,
                } if medical_bandage_like else consumption_for(role, categories)),
                "duration": "6-campaign-hours" if medical_bandage_like else ("instant" if canonical_id == "First Aid Kit" else X_ITEM_DURATION.get(canonical_id, FOOD_DURATION.get(canonical_id, "while-equipped" if role == "equipment-provider" else ("review-required" if role in {"food-buff", "exploration-effect", "combat-tool", "guided-owned-item", "reusable-or-crafting-tool"} else "instant")))),
                "equipmentRequirements": equipment_requirements(categories),
                "currentProductSupport": current_support(canonical_id, categories, native_ids),
                "canonicalDataDefects": defects,
            },
        })

    document = {
        "schemaVersion": 1,
        "catalogSha256": CATALOG_SHA256,
        "entryCount": len(rows),
        "classificationPolicy": {
            "reviewId": "complete-play-loop-item-behaviour-inventory-v1",
            "status": "reviewed",
            "authority": "app-owned structured categories plus explicit policy in scripts/generate_complete_play_loop_item_inventory.py",
            "runtimeProseParsing": False,
            "note": "Category policy inventories the work; it never supplies executable mechanics. Versioned ItemSpecs are required at runtime.",
        },
        "rows": rows,
    }
    OUTPUT_PATH.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    main()
