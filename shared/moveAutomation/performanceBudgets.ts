import { MOVE_EFFECT_OPERATION_LIMITS } from './effects'
import { ENCOUNTER_EFFECT_LIMITS } from './encounterEffects'
import { ENCOUNTER_ZONE_LIMITS } from './encounterZones'
import { PENDING_MOVE_RESOLUTION_LIMITS } from './pendingResolution'
import { MOVE_SPEC_LIMITS } from './spec'

/** Reviewed hard ceilings applied before planning or serialization. */
export const MOVE_AUTOMATION_ENGINE_BUDGETS = Object.freeze({
  operationsPerResolution: MOVE_EFFECT_OPERATION_LIMITS.operations,
  targetsPerDeclaration: MOVE_SPEC_LIMITS.targetCount,
  multiHitStrikes: MOVE_EFFECT_OPERATION_LIMITS.multiHitStrikes,
  nestedResponseDepth: PENDING_MOVE_RESOLUTION_LIMITS.reactionNestedWindowDepth,
  activeEffects: ENCOUNTER_EFFECT_LIMITS.count,
  activeZones: ENCOUNTER_ZONE_LIMITS.count,
  responseOptions: PENDING_MOVE_RESOLUTION_LIMITS.optionsPerWindow,
  traceEventsPerOperation: 128,
  realtimePayloadBytes: 1024 * 1024,
  commandBodyBytes: 256 * 1024,
  /** Generous CI guard: maximum synthetic ceiling checks must finish within this wall time. */
  syntheticGuardMilliseconds: 2_000,
})

export const assertMoveAutomationEngineBudgets = (): void => {
  const budgets = MOVE_AUTOMATION_ENGINE_BUDGETS
  const safeMaximums = {
    operationsPerResolution: 128,
    targetsPerDeclaration: 32,
    multiHitStrikes: 10,
    nestedResponseDepth: 8,
    activeEffects: 256,
    activeZones: 256,
    responseOptions: 512,
    traceEventsPerOperation: 128,
    realtimePayloadBytes: 1024 * 1024,
    commandBodyBytes: 256 * 1024,
  } as const
  for (const [key, maximum] of Object.entries(safeMaximums)) {
    const value = budgets[key as keyof typeof safeMaximums]
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
      throw new Error(`Move automation budget ${key} must remain between 1 and ${maximum}; received ${value}.`)
    }
  }
}
