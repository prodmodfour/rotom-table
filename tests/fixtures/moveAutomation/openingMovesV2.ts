import {
  LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
  type ResolveMoveIntent,
} from '#shared/livePlayMoveResolution'
import {
  createEncounterTurnResourceLedger,
} from '#shared/moveAutomation/encounterResources'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import {
  ENCOUNTER_ACTED_SINCE_ENTRY_FLAG_ID,
} from '~~/server/domain/moveAutomation/reduceEncounterResources'

export const ASTONISH_V2_SEMANTIC_SCENARIOS = Object.freeze([
  {
    scenarioId: 'astonish.v2-aware-answer',
    evidenceClasses: ['choice', 'threshold-fail'] as const,
  },
  {
    scenarioId: 'astonish.v2-critical-hit',
    evidenceClasses: ['crit'] as const,
  },
  {
    scenarioId: 'astonish.v2-immunity',
    evidenceClasses: ['immunity'] as const,
  },
  {
    scenarioId: 'astonish.v2-miss',
    evidenceClasses: ['miss'] as const,
  },
  {
    scenarioId: 'astonish.v2-once-per-scene',
    evidenceClasses: ['alternate-branch', 'lifecycle-trigger'] as const,
  },
  {
    scenarioId: 'astonish.v2-reconnect-retry',
    evidenceClasses: ['reconnect', 'retry'] as const,
  },
  {
    scenarioId: 'astonish.v2-scene-reset',
    evidenceClasses: ['lifecycle-cleanup'] as const,
  },
  {
    scenarioId: 'astonish.v2-stale-response',
    evidenceClasses: ['multi-resource-conflict'] as const,
  },
  {
    scenarioId: 'astonish.v2-threshold-pass',
    evidenceClasses: ['hit', 'threshold-pass'] as const,
  },
  {
    scenarioId: 'astonish.v2-unaware-automatic-flinch',
    evidenceClasses: ['alternate-branch', 'choice'] as const,
  },
] as const)

export const FAKE_OUT_V2_SEMANTIC_SCENARIOS = Object.freeze([
  {
    scenarioId: 'fake-out.v2-critical-hit',
    evidenceClasses: ['crit'] as const,
  },
  {
    scenarioId: 'fake-out.v2-duplicate-retry',
    evidenceClasses: ['retry'] as const,
  },
  {
    scenarioId: 'fake-out.v2-immunity',
    evidenceClasses: ['immunity'] as const,
  },
  {
    scenarioId: 'fake-out.v2-joining-hit',
    evidenceClasses: ['hit', 'threshold-pass'] as const,
  },
  {
    scenarioId: 'fake-out.v2-miss',
    evidenceClasses: ['miss'] as const,
  },
  {
    scenarioId: 'fake-out.v2-not-joining-rejected',
    evidenceClasses: ['threshold-fail'] as const,
  },
  {
    scenarioId: 'fake-out.v2-priority-rejected',
    evidenceClasses: ['alternate-branch', 'threshold-fail'] as const,
  },
  {
    scenarioId: 'fake-out.v2-switch-reset',
    evidenceClasses: ['alternate-branch'] as const,
  },
] as const)

export const OPENING_MOVE_ACTOR_ID = 'actor-token'
export const OPENING_MOVE_TARGET_ID = 'target-token'
export const OPENING_MOVE_ACTOR_SLUG = 'opening-actor'
export const OPENING_MOVE_TARGET_SLUG = 'opening-target'

export type OpeningMoveName = 'Astonish' | 'Fake Out' | 'Pound'

const placement = (
  id: string,
  sheetSlug: string,
  x: number,
  sideId: string,
): SheetPlacement => ({
  id,
  sheetKind: 'pokemon',
  sheetSlug,
  sideId,
  position: { x, y: 0, z: 1 },
  initiative: id === OPENING_MOVE_ACTOR_ID ? 20 : 10,
})

const pokemonSheet = (options: {
  readonly slug: string
  readonly species: string
  readonly types: readonly string[]
  readonly currentHp: number
  readonly moves?: readonly { readonly name: string }[]
}): CharacterSheet => ({
  slug: options.slug,
  nickname: options.species,
  species: options.species,
  types: [...options.types],
  level: 20,
  revision: 3,
  movelist: [...(options.moves ?? [])],
  stats: {
    hp: { added: 300 },
    atk: { added: 8, stage: 0 },
    def: { added: 8, stage: 0 },
    satk: { added: 8, stage: 0 },
    sdef: { added: 8, stage: 0 },
    spd: { added: 8, stage: 0 },
  },
  combatStages: { acc: 0 },
  combat: { currentHp: options.currentHp, conditions: [] },
})

const actedSinceEntryResources = () => {
  const ledger = createEncounterTurnResourceLedger({
    placementId: OPENING_MOVE_ACTOR_ID,
    round: 1,
    turn: 0,
  })
  return {
    [OPENING_MOVE_ACTOR_ID]: {
      ...ledger,
      oncePerTurnFlags: [{
        id: ENCOUNTER_ACTED_SINCE_ENTRY_FLAG_ID,
        sourceOperationId: 'operation.opening-action.seed',
        resetOn: ['scene-end', 'recall', 'send-out'] as const,
      }],
    },
  }
}

export interface OpeningMoveV2FixtureOptions {
  readonly moveName?: OpeningMoveName
  readonly actedSinceEntry?: boolean
  readonly actedThisRound?: boolean
  readonly targetTypes?: readonly string[]
  readonly mapRevision?: number
}

export interface OpeningMoveV2Fixture {
  readonly map: TabletopMap
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly trainerSheets: ReadonlyMap<string, TrainerSheet>
  readonly intent: ResolveMoveIntent
}

export const openingMoveV2Fixture = (
  options: OpeningMoveV2FixtureOptions = {},
): OpeningMoveV2Fixture => {
  const moveName = options.moveName ?? 'Astonish'
  const emptyState = createEmptyEncounterState()
  const encounterState = {
    ...emptyState,
    sides: {
      heroes: { id: 'heroes', label: 'Heroes', status: 'active' as const },
      foes: { id: 'foes', label: 'Foes', status: 'active' as const },
    },
    history: {
      ...emptyState.history,
      currentRound: 1,
      currentTurn: {
        round: 1,
        turn: 0,
        placementId: OPENING_MOVE_ACTOR_ID,
      },
      actedThisRoundPlacementIds: options.actedThisRound
        ? [OPENING_MOVE_ACTOR_ID]
        : [],
    },
    turnResources: options.actedSinceEntry ? actedSinceEntryResources() : {},
  }
  const map: TabletopMap = {
    schemaVersion: 2,
    slug: 'opening-moves-arena',
    name: 'Opening Moves Arena',
    revision: options.mapRevision ?? 7,
    dimensions: { x: 6, y: 3, z: 4 },
    groundLevelY: 0,
    playerVisible: true,
    voxels: [],
    hazards: [],
    fieldEffects: { weather: [], terrains: [], rooms: [] },
    placements: [
      placement(OPENING_MOVE_ACTOR_ID, OPENING_MOVE_ACTOR_SLUG, 1, 'heroes'),
      placement(OPENING_MOVE_TARGET_ID, OPENING_MOVE_TARGET_SLUG, 2, 'foes'),
    ],
    lights: [],
    initiative: {
      activeId: OPENING_MOVE_ACTOR_ID,
      round: 1,
      manualOrderIds: [OPENING_MOVE_ACTOR_ID, OPENING_MOVE_TARGET_ID],
    },
    activeScene: { name: 'Opening Move Scene', startedAt: 100 },
    encounterState,
    metadata: {},
    createdAt: 1,
    updatedAt: 100,
  }
  return {
    map,
    pokemonSheets: new Map([
      [OPENING_MOVE_ACTOR_SLUG, pokemonSheet({
        slug: OPENING_MOVE_ACTOR_SLUG,
        species: 'Misdreavus',
        types: ['Dark'],
        currentHp: 500,
        moves: [{ name: 'Astonish' }, { name: 'Fake Out' }, { name: 'Pound' }],
      })],
      [OPENING_MOVE_TARGET_SLUG, pokemonSheet({
        slug: OPENING_MOVE_TARGET_SLUG,
        species: 'Abra',
        types: options.targetTypes ?? (moveName === 'Astonish' ? ['Psychic'] : ['Fire']),
        currentHp: 500,
      })],
    ]),
    trainerSheets: new Map<string, TrainerSheet>(),
    intent: openingMoveIntent(moveName),
  }
}

export const openingMoveIntent = (
  moveName: OpeningMoveName,
): ResolveMoveIntent => ({
  schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
  placementId: OPENING_MOVE_ACTOR_ID,
  moveName,
  selection: {
    kind: 'single-target',
    targetPlacementId: OPENING_MOVE_TARGET_ID,
  },
})
