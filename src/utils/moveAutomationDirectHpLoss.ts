import { computeSheetAbilityAwareMultiplier } from '~/utils/sheetPassiveAbilityEffects'
import type {
  MoveAutomationDirectHpLossRule,
  MoveAutomationScript,
  MoveAutomationUserLevelRollTableDirectHpLossRule,
} from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'

export interface ResolveMoveAutomationDirectHpLossInput {
  script: MoveAutomationScript | null | undefined
  user: SpawnedPokemon
  target: SpawnedPokemon
  rollTotal: number | null | undefined
}

const finiteNonNegativeLevel = (level: number): number => Number.isFinite(level) ? Math.max(0, level) : 0

const rollTableEntryFor = (
  rule: MoveAutomationUserLevelRollTableDirectHpLossRule,
  rollTotal: number | null | undefined,
): MoveAutomationUserLevelRollTableDirectHpLossRule['rollTable'][number] | null => {
  if (rollTotal == null) return null
  return rule.rollTable.find((entry) => entry.roll === rollTotal) ?? null
}

const targetHasTypeImmunity = (
  script: MoveAutomationScript,
  target: SpawnedPokemon,
): boolean => computeSheetAbilityAwareMultiplier(
  script.type,
  target.defenderTypes,
  target.abilityNames,
  target.defenderCapabilities,
) === 0

export const directHpLossRollFormulaForScript = (
  script: MoveAutomationScript | null | undefined,
): string | null => script?.directHpLoss?.kind === 'user-level-roll-table' ? script.directHpLoss.rollFormula : null

export const resolveMoveAutomationDirectHpLoss = ({
  script,
  user,
  target,
  rollTotal,
}: ResolveMoveAutomationDirectHpLossInput): number | null => {
  const rule = script?.directHpLoss
  if (!script || !rule) return null
  if (rule.applyTypeImmunity && targetHasTypeImmunity(script, target)) return 0

  if (rule.kind === 'fixed') return Math.max(0, Math.floor(rule.amount))

  const entry = rollTableEntryFor(rule, rollTotal)
  if (!entry) return 0

  return Math.floor(finiteNonNegativeLevel(user.level) * entry.multiplier)
}
