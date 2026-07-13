import { createHash } from 'node:crypto'
import type {
  MoveCombatStageEffectOperation,
  MoveConditionEffectOperation,
  MoveEffectOperation,
  MoveLogEffectOperation,
} from '#shared/moveAutomation/effects'
import { parseMoveEffectOperation } from '#shared/moveAutomation/effects'
import type { PendingMoveResponseWindow } from '#shared/moveAutomation/pendingResolution'
import type { AuthoritativeMoveRulesContext } from './context'
import { stableJsonStringify } from './stableJson'

export const ABILITY_FOLLOW_UP_PROGRAM_VERSION = 1 as const

export const ABILITY_FOLLOW_UP_KINDS = [
  'moxie',
  'celebrate',
  'cute-charm',
  'poison-point',
  'spite',
] as const

export type AbilityFollowUpKind = (typeof ABILITY_FOLLOW_UP_KINDS)[number]

export type AbilityFollowUpEffectKind =
  | 'raise-attack'
  | 'celebrate-log'
  | 'apply-infatuation'
  | 'apply-poison'
  | 'disable-provoking-move'

export interface AbilityFollowUpResponseSpec {
  readonly kind: AbilityFollowUpKind
  readonly displayName: string
  readonly reasonCode: string
  readonly promptKey: string
  readonly optionId: string
  readonly optionLabelKey: string
  readonly priority: number
  readonly effect: AbilityFollowUpEffectKind
}

/**
 * Reviewed response-window definitions for the five legacy browser follow-ups.
 * The durable window stores only these stable identities; mechanics are looked
 * up again from this server-owned registry when an authorized response arrives.
 */
export const ABILITY_FOLLOW_UP_RESPONSE_SPECS: readonly AbilityFollowUpResponseSpec[] = Object.freeze([
  Object.freeze({
    kind: 'moxie',
    displayName: 'Moxie',
    reasonCode: 'ability.moxie.follow-up',
    promptKey: 'ability.moxie.raise-attack-after-faint',
    optionId: 'ability.moxie.apply',
    optionLabelKey: 'ability.moxie.raise-attack',
    priority: 500,
    effect: 'raise-attack',
  }),
  Object.freeze({
    kind: 'celebrate',
    displayName: 'Celebrate',
    reasonCode: 'ability.celebrate.follow-up',
    promptKey: 'ability.celebrate.disengage-after-hit',
    optionId: 'ability.celebrate.apply',
    optionLabelKey: 'ability.celebrate.use-celebrate',
    priority: 400,
    effect: 'celebrate-log',
  }),
  Object.freeze({
    kind: 'cute-charm',
    displayName: 'Cute Charm',
    reasonCode: 'ability.cute-charm.follow-up',
    promptKey: 'ability.cute-charm.infatuate-attacker',
    optionId: 'ability.cute-charm.apply',
    optionLabelKey: 'ability.cute-charm.apply-infatuation',
    priority: 300,
    effect: 'apply-infatuation',
  }),
  Object.freeze({
    kind: 'poison-point',
    displayName: 'Poison Point',
    reasonCode: 'ability.poison-point.follow-up',
    promptKey: 'ability.poison-point.poison-attacker',
    optionId: 'ability.poison-point.apply',
    optionLabelKey: 'ability.poison-point.apply-poison',
    priority: 200,
    effect: 'apply-poison',
  }),
  Object.freeze({
    kind: 'spite',
    displayName: 'Spite',
    reasonCode: 'move.spite.follow-up',
    promptKey: 'move.spite.disable-provoking-move',
    optionId: 'move.spite.apply',
    optionLabelKey: 'move.spite.disable-move',
    priority: 100,
    effect: 'disable-provoking-move',
  }),
])

const SPEC_BY_REASON = new Map(
  ABILITY_FOLLOW_UP_RESPONSE_SPECS.map(spec => [spec.reasonCode, spec]),
)
const SPEC_BY_KIND = new Map(
  ABILITY_FOLLOW_UP_RESPONSE_SPECS.map(spec => [spec.kind, spec]),
)

export const ABILITY_FOLLOW_UP_DEFINITION_HASH = createHash('sha256')
  .update(stableJsonStringify({
    version: ABILITY_FOLLOW_UP_PROGRAM_VERSION,
    specs: ABILITY_FOLLOW_UP_RESPONSE_SPECS,
  }))
  .digest('hex')

export const abilityFollowUpSpecForKind = (
  kind: AbilityFollowUpKind,
): AbilityFollowUpResponseSpec => SPEC_BY_KIND.get(kind)
  ?? (() => { throw new Error(`Unknown ability follow-up kind ${kind}.`) })()

export const abilityFollowUpSpecForWindow = (
  window: PendingMoveResponseWindow,
): AbilityFollowUpResponseSpec | null => SPEC_BY_REASON.get(window.reasonCode) ?? null

const operationSource = (window: PendingMoveResponseWindow) => ({
  kind: 'operation' as const,
  id: window.operationId,
})

const commonEffect = (window: PendingMoveResponseWindow) => ({
  id: `${window.operationId}.effect`,
  source: operationSource(window),
  recipients: { kind: 'actor' as const },
  phase: 'cleanup' as const,
  reasonCode: `${window.reasonCode}.applied`,
})

const conditionPayload = (
  conditionId: 'disabled' | 'infatuation' | 'poisoned',
  conditionDetail?: string,
): MoveConditionEffectOperation['payload'] => ({
  action: 'apply',
  conditionId,
  ...(conditionDetail ? { conditionDetail } : {}),
  conditionSource: null,
  filter: null,
  randomChoice: null,
  duration: null,
  saveTiming: 'canonical',
  stackPolicy: { kind: 'refresh', maxStacks: null },
})

const effectOperation = (input: {
  readonly spec: AbilityFollowUpResponseSpec
  readonly window: PendingMoveResponseWindow
  readonly canonicalMoveId: string
  readonly context: AuthoritativeMoveRulesContext
}): MoveEffectOperation | null => {
  const common = commonEffect(input.window)
  if (input.spec.effect === 'raise-attack') {
    return {
      ...common,
      kind: 'combat-stage',
      payload: {
        action: 'modify',
        stage: 'atk',
        selectedStage: null,
        value: 1,
        stageSource: null,
        rounding: null,
      },
    } satisfies MoveCombatStageEffectOperation
  }
  if (input.spec.effect === 'celebrate-log') return null
  if (input.spec.effect === 'apply-poison') {
    return {
      ...common,
      kind: 'condition',
      payload: conditionPayload('poisoned'),
    } satisfies MoveConditionEffectOperation
  }
  if (input.spec.effect === 'disable-provoking-move') {
    return {
      ...common,
      kind: 'condition',
      payload: conditionPayload('disabled', input.canonicalMoveId),
    } satisfies MoveConditionEffectOperation
  }

  const owner = input.window.ownership.find(candidate => (
    candidate.kind === 'placement' && candidate.id !== null
  ))
  const defenderName = owner?.id
    ? input.context.queries.tokens.get(owner.id)?.species ?? null
    : null
  if (!defenderName) {
    throw new Error('Cute Charm follow-up lost its authoritative defender identity.')
  }
  return {
    ...common,
    kind: 'condition',
    payload: conditionPayload('infatuation', defenderName),
  } satisfies MoveConditionEffectOperation
}

const logOperation = (input: {
  readonly spec: AbilityFollowUpResponseSpec
  readonly window: PendingMoveResponseWindow
  readonly canonicalMoveId: string
}): MoveLogEffectOperation => ({
  id: `${input.window.operationId}.log`,
  kind: 'log',
  source: operationSource(input.window),
  recipients: { kind: 'none' },
  phase: 'cleanup',
  reasonCode: `${input.window.reasonCode}.logged`,
  payload: {
    messageKey: input.spec.promptKey,
    arguments: [
      { key: 'ability', value: input.spec.displayName },
      { key: 'move', value: input.canonicalMoveId },
    ],
  },
})

/** Build only reviewed, strictly parsed operations for one selected option. */
export const buildAbilityFollowUpEffectOperations = (input: {
  readonly window: PendingMoveResponseWindow
  readonly optionId: string
  readonly canonicalMoveId: string
  readonly context: AuthoritativeMoveRulesContext
}): readonly MoveEffectOperation[] => {
  const spec = abilityFollowUpSpecForWindow(input.window)
  if (!spec || input.optionId !== spec.optionId) {
    throw new Error('The durable ability follow-up option has no reviewed server definition.')
  }
  const effect = effectOperation({ ...input, spec })
  return Object.freeze([
    ...(effect ? [parseMoveEffectOperation(effect, 'abilityFollowUp.effect')] : []),
    parseMoveEffectOperation(logOperation({ ...input, spec }), 'abilityFollowUp.log'),
  ])
}
