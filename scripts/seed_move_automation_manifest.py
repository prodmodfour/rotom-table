#!/usr/bin/env python3
"""Seed and deterministically update the canonical move automation manifest.

Existing canonical rows are preserved so rerunning this bootstrap utility cannot
silently promote or downgrade reviewed semantic status. Missing rows receive the
truthful Phase 1 defaults derived from the explicit v1 registry.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

from move_automation_coverage import MOVES_PATH, MoveCoverage, build_coverage
from move_automation_worklist import classify_move_worklist_bucket


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MANIFEST_PATH = ROOT / "data" / "move-automation" / "manifest.json"
RULESET_PATH = ROOT / "data" / "move-automation" / "ruleset.json"
MANIFEST_SCHEMA_VERSION = 1
MANIFEST_ROOT_FIELDS = {"schemaVersion", "moves"}
MANIFEST_MOVE_FIELDS = {
    "canonicalId",
    "displayName",
    "baseStatus",
    "interactionStatus",
    "runtime",
    "rulesProvenance",
    "capabilityTags",
    "suggestedCapabilityTags",
    "blockerCodes",
    "limitations",
    "manualSteps",
    "scenarioIds",
    "reviewedAt",
    "unsupportedInteractionIds",
    "rolloutCohortId",
}


class ManifestSeedError(ValueError):
    """Raised when bootstrap inputs cannot produce a truthful manifest."""


def load_ruleset() -> dict[str, Any]:
    ruleset = json.loads(RULESET_PATH.read_text(encoding="utf-8"))
    expected_hash = ruleset.get("sourceData", {}).get("sha256")
    actual_hash = hashlib.sha256(MOVES_PATH.read_bytes()).hexdigest()
    if actual_hash != expected_hash:
        raise ManifestSeedError(
            "Canonical move source hash does not match data/move-automation/ruleset.json."
        )
    return ruleset


def load_existing_rows(
    manifest_path: Path,
    canonical_ids: set[str],
) -> dict[str, dict[str, Any]]:
    if not manifest_path.exists():
        return {}

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not isinstance(manifest, dict) or set(manifest) != MANIFEST_ROOT_FIELDS:
        raise ManifestSeedError("Existing manifest must contain only schemaVersion and moves.")
    if manifest.get("schemaVersion") != MANIFEST_SCHEMA_VERSION:
        raise ManifestSeedError(
            f"Existing manifest schemaVersion must be {MANIFEST_SCHEMA_VERSION}."
        )
    if not isinstance(manifest.get("moves"), list):
        raise ManifestSeedError("Existing manifest moves must be an array.")

    rows: dict[str, dict[str, Any]] = {}
    for index, row in enumerate(manifest["moves"]):
        if not isinstance(row, dict) or set(row) != MANIFEST_MOVE_FIELDS:
            raise ManifestSeedError(f"Existing manifest move at index {index} has an invalid shape.")
        canonical_id = row.get("canonicalId")
        if not isinstance(canonical_id, str) or canonical_id not in canonical_ids:
            raise ManifestSeedError(
                f"Existing manifest move at index {index} is not a canonical move."
            )
        if canonical_id in rows:
            raise ManifestSeedError(f"Existing manifest contains duplicate move {canonical_id!r}.")
        rows[canonical_id] = row
    return rows


def rules_provenance_reference(ruleset: dict[str, Any]) -> dict[str, Any]:
    return {
        "rulesetId": ruleset["rulesetId"],
        "canonicalizationVersion": ruleset["canonicalization"]["version"],
        "sourceDataSha256": ruleset["sourceData"]["sha256"],
    }


def bootstrap_row(
    move: dict[str, Any],
    is_registered: bool,
    ruleset: dict[str, Any],
) -> dict[str, Any]:
    canonical_id = move["name"]
    if is_registered:
        base_status = "assisted"
        runtime = {
            "kind": "legacy-v1",
            "version": None,
            "definitionHash": None,
            "sourceModule": None,
        }
        suggested_capability_tags: list[str] = []
        blocker_codes: list[str] = []
        limitations = [{
            "code": "audit.required",
            "summary": (
                "Semantic conformance review is required before this legacy "
                "implementation can be marked complete."
            ),
        }]
    else:
        base_status = "blocked"
        runtime = {
            "kind": "unimplemented",
            "version": None,
            "definitionHash": None,
            "sourceModule": None,
        }
        # These legacy worklist buckets are planning hints, never reviewed
        # capability claims. Authoritative capabilityTags remain empty.
        suggested_capability_tags = [classify_move_worklist_bucket(move)]
        blocker_codes = ["runtime.unimplemented"]
        limitations = []

    return {
        "canonicalId": canonical_id,
        "displayName": canonical_id,
        "baseStatus": base_status,
        "interactionStatus": "unassessed",
        "runtime": runtime,
        "rulesProvenance": rules_provenance_reference(ruleset),
        "capabilityTags": [],
        "suggestedCapabilityTags": suggested_capability_tags,
        "blockerCodes": blocker_codes,
        "limitations": limitations,
        "manualSteps": [],
        "scenarioIds": [],
        "reviewedAt": None,
        "unsupportedInteractionIds": [],
        "rolloutCohortId": None,
    }


def build_seeded_manifest(
    coverage: MoveCoverage,
    ruleset: dict[str, Any],
    existing_rows: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    expected_count = ruleset.get("canonicalization", {}).get("expectedMoveCount")
    if len(coverage.canonical_moves) != expected_count:
        raise ManifestSeedError(
            f"Canonical move count changed: expected {expected_count}, "
            f"received {len(coverage.canonical_moves)}."
        )
    if coverage.extra_names:
        raise ManifestSeedError(
            "Explicit registry contains unknown moves: " + ", ".join(coverage.extra_names)
        )

    moves = [
        existing_rows.get(move["name"])
        or bootstrap_row(move, move["name"] in coverage.explicit_names, ruleset)
        for move in coverage.canonical_moves
    ]
    canonical_ids = [row["canonicalId"] for row in moves]
    if len(set(canonical_ids)) != len(canonical_ids):
        raise ManifestSeedError("Generated manifest contains duplicate canonical move IDs.")

    return {
        "schemaVersion": MANIFEST_SCHEMA_VERSION,
        "moves": moves,
    }


def seed_manifest(manifest_path: Path = DEFAULT_MANIFEST_PATH) -> dict[str, Any]:
    ruleset = load_ruleset()
    coverage = build_coverage()
    canonical_ids = {move["name"] for move in coverage.canonical_moves}
    existing_rows = load_existing_rows(manifest_path, canonical_ids)
    manifest = build_seeded_manifest(coverage, ruleset, existing_rows)

    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return manifest


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Seed missing canonical rows without changing existing semantic statuses."
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_MANIFEST_PATH,
        help="manifest path to update (defaults to data/move-automation/manifest.json)",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        manifest = seed_manifest(args.output.resolve())
    except (ManifestSeedError, json.JSONDecodeError, KeyError, OSError) as error:
        print(f"Could not seed move automation manifest: {error}")
        return 1

    assisted = sum(row["baseStatus"] == "assisted" for row in manifest["moves"])
    blocked = sum(row["baseStatus"] == "blocked" for row in manifest["moves"])
    print(
        f"Wrote {len(manifest['moves'])} canonical move rows "
        f"({assisted} assisted, {blocked} blocked) to {args.output}."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
