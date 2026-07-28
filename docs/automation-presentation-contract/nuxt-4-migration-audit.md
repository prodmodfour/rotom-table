# Repository-specific Nuxt 4 migration audit

Accepted target: Nuxt **4.5.1** on Node **24.16.0** (2026-07-28). Nitro 2.13.4, Vite 8.1.5, Vue 3.5.40, and the exact transitive graph are locked in `package-lock.json`.

This audit is bound to the Nuxt 3 rollback baseline in [nuxt-3-baseline.md](./nuxt-3-baseline.md). The target is stable Nuxt 4 without Nuxt 5 compatibility flags.

## Directory and path contract

| Concern | Existing contract | Nuxt 4 decision | Verification |
| --- | --- | --- | --- |
| app source | `src/` | retain explicit `srcDir: 'src'` | prepare, typecheck, SSR route and browser smoke |
| server | root `server/` | retain explicit `serverDir: 'server'` | built API route smoke |
| shared | root `shared/` | Nuxt 4 resolves shared from `rootDir` with custom `srcDir`; retain imports | typecheck and pure tests |
| public | root `public/` | use root-relative Nuxt 4 `dir.public: 'public'` | favicon and badge HTTP smoke |
| aliases | `~` and `@` resolve to `src/` | preserve; pure Vitest aliases stay explicit | typecheck and tests |
| build output | `.nuxt-dev` / `.nuxt-build` | preserve to avoid dev/build collisions | prepare, typecheck and build |
| trainer sprites | `trainer_sizes/sprites` | preserve Nitro `publicAssets` mount | built HTTP asset smoke |
| campaign data | `ROTOM_CAMPAIGN_ROOT` outside app source | preserve; never move beneath `src/` | isolated SQLite smoke |

Nuxt 4 changes its default app directory to `app/`, but an explicit custom `srcDir` remains supported. Root `server/`, `shared/`, and `public/` must not be moved to imitate the default structure.

## Configuration inventory

- No Nuxt modules were present on the rollback baseline.
- Components are auto-imported recursively from `src/components` with `pathPrefix: false`.
- One global route middleware (`src/middleware/auth.global.ts`) owns profile/login redirects.
- One client plugin (`src/plugins/styled-title-tooltips.client.ts`) uses DOM APIs only after client startup.
- `ClientOnly` protects the Three.js map and scene-only controls.
- teleport users render modals, menus, and reference tooltips to `body`.
- the inline head bootstrap reads only the theme key and prevents a theme flash.
- Nitro experimental WebSockets are required by the live-session transport.
- app-owned persistence directories are excluded from Vite and Chokidar watchers with regular expressions.

## Nuxt 4 risk review

### Data fetching and shallow refs

The repository has five Nuxt data-fetching call sites. Each uses a distinct stable key per resource or a computed key tied to a slug. No two call sites intentionally share a key with conflicting `deep`, `transform`, `pick`, `default`, or cache options. Loaded sheet and inventory documents are cloned into explicit editable state before nested mutation, so Nuxt 4 shallow data refs do not become mutable domain stores. The Pokedex detail/index requests replace whole values rather than relying on deep fetch-ref tracking.

### Component and page names

No production logic uses generated Nuxt component names as mechanic identity. Tests mount imported components directly. Nuxt 5 page-name normalization is not enabled.

### Hydration and browser boundaries

- browser-only plugins retain `.client.ts` suffixes;
- the Three.js component retains `.client.vue` and a `ClientOnly` boundary;
- local/session storage reads are delayed to mounted code or guarded utilities;
- teleports have deterministic closed SSR state;
- theme bootstrap is intentionally inline and idempotent;
- route and browser tests fail on hydration console errors.

### Compatibility policy

- do not set `future.compatibilityVersion: 5`;
- do not use nightly channels;
- retain the reviewed `compatibilityDate` unless observed runtime behaviour requires an explicit change;
- fix migration regressions instead of setting broad compatibility flags.

## Deployment audit

The production artifact remains a Nitro Node server started with `node .output/server/index.mjs` on Node 24. Reverse proxy forwarding, WebSocket upgrade forwarding, campaign-root permissions, hosted-write policy, SQLite WAL files, health checks, and backups are unchanged. Repository changes are deployed through GitHub; this migration does not alter production directly.

## Acceptance and rollback closure

`nuxt prepare`, lint, typecheck, pure and Nuxt-runtime tests, production Nitro build, production-build Playwright, axe, health/route/asset checks, and the local production-like campaign smoke are the migration gate. Results are recorded in [release-acceptance.md](release-acceptance.md).

No Nuxt 5 flag, compatibility escape hatch, unexplained hydration warning, or directory relocation was required. The active rollback window to commit `c5af04b382f0aac76dfe4e96aa86804b04949e8d` is closed after final acceptance; the baseline remains a historical recovery reference. Production deployment remains the user's GitHub-based path.

## Official references

- [Nuxt 4 upgrade guide](https://nuxt.com/docs/4.x/getting-started/upgrade)
- [Nuxt ESLint module](https://eslint.nuxt.com/packages/module)
- [Nuxt testing guide](https://nuxt.com/docs/getting-started/testing)
- [Playwright web-server configuration](https://playwright.dev/docs/test-webserver)
