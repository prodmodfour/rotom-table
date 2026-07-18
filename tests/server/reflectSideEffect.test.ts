import { describe, expect, it } from 'vitest'
import {
  LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
  type ResolveMoveIntent,
} from '#shared/livePlayMoveResolution'
import {
  createEmptyEncounterState,
  type EncounterSideDirectory,
  type EncounterState,
} from '#shared/moveAutomation/encounterState'
import {
  parseEncounterEffect,
  parseEncounterEffectDefinition,
} from '#shared/moveAutomation/encounterEffects'
import {
  parseMoveEffectOperation,
  type MoveTemporaryEffectOperation,
} from '#shared/moveAutomation/effects'
import { buildAuthoritativeMoveRulesContext } from '~~/server/domain/moveAutomation/context'
import {
  REFLECT_ACTIVATIONS,
  REFLECT_EFFECT_BASE_ID,
  REFLECT_MOVE_SOURCE_ID,
  REFLECT_OPERATION_ID,
  REFLECT_SIDE_EFFECT_DEFINITION,
  ReflectSideEffectError,
  applyReflectSideEffectLifecycleEvent,
  createReflectSideEffect,
  isReflectSideEffect,
  parseReflectSideEffect,
} from '~~/server/domain/moveAutomation/reflect'
import { reduceMoveTemporaryEffect } from '~~/server/domain/moveAutomation/reducers/mapTemporaryEffects'
import { MoveMapOperationReductionError } from '~~/server/domain/moveAutomation/reducers/mapOperationError'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'

const SIDES = Object.freeze({
  allies: { id: 'allies', label: 'Allies', status: 'active' },
  enemies: { id: 'enemies', label: 'Enemies', status: 'active' },
} as const satisfies EncounterSideDirectory)

const actor = (sideId: string | null | undefined) => ({
  id: 'actor-token',
  ...(sideId === undefined ? {} : { sideId }),
})

const reflectEffect = (options: {
  readonly sideId?: 'allies' | 'enemies'
  readonly placementId?: string
  readonly createdRound?: number
  readonly createdTurn?: number
} = {}) => createReflectSideEffect({
  actor: {
    id: options.placementId ?? 'actor-token',
    sideId: options.sideId ?? 'allies',
  },
  sides: SIDES,
  createdRound: options.createdRound ?? 2,
  createdTurn: options.createdTurn ?? 4,
})

const placement = (
  id: string,
  sheetSlug: string,
  x: number,
  sideId?: string,
): SheetPlacement => ({
  id,
  sheetKind: 'pokemon',
  sheetSlug,
  position: { x, y: 0, z: 0 },
  ...(sideId === undefined ? {} : { sideId }),
})

const sheet = (slug: string): CharacterSheet => ({
  slug,
  nickname: slug,
  species: slug === 'actor' ? 'Mr. Mime' : 'Pikachu',
  level: 20,
  revision: 3,
  movelist: slug === 'actor' ? [{ name: 'Reflect' }] : [],
  combat: { currentHp: 50 },
})

const intent = (): ResolveMoveIntent => ({
  schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
  placementId: 'actor-token',
  moveName: 'Reflect',
  selection: { kind: 'self' },
})

const mapFixture = (options: {
  readonly actorSideId?: string
  readonly encounterState?: EncounterState
  readonly round?: number
} = {}): TabletopMap => ({
  schemaVersion: 2,
  slug: 'reflect-foundation-arena',
  name: 'Reflect Foundation Arena',
  revision: 7,
  dimensions: { x: 6, y: 3, z: 6 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  encounterState: options.encounterState ?? {
    ...createEmptyEncounterState(),
    sides: SIDES,
  },
  placements: [
    placement('actor-token', 'actor', 0, options.actorSideId),
    placement('target-token', 'target', 1, 'enemies'),
  ],
  lights: [],
  activeScene: { name: 'Reflect Scene', startedAt: 100 },
  initiative: { activeId: 'actor-token', round: options.round ?? 2 },
})

const buildContext = (map: TabletopMap) => buildAuthoritativeMoveRulesContext({
  map,
  pokemonSheets: new Map([
    ['actor', sheet('actor')],
    ['target', sheet('target')],
  ]),
  trainerSheets: new Map<string, TrainerSheet>(),
  intent: intent(),
  candidatePlacementIds: [],
  selectedPlacementIds: ['actor-token'],
  random: () => 0,
  time: 5_000,
})

const reflectOperation = (): MoveTemporaryEffectOperation => parseMoveEffectOperation({
  id: REFLECT_OPERATION_ID,
  kind: 'temporary-effect',
  source: { kind: 'move', id: REFLECT_MOVE_SOURCE_ID },
  recipients: { kind: 'actor' },
  phase: 'schedule',
  reasonCode: 'reflect.apply-side-blessing',
  payload: {
    action: 'add',
    effectId: REFLECT_EFFECT_BASE_ID,
    recipientScope: 'actor-side',
    definition: REFLECT_SIDE_EFFECT_DEFINITION,
  },
}) as MoveTemporaryEffectOperation

describe('Reflect owned side-effect foundation', () => {
  it('strictly parses only the bounded physical resistance payload and charge range', () => {
    const effect = reflectEffect()

    expect(parseEncounterEffectDefinition(REFLECT_SIDE_EFFECT_DEFINITION)).toEqual(
      REFLECT_SIDE_EFFECT_DEFINITION,
    )
    expect(parseReflectSideEffect(JSON.parse(JSON.stringify(effect)))).toEqual(effect)
    expect(parseEncounterEffect(effect).payload).toEqual({
      attribute: 'damage-reduction',
      operation: 'resist-step',
      value: 1,
      rounding: 'none',
      damageClass: 'physical',
    })
    expect(isReflectSideEffect(effect)).toBe(true)

    for (const charges of [0, REFLECT_ACTIVATIONS + 1, null]) {
      expect(() => parseReflectSideEffect({ ...effect, charges })).toThrowError(
        expect.objectContaining({
          name: ReflectSideEffectError.name,
          code: 'invalid-reflect-effect',
        }),
      )
    }
    expect(() => parseReflectSideEffect({
      ...effect,
      payload: { ...effect.payload, damageClass: 'special' },
    })).toThrowError(expect.objectContaining({ code: 'invalid-reflect-effect' }))
    expect(() => parseEncounterEffect({
      ...effect,
      payload: { ...effect.payload, value: 0 },
    })).toThrow('resist-step requires damage-reduction, a damage class, 1-8 whole steps')
    expect(() => parseMoveEffectOperation({
      ...reflectOperation(),
      payload: {
        ...reflectOperation().payload,
        recipientScope: 'controller-side',
      },
    })).toThrow('operation.payload.recipientScope')
  })

  it('creates one deterministic effect owned only by the actor explicit side', () => {
    const input = {
      actor: actor('allies'),
      sides: SIDES,
      createdRound: 2,
      createdTurn: 4,
    } as const
    const before = structuredClone(input)
    const effect = createReflectSideEffect(input)

    expect(effect).toMatchObject({
      id: 'reflect.blessing.allies',
      source: {
        operationId: REFLECT_OPERATION_ID,
        moveId: REFLECT_MOVE_SOURCE_ID,
        placementId: 'actor-token',
      },
      affected: { placementIds: [], sideIds: ['allies'], cells: [] },
      duration: { kind: 'scene', remaining: null },
      stacks: 1,
      charges: REFLECT_ACTIVATIONS,
      stackPolicy: { kind: 'replace', maxStacks: null },
      chargePolicy: { kind: 'consume-on-trigger', amount: 1 },
      payload: { damageClass: 'physical', operation: 'resist-step', value: 1 },
      transferPolicy: 'retain',
    })
    expect(input).toEqual(before)

    for (const sideId of [undefined, null, 'missing-side'] as const) {
      expect(() => createReflectSideEffect({
        ...input,
        actor: actor(sideId),
      })).toThrowError(expect.objectContaining({
        name: ReflectSideEffectError.name,
        code: 'actor-side-required',
      }))
    }
  })

  it('materializes side scope through the pure map reducer and fails closed without allegiance', () => {
    const map = mapFixture({ actorSideId: 'allies' })
    const before = structuredClone(map.encounterState)
    const reduced = reduceMoveTemporaryEffect({
      context: buildContext(map),
      previous: map.encounterState,
      operation: reflectOperation(),
      recipientIds: ['actor-token'],
    })
    const effect = reduced.current.effects[0]

    expect(effect && parseReflectSideEffect(effect)).toEqual(reflectEffect({ createdTurn: 0 }))
    expect(reduced.details).toEqual({
      action: 'add',
      effectId: 'reflect.blessing.allies',
      recipientScope: 'actor-side',
      transitionKinds: ['added'],
    })
    expect(map.encounterState).toEqual(before)

    const spent = applyReflectSideEffectLifecycleEvent(
      { effects: reduced.current.effects },
      { kind: 'effect-triggered', effectId: effect!.id },
    )
    const spentState: EncounterState = {
      ...reduced.current,
      effects: spent.effects,
    }
    const reapplicationMap = mapFixture({
      actorSideId: 'allies',
      encounterState: spentState,
      round: 4,
    })
    const reapplied = reduceMoveTemporaryEffect({
      context: buildContext(reapplicationMap),
      previous: spentState,
      operation: reflectOperation(),
      recipientIds: ['actor-token'],
    })
    expect(reapplied.current.effects[0]).toMatchObject({
      createdRound: 4,
      charges: REFLECT_ACTIVATIONS,
    })
    expect(reapplied.details).toMatchObject({ transitionKinds: ['replaced'] })

    const unknownSideMap = mapFixture()
    expect(() => reduceMoveTemporaryEffect({
      context: buildContext(unknownSideMap),
      previous: unknownSideMap.encounterState,
      operation: reflectOperation(),
      recipientIds: ['actor-token'],
    })).toThrowError(expect.objectContaining({
      name: MoveMapOperationReductionError.name,
      code: 'temporary-effect-invalid',
    }))
    expect(() => reduceMoveTemporaryEffect({
      context: buildContext(map),
      previous: map.encounterState,
      operation: reflectOperation(),
      recipientIds: ['target-token'],
    })).toThrowError(expect.objectContaining({
      code: 'temporary-effect-invalid',
    }))
  })

  it('replaces a spent same-side instance and refreshes its canonical source and charges', () => {
    const original = reflectEffect()
    const spent = applyReflectSideEffectLifecycleEvent(
      { effects: [original] },
      { kind: 'effect-triggered', effectId: original.id },
    )
    const replacement = reflectEffect({
      placementId: 'replacement-actor',
      createdRound: 4,
      createdTurn: 9,
    })
    const result = applyReflectSideEffectLifecycleEvent(spent, {
      kind: 'effect-applied',
      effect: replacement,
    })

    expect(result.effects).toEqual([replacement])
    expect(result.effects[0]).toMatchObject({
      source: { placementId: 'replacement-actor' },
      createdRound: 4,
      createdTurn: 9,
      charges: REFLECT_ACTIVATIONS,
    })
    expect(result.transitions).toEqual([
      expect.objectContaining({
        effectId: original.id,
        kind: 'replaced',
        reasonCode: 'effect-replaced',
      }),
    ])
    expect(original.charges).toBe(REFLECT_ACTIVATIONS)
  })

  it('consumes exactly two activations and expires automatically on depletion or scene end', () => {
    const effect = reflectEffect()
    const first = applyReflectSideEffectLifecycleEvent(
      { effects: [effect] },
      { kind: 'effect-triggered', effectId: effect.id },
    )

    expect(first.effects[0]?.charges).toBe(1)
    expect(first.transitions).toEqual([
      expect.objectContaining({
        kind: 'charge-consumed',
        reasonCode: 'effect-charge-consumed',
      }),
    ])

    const depleted = applyReflectSideEffectLifecycleEvent(
      first,
      { kind: 'effect-triggered', effectId: effect.id },
    )
    expect(depleted.effects).toEqual([])
    expect(depleted.transitions).toEqual([
      expect.objectContaining({
        kind: 'expired',
        reasonCode: 'effect-charges-depleted',
      }),
    ])

    const sceneEnded = applyReflectSideEffectLifecycleEvent(
      { effects: [effect] },
      { kind: 'scene-end' },
    )
    expect(sceneEnded.effects).toEqual([])
    expect(sceneEnded.transitions).toEqual([
      expect.objectContaining({
        kind: 'expired',
        reasonCode: 'effect-duration-expired',
      }),
    ])
    expect(() => applyReflectSideEffectLifecycleEvent(
      { effects: [effect] },
      { kind: 'effect-triggered', effectId: 'reflect.blessing.enemies' },
    )).toThrowError(expect.objectContaining({
      code: 'reflect-effect-not-found',
    }))
  })
})
