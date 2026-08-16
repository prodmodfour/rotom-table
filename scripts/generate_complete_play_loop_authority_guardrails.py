#!/usr/bin/env python3
"""Generate and enforce the P8-094 complete-loop authority guardrails.

The checker is intentionally source-structural rather than prose-driven. It
binds every catalog provider and settlement field to reviewed runtime owners,
rejects new client mechanic callers, and makes every server inventory document
assignment an explicit reviewed boundary.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from collections import Counter
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
REVIEW_PATH = ROOT / "scripts/reviewed-data/complete-play-loop-authority-guardrails.v1.json"
OUTPUT_PATH = ROOT / "data/complete-play-loop/authority-guardrails.v1.json"
REGISTRY_IMPLEMENTATION_PATH = ROOT / "server/domain/itemAutomation/registry.ts"
SETTLEMENT_DOCUMENT_PATH = ROOT / "shared/encounterSettlement/document.ts"


def fail(message: str) -> None:
    raise SystemExit(message)


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def stable_json(value: Any) -> str:
    if isinstance(value, dict):
        return "{" + ",".join(
            json.dumps(key, ensure_ascii=False, separators=(",", ":")) + ":" + stable_json(value[key])
            for key in sorted(value)
        ) + "}"
    if isinstance(value, list):
        return "[" + ",".join(stable_json(entry) for entry in value) + "]"
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def sha256_value(value: Any) -> str:
    return sha256_bytes(stable_json(value).encode("utf-8"))


def load(path: Path) -> Any:
    return json.loads(path.read_text())


def relative_files(roots: list[str], suffixes: tuple[str, ...] = (".ts", ".vue")) -> list[Path]:
    files: list[Path] = []
    for root in roots:
        base = ROOT / root
        if not base.is_dir():
            fail(f"Guardrail source root is missing: {root}")
        files.extend(path for path in base.rglob("*") if path.is_file() and path.suffix in suffixes)
    return sorted(set(files))


def rel(path: Path) -> str:
    return path.relative_to(ROOT).as_posix()


def evidence(paths: list[str]) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    if len(paths) != len(set(paths)):
        fail("Guardrail evidence paths must be unique within one authority.")
    for path_value in paths:
        path = ROOT / path_value
        if not path.is_file():
            fail(f"Guardrail evidence path is missing: {path_value}")
        rows.append({"path": path_value, "sha256": sha256_bytes(path.read_bytes())})
    return rows


def extract_settlement_fields() -> list[str]:
    source = SETTLEMENT_DOCUMENT_PATH.read_text()
    match = re.search(
        r"export interface EncounterSettlementDocument\s*\{(?P<body>.*?)\n\}",
        source,
        flags=re.DOTALL,
    )
    if not match:
        fail("EncounterSettlementDocument interface could not be located.")
    fields = re.findall(r"^\s*readonly\s+([A-Za-z][A-Za-z0-9]*)\s*:", match.group("body"), flags=re.MULTILINE)
    if not fields or len(fields) != len(set(fields)):
        fail("EncounterSettlementDocument fields must be uniquely extractable.")
    return fields


def generate() -> dict[str, Any]:
    review = load(REVIEW_PATH)
    if review.get("schemaVersion") != 1 or review.get("ticket") != "P8-094" or review.get("status") != "reviewed":
        fail("Authority guardrails must use reviewed P8-094 schema v1.")
    if review.get("runtimeProseParsing") is not False:
        fail("Authority guardrails must prohibit runtime prose parsing.")

    catalog_config = review.get("catalogRegistry")
    if not isinstance(catalog_config, dict):
        fail("Authority guardrails require catalogRegistry.")
    catalog_path = ROOT / str(catalog_config.get("catalogPath", ""))
    cohort_path = ROOT / str(catalog_config.get("cohortRegistryPath", ""))
    catalog = load(catalog_path)
    cohorts = load(cohort_path)
    if not isinstance(catalog, dict) or not isinstance(cohorts, dict):
        fail("Catalog and cohort registry must be JSON objects.")
    if cohorts.get("catalogSha256") != sha256_bytes(catalog_path.read_bytes()):
        fail("Catalog cohort registry is stale against canonical items.")

    canonical_ids = list(catalog)
    member_rows = [member for cohort in cohorts.get("cohorts", []) for member in cohort.get("members", [])]
    member_ids = [row.get("canonicalId") for row in member_rows]
    counts = Counter(member_ids)
    duplicates = sorted(value for value, count in counts.items() if count != 1)
    missing = sorted(set(canonical_ids) - set(member_ids))
    unknown = sorted(set(member_ids) - set(canonical_ids))
    if duplicates or missing or unknown or len(member_ids) != len(canonical_ids):
        fail(f"Canonical item registration drift: duplicates={duplicates}, missing={missing}, unknown={unknown}.")

    allowed_states = set(catalog_config.get("allowedImplementationStates", []))
    forbidden_states = set(catalog_config.get("forbiddenImplementationStates", []))
    if not allowed_states or allowed_states & forbidden_states:
        fail("Implementation-state guardrails are malformed.")
    for cohort in cohorts.get("cohorts", []):
        state = cohort.get("implementationState")
        if state not in allowed_states or state in forbidden_states:
            fail(f"Cohort {cohort.get('cohortId')} has forbidden implementation state {state}.")
        if cohort.get("unresolvedRequirements") != []:
            fail(f"Cohort {cohort.get('cohortId')} has unresolved requirements.")

    provider_review = review.get("providerAuthorities")
    provider_counts = cohorts.get("providerCounts")
    if not isinstance(provider_review, dict) or not isinstance(provider_counts, dict):
        fail("Provider authority maps are malformed.")
    if set(provider_review) != set(provider_counts):
        fail("Provider identities drifted between reviewed owners and the cohort registry.")
    provider_states: dict[str, set[str]] = {provider_id: set() for provider_id in provider_review}
    for cohort in cohorts.get("cohorts", []):
        provider_states[cohort["providerId"]].add(cohort["implementationState"])

    provider_output: dict[str, Any] = {}
    for provider_id, authority in provider_review.items():
        count = provider_counts.get(provider_id)
        if not isinstance(count, int) or count < 0:
            fail(f"Provider {provider_id} has an invalid member count.")
        allow_zero = authority.get("allowZeroMembers") is True
        if count == 0 and not allow_zero:
            fail(f"Provider {provider_id} is orphaned from the canonical catalog.")
        if count > 0 and allow_zero:
            fail(f"Zero-only provider {provider_id} unexpectedly owns catalog members.")
        expected_state = authority.get("implementationState")
        if count > 0 and provider_states[provider_id] != {expected_state}:
            fail(f"Provider {provider_id} implementation-state authority drifted.")
        owner_paths = authority.get("ownerPaths")
        if not isinstance(owner_paths, list) or not owner_paths or not all(isinstance(path, str) for path in owner_paths):
            fail(f"Provider {provider_id} has no bounded runtime owner evidence.")
        provider_output[provider_id] = {
            "memberCount": count,
            "implementationState": expected_state,
            "allowZeroMembers": allow_zero,
            "ownerEvidence": evidence(owner_paths),
        }

    handler_review = review.get("handlerAuthorities")
    if not isinstance(handler_review, dict) or not handler_review:
        fail("Handler authorities must be a nonempty object.")
    handler_assignments = re.findall(
        r"registeredHandlerId\s*:\s*['\"]([^'\"]+)['\"]",
        REGISTRY_IMPLEMENTATION_PATH.read_text(),
    )
    active_handlers = set(handler_assignments)
    if active_handlers != set(handler_review):
        fail(
            "Item handler authority drift: "
            f"orphaned={sorted(set(handler_review) - active_handlers)}, "
            f"unregistered={sorted(active_handlers - set(handler_review))}."
        )
    handler_output: dict[str, Any] = {}
    for handler_id, authority in handler_review.items():
        owner_paths = authority.get("ownerPaths")
        if not isinstance(owner_paths, list) or not owner_paths:
            fail(f"Handler {handler_id} has no runtime owner.")
        handler_output[handler_id] = {
            "assignmentCount": handler_assignments.count(handler_id),
            "implementationState": authority.get("implementationState"),
            "ownerEvidence": evidence(owner_paths),
        }

    production_files = relative_files(["src", "server"])
    symbol_rows = review.get("mechanicalAuthoritySymbols")
    if not isinstance(symbol_rows, list) or not symbol_rows:
        fail("Mechanical authority symbols must be a nonempty array.")
    symbol_names: set[str] = set()
    symbol_output: list[dict[str, Any]] = []
    for row in symbol_rows:
        if not isinstance(row, dict) or not isinstance(row.get("symbol"), str):
            fail("Mechanical authority symbol row is malformed.")
        symbol = row["symbol"]
        if symbol in symbol_names:
            fail(f"Mechanical authority symbol is duplicated: {symbol}")
        symbol_names.add(symbol)
        declaration_path = row.get("declarationPath")
        allowed_callers = row.get("allowedCallers")
        if not isinstance(declaration_path, str) or not isinstance(allowed_callers, list) or not allowed_callers:
            fail(f"Mechanical authority {symbol} must declare one owner and bounded callers.")
        invocation = re.compile(rf"\b{re.escape(symbol)}\s*\(")
        actual_callers = sorted(
            rel(path) for path in production_files
            if rel(path) != declaration_path and invocation.search(path.read_text())
        )
        expected_callers = sorted(allowed_callers)
        if actual_callers != expected_callers:
            fail(f"Mechanical authority {symbol} caller drift: expected={expected_callers}, actual={actual_callers}.")
        if any(path.startswith("src/") for path in actual_callers):
            fail(f"Mechanical authority {symbol} is called by client code.")
        symbol_output.append({
            "symbol": symbol,
            "declarationEvidence": evidence([declaration_path])[0],
            "callerEvidence": evidence(expected_callers),
        })

    client_rules = review.get("clientAuthorityRules")
    if not isinstance(client_rules, dict):
        fail("Client authority rules are malformed.")
    client_files = relative_files(client_rules.get("roots", []))
    forbidden_imports = client_rules.get("forbiddenImportPrefixes", [])
    forbidden_callbacks = client_rules.get("forbiddenMutationCallbacks", [])
    import_pattern = re.compile(r"(?:from\s+|import\s*\()['\"]([^'\"]+)['\"]")
    callback_patterns = [re.compile(rf"\b{re.escape(value)}\b") for value in forbidden_callbacks]
    for path in client_files:
        source = path.read_text()
        for imported in import_pattern.findall(source):
            if any(imported.startswith(prefix) for prefix in forbidden_imports):
                fail(f"Client file {rel(path)} imports server authority {imported}.")
        for name, pattern in zip(forbidden_callbacks, callback_patterns, strict=True):
            if pattern.search(source):
                fail(f"Client file {rel(path)} retains forbidden mechanical mutation callback {name}.")

    inventory = review.get("inventoryMutationAuthorities")
    if not isinstance(inventory, dict):
        fail("Inventory mutation authorities are malformed.")
    try:
        assignment_pattern = re.compile(inventory["assignmentPattern"])
        bracket_pattern = re.compile(inventory["bracketAssignmentPattern"])
    except (KeyError, re.error) as error:
        fail(f"Inventory mutation pattern is invalid: {error}")
    reviewed_inventory_owners = inventory.get("owners")
    if not isinstance(reviewed_inventory_owners, dict):
        fail("Inventory mutation owners must be an object.")
    actual_inventory_counts: dict[str, int] = {}
    bracket_writers: list[str] = []
    for path in relative_files(["server"], (".ts",)):
        source = path.read_text()
        count = len(assignment_pattern.findall(source))
        if count:
            actual_inventory_counts[rel(path)] = count
        if bracket_pattern.search(source):
            bracket_writers.append(rel(path))
    expected_inventory_counts = {
        path: authority.get("assignmentCount")
        for path, authority in reviewed_inventory_owners.items()
    }
    if bracket_writers:
        fail(f"Unreviewed bracket inventory writes exist: {bracket_writers}.")
    if actual_inventory_counts != expected_inventory_counts:
        fail(
            "Inventory write authority drift: "
            f"expected={expected_inventory_counts}, actual={actual_inventory_counts}."
        )
    inventory_output: dict[str, Any] = {}
    for path, authority in reviewed_inventory_owners.items():
        kind = authority.get("kind")
        if kind not in {
            "pure-reducer", "transaction-planned-migration", "transaction-repository",
            "transaction-use-case", "projection-redaction",
        }:
            fail(f"Inventory owner {path} has an unsupported authority kind.")
        inventory_output[path] = {
            "assignmentCount": authority["assignmentCount"],
            "kind": kind,
            "evidence": evidence([path])[0],
        }

    field_owners = review.get("settlementFieldOwners")
    settlement_providers = review.get("settlementProviders")
    if not isinstance(field_owners, dict) or not isinstance(settlement_providers, dict):
        fail("Settlement ownership maps are malformed.")
    settlement_fields = extract_settlement_fields()
    if set(settlement_fields) != set(field_owners):
        fail(
            "Settlement field ownership drift: "
            f"unowned={sorted(set(settlement_fields) - set(field_owners))}, "
            f"orphaned={sorted(set(field_owners) - set(settlement_fields))}."
        )
    referenced_providers: set[str] = set()
    for field, owners in field_owners.items():
        if not isinstance(owners, list) or not owners or len(owners) != len(set(owners)):
            fail(f"Settlement field {field} has no unique owner set.")
        unknown_owners = set(owners) - set(settlement_providers)
        if unknown_owners:
            fail(f"Settlement field {field} references unknown owners: {sorted(unknown_owners)}.")
        referenced_providers.update(owners)
    orphaned_settlement_providers = set(settlement_providers) - referenced_providers
    if orphaned_settlement_providers:
        fail(f"Settlement providers own no document field: {sorted(orphaned_settlement_providers)}.")
    settlement_provider_output: dict[str, Any] = {}
    for provider_id, owner_paths in settlement_providers.items():
        if not isinstance(owner_paths, list) or not owner_paths:
            fail(f"Settlement provider {provider_id} has no runtime owner evidence.")
        settlement_provider_output[provider_id] = evidence(owner_paths)

    result: dict[str, Any] = {
        "schemaVersion": 1,
        "ticket": "P8-094",
        "status": "enforced",
        "runtimeProseParsing": False,
        "reviewedAuthoritySha256": sha256_bytes(REVIEW_PATH.read_bytes()),
        "catalog": {
            "path": rel(catalog_path),
            "sha256": sha256_bytes(catalog_path.read_bytes()),
            "itemCount": len(canonical_ids),
            "registeredExactlyOnce": True,
            "blockedCount": 0,
        },
        "cohortRegistryEvidence": evidence([rel(cohort_path)])[0],
        "providerAuthorities": provider_output,
        "handlerAuthorities": handler_output,
        "mechanicalAuthoritySymbols": symbol_output,
        "clientAuthority": {
            "filesChecked": len(client_files),
            "serverImports": 0,
            "mechanicalMutationCallbacks": 0,
            "commandOnly": True,
        },
        "inventoryMutationAuthorities": inventory_output,
        "settlementFieldOwners": field_owners,
        "settlementProviderEvidence": settlement_provider_output,
        "sourceEvidence": evidence([
            "scripts/generate_complete_play_loop_authority_guardrails.py",
            "scripts/reviewed-data/complete-play-loop-authority-guardrails.v1.json",
            "shared/itemAutomation/spec.ts",
            "shared/encounterSettlement/document.ts",
        ]),
        "certificationEvidence": evidence([
            "tests/data/completePlayLoopAuthorityGuardrails.test.ts",
            "docs/complete-play-loop-authority-guardrails.md",
            "package.json",
            "scripts/quality-gate.sh",
        ]),
    }
    result["completionEvidenceSha256"] = sha256_value(result)
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()

    generated = json.dumps(generate(), ensure_ascii=False, indent=2) + "\n"
    if args.check:
        if not OUTPUT_PATH.is_file() or OUTPUT_PATH.read_text() != generated:
            fail(f"Authority guardrail contract is stale; run {rel(Path(__file__))}.")
        print("Complete Play Loop authority guardrails pass.")
        return
    OUTPUT_PATH.write_text(generated)
    print(f"Wrote {rel(OUTPUT_PATH)}")


if __name__ == "__main__":
    main()
