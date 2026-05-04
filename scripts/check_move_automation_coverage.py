#!/usr/bin/env python3
"""Fail unless every canonical PTU move has an explicit automation script.

This intentionally does not count the manual fallback resolver. A move is
considered automated only when it appears as a human-authored entry in
EXPLICIT_MOVE_AUTOMATION_SCRIPTS in utils/moveAutomation.ts.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MOVES_PATH = ROOT / "ptu-data" / "data" / "moves.json"
REGISTRY_PATH = ROOT / "utils" / "moveAutomation.ts"

VALID_TYPES = {
    "Normal", "Fighting", "Flying", "Poison", "Ground", "Rock",
    "Bug", "Ghost", "Steel", "Fire", "Water", "Grass",
    "Electric", "Psychic", "Ice", "Dragon", "Dark", "Fairy",
}

moves_data = json.loads(MOVES_PATH.read_text())
canonical_moves = sorted(
    move["name"]
    for move in moves_data.values()
    if move.get("type") in VALID_TYPES
)

source = REGISTRY_PATH.read_text()
registry_match = re.search(
    r"EXPLICIT_MOVE_AUTOMATION_SCRIPTS[\s\S]*?new Map<string, MoveAutomationScript>\(\[([\s\S]*?)\]\)",
    source,
)
if not registry_match:
    raise SystemExit("Could not find EXPLICIT_MOVE_AUTOMATION_SCRIPTS registry")

registry_body = registry_match.group(1)
# Matches entries like ['Thunderbolt', defineExplicitMoveScript(...)] or
# ["Thunderbolt", defineExplicitMoveScript(...)]. Comments are ignored by this
# convention because example entries should remain commented out.
implemented = set(re.findall(r"^\s*\[(['\"])(.*?)\1\s*,", registry_body, flags=re.MULTILINE))
implemented_names = {name for _quote, name in implemented}

missing = [name for name in canonical_moves if name not in implemented_names]
extra = sorted(implemented_names - set(canonical_moves))

if extra:
    print("Unknown explicit move script entries:")
    for name in extra:
        print(f"  - {name}")

if missing:
    print(f"Explicit move automation coverage: {len(implemented_names)}/{len(canonical_moves)}")
    print("Missing explicit scripts:")
    for name in missing:
        print(f"  - {name}")
    raise SystemExit(1)

print(f"Explicit move automation coverage: {len(implemented_names)}/{len(canonical_moves)}")
