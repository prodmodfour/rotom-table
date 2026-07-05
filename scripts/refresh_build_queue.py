#!/usr/bin/env python3
"""Refresh BUILD_TICKETS.md and PROJECT_BRIEF.md from a ticket planning file."""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

BUILD_TICKETS_PATH = Path("BUILD_TICKETS.md")
PROJECT_BRIEF_PATH = Path("PROJECT_BRIEF.md")

TICKET_HEADING_RE = re.compile(r"^##\s+(?:(?:Ticket\s+)?(\d{1,3})\b|([A-Z][A-Z0-9-]*-\d{3})\b)", re.IGNORECASE)
STATUS_LINE_RE = re.compile(r"^Status:\s+", re.IGNORECASE)
H1_RE = re.compile(r"^#\s+(.+?)\s*$", re.MULTILINE)
H2_RE = re.compile(r"^##\s+(.+?)\s*$")


def run_git(args: list[str], *, cwd: Path, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args],
        cwd=cwd,
        check=check,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )


def repo_root() -> Path:
    result = run_git(["rev-parse", "--show-toplevel"], cwd=Path.cwd())
    return Path(result.stdout.strip())


def resolve_ticket_file(raw_path: str) -> Path:
    candidate = Path(raw_path).expanduser()
    if candidate.exists():
        return candidate.resolve()
    if candidate.suffix != ".md":
        markdown_candidate = candidate.with_suffix(".md")
        if markdown_candidate.exists():
            return markdown_candidate.resolve()
    raise SystemExit(f"Ticket file not found: {raw_path}")


def relative_to_repo(path: Path, root: Path) -> Path:
    try:
        return path.resolve().relative_to(root)
    except ValueError as exc:
        raise SystemExit(f"Ticket file must be inside the git repo: {path}") from exc


def ensure_refresh_paths_are_safe(source_rel: Path) -> None:
    protected = {BUILD_TICKETS_PATH, PROJECT_BRIEF_PATH}
    if source_rel in protected:
        raise SystemExit(f"Refusing to use {source_rel} as the source ticket file.")


def ensure_clean_except_source(root: Path, source_rel: Path, *, allow_dirty: bool) -> None:
    if allow_dirty:
        return
    status = run_git(["status", "--porcelain=v1", "-z"], cwd=root).stdout
    if not status:
        return

    entries = [entry for entry in status.split("\0") if entry]
    dirty_paths: list[str] = []
    source_posix = source_rel.as_posix()
    for entry in entries:
        status_code = entry[:2]
        path_text = entry[3:]
        # Rename/copy entries include an extra source path in porcelain -z. The
        # refresh workflow should not need them, so keep the check conservative.
        if status_code[0] in {"R", "C"}:
            dirty_paths.append(path_text)
            continue
        if path_text != source_posix:
            dirty_paths.append(path_text)

    if dirty_paths:
        listed = "\n".join(f"  - {path}" for path in dirty_paths)
        raise SystemExit(
            "Working tree has unrelated changes. Commit/stash them or rerun "
            f"with --allow-dirty.\n{listed}"
        )


def first_h1(markdown: str, fallback: str) -> str:
    match = H1_RE.search(markdown)
    if not match:
        return fallback
    return match.group(1).strip()


def cleaned_project_title(title: str) -> str:
    return re.sub(r"\s+Tickets\s*$", "", title.strip(), flags=re.IGNORECASE)


def is_ticket_heading(line: str) -> bool:
    return TICKET_HEADING_RE.match(line) is not None


def ticket_id_from_heading(line: str) -> str:
    match = TICKET_HEADING_RE.match(line)
    if not match:
        raise ValueError(f"Not a ticket heading: {line}")
    numeric_id = match.group(1)
    if numeric_id is not None:
        return numeric_id.zfill(3)
    return match.group(2).upper()


def normalized_ticket_heading(line: str) -> str:
    match = TICKET_HEADING_RE.match(line)
    if not match:
        raise ValueError(f"Not a ticket heading: {line}")
    ticket_id = ticket_id_from_heading(line)
    suffix = line[match.end() :].strip()
    if suffix:
        return f"## {ticket_id} {suffix}"
    return f"## {ticket_id}"


def add_todo_statuses(markdown: str) -> tuple[str, list[str]]:
    lines = markdown.splitlines()
    output: list[str] = []
    ticket_ids: list[str] = []
    i = 0
    while i < len(lines):
        line = lines[i].rstrip()
        if not is_ticket_heading(line):
            output.append(line)
            i += 1
            continue

        ticket_ids.append(ticket_id_from_heading(line))
        output.append(normalized_ticket_heading(line))

        j = i + 1
        while j < len(lines) and not lines[j].strip():
            j += 1
        if j < len(lines) and STATUS_LINE_RE.match(lines[j].strip()):
            j += 1
            while j < len(lines) and not lines[j].strip():
                j += 1

        output.extend(["", "Status: TODO", ""])
        i = j

    return "\n".join(output).rstrip() + "\n", ticket_ids


def build_tickets_markdown(ticket_body: str, ticket_ids: list[str]) -> str:
    final_ticket = ticket_ids[-1]
    ticket_count = len(ticket_ids)
    noun = "ticket" if ticket_count == 1 else "tickets"
    return (
        "# BUILD_TICKETS.md\n\n"
        "AUTOMATION_STATUS: TODO\n\n"
        "Ticket statuses:\n\n"
        "* TODO — not done\n"
        "* DONE — done\n\n"
        "The build loop must select the lowest-numbered TODO ticket. "
        "Each ticket below maps to one ticket from the supplied planning file; "
        "build ticket numbers follow that document's suggested order when present.\n\n"
        "Autonomous cycle rules for every ticket: implement only the selected "
        "ticket, run `scripts/quality-gate.sh`, update only the selected ticket "
        "status, commit with a conventional commit message, and leave the working "
        f"tree clean. The final ticket (`{final_ticket}`) may also set "
        f"`AUTOMATION_STATUS: DONE` after all {ticket_count} refreshed {noun} "
        "are complete.\n\n"
        "---\n\n"
        f"{ticket_body}"
    )


def parse_h2_sections(markdown: str) -> dict[str, str]:
    sections: dict[str, list[str]] = {}
    current: str | None = None
    for line in markdown.splitlines():
        match = H2_RE.match(line)
        if match:
            current = match.group(1).strip().lower()
            sections[current] = []
            continue
        if current is not None:
            sections[current].append(line.rstrip())
    return {heading: "\n".join(lines).strip() for heading, lines in sections.items()}


def find_section(sections: dict[str, str], *needles: str) -> str:
    lowered_needles = tuple(needle.lower() for needle in needles)
    for heading, body in sections.items():
        if any(needle in heading for needle in lowered_needles):
            return body.strip()
    return ""


def ensure_markdown_list(body: str, fallback: str) -> str:
    if body.strip():
        return body.strip()
    return fallback.strip()


def project_brief_markdown(markdown: str, ticket_ids: list[str], source_rel: Path) -> str:
    source_title = first_h1(markdown, source_rel.stem.replace("-", " ").title())
    project_title = cleaned_project_title(source_title)
    sections = parse_h2_sections(markdown)
    goal = find_section(sections, "goal")
    non_goals = find_section(sections, "non-goals", "non goals")
    constraints = find_section(sections, "constraints")
    exit_criteria = find_section(sections, "exit criteria")

    first_ticket = ticket_ids[0]
    final_ticket = ticket_ids[-1]
    ticket_count = len(ticket_ids)
    noun = "ticket" if ticket_count == 1 else "tickets"

    goal_body = goal or (
        f"Implement the work described by `BUILD_TICKETS.md` "
        f"(`{first_ticket}` through `{final_ticket}`)."
    )
    non_goal_body = ensure_markdown_list(
        non_goals,
        "- Do not broaden the refreshed ticket queue into unrelated Rotom Table work.\n"
        "- Do not change production runtime state or private campaign data.\n"
        "- Do not weaken live-play authority, revision checks, idempotency, or recovery behavior.",
    )
    constraint_body = ensure_markdown_list(
        constraints,
        "- Keep work scoped to the selected ticket.\n"
        "- Preserve Rotom Table's live-play-only production boundaries.\n"
        "- Keep runtime/generated/private data out of commits.",
    )
    exit_body = ensure_markdown_list(
        exit_criteria,
        "- The refreshed ticket queue is complete.\n"
        "- Tests and quality gates pass.\n"
        "- Documentation reflects the implemented behavior.",
    )

    return f"""# PROJECT_BRIEF.md

TEMPLATE_CUSTOMISED: true

## Project name

Rotom Table — {project_title}.

## Project type

Nuxt 3 and Vue 3 live-play application with TypeScript shared models, three.js/isometric map and token rendering, server-side SQLite persistence, durable HTTP/SSE live-play command flow, IndexedDB outbox recovery, and Vitest coverage.

## Project goal

Implement the refreshed work described by `BUILD_TICKETS.md` (`{first_ticket}` through `{final_ticket}`), generated from the supplied ticket planning file before that handoff file was removed.

{goal_body}

The core rule for refreshed queues is: **ticket work must remain scoped, tested, and compatible with Rotom Table's live-play production boundaries.**

## Audience

- Rotom Table maintainers and operators.
- GMs and players using live-play maps.
- Future autonomous or human contributors maintaining the refreshed feature area.

## Success criteria

The work is successful when:

- Every ticket in `BUILD_TICKETS.md` for `{first_ticket}` through `{final_ticket}` is marked `DONE`.
- `scripts/quality-gate.sh` passes on the final branch.
{exit_body}
- The top-level `AUTOMATION_STATUS` in `BUILD_TICKETS.md` is set to `DONE` when the final ticket is complete.

## Non-goals

{non_goal_body}

## Technology preferences

Preferred stack:

- language: TypeScript, with existing Python/Bash helpers only where already appropriate;
- framework: Nuxt 3 and Vue 3;
- rendering: existing three.js/isometric map/token rendering utilities;
- live-play flow: existing HTTP/SSE command and replay architecture with IndexedDB outbox recovery;
- testing: Vitest, Vue Test Utils/happy-dom where applicable, focused utility tests, renderer state tests, and existing integration helpers;
- package manager: npm with Node.js 24 from `.nvmrc`;
- CI: existing GitHub Actions CI plus local `scripts/quality-gate.sh`.

Hard constraints:

- Follow the repository `AGENTS.md` production deployment boundaries and live-play-only instruction.
- Keep campaign/private data, `.env` files, databases, generated runtime files, and secrets out of commits.
- Keep ticket scope narrow: implement only the lowest-numbered `TODO` ticket in each autonomous cycle.
{constraint_body}
- Do not introduce new dependencies unless there is no practical in-repo alternative.

Flexible choices:

- Exact helper names, file locations, and resolver names may differ from ticket suggestions when they fit the existing architecture better.
- Tests should focus on deterministic utilities and integration boundaries where practical.
- Documentation should be updated when a ticket changes user-facing behavior, architecture, operations, or terminology.

## Architecture expectations

Use existing Rotom Table boundaries and keep the refreshed work aligned with the ticket queue:

```text
planning document -> BUILD_TICKETS.md queue -> scoped ticket implementation -> targeted validation -> quality gate -> conventional commit
```

Expected patterns:

- Keep each autonomous cycle focused on the lowest-numbered `TODO` ticket.
- Prefer pure helpers and narrow integration points so behavior can be tested without broad rewrites.
- Preserve live-play authority, privacy boundaries, and production deployment boundaries unless a selected ticket explicitly requires a reviewed change.
- Keep generated, runtime, and private data out of commits.

## Quality expectations

Expected quality gates:

- shell syntax checks for Bash automation scripts;
- build-loop regression tests from the autonomous build template;
- secret and generated/private-file guardrails;
- `npm ci` using Node.js 24 from `.nvmrc`;
- `npm run typecheck --if-present`;
- `npm test --if-present`;
- `npm run build --if-present`.

Each ticket should also run targeted verification commands for the changed utilities, components, pages, server code, or docs where practical before the full quality gate.

## Documentation expectations

Update existing README/docs/copy when a ticket changes or exposes user-facing behavior, renderer architecture, live-play behavior, operations, limitations, or terminology. Keep `BUILD_TICKETS.md` authoritative for autonomous execution.

## Safety and security constraints

Do not include:

- real secrets, credentials, access tokens, private keys, or real `.env` files;
- private campaign data or production data dumps;
- internal/private hostnames or URLs;
- destructive automation;
- direct production app-runtime edits, rebuilds, restarts, or deployment steps;
- arbitrary shell/code execution features unrelated to the project.

## Agent behaviour notes

- `BUILD_TICKETS.md` is the authoritative local autonomous queue for {project_title}.
- Work one ticket per autonomous cycle, in numeric order; build ticket numbers follow the refreshed planning file's suggested order when present.
- Keep each commit focused on the selected ticket and use a conventional commit message.
- Do not update ticket statuses beyond the selected ticket. The only exception is the final ticket `{final_ticket}`, which may set `AUTOMATION_STATUS: DONE` after all {ticket_count} refreshed {noun} are complete and the final quality gate passes.
- Do not create, close, merge, or comment on pull requests/issues from inside an autonomous ticket run unless a future ticket explicitly asks for it.
"""


def source_is_tracked(root: Path, source_rel: Path) -> bool:
    result = run_git(["ls-files", "--", source_rel.as_posix()], cwd=root)
    return bool(result.stdout.strip())


def write_refresh_files(root: Path, source: Path, source_rel: Path) -> list[Path]:
    markdown = source.read_text()
    source_was_tracked = source_is_tracked(root, source_rel)
    ticket_body, ticket_ids = add_todo_statuses(markdown)
    if not ticket_ids:
        raise SystemExit(
            "No ticket headings found. Expected headings like '## ABC-001 — ...', "
            "'## 001 — ...', or '## Ticket 1 — ...'."
        )

    build_tickets = build_tickets_markdown(ticket_body, ticket_ids)
    project_brief = project_brief_markdown(markdown, ticket_ids, source_rel)

    build_path = root / BUILD_TICKETS_PATH
    brief_path = root / PROJECT_BRIEF_PATH
    build_path.write_text(build_tickets)
    brief_path.write_text(project_brief)
    source.unlink()

    changed_paths = [BUILD_TICKETS_PATH, PROJECT_BRIEF_PATH]
    if source_was_tracked:
        changed_paths.append(source_rel)
    return changed_paths


def git_has_staged_changes(root: Path) -> bool:
    result = run_git(["diff", "--cached", "--quiet"], cwd=root, check=False)
    return result.returncode != 0


def commit_and_push(root: Path, paths: list[Path], source_rel: Path, *, no_commit: bool, no_push: bool) -> None:
    run_git(["diff", "--check"], cwd=root)
    if no_commit:
        print("Refreshed files without committing (--no-commit).")
        return

    run_git(["add", "--", *[path.as_posix() for path in paths]], cwd=root)
    if not git_has_staged_changes(root):
        print("No staged changes to commit after refresh.")
        return

    message = f"docs: refresh build queue from {source_rel.stem}"
    run_git(["commit", "-m", message], cwd=root)
    print(f"Committed: {message}")

    if no_push:
        print("Skipped push (--no-push).")
        return

    run_git(["push"], cwd=root)
    print("Pushed current branch.")


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Refresh BUILD_TICKETS.md and PROJECT_BRIEF.md from a ticket planning "
            "file, delete the planning file, commit, and push."
        )
    )
    parser.add_argument("ticket_file", help="Ticket planning markdown file, e.g. sprint-6.md")
    parser.add_argument(
        "--allow-dirty",
        action="store_true",
        help="Allow unrelated working-tree changes; only refresh paths are staged.",
    )
    parser.add_argument("--no-commit", action="store_true", help="Refresh files but do not commit or push.")
    parser.add_argument("--no-push", action="store_true", help="Commit the refresh but do not push.")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    root = repo_root()
    source = resolve_ticket_file(args.ticket_file)
    source_rel = relative_to_repo(source, root)
    ensure_refresh_paths_are_safe(source_rel)
    ensure_clean_except_source(root, source_rel, allow_dirty=args.allow_dirty)

    changed_paths = write_refresh_files(root, source, source_rel)
    commit_and_push(root, changed_paths, source_rel, no_commit=args.no_commit, no_push=args.no_push)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
