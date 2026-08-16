import { computed, watch, type ComputedRef, type Ref } from 'vue'
import { applyCombatStageToStatTotal } from '~/utils/combatStageStats'
import { makeAbilityLookupRows, type AbilityLookupRow } from '~/utils/sheetAbilityLookup'
import {
  clampHpValue,
  computeHpThresholds,
  computeInjuryAdjustedMaxHp,
  computeTickValue,
  computeTrainerFormulaMaxHp,
} from '~/utils/ptuHp'
import { computeTrainerLevelUpStatPointBudget } from '~/utils/statPointBudgets'
import { makeAutomaticStruggleMoves } from '~/utils/struggleMoves'
import { makeMoveLookupRows, type MoveLookupRow } from '~/utils/sheetMoveLookup'
import {
  deriveTrainerAutomaticAbilities,
  deriveTrainerAutomaticMoves,
} from '~/utils/sheets/trainerCombatDerivations'
import { trainerOrderOptionsForSheet, type TokenOrderMenuOption } from '~/utils/mapTokenOrders'
import { buildSheetAccuracySummary } from '~/utils/sheetAccuracy'
import {
  applyProjectedEquipmentContributions,
  projectedEquipmentContributionDelta,
} from '~/utils/equipmentContributionProjection'
import { computeEvasionTotal, computeStatEvasion } from '~/utils/evasion'
import {
  computeTrainerMaxAp,
  resolveAdvancement,
  resolveTrainerCapabilities,
  resolveTrainerSkills,
  resolveTrainerStats,
} from '~/utils/sheets/trainerDerived'
import {
  resolvedStatBaseTotal,
  resolvedStatEffectiveStage,
  resolvedStatTotal,
} from '~/utils/sheets/resolvedStatRows'
import {
  conditionAdjustedCombatStage,
  conditionAdjustedEvasion,
  conditionAdjustedInitiative,
  conditionCombatStageModifier,
  conditionEvasionModifier,
  describeSheetConditionEffects,
} from '~/utils/sheetConditionEffects'
import { mergeLegacyConditions } from '~/utils/statusConditions'
import type { TrainerAbilityEntry, TrainerMove, TrainerOrder, TrainerSheet, TrainerStatKey } from '~/types/trainerSheet'

export type TrainerSheetRef = Ref<TrainerSheet | null> | ComputedRef<TrainerSheet | null>

export type TrainerSheetMoveLookupRow = MoveLookupRow<TrainerMove> & {
  automatic: boolean
  sheetIndex: number | null
  sourceLabel?: string | null
}

export type TrainerSheetAbilityLookupRow = AbilityLookupRow<TrainerAbilityEntry> & {
  automatic: boolean
  sheetIndex: number | null
  sourceLabel?: string | null
}

export interface TrainerSheetOrderRow extends TokenOrderMenuOption {
  order: TrainerOrder | null
  automatic: boolean
  sheetIndex: number | null
}

type TrainerStatRows = ReturnType<typeof resolveTrainerStats>

const totalForStat = (rows: TrainerStatRows, key: TrainerStatKey): number =>
  resolvedStatTotal(rows, key)

const baseTotalForStat = (rows: TrainerStatRows, key: TrainerStatKey): number =>
  resolvedStatBaseTotal(rows, key)

const effectiveStageForStat = (rows: TrainerStatRows, key: TrainerStatKey): number =>
  resolvedStatEffectiveStage(rows, key)

export function useTrainerSheetDerived(sheet: TrainerSheetRef) {
  const combatConditions = computed(() => mergeLegacyConditions(
    sheet.value?.conditions,
    sheet.value?.statusAfflictions,
  ))
  const automaticTrainerAbilities = computed(() => deriveTrainerAutomaticAbilities(sheet.value))
  const trainerAbilities = computed<TrainerAbilityEntry[]>(() => [
    ...automaticTrainerAbilities.value.map((ability) => ability.entry),
    ...(sheet.value?.abilities ?? []),
  ])
  const stats = computed(() => {
    if (!sheet.value) return []
    const conditions = combatConditions.value
    const abilities = trainerAbilities.value
    return resolveTrainerStats(sheet.value).map((row) => {
      const conditionStageModifier = row.key === 'hp'
        ? 0
        : conditionCombatStageModifier(conditions, row.key, { abilities })
      const equipmentDefaultStage = row.key === 'hp' ? 0 : projectedEquipmentContributionDelta({
        sheet: sheet.value,
        metric: 'combat-stage-default',
        targetId: row.key,
      })
      const effectiveStage = row.key === 'hp'
        ? 0
        : conditionAdjustedCombatStage(row.stage + equipmentDefaultStage, conditions, row.key, { abilities })
      const stagedTotal = row.key === 'hp'
        ? row.total
        : applyCombatStageToStatTotal(row.key, row.baseTotal, effectiveStage)
      return {
        ...row,
        conditionStageModifier,
        effectiveStage,
        total: applyProjectedEquipmentContributions({
          sheet: sheet.value,
          metric: 'stat-after-stages',
          targetId: row.key,
          base: stagedTotal,
        }),
      }
    })
  })
  const skills = computed(() => sheet.value ? resolveTrainerSkills(sheet.value).map(row => ({
    ...row,
    modifier: applyProjectedEquipmentContributions({
      sheet: sheet.value,
      metric: 'skill-check-modifier',
      targetId: row.key,
      base: row.modifier,
    }),
  })) : [])
  const combatSkillRankValue = computed(() => skills.value.find((skill) => skill.key === 'combat')?.rankValue ?? null)
  const capRes = computed(() => {
    if (!sheet.value) return { rows: [], other: [] }
    const resolved = resolveTrainerCapabilities(sheet.value)
    return {
      ...resolved,
      rows: resolved.rows.map(row => typeof row.value === 'number'
        ? {
            ...row,
            value: applyProjectedEquipmentContributions({
              sheet: sheet.value,
              metric: 'capability-value',
              targetId: row.label.trim().toLocaleLowerCase('en-US'),
              base: row.value,
            }),
          }
        : row),
    }
  })
  const adv = computed(() => sheet.value ? resolveAdvancement(sheet.value) : [])

  const fullMaxHp = computed(() => sheet.value
    ? computeTrainerFormulaMaxHp(sheet.value.level ?? 1, totalForStat(stats.value, 'hp'))
    : 0)
  const maxHp = computed(() => sheet.value
    ? computeInjuryAdjustedMaxHp(fullMaxHp.value, sheet.value.currentInjuries)
    : 0)
  const maxAp = computed(() => sheet.value ? computeTrainerMaxAp(sheet.value) : 0)
  const currentHp = computed(() => clampHpValue(sheet.value?.currentHp ?? maxHp.value, maxHp.value))
  const apLeft = computed(() => sheet.value?.ap?.left ?? maxAp.value)

  const setCurrentHp = (value: unknown) => {
    if (!sheet.value) return
    sheet.value.currentHp = clampHpValue(value, maxHp.value)
  }

  watch(
    () => [sheet.value?.currentHp, maxHp.value] as const,
    ([rawCurrentHp]) => {
      if (!sheet.value || rawCurrentHp == null) return
      const clamped = clampHpValue(rawCurrentHp, maxHp.value)
      if (rawCurrentHp !== clamped) sheet.value.currentHp = clamped
    },
    { immediate: true },
  )

  const totalRow = (key: TrainerStatKey) => totalForStat(stats.value, key)

  const attackTotal = computed(() => totalRow('atk'))
  const specialAttackTotal = computed(() => totalRow('satk'))

  const automaticTrainerMoves = computed(() => deriveTrainerAutomaticMoves(sheet.value))
  const automaticStruggleMoves = computed(() =>
    makeAutomaticStruggleMoves<TrainerMove>(
      sheet.value?.capabilities?.other,
      [...automaticTrainerMoves.value.map((move) => move.entry), ...(sheet.value?.movelist ?? [])],
    ),
  )

  const moveRows = computed<TrainerSheetMoveLookupRow[]>(() => {
    const options = {
      physicalAttack: baseTotalForStat(stats.value, 'atk'),
      specialAttack: baseTotalForStat(stats.value, 'satk'),
      physicalAttackStage: effectiveStageForStat(stats.value, 'atk'),
      specialAttackStage: effectiveStageForStat(stats.value, 'satk'),
      abilities: trainerAbilities.value,
      combatSkillRankValue: combatSkillRankValue.value,
    }
    const manualRows = makeMoveLookupRows(sheet.value?.movelist, options)
      .map((row, i) => ({ ...row, automatic: false, sheetIndex: i, sourceLabel: null }))
    const automaticStruggleRows = makeMoveLookupRows(automaticStruggleMoves.value, options)
      .map((row) => ({ ...row, automatic: true, sheetIndex: null, sourceLabel: 'Struggle rules' }))
    const automaticFeatureRows = makeMoveLookupRows(automaticTrainerMoves.value.map((move) => move.entry), options)
      .map((row, i) => ({ ...row, automatic: true, sheetIndex: null, sourceLabel: automaticTrainerMoves.value[i]?.sourceLabel ?? 'Feature' }))
    return [...automaticStruggleRows, ...automaticFeatureRows, ...manualRows]
  })

  const abilityRows = computed<TrainerSheetAbilityLookupRow[]>(() => {
    const automaticAbilities = automaticTrainerAbilities.value
    const automaticRows = makeAbilityLookupRows(automaticAbilities.map((ability) => ability.entry))
      .map((row, i) => ({ ...row, automatic: true, sheetIndex: null, sourceLabel: automaticAbilities[i]?.sourceLabel ?? 'Feature' }))
    const manualRows = makeAbilityLookupRows(sheet.value?.abilities)
      .map((row, i) => ({ ...row, automatic: false, sheetIndex: i, sourceLabel: null }))
    return [...automaticRows, ...manualRows]
  })

  const orderRows = computed<TrainerSheetOrderRow[]>(() => {
    const manualOrderBySlug = new Map<string, { order: TrainerOrder; index: number }>()
    for (const [index, order] of (sheet.value?.orders ?? []).entries()) {
      const key = String(order.name ?? '').trim().toLowerCase()
      if (key && !manualOrderBySlug.has(key)) manualOrderBySlug.set(key, { order, index })
    }

    return sheet.value ? trainerOrderOptionsForSheet(sheet.value).map((option) => {
      const manual = manualOrderBySlug.get(String(option.name ?? '').trim().toLowerCase())
      return {
        ...option,
        order: manual?.order ?? null,
        automatic: !manual,
        sheetIndex: manual?.index ?? null,
      }
    }) : []
  })

  const trainerAccuracy = computed(() => {
    const summary = buildSheetAccuracySummary({
      stage: sheet.value?.combatStages?.acc,
      conditions: combatConditions.value,
      includeHeldItemBonus: false,
      abilities: trainerAbilities.value,
    })
    const equipmentBonus = projectedEquipmentContributionDelta({
      sheet: sheet.value,
      metric: 'accuracy-roll',
      targetId: 'all',
    })
    return { ...summary, total: summary.total + equipmentBonus, itemBonus: equipmentBonus }
  })

  const trainerEvasion = computed(() => {
    const evasion = sheet.value?.evasion
    const speedBonus = evasion?.speedBonus ?? 0
    const physicalBonus = evasion?.physicalBonus ?? 0
    const specialBonus = evasion?.specialBonus ?? 0
    const conditions = combatConditions.value
    const equipmentEvasionBonus = (targetId: 'physical' | 'special' | 'speed') => (
      projectedEquipmentContributionDelta({
        sheet: sheet.value,
        metric: 'evasion',
        targetId,
      })
    )
    const withEquipmentStat = (
      result: ReturnType<typeof conditionAdjustedEvasion>,
      targetId: 'def' | 'sdef' | 'spd',
      bonus: number,
    ) => {
      const effectiveStat = applyProjectedEquipmentContributions({
        sheet: sheet.value,
        metric: 'stat-after-stages',
        targetId,
        base: result.effectiveStat,
      })
      const base = computeStatEvasion(effectiveStat)
      return {
        ...result,
        effectiveStat,
        base,
        total: result.suppressedByCondition
          ? 0
          : computeEvasionTotal(base, bonus + conditionEvasionModifier(conditions)),
      }
    }

    return {
      speed: {
        ...withEquipmentStat(conditionAdjustedEvasion({
          statTotal: baseTotalForStat(stats.value, 'spd'),
          combatStage: (sheet.value?.stats?.spd?.stage ?? sheet.value?.combatStages?.spd ?? 0)
            + projectedEquipmentContributionDelta({
              sheet: sheet.value, metric: 'combat-stage-default', targetId: 'spd',
            }),
          bonus: speedBonus + equipmentEvasionBonus('speed'),
          conditions,
          abilities: trainerAbilities.value,
          statStageKey: 'spd',
          kind: 'speed',
        }), 'spd', speedBonus + equipmentEvasionBonus('speed')),
        bonus: speedBonus,
      },
      physical: {
        ...withEquipmentStat(conditionAdjustedEvasion({
          statTotal: baseTotalForStat(stats.value, 'def'),
          combatStage: (sheet.value?.stats?.def?.stage ?? sheet.value?.combatStages?.def ?? 0)
            + projectedEquipmentContributionDelta({
              sheet: sheet.value, metric: 'combat-stage-default', targetId: 'def',
            }),
          bonus: physicalBonus + equipmentEvasionBonus('physical'),
          conditions,
          abilities: trainerAbilities.value,
          statStageKey: 'def',
          kind: 'physical',
        }), 'def', physicalBonus + equipmentEvasionBonus('physical')),
        bonus: physicalBonus,
      },
      special: {
        ...withEquipmentStat(conditionAdjustedEvasion({
          statTotal: baseTotalForStat(stats.value, 'sdef'),
          combatStage: (sheet.value?.stats?.sdef?.stage ?? sheet.value?.combatStages?.sdef ?? 0)
            + projectedEquipmentContributionDelta({
              sheet: sheet.value, metric: 'combat-stage-default', targetId: 'sdef',
            }),
          bonus: specialBonus + equipmentEvasionBonus('special'),
          conditions,
          abilities: trainerAbilities.value,
          statStageKey: 'sdef',
          kind: 'special',
        }), 'sdef', specialBonus + equipmentEvasionBonus('special')),
        bonus: specialBonus,
      },
    }
  })

  const tickValue = computed(() => computeTickValue(fullMaxHp.value))
  const hpThresholds = computed(() => computeHpThresholds(fullMaxHp.value))
  const conditionEffects = computed(() => describeSheetConditionEffects(
    combatConditions.value,
    { tickValue: tickValue.value, abilities: trainerAbilities.value },
  ))
  const initiativeItemBonus = computed(() => projectedEquipmentContributionDelta({
    sheet: sheet.value,
    metric: 'initiative',
    targetId: 'all',
  }))
  const initiative = computed(() =>
    conditionAdjustedInitiative(
      totalRow('spd') + initiativeItemBonus.value,
      combatConditions.value,
      { abilities: trainerAbilities.value },
    ),
  )

  const statPointsSpent = computed(() =>
    stats.value.reduce((sum, row) => sum + (Number.isFinite(row.levelUp) ? row.levelUp : 0), 0),
  )
  const statPointsBudget = computed(() => computeTrainerLevelUpStatPointBudget(sheet.value?.level ?? 1))
  const statPointsLeft = computed(() => statPointsBudget.value - statPointsSpent.value)

  return {
    stats,
    skills,
    capRes,
    adv,
    fullMaxHp,
    maxHp,
    maxAp,
    currentHp,
    apLeft,
    setCurrentHp,
    totalRow,
    attackTotal,
    specialAttackTotal,
    moveRows,
    abilityRows,
    orderRows,
    trainerAccuracy,
    trainerEvasion,
    tickValue,
    hpThresholds,
    initiative,
    initiativeItemBonus,
    combatConditions,
    conditionEffects,
    statPointsSpent,
    statPointsBudget,
    statPointsLeft,
  }
}
