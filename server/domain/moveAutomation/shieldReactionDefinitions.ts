import { createHash } from 'node:crypto'
import type { MoveReactionTiming } from '#shared/moveAutomation/reactions'
import { stableJsonStringify } from './stableJson'

export const MOVE_SHIELD_REACTION_PROGRAM_VERSION = 1 as const
export const MOVE_SHIELD_REACTION_PRIORITY = 500 as const
export const MOVE_SHIELD_GUARD_BREAK_PRIORITY = 1_000 as const

export const MOVE_SHIELD_SCOPE_KINDS = ['self', 'side', 'area'] as const
export const MOVE_SHIELD_TRIGGER_EVENTS = ['targeted', 'hit'] as const
export const MOVE_SHIELD_TRIGGER_CATEGORIES = ['any', 'status', 'damaging'] as const
export const MOVE_SHIELD_TRIGGER_ACTION_TIMINGS = [
  'any',
  'priority-or-interrupt',
] as const
export const MOVE_SHIELD_CANCELLATION_SCOPES = ['covered', 'all-targets'] as const
export const MOVE_SHIELD_RETALIATION_KINDS = [
  'poison-attacker',
  'lower-attacker-attack-two',
  'lower-attacker-defense-two',
  'attacker-loses-tick',
] as const

export type MoveShieldScopeKind = (typeof MOVE_SHIELD_SCOPE_KINDS)[number]
export type MoveShieldTriggerEvent = (typeof MOVE_SHIELD_TRIGGER_EVENTS)[number]
export type MoveShieldTriggerCategory = (typeof MOVE_SHIELD_TRIGGER_CATEGORIES)[number]
export type MoveShieldTriggerActionTiming =
  (typeof MOVE_SHIELD_TRIGGER_ACTION_TIMINGS)[number]
export type MoveShieldCancellationScope =
  (typeof MOVE_SHIELD_CANCELLATION_SCOPES)[number]
export type MoveShieldRetaliationKind =
  (typeof MOVE_SHIELD_RETALIATION_KINDS)[number]

export interface MoveShieldReactionDefinition {
  readonly canonicalId:
    | 'Protect'
    | 'Detect'
    | 'Baneful Bunker'
    | 'King’s Shield'
    | 'Obstruct'
    | 'Spiky Shield'
    | 'Crafty Shield'
    | 'Mat Block'
    | 'Quick Guard'
    | 'Wide Guard'
  readonly definitionId: string
  readonly version: typeof MOVE_SHIELD_REACTION_PROGRAM_VERSION
  readonly timing: Extract<MoveReactionTiming, 'target' | 'post-hit'>
  readonly priority: typeof MOVE_SHIELD_REACTION_PRIORITY
  readonly scope: {
    readonly kind: MoveShieldScopeKind
    /** Area may protect every geometrically covered target; side fails closed on unknown allegiance. */
    readonly coverageRelation: 'self' | 'self-and-allies' | 'any'
  }
  readonly trigger: {
    readonly event: MoveShieldTriggerEvent
    readonly category: MoveShieldTriggerCategory
    readonly actionTiming: MoveShieldTriggerActionTiming
    readonly eligibleRelation: 'self' | 'self-and-allies'
    readonly firstRoundOnly: boolean
  }
  readonly cancellation: {
    readonly cancelHit: true
    readonly cancelEffects: true
    readonly scope: MoveShieldCancellationScope
  }
  readonly retaliation: {
    readonly kind: MoveShieldRetaliationKind
    /** The frozen PTU source calls this Melee range; it is the contact retaliation seam. */
    readonly requiresMeleeRange: true
  } | null
  readonly usageResourceId: string
  readonly promptKey: string
  readonly optionId: string
  readonly optionLabelKey: string
}

const definition = (
  value: Omit<MoveShieldReactionDefinition, 'version' | 'priority'>,
): MoveShieldReactionDefinition => Object.freeze({
  ...value,
  version: MOVE_SHIELD_REACTION_PROGRAM_VERSION,
  priority: MOVE_SHIELD_REACTION_PRIORITY,
  scope: Object.freeze({ ...value.scope }),
  trigger: Object.freeze({ ...value.trigger }),
  cancellation: Object.freeze({ ...value.cancellation }),
  retaliation: value.retaliation ? Object.freeze({ ...value.retaliation }) : null,
})

const selfShield = (input: {
  readonly canonicalId: Extract<MoveShieldReactionDefinition['canonicalId'],
    'Protect' | 'Detect' | 'Baneful Bunker' | 'King’s Shield' | 'Obstruct' | 'Spiky Shield'>
  readonly definitionId: string
  readonly category: MoveShieldTriggerCategory
  readonly retaliation: MoveShieldReactionDefinition['retaliation']
}): MoveShieldReactionDefinition => definition({
  canonicalId: input.canonicalId,
  definitionId: input.definitionId,
  timing: 'post-hit',
  scope: { kind: 'self', coverageRelation: 'self' },
  trigger: {
    event: 'hit',
    category: input.category,
    actionTiming: 'any',
    eligibleRelation: 'self',
    firstRoundOnly: false,
  },
  cancellation: { cancelHit: true, cancelEffects: true, scope: 'covered' },
  retaliation: input.retaliation,
  usageResourceId: `${input.definitionId}.frequency-use`,
  promptKey: `move.${input.definitionId}.shield-response`,
  optionId: `move.${input.definitionId}.use`,
  optionLabelKey: `move.${input.definitionId}.use-shield`,
})

/**
 * Reviewed canary definitions. They are server machinery only: Phase 9 owns
 * production runtime registration and manifest promotion for these moves.
 */
export const MOVE_SHIELD_REACTION_DEFINITIONS: readonly MoveShieldReactionDefinition[] = Object.freeze([
  selfShield({
    canonicalId: 'Protect',
    definitionId: 'protect',
    category: 'any',
    retaliation: null,
  }),
  selfShield({
    canonicalId: 'Detect',
    definitionId: 'detect',
    category: 'any',
    retaliation: null,
  }),
  selfShield({
    canonicalId: 'Baneful Bunker',
    definitionId: 'baneful-bunker',
    category: 'damaging',
    retaliation: { kind: 'poison-attacker', requiresMeleeRange: true },
  }),
  selfShield({
    canonicalId: 'King’s Shield',
    definitionId: 'kings-shield',
    category: 'damaging',
    retaliation: { kind: 'lower-attacker-attack-two', requiresMeleeRange: true },
  }),
  selfShield({
    canonicalId: 'Obstruct',
    definitionId: 'obstruct',
    category: 'any',
    retaliation: { kind: 'lower-attacker-defense-two', requiresMeleeRange: true },
  }),
  selfShield({
    canonicalId: 'Spiky Shield',
    definitionId: 'spiky-shield',
    category: 'damaging',
    retaliation: { kind: 'attacker-loses-tick', requiresMeleeRange: true },
  }),
  definition({
    canonicalId: 'Crafty Shield',
    definitionId: 'crafty-shield',
    timing: 'post-hit',
    scope: { kind: 'area', coverageRelation: 'any' },
    trigger: {
      event: 'hit',
      category: 'status',
      actionTiming: 'any',
      eligibleRelation: 'self-and-allies',
      firstRoundOnly: false,
    },
    cancellation: { cancelHit: true, cancelEffects: true, scope: 'covered' },
    retaliation: null,
    usageResourceId: 'crafty-shield.frequency-use',
    promptKey: 'move.crafty-shield.shield-response',
    optionId: 'move.crafty-shield.use',
    optionLabelKey: 'move.crafty-shield.use-shield',
  }),
  definition({
    canonicalId: 'Mat Block',
    definitionId: 'mat-block',
    timing: 'post-hit',
    scope: { kind: 'side', coverageRelation: 'self-and-allies' },
    trigger: {
      event: 'hit',
      category: 'damaging',
      actionTiming: 'any',
      eligibleRelation: 'self-and-allies',
      firstRoundOnly: true,
    },
    cancellation: { cancelHit: true, cancelEffects: true, scope: 'all-targets' },
    retaliation: null,
    usageResourceId: 'mat-block.frequency-use',
    promptKey: 'move.mat-block.shield-response',
    optionId: 'move.mat-block.use',
    optionLabelKey: 'move.mat-block.use-shield',
  }),
  definition({
    canonicalId: 'Quick Guard',
    definitionId: 'quick-guard',
    timing: 'target',
    scope: { kind: 'side', coverageRelation: 'self-and-allies' },
    trigger: {
      event: 'targeted',
      category: 'damaging',
      actionTiming: 'priority-or-interrupt',
      eligibleRelation: 'self-and-allies',
      firstRoundOnly: false,
    },
    cancellation: { cancelHit: true, cancelEffects: true, scope: 'all-targets' },
    retaliation: null,
    usageResourceId: 'quick-guard.frequency-use',
    promptKey: 'move.quick-guard.shield-response',
    optionId: 'move.quick-guard.use',
    optionLabelKey: 'move.quick-guard.use-shield',
  }),
  definition({
    canonicalId: 'Wide Guard',
    definitionId: 'wide-guard',
    timing: 'post-hit',
    scope: { kind: 'area', coverageRelation: 'any' },
    trigger: {
      event: 'hit',
      category: 'any',
      actionTiming: 'any',
      eligibleRelation: 'self-and-allies',
      firstRoundOnly: false,
    },
    cancellation: { cancelHit: true, cancelEffects: true, scope: 'covered' },
    retaliation: null,
    usageResourceId: 'wide-guard.frequency-use',
    promptKey: 'move.wide-guard.shield-response',
    optionId: 'move.wide-guard.use',
    optionLabelKey: 'move.wide-guard.use-shield',
  }),
])

const DEFINITION_BY_CANONICAL_ID = new Map(
  MOVE_SHIELD_REACTION_DEFINITIONS.map(entry => [entry.canonicalId, entry]),
)

export const MOVE_SHIELD_REACTION_DEFINITION_HASH = createHash('sha256')
  .update(stableJsonStringify({
    version: MOVE_SHIELD_REACTION_PROGRAM_VERSION,
    shieldPriority: MOVE_SHIELD_REACTION_PRIORITY,
    guardBreakPriority: MOVE_SHIELD_GUARD_BREAK_PRIORITY,
    definitions: MOVE_SHIELD_REACTION_DEFINITIONS,
  }))
  .digest('hex')

export const moveShieldReactionDefinition = (
  canonicalId: MoveShieldReactionDefinition['canonicalId'],
): MoveShieldReactionDefinition => DEFINITION_BY_CANONICAL_ID.get(canonicalId)
  ?? (() => { throw new Error(`Unknown shield reaction definition ${canonicalId}.`) })()
