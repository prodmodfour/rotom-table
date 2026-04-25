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

# Anchors that can appear after a move section. Used to bound TM/HM, Egg and
# Tutor move list extraction so that following sections (Mega Evolution stat
# blocks, Forme Change blurbs, page footers, etc.) don't bleed into the lists.
MOVE_SECTION_TERMINATORS = (
    r"Egg Move List",
    r"Tutor Move List",
    r"Mega Evolution",
    r"Forme? Change",
    r"Form Information",
    r"Forme Information",
    r"Z-Move",
    r"G-Max",
    r"Gigantamax",
    r"Eternamax",
    r"Notes\s*:",
    r"Hidden Power\s*:",
    r"Special\s+Ability",
    r"Misc\.",
    r"##\s*Page",
)


# ---------------------------------------------------------------------------
# Move + ability name normalisation
#
# The pokedex markdown introduces a lot of small artifacts when the source PDF
# wraps long lines, mis-spells things, or bleeds descriptive text into a list:
#
#   * "Power- Up Punch"  → "Power-Up Punch"  (line wrap put a space after the hyphen)
#   * "Bubblebeam"        → "Bubble Beam"     (older spelling)
#   * "§ V-Create"        → "V-Create"        (footnote glyph never stripped)
#   * "+5 Speed"          → dropped           (stat-bonus pseudo-move)
#   * "Off"               → dropped           ("Knock Off" half that lost its partner)
#   * "Mew can be Tutored to learn any Move" → dropped (sentence, not a move)
#
# Ability strings have their own quirks: typos (Glutony, Telapathy, Wonderguard),
# alternative-ability separators ("Drought / Drizzle"), and footnote markers (*).
# ---------------------------------------------------------------------------

MOVE_NAME_FIXES: dict[str, str] = {
    "Bubblebeam":     "Bubble Beam",
    "Solarbeam":      "Solar Beam",
    "FirePunch":      "Fire Punch",
    "Roleplay":       "Role Play",
    "Vicegrip":       "Vice Grip",
    "Mud-Shot":       "Mud Shot",
    "Hi Jump Kick":   "High Jump Kick",
    "Zen Heabutt":    "Zen Headbutt",
    "Double-Hit":     "Double Hit",
    "Double Chop":    "Dual Chop",
    "Flame charge":   "Flame Charge",
    "Will-o-Wisp":    "Will-O-Wisp",
    "Will-O-wisp":    "Will-O-Wisp",
    "U-turn":         "U-Turn",
    "Double Edge":    "Double-Edge",
}

# Tokens that are clearly never a move name (single-word leftovers from
# descriptive text bleeding into tutor lists, or partial fragments such as
# the orphaned ``Knock`` from a wrapped ``Knock Off``).
MOVE_NAME_REJECT: frozenset[str] = frozenset({
    "Off", "Nature", "Capabilities", "Abilities", "Size", "Types",
    "Skill List", "None", "Power 2", "Jump 1/1", "Swim 2", "Levitate 6",
    "Telepath", "Telekinetic", "Firestarter", "Knock", "Cringe",
    "Wise Guard",
})


def normalize_move_name(raw: str | None) -> str | None:
    """Clean a move name from the pokedex markdown.

    Returns the normalised name, or ``None`` if the value is junk that should
    be dropped entirely (sentence-length text, stat-bonus pseudo-moves, known
    descriptive-text leftovers).
    """
    if raw is None:
        return None
    name = raw.strip()
    if not name:
        return None
    # Strip leading bullet/footnote glyphs (``§``, ``•``, ``·``, leading ``*``).
    name = re.sub(r"^[§•·*]+\s*", "", name).strip()
    if not name:
        return None
    # Strip Meowstic-style gender prefix (``(M) Mean Look`` → ``Mean Look``).
    name = re.sub(r"^\([MF]\)\s*", "", name).strip()
    # Stat-bonus pseudo-moves like ``+5 Speed`` or ``-1 Sp. Def`` are not moves.
    if re.match(r"^[-+]\d", name):
        return None
    # Real move names never contain prose punctuation. Anything containing
    # ``.``, ``,``, ``;`` or stray parens is a sentence fragment that bled in
    # from a Notes / Forme / Homebrew block.
    if any(ch in name for ch in ".,;()"):
        return None
    # Sentence-length: anything past 25 chars is bleed-in text from a Mega/
    # Forme/Notes block, never a real move name. The longest real PTU move
    # name is 16 chars (e.g. "Springtide Storm").
    if len(name) > 25:
        return None

    # Normalisation: collapse spaces, repair hyphen artifacts, title-case
    # first-word-lowercase patterns ("fire Punch" → "Fire Punch").
    name = re.sub(r"\s+", " ", name)
    name = re.sub(r"\s*-\s*", "-", name)
    parts = name.split(" ")
    if (
        parts
        and parts[0]
        and parts[0][0].islower()
        and len(parts) > 1
        and parts[1][:1].isupper()
    ):
        parts[0] = parts[0].capitalize()
        name = " ".join(parts)
    name = MOVE_NAME_FIXES.get(name, name)

    # Post-normalisation rejection. Sentence-y connector words never appear
    # in real PTU move names (the only real prepositional moves are
    # ``Roar of Time``, ``Light of Ruin``, ``Trick-or-Treat`` — ``of`` /
    # ``or`` only).
    SENTENCE_WORDS = {"is", "the", "to", "if", "and", "for", "by",
                      "from", "with", "at", "an"}
    tokens = {tok.lower() for tok in re.split(r"[\s\-]+", name) if tok}
    if tokens & SENTENCE_WORDS:
        return None
    # First character must be uppercase — real moves are always Title Case.
    if name and name[0].islower():
        return None
    if name in MOVE_NAME_REJECT:
        return None
    return name


ABILITY_NAME_FIXES: dict[str, str] = {
    "Exploitw":             "Exploit",
    "Glutony":              "Gluttony",
    "Overgrowth":           "Overgrow",
    "Overtcoat":            "Overcoat",
    "Pick Up":              "Pickup",
    "Probablity Control":   "Probability Control",
    "Sandstream":           "Sand Stream",
    "Spining Dance":        "Spinning Dance",
    "Telapathy":            "Telepathy",
    "Unnnerve":             "Unnerve",
    "Wonderguard":          "Wonder Guard",
}


def normalize_ability_name(raw: str) -> str:
    """Strip footnote markers and apply the ability typo-fix table."""
    name = raw.strip().rstrip("*").strip()
    name = re.sub(r"\s+", " ", name)
    return ABILITY_NAME_FIXES.get(name, name)


def split_ability_alternates(raw: str) -> list[str]:
    """Split ``Drought / Drizzle`` or ``Light Metal or Heavy Metal`` into a
    list of separate ability names. Returns ``[raw]`` unchanged if no
    separator is present.
    """
    parts = re.split(r"\s+/\s+|\s+or\s+", raw)
    cleaned = [p.strip() for p in parts if p.strip()]
    return cleaned if len(cleaned) > 1 else [raw]


def _strip_soft_hyphens(value: str) -> str:
    """Drop typeset soft hyphens (incl. across line breaks) and noise glyphs.

    The PDF→markdown export inserts U+00AD (soft hyphen) at line-wrap points,
    e.g. ``Frus\u00ad\ntration``. Removing the hyphen + the line break (and any
    surrounding whitespace) reconstructs the original word.
    """
    s = re.sub(r"\u00ad\s*\n\s*", "", value)
    s = s.replace("\u00ad", "")
    return s


def _flatten_section(value: str) -> str:
    """Collapse a multi-line section body into one normalised line."""
    cleaned = _strip_soft_hyphens(value)
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned.strip()


def _extract_section(text: str, start_label: str, terminators: tuple[str, ...]) -> str:
    """Return the body text between ``start_label`` and the next terminator."""
    start_pattern = rf"^[ \t]*{start_label}[ \t]*\n"
    start_match = re.search(start_pattern, text, re.MULTILINE)
    if not start_match:
        return ""
    body_start = start_match.end()
    rest = text[body_start:]
    end_pos = len(rest)
    for term in terminators:
        m = re.search(rf"^[ \t]*{term}\b", rest, re.MULTILINE)
        if m and m.start() < end_pos:
            end_pos = m.start()
    return rest[:end_pos]


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

    def add(category: str, raw: str) -> None:
        for piece in split_ability_alternates(raw):
            cleaned = normalize_ability_name(piece)
            if cleaned:
                result[category].append(cleaned)

    for line in text.splitlines():
        line = line.strip()
        m = re.match(r"Basic Ability \d+:\s*(.+)", line)
        if m:
            add("basic", m.group(1))
            continue
        m = re.match(r"Adv Ability \d+:\s*(.+)", line)
        if m:
            add("advanced", m.group(1))
            continue
        m = re.match(r"High Ability:\s*(.+)", line)
        if m:
            add("high", m.group(1))
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


def parse_egg_groups(text: str) -> list[str]:
    m = re.search(r"Egg Group\s*:\s*([^\n]+)", text)
    if not m:
        return []
    raw = _strip_soft_hyphens(m.group(1)).strip()
    if not raw or raw.lower() in {"none", "n/a", "no eggs", "no egg"}:
        return []
    # Authors use both ``/`` and the word ``and`` to join egg groups.
    parts = re.split(r"\s*/\s*|\s+and\s+", raw)
    return [p.strip() for p in parts if p.strip()]


def parse_hatch_rate(text: str) -> str | None:
    m = re.search(r"Average Hatch Rate\s*:\s*([^\n]+)", text)
    if not m:
        return None
    value = _strip_soft_hyphens(m.group(1)).strip()
    return value or None


def _split_csv(value: str) -> list[str]:
    cleaned = _flatten_section(value).rstrip(".")
    if not cleaned:
        return []
    return [p.strip() for p in cleaned.split(",") if p.strip()]


def parse_diet(text: str) -> list[str]:
    m = re.search(r"^[ \t]*Diet\s*:\s*([^\n]*)", text, re.MULTILINE)
    if not m:
        return []
    return _split_csv(m.group(1))


def parse_habitat(text: str) -> list[str]:
    m = re.search(r"^[ \t]*Habitat\s*:\s*([^\n]*)", text, re.MULTILINE)
    if not m:
        return []
    raw = m.group(1).strip()
    if raw == "???":
        return []
    return _split_csv(m.group(1))


# Splits TM/HM "06 Toxic", "A1 Cut", "100 Confide", "98 Power-Up Punch", etc.
TM_HM_ITEM_RE = re.compile(r"^\s*(?P<prefix>[A-Za-z])?(?P<num>\d{1,3})\s+(?P<name>.+?)\s*$")


def parse_tm_hm_moves(text: str) -> list[dict]:
    body = _extract_section(text, "TM/HM Move List", MOVE_SECTION_TERMINATORS)
    if not body:
        return []
    moves: list[dict] = []
    for raw in _flatten_section(body).split(","):
        item = raw.strip()
        if not item:
            continue
        match = TM_HM_ITEM_RE.match(item)
        if not match:
            continue
        # ``A`` prefix (a typeset glyph for ``H`` in the source PDF) marks an HM.
        kind = "HM" if match.group("prefix") else "TM"
        cleaned = normalize_move_name(match.group("name"))
        if cleaned is None:
            continue
        moves.append({
            "kind": kind,
            "number": match.group("num").zfill(2),
            "name": cleaned,
        })
    return moves


def parse_egg_moves(text: str) -> list[str]:
    body = _extract_section(text, "Egg Move List", MOVE_SECTION_TERMINATORS)
    if not body:
        return []
    cleaned: list[str] = []
    for raw in _split_csv(body):
        name = normalize_move_name(raw)
        if name is not None:
            cleaned.append(name)
    return cleaned


HEART_SCALE_RE = re.compile(r"\s*\(\s*N\s*\)")


def parse_tutor_moves(text: str) -> list[dict]:
    body = _extract_section(text, "Tutor Move List", MOVE_SECTION_TERMINATORS)
    if not body:
        return []
    moves: list[dict] = []
    for raw in _split_csv(body):
        heart = bool(HEART_SCALE_RE.search(raw))
        cleaned = normalize_move_name(HEART_SCALE_RE.sub("", raw))
        if cleaned is None:
            continue
        moves.append({"name": cleaned, "heart_scale": heart})
    return moves


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
        # Strip the ``§`` footnote glyph (sometimes prefixes a level-up entry).
        line = re.sub(r"^[\s§]+", "", line).rstrip()
        mm = re.match(r"(\d+)\s+(.+?)\s*-\s*(\w+)\s*$", line)
        if mm:
            cleaned = normalize_move_name(mm.group(2))
            if cleaned is None:
                continue
            moves.append({
                "level": int(mm.group(1)),
                "name": cleaned,
                "type": mm.group(3).strip(),
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
    egg_groups = parse_egg_groups(text)
    hatch_rate = parse_hatch_rate(text)
    diet = parse_diet(text)
    habitat = parse_habitat(text)
    tm_hm_moves = parse_tm_hm_moves(text)
    egg_moves = parse_egg_moves(text)
    tutor_moves = parse_tutor_moves(text)

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
        "egg_groups": egg_groups,
        "hatch_rate": hatch_rate,
        "diet": diet,
        "habitat": habitat,
        "capabilities": capabilities,
        "skills": skills,
        "level_up_moves": level_up_moves,
        "tm_hm_moves": tm_hm_moves,
        "egg_moves": egg_moves,
        "tutor_moves": tutor_moves,
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
