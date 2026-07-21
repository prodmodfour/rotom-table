import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import constraintsJson from '../../data/ability-automation/timing-constraints.json'
import {
  AbilityTimingConstraintValidationError,
  parseAbilityTimingConstraintCatalog,
} from '#shared/abilityAutomation/timingConstraints'
import {
  loadCanonicalAbilityCatalog,
  type CanonicalAbilityCatalog,
} from '#shared/abilityAutomation/ruleset'

let canonical: CanonicalAbilityCatalog

beforeAll(async () => {
  canonical = await loadCanonicalAbilityCatalog(
    readFileSync(join(process.cwd(), 'data/reference/abilities.json')),
  )
})

describe('reviewed ability timing constraints', () => {
  it('binds every explicit once-per-turn/round source clause without prose inference', () => {
    const catalog = parseAbilityTimingConstraintCatalog(constraintsJson, canonical)

    expect(catalog.entries).toEqual([
      expect.objectContaining({
        canonicalId: 'Harvest',
        constraintId: 'berry-trade-per-turn',
        kind: 'turn',
        limit: 1,
      }),
      expect.objectContaining({
        canonicalId: 'Illusion',
        constraintId: 'assume-guise-per-round',
        kind: 'round',
        limit: 1,
      }),
    ])
    expect(Object.isFrozen(catalog.entries)).toBe(true)
  })

  it('rejects stale source phrases, provenance, duplicates, and callback values', () => {
    const phrase = structuredClone(constraintsJson)
    phrase.entries[0]!.sourcePhrase = 'not canonical'
    expect(() => parseAbilityTimingConstraintCatalog(phrase, canonical)).toThrow(
      AbilityTimingConstraintValidationError,
    )

    const provenance = structuredClone(constraintsJson)
    provenance.sourceDataSha256 = 'a'.repeat(64)
    expect(() => parseAbilityTimingConstraintCatalog(provenance, canonical)).toThrow(
      AbilityTimingConstraintValidationError,
    )

    const duplicate = structuredClone(constraintsJson)
    duplicate.entries.push(structuredClone(duplicate.entries[0]!))
    expect(() => parseAbilityTimingConstraintCatalog(duplicate, canonical)).toThrow(
      AbilityTimingConstraintValidationError,
    )

    expect(() => parseAbilityTimingConstraintCatalog({
      ...constraintsJson,
      entries: [() => true],
    }, canonical)).toThrow(AbilityTimingConstraintValidationError)
  })
})
