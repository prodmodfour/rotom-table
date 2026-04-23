#!/usr/bin/env python3
"""Fetch PTU 1.05 abilities from the community character sheet and merge them
into ptu-data/data/abilities.json.

Source: https://docs.google.com/spreadsheets/d/1qNXTHozEWYrd_eGlhQdpCf5q1x3D0z7-zmFQyLwz83k
Sheet : 'Abilities Data' (columns: Name, Frequency, Effect, Trigger, Target,
                                   Keywords, Effect 2)

Requires the `gws` CLI to be configured and able to read the sheet.

Merge strategy: fill-only. Entries already present in abilities.json keep their
existing fields. Anything new from the sheet is added.
"""

import json
import os
import re
import subprocess
import sys

SPREADSHEET_ID = "1qNXTHozEWYrd_eGlhQdpCf5q1x3D0z7-zmFQyLwz83k"
SHEET_RANGE = "Abilities Data!A1:G700"

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE_PATH = os.path.join(REPO_ROOT, "ptu-data", "data", "abilities.json")


def fetch_rows() -> list[list[str]]:
    """Call gws and return the sheet rows (list of lists)."""
    cmd = [
        "gws", "sheets", "spreadsheets", "values", "get",
        "--params", json.dumps({
            "spreadsheetId": SPREADSHEET_ID,
            "range": SHEET_RANGE,
        }),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, check=True)
    # gws prints a backend banner on the first line; find the JSON object start.
    stdout = result.stdout
    brace = stdout.find("{")
    if brace < 0:
        print(stdout, file=sys.stderr)
        raise RuntimeError("gws produced no JSON payload")
    data = json.loads(stdout[brace:])
    return data.get("values", [])


def normalize_freq(raw: str) -> str:
    """Collapse inner whitespace in 'Scene -  Free Action' etc."""
    return re.sub(r"\s+", " ", raw).strip()


def rows_to_abilities(rows: list[list[str]]) -> dict[str, dict]:
    if not rows:
        return {}
    header = [h.strip() for h in rows[0]]
    def col(row, name):
        try:
            idx = header.index(name)
        except ValueError:
            return ""
        return row[idx].strip() if idx < len(row) else ""

    abilities = {}
    for row in rows[1:]:
        if not row:
            continue
        name = (row[0].strip() if row else "")
        if not name:
            continue
        entry = {"name": name}
        freq = normalize_freq(col(row, "Frequency"))
        trigger = col(row, "Trigger")
        effect = col(row, "Effect")
        target = col(row, "Target")
        if freq:
            entry["frequency"] = freq
        if trigger:
            entry["trigger"] = trigger
        if effect:
            entry["effect"] = effect
        if target:
            entry["target"] = target
        abilities[name] = entry
    return abilities


def merge(existing: dict, incoming: dict) -> tuple[dict, int, int]:
    """Fill-only merge: add new keys, never overwrite existing values.

    Returns (merged, added, enriched). 'enriched' = existing entries where the
    incoming record had fields the existing one was missing.
    """
    merged = dict(existing)
    added = 0
    enriched = 0
    for name, new_entry in incoming.items():
        if name not in merged:
            merged[name] = new_entry
            added += 1
            continue
        cur = merged[name]
        changed = False
        for key, value in new_entry.items():
            if value and not cur.get(key):
                cur[key] = value
                changed = True
        if changed:
            enriched += 1
    return merged, added, enriched


def main():
    print(f"Reading {CACHE_PATH} ...")
    if os.path.exists(CACHE_PATH):
        with open(CACHE_PATH, "r", encoding="utf-8") as f:
            existing = json.load(f)
    else:
        existing = {}
    print(f"  {len(existing)} abilities currently cached.")

    print(f"Fetching '{SHEET_RANGE}' from {SPREADSHEET_ID} ...")
    rows = fetch_rows()
    incoming = rows_to_abilities(rows)
    print(f"  {len(incoming)} abilities from sheet.")

    merged, added, enriched = merge(existing, incoming)

    with open(CACHE_PATH, "w", encoding="utf-8") as f:
        json.dump(merged, f, indent=2, ensure_ascii=False)

    print(f"Wrote {len(merged)} abilities to {CACHE_PATH}")
    print(f"  +{added} new  /  {enriched} enriched  /  {len(existing)} preserved")


if __name__ == "__main__":
    main()
