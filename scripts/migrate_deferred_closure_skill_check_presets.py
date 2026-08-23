#!/usr/bin/env python3
"""Build the reviewed generic Skill Check DC workflow presets.

Documentary markdown is provenance only. Runtime reads the generated app-owned
contract and never parses source prose. Generation fails closed unless every
reviewed source byte remains exact.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data/deferred-closure/skill-check-dc-presets.v1.json"
SOURCES = (
    (
        "books/markdown/core/03-skills-edges-and-features.md",
        "96a3da4eb912079b7f73025d92c9caf489b58c4993b235a25cc41364ed88a4d9",
        "PTU core page 34 general Skill Check difficulty guidance",
    ),
    (
        "books/markdown/core/11-running-the-game.md",
        "46d21f9baea3ee7add852126c79ec376897f78ba9e55d812cd6860885c03df74",
        "PTU core pages 465-466 probability and rank-average guidance",
    ),
    (
        "data/deferred-closure/skill-check-contract.v1.json",
        "af2dc778b80df4f5ad967168b1ca55f86bb71e008db2d236f768c2df3ade094c",
        "Reviewed generic Skill Check DC bounds and comparison policy",
    ),
)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def build() -> dict[str, object]:
    source_rows: list[dict[str, str]] = []
    for relative_path, expected_hash, finding in SOURCES:
        path = ROOT / relative_path
        actual_hash = sha256(path)
        if actual_hash != expected_hash:
            raise SystemExit(
                f"{relative_path} changed ({actual_hash}); reviewed P11-047 migration required"
            )
        source_rows.append({"path": relative_path, "sha256": expected_hash, "finding": finding})

    return {
        "schemaVersion": 1,
        "registryId": "generic-skill-check-dc-presets-v1",
        "ticket": "P11-047",
        "status": "reviewed",
        "runtimeProseParsing": False,
        "explicitDifficultyClass": {"minimum": 1, "maximum": 100},
        "presets": [
            {
                "presetId": "skill-check-dc-preset:v1:easy",
                "label": "Easy",
                "difficultyClass": 5,
                "guidance": "Easy for most Untrained or better participants",
            },
            {
                "presetId": "skill-check-dc-preset:v1:challenging",
                "label": "Challenging",
                "difficultyClass": 10,
                "guidance": "A challenging general Skill Check",
            },
            {
                "presetId": "skill-check-dc-preset:v1:hard",
                "label": "Hard",
                "difficultyClass": 15,
                "guidance": "Usually requires meaningful Skill investment",
            },
            {
                "presetId": "skill-check-dc-preset:v1:nigh-impossible",
                "label": "Nigh-impossible",
                "difficultyClass": 25,
                "guidance": "Reserved for masters of their craft",
            },
        ],
        "sourceAuthority": source_rows,
        "policy": {
            "presetSemantics": "workflow-alias-for-exact-difficulty-class",
            "explicitValuesRemainAllowed": True,
            "gmOwnsSelection": True,
            "runtimeSource": "this-reviewed-json-only",
        },
    }


def encoded(value: object) -> bytes:
    return (json.dumps(value, indent=2, ensure_ascii=False) + "\n").encode("utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    expected = encoded(build())
    if args.check:
        if not OUTPUT.exists() or OUTPUT.read_bytes() != expected:
            raise SystemExit("Skill Check DC preset registry is stale; regenerate and review it.")
        return
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_bytes(expected)


if __name__ == "__main__":
    main()
