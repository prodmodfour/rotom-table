#!/usr/bin/env python3
"""Resolve reviewed cross-plan successors for frozen hash-bound evidence."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path


def file_sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def accepted_successor_head(root: Path, relative_path: str, recorded_sha256: str) -> str:
    """Resolve a recorded hash to the current file through one contiguous accepted chain."""
    absolute = root / relative_path
    if not absolute.is_file():
        raise ValueError(f"Successor evidence path is missing: {relative_path}")
    current = file_sha256(absolute)
    chain = json.loads((root / "data/deferred-closure/successor-chain.v1.json").read_text(encoding="utf-8"))
    edges = [
        edge for edge in chain.get("edges", [])
        if edge.get("surface") == relative_path and edge.get("reviewStatus") == "accepted"
    ]
    cursor = recorded_sha256
    visited: set[str] = set()
    while cursor != current:
        if cursor in visited:
            raise ValueError(f"{relative_path} accepted successor chain cycles at {cursor}")
        visited.add(cursor)
        candidates = [edge for edge in edges if edge.get("beforeSha256") == cursor]
        if len(candidates) != 1:
            raise ValueError(
                f"{relative_path} requires one accepted successor from {cursor}; found {len(candidates)}"
            )
        after = candidates[0].get("afterSha256")
        if not isinstance(after, str):
            raise ValueError(f"{relative_path} accepted successor has no afterSha256")
        cursor = after
    return cursor


def advance_hash_bindings(root: Path, value: object) -> object:
    """Copy JSON data while advancing every {path, sha256} evidence binding."""
    if isinstance(value, list):
        return [advance_hash_bindings(root, entry) for entry in value]
    if not isinstance(value, dict):
        return value
    advanced = {key: advance_hash_bindings(root, entry) for key, entry in value.items()}
    path = advanced.get("path")
    recorded = advanced.get("sha256")
    if isinstance(path, str) and isinstance(recorded, str):
        advanced["sha256"] = accepted_successor_head(root, path, recorded)
    return advanced
