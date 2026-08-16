#!/usr/bin/env python3
"""Install/check the reviewed P8-055 Evolutionary Items structured authority.

Runtime code consumes only data/reference/rules.json. This source-hash-bound
migration keeps the reviewed transition table reproducible without parsing
item or Pokédex prose at runtime.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
RULES_PATH = ROOT / "data/reference/rules.json"
ITEMS_PATH = ROOT / "data/reference/items.json"
POKEDEX_PATH = ROOT / "data/reference/pokedex.json"
SPECS_PATH = ROOT / "data/complete-play-loop/specs.v1.json"
REMEDIATION_PATH = ROOT / "data/complete-play-loop/canonical-data-remediation.v1.json"
BEFORE_RULES_SHA256 = "adb35beee81da45794f97b52997366854e84484b0a357712b33810f5e8836192"
AFTER_RULES_SHA256 = "68c0f55a4038423de752ece05afa44830babe5ab0e642add524da46f4a49373e"
AFTER_RULES_BYTES = 163562
AFTER_RULES_GIT_BLOB = "b8666e2cfab3d961b54b8dcb5c8531bc6ad800a7"
MIGRATION_ID = "rule-data-evolution-item-mechanics-v1"
EVOLUTION_ITEM_IDS = (
    "Fire Stone", "Water Stone", "Thunder Stone", "Leaf Stone", "Moon Stone",
    "Sun Stone", "Shiny Stone", "Dusk Stone", "Dawn Stone",
    "Deepseascale/Deepseatooth", "Dragon Scale", "Dubious Disc", "Electirizer",
    "King’s Rock", "Oval Stone", "Magmarizer", "Metal Coat", "Protector",
    "Razor Claw", "Razor Fang", "Reaper Cloth", "Sachet", "Up-Grade", "Whipped Dream",
)

# item, source species, destination species, minimum Level, required gender
_TRANSITIONS = (
    ("Fire Stone", "Vulpix", "Ninetales", 20, None),
    ("Fire Stone", "Growlithe", "Arcanine", 20, None),
    ("Fire Stone", "Eevee", "Flareon", 0, None),
    ("Fire Stone", "Pansear", "Simisear", 20, None),
    ("Water Stone", "Poliwhirl", "Poliwrath", 30, None),
    ("Water Stone", "Shellder", "Cloyster", 0, None),
    ("Water Stone", "Staryu", "Starmie", 20, None),
    ("Water Stone", "Eevee", "Vaporeon", 0, None),
    ("Water Stone", "Lombre", "Ludicolo", 25, None),
    ("Water Stone", "Panpour", "Simipour", 20, None),
    ("Thunder Stone", "Pikachu", "Raichu", 20, None),
    ("Thunder Stone", "Eevee", "Jolteon", 0, None),
    ("Thunder Stone", "Eelektrik", "Eelektross", 40, None),
    ("Leaf Stone", "Gloom", "Vileplume", 30, None),
    ("Leaf Stone", "Weepinbell", "Victreebel", 30, None),
    ("Leaf Stone", "Exeggcute", "Exeggutor", 0, None),
    ("Leaf Stone", "Eevee", "Leafeon", 0, None),
    ("Leaf Stone", "Nuzleaf", "Shiftry", 25, None),
    ("Leaf Stone", "Pansage", "Simisage", 20, None),
    ("Moon Stone", "Nidorina", "Nidoqueen", 25, None),
    ("Moon Stone", "Nidorino", "Nidoking", 25, None),
    ("Moon Stone", "Clefairy", "Clefable", 20, None),
    ("Moon Stone", "Jigglypuff", "Wigglytuff", 20, None),
    ("Moon Stone", "Eevee", "Sylveon", 0, None),
    ("Moon Stone", "Skitty", "Delcatty", 20, None),
    ("Moon Stone", "Munna", "Musharna", 20, None),
    ("Sun Stone", "Gloom", "Bellossom", 30, None),
    ("Sun Stone", "Sunkern", "Sunflora", 20, None),
    ("Sun Stone", "Cottonee", "Whimsicott", 20, None),
    ("Sun Stone", "Petilil", "Lilligant", 20, None),
    ("Sun Stone", "Helioptile", "Heliolisk", 20, None),
    ("Shiny Stone", "Eevee", "Glaceon", 0, None),
    ("Shiny Stone", "Togetic", "Togekiss", 30, None),
    ("Shiny Stone", "Roselia", "Roserade", 30, None),
    ("Shiny Stone", "Minccino", "Cinccino", 20, None),
    ("Shiny Stone", "Floette", "Florges", 30, None),
    ("Dusk Stone", "Eevee", "Umbreon", 0, None),
    ("Dusk Stone", "Murkrow", "Honchkrow", 20, None),
    ("Dusk Stone", "Misdreavus", "Mismagius", 20, None),
    ("Dusk Stone", "Lampent", "Chandelure", 35, None),
    ("Dusk Stone", "Doublade", "Aegislash", 40, None),
    ("Dawn Stone", "Eevee", "Espeon", 0, None),
    ("Dawn Stone", "Kirlia", "Gallade", 30, "Male"),
    ("Dawn Stone", "Snorunt", "Froslass", 30, "Female"),
    ("Deepseascale/Deepseatooth", "Clamperl", "Huntail", 20, None),
    ("Deepseascale/Deepseatooth", "Clamperl", "Gorebyss", 20, None),
    ("Dragon Scale", "Seadra", "Kingdra", 40, None),
    ("Dubious Disc", "Porygon2", "Porygon-Z", 25, None),
    ("Electirizer", "Electabuzz", "Electivire", 40, None),
    ("King’s Rock", "Poliwhirl", "Politoed", 30, None),
    ("King’s Rock", "Slowpoke", "Slowking", 35, None),
    ("Oval Stone", "Happiny", "Chansey", 10, None),
    ("Magmarizer", "Magmar", "Magmortar", 40, None),
    ("Metal Coat", "Onix", "Steelix", 35, None),
    ("Metal Coat", "Scyther", "Scizor", 30, None),
    ("Protector", "Rhydon", "Rhyperior", 45, None),
    ("Razor Claw", "Sneasel", "Weavile", 30, None),
    ("Razor Fang", "Gligar", "Gliscor", 25, None),
    ("Reaper Cloth", "Dusclops", "Dusknoir", 40, None),
    ("Sachet", "Spritzee", "Aromatisse", 20, None),
    ("Up-Grade", "Porygon", "Porygon2", 10, None),
    ("Whipped Dream", "Swirlix", "Slurpuff", 20, None),
)


def stable_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_value(value: Any) -> str:
    return sha256_bytes(stable_json(value).encode())


def expected_rule() -> dict[str, Any]:
    return {
        "name": "Evolutionary Items",
        "category": "Item Rule",
        "text": "Reviewed structured authority for Evolutionary Stones and Keepsakes. Runtime eligibility and transitions use itemEvolutionMechanics only; documentary text is provenance, never executable input.",
        "source": "books/markdown/core/09-gear-and-items.md; books/markdown/core/05-pokemon.md",
        "itemEvolutionMechanics": {
            "schemaVersion": 1,
            "actorKind": "trainer",
            "targetKind": "owned-pokemon",
            "timing": "confirmed-instant",
            "consumptionQuantity": 1,
            "consumptionPhase": "accepted-use",
            "identityPolicy": "retain-sheet-character-and-ownership-identity",
            "statPolicy": "unallocate-added-points-then-owner-restat",
            "abilityPolicy": "map-current-canonical-abilities-by-tier-and-slot",
            "movePolicy": "retain-current-moves-and-create-bounded-opportunity-attention",
            "skillsCapabilitiesPolicy": "adopt-destination-canonical-defaults-and-preserve-explicit-overrides",
            "equipmentPolicy": "reconcile-current-equipment-against-destination-species",
            "transitionCount": len(_TRANSITIONS),
            "transitions": [
                {
                    "itemId": item_id,
                    "fromSpecies": from_species,
                    "toSpecies": to_species,
                    "minimumLevel": minimum_level,
                    "requiredGender": required_gender,
                }
                for item_id, from_species, to_species, minimum_level, required_gender in _TRANSITIONS
            ],
        },
    }


def expected_migration(rule: dict[str, Any]) -> dict[str, Any]:
    return {
        "migrationId": MIGRATION_ID,
        "canonicalId": "Evolutionary Items",
        "canonicalPath": "data/reference/rules.json",
        "beforeFileSha256": BEFORE_RULES_SHA256,
        "beforeBytes": 150599,
        "beforeGitBlob": "45398fcc1d4fb2b5a355d4883860faf499e1de24",
        "afterFileSha256": AFTER_RULES_SHA256,
        "afterBytes": AFTER_RULES_BYTES,
        "afterGitBlob": AFTER_RULES_GIT_BLOB,
        "afterRecordSha256": sha256_value(rule),
        "sourceEvidence": [
            {
                "path": "books/markdown/core/09-gear-and-items.md",
                "fileSha256": "b700b95186df42500c49575d8e7f5396188809cb46cc22c3cb3df7b1e9f6b1e0",
                "gitBlob": "d319fe6af5b33d51ce958595401dc268f57cc4fb",
                "lineRanges": [[2034, 2101]],
                "excerptSha256": "dd7bfc3390388aa8add9051c98e69017ae8ef3d4bc823ead4019135e5864e73a",
                "pages": [298],
            },
            {
                "path": "books/markdown/core/05-pokemon.md",
                "fileSha256": "4fa04ea5d56b04a95ddfaea55cf096166d0bdd71b318ed9f64dbbce583b47eb3",
                "gitBlob": "4ead8eb5ac53f9eca9de8c721579d1568d6f0bdc",
                "lineRanges": [[591, 607]],
                "excerptSha256": "9b0b18e730a0ab42b42dbd6116f05bb8b8bdfed44713e5ea99a0cf8c30bad256",
                "pages": [202],
            },
        ],
        "canonicalTransitionAuthority": {
            "path": "data/reference/pokedex.json",
            "fileSha256": "ca62ed2a9b934bc8d66c75d198b200035c37a9ade13239fc0129169a8deaa696",
            "reviewMethod": "bind each documented Evolutionary Item source species to its app-owned canonical evolution family, minimum Level, destination, and gender restriction; reject every missing, ambiguous, duplicated, or unknown transition",
        },
        "reason": "Adds bounded structured authority for 24 canonical Evolutionary Items and 62 exact transitions, including minimum Level, gender, branching destination, identity retention, canonical re-stat and Ability mapping, Move opportunities, Capability updates, equipment reconciliation, explicit confirmation, and accepted-use consumption. Runtime never parses documentary text.",
        "downstreamFrozenBaselinePolicy": "The immutable Breeding source manifest retains its original rules hash and admits this exact chained successor only while every pre-existing Breeding rule consumer remains bound to unchanged per-record authority.",
        "downstreamQualityGate": "scripts/check_breeding_automation.ts",
        "reviewStatus": "accepted",
    }


def expected_spec_rows(items: dict[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for canonical_id in EVOLUTION_ITEM_IDS:
        item = items[canonical_id]
        rows.append({
            "canonicalId": canonical_id,
            "recordSha256": sha256_value(item),
            "effectSha256": sha256_bytes("\n".join(item["effects"]).encode()),
            "effect": {"kind": "evolve-pokemon", "transitionPolicyId": canonical_id},
        })
    return rows


def follows_reviewed_file_successors(
    migrations: list[dict[str, Any]],
    start_sha256: str,
    current_sha256: str,
    canonical_path: str,
) -> bool:
    """Accept later bytes only through an unambiguous accepted migration chain."""
    cursor = start_sha256
    visited: set[str] = set()
    while cursor != current_sha256:
        matches = [
            row for row in migrations
            if row.get("reviewStatus") == "accepted"
            and row.get("canonicalPath") == canonical_path
            and row.get("beforeFileSha256") == cursor
            and isinstance(row.get("afterFileSha256"), str)
        ]
        if len(matches) != 1:
            return False
        successor = matches[0]["afterFileSha256"]
        if successor in visited or successor == cursor:
            return False
        visited.add(cursor)
        cursor = successor
    return True


def validate_sources(items: dict[str, Any], pokedex: list[dict[str, Any]]) -> None:
    species = {row["species"] for row in pokedex}
    if len(EVOLUTION_ITEM_IDS) != 24 or len(_TRANSITIONS) != 62:
        raise SystemExit("Reviewed Evolutionary Item roster cardinality drifted.")
    if len(set(EVOLUTION_ITEM_IDS)) != len(EVOLUTION_ITEM_IDS):
        raise SystemExit("Reviewed Evolutionary Item identities are duplicated.")
    if len({(row[0], row[1], row[2], row[4]) for row in _TRANSITIONS}) != len(_TRANSITIONS):
        raise SystemExit("Reviewed evolution transitions are duplicated.")
    for item_id in EVOLUTION_ITEM_IDS:
        item = items.get(item_id)
        if not item or not any(category in {"Evolutionary Stone", "Evolutionary Keepsake"} for category in item.get("categories", [])):
            raise SystemExit(f"{item_id} is not a canonical Evolutionary Item.")
    for item_id, source, target, minimum, gender in _TRANSITIONS:
        if source not in species or target not in species:
            raise SystemExit(f"Evolution transition {item_id}: {source} -> {target} references an unknown species.")
        if not isinstance(minimum, int) or minimum < 0 or minimum > 100:
            raise SystemExit(f"Evolution transition {item_id}: {source} -> {target} has an invalid minimum Level.")
        if gender not in {None, "Male", "Female"}:
            raise SystemExit(f"Evolution transition {item_id}: {source} -> {target} has an invalid gender restriction.")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="validate installed structured authority without writing")
    args = parser.parse_args()

    rules_bytes = RULES_PATH.read_bytes()
    rules = json.loads(rules_bytes)
    items = json.loads(ITEMS_PATH.read_text())
    pokedex = json.loads(POKEDEX_PATH.read_text())
    specs = json.loads(SPECS_PATH.read_text())
    remediation = json.loads(REMEDIATION_PATH.read_text())
    validate_sources(items, pokedex)
    rule = expected_rule()
    migration = expected_migration(rule)
    spec_rows = expected_spec_rows(items)

    if args.check:
        if rules.get("Evolutionary Items") != rule:
            raise SystemExit("Evolutionary Items structured rule is missing or stale.")
        rows = {row["canonicalId"]: row for row in specs["specs"]}
        if any(rows.get(row["canonicalId"]) != row for row in spec_rows):
            raise SystemExit("Reviewed Evolutionary Item specs are missing or stale.")
        policy = specs.get("ruleEvidence", {}).get("itemEvolutionPolicy")
        if not isinstance(policy, dict) or policy.get("ruleRecordSha256") != sha256_value(rule):
            raise SystemExit("Evolutionary Item rule evidence is missing or stale.")
        installed_migrations = remediation.get("reviewedMigrations", [])
        if migration not in installed_migrations:
            raise SystemExit("Evolutionary Item reviewed migration evidence is missing or stale.")
        current_rules_sha256 = sha256_bytes(rules_bytes)
        if not follows_reviewed_file_successors(
            installed_migrations,
            AFTER_RULES_SHA256,
            current_rules_sha256,
            "data/reference/rules.json",
        ):
            raise SystemExit("Evolutionary Item rules catalog has no complete reviewed successor chain.")
        if current_rules_sha256 == AFTER_RULES_SHA256 and len(rules_bytes) != AFTER_RULES_BYTES:
            raise SystemExit("Evolutionary Item direct rules successor byte count drifted.")
        print(f"Evolutionary Item mechanics check passed: {len(EVOLUTION_ITEM_IDS)} items, {len(_TRANSITIONS)} transitions.")
        return

    if "Evolutionary Items" in rules:
        raise SystemExit("Evolutionary Items structured rule already exists; use --check.")
    if sha256_bytes(rules_bytes) != BEFORE_RULES_SHA256:
        raise SystemExit("Rules catalog does not match the reviewed P8-055 migration predecessor.")
    existing_ids = {row["canonicalId"] for row in specs["specs"]}
    overlap = existing_ids.intersection(EVOLUTION_ITEM_IDS)
    if overlap:
        raise SystemExit(f"Evolutionary Item specs already exist: {sorted(overlap)}")

    if any(row.get("migrationId") == MIGRATION_ID for row in remediation.get("reviewedMigrations", [])):
        raise SystemExit("Evolutionary Item reviewed migration evidence already exists; use --check.")
    rules["Evolutionary Items"] = rule
    specs["ruleEvidence"]["itemEvolutionPolicy"] = {
        "ruleCanonicalId": "Evolutionary Items",
        "ruleRecordSha256": sha256_value(rule),
        "itemCount": len(EVOLUTION_ITEM_IDS),
        "transitionCount": len(_TRANSITIONS),
        "timing": "standard",
        "targetKind": "pokemon",
        "consumptionPhase": "accepted-use",
        "destinationChoice": "one-authority-projected-destination",
        "confirmation": "one-exact-explicit-confirmation",
        "provenance": "server-private-immutable-application-ledger",
        "restatAttention": "owner-visible-unallocated-stat-point-work",
        "moveAttention": "owner-visible-bounded-new-form-move-opportunities",
    }
    specs["specs"].extend(spec_rows)
    remediation["reviewedMigrations"].append(migration)
    rendered_rules = (json.dumps(rules, ensure_ascii=False, indent=2) + "\n").encode()
    if sha256_bytes(rendered_rules) != AFTER_RULES_SHA256 or len(rendered_rules) != AFTER_RULES_BYTES:
        raise SystemExit("Generated Evolutionary Item rules successor does not match reviewed bytes.")
    RULES_PATH.write_bytes(rendered_rules)
    SPECS_PATH.write_text(json.dumps(specs, ensure_ascii=False, indent=2) + "\n")
    REMEDIATION_PATH.write_text(json.dumps(remediation, ensure_ascii=False, indent=2) + "\n")
    print(f"Installed Evolutionary Item mechanics: {len(EVOLUTION_ITEM_IDS)} items, {len(_TRANSITIONS)} transitions.")


if __name__ == "__main__":
    main()
