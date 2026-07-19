import { findMove } from '~~/data/ptuReference'
import {
  DARK_VOID_BURST_BRANCH_ID,
  DARK_VOID_SINGLE_TARGET_BRANCH_ID,
  FIERY_WRATH_DARK_BRANCH_ID,
  FIERY_WRATH_FIRE_BRANCH_ID,
  FREEZING_GLARE_ICE_BRANCH_ID,
  FREEZING_GLARE_PSYCHIC_BRANCH_ID,
} from '#shared/moveAutomation/canonicalMoveBranches'
import { reviewedMoveScriptFromCanonical } from '~/utils/move-automation/scriptFactories'
import { createMoveAutomationScriptFromMoveData } from '~/utils/moveAutomationDerived'
import { findMoveAutomationSemanticStatus } from '~/utils/moveAutomationSemanticStatus'
import type { MoveAutomationScript } from '~/types/moveAutomation'

export {
  DARK_VOID_BURST_BRANCH_ID,
  DARK_VOID_SINGLE_TARGET_BRANCH_ID,
  FIERY_WRATH_DARK_BRANCH_ID,
  FIERY_WRATH_FIRE_BRANCH_ID,
  FREEZING_GLARE_ICE_BRANCH_ID,
  FREEZING_GLARE_PSYCHIC_BRANCH_ID,
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

const reviewedAlternateTypePresentation = (input: {
  readonly canonicalId: 'Fiery Wrath' | 'Freezing Glare'
  readonly baseBranchId: string
  readonly baseType: string
  readonly alternateBranchId: string
  readonly alternateType: string
}): MoveAutomationScript => reviewedMoveScriptFromCanonical(
  input.canonicalId,
  2,
  {
    targetMode: 'one-target',
    targetCount: 1,
    targetBranches: [{
      id: input.baseBranchId,
      label: `${input.baseType} Type`,
      targetMode: 'one-target',
      targetCount: 1,
      range: '6',
    }, {
      id: input.alternateBranchId,
      label: `${input.alternateType} Type — Once per Scene`,
      targetMode: 'one-target',
      targetCount: 1,
      range: '6',
    }],
    automationNotes: [],
  },
)

const NATIVE_PRESENTATION_OVERRIDES: ReadonlyMap<string, MoveAutomationScript> = new Map([
  ['Dark Void', reviewedDarkVoidPresentation()],
  ['Fiery Wrath', reviewedAlternateTypePresentation({
    canonicalId: 'Fiery Wrath',
    baseBranchId: FIERY_WRATH_DARK_BRANCH_ID,
    baseType: 'Dark',
    alternateBranchId: FIERY_WRATH_FIRE_BRANCH_ID,
    alternateType: 'Fire',
  })],
  ['Freezing Glare', reviewedAlternateTypePresentation({
    canonicalId: 'Freezing Glare',
    baseBranchId: FREEZING_GLARE_PSYCHIC_BRANCH_ID,
    baseType: 'Psychic',
    alternateBranchId: FREEZING_GLARE_ICE_BRANCH_ID,
    alternateType: 'Ice',
  })],
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
  const presentation = override ?? createMoveAutomationScriptFromMoveData(canonical)
  return cloneScript(status.baseStatus === 'complete'
    ? { ...presentation, automationNotes: [] }
    : presentation)
}

export const hasNativeMoveAutomationPresentation = (
  moveName: string,
): boolean => nativeMoveAutomationPresentationScriptForMove(moveName) !== null
