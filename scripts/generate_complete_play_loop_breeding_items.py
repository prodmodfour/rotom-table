#!/usr/bin/env python3
"""Generate/check the reviewed P8-058 breeding-item integration contract."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
ITEMS = ROOT / "data/reference/items.json"
REVIEW = ROOT / "scripts/reviewed-data/breeding-items.v1.json"
OUTPUT = ROOT / "data/complete-play-loop/breeding-items.v1.json"
ARTIFACTS = {
    "modifierInventory": ROOT / "data/breeding-automation/modifier-inventory.json",
    "modifierProviderHandoff": ROOT / "data/breeding-automation/modifier-provider-handoff-contract.json",
    "fossilEgg": ROOT / "data/breeding-automation/fossil-egg-contract.json",
    "babyTemplateAndArtificialEgg": ROOT / "data/breeding-automation/baby-template-contract.json",
    "interactionCertification": ROOT / "data/breeding-automation/interaction-certification.json",
    "sourceAdjudications": ROOT / "data/breeding-automation/source-adjudications.json",
}
EXPECTED_FILE_HASHES = {
    "items": "62b29a499c791d689f6efc99e04ed515a71336421352626749cf6cc7407982c8",
    "review": "82756f7e7e5d7adc8fd7aee59df8931f738d839532f8a60a7814e577d3802841",
    "modifierInventory": "297007e546dc9afe12dbe4622557ccba9c6bca9f1d8b0fec2c631d5a270d761d",
    "modifierProviderHandoff": "2add92cbab9e68f611eb0c6e162edab342918ffc5ba95ec1077f9f76b56fe25b",
    "fossilEgg": "554c3a9ea6188237ca6cea8b7ae4e6250bb057e09dfa77a515e360301f0b54a3",
    "babyTemplateAndArtificialEgg": "3fd683dcb175c3b7586f81022a54e9c3177850c756057eba33f87a8e911a50f6",
    "interactionCertification": "0f358622e6cb94b579f53535265df947f65f1f65011a0eeb1fb1aff9fa660aac",
    "sourceAdjudications": "762e166f93ec3019150c9c6c36e4433c352781a51181cf3181964a45a2a5f0a7",
}
ITEM_IDS = ["Egg Warmer", "Reanimation Machine", "Chemistry Set"]


def stable_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_value(value: Any) -> str:
    return sha256_bytes(stable_json(value).encode())


def checked_json(path: Path, expected_hash: str, label: str) -> Any:
    raw = path.read_bytes()
    if sha256_bytes(raw) != expected_hash:
        raise RuntimeError(f"{label} changed; review P8-058 breeding-item authority before regeneration")
    return json.loads(raw)


def document() -> dict[str, Any]:
    items = checked_json(ITEMS, EXPECTED_FILE_HASHES["items"], "Canonical item catalog")
    review = checked_json(REVIEW, EXPECTED_FILE_HASHES["review"], "Reviewed breeding-item integration")
    artifacts: dict[str, Any] = {}
    artifact_authority: dict[str, Any] = {}
    for key, path in ARTIFACTS.items():
        value = checked_json(path, EXPECTED_FILE_HASHES[key], key)
        artifacts[key] = value
        definition_hash = value.get("definitionSha256")
        if definition_hash is not None and sha256_value(value.get("definition")) != definition_hash:
            raise RuntimeError(f"{key} embedded definition hash is invalid")
        artifact_authority[key] = {
            "path": str(path.relative_to(ROOT)),
            "fileSha256": EXPECTED_FILE_HASHES[key],
            **({"definitionSha256": definition_hash} if definition_hash is not None else {}),
        }

    modifier_entries = {
        entry["canonicalId"]: entry
        for entry in artifacts["modifierInventory"]["definition"]["entries"]
        if entry.get("sourceKind") == "item" and entry.get("canonicalId") in ITEM_IDS
    }
    if set(modifier_entries) != set(ITEM_IDS):
        raise RuntimeError("Breeding modifier inventory does not contain all three canonical item providers")
    if any(entry.get("authorityOwner") != "item-custody" or entry.get("clientAuthority") != "none"
           for entry in modifier_entries.values()):
        raise RuntimeError("Breeding item provider ownership or client-authority boundary drifted")
    adjudication = next((entry for entry in artifacts["sourceAdjudications"]["entries"]
                         if entry.get("id") == "BR-SRC-012"), None)
    if not adjudication or adjudication.get("status") != "accepted":
        raise RuntimeError("Accepted fossil source adjudication BR-SRC-012 is unavailable")

    review_rows = {row["canonicalId"]: row for row in review["items"]}
    if set(review_rows) != set(ITEM_IDS):
        raise RuntimeError("Reviewed P8-058 item roster is incomplete")
    output_rows = []
    for canonical_id in ITEM_IDS:
        item = items.get(canonical_id)
        modifier = modifier_entries[canonical_id]
        if not item or item.get("name") != canonical_id:
            raise RuntimeError(f"Canonical item {canonical_id} is unavailable")
        record_hash = sha256_value(item)
        effect_hash = sha256_bytes("\n".join(item.get("effects", [])).encode())
        if modifier.get("recordSha256") != record_hash or modifier.get("mechanicFieldsSha256") is None:
            raise RuntimeError(f"Breeding modifier evidence drifted for {canonical_id}")
        output_rows.append({
            "canonicalId": canonical_id,
            "recordSha256": record_hash,
            "effectSha256": effect_hash,
            "modifierInventoryEntryId": modifier["id"],
            "modifierMechanicFieldsSha256": modifier["mechanicFieldsSha256"],
            "operation": review_rows[canonical_id]["operation"],
            "contexts": review_rows[canonical_id]["contexts"],
            "consumption": review_rows[canonical_id]["consumption"],
            "mechanics": review_rows[canonical_id]["mechanics"],
        })

    return {
        "schemaVersion": 1,
        "ticket": "P8-058",
        "status": "reviewed-native",
        "canonicalAuthority": {
            "items": {"path": "data/reference/items.json", "fileSha256": EXPECTED_FILE_HASHES["items"]},
            "breedingArtifacts": artifact_authority,
            "fossilSourceAdjudicationId": "BR-SRC-012",
            "runtimeDocumentaryParsingForbidden": True,
        },
        "reviewedIntegration": {
            "path": "scripts/reviewed-data/breeding-items.v1.json",
            "fileSha256": EXPECTED_FILE_HASHES["review"],
            "runtimeAuthority": False,
            "reviewStatus": review["reviewStatus"],
            "reviewMethod": review["reviewMethod"],
        },
        "runtimePolicies": review["runtimePolicies"],
        "itemCount": len(output_rows),
        "items": output_rows,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    expected = json.dumps(document(), ensure_ascii=False, indent=2) + "\n"
    if args.check:
        if not OUTPUT.exists() or OUTPUT.read_text(encoding="utf-8") != expected:
            raise SystemExit("Generated breeding-item contract is missing or stale.")
        print("Breeding-item contract check passed: 3 canonical items.")
        return
    OUTPUT.write_text(expected, encoding="utf-8")
    print(f"Generated {OUTPUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
