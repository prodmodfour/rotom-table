import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import definitionsJson from '../../data/ability-automation/parameter-definitions.json'
import {
  AbilityParameterValidationError,
  abilityInstanceParameterValues,
  parseAbilityInstanceData,
  parseAbilityParameterDefinitionCatalog,
  resolveAbilityInstanceData,
  type AbilityParameterDefinitionCatalog,
} from '#shared/abilityAutomation/parameters'
import {
  loadCanonicalAbilityCatalog,
  type CanonicalAbilityCatalog,
} from '#shared/abilityAutomation/ruleset'
import {
  SheetAbilityInstanceError,
  resolveSheetAbilityInstances,
} from '../../server/domain/abilityAutomation/instanceParameters'
import { projectAuthoritativeEffectiveAbilities } from '../../server/domain/abilityAutomation/effectiveAbilities'

let canonical: CanonicalAbilityCatalog
let definitions: AbilityParameterDefinitionCatalog

beforeAll(async () => {
  canonical = await loadCanonicalAbilityCatalog(
    readFileSync(join(process.cwd(), 'data/reference/abilities.json')),
  )
  definitions = parseAbilityParameterDefinitionCatalog(definitionsJson, canonical)
})

const instance = (
  canonicalId: string,
  parameterId: string,
  optionId: string,
) => ({
  schemaVersion: 1 as const,
  instanceId: `sheet:ability:${parameterId}`,
  canonicalId,
  definitionVersion: 1,
  selections: [{ parameterId, optionIds: [optionId] }],
})

const expectParameterError = (callback: () => unknown, code: string): void => {
  try {
    callback()
    expect.unreachable(`Expected ${code}`)
  }
  catch (error) {
    expect(error).toBeInstanceOf(AbilityParameterValidationError)
    expect((error as AbilityParameterValidationError).code).toBe(code)
  }
}

describe('ability instance parameters', () => {
  it('source-binds all canonical persistent parameter definitions', () => {
    expect(definitions.entries.map(entry => [
      entry.canonicalId,
      entry.parameters[0]?.id,
      entry.parameters[0]?.acquisition,
      entry.parameters[0]?.optionIds.length,
    ])).toEqual([
      ['Color Theory', 'color', 'server-roll', 12],
      ['Serpent’s Mark', 'pattern', 'inherited-or-server-roll', 6],
      ['Type Strategist', 'type', 'sheet-choice', 18],
    ])
    expect(Object.isFrozen(definitions.entries)).toBe(true)
  })

  it('parses stable canonical choices without retaining labels or input references', () => {
    const source = instance('Type Strategist', 'type', 'fire')
    const parsed = parseAbilityInstanceData(source, 'Type Strategist', definitions)
    source.selections[0]!.optionIds[0] = 'water'

    expect(parsed).toEqual({
      schemaVersion: 1,
      instanceId: 'sheet:ability:type',
      canonicalId: 'Type Strategist',
      definitionVersion: 1,
      selections: [{ parameterId: 'type', optionIds: ['fire'] }],
    })
    expect(abilityInstanceParameterValues(parsed, 'type')).toEqual(['fire'])
    expect(Object.isFrozen(parsed.selections)).toBe(true)
  })

  it('distinguishes missing required data from unparameterized legacy rows', () => {
    expect(resolveAbilityInstanceData(undefined, 'Type Strategist', definitions)).toEqual({
      status: 'missing-required-data',
      data: null,
    })
    expect(resolveAbilityInstanceData(undefined, 'Blaze', definitions)).toEqual({
      status: 'not-parameterized',
      data: null,
    })
    expect(resolveSheetAbilityInstances([
      { name: 'Type Strategist' },
      { name: 'Blaze' },
      { name: 'Type Strategist (Fire)' },
    ])).toEqual([
      expect.objectContaining({
        canonicalId: 'Type Strategist',
        instanceId: 'legacy:0',
        parameterStatus: 'missing-required-data',
      }),
      expect.objectContaining({
        canonicalId: 'Blaze',
        instanceId: 'legacy:1',
        parameterStatus: 'not-parameterized',
      }),
    ])
  })

  it('keeps missing parameters inactive and exposes ready values through projection', () => {
    const target = { placementId: 'actor-token', position: { x: 0, y: 0, z: 0 } }
    const missing = projectAuthoritativeEffectiveAbilities({
      baseAbilities: resolveSheetAbilityInstances([{ name: 'Type Strategist' }]),
      target,
    })
    const ready = projectAuthoritativeEffectiveAbilities({
      baseAbilities: resolveSheetAbilityInstances([{
        name: 'Type Strategist',
        automation: instance('Type Strategist', 'type', 'fire'),
      }]),
      target,
    })

    expect(missing[0]).toMatchObject({
      canonicalId: 'Type Strategist',
      effective: false,
      suppressionReasonCode: 'ability.parameters.missing',
      parameterStatus: 'missing-required-data',
      parameterData: null,
    })
    expect(ready[0]).toMatchObject({
      canonicalId: 'Type Strategist',
      effective: true,
      parameterStatus: 'ready',
      parameterData: { selections: [{ parameterId: 'type', optionIds: ['fire'] }] },
    })
  })

  it('accepts sheet-authored, server-rolled, and inherited stable values', () => {
    const resolved = resolveSheetAbilityInstances([
      { name: 'Type Strategist', automation: instance('Type Strategist', 'type', 'water') },
      { name: 'Color Theory', automation: instance('Color Theory', 'color', 'blue-violet') },
      { name: 'Serpent’s Mark', automation: instance('Serpent’s Mark', 'pattern', 'life') },
    ])

    expect(resolved.map(entry => [
      entry.canonicalId,
      entry.parameterStatus,
      entry.parameterData?.selections[0]?.optionIds[0],
    ])).toEqual([
      ['Type Strategist', 'ready', 'water'],
      ['Color Theory', 'ready', 'blue-violet'],
      ['Serpent’s Mark', 'ready', 'life'],
    ])
  })

  it('rejects stale versions, unknown options, missing selections, and mismatched identity', () => {
    expectParameterError(() => parseAbilityInstanceData({
      ...instance('Type Strategist', 'type', 'fire'),
      definitionVersion: 2,
    }, 'Type Strategist', definitions), 'version-mismatch')

    expectParameterError(() => parseAbilityInstanceData(
      instance('Type Strategist', 'type', 'light'),
      'Type Strategist',
      definitions,
    ), 'unknown-option')

    expectParameterError(() => parseAbilityInstanceData({
      ...instance('Type Strategist', 'type', 'fire'),
      selections: [],
    }, 'Type Strategist', definitions), 'missing-parameter')

    expectParameterError(() => parseAbilityInstanceData(
      instance('Type Strategist', 'type', 'fire'),
      'Color Theory',
      definitions,
    ), 'invalid-instance-data')
  })

  it('rejects duplicate instance identities and executable or unknown instance fields', () => {
    expect(() => resolveSheetAbilityInstances([
      { name: 'Type Strategist', automation: instance('Type Strategist', 'type', 'fire') },
      { name: 'Type Strategist', automation: instance('Type Strategist', 'type', 'water') },
    ])).toThrow(SheetAbilityInstanceError)

    expectParameterError(() => parseAbilityInstanceData({
      ...instance('Type Strategist', 'type', 'fire'),
      callback: () => true,
    }, 'Type Strategist', definitions), 'not-json')

    expectParameterError(() => parseAbilityInstanceData({
      ...instance('Type Strategist', 'type', 'fire'),
      unknown: true,
    }, 'Type Strategist', definitions), 'invalid-instance-data')
  })

  it('rejects stale definition provenance, source phrases, and duplicate rows', () => {
    const stale = structuredClone(definitionsJson)
    stale.sourceDataSha256 = 'a'.repeat(64)
    expectParameterError(
      () => parseAbilityParameterDefinitionCatalog(stale, canonical),
      'source-mismatch',
    )

    const phrase = structuredClone(definitionsJson)
    phrase.entries[0]!.sourcePhrase = 'not canonical source'
    expectParameterError(
      () => parseAbilityParameterDefinitionCatalog(phrase, canonical),
      'source-mismatch',
    )

    const duplicate = structuredClone(definitionsJson)
    duplicate.entries.push(structuredClone(duplicate.entries[0]!))
    expectParameterError(
      () => parseAbilityParameterDefinitionCatalog(duplicate, canonical),
      'duplicate-id',
    )
  })
})
