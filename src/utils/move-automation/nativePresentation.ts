import { findMove } from '~~/data/ptuReference'
import {
  DARK_VOID_BURST_BRANCH_ID,
  DARK_VOID_SINGLE_TARGET_BRANCH_ID,
} from '#shared/moveAutomation/canonicalMoveBranches'
import { reviewedMoveScriptFromCanonical } from '~/utils/move-automation/scriptFactories'
import { createMoveAutomationScriptFromMoveData } from '~/utils/moveAutomationDerived'
import { findMoveAutomationSemanticStatus } from '~/utils/moveAutomationSemanticStatus'
import type { MoveAutomationScript } from '~/types/moveAutomation'

export {
  DARK_VOID_BURST_BRANCH_ID,
  DARK_VOID_SINGLE_TARGET_BRANCH_ID,
} from '#shared/moveAutomation/canonicalMoveBranches'

const reviewedDarkVoidPresentation = (): MoveAutomationScript => reviewedMoveScriptFromCanonical(
  'Dark Void',
  2,
  {
    targetMode: 'one-target',
    targetCount: 1,
    areaTemplates: [],
    targetBranches: [{
      id: DARK_VOID_SINGLE_TARGET_BRANCH_ID,
      label: 'Melee 1 — 1 Target',
      targetMode: 'one-target',
      targetCount: 1,
      range: 'Melee 1',
    }, {
      id: DARK_VOID_BURST_BRANCH_ID,
      label: 'Burst 5, Friendly — Once per Scene',
      targetMode: 'multi-target',
      targetCount: null,
      range: 'Burst 5, Friendly',
      areaTemplates: [{ kind: 'burst', size: 5, label: 'Burst 5' }],
    }],
    automationNotes: [],
  },
)

const NATIVE_PRESENTATION_OVERRIDES: ReadonlyMap<string, MoveAutomationScript> = new Map([
  ['Dark Void', reviewedDarkVoidPresentation()],
])

const cloneScript = (script: MoveAutomationScript): MoveAutomationScript => (
  JSON.parse(JSON.stringify(script)) as MoveAutomationScript
)

/**
 * Return browser-safe intent/presentation metadata for a manifest-selected
 * native runtime. Mechanics remain exclusively server-owned by the MoveSpec.
 */
export const nativeMoveAutomationPresentationScriptForMove = (
  moveName: string,
): MoveAutomationScript | null => {
  const canonical = findMove(moveName)
  if (!canonical) return null
  const status = findMoveAutomationSemanticStatus(canonical.name)
  if (!status || status.runtimeKind !== 'movespec-v2' || status.baseStatus === 'blocked') {
    return null
  }
  const override = NATIVE_PRESENTATION_OVERRIDES.get(canonical.name)
  return cloneScript(override ?? createMoveAutomationScriptFromMoveData(canonical))
}

export const hasNativeMoveAutomationPresentation = (
  moveName: string,
): boolean => nativeMoveAutomationPresentationScriptForMove(moveName) !== null
