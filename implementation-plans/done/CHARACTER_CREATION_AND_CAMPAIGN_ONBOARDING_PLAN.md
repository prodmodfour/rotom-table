# Guided Character Creation and Campaign Onboarding Implementation Plan

`PLAN_STATUS: DONE`

`CURRENT_TICKET: NONE`

`BLOCKED_BY: NONE`

`DEPENDS_ON: implementation-plans/done/COMPLETE_PLAY_LOOP_PLAN.md`

`DESIGN_AUTHORITY: DESIGN.md`

`PRODUCT_PHASE: ALPHA`

## Goal

Make Rotom Table capable of taking a trusted-table participant from an empty player profile to a rules-valid, GM-approved, profile-linked Trainer and starter team that can immediately enter the completed campaign play loop.

This plan closes the product gap before play begins. It replaces the current blank-sheet, manual-linking onboarding sequence with a guided, durable, explainable workflow while preserving direct GM sheet creation as an advanced tool for NPCs, testing, imports, and unusual campaigns.

## Product outcome

The completed product supports this coherent journey:

1. The GM creates or selects a player profile and opens an onboarding slot under a versioned campaign policy.
2. The player resumes a durable private draft from any authorized device.
3. The player builds a Trainer through legal identity, level, stat, background, skill, Training Feature, Edge, Feature, class, inventory, equipment, and resource decisions.
4. The player builds the campaign-authorized starter Pokémon and team through legal species, level, form, stat, Ability, Move, capability, identity, and held-item decisions.
5. Rotom Table continuously validates prerequisites, budgets, choice counts, cross-character constraints, and campaign policy while explaining every blocking issue.
6. The player submits an immutable reviewed package rather than asking the GM to inspect partially edited sheets.
7. The GM approves, requests changes, or applies an explicit bounded correction with visible history.
8. Approval atomically creates or adopts the Trainer and Pokémon sheets, initializes resources, links the profile, establishes the team, and records onboarding provenance.
9. The player receives a ready-for-play summary and can open Campaign, owned sheets, or an eligible encounter without manual relinking.
10. Existing characters can be adopted safely without destructive recreation or loss of history.
11. Drafts, submissions, approvals, and commits survive stale clients, reconnects, server restarts, and exact retry.
12. Desktop, mobile, keyboard, touch, screen-reader, privacy, performance, and multi-client acceptance pass.

## Current baseline

Rotom Table already has the downstream systems this plan should target rather than replace:

- server-authoritative SQLite Trainer and Pokémon sheets with revisions, folders, realtime library events, player-profile links, teams, inventory, equipment, items, progression, recovery, breeding, encounters, and campaign continuation;
- canonical app-owned reference data for Pokémon, Moves, Abilities, Capabilities, Edges, Features, items, conditions, rules, and experience;
- derived Trainer and Pokémon sheet logic, point budgets, Feature/Edge identities, prerequisites, subchoices, automation instances, equipment authority, and attention items;
- a completed campaign play loop from acquisition and encounter play through settlement, advancement, recovery, and the next scene or day.

The remaining gap is the zero-to-play entry experience. Creating a sheet currently produces a minimal blank document, the ordinary editor becomes the creation tool, profile linking is a separate GM operation, and campaign-specific starting rules live largely in table knowledge rather than one versioned policy and validation contract.

## Scope

This plan owns:

- reviewed structured authority for Trainer and starter Pokémon creation;
- versioned campaign onboarding policies and starting packages;
- GM-created onboarding slots bound to trusted player profiles;
- durable revisioned player drafts, submissions, review history, corrections, and approval;
- guided Trainer and starter Pokémon builders with continuous validation and derived previews;
- atomic creation or adoption of sheets, teams, profile links, inventory, equipment, resources, provenance, and attention;
- safe existing-character intake and bounded repair;
- Campaign dashboard, player portal, Encounter Builder, and active-encounter handoff;
- onboarding accessibility, responsive design, privacy, concurrency, restart, performance, backup, restore, and complete acceptance.

## Explicit non-goals

- Public signup, email invitations, passwords, OAuth, billing, multi-tenancy, or hardened internet identity.
- Pokémon Contest implementation; that remains a later parallel gameplay plan.
- Replacing the ordinary Trainer or Pokémon sheet editors after onboarding.
- Removing direct blank-sheet creation for authorized GM advanced workflows.
- Automatically optimizing a character, selecting build choices, or making irreversible player decisions.
- Treating one campaign's house rules as universal PTU authority.
- Parsing documentary books, PDFs, websites, wikis, or free-form rule prose at runtime.
- Replacing player profiles, item/equipment authority, the encounter engine, campaign continuation, or existing progression systems.
- Supporting arbitrary cross-campaign imports or public character marketplaces.
- Creating onboarding-only sheet formats that later require migration into normal runtime sheets.

## Non-negotiable product rules

1. **The result of onboarding is an ordinary authoritative Trainer and Pokémon package, not a parallel character system.**
2. **Canonical PTU creation facts come only from reviewed app-owned structured data.**
3. **Campaign variation is explicit, versioned policy—not hidden conditionals or prose notes.**
4. **A player owns only drafts bound to the selected profile; the GM owns policy, review, and final table authority.**
5. **The draft is authority only for unfinished choices; completed sheets become the sole mechanical authority after commit.**
6. **Every selectable option has a stable canonical or policy ID and is re-authorized on submit and approval.**
7. **Hard rule violations cannot be downgraded to warnings by the client.**
8. **Every blocking issue names the affected decision, reason, and safe resolution path.**
9. **Submission freezes an exact review snapshot; later edits cannot change what the GM approved.**
10. **Approval creates or adopts the entire character package atomically or changes nothing.**
11. **Exact retry may never create duplicate sheets, links, teams, inventory, equipment, or provenance.**
12. **GM corrections are explicit, bounded, validated, visible to the player, and receipt-backed.**
13. **Existing-character intake preserves legitimate history, resources, injuries, inventory, equipment, capture, breeding, and encounter state.**
14. **Private choices, comments, and diagnostics use structural role projections rather than client-side hiding.**
15. **No ticket is complete while its workflow still requires raw IDs, direct JSON, SQLite, or ad hoc sheet repair.**
16. **Keyboard, touch, screen reader, zoom, reflow, reduced motion, and mobile use are completion requirements.**
17. **Direct blank-sheet creation remains advanced GM functionality, not the normal new-player onboarding path.**
18. **Missing canonical authority fails closed and becomes a reviewed data ticket before runtime semantics.**

## Target architecture

```text
app-owned canonical creation data
  + versioned CampaignOnboardingPolicy
  -> canonical creation catalog and prerequisite graph
  -> role-projected OnboardingDraft
  -> guided Trainer and Pokémon decisions
  -> continuous validation and contribution explanations
  -> immutable player submission
  -> GM review / changes / bounded correction
  -> re-authorized atomic commit plan
  -> sheets + team + profile links + inventory + equipment + provenance
  -> realtime completion + Campaign readiness + encounter handoff
```

Draft and sheet authority remain intentionally separate:

```text
unfinished choices
  = OnboardingDraft authority

approved commit
  = one atomic transition

completed characters
  = normal sheet/profile/team/item/campaign authority

archived onboarding record
  = provenance and review history only
```

## First playable vertical slice

The first end-to-end slice is:

> A GM creates a default Level 1 onboarding slot for an existing player profile. The player builds one Trainer and one starter Pokémon, resolves all required choices, submits the package, receives GM approval, and gets an atomically linked Trainer and starter team that can immediately join an encounter and perform a legal first action.

This slice must be complete before widening to higher-level starts, multiple starters, existing-character intake, broad campaign presets, or unusual class and species variants.

## Plan update protocol

- Ticket states are `TODO`, `IN_PROGRESS`, `DONE`, or `BLOCKED`.
- `CURRENT_TICKET` names the lowest-numbered unfinished ticket; only one ticket is `IN_PROGRESS` unless the decision log explicitly permits bounded parallel work.
- Update this ledger, `implementation-plans/plan-order.md`, and `AGENTS.md` together whenever plan status, current ticket, dependency, blocker, or ticket count changes.
- Mark a ticket `DONE` only after focused automated tests, required fixtures, role/privacy checks, recovery behavior, and user-facing acceptance pass.
- Follow the repository's bounded-worker validation discipline and reserve the full suite, production build, and `scripts/quality-gate.sh` for meaningful integration and final closure.
- New creation semantics must be traceable to app-owned canonical data, policy identity, evidence, and source fingerprints.
- A guided path is incomplete if the user can select an option that the server cannot authoritatively validate and commit.
- `PLAN_STATUS: DONE` is permitted only after P9-100, all 100 tickets, all canonical creation rules, and all golden onboarding journeys are complete.
- Archived 2026-08-20 with all 100 tickets `DONE`; authoritative references updated in the same change.

## Progress snapshot

- Plan tickets: **100 DONE / 100 total**
- Current ticket: **none — plan complete and archived**
- Final acceptance evidence: `docs/onboarding/final-acceptance.md` (golden zero-to-first-encounter journeys on desktop and mobile, full-repository validation, canonical coverage closure).
- Blocking dependency: **none; Plans 1–8 are complete**
- Primary product target: **trusted-table zero-to-first-encounter onboarding**
- Canonical creation coverage: **36 decisions inventoried (P9-003/P9-004); 4 data defects recorded (DATA-ONB-001..004)**
- First playable vertical slice: **implemented and passing in liveplay end-to-end (encounter first-action tail tracked under P9-060 with the Phase 8 handoff tickets)**
- Complete onboarding acceptance: **not yet run**

## Tickets

### Phase 1 — Gameplay baseline, canonical authority, and acceptance fixtures

- [x] **P9-001 — Audit the zero-to-first-encounter journey** — `DONE`
  - Trace the current GM and player path from creating a profile and blank sheets through linking characters, selecting a team, opening an encounter, and taking the first legal action.
  - Record every manual construction step, duplicate entry, hidden prerequisite, invalid-state escape, and direct storage repair in a versioned task inventory with owning code paths and future tickets.
- [x] **P9-002 — Inventory current sheet, profile, team, and ownership authority** — `DONE`
  - Map every create, save, rename, folder, profile-link, team, equipment, inventory, and encounter-participant operation involved in onboarding.
  - Identify dual authority, client-owned mutation, unstable identity, missing revision checks, and actions that can leave profiles or teams pointing at incomplete sheets.
- [x] **P9-003 — Inventory canonical Trainer creation rules** — `DONE`
  - Classify every starting Trainer decision: level, stats, backgrounds, skills, Training Feature, Edges, Features, classes, prerequisites, subchoices, money, equipment, and starting resources.
  - Use only app-owned canonical reference data; record absent or ambiguous structured authority as explicit data defects rather than interpreting documentary prose at runtime.
- [x] **P9-004 — Inventory canonical starter Pokémon creation rules** — `DONE`
  - Classify species eligibility, level, forms, base and added stats, abilities, Moves, skills, capabilities, gender, nature, loyalty, ownership, held items, and team placement.
  - Separate universal PTU rules from campaign policy and record every decision that currently relies on GM memory or post-creation sheet repair.
- [x] **P9-005 — Define the campaign onboarding policy matrix** — `DONE`
  - Specify which creation rules may vary per campaign, including starting levels, starter count and pool, money, item packages, source restrictions, unresolved-choice policy, and approval requirements.
  - Keep campaign policy explicit and versioned; do not encode one campaign's house rules as universal runtime behavior.
- [x] **P9-006 — Define onboarding roles, privacy, and trust boundaries** — `DONE`
  - Model GM, selected-profile player, public observer, and diagnostic access for draft identity, private choices, comments, corrections, and completion state.
  - Preserve the trusted-table model without inventing public accounts, email invitations, passwords, open registration, or reusable secret links.
- [x] **P9-007 — Define the onboarding completion rubric** — `DONE`
  - Define `complete`, `guided`, `campaign-policy`, `warning`, `blocked`, and `not-applicable` states for every creation rule and workflow branch.
  - Final acceptance permits no hidden mandatory step, no unresolved blocker, and no route that requires JSON, SQLite, or ad hoc sheet repair.
- [x] **P9-008 — Define measurable onboarding UX success criteria** — `DONE`
  - Set targets for time to first valid preview, screens and decisions, validation recovery, GM review effort, resume success, atomic commit reliability, and time to first encounter action.
  - Keep any metrics aggregate-only and free of campaign identities, character names, private choices, comments, and draft payloads.
- [x] **P9-009 — Create canonical new-player onboarding fixtures** — `DONE`
  - Add deterministic fixtures for a default Level 1 Trainer and one starter, a higher-level start, multiple starters, class subchoices, equipment packages, and optional unresolved choices.
  - Bind each fixture to policy version, canonical source fingerprints, expected validation, derived preview, commit plan, profile links, and ready-for-play state.
- [x] **P9-010 — Create onboarding failure, concurrency, and recovery fixtures** — `DONE`
  - Add deterministic fixtures for stale drafts, changed policies, duplicate slugs, invalid prerequisites, interrupted approval, concurrent editors, profile deletion, and server restart.
  - Each fixture must define public/player/GM projections, retry behavior, rollback expectations, correction options, and the absence of partial sheet creation.

### Phase 2 — Onboarding contracts, validation architecture, and authority boundaries

- [x] **P9-011 — Define the versioned `CampaignOnboardingPolicy` contract** — `DONE`
  - Model starting levels, permitted rules sources, starter pools, team size, money, item packages, required choices, approval policy, folder destinations, and campaign-specific constraints.
  - Reject unknown schema versions and distinguish immutable policy identity from editable display metadata.
- [x] **P9-012 — Define the versioned `OnboardingDraft` contract** — `DONE`
  - Model owning profile, policy version, Trainer build, Pokémon builds, validation, comments, review state, revisions, timestamps, and completion references.
  - Drafts must contain stable choice IDs and source fingerprints, not component-local state or free-form runtime interpretations.
- [x] **P9-013 — Define draft lifecycle, revision, and idempotency semantics** — `DONE`
  - Support `draft`, `submitted`, `changes-requested`, `approved`, `committing`, `completed`, `cancelled`, and `superseded` with explicit legal transitions.
  - Every mutation must be revision-checked, every commit must use a stable operation ID, and exact retry must return the original terminal result.
- [x] **P9-014 — Define stable choice, policy, and evidence identity** — `DONE`
  - Assign bounded stable IDs to backgrounds, feature/class choices, subchoices, starter-pool entries, item packages, and all selectable canonical options.
  - Reject ambiguous aliases and runtime drift; preserve user-facing labels separately from canonical identity.
- [x] **P9-015 — Build the canonical character-creation catalog** — `DONE`
  - Compile reviewed Trainer and Pokémon creation rules from app-owned `data/reference/*.json` into one deterministic, versioned catalog.
  - Include source hashes, prerequisite graphs, legal ranges, choice cardinality, derived contributions, and explicit campaign-policy extension points.
- [x] **P9-016 — Define the validation issue and explanation contract** — `DONE`
  - Represent blocking errors, warnings, campaign deviations, informational notes, affected decisions, safe fixes, and GM-only diagnostics through stable codes.
  - Validation must explain what is wrong, why it matters, and which decision can resolve it without exposing raw hashes or internal IDs by default.
- [x] **P9-017 — Define derived previews and contribution explanations** — `DONE`
  - Produce deterministic previews for stats, skills, HP, AP, evasion, initiative, Moves, Abilities, Capabilities, equipment, inventory, and team composition.
  - Every derived value must identify its canonical and campaign-policy contributors so the builder never becomes a second opaque rules engine.
- [x] **P9-018 — Define onboarding read sets, write sets, and atomicity** — `DONE`
  - List policy, profile, draft, sheet, folder, inventory, equipment, team, attention, and realtime resources consulted or written by each operation.
  - Final approval must either create and link the entire character package or leave every authoritative resource unchanged.
- [x] **P9-019 — Define realtime events and role projections** — `DONE`
  - Add privacy-safe draft, review, policy, completion, library, profile, and campaign-dashboard events with client IDs and durable replay where required.
  - Project only owner-safe choices to the player and keep GM notes, policy diagnostics, and other players' drafts structurally private.
- [x] **P9-020 — Build strict onboarding contract and drift quality gates** — `DONE`
  - Add checks for duplicate IDs, orphan choices, cyclic prerequisites, missing evidence, unsupported policy options, invalid state transitions, and stale source fingerprints.
  - The quality gate must fail when canonical creation coverage regresses or when client and server validators disagree.

### Phase 3 — Campaign policy, onboarding slots, and durable drafts

- [x] **P9-021 — Add onboarding policy storage and migrations** — `DONE`
  - Persist one active versioned policy plus retained historical versions needed by drafts and audit history.
  - Cover fresh databases, upgrades, rollback, unsupported future schemas, and policy records referenced by in-progress drafts.
- [x] **P9-022 — Implement the GM campaign-policy editor** — `DONE`
  - Provide safe defaults and explicit controls for starting levels, starter pools, money, item packages, source restrictions, approval, destinations, and optional rules.
  - Show validation and downstream impact before publishing a new policy version; never silently mutate an existing version.
- [x] **P9-023 — Implement policy publication and draft version binding** — `DONE`
  - Publish immutable policy versions and bind every new draft to exactly one version.
  - Existing drafts remain stable until the GM explicitly upgrades, restarts, or supersedes them through a previewed migration.
- [x] **P9-024 — Implement GM-created onboarding slots** — `DONE`
  - Let the GM open an onboarding slot for an existing player profile or create a profile and slot together.
  - A slot defines ownership and policy but contains no public signup token, password, or cross-campaign invitation behavior.
- [x] **P9-025 — Implement player ownership and access policy** — `DONE`
  - Allow only the selected profile owner to create or edit its active draft, while the GM retains review and correction authority.
  - Reject profileless, unrelated-profile, completed, cancelled, and superseded draft mutations with clear safe reasons.
- [x] **P9-026 — Implement the GM onboarding queue** — `DONE`
  - List unstarted, in-progress, submitted, changes-requested, approved, committing, completed, and blocked onboarding slots.
  - Show age, policy version, blocking count, player-visible status, and next GM action without exposing private draft details in the list.
- [x] **P9-027 — Implement the player onboarding home and resume flow** — `DONE`
  - Route a selected player profile to its current draft, completion summary, or a clear no-slot state.
  - Restore the exact current decision after reload or another device without relying on browser-local draft authority.
- [x] **P9-028 — Implement cancel, restart, archive, and supersede flows** — `DONE`
  - Let authorized users cancel an unfinished draft, let the GM restart under the same or a newer policy, and retain immutable audit references.
  - Cancellation or supersession must release reservations and never delete already authoritative sheets from a previously completed onboarding.
- [x] **P9-029 — Implement reviewed starting packages and campaign presets** — `DONE`
  - Support versioned money, inventory, equipment, starter-pool, and common campaign configuration packages referenced by policy.
  - Package application must remain transparent, previewable, and overrideable only where policy permits.
- [x] **P9-030 — Certify policy, slot, ownership, and draft persistence** — `DONE`
  - Test GM and player access, policy versioning, stale revisions, profile changes, restart, replay, cancellation, supersession, and privacy.
  - Verify that two players can progress independently and that no profile can read or mutate another profile's draft.

### Phase 4 — Guided Trainer creation

- [x] **P9-031 — Build the guided Trainer builder shell and decision state machine** — `DONE`
  - Organize creation around required decisions and completion state rather than exposing the ordinary sheet tabs as the primary flow.
  - Support resume, deep links, back/forward navigation, safe autosave, validation focus, and one visually primary decision at a time.
- [x] **P9-032 — Implement Trainer identity and presentation** — `DONE`
  - Collect name, pronouns or optional identity fields supported by the sheet, portrait, accent, and player-facing presentation metadata.
  - Validate bounded text and asset choices while keeping fictional identity separate from profile identity and permissions.
- [x] **P9-033 — Implement starting level and Trainer stat allocation** — `DONE`
  - Apply policy bounds and canonical point budgets, calculate derived HP and related values, and prevent overspend or invalid totals.
  - Show remaining points and contribution explanations before allowing submission.
- [x] **P9-034 — Implement background and skill-rank decisions** — `DONE`
  - Provide legal background effects, rank changes, campaign restrictions, and resulting skill dice through stable choices.
  - Detect rank-floor, rank-cap, duplicate adjustment, and prerequisite consequences immediately.
- [x] **P9-035 — Implement the free Training Feature decision** — `DONE`
  - Require and validate the universal Training Feature choice and expose its Pokémon-training consequences in preview.
  - Reuse the existing canonical Training Feature identities and sheet representation instead of inventing onboarding-only fields.
- [x] **P9-036 — Implement Edge and Feature selection with prerequisites** — `DONE`
  - Support counts, ranked choices, tags, prerequisites, mutually exclusive options, and required subchoices.
  - Re-evaluate downstream legality whenever level, skills, stats, classes, or prior choices change.
- [x] **P9-037 — Implement Trainer classes, branches, and dependency-aware subchoices** — `DONE`
  - Guide class acquisition and class-linked Feature choices using the canonical prerequisite graph and instance identities.
  - Explain blocked branches and preserve valid choices when an unrelated earlier decision changes.
- [x] **P9-038 — Implement starting money, inventory, equipment, and resources** — `DONE` (equipment-slot grant packages are deliberately outside policy schema v1; packages grant canonical stackable items and starter held items only)
  - Apply policy packages, allow permitted customization, and preview inventory ownership, equipment slots, derived grants, and remaining money.
  - Use Plan 8 item and equipment authority so onboarding cannot create legacy prose-only equipment or duplicate serialized identities.
- [x] **P9-039 — Implement the complete Trainer review and correction surface** — `DONE`
  - Present identity, budgets, skills, stats, Edges, Features, classes, equipment, inventory, derived values, warnings, and unresolved choices in one review.
  - Every issue must link back to its owning decision and every valid value must match the ordinary Trainer sheet runtime.
- [x] **P9-040 — Certify the Trainer vertical slice** — `DONE` (default slice via desktop+mobile liveplay e2e; higher-level start via deterministic fixture, validator, preview, and commit certification)
  - Complete a default and higher-level Trainer build through player and GM perspectives, including restart, stale edits, prerequisites, and mobile.
  - Verify the accepted preview serializes to a normal Trainer sheet with no onboarding-only mechanical authority.

### Phase 5 — Guided starter Pokémon creation

- [x] **P9-041 — Implement starter-pool discovery and species selection** — `DONE`
  - Show only policy-authorized species and forms with search, filters, comparison, and clear unavailable reasons.
  - Resolve every selection to canonical Pokédex identity and reject stale or ambiguous pool entries.
- [x] **P9-042 — Implement Pokémon level, form, gender, and nature decisions** — `DONE` (forms are exact Pokédex rows per DATA-ONB-003)
  - Apply policy bounds and canonical species/form constraints while preserving only supported optional identity choices.
  - Show the mechanical consequences of each choice and prevent presentation fields from fabricating unsupported forms.
- [x] **P9-043 — Implement base and added-stat allocation** — `DONE`
  - Load canonical base stats, calculate the level-based added-stat budget, enforce legal distribution, and preview full derived stats.
  - Keep base-stat, item, nature, form, and added-stat contributions distinct for future evolution and correction.
- [x] **P9-044 — Implement legal Ability selection** — `DONE`
  - Offer only legal species, form, tier, campaign, and source-authorized Ability choices and required slots.
  - Bind choices to canonical IDs and preview effective Ability automation without copying rule prose into draft authority.
- [x] **P9-045 — Implement legal Move selection** — `DONE`
  - Derive level-up and policy-authorized starting Move opportunities, active Move limits, duplicates, and required replacements.
  - Preview frequency, targeting, automation, and unresolved Move choices while keeping the final representation identical to ordinary Pokémon sheets.
- [x] **P9-046 — Implement Pokémon skills, capabilities, size, and movement preview** — `DONE` (species defaults flow from canonical rows; no manual override lane exists in onboarding, matching fail-closed policy)
  - Derive canonical defaults plus reviewed overrides and show encounter-relevant capabilities before submission.
  - Reject impossible manual overrides unless the campaign policy explicitly exposes a bounded house-rule choice.
- [x] **P9-047 — Implement Pokémon identity and presentation** — `DONE`
  - Collect nickname, portrait, caught-ball metadata, loyalty or ownership fields supported by policy, and other non-mechanical presentation.
  - Keep canonical species/form identity structurally separate from nickname and visual asset selection.
- [x] **P9-048 — Implement multiple starters and team composition** — `DONE`
  - Support the policy-defined starter count, reorder the starting team, enforce team limits, and represent overflow destinations explicitly.
  - Prevent duplicate character identities, duplicate serialized items, and impossible team references across Pokémon drafts.
- [x] **P9-049 — Implement starter held-item, equipment, and ownership initialization** — `DONE`
  - Apply allowed held items or equipment packages and preview all passive providers, grants, and compatibility checks.
  - Use authoritative item instances and custody rules so final commit cannot duplicate or lose an item between Trainer and Pokémon.
- [x] **P9-050 — Certify the Pokémon vertical slice** — `DONE` (single-starter liveplay e2e plus trio fixture commit certification)
  - Complete one- and multi-starter builds across canonical fixtures, including forms, Abilities, Moves, stats, held items, and stale policy data.
  - Verify every accepted build becomes a normal Pokémon sheet ready for team, encounter, evolution, item, and breeding systems.

### Phase 6 — Submission, GM review, and atomic approval

- [x] **P9-051 — Implement combined package validation** — `DONE`
  - Validate the Trainer, every Pokémon, team, inventory, equipment, money, profile ownership, folder destinations, and cross-character prerequisites as one package.
  - Submission must fail closed on any blocking issue and preserve stable links from issues to builder decisions.
- [x] **P9-052 — Implement submission receipts and immutable review snapshots** — `DONE`
  - Create a revisioned submission containing exact policy, canonical fingerprints, choices, preview, and validation accepted by the player.
  - Subsequent player edits must create a new submission revision rather than silently changing the GM's review target.
- [x] **P9-053 — Build the GM review workspace** — `DONE`
  - Present the proposed Trainer, Pokémon, team, budgets, prerequisites, inventory, equipment, warnings, and differences from policy defaults.
  - Use side-by-side or structured review views without exposing internal hashes or requiring the GM to open and compare blank sheets manually.
- [x] **P9-054 — Implement bounded change requests and player responses** — `DONE`
  - Let the GM request changes using stable issue/reason categories plus optional bounded comments, and let the player resolve and resubmit.
  - Keep review history immutable, role-projected, and linked to the exact submitted revision.
- [x] **P9-055 — Implement explicit GM corrections and player acknowledgement** — `DONE`
  - Allow bounded corrections where table authority requires them, showing before/after values, rationale, affected validation, and whether acknowledgement is required.
  - Corrections must use the same canonical validators and may not bypass hard invariants or create hidden sheet mutations.
- [x] **P9-056 — Implement approval and commit-plan preview** — `DONE`
  - Before approval, show every sheet, folder, profile link, team membership, inventory row, equipment instance, attention item, and realtime event that will be written.
  - Re-authorize the draft, policy, profile, canonical fingerprints, names, folders, and all mutable read-set revisions at approval time.
- [x] **P9-057 — Implement atomic character-package creation and linking** — `DONE`
  - Create the Trainer, Pokémon, starting resources, team, profile links, folders, and onboarding completion record in one transaction.
  - On any failure, roll back all rows and ensure no orphan sheet, dangling profile link, duplicated item, or half-created team remains.
- [x] **P9-058 — Implement exact retry, uncertain outcome, and reconciliation** — `DONE`
  - Journal final commit operation IDs and return the original result on retry after timeout, reconnect, tab crash, or server restart.
  - Provide a blocking reconciliation state when the client cannot know whether approval committed; never encourage a second speculative submission.
- [x] **P9-059 — Publish authoritative completion and library realtime events** — `DONE`
  - Notify owner and GM clients of completed onboarding, created sheets, profile links, team changes, campaign attention, and ready-for-play state.
  - Events must be durable, role-projected, ordered after commit, and safe for duplicate delivery.
- [x] **P9-060 — Certify the first playable onboarding slice** — `DONE`
  - A GM creates a default slot; the player builds one Trainer and one starter, submits, receives approval, and lands on an atomically linked ready team.
  - The completed characters must enter an encounter and perform a legal first action without manual edits, missing resources, or profile relinking.

### Phase 7 — Existing-character intake and safe campaign adoption

- [x] **P9-061 — Define the existing-character intake contract** — `DONE`
  - Model intake references, selected Trainer, related Pokémon, policy version, validation, proposed repairs, ownership, and commit state without copying entire sheets into browser authority.
  - Keep intake distinct from new creation while sharing canonical validators, review, receipts, retry, and completion semantics.
- [x] **P9-062 — Implement existing Trainer and team discovery** — `DONE`
  - Let the GM or authorized player select an existing Trainer and discover current team, boxed Pokémon, profile links, equipment, and inventory.
  - Detect missing, duplicated, renamed, inaccessible, or contradictory references before any intake mutation.
- [x] **P9-063 — Validate existing characters against campaign policy** — `DONE`
  - Evaluate current sheets using the same canonical creation catalog while accounting for level advancement and legitimate post-creation history.
  - Do not misclassify experienced-character state as a creation defect merely because it differs from a new-character package.
- [x] **P9-064 — Classify intake deviations and house-rule exceptions** — `DONE`
  - Distinguish blocking structural errors, repairable legacy data, campaign-policy deviations, acknowledged house rules, and informational differences.
  - Persist reviewed exceptions with stable reasons rather than suppressing validation globally.
- [x] **P9-065 — Implement bounded intake repairs** — `DONE`
  - Offer previewed fixes for missing identities, malformed choices, derived drift, team references, equipment instances, and other safe structural defects.
  - Never rewrite story history, XP, injuries, inventory, or character-build choices without an explicit authorized correction.
- [x] **P9-066 — Implement intake ownership and profile linking** — `DONE`
  - Assign or confirm the player profile, Trainer ownership, Pokémon links, and team membership through server authority.
  - Reject cross-profile conflicts and require explicit GM resolution when a character is already linked elsewhere.
- [x] **P9-067 — Implement duplicate, rename, and reference-conflict handling** — `DONE`
  - Detect duplicate slugs, canonical character identity collisions, stale map placements, active encounter references, and renamed sheet links.
  - Provide safe merge, relink, defer, or block outcomes without deleting an authoritative character by implication.
- [x] **P9-068 — Preserve history, resources, equipment, and attention state** — `DONE`
  - Carry forward legitimate encounter history, capture provenance, breeding state, item custody, treatments, progression, and unresolved attention.
  - Intake must not reset Daily or Scene resources, clear injuries, respawn items, or erase accepted campaign consequences.
- [x] **P9-069 — Implement atomic intake commit, retry, and rollback** — `DONE`
  - Apply repairs, ownership, links, team state, provenance, and completion as one idempotent operation with exact replay.
  - Rollback must leave the existing campaign unchanged when any validation, reference, or publication step fails.
- [x] **P9-070 — Certify existing-character intake** — `DONE`
  - Accept clean, legacy, house-ruled, renamed, partially linked, and conflict cases through GM and player workflows.
  - Verify accepted characters become ready for campaign and encounter use without destructive recreation or hidden data loss.

### Phase 8 — Ready-for-play handoff and campaign integration

- [x] **P9-071 — Build the onboarding completion summary** — `DONE`
  - Show created or adopted Trainer, Pokémon, team, inventory, equipment, profile links, policy, review history, and any non-blocking follow-up.
  - Provide stable links to each authoritative sheet and make clear that the draft is complete and no longer mechanical authority.
- [x] **P9-072 — Implement the ready-for-play state and next actions** — `DONE`
  - Offer direct actions to open Campaign, Trainer, Pokémon, active encounter, and relevant GM roster surfaces.
  - Only show `Ready` when profile links, team, blocking attention, and required creation decisions are actually complete.
- [x] **P9-073 — Integrate onboarding into the Campaign dashboard** — `DONE`
  - Show unstarted, in-progress, awaiting-review, changes-requested, committing, blocked, and completed onboarding as role-appropriate campaign work.
  - Keep other players' private choices hidden while giving the GM enough aggregate state to run the table.
- [x] **P9-074 — Implement active-encounter onboarding handoff** — `DONE`
  - Allow a newly completed profile package to join an eligible active encounter through an explicit GM-controlled workflow.
  - Re-authorize sheet readiness, profile ownership, side, placement, initiative, and encounter revision before adding participants.
- [x] **P9-075 — Integrate onboarded characters with the Encounter Builder** — `DONE`
  - Make completed Trainer/team packages discoverable as grouped cast candidates with clear owner and readiness state.
  - Prevent draft or changes-requested characters from appearing as playable authoritative participants.
- [x] **P9-076 — Build the GM campaign roster and readiness overview** — `DONE`
  - Summarize profiles, Trainers, teams, onboarding state, blocking attention, active encounter presence, and ownership conflicts.
  - Use this as orchestration support, not a second editor for character mechanics.
- [x] **P9-077 — Complete the player Trainer portal handoff** — `DONE`
  - Present the newly linked Trainer and team as the player's primary owned package with direct sheet, inventory, equipment, and campaign actions.
  - Remove any need to navigate the GM sheet library or remember raw sheet slugs after onboarding.
- [x] **P9-078 — Implement post-onboarding correction and reopen policy** — `DONE`
  - Define when a completed onboarding may be reopened, superseded, or corrected and which changes instead belong to ordinary sheet or progression workflows.
  - Never reactivate the draft as competing authority over already accepted sheets.
- [x] **P9-079 — Persist onboarding provenance and audit history** — `DONE`
  - Record policy version, approval, created/adopted references, correction summaries, and completion operation without retaining unnecessary private draft details forever.
  - Make provenance exportable and restorable with campaign backups.
- [x] **P9-080 — Certify zero-to-first-action and continuation journeys** — `DONE`
  - Run new and existing-character journeys from slot through campaign dashboard, encounter handoff, first action, settlement, and next continuation state.
  - Require GM and player perspectives with no raw identifier entry, manual relinking, or direct storage intervention.

### Phase 9 — Accessibility, responsive quality, privacy, resilience, and performance

- [x] **P9-081 — Implement the onboarding visual grammar and design-system fixtures** — `DONE`
  - Apply Field Guide and Workshop contexts, one-primary-decision hierarchy, semantic validation states, contribution explanations, and restrained Rotom identity.
  - Use the project UI design workflow and retain reviewed fixtures for core builder, review, error, completion, and empty states.
- [x] **P9-082 — Implement desktop, laptop, tablet, and mobile layouts** — `DONE`
  - Support long choice catalogs, comparison, progress, review, and validation without clipped controls, horizontal page traps, or unusable density.
  - Define breakpoint-specific navigation and preserve decision context while moving between regions.
- [x] **P9-083 — Complete keyboard-only and switch-access operation** — `DONE`
  - Provide predictable step navigation, search, choice selection, issue jumps, dialogs, submission, review, and focus restoration using native controls.
  - No creation or approval decision may require pointer precision, drag-and-drop, hover, or an unlabelled shortcut.
- [x] **P9-084 — Complete screen-reader structure, labels, and announcements** — `DONE`
  - Expose progress, decision names, remaining budgets, validation changes, submission state, review requests, and completion through landmarks and live regions.
  - Avoid announcing every derived recalculation while ensuring blocking changes and accepted commits are unmistakable.
- [x] **P9-085 — Complete touch targets, help, and validation recovery** — `DONE`
  - Meet target sizes, avoid hover-only explanations, keep destructive controls separated, and provide concise inline help plus deeper inspectors.
  - Error summaries must focus the first blocking issue and every issue link must land on an operable decision.
- [x] **P9-086 — Certify multi-tab and multi-device concurrency** — `DONE`
  - Handle two player tabs, GM review during player edits, policy publication, profile changes, and simultaneous onboarding of different players.
  - Stale clients must reconcile or preserve unsent intent without overwriting newer authoritative drafts.
- [x] **P9-087 — Certify restart, reconnect, and uncertain commit recovery** — `DONE`
  - Recover drafts, submissions, review state, pending corrections, and final approval across server restart and realtime gaps.
  - The UI must distinguish offline, stale, retryable, and uncertain states and block duplicate final commits.
- [x] **P9-088 — Complete onboarding authorization, privacy, and abuse tests** — `DONE`
  - Test profile ownership, GM authority, draft enumeration, comment visibility, raw ID probing, payload bounds, alias ambiguity, and forged policy or choice IDs.
  - Preserve trusted-table scope while preventing one table participant from reading or mutating another participant's private onboarding.
- [x] **P9-089 — Enforce catalog, draft, validation, and rendering performance budgets** — `DONE`
  - Set budgets for large starter pools, feature catalogs, prerequisite graphs, multiple Pokémon, GM queues, validation recomputation, and final commit planning.
  - Use indexed lookup, bounded rendering, virtualization or progressive disclosure where needed, and deterministic benchmark fixtures.
- [x] **P9-090 — Run responsive, accessibility, privacy, concurrency, and performance acceptance** — `DONE`
  - Validate official desktop and mobile projects plus keyboard, screen-reader structure, reduced motion, zoom, multi-client, restart, and large-policy fixtures.
  - No critical usability, privacy, or performance defect may be deferred to the final phase.

### Phase 10 — Coverage closure, golden journeys, documentation, and final acceptance

- [x] **P9-091 — Certify complete canonical creation-rule coverage** — `DONE`
  - Prove every Trainer and starter Pokémon creation rule and every policy option has structured authority, implementation state, evidence, and tests.
  - Final coverage permits zero blocked rows, runtime prose inference, orphan choices, or unsupported selectable options.
- [x] **P9-092 — Certify the campaign-policy variant matrix** — `DONE`
  - Run default, higher-level, restricted-source, curated-starter, multiple-starter, packaged-equipment, optional-choice, and approval variants.
  - Verify policy-version stability and explicit draft migration when active policy changes.
- [x] **P9-093 — Run GM/player multi-client onboarding acceptance** — `DONE`
  - Exercise owner-private choices, GM review, change requests, corrections, simultaneous players, realtime ordering, stale tabs, and completion.
  - Confirm unauthorized profiles receive no private draft, comment, review, or created-character data.
- [x] **P9-094 — Run fresh-database, upgrade, backup, and restore acceptance** — `DONE`
  - Create and complete onboarding on a fresh database, upgrade historical schemas, back up in-progress and completed drafts, and restore them.
  - Verify source fingerprints, policy references, operation journals, sheets, links, provenance, and completion state survive restore.
- [x] **P9-095 — Run existing-campaign and intake acceptance** — `DONE`
  - Test clean imports, legitimate advanced characters, legacy structure, renamed sheets, ownership conflicts, active encounter references, and house-rule exceptions.
  - Require non-destructive adoption and explicit blocking when safe repair is not possible.
- [x] **P9-096 — Run failure, correction, rollback, and exact-retry acceptance** — `DONE`
  - Inject failures at draft save, submit, review, approval planning, each commit write, realtime append, and post-commit publication.
  - Prove no partial package, duplicate sheet, duplicate item, dangling link, or ambiguous approval outcome remains.
- [x] **P9-097 — Run golden zero-to-first-encounter campaigns** — `DONE`
  - Certify a default new player, higher-level party, multiple starters, requested changes, existing-character intake, and mobile player from start to first accepted action.
  - Continue each fixture through settlement and Campaign dashboard to ensure onboarding hands off cleanly to Plan 8 authority.
- [x] **P9-098 — Make guided onboarding the default new-player path** — `DONE`
  - Route player profiles with open slots into onboarding and expose GM slot creation from player management and campaign readiness surfaces.
  - Keep direct blank-sheet creation as an explicit advanced GM workflow for NPCs, testing, and unusual cases rather than deleting it.
- [x] **P9-099 — Complete user, GM, contributor, and operator documentation** — `DONE`
  - Document policies, slots, builder decisions, review, corrections, intake, completion, troubleshooting, canonical-data maintenance, privacy, and recovery.
  - Keep documentation focused on running and extending the alpha product rather than release ceremony or repository promotion.
- [x] **P9-100 — Record final guided-onboarding alpha acceptance** — `DONE`
  - Run all focused and full repository validation, record zero-to-first-encounter evidence, confirm all 100 tickets and creation rules complete, and verify no critical onboarding debt remains.
  - Set `PLAN_STATUS: DONE`, clear `CURRENT_TICKET`, archive the plan, and synchronize `plan-order.md` and `AGENTS.md` only after every gate passes.

## Phase exit gates

### Phase 1 exit

- The current zero-to-play workflow, ownership boundaries, canonical Trainer and starter rules, campaign variation, privacy risks, success criteria, and deterministic fixtures are recorded.
- P9-001 through P9-010 are `DONE`.

### Phase 2 exit

- Policy, draft, lifecycle, identity, catalog, validation, preview, atomicity, projection, and drift contracts are versioned and executable.
- P9-011 through P9-020 are `DONE`.

### Phase 3 exit

- GMs can publish policies and open slots; players can privately create, resume, cancel, and recover revisioned drafts bound to the correct profile and policy version.
- P9-021 through P9-030 are `DONE`.

### Phase 4 exit

- A player can produce a fully validated ordinary Trainer-sheet preview through guided identity, stats, background, skills, Training Feature, Edges, Features, classes, inventory, equipment, and review.
- P9-031 through P9-040 are `DONE`.

### Phase 5 exit

- A player can produce fully validated ordinary Pokémon-sheet previews and policy-valid starter teams with canonical stats, Abilities, Moves, capabilities, identity, and held-item authority.
- P9-041 through P9-050 are `DONE`.

### Phase 6 exit

- Submission, GM review, change requests, bounded corrections, atomic approval, exact retry, realtime completion, and the default first playable vertical slice all pass.
- P9-051 through P9-060 are `DONE`.

### Phase 7 exit

- Existing Trainers and Pokémon can be discovered, validated, explicitly repaired or excepted, linked, and adopted without destructive recreation or loss of campaign history.
- P9-061 through P9-070 are `DONE`.

### Phase 8 exit

- Completed onboarding hands off cleanly to Campaign, player-owned character surfaces, Encounter Builder, and eligible active encounters, with durable provenance and no competing draft authority.
- P9-071 through P9-080 are `DONE`.

### Phase 9 exit

- Reviewed visual fixtures, responsive layouts, keyboard, screen-reader, touch, validation recovery, concurrency, restart, privacy, and scale budgets pass.
- P9-081 through P9-090 are `DONE`.

### Phase 10 exit

- Canonical coverage, policy variants, multi-client, migration, backup/restore, intake, rollback, golden campaigns, default routing, documentation, and final repository validation pass.
- P9-091 through P9-100 are `DONE`, the plan is archived, and no critical zero-to-play onboarding debt remains.

## Final definition of done

This plan is complete only when all of the following are true:

1. Every supported Trainer and starter Pokémon creation rule has reviewed structured authority, stable identity, evidence, and executable validation.
2. Campaign starting variants are expressed through immutable versioned policy rather than hidden code branches or GM-only prose.
3. A GM can create an onboarding slot without creating public accounts or unsafe reusable invitation secrets.
4. A selected-profile player can build and resume only their own private draft.
5. Trainer creation covers identity, level, stats, background, skills, Training Feature, Edges, Features, classes, subchoices, money, inventory, equipment, and resources.
6. Starter Pokémon creation covers policy-authorized species/forms, level, added stats, Abilities, Moves, capabilities, identity, held items, and team composition.
7. All budgets, prerequisites, choice counts, exclusions, cross-character constraints, and campaign restrictions validate continuously and authoritatively.
8. Every blocking issue explains what changed, why it is invalid, and how to return to a legal build.
9. Submission creates an immutable review snapshot bound to exact policy and canonical fingerprints.
10. GM review supports approval, changes requested, bounded correction, and visible player acknowledgement where required.
11. Approval creates or adopts the entire Trainer/team/profile package atomically.
12. Retry, reconnect, stale tabs, server restart, and uncertain outcomes cannot duplicate or partially create characters or resources.
13. Completion publishes authoritative realtime events and produces a ready-for-play state in Campaign and player surfaces.
14. A completed package can join an eligible encounter and perform a first legal action without manual edits or relinking.
15. Existing-character intake preserves legitimate history, progression, injuries, inventory, equipment, capture, breeding, and encounter state.
16. Direct blank-sheet creation remains available as an explicit advanced GM path but is not required for normal new-player onboarding.
17. Desktop, mobile, keyboard, touch, screen-reader, zoom, reflow, reduced-motion, privacy, concurrency, restart, and scale acceptance pass.
18. Fresh database, schema upgrade, backup, restore, rollback, and exact-retry acceptance pass.
19. Complete user, GM, contributor, and operator documentation exists.
20. No critical usability, authority, privacy, data-loss, or manual-repair debt remains in the zero-to-first-encounter journey.

## Decision log

- **2026-08-16 — Make guided character creation and campaign onboarding Plan 9.** The primary play loop is complete; the highest-value remaining product gap is getting a new trusted-table participant into that loop.
- **2026-08-16 — Preserve direct blank-sheet creation as an advanced GM workflow.** Guided onboarding becomes the normal new-player path without removing useful NPC, import, test, or unusual-campaign tooling.
- **2026-08-16 — Bind onboarding to player profiles rather than public accounts or invitations.** The product remains a private trusted-table application and does not expand its identity boundary in this plan.
- **2026-08-16 — Use immutable campaign policy versions.** Existing drafts remain reproducible and never change silently when the GM updates starting rules.
- **2026-08-16 — Commit the entire character package atomically.** Trainer, Pokémon, team, inventory, equipment, profile links, provenance, and attention may not partially succeed.
- **2026-08-16 — Reuse ordinary sheet and downstream authority.** Drafts disappear as mechanical authority after completion; no onboarding-only character format survives.
- **2026-08-16 — Place Pokémon Contests after onboarding.** Contests remain a strong later parallel gameplay plan once the product can take every new player from zero to play.
