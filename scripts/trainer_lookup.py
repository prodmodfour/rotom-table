#!/usr/bin/env python3
import json
import sys
import unicodedata
from pathlib import Path

DATA_PATH = Path(__file__).resolve().parent.parent / "trainer_sizes" / "trainers.json"


def normalize_name(value: str) -> str:
    value = unicodedata.normalize("NFKD", value).casefold()
    return "".join(char for char in value if char.isalnum())


def main() -> int:
    if len(sys.argv) != 2 or not sys.argv[1].strip():
        print("usage: just trainer <trainer name>", file=sys.stderr)
        return 1

    query = sys.argv[1].strip()
    normalized_query = normalize_name(query)
    trainers = json.loads(DATA_PATH.read_text(encoding="utf-8"))

    match = next(
        (entry for entry in trainers if normalize_name(entry["trainer"]) == normalized_query),
        None,
    )

    if match is None:
        print(f"Trainer not found: {query}", file=sys.stderr)
        return 1

    print(json.dumps(match, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
