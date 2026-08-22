#!/usr/bin/env python3
"""Generate the reviewed P8-092 canonical item cohort registry.

Cohort membership comes only from exact app-owned registries and the explicit
reviewed policy file. This generator never parses canonical effect prose and
never grants runtime mechanics. Any blocked decision requires explicit
remediation evidence; the reviewed P8-093 policy currently permits none.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter
from pathlib import Path
from typing import Any, Iterable

ROOT = Path(__file__).resolve().parents[1]
CATALOG_PATH = ROOT / "data/reference/items.json"
POLICY_PATH = ROOT / "scripts/reviewed-data/item-catalog-cohort-policy.v1.json"
OUTPUT_PATH = ROOT / "data/complete-play-loop/item-catalog-cohorts.v1.json"


def stable_json(value: Any) -> str:
    if isinstance(value, dict):
        return "{" + ",".join(
            json.dumps(key, ensure_ascii=False, separators=(",", ":")) + ":" + stable_json(value[key])
            for key in sorted(value)
        ) + "}"
    if isinstance(value, list):
        return "[" + ",".join(stable_json(entry) for entry in value) + "]"
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_value(value: Any) -> str:
    return sha256_bytes(stable_json(value).encode("utf-8"))


def sha256_text(value: str) -> str:
    return sha256_bytes(value.encode("utf-8"))


def load(path: Path) -> Any:
    return json.loads(path.read_text())


def exact_ids(path: str, collection: str, field: str) -> set[str]:
    document = load(ROOT / path)
    rows = document.get(collection)
    if not isinstance(rows, list):
        raise SystemExit(f"{path} has no {collection} array")
    result: set[str] = set()
    for index, row in enumerate(rows):
        if not isinstance(row, dict) or not isinstance(row.get(field), str):
            raise SystemExit(f"{path}.{collection}[{index}] has no exact {field}")
        canonical_id = row[field]
        if canonical_id in result:
            raise SystemExit(f"{path} repeats {canonical_id}")
        result.add(canonical_id)
    return result


def evidence(paths: Iterable[str]) -> list[dict[str, str]]:
    result: list[dict[str, str]] = []
    for relative in paths:
        path = ROOT / relative
        if not path.is_file():
            raise SystemExit(f"Cohort evidence path is missing: {relative}")
        result.append({"path": relative, "sha256": sha256_bytes(path.read_bytes())})
    return result


def chunks(values: list[str], limit: int) -> list[list[str]]:
    return [values[index:index + limit] for index in range(0, len(values), limit)]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()

    raw_catalog = CATALOG_PATH.read_bytes()
    catalog = json.loads(raw_catalog)
    policy = load(POLICY_PATH)
    if policy.get("schemaVersion") != 1 or policy.get("status") != "reviewed":
        raise SystemExit("Item cohort policy must be reviewed schema v1")
    limit = policy.get("maximumMembersPerCohort")
    if not isinstance(limit, int) or limit < 1 or limit > 64:
        raise SystemExit("Item cohort member limit must be from 1 through 64")
    providers = policy.get("providers")
    if not isinstance(providers, dict):
        raise SystemExit("Item cohort policy providers must be an object")

    canonical_order = list(catalog)
    canonical_ids = set(canonical_order)
    for canonical_id, row in catalog.items():
        if not isinstance(row, dict) or row.get("name") != canonical_id:
            raise SystemExit(f"Canonical item key/name mismatch: {canonical_id}")

    machine = {
        canonical_id for canonical_id, row in catalog.items()
        if set(row.get("categories", [])) & {"TM", "HM"}
    }
    evolution = {
        canonical_id for canonical_id, row in catalog.items()
        if set(row.get("categories", [])) & {"Evolutionary Stone", "Evolutionary Keepsake"}
    }
    permanent = {
        "HP Up", "Protein", "Iron", "Calcium", "Zinc", "Carbos",
        "Heart Booster", "PP Up", "Rare Candy", "Stat Suppressants",
    }
    exploration = exact_ids("data/complete-play-loop/exploration-items.v1.json", "items", "canonicalId")
    breeding = exact_ids("data/complete-play-loop/breeding-items.v1.json", "items", "canonicalId")
    guided = exact_ids(
        "data/complete-play-loop/guided-item-adjudications.v1.json",
        "inventoryItems",
        "canonicalId",
    ) | {"Re-Breather"}
    equipment = exact_ids(
        "data/complete-play-loop/equipment-definitions.v1.json",
        "definitions",
        "canonicalItemId",
    )
    specs = exact_ids("data/complete-play-loop/specs.v1.json", "specs", "canonicalId")
    capture = {
        canonical_id for canonical_id, row in catalog.items()
        if "Poké Ball" in row.get("categories", [])
    }
    # Poffin is owned by the reviewed Pokémon Contest preparation authority;
    # the four other Contest items remain classified by their earlier equipment/tool providers.
    contest = {"Poffin"}
    interpretive_groups = policy.get("interpretiveCampaignToolGroups")
    if not isinstance(interpretive_groups, dict):
        raise SystemExit("Item cohort policy interpretive groups must be an object")
    interpretive: set[str] = set()
    for group_id, values in interpretive_groups.items():
        if not isinstance(values, list) or not values or any(not isinstance(value, str) for value in values):
            raise SystemExit(f"Interpretive group {group_id} must be a nonempty string array")
        duplicates = interpretive.intersection(values)
        if duplicates:
            raise SystemExit(f"Interpretive groups repeat: {sorted(duplicates)}")
        interpretive.update(values)
    defects = set(policy.get("canonicalDataDefectItems", []))

    candidate_sets = {
        "machine-move": machine,
        "evolution": evolution,
        "permanent-advancement": permanent,
        "exploration": exploration,
        "breeding": breeding,
        "guided-adjudication": guided,
        "equipment": equipment,
        "core-item-spec": specs,
        "capture": capture,
        "contest": contest,
        "interpretive-campaign-tool": interpretive,
        "canonical-data-defect": defects,
    }
    unknown = set().union(*candidate_sets.values()) - canonical_ids
    if unknown:
        raise SystemExit(f"Cohort policy references unknown canonical items: {sorted(unknown)}")

    assigned: set[str] = set()
    provider_members: dict[str, list[str]] = {}
    precedence = policy.get("precedence")
    if precedence != list(candidate_sets):
        raise SystemExit("Item cohort precedence must list every provider once in reviewed order")
    for provider_id in precedence:
        selected = candidate_sets[provider_id] - assigned
        provider_members[provider_id] = [value for value in canonical_order if value in selected]
        assigned.update(selected)
    if assigned != canonical_ids:
        raise SystemExit(f"Canonical cohort registry is incomplete: {sorted(canonical_ids - assigned)}")

    cohort_inputs: list[tuple[str, str, list[str]]] = []
    for provider_id in precedence:
        if provider_id == "interpretive-campaign-tool":
            for group_id, values in interpretive_groups.items():
                exact = [value for value in values if value in provider_members[provider_id]]
                if exact:
                    cohort_inputs.append((f"interpretive-campaign-tool-{group_id}", provider_id, exact))
            continue
        values = provider_members[provider_id]
        for index, part in enumerate(chunks(values, limit), start=1):
            suffix = f"-{index:02d}" if len(values) > limit else ""
            cohort_inputs.append((f"{provider_id}{suffix}", provider_id, part))

    cohorts: list[dict[str, Any]] = []
    for sequence, (cohort_id, provider_id, member_ids) in enumerate(cohort_inputs, start=1):
        provider = providers.get(provider_id)
        if not isinstance(provider, dict):
            raise SystemExit(f"Missing reviewed provider policy: {provider_id}")
        state = provider.get("implementationState")
        if state not in {"native", "guided", "passive", "reference-only", "not-applicable", "blocked"}:
            raise SystemExit(f"Provider {provider_id} has an invalid implementation state")
        unresolved = provider.get("unresolvedRequirements")
        if not isinstance(unresolved, list) or any(not isinstance(value, str) or not value for value in unresolved):
            raise SystemExit(f"Provider {provider_id} has invalid unresolved requirements")
        if (state == "blocked") != bool(unresolved):
            raise SystemExit(f"Provider {provider_id} blocked state and unresolved requirements disagree")
        members = []
        for canonical_id in member_ids:
            row = catalog[canonical_id]
            members.append({
                "canonicalId": canonical_id,
                "recordSha256": sha256_value(row),
                "effectSha256": sha256_text("\n".join(row.get("effects", []))),
            })
        source_registry = provider.get("sourceRegistry")
        if not isinstance(source_registry, str):
            raise SystemExit(f"Provider {provider_id} has no source registry")
        source_paths = list(dict.fromkeys([
            "data/reference/items.json",
            "scripts/reviewed-data/item-catalog-cohort-policy.v1.json",
            source_registry,
        ]))
        cohort = {
            "cohortId": cohort_id,
            "sequence": sequence,
            "providerId": provider_id,
            "implementationState": state,
            "memberCount": len(members),
            "sourceFingerprint": sha256_value(members),
            "members": members,
            "providerRequirements": provider.get("providerRequirements"),
            "sourceEvidence": evidence(source_paths),
            "executableEvidence": evidence(provider.get("executableEvidence", [])),
            "uiProjectionEvidence": evidence(provider.get("uiProjectionEvidence", [])),
            "recoveryEvidence": evidence(provider.get("recoveryEvidence", [])),
            "unresolvedRequirements": unresolved,
        }
        for key in ("providerRequirements", "executableEvidence", "uiProjectionEvidence", "recoveryEvidence"):
            if not cohort[key]:
                raise SystemExit(f"Cohort {cohort_id} requires nonempty {key}")
        cohorts.append(cohort)

    state_counts = Counter()
    provider_counts = Counter()
    for cohort in cohorts:
        state_counts[cohort["implementationState"]] += cohort["memberCount"]
        provider_counts[cohort["providerId"]] += cohort["memberCount"]
    document = {
        "schemaVersion": 1,
        "ticket": "P8-092",
        "status": "reviewed",
        "catalogSha256": sha256_bytes(raw_catalog),
        "policySha256": sha256_bytes(POLICY_PATH.read_bytes()),
        "runtimeProseParsing": False,
        "cohortMemberLimit": limit,
        "cohortCount": len(cohorts),
        "itemCount": len(canonical_ids),
        "implementationStateCounts": dict(sorted(state_counts.items())),
        "providerCounts": {provider_id: provider_counts[provider_id] for provider_id in precedence},
        "registrySha256": sha256_value(cohorts),
        "cohorts": cohorts,
    }
    rendered = json.dumps(document, ensure_ascii=False, indent=2) + "\n"
    if args.check:
        if not OUTPUT_PATH.is_file() or OUTPUT_PATH.read_text() != rendered:
            raise SystemExit("Canonical item cohort registry is stale; regenerate and review it.")
        return
    OUTPUT_PATH.write_text(rendered)


if __name__ == "__main__":
    main()
