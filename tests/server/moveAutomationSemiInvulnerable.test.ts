import { describe, expect, it } from 'vitest'
import {
  ENCOUNTER_EVENT_SCHEMA_VERSION,
  parseEncounterEvent,
} from '#shared/moveAutomation/events'
import {
  createEmptyEncounterState,
  type EncounterState,
} from '#shared/moveAutomation/encounterState'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { buildAuthoritativeMoveRulesContext } from '~~/server/domain/moveAutomation/context'
import {
  MOVE_SEMI_INVULNERABLE_CANONICAL_IDS,
  MOVE_SEMI_INVULNERABLE_DEFINITION_HASH,
  MOVE_SEMI_INVULNERABLE_DEFINITIONS,
} from '~~/server/domain/moveAutomation/semiInvulnerableDefinitions'
import {
  MoveSemiInvulnerableSetupError,
  createMoveSemiInvulnerableSetupPlan,
  parseMoveSemiInvulnerableSetupGroups,
} from '~~/server/domain/moveAutomation/semiInvulnerableEffects'
import {
  createMoveSemiInvulnerableCleanupEvents,
  createMoveSemiInvulnerableLifecycleHandler,
} from '~~/server/domain/moveAutomation/semiInvulnerableLifecycle'
import {
  createMoveSemiInvulnerableTargetabilityResolver,
} from '~~/server/domain/moveAutomation/semiInvulnerableTargetability'
import {
  MoveSemiInvulnerableMovementError,
  resolveMoveSemiInvulnerableMovement,
} from '~~/server/domain/moveAutomation/semiInvulnerableMovement'
import {
  evaluateMoveAutomationTargetPredicates,
} from '~~/server/domain/moveAutomation/predicates/target'
import { reduceEncounterLifecycle } from '~~/server/domain/moveAutomation/reduceLifecycle'
import { createMoveAutomationRelationshipResolver } from '~~/server/domain/moveAutomation/relationships'
import { resolveAuthoritativeMoveFromContext } from '~~/server/domain/resolveAuthoritativeMove'
import { resolveAuthoritativeMovement } from '~~/server/domain/movement/resolveMovement'

const placement = (
  id: string,
  sheetSlug: string,
  x: number,
  z: number,
): SheetPlacement => ({
  id,
  sheetKind: 'pokemon',
  sheetSlug,
  position: { x, y: 0, z },
})

const pokemonSheet = (
  slug: string,
  species = 'Pikachu',
  capabilities: CharacterSheet['capabilities'] = { overland: 6 },
): CharacterSheet => ({
  slug,
  nickname: slug,
  species,
  level: 20,
  revision: slug === 'actor' ? 3 : slug === 'target' ? 4 : 5,
  movelist: [{ name: 'Scratch' }],
  capabilities,
  combat: { currentHp: 50 },
})

const basePlacements = (): SheetPlacement[] => [
  placement('actor-token', 'actor', 1, 1),
  placement('target-token', 'target', 2, 1),
  placement('other-token', 'other', 9, 9),
]

const mapFixture = (options: {
  readonly placements?: readonly SheetPlacement[]
  readonly encounterState?: EncounterState
  readonly voxels?: TabletopMap['voxels']
} = {}): TabletopMap => ({
  schemaVersion: 2,
  slug: 'semi-invulnerable-arena',
  name: 'Semi Invulnerable Arena',
  revision: 8,
  dimensions: { x: 12, y: 4, z: 12 },
  groundLevelY: 0,
  voxels: [...(options.voxels ?? [])],
  placements: [...(options.placements ?? basePlacements())],
  ...(options.encounterState ? { encounterState: options.encounterState } : {}),
})

const sheets = (options: {
  readonly actorCapabilities?: CharacterSheet['capabilities']
  readonly targetCapabilities?: CharacterSheet['capabilities']
} = {}) => new Map<string, CharacterSheet>([
  ['actor', pokemonSheet('actor', 'Pikachu', options.actorCapabilities ?? { overland: 6 })],
  ['target', pokemonSheet('target', 'Pikachu', options.targetCapabilities ?? { overland: 6 })],
  ['other', pokemonSheet('other')],
])

const setupPlan = (
  canonicalMoveId: Parameters<typeof createMoveSemiInvulnerableSetupPlan>[0]['canonicalMoveId'],
  options: {
    readonly operationId?: string
    readonly effects?: EncounterState['effects']
    readonly carriedTargetPlacementId?: string | null
  } = {},
) => createMoveSemiInvulnerableSetupPlan({
  authority: {
    placementIds: basePlacements().map(entry => entry.id),
    effects: options.effects ?? [],
  },
  canonicalMoveId,
  operationId: options.operationId ?? `setup.${canonicalMoveId.toLowerCase().replaceAll(' ', '-')}`,
  actorPlacementId: 'actor-token',
  ...(options.carriedTargetPlacementId === undefined
    ? {}
    : { carriedTargetPlacementId: options.carriedTargetPlacementId }),
  createdRound: 2,
  createdTurn: 4,
})

const stateFromSetup = (
  setup: ReturnType<typeof setupPlan>,
): EncounterState => reduceEncounterLifecycle(
  createEmptyEncounterState(),
  setup.events,
).state

const contextFor = (options: {
  readonly map: TabletopMap
  readonly actorCapabilities?: CharacterSheet['capabilities']
  readonly targetCapabilities?: CharacterSheet['capabilities']
  readonly actorPlacementId?: string
}): ReturnType<typeof buildAuthoritativeMoveRulesContext> => buildAuthoritativeMoveRulesContext({
  map: options.map,
  pokemonSheets: sheets({
    actorCapabilities: options.actorCapabilities,
    targetCapabilities: options.targetCapabilities,
  }),
  trainerSheets: new Map<string, TrainerSheet>(),
  intent: {
    schemaVersion: 1,
    placementId: options.actorPlacementId ?? 'actor-token',
    moveName: 'Scratch',
    selection: { kind: 'self' },
  },
  candidatePlacementIds: options.map.placements.map(entry => entry.id),
  selectedPlacementIds: [],
  random: () => { throw new Error('semi-invulnerable state planning must not draw randomness') },
  time: 1_000,
})

const effectRemovalEvent = (
  effectId: string,
  eventId = 'event.setup.cancelled',
) => parseEncounterEvent({
  schemaVersion: ENCOUNTER_EVENT_SCHEMA_VERSION,
  eventId,
  kind: 'effect-removed',
  sourceOperationId: 'operation.setup.cancelled',
  causalParentEventId: null,
  reasonCode: 'gm.cancelled-setup',
  effectId,
})

const interruptHitEvent = (
  canonicalId: string,
  targetPlacementId = 'actor-token',
) => parseEncounterEvent({
  schemaVersion: ENCOUNTER_EVENT_SCHEMA_VERSION,
  eventId: `event.setup.interrupt.${canonicalId.toLowerCase().replaceAll(' ', '-')}`,
  kind: 'move-hit',
  sourceOperationId: 'operation.setup.interrupt',
  causalParentEventId: null,
  reasonCode: 'move.interrupt-hit',
  move: {
    resolutionId: 'resolution.setup.interrupt',
    canonicalId,
    actorPlacementId: 'other-token',
  },
  targetPlacementId,
  hitIndex: 1,
})

const koEvent = (targetPlacementId: string) => parseEncounterEvent({
  schemaVersion: ENCOUNTER_EVENT_SCHEMA_VERSION,
  eventId: 'event.setup.ko',
  kind: 'move-ko',
  sourceOperationId: 'operation.setup.ko',
  causalParentEventId: null,
  reasonCode: 'move.target-knocked-out',
  move: {
    resolutionId: 'resolution.setup.ko',
    canonicalId: 'Scratch',
    actorPlacementId: 'other-token',
  },
  targetPlacementId,
  hitIndex: 1,
})

const switchEvent = (recalledPlacementId: string) => parseEncounterEvent({
  schemaVersion: ENCOUNTER_EVENT_SCHEMA_VERSION,
  eventId: `event.setup.switch.${recalledPlacementId}`,
  kind: 'switch',
  sourceOperationId: 'operation.setup.switch',
  causalParentEventId: null,
  reasonCode: 'switch.recall-and-send-out',
  recalledPlacementId,
  sentOutPlacementId: 'other-token',
})

const sceneEndEvent = () => parseEncounterEvent({
  schemaVersion: ENCOUNTER_EVENT_SCHEMA_VERSION,
  eventId: 'event.setup.scene-end',
  kind: 'scene-end',
  sourceOperationId: 'operation.setup.scene-end',
  causalParentEventId: null,
  reasonCode: 'scene.scene-end',
  sceneId: 'scene.setup-test',
})

const expectSetupError = (
  run: () => unknown,
  code: MoveSemiInvulnerableSetupError['code'],
): void => {
  expect(run).toThrowError(expect.objectContaining({
    name: MoveSemiInvulnerableSetupError.name,
    code,
  }))
}

const expectMovementError = (
  run: () => unknown,
  code: MoveSemiInvulnerableMovementError['code'],
): void => {
  expect(run).toThrowError(expect.objectContaining({
    name: MoveSemiInvulnerableMovementError.name,
    code,
  }))
}

describe('semi-invulnerable setup states', () => {
  it('defines every reviewed family with explicit state, targetability, and resolve movement policy', () => {
    expect(MOVE_SEMI_INVULNERABLE_DEFINITIONS.map(definition => definition.canonicalId))
      .toEqual(MOVE_SEMI_INVULNERABLE_CANONICAL_IDS)
    expect(MOVE_SEMI_INVULNERABLE_DEFINITIONS.map(definition => ({
      move: definition.canonicalId,
      state: definition.userState,
      carried: definition.carriedTargetState,
      movement: definition.resolutionMovement.kind,
    }))).toEqual([
      { move: 'Dig', state: 'underground', carried: null, movement: 'surface' },
      { move: 'Dive', state: 'underwater', carried: null, movement: 'surface' },
      { move: 'Fly', state: 'airborne', carried: null, movement: 'land-adjacent' },
      { move: 'Bounce', state: 'airborne', carried: null, movement: 'land-adjacent' },
      { move: 'Sky Drop', state: 'airborne', carried: 'carried', movement: 'lower-carried-pair' },
      { move: 'Phantom Force', state: 'vanished', carried: null, movement: 'appear-adjacent' },
      { move: 'Shadow Force', state: 'vanished', carried: null, movement: 'appear-adjacent' },
    ])
    expect(MOVE_SEMI_INVULNERABLE_DEFINITION_HASH).toMatch(/^[a-f0-9]{64}$/)
    expect(Object.isFrozen(MOVE_SEMI_INVULNERABLE_DEFINITIONS)).toBe(true)
    expect(MOVE_SEMI_INVULNERABLE_DEFINITIONS.every(definition => (
      Object.isFrozen(definition.resolutionMovement)
      && Object.isFrozen(definition.userTargetingExceptions)
    ))).toBe(true)
  })

  it('materializes one durable user effect or an atomic Sky Drop user/carried pair', () => {
    for (const canonicalMoveId of MOVE_SEMI_INVULNERABLE_CANONICAL_IDS) {
      const setup = setupPlan(canonicalMoveId, canonicalMoveId === 'Sky Drop'
        ? { carriedTargetPlacementId: 'target-token' }
        : {})
      const state = stateFromSetup(setup)
      const groups = parseMoveSemiInvulnerableSetupGroups(state.effects)

      expect(groups).toHaveLength(1)
      expect(groups[0]).toMatchObject({
        setupOperationId: setup.setupOperationId,
        actorPlacementId: 'actor-token',
        carriedTargetPlacementId: canonicalMoveId === 'Sky Drop'
          ? 'target-token'
          : null,
      })
      expect(state.effects).toHaveLength(canonicalMoveId === 'Sky Drop' ? 2 : 1)
      expect(state.effects.every(effect => (
        effect.kind === 'capability'
        && effect.duration.kind === 'scene'
        && effect.tags.includes('semi-invulnerable')
        && effect.dispel.policy === 'none'
      ))).toBe(true)
    }

    const skyDrop = setupPlan('Sky Drop', { carriedTargetPlacementId: 'target-token' })
    const map = mapFixture({ encounterState: stateFromSetup(skyDrop) })
    const context = contextFor({ map })
    expect(context.queries.tokens.get('actor-token')?.movementProfile?.state.semiInvulnerable)
      .toBe('airborne')
    expect(context.queries.tokens.get('target-token')?.movementProfile?.state.semiInvulnerable)
      .toBe('carried')
    expect(context.queries.targetability.resolveAction({
      actorPlacementId: 'target-token',
      moveCanonicalId: 'Scratch',
    })).toMatchObject({
      available: false,
      reasonCode: 'action-blocked-carried-target',
      state: 'carried',
    })
  })

  it('rejects missing/extra carried targets, occupied setup states, and incomplete linked data', () => {
    expectSetupError(() => setupPlan('Sky Drop'), 'invalid-setup')
    expectSetupError(
      () => setupPlan('Dig', { carriedTargetPlacementId: 'target-token' }),
      'invalid-setup',
    )
    expectSetupError(
      () => setupPlan('Sky Drop', { carriedTargetPlacementId: 'actor-token' }),
      'invalid-setup',
    )

    const first = setupPlan('Dig')
    expectSetupError(
      () => setupPlan('Dive', { effects: first.effects }),
      'setup-conflict',
    )

    const skyDrop = setupPlan('Sky Drop', { carriedTargetPlacementId: 'target-token' })
    expectSetupError(
      () => parseMoveSemiInvulnerableSetupGroups([skyDrop.actorEffect]),
      'incomplete-setup-group',
    )
  })

  it('fails ordinary targeting closed and exposes only reviewed exception mechanics', () => {
    const dig = setupPlan('Dig')
    const digResolver = createMoveSemiInvulnerableTargetabilityResolver({ effects: dig.effects })
    expect(digResolver.resolve({
      actorPlacementId: 'other-token',
      targetPlacementId: 'actor-token',
      attackingMoveId: 'Scratch',
    })).toMatchObject({
      targetable: false,
      reasonCode: 'target-excluded-semi-invulnerable',
      state: 'underground',
      familyId: 'dig',
    })
    expect(digResolver.resolve({
      actorPlacementId: 'other-token',
      targetPlacementId: 'actor-token',
      attackingMoveId: 'Earthquake',
    })).toMatchObject({
      targetable: true,
      reasonCode: 'targetable-reviewed-exception',
      exception: {
        canonicalMoveId: 'Earthquake',
        ignoresRange: false,
        accuracy: 'normal',
      },
    })

    const fly = setupPlan('Fly')
    const flyResolver = createMoveSemiInvulnerableTargetabilityResolver({ effects: fly.effects })
    expect(flyResolver.resolve({
      actorPlacementId: 'other-token',
      targetPlacementId: 'actor-token',
      attackingMoveId: 'Gust',
    })).toMatchObject({
      targetable: true,
      exception: {
        ignoresRange: true,
        damageBaseOverride: 8,
        accuracy: 'normal',
      },
    })
    expect(flyResolver.resolve({
      actorPlacementId: 'other-token',
      targetPlacementId: 'actor-token',
      attackingMoveId: 'Hurricane',
    })).toMatchObject({
      targetable: true,
      exception: { accuracy: 'automatic' },
    })
    expect(flyResolver.resolve({
      actorPlacementId: 'other-token',
      targetPlacementId: 'actor-token',
      attackingMoveId: 'Sky Uppercut',
    }).targetable).toBe(false)
    expect(flyResolver.resolve({
      actorPlacementId: 'other-token',
      targetPlacementId: 'actor-token',
      attackingMoveId: 'Sky Uppercut',
      timing: 'interrupt',
    })).toMatchObject({
      targetable: true,
      exception: { cancelsSetupOnHit: true },
    })

    const vanished = setupPlan('Phantom Force')
    expect(createMoveSemiInvulnerableTargetabilityResolver({ effects: vanished.effects }).resolve({
      actorPlacementId: 'other-token',
      targetPlacementId: 'actor-token',
      attackingMoveId: 'Gust',
    })).toMatchObject({ targetable: false, state: 'vanished' })
  })

  it('allows only the exact originating continuation and fails malformed state closed', () => {
    const skyDrop = setupPlan('Sky Drop', { carriedTargetPlacementId: 'target-token' })
    const resolver = createMoveSemiInvulnerableTargetabilityResolver({ effects: skyDrop.effects })
    expect(resolver.resolve({
      actorPlacementId: 'actor-token',
      targetPlacementId: 'target-token',
      attackingMoveId: 'Sky Drop',
      originatingSetupOperationId: skyDrop.setupOperationId,
    })).toMatchObject({
      targetable: true,
      reasonCode: 'targetable-originating-resolution',
      role: 'carried-target',
    })
    expect(resolver.resolveAction({
      actorPlacementId: 'actor-token',
      moveCanonicalId: 'Sky Drop',
      originatingSetupOperationId: skyDrop.setupOperationId,
    })).toMatchObject({
      available: true,
      reasonCode: 'action-available-setup-resolution',
    })
    expect(resolver.resolveAction({
      actorPlacementId: 'actor-token',
      moveCanonicalId: 'Scratch',
    })).toMatchObject({
      available: false,
      reasonCode: 'action-blocked-awaiting-setup-resolution',
    })

    const malformed = {
      ...setupPlan('Dig').actorEffect,
      tags: ['movement'],
    }
    expect(createMoveSemiInvulnerableTargetabilityResolver({ effects: [malformed] }).resolve({
      actorPlacementId: 'other-token',
      targetPlacementId: 'actor-token',
      attackingMoveId: 'Earthquake',
    })).toMatchObject({
      targetable: false,
      reasonCode: 'target-excluded-malformed-semi-invulnerable-state',
    })
  })

  it('applies the global state gate through authoritative target predicates', () => {
    const setup = setupPlan('Dig')
    const targetability = createMoveSemiInvulnerableTargetabilityResolver({ effects: setup.effects })
    const relationships = createMoveAutomationRelationshipResolver({
      sides: {},
      placements: basePlacements().map(entry => ({ id: entry.id })),
    })
    const evaluate = (attackingMoveId: string) => evaluateMoveAutomationTargetPredicates({
      actorPlacementId: 'other-token',
      authoritativeCandidatePlacementIds: ['actor-token'],
      requestedCandidatePlacementIds: ['actor-token'],
      predicate: { relationship: 'any', willingness: 'any', excludeActor: false },
      relationships,
      targetability,
      attackingMoveId,
    })

    expect(evaluate('Scratch').legalTargetEvaluations[0]).toMatchObject({
      outcome: 'excluded',
      reasonCode: 'target-excluded-semi-invulnerable',
    })
    expect(evaluate('Magnitude').legalTargetPlacementIds).toEqual(['actor-token'])
  })

  it('blocks ordinary move declarations and movement while a setup state is active', () => {
    const setup = setupPlan('Dig')
    const state = stateFromSetup(setup)
    const map = mapFixture({ encounterState: state })
    const pokemonSheets = sheets()
    const context = contextFor({ map })

    expect(() => resolveAuthoritativeMoveFromContext(context)).toThrowError(
      expect.objectContaining({ code: 'move-semi-invulnerable' }),
    )
    const movement = resolveAuthoritativeMovement({
      map,
      sheets: { pokemon: pokemonSheets, trainer: new Map<string, TrainerSheet>() },
      placementId: 'actor-token',
      mode: 'shift',
      destination: { x: 3, y: 0, z: 1 },
    })
    expect(movement).toMatchObject({
      ok: false,
      reasonCode: 'movement-semi-invulnerable-state',
      movementProfile: { state: { semiInvulnerable: 'underground' } },
    })
  })

  it('cleans both linked effects on explicit cancellation, one-sided removal, KO, and scene end', () => {
    const setup = setupPlan('Sky Drop', { carriedTargetPlacementId: 'target-token' })
    const state = stateFromSetup(setup)
    const handler = createMoveSemiInvulnerableLifecycleHandler()

    const cancelled = reduceEncounterLifecycle(state, createMoveSemiInvulnerableCleanupEvents({
      effects: state.effects,
      setupOperationId: setup.setupOperationId,
      sourceOperationId: 'operation.explicit-cancel',
      reasonCode: 'semi-invulnerable.cancelled',
    }), [handler])
    expect(cancelled.state.effects).toEqual([])

    const oneSided = reduceEncounterLifecycle(
      state,
      [effectRemovalEvent(setup.actorEffect.id)],
      [handler],
    )
    expect(oneSided.state.effects).toEqual([])
    expect(oneSided.emittedEvents).toHaveLength(1)
    expect(oneSided.emittedEvents[0]).toMatchObject({
      kind: 'effect-removed',
      effectId: setup.carriedTargetEffect?.id,
      reasonCode: 'semi-invulnerable.linked-effect-removed',
    })

    for (const participantId of ['actor-token', 'target-token']) {
      const first = reduceEncounterLifecycle(state, [koEvent(participantId)], [handler])
      const replay = reduceEncounterLifecycle(state, [koEvent(participantId)], [handler])
      expect(first).toEqual(replay)
      expect(first.state.effects).toEqual([])
      expect(first.emittedEvents).toHaveLength(2)

      const switched = reduceEncounterLifecycle(state, [switchEvent(participantId)], [handler])
      expect(switched.state.effects).toEqual([])
      expect(switched.emittedEvents).toHaveLength(2)
    }

    const interrupted = reduceEncounterLifecycle(
      state,
      [interruptHitEvent('Sky Uppercut')],
      [handler],
    )
    expect(interrupted.state.effects).toEqual([])
    expect(interrupted.emittedEvents).toHaveLength(2)
    expect(interrupted.emittedEvents.every(event => (
      event.reasonCode === 'semi-invulnerable.cancelled'
    ))).toBe(true)
    expect(reduceEncounterLifecycle(
      state,
      [interruptHitEvent('Scratch')],
      [handler],
    ).state.effects).toHaveLength(2)

    const sceneEnded = reduceEncounterLifecycle(state, [sceneEndEvent()], [handler])
    expect(sceneEnded.state.effects).toEqual([])
    expect(sceneEnded.transitions.map(entry => entry.transition.kind)).toEqual([
      'expired',
      'expired',
    ])
  })

  it('resolves Dig movement through the oracle, then supplies exact cleanup without mutation', () => {
    const setup = setupPlan('Dig')
    const state = stateFromSetup(setup)
    const map = mapFixture({
      encounterState: state,
      placements: [
        placement('actor-token', 'actor', 1, 1),
        placement('target-token', 'target', 7, 1),
        placement('other-token', 'other', 9, 9),
      ],
    })
    const context = contextFor({ map })
    const originalMap = structuredClone(context.map)
    const result = resolveMoveSemiInvulnerableMovement({
      context,
      setupOperationId: setup.setupOperationId,
      resolutionOperationId: 'resolution.dig',
      destinationSetId: 'destinations.dig',
      choices: { resolve: () => ({ destination: { x: 4, y: 0, z: 1 }, targetPlacementId: null }) },
    })

    expect(result).toMatchObject({
      canonicalMoveId: 'Dig',
      actorPlacementId: 'actor-token',
      targetPlacementId: null,
      movements: [{
        placementId: 'actor-token',
        role: 'user',
        mode: 'traverse',
        origin: { x: 1, y: 0, z: 1 },
        destination: { x: 4, y: 0, z: 1 },
        cost: 3,
        reviewedLimit: 6,
        capabilityModes: ['overland'],
        traversesIntermediateCells: true,
      }],
      cleanupEvents: [{
        kind: 'effect-removed',
        effectId: setup.actorEffect.id,
        reasonCode: 'semi-invulnerable.resolved',
      }],
    })
    expect(reduceEncounterLifecycle(state, result.cleanupEvents).state.effects).toEqual([])
    expect(context.map).toEqual(originalMap)
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.movements[0]?.path)).toBe(true)
  })

  it('appears adjacent without traversing blocking terrain for Phantom Force', () => {
    const setup = setupPlan('Phantom Force')
    const state = stateFromSetup(setup)
    const map = mapFixture({
      encounterState: state,
      placements: [
        placement('actor-token', 'actor', 1, 1),
        placement('target-token', 'target', 7, 1),
        placement('other-token', 'other', 9, 9),
      ],
      voxels: [{ x: 4, y: 0, z: 1, materialId: 'airship_wall_bulkhead' }],
    })
    const context = contextFor({ map })
    const result = resolveMoveSemiInvulnerableMovement({
      context,
      setupOperationId: setup.setupOperationId,
      resolutionOperationId: 'resolution.phantom-force',
      destinationSetId: 'destinations.phantom-force',
      choices: {
        resolve: () => ({
          destination: { x: 6, y: 0, z: 1 },
          targetPlacementId: 'target-token',
        }),
      },
    })

    expect(result.movements).toEqual([expect.objectContaining({
      placementId: 'actor-token',
      mode: 'appear',
      path: [
        { x: 1, y: 0, z: 1 },
        { x: 6, y: 0, z: 1 },
      ],
      traversesIntermediateCells: false,
      ignoresMovementCapabilities: true,
      capabilityModes: [],
    })])
    expect(result.targetPlacementId).toBe('target-token')
  })

  it('moves and lowers a Sky Drop pair atomically while preserving footprint separation', () => {
    const setup = setupPlan('Sky Drop', { carriedTargetPlacementId: 'target-token' })
    const state = stateFromSetup(setup)
    const map = mapFixture({ encounterState: state })
    const context = contextFor({ map })
    const result = resolveMoveSemiInvulnerableMovement({
      context,
      setupOperationId: setup.setupOperationId,
      resolutionOperationId: 'resolution.sky-drop',
      destinationSetId: 'destinations.sky-drop',
      choices: { resolve: () => ({ destination: { x: 4, y: 0, z: 1 }, targetPlacementId: null }) },
    })

    expect(result.movements).toEqual([
      expect.objectContaining({
        placementId: 'actor-token',
        role: 'user',
        mode: 'traverse',
        destination: { x: 4, y: 0, z: 1 },
      }),
      expect.objectContaining({
        placementId: 'target-token',
        role: 'carried-target',
        mode: 'carried',
        origin: { x: 2, y: 0, z: 1 },
        destination: { x: 5, y: 0, z: 1 },
        ignoresMovementCapabilities: true,
      }),
    ])
    expect(result.cleanupEvents.map(event => event.effectId).sort()).toEqual(
      setup.effects.map(effect => effect.id).sort(),
    )
    expect(reduceEncounterLifecycle(state, result.cleanupEvents).state.effects).toEqual([])
  })

  it('fails stale or illegal resolve choices before exposing movement or cleanup', () => {
    const fly = setupPlan('Fly')
    const context = contextFor({ map: mapFixture({ encounterState: stateFromSetup(fly) }) })
    const originalMap = structuredClone(context.map)

    expectMovementError(() => resolveMoveSemiInvulnerableMovement({
      context,
      setupOperationId: fly.setupOperationId,
      resolutionOperationId: 'resolution.fly.missing-target',
      destinationSetId: 'destinations.fly',
      choices: { resolve: () => ({ destination: { x: 4, y: 0, z: 1 }, targetPlacementId: null }) },
    }), 'target-required')
    expectMovementError(() => resolveMoveSemiInvulnerableMovement({
      context,
      setupOperationId: fly.setupOperationId,
      resolutionOperationId: 'resolution.fly.not-adjacent',
      destinationSetId: 'destinations.fly',
      choices: {
        resolve: () => ({
          destination: { x: 10, y: 0, z: 1 },
          targetPlacementId: 'target-token',
        }),
      },
    }), 'target-not-adjacent')
    expectMovementError(() => resolveMoveSemiInvulnerableMovement({
      context,
      setupOperationId: 'setup.missing',
      resolutionOperationId: 'resolution.missing',
      destinationSetId: 'destinations.missing',
      choices: { resolve: () => null },
    }), 'setup-group-not-found')
    expect(context.map).toEqual(originalMap)
  })
})
