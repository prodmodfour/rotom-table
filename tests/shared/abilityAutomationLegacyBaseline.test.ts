import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import baselineJson from '../../data/ability-automation/legacy-baseline.json'
import {
  AbilityAutomationLegacyBaselineValidationError,
  parseAbilityAutomationLegacyBaseline,
  type AbilityAutomationLegacyBaselineValidationCode,
} from '#shared/abilityAutomation/legacyBaseline'
import {
  loadCanonicalAbilityCatalog,
  type CanonicalAbilityCatalog,
} from '#shared/abilityAutomation/ruleset'

let catalog: CanonicalAbilityCatalog

beforeAll(async () => {
  catalog = await loadCanonicalAbilityCatalog(
    readFileSync(join(process.cwd(), 'data/reference/abilities.json')),
  )
})

const expectBaselineError = (
  value: unknown,
  code: AbilityAutomationLegacyBaselineValidationCode,
  path?: string,
): void => {
  try {
    parseAbilityAutomationLegacyBaseline(value, catalog)
    expect.unreachable(`Expected ${code}`)
  }
  catch (error) {
    expect(error).toBeInstanceOf(AbilityAutomationLegacyBaselineValidationError)
    expect((error as AbilityAutomationLegacyBaselineValidationError).code).toBe(code)
    if (path) expect((error as AbilityAutomationLegacyBaselineValidationError).path).toBe(path)
  }
}

describe('ability automation legacy baseline audit', () => {
  it('records only reviewed partial fragments and leaves the remaining catalog explicitly uncovered', () => {
    const baseline = parseAbilityAutomationLegacyBaseline(baselineJson, catalog)
    const fragmentCount = baseline.entries.reduce((count, entry) => count + entry.fragments.length, 0)
    const covered = new Set(baseline.entries.map(entry => entry.canonicalId))
    const uncovered = catalog.abilities.filter(ability => !covered.has(ability.canonicalId))

    expect(baseline.schemaVersion).toBe(1)
    expect(baseline.capturedAt).toBe('2026-07-09')
    expect(baseline.canonicalSourceSha256).toBe(catalog.sourceDataSha256)
    expect(baseline.entries).toHaveLength(45)
    expect(fragmentCount).toBe(55)
    expect(uncovered).toHaveLength(438)
    expect(baseline.entries.map(entry => entry.canonicalId)).toEqual(
      [...baseline.entries.map(entry => entry.canonicalId)].sort(),
    )
  })

  it('links every fragment to an existing repository module and stable behavior codes', () => {
    const baseline = parseAbilityAutomationLegacyBaseline(baselineJson, catalog)

    for (const entry of baseline.entries) {
      for (const fragment of entry.fragments) {
        expect(existsSync(join(process.cwd(), fragment.sourceModule)), fragment.sourceModule).toBe(true)
        expect(fragment.behaviorCodes.length).toBeGreaterThan(0)
        expect(fragment.behaviorCodes.every(code => /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/.test(code))).toBe(true)
      }
    }
  })

  it('distinguishes active, passive, follow-up, immunity, overlay, and interaction fragments', () => {
    const baseline = parseAbilityAutomationLegacyBaseline(baselineJson, catalog)
    const categories = new Set(
      baseline.entries.flatMap(entry => entry.fragments.map(fragment => fragment.category)),
    )

    expect(categories).toEqual(new Set([
      'ability-overlay',
      'active-transaction',
      'condition-immunity',
      'critical-immunity',
      'derived-sheet',
      'move-follow-up',
      'move-interaction',
      'move-script-rewrite',
      'passive-provider',
      'reaction-definition',
      'recoil-immunity',
      'sheet-toggle',
      'weather-immunity',
    ]))
  })

  it('fails on unknown fields, abilities, sources, duplicates, and provenance drift', () => {
    expectBaselineError(
      { ...structuredClone(baselineJson), executable: true },
      'invalid-legacy-baseline',
      'legacyBaseline',
    )

    const unknown = structuredClone(baselineJson)
    unknown.entries[0]!.canonicalId = 'Unknown Ability'
    expectBaselineError(unknown, 'unknown-ability', 'legacyBaseline.entries[0].canonicalId')

    const duplicate = structuredClone(baselineJson)
    duplicate.entries.splice(1, 0, structuredClone(duplicate.entries[0]!))
    expectBaselineError(duplicate, 'duplicate-ability', 'legacyBaseline.entries')

    const badSource = structuredClone(baselineJson)
    badSource.entries[0]!.fragments[0]!.sourceModule = '../private.ts'
    expectBaselineError(
      badSource,
      'invalid-legacy-baseline',
      'legacyBaseline.entries[0].fragments[0].sourceModule',
    )

    const stale = structuredClone(baselineJson)
    stale.canonicalSourceSha256 = 'a'.repeat(64)
    expectBaselineError(
      stale,
      'invalid-legacy-baseline',
      'legacyBaseline.canonicalSourceSha256',
    )
  })
})
