#!/usr/bin/env python3
"""PTU 1.05 Pokémon generator — core logic ported from ptu-tools (Kotlin)."""

import copy
import math
import random
from typing import Optional


# ─── PTU Natures (PTU 1.05-specific: HP is a stat that natures can affect) ───
# Format: (label, raise_stat, lower_stat)
# raise gives +1 for hp, +2 for others; lower gives -1 for hp, -2 for others
NATURES = [
    ("Cuddly", "hp", "atk"), ("Distracted", "hp", "def"),
    ("Proud", "hp", "spatk"), ("Decisive", "hp", "spdef"),
    ("Patient", "hp", "spd"),
    ("Desperate", "atk", "hp"), ("Lonely", "atk", "def"),
    ("Adamant", "atk", "spatk"), ("Naughty", "atk", "spdef"),
    ("Brave", "atk", "spd"),
    ("Stark", "def", "hp"), ("Bold", "def", "atk"),
    ("Impish", "def", "spatk"), ("Lax", "def", "spdef"),
    ("Relaxed", "def", "spd"),
    ("Curious", "spatk", "hp"), ("Modest", "spatk", "atk"),
    ("Mild", "spatk", "def"), ("Rash", "spatk", "spdef"),
    ("Quiet", "spatk", "spd"),
    ("Dreamy", "spdef", "hp"), ("Calm", "spdef", "atk"),
    ("Gentle", "spdef", "def"), ("Careful", "spdef", "spatk"),
    ("Sassy", "spdef", "spd"),
    ("Skittish", "spd", "hp"), ("Timid", "spd", "atk"),
    ("Hasty", "spd", "def"), ("Jolly", "spd", "spatk"),
    ("Naive", "spd", "spdef"),
    # Neutral natures
    ("Composed", "hp", "hp"), ("Hardy", "atk", "atk"),
    ("Docile", "def", "def"), ("Bashful", "spatk", "spatk"),
    ("Quirky", "spdef", "spdef"), ("Serious", "spd", "spd"),
]

STAT_KEYS = ["hp", "atk", "def", "spatk", "spdef", "spd"]

STAT_DISPLAY = {
    "hp": "HP", "atk": "Attack", "def": "Defence",
    "spatk": "Special Attack", "spdef": "Special Defense", "spd": "Speed"
}

NATURE_STAT_DISPLAY = {
    "hp": "HP", "atk": "Attack", "def": "Defence",
    "spatk": "Special Attack", "spdef": "Special Defense", "spd": "Speed"
}

# ─── Damage base → rolled damage table (PTU 1.05 Useful Charts) ───
DAMAGE_TABLE = {
    1: "1d6+1", 2: "1d6+3", 3: "1d6+5", 4: "1d8+6", 5: "1d8+8",
    6: "2d6+8", 7: "2d6+10", 8: "2d8+10", 9: "2d10+10", 10: "3d8+10",
    11: "3d10+10", 12: "3d12+10", 13: "4d10+10", 14: "4d10+15",
    15: "4d10+20", 16: "5d10+20", 17: "5d12+25", 18: "6d12+25",
    19: "6d12+30", 20: "6d12+35", 21: "6d12+40", 22: "6d12+45",
    23: "6d12+50", 24: "6d12+55", 25: "6d12+60", 26: "7d12+65",
    27: "8d12+70", 28: "8d12+80",
}

# ─── Type effectiveness (defensive, PTU style: 1.5 = super-effective) ───
TYPE_CHART = {
    "Bug":      {"Normal":1.0,"Fire":1.5,"Water":1.0,"Electric":1.0,"Grass":0.5,"Ice":1.0,"Fighting":0.5,"Poison":1.0,"Ground":0.5,"Flying":1.5,"Psychic":1.0,"Bug":1.0,"Rock":1.5,"Ghost":1.0,"Dragon":1.0,"Dark":1.0,"Steel":1.0,"Fairy":1.0},
    "Dark":     {"Normal":1.0,"Fire":1.0,"Water":1.0,"Electric":1.0,"Grass":1.0,"Ice":1.0,"Fighting":1.5,"Poison":1.0,"Ground":1.0,"Flying":1.0,"Psychic":0.0,"Bug":1.5,"Rock":1.0,"Ghost":0.5,"Dragon":1.0,"Dark":0.5,"Steel":1.0,"Fairy":1.5},
    "Dragon":   {"Normal":1.0,"Fire":0.5,"Water":0.5,"Electric":0.5,"Grass":0.5,"Ice":1.5,"Fighting":1.0,"Poison":1.0,"Ground":1.0,"Flying":1.0,"Psychic":1.0,"Bug":1.0,"Rock":1.0,"Ghost":1.0,"Dragon":1.5,"Dark":1.0,"Steel":1.0,"Fairy":1.5},
    "Electric": {"Normal":1.0,"Fire":1.0,"Water":1.0,"Electric":0.5,"Grass":1.0,"Ice":1.0,"Fighting":1.0,"Poison":1.0,"Ground":1.5,"Flying":0.5,"Psychic":1.0,"Bug":1.0,"Rock":1.0,"Ghost":1.0,"Dragon":1.0,"Dark":1.0,"Steel":0.5,"Fairy":1.0},
    "Fairy":    {"Normal":1.0,"Fire":1.0,"Water":1.0,"Electric":1.0,"Grass":1.0,"Ice":1.0,"Fighting":0.5,"Poison":1.5,"Ground":1.0,"Flying":1.0,"Psychic":1.0,"Bug":0.5,"Rock":1.0,"Ghost":1.0,"Dragon":0.0,"Dark":0.5,"Steel":1.5,"Fairy":1.0},
    "Fighting": {"Normal":1.0,"Fire":1.0,"Water":1.0,"Electric":1.0,"Grass":1.0,"Ice":1.0,"Fighting":1.0,"Poison":1.0,"Ground":1.0,"Flying":1.5,"Psychic":1.5,"Bug":0.5,"Rock":0.5,"Ghost":1.0,"Dragon":1.0,"Dark":0.5,"Steel":1.0,"Fairy":1.5},
    "Fire":     {"Normal":1.0,"Fire":0.5,"Water":1.5,"Electric":1.0,"Grass":0.5,"Ice":0.5,"Fighting":1.0,"Poison":1.0,"Ground":1.5,"Flying":1.0,"Psychic":1.0,"Bug":0.5,"Rock":1.5,"Ghost":1.0,"Dragon":1.0,"Dark":1.0,"Steel":0.5,"Fairy":0.5},
    "Flying":   {"Normal":1.0,"Fire":1.0,"Water":1.0,"Electric":1.5,"Grass":0.5,"Ice":1.5,"Fighting":0.5,"Poison":1.0,"Ground":1.0,"Flying":1.0,"Psychic":1.0,"Bug":0.5,"Rock":1.5,"Ghost":1.0,"Dragon":1.0,"Dark":1.0,"Steel":1.0,"Fairy":1.0},
    "Ghost":    {"Normal":0.0,"Fire":1.0,"Water":1.0,"Electric":1.0,"Grass":1.0,"Ice":1.0,"Fighting":0.0,"Poison":0.5,"Ground":1.0,"Flying":1.0,"Psychic":1.0,"Bug":0.5,"Rock":1.0,"Ghost":1.5,"Dragon":1.0,"Dark":1.5,"Steel":1.0,"Fairy":1.0},
    "Grass":    {"Normal":1.0,"Fire":1.5,"Water":0.5,"Electric":0.5,"Grass":0.5,"Ice":1.5,"Fighting":1.0,"Poison":1.5,"Ground":0.5,"Flying":1.5,"Psychic":1.0,"Bug":1.5,"Rock":1.0,"Ghost":1.0,"Dragon":1.0,"Dark":1.0,"Steel":1.0,"Fairy":1.0},
    "Ground":   {"Normal":1.0,"Fire":1.0,"Water":1.5,"Electric":0.0,"Grass":1.5,"Ice":1.5,"Fighting":1.0,"Poison":0.5,"Ground":1.0,"Flying":1.0,"Psychic":1.0,"Bug":1.0,"Rock":0.5,"Ghost":1.0,"Dragon":1.0,"Dark":1.0,"Steel":1.0,"Fairy":1.0},
    "Ice":      {"Normal":1.0,"Fire":1.5,"Water":1.0,"Electric":1.0,"Grass":1.0,"Ice":0.5,"Fighting":1.5,"Poison":1.0,"Ground":1.0,"Flying":1.0,"Psychic":1.0,"Bug":1.0,"Rock":1.5,"Ghost":1.0,"Dragon":1.0,"Dark":1.0,"Steel":1.5,"Fairy":1.0},
    "Normal":   {"Normal":1.0,"Fire":1.0,"Water":1.0,"Electric":1.0,"Grass":1.0,"Ice":1.0,"Fighting":1.5,"Poison":1.0,"Ground":1.0,"Flying":1.0,"Psychic":1.0,"Bug":1.0,"Rock":1.0,"Ghost":0.0,"Dragon":1.0,"Dark":1.0,"Steel":1.0,"Fairy":1.0},
    "Poison":   {"Normal":1.0,"Fire":1.0,"Water":1.0,"Electric":1.0,"Grass":0.5,"Ice":1.0,"Fighting":0.5,"Poison":0.5,"Ground":1.5,"Flying":1.0,"Psychic":1.5,"Bug":0.5,"Rock":1.0,"Ghost":1.0,"Dragon":1.0,"Dark":1.0,"Steel":1.0,"Fairy":0.5},
    "Psychic":  {"Normal":1.0,"Fire":1.0,"Water":1.0,"Electric":1.0,"Grass":1.0,"Ice":1.0,"Fighting":0.5,"Poison":1.0,"Ground":1.0,"Flying":1.0,"Psychic":0.5,"Bug":1.5,"Rock":1.0,"Ghost":1.5,"Dragon":1.0,"Dark":1.5,"Steel":1.0,"Fairy":1.0},
    "Rock":     {"Normal":0.5,"Fire":0.5,"Water":1.5,"Electric":1.0,"Grass":1.5,"Ice":1.0,"Fighting":1.5,"Poison":0.5,"Ground":1.5,"Flying":0.5,"Psychic":1.0,"Bug":1.0,"Rock":1.0,"Ghost":1.0,"Dragon":1.0,"Dark":1.0,"Steel":1.5,"Fairy":1.0},
    "Steel":    {"Normal":0.5,"Fire":1.5,"Water":1.0,"Electric":1.0,"Grass":0.5,"Ice":0.5,"Fighting":1.5,"Poison":0.0,"Ground":1.5,"Flying":0.5,"Psychic":0.5,"Bug":0.5,"Rock":0.5,"Ghost":1.0,"Dragon":0.5,"Dark":1.0,"Steel":0.5,"Fairy":0.5},
    "Water":    {"Normal":1.0,"Fire":0.5,"Water":0.5,"Electric":1.5,"Grass":1.5,"Ice":0.5,"Fighting":1.0,"Poison":1.0,"Ground":1.0,"Flying":1.0,"Psychic":1.0,"Bug":1.0,"Rock":1.0,"Ghost":1.0,"Dragon":1.0,"Dark":1.0,"Steel":0.5,"Fairy":1.0},
}

ALL_TYPES = list(TYPE_CHART.keys())


def get_type_effectiveness(defender_types: list[str]) -> dict[str, float]:
    """Compute defensive effectiveness for each attacking type against the defender.
    PTU dual-type rules: multiply per-type multipliers, then compress:
      >2.0 → log2, 2.0 → 1.5, rest stays.
    """
    results = {}
    for atk_type in ALL_TYPES:
        total = 1.0
        for def_type in defender_types:
            chart = TYPE_CHART.get(def_type, {})
            mult = chart.get(atk_type, 1.0)
            # PTU uses 1.5 in its chart but standard calc multiplies as 2.0
            if mult == 1.5:
                mult = 2.0
            total *= mult
        # Compress
        if total > 2.0:
            total = math.log2(total)
        elif total == 2.0:
            total = 1.5
        results[atk_type] = total
    return results


def apply_nature(base_stats: dict[str, int], nature_tuple: tuple) -> dict[str, int]:
    """Apply nature modifiers to base stats. Returns modified copy."""
    stats = dict(base_stats)
    label, raise_stat, lower_stat = nature_tuple
    # Raise: +1 for HP, +2 for others
    stats[raise_stat] += 1 if raise_stat == "hp" else 2
    # Lower: -1 for HP, -2 for others
    stats[lower_stat] -= 1 if lower_stat == "hp" else 2
    # Minimum 1
    for k in STAT_KEYS:
        if stats[k] < 1:
            stats[k] = 1
    return stats


def randomize_stats(base_stats: dict[str, int], level: int) -> dict[str, int]:
    """Distribute level-up stat points following PTU base-stat-relation rules.

    Returns dict of added points per stat.
    """
    added = {k: 0 for k in STAT_KEYS}
    total_points = 10 + level

    # Sort stats by base value to enforce base-stat-relation rule
    sorted_bases = sorted(base_stats.items(), key=lambda x: x[1])

    for _ in range(total_points):
        can_add_to = []
        for stat_name, stat_base in sorted_bases:
            current = base_stats[stat_name] + added[stat_name]
            is_addable = True
            for other_name, other_base in sorted_bases:
                other_current = base_stats[other_name] + added[other_name]
                # A stat with lower base cannot equal or exceed a stat with higher base
                if stat_base < other_base and current + 1 >= other_current:
                    is_addable = False
                    break
            if is_addable:
                can_add_to.append(stat_name)

        if not can_add_to:
            # Fallback: add to any stat (shouldn't normally happen)
            can_add_to = list(STAT_KEYS)

        chosen = random.choice(can_add_to)
        added[chosen] += 1

    return added


def pick_nature(requested: Optional[str] = None) -> tuple:
    if requested:
        for n in NATURES:
            if n[0].lower() == requested.lower():
                return n
    return random.choice(NATURES)


def pick_gender(entry: dict) -> str:
    if entry["genderless"]:
        return "No Gender"
    if random.random() * 100 <= (entry["male_pct"] or 0):
        return "Male"
    return "Female"


def pick_moves(entry: dict, level: int, moves_db: dict, max_moves: int = 6) -> list[dict]:
    """Pick random level-up moves the Pokémon can know at this level."""
    available = [m for m in entry["level_up_moves"] if m["level"] <= level]
    if not available:
        return []

    random.shuffle(available)
    chosen_names = []
    chosen = []
    for m in available:
        if len(chosen_names) >= max_moves:
            break
        if m["name"] not in chosen_names:
            chosen_names.append(m["name"])
            chosen.append(m)

    result = []
    for m in chosen:
        move_data = moves_db.get(m["name"])
        if move_data:
            md = dict(move_data)
            # Apply STAB: +2 DB if type matches
            if md.get("damage_base") and md.get("type") in entry["types"]:
                md["stab"] = True
                md["damage_base"] += 2
                # Update damage roll string
                db = md["damage_base"]
                md["damage_roll"] = DAMAGE_TABLE.get(db, md.get("damage_roll", ""))
            else:
                md["stab"] = False
            result.append(md)
        else:
            # Move not in DB — include with basic info from pokedex
            result.append({
                "name": m["name"], "type": m.get("type", "Normal"),
                "frequency": "At-Will", "ac": 2, "damage_base": None,
                "damage_class": "Status", "range": "Melee, 1 Target",
                "effect": "", "stab": False,
            })

    return result


def _lookup_ability(name: str, abilities_db: dict) -> dict:
    """Look up an ability by name, with fallbacks for pokedex aliases.

    The pokedex markdown uses several name variants that don't match the
    canonical entries in abilities.json:
      - 'Pick Up' vs 'Pickup' (spacing)
      - 'Type Aura (Water)' vs 'Type Aura' (parenthetical suffix)
      - 'Drought / Drizzle' / 'Light Metal or Heavy Metal' (split names)
      - 'Serpent's Mark*' (trailing asterisk)
      - typos like 'Glutony', 'Overtcoat', 'Telapathy' (fuzzy match)
    """
    import difflib

    def try_key(key):
        if not key:
            return None
        if key in abilities_db:
            return abilities_db[key]
        lower = key.lower()
        for k in abilities_db:
            if k.lower() == lower:
                return abilities_db[k]
        collapsed = key.replace(" ", "").lower()
        for k in abilities_db:
            if k.replace(" ", "").lower() == collapsed:
                return abilities_db[k]
        return None

    # Exact / case-insensitive / space-insensitive.
    hit = try_key(name)
    if hit:
        return hit

    # Strip trailing '*' (errata marker in some dex entries).
    cleaned = name.rstrip("*").strip()
    if cleaned != name:
        hit = try_key(cleaned)
        if hit:
            return hit

    # Strip parenthetical suffix: 'Type Aura (Water)' -> 'Type Aura'.
    paren = cleaned.split("(", 1)[0].strip()
    if paren and paren != cleaned:
        hit = try_key(paren)
        if hit:
            return hit

    # Split names: 'Drought / Drizzle' / 'Light Metal or Heavy Metal'.
    for sep in (" / ", "/", " or "):
        if sep in cleaned:
            for part in cleaned.split(sep):
                hit = try_key(part.strip())
                if hit:
                    return hit
            break

    # Fuzzy match as last resort (catches typos like 'Glutony', 'Telapathy').
    close = difflib.get_close_matches(cleaned, list(abilities_db.keys()),
                                      n=1, cutoff=0.86)
    if close:
        return abilities_db[close[0]]

    return {"name": name}


def pick_abilities(entry: dict, level: int, abilities_db: dict) -> list[dict]:
    """Pick abilities based on level thresholds (PTU 1.05 rules)."""
    used = []
    result = []

    basic = entry["abilities"]["basic"]
    advanced = entry["abilities"]["advanced"]
    high = entry["abilities"]["high"]

    if not basic:
        return result

    # 1st ability: random basic
    choice = random.choice(basic)
    used.append(choice)
    result.append(dict(_lookup_ability(choice, abilities_db)))

    # 2nd ability at level 20+: basic + advanced
    if level >= 20:
        pool = [a for a in basic + advanced if a not in used]
        if pool:
            choice = random.choice(pool)
            used.append(choice)
            result.append(dict(_lookup_ability(choice, abilities_db)))

    # 3rd ability at level 40+: basic + advanced + high
    if level >= 40:
        pool = [a for a in basic + advanced + high if a not in used]
        if pool:
            choice = random.choice(pool)
            used.append(choice)
            result.append(dict(_lookup_ability(choice, abilities_db)))

    return result


def compute_health(level: int, hp_total: int) -> int:
    """PTU health = level + (HP stat total × 3) + 10."""
    return level + (hp_total * 3) + 10


def compute_evasion(def_total: int, spdef_total: int, spd_total: int) -> dict:
    """PTU evasion = stat_total // 5 (physical=def, special=spdef, speed=spd)."""
    return {
        "physical": def_total // 5,
        "special": spdef_total // 5,
        "speed": spd_total // 5,
    }


def generate_pokemon(
    entry: dict,
    level: int,
    moves_db: dict,
    abilities_db: dict,
    nature: Optional[str] = None,
    shiny_odds: float = 0.0,
) -> dict:
    """Generate a full PTU 1.05 Pokémon."""
    entry = copy.deepcopy(entry)

    # Nature
    nature_tuple = pick_nature(nature)
    nature_label = nature_tuple[0]

    # Apply nature to base stats
    natured_stats = apply_nature(entry["base_stats"], nature_tuple)

    # Distribute level-up points
    added = randomize_stats(natured_stats, level)

    # Compute totals
    totals = {k: natured_stats[k] + added[k] for k in STAT_KEYS}

    # Gender
    gender = pick_gender(entry)

    # Shiny
    shiny = random.random() * 100 <= shiny_odds

    # Health
    max_hp = compute_health(level, totals["hp"])
    tick = max(max_hp // 10, 1)

    # Evasion
    evasion = compute_evasion(totals["def"], totals["spdef"], totals["spd"])

    # Abilities — check for Cluster Mind (8 moves instead of 6)
    abilities = pick_abilities(entry, level, abilities_db)
    max_moves = 8 if any(a.get("name") == "Cluster Mind" for a in abilities) else 6
    moves = pick_moves(entry, level, moves_db, max_moves)

    # Tutor points
    tutor_points = round(math.floor(level / 5.0) + 1)

    # Type effectiveness
    type_eff = get_type_effectiveness(entry["types"])
    weak = {t: v for t, v in sorted(type_eff.items()) if v > 1.0}
    resist = {t: v for t, v in sorted(type_eff.items()) if 0 < v < 1.0}
    immune = {t: v for t, v in sorted(type_eff.items()) if v == 0.0}

    # Nature display string
    raise_stat = nature_tuple[1]
    lower_stat = nature_tuple[2]
    raise_amt = "+1" if raise_stat == "hp" else "+2"
    lower_amt = "-1" if lower_stat == "hp" else "-2"
    if raise_stat == lower_stat:
        nature_display = nature_label
    else:
        nature_display = f"{nature_label} ({raise_amt} {NATURE_STAT_DISPLAY[raise_stat]}, {lower_amt} {NATURE_STAT_DISPLAY[lower_stat]})"

    return {
        "species": entry["species"],
        "level": level,
        "nature": nature_display,
        "nature_label": nature_label,
        "types": entry["types"],
        "gender": gender,
        "shiny": shiny,
        "base_stats": natured_stats,
        "added_stats": added,
        "total_stats": totals,
        "max_hp": max_hp,
        "tick": tick,
        "dr": 0,
        "evasion": evasion,
        "moves": moves,
        "abilities": abilities,
        "type_effectiveness": {"weak": weak, "resist": resist, "immune": immune},
        "capabilities": entry["capabilities"],
        "size": entry["size"],
        "weight": entry["weight"],
        "skills": entry["skills"],
        "tutor_points": tutor_points,
        "evolutions_remaining": entry["evolutions_remaining"],
    }
