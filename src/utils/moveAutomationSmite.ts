import type { MoveAutomationScript } from '~/types/moveAutomation'
import { resistMultiplierOneStepFurther } from '~/utils/typeChart'

type SmiteMoveScript = Pick<
  MoveAutomationScript,
  'damaging' | 'requiresAccuracy' | 'keywords'
>

export const moveAutomationHasSmiteKeyword = (
  script: Pick<MoveAutomationScript, 'keywords'> | null | undefined,
): boolean => script?.keywords.some(keyword => /^Smite$/i.test(keyword.trim())) ?? false

export const moveAutomationIsSmiteMiss = (
  script: SmiteMoveScript | null | undefined,
  hit: boolean | undefined,
): boolean => Boolean(
  script?.damaging
  && script.requiresAccuracy
  && hit === false
  && moveAutomationHasSmiteKeyword(script),
)

/** A Smite miss still resolves damage, but remains a miss for every secondary effect. */
export const moveAutomationDamageAppliesOnAccuracyOutcome = (
  script: SmiteMoveScript | null | undefined,
  hit: boolean | undefined,
): boolean => Boolean(script?.damaging && (hit === true || moveAutomationIsSmiteMiss(script, hit)))

/** Apply Smite's canonical one additional resistance step exactly once on a miss. */
export const moveAutomationEffectivenessForAccuracyOutcome = (
  script: SmiteMoveScript | null | undefined,
  hit: boolean | undefined,
  multiplier: number,
): number => moveAutomationIsSmiteMiss(script, hit)
  ? resistMultiplierOneStepFurther(multiplier)
  : multiplier
