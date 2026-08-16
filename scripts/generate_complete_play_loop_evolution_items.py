#!/usr/bin/env python3
"""Generate/check the reviewed P8-055 Evolutionary Item evidence contract."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data/complete-play-loop/evolution-items.v1.json"
RULES = ROOT / "data/reference/rules.json"
ITEMS = ROOT / "data/reference/items.json"
POKEDEX = ROOT / "data/reference/pokedex.json"
SPECS = ROOT / "data/complete-play-loop/specs.v1.json"
REMEDIATION = ROOT / "data/complete-play-loop/canonical-data-remediation.v1.json"
RULE_ID = "Evolutionary Items"
MIGRATION_ID = "rule-data-evolution-item-mechanics-v1"
SUCCESSOR_MIGRATION_IDS = [
    "rule-data-item-form-change-mechanics-v1",
    "rule-data-exploration-item-mechanics-v1",
    "rule-data-pokemon-advancement-choices-v1",
    "rule-data-trainer-advancement-choices-v1",
]
ITEM_SOURCE = ROOT / "books/markdown/core/09-gear-and-items.md"
EVOLUTION_SOURCE = ROOT / "books/markdown/core/05-pokemon.md"
ITEM_SOURCE_LINES = (2034, 2101)
EVOLUTION_SOURCE_LINES = (591, 607)


def stable_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_value(value: Any) -> str:
    return sha256_bytes(stable_json(value).encode())


def excerpt(path: Path, line_range: tuple[int, int]) -> bytes:
    lines = path.read_text().splitlines(keepends=True)
    start, end = line_range
    if start < 1 or end < start or end > len(lines):
        raise SystemExit(f"Invalid reviewed excerpt {path}:{start}-{end}.")
    return "".join(lines[start - 1:end]).encode()


def source(path: Path, line_range: tuple[int, int], pages: list[int]) -> dict[str, Any]:
    return {
        "path": str(path.relative_to(ROOT)),
        "fileSha256": sha256_bytes(path.read_bytes()),
        "gitBlob": hashlib.sha1(b"blob " + str(len(path.read_bytes())).encode() + b"\0" + path.read_bytes()).hexdigest(),
        "lineRanges": [list(line_range)],
        "excerptSha256": sha256_bytes(excerpt(path, line_range)),
        "pages": pages,
    }


def build(certification_status: str = "pending-final-gates") -> dict[str, Any]:
    rules_bytes = RULES.read_bytes()
    items_bytes = ITEMS.read_bytes()
    pokedex_bytes = POKEDEX.read_bytes()
    rules = json.loads(rules_bytes)
    items = json.loads(items_bytes)
    pokedex_rows = json.loads(pokedex_bytes)
    specs = json.loads(SPECS.read_text())
    remediation = json.loads(REMEDIATION.read_text())
    rule = rules.get(RULE_ID)
    mechanics = rule.get("itemEvolutionMechanics") if isinstance(rule, dict) else None
    if not isinstance(mechanics, dict) or mechanics.get("schemaVersion") != 1:
        raise SystemExit("Evolutionary Items authority is missing.")
    transitions = mechanics.get("transitions")
    if not isinstance(transitions, list) or len(transitions) != 62:
        raise SystemExit("Evolutionary Item transition authority drifted.")
    migration = next((row for row in remediation.get("reviewedMigrations", []) if row.get("migrationId") == MIGRATION_ID), None)
    if not isinstance(migration, dict) or migration.get("reviewStatus") != "accepted":
        raise SystemExit("Evolutionary Item migration evidence is missing.")
    if migration.get("afterRecordSha256") != sha256_value(rule):
        raise SystemExit("Evolutionary Item migration no longer binds its canonical rule record.")
    current_rules_sha = migration.get("afterFileSha256")
    for successor_id in SUCCESSOR_MIGRATION_IDS:
        successor = next((row for row in remediation.get("reviewedMigrations", []) if row.get("migrationId") == successor_id), None)
        if not isinstance(successor, dict) or successor.get("reviewStatus") != "accepted" \
                or successor.get("canonicalPath") != str(RULES.relative_to(ROOT)) \
                or successor.get("beforeFileSha256") != current_rules_sha:
            raise SystemExit("Evolutionary Item rule successor evidence is missing or discontinuous.")
        current_rules_sha = successor.get("afterFileSha256")
    if current_rules_sha != sha256_bytes(rules_bytes):
        raise SystemExit("Evolutionary Item rule successors do not bind current rule authority.")
    species = {row.get("species"): row for row in pokedex_rows}
    spec_rows = {
        row.get("canonicalId"): row
        for row in specs.get("specs", [])
        if isinstance(row, dict) and isinstance(row.get("effect"), dict)
        and row["effect"].get("kind") == "evolve-pokemon"
    }
    item_ids = list(dict.fromkeys(row["itemId"] for row in transitions))
    if len(item_ids) != 24 or set(item_ids) != set(spec_rows):
        raise SystemExit("Evolutionary Item spec roster drifted.")
    contract_items: list[dict[str, Any]] = []
    for item_id in item_ids:
        item = items.get(item_id)
        spec = spec_rows.get(item_id)
        if not isinstance(item, dict) or not isinstance(spec, dict):
            raise SystemExit(f"Missing canonical Evolutionary Item {item_id}.")
        if spec.get("recordSha256") != sha256_value(item) or spec.get("effectSha256") != sha256_bytes("\n".join(item.get("effects", [])).encode()):
            raise SystemExit(f"Evolutionary Item {item_id} fingerprint drifted.")
        item_transitions: list[dict[str, Any]] = []
        for transition in (row for row in transitions if row["itemId"] == item_id):
            source_record = species.get(transition["fromSpecies"])
            target_record = species.get(transition["toSpecies"])
            if not isinstance(source_record, dict) or not isinstance(target_record, dict):
                raise SystemExit(f"Evolutionary Item {item_id} references unknown species.")
            item_transitions.append({
                **transition,
                "fromSpeciesRecordSha256": sha256_value(source_record),
                "toSpeciesRecordSha256": sha256_value(target_record),
            })
        contract_items.append({
            "canonicalId": item_id,
            "recordSha256": spec["recordSha256"],
            "effectSha256": spec["effectSha256"],
            "price": item.get("costs", [None])[0],
            "transitionCount": len(item_transitions),
            "transitions": item_transitions,
        })
    return {
        "schemaVersion": 1,
        "ticket": "P8-055",
        "status": "reviewed-native",
        "canonicalAuthority": {
            "items": {"path": str(ITEMS.relative_to(ROOT)), "fileSha256": sha256_bytes(items_bytes)},
            "rules": {
                "path": str(RULES.relative_to(ROOT)),
                "fileSha256": sha256_bytes(rules_bytes),
                "recordSha256": sha256_value(rule),
                "migrationId": MIGRATION_ID,
                "migrationAfterFileSha256": migration["afterFileSha256"],
                "catalogSuccessorMigrationIds": SUCCESSOR_MIGRATION_IDS,
            },
            "pokedex": {"path": str(POKEDEX.relative_to(ROOT)), "fileSha256": sha256_bytes(pokedex_bytes)},
            "runtimeDocumentaryParsingForbidden": True,
        },
        "sourceEvidence": [
            source(ITEM_SOURCE, ITEM_SOURCE_LINES, [298]),
            source(EVOLUTION_SOURCE, EVOLUTION_SOURCE_LINES, [202]),
        ],
        "policy": {
            "actorKind": mechanics["actorKind"],
            "targetKind": mechanics["targetKind"],
            "timing": mechanics["timing"],
            "consumption": {"phase": mechanics["consumptionPhase"], "quantity": mechanics["consumptionQuantity"]},
            "identity": mechanics["identityPolicy"],
            "stats": mechanics["statPolicy"],
            "abilities": mechanics["abilityPolicy"],
            "moves": mechanics["movePolicy"],
            "skillsCapabilities": mechanics["skillsCapabilitiesPolicy"],
            "equipment": mechanics["equipmentPolicy"],
            "destinationChoice": "one-authority-projected-opaque-destination",
            "confirmation": "one-exact-explicit-confirmation",
            "staleChoicePolicy": "reject-and-refresh",
        },
        "items": contract_items,
        "execution": {
            "contexts": ["sheet", "campaign"],
            "operation": "evolve-pokemon",
            "atomicWrites": ["source-inventory", "pokemon-sheet", "equipment-state", "private-evolution-ledger", "owner-attention"],
            "replay": "exact-operation-id-reuses-accepted-result",
            "setupSave": "locked-authority-preserved-and-exact-restat-resolution-receipted",
            "sourceFiles": [
                "shared/itemAutomation/evolution.ts",
                "server/domain/itemAutomation/evolution.ts",
                "server/domain/itemAutomation/eligibility.ts",
                "server/domain/itemAutomation/planner.ts",
                "server/domain/itemAutomation/reducer.ts",
                "server/domain/itemAutomation/conformance.ts",
                "server/storage/sheetRepository.ts",
            ],
        },
        "privacy": {
            "choices": "actor-owner",
            "outcome": "actor-owner",
            "privateFields": ["source-operation", "source-row", "source-instance", "hashes", "ability-slot-evidence", "raw-equipment-reasons"],
            "ownerProjection": ["species-transition", "stat-allocation", "move-opportunities", "ability-changes", "inactive-equipment-item-labels"],
        },
        "ui": {
            "selectedMockup": ".pi/artifacts/ui-mockups/evolution-item-workflow/v002.png",
            "decisionComponent": "src/components/sheets/TrainerSheetItemDecision.vue",
            "attentionComponent": "src/components/sheets/PokemonEvolutionAttentionCard.vue",
            "responsive": "one-column-below-720px",
        },
        "certification": {
            "status": certification_status,
            "requirements": [
                "focused-domain-integration-and-component-tests",
                "desktop-and-mobile-liveplay-e2e",
                "privacy-and-replay-acceptance",
                "typecheck-eslint-generated-data-and-breeding-successor-gates",
            ],
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--certify", action="store_true")
    args = parser.parse_args()
    existing_status = "pending-final-gates"
    if OUTPUT.exists():
        current = json.loads(OUTPUT.read_text())
        existing_status = current.get("certification", {}).get("status", existing_status)
    expected = build("certified" if args.certify else existing_status)
    rendered = json.dumps(expected, ensure_ascii=False, indent=2) + "\n"
    if args.check:
        if not OUTPUT.exists() or OUTPUT.read_text() != rendered:
            raise SystemExit("Evolutionary Item evidence contract is missing or stale.")
        print(f"Evolutionary Item evidence check passed: {len(expected['items'])} items, 62 transitions.")
        return
    OUTPUT.write_text(rendered)
    print(f"Generated {OUTPUT.relative_to(ROOT)} with {len(expected['items'])} items and 62 transitions.")


if __name__ == "__main__":
    main()
