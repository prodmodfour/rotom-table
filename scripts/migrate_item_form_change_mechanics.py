#!/usr/bin/env python3
"""Install/check the reviewed P8-056 item-driven form-change authority.

Runtime code consumes only data/reference/rules.json. The separately reviewed
transcription is a migration input, never a runtime source, and every source
excerpt is hash-bound before the structured successor is installed.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
RULES_PATH = ROOT / "data/reference/rules.json"
ITEMS_PATH = ROOT / "data/reference/items.json"
POKEDEX_PATH = ROOT / "data/reference/pokedex.json"
ABILITIES_PATH = ROOT / "data/reference/abilities.json"
REVIEW_PATH = ROOT / "scripts/reviewed-data/item-form-changes.v1.json"
REMEDIATION_PATH = ROOT / "data/complete-play-loop/canonical-data-remediation.v1.json"

BEFORE_RULES_SHA256 = "68c0f55a4038423de752ece05afa44830babe5ab0e642add524da46f4a49373e"
BEFORE_RULES_BYTES = 163562
BEFORE_RULES_GIT_BLOB = "b8666e2cfab3d961b54b8dcb5c8531bc6ad800a7"
AFTER_RULES_SHA256 = "bc0ff520e94cd81e83a77fc1bad5ee005f028452ecf8989ff6f416cefafa99df"
AFTER_RULES_BYTES = 184898
AFTER_RULES_GIT_BLOB = "a549fd130899fa2252c0716cffe1b982e1cff937"
REVIEW_SHA256 = "36fc31bb3095b0c84bec71b7254ed59384a14c1395bdd84d81f0e9f7b35eefd7"
MIGRATION_ID = "rule-data-item-form-change-mechanics-v1"
RULE_ID = "Item-Driven Form Changes"
TYPE_IDS = {
    "Normal", "Fighting", "Flying", "Poison", "Ground", "Rock", "Bug",
    "Ghost", "Steel", "Fire", "Water", "Grass", "Electric", "Psychic",
    "Ice", "Dragon", "Dark", "Fairy",
}
STAT_IDS = ("atk", "def", "satk", "sdef", "spd")


def stable_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_value(value: Any) -> str:
    return sha256_bytes(stable_json(value).encode())


def git_blob(path: Path) -> str:
    return subprocess.check_output(["git", "hash-object", str(path)], cwd=ROOT, text=True).strip()


def excerpt_bytes(path: Path, ranges: list[list[int]]) -> bytes:
    lines = path.read_text(encoding="utf-8").splitlines(keepends=True)
    return "".join("".join(lines[start - 1:end]) for start, end in ranges).encode()


def load_review() -> dict[str, Any]:
    raw = REVIEW_PATH.read_bytes()
    if sha256_bytes(raw) != REVIEW_SHA256:
        raise SystemExit("Reviewed item form-change transcription fingerprint drifted.")
    review = json.loads(raw)
    if review.get("schemaVersion") != 1 or review.get("ticket") != "P8-056" or review.get("reviewStatus") != "accepted":
        raise SystemExit("Reviewed item form-change transcription identity is unavailable.")
    return review


def expected_rule(review: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": RULE_ID,
        "category": "Item Rule",
        "text": "Reviewed structured authority for Mega Evolution form changes. Runtime eligibility, effective data, source ownership, Scene usage, and reversal use itemFormChangeMechanics only; documentary text is provenance, never executable input.",
        "source": "books/markdown/core/05-pokemon.md; books/markdown/core/09-gear-and-items.md; reviewed Pokédex Mega Evolution blocks",
        "itemFormChangeMechanics": {
            "schemaVersion": 1,
            "triggerKind": "mega-evolution",
            "ringItemId": "Mega Ring",
            "stoneItemId": "Mega Stone",
            "timing": "swift-action-on-trainer-or-pokemon-turn",
            "duration": "scene",
            "trainerSceneLimit": 1,
            "hpPolicy": "unchanged",
            "statPolicy": "add-reviewed-non-hp-deltas-to-effective-stats",
            "typePolicy": "replace-only-when-form-record-declares-types",
            "abilityPolicy": "add-reviewed-ability-or-select-distinct-natural-ability-on-duplicate",
            "identityPolicy": "retain-sheet-character-history-and-customization",
            "sourcePolicy": "active-matching-ring-and-form-bound-stone-or-reviewed-delta-exception",
            "sourceLossPolicy": "accepted-scene-form-survives-suppression-and-stone-is-removal-locked",
            "reversalPolicy": "automatic-at-scene-end",
            "persistentFormPolicy": "supported-by-state-model-but-no-reviewed-item-trigger",
            "formCount": len(review["forms"]),
            "forms": review["forms"],
        },
    }


def validate_review(review: dict[str, Any]) -> None:
    items = json.loads(ITEMS_PATH.read_text(encoding="utf-8"))
    pokedex = json.loads(POKEDEX_PATH.read_text(encoding="utf-8"))
    abilities = json.loads(ABILITIES_PATH.read_text(encoding="utf-8"))
    if "Mega Ring" not in items or "Mega Stone" not in items:
        raise SystemExit("Canonical Mega Ring or Mega Stone identity is unavailable.")
    species = {row.get("species") for row in pokedex}
    forms = review.get("forms")
    if not isinstance(forms, list) or len(forms) != 50:
        raise SystemExit("Reviewed Mega form roster must contain exactly 50 forms.")
    if len({row.get("formId") for row in forms}) != len(forms):
        raise SystemExit("Reviewed Mega form identities are duplicated.")
    if sum(row.get("baseSpeciesId") == "Rayquaza" for row in forms) != 1:
        raise SystemExit("Reviewed Delta Evolution exception identity drifted.")
    for row in forms:
        if set(row) != {"formId", "baseSpeciesId", "displayName", "types", "abilityId", "statDeltas", "requiresMegaStone"}:
            raise SystemExit(f"Reviewed form {row.get('formId')} has an invalid shape.")
        if row["baseSpeciesId"] not in species or row["abilityId"] not in abilities:
            raise SystemExit(f"Reviewed form {row['formId']} references unavailable canonical data.")
        if row["types"] is not None and (not row["types"] or any(value not in TYPE_IDS for value in row["types"])):
            raise SystemExit(f"Reviewed form {row['formId']} has invalid types.")
        if set(row["statDeltas"]) != set(STAT_IDS) or any(
            not isinstance(row["statDeltas"][key], int) or abs(row["statDeltas"][key]) > 20 for key in STAT_IDS
        ):
            raise SystemExit(f"Reviewed form {row['formId']} has invalid non-HP Stat deltas.")
        if row["requiresMegaStone"] is not (row["baseSpeciesId"] != "Rayquaza"):
            raise SystemExit(f"Reviewed form {row['formId']} has invalid Mega Stone policy.")
    evidence = review.get("sourceEvidence")
    if not isinstance(evidence, list) or len(evidence) != 50:
        raise SystemExit("Reviewed Mega form source-evidence roster drifted.")
    for entry in evidence:
        path = ROOT / entry["path"]
        if sha256_bytes(path.read_bytes()) != entry["fileSha256"] or git_blob(path) != entry["gitBlob"]:
            raise SystemExit(f"Reviewed Mega source changed: {entry['path']}")
        if sha256_bytes(excerpt_bytes(path, entry["lineRanges"])) != entry["excerptSha256"]:
            raise SystemExit(f"Reviewed Mega source excerpt changed: {entry['path']}")


def follows_reviewed_rules_successors(
    migrations: list[dict[str, Any]],
    start_sha256: str,
    current_sha256: str,
) -> bool:
    """Accept later rule bytes only through an unambiguous accepted migration chain."""
    cursor = start_sha256
    visited: set[str] = set()
    while cursor != current_sha256:
        matches = [
            row for row in migrations
            if row.get("reviewStatus") == "accepted"
            and row.get("canonicalPath") == "data/reference/rules.json"
            and row.get("beforeFileSha256") == cursor
            and isinstance(row.get("afterFileSha256"), str)
        ]
        if len(matches) != 1:
            return False
        successor = matches[0]["afterFileSha256"]
        if successor in visited or successor == cursor:
            return False
        visited.add(cursor)
        cursor = successor
    return True


def expected_migration(review: dict[str, Any], rule: dict[str, Any]) -> dict[str, Any]:
    return {
        "migrationId": MIGRATION_ID,
        "canonicalId": RULE_ID,
        "canonicalPath": "data/reference/rules.json",
        "beforeFileSha256": BEFORE_RULES_SHA256,
        "beforeBytes": BEFORE_RULES_BYTES,
        "beforeGitBlob": BEFORE_RULES_GIT_BLOB,
        "afterFileSha256": AFTER_RULES_SHA256,
        "afterBytes": AFTER_RULES_BYTES,
        "afterGitBlob": AFTER_RULES_GIT_BLOB,
        "afterRecordSha256": sha256_value(rule),
        "reviewedTranscription": {
            "path": "scripts/reviewed-data/item-form-changes.v1.json",
            "fileSha256": REVIEW_SHA256,
            "formCount": len(review["forms"]),
            "reviewStatus": "accepted",
            "runtimeAuthority": False,
        },
        "sourceEvidence": review["sourceEvidence"],
        "reason": "Adds exact structured Mega Evolution authority for 50 reviewed forms across 48 species, including matching equipment ownership, the Rayquaza Delta Evolution exception, Swift Action economy, one Trainer-supported use per Scene, type and non-HP Stat overlays, distinct Ability selection, Scene-end reversal, and source-removal locking. Runtime never parses documentary text.",
        "downstreamFrozenBaselinePolicy": "The immutable Breeding source manifest retains its original rules hash and admits this exact chained successor only while every pre-existing Breeding rule consumer remains bound to unchanged per-record authority.",
        "downstreamQualityGate": "scripts/check_breeding_automation.ts",
        "reviewStatus": "accepted",
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    review = load_review()
    validate_review(review)
    rule = expected_rule(review)
    migration = expected_migration(review, rule)
    rules_bytes = RULES_PATH.read_bytes()
    rules = json.loads(rules_bytes)
    remediation = json.loads(REMEDIATION_PATH.read_text(encoding="utf-8"))

    if args.check:
        if rules.get(RULE_ID) != rule:
            raise SystemExit("Item-driven form-change structured rule is missing or stale.")
        if migration not in remediation.get("reviewedMigrations", []):
            raise SystemExit("Item-driven form-change migration evidence is missing or stale.")
        current_rules_sha256 = sha256_bytes(rules_bytes)
        if not follows_reviewed_rules_successors(
            remediation.get("reviewedMigrations", []),
            AFTER_RULES_SHA256,
            current_rules_sha256,
        ):
            raise SystemExit("Item-driven form-change rules have no complete reviewed successor chain.")
        if current_rules_sha256 == AFTER_RULES_SHA256 \
                and (len(rules_bytes) != AFTER_RULES_BYTES or git_blob(RULES_PATH) != AFTER_RULES_GIT_BLOB):
            raise SystemExit("Item-driven form-change direct rules successor fingerprint drifted.")
        print(f"Item form-change mechanics check passed: {len(review['forms'])} forms.")
        return

    if RULE_ID in rules or any(row.get("migrationId") == MIGRATION_ID for row in remediation.get("reviewedMigrations", [])):
        raise SystemExit("Item-driven form-change authority already exists; use --check.")
    if sha256_bytes(rules_bytes) != BEFORE_RULES_SHA256 or len(rules_bytes) != BEFORE_RULES_BYTES:
        raise SystemExit("Rules catalog does not match the reviewed P8-056 predecessor.")
    rules[RULE_ID] = rule
    remediation["reviewedMigrations"].append(migration)
    rendered = (json.dumps(rules, ensure_ascii=False, indent=2) + "\n").encode()
    RULES_PATH.write_bytes(rendered)
    REMEDIATION_PATH.write_text(json.dumps(remediation, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Installed item form-change mechanics: {len(review['forms'])} forms; rules SHA-256 {sha256_bytes(rendered)}; bytes {len(rendered)}; Git blob {git_blob(RULES_PATH)}.")


if __name__ == "__main__":
    main()
