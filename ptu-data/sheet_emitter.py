"""Convert a generated ``poke`` dict (see :func:`generator.generate_pokemon`)
into a ``CharacterSheet`` JSON-ready dict for the web UI.

The ``/sheets`` page in this Nuxt project reads ``data/sheets/**/*.json``
files matching :class:`types/characterSheet.ts::CharacterSheet`. Generated
encounters used to land in ``generated_pokemon/*.md`` and never showed up
in that listing — this module bridges the gap.
"""

from __future__ import annotations

from typing import Any, Optional

# Generator stat key → CharacterSheet stat key.
_GEN_TO_SHEET_STAT = {
    "hp": "hp",
    "atk": "atk",
    "def": "def",
    "spatk": "satk",
    "spdef": "sdef",
    "spd": "spd",
}


def _nature_offsets(nature_tuple: tuple) -> dict[str, int]:
    """PTU 1.05 nature deltas, keyed by *generator* stat key.

    Mirrors :func:`generator.apply_nature`: ±1 for HP, ±2 for everything
    else; neutral natures (raise == lower) cancel out.
    """
    _label, raise_stat, lower_stat = nature_tuple
    offsets = {k: 0 for k in _GEN_TO_SHEET_STAT}
    if raise_stat == lower_stat:
        return offsets
    offsets[raise_stat] += 1 if raise_stat == "hp" else 2
    offsets[lower_stat] -= 1 if lower_stat == "hp" else 2
    return offsets


def _sheet_nature_mod_per_stat(nature_tuple: tuple) -> dict[str, int]:
    """The renderer's nature modifier per *sheet* stat key.

    ``resolveStats`` in ``data/characterSheets.ts`` uses
    ``NATURE_DELTA = 1`` for non-HP stats and always ``0`` for HP.
    """
    _label, raise_stat, lower_stat = nature_tuple
    if raise_stat == lower_stat:
        return {sheet_k: 0 for sheet_k in _GEN_TO_SHEET_STAT.values()}

    raise_sheet = _GEN_TO_SHEET_STAT[raise_stat]
    lower_sheet = _GEN_TO_SHEET_STAT[lower_stat]
    out: dict[str, int] = {}
    for sheet_k in _GEN_TO_SHEET_STAT.values():
        if sheet_k == "hp":
            out[sheet_k] = 0
            continue
        delta = 0
        if sheet_k == raise_sheet:
            delta += 1
        if sheet_k == lower_sheet:
            delta -= 1
        out[sheet_k] = delta
    return out


def _stats_block(poke: dict) -> dict[str, dict[str, int]]:
    """Build the ``stats`` block.

    The renderer computes::

        total = species_pokedex_base + sheet_mod + base + added

    The generator's authoritative total (used for HP, evasion, etc.) is::

        species_pokedex_base + nature_offset + added

    To make the sheet display match the generator we set
    ``base = nature_offset - sheet_mod`` per stat. Wild encounters have no
    "personal points spent" in PTU 1.05, so this just folds the leftover
    nature offset into the base column.
    """
    nature_tuple = poke["nature_tuple"]
    nature_offset = _nature_offsets(nature_tuple)
    sheet_mod = _sheet_nature_mod_per_stat(nature_tuple)
    added_stats = poke["added_stats"]

    out: dict[str, dict[str, int]] = {}
    for gen_k, sheet_k in _GEN_TO_SHEET_STAT.items():
        base = nature_offset[gen_k] - sheet_mod[sheet_k]
        out[sheet_k] = {
            "base": base,
            "added": int(added_stats.get(gen_k, 0)),
            "stage": 0,
        }
    return out


def _nature_mod_field(nature_tuple: tuple) -> Optional[dict[str, str]]:
    """Build the ``natureMod`` field, or ``None`` for a neutral nature."""
    _label, raise_stat, lower_stat = nature_tuple
    if raise_stat == lower_stat:
        return None
    return {
        "plus": _GEN_TO_SHEET_STAT[raise_stat],
        "minus": _GEN_TO_SHEET_STAT[lower_stat],
    }


_CATEGORY_MAP = {
    "physical": "Physical",
    "special": "Special",
    "status": "Status",
}


def _movelist(poke: dict) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for m in poke.get("moves", []):
        cat_raw = (m.get("damage_class") or "Status").strip()
        cat = _CATEGORY_MAP.get(cat_raw.lower(), cat_raw)
        entry: dict[str, Any] = {
            "name": m["name"],
            "type": m.get("type", "Normal"),
            "category": cat,
        }
        db = m.get("damage_base")
        if db:
            entry["db"] = db
        roll = m.get("damage_roll")
        if roll:
            entry["damageRoll"] = roll
        for src, dst in (("frequency", "frequency"), ("ac", "ac"),
                         ("range", "range"), ("effect", "effect")):
            v = m.get(src)
            if v not in (None, ""):
                entry[dst] = v
        out.append(entry)
    return out


def _abilities(poke: dict) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for a in poke.get("abilities", []):
        entry: dict[str, Any] = {"name": a["name"]}
        # ability dicts have either ``frequency`` (most) or just a name (when
        # the lookup failed). ``trigger`` is informational only.
        freq = a.get("frequency")
        if freq:
            entry["frequency"] = freq
        eff = a.get("effect")
        if eff:
            entry["effect"] = eff
        out.append(entry)
    return out


def _capabilities(poke: dict) -> Optional[dict[str, Any]]:
    """Capabilities block. Mirrors species defaults but pins them onto the
    sheet so the renderer doesn't have to second-guess (and so the values
    stay stable if pokedex.json drifts).
    """
    caps = poke.get("capabilities") or {}
    out: dict[str, Any] = {}
    for src, dst in (
        ("overland", "overland"),
        ("sky", "sky"),
        ("swim", "swim"),
        ("levitate", "levitate"),
        ("burrow", "burrow"),
        ("jump", "jump"),
        ("power", "power"),
    ):
        v = caps.get(src)
        if v not in (None, "", 0):
            out[dst] = v
    weight = poke.get("weight")
    if weight not in (None, "", 0):
        out["weight"] = weight
    size = poke.get("size")
    if size:
        out["size"] = size
    other = caps.get("other") or []
    if other:
        out["other"] = list(other)
    return out or None


def to_character_sheet(
    poke: dict,
    *,
    slug: str,
    nickname: Optional[str] = None,
) -> dict[str, Any]:
    """Project ``poke`` onto the CharacterSheet schema.

    ``slug`` must be globally unique across ``data/sheets/**/*.json`` —
    duplicates clobber each other in ``characterSheetsBySlug``.
    """
    sheet: dict[str, Any] = {
        "slug": slug,
        "nickname": nickname or poke["species"],
        "species": poke["species"],
        "level": poke["level"],
        "gender": poke.get("gender"),
        "shiny": bool(poke.get("shiny")),
        "nature": poke.get("nature_label"),
        "types": list(poke.get("types") or []),
        "stats": _stats_block(poke),
        "combat": {
            "maxHp": poke["max_hp"],
            "currentHp": poke["max_hp"],
            "tick": poke.get("tick", max(poke["max_hp"] // 10, 1)),
            "evasion": {
                "vsAtk": poke["evasion"]["physical"],
                "vsSatk": poke["evasion"]["special"],
                "vsAny": poke["evasion"]["speed"],
            },
            "dr": poke.get("dr", 0),
        },
        "tutorPoints": {
            "earned": poke.get("tutor_points", 0),
            "spent": 0,
        },
        "movelist": _movelist(poke),
        "abilities": _abilities(poke),
    }

    nature_mod = _nature_mod_field(poke["nature_tuple"])
    if nature_mod is not None:
        sheet["natureMod"] = nature_mod

    caps = _capabilities(poke)
    if caps is not None:
        sheet["capabilities"] = caps

    # Skills stay implicit: the renderer falls back to species defaults for
    # any key not pinned on the sheet, which is exactly what we want for a
    # freshly-rolled wild encounter.

    return sheet
