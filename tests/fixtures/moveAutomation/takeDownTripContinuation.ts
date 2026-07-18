import {
  LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
  type ResolveMoveIntent,
} from '#shared/livePlayMoveResolution'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { buildTakeDownTripContinuationOperations } from '~~/server/domain/moveAutomation/takeDownTripContinuation'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'

export const TAKE_DOWN_TRIP_FIXTURE_VERSION = 1742 as const

/**
 * Test-only continuation program. Its attacked target is supplied by the
 * fixture as an already-authoritative qualifying Take Down hit; the catalog
 * runtime remains legacy until MA-174C wires the fragment after real damage.
 */
export const TAKE_DOWN_TRIP_CONTINUATION_FIXTURE_SPEC = Object.freeze({
  schemaVersion: 2,
  canonicalId: 'Take Down',
  version: TAKE_DOWN_TRIP_FIXTURE_VERSION,
  targeting: {
    kind: 'single-target',
    minTargets: 1,
    maxTargets: 1,
    selector: { kind: 'selected-targets' },
  },
  preconditions: [],
  costs: [{
    id: 'take-down.trip-fixture.no-cost',
    phase: 'pay',
    cost: {
      kind: 'no-cost',
      reasonCode: 'take-down.trip-fixture.already-established-hit',
    },
  }],
  phases: [
    {
      phase: 'after-damage',
      operations: buildTakeDownTripContinuationOperations('attacked-targets'),
    },
    {
      phase: 'usage',
      operations: [{
        id: 'take-down.trip-fixture.usage',
        kind: 'usage',
        source: { kind: 'move', id: 'move.take-down' },
        recipients: { kind: 'actor' },
        phase: 'usage',
        reasonCode: 'take-down.trip-fixture.frequency-use',
        payload: {
          action: 'spend',
          resourceId: 'take-down.frequency-use',
          amount: 1,
        },
      }],
    },
  ],
  registeredHandlerId: null,
  presentation: {
    displayName: 'Take Down Trip Fixture',
    vfxKey: null,
    tags: ['test-only', 'trip-continuation'],
  },
} as const)

const placement = (id: string, sheetSlug: string, x: number): SheetPlacement => ({
  id,
  sheetKind: 'pokemon',
  sheetSlug,
  position: { x, y: 0, z: 1 },
  initiative: id === 'actor-token' ? 20 : 10,
})

const pokemonSheet = (options: {
  readonly slug: 'actor' | 'target'
  readonly combatSkill?: string
  readonly acrobaticsSkill?: string
  readonly revision?: number
}): CharacterSheet => ({
  slug: options.slug,
  nickname: options.slug === 'actor' ? 'Ram' : 'Wall',
  species: options.slug === 'actor' ? 'Rhyhorn' : 'Snorlax',
  level: 20,
  revision: options.revision ?? 3,
  types: ['Normal'],
  abilities: [],
  movelist: options.slug === 'actor' ? [{ name: 'Take Down' }] : [],
  skills: {
    combat: options.combatSkill ?? '1d6',
    acrobatics: options.acrobaticsSkill ?? '1d6',
  },
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
  combat: {
    currentHp: 100,
    injuries: 0,
    conditions: [],
  },
})

export interface TakeDownTripContinuationFixtureOptions {
  readonly mapRevision?: number
  readonly actorCombatSkill?: string
  readonly actorAcrobaticsSkill?: string
  readonly targetCombatSkill?: string
  readonly targetAcrobaticsSkill?: string
  readonly actorSheetRevision?: number
  readonly targetSheetRevision?: number
}

export interface TakeDownTripContinuationFixture {
  readonly map: TabletopMap
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly trainerSheets: ReadonlyMap<string, TrainerSheet>
  readonly intent: ResolveMoveIntent
}

export const takeDownTripContinuationFixture = (
  options: TakeDownTripContinuationFixtureOptions = {},
): TakeDownTripContinuationFixture => ({
  map: {
    schemaVersion: 2,
    slug: 'take-down-trip-arena',
    name: 'Take Down Trip Arena',
    revision: options.mapRevision ?? 0,
    dimensions: { x: 8, y: 3, z: 5 },
    groundLevelY: 0,
    playerVisible: true,
    voxels: [],
    hazards: [],
    fieldEffects: { weather: [], terrains: [], rooms: [] },
    encounterState: createEmptyEncounterState(),
    placements: [
      placement('actor-token', 'actor', 1),
      placement('target-token', 'target', 2),
    ],
    lights: [],
    initiative: { activeId: 'actor-token', round: 1 },
    activeScene: { name: 'Take Down Trip Scene', startedAt: 100 },
    createdAt: 1,
    updatedAt: 100,
  },
  pokemonSheets: new Map([
    ['actor', pokemonSheet({
      slug: 'actor',
      combatSkill: options.actorCombatSkill,
      acrobaticsSkill: options.actorAcrobaticsSkill,
      revision: options.actorSheetRevision,
    })],
    ['target', pokemonSheet({
      slug: 'target',
      combatSkill: options.targetCombatSkill,
      acrobaticsSkill: options.targetAcrobaticsSkill,
      revision: options.targetSheetRevision,
    })],
  ]),
  trainerSheets: new Map<string, TrainerSheet>(),
  intent: {
    schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
    placementId: 'actor-token',
    moveName: 'Take Down',
    selection: { kind: 'single-target', targetPlacementId: 'target-token' },
  },
})
