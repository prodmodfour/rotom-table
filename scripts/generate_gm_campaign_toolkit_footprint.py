#!/usr/bin/env python3
"""Generate/check the immutable Plan 12 activation footprint and its final dispositions."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
FOOTPRINT = ROOT / "data/gm-campaign-toolkit/generation-preparation-footprint.v1.json"
FINALITY = ROOT / "data/gm-campaign-toolkit/footprint-finality.v1.json"
EXPECTED_ACTIVATION_SHA256 = "161be4cb987549b3947ba65262d325fcfd28dd5538286d633528e4ef2a2f9862"
VALID_FINAL_STATES = {"Native", "Migrated", "Preserved", "Retired", "Documentary"}
TABLE_PATHS = (
    "encounter_tables/spire-city/streets.json",
    "encounter_tables/thickerby_vale/cave.json",
    "encounter_tables/thickerby_vale/forest.json",
    "encounter_tables/thickerby_vale/riverbank.json",
)


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def canonical_species() -> set[str]:
    rows = load_json(ROOT / "data/reference/pokedex.json")
    return {row["species"] for row in rows if isinstance(row, dict) and isinstance(row.get("species"), str)}


def table_validation(path: str, species: set[str]) -> dict[str, Any]:
    table = load_json(ROOT / path)
    rows = table.get("entries", [])
    legacy = sum(1 for row in rows if isinstance(row, list))
    nothing = sum(
        1 for row in rows
        if (isinstance(row, dict) and str(row.get("species", "")).casefold() == "nothing")
        or (isinstance(row, list) and len(row) > 1 and str(row[1]).casefold() == "nothing")
    )
    names = [
        row.get("species") if isinstance(row, dict) else row[1] if isinstance(row, list) and len(row) > 1 else None
        for row in rows
    ]
    unknown = sorted({name for name in names if isinstance(name, str) and name.casefold() != "nothing" and name not in species})
    return {
        "path": path,
        "name": table.get("name"),
        "rows": len(rows),
        "legacyTupleRows": legacy,
        "explicitNothingRows": nothing,
        "unknownSpecies": unknown,
        "tableLevelRange": [table.get("min_level"), table.get("max_level")],
        "disposition": "REUSABLE" if not unknown else "REPAIR_REQUIRED",
    }


def refresh_footprint(source: dict[str, Any]) -> dict[str, Any]:
    result = json.loads(json.dumps(source))
    species = canonical_species()
    tables = [table_validation(path, species) for path in TABLE_PATHS]
    result["legacyTableValidation"] = {
        "tables": tables,
        "totals": {
            "tables": len(tables),
            "rows": sum(row["rows"] for row in tables),
            "legacyTupleRows": sum(row["legacyTupleRows"] for row in tables),
            "unknownSpecies": sum(len(row["unknownSpecies"]) for row in tables),
            "repairRequired": sum(row["disposition"] != "REUSABLE" for row in tables),
        },
    }
    for row in result["rows"]:
        path = row.get("path")
        if isinstance(path, str):
            candidate = ROOT / path
            row["sha256"] = sha256(candidate) if candidate.is_file() else None
    return result


def check(allow_updated_activation: bool, require_final: bool) -> list[str]:
    errors: list[str] = []
    footprint = load_json(FOOTPRINT)
    rows = footprint.get("rows")
    if not isinstance(rows, list) or len(rows) != 40:
        errors.append("activation footprint must contain exactly 40 rows")
        rows = []
    if footprint.get("summary", {}).get("rowCount") != 40:
        errors.append("activation footprint summary.rowCount must be 40")
    actual_sha = sha256(FOOTPRINT)
    if not allow_updated_activation and actual_sha != EXPECTED_ACTIVATION_SHA256:
        errors.append(f"activation footprint drifted: expected {EXPECTED_ACTIVATION_SHA256}, got {actual_sha}")

    finality = load_json(FINALITY)
    if require_final:
        if finality.get("status") != "accepted-final":
            errors.append("footprint finality status must be accepted-final")
        if finality.get("finalityTicket") != "P12-093":
            errors.append("footprint finality must bind acceptance to P12-093")
    dispositions = finality.get("rows")
    if not isinstance(dispositions, list) or len(dispositions) != 40:
        errors.append("footprint finality registry must contain exactly 40 rows")
        dispositions = []
    by_key = {str(row.get("rowKey")): row for row in dispositions if isinstance(row, dict)}

    for index, row in enumerate(rows):
        key = row.get("path") or f"absent:{row.get('surface')}"
        disposition = by_key.get(str(key))
        if not disposition:
            errors.append(f"footprint row {index + 1} ({key}) has no finality disposition")
            continue
        target = disposition.get("targetState")
        state = disposition.get("implementationState")
        if target not in VALID_FINAL_STATES:
            errors.append(f"{key}: invalid targetState {target!r}")
        if state not in VALID_FINAL_STATES | {"Pending", "Blocked"}:
            errors.append(f"{key}: invalid implementationState {state!r}")
        if state == "Blocked" and require_final:
            errors.append(f"{key}: Blocked is forbidden at final acceptance")
        if state == "Pending":
            path = row.get("path")
            if isinstance(path, str) and isinstance(row.get("sha256"), str):
                candidate = ROOT / path
                if not candidate.is_file():
                    errors.append(f"{key}: pending activation source is missing")
                elif sha256(candidate) != row["sha256"]:
                    interim = disposition.get("approvedInterimDrift")
                    if not isinstance(interim, dict) or not isinstance(interim.get("ticket"), str) or not interim.get("authorityPaths"):
                        errors.append(f"{key}: pending activation source drifted without a reviewed disposition")
                    else:
                        for interim_path in interim["authorityPaths"]:
                            if not isinstance(interim_path, str) or not (ROOT / interim_path).exists():
                                errors.append(f"{key}: approved interim authority path is missing: {interim_path!r}")
            if require_final:
                errors.append(f"{key}: Pending is forbidden at final acceptance")
        else:
            if state != target:
                errors.append(f"{key}: implementationState {state!r} does not equal targetState {target!r}")
            authority_paths = disposition.get("authorityPaths")
            if not isinstance(authority_paths, list) or not authority_paths:
                errors.append(f"{key}: final disposition must name authorityPaths")
            else:
                for authority_path in authority_paths:
                    if not isinstance(authority_path, str) or not (ROOT / authority_path).exists():
                        errors.append(f"{key}: authority path is missing: {authority_path!r}")
            if not isinstance(disposition.get("ownerTicket"), str) or not disposition["ownerTicket"]:
                errors.append(f"{key}: final disposition must name an ownerTicket")
            if not isinstance(disposition.get("proof"), str) or not disposition["proof"].strip():
                errors.append(f"{key}: final disposition must include proof")
            if state in {"Native", "Migrated", "Preserved"} and disposition.get("runtimeReachable") is not True:
                errors.append(f"{key}: active authority must assert runtimeReachable=true")
            if state == "Retired":
                if disposition.get("runtimeReachable") is not False:
                    errors.append(f"{key}: retired row must assert runtimeReachable=false")
                activation_path = row.get("path")
                if isinstance(activation_path, str) and (ROOT / activation_path).exists():
                    errors.append(f"{key}: retired activation source must be absent")
            if state == "Documentary" and disposition.get("runtimeReachable") is not False:
                errors.append(f"{key}: documentary row must assert runtimeReachable=false")

    final_counts = {state: 0 for state in sorted(VALID_FINAL_STATES)}
    for disposition in dispositions:
        if isinstance(disposition, dict) and disposition.get("implementationState") in final_counts:
            final_counts[disposition["implementationState"]] += 1
    expected_summary = {
        "rows": len(dispositions),
        "final": sum(final_counts.values()),
        "pending": sum(1 for row in dispositions if isinstance(row, dict) and row.get("implementationState") == "Pending"),
        "blocked": sum(1 for row in dispositions if isinstance(row, dict) and row.get("implementationState") == "Blocked"),
        "byState": {state: final_counts[state] for state in ("Native", "Migrated", "Preserved", "Retired", "Documentary")},
    }
    if finality.get("summary") != expected_summary:
        errors.append("footprint finality summary must exactly match computed row states")

    if len(by_key) != len(dispositions):
        errors.append("footprint finality rowKey values must be unique")
    footprint_keys = {str(row.get("path") or f"absent:{row.get('surface')}") for row in rows}
    if set(by_key) != footprint_keys:
        errors.append("footprint and finality row keys must match exactly")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--write", action="store_true", help="refresh hashes and legacy-table validation in the activation artifact")
    parser.add_argument("--check", action="store_true", help="check activation footprint and disposition coverage")
    parser.add_argument("--check-final", action="store_true", help="also require every row to be in a final state")
    parser.add_argument("--allow-updated-activation", action="store_true", help="used only when intentionally minting a reviewed replacement activation artifact")
    args = parser.parse_args()

    if args.write:
        source = load_json(FOOTPRINT)
        refreshed = refresh_footprint(source)
        FOOTPRINT.write_text(json.dumps(refreshed, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"wrote {FOOTPRINT.relative_to(ROOT)} ({len(refreshed['rows'])} rows)")

    errors = check(args.allow_updated_activation, args.check_final)
    if errors:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
        return 1
    print(f"GM Campaign Toolkit footprint: 40/40 registered; final={args.check_final}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
