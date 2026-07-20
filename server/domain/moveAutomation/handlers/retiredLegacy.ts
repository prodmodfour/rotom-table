import type { CharacterSheet } from '~/types/characterSheet'
import { reviewedDamage } from '../specs/reviewedSpecBuilder'
import type {
  RegisteredMoveHandlerContext,
  RegisteredMoveHandlerRegistration,
} from './registry'

export const RETIRED_LEGACY_HANDLER_ID = 'ma299.retired-legacy-context' as const

const loyaltyFor = (context: RegisteredMoveHandlerContext): number => {
  if (context.actor.sheet.kind !== 'pokemon') {
    throw new Error(`${context.intent.moveName} requires an authoritative Pokémon Loyalty value.`)
  }
  const loyalty = (context.actor.sheet.sheet as CharacterSheet).loyalty
  if (typeof loyalty !== 'number' || !Number.isSafeInteger(loyalty) || loyalty < 0 || loyalty > 6) {
    throw new Error(`${context.intent.moveName} requires an authoritative Loyalty value from 0 through 6.`)
  }
  return loyalty
}

const run = (context: RegisteredMoveHandlerContext) => {
  const canonicalId = context.intent.moveName
  if (canonicalId !== 'Frustration' && canonicalId !== 'Return') {
    throw new Error(`Retired legacy context handler cannot execute ${canonicalId}.`)
  }
  const loyalty = loyaltyFor(context)
  const slug = canonicalId.toLowerCase()
  const damageBase = canonicalId === 'Frustration' ? 9 - loyalty : 3 + loyalty
  return {
    operations: [reviewedDamage({
      slug,
      damageBase,
      damageClass: 'physical',
      moveType: 'normal',
      recipients: 'hit-targets',
    })],
    traceEntries: [{
      kind: 'predicate' as const,
      reasonCode: `${slug}.loyalty-damage-base`,
      phase: 'declare' as const,
      predicateId: `${slug}.loyalty-damage-base`,
      outcome: true,
      input: { damageBase },
    }],
  }
}

export const RETIRED_LEGACY_HANDLER_REGISTRATION: RegisteredMoveHandlerRegistration = Object.freeze({
  id: RETIRED_LEGACY_HANDLER_ID,
  version: 1,
  run,
})
