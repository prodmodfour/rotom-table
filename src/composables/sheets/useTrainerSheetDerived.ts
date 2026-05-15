import { computed, watch, type ComputedRef, type Ref } from 'vue'
import { makeAbilityLookupRows } from '~/utils/sheetAbilityLookup'
import { clampHpValue, computeHpThresholds, computeTickValue } from '~/utils/ptuHp'
import { computeTrainerLevelUpStatPointBudget } from '~/utils/statPointBudgets'
import { makeAutomaticStruggleMoves } from '~/utils/struggleMoves'
import { makeMoveLookupRows, type MoveLookupRow } from '~/utils/sheetMoveLookup'
import {
  computeEvasionTotal,
  computeStatEvasion,
} from '~/utils/evasion'
import {
  computeTrainerFullMaxHp,
  computeTrainerMaxAp,
  computeTrainerMaxHp,
  resolveAdvancement,
  resolveTrainerCapabilities,
  resolveTrainerSkills,
  resolveTrainerStats,
} from '~/utils/sheets/trainerDerived'
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
  const stats = computed(() => sheet.value ? resolveTrainerStats(sheet.value) : [])
  const skills = computed(() => sheet.value ? resolveTrainerSkills(sheet.value) : [])
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
      physicalAttackStage: sheet.value?.stats?.atk?.stage ?? sheet.value?.combatStages?.atk ?? 0,
      specialAttackStage: sheet.value?.stats?.satk?.stage ?? sheet.value?.combatStages?.satk ?? 0,
      abilities: sheet.value?.abilities,
    }
    const manualRows = makeMoveLookupRows(sheet.value?.movelist, options)
      .map((row, i) => ({ ...row, automatic: false, sheetIndex: i }))
    const automaticRows = makeMoveLookupRows(automaticStruggleMoves.value, options)
      .map((row) => ({ ...row, automatic: true, sheetIndex: null }))
    return [...manualRows, ...automaticRows]
  })

  const abilityRows = computed(() => makeAbilityLookupRows(sheet.value?.abilities))

  const trainerEvasion = computed(() => {
    const evasion = sheet.value?.evasion
    const speedBase = computeStatEvasion(totalRow('spd'))
    const physicalBase = computeStatEvasion(totalRow('def'))
    const specialBase = computeStatEvasion(totalRow('sdef'))
    const speedBonus = evasion?.speedBonus ?? 0
    const physicalBonus = evasion?.physicalBonus ?? 0
    const specialBonus = evasion?.specialBonus ?? 0

    return {
      speed: {
        total: computeEvasionTotal(speedBase, speedBonus),
        base: speedBase,
        bonus: speedBonus,
      },
      physical: {
        total: computeEvasionTotal(physicalBase, physicalBonus),
        base: physicalBase,
        bonus: physicalBonus,
      },
      special: {
        total: computeEvasionTotal(specialBase, specialBonus),
        base: specialBase,
        bonus: specialBonus,
      },
    }
  })

  const tickValue = computed(() => computeTickValue(fullMaxHp.value))
  const hpThresholds = computed(() => computeHpThresholds(fullMaxHp.value))

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
    trainerEvasion,
    tickValue,
    hpThresholds,
    statPointsSpent,
    statPointsBudget,
    statPointsLeft,
  }
}
