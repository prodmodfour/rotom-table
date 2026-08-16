#!/usr/bin/env python3
"""Install/check reviewed P8-057 exploration-item authority and ItemSpec rows.

Runtime consumes only app-owned data/reference/rules.json and the generated
complete-loop ItemSpec document. The reviewed transcription and book excerpts
are migration evidence only and are never parsed by runtime mechanics.
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
FEATURES_PATH = ROOT / "data/reference/features.json"
SPECS_PATH = ROOT / "data/complete-play-loop/specs.v1.json"
REVIEW_PATH = ROOT / "scripts/reviewed-data/exploration-items.v1.json"
REMEDIATION_PATH = ROOT / "data/complete-play-loop/canonical-data-remediation.v1.json"

BEFORE_RULES_SHA256 = "bc0ff520e94cd81e83a77fc1bad5ee005f028452ecf8989ff6f416cefafa99df"
BEFORE_RULES_BYTES = 184898
BEFORE_RULES_GIT_BLOB = "a549fd130899fa2252c0716cffe1b982e1cff937"
AFTER_RULES_SHA256 = "ff0e220165887fec69ce11f70c0db84210ae289a51145196fe885fe0937ce0a8"
AFTER_RULES_BYTES = 188040
AFTER_RULES_GIT_BLOB = "e3f8f3e30d24bf3ca60c98d315a0ecd3d293342b"
CHAINED_RULES_SHA256 = "94e0ec0f9a7416d807db892f501215666487357d20ab945b294a21742da6e142"
CHAINED_RULES_BYTES = 196347
CHAINED_RULES_GIT_BLOB = "b6db0c515133519860b79a80dac3a6e409a4a921"
BEFORE_SPECS_SHA256 = "5bed2257aa99ab551cb1a1d667e7c4933dee58ddd6e719d617c0e9667de949c7"
BEFORE_SPECS_BYTES = 90164
BEFORE_SPECS_GIT_BLOB = "44b813bf81c43b1ee8549ab29cb35bcd906b0618"
AFTER_SPECS_SHA256 = "bf0a74b237eab416c8b082f7547edb36ceb2c32c673eba1bff7bda4b7a1e7cba"
AFTER_SPECS_BYTES = 96900
AFTER_SPECS_GIT_BLOB = "a524b837cce111a52fed6b62604b4f44c157c21c"
REVIEW_SHA256 = "c9f023bd817a4f4468f4dc172f470b7a201c60e73892cbf81a7152d932c18a75"
RULE_ID = "Exploration Items"
MIGRATION_ID = "rule-data-exploration-item-mechanics-v1"
EXPLORATION_ITEM_IDS = [
    "Bait", "Fishing Lure", "Honey", "Repel", "Super Repel", "Max Repel", "Dowsing Rod",
]


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
        raise SystemExit("Reviewed exploration-item transcription fingerprint drifted.")
    review = json.loads(raw)
    if review.get("schemaVersion") != 1 or review.get("ticket") != "P8-057" or review.get("reviewStatus") != "accepted":
        raise SystemExit("Reviewed exploration-item transcription identity is unavailable.")
    return review


def expected_rule(review: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": RULE_ID,
        "category": "Item Rule",
        "text": "Reviewed structured authority for Bait, Fishing Lure, Honey as Bait, Repels, and Dowsing Rod. Runtime timing, checks, campaign effects, bounded prompts, and rewards use itemExplorationMechanics only; documentary text is provenance, never executable input.",
        "source": "books/markdown/core/09-gear-and-items.md; data/reference/features.json#Crystal Resonance",
        "itemExplorationMechanics": {"schemaVersion": 1, **review["mechanics"]},
    }


def item_row(items: dict[str, Any], canonical_id: str, effect: dict[str, Any]) -> dict[str, Any]:
    item = items[canonical_id]
    return {
        "canonicalId": canonical_id,
        "recordSha256": sha256_value(item),
        "effectSha256": sha256_bytes("\n".join(item["effects"]).encode()),
        "effect": effect,
    }


def expected_specs(review: dict[str, Any], rule: dict[str, Any], source: dict[str, Any]) -> dict[str, Any]:
    specs = json.loads(json.dumps(source))
    items = json.loads(ITEMS_PATH.read_text(encoding="utf-8"))
    features = json.loads(FEATURES_PATH.read_text(encoding="utf-8"))
    mechanics = review["mechanics"]
    lure = mechanics["bait"]["routeLure"]
    distraction = mechanics["bait"]["wildDistraction"]
    dowsing = mechanics["dowsingRod"]
    rows: dict[str, dict[str, Any]] = {
        "Bait": item_row(items, "Bait", {
            "kind": "use-bait", "lure": lure, "distraction": distraction,
        }),
        "Fishing Lure": item_row(items, "Fishing Lure", {
            "kind": "start-route-lure", "lure": lure, "reusable": True,
            "lossPolicy": mechanics["fishingLure"]["lossPolicy"],
        }),
        "Honey": item_row(items, "Honey", {
            "kind": "use-snack-or-bait", "buffKind": "fixed-heal", "amount": 5,
            "denominator": None, "requiredPokemonType": None,
            "lure": lure, "distraction": distraction,
        }),
        "Dowsing Rod": item_row(items, "Dowsing Rod", {
            "kind": "search-for-shards", "searchMinutes": dowsing["searchMinutes"],
            "dailyUses": dowsing["dailyUses"], "baseDice": dowsing["baseDice"],
            "terrainBonusDice": dowsing["terrainBonusDice"],
            "skillStuntDowsingBonusDice": dowsing["skillStuntDowsingBonusDice"],
            "crystalResonanceBonusDice": dowsing["crystalResonanceBonusDice"],
            "successMinimum": dowsing["successMinimum"], "rerollOn": dowsing["rerollOn"],
            "shardColors": dowsing["shardColors"], "areaAuthority": dowsing["areaAuthority"],
        }),
    }
    for repel in mechanics["repels"]:
        rows[repel["canonicalId"]] = item_row(items, repel["canonicalId"], {
            "kind": "use-repel", "durationMinutes": repel["durationMinutes"],
            "maximumAffectedWildLevel": repel["maximumAffectedWildLevel"],
            "directBaseAc": mechanics["repelDirect"]["accuracyCheck"]["baseAc"],
            "positioningAuthority": mechanics["repelDirect"]["hitConsequence"]["positioningAuthority"],
        })
    specs["ruleEvidence"]["explorationItemPolicy"] = {
        "ruleCanonicalId": RULE_ID,
        "ruleRecordSha256": sha256_value(rule),
        "actorKind": "trainer",
        "itemIds": EXPLORATION_ITEM_IDS,
        "routeLure": lure,
        "wildDistraction": distraction,
        "fishingLure": mechanics["fishingLure"],
        "repels": mechanics["repels"],
        "repelDirect": mechanics["repelDirect"],
        "dowsingRod": dowsing,
        "crystalResonanceRecordSha256": sha256_value(features["Crystal Resonance"]),
        "runtimeDocumentaryParsingForbidden": True,
    }
    honey_indices = [index for index, row in enumerate(specs["specs"]) if row.get("canonicalId") == "Honey"]
    if len(honey_indices) != 1:
        raise SystemExit("Reviewed Honey ItemSpec predecessor is unavailable or duplicated.")
    specs["specs"][honey_indices[0]] = rows["Honey"]
    existing = {row.get("canonicalId") for row in specs["specs"]}
    for canonical_id in ["Bait", "Fishing Lure", "Repel", "Super Repel", "Max Repel", "Dowsing Rod"]:
        if canonical_id in existing:
            raise SystemExit(f"Exploration ItemSpec {canonical_id} already exists in the predecessor.")
        specs["specs"].append(rows[canonical_id])
    return specs


def validate_review(review: dict[str, Any]) -> None:
    mechanics = review.get("mechanics")
    if not isinstance(mechanics, dict) or mechanics.get("actorKind") != "trainer":
        raise SystemExit("Exploration-item actor authority drifted.")
    bait = mechanics.get("bait", {})
    lure = bait.get("routeLure", {})
    distraction = bait.get("wildDistraction", {})
    if bait.get("canonicalId") != "Bait" or bait.get("consumptionQuantity") != 1 \
            or lure != {"checkIntervalMinutes": 15, "successMinimum": 15, "maximumAttempts": 3, "dieSides": 20, "encounterSelection": "gm-comparable-party-level"} \
            or distraction != {"timing": "standard-action", "target": "exact-wild-pokemon", "focusDc": 12, "failureConsequence": "forfeit-next-standard-action"}:
        raise SystemExit("Reviewed Bait mechanics drifted.")
    repels = mechanics.get("repels")
    if repels != [
        {"canonicalId": "Repel", "durationMinutes": 60, "maximumAffectedWildLevel": 15},
        {"canonicalId": "Super Repel", "durationMinutes": 120, "maximumAffectedWildLevel": 25},
        {"canonicalId": "Max Repel", "durationMinutes": 300, "maximumAffectedWildLevel": 35},
    ]:
        raise SystemExit("Reviewed Repel family drifted.")
    dowsing = mechanics.get("dowsingRod", {})
    if dowsing.get("searchMinutes") != 10 or dowsing.get("successMinimum") != 4 \
            or dowsing.get("rerollOn") != 6 or dowsing.get("shardColors") != ["Red", "Orange", "Yellow", "Green", "Blue", "Violet"]:
        raise SystemExit("Reviewed Dowsing Rod mechanics drifted.")
    items = json.loads(ITEMS_PATH.read_text(encoding="utf-8"))
    if any(canonical_id not in items for canonical_id in [*EXPLORATION_ITEM_IDS, "Shards"]):
        raise SystemExit("Canonical exploration item or Shards identity is unavailable.")
    features = json.loads(FEATURES_PATH.read_text(encoding="utf-8"))
    if features.get("Crystal Resonance", {}).get("effect") != "You roll an additional 3d6 when determining how many Shards you find when Dowsing.":
        raise SystemExit("Canonical Crystal Resonance authority drifted.")
    evidence = review.get("sourceEvidence")
    if not isinstance(evidence, list) or len(evidence) != 5:
        raise SystemExit("Exploration source-evidence roster drifted.")
    for entry in evidence:
        path = ROOT / entry["path"]
        if sha256_bytes(path.read_bytes()) != entry["fileSha256"] or git_blob(path) != entry["gitBlob"]:
            raise SystemExit(f"Reviewed exploration source changed: {entry['path']}")
        if sha256_bytes(excerpt_bytes(path, entry["lineRanges"])) != entry["excerptSha256"]:
            raise SystemExit(f"Reviewed exploration source excerpt changed: {entry['subject']}")


def follows_reviewed_successors(
    migrations: list[dict[str, Any]],
    start_sha256: str,
    current_sha256: str,
    before_key: str,
    after_key: str,
    canonical_path: str | None = None,
) -> bool:
    """Accept a later aggregate only through an unambiguous accepted hash chain."""
    cursor = start_sha256
    visited: set[str] = set()
    while cursor != current_sha256:
        matches = [
            row for row in migrations
            if row.get("reviewStatus") == "accepted"
            and (canonical_path is None or row.get("canonicalPath") == canonical_path)
            and row.get(before_key) == cursor
            and isinstance(row.get(after_key), str)
        ]
        if len(matches) != 1:
            return False
        successor = matches[0][after_key]
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
        "itemSpecSuccessor": {
            "path": "data/complete-play-loop/specs.v1.json",
            "beforeFileSha256": BEFORE_SPECS_SHA256,
            "beforeBytes": BEFORE_SPECS_BYTES,
            "beforeGitBlob": BEFORE_SPECS_GIT_BLOB,
            "afterFileSha256": AFTER_SPECS_SHA256,
            "afterBytes": AFTER_SPECS_BYTES,
            "afterGitBlob": AFTER_SPECS_GIT_BLOB,
            "nativeItemCount": len(EXPLORATION_ITEM_IDS),
        },
        "reviewedTranscription": {
            "path": "scripts/reviewed-data/exploration-items.v1.json",
            "fileSha256": REVIEW_SHA256,
            "reviewStatus": "accepted",
            "runtimeAuthority": False,
        },
        "sourceEvidence": review["sourceEvidence"],
        "reason": "Adds exact structured route-lure checks, wild distraction, reusable Fishing Lure policy, Honey's alternate Bait mode, campaign-minute Repels, direct Repel attack consequences, and ten-minute daily Dowsing rewards. Species selection and direct flee positioning remain explicit bounded GM work; runtime never parses documentary text.",
        "downstreamFrozenBaselinePolicy": "The immutable Breeding source manifest retains its original rules hash and admits this exact chained successor only while every pre-existing Breeding consumer remains bound to unchanged per-record authority.",
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
    specs_bytes = SPECS_PATH.read_bytes()
    rules = json.loads(rules_bytes)
    specs = json.loads(specs_bytes)
    remediation = json.loads(REMEDIATION_PATH.read_text(encoding="utf-8"))

    if args.check:
        if rules.get(RULE_ID) != rule:
            raise SystemExit("Exploration-item structured rule is missing or stale.")
        migration_rows = [row for row in remediation.get("reviewedMigrations", []) if row.get("migrationId") == MIGRATION_ID]
        if migration_rows != [migration]:
            raise SystemExit("Exploration-item migration evidence is missing, duplicated, or stale.")
        installed_migrations = remediation.get("reviewedMigrations", [])
        current_rules_sha256 = sha256_bytes(rules_bytes)
        if not follows_reviewed_successors(
            installed_migrations,
            AFTER_RULES_SHA256,
            current_rules_sha256,
            "beforeFileSha256",
            "afterFileSha256",
            "data/reference/rules.json",
        ):
            raise SystemExit("Exploration-item rules catalog has no complete reviewed successor chain.")
        expected_subset = expected_specs(review, rule, {
            "ruleEvidence": {},
            "specs": [{"canonicalId": "Honey"}],
        })
        current_rows = {row.get("canonicalId"): row for row in specs.get("specs", [])}
        if any(current_rows.get(row["canonicalId"]) != row for row in expected_subset["specs"]):
            raise SystemExit("Exploration ItemSpec rows are missing or stale.")
        if specs.get("ruleEvidence", {}).get("explorationItemPolicy") \
                != expected_subset["ruleEvidence"]["explorationItemPolicy"]:
            raise SystemExit("Exploration ItemSpec rule evidence is missing or stale.")
        current_specs_sha256 = sha256_bytes(specs_bytes)
        if not follows_reviewed_successors(
            installed_migrations,
            AFTER_SPECS_SHA256,
            current_specs_sha256,
            "beforeItemSpecsSha256",
            "afterItemSpecsSha256",
        ):
            raise SystemExit("Exploration ItemSpec document has no complete reviewed successor chain.")
        print("Exploration item mechanics check passed: 7 canonical items.")
        return

    if RULE_ID in rules or any(row.get("migrationId") == MIGRATION_ID for row in remediation.get("reviewedMigrations", [])):
        raise SystemExit("Exploration-item authority already exists; use --check.")
    if sha256_bytes(rules_bytes) != BEFORE_RULES_SHA256 or len(rules_bytes) != BEFORE_RULES_BYTES or git_blob(RULES_PATH) != BEFORE_RULES_GIT_BLOB:
        raise SystemExit("Rules catalog does not match the reviewed P8-057 predecessor.")
    if sha256_bytes(specs_bytes) != BEFORE_SPECS_SHA256 or len(specs_bytes) != BEFORE_SPECS_BYTES or git_blob(SPECS_PATH) != BEFORE_SPECS_GIT_BLOB:
        raise SystemExit("ItemSpec document does not match the reviewed P8-057 predecessor.")
    rules[RULE_ID] = rule
    specs = expected_specs(review, rule, specs)
    remediation["reviewedMigrations"].append(migration)
    RULES_PATH.write_text(json.dumps(rules, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    SPECS_PATH.write_text(json.dumps(specs, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    REMEDIATION_PATH.write_text(json.dumps(remediation, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if sha256_bytes(RULES_PATH.read_bytes()) != AFTER_RULES_SHA256 or git_blob(RULES_PATH) != AFTER_RULES_GIT_BLOB:
        raise SystemExit("Installed rules successor does not match reviewed fingerprint.")
    if sha256_bytes(SPECS_PATH.read_bytes()) != AFTER_SPECS_SHA256 or git_blob(SPECS_PATH) != AFTER_SPECS_GIT_BLOB:
        raise SystemExit("Installed ItemSpec successor does not match reviewed fingerprint.")
    print(f"Installed exploration item mechanics; rules SHA-256 {AFTER_RULES_SHA256}; specs SHA-256 {AFTER_SPECS_SHA256}.")


if __name__ == "__main__":
    main()
