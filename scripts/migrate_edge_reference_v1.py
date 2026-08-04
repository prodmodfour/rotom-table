#!/usr/bin/env python3
"""Create the reviewed Edge v1 app-owned reference catalogs.

Runtime code never reads documentary books or parser output. This one-way,
hash-guarded maintenance migration repairs four known Trainer Edge parser
boundary leaks and creates the separately owned Poké Edge catalog reviewed for
EA-001 through EA-004.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
TRAINER_REFERENCE = ROOT / "data/reference/edges.json"
POKE_REFERENCE = ROOT / "data/reference/poke-edges.json"
ORIGINAL_TRAINER_SHA256 = "0607325a7743f57ba06761492fc88ee3814f6932d83ef76c57167bfbbf23adfe"


def digest(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def stable_write(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


TRAINER_EFFECT_REPAIRS = {
    "Confidence Artist": "You learn the Move Confide.",
    "Groomer": (
        "You know how to effectively groom your Pokémon with access to a Groomer’s Kit. "
        "You may groom up to 6 Pokémon in one hour. Grooming Pokémon may count as an hour of Training, "
        "and you may apply Experience Training, teach Poké Edges, and apply any Features that could be "
        "applied during Training. If you apply Experience Training from Grooming, use your General "
        "Education or Pokémon Education Rank to determine Bonus Experience gained during Training. "
        "A Pokémon that has been Groomed also gains a +1d6 Bonus to the Introduction Roll of a Contest "
        "for the rest of the day."
    ),
    "Survival Drive": "You learn the Move Bulk Up.",
    "Trainer of Champions": (
        "Whenever you apply Experience Training to a Pokémon, they gain an additional +5 Experience."
    ),
}


def choice(kind: str, minimum: int = 1, maximum: int = 1, *, same: bool = False) -> dict[str, Any]:
    return {"kind": kind, "minimum": minimum, "maximum": maximum, "sameAcrossRanks": same}


def repeat(kind: str = "once", maximum: int | None = 1) -> dict[str, Any]:
    return {"kind": kind, "maximum": maximum}


def edge(
    name: str,
    prerequisites: str,
    cost: int,
    effect: str,
    *,
    tags: list[str] | None = None,
    choices: list[dict[str, Any]] | None = None,
    repeatability: dict[str, Any] | None = None,
    replaces: str | None = None,
) -> dict[str, Any]:
    return {
        "name": name,
        "tags": tags or [],
        "prerequisites": prerequisites,
        "cost": cost,
        "choices": choices or [],
        "repeatability": repeatability or repeat(),
        "effect": effect,
        "replaces": replaces,
        "catalogVersion": 1,
    }


POKE_EDGES: dict[str, dict[str, Any]] = {
    "Ability Mastery": edge(
        "Ability Mastery", "Level 60", 3,
        "The Pokémon gains an additional Ability, picked from any Ability it could naturally qualify for.",
        tags=["Ability"], choices=[choice("ability")],
    ),
    "Accuracy Training": edge(
        "Accuracy Training", "Level 20", 1,
        "Pick a Move with an AC of 3 or higher; the AC of the target Move is permanently lowered by 1. "
        "This Poké Edge may be taken up to three times, each time selecting a different Move.",
        tags=["Move"], choices=[choice("move")], repeatability=repeat("different-choice", 3),
    ),
    "Advanced Connection": edge(
        "Advanced Connection", "An Ability with the Connection Keyword", 1,
        "Choose an Ability with the Connection Keyword that the target has; the Connected Move no longer "
        "takes up a Move Slot for the user.",
        tags=["Ability", "Move"], choices=[choice("ability")],
    ),
    "Advanced Mobility": edge(
        "Advanced Mobility", "Level 20", 1,
        "Increase one Movement Capability by 2. This Edge may be taken multiple times, but may not be applied "
        "more than once to the same Movement Capability.",
        tags=["Capability"], choices=[choice("movement-capability")],
        repeatability=repeat("different-choice", None),
    ),
    "Attack Conflict": edge(
        "Attack Conflict", "None", 1,
        "Select Attack or Special Attack. From now on, that Stat does not need to remain higher than Stats it "
        "surpasses in Base Relations, and similarly all other Stats surpassed by it do not need to remain lower.",
        tags=["Stat"], choices=[choice("attack-stat")],
    ),
    "Aura Pulse": edge(
        "Aura Pulse", "Level 30, Aura Reader, owned by a Trainer with Aura Pulse", 2,
        "The Pokémon gains the Aura Pulse Capability.", tags=["Capability"],
    ),
    "Basic Ranged Attacks": edge(
        "Basic Ranged Attacks", "One of Firestarter, Fountain, Freezer, Guster, Materializer, or Zapper", 1,
        "Choose one of the Capabilities listed in the prerequisites for this Poké Edge. Struggle Attacks modified "
        "by that Capability may now be made at a range of up to 6 meters. This Poké Edge may be taken multiple "
        "times, selecting a different Capability each time.",
        tags=["Capability", "Struggle"], choices=[choice("elemental-struggle-capability")],
        repeatability=repeat("different-choice", 6),
    ),
    "Capability Training": edge(
        "Capability Training", "Level 20", 1,
        "Increase Power or a Jump Capability by 1. Capability Training may be taken multiple times, each time "
        "increasing a different Capability.",
        tags=["Capability"], choices=[choice("power-or-jump-capability")],
        repeatability=repeat("different-choice", 3),
    ),
    "Enticing Bait": edge(
        "Enticing Bait", "Level 20, Alluring Capability", 1,
        "When activating the Alluring Capability, the user adds the higher of its Athletics or Focus Ranks to its d20 roll.",
        tags=["Capability"],
    ),
    "Extended Invisibility": edge(
        "Extended Invisibility", "Level 20, Invisibility Capability", 1,
        "The user may remain Invisible for up to 8 minutes.", tags=["Capability"],
    ),
    "Far Reading": edge(
        "Far Reading", "Level 20, Telepath Capability", 1,
        "The user treats their Focus Rank as 2 higher for the purposes of determining the range of Telepath.",
        tags=["Capability"],
    ),
    "Mixed Power": edge(
        "Mixed Power", "Level 10, invested at least 5 Level-Up Stat Points into both Attack and Special Attack", 2,
        "The user gains the Twisted Power Ability.", tags=["Ability", "Stat"], replaces="Mixed Sweeper",
    ),
    "Precise Threadings": edge(
        "Precise Threadings", "Level 20, Threaded Capability", 1,
        "The user may use their Threaded Capability at a range of 6 meters and with an AC of 3 rather than 6.",
        tags=["Capability"],
    ),
    "Realized Potential": edge(
        "Realized Potential", "Level 30, user is an Underdog Pokémon", 2,
        "Subtract the user’s Species Base Stat Total from 45. The user gains Bonus Stat Points equal to the "
        "remainder. These Stat Points must follow Base Stat Relations as normal. If the user evolves to a species "
        "with a Base Stat Total 45 or higher, Realized Potential is removed and the Tutor Points refunded.",
        tags=["Stat", "Evolution"],
    ),
    "Seismometer": edge(
        "Seismometer", "Level 20, Tremorsense Capability", 1,
        "The user’s Tremorsense range is increased by a number of meters equal to their Perception Rank.",
        tags=["Capability"],
    ),
    "Skill Improvement": edge(
        "Skill Improvement", "None", 1,
        "Rank up one Skill that is currently at or below its default level for the species. This Edge may be taken "
        "multiple times, each time selecting a different Skill. If Evolution or another permanent effect would cause "
        "the Skill Rank to go beyond 6, this Poké Edge is refunded.",
        tags=["Skill"], choices=[choice("skill")], repeatability=repeat("different-choice", None),
    ),
    "TK Mastery": edge(
        "TK Mastery", "Level 20, Telekinetic Capability", 1,
        "The user treats their Focus Rank as 2 higher for the purposes of the Telekinetic Capability.",
        tags=["Capability"],
    ),
    "Trail Sniffer": edge(
        "Trail Sniffer", "Level 20, Tracker Capability", 1,
        "The user gets a bonus to all Perception Rolls to use the Tracker Capability equal to their Focus Rank.",
        tags=["Capability"],
    ),
    "Underdog’s Lessons": edge(
        "Underdog’s Lessons", "Underdog’s Strength", 1,
        "Choose a Level-Up Move from one of the user’s Final Evolutions that it can learn at or below its current "
        "Level. The user learns that Move as if it were a Level-Up Move and can now learn Moves from TMs, HMs, "
        "and Tutoring from the lists of that Final Evolution. Underdog’s Lessons may be taken up to three times but "
        "must use the same Final Evolution each time in the case of Pokémon with multiple Final Evolutions.",
        tags=["Move", "Evolution"],
        choices=[choice("final-evolution", same=True), choice("move")], repeatability=repeat("ranked", 3),
    ),
    "Underdog’s Strength": edge(
        "Underdog’s Strength", "Level 15, user is an Underdog Pokémon", 1,
        "The user has each of their Base Stats increased by +1. The user may no longer undergo Evolution.",
        tags=["Stat", "Evolution"],
    ),
}


def repair_trainer_edges() -> None:
    raw = TRAINER_REFERENCE.read_bytes()
    current_sha = digest(raw)
    data = json.loads(raw)
    if not isinstance(data, dict) or len(data) != 61:
        raise RuntimeError("Trainer Edge reference must contain exactly 61 rows")

    already_repaired = all(data.get(name, {}).get("effect") == value for name, value in TRAINER_EFFECT_REPAIRS.items())
    if not already_repaired and current_sha != ORIGINAL_TRAINER_SHA256:
        raise RuntimeError(f"Refusing unknown Trainer Edge source drift: {current_sha}")

    for name, effect in TRAINER_EFFECT_REPAIRS.items():
        if name not in data:
            raise RuntimeError(f"Missing Trainer Edge {name}")
        data[name]["effect"] = effect
    stable_write(TRAINER_REFERENCE, data)


def write_poke_edges() -> None:
    if len(POKE_EDGES) != 20 or sorted(POKE_EDGES) != list(POKE_EDGES):
        raise RuntimeError("Poké Edge catalog must contain 20 rows in Unicode-code-point order")
    if POKE_REFERENCE.exists():
        current = json.loads(POKE_REFERENCE.read_text(encoding="utf-8"))
        if current != POKE_EDGES:
            raise RuntimeError("Refusing to overwrite a drifted app-owned Poké Edge catalog")
    stable_write(POKE_REFERENCE, POKE_EDGES)


def main() -> None:
    repair_trainer_edges()
    write_poke_edges()
    print(f"Trainer Edges: 61 ({digest(TRAINER_REFERENCE.read_bytes())})")
    print(f"Poké Edges: {len(POKE_EDGES)} ({digest(POKE_REFERENCE.read_bytes())})")


if __name__ == "__main__":
    main()
