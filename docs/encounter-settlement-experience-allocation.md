# Encounter settlement batch Experience allocation

P8-075 provides one server-owned batch planner for settlement Experience. The implementation is [`server/domain/encounterSettlement/experienceAllocation.ts`](../server/domain/encounterSettlement/experienceAllocation.ts), and its reviewed evidence contract is [`data/complete-play-loop/encounter-settlement-experience-allocation.v1.json`](../data/complete-play-loop/encounter-settlement-experience-allocation.v1.json).

## Current authority

The planner requires one `authoritative-current` read containing the Experience declarations and every Pokémon sheet needed by selected participants or durable relationship mechanics. Each direct recipient must be a current Pokémon participant at the exact settlement sheet revision. Trainers are not Pokémon XP recipients.

A current sheet is valid only when:

- Level is an integer from 1 through 100;
- total Experience is a non-negative safe integer;
- the canonical Experience chart resolves that exact Level from the total;
- or, when total Experience is absent, the app-owned threshold for the current Level supplies the only fallback.

Duplicate recipients, duplicate sheet authorities, stale revisions, unsafe totals, inconsistent Level/Experience pairs, missing relationship counterparts, and corrupt reciprocal state reject the complete plan. Browser calculations and labels have no authority.

## Distribution methods

One declaration selects a group, encounter side, participant, or Pokémon-sheet scope and one method:

- **fixed** — split equally as integers; deterministic remainder points go in stable participant-identity order;
- **weighted** — use positive safe-integer weights, exact integer products, largest remainder, and stable identity for ties;
- **individual** — provide one positive server-validated amount per selected recipient, summing exactly to the reward.

Every selected recipient receives at least one point. Relationship-aware final writes conserve the exact reward total. One deterministic settlement allocation retains the scope and total; its leaf writes identify every actual sheet.

## Authoritative Level preview

For each changed sheet the preview records:

- expected revision;
- XP grant;
- total Experience before and after;
- Level before and after;
- every crossed Level and exact threshold;
- source-owned lifecycle reason IDs.

Thresholds come only from [`data/reference/pokemonExperienceChart.json`](../data/reference/pokemonExperienceChart.json). The planner reuses the existing Pokémon Experience mutation and capability-evolution functions, so the preview does not implement a second level algorithm.

## Marsupial sharing and Level 25

The existing reciprocal Marsupial provider remains authoritative. When a selected valid mother has the reviewed 20-percent sharing choice, the planner sends `floor(base grant × 0.2)` to the exact baby and leaves the remainder with the mother. Missing, one-sided, malformed, duplicate, capability-invalid, or lifecycle-invalid relationships reject the whole batch.

When a valid baby crosses Level 25, capability evolution authority ends Baby Template and clears pouch state from both sheets. If the other sheet receives no XP, the reward preflight still contains an explicit non-contributing zero-amount related write. This keeps every durable mutation visible without counting it toward the reward twice.

## All-or-nothing plan

Every generated allocation and write has a deterministic SHA-256 identity. Each changed sheet retains:

- expected and next revision;
- aggregate grant amount;
- stable-JSON SHA-256 of current and next documents;
- private source-derived next document.

Before application, every current sheet revision and before hash, every planned after hash, and every next revision are checked. If any line is pending or denied, or any sheet changed, no writes are applicable. P8-080 persists the complete list in the atomic settlement transaction; P8-075 never performs repetitive token edits or partial persistence.

A non-excluded Experience line without a declaration stays pending. A denied destination keeps its allocation and private permission evidence but has no writes. Explicitly excluded XP requires no allocation. Foreign or already-applied Experience allocation evidence is never replaced.

## Privacy and later work

Sheet documents and hashes, relationship state and operation IDs, permission authority, source-write IDs, and Profile evidence are private. A later role projection may show safe recipient labels, XP amounts, Level before/after, crossed Levels, pending or denied status, and safe lifecycle summaries.

This provider does not commit settlement, expose private state, make post-level advancement choices, or resolve attention items. Those remain ordered work for P8-080 and Phase 9.
