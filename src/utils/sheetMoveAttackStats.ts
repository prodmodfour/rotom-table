import { applyCombatStageToStat } from '~/utils/combatStageStats'
import {
  sheetHasCanonicalAbility,
  type SheetAbilityNameSource,
} from '~/utils/sheetAbilities'

export const WEIRD_POWER_ABILITY_NAME = 'Weird Power'

export type SheetMoveAttackStatKey = 'atk' | 'satk'

export interface SheetMoveAttackStatOptions {
  /** Ability names/entries that may alter which offensive stat is added. */
  abilities?: readonly SheetAbilityNameSource[] | null
  /** Resolved Attack total before Combat Stages. */
  physicalAttack?: number | null
  /** Resolved Special Attack total before Combat Stages. */
  specialAttack?: number | null
  /** Current Attack Combat Stage. */
  physicalAttackStage?: number | null
  /** Current Special Attack Combat Stage. */
  specialAttackStage?: number | null
}

export interface SheetMoveAttackStatResolution {
  /** Total offensive bonus added to the damage roll after Combat Stages and abilities. */
  attackStat: number | null
  /** Normal damage-class offensive stat before current Combat Stages. */
  baseAttackStat: number | null
  /** Combat Stage used for the normal damage-class offensive stat. */
  attackStage: number | null
  /** Which sheet stat supplies the normal damage-class offensive bonus. */
  attackStatKey: SheetMoveAttackStatKey | null
  /** Human-readable label for the normal damage-class offensive stat. */
  attackStatLabel: string | null
  /** Ability responsible for adding an extra offensive stat to the damage roll. */
  attackStatAbility: string | null
  /** Extra offensive stat added by an ability after current Combat Stages. */
  additionalAttackStat: number | null
  /** Extra offensive stat before current Combat Stages. */
  additionalBaseAttackStat: number | null
  /** Combat Stage used for the extra offensive stat. */
  additionalAttackStage: number | null
  /** Which sheet stat supplies the extra offensive bonus. */
  additionalAttackStatKey: SheetMoveAttackStatKey | null
  /** Human-readable label for the extra offensive stat. */
  additionalAttackStatLabel: string | null
}

interface SheetMoveAttackStatCandidate {
  key: SheetMoveAttackStatKey
  label: string
  base: number
  stage: number
  current: number
}

const ATTACK_STAT_LABELS: Record<SheetMoveAttackStatKey, string> = {
  atk: 'Attack',
  satk: 'Special Attack',
}

const normalAttackStatKeyFor = (
  damageClass: string | null | undefined,
): SheetMoveAttackStatKey | null => {
  switch (String(damageClass ?? '').trim().toLowerCase()) {
    case 'physical': return 'atk'
    case 'special': return 'satk'
    default: return null
  }
}

const alternateAttackStatKey = (key: SheetMoveAttackStatKey): SheetMoveAttackStatKey =>
  key === 'atk' ? 'satk' : 'atk'

const finiteNumberOrZero = (value: number | null | undefined): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0

const finiteStageOrZero = (value: number | null | undefined): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0

const attackStatCandidates = (
  options: SheetMoveAttackStatOptions,
): Record<SheetMoveAttackStatKey, SheetMoveAttackStatCandidate> => {
  const atkBase = finiteNumberOrZero(options.physicalAttack)
  const satkBase = finiteNumberOrZero(options.specialAttack)
  const atkStage = finiteStageOrZero(options.physicalAttackStage)
  const satkStage = finiteStageOrZero(options.specialAttackStage)

  return {
    atk: {
      key: 'atk',
      label: ATTACK_STAT_LABELS.atk,
      base: atkBase,
      stage: atkStage,
      current: applyCombatStageToStat(atkBase, atkStage),
    },
    satk: {
      key: 'satk',
      label: ATTACK_STAT_LABELS.satk,
      base: satkBase,
      stage: satkStage,
      current: applyCombatStageToStat(satkBase, satkStage),
    },
  }
}

const additionalStatFields = (
  candidate: SheetMoveAttackStatCandidate | null,
): Pick<
  SheetMoveAttackStatResolution,
  | 'additionalAttackStat'
  | 'additionalBaseAttackStat'
  | 'additionalAttackStage'
  | 'additionalAttackStatKey'
  | 'additionalAttackStatLabel'
> => ({
  additionalAttackStat: candidate?.current ?? null,
  additionalBaseAttackStat: candidate?.base ?? null,
  additionalAttackStage: candidate?.stage ?? null,
  additionalAttackStatKey: candidate?.key ?? null,
  additionalAttackStatLabel: candidate?.label ?? null,
})

const resolutionForCandidate = (
  candidate: SheetMoveAttackStatCandidate,
  abilityName: string | null,
  additional: SheetMoveAttackStatCandidate | null = null,
): SheetMoveAttackStatResolution => ({
  attackStat: candidate.current + (additional?.current ?? 0),
  baseAttackStat: candidate.base,
  attackStage: candidate.stage,
  attackStatKey: candidate.key,
  attackStatLabel: candidate.label,
  attackStatAbility: abilityName,
  ...additionalStatFields(additional),
})

const emptyAttackStatResolution = (): SheetMoveAttackStatResolution => ({
  attackStat: null,
  baseAttackStat: null,
  attackStage: null,
  attackStatKey: null,
  attackStatLabel: null,
  attackStatAbility: null,
  ...additionalStatFields(null),
})

export const hasWeirdPowerAbility = (
  abilities: readonly SheetAbilityNameSource[] | null | undefined,
): boolean => sheetHasCanonicalAbility(abilities, WEIRD_POWER_ABILITY_NAME)

/**
 * Resolve the offensive stat bonus added to a move damage roll.
 *
 * Normally Physical moves add Attack and Special moves add Special Attack.
 * Weird Power adds the higher opposite offensive stat to the lower stat's
 * damage class; equal stats do not trigger the extra addition.
 */
export const resolveSheetMoveAttackStat = (
  damageClass: string | null | undefined,
  options: SheetMoveAttackStatOptions = {},
): SheetMoveAttackStatResolution => {
  const normalKey = normalAttackStatKeyFor(damageClass)
  if (!normalKey) return emptyAttackStatResolution()

  const candidates = attackStatCandidates(options)
  const normal = candidates[normalKey]
  const alternate = candidates[alternateAttackStatKey(normalKey)]

  if (hasWeirdPowerAbility(options.abilities) && alternate.current > normal.current) {
    return resolutionForCandidate(normal, WEIRD_POWER_ABILITY_NAME, alternate)
  }

  return resolutionForCandidate(normal, null)
}
