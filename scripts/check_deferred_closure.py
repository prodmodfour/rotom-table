#!/usr/bin/env python3
"""Validate Plan 11 closure registration and, optionally, final completion."""

from __future__ import annotations

import argparse
import hashlib
import json
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
STALE_DOCUMENTATION = "Concrete move/field trigger registrations remain deferred to their owning tickets."


def load(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def file_sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def grant_index(grants: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {
        grant["grantId"]: grant
        for definition in grants["definitions"]
        for grant in definition.get("grants", [])
    }


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
            path = ROOT / str(binding.get("path", ""))
            if not path.is_file() or file_sha256(path) != binding.get("sha256"):
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


def validate(require_complete: bool) -> dict[str, Any]:
    inventory = load(INVENTORY_PATH)
    rubric = load(RUBRIC_PATH)
    grant_document = load(GRANTS_PATH)
    contests = load(CONTESTS_PATH)
    grants = grant_index(grant_document)
    errors: list[str] = []
    item_action_report = validate_item_action_closure(inventory, grant_document, errors)

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
        if not acceptance_path.is_file():
            errors.append("zero-deferred acceptance record is absent")

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
        "states": actual,
        "errors": errors,
    }
    if errors:
        raise RuntimeError("\n".join(errors))
    return report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--require-complete", action="store_true")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    try:
        report = validate(args.require_complete)
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
