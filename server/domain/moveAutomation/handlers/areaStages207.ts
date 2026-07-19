import type {
  RegisteredMoveHandlerContext,
  RegisteredMoveHandlerRegistration,
} from './registry'

export const AREA_STAGES_207_HANDLER_ID = 'ma207.area-stage-outliers' as const

/**
 * Hyperspace Fury has no interrupt window: this audited handler records that
 * server-owned policy while emitting no response operation for a client to
 * answer or forge.
 */
const runAreaStages207Handler = (context: RegisteredMoveHandlerContext) => {
  if (context.intent.moveName !== 'Hyperspace Fury') {
    throw new Error(`MA-207 handler cannot execute ${context.intent.moveName}.`)
  }
  return {
    operations: [],
    traceEntries: [{
      kind: 'predicate' as const,
      phase: 'declare' as const,
      predicateId: 'hyperspace-fury.interrupt-policy',
      outcome: true,
      reasonCode: 'hyperspace-fury.interrupts-forbidden',
      input: { responseWindowCount: 0 },
    }],
  }
}

export const AREA_STAGES_207_HANDLER_REGISTRATION: RegisteredMoveHandlerRegistration =
  Object.freeze({
    id: AREA_STAGES_207_HANDLER_ID,
    version: 1,
    run: runAreaStages207Handler,
  })
