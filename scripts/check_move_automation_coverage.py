#!/usr/bin/env python3
"""Check and report explicit PTU move automation coverage.

A move is considered automated only when it appears in the explicit automation
registry; unregistered moves stay visible but disabled in the token move menu.

The optional worklist report is a planning aid for reviewed explicit scripts.
It intentionally uses conservative heuristics and must not be treated as runtime
automation or proof that a move is safe to automate blindly.
"""
from __future__ import annotations

import argparse
import ast
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

ROOT = Path(__file__).resolve().parents[1]
MOVES_PATH = ROOT / "data" / "reference" / "moves.json"
REGISTRY_PATH = ROOT / "src" / "utils" / "moveAutomation.ts"

VALID_TYPES = {
    "Normal", "Fighting", "Flying", "Poison", "Ground", "Rock",
    "Bug", "Ghost", "Steel", "Fire", "Water", "Grass",
    "Electric", "Psychic", "Ice", "Dragon", "Dark", "Fairy",
}

WORKLIST_BUCKETS = [
    "plain-single-target-damage",
    "single-target-status",
    "single-target-stage",
    "single-target-secondary-condition",
    "single-target-secondary-stage",
    "plain-area-damage",
    "area-condition-or-stage",
    "hp-heal-drain-recoil-cost",
    "direct-hp-loss",
    "dynamic-damage-base",
    "field-weather-terrain-room",
    "hazard",
    "persistent-marker-or-delayed-effect",
    "movement-positioning",
    "item-inventory",
    "copy-random-move-list",
    "reaction-interrupt-shield",
    "complex-review-needed",
]

NEXT_BATCH_SIZE = 30


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
    reader = TypeScriptRegistryReader(REGISTRY_PATH.read_text(), canonical_names)
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


def move_text(move: dict, *, include_name: bool = True) -> str:
    fields = ["range", "effect", "special"]
    if include_name:
        fields.insert(0, "name")
    return " ".join(str(move.get(field) or "") for field in fields)


def has(pattern: str, value: str) -> bool:
    return re.search(pattern, value, flags=re.IGNORECASE) is not None


def effect_text(move: dict) -> str:
    return str(move.get("effect") or "").strip()


def range_text(move: dict) -> str:
    return str(move.get("range") or "").strip()


def has_no_secondary_effect(move: dict) -> bool:
    effect = effect_text(move)
    return not effect or re.fullmatch(r"None\.?", effect, flags=re.IGNORECASE) is not None


def is_damaging(move: dict) -> bool:
    return move.get("damage_base") is not None and move.get("damage_class") not in {"Status", "Static"}


def has_area_or_multi_target_range(move: dict) -> bool:
    range_value = range_text(move)
    return has(
        r"\b(Burst|Cone|Blast|Line|Field|Weather|Hazard|Blessing|All Cardinally Adjacent|All Adjacent|[2-9]\d*\s*Targets?)\b",
        range_value,
    )


def is_single_target_like(move: dict) -> bool:
    if has_area_or_multi_target_range(move):
        return False
    range_value = range_text(move)
    return bool(
        has(r"\b(1\s*Target|Single Target|Melee|Ranged)\b", range_value)
        or is_damaging(move)
    )


def has_condition_effect(move: dict) -> bool:
    return has(
        r"Burn(?:ed|s)?|Poison(?:ed|s)?|Paraly(?:sis|zed|zes)|Sleep|Asleep|Frozen|Freez(?:e|es)|"
        r"Confus(?:ed|es|ion)|Flinch(?:ed|es)?|Blind(?:ness)?|Trapped|Stuck|Slowed|Vulnerable|"
        r"Trip(?:ped|s)?|Suppressed|Enraged|Infatuated|Cursed|Badly Poisoned",
        effect_text(move),
    )


def has_stage_effect(move: dict) -> bool:
    effect = effect_text(move)
    return has(
        r"Combat Stage|\bCS\b|Attack|Defense|Special Attack|Special Defense|Sp\. Atk|Sp\. Def|Speed|Accuracy|Evasion|stats?",
        effect,
    ) and has(
        r"raise|lower|increase|decrease|reduced|boost|reset|swap|\+\d|-\d",
        effect,
    )


def move_name_in(move: dict, names: set[str]) -> bool:
    return str(move.get("name") or "") in names


def classify_move_worklist_bucket(move: dict) -> str:
    """Classify a missing move into a conservative planning bucket."""

    text = move_text(move)
    range_value = range_text(move)

    if has(r"\b(Interrupt|Reaction|Shield|Trigger)\b", text) or move_name_in(move, {
        "Baneful Bunker", "Beak Blast", "Bide", "Counter", "Crafty Shield",
        "Detect", "Endure", "Feint", "Focus Punch", "Follow Me",
        "King’s Shield", "Magic Coat", "Mat Block", "Me First", "Mirror Coat",
        "Obstruct", "Powder", "Protect", "Pursuit", "Quick Guard",
        "Rage Powder", "Shell Trap", "Snatch", "Spiky Shield", "Sucker Punch",
        "Wide Guard",
    }):
        return "reaction-interrupt-shield"

    if has(
        r"Metronome|Assist|Copycat|Mimic|Mirror Move|Sketch|Transform|Instruct|Sleep Talk|Nature Power|"
        r"random|roll 1d|Move List|copy|copies|last Move|Present|Magnitude|Dire Claw|Tri Attack|Acupressure",
        text,
    ):
        return "copy-random-move-list"

    if has(
        r"\bHazard\b|Spikes|Stealth Rock|Sticky Web|Toxic Spikes|Ceaseless Edge|Stone Axe|Fire Pledge|Grass Pledge|Water Pledge",
        text,
    ):
        return "hazard"

    if has(
        r"Weather|Terrain|Room|Gravity|Tailwind|Court Change|Defog|Electric Terrain|Grassy Terrain|"
        r"Misty Terrain|Psychic Terrain|Hail|Rain Dance|Sandstorm|Sunny Day|Trick Room|Magic Room|Wonder Room|Ion Deluge",
        text,
    ):
        return "field-weather-terrain-room"

    if has(
        r"\bitem\b|Held Item|Accessory Slot|Berry|Bestow|Covet|Corrosive Gas|Fling|Incinerate|"
        r"Knock Off|Natural Gift|Pay Day|Pluck|Recycle|Stuff Cheeks|Switcheroo|Techno Blast|Thief|Trick(?! Room)\b",
        text,
    ):
        return "item-inventory"

    if has(
        r"\b(Dash|Pass|Push|Pull|Shift|Teleport|Fly|Dig|Dive|Bounce|Sky Drop|Phantom Force|Shadow Force|"
        r"Circle Throw|Dragon Tail|Roar|Whirlwind|Ally Switch|Baton Pass|Flip Turn|Parting Shot|Teleport|"
        r"U-Turn|Volt Switch)\b|recalled|sent out|switch(?:es|ed)?|move the user|moves the user|swap places",
        text,
    ):
        return "movement-positioning"

    if has(
        r"Aqua Ring|Barrier|Blessing|Block|Coat|Curse|Destiny Bond|Disable|Doom Desire|Encore|Future Sight|"
        r"Grudge|Imprison|Ingrain|Laser Focus|Leech Seed|Lock-On|Mean Look|Mind Reader|Nightmare|Perish|"
        r"Powder|Smokescreen|Spider Web|Stockpile|Substitute|Vortex|Wish|Yawn|delayed|end of|next turn|"
        r"for \d+ rounds?|until the end|one full round",
        text,
    ):
        return "persistent-marker-or-delayed-effect"

    if has(
        r"loses? \d+ Hit Points|lose 15 Hit Points|fixed HP|direct HP|Dragon Rage|Endeavor|Final Gambit|"
        r"Nature’s Madness|Night Shade|Pain Split|Psywave|Seismic Toss|Sonic Boom|Super Fang",
        text,
    ):
        return "direct-hp-loss"

    if has(
        r"heal|heals|healed|recover|Hit Points?|\bHP\b|Drain|drain|Recoil|self-KO|faints|Belly Drum|cost|"
        r"Massive Damage|set to full|half of the damage",
        text,
    ):
        return "hp-heal-drain-recoil-cost"

    if has(
        r"Damage Base is|Damage Base equal|Damage Base increases|Damage Base.*\+|\bDB\b.*(?:increase|raised|equal|reduced|\+)|"
        r"Damage Roll|Five Strike|Double Strike|Triple Axel|Triple Kick|Beat Up|Electro Ball|Flail|Grass Knot|"
        r"Gyro Ball|Hidden Power|Judgment|Low Kick|Multi-Attack|Punishment|Return|Reversal|Revelation Dance|"
        r"Stored Power|Terrain Pulse|Trump Card|Weather Ball|Weight Class|current Hit Points|remaining Hit Points|"
        r"full Hit Points|consecutive|number of hits|positive (?:Combat Stage|CS)|acted this round|lower initiative|depends on",
        text,
    ):
        return "dynamic-damage-base"

    condition_effect = has_condition_effect(move)
    stage_effect = has_stage_effect(move)

    if has_area_or_multi_target_range(move):
        if condition_effect or stage_effect or not has_no_secondary_effect(move):
            return "area-condition-or-stage"
        if is_damaging(move):
            return "plain-area-damage"
        return "complex-review-needed"

    if is_single_target_like(move):
        if is_damaging(move):
            if condition_effect:
                return "single-target-secondary-condition"
            if stage_effect:
                return "single-target-secondary-stage"
            if has_no_secondary_effect(move) or is_simple_cannot_miss_effect(move) or is_simple_critical_effect(move):
                return "plain-single-target-damage"
            return "complex-review-needed"
        if stage_effect:
            return "single-target-stage"
        if condition_effect:
            return "single-target-status"

    return "complex-review-needed"


def is_simple_cannot_miss_effect(move: dict) -> bool:
    effect = effect_text(move)
    return re.fullmatch(
        r"[\w\-’' ]+ cannot miss\.?",
        effect,
        flags=re.IGNORECASE,
    ) is not None


def is_simple_critical_effect(move: dict) -> bool:
    effect = effect_text(move)
    return re.fullmatch(
        r"(?:If [\w\-’' ]+ hits, it is a Critical Hit|[\w\-’' ]+ is a Critical Hit on (?:an? )?(?:\d+\+|Even-Numbered Rolls?))\.?",
        effect,
        flags=re.IGNORECASE,
    ) is not None


def is_simple_condition_effect(move: dict) -> bool:
    effect = effect_text(move)
    return re.fullmatch(
        r"[\w\-’' ]+ (?:Burns|Paralyzes|Freezes|Confuses|Flinches|Poisons) (?:the target|all targets) "
        r"on (?:an? )?(?:\d+\+|\d+-\d+|even roll|Even-Numbered Rolls?)\.?,?"
        r"(?: and is a Critical Hit on (?:an? )?\d+\+\.?)?",
        effect,
        flags=re.IGNORECASE,
    ) is not None


def is_simple_stage_effect(move: dict) -> bool:
    effect = effect_text(move)
    if not has_stage_effect(move):
        return False
    if has(r"all Legal Targets|each of its stats|reset|swap|transfer|positive Combat Stage|Damage Base|Damage Roll", effect):
        return False
    return not has(r"if |If |may|choose|instead|before|after|until|for \d+ rounds?|depends", effect)


def recommended_batch_score(move: dict) -> tuple[int, str] | None:
    """Return a score for the planning report's next safest batch."""

    if not is_damaging(move) or not is_single_target_like(move):
        return None

    text = move_text(move)
    if has(
        r"\b(Dash|Pass|Push|Pull|Set-Up|Set Up|Execute|Exhaust|Smite|Spirit Surge|Interrupt|Reaction|Shield|Trigger|"
        r"Full Action|Swift Action|Free Action|Hazard|Weather|Terrain|Room)\b|"
        r"item|Held Item|Accessory|Berry|random|roll 1d|copy|Move List|all targets|recalled|sent out|switch|delayed|"
        r"next turn|end of|Vortex|Coat|Blessing|Substitute|Leech Seed|Aqua Ring|Ingrain|Wish|Future Sight|Doom Desire",
        text,
    ):
        return None

    bucket = classify_move_worklist_bucket(move)
    if bucket == "plain-single-target-damage":
        if has_no_secondary_effect(move):
            return (0, move["name"])
        if is_simple_cannot_miss_effect(move):
            return (1, move["name"])
        if is_simple_critical_effect(move):
            return (2, move["name"])
    if bucket == "single-target-secondary-stage" and is_simple_stage_effect(move):
        return (3, move["name"])
    if bucket == "single-target-secondary-condition" and is_simple_condition_effect(move):
        return (4, move["name"])

    return None


def grouped_missing_moves(coverage: MoveCoverage) -> dict[str, list[str]]:
    canonical_by_name = {move["name"]: move for move in coverage.canonical_moves}
    grouped: dict[str, list[str]] = {bucket: [] for bucket in WORKLIST_BUCKETS}
    for name in coverage.missing_names:
        bucket = classify_move_worklist_bucket(canonical_by_name[name])
        grouped[bucket].append(name)
    return grouped


def recommended_next_batch(coverage: MoveCoverage, limit: int = NEXT_BATCH_SIZE) -> list[str]:
    candidates: list[tuple[tuple[int, str], str]] = []
    for move in coverage.canonical_moves:
        if move["name"] not in coverage.missing_names:
            continue
        score = recommended_batch_score(move)
        if score is not None:
            candidates.append((score, move["name"]))
    candidates.sort(key=lambda item: item[0])
    return [name for _score, name in candidates[:limit]]


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


def print_worklist_report(coverage: MoveCoverage) -> int:
    grouped = grouped_missing_moves(coverage)
    batch = recommended_next_batch(coverage)

    print("Move automation worklist report")
    print("Buckets are heuristic planning aids only; every automated move still needs an explicit reviewed script entry.")
    print(f"Canonical valid move count: {len(coverage.canonical_moves)}")
    print(f"Explicit script count: {len(coverage.explicit_names)}")
    print(f"Missing script count: {len(coverage.missing_names)}")

    if coverage.extra_names:
        print("\nUnknown explicit move script entries:")
        for name in coverage.extra_names:
            print(f"  - {name}")

    print("\nMissing moves by bucket:")
    for bucket in WORKLIST_BUCKETS:
        names = grouped[bucket]
        print(f"\n{bucket} ({len(names)})")
        for name in names:
            print(f"  - {name}")

    print(f"\nRecommended next safest batch ({len(batch)} moves):")
    for name in batch:
        print(f"  - {name}")

    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--report",
        "--worklist",
        action="store_true",
        dest="report",
        help="print a heuristic missing-move worklist report instead of failing coverage",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    coverage = build_coverage()
    if args.report:
        return print_worklist_report(coverage)
    return print_default_coverage(coverage)


if __name__ == "__main__":
    raise SystemExit(main())
