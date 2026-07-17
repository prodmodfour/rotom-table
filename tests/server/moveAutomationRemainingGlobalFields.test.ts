import { describe, expect, it } from 'vitest'
import { parseEncounterEffect } from '#shared/moveAutomation/encounterEffects'
import {
  createEmptyEncounterState,
  type EncounterState,
} from '#shared/moveAutomation/encounterState'
import {
  parseEncounterZone,
  type EncounterGlobalFieldZone,
  type EncounterZoneDuration,
} from '#shared/moveAutomation/encounterZones'
import { applyEncounterEffectLifecycleEvent } from '~~/server/domain/moveAutomation/effectLifecycle'
import {
  advanceEncounterGlobalFields,
  createEncounterGlobalFieldZone,
} from '~~/server/domain/moveAutomation/fieldLifecycle'
import {
  RemainingGlobalFieldQueryError,
  createMoveAutomationRemainingGlobalFieldResolver,
} from '~~/server/domain/moveAutomation/remainingGlobalFields'
import {
  createTailwindInitiativeEffect,
} from '~~/server/domain/moveAutomation/tailwind'
import type { TabletopMap } from '~/types/map'

const sides = {
  red: { id: 'red', label: 'Red', status: 'active' as const },
  blue: { id: 'blue', label: 'Blue', status: 'active' as const },
}

const mapFixture = (encounterState: EncounterState): TabletopMap => ({
  schemaVersion: 2,
  slug: 'remaining-fields-arena',
  name: 'Remaining Fields Arena',
  revision: 4,
  dimensions: { x: 8, y: 3, z: 8 },
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [],
  encounterState,
})

const room = (input: {
  readonly kind: 'magic' | 'gravity'
  readonly sideId: 'red' | 'blue'
  readonly duration?: EncounterZoneDuration
  readonly startsNextRound?: boolean
  readonly suppressed?: boolean
}): EncounterGlobalFieldZone => {
  const zone = createEncounterGlobalFieldZone({
    kind: 'room',
    fieldId: input.kind,
    source: {
      kind: 'operation',
      operationId: `operation.${input.kind}`,
      moveId: `move.${input.kind}`,
      placementId: `${input.sideId}-source`,
    },
    sideId: input.sideId,
    duration: input.duration ?? { kind: 'rounds', boundary: 'end', remaining: 4 },
    replacementGroup: `field.room.${input.kind}`,
    startsNextRound: input.startsNextRound,
  })
  if (!input.suppressed) return zone
  return parseEncounterZone({
    ...zone,
    fieldPolicy: {
      ...zone.fieldPolicy,
      suppression: {
        sources: [{
          zoneId: 'zone.field.suppressor',
          reasonCode: 'field.room.suppressed',
        }],
      },
    },
  }) as EncounterGlobalFieldZone
}

const tailwind = (sideId: 'red' | 'blue' = 'red') => createTailwindInitiativeEffect({
  sideId,
  source: {
    operationId: `operation.tailwind.${sideId}`,
    moveId: 'move.tailwind',
    placementId: `${sideId}-source`,
  },
  createdRound: 2,
  createdTurn: 3,
})

const suppressedTailwindEffects = () => {
  const suppressor = parseEncounterEffect({
    id: 'effect.field.suppressor',
    kind: 'capability',
    source: {
      operationId: 'operation.field.suppressor',
      moveId: 'move.field-suppressor',
      placementId: 'blue-source',
    },
    affected: { placementIds: [], sideIds: ['red'], cells: [] },
    createdRound: 2,
    createdTurn: 3,
    duration: { kind: 'scene', remaining: null },
    stacks: 1,
    charges: null,
    stackPolicy: { kind: 'independent-instance', maxStacks: null },
    chargePolicy: { kind: 'none', amount: null },
    tags: ['field', 'suppressor'],
    payload: { capabilityId: 'field.tailwind', action: 'suppress' },
    dispel: { policy: 'none', tags: [] },
    transferPolicy: 'retain',
    suppression: { sources: [] },
  })
  const suppressed = parseEncounterEffect({
    ...tailwind('red'),
    suppression: {
      sources: [{
        effectId: suppressor.id,
        reasonCode: 'field.tailwind.suppressed',
      }],
    },
  })
  return [suppressor, suppressed] as const
}

const stateWith = (input: {
  readonly zones?: EncounterState['zones']
  readonly effects?: EncounterState['effects']
} = {}): EncounterState => ({
  ...createEmptyEncounterState(),
  sides,
  zones: input.zones ?? [],
  effects: input.effects ?? [],
})

describe('remaining authoritative global field queries', () => {
  it('exposes active Magic Room, Gravity, and side-owned Tailwind metadata immutably', () => {
    const state = stateWith({
      zones: [
        room({ kind: 'magic', sideId: 'red' }),
        room({
          kind: 'gravity',
          sideId: 'blue',
          duration: { kind: 'scene', remaining: null },
        }),
      ],
      effects: [tailwind('red')],
    })
    const map = mapFixture(state)
    const before = structuredClone(map)
    const fields = createMoveAutomationRemainingGlobalFieldResolver(map)

    expect(fields.magicRoom({ scope: 'pokemon-held', timing: 'static' })).toMatchObject({
      suppressed: true,
      reasonCode: 'magic-room.item-effect-suppressed',
      field: {
        active: true,
        reasonCode: 'room.active',
        instance: {
          kind: 'magic',
          sideId: 'red',
          duration: { kind: 'rounds', boundary: 'end', remaining: 4 },
          priority: 0,
          replacementGroup: 'field.room.magic',
          suppressionSources: [],
          source: { operationId: 'operation.magic' },
        },
      },
    })
    expect(fields.magicRoom({ scope: 'pokemon-held', timing: 'activated' }))
      .toMatchObject({ suppressed: false, reasonCode: 'magic-room.timing-exempt' })
    expect(fields.magicRoom({ scope: 'trainer-other-equipment', timing: 'static' }))
      .toMatchObject({ suppressed: false, reasonCode: 'magic-room.scope-exempt' })

    expect(fields.gravity()).toMatchObject({
      reasonCode: 'gravity.active',
      field: {
        active: true,
        instance: {
          kind: 'gravity',
          sideId: 'blue',
          duration: { kind: 'scene', remaining: null },
          source: { operationId: 'operation.gravity' },
        },
      },
      overlay: {
        treatsPokemonAsGrounded: true,
        accuracyRollBonus: 2,
        maximumAerialEndAltitudeMeters: 1,
        neutralizesFlyingGroundResistance: true,
        suppressesLevitateGroundResistance: true,
        suppressesGroundsourceImmunity: true,
      },
    })

    expect(fields.tailwind('red')).toMatchObject({
      active: true,
      initiativeBonus: 5,
      reasonCode: 'tailwind.active',
      field: {
        ownerSideId: 'red',
        duration: { kind: 'scene', remaining: null },
        source: { operationId: 'operation.tailwind.red' },
        createdRound: 2,
        createdTurn: 3,
      },
      modifier: { attribute: 'initiative', operation: 'add', value: 5 },
    })
    expect(fields.tailwind('blue')).toMatchObject({
      active: false,
      initiativeBonus: 0,
      field: null,
      modifier: null,
      reasonCode: 'tailwind.wrong-side',
    })
    expect(fields.tailwinds()).toHaveLength(1)
    expect(Object.isFrozen(fields)).toBe(true)
    expect(Object.isFrozen(fields.gravity())).toBe(true)
    expect(Object.isFrozen(fields.gravity().field.instance?.duration)).toBe(true)
    expect(Object.isFrozen(fields.tailwinds())).toBe(true)
    expect(Object.isFrozen(fields.tailwind('red').field?.source)).toBe(true)
    expect(map).toEqual(before)
  })

  it('retains ownership and duration for suppressed or pending inactive Rooms', () => {
    const map = mapFixture(stateWith({
      zones: [
        room({ kind: 'magic', sideId: 'red', suppressed: true }),
        room({ kind: 'gravity', sideId: 'blue', startsNextRound: true }),
      ],
      effects: suppressedTailwindEffects(),
    }))
    const fields = createMoveAutomationRemainingGlobalFieldResolver(map)

    expect(fields.magicRoom({ scope: 'trainer-accessory', timing: 'trigger' })).toMatchObject({
      suppressed: false,
      reasonCode: 'magic-room.inactive',
      field: {
        active: false,
        reasonCode: 'room.suppressed',
        instance: {
          sideId: 'red',
          inactiveReason: 'suppressed',
          duration: { remaining: 4 },
          replacementGroup: 'field.room.magic',
          suppressionSources: [{
            zoneId: 'zone.field.suppressor',
            reasonCode: 'field.room.suppressed',
          }],
        },
      },
    })
    expect(fields.gravity()).toMatchObject({
      reasonCode: 'gravity.inactive',
      field: {
        active: false,
        reasonCode: 'room.starts-next-round',
        instance: {
          sideId: 'blue',
          inactiveReason: 'starts-next-round',
          duration: { remaining: 4 },
        },
      },
      overlay: {
        treatsPokemonAsGrounded: false,
        accuracyRollBonus: 0,
        maximumAerialEndAltitudeMeters: null,
      },
    })
    expect(fields.tailwind('red')).toMatchObject({
      active: false,
      initiativeBonus: 0,
      reasonCode: 'tailwind.suppressed',
      field: {
        ownerSideId: 'red',
        activity: 'suppressed',
        duration: { kind: 'scene', remaining: null },
        suppressionSourceEffectIds: ['effect.field.suppressor'],
      },
    })
  })

  it('reports lifecycle-expired fields as inactive without preserving stale mechanics', () => {
    const initial = stateWith({
      zones: [
        room({
          kind: 'magic',
          sideId: 'red',
          duration: { kind: 'rounds', boundary: 'end', remaining: 1 },
        }),
        room({
          kind: 'gravity',
          sideId: 'blue',
          duration: { kind: 'rounds', boundary: 'end', remaining: 1 },
        }),
      ],
      effects: [tailwind('red')],
    })
    const expiredZones = advanceEncounterGlobalFields({
      zones: initial.zones,
      event: { kind: 'round-end' },
    }).zones
    const expiredEffects = applyEncounterEffectLifecycleEvent(
      { effects: initial.effects },
      { kind: 'scene-end' },
    ).effects
    const fields = createMoveAutomationRemainingGlobalFieldResolver(mapFixture(stateWith({
      zones: expiredZones,
      effects: expiredEffects,
    })))

    expect(fields.magicRoom({ scope: 'pokemon-held', timing: 'static' })).toMatchObject({
      suppressed: false,
      reasonCode: 'magic-room.inactive',
      field: { active: false, instance: null, reasonCode: 'room.absent' },
    })
    expect(fields.gravity()).toMatchObject({
      reasonCode: 'gravity.inactive',
      field: { active: false, instance: null, reasonCode: 'room.absent' },
    })
    expect(fields.tailwind('red')).toMatchObject({
      active: false,
      field: null,
      reasonCode: 'tailwind.inactive',
    })
  })

  it('rejects unbounded query values and ignores non-canonical Tailwind lookalikes', () => {
    const lookalike = { ...tailwind('red'), id: 'effect.field.tailwind.lookalike' }
    const fields = createMoveAutomationRemainingGlobalFieldResolver(mapFixture(stateWith({
      effects: [lookalike],
    })))

    expect(fields.tailwinds()).toEqual([])
    expect(() => fields.magicRoom({
      scope: 'bag-item' as never,
      timing: 'static',
    })).toThrowError(expect.objectContaining({
      name: RemainingGlobalFieldQueryError.name,
      code: 'invalid-item-effect-scope',
    }))
    expect(() => fields.magicRoom({
      scope: 'pokemon-held',
      timing: 'continuous' as never,
    })).toThrowError(expect.objectContaining({
      name: RemainingGlobalFieldQueryError.name,
      code: 'invalid-item-effect-timing',
    }))
    expect(() => fields.tailwind('Red Side')).toThrowError(expect.objectContaining({
      name: RemainingGlobalFieldQueryError.name,
      code: 'invalid-side-id',
    }))
  })
})
