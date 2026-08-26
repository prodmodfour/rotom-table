#!/usr/bin/env python3
"""Bounded Plan 12 fixture, boundary, and finality checks."""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data/gm-campaign-toolkit"


def read(path: str) -> Any:
    return json.loads((ROOT / path).read_text(encoding="utf-8"))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--require-final", action="store_true")
    args = parser.parse_args()
    errors: list[str] = []

    foundation_paths = [
        "data/gm-campaign-toolkit/generation-preparation-footprint.v1.json",
        "data/gm-campaign-toolkit/footprint-finality.v1.json",
        "data/gm-campaign-toolkit/completion-rubric.v1.json",
        "data/gm-campaign-toolkit/data-boundaries.v1.json",
        "data/gm-campaign-toolkit/role-projections.v1.json",
        "data/gm-campaign-toolkit/ux-success-criteria.v1.json",
        "data/gm-campaign-toolkit/performance-scale-budgets.v1.json",
        "data/gm-campaign-toolkit/legality-policies.v1.json",
        "data/gm-campaign-toolkit/fixtures/index.v1.json",
        "data/gm-campaign-toolkit/fixtures/deterministic-generation.v1.json",
        "data/gm-campaign-toolkit/fixtures/failure-recovery.v1.json",
        "data/gm-campaign-toolkit/default-npc-archetypes.v1.json",
        "data/gm-campaign-toolkit/fixtures/session-preparation.v1.json",
        "data/gm-campaign-toolkit/fixtures/builder-launch.v1.json",
        "data/gm-campaign-toolkit/recovery-performance-certification.v1.json",
    ]
    documents: dict[str, Any] = {}
    for path in foundation_paths:
        try:
            documents[path] = read(path)
        except Exception as error:  # noqa: BLE001 - checker reports all failures
            errors.append(f"{path}: {error}")
    for path, document in documents.items():
        if not isinstance(document, dict) or document.get("schemaVersion") != 1:
            errors.append(f"{path}: schemaVersion must be 1")

    footprint = documents.get(foundation_paths[0], {})
    rubric = documents.get(foundation_paths[2], {})
    boundaries = documents.get(foundation_paths[3], {})
    roles = documents.get(foundation_paths[4], {})
    ux = documents.get(foundation_paths[5], {})
    scale = documents.get(foundation_paths[6], {})
    legality = documents.get(foundation_paths[7], {})
    fixture_index = documents.get(foundation_paths[8], {})
    deterministic = documents.get(foundation_paths[9], {})
    failures = documents.get(foundation_paths[10], {})
    npc_archetypes = documents.get(foundation_paths[11], {})
    session_preparation = documents.get(foundation_paths[12], {})
    builder_launch = documents.get(foundation_paths[13], {})
    recovery_certification = documents.get(foundation_paths[14], {})

    if len(footprint.get("rows", [])) != 40:
        errors.append("footprint must contain 40 rows")
    if rubric.get("zeroGapRules", {}).get("concreteMechanicMayBeDowngradedToProse") is not False:
        errors.append("rubric must forbid prose downgrade")
    if boundaries.get("runtimePolicy", {}).get("documentaryRead") != "forbidden":
        errors.append("runtime documentary reads must be forbidden")
    if len(boundaries.get("canonicalRuntimeSources", [])) != 15:
        errors.append("boundaries must register fourteen reference files plus PTU_NATURE_CHART")
    if roles.get("realtime", {}).get("contentPayloadsForbidden") is not True:
        errors.append("realtime content payloads must be forbidden")
    ux_acceptance = ux.get("implementationAcceptance", {})
    ux_navigation = ux_acceptance.get("navigation", {})
    navigation_path = ux_navigation.get("sourcePath")
    if ux_acceptance.get("status") != "accepted" or ux_acceptance.get("tickets") != ["P12-085", "P12-086", "P12-087", "P12-088"]:
        errors.append("UX implementation acceptance must bind P12-085 through P12-088")
    if not isinstance(navigation_path, str) or not (ROOT / navigation_path).is_file():
        errors.append("UX navigation acceptance source is missing")
    elif hashlib.sha256((ROOT / navigation_path).read_bytes()).hexdigest() != ux_navigation.get("sourceSha256"):
        errors.append("UX navigation acceptance source drifted")
    if ux_navigation.get("destinationLabel") != "Campaign Toolkit" or ux_navigation.get("gmOnly") is not True:
        errors.append("UX navigation acceptance must retain the GM-only Campaign Toolkit destination")
    if ux_acceptance.get("accessibility", {}).get("maximumSeriousOrCriticalAxeViolations") != 0:
        errors.append("UX accessibility acceptance must retain zero serious or critical Axe findings")
    if ux_acceptance.get("responsive", {}).get("minimumCssWidthAtTwoHundredPercentZoom") != 160:
        errors.append("UX responsive acceptance must retain the 200-percent zoom boundary")
    expected_scale = {
        "campaignTables": 200,
        "rowsPerTable": 50,
        "generationRequestMaximum": 30,
        "committedPokemonBudget": 10,
        "npcTrainerCount": 1,
        "npcRosterMaximum": 6,
        "preparationScenes": 20,
        "preparationLinkedDocuments": 50,
        "realtimeClients": 6,
        "concurrentGmTabs": 2,
    }
    if scale.get("scale") != expected_scale:
        errors.append("performance scale fixture does not equal activation decision 8")
    wild = legality.get("wild", {})
    for key in ("level", "experience", "moves", "abilities", "gender", "nature", "shiny", "heldItem", "groupComposition"):
        if key not in wild:
            errors.append(f"legality policy missing wild.{key}")
    fixtures = fixture_index.get("fixtures", [])
    indexed_paths = {row.get("path") for row in fixtures if isinstance(row, dict)}
    for required in foundation_paths[6:8] + foundation_paths[9:11]:
        if required not in indexed_paths:
            errors.append(f"fixture index missing {required}")
    if deterministic.get("rng", {}).get("browserDraws") is not False:
        errors.append("deterministic fixture must forbid browser draws")
    npc_fixtures = [row for row in deterministic.get("fixtures", []) if isinstance(row, dict) and row.get("fixtureId") == "npc-one-plus-six"]
    if len(npc_fixtures) != 1:
        errors.append("deterministic fixtures must contain exactly one npc-one-plus-six package")
    else:
        expected = npc_fixtures[0].get("expected", {})
        if expected.get("trainerCount") != 1 or expected.get("pokemonCount") != 6 or len(expected.get("roster", [])) != 6:
            errors.append("NPC determinism fixture must bind an exact 1+6 package")
        for key in ("seedHex", "previewHash", "journalSha256"):
            value = expected.get(key)
            if not isinstance(value, str) or len(value) != 64 or any(char not in "0123456789abcdef" for char in value):
                errors.append(f"NPC determinism fixture {key} must be a SHA-256 commitment")
    policies = npc_archetypes.get("policies", [])
    if len(policies) != 1 or policies[0].get("archetypeId") != "npc-archetype:v1:field-researcher":
        errors.append("reviewed NPC archetype seed must contain the Field Researcher policy")
    elif policies[0].get("roster", {}).get("count") != 6:
        errors.append("reviewed Field Researcher policy must retain the six-Pokémon roster bound")
    if foundation_paths[12] not in indexed_paths:
        errors.append("fixture index missing the reviewed session preparation fixture")
    if foundation_paths[13] not in indexed_paths:
        errors.append("fixture index missing the reviewed Builder launch fixture")
    preparation_document = session_preparation.get("document", {})
    preparation_expected = session_preparation.get("expected", {})
    if len(preparation_document.get("scenes", [])) != 1 or preparation_expected.get("sceneCount") != 1:
        errors.append("session preparation fixture must retain its one-scene vertical slice")
    if preparation_expected.get("publicProjectionBeforeLaunch", "missing") is not None:
        errors.append("session preparation fixture must forbid public projection before launch")
    if set(preparation_expected.get("readyBlockedReasons", [])) != {"open-decision", "unreviewed-option"}:
        errors.append("session preparation fixture must bind both readiness blockers")
    launch_expected = builder_launch.get("expected", {})
    launch_journey = builder_launch.get("goldenJourney", {})
    if launch_journey.get("sourceResolution") != "inside-launch-transaction" or launch_journey.get("browserMechanicalAuthority") is not False:
        errors.append("Builder fixture must bind transaction-local source resolution with no browser mechanics authority")
    if launch_expected.get("preparationRevisionAfterLaunch") != 1 or launch_expected.get("launchEvidenceCount") != 1:
        errors.append("Builder fixture must bind one immutable linked preparation launch")
    if any(value != 0 for value in launch_expected.get("exactRetry", {}).values()):
        errors.append("Builder exact retry fixture must add zero authority")
    interrupted = launch_expected.get("interruptedLaunch", {})
    for key in ("encounterDocuments", "launchOperations", "preparationRevision", "preparationLaunchEvidence", "recordLaunchOperations", "additionalRealtime"):
        if interrupted.get(key) != 0:
            errors.append(f"Builder interrupted launch must retain zero {key}")
    if launch_expected.get("settlementUsesOrdinaryAuthority") is not True or launch_expected.get("toolkitSpecificLiveplayEngine") is not False:
        errors.append("Builder fixture must continue through ordinary settlement authority")
    if recovery_certification.get("status") != "certified" or recovery_certification.get("storage", {}).get("latestVersion") != 56:
        errors.append("recovery/performance certification must accept storage schema v56")
    acceptance = recovery_certification.get("acceptance", {})
    if acceptance.get("nextTicket") != "P12-085" or any(value is not True for key, value in acceptance.items() if key != "nextTicket"):
        errors.append("recovery/performance certification acceptance matrix is incomplete")
    budget_path = recovery_certification.get("performance", {}).get("budgetPath")
    if isinstance(budget_path, str):
        budget_hash = hashlib.sha256((ROOT / budget_path).read_bytes()).hexdigest()
        if recovery_certification.get("performance", {}).get("budgetSha256") != budget_hash:
            errors.append("recovery/performance certification budget hash drifted")
    else:
        errors.append("recovery/performance certification budget path is missing")
    for row in [*recovery_certification.get("authorities", []), *recovery_certification.get("evidence", [])]:
        path = row.get("path") if isinstance(row, dict) else None
        expected_hash = row.get("sha256") if isinstance(row, dict) else None
        if not isinstance(path, str) or not (ROOT / path).is_file():
            errors.append(f"recovery/performance certification evidence is missing: {path}")
        elif hashlib.sha256((ROOT / path).read_bytes()).hexdigest() != expected_hash:
            errors.append(f"recovery/performance certification evidence drifted: {path}")
    scenario_ids = {row.get("id") for row in failures.get("scenarios", []) if isinstance(row, dict)}
    expected_scenarios = {
        "exact-retry", "changed-input-conflict", "stale-revision", "offline-interruption",
        "restart-pending", "reconnect", "correction", "cancellation", "concurrent-gm-tabs", "interrupted-launch",
    }
    if scenario_ids != expected_scenarios:
        errors.append("failure/recovery scenario matrix is incomplete")

    footprint_command = [sys.executable, str(ROOT / "scripts/generate_gm_campaign_toolkit_footprint.py"), "--check"]
    if args.require_final:
        footprint_command.append("--check-final")
    result = subprocess.run(footprint_command, cwd=ROOT, text=True, capture_output=True, check=False)
    if result.returncode:
        errors.extend(line.removeprefix("ERROR: ") for line in result.stderr.splitlines() if line.strip())

    if args.require_final:
        acceptance_path = DATA / "final-acceptance.v1.json"
        if not acceptance_path.is_file():
            errors.append("final acceptance artifact is missing")
        else:
            final_acceptance = json.loads(acceptance_path.read_text(encoding="utf-8"))
            if (
                final_acceptance.get("schemaVersion") != 1
                or final_acceptance.get("ticket") != "P12-096"
                or final_acceptance.get("status") != "accepted"
                or final_acceptance.get("ticketsDone") != 96
            ):
                errors.append("final acceptance must record 96 accepted P12-096 tickets")
            plan = final_acceptance.get("plan", {})
            archived_plan_path = plan.get("path")
            if (
                archived_plan_path != "implementation-plans/done/GM_CAMPAIGN_TOOLKIT_PLAN.md"
                or plan.get("ticketsDone") != 96
                or plan.get("phasesDone") != 8
                or plan.get("currentTicket") != "NONE"
                or plan.get("blockers") != 0
                or plan.get("archived") is not True
                or not (ROOT / archived_plan_path).is_file()
                or (ROOT / "implementation-plans/GM_CAMPAIGN_TOOLKIT_PLAN.md").exists()
            ):
                errors.append("final acceptance must bind the archived 96-ticket, eight-phase Plan 12 ledger")
            final_footprint = final_acceptance.get("footprint", {})
            expected_final_footprint = {
                "rows": 40,
                "finalRows": 40,
                "nativeRows": 20,
                "migratedRows": 4,
                "preservedRows": 5,
                "retiredRows": 10,
                "documentaryRows": 1,
                "pendingRows": 0,
                "blockedRows": 0,
                "hardFailures": 0,
            }
            if final_footprint.get("activationSha256") != "161be4cb987549b3947ba65262d325fcfd28dd5538286d633528e4ef2a2f9862":
                errors.append("final acceptance must retain the immutable activation footprint hash")
            if any(final_footprint.get(key) != value for key, value in expected_final_footprint.items()):
                errors.append("final acceptance footprint counts are incomplete")
            for row in final_acceptance.get("sourceEvidence", []):
                path = row.get("path") if isinstance(row, dict) else None
                expected_hash = row.get("sha256") if isinstance(row, dict) else None
                if not isinstance(path, str) or not (ROOT / path).is_file():
                    errors.append(f"final acceptance evidence is missing: {path}")
                elif hashlib.sha256((ROOT / path).read_bytes()).hexdigest() != expected_hash:
                    errors.append(f"final acceptance evidence drifted: {path}")
            prospective = final_acceptance.get("nextProspectivePlan", {})
            prospective_path = prospective.get("draftPath")
            if (
                prospective.get("order") != 13
                or prospective.get("draftStatus") != "REGISTERED_FOR_REVIEW"
                or prospective.get("numberedLedgerRegistered") is not False
                or prospective.get("activated") is not False
                or prospective.get("executionObligation") is not False
                or prospective.get("ownerStartRequired") is not True
                or not isinstance(prospective_path, str)
                or not (ROOT / prospective_path).is_file()
            ):
                errors.append("Plan 13 must remain a registered, unnumbered, inactive, non-obligating scope draft")
            final_assertions = final_acceptance.get("finalAssertions", {})
            if not final_assertions or any(value is not True for value in final_assertions.values()):
                errors.append("final acceptance assertions are incomplete")
            production_path = DATA / "production-liveplay-acceptance.v1.json"
            production = json.loads(production_path.read_text(encoding="utf-8")) if production_path.is_file() else {}
            if production.get("ticket") != "P12-095" or production.get("status") != "accepted" or production.get("results", {}).get("failed") != 0:
                errors.append("P12-095 production liveplay acceptance is incomplete")
        forbidden_runtime = {
            "server/utils/pokegenBatch.ts",
            "server/utils/pokegenRunner.ts",
            "scripts/pokegen.sh",
        }
        for path in forbidden_runtime:
            if (ROOT / path).exists():
                errors.append(f"retired runtime seam still exists: {path}")
        justfile = (ROOT / "justfile").read_text(encoding="utf-8")
        if "pokegen.sh" in justfile or "encounter region table" in justfile:
            errors.append("justfile still reaches retired encounter generation")

    if errors:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
        return 1
    print(f"GM Campaign Toolkit checks passed (foundation={len(foundation_paths)}, requireFinal={args.require_final})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
