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
SCENARIO_ROOT = ROOT / "tests" / "fixtures" / "moveAutomation"


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

    def map_values(self, name: str) -> list[str]:
        if name in self._map_cache:
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

        self._map_cache[name] = unique_preserving_order(values)
        return self._map_cache[name]

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


MANIFEST_SCHEMA_VERSION = 1
MANIFEST_ROOT_FIELDS = {"schemaVersion", "moves"}
MANIFEST_MOVE_FIELDS = {
    "canonicalId", "displayName", "baseStatus", "interactionStatus", "runtime",
    "rulesProvenance", "capabilityTags", "suggestedCapabilityTags", "blockerCodes",
    "limitations", "manualSteps", "scenarioIds", "reviewedAt",
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
    "unsupportedInteractionIds": 64,
}


class MoveAutomationValidationError(ValueError):
    """A deterministic, actionable semantic coverage validation failure."""

    def __init__(self, code: str, path: str, message: str):
        super().__init__(f"{path}: {message}")
        self.code = code
        self.path = path
        self.detail = message


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


def _record(value: Any, path: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        _fail("invalid-manifest", path, "must be an object.")
    return value


def _exact_fields(value: dict[str, Any], fields: set[str], path: str) -> None:
    missing = sorted(fields - set(value))
    unknown = sorted(set(value) - fields)
    if missing or unknown:
        _fail(
            "invalid-manifest",
            path,
            "has an invalid shape "
            f"(missing: {', '.join(missing) or 'none'}; "
            f"unknown: {', '.join(unknown) or 'none'}).",
        )


def _bounded_text(value: Any, path: str, maximum: int) -> str:
    if (
        not isinstance(value, str)
        or not value
        or value.strip() != value
        or CONTROL_CHARACTER_PATTERN.search(value)
    ):
        _fail("invalid-manifest", path, "must be a non-empty, trimmed, single-line string.")
    if len(value) > maximum:
        _fail("limit-exceeded", path, f"must contain at most {maximum} characters.")
    return value


def _stable_id(value: Any, path: str) -> str:
    identifier = _bounded_text(value, path, MANIFEST_LIMITS["identifierLength"])
    if not STABLE_ID_PATTERN.fullmatch(identifier):
        _fail("invalid-manifest", path, "must be a lowercase stable identifier.")
    return identifier


def _positive_integer(value: Any, path: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        _fail("invalid-manifest", path, "must be a positive integer.")
    return value


def _sha256(value: Any, path: str) -> str:
    if not isinstance(value, str) or not SHA256_PATTERN.fullmatch(value):
        _fail("invalid-manifest", path, "must be a lowercase SHA-256 digest.")
    return value


def _bounded_array(value: Any, path: str, maximum: int) -> list[Any]:
    if not isinstance(value, list):
        _fail("invalid-manifest", path, "must be an array.")
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
    return ruleset, canonical_moves, actual_hash


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


def _parse_manifest(
    manifest_path: Path,
    ruleset: dict[str, Any],
    canonical_moves: list[dict[str, Any]],
    source_hash: str,
    explicit_names: set[str],
    scenario_ids: set[str],
) -> tuple[list[dict[str, Any]], int, int]:
    manifest = _record(_load_json(manifest_path, "manifest"), "manifest")
    _exact_fields(manifest, MANIFEST_ROOT_FIELDS, "manifest")
    if manifest["schemaVersion"] != MANIFEST_SCHEMA_VERSION:
        _fail("invalid-manifest", "manifest.schemaVersion", "must be 1.")
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
        if any(value is not None for value in linked_fields) and not all(
            value is not None for value in linked_fields
        ):
            _fail(
                "invalid-runtime-reference",
                f"{path}.runtime",
                "version, definitionHash, and sourceModule must be linked together.",
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


def validate_semantic_coverage(
    *,
    require_complete: bool = False,
    manifest_path: Path = MANIFEST_PATH,
    ruleset_path: Path = RULESET_PATH,
    moves_path: Path = MOVES_PATH,
    source_dir: Path = MOVE_AUTOMATION_SOURCE_DIR,
    scenario_root: Path = SCENARIO_ROOT,
) -> SemanticCoverageReport:
    """Validate semantic metadata independently from final completion policy."""

    ruleset, canonical_moves, source_hash = _parse_ruleset_and_catalog(
        ruleset_path,
        moves_path,
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
    scenario_ids = _discover_scenario_ids(scenario_root)
    rows, linked_runtime_count, scenario_reference_count = _parse_manifest(
        manifest_path,
        ruleset,
        canonical_moves,
        source_hash,
        explicit_names,
        scenario_ids,
    )
    base_counts = {status: 0 for status in BASE_STATUSES}
    interaction_counts = {status: 0 for status in INTERACTION_STATUSES}
    runtime_counts = {kind: 0 for kind in RUNTIME_KINDS}
    for row in rows:
        base_counts[row["baseStatus"]] += 1
        interaction_counts[row["interactionStatus"]] += 1
        runtime_counts[row["runtime"]["kind"]] += 1

    issues: tuple[MoveAutomationValidationError, ...] = ()
    if require_complete and base_counts["complete"] != len(canonical_moves):
        issues = (MoveAutomationValidationError(
            "completion-required",
            "manifest.moves",
            f"expected {len(canonical_moves)} complete moves; found "
            f"{base_counts['complete']} complete, {base_counts['assisted']} assisted, "
            f"and {base_counts['blocked']} blocked.",
        ),)

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
        require_complete=require_complete,
        issues=issues,
    )
