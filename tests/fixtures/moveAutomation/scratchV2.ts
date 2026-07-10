import {
  LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
  type ResolveMoveIntent,
} from '#shared/livePlayMoveResolution'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'

export const SCRATCH_V2_PASS_HIT_SCENARIO = Object.freeze({
  scenarioId: 'scratch.v2-pass-hit',
  evidenceClasses: ['hit', 'pass', 'retry'] as const,
})

const placement = (
  id: string,
  sheetSlug: string,
  x: number,
): SheetPlacement => ({
  id,
  sheetKind: 'pokemon',
  sheetSlug,
  position: { x, y: 0, z: 1 },
})

const pokemonSheet = (
  slug: string,
  options: {
    readonly species: string
    readonly currentHp: number
    readonly moves?: readonly { readonly name: string }[]
  },
): CharacterSheet => ({
  slug,
  nickname: options.species,
  species: options.species,
  level: 20,
  revision: 3,
  movelist: [...(options.moves ?? [])],
  combat: { currentHp: options.currentHp },
})

export interface ScratchV2ScenarioFixture {
  readonly map: TabletopMap
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly trainerSheets: ReadonlyMap<string, TrainerSheet>
  readonly intent: ResolveMoveIntent
  readonly randomValues: readonly number[]
}

/** One-target Pass fixture shared by v1/v2 shadow planning and native command tests. */
export const scratchV2PassHitFixture = (): ScratchV2ScenarioFixture => ({
  map: {
    schemaVersion: 2,
    slug: 'scratch-v2-arena',
    name: 'Scratch v2 Arena',
    revision: 7,
    dimensions: { x: 8, y: 3, z: 4 },
    groundLevelY: 0,
    playerVisible: true,
    voxels: [],
    hazards: [],
    fieldEffects: { weather: [], terrains: [], rooms: [] },
    placements: [
      placement('actor-token', 'actor', 1),
      placement('target-token', 'target', 2),
      placement('occupied-end', 'blocker', 5),
    ],
    lights: [],
    initiative: { activeId: 'actor-token', round: 1 },
    activeScene: { name: 'Scratch Scene', startedAt: 100 },
    metadata: { note: 'preserved' },
    createdAt: 1,
    updatedAt: 100,
  },
  pokemonSheets: new Map([
    ['actor', pokemonSheet('actor', {
      species: 'Pikachu',
      currentHp: 50,
      moves: [{ name: 'Scratch' }],
    })],
    ['target', pokemonSheet('target', { species: 'Snorlax', currentHp: 100 })],
    ['blocker', pokemonSheet('blocker', { species: 'Geodude', currentHp: 50 })],
  ]),
  trainerSheets: new Map<string, TrainerSheet>(),
  intent: {
    schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
    placementId: 'actor-token',
    moveName: 'Scratch',
    selection: {
      kind: 'area',
      areaTemplateId: 'pass:any:4',
      direction: 'east',
    },
  },
  randomValues: [0.5, 0],
})
