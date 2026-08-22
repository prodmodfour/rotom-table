# Guided onboarding final alpha acceptance (P9-100)

- Date: 2026-08-20
- Plan: `implementation-plans/done/CHARACTER_CREATION_AND_CAMPAIGN_ONBOARDING_PLAN.md`
- Status: **all 100 tickets DONE; plan archived**

## Zero-to-first-encounter evidence

`tests/e2e/onboarding-first-slice.spec.ts` (chromium + mobile-chromium, production build, fresh campaign root) certifies the complete golden journey in one run:

1. GM publishes an immutable policy version in the policy editor.
2. GM opens a slot creating profile + durable draft together.
3. The player resumes from the onboarding home and completes every guided decision (identity, stats, background, Training Feature, Edges with subchoices, Features/classes, starter species/nature/gender/ability/moves/stats) with live validation and derived previews.
4. Submission freezes immutable snapshot #1.
5. GM requests changes with stable reasons + comment + GM-only note; the player sees the request (never the private note) and resubmits (#2).
6. GM applies a bounded correction (starter rename) requiring acknowledgement; approval stays blocked until the player acknowledges (#3).
7. Approval re-authorizes everything and atomically creates the trainer sheet, starter sheet, team, money, profile links, provenance, and dual-audience completion events; the sheets open as ordinary library documents with runtime-derived values equal to the fixture expectations.
8. The GM stages a battlefield with sides and places the party through the explicit join workflow (side-assigned placements, revision-checked).
9. In live-play mode **the player performs a legal first action** — an authoritative token-move command accepted under profile-linked control — with zero manual edits, raw IDs, or relinking.
10. The player's Campaign dashboard shows the ready state.

`tests/e2e/onboarding-acceptance.spec.ts` (both projects) certifies: zero serious/critical Axe violations on the queue, policy editor, player home, and builder; keyboard-only decision navigation and steppers; 320 px reflow with no horizontal page scrolling; and stale-tab reconciliation without lost-update corruption.

## Validation inventory

| Command | Result |
| --- | --- |
| `npm run lint` | 0 errors |
| `npm run typecheck` | clean |
| `NODE_OPTIONS=--max-old-space-size=4096 npm run build` | clean production build |
| `npx vitest run` (full repository, bounded workers) | 11,116 tests passing after reviewed re-pins |
| `npx playwright test --config=playwright.onboarding-reuse.config.ts` (both projects) | 4/4 passing |

Focused onboarding suites: contract gates (27), commit plan/realtime (7), repository (7), workflows (8), approval/commit (6), corrections (3), intake (4), encounter join (4), reopen/privacy (6 files' guards), performance budgets (4), presets (3), backup/variants (6), coverage certifier (3), plus the Phase 1 inventory/fixture certifiers.

## Canonical authority closure

- 38 inventoried creation decisions all carry rubric states with evidence and tests (`data/onboarding/creation-rule-coverage.json`); zero `blocked` rows.
- All four data defects (DATA-ONB-001..004) resolved through the reviewed, source-hash-bound `Character Creation` rule migration (`rule-data-character-creation-mechanics-v1` in `data/complete-play-loop/canonical-data-remediation.v1.json`, transcription `scripts/reviewed-data/character-creation.v1.json`), chained into every dependent evidence contract and the breeding source-succession checker.
- The compiled creation catalog fingerprints every consumed source; drift blocks submission and approval.

## Remaining recorded boundaries (not debt)

- Whole-map party placement is setup-mode-only by platform design; live scenes use the certified in-play token tools (explicitly reported by the join workflow).
- Equipment-slot grant packages are outside policy schema v1; packages grant canonical stackable items and starter held items.
- Player profiles remain campaign-root JSON; approval orders profile-link application after the SQLite commit with journaled reconciliation (`profileLinksApplied`), certified by the interrupted-link retry test.
