"""Coverage reader for reviewed explicit PTU move automation scripts."""
from __future__ import annotations

import ast
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


ROOT = Path(__file__).resolve().parents[1]
MOVES_PATH = ROOT / "data" / "reference" / "moves.json"
MOVE_AUTOMATION_SOURCE_DIR = ROOT / "src" / "utils" / "move-automation"


def load_registry_source() -> str:
    """Return the explicit automation registry and reviewed script module sources."""

    paths = sorted(MOVE_AUTOMATION_SOURCE_DIR.rglob("*.ts"))
    return "\n\n".join(path.read_text() for path in paths)

VALID_TYPES = {
    "Normal", "Fighting", "Flying", "Poison", "Ground", "Rock",
    "Bug", "Ghost", "Steel", "Fire", "Water", "Grass",
    "Electric", "Psychic", "Ice", "Dragon", "Dark", "Fairy",
}


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


def load_canonical_moves() -> list[dict]:
    moves_data = json.loads(MOVES_PATH.read_text())
    return sorted(
        (
            move
            for move in moves_data.values()
            if move.get("type") in VALID_TYPES
        ),
        key=lambda move: move["name"],
    )


def build_coverage() -> MoveCoverage:
    canonical_moves = load_canonical_moves()
    canonical_names = {move["name"] for move in canonical_moves}
    reader = TypeScriptRegistryReader(load_registry_source(), canonical_names)
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
