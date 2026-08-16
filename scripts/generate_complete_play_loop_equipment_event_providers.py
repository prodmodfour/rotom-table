#!/usr/bin/env python3
"""Generate reviewed equipment event providers without runtime prose parsing."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
ITEMS_PATH = ROOT / "data/reference/items.json"
EQUIPMENT_PATH = ROOT / "data/complete-play-loop/equipment-definitions.v1.json"
OUTPUT_PATH = ROOT / "data/complete-play-loop/equipment-event-providers.v1.json"
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


def frequency(kind: str = "at-will", consume: str = "on-applied") -> dict[str, str]:
    return {"kind": kind, "consume": consume}


def automatic() -> dict[str, str]:
    return {"kind": "automatic"}


def owner_choice(*options: tuple[str, str]) -> dict[str, Any]:
    return {
        "kind": "owner-choice",
        "options": [{"optionId": option_id, "label": label} for option_id, label in options],
    }


def privacy(source: str = "owner-gm", outcome: str = "public") -> dict[str, str]:
    return {"source": source, "outcome": outcome}


def provider(
    provider_id: str,
    label: str,
    event_kind: str,
    checkpoint: str,
    predicate: dict[str, Any],
    effect: dict[str, Any],
    *,
    priority: int = 0,
    response: str = "mandatory",
    provider_frequency: dict[str, str] | None = None,
    choice: dict[str, Any] | None = None,
    source_visibility: str = "owner-gm",
) -> dict[str, Any]:
    return {
        "providerId": provider_id,
        "label": label,
        "eventKind": event_kind,
        "checkpoint": checkpoint,
        "predicate": predicate,
        "frequency": provider_frequency or frequency(),
        "priority": priority,
        "response": response,
        "choice": choice or automatic(),
        "privacy": privacy(source_visibility),
        "oncePerCausalChain": True,
        "acceptedEffectSurvivesSourceLoss": True,
        "effect": effect,
    }


def move_predicate(*, role: str, timings: list[str], canonical_ids: list[str] | None = None,
                   keywords_any: list[str] | None = None, damage_classes: list[str] | None = None,
                   configured_type: bool = False) -> dict[str, Any]:
    return {
        "kind": "move",
        "ownerRole": role,
        "timings": timings,
        "canonicalMoveIds": canonical_ids or [],
        "keywordsAny": keywords_any or [],
        "damageClasses": damage_classes or [],
        "configuredType": configured_type,
    }


def strike_predicate(*, role: str, timings: list[str], minimum_loss: int | None = None,
                     natural_minimum: int | None = None, direct_only: bool = False,
                     relationship: str = "any") -> dict[str, Any]:
    return {
        "kind": "strike",
        "ownerRole": role,
        "timings": timings,
        "accuracyOutcomes": ["hit"],
        "directOnly": direct_only,
        "minimumTotalLoss": minimum_loss,
        "naturalAccuracyMinimum": natural_minimum,
        "relationship": relationship,
    }


def hp_predicate(*, role: str = "subject", changes: list[str], faint: list[str] | None = None,
                 before_at_maximum: bool | None = None, reason_codes: list[str] | None = None,
                 move_sourced: bool | None = None) -> dict[str, Any]:
    return {
        "kind": "hp",
        "ownerRole": role,
        "changeKinds": changes,
        "faintTransitions": faint or [],
        "beforeAtMaximum": before_at_maximum,
        "reasonCodes": reason_codes or [],
        "moveSourced": move_sourced,
    }


def item_predicate(*changes: str) -> dict[str, Any]:
    return {"kind": "item", "ownerRole": "after", "changes": list(changes)}


def lifecycle_predicate(boundary: str, transition: str, role: str = "subject") -> dict[str, Any]:
    return {"kind": "lifecycle", "ownerRole": role, "boundaries": [boundary], "transitions": [transition]}


def action_predicate(action_id: str, role: str) -> dict[str, Any]:
    return {"kind": "action", "ownerRole": role, "actionIds": [action_id], "timings": ["started"]}


PROVIDERS: dict[str, list[dict[str, Any]]] = {
    "Gas Mask": [provider(
        "equipment.gas-mask.move-immunity", "Gas Mask protection", "move", "pre-effect",
        move_predicate(role="target", timings=["use-started"], canonical_ids=[
            "Poison Gas", "Poison Powder", "Rage Powder", "Sleep Powder", "Smog",
            "Smokescreen", "Spore", "Stun Spore", "Sweet Scent",
        ]),
        {"kind": "prevent-move", "reasonCode": "equipment.gas-mask.move-immunity"},
        priority=80,
    )],
    "Helmet": [
        provider(
            "equipment.helmet.move-resistance", "Helmet resistance", "strike", "pre-effect",
            {**strike_predicate(role="defender", timings=["damage-resolved"]),
             "canonicalMoveIds": ["Headbutt", "Zen Headbutt"]},
            {"kind": "add-resistance-step", "steps": 1, "reasonCode": "equipment.helmet.move-resistance"},
            priority=45,
        ),
        provider(
            "equipment.helmet.flinch-immunity", "Helmet flinch protection", "condition", "pre-effect",
            {"kind": "condition", "ownerRole": "subject", "conditionIds": ["Flinch"],
             "operations": ["apply"], "sourceMoveIds": ["Headbutt", "Zen Headbutt"]},
            {"kind": "prevent-condition", "conditionId": "Flinch", "reasonCode": "equipment.helmet.flinch-immunity"},
            priority=90,
        ),
    ],
    "Big Root": [provider(
        "equipment.big-root.drain-healing", "Big Root drain healing", "hp", "pre-effect",
        hp_predicate(changes=["drain"]),
        {"kind": "multiply-hp-change", "changeKind": "drain", "numerator": 2, "denominator": 1,
         "reasonCode": "equipment.big-root.double-drain-healing"},
        priority=25,
    )],
    "Choice Item": [
        provider(
            "equipment.choice-item.equip-suppression", "Choice Item suppression", "item", "after-commit",
            item_predicate("equipped"),
            {"kind": "apply-condition", "conditionId": "Suppressed", "duration": "encounter",
             "reasonCode": "equipment.choice-item.suppression"},
            priority=70,
        ),
        provider(
            "equipment.choice-item.scene-suppression", "Choice Item suppression", "lifecycle", "lifecycle",
            lifecycle_predicate("scene", "started", "global"),
            {"kind": "apply-condition", "conditionId": "Suppressed", "duration": "encounter",
             "reasonCode": "equipment.choice-item.suppression"},
            priority=70,
            provider_frequency=frequency("scene", "on-applied"),
        ),
        provider(
            "equipment.choice-item.turn-suppression", "Choice Item suppression", "lifecycle", "lifecycle",
            lifecycle_predicate("turn", "started"),
            {"kind": "apply-condition", "conditionId": "Suppressed", "duration": "encounter",
             "reasonCode": "equipment.choice-item.suppression"},
            priority=70,
        ),
    ],
    "Everstone": [provider(
        "equipment.everstone.prevent-evolution", "Everstone evolution prevention", "action", "declaration",
        action_predicate("evolution", "target"),
        {"kind": "prevent-action", "actionId": "evolution", "reasonCode": "equipment.everstone.prevent-evolution"},
        priority=100,
    )],
    "Eviolite": [provider(
        "equipment.eviolite.prevent-evolution", "Eviolite evolution prevention", "action", "declaration",
        action_predicate("evolution", "target"),
        {"kind": "prevent-action", "actionId": "evolution", "reasonCode": "equipment.eviolite.prevent-evolution"},
        priority=100,
    )],
    "Flame Orb": [
        provider(
            "equipment.flame-orb.equip-burn", "Flame Orb burn", "item", "after-commit",
            item_predicate("equipped"),
            {"kind": "apply-condition", "conditionId": "Burned", "duration": "persistent",
             "reasonCode": "equipment.flame-orb.induced-burn"},
            priority=60,
        ),
        provider(
            "equipment.flame-orb.turn-burn", "Flame Orb burn", "lifecycle", "lifecycle",
            lifecycle_predicate("turn", "started"),
            {"kind": "apply-condition", "conditionId": "Burned", "duration": "persistent",
             "reasonCode": "equipment.flame-orb.induced-burn"},
            priority=60,
        ),
    ],
    "Focus Band": [provider(
        "equipment.focus-band.prevent-faint", "Focus Band", "hp", "pre-effect",
        hp_predicate(changes=["damage", "recoil", "cost", "set"], faint=["fainted"]),
        {"kind": "survive-at-one", "roll": {"sides": 20, "minimum": 16},
         "requiresMoveDamageFromMaximum": False, "reasonCode": "equipment.focus-band.prevent-faint"},
        priority=95,
        provider_frequency=frequency("scene", "on-applied"),
    )],
    "Focus Sash": [provider(
        "equipment.focus-sash.prevent-faint", "Focus Sash", "hp", "pre-effect",
        hp_predicate(changes=["damage"], faint=["fainted"], before_at_maximum=True, move_sourced=True),
        {"kind": "survive-at-one", "roll": None, "requiresMoveDamageFromMaximum": True,
         "reasonCode": "equipment.focus-sash.prevent-faint"},
        priority=96,
        provider_frequency=frequency("scene", "on-applied"),
    )],
    "Go-Goggles": [provider(
        "equipment.go-goggles.sandstorm-immunity", "Go-Goggles", "hp", "pre-effect",
        hp_predicate(changes=["damage"], reason_codes=["weather.sandstorm.round-end-residual"]),
        {"kind": "prevent-hp-change", "reasonCode": "equipment.go-goggles.sandstorm-immunity"},
        priority=85,
    )],
    "Iron Ball": [provider(
        "equipment.iron-ball.ground-immunity-loss", "Iron Ball grounding", "movement", "pre-effect",
        {"kind": "movement", "ownerRole": "subject", "checkpoints": ["pre-step"]},
        {"kind": "remove-type-immunity", "typeId": "ground", "reasonCode": "equipment.iron-ball.ground-immunity-loss"},
        priority=75,
    )],
    "King’s Rock": [provider(
        "equipment.kings-rock.flinch", "King’s Rock", "strike", "post-effect",
        strike_predicate(role="attacker", timings=["accuracy-resolved"], natural_minimum=19),
        {"kind": "apply-condition", "conditionId": "Flinch", "duration": "turn",
         "reasonCode": "equipment.kings-rock.flinch"},
        priority=30,
    )],
    "Life Orb": [provider(
        "equipment.life-orb.recoil", "Life Orb recoil", "strike", "post-effect",
        strike_predicate(role="attacker", timings=["damage-resolved"], minimum_loss=1, direct_only=True),
        {"kind": "lose-max-hp-fraction", "numerator": 1, "denominator": 16,
         "reasonCode": "equipment.life-orb.recoil"},
        priority=-20,
    )],
    "Razor Fang": [provider(
        "equipment.razor-fang.injury", "Razor Fang", "strike", "post-effect",
        strike_predicate(role="attacker", timings=["accuracy-resolved"], natural_minimum=19),
        {"kind": "add-injury", "amount": 1, "reasonCode": "equipment.razor-fang.injury"},
        priority=29,
    )],
    "Safety Goggles": [provider(
        "equipment.safety-goggles.powder-immunity", "Safety Goggles", "move", "pre-effect",
        move_predicate(role="target", timings=["use-started"], keywords_any=["powder"]),
        {"kind": "prevent-move", "reasonCode": "equipment.safety-goggles.powder-immunity"},
        priority=85,
    )],
    "Shell Bell": [provider(
        "equipment.shell-bell.temporary-hp", "Shell Bell", "strike", "post-effect",
        strike_predicate(role="attacker", timings=["damage-resolved"], minimum_loss=1, relationship="foe"),
        {"kind": "gain-temporary-hp-ticks", "ticks": 1, "reasonCode": "equipment.shell-bell.temporary-hp"},
        priority=-10,
    )],
    "Toxic Orb": [
        provider(
            "equipment.toxic-orb.equip-poison", "Toxic Orb poison", "item", "after-commit",
            item_predicate("equipped"),
            {"kind": "apply-condition", "conditionId": "Poisoned", "duration": "persistent",
             "reasonCode": "equipment.toxic-orb.induced-poison"},
            priority=60,
        ),
        provider(
            "equipment.toxic-orb.turn-poison", "Toxic Orb poison", "lifecycle", "lifecycle",
            lifecycle_predicate("turn", "started"),
            {"kind": "apply-condition", "conditionId": "Poisoned", "duration": "persistent",
             "reasonCode": "equipment.toxic-orb.induced-poison"},
            priority=60,
        ),
    ],
    "Winter Cloak": [provider(
        "equipment.winter-cloak.hail-immunity", "Winter Cloak", "hp", "pre-effect",
        hp_predicate(changes=["damage"], reason_codes=["weather.hail.round-end-residual"]),
        {"kind": "prevent-hp-change", "reasonCode": "equipment.winter-cloak.hail-immunity"},
        priority=85,
    )],
    "Light Shield": [provider(
        "equipment.light-shield.ready", "Readied Light Shield", "action", "post-effect",
        action_predicate("equipment.light-shield.ready", "actor"),
        {"kind": "apply-readied-shield", "evasion": 4, "damageReduction": 10,
         "conditionId": "Slowed", "duration": "through-next-turn",
         "reasonCode": "equipment.light-shield.ready"},
        priority=40,
    )],
    "Heavy Shield": [provider(
        "equipment.heavy-shield.ready", "Readied Heavy Shield", "action", "post-effect",
        action_predicate("equipment.heavy-shield.ready", "actor"),
        {"kind": "apply-readied-shield", "evasion": 6, "damageReduction": 15,
         "conditionId": "Slowed", "duration": "through-next-turn",
         "reasonCode": "equipment.heavy-shield.ready"},
        priority=40,
    )],
    "Shock Collar": [provider(
        "equipment.shock-collar.activate", "Shock Collar", "action", "post-effect",
        action_predicate("equipment.shock-collar.activate", "target"),
        {"kind": "lose-max-hp-fraction", "numerator": 1, "denominator": 6,
         "reasonCode": "equipment.shock-collar.activation"},
        priority=20,
    )],
    "Type Gem": [provider(
        "equipment.type-gem.empower", "Type Gem", "move", "declaration",
        move_predicate(role="user", timings=["declared"], damage_classes=["physical", "special"], configured_type=True),
        {"kind": "consume-source-and-add-damage-base", "amount": 3,
         "reasonCode": "equipment.type-gem.empower"},
        priority=50,
        response="optional",
        choice=owner_choice(("activate", "Consume Type Gem"), ("pass", "Do not use")),
        source_visibility="owner-gm",
    )],
}


def build_document() -> dict[str, Any]:
    raw = ITEMS_PATH.read_bytes()
    if hashlib.sha256(raw).hexdigest() != CATALOG_SHA256:
        raise RuntimeError("Canonical item catalog changed; review event providers before regeneration")
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
            "providers": PROVIDERS.get(canonical_id, []),
        })
    unknown = set(PROVIDERS) - set(expected_ids)
    if unknown:
        raise RuntimeError(f"Provider adjudications reference unknown equipment: {sorted(unknown)}")
    providers = [entry for definition in definitions for entry in definition["providers"]]
    return {
        "schemaVersion": 1,
        "ticket": "P8-048",
        "catalogSha256": CATALOG_SHA256,
        "equipmentDefinitionsSha256": hashlib.sha256(EQUIPMENT_PATH.read_bytes()).hexdigest(),
        "definitionCount": len(definitions),
        "providingItemCount": sum(1 for definition in definitions if definition["providers"]),
        "providerCount": len(providers),
        "classificationPolicy": {
            "status": "reviewed",
            "runtimeProseParsing": False,
            "inactiveOrSuppressedPolicy": "withdraw-future-subscriptions-immediately",
            "acceptedEffectPolicy": "accepted-durable-effects-survive-source-loss",
            "eventAuthority": "typed-server-events-only",
            "replayPolicy": "receipt-bound-no-reroll",
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
            raise SystemExit("equipment-event-providers.v1.json is stale; regenerate it")
        return
    OUTPUT_PATH.write_text(rendered, encoding="utf-8")


if __name__ == "__main__":
    main()
