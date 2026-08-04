# Implementation Plan Order

The plans are implemented in the following dependency order. Each plan's own ledger remains authoritative for its tickets and `PLAN_STATUS`; update this index whenever a plan status or dependency changes.

| Order | Implementation plan | Declared status | Current execution state |
| ---: | --- | --- | --- |
| 1 | [Ability Automation](done/ABILITY_AUTOMATION_PLAN.md) | `DONE` | Complete and archived. |
| 2 | [Platform Modernisation and Automation Presentation Contract](done/AUTOMATION_PRESENTATION_CONTRACT_PLAN.md) | `DONE` | Complete and archived. |
| 3 | [Capability Automation](done/CAPABILITY_AUTOMATION_PLAN.md) | `DONE` | Complete and archived. |
| 4 | [Edge Automation](done/EDGE_AUTOMATION_PLAN.md) | `DONE` | Complete and archived: 61 Trainer + 20 Poké rows, with 80 native-complete and Breeder delegated-complete. |
| 5 | [Feature Automation](done/FEATURE_AUTOMATION_PLAN.md) | `DONE` | Complete and archived: 444 native-complete Features across 30 reviewed cohorts. |
| 6 | [Encounter UI and UX](ENCOUNTER_UI_UX_PLAN.md) | `IN_PROGRESS` | Current and unblocked; Feature Automation is complete. Current ticket: `EUX-001`. |
| 7 | [Breeding and Egg Lifecycle](BREEDING_AND_EGG_LIFECYCLE_PLAN.md) | `QUEUED` | Waiting for Encounter UI and UX to be `DONE`. Current ticket: `BR-001`. |
