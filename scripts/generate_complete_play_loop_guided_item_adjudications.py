#!/usr/bin/env python3
"""Generate the hash-bound P8-059 guided item adjudication contract."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
REVIEWED = ROOT / "scripts/reviewed-data/guided-item-adjudications.v1.json"
ITEMS = ROOT / "data/reference/items.json"
RULES = ROOT / "data/reference/rules.json"
SPECS = ROOT / "data/complete-play-loop/specs.v1.json"
MEDICAL = ROOT / "data/complete-play-loop/medical-extended-actions.v1.json"
EQUIPMENT_DEFINITIONS = ROOT / "data/complete-play-loop/equipment-definitions.v1.json"
EQUIPMENT_GRANTS = ROOT / "data/complete-play-loop/equipment-grants.v1.json"
OUTPUT = ROOT / "data/complete-play-loop/guided-item-adjudications.v1.json"

EXPECTED = {
    REVIEWED: "c68b2785bb9bca914c5d075ef2ed5eaacaaca914f73b8886902fcdd855000e00",
    ITEMS: "842256900ab540c7cdb22c1663d8bb7c89966b8d225cff1a1c5f175ae1e915ef",
    RULES: "94e0ec0f9a7416d807db892f501215666487357d20ab945b294a21742da6e142",
    SPECS: "8526cc06462ab8ea0146c3e2cc9556bb3d50d2505f2d18499b230a04048de1fe",
    MEDICAL: "fd2cddf562e33e0200b793840ab6b0c98523b8a30946bcfbb916d3a07aef5192",
    EQUIPMENT_DEFINITIONS: "08822fc60a549c23123d8519c472fe02cb9681d54372ea42a0d1f914df4a1a2a",
    EQUIPMENT_GRANTS: "466a621c6901a4c0d6c544deae103e82062c75c8fe32d3c84442c1e0c87836bc",
}


def file_sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def stable_json(value: Any) -> str:
    if isinstance(value, dict):
        return "{" + ",".join(
            json.dumps(key, ensure_ascii=False, separators=(",", ":")) + ":" + stable_json(value[key])
            for key in sorted(value)
        ) + "}"
    if isinstance(value, list):
        return "[" + ",".join(stable_json(entry) for entry in value) + "]"
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def value_sha(value: Any) -> str:
    return hashlib.sha256(stable_json(value).encode("utf-8")).hexdigest()


def require_sources() -> None:
    for path, expected in EXPECTED.items():
        actual = file_sha(path)
        if actual != expected:
            raise RuntimeError(f"{path.relative_to(ROOT)} changed ({actual}); reviewed P8-059 migration required")


def build() -> dict[str, Any]:
    require_sources()
    reviewed = json.loads(REVIEWED.read_text(encoding="utf-8"))
    items = json.loads(ITEMS.read_text(encoding="utf-8"))
    rules = json.loads(RULES.read_text(encoding="utf-8"))
    specs = json.loads(SPECS.read_text(encoding="utf-8"))
    medical = json.loads(MEDICAL.read_text(encoding="utf-8"))
    equipment_definitions = json.loads(EQUIPMENT_DEFINITIONS.read_text(encoding="utf-8"))
    equipment_grants = json.loads(EQUIPMENT_GRANTS.read_text(encoding="utf-8"))

    if reviewed.get("schemaVersion") != 1 or reviewed.get("status") != "reviewed" or reviewed.get("runtimeProseParsing") is not False:
        raise RuntimeError("Reviewed guided-item adjudication input has invalid authority markers")
    if value_sha(rules.get("Loyalty")) != "95cf2e2467ac266b285b011aac0622b52f1014ed8dfad36f42a8d1adb57e76d3":
        raise RuntimeError("Canonical Loyalty rule evidence changed")
    if value_sha(rules.get("Using Items")) != "b28291192d6d5b498596316a5e642d486f6007087ab61fd9b58f2506d812c3f9":
        raise RuntimeError("Canonical Using Items evidence changed")

    spec_rows = {row["canonicalId"]: row for row in specs["specs"]}
    for row in reviewed["inventoryItems"]:
        canonical_id = row["canonicalId"]
        if canonical_id not in items or value_sha(items[canonical_id]) != row["canonicalRecordSha256"]:
            raise RuntimeError(f"Canonical item evidence changed for {canonical_id}")
        if canonical_id != "Poultices":
            source = spec_rows.get(canonical_id)
            if not source or source["recordSha256"] != row["canonicalRecordSha256"] \
                    or source["effectSha256"] != row["canonicalEffectSha256"]:
                raise RuntimeError(f"Reviewed deterministic ItemSpec evidence changed for {canonical_id}")

    poultices = medical.get("poultices", {})
    reviewed_poultices = next(row for row in reviewed["inventoryItems"] if row["canonicalId"] == "Poultices")
    if poultices.get("canonicalRecordSha256") != reviewed_poultices["canonicalRecordSha256"] \
            or poultices.get("canonicalEffectSha256") != reviewed_poultices["canonicalEffectSha256"] \
            or poultices.get("sharesBandageTreatment") is not True:
        raise RuntimeError("Reviewed Poultices treatment evidence changed")

    rebreather = reviewed["reBreather"]
    equipment_definition = next(
        (row for row in equipment_definitions["definitions"] if row["canonicalItemId"] == "Re-Breather"), None
    )
    grant_definition = next(
        (row for row in equipment_grants["definitions"] if row["canonicalItemId"] == "Re-Breather"), None
    )
    if not equipment_definition or value_sha(equipment_definition) != rebreather["equipmentDefinitionSha256"]:
        raise RuntimeError("Reviewed Re-Breather equipment definition changed")
    if not grant_definition or value_sha(grant_definition) != rebreather["equipmentGrantDefinitionSha256"]:
        raise RuntimeError("Reviewed Re-Breather grant definition changed")
    if [grant.get("grantId") for grant in grant_definition["grants"]] != [
        "equipment.re-breather.gilled", "equipment.re-breather.activate"
    ]:
        raise RuntimeError("Re-Breather grants are incomplete or reordered")

    return {
        "schemaVersion": 1,
        "ticket": "P8-059",
        "status": "reviewed",
        "reviewId": reviewed["reviewId"],
        "runtimeProseParsing": False,
        "sources": [
            {"path": str(path.relative_to(ROOT)), "fileSha256": EXPECTED[path]}
            for path in EXPECTED
        ],
        "ruleEvidence": {
            "loyaltyRecordSha256": "95cf2e2467ac266b285b011aac0622b52f1014ed8dfad36f42a8d1adb57e76d3",
            "usingItemsRecordSha256": "b28291192d6d5b498596316a5e642d486f6007087ab61fd9b58f2506d812c3f9",
        },
        "loyalty": reviewed["loyalty"],
        "inventoryItems": reviewed["inventoryItems"],
        "consumption": reviewed["consumption"],
        "reBreather": reviewed["reBreather"],
        "boundaries": {
            "declaration": "reserve exact consumable or bind exact equipped instance without applying mechanics",
            "acceptance": "reauthorize current definition, custody, target, revisions, bounded option, and authenticated GM role before one atomic commit",
            "cancellation": "release the exact reservation or close the equipment request without item, HP, condition, Loyalty, capability, action, or clock mutation",
            "replay": "same principal and exact command return the stored terminal projection without reapplying",
            "privacy": "public projections exclude operation IDs, source rows, equipment instance IDs, hashes, profile identities, ownership evidence, raw commands, private Loyalty values, and private receipts",
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    generated = json.dumps(build(), ensure_ascii=False, indent=2) + "\n"
    if args.check:
        if not OUTPUT.exists() or OUTPUT.read_text(encoding="utf-8") != generated:
            raise SystemExit("Guided-item adjudication contract is stale; regenerate it")
        print("Guided-item adjudication contract check passed: 5 inventory items and Re-Breather.")
        return
    OUTPUT.write_text(generated, encoding="utf-8")


if __name__ == "__main__":
    main()
