#!/usr/bin/env python3
"""Parse PTU 1.05 items into a JSON cache."""

import json
import os
import re
import sys

MARKDOWN_DIR = os.path.join(os.path.dirname(__file__), "..", "books", "markdown")
SOURCE_FILES = [
    os.path.join(MARKDOWN_DIR, "arceus_references.md"),
    os.path.join(MARKDOWN_DIR, "swsh_-_armor_crown_references.md"),
    os.path.join(MARKDOWN_DIR, "sumo_references.md"),
    os.path.join(MARKDOWN_DIR, "errata-3.md"),
    os.path.join(MARKDOWN_DIR, "errata-2.md"),
    os.path.join(MARKDOWN_DIR, "core", "09-gear-and-items.md"),
]
CACHE_DIR = os.path.join(os.path.dirname(__file__), "data")

ALL_TYPES = [
    "Normal", "Fire", "Water", "Electric", "Grass", "Ice", "Fighting", "Poison",
    "Ground", "Flying", "Psychic", "Bug", "Rock", "Ghost", "Dragon", "Dark",
    "Steel", "Fairy",
]
ALL_STATS = ["Attack", "Defense", "Special Attack", "Special Defense", "Speed", "Accuracy", "Evasion"]


def _append_unique(target: list[str], value: str | None):
    if value and value not in target:
        target.append(value)


def _normalize_name(s: str) -> str:
    s = s.replace("\u00ad", "")
    s = re.sub(r"\s+", " ", s).strip()
    s = s.replace(" / ", "/")
    s = s.replace("/ ", "/")
    s = s.replace(" /", "/")
    return s


def _clean_text(text: str) -> str:
    text = text.replace("\u00ad", "")
    text = re.sub(r"(\w)-\s*\n\s*(\w)", r"\1\2", text)
    text = re.sub(r"(?m)^## Page .*?$", "", text)
    text = re.sub(r"(?m)^(Gear and Items|Pokémon Items|Equipment|Pokémon|Combat)\s*$", "", text)
    text = re.sub(r"(?m)^\d+\s*$", "", text)
    return text.strip()


def _clean_lines(section: str) -> list[str]:
    section = _clean_text(section)
    lines = []
    for line in section.splitlines():
        stripped = line.strip()
        if stripped:
            lines.append(stripped)
    return lines


def _clean_lines_keep_numbers(section: str) -> list[str]:
    section = section.replace("\u00ad", "")
    section = re.sub(r"(\w)-\s*\n\s*(\w)", r"\1\2", section)
    section = re.sub(r"(?m)^## Page .*?$", "", section)
    section = re.sub(r"(?m)^(Gear and Items|Pokémon Items|Equipment|Pokémon|Combat)\s*$", "", section)
    lines = []
    for line in section.splitlines():
        stripped = line.strip()
        if stripped:
            lines.append(stripped)
    return lines


def _clean_block_text(text: str) -> str:
    lines = [line.strip() for line in _clean_text(text).splitlines() if line.strip()]
    return re.sub(r"\s+", " ", " ".join(lines)).strip()


def _extract_between(text: str, start: str, end: str | None = None) -> str:
    start_index = text.index(start)
    if end is None:
        return text[start_index:]
    end_index = text.index(end, start_index)
    return text[start_index:end_index]


def _looks_like_cost(line: str) -> bool:
    return bool(re.fullmatch(r"\$[\d,]+(?:\s+or\s+more)?|---", line))


def _extract_cost_phrases(text: str) -> list[str]:
    text = _clean_block_text(text)
    phrases = re.findall(r"[^.]*\$[\d,]+(?:\s+or\s+more)?[^.]*\.?", text)
    cleaned = []
    for phrase in phrases:
        phrase = phrase.strip(" .")
        if phrase:
            cleaned.append(phrase)
    return cleaned


def _match_name(lines: list[str], index: int, names: list[str]):
    candidates = sorted(names, key=len, reverse=True)
    for span in (3, 2, 1):
        if index + span > len(lines):
            continue
        joined = _normalize_name(" ".join(lines[index:index + span]))
        for name in candidates:
            norm_name = _normalize_name(name)
            if joined == norm_name:
                return name, span, ""
            if span == 1 and joined.startswith(norm_name + " "):
                return name, 1, joined[len(norm_name):].strip()
    return None


def _extract_named_blocks(section: str, names: list[str], ignore: set[str] | None = None) -> dict[str, list[str]]:
    ignore = ignore or set()
    lines = _clean_lines(section)
    blocks: dict[str, list[str]] = {name: [] for name in names}
    current = None
    index = 0

    while index < len(lines):
        line = lines[index]
        if line in ignore:
            index += 1
            continue
        match = _match_name(lines, index, names)
        if match:
            name, consumed, remainder = match
            current = name
            if remainder:
                blocks[name].append(remainder)
            index += consumed
            continue
        if current is not None:
            blocks[current].append(line)
        index += 1

    return {name: block for name, block in blocks.items() if block}


def _add_item(
    items: dict[str, dict],
    name: str,
    *,
    category: str | None = None,
    effect: str | None = None,
    cost: str | None = None,
    section: str | None = None,
    aliases: list[str] | None = None,
    notes: list[str] | None = None,
    source: str | None = None,
):
    entry = items.setdefault(name, {
        "name": name,
        "categories": [],
        "effects": [],
        "costs": [],
        "sections": [],
        "aliases": [],
        "notes": [],
    })
    if source and not entry.get("source"):
        entry["source"] = source
    _append_unique(entry["categories"], category)
    _append_unique(entry["effects"], effect)
    _append_unique(entry["costs"], cost)
    _append_unique(entry["sections"], section)
    for alias in aliases or []:
        _append_unique(entry["aliases"], alias)
    for note in notes or []:
        _append_unique(entry["notes"], note)


def _parse_colon_block(text: str, start_name: str, end_name: str | None = None) -> str:
    start = text.index(f"{start_name}:") + len(start_name) + 1
    end = text.index(f"{end_name}:", start) if end_name else len(text)
    return text[start:end].strip()


def _parse_pokeballs(text: str, items: dict[str, dict], source: str):
    section = _extract_between(text, "Ball #", "GM Tip: A good way")
    lines = _clean_lines_keep_numbers(section)
    rows = []
    index = 0
    while index < len(lines):
        if re.fullmatch(r"\d{2}", lines[index]):
            number = lines[index]
            name = lines[index + 1]
            modifier = lines[index + 2]
            index += 3
            effect_lines = []
            while index < len(lines) and not re.fullmatch(r"\d{2}", lines[index]):
                effect_lines.append(lines[index])
                index += 1
            rows.append((number, name, modifier, _clean_block_text("\n".join(effect_lines))))
        else:
            index += 1

    for number, name, modifier, effect in rows:
        if name == "Basic Ball":
            cost = "$250"
            aliases = ["Poké Ball", "Poke Ball"]
        elif name == "Great Ball":
            cost = "$400"
            aliases = []
        elif name == "Ultra Ball":
            cost = "$800"
            aliases = []
        elif name == "Master Ball":
            cost = "$300,000 or more"
            aliases = []
        else:
            cost = "$800"
            aliases = []
        _add_item(
            items,
            name,
            category="Poké Ball",
            effect=f"Capture Modifier {modifier}. {effect}",
            cost=cost,
            section="Poké Ball Chart",
            aliases=aliases,
            source=source,
        )


def _parse_trainer_essentials(text: str, items: dict[str, dict], source: str):
    blocks = {
        "Bait": _parse_colon_block(text, "Bait", "Collection Jar"),
        "Collection Jar": _parse_colon_block(text, "Collection Jar", "First Aid Kit"),
        "First Aid Kit": _parse_colon_block(text, "First Aid Kit", "Fishing Lure"),
        "Fishing Lure": _parse_colon_block(text, "Fishing Lure", "Saddle"),
        "Saddle": _parse_colon_block(text, "Saddle", "Rope"),
        "Rope": _parse_colon_block(text, "Rope", "Sleeping Bag"),
        "Sleeping Bag": _parse_colon_block(text, "Sleeping Bag", "Tents"),
        "Tents": _parse_colon_block(text, "Tents", "Lighter"),
        "Lighter": _parse_colon_block(text, "Lighter", "Flashlight"),
        "Flashlight": _parse_colon_block(text, "Flashlight", "Water Filter"),
        "Water Filter": _parse_colon_block(text, "Water Filter", "Repels"),
    }

    for name in ["Bait", "Collection Jar", "First Aid Kit", "Fishing Lure", "Saddle", "Sleeping Bag", "Tents", "Lighter", "Flashlight", "Water Filter"]:
        block = blocks[name]
        costs = _extract_cost_phrases(block)
        _add_item(
            items,
            name,
            category="Trainer Essential",
            effect=_clean_block_text(block),
            cost="; ".join(costs) if costs else None,
            section="Trainer Essentials",
            source=source,
        )

    rope_block = blocks["Rope"]
    _add_item(
        items,
        "Rope",
        category="Trainer Essential",
        effect=_clean_block_text(rope_block),
        section="Trainer Essentials",
        source=source,
    )
    for variant, cost in [("Basic Rope", "$100"), ("Utility Rope", "$200"), ("Sturdy Rope", "$400")]:
        match = re.search(rf"{re.escape(variant)}: (.+?)(?=(?:Basic Rope|Utility Rope|Sturdy Rope|$))", rope_block, re.S)
        if match:
            _add_item(
                items,
                variant,
                category="Rope",
                effect=_clean_block_text(match.group(1)),
                cost=cost,
                section="Trainer Essentials",
                source=source,
            )


def _parse_repels(text: str, items: dict[str, dict], source: str):
    section = _extract_between(text, "Strength", "## Page 276")
    names = ["Repel", "Super Repel", "Max Repel"]
    blocks = _extract_named_blocks(section, names, ignore={"Strength", "Effect", "Price"})
    for name, block in blocks.items():
        cost = block[-1] if _looks_like_cost(block[-1]) else None
        effect_lines = block[:-1] if cost else block
        _add_item(
            items,
            name,
            category="Repellent",
            effect=_clean_block_text("\n".join(effect_lines)),
            cost=cost,
            section="Repels",
            source=source,
        )


def _parse_medicines(text: str, items: dict[str, dict], source: str):
    section = _extract_between(text, "Basic Restoratives", "Bandages and Poultices")
    names = [
        "Potion", "Super Potion", "Hyper Potion", "Antidote", "Paralyze Heal", "Burn Heal",
        "Ice Heal", "Full Heal", "Full Restore", "Revive", "Energy Powder", "Energy Root",
        "Heal Powder", "Revival Herb", "X Attack", "X Defend", "X Special", "X Sp. Def",
        "X Speed", "Dire Hit", "X Accuracy", "Guard Spec",
    ]
    blocks = _extract_named_blocks(section, names, ignore={"Basic Restoratives", "X-Items", "Item", "Effect", "Cost"})
    for name, block in blocks.items():
        cost = block[-1] if block and _looks_like_cost(block[-1]) else None
        effect_lines = block[:-1] if cost else block
        category = "X-Item" if name.startswith("X ") or name in {"Dire Hit", "Guard Spec"} else "Medicine"
        _add_item(
            items,
            name,
            category=category,
            effect=_clean_block_text("\n".join(effect_lines)),
            cost=cost,
            section="Medicines",
            source=source,
        )


def _parse_bandages(text: str, items: dict[str, dict], source: str):
    section = _extract_between(text, "Bandages and Poultices", "## Page 278")
    names = ["Bandages", "Poultices"]
    blocks = _extract_named_blocks(section, names, ignore={"Bandages and Poultices", "Item", "Effect", "Cost"})
    section_note = re.search(r"Bandages are applied as Extended Actions(.+?)Item", section, re.S)
    note_text = _clean_block_text(section_note.group(1)) if section_note else None
    for name, block in blocks.items():
        cost = block[-1] if block and _looks_like_cost(block[-1]) else None
        effect_lines = block[:-1] if cost else block
        effect = _clean_block_text("\n".join(effect_lines))
        if note_text:
            effect = f"{note_text} {effect}".strip()
        _add_item(
            items,
            name,
            category="Medicine",
            effect=effect,
            cost=cost,
            section="Bandages and Poultices",
            source=source,
        )


def _parse_food_and_refreshments(text: str, items: dict[str, dict], source: str):
    snack_section = _extract_between(text, "Snacks", "## Page 279")
    snack_names = ["Candy Bar", "Honey", "Leftovers", "Black Sludge"]
    snack_blocks = _extract_named_blocks(snack_section, snack_names, ignore={"Snacks", "Item", "Effects", "Cost"})
    for name, block in snack_blocks.items():
        cost = block[-1] if block and _looks_like_cost(block[-1]) else None
        effect_lines = block[:-1] if cost else block
        _add_item(
            items,
            name,
            category="Snack Item",
            effect=_clean_block_text("\n".join(effect_lines)),
            cost=cost,
            section="Food Items",
            source=source,
        )

    refreshment_section = _extract_between(text, "Refreshment Items", "## Page 280")
    baby_food_match = re.search(r"Baby Food: (.+?) Item", refreshment_section, re.S)
    if baby_food_match:
        _add_item(
            items,
            "Baby Food",
            category="Food Item",
            effect=_clean_block_text(baby_food_match.group(1)),
            section="Refreshment Items",
            source=source,
        )

    refreshment_names = ["Enriched Water", "Shuckle’s Berry Juice", "Super Soda Pop", "Sparkling Lemonade", "MooMoo Milk"]
    refreshment_blocks = _extract_named_blocks(refreshment_section, refreshment_names, ignore={"Refreshment Items", "Miscellaneous Food", "Item", "Effects", "Cost"})
    for name, block in refreshment_blocks.items():
        cost = block[-1] if block and _looks_like_cost(block[-1]) else None
        effect_lines = block[:-1] if cost else block
        _add_item(
            items,
            name,
            category="Refreshment Item",
            effect=_clean_block_text("\n".join(effect_lines)),
            cost=cost,
            section="Refreshment Items",
            source=source,
        )


def _parse_berries_and_herbs(text: str, items: dict[str, dict], source: str):
    berry_preamble = _extract_between(text, "Apricorns, Berries, and Herbs", "Berry Chart")
    mulch_match = re.search(r"Mulch may be used(.+?)Plant Type", berry_preamble, re.S)
    if mulch_match:
        _add_item(
            items,
            "Mulch",
            category="Gardening Item",
            effect=_clean_block_text(mulch_match.group(1)),
            cost="$200",
            section="Apricorns, Berries, and Herbs",
            source=source,
        )

    apricorn_section = _extract_between(text, "Apricorn Type", "Herb Type")
    apricorn_names = [
        "Red Apricorns", "Yellow Apricorns", "Blue Apricorns", "Green Apricorns",
        "Pink Apricorns", "White Apricorns", "Black Apricorns",
    ]
    apricorn_blocks = _extract_named_blocks(apricorn_section, apricorn_names, ignore={"Apricorn Type", "Poké Ball"})
    for name, block in apricorn_blocks.items():
        _add_item(
            items,
            name,
            category="Apricorn",
            effect=f"Can be turned into a { _clean_block_text(' '.join(block)) }.",
            section="Apricorns",
            source=source,
        )

    herb_section = _extract_between(text, "Herb Type", "## Page 282")
    herb_names = [
        "Energy Root", "Revival Herb", "Mental Herb", "Power Herb", "White Herb",
        "Tiny Mushroom", "Big Mushroom", "Balm Mushroom",
    ]
    herb_blocks = _extract_named_blocks(herb_section, herb_names, ignore={"Herb Type", "Effect", "Price", "Apricorns", "Herbs"})
    herb_notes = []
    for note_match in re.finditer(r"\*.+", herb_section):
        herb_notes.append(_clean_block_text(note_match.group(0)))
    for name, block in herb_blocks.items():
        cost = block[-1] if block and _looks_like_cost(block[-1]) else None
        effect_lines = block[:-1] if cost else block
        _add_item(
            items,
            name,
            category="Herb" if "Herb" in name or name in {"Energy Root", "Revival Herb"} else "Mushroom",
            effect=_clean_block_text("\n".join(effect_lines)),
            cost=cost,
            section="Apricorns, Berries, and Herbs",
            notes=herb_notes if name in {"Energy Root", "Tiny Mushroom", "Big Mushroom", "Balm Mushroom"} else None,
            source=source,
        )

    berry_section = _extract_between(text, "Berry Chart", "## Page 284")
    lines = _clean_lines(berry_section)
    tier_costs = {"1": "$150", "2": "$250", "3": "$500"}
    treat_note = "Treat Berries heal 1/8th of the Pokémon’s Max HP. If the user likes the Treat’s flavor, it heals 1/6th instead. If the user dislikes the treat’s flavor, the user is Confused."
    suppressant_note = "Suppressant Berries lower the indicated Base Stat by 1 when consumed by a Pokémon. This effect only works if the Pokémon’s trainer wishes it to."
    weaken_note = "Berries that weaken a Type of Move allow the user to trade in their Digestion Buff to grant one step of resistance when hit by a Move of the indicated Type."

    index = 0
    while index < len(lines):
        if lines[index] in {"1", "2", "3"} and index + 1 < len(lines) and lines[index + 1].endswith("Berry"):
            tier = lines[index]
            name = lines[index + 1]
            index += 2
            effect_lines = []
            while index < len(lines) and not (lines[index] in {"1", "2", "3"} and index + 1 < len(lines) and lines[index + 1].endswith("Berry")):
                if lines[index].startswith("*"):
                    index += 1
                    continue
                effect_lines.append(lines[index])
                index += 1
            effect = _clean_block_text("\n".join(effect_lines)).replace("*", "")
            notes = []
            if "Treat" in effect:
                notes.append(treat_note)
            if "Suppressant" in effect:
                notes.append(suppressant_note)
            if "Weakens foe" in effect:
                notes.append(weaken_note)
            _add_item(
                items,
                name,
                category="Berry",
                effect=effect,
                cost=tier_costs[tier],
                section="Berry Chart",
                notes=notes,
                source=source,
            )
        else:
            index += 1


def _parse_crafting_items(text: str, items: dict[str, dict], source: str):
    section = _extract_between(text, "Crafting Kits", "## Page 285")
    blocks = {
        "Chemistry Set": _parse_colon_block(section, "Chemistry Set", "Cooking Set"),
        "Cooking Set": _parse_colon_block(section, "Cooking Set", "Dowsing Rod"),
        "Dowsing Rod": _parse_colon_block(section, "Dowsing Rod", "Poffin Mixer"),
        "Poffin Mixer": _parse_colon_block(section, "Poffin Mixer", "Poké Ball Tool Box"),
        "Poké Ball Tool Box": _parse_colon_block(section, "Poké Ball Tool Box", "Portable Grower / Berry Planter"),
        "Portable Grower / Berry Planter": _parse_colon_block(section, "Portable Grower / Berry Planter", "Shards"),
        "Shards": _parse_colon_block(section, "Shards"),
    }
    for name, block in blocks.items():
        costs = _extract_cost_phrases(block)
        _add_item(
            items,
            name,
            category="Crafting Item",
            effect=_clean_block_text(block),
            cost="; ".join(costs) if costs else None,
            section="Crafting Kits",
            aliases=["Portable Grower", "Berry Planter"] if name == "Portable Grower / Berry Planter" else None,
            source=source,
        )


def _parse_example_weapons(text: str, items: dict[str, dict], source: str):
    section = _extract_between(text, "Example Weapons", "## Page 293")
    names = [
        "Kitchen Knife", "Baseball Bat", "Weighted Rope", "Slingshot", "Survival Knife",
        "Quarterstaff", "Throwing Hammers", "Hunting Bow", "Honed Claws", "Meteor Masher",
        "Super Lucky Throwing Stars", "Twin-Needled Bow",
    ]
    ignore = {"Example Weapons", "Crude Weapons", "Simple Weapons", "Fine Weapons"}
    blocks = _extract_named_blocks(section, names, ignore=ignore)
    for name, block in blocks.items():
        _add_item(
            items,
            name,
            category="Weapon",
            effect=_clean_block_text("\n".join(block)),
            section="Example Weapons",
            source=source,
        )


def _parse_equipment_tables(text: str, items: dict[str, dict], source: str):
    body_section = _extract_between(text, "Body Equipment", "Head Equipment")
    body_names = ["Light Armor", "Heavy Armor", "Fancy Clothes", "Stealth Clothes"]
    body_blocks = _extract_named_blocks(body_section, body_names, ignore={"Body Equipment", "Equipment", "Effect", "Cost"})
    for name, block in body_blocks.items():
        cost = block[-1] if _looks_like_cost(block[-1]) else None
        _add_item(items, name, category="Body Equipment", effect=_clean_block_text("\n".join(block[:-1] if cost else block)), cost=cost, section="Equipment", source=source)

    head_section = _extract_between(text, "Head Equipment", "Feet Equipment")
    head_names = ["Dark Vision Goggles", "Gas Mask", "Helmet", "Re-Breather", "Sunglasses"]
    head_blocks = _extract_named_blocks(head_section, head_names, ignore={"Head Equipment", "Equipment", "Effect", "Cost"})
    for name, block in head_blocks.items():
        cost = block[-1] if _looks_like_cost(block[-1]) else None
        _add_item(items, name, category="Head Equipment", effect=_clean_block_text("\n".join(block[:-1] if cost else block)), cost=cost, section="Equipment", source=source)

    feet_section = _extract_between(text, "Feet Equipment", "## Page 294")
    feet_names = ["Snow Boots", "Running Shoes", "Flippers", "Jungle Boots"]
    feet_blocks = _extract_named_blocks(feet_section, feet_names, ignore={"Feet Equipment", "Equipment", "Effect", "Cost"})
    for name, block in feet_blocks.items():
        cost = block[-1] if _looks_like_cost(block[-1]) else None
        _add_item(items, name, category="Feet Equipment", effect=_clean_block_text("\n".join(block[:-1] if cost else block)), cost=cost, section="Equipment", source=source)

    hand_section = _extract_between(text, "Hand Equipment", "Accessory Items")
    hand_names = ["Fishing Rod", "Glue Cannon", "Hand Net", "Weighted Nets", "Capture Styler", "Light Shield", "Heavy Shield", "Wonder Launcher"]
    hand_blocks = _extract_named_blocks(hand_section, hand_names, ignore={"Hand Equipment", "Equipment", "Effect", "Fishing Rods", "Capture"})
    for name, block in hand_blocks.items():
        block_text = _clean_block_text("\n".join(block))
        costs = _extract_cost_phrases(block_text)
        _add_item(
            items,
            name,
            category="Hand Equipment",
            effect=block_text,
            cost="; ".join(costs) if costs else None,
            section="Equipment",
            source=source,
        )

    accessory_section = _extract_between(text, "Accessory Items", "GM TIP: Creating Your Own Items")
    accessory_names = ["Focus", "Snag Machine", "Mega Ring"]
    accessory_blocks = _extract_named_blocks(accessory_section, accessory_names, ignore={"Accessory Items", "Equipment", "Effect"})
    for name, block in accessory_blocks.items():
        block_text = _clean_block_text("\n".join(block))
        costs = _extract_cost_phrases(block_text)
        _add_item(
            items,
            name,
            category="Accessory Item",
            effect=block_text,
            cost="; ".join(costs) if costs else None,
            section="Accessory Items",
            source=source,
        )


def _parse_held_items(text: str, items: dict[str, dict], source: str):
    section = _extract_between(text, "Held Item", "## Page 298")
    names = [
        "Big Root", "Bright Powder", "Choice Item", "Contest Accessory", "Contest Fashion",
        "Everstone", "Eviolite", "Expert Belt", "Flame Orb", "Focus Band", "Focus Sash",
        "Full Incense", "Go-Goggles", "Iron Ball", "King’s Rock", "Lagging Item", "Lax Incense",
        "Life Orb", "Luck Incense", "Quick Claw", "Razor Claw", "Razor Fang", "Safety Goggles",
        "Shell Bell", "Shock Collar", "Stat Boosters", "Toxic Orb", "Type Boosters", "Type Brace",
        "Winter Cloak", "Type Gem", "Type Plate", "Mega Stone", "Metal Powder", "Rare Leek",
        "Thick Club", "Pink Pearl",
    ]
    blocks = _extract_named_blocks(section, names, ignore={"Held Item", "Effect", "Cost"})
    for name, block in blocks.items():
        cost = block[-1] if block and _looks_like_cost(block[-1]) else None
        effect = _clean_block_text("\n".join(block[:-1] if cost else block))
        aliases = []
        if name in {"Type Gem", "Type Plate", "Type Boosters", "Type Brace"}:
            aliases.extend([f"{t} {name[:-1] if name.endswith('s') else name}" for t in ALL_TYPES])
        if name in {"Choice Item", "Lagging Item", "Stat Boosters"}:
            aliases.extend([f"{stat} {name[:-1] if name.endswith('s') else name}" for stat in ALL_STATS])
        _add_item(
            items,
            name,
            category="Held Item",
            effect=effect,
            cost=cost,
            section="Held Items",
            aliases=aliases,
            source=source,
        )


def _parse_toolkits(text: str, items: dict[str, dict], source: str):
    section = _extract_between(text, "Pokémon Toolkits", "Evolutionary Items")
    blocks = {
        "Egg Warmer": _parse_colon_block(section, "Egg Warmer", "Groomer’s Kit"),
        "Groomer’s Kit": _parse_colon_block(section, "Groomer’s Kit", "Reanimation Machine"),
        "Reanimation Machine": _parse_colon_block(section, "Reanimation Machine"),
    }
    for name, block in blocks.items():
        costs = _extract_cost_phrases(block)
        _add_item(
            items,
            name,
            category="Pokémon Toolkit",
            effect=_clean_block_text(block),
            cost="; ".join(costs) if costs else None,
            section="Pokémon Toolkits",
            source=source,
        )


def _parse_evolutionary_items(text: str, items: dict[str, dict], source: str):
    stones_section = _extract_between(text, "Evolutionary Stones", "Evolutionary Keepsakes")
    stone_names = ["Fire Stone", "Water Stone", "Thunder Stone", "Leaf Stone", "Moon Stone", "Sun Stone", "Shiny Stone", "Dusk Stone", "Dawn Stone"]
    stone_blocks = _extract_named_blocks(stones_section, stone_names, ignore={"Evolutionary Stones", "Item", "Effect"})
    for name, block in stone_blocks.items():
        _add_item(items, name, category="Evolutionary Stone", effect=_clean_block_text("\n".join(block)), cost="$3000", section="Evolutionary Items", source=source)

    keepsakes_section = _extract_between(text, "Evolutionary Keepsakes", "## Page 299")
    keepsake_names = [
        "Deepseascale/Deepseatooth", "Dragon Scale", "Dubious Disc", "Electirizer", "King’s Rock",
        "Oval Stone", "Magmarizer", "Metal Coat", "Protector", "Razor Claw", "Razor Fang",
        "Reaper Cloth", "Sachet", "Up-Grade", "Whipped Dream",
    ]
    keep_blocks = _extract_named_blocks(keepsakes_section, keepsake_names, ignore={"Evolutionary Keepsakes", "Item", "Effect"})
    for name, block in keep_blocks.items():
        _add_item(items, name, category="Evolutionary Keepsake", effect=_clean_block_text("\n".join(block)), cost="$3000", section="Evolutionary Items", source=source)


def _parse_vitamins(text: str, items: dict[str, dict], source: str):
    vitamin_section = _extract_between(text, "Vitamin", "Note: PP Ups")
    vitamin_names = ["HP Up", "Protein", "Iron", "Calcium", "Zinc", "Carbos", "Heart Booster", "PP Up"]
    vitamin_blocks = _extract_named_blocks(vitamin_section, vitamin_names, ignore={"Vitamin", "Effect", "Cost"})
    for name, block in vitamin_blocks.items():
        cost = block[-1] if block and _looks_like_cost(block[-1]) else None
        effect = _clean_block_text("\n".join(block[:-1] if cost else block))
        _add_item(items, name, category="Vitamin", effect=effect, cost=cost, section="Vitamins", source=source)

    related_section = _extract_between(text, "Heart Scale:", "## Page 300")
    heart_scale = _parse_colon_block(related_section, "Heart Scale", "Rare Candy")
    rare_candy = _parse_colon_block(related_section, "Rare Candy", "Stat Suppressants")
    stat_suppressants = _parse_colon_block(related_section, "Stat Suppressants")
    _add_item(items, "Heart Scale", category="Related Vitamin Item", effect=_clean_block_text(heart_scale), section="Vitamins", source=source)
    _add_item(items, "Rare Candy", category="Related Vitamin Item", effect=_clean_block_text(rare_candy), cost="$9800 or more", section="Vitamins", source=source)
    _add_item(items, "Stat Suppressants", category="Medicine", effect=_clean_block_text(stat_suppressants), cost="$500", section="Vitamins", source=source)


def _parse_tm_chart(text: str, items: dict[str, dict], source: str):
    section = _extract_between(text, "TM Chart", "## Page 302")
    compact = _clean_text(section)
    compact = re.sub(r"\s+", " ", compact)
    pattern = re.compile(r"(\d{2,3}|A\d)\s*-\s*(.+?)\s+(\$[\d,]+)(?=\s+(?:\d{2,3}|A\d)\s*-|\s*$)")
    for code, move_name, cost in pattern.findall(compact):
        is_hm = code.startswith("A")
        label = f"{'HM' if is_hm else 'TM'} {code} - {move_name}"
        effect = (
            f"Teaches {move_name}. {'HMs may be used once per day.' if is_hm else 'TMs are one-time use items.'} "
            "Teaching the move takes about an hour, and normally costs the Pokémon 1 Tutor Point."
        )
        aliases = [f"{move_name} {'HM' if is_hm else 'TM'}", move_name, f"{'HM' if is_hm else 'TM'} {code}", f"{'HM' if is_hm else 'TM'}{code}"]
        _add_item(items, label, category="HM" if is_hm else "TM", effect=effect, cost=cost, section="TM Chart", aliases=aliases, source=source)


def _parse_combat_items(text: str, items: dict[str, dict], source: str):
    section = _extract_between(text, "Combat Items", "Smoke Ball:") + "\n" + _parse_colon_block(_extract_between(text, "Smoke Ball:", None), "Smoke Ball")
    blocks = {
        "Caltrops": re.search(r"Caltrops & Toxic Caltrops: (.+?)Dream Mist:", section, re.S),
        "Dream Mist": re.search(r"Dream Mist: (.+?)Magic Flute:", section, re.S),
        "Magic Flute": re.search(r"Magic Flute: (.+?)Cleanse Tags:", section, re.S),
        "Cleanse Tags": re.search(r"Cleanse Tags: (.+?)Pester Balls:", section, re.S),
        "Pester Balls": re.search(r"Pester Balls: (.+?)Smoke Ball:", section, re.S),
    }
    for name, match in blocks.items():
        if not match:
            continue
        block = match.group(1)
        cost = "; ".join(_extract_cost_phrases(block)) or None
        _add_item(items, name, category="Combat Item", effect=_clean_block_text(block), cost=cost, section="Combat Items", source=source)

    caltrops_block = blocks["Caltrops"].group(1) if blocks["Caltrops"] else ""
    if caltrops_block:
        _add_item(items, "Toxic Caltrops", category="Combat Item", effect=_clean_block_text(caltrops_block).replace("Spikes and Toxic Spikes", "Toxic Spikes"), cost="$500", section="Combat Items", source=source)

    smoke_block = _parse_colon_block(_extract_between(text, "Smoke Ball:", None), "Smoke Ball")
    _add_item(items, "Smoke Ball", category="Combat Item", effect=_clean_block_text(smoke_block), cost="$500", section="Combat Items", source=source)


def _parse_core_items(text: str) -> dict[str, dict]:
    source = "09-gear-and-items.md"
    items: dict[str, dict] = {}
    _parse_pokeballs(text, items, source)
    _parse_trainer_essentials(text, items, source)
    _parse_repels(text, items, source)
    _parse_medicines(text, items, source)
    _parse_bandages(text, items, source)
    _parse_food_and_refreshments(text, items, source)
    _parse_berries_and_herbs(text, items, source)
    _parse_crafting_items(text, items, source)
    _parse_example_weapons(text, items, source)
    _parse_equipment_tables(text, items, source)
    _parse_held_items(text, items, source)
    _parse_toolkits(text, items, source)
    _parse_evolutionary_items(text, items, source)
    _parse_vitamins(text, items, source)
    _parse_tm_chart(text, items, source)
    _parse_combat_items(text, items, source)
    return items


def _parse_from_source(path: str, text: str) -> dict[str, dict]:
    if os.path.basename(path) == "09-gear-and-items.md":
        return _parse_core_items(text)
    return {}


def parse_items(verbose: bool = False) -> dict[str, dict]:
    items: dict[str, dict] = {}
    provenance: dict[str, str] = {}

    for path in SOURCE_FILES:
        if not os.path.exists(path):
            continue
        with open(path, "r", encoding="utf-8") as file:
            text = file.read()
        label = os.path.basename(path)
        parsed = _parse_from_source(path, text)
        added = 0
        shadowed = 0
        for name, item in parsed.items():
            if name not in items:
                items[name] = item
                provenance[name] = label
                added += 1
            else:
                shadowed += 1
                current = items[name]
                for key in ("categories", "effects", "costs", "sections", "aliases", "notes"):
                    for value in item.get(key, []):
                        _append_unique(current[key], value)
                if verbose:
                    print(f"  [merged] {name}: combined data from {label} into {provenance[name]}")
        if parsed or verbose:
            print(f"  {label}: +{added} new, {shadowed} merged/shadowed by higher-priority source")

    return items


def build_cache(verbose: bool = False):
    os.makedirs(CACHE_DIR, exist_ok=True)
    print("Parsing items (priority: newest supplement → core)...")
    items = parse_items(verbose=verbose)
    out_path = os.path.join(CACHE_DIR, "items.json")
    with open(out_path, "w", encoding="utf-8") as file:
        json.dump(items, file, indent=2, ensure_ascii=False)
    print(f"Wrote {len(items)} items to {out_path}")
    return items


if __name__ == "__main__":
    build_cache(verbose="--verbose" in sys.argv or "-v" in sys.argv)
