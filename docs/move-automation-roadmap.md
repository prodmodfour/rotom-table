# Move automation roadmap

This roadmap records the mechanic-first implementation order for PTU move automation. It is intentionally separate from the heuristic worklist report: the worklist can suggest places to inspect, but it does not decide what becomes automated.

## Current coverage snapshot

As of this audit:

| Count | Value |
| --- | ---: |
| Canonical valid moves | 776 |
| Explicit scripts | 254 |
| Missing scripts | 522 |

`npm run check:move-automation` is expected to fail while any canonical move is missing an explicit reviewed script. Canonical move data, derived helpers, or report buckets must not count as automation coverage by themselves.

## Phase plan and current status

| Phase | Scope | Current status | Notes |
| --- | --- | --- | --- |
| 0 — foundation and guardrails | explicit registry; coverage check; report/worklist; module split / anti-god-file structure | Done | `src/utils/move-automation/registry.ts` is the explicit allow-list, `scripts/check_move_automation_coverage.py` enforces coverage, report/worklist tooling exists, and reviewed families live under `src/utils/move-automation/scripts/`. |
| 1 — high-volume low-risk target effects | plain single-target damaging moves; single-target status-only moves; single-target target-stage moves; simple damaging moves with target secondary condition; simple damaging moves with target secondary stage change | In progress | Many reviewed single-target scripts exist. Powder-keyword Grass immunity and Groundsource grounded suppression markers are now supported. Drown Out reaction/cancel support is still not modeled. Human review must choose exact move lists. |
| 2 — area and multi-target moves | plain area damage; area status/stage effects; supported multi-template area alternatives only when all legal branches are represented; no mixed single-target-or-area moves until mixed-mode targeting exists | In progress / blocked by missing mixed-mode support | Reviewed area confirmation/stage/condition/pass scripts exist. Mixed single-target-or-area moves remain blocked until both branches can be represented. |
| 3 — HP manipulation and damage variants | healing; drain; recoil; HP costs; fixed/direct HP loss; dynamic Damage Base; multi-strike variants | In progress / partially blocked by engine support | Some explicit scripts cover examples such as healing, direct HP loss, and multi-strike variants. Full HP-cost, recoil, dynamic-DB, and contextual damage support remains incomplete. |
| 4 — field and map state | weather; terrain; rooms; hazards; barriers/smoke/field geometry | Not started / blocked by missing persistent field-map support | Do not automate weather, terrain, room, hazard, barrier, or smoke moves as note-only scripts. |
| 5 — persistent token-side markers and delayed effects | coats; blessings; vortexes; seeded states; delayed triggers; beginning/end-of-turn processing | In progress / blocked by missing turn-processing support | Some token markers exist, but delayed triggers and beginning/end-of-turn processing are not complete enough for note-only coverage. |
| 6 — movement and positioning | push/pull; dash/pass; teleport; switch places; recall/send-out; semi-invulnerable movement states | In progress / blocked by missing movement-effect support | Pass-style area targeting exists for reviewed moves. Push, pull, teleport, recall/send-out, and semi-invulnerable movement states need engine support before broad automation. |
| 7 — items and inventory | held item mutation; thrown/dropped items; berries; item suppression/removal | Blocked by missing engine support | Do not represent item mutation as automation through manual notes only. |
| 8 — copy/random/move-list mutation | Metronome; Assist; Copycat; Mimic; Mirror Move; Sketch; Transform; Instruct; Nature Power; move-list mutation | Not started / blocked by missing engine support | These require move-list mutation, random selection, or copied-script execution support. |
| 9 — reactions, interrupts, shields | Protect/Detect-like shields; Counter/Mirror Coat/Bide; triggered/reaction timing; pending response windows | Not started / blocked by missing engine support | These require pending response windows and interrupt/reaction timing before automation coverage can be counted. |

## Rules for future implementation prompts

- Implementation agents do not choose what to automate.
- A human reviewer chooses the exact move list for each implementation batch.
- The worklist report is advisory only; it is not the phase plan and not an automation generator.
- Every move must remain explicitly reviewed by name before it counts as automated.
- Do not count canonical derived data as automated coverage.
- Do not use manual-note-only automation for missing legal branches.
- Do not automate mixed single-target-or-area moves unless both legal branches are represented.
- Do not add new scripts in the compatibility barrel `src/utils/moveAutomation.ts`; it should remain a barrel.
- Do not create god files. Keep reviewed move-family modules under `src/utils/move-automation/scripts/` or split them further by mechanic when needed.
- Do not weaken the coverage check. Missing canonical scripts must continue to fail `npm run check:move-automation` until coverage is complete.

## Phase 1 audit

The current Phase 1 audit lives in [`docs/move-automation-phase-1-audit.md`](./move-automation-phase-1-audit.md). The current approved Phase 1 mini-batch has been applied; Spore and Earth Power are now automated after keyword-immunity foundation work, while Chatter remains deferred until Drown Out reaction/cancel support exists. The audit classifies missing Phase 1-looking moves using the explicit rules in this roadmap and marks later-phase-looking moves as deferred instead of allowing the worklist to drive one-off implementation.
