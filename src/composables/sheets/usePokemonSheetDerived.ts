import { computed, watch, type ComputedRef, type Ref } from 'vue'
import { getPokedexEntry, getSpriteUrl } from '~~/data/characterSheets'
import { findItem } from '~~/data/ptuReference'
import { applyCombatStageToStatTotal } from '~/utils/combatStageStats'
import { makeAutomaticStruggleMoves } from '~/utils/struggleMoves'
import { buildSheetAccuracySummary } from '~/utils/sheetAccuracy'
import { POKEMON_TYPES, computeMultiplier, formatMultiplier } from '~/utils/typeChart'
import { clampHpValue, computeHpThresholds, computeTickValue } from '~/utils/ptuHp'
import { computePokemonLevelUpStatPointBudget } from '~/utils/statPointBudgets'
import {
  computeFullMaxHp,
  computeMaxHp,
  resolveCapabilities,
  resolveSkills,
  resolveStats,
  validateBaseRelations,
} from '~/utils/sheets/pokemonDerived'
import { computeSheetAbilityEvasionBonus } from '~/utils/sheetAbilityActivation'
import { heldItemInitiativeBonus, heldItemSpeedEvasionBonus } from '~/utils/sheetHeldItemEffects'
import {
  conditionAdjustedCombatStage,
  conditionAdjustedEvasion,
  conditionAdjustedInitiative,
  conditionCombatStageModifier,
  describeSheetConditionEffects,
} from '~/utils/sheetConditionEffects'
import { mergeLegacyConditions } from '~/utils/statusConditions'
import { parseSkillDiceRankValue } from '~/utils/skillRanks'
import { resolveSheetPassiveTypeEffectiveness } from '~/utils/sheetPassiveAbilityEffects'
import {
  calculatePokemonExperienceToNextLevel,
  calculatePokemonLevelFromExperience,
} from '~/utils/sheets/pokemonExperience'
import { resolvePokemonTrainingFeatureEffects } from '~/utils/sheets/pokemonTrainingFeatures'
import {
  resolvedStatBaseTotal,
  resolvedStatEffectiveStage,
  resolvedStatTotal,
} from '~/utils/sheets/resolvedStatRows'
import { makeAbilityLookupRows } from '~/utils/sheetAbilityLookup'
import { makeMoveLookupRows, type MoveLookupRow } from '~/utils/sheetMoveLookup'
import type {
  CharacterSheet,
  CharacterSheetMove,
  StatKey,
} from '~/types/characterSheet'

export type PokemonSheetRef = Ref<CharacterSheet | null> | ComputedRef<CharacterSheet | null>

export type PokemonSheetMoveLookupRow = MoveLookupRow<CharacterSheetMove> & {
  automatic: boolean
  sheetIndex: number | null
}

const BASE_RELATION_VISIBLE_LIMIT = 6

type PokemonStatRows = ReturnType<typeof resolveStats>

const totalForStat = (rows: PokemonStatRows, key: StatKey): number =>
  resolvedStatTotal(rows, key)

const baseTotalForStat = (rows: PokemonStatRows, key: StatKey): number =>
  resolvedStatBaseTotal(rows, key)

const effectiveStageForStat = (rows: PokemonStatRows, key: StatKey): number =>
  resolvedStatEffectiveStage(rows, key)

export const formatLookupList = (values: readonly string[] | null | undefined): string => {
  const presentValues = (values ?? []).filter(Boolean)
  return presentValues.length ? presentValues.join(', ') : '—'
}

export function usePokemonSheetDerived(sheet: PokemonSheetRef) {
  const species = computed(() => (sheet.value ? getPokedexEntry(sheet.value.species) : null))
  const spriteUrl = computed(() => (sheet.value ? getSpriteUrl(sheet.value.species) : null))

  const combatConditions = computed(() => mergeLegacyConditions(
    sheet.value?.combat?.conditions,
    sheet.value?.combat?.statusAfflictions,
  ))
  const stats = computed(() => {
    if (!sheet.value) return []
    const conditions = combatConditions.value
    const abilities = sheet.value.abilities
    return resolveStats(sheet.value).map((row) => {
      if (row.key === 'hp') return row
      const conditionStageModifier = conditionCombatStageModifier(conditions, row.key, { abilities })
      const effectiveStage = conditionAdjustedCombatStage(row.stage, conditions, row.key, { abilities })
      return {
        ...row,
        conditionStageModifier,
        effectiveStage,
        total: applyCombatStageToStatTotal(row.key, row.baseTotal, effectiveStage),
      }
    })
  })
  const skills = computed(() => (sheet.value ? resolveSkills(sheet.value) : []))
  const combatSkillRankValue = computed(() =>
    parseSkillDiceRankValue(skills.value.find((skill) => skill.key === 'combat')?.value),
  )
  const capabilities = computed(() =>
    sheet.value ? resolveCapabilities(sheet.value) : { rows: [], naturewalk: undefined, other: [] },
  )
  const activeTrainingFeatureEffects = computed(() =>
    resolvePokemonTrainingFeatureEffects(sheet.value?.activeTrainingFeature),
  )
  const sheetTypes = computed(() => sheet.value?.types ?? species.value?.types ?? [])
  const eggGroups = computed(() => sheet.value?.eggGroups ?? species.value?.egg_groups ?? [])

  const levelFromExperience = computed(() => calculatePokemonLevelFromExperience(sheet.value?.totalExp))
  const levelIsExperienceDerived = computed(() => levelFromExperience.value != null)
  const experienceToNextLevel = computed(() => calculatePokemonExperienceToNextLevel(sheet.value?.totalExp))

  watch(
    () => [sheet.value, levelFromExperience.value] as const,
    ([currentSheet, level]) => {
      if (!currentSheet || level == null || currentSheet.level === level) return
      currentSheet.level = level
    },
    { immediate: true, flush: 'sync' },
  )

  const hpTotal = computed(() => totalForStat(stats.value, 'hp'))
  const speedTotal = computed(() => totalForStat(stats.value, 'spd'))
  const fullMaxHp = computed(() => (sheet.value ? computeFullMaxHp(sheet.value, hpTotal.value) : 0))
  const maxHp = computed(() => (sheet.value ? computeMaxHp(sheet.value, hpTotal.value) : 0))
  const currentHp = computed(() => clampHpValue(sheet.value?.combat?.currentHp ?? maxHp.value, maxHp.value))
  const tickValue = computed(() => computeTickValue(fullMaxHp.value))
  const conditionEffects = computed(() => describeSheetConditionEffects(
    combatConditions.value,
    { tickValue: tickValue.value, abilities: sheet.value?.abilities },
  ))
  const initiativeItemBonus = computed(() => heldItemInitiativeBonus(sheet.value?.items?.held))
  const initiativeTrainingBonus = computed(() => activeTrainingFeatureEffects.value?.initiativeBonus ?? 0)
  const initiative = computed(() =>
    conditionAdjustedInitiative(
      speedTotal.value + initiativeItemBonus.value + initiativeTrainingBonus.value,
      combatConditions.value,
      { abilities: sheet.value?.abilities },
    ),
  )

  const setCurrentHp = (value: unknown) => {
    if (!sheet.value) return
    sheet.value.combat!.currentHp = clampHpValue(value, maxHp.value)
  }

  watch(
    () => [sheet.value?.combat?.currentHp, maxHp.value] as const,
    ([rawCurrentHp]) => {
      if (!sheet.value || rawCurrentHp == null) return
      const clamped = clampHpValue(rawCurrentHp, maxHp.value)
      if (rawCurrentHp !== clamped) sheet.value.combat!.currentHp = clamped
    },
    { immediate: true },
  )

  const hpThresholds = computed(() => computeHpThresholds(fullMaxHp.value))

  const statPointsSpent = computed(() =>
    stats.value.reduce((sum, row) => sum + (Number.isFinite(row.added) ? row.added : 0), 0),
  )
  const statPointsBudget = computed(() => computePokemonLevelUpStatPointBudget(sheet.value?.level ?? 1))
  const statPointsLeft = computed(() => statPointsBudget.value - statPointsSpent.value)
  const baseRelationViolations = computed(() => validateBaseRelations(stats.value))
  const visibleBaseRelationViolations = computed(() =>
    baseRelationViolations.value.slice(0, BASE_RELATION_VISIBLE_LIMIT),
  )
  const remainingBaseRelationViolationCount = computed(() =>
    Math.max(0, baseRelationViolations.value.length - visibleBaseRelationViolations.value.length),
  )

  const pokemonAccuracy = computed(() => {
    const summary = buildSheetAccuracySummary({
      stage: sheet.value?.combatStages?.acc,
      conditions: combatConditions.value,
      heldItem: sheet.value?.items?.held,
      abilities: sheet.value?.abilities,
    })
    const trainingBonus = activeTrainingFeatureEffects.value?.accuracyRollBonus ?? 0
    return trainingBonus
      ? { ...summary, total: summary.total + trainingBonus, trainingBonus }
      : summary
  })

  const pokemonEvasion = computed(() => {
    const evasion = sheet.value?.combat?.evasion
    const vsAtkBonus = evasion?.vsAtkBonus ?? 0
    const vsSatkBonus = evasion?.vsSatkBonus ?? 0
    const vsAnyBonus = evasion?.vsAnyBonus ?? 0
    const abilityBonus = computeSheetAbilityEvasionBonus(sheet.value?.abilities)
    const trainingBonus = activeTrainingFeatureEffects.value?.evasionBonus ?? 0
    const trainingBonusField = trainingBonus ? { trainingBonus } : {}
    const vsAnyItemBonus = heldItemSpeedEvasionBonus(sheet.value?.items?.held)
    const conditions = combatConditions.value

    return {
      vsAtk: {
        ...conditionAdjustedEvasion({
          statTotal: baseTotalForStat(stats.value, 'def'),
          combatStage: sheet.value?.stats?.def?.stage,
          bonus: vsAtkBonus + abilityBonus + trainingBonus,
          conditions,
          abilities: sheet.value?.abilities,
          statStageKey: 'def',
          kind: 'physical',
        }),
        bonus: vsAtkBonus,
        abilityBonus,
        ...trainingBonusField,
      },
      vsSatk: {
        ...conditionAdjustedEvasion({
          statTotal: baseTotalForStat(stats.value, 'sdef'),
          combatStage: sheet.value?.stats?.sdef?.stage,
          bonus: vsSatkBonus + abilityBonus + trainingBonus,
          conditions,
          abilities: sheet.value?.abilities,
          statStageKey: 'sdef',
          kind: 'special',
        }),
        bonus: vsSatkBonus,
        abilityBonus,
        ...trainingBonusField,
      },
      vsAny: {
        ...conditionAdjustedEvasion({
          statTotal: baseTotalForStat(stats.value, 'spd'),
          combatStage: sheet.value?.stats?.spd?.stage,
          bonus: vsAnyBonus + abilityBonus + vsAnyItemBonus + trainingBonus,
          conditions,
          abilities: sheet.value?.abilities,
          statStageKey: 'spd',
          kind: 'speed',
        }),
        bonus: vsAnyBonus,
        abilityBonus,
        itemBonus: vsAnyItemBonus,
        ...trainingBonusField,
      },
    }
  })

  const tutorPointsLeft = computed(() => {
    const tp = sheet.value?.tutorPoints
    if (!tp) return null
    return (tp.earned ?? 0) - (tp.spent ?? 0)
  })

  const attackTotal = computed(() => totalForStat(stats.value, 'atk'))
  const specialAttackTotal = computed(() => totalForStat(stats.value, 'satk'))

  const struggleCapabilityNames = computed(() => capabilities.value.other)

  const automaticStruggleMoves = computed(() =>
    makeAutomaticStruggleMoves(struggleCapabilityNames.value, sheet.value?.movelist),
  )

  const moveRows = computed<PokemonSheetMoveLookupRow[]>(() => {
    const options = {
      stabTypes: sheetTypes.value,
      physicalAttack: baseTotalForStat(stats.value, 'atk'),
      specialAttack: baseTotalForStat(stats.value, 'satk'),
      physicalAttackStage: effectiveStageForStat(stats.value, 'atk'),
      specialAttackStage: effectiveStageForStat(stats.value, 'satk'),
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

  const heldItemName = computed(() => sheet.value?.items?.held?.trim() ?? '')
  const heldItemReference = computed(() => (heldItemName.value ? findItem(heldItemName.value) : null))

  const typeEffectivenessRows = computed(() => {
    const defenders = sheetTypes.value
    if (defenders.length === 0) return []
    return POKEMON_TYPES.map((attacker) => {
      const baseMult = computeMultiplier(attacker, defenders)
      const passiveEffectiveness = resolveSheetPassiveTypeEffectiveness(
        attacker,
        baseMult,
        sheet.value?.abilities,
      )
      const mult = passiveEffectiveness.multiplier
      return {
        type: attacker,
        mult,
        label: formatMultiplier(mult),
        source: mult !== baseMult && passiveEffectiveness.sources.length
          ? passiveEffectiveness.sources.join(', ')
          : null,
        tone:
          mult === 0 ? 'immune'
          : mult > 1 ? 'weak'
          : mult < 1 ? 'resist'
          : 'neutral',
      }
    })
  })

  return {
    species,
    spriteUrl,
    stats,
    skills,
    capabilities,
    sheetTypes,
    eggGroups,
    levelFromExperience,
    levelIsExperienceDerived,
    experienceToNextLevel,
    fullMaxHp,
    maxHp,
    currentHp,
    setCurrentHp,
    tickValue,
    hpThresholds,
    speedTotal,
    initiative,
    initiativeItemBonus,
    initiativeTrainingBonus,
    activeTrainingFeatureEffects,
    combatConditions,
    conditionEffects,
    statPointsSpent,
    statPointsBudget,
    statPointsLeft,
    baseRelationViolations,
    visibleBaseRelationViolations,
    remainingBaseRelationViolationCount,
    pokemonAccuracy,
    pokemonEvasion,
    tutorPointsLeft,
    attackTotal,
    specialAttackTotal,
    moveRows,
    abilityRows,
    heldItemName,
    heldItemReference,
    typeEffectivenessRows,
  }
}
