import type {
  RegisteredMoveHandlerContext,
  RegisteredMoveHandlerRegistration,
} from './registry'
import {
  reviewedDamage,
  reviewedStage,
  standardAccuracy,
  standardTerminalOperations,
} from '../specs/reviewedSpecBuilder'

export const SETUP_DAMAGE_208_HANDLER_ID = 'ma208.setup-damage' as const

const runSetupDamage208 = (context: RegisteredMoveHandlerContext) => {
  if (context.intent.moveName === 'Springtide Storm') {
    const formId = context.actor.token.creatureRules?.formId
      ?? context.actor.token.slug.toLowerCase()
    const therian = formId.includes('therian')
    return {
      operations: [reviewedStage({
        slug: 'springtide-storm',
        id: therian ? 'therian-lower-all-stats' : 'incarnate-raise-all-stats',
        recipients: therian ? 'hit-targets' : 'actor',
        stage: 'all-stats',
        value: therian ? -1 : 1,
        sourceOperationId: 'springtide-storm.damage',
        trigger: {
          kind: 'accuracy-roll',
          rollId: 'springtide-storm.accuracy-roll',
          trigger: { kind: 'range', minimum: 16 },
          scope: therian ? 'recipient' : 'resolution',
          application: 'once',
        },
        applyTypeImmunity: therian,
      })],
      traceEntries: [{
        kind: 'predicate' as const,
        phase: 'declare' as const,
        predicateId: 'springtide-storm.therian-form',
        outcome: therian,
        reasonCode: therian
          ? 'springtide-storm.therian-form'
          : 'springtide-storm.non-therian-form',
        input: { formId },
      }],
    }
  }
  if (context.intent.moveName !== 'Meteor Beam') {
    throw new Error(`MA-208/209 contextual handler cannot execute ${context.intent.moveName}.`)
  }
  const setup = context.queries.resources.setupExecuteState(context.actor.placement.id)
  const executing = setup?.canonicalMoveId === 'Meteor Beam'
    && setup.status === 'ready-to-execute'

  if (!executing) {
    return {
      operations: [
        reviewedStage({
          slug: 'meteor-beam',
          id: 'setup-raise-special-attack',
          recipients: 'actor',
          stage: 'satk',
          value: 1,
          phase: 'hit',
        }),
        ...standardTerminalOperations('meteor-beam'),
      ],
      traceEntries: [{
        kind: 'predicate' as const,
        phase: 'declare' as const,
        predicateId: 'meteor-beam.setup-state',
        outcome: false,
        reasonCode: 'meteor-beam.setup-declared',
        input: { setupStatus: setup?.status ?? null },
      }],
    }
  }

  return {
    operations: [
      standardAccuracy('meteor-beam'),
      reviewedDamage({
        slug: 'meteor-beam',
        damageBase: 12,
        damageClass: 'special',
        moveType: 'rock',
      }),
      // Frequency was spent when the setup was accepted; execution only logs completion.
      standardTerminalOperations('meteor-beam')[1]!,
    ],
    traceEntries: [{
      kind: 'predicate' as const,
      phase: 'declare' as const,
      predicateId: 'meteor-beam.setup-state',
      outcome: true,
      reasonCode: 'meteor-beam.setup-executed',
      input: { setupStatus: setup.status },
    }],
  }
}

export const SETUP_DAMAGE_208_HANDLER_REGISTRATION: RegisteredMoveHandlerRegistration =
  Object.freeze({
    id: SETUP_DAMAGE_208_HANDLER_ID,
    version: 1,
    run: runSetupDamage208,
  })
