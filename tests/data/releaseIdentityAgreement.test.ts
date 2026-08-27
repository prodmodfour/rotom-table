import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import packageMetadata from '../../package.json'
import packageLock from '../../package-lock.json'
import versionMints from '../../data/release-readiness/version-mints.v1.json'
import versionPolicy from '../../data/release-readiness/version-policy.v1.json'
import {
  createReleaseIdentity,
  parseReleaseIdentity,
  releaseTagForVersion,
  ROTOM_TABLE_VERSION,
} from '../../shared/release/identity'
import { LATEST_STORAGE_SCHEMA_VERSION } from '../../server/storage/migrations'

const root = resolve(import.meta.dirname, '../..')
const source = (path: string): string => readFileSync(resolve(root, path), 'utf8')

describe('Plan 13 single-source release identity', () => {
  it('keeps package, lock, mint authority, and derived shared identity in agreement', () => {
    expect(ROTOM_TABLE_VERSION).toBe(packageMetadata.version)
    expect(packageLock.version).toBe(packageMetadata.version)
    expect(packageLock.packages[''].version).toBe(packageMetadata.version)
    expect(versionMints.mints.at(-1)?.to).toBe(packageMetadata.version)
    expect(versionPolicy.sourceOfTruth).toBe('package.json#/version')
    expect(releaseTagForVersion()).toBe(`v${packageMetadata.version}`)
  })

  it('derives server, UI, and Nuxt build surfaces without a second runtime version literal', () => {
    const health = source('server/api/health.get.ts')
    const version = source('server/api/version.get.ts')
    const settings = source('src/components/settings/SettingsPanel.client.vue')
    const nuxt = source('nuxt.config.ts')
    expect(health).toContain('runtimeReleaseIdentity(event)')
    expect(version).toContain('runtimeReleaseIdentity(event)')
    expect(settings).toContain('parseReleaseIdentity(runtimeConfig.public.releaseIdentity)')
    expect(settings).toContain('About Rotom Table')
    expect(nuxt).toContain('createReleaseIdentity')
    for (const runtimeSource of [health, version, settings, nuxt]) {
      expect(runtimeSource).not.toContain(`'${packageMetadata.version}'`)
      expect(runtimeSource).not.toContain(`"${packageMetadata.version}"`)
    }
  })

  it('makes missing dev provenance explicit and rejects release/tag disagreement', () => {
    const development = createReleaseIdentity({
      storageSchemaVersion: LATEST_STORAGE_SCHEMA_VERSION,
      build: {
        kind: 'development',
        commit: null,
        tag: null,
        command: 'nuxt dev',
        nodeVersion: process.version,
        npmVersion: null,
        provenanceComplete: false,
      },
    })
    expect(parseReleaseIdentity(development)).toEqual(development)
    expect(development.build.provenanceComplete).toBe(false)
    expect(() => createReleaseIdentity({
      storageSchemaVersion: LATEST_STORAGE_SCHEMA_VERSION,
      build: {
        ...development.build,
        kind: 'release',
        command: 'npm run build',
        commit: 'a'.repeat(40),
        tag: 'v9.9.9',
        provenanceComplete: true,
      },
    })).toThrow(/disagrees with package version/u)
  })
})
