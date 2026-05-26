import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const testDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(testDir, '../..')

const readText = (relativePath: string): string => readFileSync(resolve(repoRoot, relativePath), 'utf8')
const readJson = <T>(relativePath: string): T => JSON.parse(readText(relativePath)) as T

interface PackageJson {
  readonly scripts: Record<string, string>
  readonly dependencies?: Record<string, string>
  readonly devDependencies?: Record<string, string>
}

interface PackageLockJson {
  readonly packages?: Record<string, { readonly version?: string }>
}

const directPackageNames = (pkg: PackageJson): Set<string> =>
  new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})])

const lockHasPackage = (lock: PackageLockJson, packageName: string): boolean =>
  Object.hasOwn(lock.packages ?? {}, `node_modules/${packageName}`)

const forbiddenDirectDependencies = [
  'ws',
  'socket.io',
  'yjs',
  '@hocuspocus/server',
  'sharedb',
  'redis',
  'ioredis',
  'pg',
  'postgres',
  '@neondatabase/serverless',
  'cloudflare',
  'wrangler',
  'miniflare',
  '@cloudflare/workers-types',
]

describe('Track 2 dependency and runtime review', () => {
  const review = readText('docs/track-2-dependency-runtime-review.md')
  const pkg = readJson<PackageJson>('package.json')
  const lock = readJson<PackageLockJson>('package-lock.json')
  const nuxtConfig = readText('nuxt.config.ts')
  const sessionHostScript = readText('scripts/session-host-dev.mjs')

  it('documents the dependency outcome without changing the locked architecture', () => {
    expect(review).toContain('No new direct runtime dependency is required for Track 2 session hosting')
    expect(review).toContain('existing Nuxt/Nitro app')
    expect(review).toContain('browser `WebSocket`')
    expect(review).toContain('Node built-ins')
    expect(review).toContain('No hosted persistence package is imported, configured, or required by Rotom Table')
    expect(review).toContain('local JSON snapshots plus the optional local JSON-lines event log')
    expect(review).toContain('cloudflared` is an external operator tool, not an npm dependency')
    expect(review).toContain('does not add a package, a database, a cloud service, a public auth provider, or a new deployment target')
    expect(review).not.toContain('Quick Tunnel is the supported')
  })

  it('records the current Nuxt/Nitro dependency inventory and optional transitive boundary', () => {
    expect(review).toContain('| App/server framework | `nuxt`')
    expect(review).toContain('| Nitro WebSocket support | `nitro.experimental.websocket = true`')
    expect(review).toContain('Nuxt/Nitro transitive packages include Nitro/H3/CrossWS')
    expect(review).toContain('| Optional transitive packages | Nuxt/Nitro/devtools may place packages such as `ws` or `ioredis`')
    expect(review).toContain('not direct Rotom Table dependencies')
    expect(review).toContain('| Renderer | `three` plus `@types/three`')
    expect(review).toContain('| Node built-ins | `node:fs`, `node:path`, `node:crypto`, `node:child_process`, `node:process`')
    expect(lockHasPackage(lock, 'nuxt')).toBe(true)
    expect(lockHasPackage(lock, 'nitropack')).toBe(true)
    expect(lockHasPackage(lock, 'h3')).toBe(true)
    expect(lockHasPackage(lock, 'crossws')).toBe(true)
  })

  it('keeps forbidden realtime/database/cloud packages out of direct dependencies', () => {
    const directDeps = directPackageNames(pkg)

    expect(directDeps.has('nuxt')).toBe(true)
    expect(directDeps.has('three')).toBe(true)

    for (const packageName of forbiddenDirectDependencies) {
      expect(directDeps.has(packageName), `${packageName} should not be a direct dependency`).toBe(false)
    }

    expect([...directDeps].some((packageName) => packageName.startsWith('@cloudflare/'))).toBe(false)
  })

  it('documents and validates the exact runtime gate plus safe helper scripts', () => {
    expect(review).toContain('ROTOM_ENABLE_SESSION_HOST=1')
    expect(review).toContain('Values such as `true`, `yes`, `on`, an empty string')
    expect(review).toContain('Plain `npm run dev` keeps session endpoints and `/api/sessions/socket` fail-closed')
    expect(review).toContain('npm run dev:session:lan')
    expect(review).toContain('ROTOM_ENABLE_SESSION_HOST=1 npm run dev -- --host 0.0.0.0 --port 3000')
    expect(review).toContain('npm run dev:session:tunnel')
    expect(review).toContain('ROTOM_ENABLE_SESSION_HOST=1 npm run dev -- --host 127.0.0.1 --port 3000')
    expect(review).toContain('support `--port <port>` and `--print-only`')

    expect(pkg.scripts.dev).toBe('nuxt dev')
    expect(pkg.scripts['dev:session:lan']).toBe('node scripts/session-host-dev.mjs --mode lan')
    expect(pkg.scripts['dev:session:tunnel']).toBe('node scripts/session-host-dev.mjs --mode tunnel')
    expect(pkg.scripts['smoke:session:multi-tab']).toBe('node scripts/session-multi-tab-smoke.mjs')
    expect(sessionHostScript).toContain("export const SESSION_HOST_ENABLE_ENV = 'ROTOM_ENABLE_SESSION_HOST'")
    expect(sessionHostScript).toContain("export const SESSION_HOST_ENABLE_VALUE = '1'")
    expect(sessionHostScript).toContain("host: '0.0.0.0'")
    expect(sessionHostScript).toContain("host: '127.0.0.1'")
  })

  it('documents Node/Nitro compatibility and non-reviewed hosting targets', () => {
    expect(review).toContain('Node 20 or newer is the documented floor')
    expect(review).toContain('@types/node` 20.x')
    expect(review).toContain('normal Node/Nuxt/Nitro server process')
    expect(review).toContain('Static hosting, edge/serverless adapters, Cloudflare Workers, Durable Objects, or serverless functions are not reviewed Track 2 hosts')
    expect(review).toContain('nuxt.config.ts` intentionally enables `nitro.experimental.websocket = true')
    expect(review).toContain('A read-only deployment is not a supported live-session host')
    expect(nuxtConfig).toContain('nitro: {')
    expect(nuxtConfig).toContain('experimental: {')
    expect(nuxtConfig).toContain('websocket: true')
  })

  it('documents Cloudflare named tunnel assumptions without adding Cloudflare as an app dependency', () => {
    expect(review).toContain('named Cloudflare Tunnel with a stable hostname')
    expect(review).toContain('service: http://localhost:3000')
    expect(review).toContain('wss://table.example.com/api/sessions/socket')
    expect(review).toContain('/api/sessions/socket` must preserve WebSocket upgrade behaviour')
    expect(review).toContain('must not cache `/sessions`, `/maps/*`, `/api/sessions/*`, WebSocket responses')
    expect(review).toContain('Cloudflare Access, WAF rules, or IP restrictions may be used as optional outer protection only')
    expect(review).toContain('Quick Tunnel and temporary `trycloudflare.com` hostnames remain development smoke-test only')
    expect(review).toContain('cert.pem`, tunnel credentials JSON, tokens, Access/WAF config, private keys, real `.env` files')
    expect(directPackageNames(pkg).has('cloudflare')).toBe(false)
    expect([...directPackageNames(pkg)].some((packageName) => packageName.startsWith('@cloudflare/'))).toBe(false)
  })

  it('provides a dependency/runtime verification checklist and known limits', () => {
    expect(review).toContain('`package.json` and `package-lock.json` were reviewed')
    expect(review).toContain('npm run dev:session:lan -- --print-only')
    expect(review).toContain('npm run dev:session:tunnel -- --print-only')
    expect(review).toContain('The full quality gate passes: `npm run typecheck`, `npm test`, and `npm run build`')
    expect(review).toContain('no generated `data/sessions/` files')
    expect(review).toContain('Nitro WebSocket support is still explicitly enabled through an experimental configuration flag')
    expect(review).toContain('Legacy `/api/events` SSE remains only for local-first non-session paths')
  })

  it('is linked from primary Track 2 hosting, protocol, and review docs', () => {
    expect(readText('README.md')).toContain('docs/track-2-dependency-runtime-review.md')
    expect(readText('docs/README.md')).toContain('track-2-dependency-runtime-review.md')
    expect(readText('SECURITY.md')).toContain('docs/track-2-dependency-runtime-review.md')
    expect(readText('docs/local-development.md')).toContain('track-2-dependency-runtime-review.md')
    expect(readText('docs/track-2-roadmap.md')).toContain('track-2-dependency-runtime-review.md')
    expect(readText('docs/track-2-validation-matrix.md')).toContain('track-2-dependency-runtime-review.md')
    expect(readText('docs/track-2-session-protocol.md')).toContain('track-2-dependency-runtime-review.md')
    expect(readText('docs/track-2-websocket-protocol.md')).toContain('track-2-dependency-runtime-review.md')
    expect(readText('docs/track-2-session-host-runtime.md')).toContain('track-2-dependency-runtime-review.md')
    expect(readText('docs/track-2-public-exposure-checks.md')).toContain('track-2-dependency-runtime-review.md')
    expect(readText('docs/track-2-lan-hosting.md')).toContain('track-2-dependency-runtime-review.md')
    expect(readText('docs/track-2-cloudflare-tunnel-hosting.md')).toContain('track-2-dependency-runtime-review.md')
    expect(readText('docs/track-2-quick-tunnel-caveat.md')).toContain('track-2-dependency-runtime-review.md')
    expect(readText('docs/track-2-security-review.md')).toContain('track-2-dependency-runtime-review.md')
    expect(readText('docs/track-2-deployment-smoke-checklist.md')).toContain('track-2-dependency-runtime-review.md')
  })
})
