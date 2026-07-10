"""Informational prose heuristics for missing PTU move automation scripts."""
from __future__ import annotations

import re

from move_automation_coverage import MoveCoverage

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

# These moves need explicit support for their critical-hit, user-stage, or type
# mechanics before they are safe worklist recommendations.
KNOWN_UNSUPPORTED_COMPLEX_MOVES = {
    "Frost Breath",
    "Storm Throw",
    "Spacial Rend",
    "Aura Wheel",
    "Hammer Arm",
    "Ice Hammer",
}

# Human-deferred until Sonic Drown Out reaction/cancel timing is modeled.
HUMAN_DEFERRED_REACTION_CANCEL_MOVES = {
    "Chatter",
}


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


def has_supported_area_template_range(move: dict) -> bool:
    return has(r"\b(Burst|Cone|Blast|Line|All Cardinally Adjacent)\b", range_text(move))


def has_mixed_single_target_area_range(move: dict) -> bool:
    """Return whether a range offers a single-target branch and an area branch."""

    range_value = range_text(move)
    return has(r"\b(1\s*Target|Single Target)\b", range_value) and has(
        r"\b(Burst|Cone|Blast|Line|Pass)\b",
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


def has_user_stage_effect(move: dict) -> bool:
    effect = effect_text(move)
    return has_stage_effect(move) and has(r"\buser(?:[’']s)?\b|\bThe user\b", effect)


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
        r"Smokescreen|Spider Web|Stockpile|Substitute|Vortex|Wish|Yawn|delayed|end of|next turn|"
        r"for \d+ rounds?|until the end|one full round",
        text,
    ):
        return "persistent-marker-or-delayed-effect"

    if has_mixed_single_target_area_range(move):
        return "complex-review-needed"

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
                if has_user_stage_effect(move):
                    return "complex-review-needed"
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
        r"[\w\-’' ]+ is a Critical Hit on (?:an? )?\d+\+\.?",
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
    if has(r"all Legal Targets|each of its stats|reset|swap|transfer|invert|inverted|becomes?|positive Combat Stage|Damage Base|Damage Roll", effect):
        return False
    return not has(r"if |If |may|choose|instead|before|after|until|for \d+ rounds?|depends", effect)


def is_simple_target_stage_effect(move: dict) -> bool:
    effect = effect_text(move)
    if not is_simple_stage_effect(move):
        return False
    if has_user_stage_effect(move):
        return False
    return has(r"\btarget(?:[’']s)?\b|\bfoe(?:[’']s)?\b", effect)


def recommended_batch_score(move: dict) -> tuple[int, str] | None:
    """Return a score for the planning report's next safest batch."""

    name = str(move.get("name") or "")
    if (
        name in KNOWN_UNSUPPORTED_COMPLEX_MOVES
        or name in HUMAN_DEFERRED_REACTION_CANCEL_MOVES
        or has_mixed_single_target_area_range(move)
    ):
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
    if bucket == "plain-area-damage" and has_no_secondary_effect(move) and has_supported_area_template_range(move):
        if not has(r"\b(Exhaust|Set-Up|Set Up|Execute|Interrupt|Reaction|Shield|Trigger|Full Action|Swift Action|Free Action)\b", range_text(move)):
            return (3, move["name"])
    if bucket == "single-target-secondary-stage" and is_simple_target_stage_effect(move):
        return (3, move["name"])
    if bucket == "single-target-secondary-condition" and is_simple_condition_effect(move):
        return (4, move["name"])
    if bucket == "single-target-stage" and is_simple_target_stage_effect(move):
        return (5, move["name"])

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

def print_worklist_report(coverage: MoveCoverage) -> int:
    grouped = grouped_missing_moves(coverage)
    batch = recommended_next_batch(coverage)

    print("Move automation heuristic prose classification (informational only)")
    print(
        "This legacy report is not a progress tracker or implementation queue; "
        "use --report or --json for reviewed semantic planning data."
    )
    print(
        "Buckets and candidates are regex-derived hints only; every move still "
        "needs reviewed manifest metadata and scenario evidence."
    )
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

    print(
        f"\nInformational candidate sample ({len(batch)} moves; "
        "not an implementation queue):"
    )
    for name in batch:
        print(f"  - {name}")

    return 0
