import {
  LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
  type ResolveMoveIntent,
} from '#shared/livePlayMoveResolution'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'

export const U_TURN_ACTOR_PLACEMENT_ID = 'u-turn-actor'
export const U_TURN_TARGET_PLACEMENT_ID = 'u-turn-target'
export const U_TURN_TRAINER_PLACEMENT_ID = 'u-turn-trainer'
export const U_TURN_REPLACEMENT_SLUG = 'u-turn-replacement'

export const U_TURN_V2_SEMANTIC_SCENARIOS = Object.freeze([
  { scenarioId: 'u-turn.v2-critical-hit', evidenceClasses: ['crit'] as const },
  { scenarioId: 'u-turn.v2-duplicate-retry', evidenceClasses: ['retry'] as const },
  { scenarioId: 'u-turn.v2-hit-switch', evidenceClasses: ['choice', 'hit', 'self', 'threshold-pass'] as const },
  { scenarioId: 'u-turn.v2-miss', evidenceClasses: ['miss'] as const },
  { scenarioId: 'u-turn.v2-no-replacement-recall', evidenceClasses: ['alternate-branch', 'pass'] as const },
  { scenarioId: 'u-turn.v2-pass-recall', evidenceClasses: ['alternate-branch', 'pass'] as const },
  { scenarioId: 'u-turn.v2-reconnect', evidenceClasses: ['reconnect'] as const },
  { scenarioId: 'u-turn.v2-stale-roster', evidenceClasses: ['multi-resource-conflict'] as const },
  { scenarioId: 'u-turn.v2-stuck-rejected', evidenceClasses: ['alternate-branch', 'threshold-fail'] as const },
  { scenarioId: 'u-turn.v2-trapped-recall', evidenceClasses: ['alternate-branch'] as const },
] as const)

const placement = (input: {
  readonly id: string
  readonly sheetKind: 'pokemon' | 'trainer'
  readonly sheetSlug: string
  readonly x: number
  readonly sideId: string
  readonly initiative: number
}): SheetPlacement => ({
  id: input.id,
  sheetKind: input.sheetKind,
  sheetSlug: input.sheetSlug,
  position: { x: input.x, y: 0, z: 1 },
  sideId: input.sideId,
  initiative: input.initiative,
  facing: 'south-east',
})

const pokemonSheet = (input: {
  readonly slug: string
  readonly species: string
  readonly currentHp?: number
  readonly conditions?: readonly string[]
  readonly actor?: boolean
  readonly revision?: number
}): CharacterSheet => ({
  slug: input.slug,
  nickname: input.species,
  species: input.species,
  level: 20,
  revision: input.revision ?? 3,
  types: input.actor ? ['Normal'] : ['Normal'],
  movelist: input.actor ? [{ name: 'U-Turn' }] : [],
  capabilities: { overland: 6 },
  stats: {
    hp: { added: 20 },
    atk: { added: input.actor ? 8 : 3, stage: 0 },
    def: { added: 3, stage: 0 },
    satk: { added: 3, stage: 0 },
    sdef: { added: 3, stage: 0 },
    spd: { added: 5, stage: 0 },
  },
  combatStages: { acc: 0 },
  combat: {
    currentHp: input.currentHp ?? 100,
    injuries: 0,
    conditions: [...(input.conditions ?? [])],
  },
})

export interface UTurnV2FixtureOptions {
  readonly actorConditions?: readonly string[]
  readonly trainerTeam?: readonly string[]
  readonly trainerRevision?: number
  readonly replacementRevision?: number
  readonly mapRevision?: number
}

export interface UTurnV2Fixture {
  readonly map: TabletopMap
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly trainerSheets: ReadonlyMap<string, TrainerSheet>
  readonly intent: ResolveMoveIntent
}

export const uTurnV2Fixture = (
  options: UTurnV2FixtureOptions = {},
): UTurnV2Fixture => {
  const encounterState = createEmptyEncounterState()
  const mapRevision = options.mapRevision ?? 0
  return {
    map: {
      schemaVersion: 2,
      slug: 'u-turn-arena',
      name: 'U-Turn Arena',
      revision: mapRevision,
      dimensions: { x: 8, y: 3, z: 6 },
      groundLevelY: 0,
      playerVisible: true,
      voxels: [],
      hazards: [],
      fieldEffects: { weather: [], terrains: [], rooms: [] },
      placements: [
        placement({
          id: U_TURN_TRAINER_PLACEMENT_ID,
          sheetKind: 'trainer',
          sheetSlug: 'u-turn-owner',
          x: 0,
          sideId: 'heroes',
          initiative: 12,
        }),
        placement({
          id: U_TURN_ACTOR_PLACEMENT_ID,
          sheetKind: 'pokemon',
          sheetSlug: 'u-turn-actor-sheet',
          x: 2,
          sideId: 'heroes',
          initiative: 18,
        }),
        placement({
          id: U_TURN_TARGET_PLACEMENT_ID,
          sheetKind: 'pokemon',
          sheetSlug: 'u-turn-target-sheet',
          x: 3,
          sideId: 'foes',
          initiative: 10,
        }),
      ],
      lights: [],
      initiative: {
        activeId: U_TURN_ACTOR_PLACEMENT_ID,
        round: 2,
        manualOrderIds: [
          U_TURN_ACTOR_PLACEMENT_ID,
          U_TURN_TRAINER_PLACEMENT_ID,
          U_TURN_TARGET_PLACEMENT_ID,
        ],
      },
      activeScene: { name: 'U-Turn Scene', startedAt: 100 },
      temporaryHitPoints: {
        scene: { name: 'U-Turn Scene', startedAt: 100 },
        byPlacementId: { [U_TURN_ACTOR_PLACEMENT_ID]: 5 },
      },
      encounterState: {
        ...encounterState,
        sides: {
          heroes: { id: 'heroes', label: 'Heroes', status: 'active' },
          foes: { id: 'foes', label: 'Foes', status: 'active' },
        },
      },
      metadata: { note: 'preserved' },
      createdAt: 1,
      updatedAt: 100,
    },
    pokemonSheets: new Map([
      ['u-turn-actor-sheet', pokemonSheet({
        slug: 'u-turn-actor-sheet',
        species: 'Eevee',
        conditions: options.actorConditions,
        actor: true,
      })],
      ['u-turn-target-sheet', pokemonSheet({
        slug: 'u-turn-target-sheet',
        species: 'Snorlax',
      })],
      [U_TURN_REPLACEMENT_SLUG, pokemonSheet({
        slug: U_TURN_REPLACEMENT_SLUG,
        species: 'Pikachu',
        revision: options.replacementRevision,
      })],
    ]),
    trainerSheets: new Map([[
      'u-turn-owner',
      {
        slug: 'u-turn-owner',
        name: 'U-Turn Owner',
        level: 10,
        revision: options.trainerRevision ?? 3,
        currentTeam: [...(options.trainerTeam ?? [
          'u-turn-actor-sheet',
          U_TURN_REPLACEMENT_SLUG,
        ])],
      },
    ]]),
    intent: {
      schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
      placementId: U_TURN_ACTOR_PLACEMENT_ID,
      moveName: 'U-Turn',
      selection: {
        kind: 'single-target',
        targetPlacementId: U_TURN_TARGET_PLACEMENT_ID,
      },
    },
  }
}
