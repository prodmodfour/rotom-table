#!/usr/bin/env python3
"""Apply/check the reviewed Pokémon Contest canonical-data migration.

Documentary markdown is read only by this migration tool. Runtime code consumes
only the resulting app-owned data/reference/*.json files.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import unicodedata
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = ROOT / "scripts/reviewed-data/pokemon-contests.v1.json"
DEFERRED_CLOSURE_SUCCESSOR_PATH = ROOT / "scripts/reviewed-data/deferred-closure-contest-variants.v1.json"
BATTLE_CONTEST_EFFECTS_SUCCESSOR_PATH = ROOT / "scripts/reviewed-data/deferred-closure-battle-contest-effects.v1.json"
BATTLE_CONTEST_VOLTAGE_LIFECYCLE_SUCCESSOR_PATH = ROOT / "scripts/reviewed-data/deferred-closure-battle-contest-voltage-lifecycle.v1.json"
BATTLE_CONTEST_SETTLEMENT_SUCCESSOR_PATH = ROOT / "scripts/reviewed-data/deferred-closure-battle-contest-settlement.v1.json"
BATTLE_CONTEST_ACTIVATION_SUCCESSOR_PATH = ROOT / "scripts/reviewed-data/deferred-closure-battle-contest-activation.v1.json"
DEFERRED_CLOSURE_SUCCESSOR_CHAIN_PATH = ROOT / "data/deferred-closure/successor-chain.v1.json"
MOVES_PATH = ROOT / "data/reference/moves.json"
ITEMS_PATH = ROOT / "data/reference/items.json"
CONTESTS_PATH = ROOT / "data/reference/contests.json"
EQUIPMENT_DEFINITIONS_PATH = ROOT / "data/complete-play-loop/equipment-definitions.v1.json"

MOVE_SOURCE_PATHS = [
    "books/markdown/arceus_references.md",
    "books/markdown/swsh_-_armor_crown_references.md",
    "books/markdown/sumo_references.md",
    "books/markdown/errata-3.md",
    "books/markdown/errata-2.md",
    "books/markdown/core/10-indices-and-reference.md",
]

TYPE_IDS = {
    "beauty": "beauty",
    "cool": "cool",
    "cute": "cute",
    "smart": "smart",
    "tough": "tough",
}

EFFECT_IDS = {
    "attention grabber": "attention-grabber",
    "big show": "big-show",
    "catching up": "catching-up",
    "desperation": "desperation",
    "double time": "double-time",
    "excitement": "excitement",
    "exhausting act": "exhausting-act",
    "gamble": "gamble",
    "get ready": "get-ready",
    "good show": "good-show",
    "incentives": "incentives",
    "inversed appeal": "inversed-appeal",
    "reflective appeal": "reflective-appeal",
    "reliable": "reliable",
    "sabotage": "sabotage",
    "safe option": "safe-option",
    "saving grace": "saving-grace",
    "seen nothing yet": "seen-nothing-yet",
    "special attention": "special-attention",
    "steady performance": "steady-performance",
    "tease": "tease",
    "unsettling": "unsettling",
}

EXPECTED_DEFINED_COUNT = 761
EXPECTED_UNAVAILABLE_COUNT = 16


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def git_blob_bytes(data: bytes) -> str:
    return hashlib.sha1(f"blob {len(data)}\0".encode("ascii") + data).hexdigest()


def source_sha256(path: str) -> str:
    return sha256_bytes((ROOT / path).read_bytes())


def canonical_key(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value)
    without_marks = "".join(char for char in normalized if not unicodedata.combining(char))
    return re.sub(r"[^a-z0-9]+", "-", without_marks.lower()).strip("-")


def normalized_effect_label(value: str) -> str:
    return re.sub(r"[!\s]+$", "", value.strip()).lower()


def load_manifest() -> dict[str, Any]:
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    if manifest.get("migrationId") != "pokemon-contests:v1" or manifest.get("status") != "reviewed":
        raise RuntimeError("Pokémon Contest migration manifest is not the reviewed v1 manifest")
    for source in manifest["sources"]:
        actual = source_sha256(source["path"])
        if actual != source["sha256"]:
            raise RuntimeError(f"stale source fingerprint for {source['path']}: expected {source['sha256']}, got {actual}")
    return manifest


def parse_documentary_move_identities(manifest: dict[str, Any]) -> dict[str, dict[str, str]]:
    source_hashes = {source["path"]: source["sha256"] for source in manifest["sources"]}
    identities: dict[str, dict[str, str]] = {}
    for source_path in MOVE_SOURCE_PATHS:
        text = (ROOT / source_path).read_text(encoding="utf-8")
        for block in re.split(r"^Move: ", text, flags=re.MULTILINE)[1:]:
            lines = block.strip().splitlines()
            if not lines:
                continue
            name = lines[0].strip()
            body = "\n".join(lines[1:])
            key = canonical_key(name)
            if key in identities:
                continue  # Sources are newest/highest priority first.
            contest_type_match = re.search(r"^Contest Type:\s*(.+)$", body, flags=re.MULTILINE)
            contest_effect_match = re.search(r"^Contest Effect:\s*(.+)$", body, flags=re.MULTILINE)
            if not contest_type_match and not contest_effect_match:
                continue
            if not contest_type_match or not contest_effect_match:
                raise RuntimeError(f"partial contest identity for documentary Move {name!r} in {source_path}")
            type_label = contest_type_match.group(1).strip()
            effect_label = contest_effect_match.group(1).strip()
            type_id = TYPE_IDS.get(type_label.lower())
            effect_id = EFFECT_IDS.get(normalized_effect_label(effect_label))
            if not type_id or not effect_id:
                raise RuntimeError(f"unknown contest identity for {name!r}: {type_label!r} / {effect_label!r}")
            identities[key] = {
                "typeId": type_id,
                "effectId": effect_id,
                "typeLabel": type_label,
                "effectLabel": effect_label,
                "source": source_path,
                "sourceSha256": source_hashes[source_path],
            }
    return identities


def expected_moves(current: dict[str, Any], manifest: dict[str, Any]) -> dict[str, Any]:
    identities = parse_documentary_move_identities(manifest)
    output: dict[str, Any] = {}
    defined = 0
    unavailable = 0
    for name, raw in current.items():
        move = dict(raw)
        identity = identities.get(canonical_key(name))
        if identity:
            defined += 1
            move["contest"] = {
                "schemaVersion": 1,
                "status": "defined",
                "typeId": identity["typeId"],
                "effectId": identity["effectId"],
                "typeLabel": identity["typeLabel"],
                "effectLabel": identity["effectLabel"],
                "tags": (["sonic"] if re.search(r"(?:^|[, ]+)Sonic(?:[, ]+|$)", str(move.get("range", "")), flags=re.IGNORECASE) else []),
                "source": identity["source"],
                "sourceSha256": identity["sourceSha256"],
                "reviewedMigrationId": "pokemon-contests:v1",
            }
        else:
            unavailable += 1
            reason = (
                "struggle-attacks-are-not-moves"
                if name == "Struggle" or name.startswith("Struggle (")
                else "no-reviewed-documentary-contest-identity"
            )
            move["contest"] = {
                "schemaVersion": 1,
                "status": "unavailable",
                "reasonCode": reason,
                "safeReason": (
                    "Struggle Attacks are not Moves and have no Contest identity."
                    if reason == "struggle-attacks-are-not-moves"
                    else "No reviewed canonical Contest identity is available for this move."
                ),
                "reviewedMigrationId": "pokemon-contests:v1",
            }
        output[name] = move
    if defined != EXPECTED_DEFINED_COUNT or unavailable != EXPECTED_UNAVAILABLE_COUNT:
        raise RuntimeError(
            f"contest Move coverage drift: expected {EXPECTED_DEFINED_COUNT}/{EXPECTED_UNAVAILABLE_COUNT} "
            f"defined/unavailable, got {defined}/{unavailable}"
        )
    return output


def expected_items(current: dict[str, Any]) -> dict[str, Any]:
    output = {name: dict(value) for name, value in current.items() if name != "Poffin"}
    item_mechanics = {
        "Poffin Mixer": {
            "schemaVersion": 1,
            "kind": "guided-crafting",
            "outputItemId": "Poffin",
            "ingredientMoneyCost": 500,
            "outputQuantity": 2,
            "choiceRequired": "contest-stat-from-reviewed-berry-mapping",
            "reviewedBerryStatMapping": {
                "cool": ["Cheri Berry", "Figy Berry", "Razz Berry", "Spelon Berry", "Belue Berry"],
                "beauty": ["Chesto Berry", "Wiki Berry", "Bluk Berry", "Spelon Berry", "Pamtre Berry"],
                "cute": ["Pecha Berry", "Mago Berry", "Nanab Berry", "Pamtre Berry", "Watmel Berry"],
                "smart": ["Rawst Berry", "Aguav Berry", "Wepear Berry", "Watmel Berry", "Durin Berry"],
                "tough": ["Aspear Berry", "Iapapa Berry", "Pinap Berry", "Durin Berry", "Belue Berry"],
            },
        },
        "Fancy Clothes": {
            "schemaVersion": 1,
            "kind": "trainer-introduction-bonus",
            "bonusDice": 2,
            "contestStatChoiceRequired": True,
        },
        "Contest Accessory": {
            "schemaVersion": 1,
            "kind": "pokemon-introduction-bonus",
            "bonusDice": 2,
            "contestStatChoiceRequired": True,
        },
        "Contest Fashion": {
            "schemaVersion": 1,
            "kind": "appeal-reroll-ones",
            "usesPerContest": 1,
            "contestStatChoiceRequired": True,
        },
    }
    for item_name, mechanics in item_mechanics.items():
        if item_name not in output:
            raise RuntimeError(f"canonical contest item {item_name!r} is missing")
        output[item_name]["contestMechanics"] = mechanics
    output["Poffin"] = {
        "name": "Poffin",
        "categories": ["Food", "Contest Item"],
        "effects": [
            "When consumed through the authoritative preparation workflow, choose one Contest Stat. The Pokémon permanently gains +1 die in that stat, subject to its lifetime Poffin allowance."
        ],
        "costs": ["$500"],
        "sections": ["Food"],
        "aliases": ["Poffins"],
        "notes": ["The chosen Contest Stat is structured per item unit and is never inferred from free-form inventory text."],
        "source": "pokemon-contests:v1 reviewed migration",
        "contestMechanics": {
            "schemaVersion": 1,
            "kind": "poffin",
            "contestStatChoiceRequired": True,
            "contestDiceGranted": 1,
            "consumptionPhase": "accepted-preparation-operation",
            "acquisitionCost": 500,
        },
    }
    return output


def expected_contests(
    current: dict[str, Any],
    battle_effect_review: dict[str, Any],
    battle_voltage_review: dict[str, Any],
    battle_settlement_review: dict[str, Any],
    battle_activation_review: dict[str, Any],
) -> dict[str, Any]:
    output = json.loads(json.dumps(current))
    variants = [row for row in output.get("variants", []) if row.get("id") == "battle"]
    if len(variants) != 1:
        raise RuntimeError("contests derivative requires exactly one Battle Contest row")
    effect_policy = battle_effect_review.get("contestEffectPolicy")
    voltage_policy = battle_voltage_review.get("voltagePolicy")
    settlement_policy = battle_settlement_review.get("settlementPolicy")
    activation_policy = battle_activation_review.get("activationPolicy")
    if not isinstance(effect_policy, dict):
        raise RuntimeError("Battle Contest effect review has no typed policy")
    if not isinstance(voltage_policy, dict):
        raise RuntimeError("Battle Contest voltage lifecycle review has no typed policy")
    if not isinstance(settlement_policy, dict):
        raise RuntimeError("Battle Contest settlement review has no typed policy")
    if not isinstance(activation_policy, dict) or activation_policy.get("afterCompletionState") != "native":
        raise RuntimeError("Battle Contest activation review has no native completion policy")
    variants[0]["contestEffectPolicy"] = json.loads(json.dumps(effect_policy))
    variants[0]["voltagePolicy"] = json.loads(json.dumps(voltage_policy))
    variants[0]["settlementPolicy"] = json.loads(json.dumps(settlement_policy))
    variants[0]["completionState"] = activation_policy["afterCompletionState"]
    return output


def validate_battle_effect_review(review: dict[str, Any]) -> None:
    if (
        review.get("schemaVersion") != 1
        or review.get("migrationId") != "deferred-closure:battle-contest-effects:v1"
        or review.get("ticket") != "P11-070"
        or review.get("status") != "reviewed"
    ):
        raise RuntimeError("Battle Contest effect review identity is invalid")
    sources = review.get("sources")
    if not isinstance(sources, list) or not sources:
        raise RuntimeError("Battle Contest effect review has no source fingerprints")
    for source in sources:
        path = ROOT / str(source.get("path", ""))
        if not path.is_file() or sha256_bytes(path.read_bytes()) != source.get("sha256"):
            raise RuntimeError(f"Battle Contest effect source fingerprint drift for {source.get('path')}")
    target = review.get("target", {})
    successor = json.loads(BATTLE_CONTEST_VOLTAGE_LIFECYCLE_SUCCESSOR_PATH.read_text(encoding="utf-8"))
    if (
        target.get("path") != str(CONTESTS_PATH.relative_to(ROOT))
        or target.get("afterSha256") != successor.get("target", {}).get("beforeSha256")
    ):
        raise RuntimeError("Battle Contest effect target is not the accepted voltage-lifecycle predecessor")


def validate_battle_voltage_review(review: dict[str, Any]) -> None:
    if (
        review.get("schemaVersion") != 1
        or review.get("migrationId") != "deferred-closure:battle-contest-voltage-lifecycle:v1"
        or review.get("ticket") != "P11-072"
        or review.get("status") != "reviewed"
    ):
        raise RuntimeError("Battle Contest voltage lifecycle review identity is invalid")
    sources = review.get("sources")
    if not isinstance(sources, list) or len(sources) != 2:
        raise RuntimeError("Battle Contest voltage lifecycle review has incomplete source fingerprints")
    for source in sources:
        path = ROOT / str(source.get("path", ""))
        if not path.is_file() or sha256_bytes(path.read_bytes()) != source.get("sha256"):
            raise RuntimeError(f"Battle Contest voltage source fingerprint drift for {source.get('path')}")
    target = review.get("target", {})
    successor = json.loads(BATTLE_CONTEST_SETTLEMENT_SUCCESSOR_PATH.read_text(encoding="utf-8"))
    if (
        target.get("path") != str(CONTESTS_PATH.relative_to(ROOT))
        or target.get("afterSha256") != successor.get("target", {}).get("beforeSha256")
    ):
        raise RuntimeError("Battle Contest voltage lifecycle target is not the accepted settlement predecessor")
    policy = review.get("voltagePolicy", {})
    if policy.get("jugglerRecallExceptionProviderIds") != ["feature:Quick Switch", "feature:Round Trip"]:
        raise RuntimeError("Battle Contest Juggler recall exceptions are not explicit reviewed providers")


def validate_battle_settlement_review(review: dict[str, Any]) -> None:
    if (
        review.get("schemaVersion") != 1
        or review.get("migrationId") != "deferred-closure:battle-contest-settlement:v1"
        or review.get("ticket") != "P11-077"
        or review.get("status") != "reviewed"
    ):
        raise RuntimeError("Battle Contest settlement review identity is invalid")
    sources = review.get("sources")
    if not isinstance(sources, list) or len(sources) != 1:
        raise RuntimeError("Battle Contest settlement review has incomplete source fingerprints")
    for source in sources:
        path = ROOT / str(source.get("path", ""))
        if not path.is_file() or sha256_bytes(path.read_bytes()) != source.get("sha256"):
            raise RuntimeError(f"Battle Contest settlement source fingerprint drift for {source.get('path')}")
    target = review.get("target", {})
    activation = json.loads(BATTLE_CONTEST_ACTIVATION_SUCCESSOR_PATH.read_text(encoding="utf-8"))
    activation_target = activation.get("target", {})
    if (
        target.get("path") != str(CONTESTS_PATH.relative_to(ROOT))
        or activation_target.get("path") != target.get("path")
        or activation_target.get("beforeBytes") != target.get("afterBytes")
        or activation_target.get("beforeSha256") != target.get("afterSha256")
        or activation_target.get("beforeGitBlob") != target.get("afterGitBlob")
    ):
        raise RuntimeError("Battle Contest settlement target is not the reviewed native-activation predecessor")
    policy = review.get("settlementPolicy", {})
    if (
        policy.get("experienceRecipients") != "all-declared-team-pokemon"
        or policy.get("encounterReconciliation") != "exact-preview-one-combined-transaction"
        or policy.get("duplicateSourcePolicy") != "exact-retry-or-reject"
    ):
        raise RuntimeError("Battle Contest settlement policy is not exact reviewed authority")


def validate_battle_activation_review(review: dict[str, Any]) -> None:
    if (
        review.get("schemaVersion") != 1
        or review.get("migrationId") != "deferred-closure:battle-contest-native-activation:v1"
        or review.get("ticket") != "P11-080"
        or review.get("status") != "reviewed"
        or review.get("runtimeProseParsing") is not False
    ):
        raise RuntimeError("Battle Contest native activation review identity is invalid")
    sources = review.get("sources")
    if not isinstance(sources, list) or len(sources) != 1:
        raise RuntimeError("Battle Contest native activation review has incomplete source fingerprints")
    for source in sources:
        path = ROOT / str(source.get("path", ""))
        if not path.is_file() or sha256_bytes(path.read_bytes()) != source.get("sha256"):
            raise RuntimeError(f"Battle Contest activation source fingerprint drift for {source.get('path')}")
    target = review.get("target", {})
    data = CONTESTS_PATH.read_bytes()
    if (
        target.get("path") != str(CONTESTS_PATH.relative_to(ROOT))
        or target.get("afterBytes") != len(data)
        or target.get("afterSha256") != sha256_bytes(data)
        or target.get("afterGitBlob") != git_blob_bytes(data)
    ):
        raise RuntimeError("Battle Contest native activation target fingerprint drift")
    policy = review.get("activationPolicy", {})
    if (
        policy.get("beforeCompletionState") != "structured"
        or policy.get("afterCompletionState") != "native"
        or policy.get("requiredTicketRange") != ["P11-065", "P11-080"]
        or policy.get("runtimeProseParsing") is not False
        or policy.get("parallelMechanicsEngines") != 0
    ):
        raise RuntimeError("Battle Contest native activation policy is incomplete")


def expected_equipment_definitions(current: dict[str, Any], items: dict[str, Any]) -> dict[str, Any]:
    output = json.loads(json.dumps(current))
    changed_ids = {"Fancy Clothes", "Contest Accessory", "Contest Fashion"}
    rows = {row.get("canonicalItemId"): row for row in output.get("definitions", [])}
    for item_id in changed_ids:
        if item_id not in rows or item_id not in items:
            raise RuntimeError(f"equipment derivative is missing {item_id}")
        canonical = json.dumps(items[item_id], ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        rows[item_id]["canonicalRecordSha256"] = sha256_bytes(canonical.encode("utf-8"))
    return output


def raw_base_hash_ok(path: Path, target: dict[str, Any], current: dict[str, Any]) -> bool:
    if any("contest" in row for row in current.values() if isinstance(row, dict)) or "Poffin" in current:
        return True
    return sha256_bytes(path.read_bytes()) == target["baseSha256"]


def dump(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def validate_reviewed_targets(manifest: dict[str, Any]) -> None:
    for target in manifest["targets"]:
        path = ROOT / target["path"]
        data = path.read_bytes()
        exact_baseline = (
            target.get("afterBytes") == len(data)
            and target.get("afterSha256") == sha256_bytes(data)
            and target.get("afterGitBlob") == git_blob_bytes(data)
        )
        if exact_baseline:
            continue
        if target["path"] == "data/reference/contests.json" and DEFERRED_CLOSURE_SUCCESSOR_PATH.exists():
            successor = json.loads(DEFERRED_CLOSURE_SUCCESSOR_PATH.read_text(encoding="utf-8"))
            successor_target = successor.get("target", {})
            if (
                successor.get("status") == "reviewed"
                and successor.get("migrationId") == "deferred-closure:contest-variants:v1"
                and successor_target.get("beforeSha256") == target.get("afterSha256")
                and successor_target.get("afterBytes") == len(data)
                and successor_target.get("afterSha256") == sha256_bytes(data)
                and successor_target.get("afterGitBlob") == git_blob_bytes(data)
            ):
                continue
            if DEFERRED_CLOSURE_SUCCESSOR_CHAIN_PATH.exists():
                chain = json.loads(DEFERRED_CLOSURE_SUCCESSOR_CHAIN_PATH.read_text(encoding="utf-8"))
                edges = [edge for edge in chain.get("edges", []) if edge.get("surface") == target["path"]]
                contiguous = bool(edges) and edges[0].get("beforeSha256") == target.get("afterSha256")
                contiguous = contiguous and all(edges[index].get("beforeSha256") == edges[index - 1].get("afterSha256") for index in range(1, len(edges)))
                if contiguous and all(edge.get("reviewStatus") == "accepted" for edge in edges):
                    if edges[-1].get("afterSha256") == sha256_bytes(data):
                        continue
                    if BATTLE_CONTEST_ACTIVATION_SUCCESSOR_PATH.exists():
                        activation = json.loads(BATTLE_CONTEST_ACTIVATION_SUCCESSOR_PATH.read_text(encoding="utf-8"))
                        activation_target = activation.get("target", {})
                        if (
                            activation.get("status") == "reviewed"
                            and activation_target.get("beforeSha256") == edges[-1].get("afterSha256")
                            and activation_target.get("afterSha256") == sha256_bytes(data)
                            and activation_target.get("afterBytes") == len(data)
                            and activation_target.get("afterGitBlob") == git_blob_bytes(data)
                        ):
                            continue
                    if BATTLE_CONTEST_VOLTAGE_LIFECYCLE_SUCCESSOR_PATH.exists():
                        voltage = json.loads(BATTLE_CONTEST_VOLTAGE_LIFECYCLE_SUCCESSOR_PATH.read_text(encoding="utf-8"))
                        voltage_target = voltage.get("target", {})
                        if (
                            voltage.get("status") == "reviewed"
                            and voltage_target.get("beforeSha256") == edges[-1].get("afterSha256")
                            and voltage_target.get("afterSha256") == sha256_bytes(data)
                            and voltage_target.get("afterBytes") == len(data)
                            and voltage_target.get("afterGitBlob") == git_blob_bytes(data)
                        ):
                            continue
                    if BATTLE_CONTEST_SETTLEMENT_SUCCESSOR_PATH.exists():
                        settlement = json.loads(BATTLE_CONTEST_SETTLEMENT_SUCCESSOR_PATH.read_text(encoding="utf-8"))
                        settlement_target = settlement.get("target", {})
                        if (
                            settlement.get("status") == "reviewed"
                            and settlement_target.get("beforeSha256") == edges[-1].get("afterSha256")
                            and settlement_target.get("afterSha256") == sha256_bytes(data)
                            and settlement_target.get("afterBytes") == len(data)
                            and settlement_target.get("afterGitBlob") == git_blob_bytes(data)
                        ):
                            continue
                        if BATTLE_CONTEST_ACTIVATION_SUCCESSOR_PATH.exists():
                            activation = json.loads(BATTLE_CONTEST_ACTIVATION_SUCCESSOR_PATH.read_text(encoding="utf-8"))
                            activation_target = activation.get("target", {})
                            if (
                                settlement.get("status") == "reviewed"
                                and settlement_target.get("beforeSha256") == edges[-1].get("afterSha256")
                                and activation.get("status") == "reviewed"
                                and activation_target.get("beforeSha256") == settlement_target.get("afterSha256")
                                and activation_target.get("afterSha256") == sha256_bytes(data)
                                and activation_target.get("afterBytes") == len(data)
                                and activation_target.get("afterGitBlob") == git_blob_bytes(data)
                            ):
                                continue
        raise RuntimeError(f"reviewed target fingerprint drift for {target['path']}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--write", action="store_true", help="write reviewed target data")
    parser.add_argument("--check", action="store_true", help="verify target data without writing")
    args = parser.parse_args()
    if args.write == args.check:
        parser.error("choose exactly one of --write or --check")

    manifest = load_manifest()
    targets = {target["path"]: target for target in manifest["targets"]}
    current_moves = json.loads(MOVES_PATH.read_text(encoding="utf-8"))
    current_items = json.loads(ITEMS_PATH.read_text(encoding="utf-8"))
    current_equipment = json.loads(EQUIPMENT_DEFINITIONS_PATH.read_text(encoding="utf-8"))
    current_contests = json.loads(CONTESTS_PATH.read_text(encoding="utf-8"))
    battle_effect_review = json.loads(BATTLE_CONTEST_EFFECTS_SUCCESSOR_PATH.read_text(encoding="utf-8"))
    battle_voltage_review = json.loads(BATTLE_CONTEST_VOLTAGE_LIFECYCLE_SUCCESSOR_PATH.read_text(encoding="utf-8"))
    battle_settlement_review = json.loads(BATTLE_CONTEST_SETTLEMENT_SUCCESSOR_PATH.read_text(encoding="utf-8"))
    battle_activation_review = json.loads(BATTLE_CONTEST_ACTIVATION_SUCCESSOR_PATH.read_text(encoding="utf-8"))
    if current_contests.get("reviewedMigrationId") != manifest["migrationId"]:
        raise RuntimeError("contests.json is not bound to the reviewed migration")
    reviewed_sources = {source["path"]: source["sha256"] for source in manifest["sources"]}
    contest_sources = current_contests.get("sourceFingerprint", {}).get("sources", [])
    if not contest_sources or any(reviewed_sources.get(source.get("path")) != source.get("sha256") for source in contest_sources):
        raise RuntimeError("contests.json has stale or unreviewed source fingerprints")
    if current_contests.get("performance", {}).get("contestDiceDepletionScope") != "contest":
        raise RuntimeError("contests.json does not preserve whole-Contest dice depletion")
    if any(row.get("completionState") == "blocked" for row in current_contests.get("integrationRows", [])):
        raise RuntimeError("contests.json contains a blocked integration row")
    if not raw_base_hash_ok(MOVES_PATH, targets[str(MOVES_PATH.relative_to(ROOT))], current_moves):
        raise RuntimeError("moves.json does not match the reviewed migration base")
    if not raw_base_hash_ok(ITEMS_PATH, targets[str(ITEMS_PATH.relative_to(ROOT))], current_items):
        raise RuntimeError("items.json does not match the reviewed migration base")

    moves = expected_moves(current_moves, manifest)
    items = expected_items(current_items)
    contests = expected_contests(current_contests, battle_effect_review, battle_voltage_review, battle_settlement_review, battle_activation_review)
    equipment = expected_equipment_definitions(current_equipment, items)
    if args.write:
        dump(MOVES_PATH, moves)
        dump(ITEMS_PATH, items)
        dump(CONTESTS_PATH, contests)
        dump(EQUIPMENT_DEFINITIONS_PATH, equipment)
        validate_battle_effect_review(battle_effect_review)
        validate_battle_voltage_review(battle_voltage_review)
        validate_battle_settlement_review(battle_settlement_review)
        validate_battle_activation_review(battle_activation_review)
        validate_reviewed_targets(manifest)
        print(f"wrote {len(moves)} Move contest identities, {len(items)} canonical items, native Battle Contest authority, and synchronized equipment hashes")
        return 0

    validate_battle_effect_review(battle_effect_review)
    validate_battle_voltage_review(battle_voltage_review)
    validate_battle_settlement_review(battle_settlement_review)
    validate_battle_activation_review(battle_activation_review)
    validate_reviewed_targets(manifest)
    errors: list[str] = []
    if current_moves != moves:
        errors.append("data/reference/moves.json differs from reviewed Pokémon Contest migration")
    if current_items != items:
        errors.append("data/reference/items.json differs from reviewed Pokémon Contest migration")
    if current_contests != contests:
        errors.append("data/reference/contests.json differs from reviewed Battle Contest effect/Voltage/settlement/activation migrations")
    if current_equipment != equipment:
        errors.append("equipment definitions are stale against reviewed Contest item rows")
    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1
    print(f"Pokémon Contest migration check passed ({EXPECTED_DEFINED_COUNT} defined Moves, {EXPECTED_UNAVAILABLE_COUNT} unavailable Moves, {len(items)} items)")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except RuntimeError as error:
        print(f"pokemon contest migration error: {error}", file=sys.stderr)
        raise SystemExit(1)
