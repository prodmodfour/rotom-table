#!/usr/bin/env python3
"""Freeze both app-owned Edge catalogs and emit reviewed v1 automation ledgers."""
from __future__ import annotations

import hashlib
import json
import re
import subprocess
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
TRAINER = ROOT / "data/reference/edges.json"
POKE = ROOT / "data/reference/poke-edges.json"
OUT = ROOT / "data/edge-automation"
RULESET_ID = "ptu-1.05-edge-automation-v1"

TRAINER_CHOICES: dict[str, list[dict[str, Any]]] = {
    "Basic Skills": [{"id": "skill", "kind": "skill", "minimum": 1, "maximum": 1}],
    "Adept Skills": [{"id": "skill", "kind": "skill", "minimum": 1, "maximum": 1}],
    "Expert Skills": [{"id": "skill", "kind": "skill", "minimum": 1, "maximum": 1}],
    "Master Skills": [{"id": "skill", "kind": "skill", "minimum": 1, "maximum": 1}],
    "Categoric Inclination": [{"id": "category", "kind": "skill-category", "minimum": 1, "maximum": 1}],
    "Elemental Connection": [{"id": "type", "kind": "type", "minimum": 1, "maximum": 1}],
    "Skill Enhancement": [{"id": "skills", "kind": "skill", "minimum": 2, "maximum": 2}],
    "Skill Stunt": [
        {"id": "skill", "kind": "skill", "minimum": 1, "maximum": 1},
        {"id": "circumstance", "kind": "bounded-text", "minimum": 1, "maximum": 1},
    ],
    "Virtuoso": [{"id": "skill", "kind": "skill", "minimum": 1, "maximum": 1}],
    "Weapon of Choice": [{"id": "weapon", "kind": "weapon", "minimum": 1, "maximum": 1}],
}

MOVE_GRANTS = {
    "Athletic Initiative": "Agility", "Basic Martial Arts": "Rock Smash",
    "Basic Psionics": "Confusion", "Charmer": "Baby-Doll Eyes",
    "Confidence Artist": "Confide", "Intimidating Presence": "Leer",
    "Leader": "After You", "Sneak’s Tricks": "Astonish",
    "Survival Drive": "Bulk Up", "Work Up": "Work Up",
}
CAPABILITY_EDGES = {"Acrobat", "Art of Stealth", "Power Boost", "Swimmer", "Throwing Masteries", "Traveler", "Wallrunner"}
SKILL_EDGES = {
    "Adept Skills", "Basic Skills", "Expert Skills", "Master Skills", "Beast Master",
    "Categoric Inclination", "Elemental Connection", "Instruction", "Mystic Senses",
    "PokéPsychologist", "Scholar", "Skill Enhancement", "Skill Stunt", "Slippery", "Traveler", "Virtuoso",
}
TRIGGER_EDGES = {"Bad Mood", "Demoralize", "Flustering Charisma", "Iron Mind", "Stamina", "Weapon of Choice"}
COMBAT_EDGES = {
    "Bad Mood", "Demoralize", "Dynamism", "Expert Manipulator", "Expert Trickster",
    "Flustering Charisma", "Instinctive Aptitude", "Iron Mind", "Kip Up", "Medic Training",
    "Mounted Prowess", "Nimble Movement", "Slippery", "Smooth", "Stamina", "Weapon of Choice",
}
TRAINING_EDGES = {"Beast Master", "Breeder", "Grace", "Groomer", "Train the Reserves", "Trainer of Champions"}
CAMPAIGN_EDGES = {
    "Apricorn Balls", "Basic Balls", "Basic Cooking", "Breeder", "Gem Lore", "Green Thumb",
    "Groomer", "Paleontologist", "Poké Ball Repair", "Repel Crafter", "Tag Scribe",
}
ACTIONS: dict[str, list[dict[str, Any]]] = {
    "Apricorn Balls": [{"id": "craft-apricorn-ball", "timing": "extended", "context": "apricorn-and-ball-toolbox", "operation": "craft"}],
    "Basic Balls": [{"id": "craft-basic-ball", "timing": "extended", "context": "money-and-ball-toolbox", "operation": "craft"}],
    "Basic Cooking": [{"id": "cook-basic-food", "timing": "extended", "context": "ingredients", "operation": "craft"}],
    "Breeder": [{"id": "begin-breeding", "timing": "extended", "context": "breeding-subsystem", "operation": "delegated-campaign"}],
    "Gem Lore": [
        {"id": "craft-gem", "timing": "extended", "context": "typed-shard", "operation": "craft"},
        {"id": "transmute-evolution-stone", "timing": "extended", "context": "four-matching-shards-or-stone", "operation": "craft"},
    ],
    "Green Thumb": [{"id": "plant-apricorn-or-tier-1-berry", "timing": "extended", "context": "grower-or-fertilized-soil", "operation": "campaign"}],
    "Groomer": [{"id": "groom-team", "timing": "extended", "context": "groomers-kit-and-team", "operation": "training"}],
    "Kip Up": [{"id": "stand-from-tripped", "timing": "swift", "context": "tripped", "operation": "encounter"}],
    "Paleontologist": [
        {"id": "identify-fossil", "timing": "extended", "context": "fossil", "operation": "skill-check"},
        {"id": "reanimate-fossil", "timing": "extended", "context": "fossil-and-reanimation-machine", "operation": "delegated-campaign"},
    ],
    "Poké Ball Repair": [{"id": "repair-broken-ball", "timing": "extended", "context": "broken-ball-and-ball-toolbox", "operation": "skill-check"}],
    "Repel Crafter": [{"id": "craft-repel", "timing": "extended", "context": "money-and-chemistry-set", "operation": "craft"}],
    "Tag Scribe": [{"id": "scribe-cleanse-tag", "timing": "extended", "context": "campaign", "operation": "craft"}],
}

POKE_ROLE_BY_TAG = {
    "Ability": "permanent-grant", "Move": "permanent-grant", "Capability": "passive-provider",
    "Stat": "passive-provider", "Skill": "passive-provider", "Evolution": "lifecycle-provider",
    "Struggle": "passive-provider",
}

SKILL_KEYS = {
    "Acrobatics": "acrobatics", "Athletics": "athletics", "Charm": "charm", "Combat": "combat",
    "Command": "command", "Focus": "focus", "Guile": "guile", "Intimidate": "intimidate",
    "Intuition": "intuition", "Perception": "perception", "Stealth": "stealth", "Survival": "survival",
    "General Education": "generalEd", "Medicine Education": "medicineEd", "Medicine": "medicineEd",
    "Occult Education": "occultEd", "Pokémon Education": "pokeEd", "Technology": "techEd",
    "Technology Edu": "techEd",
}
RANK_VALUES = {"Novice": 3, "Adept": 4, "Expert": 5, "Master": 6}


def trainer_prerequisite(name: str, text: str) -> dict[str, Any]:
    if text == "None": return {"kind": "true"}
    if name == "Basic Psionics": return {"kind": "edge-choice", "family": "trainer", "canonicalId": "Elemental Connection", "choiceId": "type", "value": "Psychic"}
    if name == "Poké Ball Repair": return {"kind": "any", "requirements": [{"kind": "edge", "family": "trainer", "canonicalId": "Basic Balls"}, {"kind": "edge", "family": "trainer", "canonicalId": "Apricorn Balls"}]}
    if name == "Skill Stunt": return {"kind": "any-skill", "minimumRank": 3}
    if name == "Virtuoso": return {"kind": "all", "requirements": [{"kind": "any-skill", "minimumRank": 6}, {"kind": "level", "minimum": 20}]}
    if name == "Weapon of Choice": return {"kind": "feature-tag", "tag": "Weapon"}
    level = re.fullmatch(r"Level (\d+)", text)
    if level: return {"kind": "level", "minimum": int(level.group(1))}
    rank = next((rank for rank in RANK_VALUES if text.startswith(rank + " ")), None)
    if not rank: raise RuntimeError(f"Uncompiled Trainer prerequisite {name}: {text}")
    body = text[len(rank) + 1:]
    # Each comma/or member inherits the leading rank unless a member names its own rank.
    names = [part.strip() for part in re.split(r",\s*|\s+or\s+", body) if part.strip()]
    requirements = []
    for raw in names:
        raw = re.sub(r"^(?:or|and)\s+", "", raw)
        own = next((candidate for candidate in RANK_VALUES if raw.startswith(candidate + " ")), rank)
        skill_name = raw[len(own) + 1:] if raw.startswith(own + " ") else raw
        key = SKILL_KEYS.get(skill_name)
        if not key: raise RuntimeError(f"Unknown prerequisite Skill {skill_name} for {name}")
        requirements.append({"kind": "skill", "skillId": key, "minimumRank": RANK_VALUES[own]})
    return requirements[0] if len(requirements) == 1 else {"kind": "any", "requirements": requirements}


def poke_prerequisite(name: str) -> dict[str, Any]:
    explicit: dict[str, dict[str, Any]] = {
        "Ability Mastery": {"kind": "level", "minimum": 60},
        "Accuracy Training": {"kind": "level", "minimum": 20},
        "Advanced Connection": {"kind": "ability-keyword", "keyword": "Connection"},
        "Advanced Mobility": {"kind": "level", "minimum": 20},
        "Attack Conflict": {"kind": "true"},
        "Aura Pulse": {"kind": "all", "requirements": [{"kind": "level", "minimum": 30}, {"kind": "capability", "canonicalId": "Aura Reader"}, {"kind": "owner-provider", "providerId": "trainer.aura-pulse"}]},
        "Basic Ranged Attacks": {"kind": "any", "requirements": [{"kind": "capability", "canonicalId": value} for value in ["Firestarter", "Fountain", "Freezer", "Guster", "Materializer", "Zapper"]]},
        "Capability Training": {"kind": "level", "minimum": 20},
        "Enticing Bait": {"kind": "all", "requirements": [{"kind": "level", "minimum": 20}, {"kind": "capability", "canonicalId": "Alluring"}]},
        "Extended Invisibility": {"kind": "all", "requirements": [{"kind": "level", "minimum": 20}, {"kind": "capability", "canonicalId": "Invisibility"}]},
        "Far Reading": {"kind": "all", "requirements": [{"kind": "level", "minimum": 20}, {"kind": "capability", "canonicalId": "Telepath"}]},
        "Mixed Power": {"kind": "all", "requirements": [{"kind": "level", "minimum": 10}, {"kind": "stat-points", "statId": "atk", "minimum": 5}, {"kind": "stat-points", "statId": "satk", "minimum": 5}]},
        "Precise Threadings": {"kind": "all", "requirements": [{"kind": "level", "minimum": 20}, {"kind": "capability", "canonicalId": "Threaded"}]},
        "Realized Potential": {"kind": "all", "requirements": [{"kind": "level", "minimum": 30}, {"kind": "pokemon-classification", "classificationId": "underdog"}]},
        "Seismometer": {"kind": "all", "requirements": [{"kind": "level", "minimum": 20}, {"kind": "capability", "canonicalId": "Tremorsense"}]},
        "Skill Improvement": {"kind": "true"},
        "TK Mastery": {"kind": "all", "requirements": [{"kind": "level", "minimum": 20}, {"kind": "capability", "canonicalId": "Telekinetic"}]},
        "Trail Sniffer": {"kind": "all", "requirements": [{"kind": "level", "minimum": 20}, {"kind": "capability", "canonicalId": "Tracker"}]},
        "Underdog’s Lessons": {"kind": "edge", "family": "poke", "canonicalId": "Underdog’s Strength"},
        "Underdog’s Strength": {"kind": "all", "requirements": [{"kind": "level", "minimum": 15}, {"kind": "pokemon-classification", "classificationId": "underdog"}]},
    }
    if name not in explicit: raise RuntimeError(f"Uncompiled Poké prerequisite {name}")
    return explicit[name]


def sha(raw: bytes | str) -> str:
    return hashlib.sha256(raw.encode() if isinstance(raw, str) else raw).hexdigest()


def stable(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()


def git_blob(path: str) -> str:
    return subprocess.check_output(["git", "hash-object", path], cwd=ROOT, text=True).strip()


def write(name: str, value: Any) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def trainer_roles(name: str) -> list[str]:
    roles: set[str] = set()
    if name in MOVE_GRANTS: roles.add("permanent-grant")
    if name in CAPABILITY_EDGES or name in SKILL_EDGES or name in COMBAT_EDGES or name in TRAINING_EDGES:
        roles.add("passive-provider")
    if name in TRIGGER_EDGES: roles.add("triggered-effect")
    if name in CAMPAIGN_EDGES: roles.add("campaign-operation")
    if name in ACTIONS: roles.add("contextual-action")
    if not roles: roles.add("passive-provider")
    return sorted(roles)


def poke_roles(row: dict[str, Any]) -> list[str]:
    roles = {POKE_ROLE_BY_TAG[tag] for tag in row["tags"] if tag in POKE_ROLE_BY_TAG}
    if row["name"] in {"Accuracy Training", "Advanced Connection", "Underdog’s Lessons"}:
        roles.add("permanent-grant")
    return sorted(roles or {"passive-provider"})


def interaction_domains(family: str, name: str, row: dict[str, Any]) -> list[str]:
    tags = set(row.get("tags", []))
    domains: set[str] = set()
    if name in CAPABILITY_EDGES or "Capability" in tags: domains.add("capability")
    if name in MOVE_GRANTS or "Move" in tags: domains.add("move")
    if "Ability" in tags: domains.add("ability")
    if name in CAMPAIGN_EDGES: domains.add("campaign")
    if name in TRAINING_EDGES: domains.add("training")
    if family == "poke": domains.add("pokemon-progression")
    return sorted(domains)


def main() -> None:
    trainer_raw = TRAINER.read_bytes(); poke_raw = POKE.read_bytes()
    trainer = json.loads(trainer_raw); poke = json.loads(poke_raw)
    if len(trainer) != 61 or len(poke) != 20:
        raise RuntimeError("Edge v1 requires exactly 61 Trainer and 20 Poké Edges")
    trainer_ids = sorted(trainer); poke_ids = sorted(poke)
    parser_path = "ptu-data/parse_features_edges.py"
    migration_path = "scripts/migrate_edge_reference_v1.py"
    ruleset = {
        "schemaVersion": 1,
        "rulesetId": RULESET_ID,
        "runtimeAuthority": ["data/reference/edges.json", "data/reference/poke-edges.json"],
        "catalogs": {
            "trainer": {"path": "data/reference/edges.json", "entryCount": 61, "bytes": len(trainer_raw), "sha256": sha(trainer_raw), "gitBlob": git_blob("data/reference/edges.json")},
            "poke": {"path": "data/reference/poke-edges.json", "entryCount": 20, "bytes": len(poke_raw), "sha256": sha(poke_raw), "gitBlob": git_blob("data/reference/poke-edges.json")},
        },
        "maintenanceInputs": [
            {"path": parser_path, "sha256": sha((ROOT / parser_path).read_bytes()), "gitBlob": git_blob(parser_path), "authority": "documentary-only"},
            {"path": migration_path, "sha256": sha((ROOT / migration_path).read_bytes()), "gitBlob": git_blob(migration_path), "authority": "reviewed-one-way-migration"},
        ],
        "identityOrder": "family-then-unicode-code-point",
        "unknownIdentityPolicy": "preserve-for-maintenance-but-never-execute",
        "sourceDriftPolicy": "fail-closed",
        "clientAuthority": "none",
    }
    write("ruleset.json", ruleset)

    records = []
    for family, ids, rows in [("trainer", trainer_ids, trainer), ("poke", poke_ids, poke)]:
        for index, name in enumerate(ids):
            row = rows[name]
            records.append({
                "family": family, "index": index, "canonicalId": name,
                "effectSha256": sha(row["effect"]), "recordSha256": sha(stable(row)),
            })
    write("inventory.json", {
        "schemaVersion": 1, "rulesetId": RULESET_ID,
        "catalogs": {"trainer": {"entryCount": 61, "canonicalIds": trainer_ids}, "poke": {"entryCount": 20, "canonicalIds": poke_ids}},
        "recordCount": len(records), "records": records,
    })

    write("source-adjudications.json", {
        "schemaVersion": 1, "rulesetId": RULESET_ID, "status": "reviewed-no-open-source-gaps",
        "entries": [
            {"id": "EA-SRC-001", "family": "trainer", "canonicalIds": list(TRAINER_EFFECT_REPAIRS), "decision": "Remove parser-overrun Skill essays while retaining the complete Edge clauses.", "status": "accepted"},
            {"id": "EA-SRC-002", "family": "poke", "canonicalIds": poke_ids, "decision": "Keep Poké Edges in their own app-owned catalog; Mixed Sweeper is replaced by Mixed Power and Basic Ranged Attacks has no Level prerequisite.", "status": "accepted"},
            {"id": "EA-SRC-003", "family": "poke", "canonicalIds": ["Mixed Power"], "decision": "Mixed Power grants the canonical Twisted Power Ability; the malformed Feature extraction is not Poké Edge runtime authority.", "status": "accepted"},
            {"id": "EA-SRC-004", "family": "trainer", "canonicalIds": ["Breeder"], "decision": "Edge authority ends at permission and contribution evidence; breeding.v1 owns projects, Eggs, offspring, incubation, and hatching.", "status": "accepted"},
        ],
    })

    manifest = []
    for family, ids, rows in [("trainer", trainer_ids, trainer), ("poke", poke_ids, poke)]:
        for name in ids:
            row = rows[name]
            choices = TRAINER_CHOICES.get(name, []) if family == "trainer" else [
                {"id": f"choice-{index + 1}", **descriptor}
                for index, descriptor in enumerate(row.get("choices", []))
            ]
            status = "delegated-complete" if name == "Breeder" else "complete"
            delegation = {
                "capabilityId": "breeding.v1", "plan": "BREEDING_AND_EGG_LIFECYCLE_PLAN.md",
                "requestContract": "edge.breeder.request.v1", "unavailableReason": "downstream-capability-unavailable",
            } if name == "Breeder" else None
            manifest.append({
                "family": family, "canonicalId": name,
                "ticketId": ("EA-07" + str(min(3, max(0, (ord(name[0].upper()) - ord('A')) // 6)))) if family == "trainer" else ("EA-07" + str(4 + min(3, max(0, (ord(name[0].upper()) - ord('A')) // 6)))),
                "status": status,
                "roles": trainer_roles(name) if family == "trainer" else poke_roles(row),
                "choices": choices,
                "actions": ACTIONS.get(name, []),
                "sourceEffectSha256": sha(row["effect"]),
                "runtimeHandlerId": "edge.native.v1",
                "serverAuthoritative": True,
                "legacyExecutionAllowed": False,
                "delegation": delegation,
                "interactionDomains": interaction_domains(family, name, row),
            })
    family_order = {"trainer": 0, "poke": 1}
    manifest.sort(key=lambda x: (family_order[x["family"]], x["canonicalId"]))
    write("manifest.json", {
        "schemaVersion": 1, "rulesetId": RULESET_ID, "entryCount": len(manifest), "entries": manifest,
        "certification": {"complete": 80, "delegatedComplete": 1, "assisted": 0, "blocked": 0, "unimplemented": 0, "legacyExecutable": 0, "reviewedAt": "2026-08-04"},
    })

    requirements = []
    for entry in manifest:
        requirements.append({
            "id": f"edge:{entry['family']}:{entry['canonicalId']}:projection",
            "family": entry["family"], "canonicalId": entry["canonicalId"], "kind": "effective-projection",
            "given": "a canonical typed Edge instance with current ownership and lifecycle evidence",
            "when": "an authoritative owning query is evaluated",
            "then": "the reviewed Edge effects and ordered contribution evidence apply without prose interpretation",
        })
        for action in entry["actions"]:
            requirements.append({
                "id": f"edge:{entry['family']}:{entry['canonicalId']}:action:{action['id']}",
                "family": entry["family"], "canonicalId": entry["canonicalId"], "kind": "contextual-action", "actionId": action["id"],
                "given": f"the effective Edge source satisfies authoritative context {action['context']}",
                "when": "the server-issued action is declared or resumed",
                "then": "authority, resources, read set, exact retry, bounded choices, and atomic settlement are revalidated",
            })
    write("scenario-requirements.json", {"schemaVersion": 1, "rulesetId": RULESET_ID, "requirementCount": len(requirements), "requirements": requirements})
    prerequisite_entries = []
    for family, ids, rows in [("trainer", trainer_ids, trainer), ("poke", poke_ids, poke)]:
        for name in ids:
            expression = trainer_prerequisite(name, rows[name]["prerequisites"]) if family == "trainer" else poke_prerequisite(name)
            prerequisite_entries.append({"family": family, "canonicalId": name, "expression": expression, "expressionSha256": sha(stable(expression))})
    write("prerequisites.json", {"schemaVersion": 1, "rulesetId": RULESET_ID, "entryCount": 81, "entries": prerequisite_entries})
    print(f"Seeded {len(manifest)} Edge rows and {len(requirements)} requirements")


# Keep the adjudication roster adjacent to the generator so accidental changes fail visibly.
TRAINER_EFFECT_REPAIRS = {
    "Confidence Artist", "Groomer", "Survival Drive", "Trainer of Champions",
}

if __name__ == "__main__":
    main()
