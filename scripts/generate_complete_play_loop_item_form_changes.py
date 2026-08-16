#!/usr/bin/env python3
"""Generate/check the reviewed P8-056 item-driven form-change contract."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
RULES = ROOT / "data/reference/rules.json"
ITEMS = ROOT / "data/reference/items.json"
POKEDEX = ROOT / "data/reference/pokedex.json"
ABILITIES = ROOT / "data/reference/abilities.json"
REVIEW = ROOT / "scripts/reviewed-data/item-form-changes.v1.json"
REMEDIATION = ROOT / "data/complete-play-loop/canonical-data-remediation.v1.json"
OUTPUT = ROOT / "data/complete-play-loop/item-form-changes.v1.json"
RULES_SHA256 = "94e0ec0f9a7416d807db892f501215666487357d20ab945b294a21742da6e142"
MIGRATION_ID = "rule-data-item-form-change-mechanics-v1"
MIGRATION_AFTER_RULES_SHA256 = "bc0ff520e94cd81e83a77fc1bad5ee005f028452ecf8989ff6f416cefafa99df"
SUCCESSOR_MIGRATION_IDS = [
    "rule-data-exploration-item-mechanics-v1",
    "rule-data-pokemon-advancement-choices-v1",
    "rule-data-trainer-advancement-choices-v1",
]
RULE_ID = "Item-Driven Form Changes"
REVIEW_SHA256 = "36fc31bb3095b0c84bec71b7254ed59384a14c1395bdd84d81f0e9f7b35eefd7"


def stable_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_value(value: Any) -> str:
    return sha256_bytes(stable_json(value).encode())


def document() -> dict[str, Any]:
    rules_bytes = RULES.read_bytes()
    if sha256_bytes(rules_bytes) != RULES_SHA256:
        raise RuntimeError("Canonical rules catalog changed; review item form changes before regeneration")
    if sha256_bytes(REVIEW.read_bytes()) != REVIEW_SHA256:
        raise RuntimeError("Reviewed item form-change transcription changed")
    rules = json.loads(rules_bytes)
    items = json.loads(ITEMS.read_text(encoding="utf-8"))
    pokedex = {row["species"]: row for row in json.loads(POKEDEX.read_text(encoding="utf-8"))}
    abilities = json.loads(ABILITIES.read_text(encoding="utf-8"))
    review = json.loads(REVIEW.read_text(encoding="utf-8"))
    remediation = json.loads(REMEDIATION.read_text(encoding="utf-8"))
    rule = rules[RULE_ID]
    mechanics = rule["itemFormChangeMechanics"]
    migration = next((row for row in remediation["reviewedMigrations"] if row.get("migrationId") == MIGRATION_ID), None)
    if not migration or migration.get("afterFileSha256") != MIGRATION_AFTER_RULES_SHA256 or migration.get("afterRecordSha256") != sha256_value(rule):
        raise RuntimeError("Reviewed item form-change migration evidence is unavailable or stale")
    current_rules_sha256 = MIGRATION_AFTER_RULES_SHA256
    for migration_id in SUCCESSOR_MIGRATION_IDS:
        successor = next((row for row in remediation["reviewedMigrations"] if row.get("migrationId") == migration_id), None)
        if not successor or successor.get("beforeFileSha256") != current_rules_sha256:
            raise RuntimeError("Reviewed item form-change successor chain is unavailable or stale")
        current_rules_sha256 = successor.get("afterFileSha256")
    if current_rules_sha256 != RULES_SHA256:
        raise RuntimeError("Reviewed item form-change successor chain does not reach current rules")
    if mechanics["forms"] != review["forms"] or mechanics["formCount"] != 50:
        raise RuntimeError("Canonical form authority disagrees with the reviewed transcription")
    forms = []
    for form in mechanics["forms"]:
        species = pokedex[form["baseSpeciesId"]]
        ability = abilities[form["abilityId"]]
        forms.append({
            **form,
            "formRecordSha256": sha256_value(form),
            "baseSpeciesRecordSha256": sha256_value(species),
            "abilityRecordSha256": sha256_value(ability),
        })
    return {
        "schemaVersion": 1,
        "ticket": "P8-056",
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
                "ringRecordSha256": sha256_value(items["Mega Ring"]),
                "stoneRecordSha256": sha256_value(items["Mega Stone"]),
            },
            "pokedex": {
                "path": "data/reference/pokedex.json",
                "fileSha256": sha256_bytes(POKEDEX.read_bytes()),
            },
            "abilities": {
                "path": "data/reference/abilities.json",
                "fileSha256": sha256_bytes(ABILITIES.read_bytes()),
            },
            "runtimeDocumentaryParsingForbidden": True,
        },
        "reviewedTranscription": {
            "path": "scripts/reviewed-data/item-form-changes.v1.json",
            "fileSha256": REVIEW_SHA256,
            "runtimeAuthority": False,
            "reviewStatus": review["reviewStatus"],
            "reviewMethod": review["reviewMethod"],
        },
        "sourceEvidence": review["sourceEvidence"],
        "policy": {
            "timing": mechanics["timing"],
            "duration": mechanics["duration"],
            "trainerSceneLimit": mechanics["trainerSceneLimit"],
            "hp": mechanics["hpPolicy"],
            "stats": mechanics["statPolicy"],
            "types": mechanics["typePolicy"],
            "abilities": mechanics["abilityPolicy"],
            "identity": mechanics["identityPolicy"],
            "sources": mechanics["sourcePolicy"],
            "sourceLoss": mechanics["sourceLossPolicy"],
            "reversal": mechanics["reversalPolicy"],
            "persistentForms": mechanics["persistentFormPolicy"],
            "privacy": "public-form-consequence-private-source-and-operation-evidence",
            "replay": "exact-command-idempotency-and-current-authority-revalidation",
        },
        "formCount": len(forms),
        "speciesCount": len({row["baseSpeciesId"] for row in forms}),
        "forms": forms,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    expected = json.dumps(document(), ensure_ascii=False, indent=2) + "\n"
    if args.check:
        if not OUTPUT.exists() or OUTPUT.read_text(encoding="utf-8") != expected:
            raise SystemExit("Generated item form-change contract is missing or stale.")
        print("Item form-change contract check passed: 50 forms across 48 species.")
        return
    OUTPUT.write_text(expected, encoding="utf-8")
    print(f"Generated {OUTPUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
