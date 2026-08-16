#!/usr/bin/env python3
"""Generate/check the reviewed P8-057 exploration-item contract."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
RULES = ROOT / "data/reference/rules.json"
ITEMS = ROOT / "data/reference/items.json"
FEATURES = ROOT / "data/reference/features.json"
SPECS = ROOT / "data/complete-play-loop/specs.v1.json"
REVIEW = ROOT / "scripts/reviewed-data/exploration-items.v1.json"
REMEDIATION = ROOT / "data/complete-play-loop/canonical-data-remediation.v1.json"
OUTPUT = ROOT / "data/complete-play-loop/exploration-items.v1.json"
RULES_SHA256 = "94e0ec0f9a7416d807db892f501215666487357d20ab945b294a21742da6e142"
BASE_SPECS_SHA256 = "bf0a74b237eab416c8b082f7547edb36ceb2c32c673eba1bff7bda4b7a1e7cba"
SPECS_SHA256 = "8526cc06462ab8ea0146c3e2cc9556bb3d50d2505f2d18499b230a04048de1fe"
REVIEW_SHA256 = "c9f023bd817a4f4468f4dc172f470b7a201c60e73892cbf81a7152d932c18a75"
MIGRATION_ID = "rule-data-exploration-item-mechanics-v1"
MIGRATION_AFTER_RULES_SHA256 = "ff0e220165887fec69ce11f70c0db84210ae289a51145196fe885fe0937ce0a8"
SUCCESSOR_MIGRATION_IDS = [
    "rule-data-pokemon-advancement-choices-v1",
    "rule-data-trainer-advancement-choices-v1",
]
RULE_ID = "Exploration Items"
ITEM_IDS = ["Bait", "Fishing Lure", "Honey", "Repel", "Super Repel", "Max Repel", "Dowsing Rod"]


def stable_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_value(value: Any) -> str:
    return sha256_bytes(stable_json(value).encode())


def document() -> dict[str, Any]:
    rules_bytes = RULES.read_bytes()
    specs_bytes = SPECS.read_bytes()
    if sha256_bytes(rules_bytes) != RULES_SHA256:
        raise RuntimeError("Canonical rules catalog changed; review exploration items before regeneration")
    if sha256_bytes(specs_bytes) != SPECS_SHA256:
        raise RuntimeError("Reviewed ItemSpec document changed; review exploration items before regeneration")
    if sha256_bytes(REVIEW.read_bytes()) != REVIEW_SHA256:
        raise RuntimeError("Reviewed exploration-item transcription changed")
    rules = json.loads(rules_bytes)
    items = json.loads(ITEMS.read_text(encoding="utf-8"))
    features = json.loads(FEATURES.read_text(encoding="utf-8"))
    specs = json.loads(specs_bytes)
    review = json.loads(REVIEW.read_text(encoding="utf-8"))
    remediation = json.loads(REMEDIATION.read_text(encoding="utf-8"))
    rule = rules[RULE_ID]
    mechanics = rule["itemExplorationMechanics"]
    migration = next((row for row in remediation["reviewedMigrations"] if row.get("migrationId") == MIGRATION_ID), None)
    if not migration or migration.get("afterFileSha256") != MIGRATION_AFTER_RULES_SHA256 \
            or migration.get("afterRecordSha256") != sha256_value(rule) \
            or migration.get("itemSpecSuccessor", {}).get("afterFileSha256") != BASE_SPECS_SHA256:
        raise RuntimeError("Reviewed exploration-item migration evidence is unavailable or stale")
    item_successor = next((row for row in remediation["reviewedMigrations"]
                           if row.get("migrationId") == "item-black-sludge-acquisition-cost-v1"), None)
    if not item_successor \
            or item_successor.get("beforeItemSpecsSha256") != BASE_SPECS_SHA256 \
            or item_successor.get("afterItemSpecsSha256") != SPECS_SHA256:
        raise RuntimeError("Reviewed ItemSpec successor chain is unavailable or stale")
    current_rules_sha256 = MIGRATION_AFTER_RULES_SHA256
    for migration_id in SUCCESSOR_MIGRATION_IDS:
        successor = next((row for row in remediation["reviewedMigrations"] if row.get("migrationId") == migration_id), None)
        if not successor or successor.get("beforeFileSha256") != current_rules_sha256:
            raise RuntimeError("Reviewed exploration-item successor chain is unavailable or stale")
        current_rules_sha256 = successor.get("afterFileSha256")
    if current_rules_sha256 != RULES_SHA256:
        raise RuntimeError("Reviewed exploration-item successor chain does not reach current rules")
    if mechanics != {"schemaVersion": 1, **review["mechanics"]}:
        raise RuntimeError("Canonical exploration authority disagrees with reviewed transcription")
    spec_rows = {row["canonicalId"]: row for row in specs["specs"] if row.get("canonicalId") in ITEM_IDS}
    if set(spec_rows) != set(ITEM_IDS):
        raise RuntimeError("Exploration ItemSpec roster is incomplete")
    item_rows = []
    for canonical_id in ITEM_IDS:
        item = items[canonical_id]
        spec = spec_rows[canonical_id]
        if spec["recordSha256"] != sha256_value(item) \
                or spec["effectSha256"] != sha256_bytes("\n".join(item["effects"]).encode()):
            raise RuntimeError(f"Exploration ItemSpec evidence drifted for {canonical_id}")
        item_rows.append({
            "canonicalId": canonical_id,
            "recordSha256": sha256_value(item),
            "effectSha256": sha256_bytes("\n".join(item["effects"]).encode()),
            "reviewedEffect": spec["effect"],
        })
    return {
        "schemaVersion": 1,
        "ticket": "P8-057",
        "status": "reviewed-native",
        "canonicalAuthority": {
            "rules": {
                "path": "data/reference/rules.json",
                "fileSha256": RULES_SHA256,
                "recordSha256": sha256_value(rule),
                "migrationId": MIGRATION_ID,
                "catalogSuccessorMigrationIds": SUCCESSOR_MIGRATION_IDS,
            },
            "items": {
                "path": "data/reference/items.json",
                "fileSha256": sha256_bytes(ITEMS.read_bytes()),
                "shardsRecordSha256": sha256_value(items["Shards"]),
            },
            "features": {
                "path": "data/reference/features.json",
                "fileSha256": sha256_bytes(FEATURES.read_bytes()),
                "crystalResonanceRecordSha256": sha256_value(features["Crystal Resonance"]),
            },
            "specs": {
                "path": "data/complete-play-loop/specs.v1.json",
                "fileSha256": SPECS_SHA256,
            },
            "runtimeDocumentaryParsingForbidden": True,
        },
        "reviewedTranscription": {
            "path": "scripts/reviewed-data/exploration-items.v1.json",
            "fileSha256": REVIEW_SHA256,
            "runtimeAuthority": False,
            "reviewStatus": review["reviewStatus"],
            "reviewMethod": review["reviewMethod"],
        },
        "sourceEvidence": review["sourceEvidence"],
        "policy": {
            "routeLureClock": "campaign-minute-checks-at-fifteen-minute-boundaries",
            "routeEncounter": "bounded-gm-comparable-party-level-prompt",
            "wildIdentity": "exact-map-wild-placement-only",
            "repelPositioning": "server-hit-and-forfeit-with-bounded-gm-positioning-prompt",
            "dowsingArea": "gm-confirmed-route-cave-or-outside-area",
            "dowsingRewards": "atomic-color-preserving-shard-inventory-grants",
            "privacy": "public-consequence-owner-or-gm-detail-private-provenance",
            "replay": "exact-command-idempotency-and-current-authority-revalidation",
        },
        "itemCount": len(item_rows),
        "items": item_rows,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    expected = json.dumps(document(), ensure_ascii=False, indent=2) + "\n"
    if args.check:
        if not OUTPUT.exists() or OUTPUT.read_text(encoding="utf-8") != expected:
            raise SystemExit("Generated exploration-item contract is missing or stale.")
        print("Exploration-item contract check passed: 7 canonical items.")
        return
    OUTPUT.write_text(expected, encoding="utf-8")
    print(f"Generated {OUTPUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
