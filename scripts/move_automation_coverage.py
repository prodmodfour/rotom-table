"""Coverage reader for reviewed explicit PTU move automation scripts."""
from __future__ import annotations

import ast
import hashlib
import json
import re
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any, Iterable


ROOT = Path(__file__).resolve().parents[1]
MOVES_PATH = ROOT / "data" / "reference" / "moves.json"
MOVE_AUTOMATION_SOURCE_DIR = ROOT / "src" / "utils" / "move-automation"
MANIFEST_PATH = ROOT / "data" / "move-automation" / "manifest.json"
RULESET_PATH = ROOT / "data" / "move-automation" / "ruleset.json"
CAPABILITY_CATALOG_PATH = ROOT / "data" / "move-automation" / "capabilities.json"
SCENARIO_REQUIREMENTS_PATH = ROOT / "data" / "move-automation" / "scenario-requirements.json"
LEGACY_FINGERPRINT_PATH = ROOT / "data" / "move-automation" / "legacy-v1-fingerprints.json"
SCENARIO_ROOT = ROOT / "tests" / "fixtures" / "moveAutomation"
COMPLETE_PLAY_LOOP_REMEDIATION_PATH = ROOT / "data" / "complete-play-loop" / "canonical-data-remediation.v1.json"
POKEMON_CONTEST_REVIEW_PATH = ROOT / "scripts" / "reviewed-data" / "pokemon-contests.v1.json"
MOVE_CATALOG_SUCCESSOR_MIGRATION_ID = "move-data-facade-identity-normalization-v1"
MOVE_CATALOG_SUCCESSOR_SHA256 = "418d20378d61383295da0c6d4a8a3752e6ed001300c604df9fe7e3f04276089e"
CONTEST_CATALOG_SUCCESSOR_MIGRATION_ID = "pokemon-contests:v1"
CONTEST_CATALOG_SUCCESSOR_SHA256 = "10833d0bac9baa2ed74cc3882e3287e99c99fc6b727185bee43d9374428c5821"


def load_registry_source(source_dir: Path = MOVE_AUTOMATION_SOURCE_DIR) -> str:
    """Return the explicit automation registry and reviewed script module sources."""

    paths = sorted(source_dir.rglob("*.ts"))
    return "\n\n".join(path.read_text(encoding="utf-8") for path in paths)


VALID_TYPE_ORDER = (
    "Normal", "Fighting", "Flying", "Poison", "Ground", "Rock",
    "Bug", "Ghost", "Steel", "Fire", "Water", "Grass",
    "Electric", "Psychic", "Ice", "Dragon", "Dark", "Fairy",
)
VALID_TYPES = set(VALID_TYPE_ORDER)


@dataclass(frozen=True)
class MoveCoverage:
    canonical_moves: list[dict]
    explicit_names: set[str]
    missing_names: list[str]
    extra_names: list[str]


class TypeScriptRegistryReader:
    """Small, source-limited reader for the explicit automation registry.

    This is intentionally not a general TypeScript parser. It understands the
    current reviewed allow-list shape: direct ``new Map`` entries, spread maps,
    and maps generated from explicit string-name arrays. That keeps the coverage
    checker aligned with the human-reviewed registry without accepting canonical
    moves that merely exist in data files.
    """

    def __init__(self, source: str, canonical_names: Iterable[str]):
        self.source = source
        self.canonical_names = set(canonical_names)
        self._array_cache: dict[str, list[str]] = {}
        self._map_cache: dict[str, list[str]] = {}
        self._source_group_cache: dict[str, list[str]] = {}

    def map_values(self, name: str) -> list[str]:
        if name in self._map_cache:
            return self._map_cache[name]

        assignment_end = self._assignment_end(name)
        if assignment_end is not None:
            builder_match = re.match(
                r"\s*createExplicitMoveAutomationScriptRegistry\s*\(\s*([A-Z0-9_]+)",
                self.source[assignment_end:],
            )
            if builder_match:
                values = self.source_group_values(builder_match.group(1))
                self._map_cache[name] = unique_preserving_order(values)
                return self._map_cache[name]

        array_body, call_body = self._new_map_body(name)
        if call_body is None:
            raise SystemExit(f"Could not find {name} registry")

        values: list[str] = []
        if array_body is not None:
            values.extend(self._direct_map_keys(array_body))
            for ref in re.findall(r"\.\.\.([A-Z0-9_]+)", array_body):
                values.extend(self.map_values(ref))
        else:
            for ref in re.findall(r"\b([A-Z0-9_]+)\.map\s*\(", call_body):
                values.extend(self.array_values(ref))
            for ref in re.findall(r"\b([A-Z0-9_]+)\.flatMap\s*\(", call_body):
                values.extend(self.source_group_values(ref))

        self._map_cache[name] = unique_preserving_order(values)
        return self._map_cache[name]

    def source_group_values(self, name: str) -> list[str]:
        """Read map references from source-attributed registry descriptors."""

        if name in self._source_group_cache:
            return self._source_group_cache[name]

        assignment_end = self._assignment_end(name)
        if assignment_end is None:
            self._source_group_cache[name] = []
            return []
        array_start = self.source.find("[", assignment_end)
        if array_start < 0:
            self._source_group_cache[name] = []
            return []

        array_body, _array_end = balanced_body(self.source, array_start, "[", "]")
        values: list[str] = []
        values.extend(
            move_name
            for ref in re.findall(r"\bscripts\s*:\s*([A-Z0-9_]+)", array_body)
            for move_name in self.map_values(ref)
        )

        nested_map_pattern = re.compile(
            r"\bscripts\s*:\s*new\s+Map(?:<[^>]+>)?\s*\("
        )
        for match in nested_map_pattern.finditer(array_body):
            call_start = array_body.rfind("(", 0, match.end())
            call_body, _call_end = balanced_body(array_body, call_start, "(", ")")
            nested_array_start = call_body.find("[")
            if nested_array_start < 0:
                continue
            nested_body, _nested_end = balanced_body(
                call_body,
                nested_array_start,
                "[",
                "]",
            )
            values.extend(self._direct_map_keys(nested_body))
            for ref in re.findall(r"\.\.\.([A-Z0-9_]+)", nested_body):
                values.extend(self.map_values(ref))

        self._source_group_cache[name] = unique_preserving_order(values)
        return self._source_group_cache[name]

    def array_values(self, name: str) -> list[str]:
        if name in self._array_cache:
            return self._array_cache[name]

        # The struggle list is generated from capability variants in TypeScript.
        # It is still explicit reviewed coverage, so mirror the app's generated
        # names from the canonical dataset instead of trying to evaluate TS.
        if name == "STRUGGLE_ATTACK_MOVE_NAMES":
            values = [
                move_name
                for move_name in sorted(self.canonical_names)
                if re.match(r"^Struggle(?:$| \()", move_name)
            ]
            self._array_cache[name] = values
            return values

        assignment_end = self._assignment_end(name)
        if assignment_end is None:
            self._array_cache[name] = []
            return []

        array_start = self.source.find("[", assignment_end)
        if array_start < 0:
            self._array_cache[name] = []
            return []

        array_body, _array_end = balanced_body(self.source, array_start, "[", "]")
        values = string_literals(array_body)
        for ref in re.findall(r"\.\.\.([A-Z0-9_]+)", array_body):
            values.extend(self.array_values(ref))

        self._array_cache[name] = unique_preserving_order(values)
        return self._array_cache[name]

    def _assignment_end(self, name: str) -> int | None:
        match = re.search(
            rf"(?:export\s+)?const\s+{re.escape(name)}\b[\s\S]*?=",
            self.source,
        )
        return match.end() if match else None

    def _new_map_body(self, name: str) -> tuple[str | None, str | None]:
        match = re.search(
            rf"(?:export\s+)?const\s+{re.escape(name)}\b[\s\S]*?new\s+Map(?:<[^>]+>)?\s*\(",
            self.source,
        )
        if not match:
            return None, None

        call_start = self.source.rfind("(", 0, match.end())
        call_body, _call_end = balanced_body(self.source, call_start, "(", ")")

        index = match.end()
        while index < len(self.source) and self.source[index].isspace():
            index += 1
        if index < len(self.source) and self.source[index] == "[":
            array_body, _array_end = balanced_body(self.source, index, "[", "]")
            return array_body, call_body

        return None, call_body

    @staticmethod
    def _direct_map_keys(array_body: str) -> list[str]:
        body = strip_ts_comments(array_body)
        return [
            match.group(2)
            for match in re.finditer(
                r"^\s*\[\s*(['\"])((?:\\.|(?!\1).)*?)\1\s*,",
                body,
                flags=re.MULTILINE,
            )
        ]


def balanced_body(text: str, start: int, open_char: str, close_char: str) -> tuple[str, int]:
    if start < 0 or start >= len(text) or text[start] != open_char:
        raise ValueError(f"Expected {open_char!r} at offset {start}")

    depth = 1
    index = start + 1
    quote: str | None = None
    escaped = False
    line_comment = False
    block_comment = False

    while index < len(text):
        char = text[index]
        next_char = text[index + 1] if index + 1 < len(text) else ""

        if line_comment:
            if char == "\n":
                line_comment = False
        elif block_comment:
            if char == "*" and next_char == "/":
                block_comment = False
                index += 1
        elif quote:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == quote:
                quote = None
        else:
            if char == "/" and next_char == "/":
                line_comment = True
                index += 1
            elif char == "/" and next_char == "*":
                block_comment = True
                index += 1
            elif char in {"'", '"', "`"}:
                quote = char
            elif char == open_char:
                depth += 1
            elif char == close_char:
                depth -= 1
                if depth == 0:
                    return text[start + 1:index], index

        index += 1

    raise ValueError(f"Unbalanced {open_char}{close_char} pair")


def strip_ts_comments(text: str) -> str:
    without_block_comments = re.sub(r"/\*[\s\S]*?\*/", "", text)
    return re.sub(r"//.*", "", without_block_comments)


def string_literals(text: str) -> list[str]:
    values: list[str] = []
    for match in re.finditer(
        r"(['\"])((?:\\.|(?!\1).)*?)\1",
        strip_ts_comments(text),
    ):
        try:
            values.append(ast.literal_eval(match.group(0)))
        except (SyntaxError, ValueError):
            values.append(match.group(2).replace(r"\'", "'").replace(r'\"', '"'))
    return values


def unique_preserving_order(values: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        ordered.append(value)
    return ordered


def load_canonical_moves(moves_path: Path = MOVES_PATH) -> list[dict]:
    moves_data = json.loads(moves_path.read_text(encoding="utf-8"))
    return sorted(
        (
            move
            for move in moves_data.values()
            if move.get("type") in VALID_TYPES
        ),
        key=lambda move: move["name"],
    )


def build_coverage(
    moves_path: Path = MOVES_PATH,
    source_dir: Path = MOVE_AUTOMATION_SOURCE_DIR,
) -> MoveCoverage:
    canonical_moves = load_canonical_moves(moves_path)
    canonical_names = {move["name"] for move in canonical_moves}
    reader = TypeScriptRegistryReader(load_registry_source(source_dir), canonical_names)
    explicit_names = set(reader.map_values("EXPLICIT_MOVE_AUTOMATION_SCRIPTS"))
    missing_names = [
        move["name"]
        for move in canonical_moves
        if move["name"] not in explicit_names
    ]
    extra_names = sorted(explicit_names - canonical_names)
    return MoveCoverage(
        canonical_moves=canonical_moves,
        explicit_names=explicit_names,
        missing_names=missing_names,
        extra_names=extra_names,
    )


def print_default_coverage(coverage: MoveCoverage) -> int:
    if coverage.extra_names:
        print("Unknown explicit move script entries:")
        for name in coverage.extra_names:
            print(f"  - {name}")

    if coverage.missing_names:
        print(f"Explicit move automation coverage: {len(coverage.explicit_names)}/{len(coverage.canonical_moves)}")
        print("Missing explicit scripts:")
        for name in coverage.missing_names:
            print(f"  - {name}")
        return 1

    print(f"Explicit move automation coverage: {len(coverage.explicit_names)}/{len(coverage.canonical_moves)}")
    return 0


MANIFEST_SCHEMA_VERSION = 2
CAPABILITY_CATALOG_SCHEMA_VERSION = 1
SCENARIO_REQUIREMENTS_SCHEMA_VERSION = 1
LEGACY_FINGERPRINT_SCHEMA_VERSION = 1
MANIFEST_ROOT_FIELDS = {"schemaVersion", "moves"}
LEGACY_FINGERPRINT_ROOT_FIELDS = {"schemaVersion", "runtimeKind", "entries"}
LEGACY_FINGERPRINT_FIELDS = {"canonicalId", "sourceModule", "version", "definitionHash"}
CAPABILITY_ROOT_FIELDS = {"schemaVersion", "capabilities"}
SCENARIO_REQUIREMENTS_ROOT_FIELDS = {
    "schemaVersion", "evidenceClasses", "requirements",
}
EVIDENCE_CLASS_FIELDS = {"code", "summary"}
SCENARIO_REQUIREMENT_FIELDS = {"tag", "summary", "requiredEvidenceClasses"}
CONFORMANCE_EVIDENCE_FIELDS = {"requirementTags", "scenarios", "notApplicable"}
SCENARIO_EVIDENCE_FIELDS = {"scenarioId", "evidenceClasses"}
NOT_APPLICABLE_EVIDENCE_FIELDS = {"evidenceClass", "reason"}
CAPABILITY_FIELDS = {
    "code", "owningPhase", "dependencies", "implementationStatus",
    "representativeMove",
}
CAPABILITY_PHASES = {
    "phase-0", "phase-1", "phase-2", "phase-3", "phase-4", "phase-5",
    "phase-6", "phase-7", "phase-8", "phase-8b", "phase-9", "phase-10",
}
CAPABILITY_IMPLEMENTATION_STATUSES = {"planned", "implemented"}
CAPABILITY_LIMITS = {"capabilities": 256, "dependencies": 32}
SCENARIO_REQUIREMENT_LIMITS = {
    "evidenceClasses": 64,
    "requirements": 64,
    "requiredEvidenceClasses": 32,
}
MANIFEST_MOVE_FIELDS = {
    "canonicalId", "displayName", "baseStatus", "interactionStatus", "runtime",
    "rulesProvenance", "capabilityTags", "suggestedCapabilityTags", "blockerCodes",
    "limitations", "manualSteps", "scenarioIds", "conformanceEvidence", "reviewedAt",
    "unsupportedInteractionIds", "rolloutCohortId",
}
RUNTIME_FIELDS = {"kind", "version", "definitionHash", "sourceModule"}
PROVENANCE_FIELDS = {"rulesetId", "canonicalizationVersion", "sourceDataSha256"}
DEBT_FIELDS = {"code", "summary"}
BASE_STATUSES = ("complete", "assisted", "blocked")
INTERACTION_STATUSES = ("unassessed", "partial", "complete")
RUNTIME_KINDS = ("unimplemented", "legacy-v1", "movespec-v2")
SHA256_PATTERN = re.compile(r"^[a-f0-9]{64}$")
STABLE_ID_PATTERN = re.compile(r"^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$")
CONTROL_CHARACTER_PATTERN = re.compile(r"[\x00-\x1f\x7f]")
SCENARIO_ID_PATTERN = re.compile(
    r"\bscenarioId\s*:\s*(['\"])([a-z0-9]+(?:[._:/-][a-z0-9]+)*)\1"
)
MANIFEST_LIMITS = {
    "records": 1024,
    "identifierLength": 160,
    "sourceModuleLength": 240,
    "summaryLength": 500,
    "capabilityTags": 64,
    "suggestedCapabilityTags": 64,
    "blockerCodes": 32,
    "limitations": 32,
    "manualSteps": 32,
    "scenarioIds": 64,
    "evidenceRequirementTags": 32,
    "evidenceScenarios": 64,
    "evidenceClassesPerScenario": 32,
    "notApplicableEvidence": 32,
    "unsupportedInteractionIds": 64,
}


class MoveAutomationValidationError(ValueError):
    """A deterministic, actionable semantic coverage validation failure."""

    def __init__(self, code: str, path: str, message: str):
        super().__init__(f"{path}: {message}")
        self.code = code
        self.path = path
        self.detail = message


MISSING_EVIDENCE_REQUIREMENTS_UNASSIGNED = "requirements-unassigned"


@dataclass(frozen=True)
class SemanticStatusProgressGroup:
    status: str
    moves: tuple[str, ...]


@dataclass(frozen=True)
class CapabilityBlockerProgressGroup:
    blocker_code: str
    owning_phase: str
    implementation_status: str
    moves: tuple[str, ...]


@dataclass(frozen=True)
class CohortProgressGroup:
    cohort_id: str | None
    moves: tuple[str, ...]


@dataclass(frozen=True)
class MissingTestEvidenceProgressGroup:
    evidence_code: str
    summary: str
    moves: tuple[str, ...]


@dataclass(frozen=True)
class SemanticProgressReport:
    semantic_status: tuple[SemanticStatusProgressGroup, ...]
    capability_blockers: tuple[CapabilityBlockerProgressGroup, ...]
    cohorts: tuple[CohortProgressGroup, ...]
    missing_test_evidence: tuple[MissingTestEvidenceProgressGroup, ...]

    def as_json(self) -> dict[str, Any]:
        return {
            "basis": "reviewed-semantic-manifest",
            "groups": {
                "capabilityBlocker": [
                    {
                        "blockerCode": group.blocker_code,
                        "count": len(group.moves),
                        "implementationStatus": group.implementation_status,
                        "moves": list(group.moves),
                        "owningPhase": group.owning_phase,
                    }
                    for group in self.capability_blockers
                ],
                "cohort": [
                    {
                        "cohortId": group.cohort_id,
                        "count": len(group.moves),
                        "moves": list(group.moves),
                    }
                    for group in self.cohorts
                ],
                "missingTestEvidence": [
                    {
                        "count": len(group.moves),
                        "evidenceCode": group.evidence_code,
                        "moves": list(group.moves),
                        "summary": group.summary,
                    }
                    for group in self.missing_test_evidence
                ],
                "semanticStatus": [
                    {
                        "count": len(group.moves),
                        "moves": list(group.moves),
                        "status": group.status,
                    }
                    for group in self.semantic_status
                ],
            },
            "heuristicProseClassification": "informational-only",
            "schemaVersion": 1,
        }


@dataclass(frozen=True)
class SemanticCoverageReport:
    ruleset_id: str
    source_data_sha256: str
    canonical_count: int
    manifest_count: int
    base_status_counts: dict[str, int]
    interaction_status_counts: dict[str, int]
    runtime_counts: dict[str, int]
    explicit_registry_count: int
    linked_runtime_count: int
    runtime_definition_hash_count: int
    scenario_reference_count: int
    discovered_scenario_count: int
    progress: SemanticProgressReport
    require_complete: bool
    issues: tuple[MoveAutomationValidationError, ...] = ()

    @property
    def metadata_valid(self) -> bool:
        return not any(issue.code != "completion-required" for issue in self.issues)

    @property
    def complete(self) -> bool:
        return (
            self.manifest_count == self.canonical_count
            and self.base_status_counts.get("complete", 0) == self.canonical_count
            and self.base_status_counts.get("assisted", 0) == 0
            and self.base_status_counts.get("blocked", 0) == 0
        )

    @property
    def valid(self) -> bool:
        return not self.issues

    def as_json(self) -> dict[str, Any]:
        return {
            "baseStatus": {
                status: self.base_status_counts.get(status, 0)
                for status in BASE_STATUSES
            },
            "catalog": {
                "canonicalMoves": self.canonical_count,
                "rulesetId": self.ruleset_id,
                "sourceDataSha256": self.source_data_sha256,
            },
            "complete": self.complete,
            "interactionStatus": {
                status: self.interaction_status_counts.get(status, 0)
                for status in INTERACTION_STATUSES
            },
            "issues": [
                {"code": issue.code, "message": issue.detail, "path": issue.path}
                for issue in self.issues
            ],
            "manifestMoves": self.manifest_count,
            "metadataValid": self.metadata_valid,
            "planning": self.progress.as_json(),
            "references": {
                "discoveredScenarios": self.discovered_scenario_count,
                "linkedRuntimes": self.linked_runtime_count,
                "runtimeDefinitionHashes": self.runtime_definition_hash_count,
                "scenarioReferences": self.scenario_reference_count,
            },
            "registry": {"explicitLegacyScripts": self.explicit_registry_count},
            "requireComplete": self.require_complete,
            "runtime": {
                kind: self.runtime_counts.get(kind, 0)
                for kind in RUNTIME_KINDS
            },
            "valid": self.valid,
        }


def _fail(code: str, path: str, message: str) -> None:
    raise MoveAutomationValidationError(code, path, message)


def _reject_duplicate_json_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    value: dict[str, Any] = {}
    for key, entry in pairs:
        if key in value:
            _fail("invalid-json", key, "duplicate JSON object key.")
        value[key] = entry
    return value


def _load_json(path: Path, label: str) -> Any:
    try:
        return json.loads(
            path.read_text(encoding="utf-8"),
            object_pairs_hook=_reject_duplicate_json_keys,
        )
    except MoveAutomationValidationError:
        raise
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        _fail("invalid-json", label, f"could not load {path}: {error}")


def _record(
    value: Any,
    path: str,
    code: str = "invalid-manifest",
) -> dict[str, Any]:
    if not isinstance(value, dict):
        _fail(code, path, "must be an object.")
    return value


def _exact_fields(
    value: dict[str, Any],
    fields: set[str],
    path: str,
    code: str = "invalid-manifest",
) -> None:
    missing = sorted(fields - set(value))
    unknown = sorted(set(value) - fields)
    if missing or unknown:
        _fail(
            code,
            path,
            "has an invalid shape "
            f"(missing: {', '.join(missing) or 'none'}; "
            f"unknown: {', '.join(unknown) or 'none'}).",
        )


def _bounded_text(
    value: Any,
    path: str,
    maximum: int,
    code: str = "invalid-manifest",
) -> str:
    if (
        not isinstance(value, str)
        or not value
        or value.strip() != value
        or CONTROL_CHARACTER_PATTERN.search(value)
    ):
        _fail(code, path, "must be a non-empty, trimmed, single-line string.")
    if len(value) > maximum:
        _fail("limit-exceeded", path, f"must contain at most {maximum} characters.")
    return value


def _stable_id(
    value: Any,
    path: str,
    code: str = "invalid-manifest",
) -> str:
    identifier = _bounded_text(
        value,
        path,
        MANIFEST_LIMITS["identifierLength"],
        code,
    )
    if not STABLE_ID_PATTERN.fullmatch(identifier):
        _fail(code, path, "must be a lowercase stable identifier.")
    return identifier


def _positive_integer(value: Any, path: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        _fail("invalid-manifest", path, "must be a positive integer.")
    return value


def _sha256(value: Any, path: str) -> str:
    if not isinstance(value, str) or not SHA256_PATTERN.fullmatch(value):
        _fail("invalid-manifest", path, "must be a lowercase SHA-256 digest.")
    return value


def _bounded_array(
    value: Any,
    path: str,
    maximum: int,
    code: str = "invalid-manifest",
) -> list[Any]:
    if not isinstance(value, list):
        _fail(code, path, "must be an array.")
    if len(value) > maximum:
        _fail("limit-exceeded", path, f"must contain at most {maximum} entries.")
    return value


def _stable_id_array(value: Any, path: str, maximum: int) -> list[str]:
    entries = [
        _stable_id(entry, f"{path}[{index}]")
        for index, entry in enumerate(_bounded_array(value, path, maximum))
    ]
    if len(set(entries)) != len(entries):
        _fail("invalid-manifest", path, "must not contain duplicates.")
    return entries


def _unique_text_array(value: Any, path: str, maximum: int = 1024) -> list[str]:
    entries = [
        _bounded_text(entry, f"{path}[{index}]", MANIFEST_LIMITS["summaryLength"])
        for index, entry in enumerate(_bounded_array(value, path, maximum))
    ]
    if len(set(entries)) != len(entries):
        _fail("invalid-manifest", path, "must not contain duplicates.")
    return entries


def _debt_array(value: Any, path: str, maximum: int) -> list[dict[str, str]]:
    debts: list[dict[str, str]] = []
    for index, entry in enumerate(_bounded_array(value, path, maximum)):
        entry_path = f"{path}[{index}]"
        debt = _record(entry, entry_path)
        _exact_fields(debt, DEBT_FIELDS, entry_path)
        debts.append({
            "code": _stable_id(debt["code"], f"{entry_path}.code"),
            "summary": _bounded_text(
                debt["summary"],
                f"{entry_path}.summary",
                MANIFEST_LIMITS["summaryLength"],
            ),
        })
    if len({debt["code"] for debt in debts}) != len(debts):
        _fail("invalid-manifest", f"{path}.code", "must not contain duplicates.")
    return debts


def _parse_ruleset_and_catalog(
    ruleset_path: Path,
    moves_path: Path,
) -> tuple[dict[str, Any], list[dict[str, Any]], str]:
    ruleset = _record(_load_json(ruleset_path, "ruleset"), "ruleset")
    _exact_fields(ruleset, {
        "schemaVersion", "rulesetId", "sourceData", "canonicalization",
        "struggleVariants", "homebrewNamespaces", "verifiedSupplementSources",
        "verifiedErrataSources",
    }, "ruleset")
    if ruleset["schemaVersion"] != 1:
        _fail("invalid-ruleset", "ruleset.schemaVersion", "must be 1.")
    _bounded_text(
        ruleset["rulesetId"],
        "ruleset.rulesetId",
        MANIFEST_LIMITS["identifierLength"],
    )

    source_data = _record(ruleset["sourceData"], "ruleset.sourceData")
    _exact_fields(source_data, {"path", "role", "sha256"}, "ruleset.sourceData")
    _bounded_text(
        source_data["path"],
        "ruleset.sourceData.path",
        MANIFEST_LIMITS["sourceModuleLength"],
    )
    if source_data["role"] != "immediate-rules-data-authority":
        _fail("invalid-ruleset", "ruleset.sourceData.role", "is unsupported.")
    expected_hash = _sha256(source_data["sha256"], "ruleset.sourceData.sha256")
    try:
        source_bytes = moves_path.read_bytes()
    except OSError as error:
        _fail("invalid-catalog", "catalog", f"could not load {moves_path}: {error}")
    actual_hash = hashlib.sha256(source_bytes).hexdigest()
    if actual_hash != expected_hash:
        remediation = _record(
            _load_json(COMPLETE_PLAY_LOOP_REMEDIATION_PATH, "canonicalDataRemediation"),
            "canonicalDataRemediation",
        )
        reviewed_migrations = remediation.get("reviewedMigrations")
        review = next((entry for entry in reviewed_migrations if (
            isinstance(entry, dict) and entry.get("migrationId") == MOVE_CATALOG_SUCCESSOR_MIGRATION_ID
        )), None) if isinstance(reviewed_migrations, list) else None
        facade_successor_is_reviewed = (
            expected_hash == "f90491826349afd7d1f2809fd9d74b7acc555f5163b99264205ee369249e9815"
            and isinstance(review, dict)
            and review.get("beforeFileSha256") == expected_hash
            and review.get("afterFileSha256") == MOVE_CATALOG_SUCCESSOR_SHA256
            and review.get("reviewStatus") == "accepted"
        )
        contest_review = _record(
            _load_json(POKEMON_CONTEST_REVIEW_PATH, "pokemonContestReview"),
            "pokemonContestReview",
        )
        contest_target = next((entry for entry in contest_review.get("targets", []) if (
            isinstance(entry, dict) and entry.get("path") == "data/reference/moves.json"
        )), None)
        contest_successor_is_reviewed = (
            contest_review.get("migrationId") == CONTEST_CATALOG_SUCCESSOR_MIGRATION_ID
            and contest_review.get("status") == "reviewed"
            and isinstance(contest_target, dict)
            and contest_target.get("baseSha256") == MOVE_CATALOG_SUCCESSOR_SHA256
            and contest_target.get("afterSha256") == actual_hash
            and contest_target.get("afterBytes") == len(source_bytes)
        )
        accepted_successor = facade_successor_is_reviewed and (
            (actual_hash == MOVE_CATALOG_SUCCESSOR_SHA256 and review.get("afterBytes") == len(source_bytes))
            or (actual_hash == CONTEST_CATALOG_SUCCESSOR_SHA256 and contest_successor_is_reviewed)
        )
        if not accepted_successor:
            _fail(
                "source-hash-mismatch",
                "catalog",
                f"SHA-256 changed; expected {expected_hash}, received {actual_hash}.",
            )

    canonicalization = _record(ruleset["canonicalization"], "ruleset.canonicalization")
    _exact_fields(canonicalization, {
        "version", "identity", "ordering", "expectedMoveCount", "includedTypes",
        "excludedParserJunk",
    }, "ruleset.canonicalization")
    if canonicalization["version"] != 1:
        _fail("invalid-ruleset", "ruleset.canonicalization.version", "must be 1.")
    if canonicalization["identity"] != "source-key":
        _fail("invalid-ruleset", "ruleset.canonicalization.identity", "must be source-key.")
    if canonicalization["ordering"] != "canonical-id-code-point":
        _fail(
            "invalid-ruleset",
            "ruleset.canonicalization.ordering",
            "must be canonical-id-code-point.",
        )
    expected_count = _positive_integer(
        canonicalization["expectedMoveCount"],
        "ruleset.canonicalization.expectedMoveCount",
    )
    included_types = _unique_text_array(
        canonicalization["includedTypes"],
        "ruleset.canonicalization.includedTypes",
    )
    if included_types != list(VALID_TYPE_ORDER):
        _fail(
            "invalid-ruleset",
            "ruleset.canonicalization.includedTypes",
            "must contain the canonical move types in canonical order.",
        )

    excluded_policy = _record(
        canonicalization["excludedParserJunk"],
        "ruleset.canonicalization.excludedParserJunk",
    )
    _exact_fields(
        excluded_policy,
        {"policy", "expectedSourceKeys"},
        "ruleset.canonicalization.excludedParserJunk",
    )
    if excluded_policy["policy"] != "exclude-records-with-noncanonical-types":
        _fail(
            "invalid-ruleset",
            "ruleset.canonicalization.excludedParserJunk.policy",
            "is unsupported.",
        )
    expected_excluded_junk = _unique_text_array(
        excluded_policy["expectedSourceKeys"],
        "ruleset.canonicalization.excludedParserJunk.expectedSourceKeys",
    )

    struggle_policy = _record(ruleset["struggleVariants"], "ruleset.struggleVariants")
    _exact_fields(
        struggle_policy,
        {"policy", "canonicalSourceKeys"},
        "ruleset.struggleVariants",
    )
    if struggle_policy["policy"] != "distinct-canonical-records":
        _fail("invalid-ruleset", "ruleset.struggleVariants.policy", "is unsupported.")
    expected_struggle_ids = _unique_text_array(
        struggle_policy["canonicalSourceKeys"],
        "ruleset.struggleVariants.canonicalSourceKeys",
    )

    homebrew_policy = _record(ruleset["homebrewNamespaces"], "ruleset.homebrewNamespaces")
    _exact_fields(
        homebrew_policy,
        {"policy", "canonicalNamespace", "homebrewPrefix", "includeInCanonicalCatalog"},
        "ruleset.homebrewNamespaces",
    )
    if (
        homebrew_policy["policy"] != "separate-explicit-namespace"
        or homebrew_policy["canonicalNamespace"] != "canonical"
        or homebrew_policy["includeInCanonicalCatalog"] is not False
    ):
        _fail("invalid-ruleset", "ruleset.homebrewNamespaces", "is unsupported.")
    homebrew_prefix = _bounded_text(
        homebrew_policy["homebrewPrefix"],
        "ruleset.homebrewNamespaces.homebrewPrefix",
        MANIFEST_LIMITS["identifierLength"],
    )

    for collection_name in ("verifiedSupplementSources", "verifiedErrataSources"):
        collection_path = f"ruleset.{collection_name}"
        source_reference_ids: set[str] = set()
        for index, reference_value in enumerate(
            _bounded_array(ruleset[collection_name], collection_path, 1024)
        ):
            reference_path = f"{collection_path}[{index}]"
            reference = _record(reference_value, reference_path)
            _exact_fields(
                reference,
                {"id", "citation", "verifiedAt", "sourceDataSha256"},
                reference_path,
            )
            reference_id = _bounded_text(
                reference["id"],
                f"{reference_path}.id",
                MANIFEST_LIMITS["identifierLength"],
            )
            if reference_id in source_reference_ids:
                _fail("invalid-ruleset", f"{reference_path}.id", "must be unique.")
            source_reference_ids.add(reference_id)
            _bounded_text(
                reference["citation"],
                f"{reference_path}.citation",
                MANIFEST_LIMITS["summaryLength"],
            )
            verified_at = reference["verifiedAt"]
            if not isinstance(verified_at, str):
                _fail("invalid-ruleset", f"{reference_path}.verifiedAt", "must be an ISO date.")
            try:
                if date.fromisoformat(verified_at).isoformat() != verified_at:
                    raise ValueError
            except ValueError:
                _fail("invalid-ruleset", f"{reference_path}.verifiedAt", "must be a real ISO date.")
            _sha256(
                reference["sourceDataSha256"],
                f"{reference_path}.sourceDataSha256",
            )

    source = _load_json(moves_path, "catalog")
    if not isinstance(source, dict):
        _fail("invalid-catalog", "catalog", "must be an object keyed by canonical move ID.")
    canonical_moves: list[dict[str, Any]] = []
    excluded_junk: list[str] = []
    struggle_ids: list[str] = []
    for canonical_id, move_value in source.items():
        move_path = f"catalog[{canonical_id!r}]"
        if not canonical_id or canonical_id.strip() != canonical_id:
            _fail("invalid-catalog", move_path, "source keys must be non-empty and trimmed.")
        move = _record(move_value, move_path)
        if move.get("name") != canonical_id:
            _fail("invalid-catalog", f"{move_path}.name", "must match its source key.")
        if canonical_id.startswith(homebrew_prefix):
            continue
        if move.get("type") not in VALID_TYPES:
            excluded_junk.append(canonical_id)
            continue
        canonical_moves.append(move)
        if re.match(r"^Struggle(?:$| \()", canonical_id):
            struggle_ids.append(canonical_id)

    if sorted(excluded_junk) != sorted(expected_excluded_junk):
        _fail(
            "parser-junk-policy-mismatch",
            "catalog",
            "excluded parser-junk identities changed.",
        )
    if sorted(struggle_ids) != sorted(expected_struggle_ids):
        _fail("struggle-policy-mismatch", "catalog", "canonical Struggle identities changed.")
    if len(canonical_moves) != expected_count:
        _fail(
            "canonical-count-mismatch",
            "catalog",
            f"expected {expected_count} canonical moves, received {len(canonical_moves)}.",
        )
    canonical_moves.sort(key=lambda move: move["name"])
    # Manifest provenance remains bound to the reviewed baseline. Exact
    # reviewed successors above normalize Facade and add Contest-only identity
    # evidence without changing Move automation semantics.
    return ruleset, canonical_moves, expected_hash


def _parse_capability_catalog(
    capability_path: Path,
    canonical_moves: list[dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    validation_code = "invalid-capability-catalog"
    root = _record(
        _load_json(capability_path, "capabilityCatalog"),
        "capabilityCatalog",
        validation_code,
    )
    _exact_fields(
        root,
        CAPABILITY_ROOT_FIELDS,
        "capabilityCatalog",
        validation_code,
    )
    if root["schemaVersion"] != CAPABILITY_CATALOG_SCHEMA_VERSION:
        _fail(
            validation_code,
            "capabilityCatalog.schemaVersion",
            f"must be {CAPABILITY_CATALOG_SCHEMA_VERSION}.",
        )

    canonical_ids = {move["name"] for move in canonical_moves}
    capabilities: list[dict[str, Any]] = []
    for index, capability_value in enumerate(_bounded_array(
        root["capabilities"],
        "capabilityCatalog.capabilities",
        CAPABILITY_LIMITS["capabilities"],
        validation_code,
    )):
        path = f"capabilities[{index}]"
        capability = _record(capability_value, path, validation_code)
        _exact_fields(capability, CAPABILITY_FIELDS, path, validation_code)
        code = _stable_id(capability["code"], f"{path}.code", validation_code)
        owning_phase = capability["owningPhase"]
        if owning_phase not in CAPABILITY_PHASES:
            _fail(validation_code, f"{path}.owningPhase", "must be a supported owning phase.")
        dependencies = [
            _stable_id(dependency, f"{path}.dependencies[{dependency_index}]", validation_code)
            for dependency_index, dependency in enumerate(_bounded_array(
                capability["dependencies"],
                f"{path}.dependencies",
                CAPABILITY_LIMITS["dependencies"],
                validation_code,
            ))
        ]
        if len(set(dependencies)) != len(dependencies):
            _fail(validation_code, f"{path}.dependencies", "must not contain duplicates.")
        implementation_status = capability["implementationStatus"]
        if implementation_status not in CAPABILITY_IMPLEMENTATION_STATUSES:
            _fail(
                validation_code,
                f"{path}.implementationStatus",
                "must be planned or implemented.",
            )
        representative_move = _bounded_text(
            capability["representativeMove"],
            f"{path}.representativeMove",
            MANIFEST_LIMITS["identifierLength"],
            validation_code,
        )
        if representative_move not in canonical_ids:
            _fail(
                "unknown-representative-move",
                f"{path}.representativeMove",
                f"{representative_move} is not canonical.",
            )
        capabilities.append({
            "code": code,
            "owningPhase": owning_phase,
            "dependencies": dependencies,
            "implementationStatus": implementation_status,
            "representativeMove": representative_move,
        })

    codes = [capability["code"] for capability in capabilities]
    if len(set(codes)) != len(codes):
        _fail(
            "duplicate-capability",
            "capabilityCatalog.capabilities",
            "must contain at most one definition per capability code.",
        )
    capability_by_code = {capability["code"]: capability for capability in capabilities}
    capability_index_by_code = {code: index for index, code in enumerate(codes)}
    for capability_index, capability in enumerate(capabilities):
        for dependency_index, dependency in enumerate(capability["dependencies"]):
            if dependency not in capability_by_code:
                _fail(
                    "unknown-capability-dependency",
                    f"capabilities[{capability_index}].dependencies[{dependency_index}]",
                    f"{dependency} does not resolve to a capability.",
                )

    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(code: str) -> None:
        if code in visited:
            return
        visiting.add(code)
        capability = capability_by_code[code]
        capability_index = capability_index_by_code[code]
        for dependency_index, dependency in enumerate(capability["dependencies"]):
            if dependency in visiting:
                _fail(
                    "capability-dependency-cycle",
                    f"capabilities[{capability_index}].dependencies[{dependency_index}]",
                    f"{code} introduces a dependency cycle through {dependency}.",
                )
            visit(dependency)
        visiting.remove(code)
        visited.add(code)

    for code in codes:
        visit(code)
    return capability_by_code


def _parse_scenario_requirements(
    requirements_path: Path,
) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
    validation_code = "invalid-scenario-requirements"
    root = _record(
        _load_json(requirements_path, "scenarioRequirements"),
        "scenarioRequirements",
        validation_code,
    )
    _exact_fields(
        root,
        SCENARIO_REQUIREMENTS_ROOT_FIELDS,
        "scenarioRequirements",
        validation_code,
    )
    if root["schemaVersion"] != SCENARIO_REQUIREMENTS_SCHEMA_VERSION:
        _fail(
            validation_code,
            "scenarioRequirements.schemaVersion",
            f"must be {SCENARIO_REQUIREMENTS_SCHEMA_VERSION}.",
        )

    evidence_classes: list[dict[str, str]] = []
    for index, value in enumerate(_bounded_array(
        root["evidenceClasses"],
        "scenarioRequirements.evidenceClasses",
        SCENARIO_REQUIREMENT_LIMITS["evidenceClasses"],
        validation_code,
    )):
        path = f"scenarioRequirements.evidenceClasses[{index}]"
        entry = _record(value, path, validation_code)
        _exact_fields(entry, EVIDENCE_CLASS_FIELDS, path, validation_code)
        evidence_classes.append({
            "code": _stable_id(entry["code"], f"{path}.code", validation_code),
            "summary": _bounded_text(
                entry["summary"],
                f"{path}.summary",
                MANIFEST_LIMITS["summaryLength"],
                validation_code,
            ),
        })
    evidence_codes = [entry["code"] for entry in evidence_classes]
    if len(set(evidence_codes)) != len(evidence_codes):
        _fail(
            "duplicate-evidence-class",
            "scenarioRequirements.evidenceClasses",
            "must contain at most one definition per evidence class.",
        )
    evidence_by_code = {entry["code"]: entry for entry in evidence_classes}

    requirements: list[dict[str, Any]] = []
    for index, value in enumerate(_bounded_array(
        root["requirements"],
        "scenarioRequirements.requirements",
        SCENARIO_REQUIREMENT_LIMITS["requirements"],
        validation_code,
    )):
        path = f"scenarioRequirements.requirements[{index}]"
        entry = _record(value, path, validation_code)
        _exact_fields(entry, SCENARIO_REQUIREMENT_FIELDS, path, validation_code)
        required_classes = [
            _stable_id(
                evidence_class,
                f"{path}.requiredEvidenceClasses[{evidence_index}]",
                validation_code,
            )
            for evidence_index, evidence_class in enumerate(_bounded_array(
                entry["requiredEvidenceClasses"],
                f"{path}.requiredEvidenceClasses",
                SCENARIO_REQUIREMENT_LIMITS["requiredEvidenceClasses"],
                validation_code,
            ))
        ]
        if not required_classes:
            _fail(
                validation_code,
                f"{path}.requiredEvidenceClasses",
                "must identify at least one evidence class.",
            )
        if len(set(required_classes)) != len(required_classes):
            _fail(
                validation_code,
                f"{path}.requiredEvidenceClasses",
                "must not contain duplicates.",
            )
        for evidence_index, evidence_class in enumerate(required_classes):
            if evidence_class not in evidence_by_code:
                _fail(
                    "unknown-evidence-class",
                    f"{path}.requiredEvidenceClasses[{evidence_index}]",
                    f"{evidence_class} does not resolve to an evidence class.",
                )
        requirements.append({
            "tag": _stable_id(entry["tag"], f"{path}.tag", validation_code),
            "summary": _bounded_text(
                entry["summary"],
                f"{path}.summary",
                MANIFEST_LIMITS["summaryLength"],
                validation_code,
            ),
            "requiredEvidenceClasses": required_classes,
        })

    requirement_tags = [entry["tag"] for entry in requirements]
    if len(set(requirement_tags)) != len(requirement_tags):
        _fail(
            "duplicate-requirement-tag",
            "scenarioRequirements.requirements",
            "must contain at most one mapping per requirement tag.",
        )
    requirement_by_tag = {entry["tag"]: entry for entry in requirements}
    used_evidence_classes = {
        evidence_class
        for requirement in requirements
        for evidence_class in requirement["requiredEvidenceClasses"]
    }
    for index, evidence_class in enumerate(evidence_classes):
        if evidence_class["code"] not in used_evidence_classes:
            _fail(
                "unused-evidence-class",
                f"scenarioRequirements.evidenceClasses[{index}].code",
                f"{evidence_class['code']} is not required by any mechanic or branch tag.",
            )
    return evidence_by_code, requirement_by_tag


def _discover_scenario_ids(scenario_root: Path) -> set[str]:
    if not scenario_root.exists():
        return set()
    scenario_ids: set[str] = set()
    for path in sorted(scenario_root.rglob("*")):
        if not path.is_file() or path.suffix not in {".ts", ".tsx", ".js", ".mjs", ".json"}:
            continue
        try:
            source = path.read_text(encoding="utf-8")
        except (OSError, UnicodeError) as error:
            _fail("invalid-scenario", str(path), f"could not read scenario fixture: {error}")
        for match in SCENARIO_ID_PATTERN.finditer(source):
            scenario_id = match.group(2)
            if scenario_id in scenario_ids:
                _fail("duplicate-scenario", scenario_id, "is declared by more than one fixture.")
            scenario_ids.add(scenario_id)
    return scenario_ids


def _validate_source_module(source_module: str, path: str) -> None:
    module_path = Path(source_module)
    if module_path.is_absolute() or ".." in module_path.parts:
        _fail("invalid-runtime-reference", path, "must be a repository-relative path.")
    resolved = (ROOT / module_path).resolve()
    try:
        resolved.relative_to(ROOT.resolve())
    except ValueError:
        _fail("invalid-runtime-reference", path, "must stay inside the repository.")
    if not resolved.is_file():
        _fail("missing-runtime-reference", path, f"does not resolve to a file: {source_module}.")


def _parse_legacy_fingerprints(
    fingerprint_path: Path,
    canonical_moves: list[dict[str, Any]],
    explicit_names: set[str],
) -> dict[str, dict[str, Any]]:
    validation_code = "invalid-legacy-fingerprint-index"
    root = _record(
        _load_json(fingerprint_path, "legacyFingerprints"),
        "legacyFingerprints",
        validation_code,
    )
    _exact_fields(
        root,
        LEGACY_FINGERPRINT_ROOT_FIELDS,
        "legacyFingerprints",
        validation_code,
    )
    if root["schemaVersion"] != LEGACY_FINGERPRINT_SCHEMA_VERSION:
        _fail(
            validation_code,
            "legacyFingerprints.schemaVersion",
            f"must be {LEGACY_FINGERPRINT_SCHEMA_VERSION}.",
        )
    if root["runtimeKind"] != "legacy-v1":
        _fail(validation_code, "legacyFingerprints.runtimeKind", "must be legacy-v1.")

    canonical_ids = {move["name"] for move in canonical_moves}
    entries: list[dict[str, Any]] = []
    for index, entry_value in enumerate(_bounded_array(
        root["entries"],
        "legacyFingerprints.entries",
        len(canonical_moves),
        validation_code,
    )):
        path = f"legacyFingerprints.entries[{index}]"
        entry = _record(entry_value, path, validation_code)
        _exact_fields(entry, LEGACY_FINGERPRINT_FIELDS, path, validation_code)
        canonical_id = _bounded_text(
            entry["canonicalId"],
            f"{path}.canonicalId",
            MANIFEST_LIMITS["identifierLength"],
            validation_code,
        )
        if canonical_id not in canonical_ids:
            _fail("unknown-move", f"{path}.canonicalId", f"{canonical_id} is not canonical.")
        source_module = _bounded_text(
            entry["sourceModule"],
            f"{path}.sourceModule",
            MANIFEST_LIMITS["sourceModuleLength"],
            validation_code,
        )
        _validate_source_module(source_module, f"{path}.sourceModule")
        entries.append({
            "canonicalId": canonical_id,
            "sourceModule": source_module,
            "version": _positive_integer(entry["version"], f"{path}.version"),
            "definitionHash": _sha256(entry["definitionHash"], f"{path}.definitionHash"),
        })

    entry_ids = [entry["canonicalId"] for entry in entries]
    if len(set(entry_ids)) != len(entry_ids):
        _fail("duplicate-legacy-fingerprint", "legacyFingerprints.entries", "contains a duplicate canonical move.")
    expected_ids = sorted(explicit_names)
    if entry_ids != expected_ids:
        missing = sorted(explicit_names - set(entry_ids))
        extra = sorted(set(entry_ids) - explicit_names)
        _fail(
            "legacy-fingerprint-membership-mismatch",
            "legacyFingerprints.entries",
            "must contain every explicit v1 registry entry exactly once in canonical order "
            f"(missing: {', '.join(missing) or 'none'}; extra: {', '.join(extra) or 'none'}).",
        )
    return {entry["canonicalId"]: entry for entry in entries}


def _parse_conformance_evidence(
    value: Any,
    path: str,
    listed_scenario_ids: list[str],
    base_status: str,
    reviewed_at: str | None,
    evidence_by_code: dict[str, dict[str, Any]],
    requirement_by_tag: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    evidence = _record(value, path)
    _exact_fields(evidence, CONFORMANCE_EVIDENCE_FIELDS, path)

    requirement_tags = _stable_id_array(
        evidence["requirementTags"],
        f"{path}.requirementTags",
        MANIFEST_LIMITS["evidenceRequirementTags"],
    )
    for index, requirement_tag in enumerate(requirement_tags):
        if requirement_tag not in requirement_by_tag:
            _fail(
                "unknown-evidence-requirement",
                f"{path}.requirementTags[{index}]",
                f"{requirement_tag} does not resolve to a scenario requirement.",
            )

    scenarios: list[dict[str, Any]] = []
    for index, value in enumerate(_bounded_array(
        evidence["scenarios"],
        f"{path}.scenarios",
        MANIFEST_LIMITS["evidenceScenarios"],
    )):
        scenario_path = f"{path}.scenarios[{index}]"
        scenario = _record(value, scenario_path)
        _exact_fields(scenario, SCENARIO_EVIDENCE_FIELDS, scenario_path)
        evidence_classes = _stable_id_array(
            scenario["evidenceClasses"],
            f"{scenario_path}.evidenceClasses",
            MANIFEST_LIMITS["evidenceClassesPerScenario"],
        )
        if not evidence_classes:
            _fail(
                "invalid-conformance-evidence",
                f"{scenario_path}.evidenceClasses",
                "must identify at least one evidence class.",
            )
        for evidence_index, evidence_class in enumerate(evidence_classes):
            if evidence_class not in evidence_by_code:
                _fail(
                    "unknown-evidence-class",
                    f"{scenario_path}.evidenceClasses[{evidence_index}]",
                    f"{evidence_class} does not resolve to an evidence class.",
                )
        scenarios.append({
            "scenarioId": _stable_id(
                scenario["scenarioId"],
                f"{scenario_path}.scenarioId",
            ),
            "evidenceClasses": evidence_classes,
        })
    mapped_scenario_ids = [scenario["scenarioId"] for scenario in scenarios]
    if len(set(mapped_scenario_ids)) != len(mapped_scenario_ids):
        _fail(
            "invalid-conformance-evidence",
            f"{path}.scenarios",
            "must contain at most one evidence mapping per scenario ID.",
        )

    not_applicable: list[dict[str, str]] = []
    for index, value in enumerate(_bounded_array(
        evidence["notApplicable"],
        f"{path}.notApplicable",
        MANIFEST_LIMITS["notApplicableEvidence"],
    )):
        exception_path = f"{path}.notApplicable[{index}]"
        exception = _record(value, exception_path)
        _exact_fields(exception, NOT_APPLICABLE_EVIDENCE_FIELDS, exception_path)
        evidence_class = _stable_id(
            exception["evidenceClass"],
            f"{exception_path}.evidenceClass",
        )
        if evidence_class not in evidence_by_code:
            _fail(
                "unknown-evidence-class",
                f"{exception_path}.evidenceClass",
                f"{evidence_class} does not resolve to an evidence class.",
            )
        not_applicable.append({
            "evidenceClass": evidence_class,
            "reason": _bounded_text(
                exception["reason"],
                f"{exception_path}.reason",
                MANIFEST_LIMITS["summaryLength"],
            ),
        })
    not_applicable_classes = [entry["evidenceClass"] for entry in not_applicable]
    if len(set(not_applicable_classes)) != len(not_applicable_classes):
        _fail(
            "invalid-conformance-evidence",
            f"{path}.notApplicable",
            "must contain at most one reason per evidence class.",
        )

    required_classes = {
        evidence_class
        for requirement_tag in requirement_tags
        for evidence_class in requirement_by_tag[requirement_tag]["requiredEvidenceClasses"]
    }
    covered_classes = {
        evidence_class
        for scenario in scenarios
        for evidence_class in scenario["evidenceClasses"]
    }
    not_applicable_class_set = set(not_applicable_classes)
    listed_scenario_id_set = set(listed_scenario_ids)
    for index, scenario in enumerate(scenarios):
        if scenario["scenarioId"] not in listed_scenario_id_set:
            _fail(
                "invalid-conformance-evidence",
                f"{path}.scenarios[{index}].scenarioId",
                f"{scenario['scenarioId']} is not listed by the row's scenarioIds.",
            )
    for evidence_class in sorted(covered_classes):
        if evidence_class not in required_classes:
            _fail(
                "invalid-conformance-evidence",
                f"{path}.scenarios",
                f"{evidence_class} is not required by the row's requirement tags.",
            )
        if evidence_class in not_applicable_class_set:
            _fail(
                "invalid-conformance-evidence",
                path,
                f"{evidence_class} cannot be both scenario-covered and not applicable.",
            )
    for evidence_class in sorted(not_applicable_class_set):
        if evidence_class not in required_classes:
            _fail(
                "invalid-conformance-evidence",
                f"{path}.notApplicable",
                f"{evidence_class} is not required by the row's requirement tags.",
            )
    if not_applicable and reviewed_at is None:
        _fail(
            "invalid-conformance-evidence",
            f"{path}.notApplicable",
            "not-applicable reasons require reviewedAt metadata.",
        )

    if base_status == "complete":
        if not requirement_tags:
            _fail(
                "missing-conformance-evidence",
                f"{path}.requirementTags",
                "complete automation requires at least one reviewed mechanic or branch tag.",
            )
        unmapped_scenarios = [
            scenario_id
            for scenario_id in listed_scenario_ids
            if scenario_id not in set(mapped_scenario_ids)
        ]
        if unmapped_scenarios:
            _fail(
                "missing-conformance-evidence",
                f"{path}.scenarios",
                "complete automation must classify scenario evidence: "
                + ", ".join(unmapped_scenarios)
                + ".",
            )
        missing_classes = sorted(
            required_classes - covered_classes - not_applicable_class_set
        )
        if missing_classes:
            _fail(
                "missing-conformance-evidence",
                path,
                "complete automation is missing required evidence: "
                + ", ".join(missing_classes)
                + ".",
            )

    return {
        "requirementTags": requirement_tags,
        "scenarios": scenarios,
        "notApplicable": not_applicable,
    }


def _parse_manifest(
    manifest_path: Path,
    ruleset: dict[str, Any],
    canonical_moves: list[dict[str, Any]],
    source_hash: str,
    explicit_names: set[str],
    legacy_fingerprints: dict[str, dict[str, Any]],
    scenario_ids: set[str],
    capability_by_code: dict[str, dict[str, Any]],
    evidence_by_code: dict[str, dict[str, Any]],
    requirement_by_tag: dict[str, dict[str, Any]],
) -> tuple[list[dict[str, Any]], int, int]:
    manifest = _record(_load_json(manifest_path, "manifest"), "manifest")
    _exact_fields(manifest, MANIFEST_ROOT_FIELDS, "manifest")
    if manifest["schemaVersion"] != MANIFEST_SCHEMA_VERSION:
        _fail(
            "invalid-manifest",
            "manifest.schemaVersion",
            f"must be {MANIFEST_SCHEMA_VERSION}.",
        )
    rows_input = _bounded_array(
        manifest["moves"],
        "manifest.moves",
        min(MANIFEST_LIMITS["records"], len(canonical_moves)),
    )
    canonical_by_id = {move["name"]: move for move in canonical_moves}
    rows: list[dict[str, Any]] = []
    linked_runtime_count = 0
    scenario_reference_count = 0

    for index, row_value in enumerate(rows_input):
        path = f"manifest.moves[{index}]"
        row = _record(row_value, path)
        _exact_fields(row, MANIFEST_MOVE_FIELDS, path)
        canonical_id = _bounded_text(
            row["canonicalId"],
            f"{path}.canonicalId",
            MANIFEST_LIMITS["identifierLength"],
        )
        canonical_move = canonical_by_id.get(canonical_id)
        if canonical_move is None:
            _fail("unknown-move", f"{path}.canonicalId", f"{canonical_id} is not canonical.")
        display_name = _bounded_text(
            row["displayName"],
            f"{path}.displayName",
            MANIFEST_LIMITS["identifierLength"],
        )
        if display_name != canonical_move["name"]:
            _fail("unknown-move", f"{path}.displayName", "must match the canonical name.")

        base_status = row["baseStatus"]
        if base_status not in BASE_STATUSES:
            _fail("invalid-manifest", f"{path}.baseStatus", "has an unsupported status.")
        interaction_status = row["interactionStatus"]
        if interaction_status not in INTERACTION_STATUSES:
            _fail("invalid-manifest", f"{path}.interactionStatus", "has an unsupported status.")

        runtime = _record(row["runtime"], f"{path}.runtime")
        _exact_fields(runtime, RUNTIME_FIELDS, f"{path}.runtime")
        runtime_kind = runtime["kind"]
        if runtime_kind not in RUNTIME_KINDS:
            _fail("invalid-manifest", f"{path}.runtime.kind", "has an unsupported kind.")
        version = runtime["version"]
        if version is not None:
            _positive_integer(version, f"{path}.runtime.version")
        definition_hash = runtime["definitionHash"]
        if definition_hash is not None:
            _sha256(definition_hash, f"{path}.runtime.definitionHash")
        source_module = runtime["sourceModule"]
        if source_module is not None:
            source_module = _bounded_text(
                source_module,
                f"{path}.runtime.sourceModule",
                MANIFEST_LIMITS["sourceModuleLength"],
            )
        linked_fields = (version, definition_hash, source_module)
        if runtime_kind == "unimplemented" and any(value is not None for value in linked_fields):
            _fail(
                "invalid-status-combination",
                f"{path}.runtime",
                "unimplemented runtimes cannot contain linked implementation metadata.",
            )
        if runtime_kind != "unimplemented" and not all(
            value is not None for value in linked_fields
        ):
            _fail(
                "missing-runtime-reference",
                f"{path}.runtime",
                "implemented runtimes require a version, definitionHash, and sourceModule.",
            )
        if source_module is not None:
            _validate_source_module(source_module, f"{path}.runtime.sourceModule")
            linked_runtime_count += 1
        if runtime_kind == "legacy-v1" and canonical_id not in explicit_names:
            _fail(
                "missing-registry-reference",
                f"{path}.runtime.kind",
                "legacy-v1 does not resolve in EXPLICIT_MOVE_AUTOMATION_SCRIPTS.",
            )
        if runtime_kind == "legacy-v1" and canonical_id in explicit_names:
            expected_runtime = legacy_fingerprints.get(canonical_id)
            actual_runtime = {
                "canonicalId": canonical_id,
                "sourceModule": source_module,
                "version": version,
                "definitionHash": definition_hash,
            }
            if expected_runtime != actual_runtime:
                _fail(
                    "legacy-runtime-fingerprint-drift",
                    f"{path}.runtime",
                    "must match the linked explicit v1 source, version, and definition hash.",
                )
        if runtime_kind == "movespec-v2" and not all(
            value is not None for value in linked_fields
        ):
            _fail(
                "missing-runtime-reference",
                f"{path}.runtime",
                "movespec-v2 requires a versioned, fingerprinted source reference.",
            )
        if runtime_kind == "unimplemented" and canonical_id in explicit_names:
            _fail(
                "registry-manifest-mismatch",
                f"{path}.runtime.kind",
                "an explicit v1 registry entry cannot be marked unimplemented.",
            )

        provenance = _record(row["rulesProvenance"], f"{path}.rulesProvenance")
        _exact_fields(provenance, PROVENANCE_FIELDS, f"{path}.rulesProvenance")
        provenance_hash = _sha256(
            provenance["sourceDataSha256"],
            f"{path}.rulesProvenance.sourceDataSha256",
        )
        if (
            provenance["rulesetId"] != ruleset["rulesetId"]
            or provenance["canonicalizationVersion"]
            != ruleset["canonicalization"]["version"]
            or provenance_hash != source_hash
        ):
            _fail(
                "provenance-mismatch",
                f"{path}.rulesProvenance",
                "must reference the loaded canonical catalog exactly.",
            )

        capability_tags = _stable_id_array(
            row["capabilityTags"],
            f"{path}.capabilityTags",
            MANIFEST_LIMITS["capabilityTags"],
        )
        for capability_index, capability_code in enumerate(capability_tags):
            if capability_code not in capability_by_code:
                _fail(
                    "unknown-capability",
                    f"{path}.capabilityTags[{capability_index}]",
                    f"{capability_code} does not resolve to the capability catalog.",
                )
        suggested_tags = _stable_id_array(
            row["suggestedCapabilityTags"],
            f"{path}.suggestedCapabilityTags",
            MANIFEST_LIMITS["suggestedCapabilityTags"],
        )
        blocker_codes = _stable_id_array(
            row["blockerCodes"],
            f"{path}.blockerCodes",
            MANIFEST_LIMITS["blockerCodes"],
        )
        for blocker_index, blocker_code in enumerate(blocker_codes):
            if blocker_code not in capability_by_code:
                _fail(
                    "unknown-capability",
                    f"{path}.blockerCodes[{blocker_index}]",
                    f"{blocker_code} does not resolve to the capability catalog.",
                )
        limitations = _debt_array(
            row["limitations"],
            f"{path}.limitations",
            MANIFEST_LIMITS["limitations"],
        )
        manual_steps = _debt_array(
            row["manualSteps"],
            f"{path}.manualSteps",
            MANIFEST_LIMITS["manualSteps"],
        )
        referenced_scenarios = _stable_id_array(
            row["scenarioIds"],
            f"{path}.scenarioIds",
            MANIFEST_LIMITS["scenarioIds"],
        )
        scenario_reference_count += len(referenced_scenarios)
        for scenario_id in referenced_scenarios:
            if scenario_id not in scenario_ids:
                _fail(
                    "missing-scenario-reference",
                    f"{path}.scenarioIds",
                    f"does not resolve scenario {scenario_id!r} under {SCENARIO_ROOT.relative_to(ROOT)}.",
                )

        reviewed_at = row["reviewedAt"]
        if reviewed_at is not None:
            if not isinstance(reviewed_at, str):
                _fail("invalid-manifest", f"{path}.reviewedAt", "must be an ISO date or null.")
            try:
                if date.fromisoformat(reviewed_at).isoformat() != reviewed_at:
                    raise ValueError
            except ValueError:
                _fail("invalid-manifest", f"{path}.reviewedAt", "must be a real ISO date.")
        conformance_evidence = _parse_conformance_evidence(
            row["conformanceEvidence"],
            f"{path}.conformanceEvidence",
            referenced_scenarios,
            base_status,
            reviewed_at,
            evidence_by_code,
            requirement_by_tag,
        )
        unsupported_interactions = _stable_id_array(
            row["unsupportedInteractionIds"],
            f"{path}.unsupportedInteractionIds",
            MANIFEST_LIMITS["unsupportedInteractionIds"],
        )
        rollout_cohort = row["rolloutCohortId"]
        if rollout_cohort is not None:
            _stable_id(rollout_cohort, f"{path}.rolloutCohortId")

        has_debt = bool(blocker_codes or limitations or manual_steps)
        if base_status == "complete":
            if has_debt:
                _fail(
                    "invalid-status-combination",
                    path,
                    "complete automation cannot contain blockers, limitations, or manual steps.",
                )
            if not referenced_scenarios:
                _fail(
                    "invalid-status-combination",
                    f"{path}.scenarioIds",
                    "complete automation requires scenario evidence.",
                )
            if runtime_kind == "unimplemented" or not all(
                value is not None for value in linked_fields
            ):
                _fail(
                    "invalid-status-combination",
                    f"{path}.runtime",
                    "complete automation requires a linked, versioned, fingerprinted runtime.",
                )
        elif base_status == "assisted":
            if runtime_kind == "unimplemented":
                _fail(
                    "invalid-status-combination",
                    f"{path}.runtime",
                    "assisted automation requires an implementation.",
                )
            if not has_debt:
                _fail(
                    "invalid-status-combination",
                    path,
                    "assisted automation must identify semantic debt.",
                )
        elif not blocker_codes:
            _fail(
                "invalid-status-combination",
                f"{path}.blockerCodes",
                "blocked automation requires a blocker code.",
            )

        if interaction_status == "partial" and not unsupported_interactions:
            _fail(
                "invalid-status-combination",
                f"{path}.unsupportedInteractionIds",
                "partial interaction coverage requires an explicit exclusion.",
            )
        if interaction_status != "partial" and unsupported_interactions:
            _fail(
                "invalid-status-combination",
                f"{path}.unsupportedInteractionIds",
                "interaction exclusions require partial interaction status.",
            )
        if interaction_status == "complete" and base_status != "complete":
            _fail(
                "invalid-status-combination",
                f"{path}.interactionStatus",
                "interaction coverage cannot be complete while base automation is incomplete.",
            )

        rows.append({
            **row,
            "baseStatus": base_status,
            "interactionStatus": interaction_status,
            "runtime": {**runtime, "kind": runtime_kind},
            "capabilityTags": capability_tags,
            "suggestedCapabilityTags": suggested_tags,
            "conformanceEvidence": conformance_evidence,
        })

    manifest_ids = [row["canonicalId"] for row in rows]
    if len(set(manifest_ids)) != len(manifest_ids):
        _fail("duplicate-move", "manifest.moves", "contains a duplicate canonical move.")
    canonical_ids = [move["name"] for move in canonical_moves]
    if manifest_ids != canonical_ids:
        missing = sorted(set(canonical_ids) - set(manifest_ids))
        extra = sorted(set(manifest_ids) - set(canonical_ids))
        _fail(
            "manifest-membership-mismatch",
            "manifest.moves",
            "must contain every canonical move exactly once in canonical order "
            f"(missing: {', '.join(missing) or 'none'}; extra: {', '.join(extra) or 'none'}).",
        )
    return rows, linked_runtime_count, scenario_reference_count


def _build_semantic_progress(
    rows: list[dict[str, Any]],
    capability_by_code: dict[str, dict[str, Any]],
    evidence_by_code: dict[str, dict[str, Any]],
    requirement_by_tag: dict[str, dict[str, Any]],
) -> SemanticProgressReport:
    """Group reviewed manifest facts without consulting canonical rules prose."""

    semantic_status = tuple(
        SemanticStatusProgressGroup(
            status=status,
            moves=tuple(
                row["canonicalId"]
                for row in rows
                if row["baseStatus"] == status
            ),
        )
        for status in BASE_STATUSES
    )

    blocker_codes = sorted({
        blocker_code
        for row in rows
        for blocker_code in row["blockerCodes"]
    })
    capability_blockers = tuple(
        CapabilityBlockerProgressGroup(
            blocker_code=blocker_code,
            owning_phase=capability_by_code[blocker_code]["owningPhase"],
            implementation_status=capability_by_code[blocker_code]["implementationStatus"],
            moves=tuple(
                row["canonicalId"]
                for row in rows
                if blocker_code in row["blockerCodes"]
            ),
        )
        for blocker_code in blocker_codes
    )

    assigned_cohorts = sorted({
        row["rolloutCohortId"]
        for row in rows
        if row["rolloutCohortId"] is not None
    })
    cohort_ids: list[str | None] = list(assigned_cohorts)
    if any(row["rolloutCohortId"] is None for row in rows):
        cohort_ids.append(None)
    cohorts = tuple(
        CohortProgressGroup(
            cohort_id=cohort_id,
            moves=tuple(
                row["canonicalId"]
                for row in rows
                if row["rolloutCohortId"] == cohort_id
            ),
        )
        for cohort_id in cohort_ids
    )

    missing_evidence_by_code: dict[str, list[str]] = {}
    for row in rows:
        conformance_evidence = row["conformanceEvidence"]
        requirement_tags = conformance_evidence["requirementTags"]
        if not requirement_tags:
            missing_evidence_by_code.setdefault(
                MISSING_EVIDENCE_REQUIREMENTS_UNASSIGNED,
                [],
            ).append(row["canonicalId"])
            continue

        required_classes = {
            evidence_class
            for requirement_tag in requirement_tags
            for evidence_class in requirement_by_tag[requirement_tag]["requiredEvidenceClasses"]
        }
        covered_classes = {
            evidence_class
            for scenario in conformance_evidence["scenarios"]
            for evidence_class in scenario["evidenceClasses"]
        }
        not_applicable_classes = {
            entry["evidenceClass"]
            for entry in conformance_evidence["notApplicable"]
        }
        for evidence_class in sorted(
            required_classes - covered_classes - not_applicable_classes
        ):
            missing_evidence_by_code.setdefault(evidence_class, []).append(
                row["canonicalId"]
            )

    evidence_codes = sorted(
        missing_evidence_by_code,
        key=lambda code: (
            code != MISSING_EVIDENCE_REQUIREMENTS_UNASSIGNED,
            code,
        ),
    )
    missing_test_evidence = tuple(
        MissingTestEvidenceProgressGroup(
            evidence_code=evidence_code,
            summary=(
                "Reviewed scenario requirement tags have not been assigned."
                if evidence_code == MISSING_EVIDENCE_REQUIREMENTS_UNASSIGNED
                else evidence_by_code[evidence_code]["summary"]
            ),
            moves=tuple(missing_evidence_by_code[evidence_code]),
        )
        for evidence_code in evidence_codes
    )

    return SemanticProgressReport(
        semantic_status=semantic_status,
        capability_blockers=capability_blockers,
        cohorts=cohorts,
        missing_test_evidence=missing_test_evidence,
    )


def validate_semantic_coverage(
    *,
    require_complete: bool = False,
    manifest_path: Path = MANIFEST_PATH,
    ruleset_path: Path = RULESET_PATH,
    capabilities_path: Path = CAPABILITY_CATALOG_PATH,
    scenario_requirements_path: Path = SCENARIO_REQUIREMENTS_PATH,
    legacy_fingerprint_path: Path = LEGACY_FINGERPRINT_PATH,
    moves_path: Path = MOVES_PATH,
    source_dir: Path = MOVE_AUTOMATION_SOURCE_DIR,
    scenario_root: Path = SCENARIO_ROOT,
) -> SemanticCoverageReport:
    """Validate semantic metadata independently from final completion policy."""

    ruleset, canonical_moves, source_hash = _parse_ruleset_and_catalog(
        ruleset_path,
        moves_path,
    )
    capability_by_code = _parse_capability_catalog(capabilities_path, canonical_moves)
    evidence_by_code, requirement_by_tag = _parse_scenario_requirements(
        scenario_requirements_path,
    )
    canonical_names = {move["name"] for move in canonical_moves}
    registry_reader = TypeScriptRegistryReader(load_registry_source(source_dir), canonical_names)
    try:
        explicit_names = set(registry_reader.map_values("EXPLICIT_MOVE_AUTOMATION_SCRIPTS"))
    except (SystemExit, ValueError) as error:
        _fail("invalid-registry", "EXPLICIT_MOVE_AUTOMATION_SCRIPTS", str(error))
    extra_names = sorted(explicit_names - canonical_names)
    if extra_names:
        _fail(
            "unknown-registry-entry",
            "EXPLICIT_MOVE_AUTOMATION_SCRIPTS",
            f"contains unknown canonical moves: {', '.join(extra_names)}.",
        )
    legacy_fingerprints = _parse_legacy_fingerprints(
        legacy_fingerprint_path,
        canonical_moves,
        explicit_names,
    )
    scenario_ids = _discover_scenario_ids(scenario_root)
    rows, linked_runtime_count, scenario_reference_count = _parse_manifest(
        manifest_path,
        ruleset,
        canonical_moves,
        source_hash,
        explicit_names,
        legacy_fingerprints,
        scenario_ids,
        capability_by_code,
        evidence_by_code,
        requirement_by_tag,
    )
    base_counts = {status: 0 for status in BASE_STATUSES}
    interaction_counts = {status: 0 for status in INTERACTION_STATUSES}
    runtime_counts = {kind: 0 for kind in RUNTIME_KINDS}
    for row in rows:
        base_counts[row["baseStatus"]] += 1
        interaction_counts[row["interactionStatus"]] += 1
        runtime_counts[row["runtime"]["kind"]] += 1

    strict_issues: list[MoveAutomationValidationError] = []
    if require_complete:
        if len(canonical_moves) != 776 or len(rows) != 776:
            strict_issues.append(MoveAutomationValidationError(
                "canonical-count-required",
                "manifest.moves",
                f"strict completion requires exactly 776 canonical rows; found "
                f"{len(canonical_moves)} catalog moves and {len(rows)} manifest rows.",
            ))
        if base_counts["complete"] != len(canonical_moves):
            strict_issues.append(MoveAutomationValidationError(
                "completion-required",
                "manifest.moves",
                f"expected {len(canonical_moves)} complete moves; found "
                f"{base_counts['complete']} complete, {base_counts['assisted']} assisted, "
                f"and {base_counts['blocked']} blocked.",
            ))
        if runtime_counts["movespec-v2"] != len(canonical_moves):
            strict_issues.append(MoveAutomationValidationError(
                "authoritative-runtime-required",
                "manifest.moves.runtime",
                "strict completion requires one MoveSpec v2 runtime for every canonical move; "
                f"found {runtime_counts['movespec-v2']} v2, "
                f"{runtime_counts['legacy-v1']} legacy, and "
                f"{runtime_counts['unimplemented']} unimplemented.",
            ))
        if linked_runtime_count != len(canonical_moves):
            strict_issues.append(MoveAutomationValidationError(
                "runtime-link-required",
                "manifest.moves",
                f"strict completion requires {len(canonical_moves)} linked runtimes; "
                f"found {linked_runtime_count}.",
            ))
        non_implemented_capabilities = sorted({
            capability
            for row in rows
            for capability in row["capabilityTags"]
            if capability_by_code[capability]["implementationStatus"] != "implemented"
        })
        if non_implemented_capabilities:
            strict_issues.append(MoveAutomationValidationError(
                "implemented-capability-required",
                "manifest.moves.capabilityTags",
                "strict completion references capabilities not marked implemented: "
                + ", ".join(non_implemented_capabilities) + ".",
            ))
        suggested_debt = [row["canonicalId"] for row in rows if row["suggestedCapabilityTags"]]
        if suggested_debt:
            strict_issues.append(MoveAutomationValidationError(
                "suggested-capability-debt",
                "manifest.moves.suggestedCapabilityTags",
                "strict completion cannot retain suggested capability debt for: "
                + ", ".join(suggested_debt) + ".",
            ))
    issues = tuple(strict_issues)

    return SemanticCoverageReport(
        ruleset_id=ruleset["rulesetId"],
        source_data_sha256=source_hash,
        canonical_count=len(canonical_moves),
        manifest_count=len(rows),
        base_status_counts=base_counts,
        interaction_status_counts=interaction_counts,
        runtime_counts=runtime_counts,
        explicit_registry_count=len(explicit_names),
        linked_runtime_count=linked_runtime_count,
        runtime_definition_hash_count=sum(
            row["runtime"]["definitionHash"] is not None for row in rows
        ),
        scenario_reference_count=scenario_reference_count,
        discovered_scenario_count=len(scenario_ids),
        progress=_build_semantic_progress(
            rows,
            capability_by_code,
            evidence_by_code,
            requirement_by_tag,
        ),
        require_complete=require_complete,
        issues=issues,
    )
