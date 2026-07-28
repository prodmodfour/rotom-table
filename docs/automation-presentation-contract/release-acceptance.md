# Platform and encounter presentation release acceptance

Acceptance date: 2026-07-28

## Accepted platform

| Component | Accepted version |
| --- | --- |
| Node.js | 24.16.0 |
| npm | 11.13.0 |
| Nuxt | 4.5.1 |
| Nitro | 2.13.4 |
| Vite | 8.1.5 |
| Vue | 3.5.40 |
| TypeScript | 6.0.3 |
| Vitest | 4.1.5 |
| Three.js | 0.176.0 |
| `@nuxt/eslint` | 1.16.0 |
| ESLint | 10.8.0 |
| `@nuxt/test-utils` | 4.1.0 |
| Playwright | 1.62.0 |
| `@axe-core/playwright` | 4.12.1 |

The lockfile is authoritative for transitive versions. Nuxt 5 compatibility and nightly channels are disabled. The Nuxt 3 rollback identity remains documented in [nuxt-3-baseline.md](nuxt-3-baseline.md); the migration acceptance closes its active rollback window, while Git history remains available.

## Migration acceptance

- Explicit `srcDir`, root `server`, root `shared`, root `public`, build directories, watcher exclusions, and trainer-sprite mount are retained and tested.
- Data-fetching call sites do not rely on Nuxt 3 deep fetch refs; editable documents are copied into owned state.
- Browser-only plugin, local storage, teleports, theme bootstrap, and Three.js remain behind client-safe boundaries.
- Nitro Node output, health route, login redirect, public assets, SQLite/WAL campaign root, and WebSocket configuration retain their production shape.
- The production deployment mechanism remains GitHub-based. No local production-like file is presented as a live deployment.

## Tooling acceptance

- `npm run lint` uses first-party Nuxt flat config and correctness rules. Existing unused-code debt is reported as warnings; new encounter contract directories promote it to errors. No formatter or mass style rewrite was introduced.
- Pure Node Vitest excludes `tests/nuxt/**`; Nuxt runtime tests use `vitest.nuxt.config.ts` and `environment: 'nuxt'`.
- Playwright starts a fresh production Nitro build with an isolated disposable SQLite campaign root, isolates browser contexts, retains traces/screenshots/video on failure, and runs desktop plus mobile Chromium. Its real-server cohort covers GM/player login and profile storage, Three.js startup, a server-authoritative token move observed in both contexts, Nitro WebSocket upgrade, IndexedDB outbox creation, offline/reload recovery, and one-row durable presentation replay.
- Pull requests run focused Chromium browser/axe acceptance. Firefox/WebKit and visual-baseline review are scheduled for release candidates or changes to browser-sensitive map rendering; failure artifacts are retained for 14 days in CI.
- Axe is a floor. Keyboard, focus, screen reader, reduced motion, 200% zoom, tactical readability, and private-VPS checks remain manual release tasks in [the QA runbook](../encounter-presentation-manual-qa.md).

## Contract acceptance

Contract schema 1 and snapshot schema 3 provide:

- strict source, participant, offer, passive, affordance, reason, contribution, choice, pending, accepted, correction, history, VFX, and announcement contracts;
- role-specific public, actor-owner, responder-owner, GM, and diagnostic projections;
- exact generic declaration authorization plus source-owned final mechanic authorization;
- Move, Ability, Maneuver, Order, Capability, Feature, Edge, Item, Capture, movement, initiative, scene, field, hazard, terrain, token, and system adapters;
- durable terminal result/realtime integration, duplicate replay, correction integration, pending Move/Ability adapters, and snapshot history recovery;
- one wire-level snapshot bundle and temporary local-only legacy control adapters;
- generic UI action, passive, pending, outcome/history, announcement, and reduced-motion VFX primitives;
- machine-readable command inventory and canonical acceptance matrix.

Shop checkout is deliberately `out-of-encounter`: its authoritative transaction spans shop/inventory/sheet documents and does not pretend to have a map revision.

## Dependency governance

All added packages are development/tooling integrations owned by this initiative. They add no styled UI runtime and do not change mechanic authority.

| Dependency | Runtime boundary | Removal strategy | Review |
| --- | --- | --- | --- |
| `@nuxt/eslint`, `eslint` | build/development | replace only with a supported Nuxt lint integration | MIT; no production service surface |
| `@nuxt/test-utils` | tests | remove with Nuxt runtime project | MIT; test-only |
| `@playwright/test` | browser tests/CI | remove with browser acceptance harness | Apache-2.0; downloads Chromium in CI |
| `@axe-core/playwright` | browser accessibility tests | remove with axe checks | MPL-2.0 transitive axe core; test-only |

`reka-ui` remains intentionally uninstalled and deferred to `EUX-015`. No Pinia, XState, Tailwind, animation framework, virtualization library, or security module was added.

The lockfile also pins a narrow security override: Nitro's `archiver@7` uses API-compatible `readdir-glob@3`, and all `minimatch` consumers use 10.2.6/`brace-expansion` 5.0.8. This removes the brace-expansion denial-of-service advisory without replacing Nitro or opting into another framework version. Nuxt prepare, archive-dependent production build, tests, and `npm audit --audit-level=high` validate the override; remove it once Nitro's declared graph is natively on the fixed line.

## Browser and visual policy

- PR: desktop and Pixel 7 Chromium contract journeys, real GM/player contexts, login/profile and core routes, Three.js/realtime/reconnect/IndexedDB, privacy contexts, duplicate/reload, reduced motion, and serious/critical axe violations.
- Release candidate: add current Firefox/WebKit when map rendering or browser APIs changed; execute manual GM/player production-like journey.
- Visual screenshots are failure artifacts rather than pixel baselines for this contract initiative. Establish a reviewed baseline only when the encounter design system lands, to avoid approving accidental legacy UI as a permanent design.
- Tests disable nondeterminism through canonical in-page facts, bounded timers, explicit reduced-motion emulation, fresh server/context state, and role cookies.

## Validation evidence

Final acceptance was recorded from the clean 2026-07-28 quality-gate run on Node 24.16.0 and npm 11.13.0:

| Check | Result |
| --- | --- |
| dependency install/security | pass — `npm ci`; `npm audit --audit-level=high` reports 0 vulnerabilities |
| contract consistency | pass — 33 command sources inventoried; 14 canonical scenarios have current executable evidence |
| lint | pass — 0 errors; 113 pre-existing unused-code warnings remain visible |
| typecheck | pass — `nuxt typecheck` |
| pure Vitest | pass — 1,102 files / 8,551 tests with four workers |
| Nuxt runtime Vitest | pass — 1 file / 4 tests |
| production Playwright + axe | pass — 14 desktop/mobile Chromium tests, including real GM/player, Three.js, WebSocket, IndexedDB, reconnect/replay, privacy, keyboard/focus, reduced motion, and settled-state axe checks |
| production build | pass — Nuxt 4.5.1 / Nitro 2.13.4 Node artifact built successfully |
| production-like private-host shape | pass — built server start/restart, external campaign root and SQLite, `/api/health`, `/login`, favicon, and trainer-sprite HTTP checks; WebSocket and durable writes/reload are also exercised by the isolated production Playwright campaign |
| full `scripts/quality-gate.sh` | pass — 12m14s, maximum recorded RSS 7,544,308 KiB |
| repository hygiene | pass — `git diff --check`; generated Playwright reports, results, and disposable campaign state are ignored and removed |

This record validates the repository and local private-host execution shape; it is not a direct production deployment. The operator must deploy through GitHub and repeat the private-VPS/access-gate checklist on the real host before campaign play.

## Known compatibility surface

- `abilityActionCapabilitiesFromEncounterPresentation` derives an old in-memory Ability control shape from generic offers/passives; it is not a wire contract.
- `legacyContextMenuProjection` permits old map context menus to enrich labels/details only after a generic server offer/affordance includes the action.
- old Move presentation summaries remain fallback readers for pre-contract rows. New accepted rows carry generic presentation.
- source-owned target panels remain while the later encounter UI plan replaces layout; they cannot authorize mechanics.

These are bounded compatibility adapters, not blockers for subsequent Capability automation. A later UI redesign may remove them without changing server mechanics or the generic contract.
