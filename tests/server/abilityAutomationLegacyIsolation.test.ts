import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ABILITY_AUTOMATION_LEGACY_COMPATIBILITY_POLICY } from '#shared/abilityAutomation/legacyCompatibility'
import { selectNativeAbilityRuntime } from '../../server/domain/abilityAutomation/runtimeSelection'

const root = process.cwd()

const productionSourceFiles = (directory: string): string[] => readdirSync(directory)
  .flatMap((name) => {
    const path = join(directory, name)
    if (statSync(path).isDirectory()) return productionSourceFiles(path)
    return /\.(?:ts|vue)$/.test(name) ? [path] : []
  })

const manifestRow = (
  overrides: Partial<{
    canonicalId: string
    baseStatus: 'blocked' | 'assisted' | 'complete'
    runtimeKind: 'unimplemented' | 'abilityspec-v1'
  }> = {},
) => ({
  canonicalId: overrides.canonicalId ?? 'Moxie',
  baseStatus: overrides.baseStatus ?? 'complete',
  runtime: {
    kind: overrides.runtimeKind ?? 'abilityspec-v1',
    version: 1,
    definitionHash: 'a'.repeat(64),
    sourceModule: 'server/domain/abilityAutomation/specs/moxie.ts',
  },
})

describe('ability automation legacy isolation', () => {
  it('declares narrow compatibility boundaries and forbids native fallback', () => {
    expect(ABILITY_AUTOMATION_LEGACY_COMPATIBILITY_POLICY).toEqual({
      schemaVersion: 1,
      boundaries: ['client-live-play-panel', 'server-live-play-table-action'],
      nativeRuntimeFallback: 'forbidden',
      directProductionImports: 'forbidden',
      retirementCondition: 'certify-abilityspec-and-retire-compatibility-path',
    })
  })

  it('keeps direct legacy implementation imports inside explicit boundaries', () => {
    const files = [
      ...productionSourceFiles(join(root, 'server')),
      ...productionSourceFiles(join(root, 'src')),
    ]
    const directImports = files
      .filter((path) => {
        const source = readFileSync(path, 'utf8')
        return source.includes("from '~/utils/abilityAutomation'")
          || source.includes('from "~/utils/abilityAutomation"')
          || source.includes("from './abilityAutomation'")
          || source.includes('from "./abilityAutomation"')
      })
      .map(path => relative(root, path))
      .sort()

    expect(directImports).toEqual([
      'server/domain/abilityAutomation/legacyCompatibility.ts',
      'src/utils/abilityAutomationLegacyCompatibility.ts',
    ])
  })

  it('routes authoritative table actions through the named server compatibility boundary', () => {
    for (const path of [
      'server/useCases/applyMapTokenTableAction.ts',
      'server/useCases/applyUseTableActionCommand.ts',
    ]) {
      const source = readFileSync(join(root, path), 'utf8')
      expect(source).toContain("from '../domain/abilityAutomation/legacyCompatibility'")
      expect(source).toContain('getLegacyMapAbilityAutomation')
      expect(source).toContain('resolveLegacyMapAbilityAutomationTransaction')
    }
  })

  it('selects only manifest-certified native registrations', () => {
    const registration = {
      canonicalId: 'Moxie',
      kind: 'abilityspec-v1' as const,
      version: 1,
      definitionHash: 'a'.repeat(64),
      sourceModule: 'server/domain/abilityAutomation/specs/moxie.ts',
      definition: { id: 'moxie' },
    }

    expect(selectNativeAbilityRuntime(manifestRow(), registration)).toEqual({
      kind: 'native',
      registration,
    })
    expect(selectNativeAbilityRuntime(manifestRow({ baseStatus: 'blocked' }), registration)).toEqual({
      kind: 'unavailable',
      reason: 'manifest-base-status-not-complete',
    })
    expect(selectNativeAbilityRuntime(
      manifestRow({ runtimeKind: 'unimplemented' }),
      registration,
    )).toEqual({
      kind: 'unavailable',
      reason: 'manifest-runtime-not-native',
    })
    expect(selectNativeAbilityRuntime(manifestRow(), null)).toEqual({
      kind: 'unavailable',
      reason: 'registration-missing',
    })
    expect(selectNativeAbilityRuntime(manifestRow(), { ...registration, canonicalId: 'Celebrate' })).toEqual({
      kind: 'unavailable',
      reason: 'registration-canonical-id-mismatch',
    })
    expect(selectNativeAbilityRuntime(manifestRow(), { ...registration, version: 2 })).toEqual({
      kind: 'unavailable',
      reason: 'registration-metadata-mismatch',
    })
  })
})
