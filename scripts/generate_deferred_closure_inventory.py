#!/usr/bin/env python3
"""Reconcile the reviewed Plan 11 closure inventory to final runtime authority.

The row set and canonical identities remain the reviewed P11-001 inventory.
Final states come only from app-owned registries and the two bounded hygiene
checks; documentary prose is never interpreted as runtime authority.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
OUTPUT_PATH = ROOT / "data/deferred-closure/closure-inventory.v1.json"
GRANTS_PATH = ROOT / "data/complete-play-loop/equipment-grants.v1.json"
CONTRIBUTIONS_PATH = ROOT / "data/complete-play-loop/equipment-contributions.v1.json"
COHORTS_PATH = ROOT / "data/complete-play-loop/item-catalog-cohorts.v1.json"
ITEM_MATRIX_PATH = ROOT / "data/deferred-closure/item-action-matrix.v1.json"
CONTESTS_PATH = ROOT / "data/reference/contests.json"
WEAPON_MOVES_PATH = ROOT / "shared/capabilityAutomation/weaponMoves.ts"
SKILL_CHECK_PATH = ROOT / "shared/skillChecks/contract.ts"
LIVEPLAY_AUTHORITY_PATH = ROOT / "docs/live-play-authority.md"
ACTIVATION_SHA256 = "1e5d623174060993ef02f3417c82888eb1e30b4a029980c0c283d55cf1eca3ac"
STALE_DOCUMENTATION = "Concrete move/field trigger registrations remain deferred to their owning tickets."

EXPECTED_KINDS = {
    "weapon-profile": 6,
    "weapon-move": 7,
    "item-action": 11,
    "contest-variant": 2,
    "runtime-surface": 1,
    "hygiene": 2,
}
EVIDENCE_BY_KIND = {
    "weapon-profile": "p11-022.ranged-weapons",
    "weapon-move": "p11-030.weapon-moves",
    "item-action": "p11-044.item-actions",
    "contest-variant": "p11-080.contest-variants",
    "runtime-surface": "p11-052.skill-check",
    "hygiene": "p11-002.hygiene",
}
FINAL_STATES = {"native", "guided", "re-homed", "verified-or-retired"}


def load(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def grant_index(document: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {
        grant["grantId"]: grant
        for definition in document["definitions"]
        for grant in definition.get("grants", [])
    }


def final_state(
    row: dict[str, Any],
    grants: dict[str, dict[str, Any]],
    variants: dict[str, dict[str, Any]],
) -> str:
    if row.get("grantId"):
        grant = grants[row["grantId"]]
        return str(grant.get("finalState", grant.get("executionStatus")))
    if row["kind"] == "contest-variant":
        return str(variants[row["id"].removeprefix("contest-variant.")]["completionState"])
    if row["id"] == "runtime.generic-skill-check":
        return "native"
    if row["id"] == "registry.equipment-grants-deferred-ticket-pointers":
        return "re-homed" if all(grant.get("deferredTicket") is None for grant in grants.values()) else "stale-pointer"
    if row["id"] == "documentation.live-play-authority-trigger-registrations":
        source = LIVEPLAY_AUTHORITY_PATH.read_text(encoding="utf-8")
        return "verified-or-retired" if STALE_DOCUMENTATION not in source else "stale-deferred-language"
    raise SystemExit(f"No final-state authority for {row['id']}")


def final_description(row: dict[str, Any]) -> str:
    if row["kind"] == "weapon-profile":
        return (
            f"data/reference/items.json row '{row['canonicalItem']}' is canonical identity; "
            f"the reviewed equipment registry supplies its native {row['weaponClass']} profile "
            "through ordinary encounter targeting and accepted-result authority."
        )
    if row["kind"] == "weapon-move":
        return (
            f"Identity '{row['canonicalId']}' is named by canonical item '{row['canonicalItem']}'; "
            "the reviewed source-bound supplemental registry and ordinary Move handler are native, "
            "while the frozen data/reference/moves.json Pokémon Move catalog remains unchanged."
        )
    if row["id"] == "contest-variant.trainer-participant":
        return (
            "data/reference/contests.json carries the native trainer-participant variant; its production "
            "document, projection, operation, settlement, fixture, and activation authorities are certified."
        )
    if row["id"] == "contest-variant.battle":
        return (
            "data/reference/contests.json carries the native battle variant; its reviewed Encounter blend, "
            "two-team roster contract, scoring, recovery, settlement, fixtures, and activation are certified."
        )
    if row["id"] == "registry.equipment-grants-deferred-ticket-pointers":
        return "All reviewed closure grants have final authority and null legacy ticket pointers."
    if row["id"] == "documentation.live-play-authority-trigger-registrations":
        return "The liveplay authority guide describes current typed registrations and fail-closed behavior."
    return str(row["canonicalDataStatus"])


def build() -> dict[str, Any]:
    inventory = load(OUTPUT_PATH)
    if inventory.get("schemaVersion") != 1 or inventory.get("inventoryId") != "deferred-mechanics-closure-v1":
        raise SystemExit("Closure inventory must retain the reviewed P11-001 schema and identity")
    rows = inventory.get("rows", [])
    if len(rows) != 29 or len({row.get("id") for row in rows}) != 29:
        raise SystemExit("Closure inventory must contain exactly 29 unique reviewed rows")
    counts = {kind: sum(row.get("kind") == kind for row in rows) for kind in EXPECTED_KINDS}
    if counts != EXPECTED_KINDS:
        raise SystemExit(f"Closure inventory kind cardinality drifted: {counts}")

    grants_document = load(GRANTS_PATH)
    grants = grant_index(grants_document)
    variants = {row["id"]: row for row in load(CONTESTS_PATH)["variants"]}
    for row in rows:
        state = final_state(row, grants, variants)
        if state not in FINAL_STATES or state != row.get("targetState"):
            raise SystemExit(f"{row['id']} is not at its exact reviewed target: {state!r}")
        row["currentState"] = state
        row["closureEvidenceId"] = EVIDENCE_BY_KIND[row["kind"]]
        row["canonicalDataStatus"] = final_description(row)

    inventory["status"] = "final-acceptance"
    inventory["finalizedBy"] = "P11-089"
    inventory["activationBaseline"] = {
        "ticket": "P11-001",
        "sha256": ACTIVATION_SHA256,
        "preservation": "accepted-successor-chain",
    }
    inventory.pop("mutableSurfaces", None)
    final_paths = [
        GRANTS_PATH,
        CONTRIBUTIONS_PATH,
        COHORTS_PATH,
        ITEM_MATRIX_PATH,
        CONTESTS_PATH,
        WEAPON_MOVES_PATH,
        SKILL_CHECK_PATH,
        LIVEPLAY_AUTHORITY_PATH,
    ]
    inventory["finalSurfaceBindings"] = [
        {
            "path": path.relative_to(ROOT).as_posix(),
            "sha256": sha256(path),
            "policy": "current bytes or a contiguous accepted successor",
        }
        for path in final_paths
    ]
    inventory["allowedCurrentStates"] = ["native", "guided", "re-homed", "verified-or-retired"]
    inventory["counts"].update({
        "finalRows": 29,
        "nonFinalRows": 0,
        "blockedRows": 0,
        "unregisteredRows": 0,
    })
    for entry in inventory.get("phaseClosureEvidence", []):
        if entry.get("id") == "p11-044.item-actions":
            for binding in entry.get("authorityBindings", []):
                path = ROOT / binding["path"]
                binding["sha256"] = sha256(path)
    inventory["phaseClosureEvidence"] = [
        entry for entry in inventory.get("phaseClosureEvidence", [])
        if entry.get("id") != "p11-089.zero-deferred"
    ] + [{
        "id": "p11-089.zero-deferred",
        "scope": "all-twenty-nine-reviewed-closure-rows-and-eight-reviewed-non-gaps",
        "ticket": "P11-089",
        "status": "accepted",
        "acceptancePath": "data/deferred-closure/zero-deferred-acceptance.v1.json",
        "rowCount": 29,
        "finalCount": 29,
        "nonFinalCount": 0,
        "blockedCount": 0,
        "unregisteredCount": 0,
    }]
    inventory["finalAcceptance"] = {
        "ticket": "P11-089",
        "recordPath": "data/deferred-closure/zero-deferred-acceptance.v1.json",
        "requiredCommand": "python3 scripts/check_deferred_closure.py --require-complete --check-drift",
        "knownCoreRows": 29,
        "finalRows": 29,
        "knownDeferredRows": 0,
        "knownBlockedRows": 0,
        "proseInferredRows": 0,
        "silentlyAbsentRows": 0,
    }
    return inventory


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    rendered = json.dumps(build(), ensure_ascii=False, indent=1) + "\n"
    if args.check:
        if OUTPUT_PATH.read_text(encoding="utf-8") != rendered:
            raise SystemExit("Final Deferred Mechanics Closure inventory is stale; regenerate and review it.")
        return
    OUTPUT_PATH.write_text(rendered, encoding="utf-8")


if __name__ == "__main__":
    main()
