#!/usr/bin/env python3
"""Read-only integrity audit for Plan 12 GM Campaign Toolkit SQLite authority."""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path
from typing import Any

LATEST_TOOLKIT_SCHEMA = 56


def load_json(raw: Any, label: str, errors: list[str]) -> dict[str, Any] | None:
    if not isinstance(raw, str):
        errors.append(f"{label}: JSON column is not text")
        return None
    try:
        value = json.loads(raw)
    except Exception as error:  # noqa: BLE001 - report every corrupt row
        errors.append(f"{label}: invalid JSON ({error})")
        return None
    if not isinstance(value, dict):
        errors.append(f"{label}: JSON root is not an object")
        return None
    return value


def audit(path: Path) -> dict[str, Any]:
    errors: list[str] = []
    counts: dict[str, int] = {}
    if not path.is_file():
        return {"schemaVersion": 1, "database": str(path), "status": "failed", "errors": ["database file does not exist"], "counts": {}}

    connection = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    try:
        version = int(connection.execute("PRAGMA user_version").fetchone()[0])
        counts["storageSchemaVersion"] = version
        if version != LATEST_TOOLKIT_SCHEMA:
            errors.append(f"storage schema must be {LATEST_TOOLKIT_SCHEMA}; found {version}")
        integrity = connection.execute("PRAGMA integrity_check").fetchall()
        if [row[0] for row in integrity] != ["ok"]:
            errors.append("SQLite integrity_check failed")
        foreign_keys = connection.execute("PRAGMA foreign_key_check").fetchall()
        counts["foreignKeyViolations"] = len(foreign_keys)
        if foreign_keys:
            errors.append(f"foreign_key_check found {len(foreign_keys)} violation(s)")

        table_names = {row[0] for row in connection.execute("SELECT name FROM sqlite_schema WHERE type = 'table'")}
        required_tables = {
            "gm_encounter_tables", "gm_encounter_table_ops", "gm_wild_generation_ops", "gm_generated_packages",
            "gm_toolkit_secrets", "gm_npc_archetypes", "gm_npc_archetype_ops", "gm_npc_generation_ops",
            "gm_npc_packages", "gm_session_preparations", "gm_session_preparation_ops", "sheets", "maps",
            "encounter_documents", "encounter_launch_ops",
        }
        missing_tables = sorted(required_tables - table_names)
        if missing_tables:
            errors.append(f"missing toolkit authority tables: {', '.join(missing_tables)}")
            return {"schemaVersion": 1, "database": str(path), "status": "failed", "errors": errors, "counts": counts}

        for table, key in [
            ("gm_encounter_tables", "tables"), ("gm_wild_generation_ops", "wildOperations"),
            ("gm_generated_packages", "wildPackages"), ("gm_npc_archetypes", "npcArchetypes"),
            ("gm_npc_generation_ops", "npcOperations"), ("gm_npc_packages", "npcPackages"),
            ("gm_session_preparations", "preparations"), ("gm_session_preparation_ops", "preparationOperations"),
            ("encounter_launch_ops", "launchOperations"),
        ]:
            counts[key] = int(connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])

        secret_rows = connection.execute("SELECT secret_id, secret_value FROM gm_toolkit_secrets").fetchall()
        counts["toolkitSecrets"] = len(secret_rows)
        if len(secret_rows) != 1 or secret_rows[0]["secret_id"] != "preview-signing-v1" or len(secret_rows[0]["secret_value"]) != 64:
            errors.append("preview signing authority must contain exactly one valid backup-safe secret")

        sheet_rows = connection.execute("SELECT kind, slug, revision, document_json FROM sheets").fetchall()
        sheets = {(row["kind"], row["slug"]): row for row in sheet_rows}
        maps = {row[0]: row for row in connection.execute("SELECT slug, revision FROM maps")}
        tables = {row[0]: row for row in connection.execute("SELECT table_id, revision, status FROM gm_encounter_tables")}
        wild_packages: dict[str, dict[str, Any]] = {}
        npc_packages: dict[str, dict[str, Any]] = {}

        for row in connection.execute("SELECT package_id, operation_id, package_json FROM gm_generated_packages"):
            package = load_json(row["package_json"], f"wild package {row['package_id']}", errors)
            if package is None:
                continue
            wild_packages[row["package_id"]] = package
            if package.get("packageId") != row["package_id"] or package.get("operationId") != row["operation_id"]:
                errors.append(f"wild package {row['package_id']}: receipt contradicts indexed identity")
            for ref in package.get("sheets", []):
                if not isinstance(ref, dict):
                    errors.append(f"wild package {row['package_id']}: malformed sheet receipt")
                    continue
                sheet = sheets.get((ref.get("kind"), ref.get("slug")))
                if sheet is None:
                    errors.append(f"wild package {row['package_id']}: missing ordinary sheet {ref.get('kind')}:{ref.get('slug')}")
                elif int(sheet["revision"]) < int(ref.get("revision", -1)):
                    errors.append(f"wild package {row['package_id']}: ordinary sheet revision regressed")

        for row in connection.execute("SELECT package_id, operation_id, trainer_slug, package_json FROM gm_npc_packages"):
            package = load_json(row["package_json"], f"NPC package {row['package_id']}", errors)
            if package is None:
                continue
            npc_packages[row["package_id"]] = package
            if package.get("packageId") != row["package_id"] or package.get("operationId") != row["operation_id"]:
                errors.append(f"NPC package {row['package_id']}: receipt contradicts indexed identity")
            refs = [package.get("trainer"), *package.get("roster", [])]
            for ref in refs:
                if not isinstance(ref, dict):
                    errors.append(f"NPC package {row['package_id']}: malformed sheet receipt")
                    continue
                sheet = sheets.get((ref.get("kind"), ref.get("slug")))
                if sheet is None:
                    errors.append(f"NPC package {row['package_id']}: missing ordinary sheet {ref.get('kind')}:{ref.get('slug')}")
                elif int(sheet["revision"]) < int(ref.get("revision", -1)):
                    errors.append(f"NPC package {row['package_id']}: ordinary sheet revision regressed")
            trainer = package.get("trainer", {})
            if isinstance(trainer, dict) and trainer.get("slug") != row["trainer_slug"]:
                errors.append(f"NPC package {row['package_id']}: Trainer custody index drifted")
            for ref in package.get("roster", []):
                if isinstance(ref, dict) and ref.get("ownerTrainerSlug") != row["trainer_slug"]:
                    errors.append(f"NPC package {row['package_id']}: roster custody receipt drifted")

        orphan_wild = int(connection.execute("SELECT COUNT(*) FROM gm_wild_generation_ops op LEFT JOIN gm_generated_packages pkg ON pkg.operation_id = op.operation_id WHERE pkg.operation_id IS NULL").fetchone()[0])
        orphan_npc = int(connection.execute("SELECT COUNT(*) FROM gm_npc_generation_ops op LEFT JOIN gm_npc_packages pkg ON pkg.operation_id = op.operation_id WHERE pkg.operation_id IS NULL").fetchone()[0])
        counts["orphanAcceptedGenerationOperations"] = orphan_wild + orphan_npc
        if orphan_wild or orphan_npc:
            errors.append("accepted generation operation exists without its atomic package receipt")

        launch_ops = {row["launch_id"]: row for row in connection.execute("SELECT launch_id, encounter_id FROM encounter_launch_ops")}
        encounters = {row["encounter_id"]: row for row in connection.execute("SELECT encounter_id, linked_map_slug FROM encounter_documents")}
        record_launch_ops = {
            (row["preparation_id"], json.loads(row["command_json"]).get("launchId")): row
            for row in connection.execute("SELECT preparation_id, command_json FROM gm_session_preparation_ops WHERE command_kind = 'record-launch'")
        }
        counts["recordLaunchOperations"] = len(record_launch_ops)

        for row in connection.execute("SELECT preparation_id, document_json FROM gm_session_preparations"):
            document = load_json(row["document_json"], f"preparation {row['preparation_id']}", errors)
            if document is None:
                continue
            for scene in document.get("scenes", []):
                if not isinstance(scene, dict):
                    errors.append(f"preparation {row['preparation_id']}: malformed scene")
                    continue
                map_ref = scene.get("map")
                if isinstance(map_ref, dict) and map_ref.get("slug") not in maps:
                    errors.append(f"preparation {row['preparation_id']}: dangling map {map_ref.get('slug')}")
                for candidate in scene.get("encounterCandidates", []):
                    source = candidate.get("source", {}) if isinstance(candidate, dict) else {}
                    kind = source.get("kind") if isinstance(source, dict) else None
                    if kind == "wild-package" and source.get("packageId") not in wild_packages:
                        errors.append(f"preparation {row['preparation_id']}: dangling wild package")
                    elif kind == "npc-package" and source.get("packageId") not in npc_packages:
                        errors.append(f"preparation {row['preparation_id']}: dangling NPC package")
                    elif kind == "encounter-table" and source.get("tableId") not in tables:
                        errors.append(f"preparation {row['preparation_id']}: dangling encounter table")
                    elif kind == "existing-sheets":
                        for ref in source.get("sheets", []):
                            if isinstance(ref, dict) and (ref.get("kind"), ref.get("slug")) not in sheets:
                                errors.append(f"preparation {row['preparation_id']}: dangling ordinary sheet")
            for launch in document.get("launches", []):
                if not isinstance(launch, dict):
                    errors.append(f"preparation {row['preparation_id']}: malformed launch evidence")
                    continue
                launch_id = launch.get("launchId")
                encounter_id = launch.get("encounterId")
                launch_row = launch_ops.get(launch_id)
                encounter = encounters.get(encounter_id)
                if launch_row is None or launch_row["encounter_id"] != encounter_id:
                    errors.append(f"preparation {row['preparation_id']}: dangling launch receipt {launch_id}")
                if encounter is None or encounter["linked_map_slug"] != launch.get("mapSlug"):
                    errors.append(f"preparation {row['preparation_id']}: launch map/Encounter evidence drifted")
                if (row["preparation_id"], launch_id) not in record_launch_ops:
                    errors.append(f"preparation {row['preparation_id']}: missing record-launch operation {launch_id}")

        counts["errors"] = len(errors)
        return {
            "schemaVersion": 1,
            "database": str(path),
            "status": "accepted" if not errors else "failed",
            "errors": errors,
            "counts": counts,
        }
    finally:
        connection.close()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", type=Path, required=True)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    report = audit(args.database.resolve())
    if args.json:
        print(json.dumps(report, sort_keys=True, separators=(",", ":")))
    else:
        print(f"GM Toolkit storage audit: {report['status']} ({report['counts'].get('errors', len(report['errors']))} errors)")
        for error in report["errors"]:
            print(f"ERROR: {error}", file=sys.stderr)
    return 0 if report["status"] == "accepted" else 1


if __name__ == "__main__":
    raise SystemExit(main())
