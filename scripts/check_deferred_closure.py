#!/usr/bin/env python3
"""Validate Plan 11 closure registration and, optionally, final completion."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
INVENTORY_PATH = ROOT / "data/deferred-closure/closure-inventory.v1.json"
RUBRIC_PATH = ROOT / "data/deferred-closure/completion-rubric.v1.json"
GRANTS_PATH = ROOT / "data/complete-play-loop/equipment-grants.v1.json"
CONTRIBUTIONS_PATH = ROOT / "data/complete-play-loop/equipment-contributions.v1.json"
COHORTS_PATH = ROOT / "data/complete-play-loop/item-catalog-cohorts.v1.json"
ITEM_ACTION_MATRIX_PATH = ROOT / "data/deferred-closure/item-action-matrix.v1.json"
ITEM_ACTION_RECOVERY_PATH = ROOT / "data/deferred-closure/item-action-recovery-certification.v1.json"
ITEM_ACTION_PROOF_PATH = ROOT / "data/deferred-closure/item-action-closure-proof.v1.json"
CONTESTS_PATH = ROOT / "data/reference/contests.json"
SUCCESSOR_CHAIN_PATH = ROOT / "data/deferred-closure/successor-chain.v1.json"
DRIFT_GATE_PATH = ROOT / "data/deferred-closure/drift-forbidden-gap-gate.v1.json"
ACCEPTANCE_PATH = ROOT / "data/deferred-closure/zero-deferred-acceptance.v1.json"
PLAN_ORDER_PATH = ROOT / "implementation-plans/plan-order.md"
STALE_DOCUMENTATION = "Concrete move/field trigger registrations remain deferred to their owning tickets."


def load(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def file_sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def accepted_successor_head(path: str, recorded_sha256: str) -> str:
    """Resolve recorded evidence to current bytes only through contiguous accepted edges."""
    current = file_sha256(ROOT / path)
    chain = load(SUCCESSOR_CHAIN_PATH)
    edges = [
        edge for edge in chain.get("edges", [])
        if edge.get("surface") == path and edge.get("reviewStatus") == "accepted"
    ]
    cursor = recorded_sha256
    visited: set[str] = set()
    while cursor != current:
        if cursor in visited:
            raise ValueError(f"{path}: accepted successor chain cycles at {cursor}")
        visited.add(cursor)
        candidates = [edge for edge in edges if edge.get("beforeSha256") == cursor]
        if len(candidates) != 1:
            raise ValueError(
                f"{path}: requires one accepted successor from {cursor}; found {len(candidates)}"
            )
        cursor = str(candidates[0].get("afterSha256"))
    return cursor


def grant_index(grants: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {
        grant["grantId"]: grant
        for definition in grants["definitions"]
        for grant in definition.get("grants", [])
    }


def validate_successor_chain(errors: list[str]) -> None:
    chain = load(SUCCESSOR_CHAIN_PATH)
    edges = chain.get("edges", [])
    if chain.get("schemaVersion") != 1 or chain.get("status") != "active" or not edges:
        errors.append("accepted successor chain is not active schema v1 authority")
        return

    grouped: dict[str, list[dict[str, Any]]] = {}
    migration_ids: set[str] = set()
    branches: set[tuple[str, str]] = set()
    hash_pattern = re.compile(r"[a-f0-9]{64}")
    for edge in edges:
        migration_id = str(edge.get("migrationId", ""))
        surface = str(edge.get("surface", ""))
        before = str(edge.get("beforeSha256", ""))
        after = str(edge.get("afterSha256", ""))
        if not migration_id or migration_id in migration_ids:
            errors.append(f"successor chain duplicate or absent migration id: {migration_id!r}")
        migration_ids.add(migration_id)
        if edge.get("reviewStatus") != "accepted":
            errors.append(f"{migration_id}: successor edge is not accepted")
        if not hash_pattern.fullmatch(before) or not hash_pattern.fullmatch(after) or before == after:
            errors.append(f"{migration_id}: successor hashes are invalid or unchanged")
        branch = (surface, before)
        if branch in branches:
            errors.append(f"{migration_id}: successor chain branches from {surface}@{before}")
        branches.add(branch)
        if not surface or Path(surface).is_absolute() or ".." in Path(surface).parts \
                or not (ROOT / surface).is_file():
            errors.append(f"{migration_id}: successor surface is absent or unsafe: {surface!r}")
        if not str(edge.get("ticket", "")).startswith("P11-") \
                or not str(edge.get("changePolicy", "")).strip():
            errors.append(f"{migration_id}: successor ticket or change policy is invalid")
        source_path = edge.get("sourcePath")
        source_sha = edge.get("sourceSha256")
        if (source_path is None) != (source_sha is None):
            errors.append(f"{migration_id}: successor source path/hash binding is partial")
        elif source_path is not None:
            if not hash_pattern.fullmatch(str(source_sha)) or not (ROOT / str(source_path)).is_file():
                errors.append(f"{migration_id}: successor source binding is absent or malformed")
        grouped.setdefault(surface, []).append(edge)

    current_hashes: dict[str, str] = {}

    def resolve(path: str, recorded: str) -> str | None:
        target = ROOT / path
        if not target.is_file():
            return None
        current = current_hashes.setdefault(path, file_sha256(target))
        by_before = {
            str(edge.get("beforeSha256")): str(edge.get("afterSha256"))
            for edge in grouped.get(path, [])
        }
        cursor = recorded
        visited: set[str] = set()
        while cursor != current:
            if cursor in visited or cursor not in by_before:
                return None
            visited.add(cursor)
            cursor = by_before[cursor]
        return cursor

    for edge in edges:
        migration_id = str(edge.get("migrationId"))
        surface = str(edge.get("surface"))
        if resolve(surface, str(edge.get("afterSha256"))) is None:
            errors.append(f"{migration_id}: accepted successor does not reach current surface bytes")
        source_path = edge.get("sourcePath")
        if source_path is not None and resolve(str(source_path), str(edge.get("sourceSha256"))) is None:
            errors.append(f"{migration_id}: accepted source evidence does not reach current bytes")


def validate_drift_gate(
    inventory: dict[str, Any],
    grant_document: dict[str, Any],
    contests: dict[str, Any],
    errors: list[str],
) -> None:
    if not DRIFT_GATE_PATH.is_file():
        errors.append("deferred closure drift gate authority is absent")
        return
    gate = load(DRIFT_GATE_PATH)
    if gate.get("schemaVersion") != 1 or gate.get("ticket") != "P11-088" \
            or gate.get("status") != "enforced" or gate.get("runtimeProseParsing") is not False:
        errors.append("deferred closure drift gate is not enforced P11-088 authority")
        return

    contracts = gate.get("registryContracts", {})
    rows = inventory.get("rows", [])
    mechanics = [row for row in rows if row.get("kind") != "hygiene"]
    expected_counts = {
        "closureRows": len(rows),
        "userFacingMechanics": len(mechanics),
        "rangedWeaponProfiles": sum(row.get("kind") == "weapon-profile" for row in rows),
        "repairedWeaponMoves": sum(row.get("kind") == "weapon-move" for row in rows),
        "itemActions": sum(row.get("kind") == "item-action" for row in rows),
        "contestVariants": sum(row.get("kind") == "contest-variant" for row in rows),
        "genericSkillCheckSurfaces": sum(row.get("id") == "runtime.generic-skill-check" for row in rows),
    }
    for key, expected in expected_counts.items():
        if contracts.get(key) != expected:
            errors.append(f"drift gate {key} is {contracts.get(key)!r}; expected {expected}")

    grants = grant_index(grant_document)
    inventory_grant_ids = [str(row["grantId"]) for row in rows if row.get("grantId")]
    if len(inventory_grant_ids) != len(set(inventory_grant_ids)):
        errors.append("closure inventory contains duplicate grant identities")
    if set(contracts.get("expectedGrantIds", [])) != set(inventory_grant_ids):
        errors.append("drift gate grant inventory is incomplete or contains an unregistered row")
    forbidden = set(gate.get("forbiddenFinalTokens", []))
    for row in rows:
        try:
            state = actual_state(row, grants, contests)
        except (KeyError, StopIteration):
            errors.append(f"{row.get('id')}: drift gate authority is absent")
            continue
        if state in forbidden:
            errors.append(f"{row.get('id')}: forbidden final state {state!r}")
    for grant_id in inventory_grant_ids:
        grant = grants.get(grant_id)
        if grant is None:
            errors.append(f"{grant_id}: registered closure grant is absent")
        elif grant.get("executionStatus") in forbidden or grant.get("finalState") in forbidden \
                or grant.get("deferredTicket") is not None:
            errors.append(f"{grant_id}: deferral-flavored grant authority survived")
    for grant_id, grant in grants.items():
        if (grant.get("executionStatus") in forbidden or grant.get("finalState") in forbidden) \
                and grant_id not in inventory_grant_ids:
            errors.append(f"{grant_id}: unregistered deferral-flavored grant authority")

    item_action_ids = {
        str(grants[grant_id].get("actionId"))
        for grant_id in inventory_grant_ids
        if grants.get(grant_id, {}).get("kind") == "action"
    }
    if item_action_ids != set(contracts.get("itemActionIds", [])):
        errors.append("drift gate item-action registry is incomplete or orphaned")
    variant_rows = {row.get("id"): row for row in contests.get("variants", [])}
    if set(contracts.get("contestVariantIds", [])) != {"trainer-participant", "battle"}:
        errors.append("drift gate Contest variant inventory is invalid")
    for variant_id in contracts.get("contestVariantIds", []):
        if variant_rows.get(variant_id, {}).get("completionState") != "native":
            errors.append(f"{variant_id}: canonical Contest variant is not native")

    weapon_source = (ROOT / "shared/capabilityAutomation/weaponMoves.ts").read_text(encoding="utf-8")
    weapon_ids = contracts.get("supplementalWeaponMoveIds", [])
    if contracts.get("supplementalWeaponMoves") != len(weapon_ids) or len(set(weapon_ids)) != len(weapon_ids):
        errors.append("supplemental weapon Move inventory is not exactly twelve unique rows")
    for move_id in weapon_ids:
        if f"'{move_id}'" not in weapon_source:
            errors.append(f"supplemental weapon Move definition is absent: {move_id}")
    for handler in gate.get("handlerContracts", []):
        definition_path = ROOT / str(handler.get("definitionPath", ""))
        registration_path = ROOT / str(handler.get("registrationPath", ""))
        registry_path = ROOT / str(handler.get("registryPath", ""))
        if not all(path.is_file() for path in (definition_path, registration_path, registry_path)):
            errors.append(f"{handler.get('handlerId')}: handler path is absent")
            continue
        registration = registration_path.read_text(encoding="utf-8")
        registry = registry_path.read_text(encoding="utf-8")
        if str(handler.get("handlerId")) not in registration \
                or "CAPABILITY_WEAPON_MOVE_HANDLER_REGISTRATION" not in registry \
                or handler.get("expectedDefinitions") != len(weapon_ids) \
                or handler.get("orphanDefinitions") != 0 or handler.get("orphanRegistrations") != 0:
            errors.append(f"{handler.get('handlerId')}: handler registration or orphan contract drifted")

    for document in gate.get("documentContracts", []):
        if document.get("parallelAuthority") is not False:
            errors.append(f"{document.get('documentId')}: parallel authority is forbidden")
        for required in document.get("requiredTokens", []):
            path = ROOT / str(required.get("path", ""))
            token = str(required.get("token", ""))
            if not path.is_file() or not token or token not in path.read_text(encoding="utf-8"):
                errors.append(f"{document.get('documentId')}: required contract token is absent ({required})")

    package = load(ROOT / "package.json")
    scripts = package.get("scripts", {})
    for command in gate.get("generatedChecks", []):
        if command not in scripts:
            errors.append(f"drift gate generated check is unregistered: {command}")
    drift_script = str(scripts.get("check:deferred-closure-drift", ""))
    for command in gate.get("directGeneratedChecks", []):
        if command not in drift_script:
            errors.append(f"drift gate direct generated check is unregistered: {command}")
    zero_gate = gate.get("zeroDeferredGate", {})
    zero_script = str(scripts.get(str(zero_gate.get("command", "")), ""))
    if zero_gate.get("required") is not True or not zero_script \
            or str(zero_gate.get("inventoryGenerator")) not in zero_script \
            or str(zero_gate.get("acceptanceGenerator")) not in zero_script:
        errors.append("zero-deferred generators are not wired into the closure gate")
    quality = gate.get("qualityGate", {})
    quality_path = ROOT / str(quality.get("scriptPath", ""))
    if quality.get("required") is not True or not quality_path.is_file() \
            or str(quality.get("command")) not in quality_path.read_text(encoding="utf-8"):
        errors.append("deferred closure drift command is not wired into the repository quality gate")

    for binding in gate.get("sourceBindings", []):
        path = str(binding.get("path", ""))
        try:
            head = accepted_successor_head(path, str(binding.get("sha256", "")))
        except (ValueError, FileNotFoundError):
            head = ""
        if not (ROOT / path).is_file() or head != file_sha256(ROOT / path):
            errors.append(f"drift gate source binding is stale: {path}")


def stable_value_sha256(value: Any) -> str:
    rendered = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(rendered.encode("utf-8")).hexdigest()


def validate_zero_deferred_acceptance(
    inventory: dict[str, Any],
    rubric: dict[str, Any],
    grant_document: dict[str, Any],
    contests: dict[str, Any],
    actual: dict[str, str],
    errors: list[str],
) -> None:
    if not ACCEPTANCE_PATH.is_file():
        errors.append("zero-deferred acceptance record is absent")
        return
    record = load(ACCEPTANCE_PATH)
    if record.get("schemaVersion") != 1 \
            or record.get("acceptanceId") != "deferred-mechanics-zero-deferred-v1" \
            or record.get("ticket") != "P11-089" \
            or record.get("status") != "accepted" \
            or record.get("runtimeProseParsing") is not False:
        errors.append("zero-deferred acceptance record is not accepted P11-089 authority")
        return

    if inventory.get("status") != "final-acceptance" or inventory.get("finalizedBy") != "P11-089":
        errors.append("closure inventory is not finalized P11-089 authority")
    expected_rows = [{
        "rowId": row["id"],
        "kind": row["kind"],
        "finalState": actual.get(row["id"]),
        "targetState": row["targetState"],
        "closureEvidenceId": row.get("closureEvidenceId"),
    } for row in inventory.get("rows", [])]
    if record.get("rows") != expected_rows:
        errors.append("zero-deferred acceptance rows do not exactly match final inventory authority")
    for row in expected_rows:
        if row["finalState"] != row["targetState"] or row["finalState"] not in {
            "native", "guided", "re-homed", "verified-or-retired",
        }:
            errors.append(f"{row['rowId']}: acceptance row is not in its exact final state")

    expected_counts = {
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
    }
    if record.get("counts") != expected_counts:
        errors.append("zero-deferred acceptance counts are not the exact zero-gap contract")
    if inventory.get("counts", {}).get("finalRows") != 29 \
            or inventory.get("counts", {}).get("nonFinalRows") != 0:
        errors.append("closure inventory final counts are not 29/29")

    non_gaps = [{"id": row.get("id"), "classification": row.get("classification")} \
                for row in inventory.get("reviewedNonGaps", [])]
    if record.get("reviewedNonGaps") != non_gaps:
        errors.append("zero-deferred reviewed non-gap classification drifted")

    forbidden = set(rubric.get("forbiddenFinalTokens", [])) | {"absent", "structured"}
    state_keys = {"currentState", "targetState", "executionStatus", "finalState", "completionState"}
    audited_documents = {
        "inventory": inventory,
        "equipment-grants": grant_document,
        "equipment-contributions": load(CONTRIBUTIONS_PATH),
        "item-catalog-cohorts": load(COHORTS_PATH),
        "item-action-matrix": load(ITEM_ACTION_MATRIX_PATH),
        "contests": contests,
    }

    def inspect_states(value: Any, path: str) -> None:
        if isinstance(value, dict):
            for key, child in value.items():
                child_path = f"{path}.{key}"
                if key in state_keys and isinstance(child, str) and child in forbidden:
                    errors.append(f"{child_path}: forbidden final state {child!r}")
                inspect_states(child, child_path)
        elif isinstance(value, list):
            for index, child in enumerate(value):
                inspect_states(child, f"{path}[{index}]")

    for identity, document in audited_documents.items():
        inspect_states(document, identity)
    grants = grant_index(grant_document)
    if any(grant.get("deferredTicket") is not None for grant in grants.values()):
        errors.append("equipment grants retain a non-null deferred ticket")
    cohorts = audited_documents["item-catalog-cohorts"]
    if any(cohort.get("implementationState") == "blocked" or cohort.get("unresolvedRequirements")
           for cohort in cohorts.get("cohorts", [])):
        errors.append("item catalog cohorts retain blocked or unresolved authority")

    contributions = audited_documents["equipment-contributions"]
    marker_rows = [{
        "canonicalItemId": row.get("canonicalItemId"),
        "markers": row.get("deferredMechanics"),
    } for row in contributions.get("definitions", []) if row.get("deferredMechanics")]
    marker_contract = record.get("legacyRegistryMarkers", {})
    if marker_contract.get("field") != "deferredMechanics" \
            or marker_contract.get("disposition") != "inert-delegated-owner-marker-not-finality" \
            or marker_contract.get("markerCount") != len(marker_rows) \
            or marker_contract.get("openCoreDebtCount") != 0 \
            or marker_contract.get("rows") != marker_rows \
            or marker_contract.get("rowsSha256") != stable_value_sha256(marker_rows):
        errors.append("legacy contribution owner markers are unclassified, incomplete, or drifted")

    evidence_by_id = {row.get("id"): row for row in rubric.get("evidenceRegistry", [])}
    if set(record.get("passingEvidenceIds", [])) != set(evidence_by_id) \
            or any(row.get("status") != "passing" for row in evidence_by_id.values()):
        errors.append("zero-deferred evidence registry is incomplete or non-passing")
    for row in evidence_by_id.values():
        if row.get("type") == "test" and not (ROOT / str(row.get("path"))).is_file():
            errors.append(f"zero-deferred evidence path is absent: {row.get('path')}")

    expected_authority_paths = {
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
    }
    authority_bindings = record.get("authorityBindings", [])
    if {row.get("path") for row in authority_bindings} != expected_authority_paths:
        errors.append("zero-deferred acceptance authority inventory is incomplete or unregistered")
    for binding in [*authority_bindings, *record.get("evidenceBindings", [])]:
        relative = str(binding.get("path", ""))
        path = ROOT / relative
        try:
            head = accepted_successor_head(relative, str(binding.get("sha256", "")))
        except (ValueError, FileNotFoundError):
            head = ""
        if not path.is_file() or head != file_sha256(path):
            errors.append(f"zero-deferred acceptance binding is stale: {relative}")

    ledger = PLAN_ORDER_PATH.read_text(encoding="utf-8")
    for plan in range(1, 11):
        if re.search(rf"^\| {plan} \|.*\| `DONE` \|", ledger, re.MULTILINE) is None:
            errors.append(f"authoritative plan ledger does not mark Plan {plan} DONE")
    if re.search(r"^\| 11 \|.*\| `(IN_PROGRESS|DONE)` \|", ledger, re.MULTILINE) is None:
        errors.append("authoritative plan ledger does not register Plan 11")
    ledger_audit = record.get("ledgerAudit", {})
    if ledger_audit.get("completedPredecessorPlans") != list(range(1, 11)) \
            or ledger_audit.get("registeredClosurePlan") != 11 \
            or ledger_audit.get("knownUnregisteredMechanicsLedgers") != 0:
        errors.append("zero-deferred ledger audit is incomplete")


def actual_state(
    inventory_row: dict[str, Any],
    grants: dict[str, dict[str, Any]],
    contests: dict[str, Any],
) -> str:
    grant_id = inventory_row.get("grantId")
    if grant_id:
        grant = grants[grant_id]
        return grant.get("finalState", grant["executionStatus"])
    if inventory_row["kind"] == "contest-variant":
        variant_id = inventory_row["id"].removeprefix("contest-variant.")
        return next(row["completionState"] for row in contests["variants"] if row["id"] == variant_id)
    if inventory_row["id"] == "registry.equipment-grants-deferred-ticket-pointers":
        tracked = [row for row in grants.values() if row.get("deferredTicket")]
        return "re-homed" if all(str(row["deferredTicket"]).startswith("P11-") for row in tracked) else "stale-pointer"
    if inventory_row["id"] == "documentation.live-play-authority-trigger-registrations":
        documentation = (ROOT / "docs/live-play-authority.md").read_text(encoding="utf-8")
        return "verified-or-retired" if STALE_DOCUMENTATION not in documentation else "stale-deferred-language"
    return inventory_row["currentState"]


def validate_item_action_closure(
    inventory: dict[str, Any],
    grant_document: dict[str, Any],
    errors: list[str],
    *,
    contributions_document: dict[str, Any] | None = None,
    cohorts_document: dict[str, Any] | None = None,
    matrix_document: dict[str, Any] | None = None,
    recovery_document: dict[str, Any] | None = None,
    proof_document: dict[str, Any] | None = None,
) -> dict[str, int]:
    initial_error_count = len(errors)
    contributions = contributions_document or load(CONTRIBUTIONS_PATH)
    cohorts = cohorts_document or load(COHORTS_PATH)
    matrix = matrix_document or load(ITEM_ACTION_MATRIX_PATH)
    recovery = recovery_document or load(ITEM_ACTION_RECOVERY_PATH)
    if proof_document is not None:
        proof = proof_document
    elif not ITEM_ACTION_PROOF_PATH.is_file():
        errors.append("item-action zero-deferred proof is absent")
        proof = {}
    else:
        proof = load(ITEM_ACTION_PROOF_PATH)

    rows = matrix.get("rows", [])
    if matrix.get("schemaVersion") != 1 or matrix.get("status") != "frozen" or len(rows) != 11:
        errors.append("item-action matrix is not the frozen eleven-row authority")
    matrix_by_action = {row.get("actionId"): row for row in rows}
    if len(matrix_by_action) != len(rows):
        errors.append("item-action matrix contains duplicate action identities")

    grants = grant_index(grant_document)
    grants_by_action = {
        grant["actionId"]: grant
        for grant in grants.values()
        if grant.get("kind") == "action" and grant.get("actionId") in matrix_by_action
    }
    contribution_by_item = {
        row["canonicalItemId"]: row for row in contributions.get("definitions", [])
    }
    cohort_member_by_item = {
        member["canonicalId"]: (member, cohort)
        for cohort in cohorts.get("cohorts", [])
        for member in cohort.get("members", [])
    }
    inventory_by_id = {
        row["id"]: row for row in inventory.get("rows", []) if row.get("kind") == "item-action"
    }
    recovery_by_action = {
        row["actionId"]: row for row in recovery.get("actions", [])
    }
    forbidden_states = {
        "absent", "blocked", "deferred", "definition-missing", "prose-inferred",
        "reference-only-deferral", "silently-absent", "visible-with-reason",
    }

    if contributions.get("equipmentGrantsSha256") != file_sha256(GRANTS_PATH):
        errors.append("item-action contributions are stale against equipment grants")
    if recovery.get("ticket") != "P11-043" or recovery.get("status") != "certified":
        errors.append("item-action recovery certification is not accepted P11-043 evidence")
    if recovery.get("acceptance", {}).get("uncoveredActionCount") != 0 \
            or recovery.get("acceptance", {}).get("uncoveredScenarioCount") != 0:
        errors.append("item-action recovery certification has uncovered authority")

    native = 0
    guided = 0
    for action_id, matrix_row in matrix_by_action.items():
        label = str(action_id)
        final_state = matrix_row.get("finalState")
        if final_state not in {"native", "guided"}:
            errors.append(f"{label}: matrix final state is {final_state!r}")
            continue
        native += int(final_state == "native")
        guided += int(final_state == "guided")

        grant = grants_by_action.get(action_id)
        grant_id = grant.get("grantId") if grant else None
        if not grant:
            errors.append(f"{label}: grant authority is absent")
        else:
            if grant.get("kind") != "action" or grant.get("actionId") != label:
                errors.append(f"{label}: grant identity or kind drifted")
            if grant.get("executionStatus") != "native":
                errors.append(f"{label}: declaration executor is not native")
            if grant.get("finalState") != final_state:
                errors.append(f"{label}: grant final state disagrees with the matrix")
            if grant.get("deferredTicket") is not None:
                errors.append(f"{label}: stale deferred ticket survived")
            if grant.get("executionStatus") in forbidden_states or grant.get("finalState") in forbidden_states:
                errors.append(f"{label}: deferral-flavored grant state survived")

        contribution = contribution_by_item.get(matrix_row.get("canonicalItemId"))
        if not contribution:
            errors.append(f"{label}: contribution registry item is absent")
        else:
            final_rows = contribution.get("grantFinalStates", [])
            expected = {"grantId": grant_id, "kind": "action", "finalState": final_state}
            matching_rows = [row for row in final_rows if row.get("grantId") == grant_id]
            if matching_rows != [expected]:
                errors.append(f"{label}: contribution final-state binding is absent or contradictory")
            if any(row.get("finalState") in forbidden_states for row in matching_rows):
                errors.append(f"{label}: deferral-flavored contribution state survived")
            if contribution.get("deferredMechanics"):
                errors.append(f"{label}: contribution registry retains deferred mechanics")

        member_and_cohort = cohort_member_by_item.get(matrix_row.get("canonicalItemId"))
        if not member_and_cohort:
            errors.append(f"{label}: cohort member is absent")
        else:
            member, cohort = member_and_cohort
            expected = {"actionId": label, "finalState": final_state}
            matching_rows = [row for row in member.get("actionFinalStates", []) if row.get("actionId") == label]
            if matching_rows != [expected]:
                errors.append(f"{label}: cohort action final-state binding is absent or contradictory")
            if any(row.get("finalState") in forbidden_states for row in matching_rows):
                errors.append(f"{label}: deferral-flavored cohort state survived")
            if cohort.get("unresolvedRequirements"):
                errors.append(f"{label}: cohort retains unresolved requirements")

        recovery_row = recovery_by_action.get(label)
        inventory_row = inventory_by_id.get(recovery_row.get("surfaceId")) if recovery_row else None
        if not inventory_row or inventory_row.get("grantId") != grant_id:
            errors.append(f"{label}: closure inventory row is absent or has the wrong grant")
        else:
            if inventory_row.get("currentState") != final_state or inventory_row.get("targetState") != final_state:
                errors.append(f"{label}: closure inventory is not in its exact final state")
            if "staleDeferredTicket" in inventory_row or inventory_row.get("closureEvidenceId") != "p11-044.item-actions":
                errors.append(f"{label}: closure inventory evidence or stale-pointer cleanup is incomplete")

        if not recovery_row or recovery_row.get("finalState") != final_state:
            errors.append(f"{label}: recovery certification final state is absent or contradictory")

    audited_action_ids = set(matrix_by_action)
    audited_grants = [
        grant for definition in grant_document.get("definitions", [])
        for grant in definition.get("grants", [])
        if grant.get("kind") == "action" and grant.get("actionId") in audited_action_ids
    ]
    if len(audited_grants) != len(rows):
        errors.append("audited item-action grant cardinality is not exactly eleven")

    if proof:
        if proof.get("schemaVersion") != 1 or proof.get("ticket") != "P11-044" \
                or proof.get("status") != "proved-zero-deferred-item-actions":
            errors.append("item-action proof is not accepted P11-044 authority")
        acceptance = proof.get("acceptance", {})
        if acceptance.get("actionCount") != 11 or acceptance.get("deferredCount") != 0 \
                or acceptance.get("contradictionCount") != 0 or acceptance.get("missingCount") != 0:
            errors.append("item-action proof acceptance counts are not zero-debt")
        for binding in proof.get("authorityBindings", []):
            relative_path = str(binding.get("path", ""))
            path = ROOT / relative_path
            try:
                accepted_head = accepted_successor_head(relative_path, str(binding.get("sha256", "")))
            except ValueError:
                accepted_head = ""
            if not path.is_file() or accepted_head != file_sha256(path):
                errors.append(f"item-action proof authority drift: {binding.get('path')}")
        proof_actions = {row.get("actionId"): row for row in proof.get("actions", [])}
        for action_id, matrix_row in matrix_by_action.items():
            if proof_actions.get(action_id, {}).get("finalState") != matrix_row.get("finalState"):
                errors.append(f"{action_id}: proof action final state is absent or contradictory")

    return {
        "rows": len(rows),
        "native": native,
        "guided": guided,
        "deferred": 0 if len(errors) == initial_error_count else -1,
    }


def validate(require_complete: bool, check_drift: bool = False) -> dict[str, Any]:
    inventory = load(INVENTORY_PATH)
    rubric = load(RUBRIC_PATH)
    grant_document = load(GRANTS_PATH)
    contests = load(CONTESTS_PATH)
    grants = grant_index(grant_document)
    errors: list[str] = []
    item_action_report = validate_item_action_closure(inventory, grant_document, errors)
    if check_drift:
        validate_successor_chain(errors)
        validate_drift_gate(inventory, grant_document, contests, errors)

    if rubric.get("schemaVersion") != 1 or rubric.get("ticket") != "P11-008" or rubric.get("status") != "reviewed":
        errors.append("completion rubric is not reviewed P11-008 authority")
    inventory_rows = {row["id"]: row for row in inventory["rows"]}
    rubric_rows = {row["rowId"]: row for row in rubric["rows"]}
    if len(inventory_rows) != len(inventory["rows"]) or set(inventory_rows) != set(rubric_rows):
        errors.append("rubric rows do not exactly cover the closure inventory")
    evidence = {row["id"]: row for row in rubric["evidenceRegistry"]}
    if len(evidence) != len(rubric["evidenceRegistry"]):
        errors.append("evidence registry contains duplicate identities")

    actual: dict[str, str] = {}
    for row_id, inventory_row in inventory_rows.items():
        rubric_row = rubric_rows.get(row_id)
        if not rubric_row:
            continue
        if rubric_row["targetState"] != inventory_row["targetState"]:
            errors.append(f"{row_id}: target state drift")
        if rubric_row["closureTicket"] not in inventory_row["owningTickets"]:
            errors.append(f"{row_id}: closure ticket is not an owner")
        missing_evidence = [identity for identity in rubric_row["requiredEvidenceIds"] if identity not in evidence]
        if missing_evidence:
            errors.append(f"{row_id}: unknown evidence {missing_evidence}")
        try:
            state = actual_state(inventory_row, grants, contests)
        except (KeyError, StopIteration) as error:
            errors.append(f"{row_id}: audited authority is absent ({error})")
            continue
        actual[row_id] = state
        allowed = set(rubric_row["allowedFinalStates"])
        if state not in allowed and state not in rubric["temporaryActivationStates"]:
            errors.append(f"{row_id}: unregistered state {state!r}")
        if require_complete and state not in allowed:
            errors.append(f"{row_id}: non-final state {state!r}")

    registered_grants = {row.get("grantId") for row in inventory["rows"] if row.get("grantId")}
    unregistered_debt = sorted(
        grant_id for grant_id, grant in grants.items()
        if grant.get("executionStatus") not in (None, "native", "guided", "passive", "reference-only", "not-applicable")
        and grant_id not in registered_grants
    )
    if unregistered_debt:
        errors.append(f"unregistered grant debt: {unregistered_debt}")

    variant_rows = {row["id"]: row for row in contests["variants"]}
    for variant_id in ("trainer-participant", "battle"):
        row = variant_rows.get(variant_id, {})
        reason = str(row.get("safeReason", "")).lower()
        if "defer" in reason:
            errors.append(f"{variant_id}: deferral-flavored canonical reason survived")

    if require_complete:
        for entry in evidence.values():
            if entry["status"] != "passing":
                errors.append(f"evidence {entry['id']}: status is {entry['status']!r}")
            if entry["type"] == "test" and not (ROOT / entry["path"]).is_file():
                errors.append(f"evidence {entry['id']}: test path is absent")
        acceptance_path = ROOT / rubric["finalAcceptance"]["acceptanceRecordPath"]
        if acceptance_path != ACCEPTANCE_PATH:
            errors.append("completion rubric points to an unknown zero-deferred acceptance record")
        validate_zero_deferred_acceptance(
            inventory, rubric, grant_document, contests, actual, errors,
        )

    final_count = sum(
        1 for row_id, state in actual.items()
        if state in set(rubric_rows[row_id]["allowedFinalStates"])
    )
    report = {
        "schemaVersion": 1,
        "rubricId": rubric["rubricId"],
        "rows": len(rubric_rows),
        "final": final_count,
        "nonFinal": len(rubric_rows) - final_count,
        "unregisteredDebt": len(unregistered_debt),
        "itemActions": item_action_report,
        "requireComplete": require_complete,
        "checkDrift": check_drift,
        "states": actual,
        "errors": errors,
    }
    if errors:
        raise RuntimeError("\n".join(errors))
    return report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--require-complete", action="store_true")
    parser.add_argument("--check-drift", action="store_true")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    try:
        report = validate(args.require_complete, args.check_drift)
    except RuntimeError as error:
        raise SystemExit(f"deferred closure check failed:\n{error}")
    if args.json:
        print(json.dumps(report, indent=2, sort_keys=True))
    else:
        print(
            f"deferred closure registration passed "
            f"({report['final']}/{report['rows']} final; {report['nonFinal']} registered activation debts)"
        )


if __name__ == "__main__":
    main()
