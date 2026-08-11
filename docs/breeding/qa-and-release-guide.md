# Breeding QA and release guide

## Release principle

Breeding acceptance proves authority, privacy, durability, and presentation together. A happy-path screenshot or one unit test is not sufficient. Every release candidate must retain the same app-owned references, strict contracts, transaction boundaries, role projections, campaign-clock semantics, and recovery behavior.

Use synthetic fixtures only. Do not copy a campaign database, export, cookie, auth state, Profile, Trainer document, parent identity, roll, option, consent record, or browser storage into test artifacts.

## Test layers

### 1. Source and semantic closure

Run:

```bash
npm run check:breeding-family-resolutions
npm run check:breeding-compiler
npm run check:breeding-retirement
npm run check:breeding-automation
```

These gates verify frozen source hashes, Family resolution, compiled registry determinism, all registered Breeding JSON, plan/scenario synchronization, runtime enum closure, contract hashes, implementation paths, and fixture identity. Unknown or unregistered artifacts fail the gate.

During the active plan use `npm run check:breeding-automation-plan`. Final closure uses `npm run check:breeding-automation-complete` only after all 90 tickets are done and the plan is archived.

### 2. Focused domain and storage tests

Run the smallest owning suite first with one worker:

```bash
npx vitest run path/to/test.ts --maxWorkers=1 --no-file-parallelism
```

Required evidence for a mutation normally includes:

- strict valid and malformed contract cases;
- current authorization and stale revision;
- server-issued option and persisted-randomness reuse;
- all-participant rollback injection;
- exact retry and identity collision;
- process restart reparse;
- second-connection contention where applicable;
- role projection omissions and restricted realtime publication;
- archive round trip if a durable row changes.

Do not rerun an already-passing broad suite unless its dependency surface changed.

### 3. Workshop component and Nuxt tests

For presentation changes, run the owning composable/component tests and Nuxt accessibility mount:

```bash
npx vitest run \
  tests/components/breedingWorkshopShell.test.ts \
  tests/components/breedingWorkshopActivityCards.test.ts \
  tests/components/breedingProjectWizard.test.ts \
  tests/components/breedingConsentCenter.test.ts \
  tests/components/breedingHatchDecisionFlow.test.ts \
  --maxWorkers=1 --no-file-parallelism

npx vitest run --config vitest.nuxt.config.ts tests/nuxt/BreedingWorkshopAccessibility.test.ts
```

Add the focused composable/route tests for any changed request or projection. Verify strict parser failure is visible as a safe error rather than rendering partially trusted data.

### 4. Performance release gates

Run:

```bash
npx vitest run \
  tests/shared/breedingPerformanceBudgets.test.ts \
  tests/server/breedingParentDiscovery.test.ts \
  tests/server/breedingCampaignClockBatch.test.ts \
  tests/server/breedingWorkshop.test.ts \
  --maxWorkers=1 --no-file-parallelism
```

The measured operation excludes fixture construction/module import and includes serialization/settlement. Verify exact maximum cardinality and one-over rejection. Do not warm work inside the timed interval or raise a ceiling to mask a regression.

### 5. Production-like acceptance

Run with no duplicate build, Vite, Vitest, or Playwright process:

```bash
npm run test:breeding-production-acceptance
```

Expected coverage:

- simultaneous GM and selected-Profile player views remain structurally private across file-database restart;
- one long skip processes a deterministic 100-Egg prefix and exact equal-target continuation;
- batch and hatch operation evidence survives process restart;
- source and recipient independently approve an Egg transfer;
- two SQLite hatch contenders produce exactly one accepted child;
- production Nitro serves desktop/mobile Workshop browser acceptance;
- axe reports no serious or critical findings;
- reconnect/reload creates no duplicate card or private persistence.

One mobile skip for the desktop-only explicit width matrix is expected because the mobile project has its own visual viewport coverage. Any other unexpected skip fails review.

### 6. Archive and migration acceptance

Run the archive contract, manager, release, and certification tests together:

```bash
npx vitest run \
  tests/shared/breedingArchiveContract.test.ts \
  tests/server/breedingArchiveManager.test.ts \
  tests/server/breedingArchiveReleaseAcceptance.test.ts \
  tests/server/breedingArchiveReleaseCertification.test.ts \
  --maxWorkers=1 --no-file-parallelism
```

Verify exact 64 MiB acceptance/one-byte rejection, complete evidence chains, exact current references, GM-bound atomic restore, empty new target, replay protection, restart integrity, migration source hashes, quarantine-only map metadata, and executable out-of-place orphan repair.

### 7. Security and resilience acceptance

Run the certification suites when routes, authority, privacy, transactions, retries, or persistence change:

```bash
npx vitest run \
  tests/server/breedingSecurityCertification.test.ts \
  tests/server/breedingResilienceCertification.test.ts \
  tests/server/breedingRequestBody.test.ts \
  tests/server/breedingWriteRateLimit.test.ts \
  --maxWorkers=1 --no-file-parallelism
```

Confirm 32 KiB ingress, role/Profile/Trainer authorization, dual consent, structural privacy, 30/120 write admission, bounded repositories, durable evidence, failure injection, stale races, and silent exact retry.

### 8. Integrated closure

At the final BR-090 milestone, run one bounded validation process at a time:

```bash
npm run typecheck
npm run lint
npm test
npm run test:nuxt
npm run test:e2e
npm run build
bash scripts/quality-gate.sh
```

Do not run these concurrently. If an OOM occurs, stop duplicate validators, inspect active processes, and resume one bounded command. Record known unrelated baseline failures separately; never classify a new changed-file failure as baseline.

## Manual GM/player matrix

Use synthetic Trainers, parents, Projects, and Eggs. Test both desktop and mobile where presentation is involved.

| Scenario | Player expectation | GM expectation | Forbidden outcome |
| --- | --- | --- | --- |
| No selected Profile | Profile-required state; no Trainer facts | Not applicable | Campaign Trainer enumeration to player |
| Linked Trainer empty | Safe empty Workshop | Same owner context visible | Aggregate IDs or mechanics in shell response |
| Stale linked Trainer | Safe unavailable context | Current directory reflects actual rows | Browser infers/recreates missing Trainer |
| Same-owner Project | Current parents and non-mutating review | Current bounded diagnostics | Project creation advances time or creates Egg |
| Cross-owner Project | Each participant sees only own parent/consent | Setup/recovery status; no consent substitution | Other parent identity/mechanics before consent |
| Pending operation | Recovery message and refresh only | Authorized recovery evidence/status | Ordinary mutation controls remain active |
| Ready Egg | Current Box/team offers | Same plus GM-only special review if triggered | Client chooses destination kind without option |
| Transfer offer | Own source or recipient action only | No participant impersonation | Ownership changes before both positive consents |
| Reconnect/reload | Current projection replaces stale state | Current strict GM projection | Duplicate cards, redraw, or private local storage |
| Shared display | Owner/public-safe presentation | GM diagnostics kept off shared display | CSS-only privacy or raw IDs |

## Campaign-clock QA matrix

Check these boundaries explicitly:

- zero elapsed interval produces no duplicate credit;
- 239/240 initial minutes transition only at the exact threshold;
- DC 12 check uses one persisted d20 and exact retry reuses it;
- additional time begins only after success;
- 239/240 additional minutes transition only at the exact threshold;
- Egg readiness occurs at exact target minute and retains overflow separately;
- paused intervals record skipped time;
- provider credit remains operation- and cooldown-bound;
- 100/101 due Eggs require deterministic continuation;
- equality at consent/offer expiry is expired;
- backward or browser-time advancement is rejected/ignored;
- restart preserves last-applied clock revision/minute and child prefix.

## Consent and privacy QA

For each audience—public, owner, participating owner, GM, diagnostic—assert fields that must be absent, not merely hidden. Search serialized projections, realtime rows, browser DOM, requests, and local storage for:

- Profile IDs and linked-character data;
- counterpart Trainer/parent identity;
- raw Project/Egg IDs where the schema uses coarse identity;
- provider instances, parameter values, commands, scopes, read sets, receipts, overrides, rolls, and adjudication evidence;
- unissued options and private mechanics;
- cookies, tokens, campaign paths, or exports.

Project participant consent and Egg transfer consent must be tested separately. Test revocation, expiry equality, stale revision, current Profile drift, pending recovery, exact replay, and GM non-substitution.

## Hatch atomicity QA

After accepted hatch, assert exactly:

- one initialized Pokémon child sheet at revision zero;
- one current Trainer Box/team link and no duplicate roster link;
- one terminal Egg successor linked to that child;
- one lineage origin;
- one first `(Trainer, Species)` acquisition fact where absent;
- at most one Dex Exp increment for that first fact;
- all starting-Level inheritance checkpoints settled gap-free;
- one terminal operation result;
- the expected restricted realtime rows.

Inject failure after each participant and require all phase-two rows to roll back. Retain only valid phase-one evidence. Two stale contenders must converge to one winner.

## Accessibility and responsive QA

Follow `docs/breeding/accessibility-responsive-and-table-distance.md`. Minimum checks include:

- 320, 390, 768, and 1440 CSS-pixel widths;
- 200% and 400% zoom/reflow;
- no essential horizontal overflow;
- keyboard-only wizard and native radio selection;
- modal focus entry, containment, Escape, and restoration;
- semantic headings, status, alert, progress, and error names;
- 44 CSS-pixel touch targets;
- reduced-motion equivalence;
- text beyond colour/motion;
- shared-display readability and private-field omission;
- desktop/mobile visual baselines within reviewed tolerance.

A visible UI change must follow `.pi/skills/ui-design-workflow/SKILL.md`; substantive visual work requires a target-state mockup unless explicitly excluded by the skill.

## Documentation QA

Run the BR-088 closure test and checker:

```bash
npm run check:breeding-documentation
npm run check:breeding-automation
```

The closure verifies contributor, operator, GM/player, API, data-model, campaign-clock, and QA documents, exact routes, runtime vocabularies, commands, cross-links, and prohibited alternate authorities. Update docs in the same change as a route, request, lifecycle, schema, clock, recovery, consent, privacy, or release-command change.

## Release evidence record

Record:

- commit and ruleset/source/semantic hashes;
- schema and migration parity result;
- focused and integrated commands with file/test counts;
- production browser project counts and expected skips;
- performance and archive boundary results;
- checker, lint, typecheck, build, and quality-gate result;
- any known unrelated warning or external blocker;
- confirmation that fixtures are synthetic and no private campaign artifact was generated.

Do not record raw campaign payloads, identities, options, rolls, consents, exports, cookies, or auth state.

## Expected nonfatal build warnings

The current production build may report plugin timing, chunks over 500 kB, and unresolved external `node:sqlite` warnings. They are not waivers for a failed build or runtime endpoint. Investigate any new warning, changed chunk behavior, missing server external, browser console error, network error, or hydration mismatch.

## Sign-off rule

A ticket checkpoint is not whole-plan completion. BR-090 may mark production-authoritative only after every ticket is `DONE`, scenario coverage is closed, the plan is archived, production-like acceptance and backup/restore proof are current, manual authority paths are retired, and `scripts/quality-gate.sh` passes.
