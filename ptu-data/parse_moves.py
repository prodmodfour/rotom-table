#!/usr/bin/env python3
"""Parse PTU 1.05 moves from core + supplement reference markdown into a JSON cache."""

import json
import os
import re
import sys

MARKDOWN_DIR = os.path.join(
    os.path.dirname(__file__), "..", "books", "markdown"
)
# Source files listed in priority order, highest first. Later / newer reference
# supplements patch over older material, and errata patches the core.
SOURCE_FILES = [
    os.path.join(MARKDOWN_DIR, "arceus_references.md"),   # Legends: Arceus (2022)
    os.path.join(MARKDOWN_DIR, "swsh_-_armor_crown_references.md"),  # SwSh + DLCs
    os.path.join(MARKDOWN_DIR, "sumo_references.md"),     # SuMo (2016–2018)
    os.path.join(MARKDOWN_DIR, "errata-3.md"),            # Feb 2016 playtest / errata 3
    os.path.join(MARKDOWN_DIR, "errata-2.md"),            # Sept 2015 playtest / errata 2
    os.path.join(MARKDOWN_DIR, "core", "10-indices-and-reference.md"),
]
CACHE_DIR = os.path.join(os.path.dirname(__file__), "data")

STRUGGLE_EXPERT_NOTE = (
    "Struggle Attacks do not count as Moves; never apply STAB. "
    "If the user has Combat Skill Rank Expert or higher, use AC 3 and Damage Base 5 instead."
)

# Move descriptions use more than one heading in the source books. Most moves
# use plain ``Effect:``, while Set-Up moves often split their text into labels
# such as ``Set-Up Effect:`` and ``Resolution Effect:``. Keep the parser open to
# future move-local ``... Effect:`` headings without treating contest metadata as
# move description text.
MOVE_EFFECT_LABEL_RE = re.compile(
    r"^(?P<label>Effect|(?:[A-Za-z][A-Za-z’'/-]*(?:\s+[A-Za-z][A-Za-z’'/-]*)*)\s+Effect):\s*(?P<text>.*)$"
)
EFFECT_LABEL_EXCLUSIONS = {"Contest Effect", "Area of Effect"}
EFFECT_STOP_RE = re.compile(
    r"^(?:Contest\b|Special:|Move:|Ability:|Feature:|Edge:|## Page|New\b)"
)
MERGEABLE_SHADOW_FIELDS = ("effect", "special")


def _struggle_variant(
    name: str,
    type_: str,
    capability: str,
    *,
    damage_class: str = "Special",
    range_: str = "Melee, 1 Target",
    capability_clause: str | None = None,
    stat_clause: str | None = None,
) -> dict:
    clause = capability_clause or f"The user's Struggle Attacks may be {type_}-Typed."
    stat_text = stat_clause or (
        "The user may add Special Attack instead of Attack and deal Special Damage."
        if damage_class == "Special"
        else "This entry uses Attack and deals Physical Damage."
    )
    return {
        "name": name,
        "type": type_,
        "frequency": "At-Will",
        "ac": 4,
        "damage_base": 4,
        "damage_roll": "1d8+6 / 11",
        "damage_class": damage_class,
        "range": range_,
        "effect": (
            f"Requires {capability}. {clause} "
            f"{stat_text} "
            f"{STRUGGLE_EXPERT_NOTE}"
        ),
    }


def _struggle_variant_pair(
    capability: str,
    type_: str,
    *,
    range_: str = "Melee, 1 Target",
    capability_clause: str | None = None,
) -> dict[str, dict]:
    return {
        f"Struggle ({capability} Physical)": _struggle_variant(
            f"Struggle ({capability} Physical)",
            type_,
            capability,
            damage_class="Physical",
            range_=range_,
            capability_clause=capability_clause,
        ),
        f"Struggle ({capability} Special)": _struggle_variant(
            f"Struggle ({capability} Special)",
            type_,
            capability,
            damage_class="Special",
            range_=range_,
            capability_clause=capability_clause,
        ),
    }


# Struggle Attacks live in the Combat chapter rather than the move reference,
# but the app's sheets resolve attack details through moves.json. Keep these
# manual records here so regenerating the cache does not drop them.
MANUAL_MOVE_PATCHES = {
    "Struggle": {
        "name": "Struggle",
        "type": "Normal",
        "frequency": "At-Will",
        "ac": 4,
        "damage_base": 4,
        "damage_roll": "1d8+6 / 11",
        "damage_class": "Physical",
        "range": "Melee, 1 Target",
        "effect": (
            "A Standard Action Struggle Attack: Melee, Physical, Normal-Type. "
            f"{STRUGGLE_EXPERT_NOTE}"
        ),
    },
    **_struggle_variant_pair("Firestarter", "Fire"),
    **_struggle_variant_pair("Fountain", "Water"),
    **_struggle_variant_pair("Freezer", "Ice"),
    **_struggle_variant_pair("Guster", "Flying"),
    **_struggle_variant_pair("Materializer", "Rock"),
    **_struggle_variant_pair(
        "Telekinetic",
        "Normal",
        range_="Focus Rank, 1 Target",
        capability_clause=(
            "The user may make Struggle Attacks at a range equal to their Focus Rank. "
            "These attacks deal Normal-Type Damage as usual."
        ),
    ),
    **_struggle_variant_pair("Zapper", "Electric"),
}


def _effect_label(line: str) -> tuple[str, str] | None:
    match = MOVE_EFFECT_LABEL_RE.match(line)
    if not match:
        return None

    label = match.group("label").strip()
    if label in EFFECT_LABEL_EXCLUSIONS:
        return None

    return label, match.group("text").strip()


def _normalize_continuation_text(parts: list[str]) -> str:
    text = "\n".join(parts).strip()
    return re.sub(r"\s*\n\s*", " ", text)


def _format_effect_parts(parts: list[tuple[str, str]]) -> str | None:
    if not parts:
        return None

    if len(parts) == 1 and parts[0][0] == "Effect":
        return parts[0][1]

    return " ".join(
        f"{label}: {text}" if text else f"{label}:"
        for label, text in parts
    )


def _extract_effect(body: str) -> str | None:
    lines = body.splitlines()
    parts: list[tuple[str, str]] = []
    index = 0

    while index < len(lines):
        if EFFECT_STOP_RE.match(lines[index]):
            break

        parsed_label = _effect_label(lines[index])
        if not parsed_label:
            index += 1
            continue

        label, first_line = parsed_label
        text_parts = [first_line] if first_line else []
        index += 1

        while index < len(lines):
            line = lines[index]
            if EFFECT_STOP_RE.match(line) or _effect_label(line):
                break
            text_parts.append(line)
            index += 1

        parts.append((label, _normalize_continuation_text(text_parts)))

    return _format_effect_parts(parts)


def _merge_missing_shadow_fields(target: dict, lower_priority_move: dict) -> list[str]:
    merged: list[str] = []
    for field in MERGEABLE_SHADOW_FIELDS:
        if target.get(field) is None and lower_priority_move.get(field) is not None:
            target[field] = lower_priority_move[field]
            merged.append(field)
    return merged


def _parse_blocks(text: str) -> dict[str, dict]:
    moves: dict[str, dict] = {}
    # Split on "Move: " at the start of a line.
    blocks = re.split(r"^Move: ", text, flags=re.MULTILINE)

    for block in blocks[1:]:  # skip preamble
        lines = block.strip().splitlines()
        if not lines:
            continue

        name = lines[0].strip()
        move = {"name": name}
        body = "\n".join(lines[1:])

        # Type
        m = re.search(r"^Type:\s*(.+)", body, re.MULTILINE)
        if m:
            move["type"] = m.group(1).strip()

        # Frequency
        m = re.search(r"^Frequency:\s*(.+)", body, re.MULTILINE)
        if m:
            move["frequency"] = m.group(1).strip()

        # AC
        m = re.search(r"^AC:\s*(.+)", body, re.MULTILINE)
        if m:
            ac_val = m.group(1).strip()
            if ac_val.lower() == "none":
                move["ac"] = None
            else:
                try:
                    move["ac"] = int(ac_val)
                except ValueError:
                    move["ac"] = ac_val

        # Damage Base — e.g. "Damage Base 4: 1d8+6 / 11"
        m = re.search(r"^Damage Base\s*(\d+):\s*(.+)", body, re.MULTILINE)
        if m:
            move["damage_base"] = int(m.group(1))
            move["damage_roll"] = m.group(2).strip()
        else:
            move["damage_base"] = None

        # Class
        m = re.search(r"^Class:\s*(.+)", body, re.MULTILINE)
        if m:
            move["damage_class"] = m.group(1).strip()

        # Range
        m = re.search(r"^Range:\s*(.+)", body, re.MULTILINE)
        if m:
            move["range"] = m.group(1).strip()

        # Effect — may span multiple labelled parts.
        effect = _extract_effect(body)
        if effect is not None:
            move["effect"] = effect

        # Special — may appear before or after Contest lines and may span lines.
        # Ignore any following ability/features text accidentally captured in the
        # same split block; only Special lines belonging to this Move are valid.
        move_body = re.split(
            r"^Ability:|^Feature:|^Edge:|^## Page|^New ",
            body,
            maxsplit=1,
            flags=re.MULTILINE,
        )[0]
        specials = re.findall(
            r"^Special:\s*([\s\S]+?)(?=^Contest|^Special:|^Move:|^Ability:|^Feature:|^Edge:|^## Page|^New |\Z)",
            move_body,
            re.MULTILINE,
        )
        if specials:
            normalized_specials = []
            for special in specials:
                special = re.sub(r"\s*\n\s*", " ", special).strip()
                special = re.sub(r"\s+", " ", special)
                if special:
                    normalized_specials.append(special)
            if normalized_specials:
                move["special"] = " ".join(normalized_specials)

        moves[name] = move

    return moves


def parse_moves(verbose: bool = False) -> dict[str, dict]:
    """Parse moves from all source files in priority order (first wins)."""
    moves: dict[str, dict] = {}
    provenance: dict[str, str] = {}

    for path in SOURCE_FILES:
        if not os.path.exists(path):
            continue
        with open(path, "r", encoding="utf-8") as f:
            text = f.read()
        label = os.path.basename(path)
        added = 0
        shadowed = 0
        for name, move in _parse_blocks(text).items():
            if name not in moves:
                moves[name] = move
                provenance[name] = label
                added += 1
            else:
                shadowed += 1
                merged_fields = _merge_missing_shadow_fields(moves[name], move)
                if verbose:
                    merged_note = f"; filled missing {', '.join(merged_fields)}" if merged_fields else ""
                    print(f"  [shadowed] {name}: kept {provenance[name]}, dropped {label}{merged_note}")
        print(f"  {label}: +{added} new, {shadowed} shadowed by higher-priority source")

    for name, move in MANUAL_MOVE_PATCHES.items():
        moves[name] = dict(move)

    return moves


def build_cache(verbose: bool = False):
    os.makedirs(CACHE_DIR, exist_ok=True)
    print("Parsing moves (priority: newest supplement → core)...")
    moves = parse_moves(verbose=verbose)
    out_path = os.path.join(CACHE_DIR, "moves.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(moves, f, indent=2, ensure_ascii=False)
    print(f"Wrote {len(moves)} moves to {out_path}")
    return moves


if __name__ == "__main__":
    build_cache(verbose="--verbose" in sys.argv or "-v" in sys.argv)
