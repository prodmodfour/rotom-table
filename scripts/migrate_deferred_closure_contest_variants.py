#!/usr/bin/env python3
"""Apply/check the reviewed Plan 11 Contest-variant successor.

Documentary markdown is migration provenance only. Runtime code consumes the
structured app-owned data/reference/contests.json successor.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = ROOT / "scripts/reviewed-data/deferred-closure-contest-variants.v1.json"
TARGET_PATH = ROOT / "data/reference/contests.json"
BASE_MIGRATION_ID = "pokemon-contests:v1"


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def git_blob(value: bytes) -> str:
    return hashlib.sha1(f"blob {len(value)}\0".encode("ascii") + value).hexdigest()


def load_manifest() -> dict[str, Any]:
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    if (
        manifest.get("schemaVersion") != 1
        or manifest.get("migrationId") != "deferred-closure:contest-variants:v1"
        or manifest.get("ticket") != "P11-006"
        or manifest.get("status") != "reviewed"
    ):
        raise RuntimeError("Contest-variant successor manifest is not reviewed P11-006 authority")
    for source in manifest["sources"]:
        actual = sha256_bytes((ROOT / source["path"]).read_bytes())
        if actual != source["sha256"]:
            raise RuntimeError(f"stale source fingerprint for {source['path']}")
    ids = manifest.get("changedVariantIds")
    rows = manifest.get("variantRows")
    if ids != ["trainer-participant", "battle"] or [row.get("id") for row in rows] != ids:
        raise RuntimeError("reviewed successor must define exactly the two closure variants")
    return manifest


def successor_record(manifest: dict[str, Any]) -> dict[str, Any]:
    return {
        "migrationId": manifest["migrationId"],
        "ticket": manifest["ticket"],
        "beforeSha256": manifest["target"]["beforeSha256"],
        "sourceFingerprint": {
            "algorithm": "sha256",
            "sources": [
                {"path": row["path"], "sha256": row["sha256"]}
                for row in manifest["sources"]
            ],
        },
        "changedVariantIds": manifest["changedVariantIds"],
        "runtimeProseParsing": False,
    }


def expected_document(current: dict[str, Any], manifest: dict[str, Any]) -> dict[str, Any]:
    if current.get("schemaVersion") != 1 or current.get("reviewedMigrationId") != BASE_MIGRATION_ID:
        raise RuntimeError("canonical Contest catalog is not the reviewed Plan 10 authority")
    replacements = {row["id"]: row for row in manifest["variantRows"]}
    existing_ids = [row.get("id") for row in current.get("variants", [])]
    if any(identity not in existing_ids for identity in replacements):
        raise RuntimeError("canonical Contest catalog is missing a successor variant identity")
    result = json.loads(json.dumps(current))
    result["variants"] = [replacements.get(row["id"], row) for row in result["variants"]]
    result["reviewedSuccessors"] = [successor_record(manifest)]
    return result


def render(value: dict[str, Any]) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def validate_target(raw: bytes, manifest: dict[str, Any]) -> None:
    target = manifest["target"]
    if (
        len(raw) != target["afterBytes"]
        or sha256_bytes(raw) != target["afterSha256"]
        or git_blob(raw) != target["afterGitBlob"]
    ):
        raise RuntimeError("installed Contest-variant successor fingerprint drifted")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if args.write == args.check:
        parser.error("choose exactly one of --write or --check")

    manifest = load_manifest()
    raw = TARGET_PATH.read_bytes()
    current_hash = sha256_bytes(raw)
    target = manifest["target"]
    if current_hash not in {target["beforeSha256"], target["afterSha256"]}:
        raise RuntimeError("Contest catalog is neither the reviewed baseline nor reviewed successor")
    current = json.loads(raw)
    expected = render(expected_document(current, manifest))
    if args.write:
        TARGET_PATH.write_bytes(expected)
        validate_target(expected, manifest)
        print("installed reviewed Trainer Participant and Battle Contest structured authority")
        return 0
    validate_target(raw, manifest)
    if raw != expected:
        raise RuntimeError("Contest variant successor differs from the reviewed migration")
    print("deferred closure Contest variant successor check passed")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except RuntimeError as error:
        print(f"Contest variant migration error: {error}", file=sys.stderr)
        raise SystemExit(1)
