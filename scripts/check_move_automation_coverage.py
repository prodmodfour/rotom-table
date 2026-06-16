#!/usr/bin/env python3
"""CLI entrypoint for explicit PTU move automation coverage checks."""
from __future__ import annotations

import argparse

from move_automation_coverage import build_coverage, print_default_coverage
from move_automation_worklist import print_worklist_report


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--report",
        "--worklist",
        action="store_true",
        dest="report",
        help="print a heuristic missing-move worklist report instead of failing coverage",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    coverage = build_coverage()
    if args.report:
        return print_worklist_report(coverage)
    return print_default_coverage(coverage)


if __name__ == "__main__":
    raise SystemExit(main())
