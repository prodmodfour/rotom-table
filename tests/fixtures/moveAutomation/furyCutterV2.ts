import {
  LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
  type ResolveMoveIntent,
} from '#shared/livePlayMoveResolution'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'

export const FURY_CUTTER_V2_SEMANTIC_SCENARIOS = Object.freeze([
  {
    scenarioId: 'fury-cutter.v2-first-hit',
    evidenceClasses: ['hit', 'threshold-pass'] as const,
  },
  {
    scenarioId: 'fury-cutter.v2-second-hit',
    evidenceClasses: ['alternate-branch'] as const,
  },
  {
    scenarioId: 'fury-cutter.v2-capped-hit',
    evidenceClasses: ['alternate-branch'] as const,
  },
  {
    scenarioId: 'fury-cutter.v2-target-change',
    evidenceClasses: ['alternate-branch'] as const,
  },
  {
    scenarioId: 'fury-cutter.v2-miss-reset',
    evidenceClasses: ['miss', 'threshold-fail'] as const,
  },
  {
    scenarioId: 'fury-cutter.v2-no-damage-reset',
    evidenceClasses: ['alternate-branch', 'threshold-fail'] as const,
  },
  {
    scenarioId: 'fury-cutter.v2-different-move-reset',
    evidenceClasses: ['alternate-branch'] as const,
  },
  {
    scenarioId: 'fury-cutter.v2-switch-reset',
    evidenceClasses: ['alternate-branch'] as const,
  },
  {
    scenarioId: 'fury-cutter.v2-scene-reset',
    evidenceClasses: ['alternate-branch'] as const,
  },
  {
    scenarioId: 'fury-cutter.v2-critical-hit',
    evidenceClasses: ['crit'] as const,
  },
  {
    scenarioId: 'fury-cutter.v2-duplicate-retry',
    evidenceClasses: ['retry'] as const,
  },
] as const)

export type FuryCutterV2SemanticScenarioId =
  (typeof FURY_CUTTER_V2_SEMANTIC_SCENARIOS)[number]['scenarioId']

export const FURY_CUTTER_ACTOR_ID = 'fury-cutter-actor'
export const FURY_CUTTER_TARGET_ID = 'fury-cutter-target'
export const FURY_CUTTER_OTHER_TARGET_ID = 'fury-cutter-other-target'

const placement = (
  id: string,
  sheetSlug: string,
  x: number,
  z = 1,
): SheetPlacement => ({
  id,
  sheetKind: 'pokemon',
  sheetSlug,
  position: { x, y: 0, z },
  initiative: id === FURY_CUTTER_ACTOR_ID ? 20 : id === FURY_CUTTER_TARGET_ID ? 15 : 10,
})

const actorSheet = (): CharacterSheet => ({
  slug: 'fury-cutter-actor-sheet',
  nickname: 'Cutter',
  species: 'Scizor',
  // Keep STAB out of the fixture so each traced contextual DB is exactly
  // canonical 4/8/12/16; STAB ordering is covered by the shared DB kernel.
  types: ['Steel'],
  level: 20,
  revision: 3,
  movelist: [{ name: 'Fury Cutter' }, { name: 'Pound' }],
  stats: {
    hp: { added: 500 },
    atk: { added: 10, stage: 0 },
    def: { added: 10, stage: 0 },
    satk: { added: 10, stage: 0 },
    sdef: { added: 10, stage: 0 },
    spd: { added: 10, stage: 0 },
  },
  combatStages: { acc: 0 },
  combat: { currentHp: 1_000, conditions: [] },
})

const targetSheet = (slug: string, currentHp: number): CharacterSheet => ({
  slug,
  nickname: slug,
  species: 'Snorlax',
  types: ['Normal'],
  level: 20,
  revision: 3,
  movelist: [],
  stats: {
    hp: { added: 2_500 },
    atk: { added: 10, stage: 0 },
    def: { added: 10, stage: 0 },
    satk: { added: 10, stage: 0 },
    sdef: { added: 10, stage: 0 },
    spd: { added: 10, stage: 0 },
  },
  combatStages: { acc: 0 },
  combat: { currentHp, conditions: [] },
})

export interface FuryCutterV2Fixture {
  readonly map: TabletopMap
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly trainerSheets: ReadonlyMap<string, TrainerSheet>
}

export const furyCutterV2Fixture = (options: {
  readonly chainCount?: number
  readonly chainTargetPlacementId?: string
  readonly targetCurrentHp?: number
  readonly otherTargetCurrentHp?: number
  readonly revision?: number
} = {}): FuryCutterV2Fixture => {
  const chainCount = options.chainCount ?? 0
  const encounterState = createEmptyEncounterState()
  const map: TabletopMap = {
    schemaVersion: 2,
    slug: 'fury-cutter-v2-arena',
    name: 'Fury Cutter v2 Arena',
    revision: options.revision ?? 7,
    dimensions: { x: 8, y: 3, z: 5 },
    groundLevelY: 0,
    playerVisible: true,
    voxels: [],
    hazards: [],
    fieldEffects: { weather: [], terrains: [], rooms: [] },
    encounterState: {
      ...encounterState,
      history: {
        ...encounterState.history,
        consecutiveMoves: chainCount === 0
          ? []
          : [{
              placementId: FURY_CUTTER_ACTOR_ID,
              canonicalId: 'Fury Cutter',
              targetPlacementId: options.chainTargetPlacementId ?? FURY_CUTTER_TARGET_ID,
              count: chainCount,
              lastResolutionId: `resolution.fury.seed.${chainCount}`,
            }],
      },
    },
    placements: [
      placement(FURY_CUTTER_ACTOR_ID, 'fury-cutter-actor-sheet', 1),
      placement(FURY_CUTTER_TARGET_ID, 'fury-cutter-target-sheet', 2),
      placement(FURY_CUTTER_OTHER_TARGET_ID, 'fury-cutter-other-target-sheet', 1, 2),
    ],
    lights: [],
    initiative: {
      activeId: FURY_CUTTER_ACTOR_ID,
      round: 2,
      manualOrderIds: [
        FURY_CUTTER_ACTOR_ID,
        FURY_CUTTER_TARGET_ID,
        FURY_CUTTER_OTHER_TARGET_ID,
      ],
    },
    activeScene: { name: 'Fury Cutter Scene', startedAt: 100 },
    metadata: { note: 'preserved' },
    createdAt: 1,
    updatedAt: 100,
  }
  return {
    map,
    pokemonSheets: new Map([
      ['fury-cutter-actor-sheet', actorSheet()],
      ['fury-cutter-target-sheet', targetSheet(
        'fury-cutter-target-sheet',
        options.targetCurrentHp ?? 5_000,
      )],
      ['fury-cutter-other-target-sheet', targetSheet(
        'fury-cutter-other-target-sheet',
        options.otherTargetCurrentHp ?? 5_000,
      )],
    ]),
    trainerSheets: new Map<string, TrainerSheet>(),
  }
}

export const furyCutterIntent = (
  moveName = 'Fury Cutter',
  targetPlacementId = FURY_CUTTER_TARGET_ID,
): ResolveMoveIntent => ({
  schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
  placementId: FURY_CUTTER_ACTOR_ID,
  moveName,
  selection: { kind: 'single-target', targetPlacementId },
})
