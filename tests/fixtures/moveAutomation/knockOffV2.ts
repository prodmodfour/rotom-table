import {
  LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
  type ResolveMoveIntent,
} from '#shared/livePlayMoveResolution'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'

export const KNOCK_OFF_ACTOR_PLACEMENT_ID = 'knock-off-actor'
export const KNOCK_OFF_TARGET_PLACEMENT_ID = 'knock-off-target'

export interface KnockOffV2FixtureOptions {
  readonly heldItems?: string | null
  readonly mapRevision?: number
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
      placement(KNOCK_OFF_TARGET_PLACEMENT_ID, 'knock-off-target-sheet', 2),
    ],
    lights: [],
    initiative: { activeId: KNOCK_OFF_ACTOR_PLACEMENT_ID, round: 1 },
    activeScene: { name: 'Knock Off Scene', startedAt: 100 },
    encounterState,
    createdAt: 1,
    updatedAt: 100,
  }
  return {
    map,
    pokemonSheets: new Map([
      ['knock-off-actor-sheet', pokemonSheet({
        slug: 'knock-off-actor-sheet',
        species: 'Machop',
        moves: [{ name: 'Knock Off' }],
      })],
      ['knock-off-target-sheet', pokemonSheet({
        slug: 'knock-off-target-sheet',
        species: 'Eevee',
        heldItems: options.heldItems === undefined
          ? 'Leftovers, Bright Powder'
          : options.heldItems,
      })],
    ]),
    trainerSheets: new Map<string, TrainerSheet>(),
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
