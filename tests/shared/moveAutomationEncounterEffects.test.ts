import { describe, expect, it } from 'vitest'
import {
  ENCOUNTER_EFFECT_LIMITS,
  EncounterEffectValidationError,
  parseEncounterEffect,
  parseEncounterEffects,
} from '#shared/moveAutomation/encounterEffects'
import {
  capabilityEncounterEffectFixture,
  conditionEncounterEffectFixture,
  itemSuppressionEncounterEffectFixture,
  numericEncounterEffectFixture,
} from '../fixtures/moveAutomation/encounterEffects'

describe('typed encounter effects', () => {
  it('round-trips every supported payload kind as detached plain data', () => {
    const input = [
      conditionEncounterEffectFixture(),
      numericEncounterEffectFixture(),
      capabilityEncounterEffectFixture(),
      itemSuppressionEncounterEffectFixture(),
    ]
    const parsed = parseEncounterEffects(structuredClone(input))

    expect(parsed).toEqual(input)
    expect(JSON.stringify(parsed)).toBe(JSON.stringify(input))
    expect(parsed).not.toBe(input)
    expect(parsed[0]).not.toBe(input[0])
    expect(parsed[0]?.source).not.toBe(input[0]?.source)
    expect(parsed[0]?.affected.cells).not.toBe(input[0]?.affected.cells)
    expect(parsed[0]?.payload).not.toBe(input[0]?.payload)
    expect(parsed[0]?.dispel).not.toBe(input[0]?.dispel)
    expect(parsed[0]?.suppression).not.toBe(input[0]?.suppression)
  })

  it('selects an exact payload union from the effect kind', () => {
    const condition = conditionEncounterEffectFixture()

    expect(() => parseEncounterEffect({
      ...condition,
      payload: numericEncounterEffectFixture().payload,
    })).toThrow('encounterEffect.payload: must contain exactly the supported fields')
    expect(() => parseEncounterEffect({
      ...condition,
      kind: 'script',
      payload: { source: 'apply anything' },
    })).toThrowError(EncounterEffectValidationError)
    expect(() => parseEncounterEffect({
      ...condition,
      payload: { ...condition.payload, metadata: { arbitrary: true } },
    })).toThrow('unknown metadata')
  })

  it('stores resolved condition save timing and forbids save metadata on prevention', () => {
    const effect = conditionEncounterEffectFixture()
    expect(parseEncounterEffect(effect).payload).toEqual({
      conditionId: 'sleep',
      action: 'apply',
      saveTiming: 'end-turn',
    })
    const legacy = parseEncounterEffect({
      ...effect,
      payload: { conditionId: 'sleep', action: 'apply' },
    })
    expect(legacy.payload).toEqual({ conditionId: 'sleep', action: 'apply' })
    expect(() => parseEncounterEffect({
      ...effect,
      payload: { conditionId: 'sleep', action: 'prevent', saveTiming: 'end-turn' },
    })).toThrow('encounterEffect.payload.saveTiming: must be null')
  })

  it('validates source identity, recipients, creation coordinates, counts, and duration', () => {
    const effect = conditionEncounterEffectFixture()

    expect(() => parseEncounterEffect({
      ...effect,
      source: { ...effect.source, operationId: 'Not Stable' },
    })).toThrow('encounterEffect.source.operationId: must be a lowercase stable identifier')
    expect(() => parseEncounterEffect({
      ...effect,
      affected: { placementIds: [], sideIds: [], cells: [] },
    })).toThrow('must identify at least one affected placement, side, or cell')
    expect(() => parseEncounterEffect({
      ...effect,
      affected: { ...effect.affected, cells: [{ x: 1, y: -1, z: 2 }] },
    })).toThrow('encounterEffect.affected.cells[0].y: must be from 0')
    expect(() => parseEncounterEffect({ ...effect, createdRound: 0 }))
      .toThrow('encounterEffect.createdRound: must be from 1')
    expect(() => parseEncounterEffect({ ...effect, stacks: 0 }))
      .toThrow('encounterEffect.stacks: must be from 1')
    expect(() => parseEncounterEffect({ ...effect, charges: -1 }))
      .toThrow('encounterEffect.charges: must be from 0')
    expect(() => parseEncounterEffect({
      ...effect,
      duration: { kind: 'scene', remaining: 1 },
    })).toThrow('must be null for scene, until-triggered, and permanent durations')
    expect(() => parseEncounterEffect({
      ...effect,
      duration: { kind: 'rounds', remaining: null },
    })).toThrow('encounterEffect.duration.remaining: must be a safe integer')
  })

  it('parses explicit lifecycle policies and canonicalizes pre-policy effect data', () => {
    const effect = conditionEncounterEffectFixture()
    const { stackPolicy: _stackPolicy, chargePolicy: _chargePolicy, ...legacyEffect } = effect
    const legacy = {
      ...legacyEffect,
      duration: { kind: 'turns', remaining: 2 },
    }

    expect(parseEncounterEffect(legacy)).toMatchObject({
      duration: { kind: 'turns', subject: 'target', boundary: 'end', remaining: 2 },
      stackPolicy: { kind: 'independent-instance', maxStacks: null },
      chargePolicy: { kind: 'consume-on-trigger', amount: 1 },
    })
    expect(() => parseEncounterEffect({
      ...effect,
      duration: { kind: 'rounds', subject: 'source', boundary: 'end', remaining: 1 },
    })).toThrow('encounterEffect.duration.subject: is supported only for turn durations')
    expect(() => parseEncounterEffect({
      ...effect,
      stackPolicy: { kind: 'add-stack', maxStacks: 0 },
    })).toThrow('encounterEffect.stackPolicy.maxStacks: must be from 1')
    expect(() => parseEncounterEffect({
      ...effect,
      stacks: 3,
      stackPolicy: { kind: 'add-stack', maxStacks: 2 },
    })).toThrow('current stacks 3 exceed maxStacks 2')
    expect(() => parseEncounterEffect({
      ...effect,
      stackPolicy: { kind: 'refresh', maxStacks: 2 },
    })).toThrow('must be null unless policy is add-stack')
    expect(() => parseEncounterEffect({
      ...effect,
      chargePolicy: { kind: 'none', amount: null },
    })).toThrow('requires charges to be null when charge policy is none')
    expect(() => parseEncounterEffect({
      ...effect,
      charges: null,
      chargePolicy: { kind: 'consume-on-trigger', amount: 1 },
    })).toThrow('requires a finite charge count for consume-on-trigger')
  })

  it('stores explicit switch transfer policy and rejects unknown behavior', () => {
    const effect = numericEncounterEffectFixture()
    const passable = parseEncounterEffect({
      ...effect,
      transferPolicy: 'baton-pass',
    })

    expect(passable.transferPolicy).toBe('baton-pass')
    expect(parseEncounterEffect(effect).transferPolicy).toBeUndefined()
    expect(() => parseEncounterEffect({
      ...effect,
      transferPolicy: 'copy-on-any-switch',
    })).toThrow('encounterEffect.transferPolicy: must be retain, expire, or baton-pass')
  })

  it('retains opaque item suppression bindings and rejects ineffective or inconsistent scope', () => {
    const effect = itemSuppressionEncounterEffectFixture()
    expect(parseEncounterEffect(effect).payload).toEqual({
      familyId: 'embargo.item-suppression',
      scope: 'all-equipped',
      itemBindingIds: [],
      blocksUse: true,
      blocksBenefit: true,
    })
    expect(() => parseEncounterEffect({
      ...effect,
      payload: { ...effect.payload, scope: 'item-bindings' },
    })).toThrow('must be non-empty exactly when scope is item-bindings')
    expect(() => parseEncounterEffect({
      ...effect,
      payload: { ...effect.payload, blocksUse: false, blocksBenefit: false },
    })).toThrow('must block item use, item benefit, or both')
  })

  it('accepts bounded valued capability grants and rejects valued suppressions', () => {
    const effect = capabilityEncounterEffectFixture()

    expect(parseEncounterEffect(effect).payload).toEqual({
      capabilityId: 'movement.levitate',
      action: 'grant',
      value: 4,
    })
    expect(() => parseEncounterEffect({
      ...effect,
      payload: { ...effect.payload, value: 1.5 },
    })).toThrow('encounterEffect.payload.value: must be a safe integer')
    expect(() => parseEncounterEffect({
      ...effect,
      payload: { ...effect.payload, action: 'suppress', value: 4 },
    })).toThrow('encounterEffect.payload.value: is supported only for capability grants')
  })

  it('requires bounded unique tags, recipients, cells, and effect ids', () => {
    const effect = conditionEncounterEffectFixture()

    expect(() => parseEncounterEffect({ ...effect, tags: ['condition', 'condition'] }))
      .toThrow('encounterEffect.tags: must not contain duplicate identifiers')
    expect(() => parseEncounterEffect({
      ...effect,
      affected: { ...effect.affected, placementIds: ['target-token', 'target-token'] },
    })).toThrow('encounterEffect.affected.placementIds: must not contain duplicate identifiers')
    expect(() => parseEncounterEffect({
      ...effect,
      affected: {
        ...effect.affected,
        cells: [{ x: 1, y: 0, z: 1 }, { x: 1, y: 0, z: 1 }],
      },
    })).toThrow('encounterEffect.affected.cells: must not contain duplicate cells')
    expect(() => parseEncounterEffects([effect, structuredClone(effect)]))
      .toThrow('encounterEffects.id: must not contain duplicate identifiers')

    const oversized = Array.from(
      { length: ENCOUNTER_EFFECT_LIMITS.count + 1 },
      (_, index) => ({ ...effect, id: `effect.test-${index}` }),
    )
    expect(() => parseEncounterEffects(oversized))
      .toThrow(`encounterEffects: must contain at most ${ENCOUNTER_EFFECT_LIMITS.count} entries`)
  })

  it('enforces dispel policy and explicit suppression references', () => {
    const suppressor = capabilityEncounterEffectFixture()
    const suppressed = {
      ...numericEncounterEffectFixture(),
      suppression: {
        sources: [{ effectId: suppressor.id, reasonCode: 'gravity.suppresses-levitate' }],
      },
    }

    expect(parseEncounterEffects([suppressor, suppressed])[1]?.suppression).toEqual({
      sources: [{ effectId: suppressor.id, reasonCode: 'gravity.suppresses-levitate' }],
    })
    expect(() => parseEncounterEffect({
      ...suppressor,
      dispel: { policy: 'none', tags: ['movement'] },
    })).toThrow('must be empty when dispel policy is none')
    expect(() => parseEncounterEffect({
      ...suppressor,
      dispel: { policy: 'matching-tags', tags: [] },
    })).toThrow('must not be empty for matching-tags dispel policy')
    expect(() => parseEncounterEffects([
      {
        ...suppressed,
        suppression: {
          sources: [{ effectId: 'effect.unknown', reasonCode: 'field.suppressed' }],
        },
      },
    ])).toThrow('references unknown effect effect.unknown')
    expect(() => parseEncounterEffects([
      {
        ...suppressed,
        suppression: {
          sources: [{ effectId: suppressed.id, reasonCode: 'self.suppressed' }],
        },
      },
    ])).toThrow('cannot suppress its own effect')
  })

  it('rejects non-finite or unbounded numeric payloads', () => {
    const modifier = numericEncounterEffectFixture()

    expect(() => parseEncounterEffect({
      ...modifier,
      payload: { ...modifier.payload, value: Number.NaN },
    })).toThrow('encounterEffect.payload.value: must be a finite number')
    expect(() => parseEncounterEffect({
      ...modifier,
      payload: {
        ...modifier.payload,
        value: ENCOUNTER_EFFECT_LIMITS.numericMagnitude + 1,
      },
    })).toThrow(`magnitude must not exceed ${ENCOUNTER_EFFECT_LIMITS.numericMagnitude}`)
  })
})
