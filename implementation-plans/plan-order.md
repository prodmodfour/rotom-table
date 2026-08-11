# Implementation Plan Order

The plans are implemented in the following dependency order. Each plan's own ledger remains authoritative for its tickets and `PLAN_STATUS`; update this index whenever a ticket count, current ticket, plan status, or dependency changes. Finishing one ticket, phase, or plan is only a checkpoint: implementation work must continue in order and must not be treated as complete until every listed plan and every ticket is `DONE`, unless a genuine external blocker is recorded in the authoritative ledgers.

| Order | Implementation plan | Declared status | Current execution state |
| ---: | --- | --- | --- |
| 1 | [Ability Automation](done/ABILITY_AUTOMATION_PLAN.md) | `DONE` | Complete and archived. |
| 2 | [Platform Modernisation and Automation Presentation Contract](done/AUTOMATION_PRESENTATION_CONTRACT_PLAN.md) | `DONE` | Complete and archived. |
| 3 | [Capability Automation](done/CAPABILITY_AUTOMATION_PLAN.md) | `DONE` | Complete and archived. |
| 4 | [Edge Automation](done/EDGE_AUTOMATION_PLAN.md) | `DONE` | Complete and archived: 61 Trainer + 20 Poké rows, with 80 native-complete and Breeder delegated-complete. |
| 5 | [Feature Automation](done/FEATURE_AUTOMATION_PLAN.md) | `DONE` | Complete and archived: 444 native-complete Features across 30 reviewed cohorts. |
| 6 | [Encounter UI and UX](done/ENCOUNTER_UI_UX_PLAN.md) | `DONE` | Complete and archived: role-projected cockpit, Encounter Documents and Builder, tactical lens, Director workflows, accessibility, performance, rollout, and aggregate-only UX metrics. |
| 7 | [Breeding and Egg Lifecycle](BREEDING_AND_EGG_LIFECYCLE_PLAN.md) | `IN_PROGRESS` | Current and unblocked. Current ticket: `BR-085`; 84/90 tickets complete. |
