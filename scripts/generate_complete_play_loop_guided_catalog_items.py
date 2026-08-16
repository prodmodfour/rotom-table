#!/usr/bin/env python3
"""Generate reviewed bounded guided ItemSpecs for P8-093 catalog closure.

The reviewed input declares source disposition and generic bounded decision
facts explicitly. Canonical effect prose is fingerprinted but never parsed.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "scripts/reviewed-data/guided-catalog-items.v1.json"
COHORT_POLICY = ROOT / "scripts/reviewed-data/item-catalog-cohort-policy.v1.json"
CATALOG = ROOT / "data/reference/items.json"
OUTPUT = ROOT / "data/complete-play-loop/guided-catalog-items.v1.json"


def stable_json(value: Any) -> str:
    if isinstance(value, dict):
        return "{" + ",".join(
            json.dumps(key, ensure_ascii=False, separators=(",", ":")) + ":" + stable_json(value[key])
            for key in sorted(value)
        ) + "}"
    if isinstance(value, list):
        return "[" + ",".join(stable_json(entry) for entry in value) + "]"
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def digest_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def digest_value(value: Any) -> str:
    return digest_bytes(stable_json(value).encode("utf-8"))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    source = json.loads(SOURCE.read_text())
    cohort_policy = json.loads(COHORT_POLICY.read_text())
    catalog_raw = CATALOG.read_bytes()
    catalog = json.loads(catalog_raw)
    if source.get("schemaVersion") != 1 or source.get("status") != "reviewed" or source.get("runtimeProseParsing") is not False:
        raise SystemExit("Guided catalog source must be reviewed schema v1 without prose parsing")
    templates = source.get("templates")
    rows = source.get("items")
    if not isinstance(templates, dict) or not isinstance(rows, list):
        raise SystemExit("Guided catalog source templates/items are malformed")
    expected = set(sum(cohort_policy["interpretiveCampaignToolGroups"].values(), []))
    ids = [row.get("canonicalId") for row in rows if isinstance(row, dict)]
    if len(ids) != len(set(ids)) or set(ids) != expected:
        raise SystemExit("Guided catalog source must cover every interpretive cohort item exactly once")
    generated = []
    for index, source_row in enumerate(rows):
        canonical_id = source_row.get("canonicalId")
        template_id = source_row.get("templateId")
        if set(source_row) != {"canonicalId", "templateId"} or canonical_id not in catalog or template_id not in templates:
            raise SystemExit(f"Guided catalog source row {index} is invalid")
        item = catalog[canonical_id]
        template = templates[template_id]
        required = {
            "contexts", "timing", "actionCost", "consumption", "prompt", "canonicalFacts",
            "settlementFacts", "presentationDescription",
        }
        if set(template) != required:
            raise SystemExit(f"Guided template {template_id} has an invalid shape")
        generated.append({
            "canonicalId": canonical_id,
            "canonicalRecordSha256": digest_value(item),
            "canonicalEffectSha256": digest_bytes("\n".join(item.get("effects", [])).encode("utf-8")),
            "templateId": template_id,
            **template,
        })
    document = {
        "schemaVersion": 1,
        "ticket": "P8-093",
        "status": "reviewed",
        "reviewId": source["reviewId"],
        "runtimeProseParsing": False,
        "catalogSha256": digest_bytes(catalog_raw),
        "sourceSha256": digest_bytes(SOURCE.read_bytes()),
        "cohortPolicySha256": digest_bytes(COHORT_POLICY.read_bytes()),
        "decision": source["decision"],
        "itemCount": len(generated),
        "registrySha256": digest_value(generated),
        "items": generated,
    }
    rendered = json.dumps(document, ensure_ascii=False, indent=2) + "\n"
    if args.check:
        if not OUTPUT.is_file() or OUTPUT.read_text() != rendered:
            raise SystemExit("Guided catalog item registry is stale; regenerate and review it.")
        return
    OUTPUT.write_text(rendered)


if __name__ == "__main__":
    main()
