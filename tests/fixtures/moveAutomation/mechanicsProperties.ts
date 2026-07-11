import {
  LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
  type ResolveMoveIntent,
} from '#shared/livePlayMoveResolution'
import {
  buildAuthoritativeMoveRulesContext,
  type AuthoritativeMoveRulesContext,
} from '~~/server/domain/moveAutomation/context'
import {
  createFiniteAuthoritativeMoveRandomStream,
} from '~~/server/domain/moveAutomation/random'
import type {
  MoveCoreTokenEffectImmunityQueries,
} from '~~/server/domain/moveAutomation/reducers/coreTokenEffectTypes'
import type { CharacterSheet } from '~/types/characterSheet'
import type { CombatStageMap } from '~/types/combatStages'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'

export interface DeterministicPropertyGenerator {
  readonly fraction: () => number
  readonly integer: (minimum: number, maximum: number) => number
  readonly pick: <Value>(values: readonly Value[]) => Value
  readonly shuffle: <Value>(values: readonly Value[]) => Value[]
}

/** Small deterministic generator so property suites need no ambient RNG or dependency. */
export const createDeterministicPropertyGenerator = (
  seed: number,
): DeterministicPropertyGenerator => {
  let state = seed >>> 0
  const next = (): number => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
    return state
  }
  const fraction = (): number => next() / 0x1_0000_0000
  const integer = (minimum: number, maximum: number): number => {
    if (!Number.isSafeInteger(minimum) || !Number.isSafeInteger(maximum) || minimum > maximum) {
      throw new Error(`Invalid generated integer range ${minimum}..${maximum}.`)
    }
    return minimum + (next() % (maximum - minimum + 1))
  }
  const pick = <Value>(values: readonly Value[]): Value => {
    if (values.length === 0) throw new Error('Cannot pick from an empty property domain.')
    return values[integer(0, values.length - 1)]!
  }
  const shuffle = <Value>(values: readonly Value[]): Value[] => {
    const result = [...values]
    for (let index = result.length - 1; index > 0; index -= 1) {
      const swapIndex = integer(0, index)
      const current = result[index]!
      result[index] = result[swapIndex]!
      result[swapIndex] = current
    }
    return result
  }
  return Object.freeze({ fraction, integer, pick, shuffle })
}

export const MECHANICS_PROPERTY_TARGET_IDS = Object.freeze([
  'target-c-token',
  'target-a-token',
  'target-d-token',
  'target-b-token',
] as const)

export const MECHANICS_PROPERTY_PLACEMENT_ORDER = Object.freeze([
  'actor-token',
  ...MECHANICS_PROPERTY_TARGET_IDS,
] as const)

interface MechanicsPropertyContextOptions {
  readonly randomValues?: readonly number[]
  readonly currentHpByPlacementId?: Readonly<Record<string, number>>
  readonly temporaryHpByPlacementId?: Readonly<Record<string, number>>
  readonly stagesByPlacementId?: Readonly<Record<string, Partial<CombatStageMap>>>
  readonly candidatePlacementIds?: readonly string[]
  readonly selectedPlacementIds?: readonly string[]
}

const sheetSlugForPlacement = (placementId: string): string => (
  placementId.replace(/-token$/, '')
)

const placement = (id: string, x: number): SheetPlacement => ({
  id,
  sheetKind: 'pokemon',
  sheetSlug: sheetSlugForPlacement(id),
  position: { x, y: 0, z: 0 },
})

const propertyMap = (
  temporaryHpByPlacementId: Readonly<Record<string, number>>,
): TabletopMap => ({
  schemaVersion: 2,
  slug: 'mechanics-property-arena',
  name: 'Mechanics Property Arena',
  revision: 11,
  dimensions: { x: 8, y: 3, z: 8 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: MECHANICS_PROPERTY_PLACEMENT_ORDER.map((id, index) => placement(id, index)),
  lights: [],
  activeScene: { name: 'Property Scene', startedAt: 1_000 },
  temporaryHitPoints: Object.keys(temporaryHpByPlacementId).length === 0
    ? undefined
    : {
        scene: { name: 'Property Scene', startedAt: 1_000 },
        byPlacementId: { ...temporaryHpByPlacementId },
      },
  initiative: { activeId: 'actor-token', round: 1 },
})

const propertySheet = (
  placementId: string,
  options: MechanicsPropertyContextOptions,
): CharacterSheet => {
  const stages = options.stagesByPlacementId?.[placementId] ?? {}
  const actor = placementId === 'actor-token'
  return {
    slug: sheetSlugForPlacement(placementId),
    nickname: placementId,
    species: actor ? 'Pikachu' : 'Snorlax',
    level: 30,
    revision: 5,
    movelist: actor ? [{ name: 'Tackle' }] : [],
    types: ['Normal'],
    stats: {
      // Keep generated multi-hit runs far from an accidental early KO.
      hp: { added: 500 },
      atk: { added: 10, stage: stages.atk ?? 0 },
      def: { added: 10, stage: stages.def ?? 0 },
      satk: { added: 10, stage: stages.satk ?? 0 },
      sdef: { added: 10, stage: stages.sdef ?? 0 },
      spd: { added: 10, stage: stages.spd ?? 0 },
    },
    combatStages: { acc: stages.acc ?? 0 },
    combat: {
      currentHp: options.currentHpByPlacementId?.[placementId] ?? 10_000,
      conditions: [],
    },
    abilities: [],
  }
}

export const buildMechanicsPropertyContext = (
  options: MechanicsPropertyContextOptions = {},
): AuthoritativeMoveRulesContext => {
  const temporaryHpByPlacementId = options.temporaryHpByPlacementId ?? {}
  const sheets = new Map<string, CharacterSheet>()
  for (const placementId of MECHANICS_PROPERTY_PLACEMENT_ORDER) {
    sheets.set(sheetSlugForPlacement(placementId), propertySheet(placementId, options))
  }
  const intent: ResolveMoveIntent = {
    schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
    placementId: 'actor-token',
    moveName: 'Tackle',
    selection: {
      kind: 'single-target',
      targetPlacementId: MECHANICS_PROPERTY_TARGET_IDS[0],
    },
  }
  return buildAuthoritativeMoveRulesContext({
    map: propertyMap(temporaryHpByPlacementId),
    pokemonSheets: sheets,
    trainerSheets: new Map<string, TrainerSheet>(),
    intent,
    candidatePlacementIds: options.candidatePlacementIds ?? MECHANICS_PROPERTY_TARGET_IDS,
    selectedPlacementIds: options.selectedPlacementIds ?? [MECHANICS_PROPERTY_TARGET_IDS[0]],
    random: createFiniteAuthoritativeMoveRandomStream(options.randomValues ?? []),
    time: 10_000,
  })
}

const notPrevented = Object.freeze({
  blockedBy: null,
  consultedPlacementIds: Object.freeze([]),
})

/** Mechanics-only reducer seam with no type, condition, or stage prevention. */
export const NEVER_PREVENT_CORE_TOKEN_EFFECTS: MoveCoreTokenEffectImmunityQueries = Object.freeze({
  directHp: () => notPrevented,
  condition: () => notPrevented,
  combatStage: () => notPrevented,
})
