import {
  MOVE_COMBAT_STAGE_TOTAL_DIRECTIONS,
  MOVE_EXPRESSION_STATS,
  MOVE_STAT_COMBAT_STAGE_POLICIES,
  MOVE_STAT_STAGE_MODIFIER_POLICIES,
  type MoveCombatStageStat,
  type MoveCombatStageTotalDirection,
  type MoveExpressionStat,
  type MoveStageAffectedExpressionStat,
  type MoveStatCombatStagePolicy,
  type MoveStatStageModifierPolicy,
} from '#shared/moveAutomation/expressions'
import type { SheetPlacement } from '~/types/map'
import type { SpawnedPokemon } from '~/types/pokemon'
import { applyCombatStageToStat } from '~/utils/combatStageStats'
import {
  COMBAT_STAGE_KEYS,
  clampCombatStage,
  normalizeCombatStages,
} from '~/utils/combatStages'
import { conditionAdjustedCombatStages } from '~/utils/sheetConditionEffects'
import { aa066EffectiveCombatStages } from '../abilityAutomation/mechanics/aa066StageIntegration'

export const MOVE_AUTOMATION_STAT_LABELS = Object.freeze({
  attack: 'Attack',
  'special-attack': 'Special Attack',
  defense: 'Defense',
  'special-defense': 'Special Defense',
  speed: 'Speed',
  level: 'Level',
  'current-hp': 'Current HP',
  'maximum-hp': 'Maximum HP',
} satisfies Record<MoveExpressionStat, string>)

export const MOVE_AUTOMATION_STAT_SHORT_LABELS = Object.freeze({
  attack: 'Atk',
  'special-attack': 'Sp.Atk',
  defense: 'Def',
  'special-defense': 'Sp.Def',
  speed: 'Speed',
  level: 'Level',
  'current-hp': 'Current HP',
  'maximum-hp': 'Maximum HP',
} satisfies Record<MoveExpressionStat, string>)

export interface MoveAutomationStatQuery {
  readonly stat: MoveExpressionStat
  /** Legacy stat expressions omit this and read the unstaged authoritative value. */
  readonly combatStagePolicy?: MoveStatCombatStagePolicy
  /** Legacy stat expressions omit this and ignore condition/ability stage modifiers. */
  readonly stageModifierPolicy?: MoveStatStageModifierPolicy
}

export interface MoveAutomationCombatStageQuery {
  readonly stage: MoveCombatStageStat
  readonly stageModifierPolicy?: MoveStatStageModifierPolicy
}

export interface MoveAutomationCombatStageTotalQuery {
  readonly direction: MoveCombatStageTotalDirection
  readonly stageModifierPolicy: MoveStatStageModifierPolicy
}

export interface MoveAutomationCombatStageResolution {
  readonly stage: MoveCombatStageStat
  readonly authoredStage: number
  readonly stageModifier: number
  readonly modifiedStage: number
  readonly stageModifierPolicy: MoveStatStageModifierPolicy
  readonly value: number
}

export interface MoveAutomationStatOverlay {
  /** Authoritative stat that supplies the requested value while the overlay is active. */
  readonly sourceStat: MoveExpressionStat
  readonly sourceId: string
  readonly reasonCode: string
}

export interface MoveAutomationStatResolution {
  readonly placementId: string
  /** Stat requested by reviewed mechanics. */
  readonly stat: MoveExpressionStat
  /** Stat that supplied the value after non-destructive encounter overlays. */
  readonly sourceStat: MoveExpressionStat
  readonly overlay: MoveAutomationStatOverlay | null
  readonly label: string
  readonly shortLabel: string
  /** Resolved sheet stat before encounter Combat Stages. */
  readonly baseValue: number
  readonly combatStagePolicy: MoveStatCombatStagePolicy
  readonly stageModifierPolicy: MoveStatStageModifierPolicy
  readonly authoredStage: number | null
  readonly stageModifier: number
  readonly modifiedStage: number | null
  readonly appliedStage: number | null
  readonly value: number
}

export interface MoveAutomationCombatStageTotalResolution {
  readonly placementId: string
  readonly direction: MoveCombatStageTotalDirection
  readonly stageModifierPolicy: MoveStatStageModifierPolicy
  /** Negative stages contribute their absolute magnitude, so totals are non-negative. */
  readonly value: number
  readonly stages: readonly MoveAutomationCombatStageResolution[]
}

export interface MoveAutomationStatResolver {
  resolve(
    placementId: string,
    query: MoveAutomationStatQuery,
  ): MoveAutomationStatResolution | null
  combatStage(
    placementId: string,
    query: MoveAutomationCombatStageQuery,
  ): MoveAutomationCombatStageResolution | null
  combatStageTotal(
    placementId: string,
    query: MoveAutomationCombatStageTotalQuery,
  ): MoveAutomationCombatStageTotalResolution | null
}

export interface CreateMoveAutomationStatResolverInput {
  readonly placements: readonly SheetPlacement[]
  readonly tokens: readonly SpawnedPokemon[]
  /** Server-owned non-destructive field/effect overlay seam. */
  readonly resolveStatOverlay?: (
    placement: Pick<SheetPlacement, 'sheetKind'>,
    stat: MoveExpressionStat,
  ) => MoveAutomationStatOverlay | null
  /** Effective-ability seam; production contexts exclude suppressed or stale runtimes. */
  readonly hasEffectiveAbility?: (placementId: string, canonicalId: string) => boolean
  /** Authoritative context read-set seam. Standalone pure queries may omit it. */
  readonly recordSheetRead?: (
    placement: Pick<SheetPlacement, 'sheetKind' | 'sheetSlug'>,
  ) => void
}

export type MoveAutomationStatQueryErrorCode =
  | 'duplicate-placement-id'
  | 'duplicate-token-id'

export class MoveAutomationStatQueryError extends Error {
  readonly code: MoveAutomationStatQueryErrorCode

  constructor(code: MoveAutomationStatQueryErrorCode, message: string) {
    super(message)
    this.name = 'MoveAutomationStatQueryError'
    this.code = code
  }
}

const STAGE_KEY_BY_STAT: Readonly<Partial<Record<MoveExpressionStat, MoveCombatStageStat>>> = Object.freeze({
  attack: 'atk',
  'special-attack': 'satk',
  defense: 'def',
  'special-defense': 'sdef',
  speed: 'spd',
})
const EXPRESSION_STAT_SET = new Set<string>(MOVE_EXPRESSION_STATS)
const COMBAT_STAGE_SET = new Set<string>(COMBAT_STAGE_KEYS)
const COMBAT_STAGE_POLICY_SET = new Set<string>(MOVE_STAT_COMBAT_STAGE_POLICIES)
const STAGE_MODIFIER_POLICY_SET = new Set<string>(MOVE_STAT_STAGE_MODIFIER_POLICIES)
const STAGE_TOTAL_DIRECTION_SET = new Set<string>(MOVE_COMBAT_STAGE_TOTAL_DIRECTIONS)

interface MoveAutomationStatTokenSnapshot {
  readonly id: string
  readonly attack: number
  readonly specialAttack: number
  readonly defense: number
  readonly specialDefense: number
  readonly speed: number | null
  readonly level: number
  readonly currentHp: number
  readonly maximumHp: number
  readonly combatStages: SpawnedPokemon['combatStages']
  readonly conditions: readonly string[]
  readonly abilityNames: readonly string[]
  readonly dauntlessShieldActive: boolean
  readonly gutsActive: boolean
}

const fail = (
  code: MoveAutomationStatQueryErrorCode,
  message: string,
): never => {
  throw new MoveAutomationStatQueryError(code, message)
}

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

const indexedByUniqueId = <Value>(
  values: readonly Value[],
  idFor: (value: Value) => string,
  code: MoveAutomationStatQueryErrorCode,
  label: string,
): ReadonlyMap<string, Value> => {
  const indexed = new Map<string, Value>()
  for (const value of values) {
    const id = idFor(value)
    if (indexed.has(id)) fail(code, `${label} ${id} was listed more than once.`)
    indexed.set(id, value)
  }
  return indexed
}

const finiteOrNull = (value: unknown): number | null => (
  typeof value === 'number' && Number.isFinite(value) ? value : null
)

const statTokenSnapshot = (
  token: SpawnedPokemon,
  dauntlessShieldActive: boolean,
  gutsActive: boolean,
): MoveAutomationStatTokenSnapshot => deepFreeze({
  id: token.id,
  attack: token.atk,
  specialAttack: token.satk,
  defense: token.def,
  specialDefense: token.sdef,
  speed: finiteOrNull(token.spd),
  level: token.level,
  currentHp: token.currentHp,
  maximumHp: token.maxHp,
  combatStages: normalizeCombatStages(token.combatStages),
  conditions: [...token.conditions],
  abilityNames: [
    ...(token.abilityNames ?? []).filter(name => name !== 'Guts'),
    ...(gutsActive ? ['Guts'] : []),
  ],
  dauntlessShieldActive,
  gutsActive,
})

const finiteStatValue = (
  token: MoveAutomationStatTokenSnapshot,
  stat: MoveExpressionStat,
): number | null => {
  let value: number | null
  switch (stat) {
    case 'attack': value = token.attack; break
    case 'special-attack': value = token.specialAttack; break
    case 'defense': value = token.defense; break
    case 'special-defense': value = token.specialDefense; break
    case 'speed': value = token.speed; break
    case 'level': value = token.level; break
    case 'current-hp': value = token.currentHp; break
    case 'maximum-hp': value = token.maximumHp; break
  }
  return finiteOrNull(value)
}

interface MoveAutomationStageSnapshots {
  readonly authored: ReturnType<typeof normalizeCombatStages>
  readonly modified: ReturnType<typeof normalizeCombatStages>
}

const stageSnapshots = (
  token: MoveAutomationStatTokenSnapshot,
): MoveAutomationStageSnapshots => {
  const authored = aa066EffectiveCombatStages({
    stages: normalizeCombatStages(token.combatStages),
    abilityNames: token.dauntlessShieldActive ? ['Dauntless Shield'] : [],
  })
  return {
    authored,
    modified: conditionAdjustedCombatStages(
      authored,
      token.conditions,
      { abilities: token.abilityNames },
    ),
  }
}

const resolveCombatStageFromSnapshots = (
  snapshots: MoveAutomationStageSnapshots,
  stage: MoveCombatStageStat,
  stageModifierPolicy: MoveStatStageModifierPolicy,
): MoveAutomationCombatStageResolution => {
  const authoredStage = clampCombatStage(snapshots.authored[stage])
  const modifiedStage = clampCombatStage(snapshots.modified[stage])
  return deepFreeze({
    stage,
    authoredStage,
    stageModifier: modifiedStage - authoredStage,
    modifiedStage,
    stageModifierPolicy,
    value: stageModifierPolicy === 'honor' ? modifiedStage : authoredStage,
  })
}

const resolveCombatStage = (
  token: MoveAutomationStatTokenSnapshot,
  stage: MoveCombatStageStat,
  stageModifierPolicy: MoveStatStageModifierPolicy,
): MoveAutomationCombatStageResolution => resolveCombatStageFromSnapshots(
  stageSnapshots(token),
  stage,
  stageModifierPolicy,
)

const stageAfterPolicy = (
  stage: number,
  policy: MoveStatCombatStagePolicy,
): number => {
  if (policy === 'ignore') return 0
  if (policy === 'ignore-positive') return Math.min(0, stage)
  if (policy === 'ignore-negative') return Math.max(0, stage)
  return stage
}

const resolveStat = (
  placementId: string,
  token: MoveAutomationStatTokenSnapshot,
  query: MoveAutomationStatQuery,
  overlay: MoveAutomationStatOverlay | null,
): MoveAutomationStatResolution | null => {
  const combatStagePolicy = query.combatStagePolicy ?? 'ignore'
  const stageModifierPolicy = query.stageModifierPolicy ?? 'ignore'
  if (
    !EXPRESSION_STAT_SET.has(query.stat)
    || !COMBAT_STAGE_POLICY_SET.has(combatStagePolicy)
    || !STAGE_MODIFIER_POLICY_SET.has(stageModifierPolicy)
  ) return null
  const sourceStat = overlay?.sourceStat ?? query.stat
  if (!EXPRESSION_STAT_SET.has(sourceStat)) return null
  const baseValue = finiteStatValue(token, sourceStat)
  if (baseValue === null) return null

  const stage = STAGE_KEY_BY_STAT[sourceStat]
  if (!stage) {
    if (combatStagePolicy !== 'ignore' || stageModifierPolicy !== 'ignore') return null
    return deepFreeze({
      placementId,
      stat: query.stat,
      sourceStat,
      overlay,
      label: MOVE_AUTOMATION_STAT_LABELS[query.stat],
      shortLabel: MOVE_AUTOMATION_STAT_SHORT_LABELS[query.stat],
      baseValue,
      combatStagePolicy,
      stageModifierPolicy,
      authoredStage: null,
      stageModifier: 0,
      modifiedStage: null,
      appliedStage: null,
      value: baseValue,
    })
  }

  const stageResolution = resolveCombatStage(token, stage, stageModifierPolicy)
  const appliedStage = stageAfterPolicy(stageResolution.value, combatStagePolicy)
  return deepFreeze({
    placementId,
    stat: query.stat as MoveStageAffectedExpressionStat,
    sourceStat,
    overlay,
    label: MOVE_AUTOMATION_STAT_LABELS[query.stat],
    shortLabel: MOVE_AUTOMATION_STAT_SHORT_LABELS[query.stat],
    baseValue,
    combatStagePolicy,
    stageModifierPolicy,
    authoredStage: stageResolution.authoredStage,
    stageModifier: stageResolution.stageModifier,
    modifiedStage: stageResolution.modifiedStage,
    appliedStage,
    value: applyCombatStageToStat(baseValue, appliedStage),
  })
}

/**
 * Snapshot authoritative stat inputs once and expose placement-ID-only queries.
 * Resolved values never accept client-authored totals, stages, or modifiers.
 */
export const createMoveAutomationStatResolver = (
  input: CreateMoveAutomationStatResolverInput,
): MoveAutomationStatResolver => {
  const placements = indexedByUniqueId(
    input.placements,
    placement => placement.id,
    'duplicate-placement-id',
    'Stat-query placement',
  )
  const tokens = indexedByUniqueId(
    input.tokens.map(token => statTokenSnapshot(
      token,
      input.hasEffectiveAbility?.(token.id, 'Dauntless Shield')
        ?? token.abilityNames?.includes('Dauntless Shield')
        ?? false,
      input.hasEffectiveAbility?.(token.id, 'Guts')
        ?? token.abilityNames?.includes('Guts')
        ?? false,
    )),
    token => token.id,
    'duplicate-token-id',
    'Stat-query token',
  )
  const sheetReads = new Map(input.placements.map(placement => [
    placement.id,
    Object.freeze({
      sheetKind: placement.sheetKind,
      sheetSlug: placement.sheetSlug,
    }),
  ]))

  const tokenFor = (placementId: string): MoveAutomationStatTokenSnapshot | null => {
    if (!placements.has(placementId)) return null
    const sheetRead = sheetReads.get(placementId)
    if (sheetRead) input.recordSheetRead?.(sheetRead)
    return tokens.get(placementId) ?? null
  }

  const overlayFor = (
    placementId: string,
    stat: MoveExpressionStat,
  ): MoveAutomationStatOverlay | null => {
    const placement = placements.get(placementId)
    return placement ? input.resolveStatOverlay?.(placement, stat) ?? null : null
  }

  return Object.freeze({
    resolve: (
      placementId: string,
      query: MoveAutomationStatQuery,
    ): MoveAutomationStatResolution | null => {
      const token = tokenFor(placementId)
      return token
        ? resolveStat(placementId, token, query, overlayFor(placementId, query.stat))
        : null
    },
    combatStage: (
      placementId: string,
      query: MoveAutomationCombatStageQuery,
    ): MoveAutomationCombatStageResolution | null => {
      const token = tokenFor(placementId)
      const stageModifierPolicy = query.stageModifierPolicy ?? 'ignore'
      if (
        !token
        || !COMBAT_STAGE_SET.has(query.stage)
        || !STAGE_MODIFIER_POLICY_SET.has(stageModifierPolicy)
      ) return null
      return resolveCombatStage(token, query.stage, stageModifierPolicy)
    },
    combatStageTotal: (
      placementId: string,
      query: MoveAutomationCombatStageTotalQuery,
    ): MoveAutomationCombatStageTotalResolution | null => {
      const token = tokenFor(placementId)
      if (
        !token
        || !STAGE_TOTAL_DIRECTION_SET.has(query.direction)
        || !STAGE_MODIFIER_POLICY_SET.has(query.stageModifierPolicy)
      ) return null
      const snapshots = stageSnapshots(token)
      const stages = COMBAT_STAGE_KEYS.map(stage => resolveCombatStageFromSnapshots(
        snapshots,
        stage,
        query.stageModifierPolicy,
      ))
      const value = stages.reduce((total, stage) => (
        total + (query.direction === 'positive'
          ? Math.max(0, stage.value)
          : Math.max(0, -stage.value))
      ), 0)
      return deepFreeze({
        placementId,
        direction: query.direction,
        stageModifierPolicy: query.stageModifierPolicy,
        value,
        stages,
      })
    },
  })
}
