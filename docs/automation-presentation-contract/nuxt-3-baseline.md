# Nuxt 3 rollback baseline

Captured before APC dependency changes on 2026-07-28.

## Rollback identity

- Git commit: `c5af04b382f0aac76dfe4e96aa86804b04949e8d`
- `package-lock.json` SHA-256: `5d9c07565abfe643e1c17f750eee816d4e2f0aadfe24a75a605fd324e13ebc9c`
- Node: `v24.16.0`
- npm: `11.13.0`
- Nuxt: `3.21.2`
- Nitro: `2.13.3`
- Vite: `7.3.2`
- Vue: `3.5.33`
- TypeScript: `6.0.3`
- Vitest: `4.1.5`
- Three.js: `0.176.0`

The Git commit and lockfile hash are the rollback point. Generated `.nuxt-*` and `.output` directories are not rollback artifacts.

## Passing checks

| Check | Result | Elapsed | Peak RSS |
| --- | --- | ---: | ---: |
| `npm run typecheck` | pass | 0:56.10 | 4,372,468 KB |
| `npm test` | 1,094 files / 8,509 tests passed | 2:52.88 | 976,308 KB |
| `npm run build` | pass | 1:09.58 | 4,233,556 KB |
| built server `/api/health` | `{"ok":true,"service":"rotom-table"}` | — | — |
| built server `/` | HTTP 302 to the login flow | — | — |
| built server `/favicon.png` | HTTP 200, 27,181 bytes | — | — |

The build emitted only the existing Vite chunk-size warning. It emitted no Nuxt deprecation or hydration warning.

## Production-like assumptions retained

- application source: `src/`
- server source: root `server/`
- shared source: root `shared/`
- public files: root `public/`
- generated directories: `.nuxt-dev`, `.nuxt-build`, `.output`
- trainer sprites: root `trainer_sizes/sprites`, mounted at `/trainer-sprites`
- persistence: campaign root selected by `ROTOM_CAMPAIGN_ROOT`; SQLite/WAL remains authoritative in hosted mode
- realtime: Nitro experimental WebSocket endpoint under `/api/sessions/socket`

Private-VPS verification is an operator acceptance step, not a repository mutation. The local production-like smoke and browser suites use an isolated temporary campaign root.
