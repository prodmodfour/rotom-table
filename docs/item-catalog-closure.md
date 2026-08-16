# Canonical item catalog closure

P8-093 closes the final 60 blocked rows from the P8-092 canonical item cohort registry. All 348 exact rows in `data/reference/items.json` now have one reviewed `native`, `guided`, or `passive` provider decision. No row remains blocked, reference-only, or backed by runtime prose parsing.

The closure evidence is `data/complete-play-loop/item-catalog-closure.v1.json`. Cohort classification remains read-only coverage evidence; it never grants mechanics.

## Interpretive campaign tools

`data/complete-play-loop/guided-catalog-items.v1.json` covers the 34 reviewed field, camp, crafting, care, and combat tools exactly once. Its input is `scripts/reviewed-data/guided-catalog-items.v1.json`, and generation fails if the canonical catalog, cohort policy, exact record hashes, effect hashes, or reviewed source bytes drift.

Every definition has `runtimeProseParsing: false` and exactly one private GM decision: **Accept reviewed use**. There is no freeform mechanic field. The decision records no inferred target, recipe, output, condition, modifier, hazard, movement, or battlefield change.

Declaration and settlement require:

- one exact current Trainer source row and revision;
- current actor control and target authority;
- the exact reviewed definition hash and bounded choice;
- current action, map, encounter, and sheet read authority where applicable;
- a durable pending request and reservation policy; and
- atomic item-operation settlement with exact replay.

Consumable tools reserve one exact unit while pending and consume it only when the GM accepts. Cancellation releases the reservation without inventory, action, target, or map mutation. Reusable tools remain bound to the exact source custody and are never consumed. Acceptance stores a bounded private Trainer receipt containing the exact operation authority and reviewed source disposition. Public and player-safe projections expose labels and settlement facts, not row IDs, operation IDs, hashes, Profile IDs, or private receipts.

## Structured Poké Ball capture

`data/complete-play-loop/capture-pokeballs.v1.json` covers all 25 canonical Poké Balls. Its reviewed input is `scripts/reviewed-data/capture-pokeballs.v1.json`. Runtime capture modifiers and post-capture behavior come only from this generated structured contract; inventory `mod`, descriptions, and canonical effect prose are never parsed for mechanics.

A throw selects one `sourceInstanceId` that must resolve to exactly one current Trainer inventory section and row ID at the declared Trainer revision. Duplicate same-name rows remain separate options. The server never substitutes another row by name.

The accepted liveplay command binds the exact source, map and placement authority, Ball definition, random resolution, one-unit consumption, roster update, captured-Pokémon update, map removal/logging, sheet revisions, first-species reward, and realtime publication in one transaction. A duplicate command returns the exact accepted result without rerolling or consuming again. A stale, empty, missing, ambiguous, or renamed source fails closed before rolling.

Structured automatic providers include fixed Ball modifiers, supported target conditions, Timer/Quick Ball round schedules, Friend Ball starting Loyalty, and Heal Ball effective-Max-HP healing. Conditions without exact current authority remain explicitly unavailable with a safe reason; they do not receive an inferred bonus.

## Black Sludge repair

`scripts/reviewed-data/black-sludge-acquisition-cost.v1.json` and `scripts/migrate_black_sludge_acquisition_cost.py` record the reviewed source-hash-bound migration that adds Black Sludge's structured `$500` acquisition cost. The migration pins before/after catalog and ItemSpec hashes and updates `data/complete-play-loop/canonical-data-remediation.v1.json`.

Black Sludge is now a native ItemSpec. It may be stored only on an exact Poison-type Pokémon target, consumes one reviewed source unit on accepted use, and creates a Digestion Buff that becomes encounter-duration turn-start healing for 1/8 maximum HP when traded. Non-Poison targets, stale definitions, occupied Digestion Buff capacity, or malformed healing authority fail closed before consumption.

## Storage and recovery

Storage schema 44 preserves every schema-39 guided-request row while admitting only `campaign-tool-adjudication` in addition to the existing reviewed request kinds. The migration rebuild is row-preserving and covered from a populated schema-43 database.

Pending guided commands use the existing durable exact-command recovery boundary. Ambiguous transport outcomes retain the exact command. Reconnection does not replay automatically. Conflict or definition drift requires fresh authority and explicit redeclaration. Capture uses the existing immutable liveplay command journal and deterministic accepted-result reconstruction.

## Validation

Run the deterministic generators and drift checks:

```bash
python3 scripts/migrate_black_sludge_acquisition_cost.py --check
python3 scripts/generate_complete_play_loop_guided_catalog_items.py --check
python3 scripts/generate_complete_play_loop_capture_pokeballs.py --check
python3 scripts/generate_complete_play_loop_guided_item_adjudications.py --check
python3 scripts/generate_complete_play_loop_item_inventory.py --check
python3 scripts/generate_complete_play_loop_out_of_encounter_certification.py --check
python3 scripts/generate_complete_play_loop_item_catalog_cohorts.py --check
```

Focused acceptance covers all 34 guided definitions, reusable and consumable settlement, cancellation, private receipts, exact replay, schema-43-to-44 preservation, all 25 Ball identities, duplicate same-name rows, stale-source non-substitution, structured conditional mechanics, Friend/Heal outcomes, atomic capture replay, Black Sludge migration and 1/8 healing, complete cohort evidence, client selection, and privacy-safe UI projection.
