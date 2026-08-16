#!/usr/bin/env python3
"""Apply/check the reviewed, source-hash-bound Pokémon advancement-choice rule."""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
REVIEW_PATH = ROOT / "scripts/reviewed-data/pokemon-advancement-choices.v1.json"
REMEDIATION_PATH = ROOT / "data/complete-play-loop/canonical-data-remediation.v1.json"
MIGRATION_ID = "rule-data-pokemon-advancement-choices-v1"
AFTER_RULES_SHA256 = "d9b0815c7a9cec1974239b6cb942ec5509ba7021078423fd16ed37bbf72cca2a"
AFTER_RULES_BYTES = 190858
AFTER_RULES_GIT_BLOB = "69ad371eabdc443cc9b990bb6b77a4b77f019c75"
CHAINED_RULES_SHA256 = "94e0ec0f9a7416d807db892f501215666487357d20ab945b294a21742da6e142"
CHAINED_RULES_BYTES = 196347
REVIEW_SHA256 = "e04fa00425295f81699a8187aefd4c3f9fd0abb01f635639f313de00896e9c37"
SOURCE_EXCERPT_SHA256 = "9bf6678e0c72941c1f72f1c877666dc443d7982f037a0a36c6634d425f292779"


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def stable_digest(value: Any) -> str:
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    return digest(encoded)


def git_blob(path: Path) -> str:
    return subprocess.check_output(["git", "hash-object", str(path)], cwd=ROOT, text=True).strip()


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def canonical_json(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def source_excerpt(path: Path) -> bytes:
    lines = path.read_text(encoding="utf-8").splitlines(keepends=True)
    return ("".join(lines[403:440]) + "".join(lines[557:607])).encode()


def reviewed() -> dict[str, Any]:
    raw = REVIEW_PATH.read_bytes()
    if digest(raw) != REVIEW_SHA256:
        raise SystemExit("reviewed advancement-choice migration fingerprint drifted")
    review = json.loads(raw)
    if (
        review.get("schemaVersion") != 1
        or review.get("status") != "reviewed"
        or review.get("migrationId") != "pokemon-advancement-choices:v1"
    ):
        raise SystemExit("reviewed advancement-choice migration metadata is invalid")
    if review.get("reviewDecision") != {
        "runtimeUsesDocumentaryText": False,
        "runtimeUsesOnlyStructuredRule": True,
        "ambiguousOrConditionalEvolutionFailsClosed": True,
        "irreversibleChoiceIsAutomatic": False,
    }:
        raise SystemExit("reviewed advancement-choice decision is incomplete")
    source = ROOT / review["source"]["path"]
    if digest(source.read_bytes()) != review["source"]["sha256"]:
        raise SystemExit("advancement-choice documentary source hash drifted")
    if digest(source_excerpt(source)) != SOURCE_EXCERPT_SHA256:
        raise SystemExit("advancement-choice reviewed source excerpt drifted")
    return review


def migration_row(review: dict[str, Any]) -> dict[str, Any]:
    source_path = ROOT / review["source"]["path"]
    return {
        "migrationId": MIGRATION_ID,
        "canonicalId": review["target"]["ruleKey"],
        "canonicalPath": review["target"]["path"],
        "beforeFileSha256": review["target"]["baseSha256"],
        "beforeBytes": 188040,
        "beforeGitBlob": "e3f8f3e30d24bf3ca60c98d315a0ecd3d293342b",
        "afterFileSha256": AFTER_RULES_SHA256,
        "afterBytes": AFTER_RULES_BYTES,
        "afterGitBlob": AFTER_RULES_GIT_BLOB,
        "afterRecordSha256": stable_digest(review["rule"]),
        "reviewedTranscription": {
            "path": str(REVIEW_PATH.relative_to(ROOT)),
            "fileSha256": REVIEW_SHA256,
            "reviewStatus": "accepted",
            "runtimeAuthority": False,
        },
        "sourceEvidence": [{
            "subject": "pokemon-level-up-abilities-moves-and-evolution",
            "path": review["source"]["path"],
            "fileSha256": review["source"]["sha256"],
            "gitBlob": git_blob(source_path),
            "lineRanges": [[404, 440], [558, 607]],
            "excerptSha256": SOURCE_EXCERPT_SHA256,
            "pages": [200, 202],
        }],
        "reason": "Adds exact event-bound Move opportunities, Ability milestones, optional level Evolution and form-branch policy, plus post-evolution review. Conditional or malformed candidates fail closed and no irreversible choice is automatic.",
        "downstreamFrozenBaselinePolicy": "Earlier reviewed rule records retain per-record authority; this exact chained successor changes only the Pokémon Advancement Choices record.",
        "reviewStatus": "accepted",
    }


def expected_outputs() -> tuple[Path, bytes, bytes]:
    review = reviewed()
    target = ROOT / review["target"]["path"]
    target_bytes = target.read_bytes()
    target_json = json.loads(target_bytes)
    key = review["target"]["ruleKey"]
    if key in target_json:
        if target_json[key] != review["rule"]:
            raise SystemExit("canonical advancement-choice rule differs from reviewed migration")
        expected_target = target_bytes
    else:
        if digest(target_bytes) != review["target"]["baseSha256"]:
            raise SystemExit("canonical rules base hash drifted before advancement-choice migration")
        target_json[key] = review["rule"]
        expected_target = canonical_json(target_json)

    remediation = load_json(REMEDIATION_PATH)
    rows = remediation.get("reviewedMigrations")
    if not isinstance(rows, list):
        raise SystemExit("canonical remediation migration ledger is unavailable")
    expected_row = migration_row(review)
    matches = [row for row in rows if row.get("migrationId") == MIGRATION_ID]
    if matches:
        if matches != [expected_row]:
            raise SystemExit("advancement-choice migration evidence differs from reviewed authority")
        expected_remediation = REMEDIATION_PATH.read_bytes()
    else:
        rows.append(expected_row)
        expected_remediation = canonical_json(remediation)
    return target, expected_target, expected_remediation


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    target, expected_target, expected_remediation = expected_outputs()
    if args.check:
        if target.read_bytes() != expected_target or REMEDIATION_PATH.read_bytes() != expected_remediation:
            raise SystemExit("canonical advancement-choice migration is not fully applied")
        if (digest(expected_target), len(expected_target)) not in {
            (AFTER_RULES_SHA256, AFTER_RULES_BYTES),
            (CHAINED_RULES_SHA256, CHAINED_RULES_BYTES),
        }:
            raise SystemExit("canonical advancement-choice successor fingerprint drifted")
        print("pokemon advancement-choice migration: OK")
        return
    target.write_bytes(expected_target)
    REMEDIATION_PATH.write_bytes(expected_remediation)
    print(f"wrote {target.relative_to(ROOT)} and {REMEDIATION_PATH.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
