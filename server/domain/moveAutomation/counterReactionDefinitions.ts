import { createHash } from 'node:crypto'
import type { MoveReactionTiming } from '#shared/moveAutomation/reactions'
import { stableJsonStringify } from './stableJson'

export const MOVE_COUNTER_REACTION_PROGRAM_VERSION = 1 as const
export const MOVE_COUNTER_REACTION_PRIORITY = 400 as const

export type MoveCounterReactionCanonicalId =
  | 'Counter'
  | 'Mirror Coat'
  | 'Bide'
  | 'Magic Coat'
  | 'Snatch'

interface MoveCounterReactionDefinitionBase {
  readonly canonicalId: MoveCounterReactionCanonicalId
  readonly definitionId: string
  readonly version: typeof MOVE_COUNTER_REACTION_PROGRAM_VERSION
  readonly priority: typeof MOVE_COUNTER_REACTION_PRIORITY
  readonly triggerTiming: MoveReactionTiming
  readonly resolutionTiming: MoveReactionTiming | 'next-available-turn'
  readonly usageResourceId: string
  readonly promptKey: string
  readonly optionId: string
  readonly optionLabelKey: string
}

export interface MoveDamageCounterReactionDefinition
  extends MoveCounterReactionDefinitionBase {
  readonly family: 'damage-counter'
  readonly canonicalId: 'Counter' | 'Mirror Coat'
  readonly triggerDamageClass: 'physical' | 'special'
  readonly responseDamageClass: 'physical' | 'special'
  readonly responseType: 'fighting' | 'psychic'
  readonly resistanceSteps: 1
  readonly effectiveHpLossMultiplier: 2
}

export interface MoveBideReactionDefinition
  extends MoveCounterReactionDefinitionBase {
  readonly family: 'stored-damage'
  readonly canonicalId: 'Bide'
  readonly triggerDamageClass: 'any'
  readonly recipientPolicy: 'adjacent-enemies'
  readonly effectiveHpLossMultiplier: 1
}

export interface MoveEffectRedirectReactionDefinition
  extends MoveCounterReactionDefinitionBase {
  readonly family: 'effect-redirect'
  readonly canonicalId: 'Magic Coat' | 'Snatch'
  readonly trigger:
    | 'incoming-without-damage-dice'
    | 'self-targeting-benefits'
  readonly sourcePolicy: 'replace-with-reactor' | 'preserve'
}

export type MoveCounterReactionDefinition =
  | MoveDamageCounterReactionDefinition
  | MoveBideReactionDefinition
  | MoveEffectRedirectReactionDefinition

type MoveCounterReactionDefinitionInput =
  MoveCounterReactionDefinition extends infer Definition
    ? Definition extends MoveCounterReactionDefinition
      ? Omit<Definition, 'version' | 'priority'>
      : never
    : never

const freezeDefinition = <const Definition extends MoveCounterReactionDefinitionInput>(
  definition: Definition,
): Definition & {
  readonly version: typeof MOVE_COUNTER_REACTION_PROGRAM_VERSION
  readonly priority: typeof MOVE_COUNTER_REACTION_PRIORITY
} => {
  const completed = {
    ...definition,
    version: MOVE_COUNTER_REACTION_PROGRAM_VERSION,
    priority: MOVE_COUNTER_REACTION_PRIORITY,
  }
  Object.freeze(completed)
  return completed
}

/**
 * Reviewed engine canaries only. Phase 9 owns runtime registration and semantic
 * manifest promotion for these canonical moves.
 */
export const MOVE_COUNTER_REACTION_DEFINITIONS: readonly MoveCounterReactionDefinition[] = Object.freeze([
  freezeDefinition({
    canonicalId: 'Counter',
    definitionId: 'counter',
    family: 'damage-counter',
    triggerTiming: 'post-hit',
    resolutionTiming: 'post-damage',
    triggerDamageClass: 'physical',
    responseDamageClass: 'physical',
    responseType: 'fighting',
    resistanceSteps: 1,
    effectiveHpLossMultiplier: 2,
    usageResourceId: 'counter.frequency-use',
    promptKey: 'move.counter.reaction-response',
    optionId: 'move.counter.use',
    optionLabelKey: 'move.counter.use-reaction',
  }),
  freezeDefinition({
    canonicalId: 'Mirror Coat',
    definitionId: 'mirror-coat',
    family: 'damage-counter',
    triggerTiming: 'post-hit',
    resolutionTiming: 'post-damage',
    triggerDamageClass: 'special',
    responseDamageClass: 'special',
    responseType: 'psychic',
    resistanceSteps: 1,
    effectiveHpLossMultiplier: 2,
    usageResourceId: 'mirror-coat.frequency-use',
    promptKey: 'move.mirror-coat.reaction-response',
    optionId: 'move.mirror-coat.use',
    optionLabelKey: 'move.mirror-coat.use-reaction',
  }),
  freezeDefinition({
    canonicalId: 'Bide',
    definitionId: 'bide',
    family: 'stored-damage',
    triggerTiming: 'post-hit',
    resolutionTiming: 'next-available-turn',
    triggerDamageClass: 'any',
    recipientPolicy: 'adjacent-enemies',
    effectiveHpLossMultiplier: 1,
    usageResourceId: 'bide.frequency-use',
    promptKey: 'move.bide.reaction-response',
    optionId: 'move.bide.use',
    optionLabelKey: 'move.bide.store-damage',
  }),
  freezeDefinition({
    canonicalId: 'Magic Coat',
    definitionId: 'magic-coat',
    family: 'effect-redirect',
    triggerTiming: 'post-hit',
    resolutionTiming: 'post-hit',
    trigger: 'incoming-without-damage-dice',
    sourcePolicy: 'replace-with-reactor',
    usageResourceId: 'magic-coat.frequency-use',
    promptKey: 'move.magic-coat.reaction-response',
    optionId: 'move.magic-coat.use',
    optionLabelKey: 'move.magic-coat.reflect',
  }),
  freezeDefinition({
    canonicalId: 'Snatch',
    definitionId: 'snatch',
    family: 'effect-redirect',
    triggerTiming: 'target',
    resolutionTiming: 'target',
    trigger: 'self-targeting-benefits',
    sourcePolicy: 'preserve',
    usageResourceId: 'snatch.frequency-use',
    promptKey: 'move.snatch.reaction-response',
    optionId: 'move.snatch.use',
    optionLabelKey: 'move.snatch.take-benefits',
  }),
])

const DEFINITION_BY_CANONICAL_ID = new Map(
  MOVE_COUNTER_REACTION_DEFINITIONS.map(definition => [definition.canonicalId, definition]),
)

export const MOVE_COUNTER_REACTION_DEFINITION_HASH = createHash('sha256')
  .update(stableJsonStringify({
    version: MOVE_COUNTER_REACTION_PROGRAM_VERSION,
    priority: MOVE_COUNTER_REACTION_PRIORITY,
    definitions: MOVE_COUNTER_REACTION_DEFINITIONS,
  }))
  .digest('hex')

export const moveCounterReactionDefinition = <
  CanonicalId extends MoveCounterReactionCanonicalId,
>(canonicalId: CanonicalId): Extract<MoveCounterReactionDefinition, {
  readonly canonicalId: CanonicalId
}> => (DEFINITION_BY_CANONICAL_ID.get(canonicalId)
  ?? (() => { throw new Error(`Unknown counter reaction definition ${canonicalId}.`) })()
) as Extract<MoveCounterReactionDefinition, { readonly canonicalId: CanonicalId }>
