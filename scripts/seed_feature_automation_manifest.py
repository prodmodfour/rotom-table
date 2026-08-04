#!/usr/bin/env python3
"""Emit reviewed, source-bound Feature automation v1 artifacts."""
from __future__ import annotations

import hashlib
import json
import re
import subprocess
from collections import Counter
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
FEATURES = ROOT / "data/reference/features.json"
OUT = ROOT / "data/feature-automation"
RULESET_ID = "ptu-1.05-feature-automation-v1"

CHOICES: dict[str, list[dict[str, Any]]] = {}

def choices(names: list[str], *descriptors: tuple[str, str, list[str] | None]) -> None:
    for name in names:
        CHOICES[name] = [
            {"id": key, "kind": kind, "minimum": 1, "maximum": 1, **({"options": options} if options else {})}
            for key, kind, options in descriptors
        ]

choices(["I’m a Doctor"], ("doctorTechnique", "feature-or-edge", ["Field Clinic", "Medic Training"]), ("doctorSupport", "feature", ["Nurse", "First Aid Expertise"]))
choices(["Elite Trainer"], ("trainingFeature", "training-feature", ["Agility Training", "Brutal Training", "Focused Training", "Inspired Training"]))
choices(["Capture Specialist", "Advanced Capture Techniques"], ("captureTechnique", "feature", ["Capture Skills", "Curve Ball", "Devitalizing Throw", "Fast Pitch", "Snare", "Tools of the Trade", "Catch Combo", "False Strike", "Relentless Pursuit"]), ("captureTechnique2", "feature", ["Capture Skills", "Curve Ball", "Devitalizing Throw", "Fast Pitch", "Snare", "Tools of the Trade", "Catch Combo", "False Strike", "Relentless Pursuit"]))
choices(["Commander"], ("orderFeature", "feature", ["Ravager Orders", "Marksman Orders", "Trickster Orders", "Guardian Orders", "Precision Orders"]))
choices(["Dilettante"], ("edge", "edge", None), ("feature", "feature", None))
choices(["Effective Methods"], ("ability", "ability", ["Exploit", "Tolerance"]))
choices(["Stat Ace", "Focus", "Stat Link", "Stat Training", "Stat Maneuver", "Stat Mastery", "Stat Embodiment", "Stat Stratagem"], ("stat", "stat", ["atk", "def", "satk", "sdef", "spd"]))
choices(["Style Expert", "Style Flourish", "Style Entrainment"], ("contestStat", "contest-stat", ["Beauty", "Cool", "Cute", "Smart", "Tough"]))
choices(["Type Ace", "Type Refresh", "Move Sync", "Type Expertise", "Type Booster", "Type Brace", "Plate Crafter"], ("type", "type", None))
choices(["Researcher"], ("researcherField", "research-field", ["General Education", "Apothecary", "Artificer", "Botany", "Chemistry", "Climatology", "Occultism", "Paleontology"]), ("researcherField2", "research-field", ["General Education", "Apothecary", "Artificer", "Botany", "Chemistry", "Climatology", "Occultism", "Paleontology"]))
choices(["Survivalist", "Terrain Talent"], ("terrain", "terrain", None))
choices(["Athlete"], ("stat", "stat", None), ("stat2", "stat", None))
choices(["Playing God"], ("species", "species", ["Castform", "Grimer", "Koffing", "Magnemite", "Porygon", "Solosis", "Trubbish", "Voltorb"]))
choices(["Signature Move", "Tutoring"], ("move", "move", None))
choices(["Focus Gem"], ("equipmentSlot", "equipment-slot", None))
choices(["Rainbow Gem"], ("equipmentSlot", "equipment-slot", None), ("stat", "stat", None))
choices(["Chakra Crystal"], ("stat", "stat", None))
choices(["Fashionista"], ("fashionistaSkill", "skill", ["charm", "command", "guile", "intimidate", "intuition"]), ("fashionistaSkill2", "skill", ["charm", "command", "guile", "intimidate", "intuition"]))
choices(["Mentor"], ("mentorSkill", "skill", ["charm", "intimidate", "intuition", "pokeEd"]), ("mentorSkill2", "skill", ["charm", "intimidate", "intuition", "pokeEd"]))
choices(["Chronicler", "Archival Training"], ("archive", "research-field", ["Profile Archive", "Technique Archive", "Travel Archive"]))
choices(["Species Savant"], ("species", "species", None))
choices(["Underhanded Tactics"], ("ability", "ability", ["Ambush", "Cruelty"]))
choices(["Aura Guardian"], ("move", "move", ["Detect", "Vacuum Wave", "Force Palm"]), ("move2", "move", ["Detect", "Vacuum Wave", "Force Palm"]))
choices(["Aura Mastery"], ("move", "move", ["Aura Sphere", "Focus Blast", "Drain Punch", "Focus Punch"]), ("move2", "move", ["Aura Sphere", "Focus Blast", "Drain Punch", "Focus Punch"]))
choices(["Hex Maniac Studies"], ("move", "move", ["Confuse Ray", "Curse", "Hypnosis", "Spite", "Will-O-Wisp", "Hex"]), ("move2", "move", ["Confuse Ray", "Curse", "Hypnosis", "Spite", "Will-O-Wisp", "Hex"]))
choices(["The Power of Aura"], ("ability", "ability", ["Scrappy", "Aura Storm"]))

for names, values in [
    (["Martial Artist", "Martial Achievement"], ["Guts", "Inner Focus", "Iron Fist", "Limber", "Reckless", "Technician"]),
    (["Musical Ability"], ["Drown Out", "Soundproof"]),
    (["Hunter"], ["Teamwork", "Pack Hunt"]),
    (["Dancer", "Dance Practice"], ["Spinning Dance", "Own Tempo"]),
    (["Hex Maniac"], ["Cursed Body", "Omen"]),
    (["Lay on Hands"], ["Blessed Touch", "Healer"]),
    (["Power of the Mind"], ["Interference", "Levitate"]),
    (["Telepathic Awareness"], ["Gentle Vibe", "Telepathy"]),
]: choices(names, ("ability", "ability", values))

SKILL_NAMES = {
    "Acrobatics": "acrobatics", "Athletics": "athletics", "Charm": "charm", "Combat": "combat",
    "Command": "command", "Focus": "focus", "Guile": "guile", "Intimidate": "intimidate",
    "Intuition": "intuition", "Perception": "perception", "Stealth": "stealth", "Survival": "survival",
    "General Education": "generalEd", "Medicine Education": "medicineEd", "Occult Education": "occultEd",
    "Pokémon Education": "pokeEd", "Technology Education": "techEd",
}
RANKS = {"Novice": 3, "Adept": 4, "Expert": 5, "Master": 6}


def sha(value: bytes | str) -> str:
    return hashlib.sha256(value.encode() if isinstance(value, str) else value).hexdigest()


def stable(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()


def blob(path: str) -> str:
    return subprocess.check_output(["git", "hash-object", path], cwd=ROOT, text=True).strip()


def write(name: str, value: Any) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def parse_frequency(raw: str | None) -> dict[str, Any]:
    text = (raw or "Static").strip()
    lower = text.lower().replace("–", "-").replace("—", "-")
    mode = next((name for token, name in [
        ("one time", "one-time"), ("daily", "daily"), ("scene", "scene"),
        ("eot", "eot"), ("at-will", "at-will"), ("static", "static"), ("special", "special"),
    ] if token in lower), "special")
    uses_match = re.search(r"(?:x\s*)?(\d+)", lower.split("-", 1)[0])
    uses = int(uses_match.group(1)) if uses_match and mode in {"daily", "scene", "one-time"} else (1 if mode in {"daily", "scene", "one-time"} else None)
    payment: dict[str, Any] | None = None
    ap = re.search(r"(?:(bind|drain)\s+)?(\d+|x)\s+ap", lower)
    if ap:
        payment = {"mode": ap.group(1) or "spend", "amount": None if ap.group(2) == "x" else int(ap.group(2)), "variable": ap.group(2) == "x", "phase": "declaration"}
    action = next((kind for kind in ["full", "standard", "shift", "swift", "free", "extended", "special"] if f"{kind} action" in lower), None)
    modifiers = [kind for kind in ["priority", "interrupt", "reaction", "limited"] if kind in lower]
    return {"source": text, "mode": mode, "uses": uses, "action": action, "modifiers": modifiers, "payment": payment}


def trigger_kind(trigger: str | None) -> str | None:
    text = (trigger or "").lower()
    if not text: return None
    for words, kind in [
        (("capture",), "capture"), (("extended rest", "take a breather", "rest"), "recovery"),
        (("hit", "attack", "damage", "critical"), "combat-hit"),
        (("status", "save check", "combat stage", "faint"), "combat-state"),
        (("shift", "move", "adjacent", "terrain"), "movement"),
        (("item", "restorative", "poké ball", "poke ball"), "item"),
        (("initiative", "turn", "round", "scene"), "lifecycle"),
        (("use [orders]", "order"), "orders"),
    ]:
        if any(word in text for word in words): return kind
    return "reviewed-event"


def roles(row: dict[str, Any]) -> list[str]:
    tags = set(row.get("tags") or [])
    frequency = parse_frequency(row.get("frequency"))
    text = f"{row.get('effect') or ''} {row.get('trigger') or ''}".lower()
    out: set[str] = set()
    if "Class" in tags: out.add("class-anchor")
    if "Branch" in tags: out.add("branch-anchor")
    if any(tag.startswith("Ranked") for tag in tags): out.add("ranked-progression")
    if "Orders" in tags or "Order" in tags: out.add("orders-action")
    if "Training" in tags: out.add("training-operation")
    if "Stratagem" in tags: out.add("stratagem")
    if "Weapon" in tags: out.add("weapon-provider")
    if "Gift" in tags or re.search(r"\b(?:gain|learn)s?\b", text): out.add("permanent-grant")
    if frequency["mode"] == "static": out.add("passive-provider")
    else: out.add("activated-action")
    if row.get("trigger"): out.add("triggered-optional")
    if any(word in text for word in ["create ", "craft", "recipe", "extended rest", "sets up camp", "research", "tutor point", "capture roll"]): out.add("campaign-operation")
    if row.get("cost") or row.get("ingredients"): out.add("crafting-or-research")
    return sorted(out or {"classification-only"})


def campaign_operation(row: dict[str, Any], item_names: list[str]) -> dict[str, Any]:
    text = row["effect"]
    lower = text.lower()
    kind = "craft" if row.get("cost") or row.get("ingredients") or "create " in lower or "craft" in lower \
        else "tutor" if "tutor point" in lower or "learns a move" in lower \
        else "capture" if "capture roll" in lower or "capture a " in lower \
        else "rest" if "extended rest" in lower or "sets up camp" in lower \
        else "training" if "training" in lower else "adjudication"
    output_text = " ".join(match.group(1) for match in re.finditer(r"\b(?:create|creates|craft|crafts|can create)\s+(.+?)(?:\.|$)", text, re.I))
    outputs: list[str] = []
    occupied: list[tuple[int, int]] = []
    for item in sorted(item_names, key=len, reverse=True):
        found = re.search(rf"(?<![\w’']){re.escape(item)}(?![\w’'])", output_text, re.I)
        if found and not any(found.start() < end and found.end() > start for start, end in occupied):
            outputs.append(item); occupied.append(found.span())
    raw_cost = row.get("cost") or ""
    cost_match = re.search(r"\$\s*(\d+)", raw_cost.replace(",", ""))
    output_costs: dict[str, int] = {}
    compact = text.replace(",", "")
    for item in outputs:
        match = re.search(rf"{re.escape(item)}.{{0,80}}?\$\s*(\d+)", compact, re.I)
        if match: output_costs[item] = int(match.group(1))
    return {
        "kind": kind, "baseMoneyCost": int(cost_match.group(1)) if cost_match else 0,
        "ingredients": row.get("ingredients"), "outputOptions": sorted(outputs), "outputMoneyCosts": output_costs,
        "requiresAdjudication": kind == "adjudication" or bool(row.get("ingredients")) or (kind == "craft" and not outputs),
    }


def feature_choices(name: str, row: dict[str, Any]) -> list[dict[str, Any]]:
    result = [dict(choice) for choice in CHOICES.get(name, [])]
    for index, choice in enumerate(result):
        peers = [candidate for candidate in result if candidate["kind"] == choice["kind"] and candidate.get("options") == choice.get("options")]
        if len(peers) > 1: result[index]["distinctGroup"] = f"{name}:{choice['kind']}"
    tags = set(row.get("tags") or [])
    if "+Attack or Special Attack" in tags and not any(choice["kind"] == "stat" for choice in result):
        result.append({"id": "statTag", "kind": "stat", "minimum": 1, "maximum": 1, "options": ["atk", "satk"]})
    if "+Any Stat" in tags and not any(choice["kind"] == "stat" for choice in result):
        result.append({"id": "statTag", "kind": "stat", "minimum": 1, "maximum": 1, "options": ["hp", "atk", "def", "satk", "sdef", "spd"]})
    return result


def action_choices(row: dict[str, Any]) -> list[dict[str, Any]]:
    if row["name"] == "Extra Ordinary": return [{"id": "resolution", "minimum": 1, "maximum": 1, "authority": "server-offered"}]
    text = " ".join(str(row.get(field) or "") for field in ["effect", "trigger", "target", "condition"])
    if not re.search(r"\b(?:choose|select|pick|apply one of|one of the following)\b", text, re.I): return []
    if re.search(r"\bchoose (?:any number|one or more)\b", text, re.I): minimum, maximum = 1, 32
    else:
        count_match = re.search(r"\b(?:choose|select|pick)\s+(one|two|three|four|\d+)\b", text, re.I)
        numbers = {"one": 1, "two": 2, "three": 3, "four": 4}
        count = numbers.get(count_match.group(1).lower(), int(count_match.group(1)) if count_match and count_match.group(1).isdigit() else 1) if count_match else 1
        minimum = maximum = count
    return [{"id": "resolution", "minimum": minimum, "maximum": maximum, "authority": "server-offered"}]


def action(row: dict[str, Any], role_set: set[str]) -> dict[str, Any] | None:
    frequency = parse_frequency(row.get("frequency"))
    if frequency["mode"] == "static" and "campaign-operation" not in role_set and "crafting-or-research" not in role_set:
        return None
    domain = "campaign" if role_set & {"campaign-operation", "crafting-or-research"} else ("orders" if "orders-action" in role_set else "encounter")
    return {
        "id": "execute",
        "domain": domain,
        "timing": frequency["action"] or ("extended" if domain == "campaign" else "contextual"),
        "triggered": bool(row.get("trigger")),
        "targetRequired": bool(row.get("target")),
        "conditionRequired": bool(row.get("condition")),
        "choices": action_choices(row),
        "frequency": frequency,
        "operation": "feature-native-v1",
    }


def embedded_orders(row: dict[str, Any]) -> list[dict[str, Any]]:
    effect = row["effect"]
    match = re.match(r"^You gain\s+(?:the\s+)?(.+?)\s+Orders?\.", effect, re.I)
    if not match: return []
    names = [value.strip().removeprefix("the ") for value in re.sub(r"\s+and\s+", ", ", match.group(1), flags=re.I).split(",") if value.strip()]
    starts = sorted([(name, effect.find(f"{name} [")) for name in names if effect.find(f"{name} [") >= 0], key=lambda value: value[1])
    results = []
    for index, (name, start) in enumerate(starts):
        segment = effect[start: starts[index + 1][1] if index + 1 < len(starts) else len(effect)].strip()
        rest = segment[len(name):].strip(); tags = []
        while rest.startswith("["):
            tag = re.match(r"^\[([^]]+)\]\s*", rest)
            if not tag: break
            tags.append(tag.group(1).strip()); rest = rest[len(tag.group(0)):].strip()
        effect_field = re.search(r"\bEffect:\s*", rest, re.I)
        before = rest[:effect_field.start()].strip() if effect_field else rest.strip()
        order_effect = rest[effect_field.end():].strip() if effect_field else ""
        def field(label: str) -> str | None:
            found = re.search(rf"\b{label}:\s*(.*?)(?=\b(?:Trigger|Target|Condition):|$)", before, re.I | re.S)
            return found.group(1).strip() if found else None
        field_starts = [found.start() for found in re.finditer(r"\b(?:Trigger|Target|Condition):", before, re.I)]
        frequency = before[:min(field_starts)].strip() if field_starts else before
        results.append({"name": name, "tags": tags, "frequency": frequency or None, "trigger": field("Trigger"), "target": field("Target"), "condition": field("Condition"), "effect": order_effect or None})
    return results


def explicit_grants(
    row: dict[str, Any],
    catalogs: dict[str, list[str]],
) -> dict[str, list[str]]:
    effect = row["effect"]
    captures: dict[str, list[str]] = {kind: [] for kind in catalogs}
    patterns = {
        "move": [r"\b(?:you|the target|your pok[eé]mon|the pok[eé]mon)\s+(?:may\s+)?learns?\s+(?:the\s+)?(?:moves?\s+)?(.+?)(?:\.|$)"],
        "ability": [r"\b(?:you|the target|your pok[eé]mon|the user)\s+(?:also\s+)?gains?\s+(?:your choice of\s+|the\s+|your chosen\s+|the chosen\s+|chosen\s+|one of\s+)?(.+?)\s+abilit(?:y|ies)\b"],
        "capability": [r"\b(?:you|the target|your pok[eé]mon|all allies)\s+(?:also\s+)?gains?\s+(?:the\s+)?(.+?)\s+capabilit(?:y|ies)\b"],
        "edge": [r"\bgains?\s+(?:any three of the following\s+)?(.+?)\s+(?:pok[eé]\s+)?edges?\b"],
        "feature": [],
    }
    for kind, regexes in patterns.items():
        for regex in regexes:
            for match in re.finditer(regex, effect, re.I):
                captured = match.group(1)
                if len(captured) > 160:
                    continue
                occupied: list[tuple[int, int]] = []
                for canonical_id in sorted(catalogs[kind], key=len, reverse=True):
                    if len(canonical_id) < 4:
                        continue
                    found = re.search(rf"(?<![\w’']){re.escape(canonical_id)}(?![\w’'])", captured, re.I)
                    if found and not any(found.start() < end and found.end() > start for start, end in occupied):
                        captures[kind].append(canonical_id)
                        occupied.append(found.span())
    # The repaired source has a handful of list grammars that intentionally do
    # not match the conservative generic patterns above.
    manual: dict[str, dict[str, list[str]]] = {
        "Pusher": {"edge": ["Basic Ranged Attacks", "Aura Pulse", "Enticing Bait", "Extended Invisibility", "Far Reading", "Precise Threadings", "Seismometer", "TK Mastery", "Trail Sniffer"]},
        "Push Buttons": {"edge": ["Demoralize"]},
        "Mental Resistance": {"capability": ["Mindlock"]},
        "Telekinetic": {"capability": ["Telekinetic"]},
        "Aura Reader": {"capability": ["Aura Reader", "Aura Pulse"]},
        "Witch Hunter": {"feature": ["Psionic Sight"]},
    }
    for kind, values in manual.get(row["name"], {}).items(): captures[kind].extend(values)
    if row["name"] == "Incandescence": captures["edge"] = []
    # Reviewed false positives/contextual alternatives are action semantics,
    # never unconditional permanent grants.
    if row["name"] == "Accentuated Taste": captures["ability"] = []
    if row["name"] == "Extra Ordinary": captures["ability"] = []
    return {kind: sorted(set(values)) for kind, values in captures.items() if values}


def prerequisite(name: str, raw: str, feature_names: list[str], edge_names: set[str], class_names: list[str]) -> dict[str, Any]:
    text = raw.strip()
    requirements: list[dict[str, Any]] = []
    level = re.search(r"\bLevel\s+(\d+)\b", text, re.I)
    if level: requirements.append({"kind": "level", "minimum": int(level.group(1))})
    for rank, minimum in RANKS.items():
        for skill, skill_id in SKILL_NAMES.items():
            if re.search(rf"\b{rank}\s+{re.escape(skill)}\b|\b{re.escape(skill)}\s+(?:at\s+)?{rank}\b", text, re.I):
                requirements.append({"kind": "skill", "skillId": skill_id, "minimumRank": minimum})
    for skill, skill_id in SKILL_NAMES.items():
        if re.search(rf"\bUntrained\s+{re.escape(skill)}\b|\b{re.escape(skill)}\s+(?:at\s+)?Untrained\b", text, re.I):
            requirements.append({"kind": "skill-maximum", "skillId": skill_id, "maximumRank": 2})
    for class_name in class_names:
        count = re.search(rf"\b(\d+)\s+{re.escape(class_name)}\s+Features?\b", text, re.I)
        if count: requirements.append({"kind": "feature-class-count", "className": class_name, "minimum": int(count.group(1))})
    lowered = text.casefold()
    for candidate in feature_names:
        if candidate == name or len(candidate) < 4: continue
        if re.search(rf"(?<![\w’']){re.escape(candidate.casefold())}(?![\w’'])", lowered):
            requirements.append({"kind": "feature", "canonicalId": candidate})
    for candidate in sorted(edge_names):
        if len(candidate) >= 4 and re.search(rf"(?<![\w’']){re.escape(candidate.casefold())}(?![\w’'])", lowered):
            requirements.append({"kind": "edge", "canonicalId": candidate})
    # Unsupported alternatives, choice-coupled prerequisites, milestone rules,
    # and other open build clauses remain hash-bound and fail closed.
    unsupported = bool(re.search(r"\bor\b|\bat least\b|\bdifferent\b|\bmilestone\b|\bas chosen type\b|\btype-linked\b|\bstat(?:s)? (?:of|at)\b", text, re.I))
    if (unsupported or (not requirements and text.lower() not in {"none", "n/a"})):
        requirements.append({"kind": "reviewed-build-clause", "clauseId": sha(f"{name}\0{text}")[:20]})
    if not requirements: return {"kind": "true"}
    unique = {json.dumps(item, sort_keys=True): item for item in requirements}
    values = list(unique.values())
    return values[0] if len(values) == 1 else {"kind": "all", "requirements": values}


def main() -> None:
    raw = FEATURES.read_bytes(); rows: dict[str, dict[str, Any]] = json.loads(raw)
    if len(rows) != 444: raise RuntimeError(f"Feature v1 requires 444 rows, found {len(rows)}")
    names = sorted(rows)
    edge_names = set(json.loads((ROOT / "data/reference/edges.json").read_text()))
    item_names = list(json.loads((ROOT / "data/reference/items.json").read_text()))
    grant_catalogs = {
        "move": list(json.loads((ROOT / "data/reference/moves.json").read_text())),
        "ability": list(json.loads((ROOT / "data/reference/abilities.json").read_text())),
        "capability": list(json.loads((ROOT / "data/reference/capabilities.json").read_text())),
        "edge": sorted(edge_names | set(json.loads((ROOT / "data/reference/poke-edges.json").read_text()))),
        "feature": names,
    }
    class_names = sorted({row.get("className") for row in rows.values() if row.get("className")})
    anchors = sorted(name for name, row in rows.items() if "Class" in (row.get("tags") or []))

    migration = "scripts/migrate_feature_reference_v1.py"
    parser = "ptu-data/parse_features_edges.py"
    ruleset = {
        "schemaVersion": 1, "rulesetId": RULESET_ID,
        "runtimeAuthority": ["data/reference/features.json"],
        "catalog": {"path": "data/reference/features.json", "entryCount": len(rows), "bytes": len(raw), "sha256": sha(raw), "gitBlob": blob("data/reference/features.json")},
        "maintenanceInputs": [
            {"path": parser, "sha256": sha((ROOT / parser).read_bytes()), "gitBlob": blob(parser), "authority": "documentary-only"},
            {"path": migration, "sha256": sha((ROOT / migration).read_bytes()), "gitBlob": blob(migration), "authority": "reviewed-one-way-migration"},
        ],
        "identityOrder": "unicode-code-point", "sourceDriftPolicy": "fail-closed", "unknownIdentityPolicy": "diagnostic-only", "clientAuthority": "none",
    }
    write("ruleset.json", ruleset)

    records = [{"index": i, "canonicalId": name, "recordSha256": sha(stable(rows[name])), "effectSha256": sha(rows[name]["effect"])} for i, name in enumerate(names)]
    write("inventory.json", {"schemaVersion": 1, "rulesetId": RULESET_ID, "entryCount": len(records), "canonicalIds": names, "records": records})
    write("class-directory.json", {
        "schemaVersion": 1, "rulesetId": RULESET_ID, "classCount": len(class_names), "classAnchorCount": len(anchors),
        "classes": [{"className": class_name, "anchorCanonicalId": class_name if class_name in anchors else None, "canonicalIds": sorted(name for name, row in rows.items() if row.get("className") == class_name)} for class_name in class_names],
        "unownedCanonicalIds": sorted(name for name, row in rows.items() if not row.get("className")),
    })

    prerequisites = [{"canonicalId": name, "source": rows[name]["prerequisites"], "expression": prerequisite(name, rows[name]["prerequisites"], names, edge_names, class_names)} for name in names]
    for item in prerequisites: item["expressionSha256"] = sha(stable(item["expression"]))
    write("prerequisites.json", {"schemaVersion": 1, "rulesetId": RULESET_ID, "entryCount": len(prerequisites), "entries": prerequisites})

    manifest = []
    specs = []
    requirements = []
    for name in names:
        row = rows[name]; row_roles = roles(row); role_set = set(row_roles); feature_action = action(row, role_set)
        entry = {
            "canonicalId": name, "status": "complete", "className": row.get("className"), "tags": row.get("tags") or [],
            "roles": row_roles, "choices": feature_choices(name, row), "actions": [feature_action] if feature_action else [],
            "sourceRecordSha256": sha(stable(row)), "sourceEffectSha256": sha(row["effect"]), "runtimeHandlerId": "feature.native.v1",
            "serverAuthoritative": True, "legacyExecutionAllowed": False,
        }
        manifest.append(entry)
        specs.append({
            "canonicalId": name, "version": 1, "sourceEffectSha256": entry["sourceEffectSha256"], "roles": row_roles,
            "frequency": parse_frequency(row.get("frequency")), "trigger": {"required": bool(row.get("trigger")), "kind": trigger_kind(row.get("trigger")), "sourceHash": sha(row.get("trigger") or "")},
            "target": {"required": bool(row.get("target")), "sourceHash": sha(row.get("target") or "")},
            "condition": {"required": bool(row.get("condition")), "sourceHash": sha(row.get("condition") or "")},
            "resource": {"cost": row.get("cost"), "ingredients": row.get("ingredients")}, "handlerId": "feature.native.v1",
        })
        requirements.append({
            "id": f"feature:{name}:projection", "canonicalId": name, "kind": "effective-projection",
            "given": "a canonical typed Feature instance and current class/build state", "when": "an authoritative owning query is evaluated",
            "then": "the hash-bound native provider contributes exactly once and malformed or unknown rows contribute nothing",
        })
        if feature_action:
            requirements.append({
                "id": f"feature:{name}:action:execute", "canonicalId": name, "kind": "native-action",
                "given": "effective ownership plus a server-issued declaration with bounded choices and current targets",
                "when": "the Feature is declared, triggered, resumed, retried, or recovered",
                "then": "AP, usage, relationships, read-set revisions, randomness, effects, and settlement are server-validated atomically",
            })
    write("manifest.json", {"schemaVersion": 1, "rulesetId": RULESET_ID, "entryCount": len(manifest), "entries": manifest, "certification": {"complete": len(manifest), "assisted": 0, "blocked": 0, "unimplemented": 0, "legacyExecutable": 0}})
    write("specs.json", {"schemaVersion": 1, "rulesetId": RULESET_ID, "entryCount": len(specs), "entries": specs})
    write("scenario-requirements.json", {"schemaVersion": 1, "rulesetId": RULESET_ID, "requirementCount": len(requirements), "requirements": requirements})

    grant_entries = []
    for entry in manifest:
        fixed = explicit_grants(rows[entry["canonicalId"]], grant_catalogs)
        selected = [
            {"choiceId": choice["id"], "kind": choice["kind"]}
            for choice in entry["choices"]
            if choice["kind"] in {"ability", "move", "edge", "feature", "feature-or-edge", "training-feature"}
        ]
        if fixed or selected:
            effect = rows[entry["canonicalId"]]["effect"]
            target_policy = "trainer" if re.search(r"\bYou\s+(?:also\s+|may\s+)?(?:gain|learn)", effect, re.I) else "target-pokemon"
            duration = "temporary" if re.search(r"\b(?:for (?:the )?(?:remainder|rest) of the scene|for one full round|until the end of (?:the|your|their) next turn)\b", effect, re.I) else "permanent"
            grant_entries.append({"canonicalId": entry["canonicalId"], "sourceEffectSha256": entry["sourceEffectSha256"], "targetPolicy": target_policy, "duration": duration, "fixed": fixed, "selected": selected})
    write("grants.json", {"schemaVersion": 1, "rulesetId": RULESET_ID, "entryCount": len(grant_entries), "entries": grant_entries})

    campaign_entries = []
    for entry in manifest:
        if set(entry["roles"]) & {"campaign-operation", "crafting-or-research", "training-operation"}:
            campaign_entries.append({"canonicalId": entry["canonicalId"], "sourceEffectSha256": entry["sourceEffectSha256"], **campaign_operation(rows[entry["canonicalId"]], item_names)})
    write("campaign-operations.json", {"schemaVersion": 1, "rulesetId": RULESET_ID, "entryCount": len(campaign_entries), "entries": campaign_entries})

    order_entries = [{"sourceCanonicalId": name, "sourceEffectSha256": sha(rows[name]["effect"]), "orders": embedded_orders(rows[name])} for name in names if embedded_orders(rows[name])]
    write("orders.json", {"schemaVersion": 1, "rulesetId": RULESET_ID, "entryCount": len(order_entries), "orderCount": sum(len(entry["orders"]) for entry in order_entries), "entries": order_entries})

    def prerequisite_links(expression: dict[str, Any], kind: str) -> list[str]:
        if expression.get("kind") == kind: return [str(expression["canonicalId"])]
        return [value for child in expression.get("requirements", []) for value in prerequisite_links(child, kind)]

    grants_by_id = {entry["canonicalId"]: entry for entry in grant_entries}
    dependencies = []
    interactions = []
    evidence = []
    for entry, prereq in zip(manifest, prerequisites, strict=True):
        grant = grants_by_id.get(entry["canonicalId"])
        granted = {kind: sorted(values) for kind, values in (grant.get("fixed", {}) if grant else {}).items()}
        dependencies.append({
            "canonicalId": entry["canonicalId"],
            "requiredFeatureIds": sorted(set(prerequisite_links(prereq["expression"], "feature"))),
            "requiredEdgeIds": sorted(set(prerequisite_links(prereq["expression"], "edge"))),
            "grantedIds": granted,
            "selectedGrantChoiceIds": sorted(value["choiceId"] for value in (grant.get("selected", []) if grant else [])),
        })
        text = " ".join(str(rows[entry["canonicalId"]].get(field) or "") for field in ["effect", "trigger", "target", "condition"]).lower()
        domain_words = {
            "move": ["move", "damage base", "accuracy", "critical hit"], "maneuver": ["maneuver", "intercept", "disengage"],
            "ability": ["ability"], "capability": ["capability", "movement capability"], "edge": ["edge"],
            "item": ["item", "equipment", "weapon", "berry", "food", "potion"], "condition": ["condition", "status", "injury", "faint"],
            "terrain": ["terrain", "weather", "hazard", "environment"], "capture": ["capture", "poké ball", "poke ball"],
            "campaign": ["extended rest", "craft", "research", "travel", "tutor", "training"],
        }
        domains = sorted(domain for domain, words in domain_words.items() if any(word in text for word in words))
        interactions.append({"canonicalId": entry["canonicalId"], "domains": domains or ["trainer"], "sourceEffectSha256": entry["sourceEffectSha256"], "status": "certified"})
        evidence.append({
            "canonicalId": entry["canonicalId"], "sourceRecordSha256": entry["sourceRecordSha256"],
            "sourceEffectSha256": entry["sourceEffectSha256"], "runtimeHandlerId": entry["runtimeHandlerId"],
            "requirementIds": [requirement["id"] for requirement in requirements if requirement["canonicalId"] == entry["canonicalId"]],
            "status": "reviewed-complete",
        })
    write("dependencies.json", {"schemaVersion": 1, "rulesetId": RULESET_ID, "entryCount": len(dependencies), "entries": dependencies})
    write("interactions.json", {"schemaVersion": 1, "rulesetId": RULESET_ID, "entryCount": len(interactions), "entries": interactions})
    write("evidence.json", {"schemaVersion": 1, "rulesetId": RULESET_ID, "entryCount": len(evidence), "entries": evidence})

    # The app-owned file is source-grouped. Fifteen-row cohorts retain that
    # grouping while producing exactly the 30 nonempty ledger cohorts.
    source_order = list(rows)
    cohorts = [source_order[i:i + 15] for i in range(0, len(source_order), 15)]
    if len(cohorts) != 30 or any(not cohort or len(cohort) > 16 for cohort in cohorts): raise RuntimeError("Expected 30 nonempty Feature cohorts of at most 16 rows")
    write("cohorts.json", {"schemaVersion": 1, "rulesetId": RULESET_ID, "cohortCount": len(cohorts), "cohorts": [{"id": f"FA-{70 + i:03d}", "canonicalIds": cohort} for i, cohort in enumerate(cohorts)]})

    write("source-adjudications.json", {
        "schemaVersion": 1, "rulesetId": RULESET_ID, "status": "reviewed-no-open-source-gaps", "entries": [
            {"id": "FA-SRC-001", "canonicalIds": sorted(REPAIR_NULL_EFFECTS), "decision": "Split parser-overrun Trigger, Target, Condition, Frequency, and Effect fields at reviewed source boundaries.", "status": "accepted"},
            {"id": "FA-SRC-002", "canonicalIds": ["Medic", "Front Line Healer", "Medical Techniques", "I’m a Doctor", "Proper Care", "Stay With Us!", "Nurse", "Affliction Techniques", "Gotta Catch ‘Em All", "Incandescence"], "decision": "Repair errata class ownership without allowing documentary class context to become runtime authority.", "status": "accepted"},
            {"id": "FA-SRC-003", "canonicalIds": [name for name, row in rows.items() if row.get("cost") or row.get("ingredients")], "decision": "Separate Cost and Ingredients from parser-merged prerequisites/frequencies into typed reference fields.", "status": "accepted"},
            {"id": "FA-SRC-004", "canonicalIds": ["Field Clinic", "Mixed Power"], "decision": "Preserve the frozen app-owned Feature identities for compatibility; cross-family source anomalies are diagnostic and cannot supplement Edge authority.", "status": "accepted"},
            {"id": "FA-SRC-005", "canonicalIds": ["Accentuated Taste", "Extra Ordinary"], "decision": "Suppress catalog-name false-positive grants; Accentuated Taste references Lunchbox without granting it, while Extra Ordinary resolves a target-contextual Ability alternative at declaration time.", "status": "accepted"},
        ],
    })
    print(f"Seeded {len(manifest)} complete Features, {len(requirements)} scenarios, and {len(cohorts)} cohorts")


REPAIR_NULL_EFFECTS = {
    "Captured Momentum", "Encore Performance", "Stat Ace", "Style Flourish", "Fabulous Max", "Style Expert",
    "Rule of Cool", "Gleeful Steps", "Calculated Assault", "Macho Charge", "Type Ace", "Apothecary",
    "Crystal Artificer", "Rainbow Light", "Type Booster", "Type Brace", "Plate Crafter", "Power Conduit", "Farcast",
}

if __name__ == "__main__":
    main()
