#!/usr/bin/env python3
"""Source-hash-bound migration of the four reviewed legacy encounter tables."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data/gm-campaign-toolkit/migrated-legacy-tables.v1.json"
FOOTPRINT = ROOT / "data/gm-campaign-toolkit/generation-preparation-footprint.v1.json"
MIGRATED_AT = "2026-08-25T00:00:00.000Z"
SOURCES = (
    ("encounter_tables/spire-city/streets.json", "spire-city-streets", "Spire City Streets", ["Urban"]),
    ("encounter_tables/thickerby_vale/cave.json", "thickerby-vale-caves", "Thickerby Vale Caves", ["Cave"]),
    ("encounter_tables/thickerby_vale/forest.json", "thickerby-vale-forest", "Thickerby Vale Forest", ["Forest"]),
    ("encounter_tables/thickerby_vale/riverbank.json", "thickerby-vale-riverbank", "Thickerby Vale Riverbank", ["Fresh Water", "Wetland"]),
)


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def source_hashes() -> dict[str, str]:
    footprint = load(FOOTPRINT)
    return {
        row["path"]: row["sha256"]
        for row in footprint["rows"]
        if isinstance(row.get("path"), str) and row.get("kind") == "campaign-table"
    }


def normalize_entries(source: dict[str, Any], slug: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    previous_ceiling = 0
    saw_nothing = False
    for index, entry in enumerate(source["entries"], start=1):
        if isinstance(entry, list):
            ceiling, species = entry[0], entry[1]
            weight = max(1, round(float(ceiling)) - previous_ceiling)
            previous_ceiling = round(float(ceiling))
            min_level = entry[2] if len(entry) > 2 else source["min_level"]
            max_level = entry[3] if len(entry) > 3 else source["max_level"]
        else:
            species = entry["species"]
            if entry.get("weight") is not None:
                weight = round(float(entry["weight"]))
                previous_ceiling += weight
            else:
                ceiling = round(float(entry.get("ceiling", previous_ceiling + 1)))
                weight = max(1, ceiling - previous_ceiling)
                previous_ceiling = ceiling
            min_level = entry.get("min_level", source["min_level"])
            max_level = entry.get("max_level", source["max_level"])
        row_id = f"encounter-row:v1:{slug}-{index:02d}"
        predicates = {"timeOfDay": [], "weather": []}
        if str(species).strip().casefold() == "nothing":
            rows.append({"rowId": row_id, "kind": "nothing", "weight": weight, "predicates": predicates})
            saw_nothing = True
        else:
            rows.append({
                "rowId": row_id,
                "kind": "species",
                "speciesId": str(species).strip(),
                "weight": weight,
                "minLevel": min(int(min_level), int(max_level)),
                "maxLevel": max(int(min_level), int(max_level)),
                "predicates": predicates,
            })
    if not saw_nothing:
        rows.append({
            "rowId": f"encounter-row:v1:{slug}-{len(rows) + 1:02d}",
            "kind": "nothing",
            "weight": 60,
            "predicates": {"timeOfDay": [], "weather": []},
        })
    return rows


def generate() -> dict[str, Any]:
    expected_hashes = source_hashes()
    tables = []
    sources = []
    for path, slug, reviewed_name, environment_tags in SOURCES:
        full = ROOT / path
        actual_hash = digest(full)
        expected_hash = expected_hashes.get(path)
        if actual_hash != expected_hash:
            raise RuntimeError(f"legacy source drifted: {path}: expected {expected_hash}, got {actual_hash}")
        source = load(full)
        table_id = f"encounter-table:v1:{slug}"
        rows = normalize_entries(source, slug)
        tables.append({
            "schemaVersion": 1,
            "documentKind": "encounter-table",
            "tableId": table_id,
            "revision": 0,
            "status": "active",
            "name": reviewed_name,
            "environmentTags": environment_tags,
            "predicates": {"timeOfDay": [], "weather": []},
            "rows": rows,
            "groupSizePolicy": {"kind": "party-scale", "minimum": 1, "maximum": 30, "perAdditionalTrainer": 1},
            "notes": "",
            "provenance": {
                "kind": "legacy-migration",
                "sourceLabel": path,
                "sourceSha256": actual_hash,
                "sourceTableId": None,
                "sourceRevision": None,
            },
            "createdAt": MIGRATED_AT,
            "updatedAt": MIGRATED_AT,
            "archivedAt": None,
        })
        sources.append({
            "path": path,
            "sha256": actual_hash,
            "sourceName": source.get("name"),
            "tableId": table_id,
            "speciesRows": sum(row["kind"] == "species" for row in rows),
            "nothingWeight": next(row["weight"] for row in rows if row["kind"] == "nothing"),
        })
    return {
        "schemaVersion": 1,
        "migrationId": "gm-campaign-toolkit-legacy-tables-v1",
        "ticket": "P12-014",
        "migratedAt": MIGRATED_AT,
        "sourcePolicy": "activation-sha256-exact",
        "sources": sources,
        "tables": tables,
        "summary": {
            "tables": len(tables),
            "speciesRows": sum(row["speciesRows"] for row in sources),
            "explicitNothingRows": len(tables),
            "unknownSpecies": 0,
        },
    }


def serialized(value: Any) -> str:
    return json.dumps(value, indent=2, ensure_ascii=False) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    try:
        expected = serialized(generate())
    except Exception as error:  # noqa: BLE001
        print(f"ERROR: {error}", file=sys.stderr)
        return 1
    if args.write:
        OUT.parent.mkdir(parents=True, exist_ok=True)
        OUT.write_text(expected, encoding="utf-8")
        print(f"wrote {OUT.relative_to(ROOT)}")
    if args.check or not args.write:
        if not OUT.is_file() or OUT.read_text(encoding="utf-8") != expected:
            print(f"ERROR: {OUT.relative_to(ROOT)} is missing or stale", file=sys.stderr)
            return 1
        print("legacy encounter table migration: 4/4 source-bound documents")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
