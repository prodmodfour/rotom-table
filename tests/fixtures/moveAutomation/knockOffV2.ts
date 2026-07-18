import {
  LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
  type ResolveMoveIntent,
} from '#shared/livePlayMoveResolution'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { REGISTERED_MOVE_HANDLER_REGISTRY } from '~~/server/domain/moveAutomation/handlers/registry'
import type {
  MoveAutomationRuntimeRegistry,
  MoveSpecV2Runtime,
} from '~~/server/domain/moveAutomation/registry'
import { KNOCK_OFF_MOVE_SPEC } from '~~/server/domain/moveAutomation/specs/knockOff'
import { validateMoveSpec } from '~~/server/domain/moveAutomation/validateSpec'

export const KNOCK_OFF_ACTOR_PLACEMENT_ID = 'knock-off-actor'
export const KNOCK_OFF_TARGET_PLACEMENT_ID = 'knock-off-target'
export const KNOCK_OFF_TARGET_TRAINER_SLUG = 'knock-off-target-trainer'

export const KNOCK_OFF_V2_SEMANTIC_SCENARIOS = Object.freeze([
  { scenarioId: 'knock-off.v2-atomic-failure', evidenceClasses: ['multi-resource-conflict'] as const },
  { scenarioId: 'knock-off.v2-automatic-single-item', evidenceClasses: ['alternate-branch', 'hit'] as const },
  { scenarioId: 'knock-off.v2-critical-hit', evidenceClasses: ['crit'] as const },
  { scenarioId: 'knock-off.v2-duplicate-declaration', evidenceClasses: ['retry'] as const },
  { scenarioId: 'knock-off.v2-duplicate-response', evidenceClasses: ['retry'] as const },
  { scenarioId: 'knock-off.v2-forged-response', evidenceClasses: ['multi-resource-conflict'] as const },
  { scenarioId: 'knock-off.v2-hit-choice', evidenceClasses: ['choice', 'hit', 'threshold-pass'] as const },
  { scenarioId: 'knock-off.v2-immunity', evidenceClasses: ['immunity', 'threshold-fail'] as const },
  { scenarioId: 'knock-off.v2-itemless-hit', evidenceClasses: ['alternate-branch', 'threshold-fail'] as const },
  { scenarioId: 'knock-off.v2-miss', evidenceClasses: ['miss'] as const },
  { scenarioId: 'knock-off.v2-reconnect', evidenceClasses: ['reconnect'] as const },
  { scenarioId: 'knock-off.v2-stale-item', evidenceClasses: ['multi-resource-conflict'] as const },
  { scenarioId: 'knock-off.v2-trainer-accessory', evidenceClasses: ['alternate-branch'] as const },
] as const)

const KNOCK_OFF_V2_TEST_DEFINITION = validateMoveSpec(KNOCK_OFF_MOVE_SPEC)

/** Test-only type override proving that immunity prevents the item clause. */
export const knockOffImmunityTestDefinition = () => {
  const spec = JSON.parse(JSON.stringify(KNOCK_OFF_MOVE_SPEC)) as {
    phases: Array<{
      operations: Array<{
        id: string
        kind: string
        payload: Record<string, unknown>
      }>
    }>
  }
  const damage = spec.phases.flatMap(({ operations }) => operations)
    .find(operation => operation.id === 'knock-off.damage')
  if (!damage || damage.kind !== 'damage') {
    throw new Error('Knock Off damage operation is missing.')
  }
  damage.payload.typeEffectiveness = {
    immunity: 'honor',
    resistance: 'honor',
    weakness: 'honor',
    effectivenessOverride: null,
    defenderTypeOverrides: [{ defenderType: 'normal', relation: 'immune' }],
  }
  return validateMoveSpec(spec)
}

export const KNOCK_OFF_V2_TEST_RUNTIME: MoveSpecV2Runtime = Object.freeze({
  canonicalId: 'Knock Off',
  kind: 'movespec-v2',
  version: KNOCK_OFF_V2_TEST_DEFINITION.spec.version,
  definitionHash: KNOCK_OFF_V2_TEST_DEFINITION.definitionHash,
  sourceModule: 'server/domain/moveAutomation/specs/knockOff.ts',
  definition: KNOCK_OFF_V2_TEST_DEFINITION,
})

/** Isolated registry used by pure tests that substitute reviewed Knock Off definitions. */
export const createKnockOffV2RuntimeRegistry = (): MoveAutomationRuntimeRegistry => Object.freeze({
  size: 1,
  handlerRegistry: REGISTERED_MOVE_HANDLER_REGISTRY,
  resolve: (canonicalId: string) => canonicalId === 'Knock Off'
    ? KNOCK_OFF_V2_TEST_RUNTIME
    : null,
  entries: () => Object.freeze([KNOCK_OFF_V2_TEST_RUNTIME]),
})

export interface KnockOffV2FixtureOptions {
  readonly heldItems?: string | null
  readonly mapRevision?: number
  readonly targetTrainerEquipmentSlots?: TrainerSheet['equipmentSlots']
}

const placement = (
  id: string,
  sheetSlug: string,
  x: number,
): SheetPlacement => ({
  id,
  sheetKind: 'pokemon',
  sheetSlug,
  position: { x, y: 0, z: 1 },
  sideId: id === KNOCK_OFF_ACTOR_PLACEMENT_ID ? 'heroes' : 'foes',
  initiative: id === KNOCK_OFF_ACTOR_PLACEMENT_ID ? 20 : 10,
})

const pokemonSheet = (input: {
  readonly slug: string
  readonly species: string
  readonly moves?: CharacterSheet['movelist']
  readonly heldItems?: string | null
}): CharacterSheet => ({
  slug: input.slug,
  nickname: input.species,
  species: input.species,
  level: 20,
  revision: 2,
  types: input.species === 'Machop' ? ['Fighting'] : ['Normal'],
  movelist: [...(input.moves ?? [])],
  items: input.heldItems ? { held: input.heldItems } : {},
  capabilities: { overland: 6 },
  stats: {
    hp: { added: 20 },
    atk: { added: 5, stage: 0 },
    def: { added: 5, stage: 0 },
    satk: { added: 5, stage: 0 },
    sdef: { added: 5, stage: 0 },
    spd: { added: 5, stage: 0 },
  },
  combatStages: { acc: 0 },
  combat: { currentHp: 100, injuries: 0, conditions: [] },
})

export const knockOffV2Fixture = (
  options: KnockOffV2FixtureOptions = {},
): {
  readonly map: TabletopMap
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly trainerSheets: ReadonlyMap<string, TrainerSheet>
  readonly intent: ResolveMoveIntent
} => {
  const encounterState = {
    ...createEmptyEncounterState(),
    sides: {
      heroes: { id: 'heroes', label: 'Heroes', status: 'active' as const },
      foes: { id: 'foes', label: 'Foes', status: 'active' as const },
    },
  }
  const targetIsTrainer = options.targetTrainerEquipmentSlots !== undefined
  const targetPlacement: SheetPlacement = targetIsTrainer
    ? {
        ...placement(
          KNOCK_OFF_TARGET_PLACEMENT_ID,
          KNOCK_OFF_TARGET_TRAINER_SLUG,
          2,
        ),
        sheetKind: 'trainer',
      }
    : placement(KNOCK_OFF_TARGET_PLACEMENT_ID, 'knock-off-target-sheet', 2)
  const map: TabletopMap = {
    schemaVersion: 2,
    slug: 'knock-off-arena',
    name: 'Knock Off Arena',
    revision: options.mapRevision ?? 0,
    dimensions: { x: 8, y: 3, z: 5 },
    groundLevelY: 0,
    playerVisible: true,
    voxels: [],
    hazards: [],
    fieldEffects: { weather: [], terrains: [], rooms: [] },
    placements: [
      placement(KNOCK_OFF_ACTOR_PLACEMENT_ID, 'knock-off-actor-sheet', 1),
      targetPlacement,
    ],
    lights: [],
    initiative: { activeId: KNOCK_OFF_ACTOR_PLACEMENT_ID, round: 1 },
    activeScene: { name: 'Knock Off Scene', startedAt: 100 },
    encounterState,
    createdAt: 1,
    updatedAt: 100,
  }
  const pokemonSheets = new Map([
    ['knock-off-actor-sheet', pokemonSheet({
      slug: 'knock-off-actor-sheet',
      species: 'Machop',
      moves: [{ name: 'Knock Off' }],
    })],
  ])
  const trainerSheets = new Map<string, TrainerSheet>()
  if (targetIsTrainer) {
    trainerSheets.set(KNOCK_OFF_TARGET_TRAINER_SLUG, {
      slug: KNOCK_OFF_TARGET_TRAINER_SLUG,
      name: 'Knock Off Target Trainer',
      level: 20,
      revision: 2,
      currentHp: 100,
      stats: {
        hp: { base: 20 },
        atk: { base: 10 },
        def: { base: 10 },
        satk: { base: 10 },
        sdef: { base: 10 },
        spd: { base: 10 },
      },
      combatStages: { acc: 0 },
      conditions: [],
      capabilities: { overland: 6 },
      equipmentSlots: { ...options.targetTrainerEquipmentSlots },
    })
  }
  else {
    pokemonSheets.set('knock-off-target-sheet', pokemonSheet({
      slug: 'knock-off-target-sheet',
      species: 'Eevee',
      heldItems: options.heldItems === undefined
        ? 'Leftovers, Bright Powder'
        : options.heldItems,
    }))
  }
  return {
    map,
    pokemonSheets,
    trainerSheets,
    intent: {
      schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
      placementId: KNOCK_OFF_ACTOR_PLACEMENT_ID,
      moveName: 'Knock Off',
      selection: {
        kind: 'single-target',
        targetPlacementId: KNOCK_OFF_TARGET_PLACEMENT_ID,
      },
    },
  }
}
