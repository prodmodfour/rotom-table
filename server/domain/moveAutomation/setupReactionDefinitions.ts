import { createHash } from 'node:crypto'
import type { MoveReactionTiming } from '#shared/moveAutomation/reactions'
import { MOVE_SHIELD_GUARD_BREAK_PRIORITY } from './shieldReactionDefinitions'
import { stableJsonStringify } from './stableJson'

export const MOVE_SETUP_REACTION_PROGRAM_VERSION = 1 as const
export const MOVE_SETUP_REACTION_PRIORITY = 600 as const
export const MOVE_REDIRECTION_PRIORITY = 300 as const
export const MOVE_SONIC_CANCELLATION_PRIORITY = 900 as const

export type MoveSetupReactionCanonicalId =
  | 'Focus Punch'
  | 'Beak Blast'
  | 'Shell Trap'
  | 'Follow Me'
  | 'Rage Powder'
  | 'Feint'
  | 'Pursuit'
  | 'Drown Out'

interface MoveSetupReactionDefinitionBase {
  readonly canonicalId: MoveSetupReactionCanonicalId
  readonly definitionId: string
  readonly version: typeof MOVE_SETUP_REACTION_PROGRAM_VERSION
  readonly sourceKind: 'move' | 'ability'
}

export interface MoveRoundSetupReactionDefinition
  extends MoveSetupReactionDefinitionBase {
  readonly family: 'round-setup'
  readonly canonicalId: 'Focus Punch' | 'Beak Blast'
  readonly declarationTiming: Extract<MoveReactionTiming, 'declare'>
  readonly executionBoundary: 'round-end'
  readonly cancellation:
    | {
        readonly kind: 'single-damaging-hit-percent-max'
        readonly percent: 25
        readonly dropDeferredUsage: true
      }
    | null
  readonly meleeRetaliation: 'burn-attacker' | null
  readonly usageResourceId: string
  readonly executePromptKey: string
  readonly executeOptionId: string
  readonly executeOptionLabelKey: string
}

export interface MoveHitTriggeredReactionDefinition
  extends MoveSetupReactionDefinitionBase {
  readonly family: 'hit-triggered-child'
  readonly canonicalId: 'Shell Trap'
  readonly timing: Extract<MoveReactionTiming, 'post-hit'>
  readonly priority: typeof MOVE_SETUP_REACTION_PRIORITY
  readonly requiresMelee: true
  readonly childSource: 'reactor'
  readonly childTarget: 'triggering-attacker'
  readonly usageResourceId: string
  readonly promptKey: string
  readonly optionId: string
  readonly optionLabelKey: string
}

export interface MoveTargetRedirectionReactionDefinition
  extends MoveSetupReactionDefinitionBase {
  readonly family: 'target-redirection'
  readonly canonicalId: 'Follow Me' | 'Rage Powder'
  readonly timing: Extract<MoveReactionTiming, 'target'>
  readonly priority: typeof MOVE_REDIRECTION_PRIORITY
  readonly affectedActorRelation: 'enemy'
  readonly moveTargetClass: 'opponents'
  readonly requiresRedirectorInReach: boolean
  readonly requiresShiftTowardRedirector: boolean
  readonly expiry: 'source-next-turn-or-leaves' | 'source-leaves'
}

export interface MovePlanCancellationReactionDefinition
  extends MoveSetupReactionDefinitionBase {
  readonly family: 'plan-cancellation'
  readonly canonicalId: 'Feint' | 'Drown Out'
  readonly timing: Extract<MoveReactionTiming, 'declare' | 'target'>
  readonly priority:
    | typeof MOVE_SHIELD_GUARD_BREAK_PRIORITY
    | typeof MOVE_SONIC_CANCELLATION_PRIORITY
  readonly triggeringKeyword: 'shield' | 'sonic'
  readonly reactorRelation: 'triggering-action-source' | 'enemy'
  readonly retainTriggeringUsage: true
  readonly usageResourceId: string
  readonly promptKey: string
  readonly optionId: string
  readonly optionLabelKey: string
}

export interface MoveSwitchInterruptReactionDefinition
  extends MoveSetupReactionDefinitionBase {
  readonly family: 'switch-interrupt'
  readonly canonicalId: 'Pursuit'
  readonly timing: Extract<MoveReactionTiming, 'switch'>
  readonly priority: typeof MOVE_SETUP_REACTION_PRIORITY
  readonly target: 'recalled-enemy'
  readonly damageBaseOverride: 8
  readonly movementSpeedBonus: 5
  readonly usageResourceId: string
  readonly promptKey: string
  readonly optionId: string
  readonly optionLabelKey: string
}

export type MoveSetupReactionDefinition =
  | MoveRoundSetupReactionDefinition
  | MoveHitTriggeredReactionDefinition
  | MoveTargetRedirectionReactionDefinition
  | MovePlanCancellationReactionDefinition
  | MoveSwitchInterruptReactionDefinition

const complete = <const Definition extends Omit<MoveSetupReactionDefinition, 'version'>>(
  definition: Definition,
): Definition & { readonly version: typeof MOVE_SETUP_REACTION_PROGRAM_VERSION } => Object.freeze({
  ...definition,
  version: MOVE_SETUP_REACTION_PROGRAM_VERSION,
})

/**
 * Reviewed engine canaries only. Phase 9 owns runtime registration and semantic
 * promotion for the moves; Drown Out remains an ability interaction boundary.
 */
export const MOVE_SETUP_REACTION_DEFINITIONS: readonly MoveSetupReactionDefinition[] = Object.freeze([
  complete({
    canonicalId: 'Focus Punch',
    definitionId: 'focus-punch',
    sourceKind: 'move',
    family: 'round-setup',
    declarationTiming: 'declare',
    executionBoundary: 'round-end',
    cancellation: Object.freeze({
      kind: 'single-damaging-hit-percent-max',
      percent: 25,
      dropDeferredUsage: true,
    }),
    meleeRetaliation: null,
    usageResourceId: 'focus-punch.frequency-use',
    executePromptKey: 'move.focus-punch.execute-response',
    executeOptionId: 'move.focus-punch.execute',
    executeOptionLabelKey: 'move.focus-punch.execute-now',
  }),
  complete({
    canonicalId: 'Beak Blast',
    definitionId: 'beak-blast',
    sourceKind: 'move',
    family: 'round-setup',
    declarationTiming: 'declare',
    executionBoundary: 'round-end',
    cancellation: null,
    meleeRetaliation: 'burn-attacker',
    usageResourceId: 'beak-blast.frequency-use',
    executePromptKey: 'move.beak-blast.execute-response',
    executeOptionId: 'move.beak-blast.execute',
    executeOptionLabelKey: 'move.beak-blast.execute-now',
  }),
  complete({
    canonicalId: 'Shell Trap',
    definitionId: 'shell-trap',
    sourceKind: 'move',
    family: 'hit-triggered-child',
    timing: 'post-hit',
    priority: MOVE_SETUP_REACTION_PRIORITY,
    requiresMelee: true,
    childSource: 'reactor',
    childTarget: 'triggering-attacker',
    usageResourceId: 'shell-trap.frequency-use',
    promptKey: 'move.shell-trap.reaction-response',
    optionId: 'move.shell-trap.use',
    optionLabelKey: 'move.shell-trap.use-interrupt',
  }),
  complete({
    canonicalId: 'Follow Me',
    definitionId: 'follow-me',
    sourceKind: 'move',
    family: 'target-redirection',
    timing: 'target',
    priority: MOVE_REDIRECTION_PRIORITY,
    affectedActorRelation: 'enemy',
    moveTargetClass: 'opponents',
    requiresRedirectorInReach: false,
    requiresShiftTowardRedirector: false,
    expiry: 'source-next-turn-or-leaves',
  }),
  complete({
    canonicalId: 'Rage Powder',
    definitionId: 'rage-powder',
    sourceKind: 'move',
    family: 'target-redirection',
    timing: 'target',
    priority: MOVE_REDIRECTION_PRIORITY,
    affectedActorRelation: 'enemy',
    moveTargetClass: 'opponents',
    requiresRedirectorInReach: true,
    requiresShiftTowardRedirector: true,
    expiry: 'source-leaves',
  }),
  complete({
    canonicalId: 'Feint',
    definitionId: 'feint',
    sourceKind: 'move',
    family: 'plan-cancellation',
    timing: 'target',
    priority: MOVE_SHIELD_GUARD_BREAK_PRIORITY,
    triggeringKeyword: 'shield',
    reactorRelation: 'triggering-action-source',
    retainTriggeringUsage: true,
    usageResourceId: 'feint.frequency-use',
    promptKey: 'move.feint.reaction-response',
    optionId: 'move.feint.use',
    optionLabelKey: 'move.feint.break-shield',
  }),
  complete({
    canonicalId: 'Pursuit',
    definitionId: 'pursuit',
    sourceKind: 'move',
    family: 'switch-interrupt',
    timing: 'switch',
    priority: MOVE_SETUP_REACTION_PRIORITY,
    target: 'recalled-enemy',
    damageBaseOverride: 8,
    movementSpeedBonus: 5,
    usageResourceId: 'pursuit.frequency-use',
    promptKey: 'move.pursuit.reaction-response',
    optionId: 'move.pursuit.use',
    optionLabelKey: 'move.pursuit.use-interrupt',
  }),
  complete({
    canonicalId: 'Drown Out',
    definitionId: 'drown-out',
    sourceKind: 'ability',
    family: 'plan-cancellation',
    timing: 'declare',
    priority: MOVE_SONIC_CANCELLATION_PRIORITY,
    triggeringKeyword: 'sonic',
    reactorRelation: 'enemy',
    retainTriggeringUsage: true,
    usageResourceId: 'drown-out.frequency-use',
    promptKey: 'ability.drown-out.reaction-response',
    optionId: 'ability.drown-out.use',
    optionLabelKey: 'ability.drown-out.cancel-sonic-move',
  }),
])

const DEFINITION_BY_CANONICAL_ID = new Map(
  MOVE_SETUP_REACTION_DEFINITIONS.map(definition => [definition.canonicalId, definition]),
)

export const MOVE_SETUP_REACTION_DEFINITION_HASH = createHash('sha256')
  .update(stableJsonStringify({
    version: MOVE_SETUP_REACTION_PROGRAM_VERSION,
    setupPriority: MOVE_SETUP_REACTION_PRIORITY,
    redirectionPriority: MOVE_REDIRECTION_PRIORITY,
    sonicCancellationPriority: MOVE_SONIC_CANCELLATION_PRIORITY,
    shieldGuardBreakPriority: MOVE_SHIELD_GUARD_BREAK_PRIORITY,
    definitions: MOVE_SETUP_REACTION_DEFINITIONS,
  }))
  .digest('hex')

export const moveSetupReactionDefinition = <
  CanonicalId extends MoveSetupReactionCanonicalId,
>(canonicalId: CanonicalId): Extract<MoveSetupReactionDefinition, {
  readonly canonicalId: CanonicalId
}> => (DEFINITION_BY_CANONICAL_ID.get(canonicalId)
  ?? (() => { throw new Error(`Unknown setup/redirection reaction definition ${canonicalId}.`) })()
) as Extract<MoveSetupReactionDefinition, { readonly canonicalId: CanonicalId }>
