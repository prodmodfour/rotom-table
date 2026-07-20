#!/usr/bin/env python3
"""Seed and deterministically update the canonical ability semantic manifest.

Existing canonical rows are preserved byte-for-byte at the object level so a
rerun cannot silently promote, downgrade, or rewrite reviewed semantics. New
rows receive truthful blocked/unimplemented defaults and planning-only mode
hints.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
ABILITIES_PATH = ROOT / "data" / "reference" / "abilities.json"
RULESET_PATH = ROOT / "data" / "ability-automation" / "ruleset.json"
DEFAULT_MANIFEST_PATH = ROOT / "data" / "ability-automation" / "manifest.json"
MANIFEST_SCHEMA_VERSION = 1
COHORT_SIZE = 12
FIRST_COHORT_NUMBER = 60
MANIFEST_ROOT_FIELDS = {"schemaVersion", "abilities"}
MANIFEST_ABILITY_FIELDS = {
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
    "conformanceEvidence",
    "reviewedAt",
    "unsupportedInteractionIds",
    "rolloutCohortId",
}


class AbilityManifestSeedError(ValueError):
    """Raised when inputs cannot produce a truthful deterministic manifest."""


def load_ruleset() -> dict[str, Any]:
    ruleset = json.loads(RULESET_PATH.read_text(encoding="utf-8"))
    expected_hash = ruleset.get("sourceData", {}).get("sha256")
    actual_hash = hashlib.sha256(ABILITIES_PATH.read_bytes()).hexdigest()
    if actual_hash != expected_hash:
        raise AbilityManifestSeedError(
            "Canonical ability source hash does not match data/ability-automation/ruleset.json."
        )
    return ruleset


def load_canonical_abilities(ruleset: dict[str, Any]) -> list[dict[str, Any]]:
    source = json.loads(ABILITIES_PATH.read_text(encoding="utf-8"))
    if not isinstance(source, dict):
        raise AbilityManifestSeedError("Canonical ability source must be an object.")

    abilities: list[dict[str, Any]] = []
    for canonical_id, record in source.items():
        if (
            not isinstance(canonical_id, str)
            or not canonical_id
            or canonical_id.strip() != canonical_id
            or not isinstance(record, dict)
            or record.get("name") != canonical_id
        ):
            raise AbilityManifestSeedError(
                f"Canonical ability record {canonical_id!r} has an invalid identity."
            )
        if not isinstance(record.get("frequency"), str) or not isinstance(record.get("effect"), str):
            raise AbilityManifestSeedError(
                f"Canonical ability {canonical_id!r} must have reviewed frequency and effect text."
            )
        abilities.append(record)

    abilities.sort(key=lambda ability: ability["name"])
    expected_count = ruleset.get("canonicalization", {}).get("expectedAbilityCount")
    if len(abilities) != expected_count:
        raise AbilityManifestSeedError(
            f"Canonical ability count changed: expected {expected_count}, received {len(abilities)}."
        )
    return abilities


def load_existing_rows(
    manifest_path: Path,
    canonical_ids: set[str],
) -> dict[str, dict[str, Any]]:
    if not manifest_path.exists():
        return {}

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not isinstance(manifest, dict) or set(manifest) != MANIFEST_ROOT_FIELDS:
        raise AbilityManifestSeedError(
            "Existing ability manifest must contain only schemaVersion and abilities."
        )
    if manifest.get("schemaVersion") != MANIFEST_SCHEMA_VERSION:
        raise AbilityManifestSeedError(
            f"Existing ability manifest schemaVersion must be {MANIFEST_SCHEMA_VERSION}."
        )
    if not isinstance(manifest.get("abilities"), list):
        raise AbilityManifestSeedError("Existing ability manifest abilities must be an array.")

    rows: dict[str, dict[str, Any]] = {}
    for index, row in enumerate(manifest["abilities"]):
        if not isinstance(row, dict) or set(row) != MANIFEST_ABILITY_FIELDS:
            raise AbilityManifestSeedError(
                f"Existing ability manifest row at index {index} has an invalid shape."
            )
        canonical_id = row.get("canonicalId")
        if not isinstance(canonical_id, str) or canonical_id not in canonical_ids:
            raise AbilityManifestSeedError(
                f"Existing ability manifest row at index {index} is not canonical."
            )
        if canonical_id in rows:
            raise AbilityManifestSeedError(
                f"Existing ability manifest contains duplicate ability {canonical_id!r}."
            )
        rows[canonical_id] = row
    return rows


def provenance_reference(ruleset: dict[str, Any]) -> dict[str, Any]:
    return {
        "rulesetId": ruleset["rulesetId"],
        "canonicalizationVersion": ruleset["canonicalization"]["version"],
        "sourceDataSha256": ruleset["sourceData"]["sha256"],
    }


def suggested_mode(ability: dict[str, Any]) -> str:
    if ability["frequency"].strip().lower() == "static":
        return "mode.static"
    if isinstance(ability.get("trigger"), str) and ability["trigger"].strip():
        return "mode.triggered"
    return "mode.activated"


def cohort_id(index: int) -> str:
    return f"aa-{FIRST_COHORT_NUMBER + index // COHORT_SIZE:03d}"


def bootstrap_row(
    ability: dict[str, Any],
    index: int,
    ruleset: dict[str, Any],
) -> dict[str, Any]:
    canonical_id = ability["name"]
    return {
        "canonicalId": canonical_id,
        "displayName": canonical_id,
        "baseStatus": "blocked",
        "interactionStatus": "unassessed",
        "runtime": {
            "kind": "unimplemented",
            "version": None,
            "definitionHash": None,
            "sourceModule": None,
        },
        "rulesProvenance": provenance_reference(ruleset),
        "capabilityTags": [],
        "suggestedCapabilityTags": [suggested_mode(ability)],
        "blockerCodes": ["runtime.unimplemented"],
        "limitations": [],
        "manualSteps": [],
        "scenarioIds": [],
        "conformanceEvidence": {
            "requirementTags": [],
            "scenarios": [],
            "notApplicable": [],
        },
        "reviewedAt": None,
        "unsupportedInteractionIds": [],
        "rolloutCohortId": cohort_id(index),
    }


def build_seeded_manifest(
    abilities: list[dict[str, Any]],
    ruleset: dict[str, Any],
    existing_rows: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    rows = [
        existing_rows.get(ability["name"])
        or bootstrap_row(ability, index, ruleset)
        for index, ability in enumerate(abilities)
    ]
    identities = [row["canonicalId"] for row in rows]
    if len(set(identities)) != len(identities):
        raise AbilityManifestSeedError(
            "Generated ability manifest contains duplicate canonical identities."
        )
    return {"schemaVersion": MANIFEST_SCHEMA_VERSION, "abilities": rows}


def seed_manifest(manifest_path: Path = DEFAULT_MANIFEST_PATH) -> dict[str, Any]:
    ruleset = load_ruleset()
    abilities = load_canonical_abilities(ruleset)
    existing_rows = load_existing_rows(
        manifest_path,
        {ability["name"] for ability in abilities},
    )
    manifest = build_seeded_manifest(abilities, ruleset, existing_rows)
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return manifest


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Seed missing canonical ability rows without changing reviewed rows."
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_MANIFEST_PATH,
        help="manifest path to update (defaults to data/ability-automation/manifest.json)",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        manifest = seed_manifest(args.output.resolve())
    except (AbilityManifestSeedError, json.JSONDecodeError, KeyError, OSError) as error:
        print(f"Could not seed ability automation manifest: {error}")
        return 1

    blocked = sum(row["baseStatus"] == "blocked" for row in manifest["abilities"])
    print(
        f"Wrote {len(manifest['abilities'])} canonical ability rows "
        f"({blocked} blocked) to {args.output}."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
