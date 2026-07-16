import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import type { MoveHazardCellSelectionRules } from '#shared/moveAutomation/hazardCellSelection'
import type { ResolveMoveIntent } from '#shared/livePlayMoveResolution'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { REGISTERED_MOVE_HANDLER_REGISTRY } from '~~/server/domain/moveAutomation/handlers/registry'
import type {
  MoveAutomationRuntimeRegistry,
  MoveSpecV2Runtime,
} from '~~/server/domain/moveAutomation/registry'
import { validateMoveSpec } from '~~/server/domain/moveAutomation/validateSpec'

export const HAZARD_CELL_CHOICE_CANONICAL_MOVE_ID = 'Swords Dance' as const
export const HAZARD_CELL_CHOICE_ACTOR_ID = 'hazard-actor' as const
export const HAZARD_CELL_CHOICE_ACTOR_SHEET = 'hazard-actor-sheet' as const
export const HAZARD_CELL_CHOICE_WINDOW_ID = 'hazard-test.select-cells' as const
export const HAZARD_CELL_CHOICE_OPERATION_ID = 'hazard-test.add-spikes' as const
export const HAZARD_CELL_CHOICE_SET_ID = 'hazard-test.spike-cells' as const

export const HAZARD_CELL_CHOICE_EXACT_RULES: MoveHazardCellSelectionRules = Object.freeze({
  count: Object.freeze({ kind: 'exact', count: 2 }),
  range: 3,
  adjacency: 'orthogonal',
  connectedness: 'connected',
  occupancy: 'empty-of-placements',
  geometry: Object.freeze({ kind: 'horizontal-plane' }),
})

export const HAZARD_CELL_CHOICE_UP_TO_RULES: MoveHazardCellSelectionRules = Object.freeze({
  ...HAZARD_CELL_CHOICE_EXACT_RULES,
  count: Object.freeze({ kind: 'up-to', minimum: 0, maximum: 3 }),
  connectedness: 'none',
})

export const hazardCellChoiceActorPlacement = (
  position = { x: 2, y: 0, z: 2 },
): SheetPlacement => ({
  id: HAZARD_CELL_CHOICE_ACTOR_ID,
  sheetKind: 'pokemon',
  sheetSlug: HAZARD_CELL_CHOICE_ACTOR_SHEET,
  position: { ...position },
})

export const createHazardCellChoiceMap = (
  overrides: Partial<TabletopMap> = {},
): TabletopMap => ({
  schemaVersion: 2,
  slug: 'hazard-choice-arena',
  name: 'Hazard Choice Arena',
  revision: 7,
  dimensions: { x: 6, y: 1, z: 6 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [hazardCellChoiceActorPlacement()],
  lights: [],
  initiative: { activeId: HAZARD_CELL_CHOICE_ACTOR_ID, round: 2 },
  activeScene: { name: 'Hazard Scene', startedAt: 100 },
  encounterState: createEmptyEncounterState(),
  createdAt: 1,
  updatedAt: 100,
  ...overrides,
})

export const createHazardCellChoiceActorSheet = (
  overrides: Partial<CharacterSheet> = {},
): CharacterSheet => ({
  slug: HAZARD_CELL_CHOICE_ACTOR_SHEET,
  nickname: 'Hazard Dancer',
  species: 'Forretress',
  level: 20,
  revision: 3,
  movelist: [{ name: HAZARD_CELL_CHOICE_CANONICAL_MOVE_ID }],
  capabilities: { overland: 5, sky: 0, swim: 0, levitate: 0 },
  combat: { currentHp: 50 },
  ...overrides,
})

export const hazardCellChoiceSheets = (
  actor: CharacterSheet = createHazardCellChoiceActorSheet(),
) => ({
  pokemonSheets: new Map([[HAZARD_CELL_CHOICE_ACTOR_SHEET, actor]]),
  trainerSheets: new Map<string, TrainerSheet>(),
})

export const createHazardCellChoiceSpec = (
  rules: MoveHazardCellSelectionRules = HAZARD_CELL_CHOICE_EXACT_RULES,
) => ({
  schemaVersion: 2,
  canonicalId: HAZARD_CELL_CHOICE_CANONICAL_MOVE_ID,
  version: rules.count.kind === 'exact' ? 134 : 135,
  targeting: {
    kind: 'self',
    minTargets: 1,
    maxTargets: 1,
    selector: { kind: 'actor' },
  },
  preconditions: [],
  costs: [{
    id: 'hazard-test.no-cost',
    phase: 'pay',
    cost: { kind: 'no-cost', reasonCode: 'hazard-test.reviewed-exception' },
  }],
  phases: [{
    phase: 'schedule',
    operations: [{
      id: HAZARD_CELL_CHOICE_OPERATION_ID,
      kind: 'hazard',
      source: { kind: 'move', id: 'move.hazard-test' },
      recipients: { kind: 'none' },
      phase: 'schedule',
      reasonCode: 'hazard-test.place-spikes',
      payload: {
        action: 'add',
        hazardId: 'hazard-test.spikes',
        hazardKind: 'spikes',
        cellSetId: HAZARD_CELL_CHOICE_SET_ID,
        layers: 1,
        cellSelection: {
          requestId: HAZARD_CELL_CHOICE_WINDOW_ID,
          promptKey: 'hazard-test.choose-cells',
          ...rules,
        },
      },
    }],
  }, {
    phase: 'usage',
    operations: [{
      id: 'hazard-test.usage',
      kind: 'usage',
      source: { kind: 'move', id: 'move.hazard-test' },
      recipients: { kind: 'actor' },
      phase: 'usage',
      reasonCode: 'hazard-test.frequency-use',
      payload: {
        action: 'spend',
        resourceId: 'hazard-test.frequency-use',
        amount: 1,
      },
    }],
  }, {
    phase: 'cleanup',
    operations: [{
      id: 'hazard-test.completed',
      kind: 'log',
      source: { kind: 'move', id: 'move.hazard-test' },
      recipients: { kind: 'none' },
      phase: 'cleanup',
      reasonCode: 'hazard-test.completed',
      payload: { messageKey: 'hazard-test.completed', arguments: [] },
    }],
  }],
  registeredHandlerId: null,
  presentation: {
    displayName: HAZARD_CELL_CHOICE_CANONICAL_MOVE_ID,
    vfxKey: null,
    tags: ['hazard-cell-choice-test'],
  },
})

export const createHazardCellChoiceRuntimeRegistry = (
  rules: MoveHazardCellSelectionRules = HAZARD_CELL_CHOICE_EXACT_RULES,
): MoveAutomationRuntimeRegistry => {
  const definition = validateMoveSpec(createHazardCellChoiceSpec(rules))
  const runtime: MoveSpecV2Runtime = Object.freeze({
    canonicalId: definition.spec.canonicalId,
    kind: 'movespec-v2',
    version: definition.spec.version,
    definitionHash: definition.definitionHash,
    sourceModule: 'tests/fixtures/moveAutomation/hazardCellChoices.ts',
    definition,
  })
  return Object.freeze({
    size: 1,
    handlerRegistry: REGISTERED_MOVE_HANDLER_REGISTRY,
    resolve: (canonicalId: string) => canonicalId === runtime.canonicalId ? runtime : null,
    entries: () => Object.freeze([runtime]),
  })
}

export const hazardCellChoiceIntent = (): ResolveMoveIntent => ({
  schemaVersion: 1,
  placementId: HAZARD_CELL_CHOICE_ACTOR_ID,
  moveName: HAZARD_CELL_CHOICE_CANONICAL_MOVE_ID,
  selection: { kind: 'self' },
})
