# Move automation guidelines

- Explicit move automation lives in `moveAutomation.ts` and the adjacent `moveAutomation*.ts` helpers.
- Do not add move coverage by relying on the manual move automation wizard UI. A covered move must start from the token move menu into a seamless map flow: single-target overlay, AoE confirmation overlay, or immediate self/field resolution.
- Keep reviewed move entries explicit and tested. Add/adjust tests under `tests/utils/moveAutomationExplicitScripts.test.ts` and, when the map flow changes, `tests/composables/map-editor/useMoveAutomationPanel.test.ts`.
- Prefer small reusable helpers and canonical PTU data, but document non-automatable tabletop clauses in `automationNotes` rather than silently dropping them.
