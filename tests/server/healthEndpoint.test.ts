import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import { describe, expect, it } from 'vitest'
import { createReleaseIdentity, ROTOM_TABLE_VERSION } from '../../shared/release/identity'
import { LATEST_STORAGE_SCHEMA_VERSION } from '../../server/storage/migrations'
import healthRoute from '~~/server/api/health.get'
import versionRoute from '~~/server/api/version.get'

const releaseIdentity = createReleaseIdentity({
  storageSchemaVersion: LATEST_STORAGE_SCHEMA_VERSION,
  build: {
    kind: 'release-candidate',
    commit: 'a'.repeat(40),
    tag: `v${ROTOM_TABLE_VERSION}`,
    command: 'npm run build',
    nodeVersion: 'v24.16.0',
    npmVersion: '11.6.0',
    provenanceComplete: true,
  },
})

const event = () => ({
  context: { nitro: { runtimeConfig: { public: { releaseIdentity } } } },
}) as unknown as H3Event

type HealthResponse = {
  ok: true
  service: 'rotom-table'
  version: string
  storageSchemaVersion: number
  build: typeof releaseIdentity.build
}

type HealthRouteHandler = EventHandler<EventHandlerRequest, HealthResponse>
type VersionRouteHandler = EventHandler<EventHandlerRequest, Omit<HealthResponse, 'ok' | 'service'>>

const invokeHealthRoute = async (): Promise<HealthResponse> => (
  healthRoute as HealthRouteHandler
)(event())

const invokeVersionRoute = async (): Promise<Omit<HealthResponse, 'ok' | 'service'>> => (
  versionRoute as VersionRouteHandler
)(event())

describe('release identity endpoints', () => {
  it('returns one role-safe no-secret service identity from health', async () => {
    const status = await invokeHealthRoute()

    expect(status).toEqual({
      ok: true,
      service: 'rotom-table',
      version: ROTOM_TABLE_VERSION,
      storageSchemaVersion: LATEST_STORAGE_SCHEMA_VERSION,
      build: releaseIdentity.build,
    })
    expect(Object.keys(status).sort()).toEqual(['build', 'ok', 'service', 'storageSchemaVersion', 'version'])
    expect(JSON.stringify(status)).not.toMatch(/secret|token|password|campaign|player|\/home\//i)
  })

  it('reports the exact same identity from the dedicated version endpoint', async () => {
    const health = await invokeHealthRoute()
    const version = await invokeVersionRoute()
    expect(version).toEqual({
      version: health.version,
      storageSchemaVersion: health.storageSchemaVersion,
      build: health.build,
    })
  })
})
