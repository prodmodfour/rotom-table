#!/usr/bin/env python3
"""Install/check the reviewed P8-093 Black Sludge structured acquisition cost."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
ITEMS = ROOT / "data/reference/items.json"
SPECS = ROOT / "data/complete-play-loop/specs.v1.json"
REVIEW = ROOT / "scripts/reviewed-data/black-sludge-acquisition-cost.v1.json"
REVIEW_SHA256 = "a37cf5969dc102007e12b9aae81d3144c9b12aaa0b06e8413820919a67d1d5d5"
BEFORE_CATALOG_SHA256 = "757d7a52a7ebc015025060bfb94273c3ad0ecd54dae98017d838529966e5d329"
AFTER_CATALOG_SHA256 = "62b29a499c791d689f6efc99e04ed515a71336421352626749cf6cc7407982c8"
BEFORE_RECORD_SHA256 = "e9556f3ccabe1ab9f705fe3c018a83471e01ec3c4dc87bd94e21e462962db67a"
AFTER_RECORD_SHA256 = "507c203bcd29d275c94b06e9a6efb0247e36277a92e3f5b66a6f1667a27fd250"
EFFECT_SHA256 = "1c8bc08ec3299790b9d97ea86962bddec8e490a101f44b25c66b93ff7f64c3a3"
BEFORE_SPECS_SHA256 = "bf0a74b237eab416c8b082f7547edb36ceb2c32c673eba1bff7bda4b7a1e7cba"
AFTER_SPECS_SHA256 = "8526cc06462ab8ea0146c3e2cc9556bb3d50d2505f2d18499b230a04048de1fe"


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def stable(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()


def expected_bytes(catalog: dict[str, Any]) -> bytes:
    updated = json.loads(json.dumps(catalog, ensure_ascii=False))
    updated["Black Sludge"]["costs"] = ["$500"]
    return (json.dumps(updated, ensure_ascii=False, indent=2) + "\n").encode()


def expected_specs_bytes(source: dict[str, Any], review: dict[str, Any]) -> bytes:
    updated = json.loads(json.dumps(source, ensure_ascii=False))
    updated["catalogSha256"] = AFTER_CATALOG_SHA256
    if any(row.get("canonicalId") == "Black Sludge" for row in updated.get("specs", [])):
        raise SystemExit("Black Sludge runtime spec already existed in the reviewed source state.")
    updated["specs"].append({
        "canonicalId": "Black Sludge",
        "recordSha256": AFTER_RECORD_SHA256,
        "effectSha256": EFFECT_SHA256,
        "effect": review["decision"]["runtimeEffect"],
    })
    updated["specs"].sort(key=lambda row: row["canonicalId"])
    return (json.dumps(updated, ensure_ascii=False, indent=2) + "\n").encode()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    review_raw = REVIEW.read_bytes()
    if sha(review_raw) != REVIEW_SHA256:
        raise SystemExit("Reviewed Black Sludge acquisition-cost evidence drifted.")
    review = json.loads(review_raw)
    if (review.get("schemaVersion"), review.get("ticket"), review.get("reviewStatus"), review.get("migrationId")) != (
        1, "P8-093", "accepted", "item-black-sludge-acquisition-cost-v1"
    ):
        raise SystemExit("Reviewed Black Sludge acquisition-cost identity is invalid.")
    current_raw = ITEMS.read_bytes()
    current_hash = sha(current_raw)
    catalog = json.loads(current_raw)
    row = catalog.get("Black Sludge")
    if not isinstance(row, dict) or row.get("name") != "Black Sludge":
        raise SystemExit("Canonical Black Sludge row is unavailable.")
    effect_hash = sha("\n".join(row.get("effects", [])).encode())
    if effect_hash != EFFECT_SHA256 or review.get("sourceEffectSha256") != EFFECT_SHA256:
        raise SystemExit("Canonical Black Sludge effect evidence drifted.")
    record_hash = sha(stable(row))
    if current_hash == BEFORE_CATALOG_SHA256:
        if args.check:
            raise SystemExit("Black Sludge structured acquisition-cost migration is not installed.")
        if record_hash != BEFORE_RECORD_SHA256 or review.get("sourceRecordSha256") != BEFORE_RECORD_SHA256:
            raise SystemExit("Black Sludge source record drifted before migration.")
        rendered = expected_bytes(catalog)
        if sha(rendered) != AFTER_CATALOG_SHA256:
            raise SystemExit("Black Sludge migration output fingerprint is unexpected.")
        ITEMS.write_bytes(rendered)
        return
    if current_hash != AFTER_CATALOG_SHA256 or record_hash != AFTER_RECORD_SHA256 or row.get("costs") != ["$500"]:
        raise SystemExit("Black Sludge catalog state is neither the reviewed source nor destination.")
    if review.get("decision", {}).get("costs") != ["$500"] or review.get("decision", {}).get("amount") != 500:
        raise SystemExit("Reviewed Black Sludge acquisition-cost decision drifted.")

    specs_raw = SPECS.read_bytes()
    specs_hash = sha(specs_raw)
    if specs_hash == BEFORE_SPECS_SHA256:
        if args.check:
            raise SystemExit("Black Sludge runtime ItemSpec migration is not installed.")
        if review.get("sourceSpecsSha256") != BEFORE_SPECS_SHA256:
            raise SystemExit("Reviewed Black Sludge ItemSpec source evidence drifted.")
        rendered = expected_specs_bytes(json.loads(specs_raw), review)
        if sha(rendered) != AFTER_SPECS_SHA256:
            raise SystemExit("Black Sludge ItemSpec migration output fingerprint is unexpected.")
        SPECS.write_bytes(rendered)
        return
    if specs_hash != AFTER_SPECS_SHA256:
        raise SystemExit("Black Sludge ItemSpec state is neither the reviewed source nor destination.")
    specs = json.loads(specs_raw)
    rows = [row for row in specs.get("specs", []) if row.get("canonicalId") == "Black Sludge"]
    if (len(rows) != 1
        or specs.get("catalogSha256") != AFTER_CATALOG_SHA256
        or rows[0].get("recordSha256") != AFTER_RECORD_SHA256
        or rows[0].get("effectSha256") != EFFECT_SHA256
        or rows[0].get("effect") != review["decision"]["runtimeEffect"]):
        raise SystemExit("Installed Black Sludge ItemSpec evidence drifted.")


if __name__ == "__main__":
    main()
