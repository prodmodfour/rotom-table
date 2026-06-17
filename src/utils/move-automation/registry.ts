import { findMove, moves } from '~~/data/ptuReference'
import { REVIEWED_ADDITIONAL_SINGLE_TARGET_SCRIPTS } from '~/utils/move-automation/scripts/additionalSingleTarget'
import {
  REVIEWED_ALLY_AREA_STAGE_SCRIPTS,
  REVIEWED_AREA_COAT_SCRIPTS,
  REVIEWED_AREA_CONDITION_SCRIPTS,
  REVIEWED_AREA_CONFIRMATION_SCRIPTS,
  REVIEWED_MIXED_TARGET_AREA_SCRIPTS,
  REVIEWED_PASS_SCRIPTS,
  REVIEWED_SMOG_SCRIPTS,
  REVIEWED_TARGET_STAGE_AREA_SCRIPTS,
} from '~/utils/move-automation/scripts/area'
import { REVIEWED_DIRECT_HP_LOSS_SCRIPTS } from '~/utils/move-automation/scripts/directHpLoss'
import { REVIEWED_SELF_SCRIPTS } from '~/utils/move-automation/scripts/self'
import {
  SEAMLESS_SINGLE_TARGET_ATTACK_SCRIPTS,
  STRUGGLE_ATTACK_SCRIPTS,
} from '~/utils/move-automation/scripts/singleTargetAttacks'
import { REVIEWED_SINGLE_TARGET_CONDITION_SCRIPTS } from '~/utils/move-automation/scripts/singleTargetConditions'
import { REVIEWED_SINGLE_TARGET_STAGE_SCRIPTS } from '~/utils/move-automation/scripts/singleTargetStages'
import { REVIEWED_SINGLE_TARGET_STATUS_SCRIPTS } from '~/utils/move-automation/scripts/singleTargetStatus'
import type { MoveAutomationScript } from '~/types/moveAutomation'

const SEAMLESS_AREA_CONFIRMATION_SCRIPTS: ReadonlyMap<string, MoveAutomationScript> = new Map([
  ...REVIEWED_TARGET_STAGE_AREA_SCRIPTS,
  ...REVIEWED_AREA_CONFIRMATION_SCRIPTS,
  ...REVIEWED_MIXED_TARGET_AREA_SCRIPTS,
  ...REVIEWED_AREA_CONDITION_SCRIPTS,
  ...REVIEWED_SMOG_SCRIPTS,
  ...REVIEWED_AREA_COAT_SCRIPTS,
  ...REVIEWED_ALLY_AREA_STAGE_SCRIPTS,
  ...REVIEWED_PASS_SCRIPTS,
])

const hasReviewedSeamlessSingleTargetScript = (script: MoveAutomationScript): boolean =>
  SEAMLESS_SINGLE_TARGET_ATTACK_SCRIPTS.has(script.moveName)
  || REVIEWED_SINGLE_TARGET_CONDITION_SCRIPTS.has(script.moveName)
  || REVIEWED_SINGLE_TARGET_STATUS_SCRIPTS.has(script.moveName)
  || REVIEWED_SINGLE_TARGET_STAGE_SCRIPTS.has(script.moveName)
  || REVIEWED_ADDITIONAL_SINGLE_TARGET_SCRIPTS.has(script.moveName)
  || (REVIEWED_DIRECT_HP_LOSS_SCRIPTS.has(script.moveName) && Boolean(script.directHpLoss))

export const isSeamlessSingleTargetAttackScript = (
  script: MoveAutomationScript | null | undefined,
): script is MoveAutomationScript => Boolean(
  script
    && script.kind === 'explicit'
    && (
      SEAMLESS_SINGLE_TARGET_ATTACK_SCRIPTS.has(script.moveName)
      || REVIEWED_SINGLE_TARGET_CONDITION_SCRIPTS.has(script.moveName)
      || REVIEWED_SINGLE_TARGET_STAGE_SCRIPTS.has(script.moveName)
      || REVIEWED_ADDITIONAL_SINGLE_TARGET_SCRIPTS.has(script.moveName)
    )
    && script.targetMode === 'one-target'
    && script.targetCount === 1
    && script.damaging,
)

export const isSeamlessSingleTargetMoveScript = (
  script: MoveAutomationScript | null | undefined,
): script is MoveAutomationScript => {
  if (!script) return false
  return Boolean(
    script.kind === 'explicit'
      && hasReviewedSeamlessSingleTargetScript(script)
      && script.targetMode === 'one-target'
      && script.targetCount === 1,
  )
}

export const isSeamlessSelfMoveScript = (
  script: MoveAutomationScript | null | undefined,
): boolean => Boolean(
  script
    && script.kind === 'explicit'
    && REVIEWED_SELF_SCRIPTS.has(script.moveName)
    && script.targetMode === 'self'
    && script.targetCount === 1
    && !script.requiresAccuracy,
)

export const isSeamlessAreaConfirmationScript = (
  script: MoveAutomationScript | null | undefined,
): script is MoveAutomationScript => Boolean(
  script
    && script.kind === 'explicit'
    && SEAMLESS_AREA_CONFIRMATION_SCRIPTS.has(script.moveName)
    && script.targetMode === 'multi-target'
    && script.areaTemplates?.length,
)

export const isSeamlessTargetCountMoveScript = (
  script: MoveAutomationScript | null | undefined,
): script is MoveAutomationScript => Boolean(
  script
    && script.kind === 'explicit'
    && script.targetMode === 'multi-target'
    && typeof script.targetCount === 'number'
    && Number.isInteger(script.targetCount)
    && script.targetCount > 0
    && !script.areaTemplates?.length,
)

/**
 * Human-reviewed move automation scripts. A move only counts as automated when
 * an explicit entry is added here (or moved into per-move modules later). Small
 * factories may copy canonical move data, but the registry itself remains an
 * allow-list of reviewed automation coverage.
 */
export const EXPLICIT_MOVE_AUTOMATION_SCRIPTS: ReadonlyMap<string, MoveAutomationScript> = new Map<string, MoveAutomationScript>([
  ...STRUGGLE_ATTACK_SCRIPTS,
  ...SEAMLESS_SINGLE_TARGET_ATTACK_SCRIPTS,
  ...REVIEWED_SINGLE_TARGET_CONDITION_SCRIPTS,
  ...REVIEWED_SINGLE_TARGET_STATUS_SCRIPTS,
  ...REVIEWED_SINGLE_TARGET_STAGE_SCRIPTS,
  ...REVIEWED_ADDITIONAL_SINGLE_TARGET_SCRIPTS,
  ...REVIEWED_SELF_SCRIPTS,
  ...SEAMLESS_AREA_CONFIRMATION_SCRIPTS,
  ...REVIEWED_DIRECT_HP_LOSS_SCRIPTS,
])

export const moveAutomationCoverage = {
  canonicalMoveCount: moves.length,
  explicitScriptCount: EXPLICIT_MOVE_AUTOMATION_SCRIPTS.size,
  missing: moves
    .filter((move) => !EXPLICIT_MOVE_AUTOMATION_SCRIPTS.has(move.name))
    .map((move) => move.name),
}

export const explicitScriptForMove = (moveName: string): MoveAutomationScript | null => {
  const direct = EXPLICIT_MOVE_AUTOMATION_SCRIPTS.get(moveName)
  if (direct) return direct

  const canonical = findMove(moveName)
  return canonical ? EXPLICIT_MOVE_AUTOMATION_SCRIPTS.get(canonical.name) ?? null : null
}
