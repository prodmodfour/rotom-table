import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import type { MoveMovementChoice } from '#shared/moveAutomation/effects'
import type { ResolveMoveIntent } from '#shared/livePlayMoveResolution'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import {
  REGISTERED_MOVE_HANDLER_REGISTRY,
} from '~~/server/domain/moveAutomation/handlers/registry'
import type {
  MoveAutomationRuntimeRegistry,
  MoveSpecV2Runtime,
} from '~~/server/domain/moveAutomation/registry'
import { validateMoveSpec } from '~~/server/domain/moveAutomation/validateSpec'

export const MOVEMENT_CHOICE_CANONICAL_MOVE_ID = 'Swords Dance' as const
export const MOVEMENT_CHOICE_ACTOR_PLACEMENT_ID = 'actor-token' as const
export const MOVEMENT_CHOICE_ACTOR_SHEET_SLUG = 'actor' as const

export const movementChoiceActorPlacement = (
  position = { x: 1, y: 0, z: 1 },
): SheetPlacement => ({
  id: MOVEMENT_CHOICE_ACTOR_PLACEMENT_ID,
  sheetKind: 'pokemon',
  sheetSlug: MOVEMENT_CHOICE_ACTOR_SHEET_SLUG,
  position: { ...position },
})

export const createMovementChoiceMap = (
  overrides: Partial<TabletopMap> = {},
): TabletopMap => ({
  schemaVersion: 2,
  slug: 'durable-movement-arena',
  name: 'Durable Movement Arena',
  revision: 7,
  dimensions: { x: 5, y: 2, z: 4 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [movementChoiceActorPlacement()],
  lights: [],
  initiative: { activeId: MOVEMENT_CHOICE_ACTOR_PLACEMENT_ID, round: 2 },
  activeScene: { name: 'Movement Scene', startedAt: 100 },
  encounterState: createEmptyEncounterState(),
  createdAt: 1,
  updatedAt: 100,
  ...overrides,
})

export const createMovementChoiceActorSheet = (
  overrides: Partial<CharacterSheet> = {},
): CharacterSheet => ({
  slug: MOVEMENT_CHOICE_ACTOR_SHEET_SLUG,
  nickname: 'Dancer',
  species: 'Scyther',
  level: 20,
  revision: 3,
  movelist: [{ name: MOVEMENT_CHOICE_CANONICAL_MOVE_ID }],
  capabilities: { overland: 6, sky: 0, swim: 0, levitate: 0 },
  combat: { currentHp: 50 },
  ...overrides,
})

export const movementChoiceSheets = (
  actor: CharacterSheet = createMovementChoiceActorSheet(),
) => ({
  pokemonSheets: new Map([[MOVEMENT_CHOICE_ACTOR_SHEET_SLUG, actor]]),
  trainerSheets: new Map<string, TrainerSheet>(),
})

export const MOVEMENT_CHOICE_DESTINATION_DECLARATION: MoveMovementChoice = Object.freeze({
  kind: 'destination',
  promptKey: 'movement-test.choose-destination',
  allowPass: true,
})

export const MOVEMENT_CHOICE_DIRECTION_DECLARATION: MoveMovementChoice = Object.freeze({
  kind: 'direction',
  promptKey: 'movement-test.choose-direction',
  allowPass: false,
  directions: Object.freeze(['south', 'east', 'north'] as const),
})

export const createMovementChoiceSpec = (
  choice: MoveMovementChoice = MOVEMENT_CHOICE_DESTINATION_DECLARATION,
) => ({
  schemaVersion: 2,
  canonicalId: MOVEMENT_CHOICE_CANONICAL_MOVE_ID,
  version: choice.kind === 'direction' ? 126 : 125,
  targeting: {
    kind: 'self',
    minTargets: 1,
    maxTargets: 1,
    selector: { kind: 'actor' },
  },
  preconditions: [],
  costs: [{
    id: 'movement-test.no-cost',
    phase: 'pay',
    cost: { kind: 'no-cost', reasonCode: 'movement-test.reviewed-exception' },
  }],
  phases: [{
    phase: 'movement',
    operations: [{
      id: 'movement-test.choose-destination',
      kind: 'movement-request',
      source: { kind: 'move', id: 'move.swords-dance' },
      recipients: { kind: 'actor' },
      phase: 'movement',
      reasonCode: 'movement-test.choose-destination',
      payload: {
        requestId: 'movement-test.destination-window',
        mode: 'voluntary',
        distance: 3,
        destinationSetId: 'movement-test.destinations',
        choice,
      },
    }],
  }, {
    phase: 'usage',
    operations: [{
      id: 'movement-test.usage',
      kind: 'usage',
      source: { kind: 'move', id: 'move.swords-dance' },
      recipients: { kind: 'actor' },
      phase: 'usage',
      reasonCode: 'movement-test.frequency-use',
      payload: {
        action: 'spend',
        resourceId: 'movement-test.frequency-use',
        amount: 1,
      },
    }],
  }, {
    phase: 'cleanup',
    operations: [{
      id: 'movement-test.completed',
      kind: 'log',
      source: { kind: 'move', id: 'move.swords-dance' },
      recipients: { kind: 'none' },
      phase: 'cleanup',
      reasonCode: 'movement-test.completed',
      payload: { messageKey: 'movement-test.completed', arguments: [] },
    }],
  }],
  registeredHandlerId: null,
  presentation: {
    displayName: MOVEMENT_CHOICE_CANONICAL_MOVE_ID,
    vfxKey: null,
    tags: ['movement-choice-test'],
  },
})

export const createMovementChoiceRuntimeRegistry = (
  choice: MoveMovementChoice = MOVEMENT_CHOICE_DESTINATION_DECLARATION,
): MoveAutomationRuntimeRegistry => {
  const definition = validateMoveSpec(createMovementChoiceSpec(choice))
  const runtime: MoveSpecV2Runtime = Object.freeze({
    canonicalId: definition.spec.canonicalId,
    kind: 'movespec-v2',
    version: definition.spec.version,
    definitionHash: definition.definitionHash,
    sourceModule: 'tests/fixtures/moveAutomation/movementChoices.ts',
    definition,
  })
  return Object.freeze({
    size: 1,
    handlerRegistry: REGISTERED_MOVE_HANDLER_REGISTRY,
    resolve: (canonicalId: string) => canonicalId === runtime.canonicalId ? runtime : null,
    entries: () => Object.freeze([runtime]),
  })
}

export const movementChoiceIntent = (): ResolveMoveIntent => ({
  schemaVersion: 1,
  placementId: MOVEMENT_CHOICE_ACTOR_PLACEMENT_ID,
  moveName: MOVEMENT_CHOICE_CANONICAL_MOVE_ID,
  selection: { kind: 'self' },
})
