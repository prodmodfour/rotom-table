import { describe, expect, it } from 'vitest'
import type {
  EncounterCapabilityEffect,
  EncounterNumericModifierEffect,
} from '#shared/moveAutomation/encounterEffects'
import {
  effectiveMovementMode,
  projectEffectiveMovement,
} from '~/utils/encounterMovement'

const capabilityEffect = (options: {
  readonly id: string
  readonly capabilityId: string
  readonly action?: 'grant' | 'suppress'
  readonly value?: number
  readonly placementIds?: readonly string[]
  readonly sideIds?: readonly string[]
  readonly cells?: readonly { x: number; y: number; z: number }[]
}): EncounterCapabilityEffect => ({
  id: options.id,
  kind: 'capability',
  source: {
    operationId: `${options.id}.operation`,
    moveId: 'move.movement-test',
    placementId: 'source',
  },
  affected: {
    placementIds: options.placementIds ?? ['actor'],
    sideIds: options.sideIds ?? [],
    cells: options.cells ?? [],
  },
  createdRound: 1,
  createdTurn: 0,
  duration: { kind: 'rounds', boundary: 'end', remaining: 1 },
  stacks: 1,
  charges: null,
  stackPolicy: { kind: 'replace', maxStacks: null },
  chargePolicy: { kind: 'none', amount: null },
  tags: ['movement'],
  payload: {
    capabilityId: options.capabilityId,
    action: options.action ?? 'grant',
    ...(options.value === undefined ? {} : { value: options.value }),
  },
  dispel: { policy: 'matching-tags', tags: ['movement'] },
  suppression: { sources: [] },
})

const numericEffect = (): EncounterNumericModifierEffect => ({
  id: 'effect.movement-overland-bonus',
  kind: 'numeric-modifier',
  source: {
    operationId: 'effect.movement-overland-bonus.operation',
    moveId: 'move.movement-test',
    placementId: 'source',
  },
  affected: {
    placementIds: [],
    sideIds: ['red'],
    cells: [],
  },
  createdRound: 1,
  createdTurn: 0,
  duration: { kind: 'scene', remaining: null },
  stacks: 2,
  charges: null,
  stackPolicy: { kind: 'independent-instance', maxStacks: null },
  chargePolicy: { kind: 'none', amount: null },
  tags: ['movement.overland'],
  payload: {
    attribute: 'movement',
    operation: 'add',
    value: 1,
    rounding: 'none',
  },
  dispel: { policy: 'none', tags: [] },
  suppression: { sources: [] },
})

const baseInput = () => ({
  sheetCapabilities: {
    overland: 8,
    sky: 6,
    swim: 5,
    burrow: 4,
    levitate: 3,
    climb: 4,
  },
  sheetTraits: {
    phasing: true,
    jump: { long: 3, high: 2 },
  },
  sheetConditions: [] as string[],
  target: {
    placementId: 'actor',
    sideId: 'red',
    position: { x: 2, y: 0, z: 2 },
    base: 1,
    clearance: 1,
  },
})

describe('effective encounter movement projection', () => {
  it('models every reviewed movement mode and keeps rule state independent', () => {
    const profile = projectEffectiveMovement(baseInput())

    expect(profile.speeds).toEqual({
      overland: 8,
      sky: 6,
      swim: 5,
      levitate: 3,
      burrow: 4,
      climb: 4,
    })
    expect(profile.traits).toEqual({
      phasing: true,
      jump: { long: 3, high: 2 },
    })
    expect(profile.state).toEqual({
      grounding: 'airborne',
      semiInvulnerable: 'none',
    })
    expect(profile.modes.map(mode => mode.mode)).toEqual([
      'overland',
      'sky',
      'swim',
      'burrow',
      'levitate',
      'phasing',
      'jump',
      'climb',
    ])
    expect(effectiveMovementMode(profile, 'jump')).toEqual({
      mode: 'jump',
      available: true,
      speed: null,
      longJump: 3,
      highJump: 2,
    })
    expect(Object.isFrozen(profile)).toBe(true)
    expect(Object.isFrozen(profile.modes)).toBe(true)
  })

  it('applies typed temporary grants, suppressions, state overlays, and numeric modifiers in order', () => {
    const profile = projectEffectiveMovement({
      ...baseInput(),
      encounterEffects: [
        capabilityEffect({
          id: 'effect.suppress-overland',
          capabilityId: 'movement.overland',
          action: 'suppress',
        }),
        capabilityEffect({
          id: 'effect.grant-overland',
          capabilityId: 'movement.mode.overland',
        }),
        numericEffect(),
        capabilityEffect({
          id: 'effect.suppress-sky',
          capabilityId: 'movement.sky',
          action: 'suppress',
        }),
        capabilityEffect({
          id: 'effect.suppress-phasing',
          capabilityId: 'movement.phasing',
          action: 'suppress',
        }),
        capabilityEffect({
          id: 'effect.jump-high',
          capabilityId: 'movement.jump.high',
          value: 5,
        }),
        capabilityEffect({
          id: 'effect.force-grounded',
          capabilityId: 'movement.grounding.grounded',
        }),
        capabilityEffect({
          id: 'effect.underground',
          capabilityId: 'movement.semi-invulnerable.underground',
        }),
        capabilityEffect({
          id: 'effect.other-target',
          capabilityId: 'movement.swim',
          action: 'suppress',
          placementIds: ['other'],
        }),
      ],
    })

    expect(profile.speeds).toMatchObject({ overland: 10, swim: 5, levitate: 3 })
    expect(profile.speeds.sky).toBeUndefined()
    expect(profile.traits).toEqual({ phasing: false, jump: { long: 3, high: 5 } })
    expect(profile.state).toEqual({
      grounding: 'grounded',
      semiInvulnerable: 'underground',
    })
    expect(profile.sourceEffectIds).toEqual([
      'effect.suppress-overland',
      'effect.grant-overland',
      'effect.movement-overland-bonus',
      'effect.suppress-sky',
      'effect.suppress-phasing',
      'effect.jump-high',
      'effect.force-grounded',
      'effect.underground',
    ])
  })

  it('uses footprint cell overlays but ignores suppressed, depleted, and unrelated effects', () => {
    const cellGrant = capabilityEffect({
      id: 'effect.cell-levitate',
      capabilityId: 'movement.levitate',
      value: 7,
      placementIds: [],
      cells: [{ x: 3, y: 0, z: 2 }],
    })
    const suppressed = {
      ...capabilityEffect({
        id: 'effect.suppressed-swim',
        capabilityId: 'movement.swim',
        action: 'suppress',
      }),
      suppression: {
        sources: [{ effectId: 'effect.gravity', reasonCode: 'gravity.suppressed' }],
      },
    }
    const depleted = {
      ...capabilityEffect({
        id: 'effect.depleted-burrow',
        capabilityId: 'movement.burrow',
        action: 'suppress',
      }),
      charges: 0,
      chargePolicy: { kind: 'consume-on-trigger' as const, amount: 1 },
    }

    const profile = projectEffectiveMovement({
      ...baseInput(),
      target: { ...baseInput().target, base: 2 },
      encounterEffects: [cellGrant, suppressed, depleted],
    })

    expect(profile.speeds).toMatchObject({ levitate: 7, swim: 5, burrow: 4 })
    expect(profile.sourceEffectIds).toEqual(['effect.cell-levitate'])
  })

  it('does not derive grounding or semi-invulnerability from a map/display height', () => {
    const profile = projectEffectiveMovement({
      sheetCapabilities: { overland: 4 },
      sheetTraits: { phasing: false, jump: { long: 1, high: 1 } },
      sheetConditions: [],
      target: {
        placementId: 'actor',
        // Mechanical map elevation is present, but neither it nor sprite height
        // is an airborne or semi-invulnerable rule declaration.
        position: { x: 1, y: 9, z: 1 },
      },
    })

    expect(profile.state).toEqual({ grounding: 'grounded', semiInvulnerable: 'none' })
  })
})
