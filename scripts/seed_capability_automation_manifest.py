#!/usr/bin/env python3
"""Freeze the canonical PTU capability corpus and seed reviewed automation metadata.

The checked-in JSON outputs are review artifacts.  This script is intentionally
strict: source drift must be reviewed instead of silently changing runtime
semantics.
"""
from __future__ import annotations

import hashlib
import json
import subprocess
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
REFERENCE = ROOT / "data/reference/capabilities.json"
OUT = ROOT / "data/capability-automation"
PARSER = ROOT / "ptu-data/parse_capabilities.py"
SOURCE_PRIORITY = [
    "books/markdown/arceus_references.md",
    "books/markdown/swsh_-_armor_crown_references.md",
    "books/markdown/sumo_references.md",
    "books/markdown/errata-3.md",
    "books/markdown/errata-2.md",
    "books/markdown/core/10-indices-and-reference.md",
    "books/markdown/core/06-playing-the-game.md",
    "books/markdown/core/02-character-creation.md",
]

NUMERIC = {
    "Burrow", "High Jump", "Jump", "Levitate", "Long Jump", "Overland",
    "Power", "Sky", "Swim", "Teleporter", "Throwing Range",
}
MOVEMENT = {
    "Amorphous", "Inflatable", "Mountable X", "Naturewalk", "Phasing",
    "Reach", "Shadow Meld", "Shrinkable", "Threaded", "Wallclimber",
}
SENSES = {
    "Aura Reader", "Blindsense", "Darkvision", "Dead Silent", "Dream Reader",
    "Glow", "Invisibility", "Magnetic", "Mindlock", "Premonition", "Stealth",
    "Tracker", "Tremorsense", "X-Ray Vision",
}
COMMUNICATION = {"Aura Pulse", "Pack Mon", "Telepath", "Telekinetic", "Wired"}
STRUGGLE = {"Firestarter", "Fountain", "Freezer", "Guster", "Materializer", "Zapper"}
TERRAIN = {"Groundshaper", "Gilled"}
CRAFTING = {"Blender", "Illusionist", "Living Weapon", "Planter", "Shapeshifter", "Wielder"}
GATHERING = {
    "Alluring", "Dream Mist", "Egg Warmer", "Fortune", "Gather Unown",
    "Heart Gift", "Herb Growth", "Honey Gather", "Juicer", "Milk Collection",
    "Mushroom Harvest", "Pearl Creation", "Sprouter",
}
FORMS = {
    "As One", "Bloom", "Delta Evolution", "Keystone Warp", "Letter Press",
    "Marsupial", "Split Evolution", "Viral Fusion", "Weapon Bond",
    "Weathershape", "Zygarde Cells",
}
INTEGRATED = {"Chilled", "Heater", "Soulless", "Underdog", "Volatile Bomb"}

# Reviewed source-owned actions.  Contextual means the presentation layer must
# prove the named context before surfacing an offer; this is never a universal
# "Use Capability" menu.
ACTIONS: dict[str, list[dict[str, Any]]] = {
    "Alluring": [
        {"id": "lure-with-alluring", "action": "extended", "frequency": "daily", "context": "alluring-lure-cell"},
        {"id": "resolve-alluring-lure-check", "action": "none", "frequency": "at-will", "context": "alluring-lure-due"},
        {"id": "abandon-alluring-lure", "action": "none", "frequency": "at-will", "context": "alluring-lure-active"},
        {"id": "distract-with-alluring", "action": "standard", "frequency": "daily", "context": "wild-target"},
    ],
    "As One": [
        {"id": "mount", "action": "extended", "frequency": "at-will", "context": "adjacent-willing-mount"},
        {"id": "dismount", "action": "extended", "frequency": "at-will", "context": "adjacent-release-cell"},
    ],
    "Aura Pulse": [{"id": "communicate", "action": "free", "frequency": "at-will", "context": "communication-target"}],
    "Aura Reader": [{"id": "read-aura", "action": "standard", "frequency": "at-will", "context": "living-target"}],
    "Blender": [{"id": "blend", "action": "shift", "frequency": "at-will", "context": "encounter"}],
    "Delta Evolution": [{"id": "mega-evolve", "action": "swift", "frequency": "at-will", "context": "delta-mega-ready"}],
    "Dream Mist": [{"id": "produce-dream-mist", "action": "extended", "frequency": "daily", "context": "collection-jar"}],
    "Dream Reader": [{"id": "read-dream", "action": "standard", "frequency": "at-will", "context": "sleeping-target"}],
    "Egg Warmer": [{"id": "warm-egg", "action": "extended", "frequency": "cooldown", "context": "egg"}],
    "Fortune": [{"id": "roam-for-fortune", "action": "extended", "frequency": "daily", "context": "city-or-town-one-hour"}],
    "Gather Unown": [{"id": "gather-unown", "action": "standard", "frequency": "weekly", "context": "open-space"}],
    "Glow": [
        {"id": "emit-light", "action": "free", "frequency": "at-will", "context": "not-glowing"},
        {"id": "stop-light", "action": "free", "frequency": "at-will", "context": "glowing"},
        {"id": "influence-nearby-wilds", "action": "free", "frequency": "at-will", "context": "glowing-nearby-wilds"},
    ],
    "Groundshaper": [{"id": "shape-ground", "action": "standard", "frequency": "at-will", "context": "cardinal-ground-cells"}],
    "Heart Gift": [{"id": "produce-heart-scale", "action": "extended", "frequency": "weekly", "context": "item-recipient"}],
    "Herb Growth": [{"id": "produce-revival-herb", "action": "extended", "frequency": "daily", "context": "item-recipient"}],
    "Honey Gather": [{"id": "gather-honey", "action": "extended", "frequency": "daily", "context": "abundant-plant-life-and-collection-jar"}],
    "Illusionist": [
        {"id": "create-illusion", "action": "standard", "frequency": "at-will", "context": "visible-cell"},
        {"id": "reposition-illusion", "action": "free", "frequency": "at-will", "context": "moving-illusion"},
        {"id": "dismiss-illusion", "action": "free", "frequency": "at-will", "context": "owned-illusion"},
    ],
    "Inflatable": [
        {"id": "inflate", "action": "standard", "frequency": "at-will", "context": "normal-form"},
        {"id": "deflate", "action": "shift", "frequency": "at-will", "context": "inflated"},
    ],
    "Invisibility": [
        {"id": "become-invisible", "action": "shift", "frequency": "cooldown", "context": "visible-and-ready"},
        {"id": "become-visible", "action": "free", "frequency": "at-will", "context": "invisible"},
    ],
    "Juicer": [
        {"id": "consume-juicer-shell-juice-as-snack", "action": "extended", "frequency": "at-will", "context": "stored-juicer-juice"},
        {"id": "collect-juicer-output", "action": "extended", "frequency": "at-will", "context": "stored-juicer-output"},
    ],
    "Jump": [{"id": "jump", "action": "shift", "frequency": "at-will", "context": "jump-destination-cell"}],
    "Keystone Warp": [
        {"id": "synchronize-keystone", "action": "extended", "frequency": "at-will", "context": "unsynchronized-keystone-and-2tp"},
        {"id": "keystone-warp", "action": "standard", "frequency": "at-will", "context": "synchronized-keystone"},
    ],
    "Letter Press": [{"id": "combine-unown", "action": "extended", "frequency": "at-will", "context": "eligible-unown"}],
    "Living Weapon": [
        {"id": "engage-wielder", "action": "standard", "frequency": "at-will", "context": "adjacent-willing-wielder"},
        {"id": "disengage-wielder", "action": "swift", "frequency": "at-will", "context": "adjacent-release-cell"},
        {"id": "ready-light-shield", "action": "standard", "frequency": "at-will", "context": "wielded-aegislash"},
    ],
    "Magnetic": [{"id": "manipulate-metal", "action": "standard", "frequency": "at-will", "context": "iron-or-steel-object"}],
    "Milk Collection": [{"id": "produce-moomoo-milk", "action": "extended", "frequency": "daily", "context": "collection-jar"}],
    "Marsupial": [{"id": "shelter-baby", "action": "free", "frequency": "at-will", "context": "adjacent-willing-baby-target"}],
    "Mountable X": [
        {"id": "accept-rider", "action": "extended", "frequency": "at-will", "context": "adjacent-willing-rider"},
        {"id": "release-rider", "action": "extended", "frequency": "at-will", "context": "linked-rider-and-adjacent-cell"},
    ],
    "Mushroom Harvest": [{"id": "harvest-mushroom", "action": "extended", "frequency": "daily", "context": "item-recipient"}],
    "Phasing": [
        {"id": "become-intangible", "action": "standard", "frequency": "at-will", "context": "tangible"},
        {"id": "become-tangible", "action": "shift", "frequency": "at-will", "context": "intangible"},
    ],
    "Planter": [
        {"id": "plant", "action": "extended", "frequency": "at-will", "context": "empty-planter-and-seed"},
        {"id": "harvest", "action": "extended", "frequency": "at-will", "context": "yielding-planter"},
    ],
    "Shadow Meld": [
        {"id": "meld", "action": "standard", "frequency": "at-will", "context": "lit-surface-shadow"},
        {"id": "reform", "action": "shift", "frequency": "at-will", "context": "shadow-melded"},
        {"id": "ride-shadow", "action": "shift", "frequency": "at-will", "context": "adjacent-living-shadow"},
        {"id": "leave-shadow", "action": "shift", "frequency": "at-will", "context": "adjacent-release-cell"},
    ],
    "Shapeshifter": [
        {"id": "change-shape", "action": "standard", "frequency": "at-will", "context": "valid-shape-description"},
        {"id": "oppose-examination", "action": "free", "frequency": "at-will", "context": "close-examination-target"},
        {"id": "restore-shape", "action": "standard", "frequency": "at-will", "context": "shapechanged"},
    ],
    "Shrinkable": [
        {"id": "shrink", "action": "standard", "frequency": "at-will", "context": "normal-form"},
        {"id": "restore-size", "action": "standard", "frequency": "at-will", "context": "shrunken"},
    ],
    "Sprouter": [{"id": "sprout", "action": "standard", "frequency": "weekly", "context": "plant-or-planted-berry"}],
    "Telekinetic": [
        {"id": "manipulate-object", "action": "standard", "frequency": "at-will", "context": "object-in-8m"},
        {"id": "telekinetic-maneuver", "action": "standard", "frequency": "at-will", "context": "maneuver-target-in-focus-range"},
    ],
    "Telepath": [
        {"id": "read-mind", "action": "standard", "frequency": "at-will", "context": "mind-in-focus-range"},
        {"id": "project-thought", "action": "free", "frequency": "at-will", "context": "communication-targets"},
    ],
    "Teleporter": [{"id": "teleport", "action": "shift", "frequency": "at-will", "context": "teleport-destination-cell"}],
    "Threaded": [{"id": "threaded-shift", "action": "shift", "frequency": "at-will", "context": "anchor-or-target-in-4m"}],
    "Tracker": [{"id": "track-scent", "action": "extended", "frequency": "hourly", "context": "scent-trail"}],
    "Viral Fusion": [
        {"id": "bond", "action": "extended", "frequency": "at-will", "context": "willing-or-helpless-target"},
        {"id": "release-bond", "action": "extended", "frequency": "at-will", "context": "adjacent-release-cell"},
    ],
    "Weapon Bond": [
        {"id": "assume-crowned-form", "action": "extended", "frequency": "at-will", "context": "ancestral-weapon"},
        {"id": "relinquish-crowned-form", "action": "extended", "frequency": "at-will", "context": "crowned-form"},
    ],
    "Wired": [
        {"id": "enter-machine", "action": "standard", "frequency": "at-will", "context": "electronic-device"},
        {"id": "exit-machine", "action": "shift", "frequency": "at-will", "context": "inside-machine"},
    ],
    "Zygarde Cells": [
        {"id": "assemble-zygarde", "action": "extended", "frequency": "at-will", "context": "zygarde-cube-and-cells"},
        {"id": "disassemble-zygarde", "action": "extended", "frequency": "at-will", "context": "disassemblable-zygarde"},
        {"id": "change-zygarde-form", "action": "extended", "frequency": "at-will", "context": "power-construct-zygarde"},
        {"id": "tutor-cube-move", "action": "extended", "frequency": "at-will", "context": "zygarde-cube-and-tp"},
    ],
}

BOUNDED_GM = {
    "Alluring", "Aura Reader", "Dream Reader", "Egg Warmer", "Fortune",
    "Glow", "Illusionist", "Letter Press", "Magnetic",
    "Marsupial", "Pack Mon", "Planter", "Premonition", "Shapeshifter",
    "Split Evolution", "Sprouter", "Telepath", "Tracker", "Wired", "X-Ray Vision",
    "Zygarde Cells",
}
LEVEL_REQUIREMENTS = {
    "Dream Mist": 20, "Fortune": 20, "Gather Unown": 20, "Heart Gift": 30,
    "Herb Growth": 20, "Milk Collection": 20, "Mushroom Harvest": 20,
}
PASSIVE_REQUIREMENT_OVERRIDES: dict[str, dict[str, str]] = {
    "As One": {
        "given": "an exact effective As One source carries one authoritative mount and retains a legal non-Wonder-Guard Basic Ability choice",
        "when": "the combined participant's Ability field and move rules are projected",
        "then": "the chosen Basic Ability enters the owner's ordinary Ability projection before suppression while the carried participant has no independent Ability field",
    },
    "Illusionist": {
        "given": "an exact effective Illusionist source maintains one bounded visual Illusion",
        "when": "it is projected, contacted along authoritative movement, viewed under an active Foresight-family bypass, or loses its exact source",
        "then": "ordinary viewers receive only the life-like appearance, the bypass owner privately identifies and ignores it, contact marks it noticeably disrupted without destroying maintenance, and source loss removes its authority",
    },
    "Mindlock": {
        "given": "an effective Mindlock source is consulted by telepathy, Dream Reader, Gentle Vibe, Mind Reader, or Telepathic Warning authority",
        "when": "the protected participant is targeted or originates the protected attack",
        "then": "mind and dream reads are rejected, Gentle Vibe excludes the participant, Mind Reader automatically misses without applying its read marker, and Telepathic Warning cannot trigger from that attack",
    },
    "Living Weapon": {
        "given": "an exact effective Honedge-line Living Weapon source is engaged with a willing wielder",
        "when": "equipment, movement, Ability, weapon Move, Accuracy, and Damage rules are projected",
        "then": "the exact source supplies its species profile and rank-gated Moves, preserves one wielder-speed movement budget across both participants' turns until the round resets, suppresses No Guard, forces Aegislash Blade Forme, and applies -2 to every automated weapon roll made with it (Accuracy and Damage) while fainted",
    },
    "Mountable X": {
        "given": "an effective valued Mountable source has adjacent willing riders and any bounded campaign guideline override",
        "when": "rider type, significant extra weight, and rider capacity are validated",
        "then": "the canonical average-Trainer capacity is the default guideline while one exact GM-authored override may approve riders, adjust capacity from 0 through 16, or allow significant extra weight",
    },
    "Wielder": {
        "given": "an effective Wielder holds a size-legal man-made Small or Large Melee Weapon",
        "when": "equipment, Disarm, Struggle, Reach, Accuracy, Damage Base, and weapon Move rules are projected",
        "then": "the server applies the exact melee profile and grants only its Adept Combat Move even when the wielder qualifies for Master rank; ranged, size-illegal, and Master-only grants remain unavailable",
    },
    "X-Ray Vision": {
        "given": "an effective X-Ray Vision source examines one bounded GM-authored solid barrier",
        "when": "the barrier has a retained material and non-negative finite thickness",
        "then": "the server permits sight through at most one foot while any lead- or tungsten-bearing composite blocks sight regardless of thickness and unknown material fails closed",
    },
}

ACTION_REQUIREMENT_OVERRIDES: dict[tuple[str, str], dict[str, str]] = {
    ("Alluring", "lure-with-alluring"): {
        "given": "the exact effective Alluring source has no active lure and its shared daily Bait use is available",
        "when": "an authorised GM retains a canonical species, bounded level, and legal appearance cell",
        "then": "the server spends the shared daily use and persists a source-owned lure task whose first check is due exactly 15 minutes later without rolling early",
    },
    ("Alluring", "resolve-alluring-lure-check"): {
        "given": "the exact source-owned lure remains active and one or more 15-minute check boundaries have elapsed",
        "when": "the authoritative lifecycle check is resolved",
        "then": "the server rolls only elapsed checks with server randomness, retains failures and the next boundary, expires after the third failure, or atomically creates the retained GM-selected encounter on success",
    },
    ("Alluring", "abandon-alluring-lure"): {
        "given": "the exact source-owned Alluring lure is active",
        "when": "the lure is abandoned, its actor moves, is removed, or loses that exact source",
        "then": "the durable lure task is removed without refunding or duplicating the shared daily use",
    },
    ("Alluring", "distract-with-alluring"): {
        "given": "the exact effective Alluring source targets an authoritative Wild Pokémon and its shared daily Bait use is available",
        "when": "the Standard Action distraction is declared",
        "then": "the target makes a server-owned Focus check against DC 12 and a failure durably spends its next Standard Action",
    },
    ("Living Weapon", "engage-wielder"): {
        "given": "an exact effective Honedge-line source and an adjacent willing participant satisfy authoritative hand or Held Item occupancy",
        "when": "either controlled party initiates re-engagement as a Standard Action during that acting party's turn",
        "then": "the server spends the initiating party's action and atomically creates one exact source-owned Living Weapon link with shared movement authority",
    },
    ("Living Weapon", "disengage-wielder"): {
        "given": "an exact source-effective Living Weapon link exists",
        "when": "either controlled party initiates disengagement as a Swift Action during that acting party's turn and selects a legal separation cell",
        "then": "the server spends the initiating party's action, removes only that exact link, and authoritatively separates the Living Weapon without duplicating movement",
    },
    ("Living Weapon", "ready-light-shield"): {
        "given": "an exact effective Aegislash Living Weapon source is engaged with the acting wielder",
        "when": "the controlled wielder readies its Living Weapon Light Shield as a Standard Action",
        "then": "the server grants +4 total Evasion, 10 Damage Reduction, and Slowed through the end of the wielder's next turn, with exact-link and source-loss cleanup",
    },
    ("Gather Unown", "gather-unown"): {
        "given": "an effective Level 20 Gather Unown source selects one legal authoritative destination",
        "when": "the server rolls the summoned Unown's level and form",
        "then": "the server creates one non-hostile independent Unown with canonical Hidden Power and no inherited encounter side",
    },
    ("Letter Press", "combine-unown"): {
        "given": "an effective Letter Press source selects willing independent Unown and bounded permanent choices",
        "when": "the irreversible combination is validated",
        "then": "the server rejects nested Prime or already-combined participants and atomically removes only legal independent sources while retaining permanent provenance",
    },
    ("Telekinetic", "telekinetic-maneuver"): {
        "given": "an effective Telekinetic source targets one participant within Focus Rank metres",
        "when": "it attempts Push, Trip, or Disarm using the reviewed Status Attack and opposed Focus rules",
        "then": "the server rejects effective intangible targets, applies authoritative Accuracy and Evasion with natural 1 always missing and natural 20 always hitting, compares exact Trainer weight when available for Push, and rounds half Focus Rank down without a one-metre minimum",
    },
    ("Telepath", "project-thought"): {
        "given": "an effective Pokémon Telepath selects no more than half its Focus Rank in communication targets",
        "when": "the free thought projection is validated",
        "then": "ordinary Trainers are legal recipients while Pokémon recipients must themselves have effective Telepath",
    },
    ("Wired", "exit-machine"): {
        "given": "an exact effective Wired source occupies one authoritative electronic device",
        "when": "it selects an exit device and exact retained cell",
        "then": "the occupied device is always a legal exit while cross-device travel requires matching non-empty bounded authoritative network identities",
    },
    ("Zygarde Cells", "assemble-zygarde"): {
        "given": "one effective unassembled Zygarde template is linked to an exact Cube owner with sufficient retained Cells",
        "when": "the GM retains legal Cell count, Forme, Nature, and Level choices",
        "then": "the server consumes Cells once and binds durable assembly authority to both the current placement and stable Pokémon sheet identity",
    },
    ("Zygarde Cells", "disassemble-zygarde"): {
        "given": "one 10- or 50-Cell Zygarde has unambiguous durable assembly authority and its exact Cube owner is available",
        "when": "the Extended Action returns it to Cells",
        "then": "the server returns the exact Cell count, removes the construct from play and every roster, and irreversibly prevents the archived sheet from acting or deploying",
    },
    ("Zygarde Cells", "change-zygarde-form"): {
        "given": "one 100-Cell Power Construct Zygarde has unambiguous durable assembly authority",
        "when": "its exact Cube owner changes it between 10% and 50% Formes",
        "then": "the server updates both active Forme mode and stable sheet-owned authority so recall and send-out restore the chosen Forme under a new placement identity",
    },
    ("Threaded", "threaded-shift"): {
        "given": "an effective Threaded source selects an authoritative object, anchor, or participant within four metres",
        "when": "relative weight and willingness determine which participant moves",
        "then": "the server resolves any required AC 6 Status Attack with natural 1 always missing and natural 20 always hitting, then commits only legal authoritative movement",
    },
}

ITEM_OUTPUTS = {
    "Dream Mist": ["Dream Mist"], "Heart Gift": ["Heart Scale"],
    "Herb Growth": ["Revival Herb"], "Honey Gather": ["Honey"],
    "Juicer": ["Shuckle’s Berry Juice", "Rare Candy"],
    "Milk Collection": ["MooMoo Milk"],
    "Mushroom Harvest": ["Tiny Mushroom", "Big Mushroom", "Balm Mushroom"],
}


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def stable_bytes(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()


def git_blob(path: str) -> str:
    return subprocess.check_output(["git", "hash-object", path], cwd=ROOT, text=True).strip()


def category(name: str) -> str:
    for label, names in [
        ("numeric", NUMERIC), ("movement", MOVEMENT), ("sense", SENSES),
        ("communication", COMMUNICATION), ("struggle", STRUGGLE),
        ("terrain", TERRAIN), ("crafting", CRAFTING), ("gathering", GATHERING),
        ("form", FORMS), ("integrated", INTEGRATED),
    ]:
        if name in names:
            return label
    raise ValueError(f"Unclassified capability: {name}")


def ticket_for(name: str) -> str:
    group = category(name)
    return {
        "numeric": "CA-030", "movement": "CA-031", "sense": "CA-033",
        "communication": "CA-034", "struggle": "CA-035", "terrain": "CA-036",
        "crafting": "CA-037", "gathering": "CA-038", "integrated": "CA-039",
        "form": "CA-040",
    }[group]


def source_path_for(basename: str) -> str:
    matches = [path for path in SOURCE_PRIORITY if Path(path).name == basename]
    if len(matches) != 1:
        raise ValueError(f"Expected exactly one source for {basename}: {matches}")
    return matches[0]


def write_json(name: str, value: Any) -> None:
    (OUT / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    corpus = json.loads(REFERENCE.read_text(encoding="utf-8"))
    if not isinstance(corpus, dict) or len(corpus) != 83:
        raise ValueError("Canonical capability corpus must be an 83-entry object")
    ids = sorted(corpus)
    if set(ids) != (NUMERIC | MOVEMENT | SENSES | COMMUNICATION | STRUGGLE | TERRAIN | CRAFTING | GATHERING | FORMS | INTEGRATED):
        missing = set(ids) - (NUMERIC | MOVEMENT | SENSES | COMMUNICATION | STRUGGLE | TERRAIN | CRAFTING | GATHERING | FORMS | INTEGRATED)
        extra = (NUMERIC | MOVEMENT | SENSES | COMMUNICATION | STRUGGLE | TERRAIN | CRAFTING | GATHERING | FORMS | INTEGRATED) - set(ids)
        raise ValueError(f"Classification drift; missing={missing}, extra={extra}")

    source_rows = []
    for priority, path in enumerate(SOURCE_PRIORITY):
        raw = (ROOT / path).read_bytes()
        source_rows.append({
            "priority": priority,
            "path": path,
            "basename": Path(path).name,
            "bytes": len(raw),
            "sha256": sha256_bytes(raw),
            "gitBlob": git_blob(path),
        })
    source_by_path = {row["path"]: row for row in source_rows}

    records = []
    for index, name in enumerate(ids):
        record = corpus[name]
        if record.get("name") != name or not record.get("effect") or not record.get("source"):
            raise ValueError(f"Malformed canonical record {name}")
        path = source_path_for(record["source"])
        records.append({
            "index": index,
            "canonicalId": name,
            "source": record["source"],
            "sourcePath": path,
            "sourceSha256": source_by_path[path]["sha256"],
            "effectSha256": sha256_bytes(record["effect"].encode()),
            "recordSha256": sha256_bytes(stable_bytes(record)),
        })

    reference_raw = REFERENCE.read_bytes()
    parser_raw = PARSER.read_bytes()
    ruleset = {
        "schemaVersion": 1,
        "rulesetId": "ptu-1.05-capability-automation",
        "canonicalSource": {
            "path": "data/reference/capabilities.json",
            "entryCount": len(ids),
            "bytes": len(reference_raw),
            "sha256": sha256_bytes(reference_raw),
            "gitBlob": git_blob("data/reference/capabilities.json"),
        },
        "parser": {
            "path": "ptu-data/parse_capabilities.py",
            "bytes": len(parser_raw),
            "sha256": sha256_bytes(parser_raw),
            "gitBlob": git_blob("ptu-data/parse_capabilities.py"),
        },
        "sourcePriority": source_rows,
        "precedencePolicy": "first parsed definition wins in listed newest-supplement-to-core order",
        "runtimeAuthority": "data/reference/capabilities.json",
        "reviewPolicy": {
            "sourceDrift": "fail-closed",
            "unknownCapability": "preserve-as-unresolved-sheet-label-and-do-not-execute",
            "ambiguousRule": "bounded-gm-adjudication-with-structured-audit-note",
            "clientAuthority": "none",
        },
    }
    write_json("ruleset.json", ruleset)

    inventory = {
        "schemaVersion": 1,
        "rulesetId": ruleset["rulesetId"],
        "canonicalSourceSha256": ruleset["canonicalSource"]["sha256"],
        "entryCount": len(ids),
        "identityOrder": "unicode-code-point",
        "canonicalIds": ids,
        "records": records,
        "parserAudit": {
            "parsedEntryCount": 83,
            "sourceContributions": {
                "arceus_references.md": 0,
                "swsh_-_armor_crown_references.md": 2,
                "sumo_references.md": 2,
                "errata-3.md": 0,
                "errata-2.md": 0,
                "10-indices-and-reference.md": 68,
                "06-playing-the-game.md": 9,
                "02-character-creation.md": 2,
            },
            "shadowedDefinitions": [],
            "canonicalDifferencesFromParserOutput": [
                {"canonicalId": "Sky", "adjudicationId": "CA-SRC-001"},
                {"canonicalId": "Levitate", "adjudicationId": "CA-SRC-002"},
            ],
            "status": "reviewed",
        },
    }
    write_json("inventory.json", inventory)

    adjudications = {
        "schemaVersion": 1,
        "rulesetId": ruleset["rulesetId"],
        "status": "reviewed-no-open-source-gaps",
        "entries": [
            {
                "id": "CA-SRC-001", "canonicalId": "Sky", "status": "accepted",
                "issue": "The basic-capability paragraph omits the Groundsource immunity used by the Groundsource keyword definition and later rules.",
                "decision": "Retain the canonical sentence: a positive Sky Speed grants Groundsource immunity unless a grounding rule suppresses it.",
                "evidence": ["books/markdown/core/06-playing-the-game.md", "books/markdown/core/10-indices-and-reference.md"],
            },
            {
                "id": "CA-SRC-002", "canonicalId": "Levitate", "status": "accepted",
                "issue": "The basic-capability paragraph omits the Groundsource immunity used by the Groundsource keyword definition and later rules.",
                "decision": "Retain the canonical sentence: a positive Levitate Speed grants Groundsource immunity unless a grounding rule suppresses it.",
                "evidence": ["books/markdown/core/06-playing-the-game.md", "books/markdown/core/10-indices-and-reference.md"],
            },
            {
                "id": "CA-SRC-003", "canonicalId": "Power", "status": "accepted",
                "issue": "The parser intentionally captures the Power prose before the source table.",
                "decision": "Runtime limits use the complete 1-16 table in the same source; the frozen table is checked separately.",
                "evidence": ["books/markdown/core/06-playing-the-game.md", "src/utils/usefulCharts.ts"],
            },
            {
                "id": "CA-SRC-004", "canonicalId": "Mountable X", "status": "accepted",
                "issue": "X is a parameter while species and sheet data use labels such as Mountable 1.",
                "decision": "Canonical identity remains Mountable X; strict acquisition parsing records the positive integer as parameter riders.",
                "evidence": ["books/markdown/core/10-indices-and-reference.md", "data/reference/pokedex.json"],
            },
            {
                "id": "CA-SRC-005", "canonicalId": "Freezer", "status": "accepted",
                "issue": "Source extraction joins Ice-Typed as IceTyped (and Guster similarly joins Flying-Typed).",
                "decision": "Preserve source prose bytes but normalize the reviewed struggle-attack type to canonical Pokémon type IDs.",
                "evidence": ["books/markdown/core/10-indices-and-reference.md"],
            },
            {
                "id": "CA-SRC-006", "canonicalId": "Swim", "status": "accepted",
                "issue": "The final sentence refers to an Underwater Capability rather than Swim.",
                "decision": "Treat Underwater as an obvious local reference to the Swim Capability; Dive adds 3 to Swim.",
                "evidence": ["books/markdown/core/06-playing-the-game.md"],
            },
            {
                "id": "CA-SRC-007", "canonicalId": "Sky", "status": "accepted",
                "issue": "The Fly Move record says Grants Sky +3 while the canonical Sky Capability says Fly raises Sky by 4.",
                "decision": "Capability acquisition follows the canonical Capability rule: Fly grants or raises Sky by 4.",
                "evidence": ["data/reference/capabilities.json", "data/reference/moves.json", "books/markdown/core/06-playing-the-game.md"],
            },
            {
                "id": "CA-SRC-008", "canonicalId": "Delta Evolution", "status": "accepted",
                "issue": "Species data contains reviewed spelling noise: Delta Evolver, X- Ray Vision, Invisbility, and a merged Tracker Underdog label.",
                "decision": "Normalize only those exact compatibility spellings and split the exact merged label into Tracker plus Underdog; retain every raw source label as provenance.",
                "evidence": ["data/reference/pokedex.json", "data/reference/capabilities.json"],
            },
        ],
    }
    write_json("source-adjudications.json", adjudications)

    manifest_entries = []
    for name in ids:
        actions = ACTIONS.get(name, [])
        group = category(name)
        passive_only = not actions
        manifest_entries.append({
            "canonicalId": name,
            "ticketId": ticket_for(name),
            "category": group,
            "automationStatus": "native",
            "runtimeKind": "numeric" if group == "numeric" else "action-and-passive" if actions else "passive-or-integrated",
            "presentationPolicy": "contextual-offer" if actions else "passive-fact-only",
            "adjudicationPolicy": "bounded-gm" if name in BOUNDED_GM else "deterministic",
            "levelRequirement": LEVEL_REQUIREMENTS.get(name),
            "itemOutputs": ITEM_OUTPUTS.get(name, []),
            "actions": actions,
            "passiveProjection": True,
            "serverAuthoritative": True,
            "legacyExecutionAllowed": False,
            "sourceEffectSha256": next(row["effectSha256"] for row in records if row["canonicalId"] == name),
        })
    manifest = {
        "schemaVersion": 1,
        "rulesetId": ruleset["rulesetId"],
        "canonicalSourceSha256": ruleset["canonicalSource"]["sha256"],
        "entryCount": len(manifest_entries),
        "entries": manifest_entries,
        "certification": {
            "unresolvedEntries": 0,
            "manualOnlyEntries": 0,
            "legacyExecutableEntries": 0,
            "reviewedAt": "2026-07-28",
        },
    }
    write_json("manifest.json", manifest)

    requirements = []
    for entry in manifest_entries:
        name = entry["canonicalId"]
        passive_requirement = PASSIVE_REQUIREMENT_OVERRIDES.get(name, {
            "given": "the actor owns an effective canonical capability instance",
            "when": "the authoritative encounter presentation is projected",
            "then": "a source-labelled capability fact is emitted without creating an action offer unless reviewed context is satisfied",
        })
        requirements.append({
            "id": f"capability:{name}:passive",
            "canonicalId": name,
            "kind": "passive-projection",
            **passive_requirement,
        })
        for action in entry["actions"]:
            requirement = ACTION_REQUIREMENT_OVERRIDES.get((name, action["id"]), {
                "given": f"the actor owns the capability and authoritative context satisfies {action['context']}",
                "when": "the capability action is offered and declared",
                "then": "the server revalidates ownership, context, action economy and frequency, resolves deterministic rolls, commits typed state atomically, and returns replay-safe public output",
            })
            requirements.append({
                "id": f"capability:{name}:action:{action['id']}",
                "canonicalId": name,
                "kind": "contextual-action",
                "actionId": action["id"],
                **requirement,
            })
    write_json("scenario-requirements.json", {
        "schemaVersion": 1,
        "rulesetId": ruleset["rulesetId"],
        "requirementCount": len(requirements),
        "requirements": requirements,
    })

    power_rows = [
        [1, 2, 5, 10, 20], [2, 20, 30, 60, 120], [3, 35, 50, 100, 200],
        [4, 45, 70, 140, 280], [5, 60, 90, 180, 360], [6, 75, 115, 230, 460],
        [7, 100, 140, 300, 600], [8, 120, 190, 380, 760], [9, 150, 240, 480, 960],
        [10, 200, 300, 600, 1200], [11, 250, 375, 750, 1500], [12, 350, 450, 900, 1800],
        [13, 450, 525, 1050, 2100], [14, 500, 600, 1200, 2400], [15, 550, 675, 1350, 2700],
        [16, 600, 750, 1500, 3000],
    ]
    write_json("power-chart.json", {
        "schemaVersion": 1,
        "source": "books/markdown/core/06-playing-the-game.md",
        "units": "lb",
        "rows": [
            {"power": p, "heavyMinimum": h0, "heavyMaximum": h1, "staggeringMaximum": s, "dragMaximum": d}
            for p, h0, h1, s, d in power_rows
        ],
    })

    print(f"Seeded {len(ids)} reviewed capabilities and {len(requirements)} scenarios in {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
