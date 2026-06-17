import { parseMoveAutomationAreaTemplates } from '~/utils/moveAutomationAreaTemplates'
import { buildMoveAutomationRangeKeywords } from '~/utils/moveAutomationTargeting'
import type {
  MoveAutomationAreaTemplate,
  MoveAutomationScript,
  MoveAutomationTargetBranch,
  MoveAutomationTargetMode,
} from '~/types/moveAutomation'

export const IMPLICIT_MOVE_AUTOMATION_TARGET_BRANCH_ID = 'implicit'

const isTargetBranchMode = (mode: MoveAutomationTargetMode): mode is MoveAutomationTargetBranch['targetMode'] =>
  mode === 'one-target' || mode === 'multi-target'

const cloneAreaTemplates = (areaTemplates: readonly MoveAutomationAreaTemplate[]): MoveAutomationAreaTemplate[] =>
  areaTemplates.map((template) => ({ ...template }))

const areaTemplatesForBranch = (branch: MoveAutomationTargetBranch): MoveAutomationAreaTemplate[] =>
  branch.areaTemplates != null
    ? cloneAreaTemplates(branch.areaTemplates)
    : parseMoveAutomationAreaTemplates(branch.range)

const cloneTargetBranch = (branch: MoveAutomationTargetBranch): MoveAutomationTargetBranch => ({
  ...branch,
  ...(branch.areaTemplates != null ? { areaTemplates: cloneAreaTemplates(branch.areaTemplates) } : {}),
})

export const implicitMoveAutomationTargetBranch = (
  script: Pick<MoveAutomationScript, 'targetMode' | 'targetCount' | 'range' | 'areaTemplates'> | null | undefined,
): MoveAutomationTargetBranch | null => {
  if (!script || !isTargetBranchMode(script.targetMode)) return null

  return {
    id: IMPLICIT_MOVE_AUTOMATION_TARGET_BRANCH_ID,
    label: script.range || 'Default targeting',
    targetMode: script.targetMode,
    targetCount: script.targetCount,
    range: script.range,
    areaTemplates: script.areaTemplates != null
      ? cloneAreaTemplates(script.areaTemplates)
      : parseMoveAutomationAreaTemplates(script.range),
  }
}

export const moveAutomationTargetBranches = (
  script: Pick<MoveAutomationScript, 'targetMode' | 'targetCount' | 'range' | 'areaTemplates' | 'targetBranches'> | null | undefined,
): MoveAutomationTargetBranch[] => {
  if (!script) return []
  if (script.targetBranches?.length) return script.targetBranches.map(cloneTargetBranch)

  const implicitBranch = implicitMoveAutomationTargetBranch(script)
  return implicitBranch ? [implicitBranch] : []
}

export const moveAutomationHasMultipleTargetBranches = (
  script: Pick<MoveAutomationScript, 'targetMode' | 'targetCount' | 'range' | 'areaTemplates' | 'targetBranches'> | null | undefined,
): boolean => moveAutomationTargetBranches(script).length > 1

export const moveAutomationScriptForTargetBranch = (
  script: MoveAutomationScript,
  branchIdOrBranch: string | MoveAutomationTargetBranch,
): MoveAutomationScript | null => {
  const branch = typeof branchIdOrBranch === 'string'
    ? moveAutomationTargetBranches(script).find((item) => item.id === branchIdOrBranch) ?? null
    : branchIdOrBranch
  if (!branch) return null

  return {
    ...script,
    targetMode: branch.targetMode,
    targetCount: branch.targetCount,
    range: branch.range,
    keywords: buildMoveAutomationRangeKeywords(branch.range),
    areaTemplates: areaTemplatesForBranch(branch),
    ...(script.targetBranches != null ? { targetBranches: script.targetBranches.map(cloneTargetBranch) } : {}),
  }
}
