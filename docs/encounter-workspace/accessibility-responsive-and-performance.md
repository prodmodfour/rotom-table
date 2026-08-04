# Encounter Workspace accessibility, responsive layouts, and performance

## Responsive regions

The same role-projected workspace contract drives every viewport.

- **Laptop and desktop:** turn rail, roster, battle stage, event feed, and Action Dock remain simultaneously legible.
- **Tablet:** the roster narrows and non-blocking regions may stack without changing authority or available commands.
- **Mobile:** Battle, Roster, Actions, and History are explicit region tabs. A newly blocking decision returns the user to Battle and takes focus through the priority arbiter.
- **Table display:** `layout=table-display` emphasizes current actor, turn state, blocking prompts, and critical HP while suppressing secondary chrome. It is a local presentation preference only.

No breakpoint fetches a different mechanics payload, infers hidden identities, or stores campaign state locally.

## Accessibility behavior

- A skip link targets the encounter workspace main landmark.
- Blocking decisions use an accessible modal with focus trap, Escape handling where safe, and restoration to their origin or the Action Dock.
- Settings are an accessible modal with focus trap and restoration.
- Polite and assertive live regions announce current actor changes, projected pending prompts, accepted summaries, and system errors. Historical accepted rows are not replayed as fresh announcements on initial load.
- Text sizing, high contrast, colour-vision palette, reduced motion, and touch-target sizing are CSS-token variants attached to the workspace root.
- Native HTML controls retain visible `:focus-visible` rings. Primary controls have a minimum 44 CSS-pixel target.
- Tactical bridge focus and messages remain origin-, source-, revision-, and identity-bounded.

Presentation preferences are the exact closed schema in `shared/encounterWorkspace/preferences.ts`. They never include maps, sheets, choices, commands, options, or authority payloads.

## Performance bounds

Machine-readable budgets live in [`data/encounter-workspace/performance-budgets.json`](../../data/encounter-workspace/performance-budgets.json). The Action Dock and accepted-history feed render at most 80 rows initially and reveal further rows in bounded batches. Tactical rendering remains lazy behind the tactical lens and reuses `/maps/:slug?encounterLens=1`.

Optional visual effects are disabled under reduced motion, and table display uses the same bounded workspace tree rather than mounting duplicate command surfaces. Release acceptance checks adapter p95, local interaction p95, tactical startup, accepted-presentation latency, frame rate, and DOM row caps.

## Aggregate UX metrics

`shared/encounterWorkspace/metrics.ts` defines a strict schema-v1 event and dimension whitelist. `/api/encounter-workspace/metrics` accepts authenticated samples, normalizes player role dimensions server-side, and stores aggregate count/sum/min/max rows only. Arbitrary labels and identifiers fail closed. The GM-only GET route exposes aggregate rows for staged rollout review. Metrics failures never block encounter workflows.
