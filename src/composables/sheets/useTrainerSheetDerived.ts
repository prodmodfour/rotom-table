import { computed, watch, type ComputedRef, type Ref } from 'vue'
import { makeAbilityLookupRows } from '~/utils/sheetAbilityLookup'
import { clampHpValue, computeHpThresholds, computeTickValue } from '~/utils/ptuHp'
import { computeTrainerLevelUpStatPointBudget } from '~/utils/statPointBudgets'
import { makeAutomaticStruggleMoves } from '~/utils/struggleMoves'
import { makeMoveLookupRows, type MoveLookupRow } from '~/utils/sheetMoveLookup'
import { trainerEquippedItemNames } from '~/utils/sheetItemNames'
import { buildSheetAccuracySummary } from '~/utils/sheetAccuracy'
import { sheetItemsInitiativeBonus } from '~/utils/sheetHeldItemEffects'
import {
  computeTrainerFullMaxHp,
  computeTrainerMaxAp,
  computeTrainerMaxHp,
  resolveAdvancement,
  resolveTrainerCapabilities,
  resolveTrainerSkills,
  resolveTrainerStats,
} from '~/utils/sheets/trainerDerived'
import {
  conditionAdjustedCombatStage,
  conditionAdjustedEvasion,
  conditionAdjustedInitiative,
  conditionCombatStageModifier,
  describeSheetConditionEffects,
} from '~/utils/sheetConditionEffects'
import { mergeLegacyConditions } from '~/utils/statusConditions'
import type { TrainerMove, TrainerSheet, TrainerStatKey } from '~/types/trainerSheet'

export type TrainerSheetRef = Ref<TrainerSheet | null> | ComputedRef<TrainerSheet | null>

export type TrainerSheetMoveLookupRow = MoveLookupRow<TrainerMove> & {
  automatic: boolean
  sheetIndex: number | null
}

type TrainerStatRows = ReturnType<typeof resolveTrainerStats>

const totalForStat = (rows: TrainerStatRows, key: TrainerStatKey): number =>
  rows.find((row) => row.key === key)?.total ?? 0

export function useTrainerSheetDerived(sheet: TrainerSheetRef) {
  const combatConditions = computed(() => mergeLegacyConditions(
    sheet.value?.conditions,
    sheet.value?.statusAfflictions,
  ))
  const stats = computed(() => {
    if (!sheet.value) return []
    const conditions = combatConditions.value
    const abilities = sheet.value.abilities
    return resolveTrainerStats(sheet.value).map((row) => {
      if (row.key === 'hp') return row
      return {
        ...row,
        conditionStageModifier: conditionCombatStageModifier(conditions, row.key, { abilities }),
        effectiveStage: conditionAdjustedCombatStage(row.stage, conditions, row.key, { abilities }),
      }
    })
  })
  const skills = computed(() => sheet.value ? resolveTrainerSkills(sheet.value) : [])
  const combatSkillRankValue = computed(() => skills.value.find((skill) => skill.key === 'combat')?.rankValue ?? null)
  const capRes = computed(() => sheet.value ? resolveTrainerCapabilities(sheet.value) : { rows: [], other: [] })
  const adv = computed(() => sheet.value ? resolveAdvancement(sheet.value) : [])

  const fullMaxHp = computed(() => sheet.value ? computeTrainerFullMaxHp(sheet.value) : 0)
  const maxHp = computed(() => sheet.value ? computeTrainerMaxHp(sheet.value) : 0)
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

  const automaticStruggleMoves = computed(() =>
    makeAutomaticStruggleMoves<TrainerMove>(sheet.value?.capabilities?.other, sheet.value?.movelist),
  )

  const moveRows = computed<TrainerSheetMoveLookupRow[]>(() => {
    const options = {
      physicalAttack: attackTotal.value,
      specialAttack: specialAttackTotal.value,
      physicalAttackStage: conditionAdjustedCombatStage(
        sheet.value?.stats?.atk?.stage ?? sheet.value?.combatStages?.atk ?? 0,
        combatConditions.value,
        'atk',
        { abilities: sheet.value?.abilities },
      ),
      specialAttackStage: conditionAdjustedCombatStage(
        sheet.value?.stats?.satk?.stage ?? sheet.value?.combatStages?.satk ?? 0,
        combatConditions.value,
        'satk',
        { abilities: sheet.value?.abilities },
      ),
      abilities: sheet.value?.abilities,
      combatSkillRankValue: combatSkillRankValue.value,
    }
    const manualRows = makeMoveLookupRows(sheet.value?.movelist, options)
      .map((row, i) => ({ ...row, automatic: false, sheetIndex: i }))
    const automaticRows = makeMoveLookupRows(automaticStruggleMoves.value, options)
      .map((row) => ({ ...row, automatic: true, sheetIndex: null }))
    return [...automaticRows, ...manualRows]
  })

  const abilityRows = computed(() => makeAbilityLookupRows(sheet.value?.abilities))

  const trainerAccuracy = computed(() => buildSheetAccuracySummary({
    stage: sheet.value?.combatStages?.acc,
    conditions: combatConditions.value,
    includeHeldItemBonus: false,
    abilities: sheet.value?.abilities,
  }))

  const trainerEvasion = computed(() => {
    const evasion = sheet.value?.evasion
    const speedBonus = evasion?.speedBonus ?? 0
    const physicalBonus = evasion?.physicalBonus ?? 0
    const specialBonus = evasion?.specialBonus ?? 0
    const conditions = combatConditions.value

    return {
      speed: {
        ...conditionAdjustedEvasion({
          statTotal: totalRow('spd'),
          combatStage: sheet.value?.stats?.spd?.stage ?? sheet.value?.combatStages?.spd,
          bonus: speedBonus,
          conditions,
          abilities: sheet.value?.abilities,
          statStageKey: 'spd',
          kind: 'speed',
          applyCombatStages: false,
        }),
        bonus: speedBonus,
      },
      physical: {
        ...conditionAdjustedEvasion({
          statTotal: totalRow('def'),
          combatStage: sheet.value?.stats?.def?.stage ?? sheet.value?.combatStages?.def,
          bonus: physicalBonus,
          conditions,
          abilities: sheet.value?.abilities,
          statStageKey: 'def',
          kind: 'physical',
          applyCombatStages: false,
        }),
        bonus: physicalBonus,
      },
      special: {
        ...conditionAdjustedEvasion({
          statTotal: totalRow('sdef'),
          combatStage: sheet.value?.stats?.sdef?.stage ?? sheet.value?.combatStages?.sdef,
          bonus: specialBonus,
          conditions,
          abilities: sheet.value?.abilities,
          statStageKey: 'sdef',
          kind: 'special',
          applyCombatStages: false,
        }),
        bonus: specialBonus,
      },
    }
  })

  const tickValue = computed(() => computeTickValue(fullMaxHp.value))
  const hpThresholds = computed(() => computeHpThresholds(fullMaxHp.value))
  const conditionEffects = computed(() => describeSheetConditionEffects(
    combatConditions.value,
    { tickValue: tickValue.value, abilities: sheet.value?.abilities },
  ))
  const equippedItemNames = computed(() => sheet.value ? trainerEquippedItemNames(sheet.value) : [])
  const initiativeItemBonus = computed(() => sheetItemsInitiativeBonus(equippedItemNames.value))
  const initiative = computed(() =>
    conditionAdjustedInitiative(
      totalRow('spd') + initiativeItemBonus.value,
      combatConditions.value,
      { abilities: sheet.value?.abilities },
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
