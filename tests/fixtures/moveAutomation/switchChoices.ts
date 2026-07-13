import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import type { ResolveMoveIntent } from '#shared/livePlayMoveResolution'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import {
  REGISTERED_MOVE_HANDLER_REGISTRY,
} from '~~/server/domain/moveAutomation/handlers/registry'
import type {
  MoveAutomationRuntimeRegistry,
  MoveSpecV2Runtime,
} from '~~/server/domain/moveAutomation/registry'
import { validateMoveSpec } from '~~/server/domain/moveAutomation/validateSpec'

export const SWITCH_ACTOR_PLACEMENT_ID = 'switch-actor'
export const SWITCH_TARGET_PLACEMENT_ID = 'switch-target'
export const SWITCH_TRAINER_PLACEMENT_ID = 'switch-trainer'

export const createSwitchChoicePokemonSheet = (input: {
  readonly slug: string
  readonly species: string
  readonly currentHp?: number
  readonly actor?: boolean
  readonly revision?: number
}): CharacterSheet => ({
  slug: input.slug,
  nickname: input.slug,
  species: input.species,
  level: 20,
  revision: input.revision ?? 2,
  combat: { currentHp: input.currentHp ?? 40 },
  movelist: input.actor ? [{ name: 'Ember' }] : [],
})

export const createSwitchChoiceTrainerSheet = (
  revision = 3,
): TrainerSheet => ({
  slug: 'switch-owner',
  name: 'Switch Owner',
  level: 10,
  revision,
  currentTeam: ['switch-actor-sheet', 'switch-replacement'],
})

export const createSwitchChoiceMap = (): TabletopMap => ({
  schemaVersion: 2,
  slug: 'durable-switch-arena',
  name: 'Durable Switch Arena',
  revision: 4,
  dimensions: { x: 10, y: 4, z: 10 },
  playerVisible: true,
  voxels: [],
  placements: [
    {
      id: SWITCH_TRAINER_PLACEMENT_ID,
      sheetKind: 'trainer',
      sheetSlug: 'switch-owner',
      position: { x: 0, y: 0, z: 0 },
      sideId: 'heroes',
      initiative: 12,
    },
    {
      id: SWITCH_ACTOR_PLACEMENT_ID,
      sheetKind: 'pokemon',
      sheetSlug: 'switch-actor-sheet',
      position: { x: 2, y: 0, z: 2 },
      sideId: 'heroes',
      initiative: 18,
      facing: 'north-east',
    },
    {
      id: SWITCH_TARGET_PLACEMENT_ID,
      sheetKind: 'pokemon',
      sheetSlug: 'switch-target-sheet',
      position: { x: 3, y: 0, z: 2 },
      sideId: 'foes',
      initiative: 10,
    },
  ],
  initiative: {
    activeId: SWITCH_ACTOR_PLACEMENT_ID,
    round: 2,
    manualOrderIds: [
      SWITCH_ACTOR_PLACEMENT_ID,
      SWITCH_TRAINER_PLACEMENT_ID,
      SWITCH_TARGET_PLACEMENT_ID,
    ],
  },
  activeScene: { name: 'Switch Test', startedAt: 100 },
  temporaryHitPoints: {
    scene: { name: 'Switch Test', startedAt: 100 },
    byPlacementId: { [SWITCH_ACTOR_PLACEMENT_ID]: 5 },
  },
  encounterState: {
    ...createEmptyEncounterState(),
    sides: {
      heroes: { id: 'heroes', label: 'Heroes', status: 'active' },
      foes: { id: 'foes', label: 'Foes', status: 'active' },
    },
  },
  metadata: { note: 'unchanged' },
  createdAt: 1,
  updatedAt: 100,
})

export const switchChoiceSheets = (options: {
  readonly trainerRevision?: number
  readonly replacementRevision?: number
} = {}) => ({
  pokemonSheets: new Map<string, CharacterSheet>([
    ['switch-actor-sheet', createSwitchChoicePokemonSheet({
      slug: 'switch-actor-sheet',
      species: 'Pikachu',
      actor: true,
    })],
    ['switch-target-sheet', createSwitchChoicePokemonSheet({
      slug: 'switch-target-sheet',
      species: 'Snorlax',
      currentHp: 60,
    })],
    ['switch-replacement', createSwitchChoicePokemonSheet({
      slug: 'switch-replacement',
      species: 'Eevee',
      revision: options.replacementRevision,
    })],
  ]),
  trainerSheets: new Map<string, TrainerSheet>([
    ['switch-owner', createSwitchChoiceTrainerSheet(options.trainerRevision)],
  ]),
})

export const switchChoiceIntent = (): ResolveMoveIntent => ({
  schemaVersion: 1,
  placementId: SWITCH_ACTOR_PLACEMENT_ID,
  moveName: 'Ember',
  selection: { kind: 'single-target', targetPlacementId: SWITCH_TARGET_PLACEMENT_ID },
})

export const SWITCH_CHOICE_SPEC = {
  schemaVersion: 2,
  canonicalId: 'Ember',
  version: 130,
  targeting: {
    kind: 'single-target',
    minTargets: 1,
    maxTargets: 1,
    selector: { kind: 'selected-targets' },
  },
  preconditions: [],
  costs: [],
  phases: [
    {
      phase: 'damage',
      operations: [{
        id: 'switch-test.damage',
        kind: 'direct-hp',
        source: { kind: 'move', id: 'move.ember' },
        recipients: { kind: 'attacked-targets' },
        phase: 'damage',
        reasonCode: 'move.ember.switch-test-damage',
        payload: {
          mode: 'lose',
          pool: 'hit-points',
          calculation: { kind: 'fixed', value: 5 },
          copySource: null,
          bounds: { minimum: 0, maximum: null },
          rounding: 'floor',
          accuracyRollId: null,
          applyTypeImmunity: false,
          cost: null,
          injury: { hitPointMarkers: 'ignore', massiveDamage: 'never' },
        },
      }],
    },
    {
      phase: 'movement',
      operations: [{
        id: 'switch-test.choose-replacement',
        kind: 'switch-request',
        source: { kind: 'move', id: 'move.ember' },
        recipients: { kind: 'actor' },
        phase: 'movement',
        reasonCode: 'move.ember.choose-replacement',
        payload: {
          requestId: 'switch-test.replacement-window',
          replacementSetId: 'switch-test.replacements',
          promptKey: 'move.ember.choose-replacement',
          required: true,
          positionPolicy: 'recalled-position',
          initiativePolicy: 'inherit-slot',
          stateTransferPolicy: 'none',
        },
      }],
    },
    {
      phase: 'usage',
      operations: [{
        id: 'switch-test.usage',
        kind: 'usage',
        source: { kind: 'move', id: 'move.ember' },
        recipients: { kind: 'actor' },
        phase: 'usage',
        reasonCode: 'move.ember.frequency-use',
        payload: {
          action: 'spend',
          resourceId: 'ember.frequency-use',
          amount: 1,
        },
      }],
    },
    {
      phase: 'cleanup',
      operations: [{
        id: 'switch-test.completed',
        kind: 'log',
        source: { kind: 'move', id: 'move.ember' },
        recipients: { kind: 'none' },
        phase: 'cleanup',
        reasonCode: 'move.ember.completed',
        payload: { messageKey: 'move.ember.completed', arguments: [] },
      }],
    },
  ],
  registeredHandlerId: null,
  presentation: {
    displayName: 'Ember',
    vfxKey: null,
    tags: ['switch-test'],
  },
}

export const createSwitchChoiceRuntimeRegistry = (options: {
  readonly stateTransferPolicy?: 'none' | 'baton-pass'
} = {}): MoveAutomationRuntimeRegistry => {
  const spec = structuredClone(SWITCH_CHOICE_SPEC) as unknown as {
    phases: Array<{
      operations: Array<{ kind: string; payload: Record<string, unknown> }>
    }>
  }
  const switchOperation = spec.phases
    .flatMap(block => block.operations)
    .find(operation => operation.kind === 'switch-request')
  if (!switchOperation) throw new Error('Switch fixture has no switch request.')
  switchOperation.payload.stateTransferPolicy = options.stateTransferPolicy ?? 'none'
  const definition = validateMoveSpec(spec)
  const runtime: MoveSpecV2Runtime = Object.freeze({
    canonicalId: 'Ember',
    kind: 'movespec-v2',
    version: definition.spec.version,
    definitionHash: definition.definitionHash,
    sourceModule: 'tests/fixtures/moveAutomation/switchChoices.ts',
    definition,
  })
  return Object.freeze({
    size: 1,
    handlerRegistry: REGISTERED_MOVE_HANDLER_REGISTRY,
    resolve: (canonicalId: string) => canonicalId === 'Ember' ? runtime : null,
    entries: () => Object.freeze([runtime]),
  })
}
