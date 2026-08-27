#!/usr/bin/env python3
"""Append reviewed Plan 13 successors without rewriting archived Plan 11/12 edges."""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CHAIN = ROOT / "data/deferred-closure/successor-chain.v1.json"


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    document = json.loads(CHAIN.read_text(encoding="utf-8"))
    edges = document["edges"]
    grouped: dict[str, list[dict[str, object]]] = {}
    for edge in edges:
        grouped.setdefault(str(edge["surface"]), []).append(edge)

    appended = 0
    for surface, surface_edges in sorted(grouped.items()):
        path = ROOT / surface
        if not path.is_file():
            raise SystemExit(f"Successor surface is missing: {surface}")
        before_values = {str(edge["beforeSha256"]) for edge in surface_edges}
        heads = [str(edge["afterSha256"]) for edge in surface_edges if str(edge["afterSha256"]) not in before_values]
        if len(set(heads)) != 1:
            raise SystemExit(f"Successor surface does not have one chain head: {surface} -> {heads}")
        head = heads[0]
        current = digest(path)
        if head == current:
            continue
        slug = re.sub(r"[^a-z0-9]+", "-", surface.lower()).strip("-")
        prefix = f"release-readiness:{slug}:p13-successor-v"
        revision = 1 + sum(str(edge.get("migrationId", "")).startswith(prefix) for edge in edges)
        edges.append({
            "migrationId": f"{prefix}{revision}",
            "ticket": "P13-046",
            "surface": surface,
            "beforeSha256": head,
            "afterSha256": current,
            "changedStableRows": ["release-readiness-reviewed-successor"],
            "changePolicy": "Plan 13 release certification or documentation successor; archived final mechanics states and canonical semantics remain unchanged.",
            "reviewStatus": "accepted",
        })
        appended += 1

    CHAIN.write_text(json.dumps(document, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Appended {appended} reviewed Plan 13 successor edge(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
