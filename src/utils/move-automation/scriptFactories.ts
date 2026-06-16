import { findMove } from '~~/data/ptuReference'
import { createMoveAutomationScriptFromMoveData } from '~/utils/moveAutomationDerived'
import type { CombatStageKey } from '~/types/combatStages'
import type { MoveAutomationScript } from '~/types/moveAutomation'

export const defineExplicitMoveScript = (script: Omit<MoveAutomationScript, 'kind'>): MoveAutomationScript => ({
  ...script,
  kind: 'explicit',
})

export type ReviewedMoveScriptOverrides = Partial<Omit<MoveAutomationScript, 'kind' | 'moveName' | 'version'>>

export type ReviewedTargetStageDefinition = {
  key: CombatStageKey
  delta: number
  label: string
  threshold?: string
  optional?: boolean
}

export type ReviewedTargetConditionDefinition = {
  condition: string
  label: string
  threshold?: string
  optional?: boolean
  applyWhen?: MoveAutomationScript['conditionSuggestions'][number]['applyWhen']
}

export const reviewedMoveScriptFromCanonical = (
  moveName: string,
  version = 1,
  overrides: ReviewedMoveScriptOverrides = {},
): MoveAutomationScript => {
  const move = findMove(moveName)
  if (!move) throw new Error(`Missing canonical PTU move data for ${moveName}`)
  const derivedScript = createMoveAutomationScriptFromMoveData(move)
  return defineExplicitMoveScript({
    moveName: derivedScript.moveName,
    version,
    targetMode: derivedScript.targetMode,
    targetCount: derivedScript.targetCount,
    damaging: derivedScript.damaging,
    requiresAccuracy: derivedScript.requiresAccuracy,
    damageBase: derivedScript.damageBase,
    damageClass: derivedScript.damageClass,
    type: derivedScript.type,
    ac: derivedScript.ac,
    range: derivedScript.range,
    effect: derivedScript.effect,
    special: derivedScript.special,
    keywords: derivedScript.keywords,
    criticalRange: derivedScript.criticalRange,
    areaTemplates: derivedScript.areaTemplates,
    conditionSuggestions: derivedScript.conditionSuggestions,
    stageSuggestions: derivedScript.stageSuggestions,
    hpSuggestions: derivedScript.hpSuggestions,
    fieldSuggestions: derivedScript.fieldSuggestions,
    hazardSuggestions: derivedScript.hazardSuggestions,
    automationNotes: [],
    ...overrides,
  })
}

export const targetStageSuggestions = (stages: readonly ReviewedTargetStageDefinition[]): MoveAutomationScript['stageSuggestions'] =>
  stages.map((stage) => ({
    recipient: 'target',
    key: stage.key,
    delta: stage.delta,
    label: stage.label,
    ...(stage.threshold ? { threshold: stage.threshold, optional: stage.optional ?? true } : {}),
    ...(!stage.threshold && stage.optional != null ? { optional: stage.optional } : {}),
  }))

export const userStageSuggestions = (stages: readonly ReviewedTargetStageDefinition[]): MoveAutomationScript['stageSuggestions'] =>
  stages.map((stage) => ({
    recipient: 'user',
    key: stage.key,
    delta: stage.delta,
    label: stage.label,
    ...(stage.threshold ? { threshold: stage.threshold, optional: stage.optional ?? true } : {}),
    ...(!stage.threshold && stage.optional != null ? { optional: stage.optional } : {}),
  }))

export const targetConditionSuggestions = (conditions: readonly ReviewedTargetConditionDefinition[]): MoveAutomationScript['conditionSuggestions'] =>
  conditions.map((condition) => ({
    recipient: 'target',
    condition: condition.condition,
    action: 'add',
    label: condition.label,
    ...(condition.threshold ? { threshold: condition.threshold, optional: condition.optional ?? true } : {}),
    ...(!condition.threshold && condition.optional != null ? { optional: condition.optional } : {}),
    ...(condition.applyWhen ? { applyWhen: condition.applyWhen } : {}),
  }))

export const areaAutomationNotes = (): string[] => [
  'Use the area-template buttons to choose affected legal targets, or select targets manually.',
]

export const passAutomationNotes = (): string[] => [
  'Pass previews the farthest legal empty end square in each direction, then attacks each token in the crossed squares once.',
  'The user is moved to the previewed Pass end square after the automated attack resolves; foes are treated as passable for the dash.',
]

export const passAreaTemplate = (): MoveAutomationScript['areaTemplates'] => [{ kind: 'pass', size: 4, label: 'Pass 4' }]

export const reviewedPassAttackScript = (
  moveName: string,
  version = 1,
  overrides: ReviewedMoveScriptOverrides = {},
): MoveAutomationScript => reviewedMoveScriptFromCanonical(moveName, version, {
  targetMode: 'multi-target',
  targetCount: null,
  areaTemplates: passAreaTemplate(),
  automationNotes: passAutomationNotes(),
  ...overrides,
})

export const reviewedPassConditionScript = (
  moveName: string,
  conditions: readonly ReviewedTargetConditionDefinition[],
  version = 1,
  overrides: ReviewedMoveScriptOverrides = {},
): MoveAutomationScript => reviewedPassAttackScript(moveName, version, {
  conditionSuggestions: targetConditionSuggestions(conditions),
  ...overrides,
})

export const reviewedSingleTargetAttackScript = (moveName: string, version = 1): MoveAutomationScript =>
  reviewedMoveScriptFromCanonical(moveName, version, {
    targetMode: 'one-target',
    targetCount: 1,
  })

export const reviewedSingleTargetStatusScript = reviewedSingleTargetAttackScript

export const reviewedSingleTargetConditionScript = (
  moveName: string,
  conditions: readonly ReviewedTargetConditionDefinition[],
  version = 1,
  overrides: ReviewedMoveScriptOverrides = {},
): MoveAutomationScript => reviewedMoveScriptFromCanonical(moveName, version, {
  targetMode: 'one-target',
  targetCount: 1,
  conditionSuggestions: targetConditionSuggestions(conditions),
  ...overrides,
})

export const reviewedSingleTargetConditionAndStageScript = (
  moveName: string,
  conditions: readonly ReviewedTargetConditionDefinition[],
  stages: readonly ReviewedTargetStageDefinition[],
  version = 1,
  overrides: ReviewedMoveScriptOverrides = {},
): MoveAutomationScript => reviewedMoveScriptFromCanonical(moveName, version, {
  targetMode: 'one-target',
  targetCount: 1,
  conditionSuggestions: targetConditionSuggestions(conditions),
  stageSuggestions: targetStageSuggestions(stages),
  ...overrides,
})

export const reviewedSingleTargetStageScript = (
  moveName: string,
  stages: readonly ReviewedTargetStageDefinition[],
  version = 1,
): MoveAutomationScript => reviewedMoveScriptFromCanonical(moveName, version, {
  targetMode: 'one-target',
  targetCount: 1,
  stageSuggestions: targetStageSuggestions(stages),
})

export const reviewedSelfStageScript = (
  moveName: string,
  stages: readonly ReviewedTargetStageDefinition[],
  version = 1,
  overrides: ReviewedMoveScriptOverrides = {},
): MoveAutomationScript => reviewedMoveScriptFromCanonical(moveName, version, {
  targetMode: 'self',
  targetCount: 1,
  requiresAccuracy: false,
  stageSuggestions: userStageSuggestions(stages),
  ...overrides,
})

export const reviewedAreaConfirmationScript = (
  moveName: string,
  version = 1,
  overrides: ReviewedMoveScriptOverrides = {},
): MoveAutomationScript => {
  const script = reviewedMoveScriptFromCanonical(moveName, version, {
    targetMode: 'multi-target',
    targetCount: null,
    ...overrides,
  })
  return {
    ...script,
    automationNotes: overrides.automationNotes ?? areaAutomationNotes(),
  }
}

export const reviewedAreaConditionScript = (
  moveName: string,
  conditions: readonly ReviewedTargetConditionDefinition[],
  version = 1,
): MoveAutomationScript => reviewedAreaConfirmationScript(moveName, version, {
  conditionSuggestions: targetConditionSuggestions(conditions),
})

export const reviewedTargetStagesAreaScript = (
  moveName: string,
  stages: readonly ReviewedTargetStageDefinition[],
  version = 1,
): MoveAutomationScript => reviewedAreaConfirmationScript(moveName, version, {
  stageSuggestions: targetStageSuggestions(stages),
})

export const reviewedTargetStageAreaScript = (
  moveName: string,
  key: 'atk' | 'def',
  label: string,
  version = 1,
): MoveAutomationScript => reviewedTargetStagesAreaScript(moveName, [{ key, delta: -1, label }], version)


export const reviewedFiveStrikeScript = (moveName: string, version = 1): MoveAutomationScript => reviewedMoveScriptFromCanonical(moveName, version, {
  targetMode: 'one-target',
  targetCount: 1,
  dynamicDamageBase: {
    kind: 'five-strike',
    rollFormula: '1d8',
    label: `${moveName} Five Strike`,
  },
  automationNotes: [
    'Five Strike is rolled automatically after a hit: 1=one hit, 2-3=two hits, 4-6=three hits, 7=four hits, 8=five hits.',
    'STAB is applied after strike-count Damage Base multiplication.',
    'Technician and other non-STAB Damage Base modifiers are not inferred; adjust the move before use if they apply.',
  ],
})

export const reviewedDoubleStrikeScript = (moveName: string, version = 1): MoveAutomationScript => reviewedMoveScriptFromCanonical(moveName, version, {
  targetMode: 'one-target',
  targetCount: 1,
  dynamicDamageBase: {
    kind: 'double-strike',
    label: `${moveName} Double Strike`,
  },
  automationNotes: [
    'Double Strike rolls two Accuracy Rolls automatically: one hit uses the base Damage Base; two hits double the Damage Base.',
    'Each hit can crit separately; critical bonus damage is rolled from the Move’s base Damage Base before doubling.',
    'STAB is applied after Double Strike Damage Base multiplication.',
  ],
})

export const reviewedPowerTripScript = (version = 1): MoveAutomationScript => reviewedMoveScriptFromCanonical('Power Trip', version, {
  targetMode: 'one-target',
  targetCount: 1,
  dynamicDamageBase: {
    kind: 'positive-combat-stage-scaling',
    dbPerPositiveStage: 2,
    maxDamageBase: 20,
    label: 'Power Trip Damage Base scaling',
  },
  automationNotes: [
    'Power Trip recalculates Damage Base from the user’s current positive Combat Stages at resolution time.',
    'The Power Trip bonus caps at DB 20 before this automation applies STAB.',
  ],
})
