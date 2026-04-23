#!/usr/bin/env python3
"""Format a generated PTU 1.05 Pokémon into the campaign markdown template."""

import re
from generator import DAMAGE_TABLE


def compute_damage_roll(damage_base: int, stat_value: int) -> str:
    """Compute the displayed damage roll: base dice + (constant + stat).
    PTU damage = dice roll from DB table + relevant attacking stat."""
    base_roll = DAMAGE_TABLE.get(damage_base, "")
    if not base_roll:
        return ""
    # Parse "NdX+Y" → add stat_value to Y
    m = re.match(r"(\d+d\d+)\+(\d+)", base_roll)
    if m:
        dice = m.group(1)
        const = int(m.group(2)) + stat_value
        return f"{dice}+{const}"
    return base_roll


def format_move(move: dict, atk_stat: int = 0, spatk_stat: int = 0) -> str:
    """Format a single move block. Adds relevant stat to damage roll."""
    lines = [f"## {move['name']}"]
    if move.get("type"):
        lines.append(f"  - {move['type']}")
    if move.get("damage_class"):
        lines.append(f"  - {move['damage_class']}")
    if move.get("damage_base") is not None:
        db = move["damage_base"]
        # Pick relevant stat for roll
        dc = (move.get("damage_class") or "").lower()
        stat = spatk_stat if dc == "special" else atk_stat
        roll = compute_damage_roll(db, stat)
        lines.append(f"  - DB {db}")
        if roll:
            lines.append(f"  - {roll}")
    if move.get("frequency"):
        lines.append(f"  - {move['frequency']}")
    if move.get("ac") is not None:
        lines.append(f"  - AC {move['ac']}")
    if move.get("range"):
        lines.append(f"  - {move['range']}")
    if move.get("effect") and move["effect"].lower() != "none":
        lines.append(f"  - {move['effect']}")
    return "\n".join(lines)


def format_ability(ability: dict) -> str:
    """Format a single ability block."""
    lines = [f"## {ability.get('name', 'Unknown')}"]
    if ability.get("frequency"):
        lines.append(f"  - {ability['frequency']}")
    parts = []
    if ability.get("trigger"):
        parts.append(f"Trigger - {ability['trigger']}.")
    if ability.get("effect"):
        parts.append(ability["effect"])
    if parts:
        lines.append(f"  - {' '.join(parts)}")
    return "\n".join(lines)


def format_pokemon(poke: dict) -> str:
    """Format a full Pokémon dict into the campaign markdown template."""

    name = "Wild " + poke["species"]
    if poke["shiny"]:
        name = "Shiny " + name

    type_str = " / ".join(poke["types"])

    # Stats section
    stat_lines = []
    for key, display in [("hp", "HP"), ("atk", "Attack"), ("def", "Defence"),
                         ("spatk", "Special Attack"), ("spdef", "Special Defense"),
                         ("spd", "Speed")]:
        total = poke["total_stats"][key]
        added = poke["added_stats"][key]
        base = poke["base_stats"][key]
        stat_lines.append(f"  - {display} {total} | {added} | {base}")

    atk = poke["total_stats"]["atk"]
    spatk = poke["total_stats"]["spatk"]

    # Moves
    move_blocks = []
    # Always include Struggle (Physical, uses atk stat)
    struggle_roll = compute_damage_roll(4, atk)
    move_blocks.append(
        f"## Struggle\n"
        f"  - Normal\n"
        f"  - Physical\n"
        f"  - DB 4\n"
        f"  - {struggle_roll}\n"
        f"  - At Will\n"
        f"  - AC 4\n"
        f"  - Melee, 1 Target"
    )
    for move in poke["moves"]:
        move_blocks.append(format_move(move, atk_stat=atk, spatk_stat=spatk))

    # Abilities
    ability_blocks = [format_ability(a) for a in poke["abilities"]]

    # Type effectiveness
    weak_lines = [f"  - {t} {v}" for t, v in poke["type_effectiveness"]["weak"].items()]
    resist_lines = [f"  - {t} {v}" for t, v in poke["type_effectiveness"]["resist"].items()]
    immune_lines = [f"  - {t} {v}" for t, v in poke["type_effectiveness"].get("immune", {}).items()]

    # Capabilities
    caps = poke["capabilities"]
    other_caps = "\n".join(f"  - {c}" for c in caps.get("other", []) if c)

    # Skills — fill all with defaults, override with parsed values
    default_skills = {
        "Acrobatics": "2d6", "Athletics": "2d6", "Charm": "2d6",
        "Combat": "2d6", "Command": "2d6", "General Ed": "1d6",
        "Medicine Ed": "1d6", "Occult Ed": "1d6", "Poké Ed": "1d6",
        "Tech Ed": "1d6", "Focus": "2d6", "Guile": "2d6",
        "Intimidate": "2d6", "Intuition": "2d6", "Perception": "2d6",
        "Stealth": "2d6", "Survival": "2d6",
    }
    skills = dict(default_skills)
    skills.update(poke.get("skills", {}))
    skill_lines = [f"  - {name} {val}" for name, val in skills.items()]

    md = f"""# {name}
  - {poke['species']}
  - Level {poke['level']}
  - {poke['nature']}
  - {type_str}
  - Held Item
    - Description

# Stats
{chr(10).join(stat_lines)}

# Derived Stats

## Health
  - Max {poke['max_hp']}
  - Tick {poke['tick']}
  - DR {poke['dr']}

## Evasion
  - Vs Attack {poke['evasion']['physical']}
  - Vs Special Attack {poke['evasion']['special']}
  - Vs Any {poke['evasion']['speed']}

# Moves
{(chr(10)*2).join(move_blocks)}

# Abilities

{(chr(10)*2).join(ability_blocks)}

# Type Effectiveness

## Weak
{chr(10).join(weak_lines) if weak_lines else '  - None'}

## Resist
{chr(10).join(resist_lines) if resist_lines else '  - None'}"""

    if immune_lines:
        md += f"""

## Immune
{chr(10).join(immune_lines)}"""

    md += f"""

# Capabilities
  - Overland {caps['overland']}
  - Sky {caps['sky']}
  - Swim {caps['swim']}
  - Levitate {caps['levitate']}
  - Burrow {caps['burrow']}
  - Jump {caps['jump']}
  - Power {caps['power']}
  - Weight {poke['weight']}
  - Size {poke['size']}
{other_caps}

# Poke Edges

# Skills
{chr(10).join(skill_lines)}
 
# Misc
## Tutor Points
  - Spent 0
  - Left {poke['tutor_points']}

## Inherited Moves

## Vitamins

"""
    return md
