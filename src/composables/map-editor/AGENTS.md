# Move automation panel rules

- Do not route newly covered moves through the move automation wizard UI.
- A covered move must start from the token move menu into a seamless map flow: a single-target overlay, an AoE confirmation overlay, or immediate self/field resolution.
- Keep the panel as an orchestration layer; move-specific mechanics belong in `~/utils/moveAutomation*` helpers and explicit scripts.
- Add or update tests in `tests/composables/map-editor/useMoveAutomationPanel.test.ts` when changing the map flow.
