"""Shared PTU Pokémon experience helpers for generated sheets."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

_EXPERIENCE_CHART_PATH = (
    Path(__file__).resolve().parent.parent
    / "data"
    / "reference"
    / "pokemonExperienceChart.json"
)


@lru_cache(maxsize=1)
def _experience_by_level() -> dict[int, int]:
    with _EXPERIENCE_CHART_PATH.open("r", encoding="utf-8") as f:
        chart: list[dict[str, Any]] = json.load(f)
    return {
        int(entry["level"]): int(entry["expNeeded"])
        for entry in chart
        if "level" in entry and "expNeeded" in entry
    }


def pokemon_total_exp_for_level(level: int) -> int | None:
    """Return the PTU chart threshold for a generated Pokémon's level."""
    try:
        normalized_level = int(level)
    except (TypeError, ValueError):
        return None
    return _experience_by_level().get(normalized_level)
