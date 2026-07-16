import { describe, expect, it } from 'vitest'
import {
  parseEncounterZone,
  parseEncounterZones,
  type EncounterGlobalFieldZone,
} from '#shared/moveAutomation/encounterZones'
import {
  advanceEncounterGlobalFields,
  applyEncounterGlobalField,
  createEncounterGlobalFieldZone,
  removeEncounterGlobalFields,
} from '~~/server/domain/moveAutomation/fieldLifecycle'

const source = (operationId: string, placementId: string | null = 'actor-token') => ({
  kind: 'operation' as const,
  operationId,
  moveId: 'move.field-test',
  placementId,
})

const field = (input: {
  readonly kind: 'weather' | 'terrain' | 'room'
  readonly fieldId: string
  readonly operationId: string
  readonly group: string
  readonly priority?: number
  readonly duration?: EncounterGlobalFieldZone['duration']
  readonly startsNextRound?: boolean
}): EncounterGlobalFieldZone => createEncounterGlobalFieldZone({
  kind: input.kind,
  fieldId: input.fieldId,
  source: source(input.operationId),
  sideId: 'allies',
  duration: input.duration ?? { kind: 'rounds', boundary: 'end', remaining: 3 },
  replacementGroup: input.group,
  priority: input.priority,
  startsNextRound: input.startsNextRound,
})

const fieldId = (zone: EncounterGlobalFieldZone): string => (
  zone.kind === 'weather'
    ? zone.payload.weatherId
    : zone.kind === 'terrain'
      ? zone.payload.terrainId
      : zone.payload.roomId
)

describe('global field lifecycle', () => {
  it('retains one explicit owner and resolves replacement by server priority', () => {
    const sun = field({
      kind: 'weather',
      fieldId: 'sunny',
      operationId: 'operation.sun',
      group: 'field.weather',
      priority: 10,
    })
    const weakRain = field({
      kind: 'weather',
      fieldId: 'rainy',
      operationId: 'operation.weak-rain',
      group: 'field.weather',
      priority: 9,
    })
    const strongRain = field({
      kind: 'weather',
      fieldId: 'rainy',
      operationId: 'operation.strong-rain',
      group: 'field.weather',
      priority: 10,
    })

    const prevented = applyEncounterGlobalField({
      zones: [sun],
      incoming: weakRain,
      replacementScope: 'group',
    })
    expect(prevented.changed).toBe(false)
    expect(prevented.zones).toEqual([sun])
    expect(prevented.transitions).toEqual([
      expect.objectContaining({
        kind: 'prevented',
        reasonCode: 'field-priority-prevented',
        previous: sun,
        current: sun,
      }),
    ])

    const replaced = applyEncounterGlobalField({
      zones: prevented.zones,
      incoming: strongRain,
      replacementScope: 'group',
    })
    expect(replaced.changed).toBe(true)
    expect(replaced.zones).toHaveLength(1)
    expect(replaced.zones[0]).toMatchObject({
      id: strongRain.id,
      source: source('operation.strong-rain'),
      sideId: 'allies',
      fieldPolicy: {
        priority: 10,
        replacementGroup: 'field.weather',
        suppression: { sources: [] },
      },
      payload: { weatherId: 'rainy' },
    })
    expect(replaced.transitions[0]).toMatchObject({
      kind: 'replaced',
      replacedZoneIds: [sun.id],
    })
  })

  it('retains suppressed fields without contributing and reactivates them when the source leaves', () => {
    const suppressor = field({
      kind: 'room',
      fieldId: 'magic',
      operationId: 'operation.magic-room',
      group: 'field.room.magic',
      duration: { kind: 'scene', remaining: null },
    })
    const sunBase = field({
      kind: 'weather',
      fieldId: 'sunny',
      operationId: 'operation.sun',
      group: 'field.weather',
    })
    const sun = parseEncounterZone({
      ...sunBase,
      fieldPolicy: {
        ...sunBase.fieldPolicy,
        suppression: {
          sources: [{
            zoneId: suppressor.id,
            reasonCode: 'field.weather.suppressed',
          }],
        },
      },
    }) as EncounterGlobalFieldZone
    const parsed = parseEncounterZones([sun, suppressor])

    expect(parsed).toHaveLength(2)
    const removed = removeEncounterGlobalFields({
      zones: parsed,
      matches: zone => zone.id === suppressor.id,
    })
    expect(removed.zones).toHaveLength(1)
    expect((removed.zones[0] as EncounterGlobalFieldZone).fieldPolicy.suppression.sources)
      .toEqual([])
    expect(removed.transitions.map(item => item.kind)).toEqual([
      'removed',
      'suppression-cleared',
    ])
  })

  it('advances fixed and scene duration once and activates delayed Rooms at the round boundary', () => {
    const rain = field({
      kind: 'weather',
      fieldId: 'rainy',
      operationId: 'operation.rain',
      group: 'field.weather',
      duration: { kind: 'rounds', boundary: 'end', remaining: 2 },
    })
    const terrain = field({
      kind: 'terrain',
      fieldId: 'grassy',
      operationId: 'operation.grassy',
      group: 'field.terrain.grassy',
      duration: { kind: 'scene', remaining: null },
    })
    const room = field({
      kind: 'room',
      fieldId: 'trick',
      operationId: 'operation.trick',
      group: 'field.room.trick',
      duration: { kind: 'rounds', boundary: 'end', remaining: 1 },
      startsNextRound: true,
    })

    const endOne = advanceEncounterGlobalFields({
      zones: [rain, terrain, room],
      event: { kind: 'round-end' },
    })
    expect(endOne.transitions.map(item => [item.fieldId, item.kind])).toEqual([
      ['rainy', 'duration-decremented'],
    ])
    expect((endOne.zones[0] as EncounterGlobalFieldZone).duration).toMatchObject({ remaining: 1 })
    expect((endOne.zones[2] as EncounterGlobalFieldZone & { kind: 'room' }).payload.startsNextRound)
      .toBe(true)

    const startTwo = advanceEncounterGlobalFields({
      zones: endOne.zones,
      event: { kind: 'round-start' },
    })
    expect(startTwo.transitions).toEqual([
      expect.objectContaining({ kind: 'activated', fieldId: 'trick' }),
    ])
    expect((startTwo.zones[2] as EncounterGlobalFieldZone & { kind: 'room' }).payload.startsNextRound)
      .toBe(false)

    const endTwo = advanceEncounterGlobalFields({
      zones: startTwo.zones,
      event: { kind: 'round-end' },
    })
    expect(endTwo.transitions.map(item => [item.fieldId, item.kind])).toEqual([
      ['rainy', 'expired'],
      ['trick', 'expired'],
    ])
    expect(endTwo.zones.filter((zone): zone is EncounterGlobalFieldZone => 'fieldPolicy' in zone)
      .map(fieldId)).toEqual(['grassy'])

    const sceneEnd = advanceEncounterGlobalFields({
      zones: endTwo.zones,
      event: { kind: 'scene-end' },
    })
    expect(sceneEnd.zones).toEqual([])
    expect(sceneEnd.transitions[0]).toMatchObject({
      fieldId: 'grassy',
      kind: 'expired',
      reasonCode: 'field-scene-expired',
    })
  })

  it('rejects unsupported global timing and duplicate active replacement groups', () => {
    const sun = field({
      kind: 'weather',
      fieldId: 'sunny',
      operationId: 'operation.sun',
      group: 'field.weather',
    })
    expect(() => parseEncounterZone({
      ...sun,
      duration: {
        kind: 'turns',
        subject: 'source',
        boundary: 'end',
        remaining: 1,
      },
    })).toThrow('global fields support fixed-round, scene, or permanent durations only')

    const rain = parseEncounterZone({
      ...field({
        kind: 'weather',
        fieldId: 'rainy',
        operationId: 'operation.rain',
        group: 'field.weather',
      }),
      id: 'zone.field.weather.manual-rain',
    })
    expect(() => parseEncounterZones([sun, rain]))
      .toThrow('fieldPolicy.replacementGroup: must not contain duplicate identities')
  })
})
