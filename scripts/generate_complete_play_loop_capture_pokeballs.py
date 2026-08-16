#!/usr/bin/env python3
"""Generate/check the reviewed P8-093 structured Poké Ball provider contract."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / "data/reference/items.json"
SOURCE = ROOT / "scripts/reviewed-data/capture-pokeballs.v1.json"
OUTPUT = ROOT / "data/complete-play-loop/capture-pokeballs.v1.json"
SOURCE_SHA256 = "9f0eaaabd87bd66d5cd7ec17091a862f39f0c20a91225c0dd449aa558575840b"


def stable(value: Any) -> str:
    if isinstance(value, dict):
        return "{" + ",".join(json.dumps(key, ensure_ascii=False) + ":" + stable(value[key]) for key in sorted(value)) + "}"
    if isinstance(value, list):
        return "[" + ",".join(stable(entry) for entry in value) + "]"
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    raw_catalog = CATALOG.read_bytes()
    raw_source = SOURCE.read_bytes()
    if sha(raw_source) != SOURCE_SHA256:
        raise SystemExit("Reviewed Poké Ball provider source drifted.")
    catalog = json.loads(raw_catalog)
    source = json.loads(raw_source)
    rows = source.get("items")
    expected = {name for name, row in catalog.items() if "Poké Ball" in row.get("categories", [])}
    if (source.get("schemaVersion"), source.get("ticket"), source.get("reviewStatus"), source.get("runtimeProseParsing")) != (1, "P8-093", "accepted", False) \
            or source.get("catalogSha256") != sha(raw_catalog) or not isinstance(rows, list):
        raise SystemExit("Reviewed Poké Ball provider identity or catalog binding drifted.")
    ids = [row.get("canonicalId") for row in rows if isinstance(row, dict)]
    if len(ids) != len(set(ids)) or set(ids) != expected or len(ids) != 25:
        raise SystemExit("Reviewed Poké Ball provider must cover every canonical Ball exactly once.")
    for row in rows:
        canonical = catalog[row["canonicalId"]]
        if row.get("canonicalRecordSha256") != sha(stable(canonical).encode()) \
                or row.get("canonicalEffectSha256") != sha("\n".join(canonical["effects"]).encode()) \
                or not isinstance(row.get("baseModifier"), int) \
                or not isinstance(row.get("condition"), dict) \
                or not isinstance(row.get("postCapture"), dict):
            raise SystemExit(f"Reviewed Poké Ball evidence drifted for {row['canonicalId']}.")
    document = {
        "schemaVersion": 1,
        "ticket": "P8-093",
        "status": "reviewed-native",
        "runtimeProseParsing": False,
        "catalogSha256": sha(raw_catalog),
        "reviewedSourceSha256": SOURCE_SHA256,
        "itemCount": len(rows),
        "registrySha256": sha(stable(rows).encode()),
        "items": rows,
    }
    rendered = json.dumps(document, ensure_ascii=False, indent=2) + "\n"
    if args.check:
        if not OUTPUT.is_file() or OUTPUT.read_text() != rendered:
            raise SystemExit("Structured Poké Ball provider contract is stale.")
    else:
        OUTPUT.write_text(rendered)


if __name__ == "__main__":
    main()
