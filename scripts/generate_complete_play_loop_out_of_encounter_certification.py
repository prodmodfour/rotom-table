#!/usr/bin/env python3
"""Generate the P8-060 cross-workflow out-of-encounter certification index.

This artifact is acceptance evidence only. It grants no runtime mechanics or authority.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data/complete-play-loop/out-of-encounter-item-certification.v1.json"

SOURCE_PATHS = [
    "data/complete-play-loop/fixtures/items.v1.json",
    "data/complete-play-loop/medical-extended-actions.v1.json",
    "data/complete-play-loop/permanent-advancement-items.v1.json",
    "data/complete-play-loop/move-learning-items.v1.json",
    "data/complete-play-loop/evolution-items.v1.json",
    "data/complete-play-loop/exploration-items.v1.json",
    "data/complete-play-loop/breeding-items.v1.json",
    "data/complete-play-loop/guided-item-adjudications.v1.json",
]

JOURNEYS: list[dict[str, Any]] = [
    {
        "id": "medical-extended-action",
        "category": "medical",
        "fixtures": ["extended-first-aid-kit", "extended-bandages-treatment"],
        "tests": [
            "tests/server/itemExtendedActions.test.ts",
            "tests/server/itemMedicalTreatments.test.ts",
            "tests/e2e/medical-extended-actions.spec.ts",
        ],
        "guarantees": ["inert-start", "atomic-completion", "safe-interruption", "exact-replay", "campaign-clock-treatment"],
    },
    {
        "id": "permanent-advancement",
        "category": "training",
        "fixtures": ["permanent-stat-vitamins", "permanent-pp-up-choice", "permanent-rare-candy", "permanent-stat-suppressant-consent"],
        "tests": [
            "tests/integration/permanentAdvancementExtendedActions.test.ts",
            "tests/server/itemPermanentAdvancement.test.ts",
            "tests/e2e/permanent-advancement-items.spec.ts",
        ],
        "guarantees": ["inert-start", "exact-choice-revalidation", "atomic-permanent-write", "stale-rejection", "exact-replay"],
    },
    {
        "id": "machine-move-learning",
        "category": "move-learning",
        "fixtures": [],
        "tests": [
            "tests/integration/machineMoveLearningExtendedActions.test.ts",
            "tests/integration/machineMoveLearningOperation.test.ts",
            "tests/server/itemMoveLearning.test.ts",
            "tests/e2e/machine-move-learning.spec.ts",
        ],
        "guarantees": ["compatibility-revalidation", "persisted-replacement-choice", "atomic-move-and-cost", "stale-rejection", "exact-replay"],
    },
    {
        "id": "evolution-item",
        "category": "evolution",
        "fixtures": [],
        "tests": [
            "tests/integration/evolutionItemOperation.test.ts",
            "tests/integration/evolutionItemSheetAction.test.ts",
            "tests/server/itemEvolution.test.ts",
            "tests/e2e/evolution-items.spec.ts",
        ],
        "guarantees": ["explicit-preview", "identity-retention", "atomic-evolution-and-consumption", "stale-rejection", "exact-replay"],
    },
    {
        "id": "exploration-campaign-and-map",
        "category": "exploration",
        "fixtures": [],
        "tests": [
            "tests/integration/explorationItemExecution.test.ts",
            "tests/integration/itemExplorationOperation.test.ts",
            "tests/integration/itemExplorationMultiClient.test.ts",
            "tests/e2e/exploration-items.spec.ts",
        ],
        "guarantees": ["campaign-clock-authority", "server-randomness", "source-custody", "multi-client-convergence", "exact-replay"],
    },
    {
        "id": "breeding-item-adapter",
        "category": "breeding-related",
        "fixtures": [],
        "tests": [
            "tests/server/itemBreedingWorkflows.test.ts",
            "tests/server/itemBreedingOperationRepository.test.ts",
            "tests/server/itemBreedingRoutes.test.ts",
            "tests/e2e/breeding-workshop.spec.ts",
        ],
        "guarantees": ["shared-egg-lifecycle", "exact-tool-custody", "atomic-source-cost", "private-projection", "exact-replay"],
    },
    {
        "id": "guided-item-adjudication",
        "category": "guided",
        "fixtures": [],
        "tests": [
            "tests/server/itemGuidedAdjudication.test.ts",
            "tests/server/itemGuidedRequestRepository.test.ts",
            "tests/composables/useItemGuidedAdjudication.test.ts",
            "tests/e2e/guided-item-adjudication.spec.ts",
        ],
        "guarantees": ["reservation-before-decision", "bounded-gm-input", "inert-cancellation", "private-receipt", "exact-replay"],
    },
    {
        "id": "cross-workflow-recovery",
        "category": "recovery",
        "fixtures": [],
        "tests": [
            "tests/integration/outOfEncounterItemRecovery.test.ts",
            "tests/server/itemOperationRepository.test.ts",
            "tests/server/itemExtendedActionRoutes.test.ts",
            "tests/composables/useTrainerItemExtendedActions.test.ts",
            "tests/composables/useItemGuidedAdjudication.test.ts",
        ],
        "guarantees": ["cancellation", "stale-revision", "reconnect", "process-restart", "uncertain-exact-retry", "no-manual-repair"],
    },
]

REQUIRED_CATEGORIES = [
    "medical", "training", "move-learning", "evolution", "exploration",
    "breeding-related", "guided", "recovery",
]
REQUIRED_RECOVERY = ["cancellation", "stale-revision", "reconnect", "process-restart", "uncertain-exact-retry", "no-manual-repair"]


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def canonical(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode()


def binding(path: str) -> dict[str, str]:
    absolute = ROOT / path
    if not absolute.is_file():
        raise SystemExit(f"Missing certification evidence: {path}")
    return {"path": path, "sha256": sha256_bytes(absolute.read_bytes())}


def build() -> dict[str, Any]:
    journeys = []
    for row in JOURNEYS:
        journeys.append({
            "id": row["id"],
            "category": row["category"],
            "fixtures": row["fixtures"],
            "guarantees": row["guarantees"],
            "evidenceTests": [binding(path) for path in row["tests"]],
            "manualRepairRequired": False,
        })
    test_paths = sorted({entry["path"] for journey in journeys for entry in journey["evidenceTests"]})
    definition = {
        "status": "certified-current-semantics",
        "authority": "acceptance-evidence-only-no-runtime-mechanics",
        "requiredCategories": REQUIRED_CATEGORIES,
        "requiredRecovery": REQUIRED_RECOVERY,
        "sourceBindings": [binding(path) for path in SOURCE_PATHS],
        "journeys": journeys,
        "summary": {
            "journeyCount": len(journeys),
            "evidenceTestCount": len(test_paths),
            "manualRepairRequired": False,
            "directJsonRepairAllowed": False,
            "directDatabaseRepairAllowed": False,
        },
    }
    return {
        "schemaVersion": 1,
        "ticket": "P8-060",
        "definitionSha256": sha256_bytes(canonical(definition)),
        "definition": definition,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    expected = canonical(build())
    if args.check:
        if not OUTPUT.is_file() or OUTPUT.read_bytes() != expected:
            raise SystemExit("Out-of-encounter item certification is missing or stale.")
        print(f"Out-of-encounter certification check passed: {len(JOURNEYS)} journeys.")
        return
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_bytes(expected)
    print(f"Wrote {OUTPUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
