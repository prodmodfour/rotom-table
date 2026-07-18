import {
  LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
  type ResolveMoveIntent,
} from '#shared/livePlayMoveResolution'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'

export const TAKE_DOWN_V2_SEMANTIC_SCENARIOS = Object.freeze([
  { scenarioId: 'take-down.v2-action-cost-rejected', evidenceClasses: ['alternate-branch'] as const },
  { scenarioId: 'take-down.v2-check-failure', evidenceClasses: ['choice', 'threshold-fail'] as const },
  { scenarioId: 'take-down.v2-check-success', evidenceClasses: ['choice', 'hit', 'threshold-pass'] as const },
  { scenarioId: 'take-down.v2-check-tie', evidenceClasses: ['alternate-branch', 'threshold-fail'] as const },
  { scenarioId: 'take-down.v2-critical-hit', evidenceClasses: ['crit'] as const },
  { scenarioId: 'take-down.v2-duplicate-retry', evidenceClasses: ['retry'] as const },
  { scenarioId: 'take-down.v2-immunity', evidenceClasses: ['immunity'] as const },
  { scenarioId: 'take-down.v2-legal-skill-choices', evidenceClasses: ['choice'] as const },
  { scenarioId: 'take-down.v2-magic-guard-recoil-immunity', evidenceClasses: ['immunity', 'self'] as const },
  { scenarioId: 'take-down.v2-miss', evidenceClasses: ['miss'] as const },
  { scenarioId: 'take-down.v2-pass', evidenceClasses: ['hit', 'pass'] as const },
  { scenarioId: 'take-down.v2-reckless', evidenceClasses: ['alternate-branch'] as const },
  { scenarioId: 'take-down.v2-reconnect', evidenceClasses: ['reconnect'] as const },
  { scenarioId: 'take-down.v2-rock-head-recoil-immunity', evidenceClasses: ['immunity', 'self'] as const },
  { scenarioId: 'take-down.v2-stale-response', evidenceClasses: ['multi-resource-conflict'] as const },
  { scenarioId: 'take-down.v2-stuck-rejected', evidenceClasses: ['alternate-branch'] as const },
] as const)

export type TakeDownV2SemanticScenarioId =
  (typeof TAKE_DOWN_V2_SEMANTIC_SCENARIOS)[number]['scenarioId']

const placement = (id: string, sheetSlug: string, x: number): SheetPlacement => ({
  id,
  sheetKind: 'pokemon',
  sheetSlug,
  position: { x, y: 0, z: 1 },
  initiative: id === 'actor-token' ? 20 : 10,
})

const pokemonSheet = (options: {
  readonly slug: 'actor' | 'target'
  readonly types: readonly string[]
  readonly abilities?: readonly { readonly name: string }[]
  readonly conditions?: readonly string[]
}): CharacterSheet => ({
  slug: options.slug,
  nickname: options.slug === 'actor' ? 'Ram' : 'Wall',
  species: options.slug === 'actor' ? 'Rhyhorn' : 'Snorlax',
  level: 20,
  revision: 3,
  types: [...options.types],
  abilities: [...(options.abilities ?? [])],
  movelist: options.slug === 'actor' ? [{ name: 'Take Down' }] : [],
  skills: {
    combat: '1d6',
    acrobatics: '1d6',
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
    conditions: [...(options.conditions ?? [])],
  },
})

export interface TakeDownV2FixtureOptions {
  readonly actorAbilities?: readonly { readonly name: string }[]
  readonly actorConditions?: readonly string[]
  readonly targetTypes?: readonly string[]
  readonly encounterStandardSpent?: number
  readonly mapRevision?: number
}

export interface TakeDownV2Fixture {
  readonly map: TabletopMap
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly trainerSheets: ReadonlyMap<string, TrainerSheet>
  readonly intent: ResolveMoveIntent
}

export const takeDownV2Fixture = (
  options: TakeDownV2FixtureOptions = {},
): TakeDownV2Fixture => {
  const encounterState = createEmptyEncounterState()
  const standardSpent = options.encounterStandardSpent ?? 0
  const mapRevision = options.mapRevision ?? 0
  return {
    map: {
      schemaVersion: 2,
      slug: 'take-down-arena',
      name: 'Take Down Arena',
      revision: mapRevision,
      dimensions: { x: 8, y: 3, z: 5 },
      groundLevelY: 0,
      playerVisible: true,
      voxels: [],
      hazards: [],
      fieldEffects: { weather: [], terrains: [], rooms: [] },
      encounterState: standardSpent > 0
        ? {
            ...encounterState,
            turnResources: {
              'actor-token': {
                placementId: 'actor-token',
                round: 1,
                turn: null,
                actions: {
                  standard: { type: 'standard', budget: 1, spent: standardSpent, resetOn: ['turn-start'] },
                  shift: { type: 'shift', budget: 1, spent: 0, resetOn: ['turn-start'] },
                  swift: { type: 'swift', budget: 1, spent: 0, resetOn: ['round-start'] },
                  free: { type: 'free', budget: null, spent: 0, resetOn: ['turn-start'] },
                  full: { type: 'full', budget: 1, spent: 0, resetOn: ['turn-start'] },
                  interrupt: { type: 'interrupt', budget: 1, spent: 0, resetOn: ['round-start'] },
                  reaction: { type: 'reaction', budget: 1, spent: 0, resetOn: ['round-start'] },
                },
                reaction: { available: true, resetOn: ['round-start'] },
                movement: { budget: null, spent: 0, resetOn: ['turn-start'] },
                oncePerTurnFlags: [],
                setupExecute: null,
              },
            },
          }
        : encounterState,
      placements: [
        placement('actor-token', 'actor', 1),
        placement('target-token', 'target', 2),
      ],
      lights: [],
      initiative: { activeId: 'actor-token', round: 1 },
      activeScene: { name: 'Take Down Scene', startedAt: 100 },
      metadata: { note: 'preserved' },
      createdAt: 1,
      updatedAt: 100,
    },
    pokemonSheets: new Map([
      ['actor', pokemonSheet({
        slug: 'actor',
        types: ['Rock'],
        abilities: options.actorAbilities,
        conditions: options.actorConditions,
      })],
      ['target', pokemonSheet({
        slug: 'target',
        types: options.targetTypes ?? ['Normal'],
      })],
    ]),
    trainerSheets: new Map<string, TrainerSheet>(),
    intent: {
      schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
      placementId: 'actor-token',
      moveName: 'Take Down',
      selection: { kind: 'single-target', targetPlacementId: 'target-token' },
    },
  }
}
