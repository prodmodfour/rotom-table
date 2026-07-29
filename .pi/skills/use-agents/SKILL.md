---
name: use-agents
description: Coordinate Pi child agents safely in the Rotom Table repository. Use when a task could benefit from parallel codebase research, semantic or security audits, or a tightly scoped implementation using isolated Git worktrees with parent-owned review, merging, validation, and resource control.
---

# Use Agents in Rotom Table

Use child agents as bounded collaborators, not as independent integration owners. The parent agent owns architecture, worktree integrity, validation, commits, and the final answer.

## Project invariants

Before delegating, honor the repository `AGENTS.md` files and the active implementation plan.

- The parent integration worktree may contain important in-progress work; commit and push a coherent checkpoint before branching for writable children.
- Give each child its own Git branch and worktree by default. Never let a writable child edit directly in the parent integration worktree.
- Never reset, clean, stash, checkout, restore, or overwrite unrelated work.
- Never treat local prodlike-only changes as a production fix.
- Preserve app-owned reference data authority, server authority, privacy, replay safety, and transactional behavior.
- The parent is the only integration and validation coordinator.
- Child agents must not merge, commit, or push. The parent reviews their worktree, creates the commit, merges it, and pushes the integrated branch.

## Decide whether to delegate

Delegate when the work can be split into independently reviewable units:

- read-only source or canonical-rule research;
- security, privacy, concurrency, lifecycle, or semantic audits;
- locating all callers or interaction seams;
- comparing implementation against a bounded catalog or fixture;
- a tightly scoped implementation with exclusive file ownership.

Do not delegate when:

- the task is small enough for one or two direct tool calls;
- the architecture is still unresolved;
- multiple tasks would need to edit the same core files;
- correctness depends on rapid feedback between tightly coupled changes;
- the child would need to run a broad test suite, typecheck, build, server, or quality gate;
- the parent cannot review the resulting diff before integrating it.

## Concurrency budget

Default to no more than **two live child agents**.

- Prefer two read-only agents, or one read-only agent plus one writer.
- Default to at most **one writable child** at a time.
- Do not increase concurrency merely because more work exists.
- Before spawning, inspect current children with `subagent_list`.
- If memory pressure is suspected, inspect host memory and active Node processes before doing more work.
- Never run heavy validation while children are active unless they are idle and no child-owned process remains.

## Isolate children with Git worktrees

Use a dedicated worktree for each child, including read-only children when practical. Writable children must always be isolated.

1. Make the parent integration tree a coherent checkpoint: review, commit, and push current work first.
2. Inspect `git worktree list` and existing branches so names and paths do not collide.
3. Create a purpose-named branch and sibling worktree from the intended integration commit, for example:

   ```bash
   git worktree add -b agent/<task-id> ../rotom-table-wt-<task-id> HEAD
   ```

4. Spawn the child with `cwd` set to that exact worktree path.
5. Tell the child its branch and worktree path are fixed boundaries. It may edit within that worktree but must not commit, merge, rebase, or push.
6. After handoff, the parent inspects and reviews the child worktree, then creates a coherent commit on the child branch.
7. The parent returns to the integration worktree, merges or cherry-picks the reviewed commit, resolves conflicts, validates the integrated result, and pushes the active branch.
8. Remove the child worktree and branch only after all wanted changes are committed and integrated. Never use forced removal to discard unexplained changes.

If a child needs parent changes made after its branch point, the parent should integrate those changes deliberately through Git. Do not copy arbitrary dirty files between worktrees.

## Assign scopes

Every child prompt must state:

1. the exact goal and expected output;
2. whether the task is read-only or writable;
3. authoritative source files and applicable invariants;
4. the exclusive file or directory scope, if writable;
5. files or concerns that are explicitly out of scope;
6. its dedicated worktree path and branch;
7. that unrelated changes must be preserved;
8. that no Git history operations, commit, merge, rebase, or push are allowed;
9. that no typecheck, Vitest, build, quality gate, dev server, or browser run is allowed unless the parent explicitly delegates one bounded command;
10. the required handoff format, including the worktree path and branch.

Prefer `write: false` for audits. Grant `write: true` only when the task has a narrow, non-overlapping implementation boundary.

## Required handoff

Ask every child to end with:

- **Findings or implementation summary**
- **Files read**
- **Files changed** (or `none`)
- **Tests run** (normally `none by instruction`)
- **Risks, uncertainties, and follow-up work**

For audits, require exact file paths and line references. Distinguish verified defects from hypotheses.

For implementations, require the child to describe invariants preserved, not merely list edits.

## Prompt templates

### Read-only audit

```text
Read-only task. Do not edit files.

Goal: <bounded question>.
Authoritative inputs: <paths and canonical rules>.
Inspect: <directories/files>.
Out of scope: <boundaries>.

Work only in the dedicated worktree at <absolute path> on branch <branch>. Do not run Git mutation or history commands.
Do not run typecheck, Vitest, builds, quality gates, dev servers, or browsers.
Return verified findings with severity, exact file:line evidence, and a minimal recommended fix. Separate confirmed defects from questions. End with the required handoff sections.
```

### Scoped implementation

```text
Writable task with exclusive scope: <files/directories>.

Goal: <one bounded implementation>.
Required invariants: <authority/privacy/replay/transaction/lifecycle rules>.
Authoritative inputs: <paths>.
Do not edit outside the exclusive scope without stopping and reporting the need.

Work only in the dedicated worktree at <absolute path> on branch <branch>. Re-read each file before editing, preserve unrelated changes, and never reset, clean, stash, restore, commit, merge, rebase, or push.
Do not run typecheck, Vitest, builds, quality gates, dev servers, or browsers. The parent will review, commit, merge, and validate.
End with the required handoff sections, including every file changed and remaining risks.
```

## Monitor without micromanaging

- After spawning, continue independent parent work only when it will not invalidate the child branch assumptions or create avoidable merge conflicts.
- Use `subagent_events` with a meaningful wait rather than tight polling.
- Read tool calls or interim reasoning only when needed to catch scope drift.
- If a child starts touching excluded files or planning prohibited validation, use `subagent_rpc` to steer it immediately.
- If a child stalls, loops, or expands scope, steer once. Abort or kill it if the boundary is still not respected.
- Do not let a child silently become the architecture decision-maker.

## Collect handoffs reliably

Before integrating or allowing context compaction:

1. wait for each child to settle;
2. retrieve its final response or last assistant text;
3. record its branch, worktree path, reported files, and risks in the parent context;
4. kill any child process that remains alive but is no longer needed;
5. verify no child-owned heavy process remains;
6. inspect the worktree status and diff before creating any commit.

A missing final handoff means the task is incomplete. Reconstruct its work from scoped diffs and events before relying on it.

## Review writable work

Never accept a child edit on trust alone.

1. Inspect `git -C <child-worktree> status --short` and `git -C <child-worktree> diff`.
2. Re-read changed code in its surrounding context.
3. Check for edits outside the assigned scope and for unexplained untracked files.
4. Verify authority, privacy, replay, transaction, lifecycle, and backward-compatibility boundaries as applicable.
5. Have the parent stage and commit only reviewed paths on the child branch.
6. Merge or cherry-pick the child commit into the latest integration branch; never overwrite either side to avoid resolving a conflict.
7. Inspect the integrated diff, run serialized validation, and push the integration branch.
8. Confirm both worktree and branch contain no wanted uncommitted work before non-forced cleanup.

Worktree isolation makes attribution explicit. Any edit outside the child worktree or assigned scope is a boundary violation and must be investigated before integration.

## Validation discipline

The parent serializes validation after integrating a meaningful batch.

- Start with the smallest focused test that exercises the changed behavior.
- When practical, constrain Vitest with `--maxWorkers=1 --no-file-parallelism`.
- Do not rerun passing suites unless their dependency surface changed.
- Run typecheck at integration milestones, not after every child edit.
- Reserve full Vitest, build, and `scripts/quality-gate.sh` for closure.
- Never overlap typecheck, Vitest, Nuxt/Vite build, or quality-gate processes.
- If OOM or memory pressure occurs, stop duplicate processes and resume with one bounded command at a time.

## Good delegation patterns for this repository

- Give separate read-only agents different canonical capability cohorts to audit in purpose-named worktrees.
- Give one agent a server-side mechanic and another a privacy-boundary audit in separate worktrees, provided their eventual commits do not overlap.
- Ask an agent to enumerate interaction seams while the parent implements the chosen design.
- Use an agent to review a completed diff for replay, stale-write, or source-loss defects.

## Bad delegation patterns

- Spawning a writable child in the parent integration worktree.
- Multiple writers editing `executeCapabilityAction.ts`, movement context, migrations, or shared state types simultaneously, even from separate worktrees.
- Asking every child to run the same focused suite.
- Delegating a broad instruction such as “finish capability automation.”
- Allowing a child to modify generated data, runtime code, tests, and the implementation plan without an exact boundary.
- Spawning more agents before collecting existing handoffs.
- Treating high parallelism as progress when integration and validation are the bottleneck.
