#!/usr/bin/env python3
"""Validate move-automation metadata or require final semantic completion."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from move_automation_coverage import (
    CAPABILITY_CATALOG_PATH,
    LEGACY_FINGERPRINT_PATH,
    MANIFEST_PATH,
    SCENARIO_REQUIREMENTS_PATH,
    SCENARIO_ROOT,
    MoveAutomationValidationError,
    SemanticCoverageReport,
    build_coverage,
    validate_semantic_coverage,
)
from move_automation_worklist import print_worklist_report


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    output = parser.add_mutually_exclusive_group()
    output.add_argument(
        "--json",
        action="store_true",
        help="print deterministic machine-readable validation output",
    )
    output.add_argument(
        "--report",
        "--markdown",
        dest="report",
        action="store_true",
        help="print the deterministic Markdown semantic progress report",
    )
    output.add_argument(
        "--worklist",
        action="store_true",
        help="print the legacy heuristic missing-script planning report",
    )
    parser.add_argument(
        "--require-complete",
        action="store_true",
        help="fail unless every canonical move has complete semantic status",
    )
    parser.add_argument(
        "--manifest",
        type=Path,
        default=MANIFEST_PATH,
        help="manifest to validate (defaults to data/move-automation/manifest.json)",
    )
    parser.add_argument(
        "--capabilities",
        type=Path,
        default=CAPABILITY_CATALOG_PATH,
        help="typed capability catalog used to resolve manifest capability references",
    )
    parser.add_argument(
        "--scenario-requirements",
        type=Path,
        default=SCENARIO_REQUIREMENTS_PATH,
        help="reviewed mapping from mechanic/branch tags to required scenario evidence",
    )
    parser.add_argument(
        "--legacy-fingerprints",
        type=Path,
        default=LEGACY_FINGERPRINT_PATH,
        help="legacy v1 fingerprint index used to validate manifest runtime links",
    )
    parser.add_argument(
        "--scenario-root",
        type=Path,
        default=SCENARIO_ROOT,
        help="scenario fixture directory used to resolve manifest scenario IDs",
    )
    return parser.parse_args()


def print_json_report(report: SemanticCoverageReport) -> None:
    print(json.dumps(report.as_json(), ensure_ascii=False, indent=2, sort_keys=True))


def print_error_json(error: MoveAutomationValidationError, require_complete: bool) -> None:
    print(json.dumps({
        "issues": [{
            "code": error.code,
            "message": error.detail,
            "path": error.path,
        }],
        "metadataValid": False,
        "requireComplete": require_complete,
        "valid": False,
    }, ensure_ascii=False, indent=2, sort_keys=True))


def _markdown_code(value: str) -> str:
    return f"`{value.replace('`', '&#96;')}`"


def _append_move_list(lines: list[str], moves: tuple[str, ...]) -> None:
    if not moves:
        lines.append("_None._")
        return
    for start in range(0, len(moves), 8):
        lines.append(
            "- " + ", ".join(
                _markdown_code(move)
                for move in moves[start:start + 8]
            )
        )


def render_markdown_report(report: SemanticCoverageReport) -> str:
    completion_requirement = (
        "PASS" if report.complete else "FAIL"
    ) if report.require_complete else "not enforced"
    lines = [
        "# Move automation semantic validation report",
        "",
        "> Planning groups are derived only from the validated semantic manifest and reviewed evidence metadata.",
        "> Heuristic move-prose classification is informational only and is not used by this report.",
        "",
        "## Summary",
        "",
        f"- Ruleset: {_markdown_code(report.ruleset_id)}",
        f"- Canonical catalog: **{report.canonical_count}**",
        f"- Manifest rows: **{report.manifest_count}**",
        "- Base status: "
        f"**{report.base_status_counts['complete']}** complete, "
        f"**{report.base_status_counts['assisted']}** assisted, "
        f"**{report.base_status_counts['blocked']}** blocked",
        "- Interaction status: "
        f"**{report.interaction_status_counts['complete']}** complete, "
        f"**{report.interaction_status_counts['partial']}** partial, "
        f"**{report.interaction_status_counts['unassessed']}** unassessed",
        "- Runtime: "
        f"**{report.runtime_counts['legacy-v1']}** legacy-v1, "
        f"**{report.runtime_counts['movespec-v2']}** movespec-v2, "
        f"**{report.runtime_counts['unimplemented']}** unimplemented",
        f"- Explicit v1 registry entries: **{report.explicit_registry_count}**",
        "- References: "
        f"**{report.linked_runtime_count}** linked runtimes, "
        f"**{report.runtime_definition_hash_count}** definition hashes, "
        f"**{report.scenario_reference_count}** scenario references "
        f"(**{report.discovered_scenario_count}** discovered fixtures)",
        f"- Metadata validation: **{'PASS' if report.metadata_valid else 'FAIL'}**",
        f"- Completion requirement: **{completion_requirement}**",
        "",
        "## Semantic status",
    ]

    for group in report.progress.semantic_status:
        lines.extend(["", f"### {group.status} ({len(group.moves)})", ""])
        _append_move_list(lines, group.moves)

    lines.extend(["", "## Capability blockers"])
    if not report.progress.capability_blockers:
        lines.extend(["", "_None._"])
    for group in report.progress.capability_blockers:
        lines.extend([
            "",
            f"### {group.blocker_code} ({len(group.moves)})",
            "",
            f"- Owning phase: {_markdown_code(group.owning_phase)}",
            f"- Implementation status: {_markdown_code(group.implementation_status)}",
        ])
        _append_move_list(lines, group.moves)

    lines.extend(["", "## Rollout cohorts"])
    if not report.progress.cohorts:
        lines.extend(["", "_None._"])
    for group in report.progress.cohorts:
        cohort_label = group.cohort_id or "unassigned"
        lines.extend(["", f"### {cohort_label} ({len(group.moves)})", ""])
        _append_move_list(lines, group.moves)

    lines.extend(["", "## Missing test evidence"])
    if not report.progress.missing_test_evidence:
        lines.extend(["", "_None._"])
    for group in report.progress.missing_test_evidence:
        lines.extend([
            "",
            f"### {group.evidence_code} ({len(group.moves)})",
            "",
            group.summary,
            "",
        ])
        _append_move_list(lines, group.moves)

    lines.extend(["", "## Validation issues", ""])
    if not report.issues:
        lines.append("_None._")
    for issue in report.issues:
        lines.append(
            f"- **ERROR [{issue.code}]** {_markdown_code(issue.path)}: {issue.detail}"
        )
    return "\n".join(lines)


def print_markdown_report(report: SemanticCoverageReport) -> None:
    print(render_markdown_report(report))


def print_concise(report: SemanticCoverageReport) -> None:
    if report.valid:
        print(
            "Move automation metadata valid: "
            f"{report.manifest_count}/{report.canonical_count} canonical rows; "
            f"{report.base_status_counts['complete']} complete, "
            f"{report.base_status_counts['assisted']} assisted, "
            f"{report.base_status_counts['blocked']} blocked."
        )
        return
    for issue in report.issues:
        print(
            f"Move automation validation failed [{issue.code}] "
            f"{issue.path}: {issue.detail}",
            file=sys.stderr,
        )


def main() -> int:
    args = parse_args()
    if args.worklist:
        return print_worklist_report(build_coverage())

    try:
        report = validate_semantic_coverage(
            require_complete=args.require_complete,
            manifest_path=args.manifest.resolve(),
            capabilities_path=args.capabilities.resolve(),
            scenario_requirements_path=args.scenario_requirements.resolve(),
            legacy_fingerprint_path=args.legacy_fingerprints.resolve(),
            scenario_root=args.scenario_root.resolve(),
        )
    except MoveAutomationValidationError as error:
        if args.json:
            print_error_json(error, args.require_complete)
        else:
            print(
                f"Move automation validation failed [{error.code}] "
                f"{error.path}: {error.detail}",
                file=sys.stderr,
            )
        return 1
    except (OSError, ValueError) as error:
        validation_error = MoveAutomationValidationError(
            "validation-error",
            "move-automation",
            str(error),
        )
        if args.json:
            print_error_json(validation_error, args.require_complete)
        else:
            print(f"Move automation validation failed: {error}", file=sys.stderr)
        return 1

    if args.json:
        print_json_report(report)
    elif args.report:
        print_markdown_report(report)
    else:
        print_concise(report)
    return 0 if report.valid else 1


if __name__ == "__main__":
    raise SystemExit(main())
