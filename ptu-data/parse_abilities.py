#!/usr/bin/env python3
"""Parse PTU 1.05 abilities from the indices-and-reference chapter into a JSON cache."""

import hashlib
import json
import os
import re

MARKDOWN_DIR = os.path.join(
    os.path.dirname(__file__), "..", "books", "markdown"
)
# Source files listed in priority order, **highest first**. Each subsequent file
# is treated as an older layer that only fills in abilities the higher-priority
# files don't already define — i.e. newer generation supplements patch over the
# PTU 1.05 core, which is the oldest base layer.
SOURCE_FILES = [
    os.path.join(MARKDOWN_DIR, "arceus_references.md"),            # Legends: Arceus (2022)
    os.path.join(MARKDOWN_DIR, "swsh_-_armor_crown_references.md"), # SwSh + DLCs   (2019–2020)
    os.path.join(MARKDOWN_DIR, "sumo_references.md"),               # Sun/Moon      (2016–2018)
    os.path.join(MARKDOWN_DIR, "errata-3.md"),                      # Feb 2016 playtest / errata 3
    os.path.join(MARKDOWN_DIR, "errata-2.md"),                      # Sept 2015 playtest / errata 2
    os.path.join(MARKDOWN_DIR, "core", "10-indices-and-reference.md"),  # PTU 1.05 core (base)
]
CACHE_DIR = os.path.join(os.path.dirname(__file__), "data")
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
ADJUDICATION_PATH = os.path.join(
    REPO_ROOT, "data", "ability-automation", "source-adjudications.json"
)

# Manual name fix-ups for known casing inconsistencies in source material.
NAME_FIXUPS = {
    "Weird power": "Weird Power",
}

FREQUENCY_RE = re.compile(r"^(Static|Scene|At-Will|Daily|EOT|EoT|1/Round)")
FIELD_BOUNDARY_RE = r"Ability:|Move:|Trigger:|Effect:|Bonus:|Target:|Choose One Effect:"


def _normalize_field(value: str) -> str:
    value = re.sub(r"\s*\n\s*", " ", value).strip()
    return re.sub(r"(?<=[A-Za-z0-9])-\s+(?=[A-Za-z0-9])", "-", value)


def _extract_labeled_field(label: str, body: str, *, keep_label: bool = False) -> str | None:
    pattern = rf"^{re.escape(label)}:\s*(.+(?:\n(?!{FIELD_BOUNDARY_RE}).+)*)"
    match = re.search(pattern, body, re.MULTILINE)
    if not match:
        return None

    value = _normalize_field(match.group(1))
    return f"{label}: {value}" if keep_label else value


def _parse_blocks(text: str) -> dict[str, dict]:
    abilities: dict[str, dict] = {}
    blocks = re.split(r"^Ability: ", text, flags=re.MULTILINE)

    for block in blocks[1:]:
        lines = block.strip().splitlines()
        if not lines:
            continue

        name = lines[0].strip()
        name = NAME_FIXUPS.get(name, name)
        ability = {"name": name}

        # Second line is typically the frequency
        if len(lines) > 1:
            freq_line = lines[1].strip()
            if FREQUENCY_RE.match(freq_line):
                ability["frequency"] = freq_line

        body = "\n".join(lines[1:])

        trigger = _extract_labeled_field("Trigger", body)
        if trigger:
            ability["trigger"] = trigger

        # Effect — grab everything after "Effect:" until another metadata
        # label. Keep unlabelled "Special:" paragraphs as part of the effect;
        # the source treats them as effect text in ability blocks.
        effect = _extract_labeled_field("Effect", body)
        choose_one_effect = _extract_labeled_field("Choose One Effect", body, keep_label=True)
        if effect:
            ability["effect"] = effect
        elif choose_one_effect:
            ability["effect"] = choose_one_effect

        bonus = _extract_labeled_field("Bonus", body)
        if bonus:
            ability["bonus"] = bonus

        abilities[name] = ability

    return abilities


def _apply_source_adjudications(abilities: dict[str, dict]) -> None:
    """Apply reviewed fixes for known PDF column/parser losses.

    Each fix is tied to exact checked-in source bytes. This keeps parser output
    reproducible without treating a heuristic or an unreviewed manual value as
    rules authority.
    """
    with open(ADJUDICATION_PATH, "r", encoding="utf-8") as f:
        document = json.load(f)

    if document.get("schemaVersion") != 1 or not isinstance(document.get("adjudications"), list):
        raise ValueError("ability source adjudications must use schemaVersion 1")

    allowed_fields = {"frequency", "trigger", "effect", "bonus"}
    for entry in document["adjudications"]:
        name = entry["canonicalId"]
        if name not in abilities:
            raise ValueError(f"adjudicated ability {name!r} is absent from parsed sources")
        source_path = os.path.join(REPO_ROOT, entry["sourcePath"])
        with open(source_path, "rb") as f:
            source_bytes = f.read()
        actual_hash = hashlib.sha256(source_bytes).hexdigest()
        if actual_hash != entry["sourceDataSha256"]:
            raise ValueError(
                f"adjudication source hash changed for {name}: "
                f"expected {entry['sourceDataSha256']}, received {actual_hash}"
            )
        source_text = source_bytes.decode("utf-8")
        if entry["sourceSection"] not in source_text:
            raise ValueError(f"adjudication source section is absent for {name}")

        fields = entry["fields"]
        if not isinstance(fields, dict) or not fields or not set(fields).issubset(allowed_fields):
            raise ValueError(f"adjudication fields are invalid for {name}")
        if any(not isinstance(value, str) or not value.strip() for value in fields.values()):
            raise ValueError(f"adjudication values are invalid for {name}")
        abilities[name].update(fields)


def parse_abilities(verbose: bool = False) -> dict[str, dict]:
    """Parse abilities from all source files in priority order (first wins)."""
    abilities: dict[str, dict] = {}
    provenance: dict[str, str] = {}  # ability name -> source file that supplied it

    for path in SOURCE_FILES:
        if not os.path.exists(path):
            continue
        with open(path, "r", encoding="utf-8") as f:
            text = f.read()
        label = os.path.basename(path)
        added = 0
        shadowed = 0
        for name, ability in _parse_blocks(text).items():
            if name not in abilities:
                abilities[name] = ability
                provenance[name] = label
                added += 1
            else:
                shadowed += 1
                if verbose:
                    print(f"  [shadowed] {name}: kept {provenance[name]}, dropped {label}")
        print(f"  {label}: +{added} new, {shadowed} shadowed by higher-priority source")

    _apply_source_adjudications(abilities)
    return abilities


def build_cache(verbose: bool = False):
    os.makedirs(CACHE_DIR, exist_ok=True)
    print("Parsing abilities (priority: newest supplement → core)...")
    abilities = parse_abilities(verbose=verbose)
    out_path = os.path.join(CACHE_DIR, "abilities.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(abilities, f, indent=2, ensure_ascii=False)
    print(f"Wrote {len(abilities)} abilities to {out_path}")
    return abilities


if __name__ == "__main__":
    import sys
    build_cache(verbose="--verbose" in sys.argv or "-v" in sys.argv)
