import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import exceptionsJson from '../../data/ability-automation/frequency-exceptions.json'
import {
  AbilityFrequencyValidationError,
  parseAbilityFrequency,
  parseAbilityFrequencyExceptionCatalog,
  parseCanonicalAbilityFrequencies,
  type AbilityFrequencyExceptionCatalog,
  type AbilityFrequencyValidationCode,
} from '#shared/abilityAutomation/frequency'
import {
  loadCanonicalAbilityCatalog,
  type CanonicalAbilityCatalog,
} from '#shared/abilityAutomation/ruleset'

let catalog: CanonicalAbilityCatalog
let exceptions: AbilityFrequencyExceptionCatalog

beforeAll(async () => {
  catalog = await loadCanonicalAbilityCatalog(
    readFileSync(join(process.cwd(), 'data/reference/abilities.json')),
  )
  exceptions = parseAbilityFrequencyExceptionCatalog(exceptionsJson, catalog)
})

const expectFrequencyError = (
  callback: () => unknown,
  code: AbilityFrequencyValidationCode,
): void => {
  try {
    callback()
    expect.unreachable(`Expected ${code}`)
  }
  catch (error) {
    expect(error).toBeInstanceOf(AbilityFrequencyValidationError)
    expect((error as AbilityFrequencyValidationError).code).toBe(code)
  }
}

describe('canonical ability frequencies', () => {
  it('parses every canonical row into the five closed frequency families', () => {
    const frequencies = parseCanonicalAbilityFrequencies(catalog, exceptions)
    const counts = [...frequencies.values()].reduce<Record<string, number>>((result, value) => {
      result[value.kind] = (result[value.kind] ?? 0) + 1
      return result
    }, {})

    expect(frequencies.size).toBe(483)
    expect(counts).toEqual({
      static: 243,
      'at-will': 56,
      scene: 151,
      daily: 31,
      exceptional: 2,
    })
    expect([...frequencies.values()].every(value => value.raw.length > 0)).toBe(true)
  })

  it('models counts independently from preserved action-economy text', () => {
    const frequencies = parseCanonicalAbilityFrequencies(catalog, exceptions)

    expect(frequencies.get('Battle Armor')).toEqual({
      raw: 'Static',
      actionText: null,
      kind: 'static',
      uses: null,
      exceptionId: null,
    })
    expect(frequencies.get('Chilling Neigh')).toEqual({
      raw: 'At-Will – Free Action',
      actionText: 'Free Action',
      kind: 'at-will',
      uses: null,
      exceptionId: null,
    })
    expect(frequencies.get('Electric Surge')).toEqual({
      raw: 'Scene x3 – Swift Action',
      actionText: 'Swift Action',
      kind: 'scene',
      uses: 3,
      exceptionId: null,
    })
    expect(frequencies.get('Ice Body')).toEqual({
      raw: 'Daily x5 - Swift Action',
      actionText: 'Swift Action',
      kind: 'daily',
      uses: 5,
      exceptionId: null,
    })
    expect(frequencies.get('Sap Sipper')).toEqual({
      raw: 'Scene',
      actionText: null,
      kind: 'scene',
      uses: 1,
      exceptionId: null,
    })
    expect(frequencies.get('Comatose')?.actionText).toBe('Move Action')
  })

  it('uses source-hash-bound reviewed clauses for both Special abilities', () => {
    const frequencies = parseCanonicalAbilityFrequencies(catalog, exceptions)

    expect(exceptions.entries).toEqual([
      {
        canonicalId: 'Illusion',
        rawFrequency: 'Special',
        exceptionId: 'illusion-marks-and-round-mode',
        clauses: [
          { id: 'mark-target', period: 'at-will', uses: null },
          { id: 'assume-illusion', period: 'round', uses: 1 },
          { id: 'dismiss-illusion', period: 'at-will', uses: null },
        ],
      },
      {
        canonicalId: 'Receiver',
        rawFrequency: 'Special – Free Action',
        exceptionId: 'receiver-separate-scene-clauses',
        clauses: [
          { id: 'ally-faints-copy', period: 'scene', uses: 1 },
          { id: 'user-faints-grant', period: 'scene', uses: 1 },
        ],
      },
    ])
    expect(frequencies.get('Illusion')).toMatchObject({
      kind: 'exceptional',
      actionText: null,
      exceptionId: 'illusion-marks-and-round-mode',
    })
    expect(frequencies.get('Receiver')).toMatchObject({
      kind: 'exceptional',
      actionText: 'Free Action',
      exceptionId: 'receiver-separate-scene-clauses',
    })
    expect(Object.isFrozen(exceptions.entries[0]!.clauses)).toBe(true)
  })

  it('rejects unsupported counts, unreviewed Special clauses, and exceptions on normal frequencies', () => {
    expectFrequencyError(
      () => parseAbilityFrequency('Scene x0 – Free Action', 'Moxie', exceptions),
      'invalid-frequency',
    )
    expectFrequencyError(
      () => parseAbilityFrequency('At-Will x2 – Free Action', 'Moxie', exceptions),
      'invalid-frequency',
    )
    expectFrequencyError(
      () => parseAbilityFrequency('Special', 'Moxie', exceptions),
      'missing-exception',
    )
    expectFrequencyError(
      () => parseAbilityFrequency('Scene – Free Action', 'Illusion', exceptions),
      'unexpected-exception',
    )
  })

  it('rejects exception provenance, source text, shape, and duplicate drift', () => {
    const stale = structuredClone(exceptionsJson)
    stale.sourceDataSha256 = 'a'.repeat(64)
    expectFrequencyError(
      () => parseAbilityFrequencyExceptionCatalog(stale, catalog),
      'source-mismatch',
    )

    const rawDrift = structuredClone(exceptionsJson)
    rawDrift.entries[0]!.rawFrequency = 'Special – Free Action'
    expectFrequencyError(
      () => parseAbilityFrequencyExceptionCatalog(rawDrift, catalog),
      'source-mismatch',
    )

    const duplicate = structuredClone(exceptionsJson)
    duplicate.entries.push(structuredClone(duplicate.entries[1]!))
    expectFrequencyError(
      () => parseAbilityFrequencyExceptionCatalog(duplicate, catalog),
      'duplicate-id',
    )

    const callback = structuredClone(exceptionsJson) as unknown as Record<string, unknown>
    callback.execute = () => undefined
    expectFrequencyError(
      () => parseAbilityFrequencyExceptionCatalog(callback, catalog),
      'not-json',
    )
  })
})
