# BUILD_TICKETS.md

AUTOMATION_STATUS: TODO

Ticket statuses:

* TODO — not done
* DONE — done

The build loop must select the lowest-numbered TODO ticket. Each ticket below maps to one ticket from the supplied planning file; build ticket numbers follow that document's suggested order when present.

Autonomous cycle rules for every ticket: implement only the selected ticket, run `scripts/quality-gate.sh`, update only the selected ticket status, commit with a conventional commit message, and leave the working tree clean. The final ticket (`MA-299`) may also set `AUTOMATION_STATUS: DONE` after all 279 refreshed tickets are complete.

---

# Move automation: full implementation ticket queue

This is the implementation queue for taking Rotom Table from explicit-but-partial move automation to complete automation of the canonical move catalog.

Baseline at commit `c55520fee271b724e2105eb263eb8a56dae05ce6`:

- 776 canonical valid move records;
- 258 moves with an explicit registry entry;
- 518 moves without an explicit registry entry;
- semantic completion is lower than 258 because some registered scripts still leave rules to the operator.

The target is **776 `complete`, zero `assisted`, zero `blocked`** for the frozen ruleset. The target does not include bespoke animation choreography or every unrelated feature/ability/item interaction in the whole game. Directly referenced interactions required by a move do count.

## How to use this file

Work from top to bottom unless a ticket explicitly says it can run in parallel. Each ticket is intended to be one reviewable commit.

For every ticket:

1. Read its dependencies and the current versions of the named files.
2. Keep the change to the stated outcome. Do not pull a later ticket forward just because the types make it tempting.
3. Add or update the tests named in the ticket.
4. Run the narrow tests while developing, then `npm run typecheck` and the relevant server/domain suites before committing.
5. Use the suggested commit subject, or an equivalent conventional subject.
6. Update this file only when reality changes a dependency or acceptance criterion; do not check off tickets by weakening their definition of done.

When a ticket introduces a new pure module, prefer this layout:

- shared wire contracts and strict parsers: `shared/moveAutomation/`;
- server-only pure rules and reducers: `server/domain/moveAutomation/`;
- transactional orchestration: `server/useCases/`;
- browser presentation and intent collection: `src/composables/map-editor/` and `src/components/`;
- reviewed catalog metadata: `data/move-automation/`;
- reusable scenarios: `tests/fixtures/moveAutomation/`.

The existing `src/utils/move-automation/` registry remains the v1 compatibility surface until the retirement tickets at the end.

Queue size at this baseline: **279 commits**—173 engine/state/QA tickets, 33 conformance batches for the registered 258, and 73 implementation batches for the missing 518.

## Decisions already locked

| Question | Decision |
|---|---|
| What counts as automated? | Manifest statuses are `complete`, `assisted`, and `blocked`. Only `complete` counts. Human choices are allowed only when represented by typed, authorized, durable prompts. |
| Runtime model | Versioned, JSON-serializable `MoveSpec` plus a bounded typed effect-operation interpreter. Registered server handlers are an audited escape hatch for genuine outliers. |
| Rules prose | Never interpret free-form move prose at runtime. Prose may scaffold or lint a human-reviewed spec. |
| Authority | The client sends intent and durable choice IDs. The server owns legality, targets, RNG, mechanics, durable state, and final logs. |
| Volatile state | Versioned `encounterState` on the authoritative map owns sides, effects, counters, zones, delayed work, history, and pending interaction summaries. |
| Persistent state | Sheets continue to own HP, injuries, daily usage, lasting character state, and character inventory. Campaign inventory remains a separate resource. |
| Allegiance | Placements receive explicit `sideId`; ally/enemy is never inferred from player/NPC ownership. |
| Timing | Initiative and server state transitions drive phases. Wall-clock timers never advance game rules. |
| Reactions | A durable resumable saga: declare, open a response window, collect/pass, then resolve or cancel. No database transaction stays open while a person decides. |
| GM intervention | Typed override/correction commands with an audit trail; no hidden manual bookkeeping. |
| Coverage claim | Base-move completeness is tracked separately from broad ecosystem interaction coverage. |
| VFX | Generic accepted-result VFX is sufficient and downstream of mechanics. Bespoke choreography is out of scope. |

## Non-negotiable invariants

- `resolveMove` remains the authoritative atomic boundary for immediate moves.
- A duplicate `opId` never rerolls, spends again, reopens a prompt, or applies an effect twice.
- Every authoritative sheet or map value consulted by a resolution is revision-validated before commit.
- A client cannot submit rolls, damage, scripts, effect operations, legal targets, or final state.
- Randomness is injected, bounded, and recorded in a structured resolution ledger.
- Every effect operation has an explicit source, recipients, timing phase, and reason code.
- Pending choices survive refresh/reconnect and are visible only to eligible participants and authorized GMs.
- A rejected or stale command applies no partial map, sheet, inventory, history, usage, or lifecycle mutation.
- `complete` means no untracked manual rule clause remains for the move's canonical text.
- Every catalog move appears exactly once in the semantic manifest; every baseline-registered move appears exactly once in Phase 8B, and every baseline-missing move appears exactly once in Phase 9.

## Shared definition of done for a completed move

A move may be marked `complete` only when:

- every legal target branch and rules-text branch is encoded;
- target eligibility and any ally/enemy/willing restrictions are server-checked;
- all rolls are server-owned and appear in the structured trace;
- all durable mutations commit atomically or through an explicit durable pending-resolution state;
- choices and reactions are typed, authorized, reconnect-safe, and idempotent;
- the move has no structured `manualSteps` or unresolved capability blocker;
- golden scenarios cover hit, miss, critical hit, immunity, alternate branch, and choice paths when applicable;
- retry, duplicate delivery, and stale-resource behavior are covered when the move touches more than one resource or opens a pending resolution;
- the manifest stores rules provenance, spec version/hash, capability tags, and scenario IDs;
- generic VFX can derive its presentation from the accepted result without affecting mechanics.

## Phase map

| Phase | Tickets | Outcome |
|---|---|---|
| 0 | MA-001–MA-008 | Correct the current authoritative boundary before adding breadth. |
| 1 | MA-010–MA-023 | Establish truthful inventory, provenance, and green validation. |
| 2 | MA-030–MA-045 | Introduce MoveSpec v2, typed operations, traces, and v1 compatibility. |
| 3 | MA-050–MA-064 | Add encounter state, allegiance, lifecycle, and resource ledgers. |
| 4 | MA-070–MA-095 | Build targeting, numeric, HP, stage, and condition kernels. |
| 5 | MA-100–MA-117 | Make choices, reactions, interruptions, and GM corrections durable. |
| 6 | MA-120–MA-146 | Unify movement, zones, hazards, weather, terrain, and rooms. |
| 7 | MA-150–MA-166 | Add item, inventory, move-history, nested-move, type, form, and ability operations. |
| 8 | MA-170–MA-181 | Prove the architecture with difficult vertical slices and repair registered partials. |
| 8B | REG-001–REG-033 | Certify all 258 baseline-registered moves in commit-sized batches. |
| 9 | MA-200–MA-272 | Implement every currently missing move in bounded cohorts. |
| 10 | MA-280–MA-299 | Recovery, observability, migration, documentation, and final closure. |

---

## Phase 0 — Correct the current authoritative boundary

## MA-001 — Make target identity a real wire field

Status: DONE

**Depends on:** nothing
**Commit:** `fix(move-automation): preserve attacked and hit target ids`

**Touch:** `src/types/moveAutomation.ts`, `src/utils/moveAutomationTransaction.ts`, `server/domain/resolveAuthoritativeMove.ts`, `server/domain/planAuthoritativeMoveState.ts`.

**Implement:**

- Make `attackedTargetIds` and `hitTargetIds` required enumerable arrays on every `MoveAutomationTransaction`.
- Remove descriptor-copy helpers and `Object.defineProperties` usage for those fields.
- Ensure unknown/no-target transactions emit empty arrays.
- Keep attacked targets distinct from targets that passed the accuracy check.

**Tests:** Extend `tests/utils/moveAutomationTransaction.test.ts`, `tests/server/resolveAuthoritativeMove.test.ts`, and `tests/server/planAuthoritativeMoveState.test.ts` with hit, miss, immunity, area, and no-target cases.

**Done:** `structuredClone`, JSON round-trip, planner cloning, and resolver cloning preserve both arrays exactly.

## MA-002 — Assert target identity through the accepted command response

Status: DONE

**Depends on:** MA-001
**Commit:** `test(move-automation): cover target ids across resolve move boundary`

**Touch:** `server/useCases/applyResolveMoveCommand.ts`, `shared/livePlayMoveResolution.ts`, `tests/server/livePlayResolveMoveCommands.test.ts`, `tests/server/resolveMoveRoute.test.ts`.

**Implement:** Add end-to-end assertions from request through stored operation result and HTTP response. Cover mixed area hit/miss and duplicate `opId` replay.

**Done:** The original response, stored operation result, duplicate response, and accepted realtime payload contain identical attacked/hit IDs.

## MA-003 — Record every sheet read by authoritative resolution

Status: DONE

**Depends on:** MA-001
**Commit:** `feat(move-automation): track authoritative sheet read set`

**Touch:** `server/domain/resolveAuthoritativeMove.ts`, `server/useCases/resolveMoveCommandScopes.ts`, `server/domain/planAuthoritativeMoveState.ts`.

**Implement:**

- Add a `sheetReads` collection containing kind, slug, and revision to the resolution context/plan.
- Record actor, every selected or area candidate target consulted, and indirect providers such as aura/immunity sources.
- Deduplicate by sheet reference and reject conflicting observed revisions.
- Do not change persistence checks yet.

**Tests:** Prove misses, no-op effects, immune targets, and indirect providers still enter the read set.

**Done:** A plan describes the complete resource snapshot used to make its decision, not only the resources it will write.

## MA-004 — Validate the full sheet read set inside commit

Status: DONE

**Depends on:** MA-003
**Commit:** `fix(move-automation): validate all consulted sheet revisions`

**Touch:** `server/useCases/applyResolveMoveCommand.ts`, `server/storage/sheetRepository.ts`, relevant repository tests.

**Implement:** Add a repository revision assertion that runs inside the same SQLite transaction before map or sheet writes. Validate every `sheetReads` entry, then apply the existing write plans. Avoid no-op writes merely to obtain CAS protection.

**Tests:** Race a change to a missed target, an immune target, and an aura provider between planning and commit. All must return a clean conflict with no map/sheet/op-result/realtime mutation.

**Done:** No accepted resolution can commit against a stale sheet value it consulted.

## MA-005 — Publish accepted move presentation from durable results

Status: DONE

**Depends on:** MA-002
**Commit:** `fix(move-automation): drive move presentation from accepted results`

**Touch:** `server/useCases/applyResolveMoveCommand.ts`, realtime append helpers, `src/composables/map-editor/` move-resolution consumers, move VFX tests.

**Implement:** Put the bounded move presentation summary—actor, move, attacked/hit IDs, area/pass geometry, outcome kind, and operation ID—in the durable accepted result/realtime event. Treat transient map-action events only as optional low-latency hints.

**Tests:** A second client that never saw the transient event still presents the accepted move once; duplicate HTTP/SSE/status terminals do not replay presentation twice.

**Done:** Accepted state is sufficient for deterministic remote presentation after reconnect or cross-process delivery.

## MA-006 — Add a server-owned relationship query seam

Status: DONE

**Depends on:** MA-004
**Commit:** `refactor(move-automation): centralize target relationship queries`

**Touch:** new `server/domain/moveAutomation/relationships.ts`, `server/domain/resolveAuthoritativeMove.ts`, `src/utils/moveAutomationConditionImmunity.ts`.

**Implement:** Introduce `sameSide`, `ally`, `enemy`, and `self` query functions whose input includes explicit side data when present. Until MA-052 lands, `ally` must fail closed when allegiance is unknown; callers may not pass all tokens as allies.

**Tests:** Unknown side, same token, same side, different side, and GM-controlled-token cases.

**Done:** Sweet Veil and future ally-only mechanics no longer infer allegiance from token ownership or token presence.

## MA-007 — Contain current client-local reaction claims

Status: DONE

**Depends on:** MA-002
**Commit:** `fix(move-automation): mark local reaction flows assisted`

**Touch:** existing registry scripts, automation notes, prompt UI, and prompt tests.

**Implement:** Identify Spite, Cute Charm, Poison Point, Moxie, Celebrate, attack-of-opportunity, and any other local post-commit prompt. Ensure UI copy says the prompt is an assisted follow-up and never implies it can interrupt or survive reconnect. Do not build the durable reaction engine here.

**Done:** Current behavior remains usable, but UX/notes do not call these flows complete. MA-013 will seed all registered moves as assisted before semantic audits begin.

## MA-008 — Add a pre-scale authoritative regression suite

Status: DONE

**Depends on:** MA-004, MA-005, MA-006
**Commit:** `test(move-automation): lock authoritative resolution invariants`

**Touch:** new `tests/server/authoritativeMoveInvariants.test.ts` plus existing resolve/planner tests.

**Implement:** Add compact invariant tests for server RNG ownership, forbidden client fields, complete read-set validation, atomic failure, duplicate replay, target identity, and accepted-result presentation.

**Done:** These invariants can be run with one test file before every later mechanics ticket.

---

## Phase 1 — Truthful inventory, provenance, and validation

## MA-010 — Record the move-runtime decisions in an ADR

Status: DONE

**Depends on:** MA-008
**Commit:** `docs(move-automation): record runtime architecture decision`

**Touch:** new `docs/adrs/010-move-automation-runtime.md`, `docs/README.md`.

**Implement:** Record the locked decisions above, the definition of `complete`, state ownership, server authority, MoveSpec/handler split, reaction saga, ruleset boundary, VFX exclusion, and rejected alternatives such as runtime prose parsing or browser macros.

**Done:** A reviewer can decide whether a future design conforms without consulting this backlog.

## MA-011 — Freeze canonical move identity and rules provenance

Status: DONE

**Depends on:** MA-010
**Commit:** `feat(move-automation): define canonical rules provenance`

**Touch:** new `data/move-automation/ruleset.json`, new `shared/moveAutomation/ruleset.ts`, canonical loader tests.

**Implement:** Treat `data/reference/moves.json` as the repository's immediate rules-data authority and store its ruleset ID, source-data SHA-256, canonicalization version, excluded parser-junk policy, and the policy for Struggle variants and homebrew namespaces. Record a supplement or errata source only when it has been verified; do not invent provenance. Make the loader reject a catalog hash change until the provenance record is intentionally updated.

**Done:** “776” refers to a reproducible source and normalization policy.

## MA-012 — Define the semantic manifest schema

Status: DONE

**Depends on:** MA-011
**Commit:** `feat(move-automation): add semantic manifest contract`

**Touch:** new `shared/moveAutomation/manifest.ts`, new `data/move-automation/manifest.json`, schema tests.

**Implement:** Define one record per canonical move with:

- canonical ID and display name;
- `baseStatus: complete | assisted | blocked` and a separate `interactionStatus: unassessed | partial | complete`;
- runtime/version/spec hash;
- rules provenance reference;
- mechanic capability tags;
- blocker codes;
- structured limitations/manual steps;
- scenario IDs and reviewed-at metadata;
- explicit unsupported interaction IDs for ability/item/feature combinations outside base-move completeness;
- rollout cohort ID.

Use a strict parser that rejects unknown fields, duplicates, unknown moves, invalid status combinations, and unbounded strings/arrays.

**Done:** A `complete` record cannot contain blockers, limitations, or manual steps and must reference at least one scenario.

## MA-013 — Seed all 776 manifest rows without inflating completion

Status: DONE

**Depends on:** MA-012
**Commit:** `data(move-automation): seed canonical semantic manifest`

**Touch:** `data/move-automation/manifest.json`, a deterministic seed/update script under `scripts/`.

**Implement:** Create exactly 776 sorted rows. Start every unregistered move as `blocked` and every registered move as `assisted`; Phase 1 audits classify blockers but do not promote rows. Copy heuristic worklist categories only into non-authoritative suggested tags.

**Tests:** Byte-stable generation, exact membership, no duplicate canonical IDs, and no accidental status changes when rerun.

**Done:** The repository has a truthful complete inventory even though almost all rows are initially non-complete.

## MA-014 — Split manifest validity from final completeness

Status: DONE

**Depends on:** MA-013
**Commit:** `feat(move-automation): split validation and completion checks`

**Touch:** `scripts/move_automation_coverage.py`, `scripts/check_move_automation_coverage.py`, `package.json`, checker tests.

**Implement:**

- `npm run check:move-automation` validates catalog, manifest, registry/spec references, scenario references, hashes, and invariants; it passes for an honest incomplete manifest.
- `npm run check:move-automation-complete` additionally requires 776 complete and is not enabled in the quality gate yet.
- Add deterministic `--json` and human `--report` output.

**Done:** Invalid metadata always fails; honest incompleteness remains green until closure.

## MA-015 — Replace count-pinning with semantic assertions

Status: DONE

**Depends on:** MA-014
**Commit:** `test(move-automation): assert semantic coverage instead of fixed counts`

**Touch:** `tests/utils/moveAutomationExplicitScripts.test.ts`, `tests/utils/moveAutomationWorklistReport.test.ts`.

**Implement:** Remove the brittle expectation that registered count stays 258. Assert canonical integrity, registry/manifest agreement, no unknown scripts, truthful statuses, and representative move behavior. Keep report totals asserted from parsed manifest output rather than duplicated constants.

**Done:** Adding a reviewed move does not require editing an arbitrary preserved-count test, while accidental deletion or status inflation still fails.

## MA-016 — Put non-strict validation in the quality gate

Status: DONE

**Depends on:** MA-014
**Commit:** `ci(move-automation): validate manifest in quality gate`

**Touch:** `scripts/quality-gate.sh`, `package.json`, `CONTRIBUTING.md`.

**Implement:** Run non-strict manifest/scenario validation before typecheck/tests/build. Document the strict command without enabling it.

**Done:** The current incomplete branch passes; removing a row, using an unknown capability, or referencing a missing scenario fails.

## MA-017 — Add structured capability definitions

Status: DONE

**Depends on:** MA-012
**Commit:** `feat(move-automation): define capability catalog`

**Touch:** new `data/move-automation/capabilities.json`, new parser under `shared/moveAutomation/`, validator tests.

**Implement:** Give every capability a stable code, owning phase, dependencies, implementation status, and representative move. Seed capabilities for targeting, expressions, HP, stages, conditions, lifecycle, reactions, movement, fields, hazards, items, history, nested moves, and transformations.

**Done:** Manifest blocker codes resolve to a typed capability rather than free-form prose.

## MA-018 — Generate legacy-script audit metadata

Status: DONE

**Depends on:** MA-013, MA-017
**Commit:** `feat(move-automation): generate legacy audit metadata`

**Touch:** new audit helper under `scripts/`, registry readers, report tests.

**Implement:** Deterministically extract canonical ID, source module, v1 version, script shape, target mode, suggestion kinds, automation notes, and inferred non-authoritative capability hints for all 258 entries. Emit JSON/report output; do not decide semantic completion.

**Done:** The Phase 8B reviewer can see the implementation and likely gaps for any registered move without searching the whole registry.

## MA-019 — Fingerprint and link every legacy implementation

Status: DONE

**Depends on:** MA-018
**Commit:** `data(move-automation): link legacy implementation fingerprints`

**Touch:** definition-hash helper, manifest generator/data, tests.

**Implement:** Populate each registered row with `legacy-v1`, source module, version, and deterministic definition hash while keeping it assisted. Fail if two canonical rows resolve to one accidental implementation or a source/hash drifts without a manifest update.

**Done:** All 258 current implementations are attributable before human conformance review.

## MA-020 — Define scenario evidence requirements

Status: DONE

**Depends on:** MA-012, MA-017
**Commit:** `feat(move-automation): define conformance evidence rules`

**Touch:** new `data/move-automation/scenario-requirements.json`, manifest validator, tests.

**Implement:** Map mechanic/branch tags to required evidence classes such as hit, miss, crit, immunity, threshold pass/fail, self/ally/enemy, area mixed outcomes, lifecycle trigger/cleanup, choice/pass, retry, reconnect, and multi-resource conflict. Allow explicit reviewed not-applicable reasons.

**Done:** Phase 8B and Phase 9 tickets know exactly which scenario classes a row must supply before `complete` is legal.

## MA-021 — Record the known registered manual-debt set

Status: DONE

**Depends on:** MA-018–MA-020
**Commit:** `data(move-automation): record known registered blockers`

**Touch:** manifest and audit-report tests.

**Implement:** Assign precise blockers/manual remainder to the known partials, including Astonish/Fake Out timing, Fury Cutter chaining, five-strike semantics, Knock Off inventory, Sand Tomb lifecycle, Tackle displacement, Take Down's opposed maneuver/caveats, U-Turn switching, Yawn delay, Reflect side state, and ally-area allegiance. Retain the generic audit-required limitation on all other registered rows until their REG ticket.

**Done:** Known gaps are explicit, and no registered row is promoted during bootstrap.

## MA-022 — Expose semantic status in move selection

Status: DONE

**Depends on:** MA-014
**Commit:** `feat(move-automation): show complete assisted and blocked states`

**Touch:** `src/utils/mapTokenMoves.ts`, `src/components/isometric/TokenContextMenu.vue`, move panel composables/components, UI tests.

**Implement:**

- base `complete`: normal automation affordance, with interaction status shown separately;
- base `assisted`: clearly labeled partial automation with structured limitations visible before use;
- base `blocked`: disabled, with capability blocker summary.

The server independently validates runtime eligibility; the client cannot promote a status.

**Done:** Players cannot confuse registry presence with complete automation.

## MA-023 — Generate stable progress and blocker reports

Status: DONE

**Depends on:** MA-014, MA-017
**Commit:** `feat(move-automation): generate semantic progress reports`

**Touch:** coverage/worklist scripts and report tests.

**Implement:** Generate deterministic Markdown and JSON grouped by semantic status, capability blocker, cohort, and missing test evidence. Keep heuristic prose classification informational only.

**Done:** Project planning no longer depends on regex buckets or hand-copied totals.

---

## Phase 2 — MoveSpec v2, typed operations, and compatibility

## MA-030 — Define MoveSpec v2 and phase names

Status: DONE

**Depends on:** MA-010, MA-017
**Commit:** `feat(move-automation): define movespec v2 contract`

**Touch:** new `shared/moveAutomation/spec.ts`, contract tests.

**Implement:** Define immutable versioned specs with canonical ID, targeting declaration, preconditions, cost declarations, ordered phase blocks, effect operations, optional registered handler ID, and presentation metadata. Start with phases `declare`, `precondition`, `pay`, `target`, `pre-hit`, `accuracy`, `hit`, `miss`, `damage`, `after-damage`, `ko`, `movement`, `schedule`, `usage`, and `cleanup`.

**Done:** Specs are plain JSON data and cannot embed callbacks or executable client data.

## MA-031 — Define the bounded effect-operation union

Status: DONE

**Depends on:** MA-030
**Commit:** `feat(move-automation): define typed effect operations`

**Touch:** new `shared/moveAutomation/effects.ts`, parser tests.

**Implement:** Seed operations for roll, damage, direct HP, heal, condition, combat stage, temporary effect, field, hazard, movement request, usage, history, log, and choice/reaction request. Each operation carries an ID, source reference, recipients selector, phase, reason code, and bounded payload.

**Done:** Unknown operations/fields reject; no operation can carry arbitrary state patches.

## MA-032 — Define expressions, selectors, and predicates

Status: TODO

**Depends on:** MA-030
**Commit:** `feat(move-automation): define rules expression language`

**Touch:** new `shared/moveAutomation/expressions.ts`, `selectors.ts`, `predicates.ts`, parser tests.

**Implement:** Add a small tagged AST for constants, arithmetic, min/max/clamp, lookup tables, selected stats, HP ratios, combat stages, weight, type, weather/terrain, move history, and boolean comparison/composition. No source strings, `eval`, regex execution, or unbounded recursion.

**Done:** Parser enforces node count, depth, string length, and list-size limits.

## MA-033 — Validate, normalize, and hash specs

Status: TODO

**Depends on:** MA-030–MA-032
**Commit:** `feat(move-automation): validate and hash movespecs`

**Touch:** new `server/domain/moveAutomation/validateSpec.ts`, stable serialization utility, tests.

**Implement:** Normalize defaults and ordering, validate referenced phase/op/capability IDs, enforce complexity bounds, and calculate a SHA-256 over canonical JSON plus ruleset version.

**Done:** Semantically identical specs hash identically; a behavior-affecting change changes the hash.

## MA-034 — Add a dual-runtime registry

Status: TODO

**Depends on:** MA-033
**Commit:** `feat(move-automation): register v1 scripts and v2 specs`

**Touch:** `src/utils/move-automation/registry.ts`, new server registry under `server/domain/moveAutomation/`, manifest validator.

**Implement:** Resolve canonical move ID to v1 adapter or v2 spec according to the manifest. Reject duplicate IDs, version/hash mismatch, client-selected runtime, and missing reviewed registration.

**Done:** Existing 258 scripts still resolve unchanged; a test-only v2 spec can be selected only by server metadata.

## MA-035 — Build the immutable authoritative rules context

Status: TODO

**Depends on:** MA-034, MA-004
**Commit:** `refactor(move-automation): centralize authoritative rules context`

**Touch:** new `server/domain/moveAutomation/context.ts`, `server/domain/resolveAuthoritativeMove.ts`.

**Implement:** Build a read-only context with map snapshot, actor, candidate/selected placements, resolved sheets and revisions, ruleset, injected RNG, time, and query interfaces. Remove mechanics helpers that reach into mutable globals or browser state.

**Done:** Pure resolution consumes one explicit immutable context and produces a plan plus read set.

## MA-036 — Add deterministic RNG and a roll ledger

Status: TODO

**Depends on:** MA-035
**Commit:** `feat(move-automation): record deterministic roll ledger`

**Touch:** new `server/domain/moveAutomation/random.ts`, resolution result contracts, tests.

**Implement:** Give every random request a stable roll ID, formula/table, reason, natural result, modifiers, final value, and parent effect ID. Inject a finite RNG stream in tests and reject missing or excess draws.

**Done:** Retry reuses the stored result; replaying a spec with the same snapshot and seeded draws yields the same ledger.

## MA-037 — Add a structured effect and decision trace

Status: TODO

**Depends on:** MA-031, MA-036
**Commit:** `feat(move-automation): emit structured resolution trace`

**Touch:** new trace contracts/reducers, accepted-result types, tests.

**Implement:** Record phase transitions, predicate outcomes, target inclusion/exclusion reasons, rolls, operation inputs/results, prevented effects, choices, child-move ancestry, and spec/ruleset hashes. Bound and sanitize the wire summary while retaining a server audit form.

**Done:** Logs can be rendered from trace data; prose logs are no longer the only audit evidence.

## MA-038 — Implement the phased interpreter skeleton

Status: TODO

**Depends on:** MA-033, MA-035–MA-037
**Commit:** `feat(move-automation): execute phased movespec plans`

**Touch:** new `server/domain/moveAutomation/executeSpec.ts`, tests.

**Implement:** Walk phases deterministically, evaluate predicates/selectors, emit operations and trace entries, and stop with a typed pending-request result when an unresolved durable choice is encountered. Do not mutate map/sheets here.

**Done:** A minimal no-damage test spec can declare, target, log, and finish; an invalid operation fails before persistence.

## MA-039 — Introduce typed state-change plans

Status: TODO

**Depends on:** MA-031, MA-038
**Commit:** `feat(move-automation): model typed state change plans`

**Touch:** new `server/domain/moveAutomation/plan.ts`, `server/domain/planAuthoritativeMoveState.ts`.

**Implement:** Replace the flat transaction as the v2 internal representation with ordered typed changes grouped by map, encounter, placement, sheet, and external resource scope. Include expected revisions and inverse/compensation metadata where safe.

**Done:** The planner can represent no-op, map-only, sheet-only, and multi-sheet plans without arbitrary JSON patches.

## MA-040 — Reduce HP, condition, and stage operations

Status: TODO

**Depends on:** MA-039
**Commit:** `feat(move-automation): reduce core token effect operations`

**Touch:** new reducers under `server/domain/moveAutomation/reducers/`, planner tests.

**Implement:** Convert v2 HP, temporary-HP, injury, condition, and combat-stage operations into existing map/sheet accumulators. Preserve caps, immunity outcomes, reason codes, and no-op traces.

**Done:** Reducers are pure, order-stable, and cannot target a placement outside the resolved selector set.

## MA-041 — Reduce map, usage, and log operations

Status: TODO

**Depends on:** MA-039
**Commit:** `feat(move-automation): reduce map and usage operations`

**Touch:** map reducers, `planMoveUsageTransition.ts`, move-log helpers.

**Implement:** Support field/hazard placeholders, usage changes, accepted-result presentation summary, and structured log projection. Detailed field/hazard semantics arrive later.

**Done:** A v2 immediate move yields one map revision and the same atomic persistence envelope as v1.

## MA-042 — Adapt v1 transactions into typed plans

Status: TODO

**Depends on:** MA-039–MA-041
**Commit:** `refactor(move-automation): adapt v1 scripts into v2 plans`

**Touch:** new `server/domain/moveAutomation/adaptV1Transaction.ts`, resolver/planner orchestration, differential tests.

**Implement:** Convert the existing flat `MoveAutomationTransaction` into v2 typed changes and trace entries after current v1 resolution. Do not reinterpret automation notes or prose.

**Done:** All existing registered scripts pass unchanged through the new planner representation.

## MA-043 — Differential-test v1 planning

Status: TODO

**Depends on:** MA-042
**Commit:** `test(move-automation): compare legacy and typed plans`

**Touch:** new fixture helper and representative v1 scenarios.

**Implement:** Run legacy and adapted planning against cloned snapshots and normalize expected timestamp/ID differences. Cover self, single target, area, pass, miss, immunity, direct HP, field, hazard, and usage.

**Done:** The compatibility layer proves parity before v2 specs begin replacing v1 scripts.

## MA-044 — Execute the first simple move as native v2

Status: TODO

**Depends on:** MA-038–MA-043
**Commit:** `feat(move-automation): run scratch through movespec v2`

**Touch:** new reviewed spec file, registry/manifest, scenario fixture.

**Implement:** Port `Scratch` without changing its canonical behavior. Shadow-plan v1 and v2 in tests, then select v2 by manifest entry.

**Done:** Scratch resolves end to end through native v2; rollback is a one-row runtime selection change.

## MA-045 — Add a registered-handler escape hatch

Status: TODO

**Depends on:** MA-038
**Commit:** `feat(move-automation): add bounded registered move handlers`

**Touch:** new `server/domain/moveAutomation/handlers/registry.ts`, validator, tests.

**Implement:** Allow a spec to reference a server-registered pure handler ID for calculations that cannot reasonably fit the expression AST. Handlers receive the immutable context and emit only typed operations/trace entries. They cannot access repositories, clocks, network, or ambient randomness.

**Done:** Unknown handlers reject, handler versions affect the spec hash, and a handler cannot bypass operation bounds.

---

## Phase 3 — Encounter state, allegiance, lifecycle, and resources

## MA-050 — Add the versioned encounter-state envelope

Status: TODO

**Depends on:** MA-039
**Commit:** `feat(move-automation): add map encounter state`

**Touch:** `src/types/map.ts`, new `shared/moveAutomation/encounterState.ts`, map serialization tests.

**Implement:** Add optional `encounterState` with an explicit schema version and empty containers for sides, effects, counters, history, turn resources, zones, and pending-resolution summaries. Do not move existing hazards, fields, temporary HP, or move usage yet.

**Done:** New maps can store a bounded canonical empty encounter state without changing current gameplay.

## MA-051 — Normalize legacy maps at read boundaries

Status: TODO

**Depends on:** MA-050
**Commit:** `feat(move-automation): normalize encounter state defaults`

**Touch:** `server/utils/mapNormalization.ts`, map repository/load tests.

**Implement:** Accept maps with no encounter state and normalize in memory to the current empty version. Reject unsupported future versions and malformed bounded fields. Loading alone must not persist or increment a revision.

**Done:** Old maps open unchanged; the next accepted write emits canonical state.

## MA-052 — Add explicit side identity to placements

Status: TODO

**Depends on:** MA-051
**Commit:** `feat(move-automation): model explicit encounter sides`

**Touch:** placement/map types and normalizers, spawn/send-out use cases, fixture builders.

**Implement:**

- Add optional `sideId` to placements and a typed side directory under encounter state.
- Define stable side ID, display label, color/presentation hint, and active/inactive status.
- Preserve unknown side on legacy maps; do not infer it from GM/player or sheet kind.
- Propagate side through spawn, send-out, recall, and placement cloning.

**Done:** Server state can represent allied GM-controlled and opposing player-controlled tokens correctly.

## MA-053 — Add setup controls for sides

Status: TODO

**Depends on:** MA-052
**Commit:** `feat(move-automation): edit encounter sides in map setup`

**Touch:** map setup token controls, placement editor types/composables, component tests.

**Implement:** Let an authorized GM create/rename/archive sides and assign selected placements in Prepare Map. Use revision-checked setup saves; live players cannot mutate side assignments.

**Done:** A GM can prepare a two-or-more-side encounter without editing JSON.

## MA-054 — Make relationship queries authoritative

Status: TODO

**Depends on:** MA-052, MA-006
**Commit:** `feat(move-automation): resolve ally and enemy from sides`

**Touch:** `server/domain/moveAutomation/relationships.ts`, authoritative context builder, query tests.

**Implement:** Resolve `self`, `ally`, `enemy`, `same-side`, `other`, and `unknown` solely from placement IDs and explicit side state. Add a policy flag for moves that allow unknown/unaffiliated targets; default ally/enemy predicates fail closed.

**Done:** All server mechanics use the same relationship result and reason code.

## MA-055 — Fix side-sensitive immunity and ally-area behavior

Status: TODO

**Depends on:** MA-054
**Commit:** `fix(move-automation): enforce allegiance for ally mechanics`

**Touch:** `src/utils/moveAutomationConditionImmunity.ts`, `server/domain/resolveAuthoritativeMove.ts`, current area scripts, tests.

**Implement:** Filter Sweet Veil providers to eligible allies in range. Route current ally-area suggestions such as Howl, Aromatic Mist, and Coaching through side predicates. Unknown side produces a clear blocked/assisted result rather than applying to everyone.

**Done:** Enemy auras and enemy tokens never grant or receive ally-only effects.

## MA-056 — Define typed encounter effect instances

Status: TODO

**Depends on:** MA-050, MA-031
**Commit:** `feat(move-automation): model typed encounter effects`

**Touch:** `shared/moveAutomation/encounterState.ts`, parser/reducer tests.

**Implement:** Define an effect instance with stable ID, kind, source operation/move/placement, affected placement/side/cells, created turn/round, duration, stacks, charges, tags, typed payload, and dispel/suppression metadata. Enforce payload unions per kind.

**Done:** No temporary rule effect needs a free-form string or opaque metadata object.

## MA-057 — Define duration, expiry, stack, and charge policies

Status: TODO

**Depends on:** MA-056
**Commit:** `feat(move-automation): define effect lifecycle policies`

**Touch:** new `server/domain/moveAutomation/effectLifecycle.ts`, tests.

**Implement:** Support start/end of source or target turn, round boundary, scene end, fixed turn/round count, until-triggered, and permanent-until-removed. Define replace, refresh, add-stack, max-stack, independent-instance, and charge-consumption policies.

**Done:** Every lifecycle transition is deterministic from encounter state plus an authoritative event.

## MA-058 — Add typed condition effect compatibility

Status: TODO

**Depends on:** MA-056, MA-040
**Commit:** `refactor(move-automation): bridge sheet conditions to typed effects`

**Touch:** condition reducers, sheet condition helpers, encounter-state adapters, tests.

**Implement:** Keep persistent canonical conditions sheet-owned, but represent source-linked, timed, stacked, or delayed condition modifiers as encounter effects. Add one query that projects effective conditions from both layers without duplicating them.

**Done:** Existing string conditions keep working while new rules can retain source, timing, and payload.

## MA-059 — Define authoritative encounter events

Status: TODO

**Depends on:** MA-057
**Commit:** `feat(move-automation): define encounter lifecycle events`

**Touch:** new `shared/moveAutomation/events.ts`, strict parser tests.

**Implement:** Define bounded internal events for scene start/end, round start/end, turn start/end, move declared/hit/damaged/KO/completed, placement entering/leaving/moving, switch/recall/send-out, effect added/removed, and resource spent/restored. Events are server-internal facts, not client-authored commands.

**Done:** Event schemas identify source operation and causal parent and cannot contain arbitrary patches.

## MA-060 — Implement the pure lifecycle reducer

Status: TODO

**Depends on:** MA-057–MA-059
**Commit:** `feat(move-automation): reduce encounter lifecycle events`

**Touch:** new `server/domain/moveAutomation/reduceLifecycle.ts`, tests.

**Implement:** Given state plus one ordered event list, expire effects, consume charges, update counters, enqueue triggered typed operations, and append trace entries. Apply recursion and emitted-event limits.

**Done:** The reducer is deterministic, pure, bounded, and order-explicit.

## MA-061 — Integrate lifecycle with initiative transitions

Status: TODO

**Depends on:** MA-060
**Commit:** `feat(move-automation): process lifecycle on initiative advance`

**Touch:** `server/useCases/applyLivePlayInitiativeCommand.ts`, initiative planner/helpers, tests.

**Implement:** Emit end-turn, round-boundary, and start-turn events in the same atomic initiative command. Apply resulting map/sheet changes before commit. Manual initiative order still wins; calculated-order modifiers are queried separately.

**Done:** Advancing initiative cannot leave expired effects or due damage/healing for a manual follow-up.

## MA-062 — Integrate scene start/end cleanup

Status: TODO

**Depends on:** MA-060
**Commit:** `feat(move-automation): process encounter state at scene boundaries`

**Touch:** live-play scene use case, move-usage/temp-HP helpers, tests.

**Implement:** Emit scene events, expire scene effects, reset scene counters/resources, and reconcile existing move usage and temporary HP according to current rules. Keep the operation atomic.

**Done:** Ending a scene leaves no orphan pending effect, counter, or response window.

## MA-063 — Add bounded encounter history indexes

Status: TODO

**Depends on:** MA-050, MA-059
**Commit:** `feat(move-automation): record move and damage history`

**Touch:** encounter-state types, lifecycle reducer, history query tests.

**Implement:** Record the minimum structured history needed by mechanics: last declared/completed move per placement, last damaging move received, damage by source since turn/round, whether a placement acted, consecutive move counters, switch/KO history, and parent/child move IDs. Bound history by scene/round windows.

**Done:** History-dependent moves query structured records instead of parsing logs.

## MA-064 — Add turn/action/movement resource ledgers

Status: TODO

**Depends on:** MA-050, MA-060
**Commit:** `feat(move-automation): track encounter action resources`

**Touch:** encounter-state types, resource reducer/query, initiative and move planners, tests.

**Implement:** Model action types, reaction availability, movement budget/spend, once-per-turn flags, setup/execute state, and reset timing. Initially observe current moves without enforcing every cost; enforcement arrives per capability.

**Done:** Move preconditions and costs can refer to authoritative resources rather than operator memory.

---

## Phase 4 — Targeting, numeric, HP, stage, and condition kernels

## MA-070 — Evaluate relationship and identity target predicates

Status: TODO

**Depends on:** MA-032, MA-054
**Commit:** `feat(move-automation): evaluate relationship target predicates`

**Touch:** new `server/domain/moveAutomation/predicates/target.ts`, tests.

**Implement:** Support self/other/ally/enemy/same-side/any, willing/unwilling declaration, distinct targets, and actor exclusion. Emit inclusion/exclusion reason codes.

**Done:** The server derives legal relationship sets; client target IDs are only requested candidates.

## MA-071 — Evaluate target state, type, size, and weight predicates

Status: TODO

**Depends on:** MA-070, MA-035
**Commit:** `feat(move-automation): evaluate target state predicates`

**Touch:** target predicate/query modules, tests.

**Implement:** Add conscious/fainted, grounded/airborne, switched/acted/damaged, condition, type, immunity tag, size, weight class, sheet kind, and required-item predicates.

**Done:** Illegal targets reject before rolls or costs unless canonical rules explicitly pay on declaration.

## MA-072 — Add server line-of-sight and cover queries

Status: TODO

**Depends on:** MA-035
**Commit:** `feat(move-automation): resolve authoritative line of sight`

**Touch:** new pure geometry query using map voxels/placements, targeting tests.

**Implement:** Compute origin/footprint visibility, blocking voxels/tokens according to the chosen rules, and cover modifiers. Reuse existing rendering geometry only through shared pure helpers; never trust a client LOS flag.

**Done:** Target legality and accuracy modifiers use one tested server result.

## MA-073 — Apply relation/state filters to area templates

Status: TODO

**Depends on:** MA-070–MA-072, existing area geometry
**Commit:** `feat(move-automation): filter authoritative area targets`

**Touch:** authoritative area resolver and tests.

**Implement:** Generate geometrically affected placements first, then apply spec predicates per target. Record excluded tokens and reasons without revealing hidden tokens to unauthorized clients.

**Done:** Bursts, cones, lines, blasts, pass, and cardinal adjacency can express allies-only, enemies-only, and all-target effects.

## MA-074 — Implement the bounded numeric expression evaluator

Status: TODO

**Depends on:** MA-032, MA-035
**Commit:** `feat(move-automation): evaluate bounded rules expressions`

**Touch:** new `server/domain/moveAutomation/evaluateExpression.ts`, property tests.

**Implement:** Evaluate arithmetic, clamp, tables, selectors, ratios, comparisons, and conditional branches with integer/rounding policy. Reject non-finite values, divide-by-zero, overflow, excessive depth, and missing selectors.

**Done:** Results are deterministic and every intermediate value can be traced by expression node ID.

## MA-075 — Add stat and defense selectors

Status: TODO

**Depends on:** MA-074
**Commit:** `feat(move-automation): select alternate attack and defense stats`

**Touch:** expression/query modules, damage resolver tests.

**Implement:** Select user/target Attack, Special Attack, Defense, Special Defense, Speed, level, positive/negative stage totals, and alternate-stat comparisons. Encode which stages/modifiers are honored or ignored.

**Done:** Body Press, Foul Play, Psyshock/Psystrike/Secret Sword, and stage-scaling moves have the required primitives.

## MA-076 — Generalize dynamic damage-base expressions

Status: TODO

**Depends on:** MA-074–MA-075
**Commit:** `feat(move-automation): calculate contextual damage bases`

**Touch:** damage resolver, spec operations, tests.

**Implement:** Replace the closed three-rule dynamic DB union for v2 with a bounded expression result plus min/max and STAB timing. Support HP ratio, speed ratio, weight class, status/history, consecutive use, positive stages, and lookup tables.

**Done:** Dynamic DB is calculated per target when rules require it and appears in the trace.

## MA-077 — Add ordered attack and damage modifier phases

Status: TODO

**Depends on:** MA-076
**Commit:** `feat(move-automation): order attack and damage modifiers`

**Touch:** damage pipeline and tests.

**Implement:** Define explicit stages for base DB, attack stat, defense stat, pre-type modifiers, type effectiveness, critical modifiers, post-damage modifiers, minimum damage, and final HP loss. Give every modifier priority, source, stacking group, and trace reason.

**Done:** Modifier ordering is centralized and stable rather than distributed among helpers.

## MA-078 — Add type, immunity, and critical-hit overrides

Status: TODO

**Depends on:** MA-077
**Commit:** `feat(move-automation): support type and critical overrides`

**Touch:** damage/type/crit queries and tests.

**Implement:** Support move-type expressions, ignore/alter immunity, ignore resistance/weakness, effectiveness override, guaranteed crit, expanded crit range, critical prevention, and ignore-positive/negative-stage policies.

**Done:** Frost Breath, Storm Throw, Spacial Rend, Freeze-Dry, Judgment, Revelation Dance, and similar moves have explicit primitives.

## MA-079 — Execute per-hit multi-strike sequences

Status: TODO

**Depends on:** MA-036, MA-077
**Commit:** `feat(move-automation): resolve multi strike per hit`

**Touch:** new multi-hit operation/handler, damage pipeline, tests.

**Implement:** Model hit-count roll/table, ordered per-hit accuracy policy, per-hit damage/crit/effects, early KO, aggregate damage, and after-each/after-all triggers. Do not collapse five-strike into one multiplied roll unless rules say so.

**Done:** The trace identifies every hit and retry never changes hit count or rolls.

## MA-080 — Generalize healing and direct HP operations

Status: TODO

**Depends on:** MA-040, MA-074
**Commit:** `feat(move-automation): generalize hp effect operations`

**Touch:** HP reducers and tests.

**Implement:** Support fixed/percent max/percent current/percent missing/formula healing or loss, set/copy/split HP, minimum/maximum, temporary HP, full heal, and user/target/area recipients. Define injury and Massive Damage interaction explicitly.

**Done:** HP changes are typed operations with source and trace, not suggestion labels.

## MA-081 — Add drain, recoil, sacrifice, and HP costs

Status: TODO

**Depends on:** MA-080, MA-077
**Commit:** `feat(move-automation): resolve linked hp costs and returns`

**Touch:** HP/damage reducers, tests.

**Implement:** Calculate drain/recoil from actual damage dealt, fixed or max-HP costs, self-KO, HP preconditions, prevented-damage behavior, and per-target/aggregate rounding. Mark whether cost is paid on declaration, hit, damage, or completion.

**Done:** Multi-target drain/recoil and immunity/no-damage cases have deterministic semantics.

## MA-082 — Implement direct-HP and redistribution semantics

Status: TODO

**Depends on:** MA-080
**Commit:** `feat(move-automation): resolve direct hp loss and redistribution`

**Touch:** direct-HP operations, immunity query, tests.

**Implement:** Support level-based/fixed/fractional loss, set-to-value, equalize/average/swap, ignore stats/effectiveness while retaining declared immunity rules, and secondary splash recipients.

**Done:** Night Shade, Seismic Toss, Super Fang, Nature's Madness, Pain Split, Final Gambit, and Flame Burst can be encoded without bespoke state patches.

## MA-083 — Generalize combat-stage operations

Status: TODO

**Depends on:** MA-040, MA-074
**Commit:** `feat(move-automation): support advanced combat stage changes`

**Touch:** stage reducers/operations and tests.

**Implement:** Add set, reset, invert, clear positive/negative, copy, swap, split, transfer, all-stats, selected-stat choice, and cap-aware delta. Preserve source and distinguish prevented/no-op changes.

**Done:** Topsy-Turvy, Haze, Heart Swap, Guard/Power/Speed Swap, Psych Up, and mixed self/target changes are representable.

## MA-084 — Generalize condition operations

Status: TODO

**Depends on:** MA-058, MA-070
**Commit:** `feat(move-automation): support typed condition operations`

**Touch:** condition reducers, immunity query, tests.

**Implement:** Add apply/remove/clear/transfer/replace/random-choice, major/minor grouping, source-linked duration, save timing, stack policy, and cleanse filters. Query type/ability/side/field immunity through authoritative context.

**Done:** Conditions never depend on a UI checkbox being applied after the accepted move.

## MA-085 — Add opposed checks and saving throws

Status: TODO

**Depends on:** MA-036, MA-074
**Commit:** `feat(move-automation): resolve opposed checks and saves`

**Touch:** roll operation/evaluator, pending choice integration seam, tests.

**Implement:** Model actor/target rolls, selected skill/stat, DC expressions, ties, modifiers, rerolls, and success/failure branches. If a human must choose a stat or spend a resource, return a typed pending request.

**Done:** The ledger explains both sides and the branch selected.

## MA-086 — Add optional-effect and branch selection operations

Status: TODO

**Depends on:** MA-038, MA-085
**Commit:** `feat(move-automation): model optional and exclusive branches`

**Touch:** spec/interpreter contracts and tests.

**Implement:** Support server-determined conditional branches, mutually exclusive player choices, optional effects with pass, and target-specific choices. Until Phase 5, unresolved choices return a typed non-committing pending result.

**Done:** Pollen Puff-style target branch and selected-stat effects are representable without client-authored scripts.

## MA-087 — Add reusable semantic scenario fixtures

Status: TODO

**Depends on:** MA-037, MA-040–MA-086
**Commit:** `test(move-automation): add semantic scenario harness`

**Touch:** new `tests/fixtures/moveAutomation/scenario.ts`, planner/resolver/command test helpers.

**Implement:** Define seeded initial map/sheets/encounter state, intent/choices, expected plan, expected committed documents, expected trace subset, and expected rejection. Run a scenario at interpreter, planner, and accepted-command layers.

**Done:** One scenario definition can prove semantics without triplicated setup.

## MA-088 — Add mechanics property and invariant tests

Status: TODO

**Depends on:** MA-074–MA-087
**Commit:** `test(move-automation): verify mechanics invariants`

**Touch:** new property-style Vitest suites.

**Implement:** Cover expression bounds, stage caps, HP constraints, deterministic selector ordering, no illegal recipients, multi-hit totals, modifier ordering, and trace-parent validity over generated bounded inputs.

**Done:** Kernel refactors fail on semantic invariants rather than only named examples.

## MA-089 — Port Ember as the secondary-condition canary

Status: TODO

**Depends on:** MA-077–MA-087
**Commit:** `feat(move-automation): port ember to movespec v2`

**Implement:** Encode ordinary special damage plus its reviewed Burn threshold, immunity, hit/miss, and crit behavior. Add full semantic scenarios and switch the manifest runtime.

**Done:** Ember resolves natively through v2 with no v1 fallback or manual step.

## MA-090 — Port Swords Dance as the stage canary

Status: TODO

**Depends on:** MA-083, MA-087
**Commit:** `feat(move-automation): port swords dance to movespec v2`

**Implement:** Encode self targeting and +2 Attack with cap/no-op trace behavior. Add scenarios and switch the manifest runtime.

**Done:** Stage changes are proven through interpreter, planner, accepted command, and duplicate replay.

## MA-091 — Port Dragon Rage as the direct-HP canary

Status: TODO

**Depends on:** MA-082, MA-087
**Commit:** `feat(move-automation): port dragon rage to movespec v2`

**Implement:** Preserve its exact fixed-loss, immunity, ignored-stat/effectiveness, accuracy, and no-crit semantics. Add hit/miss/immune scenarios.

**Done:** Direct HP loss is fully traceable and retry-safe.

## MA-092 — Port Synthesis as the healing canary

Status: TODO

**Depends on:** MA-080, MA-087
**Commit:** `feat(move-automation): port synthesis to movespec v2`

**Implement:** Encode normal/sun/rain/sand/hail healing percentages, rounding, full-HP no-op, and the existing authoritative map-weather lookup. Phase 6 later broadens weather mechanics without changing this heal query contract.

**Done:** All weather branches have scenarios and no UI-entered heal amount is authoritative.

## MA-093 — Port Absorb as the drain canary

Status: TODO

**Depends on:** MA-081, MA-087
**Commit:** `feat(move-automation): port absorb to movespec v2`

**Implement:** Heal from actual HP damage dealt with canonical rounding. Cover immunity, mitigation, temporary HP, target KO, and full-HP user.

**Done:** Damage and healing commit atomically and duplicate replay does neither twice.

## MA-094 — Port Power Trip as the dynamic-DB canary

Status: TODO

**Depends on:** MA-076–MA-078, MA-087
**Commit:** `feat(move-automation): port power trip to movespec v2`

**Implement:** Calculate DB from positive combat stages with cap/STAB ordering and a per-node expression trace. Cover zero, mixed positive/negative, and capped stages.

**Done:** No pre-resolution script mutation is needed to derive DB.

## MA-095 — Port Double Kick and Fury Attack as strike canaries

Status: TODO

**Depends on:** MA-079, MA-087
**Commit:** `feat(move-automation): port double and five strike canaries`

**Implement:** Port Double Kick for fixed double-strike and Fury Attack for rolled five-strike behavior. Record per-hit rolls/damage/crit, early KO, and aggregate result.

**Done:** Both strike families have accepted-command and retry scenarios before missing multi-hit cohorts begin.

---

## Phase 5 — Durable choices, reactions, and interrupted resolutions

## MA-100 — Define the pending-resolution contract

Status: TODO

**Depends on:** MA-038, MA-050, MA-086
**Commit:** `feat(move-automation): define pending move resolutions`

**Touch:** new `shared/moveAutomation/pendingResolution.ts`, parser tests.

**Implement:** Define resolution ID, originating map/op IDs, actor/spec/ruleset hashes, phase, full authoritative read set, completed trace/roll ledger, outstanding windows, chosen options, causal ancestry, status, timestamps, and bounded public summary. A response window contains stable option IDs and ownership—not executable client data.

**Done:** The contract distinguishes pending, resuming, committed, cancelled, expired, conflicted, and abandoned states.

## MA-101 — Persist pending resolutions separately from terminal ops

Status: TODO

**Depends on:** MA-100
**Commit:** `feat(move-automation): persist pending move resolutions`

**Touch:** `server/storage/migrations.ts`, new `server/storage/pendingMoveResolutionRepository.ts`, database/repository tests.

**Implement:** Add a SQLite table keyed by resolution ID and unique origin map/op ID. Store canonical JSON, status, map slug, revision, creation/update time, and optional terminal operation link. Keep `live_play_ops` as terminal idempotency results; encounter state stores only bounded map-visible summaries/IDs.

**Done:** A pending resolution survives restart and cannot collide with or masquerade as a terminal accepted operation.

## MA-102 — Add strict response command schemas

Status: TODO

**Depends on:** MA-100
**Commit:** `feat(move-automation): parse move response commands`

**Touch:** shared live-play command contracts, new response routes/parser tests.

**Implement:** Define choose, react, pass, GM-cancel, and GM-force-resolve commands. The client sends resolution/window/option IDs, `opId`, expected map revision, and no mechanics payload.

**Done:** Unknown, expired, duplicate, oversized, or forged option IDs reject before use-case code.

## MA-103 — Create pending resolutions from the interpreter

Status: TODO

**Depends on:** MA-101–MA-102
**Commit:** `feat(move-automation): suspend resolution for durable choices`

**Touch:** `executeSpec.ts`, resolve use case, pending repository, tests.

**Implement:** When execution reaches an unresolved choice/window, persist the pending record and public map summary atomically with any allowed declaration costs. Usually no damage/effect mutations commit before the window; exceptions must be explicit typed phases.

**Done:** No database transaction remains open while waiting and duplicate declaration returns the same pending resolution.

## MA-104 — Enforce response ownership and privacy

Status: TODO

**Depends on:** MA-103, MA-054
**Commit:** `feat(move-automation): authorize move response windows`

**Touch:** token-control/profile access helpers, pending-resolution query/use cases, tests.

**Implement:** Assign options to a placement, profile, side, actor, target, or GM. Redact window details and hidden target/roll information for ineligible viewers. A defender can answer its own reaction without controlling the attacker.

**Done:** Only eligible participants can inspect or answer each option; denied events still advance replay cursors safely.

## MA-105 — Resume and commit pending resolutions

Status: TODO

**Depends on:** MA-103–MA-104
**Commit:** `feat(move-automation): resume durable move resolutions`

**Touch:** new resume use case/route, interpreter, planner, commit orchestration, tests.

**Implement:** Load the pending record, apply one idempotent response, revalidate its full authoritative read set, resume execution, and either open the next window or atomically commit the final plan/result. Record each response in the trace.

**Done:** Stale relevant state produces a terminal conflict or explicit replan policy; no stale response partially applies effects.

## MA-106 — Add cancellation, expiry, and GM correction

Status: TODO

**Depends on:** MA-105
**Commit:** `feat(move-automation): terminate stalled move resolutions`

**Touch:** pending use cases, lifecycle integration, audit log, tests.

**Implement:** Define game-event expiry—not wall-clock rule advancement—plus explicit abandonment and authorized GM cancel/force-pass. If declaration costs need compensation, execute a typed compensating plan with CAS rather than restoring a snapshot.

**Done:** Every pending record can reach one audited terminal state and cannot be resumed afterward.

## MA-107 — Build the generic choice/reaction panel

Status: TODO

**Depends on:** MA-104–MA-105
**Commit:** `feat(move-automation): render durable response windows`

**Touch:** new map response component/composable, command outbox, component tests.

**Implement:** Show move, safe context, eligible owner, options, pass, pending/sending/uncertain state, and GM controls. Journal exact response bodies before sending. Do not reconstruct mechanics from labels.

**Done:** Refresh/reconnect restores the same authoritative prompt and a duplicate terminal cannot apply its UI result twice.

## MA-108 — Add canonical reaction phases and priority

Status: TODO

**Depends on:** MA-059, MA-105
**Commit:** `feat(move-automation): order reaction phases`

**Touch:** event/interpreter contracts, executable ordering tests.

**Implement:** Define windows around declare, pre-cost, target, pre-hit, post-hit, pre-damage, post-damage, KO, movement step, switch, and cleanup. Define priority, simultaneous ordering, nested-window maximum, pass semantics, and information revealed at each phase.

**Done:** Ordering is executable and deterministic rather than implied by component timing.

## MA-109 — Migrate current local ability prompts

Status: TODO

**Depends on:** MA-107–MA-108
**Commit:** `feat(move-automation): persist existing ability follow ups`

**Touch:** current Spite/Cute Charm/Poison Point/Moxie/Celebrate prompt utilities/components, response-window specs, tests.

**Implement:** Replace local refs/random prompt IDs with server-created windows and server-authored typed effects. Preserve current eligibility but fix ownership and reconnect behavior.

**Done:** Local prompt state is presentation-only and these follow-ups survive refresh and duplicate delivery.

## MA-110 — Persist current attack-of-opportunity responses

Status: TODO

**Depends on:** MA-108
**Commit:** `feat(move-automation): persist opportunity attack responses`

**Touch:** attack-of-opportunity state/use case/UI, response-window specs, tests.

**Implement:** Replace client-local prompt ownership and random prompt IDs with a server-created defender-owned window. Resolve a chosen attack as an ancestry-linked child. Preserve the current provoking trigger/order for now and keep its semantic status assisted until MA-146.

**Done:** The current AoO prompt is authorized, idempotent, and reconnect-safe, with its remaining post-movement timing limitation explicit.

## MA-111 — Implement shield and guard reactions

Status: TODO

**Depends on:** MA-108, MA-073, MA-081
**Commit:** `feat(move-automation): resolve shield reaction families`

**Touch:** reviewed handler/spec modules and scenario tests.

**Implement:** Add primitives for cancel hit/effects, protect self/side/area, contact retaliation, guard priority, and guard-breaking. Use them for canary scenarios representing Protect, Detect, Baneful Bunker, King's Shield, Obstruct, Spiky Shield, Crafty Shield, Mat Block, Quick Guard, and Wide Guard; registration occurs in Phase 9.

**Done:** A successful shield alters the provoking plan before commit and usage is spent once.

## MA-112 — Implement counter, storage, and reflected-effect reactions

Status: TODO

**Depends on:** MA-108, MA-063, MA-082
**Commit:** `feat(move-automation): resolve counter reaction families`

**Touch:** reaction handlers and scenarios.

**Implement:** Support recorded effective HP loss, triggering damage class/type, delayed stored damage, redirected target/effect, and reflected status. Prove with Counter, Mirror Coat, Bide, Magic Coat, and Snatch scenarios.

**Done:** Triggering and response resolutions share ancestry and cannot double-count damage.

## MA-113 — Implement setup, cancellation, and redirection reactions

Status: TODO

**Depends on:** MA-108, MA-060, MA-073
**Commit:** `feat(move-automation): resolve setup and redirection reactions`

**Touch:** lifecycle/reaction handlers and scenarios.

**Implement:** Support declare-now/execute-later, cancellation on intervening events, redirection before accuracy, and source/target replacement. Prove with Focus Punch, Beak Blast, Shell Trap, Follow Me, Rage Powder, Feint, Pursuit, and Chatter/Sonic Drown Out.

**Done:** Cancellation changes the pending plan rather than compensating after commit.

## MA-114 — Stress reaction races and recovery

Status: TODO

**Depends on:** MA-106–MA-113
**Commit:** `test(move-automation): harden response window concurrency`

**Touch:** server integration/chaos tests.

**Implement:** Race two eligible responders, response versus GM cancel, response versus relevant map/sheet edit, lost HTTP plus accepted SSE, refresh, restart, and duplicate option submission.

**Done:** Each case yields one deterministic continuation or clean conflict with no duplicate effect/resource spend.

## MA-115 — Record safe compensating metadata for accepted moves

Status: TODO

**Depends on:** MA-039–MA-041, MA-105
**Commit:** `feat(move-automation): plan safe move compensation`

**Touch:** typed plan/result contracts, state reducers, tests.

**Implement:** For each reversible typed operation, record the exact before value, after value, owning resource/revision, operation ID, and an inverse operation. Mark irreversible or externally observed operations explicitly. Do not store a generic whole-document snapshot as an undo patch.

**Done:** The server can explain which parts of an accepted move are safely compensable and why other parts are not.

## MA-116 — Add an atomic GM correction command

Status: TODO

**Depends on:** MA-115
**Commit:** `feat(move-automation): apply audited gm move corrections`

**Touch:** shared command/parser, new correction use case/route, operation storage, repositories, tests.

**Implement:** Let an authorized GM reference an accepted resolution and choose typed inverse/correction operation IDs. Re-read all affected resources, require expected current values/revisions, apply one compensating transaction, and append an ancestry-linked audit/realtime result. Never rerun original RNG.

**Done:** A concurrent later change causes a clean conflict instead of being overwritten; duplicate correction `opId` applies once.

## MA-117 — Add correction UI and audit scenarios

Status: TODO

**Depends on:** MA-116
**Commit:** `feat(move-automation): expose safe gm corrections`

**Touch:** move log/operation details UI, GM controls, component/integration tests.

**Implement:** Show eligible compensations, affected resources, non-reversible warnings, pending/accepted/conflicted state, and causal link to the original move. Do not expose private sheet values to players.

**Done:** A GM can correct a supported mistake without raw state editing, and the original plus correction remain visible in the structured trace/history.

---

## Phase 6 — Movement, zones, hazards, weather, terrain, and rooms

## MA-120 — Define one authoritative movement oracle

Status: TODO

**Depends on:** MA-035, MA-072
**Commit:** `feat(move-automation): define server movement oracle`

**Touch:** new `server/domain/movement/resolveMovement.ts`, shared geometry helpers, tests.

**Implement:** Given map/sheets/placement, movement mode, destination, and policy, derive legal path, cost, capabilities, occupancy, terrain, footprint, collision, and triggering steps. Client-provided path/cost is never authoritative.

**Done:** The oracle returns a typed success/failure with deterministic tie-breaking and reason codes.

## MA-121 — Route normal token movement through the oracle

Status: TODO

**Depends on:** MA-120
**Commit:** `refactor(live-play): validate token movement server side`

**Touch:** `applyMoveTokenCommand.ts`, command contract, movement tests.

**Implement:** Replace destination clamping/client path-length trust with server path/cost derivation. Preserve current accepted behavior where it is legal and add explicit GM override policy.

**Done:** Browser and server cannot disagree about reachability or movement spent.

## MA-122 — Route Pass movement through the oracle

Status: TODO

**Depends on:** MA-120
**Commit:** `refactor(move-automation): unify pass movement validation`

**Touch:** authoritative Pass resolver, area/path helpers, tests.

**Implement:** Preserve crossed-cell targeting and facing while deriving path, destination, occupancy, and movement triggers through the shared oracle.

**Done:** Existing Pass fixtures remain semantically equivalent without a bespoke legality path.

## MA-123 — Model movement modes and capabilities

Status: TODO

**Depends on:** MA-120, MA-058
**Commit:** `feat(move-automation): model movement capabilities`

**Touch:** authoritative sheet projection, movement query, tests.

**Implement:** Support overland, sky, swim, burrow, levitate, phasing, jump, climb, and temporary mode overlays. Encode grounded/airborne/semi-invulnerable separately from display height.

**Done:** Movement legality can be altered by typed effects and restored on expiry.

## MA-124 — Enforce action and movement costs

Status: TODO

**Depends on:** MA-064, MA-120
**Commit:** `feat(move-automation): spend authoritative action resources`

**Touch:** movement/move preconditions, resource reducer, tests.

**Implement:** Spend Standard, Shift, Swift, Free, Full, Interrupt/Reaction, movement distance, and once-per-turn resources at declared phases. Encode Exhaust, Set-Up/Execute, Priority, and no-cost exceptions as reviewed spec data.

**Done:** Cost failure rejects before mutations and duplicate resolution never spends twice.

## MA-125 — Add durable destination and direction choices

Status: TODO

**Depends on:** MA-105, MA-120
**Commit:** `feat(move-automation): choose legal movement destinations`

**Touch:** response-window options, map targeting overlay, tests.

**Implement:** Server enumerates or validates bounded legal cells/directions and issues stable option IDs. Client chooses an option, which is revalidated on resume.

**Done:** No client-authored coordinate can bypass range, bounds, occupancy, or movement mode.

## MA-126 — Implement forced push, pull, and shift vectors

Status: TODO

**Depends on:** MA-120, MA-125
**Commit:** `feat(move-automation): resolve forced displacement`

**Touch:** new spatial effect reducer, tests.

**Implement:** Derive away/toward/chosen/cardinal vectors from footprints, calculate distance expressions including Weight Class, and distinguish forced from voluntary movement and AoO policy.

**Done:** Push/pull results are typed movement operations with exact path and shortening reason.

## MA-127 — Handle collision, obstruction, and shortening

Status: TODO

**Depends on:** MA-126
**Commit:** `feat(move-automation): resolve displacement collisions`

**Touch:** movement oracle/spatial reducer, property tests.

**Implement:** Stop or reject at map bounds, blocking voxels, height changes, occupied footprints, and illegal modes according to per-operation policy. Support full-distance-required versus up-to-distance.

**Done:** No generated plan overlaps placements or leaves bounds.

## MA-128 — Implement teleport and position swaps

Status: TODO

**Depends on:** MA-120, MA-125
**Commit:** `feat(move-automation): resolve teleports and swaps`

**Touch:** spatial reducer and tests.

**Implement:** Validate source/destination footprints atomically, willingness/relationship, terrain restrictions, and simultaneous swap occupancy. Mark which movement triggers apply.

**Done:** Failed second-footprint validation leaves both placements unchanged.

## MA-129 — Implement semi-invulnerable setup states

Status: TODO

**Depends on:** MA-056, MA-123, MA-108
**Commit:** `feat(move-automation): model semi invulnerable movement states`

**Touch:** lifecycle/spatial effects, targeting predicates, tests.

**Implement:** Model underground, underwater, airborne, vanished, carried target, targetability exceptions, setup cancellation, and resolve-phase movement for Dig/Dive/Fly/Bounce/Sky Drop/Phantom Force/Shadow Force families.

**Done:** Switch/KO/cancel/scene cleanup cannot strand a token or carried target.

## MA-130 — Add recall and send-out operations to move plans

Status: TODO

**Depends on:** MA-039, MA-105, existing send-out authority
**Commit:** `feat(move-automation): plan move driven switches`

**Touch:** planner, send-out/roster helpers, scopes/read sets, tests.

**Implement:** Offer legal replacements through a durable choice, then recall and send out atomically with damage/effects. Preserve side, initiative policy, and source-leave cleanup.

**Done:** A switching move cannot commit its attack without a valid selected replacement when replacement is mandatory.

## MA-131 — Implement transferable state for Baton Pass

Status: TODO

**Depends on:** MA-057, MA-130
**Commit:** `feat(move-automation): transfer eligible effects on switch`

**Touch:** effect transfer policies, stage planner, tests.

**Implement:** Transfer stages and explicitly passable coats/stratagems/effects; leave or expire non-passable source-linked state. Store transfer behavior in effect/spec data.

**Done:** Source-leave cleanup and transfer cannot both delete or duplicate the same effect.

## MA-132 — Emit lifecycle events for every movement step

Status: TODO

**Depends on:** MA-059–MA-060, MA-120
**Commit:** `feat(move-automation): trigger effects during movement paths`

**Touch:** movement oracle, lifecycle reducer, tests.

**Implement:** Emit leave-adjacency, leave-cell, enter-cell, and final-destination events in path order. Allow a pending interrupt to stop/cancel remaining steps before final commit.

**Done:** Hazards and opportunity attacks can occur at the correct step and retry cannot retrigger earlier committed steps.

## MA-133 — Define generalized battlefield zones

Status: TODO

**Depends on:** MA-050, MA-056
**Commit:** `feat(move-automation): model battlefield zones`

**Touch:** encounter/map types, normalization, zone query tests.

**Implement:** Represent cells/geometry, source, side, layer, duration, stacking, entry/exit hooks, targeting/damage/movement modifiers, and typed payload. Add migration adapters for existing field/hazard arrays without dual application.

**Done:** Smoke, local terrain, pledges, barriers, vortexes, and side conditions share one queryable shape.

## MA-134 — Add hazard-cell selection to move intent

Status: TODO

**Depends on:** MA-073, MA-125, MA-133
**Commit:** `feat(move-automation): select authoritative hazard cells`

**Touch:** `shared/livePlayMoveResolution.ts`, targeting overlays, resolver tests.

**Implement:** Server describes legal count/range/adjacency/geometry; client returns option IDs or selected cells within a signed window. Remove the current instant-flow `hazardCells: []` limitation.

**Done:** Over-count, disconnected, occupied, out-of-range, and stale cell selections reject.

## MA-135 — Add hazard ownership, layers, and geometry

Status: TODO

**Depends on:** MA-133–MA-134
**Commit:** `feat(move-automation): validate owned hazard zones`

**Touch:** hazard types/reducers, geometry property tests.

**Implement:** Replace free-form ownership with source/side IDs, support layers/charges, connectedness, exact/up-to counts, derived Blast/Line cells, and removal/side-swap operations.

**Done:** Spikes, Stealth Rock, Sticky Web, Toxic Spikes, Stone Axe, and pledge zones are representable.

## MA-136 — Resolve zone and hazard entry effects

Status: TODO

**Depends on:** MA-132, MA-135, MA-080–MA-084
**Commit:** `feat(move-automation): trigger battlefield zones on entry`

**Touch:** lifecycle zone handlers, tests.

**Implement:** Apply direct/tick HP, conditions, stages, slow terrain, grounded checks, layer behavior, once-per-movement guards, absorption/removal, and source immunity.

**Done:** Traversing multiple cells cannot trigger the same zone more often than its policy permits.

## MA-137 — Unify field ownership, replacement, and duration

Status: TODO

**Depends on:** MA-060, MA-133
**Commit:** `feat(move-automation): unify field lifecycle`

**Touch:** field/zone queries, lifecycle reducer, existing field-effect commands, tests.

**Implement:** Define source, side, priority, replacement, suppression, fixed/scene duration, and authoritative round advancement for global fields. Keep manual ticking only as a typed GM correction.

**Done:** Any weather/terrain/room instance has one owner, one active/replaced result, and expires once under initiative retry.

## MA-138 — Implement sun and rain mechanics

Status: TODO

**Depends on:** MA-077, MA-137
**Commit:** `feat(move-automation): resolve sun and rain`

**Touch:** weather queries and damage/accuracy/heal tests.

**Implement:** Add move-type damage modifiers, accuracy exceptions, healing/charge interactions, immunity predicates, and trace reasons for Sunny and Rainy weather.

**Done:** Sun/rain affect authoritative calculations and every changed branch has a golden scenario.

## MA-139 — Implement hail and sandstorm mechanics

Status: TODO

**Depends on:** MA-060, MA-077, MA-137
**Commit:** `feat(move-automation): resolve hail and sandstorm`

**Touch:** weather queries, lifecycle HP operations, tests.

**Implement:** Add damage/accuracy/heal modifiers, end-round residuals, type/ability immunity, and ordering relative to other lifecycle effects.

**Done:** Residuals and duration advance atomically and duplicate initiative cannot tick twice.

## MA-140 — Implement Electric and Grassy Terrain

Status: TODO

**Depends on:** MA-077, MA-084, MA-123, MA-137
**Commit:** `feat(move-automation): resolve electric and grassy terrain`

**Touch:** terrain membership/query, damage/condition/lifecycle tests.

**Implement:** Use grounded membership for Electric sleep prevention and damage modifiers, and Grassy damage/healing/movement interactions. Support global and local zone geometry through one query.

**Done:** Both terrains produce traced effects only for legal grounded recipients.

## MA-141 — Implement Misty and Psychic Terrain

Status: TODO

**Depends on:** MA-077, MA-084, MA-108, MA-123, MA-137
**Commit:** `feat(move-automation): resolve misty and psychic terrain`

**Touch:** terrain, condition, damage, reaction-priority queries, tests.

**Implement:** Add grounded condition protection/damage modification for Misty Terrain and priority/reaction targeting plus damage rules for Psychic Terrain.

**Done:** Terrain changes legality before rolls and does not rely on UI filtering.

## MA-142 — Implement Trick Room and Wonder Room

Status: TODO

**Depends on:** MA-060–MA-064, MA-075, MA-137
**Commit:** `feat(move-automation): resolve trick and wonder rooms`

**Touch:** calculated initiative order, stat selectors/overlays, tests.

**Implement:** Model Trick Room's canonical activation/expiry and calculated-order inversion plus Wonder Room's defense-stat overlay. Manual initiative order still wins over calculated order.

**Done:** Neither Room destructively rewrites sheet stats or manual initiative data.

## MA-143 — Implement Magic Room, Gravity, and Tailwind

Status: TODO

**Depends on:** MA-054, MA-064, MA-123, MA-137
**Commit:** `feat(move-automation): resolve remaining global fields`

**Touch:** item-effect query seam, movement/accuracy, side initiative modifiers, tests.

**Implement:** Store/query Magic Room item suppression, Gravity grounding/movement/accuracy, and side-owned Tailwind initiative. MA-157 later connects the generic item-suppression query to every equipment contribution.

**Done:** Each field has real authoritative query behavior, ownership, duration, and no sheet rewrite.

## MA-144 — Implement barriers and smoke zones

Status: TODO

**Depends on:** MA-072, MA-077, MA-133
**Commit:** `feat(move-automation): resolve barriers and smoke`

**Touch:** LOS/cover, damage/accuracy queries, zone handlers, tests.

**Implement:** Add blocking/cover/destruction behavior for barriers and sight/accuracy/area behavior for smoke with exact cell geometry and source/side state.

**Done:** Barrier and Smokescreen-style zones materially change authoritative targeting/calculation and can be removed by typed operations.

## MA-145 — Implement field cleanup, transfer, and suppression

Status: TODO

**Depends on:** MA-133–MA-144
**Commit:** `feat(move-automation): mutate battlefield field state`

**Touch:** zone/field handlers and tests.

**Implement:** Support remove by kind/source/area, clear side, transfer/swap sides, suppress, destroy, and terrain consumption. Prove Court Change, Defog, Rapid Spin, Whirlwind, and Steel Roller behavior in scenarios; registration stays in Phase 9.

**Done:** Cleanup/transfer is a structured traced operation with exact affected IDs.

## MA-146 — Interrupt movement steps with opportunity attacks

Status: TODO

**Depends on:** MA-105, MA-110, MA-132
**Commit:** `feat(move-automation): interrupt movement with opportunity attacks`

**Touch:** movement-step lifecycle, pending-resolution orchestration, AoO handlers/UI, tests.

**Implement:** Open the eligible AoO window before the provoking step commits, resume the remaining path after pass/resolution, and allow only typed attack results to cancel, shorten, or otherwise alter movement. Revalidate the path/read set on resume.

**Done:** AoO timing is mechanically correct, reconnect-safe, and no longer a post-movement compensation.

---

## Phase 7 — Items, inventory, history, nested moves, and overlays

## MA-150 — Define authoritative item references and scopes

Status: TODO

**Depends on:** MA-035, existing inventory contracts
**Commit:** `feat(move-automation): define move item references`

**Touch:** new `shared/moveAutomation/items.ts`, item parser tests.

**Implement:** Identify Pokémon held item, trainer equipment slot, trainer inventory row, group inventory row, and map-ground item by stable ID plus owning resource/revision. Define quantity, stack, and equip semantics.

**Done:** A mutating move never identifies an item only by display name.

## MA-151 — Add ground-item state to maps

Status: TODO

**Depends on:** MA-150, MA-051
**Commit:** `feat(move-automation): persist ground items on maps`

**Touch:** map/encounter types, normalization, minimal renderer/interaction, tests.

**Implement:** Store stable ID, canonical item ID/name, quantity, cell/height, source resource, source operation, and optional side/owner hint. Bound item count and payload.

**Done:** Dropped, thrown, and knocked-off items survive reload and can be selected later.

## MA-152 — Load required item resources into resolution

Status: TODO

**Depends on:** MA-004, MA-150
**Commit:** `feat(move-automation): read authoritative item resources`

**Touch:** resolve scopes/use case, sheet/group inventory repositories, tests.

**Implement:** Resolve only item resources required by the spec/actor, normalize legal candidates, and add every consulted revision to the read set. Enforce visibility/control without exposing private inventory to other clients.

**Done:** Item legality uses current SQLite state and stale item reads conflict.

## MA-153 — Add typed item write plans

Status: TODO

**Depends on:** MA-039, MA-150–MA-152
**Commit:** `feat(move-automation): plan item mutations`

**Touch:** planner/resource scopes, item reducers, tests.

**Implement:** Plan equip, unequip, transfer, swap, decrement, consume, destroy, restore consumed, and ground-item add/remove. Deduplicate shared resources and validate quantities.

**Done:** Plans cannot create or destroy quantity except through an explicit allowed operation.

## MA-154 — Commit group-inventory move changes atomically

Status: TODO

**Depends on:** MA-153
**Commit:** `feat(move-automation): commit cross resource item effects`

**Touch:** `applyResolveMoveCommand.ts`, group inventory repository, realtime/scopes, integration tests.

**Implement:** CAS-check map, full sheet read set, and group inventory reads/writes in one SQLite transaction; append authorized resource events before commit.

**Done:** Damage and item transfer either both commit or neither does under concurrency.

## MA-155 — Add durable item choices

Status: TODO

**Depends on:** MA-105, MA-152
**Commit:** `feat(move-automation): choose legal move items`

**Touch:** response-window options, map move UI, tests.

**Implement:** Offer only legal stable item references and destinations; support none/pass where canonical. Revalidate on resume and redact private alternatives.

**Done:** Refresh restores the choice; stale inventory terminates cleanly without item loss.

## MA-156 — Implement shared item mutation operations

Status: TODO

**Depends on:** MA-153–MA-155
**Commit:** `feat(move-automation): resolve common item mutations`

**Touch:** item effect interpreter and scenarios.

**Implement:** Add shared behavior for give, steal, swap, knock to ground, throw, consume, restore, destroy, suppress, and digest/store buff.

**Done:** Bestow, Covet/Thief, Switcheroo/Trick, Knock Off, Fling, Recycle, Incinerate, Embargo, Corrosive Gas, and Stuff Cheeks can use typed primitives.

## MA-157 — Add item-dependent expressions and suppression

Status: TODO

**Depends on:** MA-074, MA-150, MA-156
**Commit:** `feat(move-automation): calculate item dependent move rules`

**Touch:** expression context, item query, field/effect overlays, tests.

**Implement:** Query holding-nothing, Berry/Plate/Drive/Memory/category/power; return move type/DB/effects; suppress contributions under Embargo/Magic Room without unequipping.

**Done:** Acrobatics, Natural Gift, Fling, Judgment, Techno Blast, Multi-Attack, and Poltergeist are representable.

## MA-158 — Finalize structured move-history queries

Status: TODO

**Depends on:** MA-063, MA-037
**Commit:** `feat(move-automation): query canonical move history`

**Touch:** encounter history reducer/query, tests.

**Implement:** Record declaration/completion, canonical ID/spec version, branch, actor, targets, success, action type, ancestry, copied/random origin, and move-list source. Add bounded last/previous/used-this-scene queries.

**Done:** Meta-moves never parse prose logs or UI history.

## MA-159 — Execute reviewed specs as nested child moves

Status: TODO

**Depends on:** MA-038, MA-105, MA-158
**Commit:** `feat(move-automation): execute nested child moves`

**Touch:** interpreter/orchestration, tests.

**Implement:** Invoke another server-registered reviewed spec with shared authoritative context, RNG ledger, typed plan, and new child resolution ID. Allow fresh target/branch windows and inherit only explicitly declared actor/source properties.

**Done:** Child operations commit atomically with ancestry and cannot select a client-provided spec.

## MA-160 — Bound recursion and nested resource use

Status: TODO

**Depends on:** MA-159
**Commit:** `fix(move-automation): bound nested move execution`

**Touch:** nested executor and adversarial tests.

**Implement:** Enforce depth, total operations, targets, emitted events, random retries, and visited/banned spec sets. Define safe failure before mutation.

**Done:** Copy loops, Metronome loops, and oversized children cannot exhaust the server or partially commit.

## MA-161 — Implement generic random tables and move pools

Status: TODO

**Depends on:** MA-036, MA-159–MA-160
**Commit:** `feat(move-automation): resolve reviewed random tables`

**Touch:** random operation/pool modules and tests.

**Implement:** Support equal/weighted entries, nested operation lists, bounded reroll-invalid, and move pools sourced from explicit allow/deny sets or authoritative move lists. Record candidate count and selected ID without leaking private alternatives.

**Done:** Dire Claw, Tri Attack, Magnitude, Present, Assist, Metronome, Sleep Talk, and Nature Power primitives are covered.

## MA-162 — Add encounter-local move-list overlays

Status: TODO

**Depends on:** MA-056, MA-158
**Commit:** `feat(move-automation): apply temporary move list overlays`

**Touch:** encounter effects, authoritative move lookup/menu, tests.

**Implement:** Add/replace/disable/restrict moves with source, target, duration, copied spec hash, and expiry. Server legality and client menu use the same projection.

**Done:** Mimic, Encore, Disable, Imprison, and temporary copied moves affect actual resolution eligibility.

## MA-163 — Add permanent move-list mutations

Status: TODO

**Depends on:** MA-039, MA-158
**Commit:** `feat(move-automation): mutate permanent move lists atomically`

**Touch:** sheet planner/reducer, tests.

**Implement:** Add explicit replace/add/remove operations with legal-slot checks, source provenance, and sheet CAS. Support Sketch replacing itself with the chosen legal move.

**Done:** Permanent mutation and move usage/history update commit atomically.

## MA-164 — Add reversible transformation snapshots

Status: TODO

**Depends on:** MA-056, MA-162
**Commit:** `feat(move-automation): model reversible transformations`

**Touch:** encounter projection, effect payload, tests.

**Implement:** Snapshot copied moves, types, abilities, weight, height, capabilities, and appearance while retaining canonical user-owned stats/state as required. Restore on switch/KO/scene end.

**Done:** Transform cannot permanently alter either sheet and survives reload while active.

## MA-165 — Add type, form, ability, and capability overlays

Status: TODO

**Depends on:** MA-056, MA-078, MA-123
**Commit:** `feat(move-automation): apply creature rule overlays`

**Touch:** encounter projection and type/ability/movement queries, tests.

**Implement:** Add/replace/suppress/copy/swap types and abilities; apply form/capability/size/grounding/sonic-lock overlays with duration and source. Resolve stacking/precedence centrally.

**Done:** Soak, Magic Powder, Reflect Type, Simple Beam, Worry Seed, Role Play, Skill Swap, Entrainment, Magnet Rise, Smack Down, Thousand Arrows, Minimize, and Throat Chop are representable.

## MA-166 — Prove cross-resource and nested recovery

Status: TODO

**Depends on:** MA-154–MA-165
**Commit:** `test(move-automation): harden item and nested resolutions`

**Touch:** integration/chaos tests.

**Implement:** Cover stale inventory, shared resource conflicts, item choice reconnect, nested target choice reconnect, child recursion rejection, permanent move-list CAS, transform cleanup, lost response, duplicate terminal, and restart.

**Done:** No case duplicates an item, move, child effect, or transformation and every failure is atomic.

---

## Phase 8 — Difficult vertical slices and registered-script repairs

These tickets finish known gaps in already registered moves. They are deliberately before the 518 missing-move cohorts so each difficult engine shape is proven without inflating breadth.

## MA-170 — Finish Yawn as a delayed condition

Status: TODO

**Depends on:** MA-060–MA-062, MA-084
**Commit:** `feat(move-automation): fully resolve yawn`

**Implement:** Replace the note/marker with a target-linked effect that triggers at the canonical future turn boundary, rechecks Sleep immunity at trigger time, applies Sleep, and removes itself. Cover switch, KO, scene end, refresh, and duplicate initiative advance.

**Done:** Yawn has no manual clause and its manifest row becomes complete.

## MA-171 — Finish Helping Hand as a consumable effect

Status: TODO

**Depends on:** MA-057, MA-077
**Commit:** `feat(move-automation): fully resolve helping hand`

**Implement:** Apply a source-linked bonus to the target's next qualifying attack, consume exactly once after calculation, and expire at the correct boundary. Trace why it did or did not apply.

**Done:** Reconnect and duplicate move resolution cannot consume the bonus twice.

## MA-172 — Finish Reflect as a side effect

Status: TODO

**Depends on:** MA-054, MA-056–MA-060, MA-077
**Commit:** `feat(move-automation): fully resolve reflect`

**Implement:** Replace manual tracking with an owned side effect containing canonical duration/charges and physical-damage predicate. Integrate activation/consumption with the damage trace.

**Done:** Reflect applies only to allies, expires automatically, and has no operator note.

## MA-173 — Finish Sand Tomb through the shared Vortex effect

Status: TODO

**Depends on:** MA-056–MA-060, MA-080, MA-123
**Commit:** `feat(move-automation): fully resolve sand tomb vortex`

**Implement:** Add the shared Vortex payload: trapped/slowed state, end-turn HP loss, escape checks, refresh/replacement, source/type metadata, and cleanup.

**Done:** Sand Tomb is complete; later Vortex moves reuse this effect rather than copy its logic.

## MA-174 — Finish Tackle and Take Down displacement

Status: TODO

**Depends on:** MA-085, MA-125–MA-127
**Commit:** `feat(move-automation): resolve tackle family displacement`

**Implement:** Encode optional/required opposed checks, legal direction, push distance, collision/shortening, and simultaneous damage/cost ordering for Tackle and Take Down.

**Done:** Neither move requires a GM push or opposed-check note.

## MA-175 — Finish U-Turn switching

Status: TODO

**Depends on:** MA-105, MA-130
**Commit:** `feat(move-automation): fully resolve u turn switching`

**Implement:** After the qualifying attack, open a legal replacement choice and atomically recall/send out under canonical optionality. Cover no-replacement and stale-roster cases.

**Done:** Attack, usage, switch, effects, and history resolve once as one saga.

## MA-176 — Finish Knock Off inventory mutation

Status: TODO

**Depends on:** MA-150–MA-157
**Commit:** `feat(move-automation): fully resolve knock off`

**Implement:** Query legal held/accessory candidates, choose when necessary, apply any damage interaction, remove/suppress according to canonical rule, and create the ground item or other canonical destination atomically.

**Done:** No manual inventory step remains and concurrency cannot duplicate the item.

## MA-177 — Finish Fury Cutter chaining

Status: TODO

**Depends on:** MA-063, MA-076
**Commit:** `feat(move-automation): fully resolve fury cutter chain`

**Implement:** Store actor+move chain state, calculate capped DB, and reset on the canonical miss/different-move/switch/scene events.

**Done:** Consecutive use is traceable and retry cannot increment the chain twice.

## MA-178 — Finish the registered Five Strike family

Status: TODO

**Depends on:** MA-079
**Commit:** `feat(move-automation): fully resolve five strike moves`

**Implement:** Migrate every registered five-strike script to per-hit resolution with one recorded hit-count roll/table, per-hit damage/crit/effects where required, early KO, and aggregate summary.

**Done:** No five-strike automation note asks the operator to finish hits manually.

## MA-179 — Finish Astonish and Fake Out timing/legality

Status: TODO

**Depends on:** MA-063–MA-064, MA-084, MA-108
**Commit:** `feat(move-automation): enforce opening move legality`

**Implement:** Express their first-turn/target-state/timing preconditions and Flinch application through history/resources and authoritative condition rules.

**Done:** Illegal use rejects with a stable reason and legal use needs no operator adjudication.

## MA-180 — Finish registered ally-area moves

Status: TODO

**Depends on:** MA-055, MA-073
**Commit:** `feat(move-automation): complete ally area scripts`

**Implement:** Remove manual ally filtering from Howl, Aromatic Mist, Coaching, and any audited registered peers. Add mixed-side area scenarios.

**Done:** All affected recipients are derived server-side and enemy/unknown-side tokens are excluded.

## MA-181 — Certify the repaired registered-script canaries

Status: TODO

**Depends on:** MA-170–MA-180
**Commit:** `test(move-automation): certify repaired registered scripts`

**Implement:** Add/finish semantic manifest scenarios for each repaired script, assert empty blockers/manual steps, and run them through interpreter, planner, accepted command, duplicate replay, and relevant reconnect paths.

**Done:** The manifest marks these scripts complete for evidence-backed reasons, not registry membership.

---

## Phase 8B — Certify all baseline-registered moves

The 33 tickets below cover all 258 moves that had explicit registry entries at the baseline commit, exactly once. Each ticket is one commit and contains at most eight moves.

### Shared registered-move conformance contract

**Start after:** MA-181 and every capability blocker recorded for the selected rows.

For each REG ticket:

1. Re-read the frozen canonical row and the current v1/v2 implementation.
2. Keep a v1 program through the adapter when it is genuinely complete; port to v2 or a registered handler when the current shape cannot encode all rules. Do not rewrite merely for uniformity.
3. Remove or structurally convert every `automationNotes` rule instruction. Informational notes may remain only when mechanics are already represented and tested.
4. Add golden scenarios for every branch, threshold, immunity, choice, recipient class, and persistent effect.
5. Run the scenarios at interpreter/legacy executor, planner, and accepted-command levels as applicable. Add retry/reconnect/multi-resource coverage when applicable.
6. Update manifest runtime/version/hash, capability tags, scenario IDs, manual steps, and blockers.
7. Promote only the listed rows whose base rules are completely applied.

**Done for the ticket:** All listed rows are `complete`, no other row changes semantic status, the registered count remains unchanged, and manifest validation/typecheck pass. If a reusable blocker remains, insert a machinery ticket before this REG ticket instead of approving a partial implementation.

## REG-001 — Certify Absorb through Air Slash

Status: TODO

**Baseline-registered moves:** Absorb; Accelerock; Acid; Acid Spray; Acupressure; Aerial Ace; Air Cutter; Air Slash

## REG-002 — Certify Apple Acid through Aurora Beam

Status: TODO

**Baseline-registered moves:** Apple Acid; Aqua Jet; Aqua Tail; Aromatic Mist; Astonish; Attack Order; Aura Sphere; Aurora Beam

## REG-003 — Certify Baby-Doll Eyes through Bone Club

Status: TODO

**Baseline-registered moves:** Baby-Doll Eyes; Bite; Blaze Kick; Bleakwind Storm; Blue Flare; Body Slam; Bolt Strike; Bone Club

## REG-004 — Certify Boomburst through Bullet Punch

Status: TODO

**Baseline-registered moves:** Boomburst; Branch Poke; Breaking Swipe; Brutal Swing; Bubble; Bubble Beam; Bulldoze; Bullet Punch

## REG-005 — Certify Charm through Cross Chop

Status: TODO

**Baseline-registered moves:** Charm; Coaching; Confide; Confuse Ray; Confusion; Cotton Spore; Crabhammer; Cross Chop

## REG-006 — Certify Cross Poison through Discharge

Status: TODO

**Baseline-registered moves:** Cross Poison; Crunch; Crush Claw; Dark Pulse; Dazzling Gleam; Decorate; Disarming Voice; Discharge

## REG-007 — Certify Dizzy Punch through Drill Peck

Status: TODO

**Baseline-registered moves:** Dizzy Punch; Double Kick; Dragon Breath; Dragon Claw; Dragon Hammer; Dragon Pulse; Dragon Rage; Drill Peck

## REG-008 — Certify Drill Run through Energy Ball

Status: TODO

**Baseline-registered moves:** Drill Run; Drum Beating; Earth Power; Eerie Impulse; Egg Bomb; Electroweb; Ember; Energy Ball

## REG-009 — Certify Esper Wing through Feather Dance

Status: TODO

**Baseline-registered moves:** Esper Wing; Extrasensory; Extreme Speed; Fairy Wind; Fake Out; Fake Tears; False Surrender; Feather Dance

## REG-010 — Certify Feint Attack through Flash Cannon

Status: TODO

**Baseline-registered moves:** Feint Attack; Fire Blast; Fire Lash; Fire Punch; Flame Wheel; Flamethrower; Flash; Flash Cannon

## REG-011 — Certify Flatter through Glare

Status: TODO

**Baseline-registered moves:** Flatter; Focus Blast; Force Palm; Frustration; Fury Attack; Fury Cutter; Fury Swipes; Glare

## REG-012 — Certify Grass Whistle through Heat Wave

Status: TODO

**Baseline-registered moves:** Grass Whistle; Grav Apple; Growl; Gunk Shot; Headbutt; Heal Bell; Heart Stamp; Heat Wave

## REG-013 — Certify Helping Hand through Ice Punch

Status: TODO

**Baseline-registered moves:** Helping Hand; Hone Claws; Horn Attack; Howl; Hyper Fang; Hypnosis; Ice Beam; Ice Punch

## REG-014 — Certify Ice Shard through Land’s Wrath

Status: TODO

**Baseline-registered moves:** Ice Shard; Icicle Crash; Icy Wind; Iron Head; Iron Tail; Karate Chop; Knock Off; Land’s Wrath

## REG-015 — Certify Lava Plume through Low Sweep

Status: TODO

**Baseline-registered moves:** Lava Plume; Leaf Blade; Leafage; Leer; Lick; Liquidation; Lovely Kiss; Low Sweep

## REG-016 — Certify Luster Purge through Mist Ball

Status: TODO

**Baseline-registered moves:** Luster Purge; Mach Punch; Magical Leaf; Magnet Bomb; Mega Punch; Metal Sound; Mirror Shot; Mist Ball

## REG-017 — Certify Moonblast through Needle Arm

Status: TODO

**Baseline-registered moves:** Moonblast; Mountain Gale; Mud Bomb; Mud Shot; Mud Sport; Mud-Slap; Mystical Fire; Needle Arm

## REG-018 — Certify Night Daze through Peck

Status: TODO

**Baseline-registered moves:** Night Daze; Night Slash; Noble Roar; Nuzzle; Octazooka; Origin Pulse; Overdrive; Peck

## REG-019 — Certify Petal Blizzard through Poison Powder

Status: TODO

**Baseline-registered moves:** Petal Blizzard; Pin Missile; Play Nice; Play Rough; Poison Fang; Poison Gas; Poison Jab; Poison Powder

## REG-020 — Certify Poison Sting through Precipice Blades

Status: TODO

**Baseline-registered moves:** Poison Sting; Poison Tail; Pound; Powder Snow; Power Gem; Power Trip; Power Whip; Precipice Blades

## REG-021 — Certify Psybeam through Razor Shell

Status: TODO

**Baseline-registered moves:** Psybeam; Psycho Cut; Psywave; Pyro Ball; Quick Attack; Raging Fury; Razor Leaf; Razor Shell

## REG-022 — Certify Reflect through Rolling Kick

Status: TODO

**Baseline-registered moves:** Reflect; Return; Rock Climb; Rock Slide; Rock Smash; Rock Throw; Rock Tomb; Rolling Kick

## REG-023 — Certify Sacred Fire through Scorching Sands

Status: TODO

**Baseline-registered moves:** Sacred Fire; Sacred Sword; Sand Attack; Sand Tomb; Sandstorm Sear; Scald; Scary Face; Scorching Sands

## REG-024 — Certify Scratch through Shadow Claw

Status: TODO

**Baseline-registered moves:** Scratch; Screech; Searing Shot; Seed Bomb; Seed Flare; Shadow Ball; Shadow Bone; Shadow Claw

## REG-025 — Certify Shadow Punch through Sludge Bomb

Status: TODO

**Baseline-registered moves:** Shadow Punch; Shadow Sneak; Shock Wave; Signal Beam; Slash; Sleep Powder; Sludge; Sludge Bomb

## REG-026 — Certify Sludge Wave through Steam Eruption

Status: TODO

**Baseline-registered moves:** Sludge Wave; Smart Strike; Smog; Snarl; Spark; Spirit Break; Spore; Steam Eruption

## REG-027 — Certify Stone Edge through Struggle (Freezer Physical)

Status: TODO

**Baseline-registered moves:** Stone Edge; Strange Steam; Struggle; Struggle (Firestarter Physical); Struggle (Firestarter Special); Struggle (Fountain Physical); Struggle (Fountain Special); Struggle (Freezer Physical)

## REG-028 — Certify Struggle (Freezer Special) through Struggle (Zapper Physical)

Status: TODO

**Baseline-registered moves:** Struggle (Freezer Special); Struggle (Guster Physical); Struggle (Guster Special); Struggle (Materializer Physical); Struggle (Materializer Special); Struggle (Telekinetic Physical); Struggle (Telekinetic Special); Struggle (Zapper Physical)

## REG-029 — Certify Struggle (Zapper Special) through Swords Dance

Status: TODO

**Baseline-registered moves:** Struggle (Zapper Special); Struggle Bug; Stun Spore; Supersonic; Swagger; Sweet Scent; Swift; Swords Dance

## REG-030 — Certify Synthesis through Thunder Punch

Status: TODO

**Baseline-registered moves:** Synthesis; Tackle; Tail Whip; Take Down; Taunt; Tearful Look; Teeter Dance; Thunder Punch

## REG-031 — Certify Thunder Shock through Vine Whip

Status: TODO

**Baseline-registered moves:** Thunder Shock; Thunderbolt; Tickle; Torment; U-Turn; Vacuum Wave; Vice Grip; Vine Whip

## REG-032 — Certify Water Gun through Yawn

Status: TODO

**Baseline-registered moves:** Water Gun; Water Pulse; Waterfall; Wildbolt Storm; Will-O-Wisp; Wing Attack; X-Scissor; Yawn

## REG-033 — Certify Zen Headbutt through Zing Zap

Status: TODO

**Baseline-registered moves:** Zen Headbutt; Zing Zap


---

## Phase 9 — Register every currently missing move

The 73 tickets below cover the baseline 518 missing moves exactly once. They are intentionally no larger than eight moves. Do not start a ticket until all capability blockers on its manifest rows are complete, even if the family-level dependency says the phase is ready.

### Shared cohort contract

Each MA-200–MA-272 ticket is one commit.

**Touch:** the reviewed v2 spec module(s) chosen by MA-034, any narrowly necessary registered server handler, `data/move-automation/manifest.json`, and ticket-specific semantic scenarios. Do not add mechanics to browser code or interpret canonical prose at runtime.

**For every move in the ticket:**

1. Compare the frozen canonical row/hash to the rule source and enumerate every branch in the spec or handler.
2. Use existing capabilities. If a reusable primitive is missing, stop and insert a machinery ticket before this cohort rather than hiding logic in a display note.
3. Add one golden scenario per move plus one for every alternate branch, trigger, random outcome class, unusual immunity, or multi-resource mutation.
4. Test server legality, effect plan, committed map/sheets/resources, trace, and any durable window.
5. Set runtime/version/spec hash, scenario IDs, and capability tags in the manifest.
6. Mark the row `complete` only with empty blockers, limitations, and manual steps.
7. Run the ticket scenarios, manifest validation, relevant planner/live-command tests, `npm run typecheck`, and `npm run check:move-automation -- --report`.

**Done for the ticket:** The semantic complete count rises by exactly the number of listed moves; registered/missing counts change by the same amount; no other move changes status; retry/reconnect tests exist where required.

### Basic targeting and area cohorts

**Start after:** MA-070–MA-095 and relevant MA-100–MA-114 reaction work.

## MA-200 — Implement Hyper Beam

Status: TODO

**Moves:** Hyper Beam

**Primary review emphasis:** Exhaust/action cost and ordinary damage.

## MA-201 — Implement Dark Void through Toxic

Status: TODO

**Moves:** Dark Void; Thunder Wave; Toxic

**Primary review emphasis:** Target legality, accuracy policy, status immunity.

## MA-202 — Implement Topsy-Turvy

Status: TODO

**Moves:** Topsy-Turvy

**Primary review emphasis:** Stage inversion and no-op behavior.

## MA-203 — Implement Chatter through Shell Side Arm

Status: TODO

**Moves:** Chatter; Dynamic Punch; Fiery Wrath; Fire Fang; Freeze-Dry; Freezing Glare; Ice Fang; Shell Side Arm

**Primary review emphasis:** Secondary conditions, Drown Out, type override, alternate stat/class selection.

## MA-204 — Implement Stomp through Thunder Fang

Status: TODO

**Moves:** Stomp; Thunder Fang

**Primary review emphasis:** Size/state predicate and secondary branches.

## MA-205 — Implement Blast Burn through Prismatic Laser

Status: TODO

**Moves:** Blast Burn; Eternabeam; Frenzy Plant; Hydro Cannon; Meteor Assault; Prismatic Laser

**Primary review emphasis:** Area damage plus Exhaust/cost timing.

## MA-206 — Implement Aeroblast through Fleur Cannon

Status: TODO

**Moves:** Aeroblast; Aromatherapy; Belch; Bug Buzz; Captivate; Diamond Storm; Draco Meteor; Fleur Cannon

**Primary review emphasis:** Area filters, cleanse, crit/stage/self-stage effects.

## MA-207 — Implement Gear Up through Leaf Tornado

Status: TODO

**Moves:** Gear Up; Glaciate; Haze; Heart Swap; Hyper Voice; Hyperspace Fury; Leaf Storm; Leaf Tornado

**Primary review emphasis:** Ally filtering, stage reset/swap, self costs, area outcomes.

## MA-208 — Implement Magnetic Flux through Psycho Boost

Status: TODO

**Moves:** Magnetic Flux; Meteor Beam; Moongeist Beam; Outrage; Overheat; Petal Dance; Photon Geyser; Psycho Boost

**Primary review emphasis:** Setup/execute, stat selection, repeated-use state, self stages.

## MA-209 — Implement Rototiller through Teatime

Status: TODO

**Moves:** Rototiller; Snore; Sparkling Aria; Springtide Storm; String Shot; Sunsteel Strike; Synchronoise; Teatime

**Primary review emphasis:** Grounded/condition/item/type filters and mixed recipients.

## MA-210 — Implement Thrash through Venom Drench

Status: TODO

**Moves:** Thrash; Uproar; Venom Drench

**Primary review emphasis:** Repeated-use lifecycle, sleep interaction, conditional stages.


### HP, healing, recoil, and direct-loss cohorts

**Start after:** MA-080–MA-086, MA-100–MA-114 where retaliation/choice is involved, and MA-150–MA-157 for item-linked healing.

## MA-211 — Implement Belly Drum through Dragon Energy

Status: TODO

**Moves:** Belly Drum; Bind; Brine; Chloroblast; Clamp; Clangorous Soul; Crush Grip; Dragon Energy

**Primary review emphasis:** HP costs, Vortex, HP-scaled DB, simultaneous self effects.

## MA-212 — Implement Drain Punch through Heal Pulse

Status: TODO

**Moves:** Drain Punch; Draining Kiss; Dream Eater; Eruption; Explosion; Giga Drain; Heal Order; Heal Pulse

**Primary review emphasis:** Drain/heal rounding, HP-scaled DB, self-KO, target restrictions.

## MA-213 — Implement Hold Hands through Milk Drink

Status: TODO

**Moves:** Hold Hands; Jungle Healing; Leech Life; Life Dew; Light of Ruin; Mega Drain; Metal Burst; Milk Drink

**Primary review emphasis:** Area heals, cleanse, recoil, retaliation window.

## MA-214 — Implement Mind Blown through Relic Song

Status: TODO

**Moves:** Mind Blown; Mystical Power; Oblivion Wing; Parabolic Charge; Pollen Puff; Purify; Recover; Relic Song

**Primary review emphasis:** Costs, mixed damage/heal branch, conditional heal/status/stage.

## MA-215 — Implement Self-Destruct through Water Spout

Status: TODO

**Moves:** Self-Destruct; Slack Off; Soft-Boiled; Steel Beam; Strength Sap; Submission; Toxic Thread; Water Spout

**Primary review emphasis:** Self-KO/cost, heal, drain/stat coupling, recoil, HP-scaled DB.

## MA-216 — Implement Wave Crash through Wring Out

Status: TODO

**Moves:** Wave Crash; Wrap; Wring Out

**Primary review emphasis:** Recoil, Vortex, target-HP DB.

## MA-217 — Implement Final Gambit through Super Fang

Status: TODO

**Moves:** Final Gambit; Flame Burst; Nature’s Madness; Night Shade; Pain Split; Seismic Toss; Super Fang

**Primary review emphasis:** Fixed/fraction/level HP, splash, equalization, immunity.


### Dynamic damage cohorts

**Start after:** MA-063, MA-074–MA-079, MA-158 for history-dependent rules.

## MA-218 — Implement Arm Thrust through Bolt Beak

Status: TODO

**Moves:** Arm Thrust; Autotomize; Barb Barrage; Barrage; Behemoth Bash; Behemoth Blade; Body Press; Bolt Beak

**Primary review emphasis:** Multi-hit, target state, special targets, alternate stat, acted order.

## MA-219 — Implement Bone Rush through Dragon Darts

Status: TODO

**Moves:** Bone Rush; Bonemerang; Bullet Seed; Comet Punch; Double Hit; Double Iron Bash; Double Slap; Dragon Darts

**Primary review emphasis:** Multi-hit count/accuracy/target distribution.

## MA-220 — Implement Dual Chop through Flail

Status: TODO

**Moves:** Dual Chop; Dual Wingbeat; Dynamax Cannon; Echoed Voice; Electro Ball; Façade; Fishious Rend; Flail

**Primary review emphasis:** Double hit, special target, chains, speed/status/order/HP expressions.

## MA-221 — Implement Fusion Bolt through Ice Ball

Status: TODO

**Moves:** Fusion Bolt; Fusion Flare; Gear Grind; Grass Knot; Gyro Ball; Heavy Slam; Hex; Ice Ball

**Primary review emphasis:** Paired-history, multi-hit, weight/speed/status/chain expressions.

## MA-222 — Implement Icicle Spear through Revelation Dance

Status: TODO

**Moves:** Icicle Spear; Infernal Parade; Judgment; Low Kick; Payback; Punishment; Retaliate; Revelation Dance

**Primary review emphasis:** Multi-hit, status/type/item, weight, order/history, stages.

## MA-223 — Implement Reversal through Stomping Tantrum

Status: TODO

**Moves:** Reversal; Rock Blast; Round; Scale Shot; Secret Power; Smelling Salts; Spike Cannon; Stomping Tantrum

**Primary review emphasis:** HP, multi-hit, ally/history, field, status, failed-action history.

## MA-224 — Implement Stored Power through Wake-Up Slap

Status: TODO

**Moves:** Stored Power; Tail Slap; Triple Axel; Triple Kick; Trump Card; Twineedle; Venoshock; Wake-Up Slap

**Primary review emphasis:** Stage DB, hit sequences, usage count, per-hit status, target condition.

## MA-225 — Implement Water Shuriken

Status: TODO

**Moves:** Water Shuriken

**Primary review emphasis:** Five-strike roll, per-hit outcomes, early KO.


### Field, weather, terrain, room, and hazard cohorts

**Start after:** MA-124 and MA-133–MA-145.

## MA-226 — Implement Acid Armor through Floral Healing

Status: TODO

**Moves:** Acid Armor; Aurora Veil; Blizzard; Camouflage; Court Change; Defog; Electric Terrain; Floral Healing

**Primary review emphasis:** Field predicates, side effects, weather accuracy, type choice, transfer/clear.

## MA-227 — Implement Geomancy through Ion Deluge

Status: TODO

**Moves:** Geomancy; Grassy Glide; Grassy Terrain; Gravity; Hail; Hurricane; Inferno; Ion Deluge

**Primary review emphasis:** Setup, terrain priority, movement/accuracy, weather, type overlay.

## MA-228 — Implement Magic Room through Shore Up

Status: TODO

**Moves:** Magic Room; Misty Explosion; Misty Terrain; Moonlight; Morning Sun; Rain Dance; Sandstorm; Shore Up

**Primary review emphasis:** Item suppression, terrain, self-KO, weather-dependent heal/weather.

## MA-229 — Implement Smokescreen through Thunder

Status: TODO

**Moves:** Smokescreen; Solar Beam; Solar Blade; Steel Roller; Sunny Day; Tailwind; Terrain Pulse; Thunder

**Primary review emphasis:** Zone sight, setup skip, terrain removal, initiative, contextual type/accuracy.

## MA-230 — Implement Trick Room through Zap Cannon

Status: TODO

**Moves:** Trick Room; Weather Ball; Wonder Room; Zap Cannon

**Primary review emphasis:** Delayed initiative, contextual type/DB, stat overlay, accuracy/status.

## MA-231 — Implement Barrier through Stone Axe

Status: TODO

**Moves:** Barrier; Ceaseless Edge; Fire Pledge; Grass Pledge; Spikes; Stealth Rock; Sticky Web; Stone Axe

**Primary review emphasis:** Zone geometry, side ownership, entry effects, layers.

## MA-232 — Implement Toxic Spikes through Water Pledge

Status: TODO

**Moves:** Toxic Spikes; Water Pledge

**Primary review emphasis:** Layers/grounded absorption and combined pledge zone.


### Persistent, marker, and delayed-effect cohorts

**Start after:** MA-056–MA-064, MA-080–MA-086, and relevant overlays in MA-158–MA-165.

## MA-233 — Implement Anchor Shot through Clear Smog

Status: TODO

**Moves:** Anchor Shot; Aqua Ring; Astral Barrage; Bitter Malice; Block; Burn Up; Charge; Clear Smog

**Primary review emphasis:** Trapping, recurring heal, fields/targets, type/effect state, stage clear.

## MA-234 — Implement Conversion through Electrify

Status: TODO

**Moves:** Conversion; Conversion2; Core Enforcer; Curse; Destiny Bond; Doom Desire; Double Team; Electrify

**Primary review emphasis:** Type/ability overlays, linked effects, KO reaction, delayed attack, evasion state.

## MA-235 — Implement Fire Spin through Healing Wish

Status: TODO

**Moves:** Fire Spin; Forest’s Curse; Future Sight; Gastro Acid; Glacial Lance; Guard Split; Headlong Rush; Healing Wish

**Primary review emphasis:** Vortex, type/ability overlay, delay, stat split, switch/KO heal.

## MA-236 — Implement High Horsepower through Lunar Blessing

Status: TODO

**Moves:** High Horsepower; Infestation; Laser Focus; Lash Out; Leech Seed; Light Screen; Lucky Chant; Lunar Blessing

**Primary review emphasis:** Vortex, next-hit crit, stage history, recurring drain, side effects, cleanse.

## MA-237 — Implement Lunar Dance through Octolock

Status: TODO

**Moves:** Lunar Dance; Lunge; Magma Storm; Mean Look; Mind Reader; Mist; Nightmare; Octolock

**Primary review emphasis:** Switch/KO heal, Vortex/trap, lock-on, side state, sleep-linked recurring state.

## MA-238 — Implement Perish Song through Roost

Status: TODO

**Moves:** Perish Song; Power Split; Psyshield Bash; Psyshock; Psystrike; Rage; Rest; Roost

**Primary review emphasis:** Countdown, stat split/selectors, persistent counters, sleep/heal, type overlay.

## MA-239 — Implement Safeguard through Spit Up

Status: TODO

**Moves:** Safeguard; Secret Sword; Sing; Snap Trap; Sonic Boom; Spider Web; Spirit Shackle; Spit Up

**Primary review emphasis:** Side immunity, alternate defense, Vortex/trap, direct HP, counter consumption.

## MA-240 — Implement Spotlight through Thunder Cage

Status: TODO

**Moves:** Spotlight; Stockpile; Substitute; Swallow; Sweet Kiss; Tar Shot; Thousand Waves; Thunder Cage

**Primary review emphasis:** Redirection, stacks, substitute HP, type overlay, trap/Vortex.

## MA-241 — Implement Trop Kick through Wish

Status: TODO

**Moves:** Trop Kick; Victory Dance; Water Sport; Whirlpool; Wish

**Primary review emphasis:** Stages, side/field effect, Vortex, delayed heal.


### Movement, switching, and positioning cohorts

**Start after:** MA-120–MA-132, MA-100–MA-114 for interrupted movement, and MA-133–MA-145 for movement-linked zones.

## MA-242 — Implement Avalanche through Defense Curl

Status: TODO

**Moves:** Avalanche; Baton Pass; Bounce; Brave Bird; Circle Throw; Close Combat; Cut; Defense Curl

**Primary review emphasis:** Setup/reaction, state transfer, semi-invulnerable, recoil, forced move, defense/DR.

## MA-243 — Implement Dig through Endeavor

Status: TODO

**Moves:** Dig; Dive; Double-Edge; Dragon Ascent; Dragon Rush; Dragon Tail; Earthquake; Endeavor

**Primary review emphasis:** Semi-invulnerable, recoil/stages, push/recall, area/ground state, HP set.

## MA-244 — Implement Fairy Lock through Flying Press

Status: TODO

**Moves:** Fairy Lock; False Swipe; First Impression; Flame Charge; Flare Blitz; Flip Turn; Fly; Flying Press

**Primary review emphasis:** Movement lock, min HP, first-turn legality, stages/recoil/switch, semi-invulnerable/type.

## MA-245 — Implement Focus Energy through Heat Crash

Status: TODO

**Moves:** Focus Energy; Freeze Shock; Giga Impact; Gust; Head Charge; Head Smash; Heal Block; Heat Crash

**Primary review emphasis:** Persistent crit, setup, Exhaust, push, recoil, heal suppression, weight DB.

## MA-246 — Implement Horn Leech through Mega Kick

Status: TODO

**Moves:** Horn Leech; Hydro Pump; Hyperspace Hole; Ice Burn; Imprison; Ingrain; Lock-On; Mega Kick

**Primary review emphasis:** Drain, push, setup, move-list lock, recurring state, target lock.

## MA-247 — Implement Megahorn through Psycho Shift

Status: TODO

**Moves:** Megahorn; Meteor Mash; Muddy Water; No Retreat; Parting Shot; Power Shift; Psychic; Psycho Shift

**Primary review emphasis:** Push/shift, mixed stages/conditions, switch, stat-value overlay, condition transfer.

## MA-248 — Implement Rapid Spin through Shift Gear

Status: TODO

**Moves:** Rapid Spin; Razor Wind; Revenge; Roar; Roar of Time; Rock Wrecker; Rollout; Shift Gear

**Primary review emphasis:** Cleanup/movement, setup, history, forced switch, Exhaust, chains, stages.

## MA-249 — Implement Skitter Smack through Steel Wing

Status: TODO

**Moves:** Skitter Smack; Skull Bash; Sky Attack; Sky Drop; Slam; Splash; Steamroller; Steel Wing

**Primary review emphasis:** Stages/setup, semi-invulnerable carried target, displacement/terrain interactions.

## MA-250 — Implement Strength through Volt Tackle

Status: TODO

**Moves:** Strength; Superpower; Surf; Surging Strikes; Triple Arrows; Twister; Volt Switch; Volt Tackle

**Primary review emphasis:** Chosen push, stages/area movement, guaranteed crit sequence, switch, recoil.

## MA-251 — Implement Whirlwind through Wood Hammer

Status: TODO

**Moves:** Whirlwind; Wicked Blow; Wild Charge; Wood Hammer

**Primary review emphasis:** Forced switch, guaranteed crit, recoil.


### Item and inventory cohorts

**Start after:** MA-150–MA-157 and MA-165 for item-driven type overlays.

## MA-252 — Implement Acrobatics through Multi-Attack

Status: TODO

**Moves:** Acrobatics; Bestow; Corrosive Gas; Covet; Embargo; Fling; Incinerate; Multi-Attack

**Primary review emphasis:** Held-state DB, give/steal/suppress/throw/destroy, contextual type.

## MA-253 — Implement Natural Gift through Stuff Cheeks

Status: TODO

**Moves:** Natural Gift; Pay Day; Pluck; Poltergeist; Power Trick; Recycle; Spectral Thief; Stuff Cheeks

**Primary review emphasis:** Berry/type/consume, ground money/item, target item, stat overlay, restore, steal stages, digest.

## MA-254 — Implement Switcheroo through Trick-or-Treat

Status: TODO

**Moves:** Switcheroo; Techno Blast; Thief; Trick; Trick-or-Treat

**Primary review emphasis:** Item swap/type, steal, type overlay; disambiguate Trick from Trick Room.


### Copy, random, move-list, and transformation cohorts

**Start after:** MA-158–MA-165, MA-100–MA-114 where a chosen/interrupting child is involved.

## MA-255 — Implement Assist through Guillotine

Status: TODO

**Moves:** Assist; Charge Beam; Copycat; Dire Claw; Eerie Spell; Encore; Fissure; Guillotine

**Primary review emphasis:** Random/copy child, random condition, usage mutation, move overlay, OHKO policy.

## MA-256 — Implement Hidden Power through Present

Status: TODO

**Moves:** Hidden Power; Horn Drill; Last Resort; Magnitude; Mimic; Mirror Move; Nature Power; Present

**Primary review emphasis:** Contextual type, OHKO, history prerequisite, random DB/effect, copied child.

## MA-257 — Implement Role Play through Tri Attack

Status: TODO

**Moves:** Role Play; Sheer Cold; Sketch; Skill Swap; Sleep Talk; Telekinesis; Transform; Tri Attack

**Primary review emphasis:** Ability overlays, OHKO, permanent list mutation, random child, spatial state, transform/random status.


### Reaction and interrupt cohorts

**Start after:** MA-100–MA-114 plus MA-120–MA-146 where reactions affect movement or fields.

## MA-258 — Implement Ally Switch through Counter

Status: TODO

**Moves:** Ally Switch; Assurance; Baneful Bunker; Beak Blast; Beat Up; Bide; Burning Jealousy; Counter

**Primary review emphasis:** Swap, history DB, shields/contact, setup, ally participants, stored/reflected damage.

## MA-259 — Implement Crafty Shield through Focus Punch

Status: TODO

**Moves:** Crafty Shield; Detect; Disable; Endure; Expanding Force; Feint; Flower Shield; Focus Punch

**Primary review emphasis:** Side/self guards, move overlay, survive-at-HP, field targeting, guard break, setup cancel.

## MA-260 — Implement Follow Me through Magic Coat

Status: TODO

**Moves:** Follow Me; Grudge; High Jump Kick; Instruct; Jump Kick; Kinesis; King’s Shield; Magic Coat

**Primary review emphasis:** Redirection, KO-trigger usage, miss recoil, nested instructed move, guard/reflect.

## MA-261 — Implement Mat Block through Powder

Status: TODO

**Moves:** Mat Block; Me First; Memento; Metronome; Mirror Coat; Obstruct; Phantom Force; Powder

**Primary review emphasis:** Guards, copied/random child, reflected damage, semi-invulnerable, trigger trap.

## MA-262 — Implement Protect through Shell Trap

Status: TODO

**Moves:** Protect; Psychic Terrain; Pursuit; Quick Guard; Rage Powder; Rising Voltage; Shadow Force; Shell Trap

**Primary review emphasis:** Guards, field reaction policy, switch interrupt, redirection, terrain DB, setup trigger.

## MA-263 — Implement Sky Uppercut through Wide Guard

Status: TODO

**Moves:** Sky Uppercut; Snatch; Spiky Shield; Spite; Sucker Punch; Teleport; Vital Throw; Wide Guard

**Primary review emphasis:** Semi-invulnerable target, steal/counter prompts, declared-action predicate, teleport/order, area guard.


### Complex closure cohorts

**Start after:** all machinery phases. Before each ticket, replace the heuristic `complex-review-needed` tag with precise capabilities in the manifest.

## MA-264 — Implement After You through Bug Bite

Status: TODO

**Moves:** After You; Agility; Amnesia; Ancient Power; Attract; Aura Wheel; Brick Break; Bug Bite

**Primary review emphasis:** Initiative, stages/random stages, linked condition, type/form, screen break, item consume.

## MA-265 — Implement Bulk Up through Cotton Guard

Status: TODO

**Moves:** Bulk Up; Calm Mind; Chip Away; Clanging Scales; Coil; Constrict; Cosmic Power; Cotton Guard

**Primary review emphasis:** Multi-stage/self-cost, defense ignore, target conditions.

## MA-266 — Implement Darkest Lariat through Foul Play

Status: TODO

**Moves:** Darkest Lariat; Defend Order; Dragon Dance; Entrainment; Fell Stinger; Fiery Dance; Foresight; Foul Play

**Primary review emphasis:** Defense ignore, stages, ability overlay, KO/history, target stat use, type/evasion state.

## MA-267 — Implement Frost Breath through Jaw Lock

Status: TODO

**Moves:** Frost Breath; Growth; Guard Swap; Hammer Arm; Harden; Ice Hammer; Iron Defense; Jaw Lock

**Primary review emphasis:** Guaranteed crit, weather stages, stage swap, self-stage, linked trap.

## MA-268 — Implement Magic Powder through Odor Sleuth

Status: TODO

**Moves:** Magic Powder; Magnet Rise; Meditate; Metal Claw; Minimize; Miracle Eye; Nasty Plot; Odor Sleuth

**Primary review emphasis:** Type/capability/size/evasion overlays and stages.

## MA-269 — Implement Ominous Wind through Quiver Dance

Status: TODO

**Moves:** Ominous Wind; Plasma Fists; Power Swap; Power-Up Punch; Psych Up; Psychic Fangs; Quash; Quiver Dance

**Primary review emphasis:** Random/self stages, type overlay, swaps/copy, screen break, initiative.

## MA-270 — Implement Reflect Type through Simple Beam

Status: TODO

**Moves:** Reflect Type; Refresh; Rock Polish; Sharpen; Shell Smash; Shelter; Silver Wind; Simple Beam

**Primary review emphasis:** Type/ability overlays, cleanse, multi-stage, random stages.

## MA-271 — Implement Smack Down through Take Heart

Status: TODO

**Moves:** Smack Down; Snipe Shot; Soak; Spacial Rend; Speed Swap; Storm Throw; Tail Glow; Take Heart

**Primary review emphasis:** Grounding, redirection exception, type overlay, crit, stat swap, cleanse/stages.

## MA-272 — Implement Thousand Arrows through Worry Seed

Status: TODO

**Moves:** Thousand Arrows; Throat Chop; Thunderous Kick; V-Create; Withdraw; Work Up; Worry Seed

**Primary review emphasis:** Grounding/type override, Sonic suppression, stages, ability overlay.


---

## Phase 10 — Migration, recovery, observability, documentation, and closure

## MA-280 — Carry encounter state through snapshots and patches

Status: TODO

**Depends on:** MA-050–MA-051
**Commit:** `feat(move-automation): synchronize encounter state`

**Touch:** live table snapshot contracts/use case, `shared/livePlayMoveState.ts`, `src/utils/livePlayPatches.ts`, snapshot sync composables, tests.

**Implement:** Include encounter state and pending public summaries in authoritative snapshots, map-change detection, accepted patches, reconciliation, and in-place map refresh. Preserve privacy and exact schema validation.

**Done:** A newly joined or reconciled client sees the same effects, sides, resources, zones, and pending prompts as the server.

## MA-281 — Add dual-read/single-write state migration

Status: TODO

**Depends on:** MA-133, MA-280
**Commit:** `feat(move-automation): migrate legacy combat state lazily`

**Touch:** map normalization/adapters, planner, tests.

**Implement:** Where existing hazards, field effects, active-order effects, temporary HP, move usage, or prompt metadata move into encounter state, read both old and new forms during the defined compatibility window but emit one canonical form on accepted writes. Reject conflicting dual representations; never double-apply.

**Done:** Existing campaigns cross the boundary without a bulk rewrite or revision churn on load.

## MA-282 — Preserve automation state through import/export and backup

Status: TODO

**Depends on:** MA-101, MA-281
**Commit:** `feat(move-automation): round trip encounter automation state`

**Touch:** map JSON import/export, SQLite migration/export scripts, repository/script tests, backup docs.

**Implement:** Round-trip encounter state and define an explicit pending-resolution export policy: resumable with its repository rows, or terminally abandoned with audit evidence. Reject unsupported future schema versions.

**Done:** JSON→SQLite→JSON and backup/restore cannot silently lose active rules state.

## MA-283 — Make response commands outbox-safe

Status: TODO

**Depends on:** MA-102–MA-107
**Commit:** `feat(move-automation): recover pending response commands`

**Touch:** live-play command outbox, recovery gate, operation status/abandonment paths, tests.

**Implement:** Journal declaration, choose, react, pass, force-resolve, and cancel commands with exact stable bodies/op IDs. Retrying uncertainty resends the exact body; changing a choice requires a new authorized response operation.

**Done:** Uncertain delivery cannot create a second window, reroll, or apply a response twice.

## MA-284 — Reconcile prompts after replay gaps and snapshots

Status: TODO

**Depends on:** MA-280, MA-283
**Commit:** `feat(move-automation): reconcile durable move prompts`

**Touch:** replay/snapshot sync and response panel composables, integration tests.

**Implement:** On gap/ahead recovery, adopt authoritative pending summaries, dismiss obsolete prompts, reopen only eligible current windows, and reject stale local answers.

**Done:** Disconnect/reconnect produces neither zombie prompts nor lost eligible prompts.

## MA-285 — Prove idempotency across HTTP, realtime, and status

Status: TODO

**Depends on:** MA-283–MA-284
**Commit:** `test(move-automation): prove terminal delivery idempotency`

**Touch:** resolve/response command, operation status, client patch adoption, and chaos tests.

**Implement:** Deliver the same pending and terminal results through HTTP, SSE replay, live SSE, and status polling in varied orders. Assert semantic counters, rolls, resources, history, lifecycle events, and presentation—not only revision.

**Done:** Every channel order converges once without reroll or duplicate presentation.

## MA-286 — Add deterministic multi-client chaos scenarios

Status: TODO

**Depends on:** MA-114, MA-166, MA-285
**Commit:** `test(move-automation): add multiplayer chaos coverage`

**Touch:** integration chaos harness/suites.

**Implement:** Cover same-target concurrent moves, disjoint moves, response races, actor disconnect, item/move-list cross-resource failure, stale revisions, movement interruption, initiative lifecycle retry, and lost terminal responses. Seed RNG and scheduling.

**Done:** Every case is one atomic success or a clean conflict; no partial resource set exists.

## MA-287 — Verify restart, authorization, and privacy

Status: TODO

**Depends on:** MA-282, MA-284
**Commit:** `test(move-automation): verify restart and prompt privacy`

**Touch:** restart integration tests, snapshot/replay filtering.

**Implement:** Restart with active effects and pending resolutions, reconnect GM/eligible/ineligible players, and inspect authorized replay. Test hidden maps/tokens, private move options, unrevealed rolls, and denied-event cursor progression.

**Done:** Recovery follows the documented resume/abandon policy and private state never reaches an ineligible client.

## MA-288 — Add development shadow planning for migrations

Status: TODO

**Depends on:** MA-034, MA-042–MA-044
**Commit:** `feat(move-automation): compare legacy and v2 plans in shadow mode`

**Touch:** planner orchestration, trace diagnostics, tests.

**Implement:** In development/test only, run selected v1 and v2 programs against the same immutable snapshot and seeded draws, compare normalized plans/traces, and commit only the manifest-selected runtime. Make it impossible for shadow mode to persist.

**Done:** A mismatch emits a sanitized diagnostic with no second mutation or resource spend.

## MA-289 — Extend safe command observability

Status: TODO

**Depends on:** MA-037, MA-105
**Commit:** `feat(move-automation): trace resolution lifecycle latency`

**Touch:** live-play command trace utilities, tests.

**Implement:** Record safe `PLANNED`, `WAITING_FOR_RESPONSE`, `RESUMED`, `COMMITTED`, `LIFECYCLE_APPLIED`, conflict, and recovery events with runtime/spec version, counts, and durations. Do not log target names, HP, private choices, raw sheets, or command bodies.

**Done:** A developer can distinguish rules planning, human wait, network uncertainty, stale conflict, and commit latency.

## MA-290 — Add move diagnostics to the latency debug panel

Status: TODO

**Depends on:** MA-289
**Commit:** `feat(move-automation): show move resolution diagnostics`

**Touch:** latency debug panel/component tests.

**Implement:** Show plan time, response wait, resume/commit time, total, runtime/version, retry/reconcile count, terminal outcome, and sanitized blocker/reason codes for recent operations.

**Done:** Slow or recovered moves can be diagnosed without developer tools and without exposing private mechanics.

## MA-291 — Enforce performance and payload budgets

Status: TODO

**Depends on:** MA-286, MA-289
**Commit:** `test(move-automation): enforce engine performance budgets`

**Touch:** performance fixtures/guardrails/docs and bounded parser tests.

**Implement:** Benchmark crowded area targeting, maximum legal multi-hit, nested move depth, many active zones/effects, large response option sets, lifecycle round transition, and trace serialization. Set explicit operation/target/event/trace/payload ceilings.

**Done:** The quality gate detects meaningful regressions while bounds reject pathological workloads before planning.

## MA-292 — Update architecture and data-model documentation

Status: TODO

**Depends on:** MA-281, MA-284
**Commit:** `docs(move-automation): document authoritative engine state`

**Touch:** `docs/architecture.md`, `docs/data-model.md`, `docs/live-play-authority.md`, `docs/live-play-batch-workflows.md`.

**Implement:** Document encounter state, side identity, spec/handler boundary, complete read sets, pending saga, atomic resource scopes, lifecycle timing, replay/reconciliation, restart, and privacy.

**Done:** Documentation describes shipped code and terminal states exactly, without hand-copying volatile coverage counts.

## MA-293 — Add the move-authoring contributor guide

Status: TODO

**Depends on:** MA-087, MA-292
**Commit:** `docs(move-automation): add contributor runbook`

**Touch:** new `docs/move-automation.md`, `CONTRIBUTING.md`, review guide.

**Implement:** Explain choosing spec versus handler, adding capability tags, authoring scenarios, hashes/provenance, branch evidence, status promotion, runtime selection, common failures, required commands, and why prose notes cannot satisfy completion.

**Done:** A contributor can add one move without reverse-engineering the entire resolver.

## MA-294 — Add operator recovery and manual QA runbooks

Status: TODO

**Depends on:** MA-287, MA-290
**Commit:** `docs(move-automation): add operator recovery runbook`

**Touch:** new move automation manual-QA doc, private-VPS live-play smoke docs.

**Implement:** Cover multi-browser canaries, pending/uncertain/conflicted states, GM cancel/correction, restart, replay gap, backup/restore, rollback, and privacy checks. Keep animation QA explicitly separate.

**Done:** An operator can recover one stalled resolution without editing SQLite or guessing which effects committed.

## MA-295 — Audit all 776 completion contracts

Status: TODO

**Depends on:** REG-001–REG-033, MA-200–MA-272, MA-287
**Commit:** `test(move-automation): audit canonical completion evidence`

**Touch:** manifest validator, scenario index, generated reports.

**Implement:** Verify every canonical branch declared by reviewed metadata has scenario evidence, every manifest hash matches, every capability is implemented, every move has zero manual steps/limitations, every referenced handler/spec exists, and every interaction exclusion is explicit.

**Done:** The only remaining non-complete row would fail with an actionable move/capability/scenario reason.

## MA-296 — Prove semantic 776/776 integrity

Status: TODO

**Depends on:** MA-295
**Commit:** `test(move-automation): require canonical semantic completeness`

**Touch:** manifest, canonical loader, strict coverage checker, sharded scenario runner if needed.

**Implement:** Require exactly 776 canonical rows, 776 complete, zero assisted, zero blocked, zero unknown/duplicate implementations, zero manual debt, and executable evidence for every declared branch.

**Done:** `npm run check:move-automation-complete` prints 776/776 from semantic status—not registry membership—and all scenarios pass with seeded RNG.

## MA-297 — Enable the strict completion gate

Status: TODO

**Depends on:** MA-296
**Commit:** `ci(move-automation): require all moves complete`

**Touch:** `scripts/quality-gate.sh`, `package.json`, `CONTRIBUTING.md`, checker tests.

**Implement:** Add the strict command to the canonical quality gate. Removing evidence, downgrading a move, adding manual debt, changing the frozen catalog, or breaking a spec hash must fail.

**Done:** The strict gate passes on the implementation commit and fails on intentional regression fixtures.

## MA-298 — Run final multiplayer, migration, and release acceptance

Status: TODO

**Depends on:** MA-297
**Commit:** `test(move-automation): complete release acceptance`

**Touch:** tests/runbooks only unless a separate defect ticket is required.

**Implement:** Run typecheck, full unit/integration suites, build, strict coverage, import/export/backup smoke, performance budgets, three-client conflicts, restart/reconnect, hidden-information checks, and the representative manual canary matrix.

**Done:** Every automated and manual gate is recorded as passing; defects found here are fixed in separate focused commits and acceptance is rerun.

## MA-299 — Retire v1 only after an observation window

Status: TODO

**Depends on:** a successful deployed release after MA-298, not merely a green branch
**Commit:** `refactor(move-automation): retire legacy automation runtime`

**Touch:** v1 adapter/registry/scripts, runtime selector, compatibility docs/tests.

**Implement:** After stored-map/operation audit and a defined release observation window, remove v1 execution and old-format writes. Preserve legacy reads for the documented backup compatibility window, or ship an explicit tested migration first.

**Done:** One authoritative runtime remains; old backups covered by policy are still readable; rollback does not require restoring deleted private state.

---

## Per-commit validation guide

Use the smallest useful loop while implementing:

```sh
npx vitest run <focused-test-files>
npm run typecheck
npm run check:move-automation -- --report
```

For changes to authority, persistence, read sets, pending resolutions, movement, inventory, initiative, or realtime recovery, also run the relevant server and integration suites. Before merging a phase boundary, run:

```sh
npm test
npm run build
bash scripts/quality-gate.sh
```

Do not run `check:move-automation-complete` as a required gate until MA-297. It is expected to fail while the queue is in progress.

## When a ticket reveals missing rules machinery

Do not solve it with a free-form note, hidden UI instruction, runtime prose parser, arbitrary state patch, or unregistered callback. Instead:

1. Add a stable capability ID and mark the affected moves blocked by it.
2. Insert a machinery ticket before the first affected cohort.
3. Implement the primitive with one representative scenario.
4. Add property/invariant coverage when the primitive is algorithmic.
5. Resume the cohort only after the capability is complete.

This keeps the final 776/776 claim meaningful and keeps each commit understandable in isolation.
