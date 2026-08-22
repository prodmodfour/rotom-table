# Onboarding visual grammar and design fixtures

- Plan: P9-081
- Design authority: `DESIGN.md` (normative)
- Reviewed mockup lineage: `.pi/artifacts/ui-mockups/onboarding-builder/` (brief, v001 prompt, v001.png, v001 review — gate passed 9/10)

## Contexts

| Surface | Context | Notes |
| --- | --- | --- |
| `/onboarding` queue + player home | Workshop | opaque cards, explicit states, no theatrics |
| `/onboarding/policy` | Workshop | explicit publish/version state |
| `/onboarding/draft/:id` builder | Workshop with Field Guide reading qualities | one primary decision |
| `/onboarding/review/:id` | Workshop | review facts + validation + plan |
| `/onboarding/intake` | Workshop | findings/repairs classification |

## Grammar

- **One primary decision.** The builder renders exactly one decision card; the rail and preview stay quiet. Rail focus uses the 3px cyan signal-spine, never a filled row.
- **Semantic states.** Amber = unresolved/attention (`--rt-pending`), mint = complete (`--rt-success`), cyan = focus/next (`--rt-focus`), danger red only for real errors and blocking issues, Rotom red reserved for the final submit/approve commitment actions.
- **Contribution explanations.** Derived values (Max HP, budgets) always carry their contributor breakdown from `shared/onboarding/preview.ts`; the preview rail shows budget meters with spent/total in tabular numerals.
- **Validation anatomy.** Issues render as left-border severity rows (`OnboardingIssueList`); on the review card they are navigable and land focus on the owning decision.
- **Restrained identity.** No Pokémon official art; species render as monogram circles. No glow/glass; solid matte surfaces with 1px rules.
- **Controls.** Rectangular, ≥44px targets, native elements only; steppers are explicit −/+ buttons with `aria-label`s.

## Retained fixtures

- Mockup v001 (selected implementation reference) plus its review are retained under the artifact directory.
- Liveplay screenshots for the core states are captured on every e2e failure run under `test-results/`; the passing golden journey (`tests/e2e/onboarding-first-slice.spec.ts`) and acceptance spec (`tests/e2e/onboarding-acceptance.spec.ts`) are the executable visual fixtures for builder, review, error, completion, and empty states on desktop and mobile projects.

## Deliberate differences from the mockup

1. "HP stat" and "Max HP" are labelled separately in the preview rail (mockup showed bare "HP 12" under "HP 48").
2. Already-chosen options are filtered from option lists rather than rendered dimmed.
3. Budget meters are 6px, lighter than the mockup's.
