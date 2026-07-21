import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import actionExceptionsJson from '../../data/ability-automation/action-exceptions.json'
import frequencyExceptionsJson from '../../data/ability-automation/frequency-exceptions.json'
import {
  AbilityActionValidationError,
  parseAbilityActionDeclaration,
  parseAbilityActionExceptionCatalog,
  parseCanonicalAbilityActions,
  type AbilityActionExceptionCatalog,
  type AbilityActionValidationCode,
} from '#shared/abilityAutomation/actionEconomy'
import {
  parseAbilityFrequencyExceptionCatalog,
  parseCanonicalAbilityFrequencies,
  type AbilityFrequencyDeclaration,
} from '#shared/abilityAutomation/frequency'
import {
  loadCanonicalAbilityCatalog,
  type CanonicalAbilityCatalog,
} from '#shared/abilityAutomation/ruleset'

let catalog: CanonicalAbilityCatalog
let frequencies: ReadonlyMap<string, AbilityFrequencyDeclaration>
let exceptions: AbilityActionExceptionCatalog

beforeAll(async () => {
  catalog = await loadCanonicalAbilityCatalog(
    readFileSync(join(process.cwd(), 'data/reference/abilities.json')),
  )
  const frequencyExceptions = parseAbilityFrequencyExceptionCatalog(
    frequencyExceptionsJson,
    catalog,
  )
  frequencies = parseCanonicalAbilityFrequencies(catalog, frequencyExceptions)
  exceptions = parseAbilityActionExceptionCatalog(actionExceptionsJson, catalog, frequencies)
})

const expectActionError = (
  callback: () => unknown,
  code: AbilityActionValidationCode,
): void => {
  try {
    callback()
    expect.unreachable(`Expected ${code}`)
  }
  catch (error) {
    expect(error).toBeInstanceOf(AbilityActionValidationError)
    expect((error as AbilityActionValidationError).code).toBe(code)
  }
}

describe('canonical ability action economy', () => {
  it('models every canonical ability and every reviewed branch', () => {
    const actions = parseCanonicalAbilityActions(catalog, frequencies, exceptions)
    const variants = [...actions.values()].flatMap(action => action.variants)
    const costCounts = variants.reduce<Record<string, number>>((counts, variant) => {
      counts[variant.cost] = (counts[variant.cost] ?? 0) + 1
      return counts
    }, {})
    const timingCounts = variants.reduce<Record<string, number>>((counts, variant) => {
      counts[variant.timing] = (counts[variant.timing] ?? 0) + 1
      return counts
    }, {})

    expect(actions.size).toBe(483)
    expect(variants).toHaveLength(488)
    expect(costCounts).toEqual({
      none: 245,
      free: 139,
      swift: 68,
      standard: 20,
      extended: 9,
      shift: 5,
      full: 1,
      special: 1,
    })
    expect(timingCounts).toEqual({
      passive: 243,
      normal: 224,
      reaction: 13,
      interrupt: 4,
      priority: 2,
      triggered: 2,
    })
  })

  it('models normal, Priority, Interrupt, and Reaction timing explicitly', () => {
    const actions = parseCanonicalAbilityActions(catalog, frequencies, exceptions)

    expect(actions.get('Battle Armor')).toEqual({
      kind: 'passive',
      rawActionText: null,
      exceptionId: null,
      variants: [{ id: 'passive', cost: 'none', timing: 'passive', availabilityPool: null }],
    })
    expect(actions.get('Ball Fetch')?.variants).toEqual([
      { id: 'use', cost: 'free', timing: 'reaction', availabilityPool: 'interrupt-reaction' },
    ])
    expect(actions.get('Quick Draw')?.variants).toEqual([
      { id: 'use', cost: 'free', timing: 'interrupt', availabilityPool: 'interrupt-reaction' },
    ])
    expect(actions.get('Leaf Rush')?.variants).toEqual([
      { id: 'use', cost: 'free', timing: 'priority', availabilityPool: null },
    ])
    expect(actions.get('Steam Engine')?.variants).toEqual([
      { id: 'use', cost: 'swift', timing: 'reaction', availabilityPool: 'interrupt-reaction' },
    ])
    expect(actions.get('Receiver')?.variants).toEqual([
      { id: 'use', cost: 'free', timing: 'normal', availabilityPool: null },
    ])
  })

  it('uses one shared availability pool for every Interrupt and Reaction', () => {
    const variants = [...parseCanonicalAbilityActions(catalog, frequencies, exceptions).values()]
      .flatMap(action => action.variants)

    expect(variants.filter(variant => (
      variant.timing === 'interrupt' || variant.timing === 'reaction'
    ))).toHaveLength(17)
    expect(variants.every(variant => (
      variant.timing === 'interrupt' || variant.timing === 'reaction'
        ? variant.availabilityPool === 'interrupt-reaction'
        : variant.availabilityPool === null
    ))).toBe(true)
  })

  it('captures all six source-reviewed exceptional action declarations', () => {
    const actions = parseCanonicalAbilityActions(catalog, frequencies, exceptions)

    expect(exceptions.entries.map(entry => entry.canonicalId)).toEqual([
      'Comatose',
      'Illusion',
      'Memory Wipe',
      'Sap Sipper',
      'Strange Tempo',
      'Vicious',
    ])
    expect(actions.get('Comatose')).toMatchObject({
      exceptionId: 'comatose-move-action-source-term',
      variants: [{ cost: 'special', timing: 'normal' }],
    })
    expect(actions.get('Illusion')?.variants.map(variant => variant.cost)).toEqual([
      'standard',
      'free',
      'free',
    ])
    expect(actions.get('Memory Wipe')?.variants.map(variant => variant.cost)).toEqual([
      'swift',
      'standard',
      'extended',
    ])
    expect(actions.get('Sap Sipper')?.variants).toEqual([
      { id: 'grass-hit', cost: 'none', timing: 'triggered', availabilityPool: null },
    ])
    expect(actions.get('Strange Tempo')?.variants.map(variant => variant.cost)).toEqual([
      'free',
      'standard',
    ])
    expect(actions.get('Vicious')?.variants[0]).toMatchObject({
      cost: 'none',
      timing: 'triggered',
    })
    expect(Object.isFrozen(exceptions.entries[1]!.variants)).toBe(true)
  })

  it('fails closed on unsupported or unreviewed action syntax', () => {
    expectActionError(() => parseAbilityActionDeclaration('Unknown', {
      raw: 'At-Will – Move Action',
      actionText: 'Move Action',
      kind: 'at-will',
      uses: null,
      exceptionId: null,
    }, exceptions), 'missing-exception')

    expectActionError(() => parseAbilityActionDeclaration('Unknown', {
      raw: 'Scene',
      actionText: null,
      kind: 'scene',
      uses: 1,
      exceptionId: null,
    }, exceptions), 'missing-exception')

    expectActionError(() => parseAbilityActionDeclaration('Unknown', {
      raw: 'Scene – Immediate Action',
      actionText: 'Immediate Action',
      kind: 'scene',
      uses: 1,
      exceptionId: null,
    }, exceptions), 'invalid-action')
  })

  it('rejects stale provenance, action-text drift, duplicate rows, and invalid shared pools', () => {
    const stale = structuredClone(actionExceptionsJson)
    stale.sourceDataSha256 = 'a'.repeat(64)
    expectActionError(
      () => parseAbilityActionExceptionCatalog(stale, catalog, frequencies),
      'source-mismatch',
    )

    const drift = structuredClone(actionExceptionsJson)
    drift.entries[0]!.rawActionText = 'Special'
    expectActionError(
      () => parseAbilityActionExceptionCatalog(drift, catalog, frequencies),
      'source-mismatch',
    )

    const duplicate = structuredClone(actionExceptionsJson)
    duplicate.entries.push(structuredClone(duplicate.entries[0]!))
    expectActionError(
      () => parseAbilityActionExceptionCatalog(duplicate, catalog, frequencies),
      'duplicate-id',
    )

    const pool = structuredClone(actionExceptionsJson)
    ;(pool.entries[0]!.variants[0] as { availabilityPool: string | null }).availabilityPool = 'interrupt-reaction'
    expectActionError(
      () => parseAbilityActionExceptionCatalog(pool, catalog, frequencies),
      'invalid-exception-catalog',
    )
  })
})
