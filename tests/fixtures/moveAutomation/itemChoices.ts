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

export const ITEM_CHOICE_ACTOR_ID = 'item-choice-actor'
export const ITEM_CHOICE_TARGET_ID = 'item-choice-target'

export const createItemChoiceMap = (): TabletopMap => ({
  schemaVersion: 2,
  slug: 'durable-item-choice-arena',
  name: 'Durable Item Choice Arena',
  revision: 4,
  dimensions: { x: 8, y: 3, z: 8 },
  playerVisible: true,
  voxels: [],
  placements: [{
    id: ITEM_CHOICE_ACTOR_ID,
    sheetKind: 'trainer',
    sheetSlug: 'item-choice-trainer',
    position: { x: 1, y: 0, z: 1 },
    sideId: 'heroes',
  }, {
    id: ITEM_CHOICE_TARGET_ID,
    sheetKind: 'pokemon',
    sheetSlug: 'item-choice-target-sheet',
    position: { x: 2, y: 0, z: 1 },
    sideId: 'foes',
  }],
  encounterState: {
    ...createEmptyEncounterState(),
    sides: {
      heroes: { id: 'heroes', label: 'Heroes', status: 'active' },
      foes: { id: 'foes', label: 'Foes', status: 'active' },
    },
  },
  createdAt: 1,
  updatedAt: 100,
})

export const createItemChoiceTrainerSheet = (input: {
  readonly revision?: number
  readonly includePotion?: boolean
} = {}): TrainerSheet => ({
  slug: 'item-choice-trainer',
  name: 'Item Choice Trainer',
  level: 20,
  revision: input.revision ?? 3,
  movelist: [{ name: 'Ember' }],
  inventory: {
    medicalKit: [
      ...(input.includePotion === false
        ? []
        : [{ id: 'private-potion-row', name: 'Potion', qty: 3 }]),
      { id: 'private-antidote-row', name: 'Antidote', qty: 1 },
    ],
  },
})

export const createItemChoiceTargetSheet = (): CharacterSheet => ({
  slug: 'item-choice-target-sheet',
  nickname: 'Item Choice Target',
  species: 'Snorlax',
  level: 20,
  revision: 2,
  combat: { currentHp: 60 },
})

export const itemChoiceSheets = () => ({
  pokemonSheets: new Map<string, CharacterSheet>([[
    'item-choice-target-sheet',
    createItemChoiceTargetSheet(),
  ]]),
  trainerSheets: new Map<string, TrainerSheet>([[
    'item-choice-trainer',
    createItemChoiceTrainerSheet(),
  ]]),
})

export const itemChoiceIntent = (): ResolveMoveIntent => ({
  schemaVersion: 1,
  placementId: ITEM_CHOICE_ACTOR_ID,
  moveName: 'Ember',
  selection: { kind: 'single-target', targetPlacementId: ITEM_CHOICE_TARGET_ID },
})

export const ITEM_CHOICE_REQUIREMENTS = [{
  id: 'item-choice.actor-medical',
  source: {
    kind: 'actor-trainer-inventory',
    sections: ['medicalKit'],
  },
}] as const

export const ITEM_CHOICE_SPEC = {
  schemaVersion: 2,
  canonicalId: 'Ember',
  version: 155,
  targeting: {
    kind: 'single-target',
    minTargets: 1,
    maxTargets: 1,
    selector: { kind: 'selected-targets' },
  },
  preconditions: [],
  costs: [],
  phases: [{
    phase: 'damage',
    operations: [{
      id: 'item-choice.damage',
      kind: 'direct-hp',
      source: { kind: 'move', id: 'move.ember' },
      recipients: { kind: 'attacked-targets' },
      phase: 'damage',
      reasonCode: 'move.ember.item-choice-damage',
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
  }, {
    phase: 'after-damage',
    operations: [{
      id: 'item-choice.request',
      kind: 'choice-request',
      source: { kind: 'move', id: 'move.ember' },
      recipients: { kind: 'actor' },
      phase: 'after-damage',
      reasonCode: 'move.ember.choose-item',
      payload: {
        requestId: 'item-choice.window',
        promptKey: 'move.ember.choose-item',
        options: [],
        allowPass: true,
        itemChoice: {
          setId: 'item-choice.actor-items',
          requirementId: 'item-choice.actor-medical',
          filter: {
            referenceKinds: ['trainer-inventory-row'],
            canonicalItemIds: ['potion'],
            minimumQuantity: 1,
          },
          destinations: [{
            id: 'use.actor',
            kind: 'actor-inventory',
            labelKey: 'move.item.destination.actor',
          }],
          noneOption: {
            id: 'item.none.reviewed',
            labelKey: 'move.item.none',
          },
        },
      },
    }],
  }, {
    phase: 'usage',
    operations: [{
      id: 'item-choice.usage',
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
  }, {
    phase: 'cleanup',
    operations: [{
      id: 'item-choice.complete',
      kind: 'log',
      source: { kind: 'move', id: 'move.ember' },
      recipients: { kind: 'none' },
      phase: 'cleanup',
      reasonCode: 'move.ember.item-choice-complete',
      payload: { messageKey: 'move.ember.item-choice-complete', arguments: [] },
    }],
  }],
  registeredHandlerId: null,
  presentation: {
    displayName: 'Ember',
    vfxKey: null,
    tags: ['item-choice-test'],
  },
}

export const createItemChoiceRuntimeRegistry = (): MoveAutomationRuntimeRegistry => {
  const definition = validateMoveSpec(ITEM_CHOICE_SPEC)
  const runtime: MoveSpecV2Runtime = Object.freeze({
    canonicalId: 'Ember',
    kind: 'movespec-v2',
    version: definition.spec.version,
    definitionHash: definition.definitionHash,
    sourceModule: 'tests/fixtures/moveAutomation/itemChoices.ts',
    definition,
  })
  return Object.freeze({
    size: 1,
    handlerRegistry: REGISTERED_MOVE_HANDLER_REGISTRY,
    resolve: (canonicalId: string) => canonicalId === 'Ember' ? runtime : null,
    entries: () => Object.freeze([runtime]),
  })
}
