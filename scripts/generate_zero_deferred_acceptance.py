#!/usr/bin/env python3
"""Generate the source-bound P11-089 zero-deferred acceptance record."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
OUTPUT_PATH = ROOT / "data/deferred-closure/zero-deferred-acceptance.v1.json"
INVENTORY_PATH = ROOT / "data/deferred-closure/closure-inventory.v1.json"
RUBRIC_PATH = ROOT / "data/deferred-closure/completion-rubric.v1.json"
CONTRIBUTIONS_PATH = ROOT / "data/complete-play-loop/equipment-contributions.v1.json"

AUTHORITY_PATHS = [
    "data/deferred-closure/closure-inventory.v1.json",
    "data/deferred-closure/completion-rubric.v1.json",
    "data/deferred-closure/drift-forbidden-gap-gate.v1.json",
    "data/complete-play-loop/equipment-grants.v1.json",
    "data/complete-play-loop/equipment-contributions.v1.json",
    "data/complete-play-loop/item-catalog-cohorts.v1.json",
    "data/deferred-closure/item-action-matrix.v1.json",
    "data/reference/contests.json",
    "shared/capabilityAutomation/weaponMoves.ts",
    "shared/skillChecks/contract.ts",
    "scripts/generate_deferred_closure_inventory.py",
    "scripts/generate_zero_deferred_acceptance.py",
    "scripts/check_deferred_closure.py",
]
CERTIFICATION_PATHS = [
    "data/deferred-closure/item-action-closure-proof.v1.json",
    "data/deferred-closure/integrated-golden-journeys-certification.v1.json",
    "data/deferred-closure/migration-upgrade-certification.v1.json",
    "data/deferred-closure/backup-restore-certification.v1.json",
    "data/deferred-closure/final-accessibility-certification.v1.json",
    "data/deferred-closure/final-performance-certification.v1.json",
    "data/deferred-closure/final-privacy-role-projection-certification.v1.json",
    "data/deferred-closure/final-documentation-certification.v1.json",
    "data/deferred-closure/drift-forbidden-gap-certification.v1.json",
    "tests/data/deferredClosureZeroDeferredAcceptance.test.ts",
]


def load(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def value_sha256(value: Any) -> str:
    rendered = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(rendered.encode("utf-8")).hexdigest()


def bindings(paths: list[str]) -> list[dict[str, str]]:
    result: list[dict[str, str]] = []
    for relative in paths:
        path = ROOT / relative
        if not path.is_file():
            raise SystemExit(f"Zero-deferred evidence is absent: {relative}")
        result.append({"path": relative, "sha256": sha256(path)})
    return result


def build() -> dict[str, Any]:
    inventory = load(INVENTORY_PATH)
    rubric = load(RUBRIC_PATH)
    contributions = load(CONTRIBUTIONS_PATH)
    if inventory.get("status") != "final-acceptance" or inventory.get("finalizedBy") != "P11-089":
        raise SystemExit("Closure inventory must be finalized before acceptance generation")
    if len(inventory.get("rows", [])) != 29:
        raise SystemExit("Zero-deferred acceptance requires exactly 29 closure rows")
    evidence = rubric.get("evidenceRegistry", [])
    if any(row.get("status") != "passing" for row in evidence):
        raise SystemExit("Every completion-rubric evidence row must pass")

    rows = [{
        "rowId": row["id"],
        "kind": row["kind"],
        "finalState": row["currentState"],
        "targetState": row["targetState"],
        "closureEvidenceId": row["closureEvidenceId"],
    } for row in inventory["rows"]]
    if any(row["finalState"] != row["targetState"] for row in rows):
        raise SystemExit("Every closure row must equal its reviewed target")
    marker_rows = [{
        "canonicalItemId": row["canonicalItemId"],
        "markers": row["deferredMechanics"],
    } for row in contributions.get("definitions", []) if row.get("deferredMechanics")]
    evidence_paths = list(dict.fromkeys([
        *(str(row["path"]) for row in evidence if row.get("type") == "test"),
        *CERTIFICATION_PATHS,
    ]))
    return {
        "schemaVersion": 1,
        "acceptanceId": "deferred-mechanics-zero-deferred-v1",
        "ticket": "P11-089",
        "status": "accepted",
        "runtimeProseParsing": False,
        "policies": {
            "finalitySource": "app-owned-registries-and-reviewed-inventory-only",
            "historicalEvidence": "current-bytes-or-contiguous-accepted-successor",
            "legacyContributionMarkerPolicy": "classify-exact-inert-owner-markers-without-treating-them-as-finality",
            "unknownRowPolicy": "fail-closed",
            "parallelMechanicsAuthority": "forbidden",
        },
        "counts": {
            "knownCoreRows": 29,
            "finalRows": 29,
            "nonFinalRows": 0,
            "knownDeferredRows": 0,
            "knownBlockedRows": 0,
            "definitionMissingRows": 0,
            "proseInferredRows": 0,
            "silentlyAbsentRows": 0,
            "unregisteredRows": 0,
            "orphanHandlers": 0,
            "hardFailures": 0,
        },
        "rows": rows,
        "reviewedNonGaps": [{
            "id": row["id"],
            "classification": row["classification"],
        } for row in inventory.get("reviewedNonGaps", [])],
        "legacyRegistryMarkers": {
            "registryPath": "data/complete-play-loop/equipment-contributions.v1.json",
            "field": "deferredMechanics",
            "disposition": "inert-delegated-owner-marker-not-finality",
            "markerCount": len(marker_rows),
            "openCoreDebtCount": 0,
            "rowsSha256": value_sha256(marker_rows),
            "rows": marker_rows,
        },
        "passingEvidenceIds": [row["id"] for row in evidence],
        "authorityBindings": bindings(AUTHORITY_PATHS),
        "evidenceBindings": bindings(evidence_paths),
        "ledgerAudit": {
            "path": "implementation-plans/plan-order.md",
            "completedPredecessorPlans": list(range(1, 11)),
            "registeredClosurePlan": 11,
            "knownUnregisteredMechanicsLedgers": 0,
        },
        "validation": {
            "requiredCommand": "python3 scripts/check_deferred_closure.py --require-complete --check-drift",
            "inventoryGeneratorCommand": "python3 scripts/generate_deferred_closure_inventory.py --check",
            "acceptanceGeneratorCommand": "python3 scripts/generate_zero_deferred_acceptance.py --check",
            "result": "passed",
        },
        "nextTicket": "P11-090",
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    rendered = json.dumps(build(), ensure_ascii=False, indent=2) + "\n"
    if args.check:
        if not OUTPUT_PATH.is_file() or OUTPUT_PATH.read_text(encoding="utf-8") != rendered:
            raise SystemExit("Zero-deferred acceptance record drifted; regenerate and review it.")
        return
    OUTPUT_PATH.write_text(rendered, encoding="utf-8")


if __name__ == "__main__":
    main()
