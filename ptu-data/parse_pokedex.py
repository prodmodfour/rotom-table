#!/usr/bin/env python3
"""Parse PTU 1.05 pokedex markdown files into a JSON data cache."""

import json
import os
import re
import sys
import unicodedata

POKEDEX_DIR = os.path.join(os.path.dirname(__file__), "..", "books", "markdown", "pokedexes")
CACHE_DIR = os.path.join(os.path.dirname(__file__), "data")
PLACEMENT_FIELDS = ("species", "size", "width", "height", "base", "clearance")


def normalize_species_name(value: str) -> str:
    value = unicodedata.normalize("NFKD", value).casefold()
    return "".join(char for char in value if char.isalnum())


def load_existing_pokedex(path: str) -> list[dict]:
    if not os.path.exists(path):
        return []
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return data if isinstance(data, list) else []


def merge_existing_placement_data(parsed_pokemon: list[dict], existing_pokemon: list[dict]) -> list[dict]:
    existing_by_species = {}
    for entry in existing_pokemon:
        species = entry.get("species")
        if not species:
            continue
        existing_by_species[normalize_species_name(species)] = entry

    merged = []
    used_keys = set()

    for entry in parsed_pokemon:
        normalized_species = normalize_species_name(entry["species"])
        existing = existing_by_species.get(normalized_species)
        if not existing:
            merged.append(entry)
            continue

        merged_entry = dict(entry)
        for field in PLACEMENT_FIELDS:
            if field in existing and existing[field] is not None:
                merged_entry[field] = existing[field]
        merged.append(merged_entry)
        used_keys.add(normalized_species)

    for normalized_species, entry in existing_by_species.items():
        if normalized_species in used_keys:
            continue
        if not any(entry.get(field) is not None for field in PLACEMENT_FIELDS if field != "species"):
            continue
        merged.append(entry)

    return merged


def parse_base_stats(text: str) -> dict[str, int]:
    """Parse base stats — value may be on the same line or the next line."""
    stats = {}
    key_map = {
        "HP": "hp", "Attack": "atk", "Defense": "def",
        "Special Attack": "spatk", "Special Defense": "spdef", "Speed": "spd"
    }
    # Match stat labels followed by the number (possibly on next line after tabs/spaces)
    for label, key in key_map.items():
        # Pattern: label, colon/tabs, optional whitespace/newlines, then the number
        pattern = rf"{re.escape(label)}\s*[:\t]+\s*(\d+)"
        m = re.search(pattern, text)
        if m:
            stats[key] = int(m.group(1))
            continue
        # Try multi-line: label on one line, number on the next (possibly with tabs between)
        pattern2 = rf"{re.escape(label)}\s*:?[\t ]*\n[\t ]*(\d+)"
        m = re.search(pattern2, text)
        if m:
            stats[key] = int(m.group(1))
    return stats


def parse_type(text: str) -> list[str]:
    m = re.search(r"Type\s*:\s*(.+)", text)
    if not m:
        return []
    raw = m.group(1).strip()
    return [t.strip() for t in raw.split("/")]


def parse_abilities(text: str) -> dict:
    result = {"basic": [], "advanced": [], "high": []}
    for line in text.splitlines():
        line = line.strip()
        m = re.match(r"Basic Ability \d+:\s*(.+)", line)
        if m:
            result["basic"].append(m.group(1).strip())
            continue
        m = re.match(r"Adv Ability \d+:\s*(.+)", line)
        if m:
            result["advanced"].append(m.group(1).strip())
            continue
        m = re.match(r"High Ability:\s*(.+)", line)
        if m:
            result["high"].append(m.group(1).strip())
    return result


# Common evolution condition keywords to strip from species names
EVO_CONDITIONS = [
    "Water Stone", "Fire Stone", "Leaf Stone", "Thunder Stone", "Moon Stone",
    "Sun Stone", "Dusk Stone", "Dawn Stone", "Shiny Stone", "Ice Stone",
    "Oval Stone", "King's Rock", "Metal Coat", "Dragon Scale", "Up-Grade",
    "Dubious Disc", "Electirizer", "Magmarizer", "Protector", "Reaper Cloth",
    "Razor Claw", "Razor Fang", "Prism Scale", "Deep Sea Tooth", "Deep Sea Scale",
    "Link Cable", "Trade", "Happiness", "Shedinja",
]


def parse_evolution(text: str) -> list[dict]:
    evos = []
    in_evo = False
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("Evolution:"):
            in_evo = True
            continue
        if in_evo:
            m = re.match(r"(\d+)\s*-\s*(.+)", line)
            if m:
                stage = int(m.group(1))
                rest = m.group(2).strip()
                # Parse min level if present
                ml = re.search(r"Minimum\s+(\d+)", rest)
                min_level = int(ml.group(1)) if ml else 0
                species = re.sub(r"\s*Minimum\s+\d+", "", rest).strip()
                # Strip evolution condition keywords from species name
                for cond in EVO_CONDITIONS:
                    species = re.sub(rf"\s+{re.escape(cond)}\b", "", species, flags=re.IGNORECASE).strip()
                evos.append({"stage": stage, "species": species, "min_level": min_level})
            elif evos:
                # Line after evo block
                break
    return evos


def parse_size_weight(text: str) -> dict:
    result = {"size": "Medium", "weight": 1}
    m = re.search(r"Height\s*:\s*.+?\((\w+)\)", text)
    if m:
        result["size"] = m.group(1)
    m = re.search(r"Weight\s*:\s*.+?\((\d+)\)", text)
    if m:
        result["weight"] = int(m.group(1))
    return result


def parse_gender(text: str) -> dict:
    result = {"genderless": True, "male_pct": None, "female_pct": None}
    m = re.search(r"Gender Ratio\s*:\s*([\d.]+)%\s*M\s*/\s*([\d.]+)%\s*F", text)
    if m:
        result["genderless"] = False
        result["male_pct"] = float(m.group(1))
        result["female_pct"] = float(m.group(2))
    # Check for "No Gender" or "Genderless"
    if re.search(r"(No Gender|Genderless)", text):
        result["genderless"] = True
        result["male_pct"] = None
        result["female_pct"] = None
    return result


def parse_capabilities(text: str) -> dict:
    result = {"overland": 0, "sky": 0, "swim": 0, "levitate": 0, "burrow": 0,
              "jump": "0/0", "power": 0, "other": []}
    cap_section = ""
    m = re.search(r"Capability List\s*\n([\s\S]+?)(?:Skill List|$)", text)
    if m:
        cap_section = m.group(1).replace("\n", " ").replace("­", "").strip()
        # Fix soft-hyphen-split words: "Mount able" → "Mountable"
        cap_section = re.sub(r'([a-z]) ([a-z])', r'\1\2', cap_section)

    for key in ["Overland", "Sky", "Swim", "Levitate", "Burrow", "Power"]:
        mp = re.search(rf"{key}\s+(\d+)", cap_section)
        if mp:
            result[key.lower()] = int(mp.group(1))

    jm = re.search(r"Jump\s+(\d+/\d+)", cap_section)
    if jm:
        result["jump"] = jm.group(1)

    # Other capabilities (Naturewalk, Firestarter, etc.)
    # Remove known numeric caps and collect the rest
    cleaned = cap_section
    for key in ["Overland", "Sky", "Swim", "Levitate", "Burrow", "Power"]:
        cleaned = re.sub(rf"{key}\s+\d+,?\s*", "", cleaned)
    cleaned = re.sub(r"Jump\s+\d+/\d+,?\s*", "", cleaned)
    # Split on commas but not within parentheses
    parts = re.split(r",\s*(?![^()]*\))", cleaned)
    others = [c.strip().rstrip(",") for c in parts if c.strip()]
    result["other"] = [o for o in others if o]
    return result


def parse_skills(text: str) -> dict:
    skills = {}
    m = re.search(r"Skill List\s*\n([\s\S]+?)(?:Move List|$)", text)
    if not m:
        return skills
    skill_text = m.group(1).replace("\n", " ").replace("­", "").strip()

    skill_map = {
        "Athl": "Athletics", "Acro": "Acrobatics", "Combat": "Combat",
        "Stealth": "Stealth", "Percep": "Perception", "Focus": "Focus",
        "Charm": "Charm", "Command": "Command", "Guile": "Guile",
        "Intimidate": "Intimidate", "Intuition": "Intuition",
        "Gen Ed": "General Ed", "Medicine Ed": "Medicine Ed",
        "Occult Ed": "Occult Ed", "Poké Ed": "Poké Ed", "Poke Ed": "Poké Ed",
        "Tech Ed": "Tech Ed", "Survival": "Survival",
    }

    for abbr, full in skill_map.items():
        pattern = rf"{re.escape(abbr)}\s+([\dd+]+(?:\+\d+)?)"
        sm = re.search(pattern, skill_text)
        if sm:
            skills[full] = sm.group(1)

    return skills


def parse_level_up_moves(text: str) -> list[dict]:
    moves = []
    m = re.search(r"Level Up Move List\s*\n([\s\S]+?)(?:TM/HM Move List|Egg Move List|Tutor Move List|$)", text)
    if not m:
        return moves
    for line in m.group(1).splitlines():
        line = line.strip()
        mm = re.match(r"(\d+)\s+(.+?)\s*-\s*(\w+)\s*$", line)
        if mm:
            moves.append({
                "level": int(mm.group(1)),
                "name": mm.group(2).strip(),
                "type": mm.group(3).strip()
            })
    return moves


def parse_pokemon_file(filepath: str) -> dict | None:
    with open(filepath, "r", encoding="utf-8") as f:
        text = f.read()

    # Extract species name: first ALL-CAPS word on its own line, optionally
    # followed by a form suffix like "Zero", "Hero", "Solo", "Galar Zen-Mode", etc.
    # Examples matched:
    #   SMOLIV
    #   PALAFIN Zero
    #   WISHIWASHI Solo
    #   DARMANITAN Galar Zen-Mode
    #   FARFETCH'D
    species_match = re.search(
        r"^\s*([A-ZÉ][A-ZÉ\-'♀♂.:0-9]*(?:\s+[A-ZÉ][A-Za-zÉé\-']*)*)\s*$",
        text,
        re.MULTILINE,
    )
    if not species_match:
        return None
    species = species_match.group(1).strip()
    # Title-case it, but preserve inner capitalization of already-mixed-case form
    # suffixes. We only title-case the leading all-caps word.
    parts = species.split()
    parts[0] = parts[0].title()
    species = " ".join(parts).replace("'S", "'s")

    base_stats = parse_base_stats(text)
    if not base_stats or len(base_stats) < 6:
        return None

    types = parse_type(text)
    abilities = parse_abilities(text)
    evolutions = parse_evolution(text)
    size_weight = parse_size_weight(text)
    gender = parse_gender(text)
    capabilities = parse_capabilities(text)
    skills = parse_skills(text)
    level_up_moves = parse_level_up_moves(text)

    # Determine evolution stage for this species
    evo_stage = 1
    for evo in evolutions:
        if evo["species"].lower() == species.lower():
            evo_stage = evo["stage"]
            break

    # Determine evolutions remaining
    max_stage = max((e["stage"] for e in evolutions), default=1)
    evolutions_remaining = max_stage - evo_stage

    return {
        "species": species,
        "types": types,
        "base_stats": base_stats,
        "abilities": abilities,
        "evolutions": evolutions,
        "evolution_stage": evo_stage,
        "evolutions_remaining": evolutions_remaining,
        "size": size_weight["size"],
        "weight": size_weight["weight"],
        "genderless": gender["genderless"],
        "male_pct": gender["male_pct"],
        "female_pct": gender["female_pct"],
        "capabilities": capabilities,
        "skills": skills,
        "level_up_moves": level_up_moves,
    }


def parse_all_pokedexes() -> list[dict]:
    all_pokemon = []
    for gen_dir in sorted(os.listdir(POKEDEX_DIR)):
        gen_path = os.path.join(POKEDEX_DIR, gen_dir)
        if not os.path.isdir(gen_path) or gen_dir == ".":
            continue
        for fname in sorted(os.listdir(gen_path)):
            if not fname.endswith(".md"):
                continue
            filepath = os.path.join(gen_path, fname)
            entry = parse_pokemon_file(filepath)
            if entry:
                entry["source_gen"] = gen_dir
                all_pokemon.append(entry)
            else:
                print(f"  WARN: Could not parse {filepath}", file=sys.stderr)
    return all_pokemon


def build_cache():
    os.makedirs(CACHE_DIR, exist_ok=True)
    print("Parsing pokedex entries...")
    parsed_pokemon = parse_all_pokedexes()
    out_path = os.path.join(CACHE_DIR, "pokedex.json")
    existing_pokemon = load_existing_pokedex(out_path)
    pokemon = merge_existing_placement_data(parsed_pokemon, existing_pokemon)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(pokemon, f, indent=2, ensure_ascii=False)
    print(f"Wrote {len(pokemon)} entries to {out_path}")
    return pokemon


if __name__ == "__main__":
    build_cache()
