import type { CombatStageKey } from '~/types/combatStages'
import type { GridAnchor } from '~/types/pokemon'

export const MOVE_AUTOMATION_OVERLAY_TITLE_ID = 'move-automation-title'

export const MOVE_AUTOMATION_FIRST_STEP = 0
export const MOVE_AUTOMATION_REVIEW_STEP = 2

export const createMoveAutomationStageDeltaRecord = (): Record<CombatStageKey, number> => ({
  atk: 0,
  def: 0,
  satk: 0,
  sdef: 0,
  spd: 0,
  acc: 0,
})

export interface MoveAutomationWizardContinueInput {
  step: number
  hasSelectedMove: boolean
  requiresTargets: boolean
  selectedTargetCount: number
}

export const canContinueMoveAutomationWizard = ({
  step,
  hasSelectedMove,
  requiresTargets,
  selectedTargetCount,
}: MoveAutomationWizardContinueInput): boolean => {
  if (step === MOVE_AUTOMATION_FIRST_STEP) return hasSelectedMove
  if (step === 1 && requiresTargets) return selectedTargetCount > 0
  return true
}

export const nextMoveAutomationWizardStep = (
  currentStep: number,
  canContinue: boolean,
  maxStep = MOVE_AUTOMATION_REVIEW_STEP,
): number => {
  if (!canContinue) return currentStep
  return Math.min(maxStep, currentStep + 1)
}

export const previousMoveAutomationWizardStep = (
  currentStep: number,
  minStep = MOVE_AUTOMATION_FIRST_STEP,
): number => Math.max(minStep, currentStep - 1)

export const formatMoveAutomationHazardCellLine = (position: GridAnchor): string =>
  `${position.x}, ${position.y}, ${position.z}`

export const appendMoveAutomationHazardCellText = (
  currentText: string,
  position: GridAnchor,
): string => {
  const line = formatMoveAutomationHazardCellLine(position)
  const trimmed = currentText.trim()
  return trimmed ? `${trimmed}\n${line}` : line
}
