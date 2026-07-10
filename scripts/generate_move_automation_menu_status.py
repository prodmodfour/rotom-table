#!/usr/bin/env python3
"""Generate the bounded browser-facing projection of the semantic move manifest."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MANIFEST_PATH = ROOT / "data" / "move-automation" / "manifest.json"
DEFAULT_OUTPUT_PATH = ROOT / "data" / "move-automation" / "menu-status.json"
OUTPUT_SCHEMA_VERSION = 1
PROJECTED_FIELDS = (
    "canonicalId",
    "displayName",
    "baseStatus",
    "interactionStatus",
    "blockerCodes",
    "limitations",
    "manualSteps",
)


class MenuStatusGenerationError(ValueError):
    """Raised when the source manifest cannot produce a safe menu projection."""


def load_manifest(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise MenuStatusGenerationError(f"Could not read semantic manifest {path}: {error}") from error

    if not isinstance(value, dict) or not isinstance(value.get("moves"), list):
        raise MenuStatusGenerationError("Semantic manifest must contain a moves array.")
    return value


def project_manifest(manifest: dict[str, Any]) -> dict[str, Any]:
    projected_moves: list[dict[str, Any]] = []
    for index, row in enumerate(manifest["moves"]):
        if not isinstance(row, dict):
            raise MenuStatusGenerationError(f"Manifest move at index {index} must be an object.")
        missing = [field for field in PROJECTED_FIELDS if field not in row]
        runtime = row.get("runtime")
        if missing or not isinstance(runtime, dict) or "kind" not in runtime:
            raise MenuStatusGenerationError(
                f"Manifest move at index {index} is missing menu status fields: "
                f"{', '.join(missing) or 'runtime.kind'}."
            )
        projected_moves.append(
            {
                **{field: row[field] for field in PROJECTED_FIELDS[:4]},
                "runtimeKind": runtime["kind"],
                **{field: row[field] for field in PROJECTED_FIELDS[4:]},
            }
        )

    return {"schemaVersion": OUTPUT_SCHEMA_VERSION, "moves": projected_moves}


def render_projection(projection: dict[str, Any]) -> str:
    return f"{json.dumps(projection, indent=2, ensure_ascii=False)}\n"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST_PATH)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT_PATH)
    parser.add_argument(
        "--check",
        action="store_true",
        help="Fail instead of writing when the committed projection is stale.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        rendered = render_projection(project_manifest(load_manifest(args.manifest)))
    except MenuStatusGenerationError as error:
        print(str(error), file=sys.stderr)
        return 1

    if args.check:
        try:
            current = args.output.read_text(encoding="utf-8")
        except OSError:
            current = ""
        if current != rendered:
            print(
                f"Move automation menu status projection is stale: {args.output}",
                file=sys.stderr,
            )
            return 1
        return 0

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(rendered, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
