#!/usr/bin/env python3
import json
import sys
import unicodedata
from pathlib import Path

DATA_PATH = Path(__file__).resolve().parent.parent / "pokemon_sizes" / "pokemon.json"


def normalize_name(value: str) -> str:
    value = unicodedata.normalize("NFKD", value).casefold()
    return "".join(char for char in value if char.isalnum())


def main() -> int:
    if len(sys.argv) != 2 or not sys.argv[1].strip():
        print("usage: just pokemon <pokemon name>", file=sys.stderr)
        return 1

    query = sys.argv[1].strip()
    normalized_query = normalize_name(query)
    pokemon = json.loads(DATA_PATH.read_text(encoding="utf-8"))

    match = next(
        (entry for entry in pokemon if normalize_name(entry["species"]) == normalized_query),
        None,
    )

    if match is None:
        print(f"Pokemon not found: {query}", file=sys.stderr)
        return 1

    print(json.dumps(match, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
