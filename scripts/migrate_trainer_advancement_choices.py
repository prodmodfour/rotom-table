#!/usr/bin/env python3
"""Apply/check the reviewed, source-hash-bound Trainer advancement-choice rule."""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
REVIEW_PATH = ROOT / "scripts/reviewed-data/trainer-advancement-choices.v1.json"
REMEDIATION_PATH = ROOT / "data/complete-play-loop/canonical-data-remediation.v1.json"
MIGRATION_ID = "rule-data-trainer-advancement-choices-v1"
AFTER_RULES_SHA256 = "94e0ec0f9a7416d807db892f501215666487357d20ab945b294a21742da6e142"
AFTER_RULES_BYTES = 196347
AFTER_RULES_GIT_BLOB = "b6db0c515133519860b79a80dac3a6e409a4a921"
REVIEW_SHA256 = "4abc452055992784f80ecb8faf4f99eb72af32dcdbb79bea0ce05dacd351c595"
SOURCE_EXCERPT_SHA256 = {
    "books/markdown/core/02-character-creation.md": "119c7ba505246b4ef4a051dff731da011e8b8071df865ccf7185cba84470a3c8",
    "books/markdown/core/03-skills-edges-and-features.md": "a1c9dba0d860a5b129d11520eb4f0a3ad2e5a7844cdce643d25eae94d406314a",
}


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


def source_excerpt(source: dict[str, Any]) -> bytes:
    lines = (ROOT / source["path"]).read_text(encoding="utf-8").splitlines(keepends=True)
    return "".join("".join(lines[start - 1:end]) for start, end in source["lineRanges"]).encode()


def reviewed() -> dict[str, Any]:
    raw = REVIEW_PATH.read_bytes()
    if digest(raw) != REVIEW_SHA256:
        raise SystemExit("reviewed Trainer advancement-choice migration fingerprint drifted")
    review = json.loads(raw)
    if (
        review.get("schemaVersion") != 1
        or review.get("status") != "reviewed"
        or review.get("migrationId") != "trainer-advancement-choices:v1"
    ):
        raise SystemExit("reviewed Trainer advancement-choice migration metadata is invalid")
    if review.get("reviewDecision") != {
        "runtimeUsesDocumentaryText": False,
        "runtimeUsesOnlyStructuredRule": True,
        "irreversibleChoiceIsAutomatic": False,
        "unsupportedPrerequisitePlanningIsGuided": True,
        "notesAreNeverResolutionAuthority": True,
    }:
        raise SystemExit("reviewed Trainer advancement-choice decision is incomplete")
    if len(review.get("sources", [])) != 2:
        raise SystemExit("Trainer advancement-choice source review is incomplete")
    for source in review["sources"]:
        path = ROOT / source["path"]
        if source.get("runtimeAuthority") is not False or digest(path.read_bytes()) != source["sha256"]:
            raise SystemExit("Trainer advancement-choice documentary source hash drifted")
        if digest(source_excerpt(source)) != SOURCE_EXCERPT_SHA256.get(source["path"]):
            raise SystemExit("Trainer advancement-choice reviewed source excerpt drifted")
    return review


def migration_row(review: dict[str, Any]) -> dict[str, Any]:
    sources = []
    for subject, source in zip(("trainer-level-progression", "feature-edge-and-class-policy"), review["sources"], strict=True):
        path = ROOT / source["path"]
        sources.append({
            "subject": subject,
            "path": source["path"],
            "fileSha256": source["sha256"],
            "gitBlob": git_blob(path),
            "lineRanges": source["lineRanges"],
            "excerptSha256": SOURCE_EXCERPT_SHA256[source["path"]],
            "pages": [19, 20, 21] if subject == "trainer-level-progression" else [52, 57, 58],
        })
    return {
        "migrationId": MIGRATION_ID,
        "canonicalId": review["target"]["ruleKey"],
        "canonicalPath": review["target"]["path"],
        "beforeFileSha256": review["target"]["baseSha256"],
        "beforeBytes": 190858,
        "beforeGitBlob": "69ad371eabdc443cc9b990bb6b77a4b77f019c75",
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
        "sourceEvidence": sources,
        "reason": "Adds exact Trainer Feature, Class, Edge, Skill Edge, milestone-option, and incomplete-build detection authority without selecting a build or parsing freeform notes.",
        "downstreamFrozenBaselinePolicy": "Earlier reviewed rule records retain per-record authority; this exact chained successor changes only the Trainer Advancement Choices record.",
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
            raise SystemExit("canonical Trainer advancement-choice rule differs from reviewed migration")
        expected_target = target_bytes
    else:
        if digest(target_bytes) != review["target"]["baseSha256"]:
            raise SystemExit("canonical rules base hash drifted before Trainer advancement-choice migration")
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
            raise SystemExit("Trainer advancement-choice migration evidence differs from reviewed authority")
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
            raise SystemExit("canonical Trainer advancement-choice migration is not fully applied")
        if digest(expected_target) != AFTER_RULES_SHA256 or len(expected_target) != AFTER_RULES_BYTES:
            raise SystemExit("canonical Trainer advancement-choice successor fingerprint drifted")
        print("trainer advancement-choice migration: OK")
        return
    target.write_bytes(expected_target)
    REMEDIATION_PATH.write_bytes(expected_remediation)
    print(f"wrote {target.relative_to(ROOT)} and {REMEDIATION_PATH.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
