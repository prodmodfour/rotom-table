# Current `/maps/:slug` compatibility baseline

Ticket EUX-009 freezes a non-private visual, interaction, accessibility, and performance baseline before the encounter workspace replaces map-first live play. The capture represents commit `164b510d` with the unmodified compatibility UI.

## Fixture and privacy boundary

The browser used an isolated throw-away campaign containing a map named **Encounter UX Baseline** and four synthetic sheets: Mira, Luxray, Rowan, and Crobat. The layout is derived from the `simple-trainer-duel` canonical fixture, but it is not campaign authority and contains no real player profile, session join code, credential, or private campaign content. The ephemeral browser-tab suffix in the stored desktop ARIA tree is replaced with `synthetic-baseline`.

The immutable artifact index, byte sizes, capture metadata, and SHA-256 values are in [`baseline/current-compatibility/manifest.json`](baseline/current-compatibility/manifest.json).

## Captured evidence

| Evidence | Desktop | Mobile/narrow |
|---|---|---|
| Map screenshot | [`desktop-map.png`](baseline/current-compatibility/desktop-map.png) | [`mobile-map.png`](baseline/current-compatibility/mobile-map.png) |
| Encounter actions | [`desktop-encounter-actions.png`](baseline/current-compatibility/desktop-encounter-actions.png) | [`mobile-encounter-actions.png`](baseline/current-compatibility/mobile-encounter-actions.png) |
| Navigation overlap | [`desktop-navigation-and-actions.png`](baseline/current-compatibility/desktop-navigation-and-actions.png) | n/a |
| Workflow recording | [`desktop-workflow.webm`](baseline/current-compatibility/desktop-workflow.webm) | [`mobile-workflow.webm`](baseline/current-compatibility/mobile-workflow.webm) |
| Playwright ARIA tree | [`desktop-accessibility-tree.yml`](baseline/current-compatibility/desktop-accessibility-tree.yml) | [`mobile-accessibility-tree.yml`](baseline/current-compatibility/mobile-accessibility-tree.yml) |
| Performance trace | [`desktop-performance-trace.json`](baseline/current-compatibility/desktop-performance-trace.json) | [`mobile-performance-trace.json`](baseline/current-compatibility/mobile-performance-trace.json) |

The performance traces retain Navigation Timing, paint, LCP, CLS, long-task, resource, and Chrome DevTools Protocol metrics after a three-second settled observation window. Resource names are reduced to URL paths; origins and query strings are not stored.

## Baseline readings

These are single-run diagnostic baselines, not release thresholds. Later performance acceptance must use repeated bounded samples on the declared lower-end profile.

| Reading | Desktop 1280×720 | Narrow 412×915 |
|---|---:|---:|
| DOMContentLoaded end | 172.6 ms | 276.3 ms |
| Load event end | 183.8 ms | 284.6 ms |
| First contentful paint | 212 ms | 296 ms |
| Last observed LCP | 444 ms | 520 ms |
| CLS | 0.000033 | 0 |
| Decoded resources | 11,571,990 bytes | 11,550,286 bytes |
| Nodes after settle | 2,419 | 2,355 |
| JS heap used after settle | 56,410,232 bytes | 55,466,100 bytes |
| Long tasks during observation | 29 / 3,815 ms | 32 / 3,803 ms |

The repeating long tasks align with the continuously scheduled isometric renderer and establish a concrete optimisation target for the optional tactical lens. They must not be interpreted as server latency.

## Compatibility observations

The evidence records the current constraints without turning them into new authority:

- the isometric canvas remains the permanent dominant surface even for non-spatial decisions;
- initiative, scene state, encounter actions, presence, navigation, and status copy occupy independent overlays;
- opening encounter actions exposes a long undifferentiated vertical list and can coincide with the navigation drawer;
- the accessibility tree presents useful named controls, but visual canvas content itself is largely generic;
- the narrow viewport retains the map-first composition rather than changing to a turn/decision-first reading order;
- disabled action reasons are available in the action tree, which is compatibility behaviour the new workspace must preserve.

## Reproduction notes

The capture was produced through the Playwright CLI against the production Nitro artifact with hosted writes and session hosting enabled only for the isolated campaign root. The browser was authenticated as GM through the normal trust-based role cookie. Screenshots and ARIA snapshots were taken after the canvas became visible; recordings cover map load and opening the legacy encounter/navigation surfaces. Performance observers were installed before reload and sampled after the canvas was visible plus a 3,000 ms settle window.

Do not regenerate this directory merely because the new UI changes. It is the before-state. New visual and performance evidence belongs in a separately identified acceptance baseline.
