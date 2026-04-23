#!/usr/bin/env python3
"""Parse PTU 1.05 special capabilities into a JSON cache."""

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
    os.path.join(MARKDOWN_DIR, "core", "10-indices-and-reference.md"),
]
CACHE_DIR = os.path.join(os.path.dirname(__file__), "data")


def _clean_section(text: str) -> str:
    text = text.replace("\u00ad", "")
    text = re.sub(r"(\w)-\s*\n\s*(\w)", r"\1\2", text)
    text = re.sub(r"(?m)^## Page .*?$", "", text)
    text = re.sub(r"(?m)^(Indices and Reference|SuMo References|SwSh \+ Armor_Crown References|Arceus References)\s*$", "", text)
    text = re.sub(r"(?m)^\d+\s*$", "", text)
    return text.strip()


def _normalize_effect(text: str) -> str:
    text = _clean_section(text)
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    return re.sub(r"\s+", " ", " ".join(lines)).strip()


def _parse_named_blocks(section: str) -> dict[str, dict]:
    section = _clean_section(section)
    pattern = re.compile(r"(?m)^([A-Z][A-Za-z0-9Éé’'&/().\-+ ]+?):\s*")
    matches = list(pattern.finditer(section))
    capabilities: dict[str, dict] = {}

    for index, match in enumerate(matches):
        name = match.group(1).strip()
        block_start = match.end()
        block_end = matches[index + 1].start() if index + 1 < len(matches) else len(section)
        effect = _normalize_effect(section[block_start:block_end])
        if effect:
            capabilities[name] = {"name": name, "effect": effect}

    return capabilities


def _parse_core_capabilities(text: str) -> dict[str, dict]:
    start = text.index("Special Capabilities")
    end = text.index("## Page 310")
    section = text[start:end]
    return _parse_named_blocks(section)


def _parse_sumo_capabilities(text: str) -> dict[str, dict]:
    if "New Capabilities:" not in text:
        return {}
    start = text.index("New Capabilities:") + len("New Capabilities:")
    end = text.index("\n\nStatic\n", start)
    section = text[start:end]
    return _parse_named_blocks(section)


def _parse_swsh_capabilities(text: str) -> dict[str, dict]:
    if "As One:" not in text:
        return {}
    start = text.index("As One:")
    end = text.index("Scene – Free Action, Reaction", start)
    section = text[start:end]
    section = section.replace("\nAbility: Ball Fetch\n", "\n")
    section = section.replace("\n\nNew Abilities:\n\n", "\n")
    return _parse_named_blocks(section)


def _parse_from_source(path: str, text: str) -> dict[str, dict]:
    basename = os.path.basename(path)
    if basename == "10-indices-and-reference.md":
        return _parse_core_capabilities(text)
    if basename == "sumo_references.md":
        return _parse_sumo_capabilities(text)
    if basename == "swsh_-_armor_crown_references.md":
        return _parse_swsh_capabilities(text)
    return {}


def parse_capabilities(verbose: bool = False) -> dict[str, dict]:
    capabilities: dict[str, dict] = {}
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
        for name, capability in parsed.items():
            if name not in capabilities:
                capabilities[name] = capability | {"source": label}
                provenance[name] = label
                added += 1
            else:
                shadowed += 1
                if verbose:
                    print(f"  [shadowed] {name}: kept {provenance[name]}, dropped {label}")
        if parsed or verbose:
            print(f"  {label}: +{added} new, {shadowed} shadowed by higher-priority source")

    return capabilities


def build_cache(verbose: bool = False):
    os.makedirs(CACHE_DIR, exist_ok=True)
    print("Parsing capabilities (priority: newest supplement → core)...")
    capabilities = parse_capabilities(verbose=verbose)
    out_path = os.path.join(CACHE_DIR, "capabilities.json")
    with open(out_path, "w", encoding="utf-8") as file:
        json.dump(capabilities, file, indent=2, ensure_ascii=False)
    print(f"Wrote {len(capabilities)} capabilities to {out_path}")
    return capabilities


if __name__ == "__main__":
    build_cache(verbose="--verbose" in sys.argv or "-v" in sys.argv)
