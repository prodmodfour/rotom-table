import {
  projectAbilityAutomationObservation,
  type AbilityAutomationObservation,
  type AbilityAutomationObservationInput,
  type AbilityAutomationObservationReasonFamily,
} from '#shared/abilityAutomation/observability'

export type AbilityAutomationObservationSink = (
  observation: AbilityAutomationObservation,
) => void

const defaultSink: AbilityAutomationObservationSink = observation => {
  console.info('[ability-automation]', observation)
}

/** Observability is best-effort and can never alter an authoritative result. */
export const emitAbilityAutomationObservation = (
  input: AbilityAutomationObservationInput,
  sink: AbilityAutomationObservationSink = defaultSink,
): AbilityAutomationObservation => {
  const observation = projectAbilityAutomationObservation(input)
  try {
    sink(observation)
  }
  catch {
    // A telemetry sink is not an authoritative resource and must fail open.
  }
  return observation
}

export const abilityAutomationObservationReasonForError = (
  error: unknown,
): AbilityAutomationObservationReasonFamily => {
  const statusCode = error && typeof error === 'object' && 'statusCode' in error
    ? Number((error as { statusCode?: unknown }).statusCode)
    : 500
  if (statusCode === 401 || statusCode === 403) return 'unauthorized'
  if (statusCode === 404) return 'unavailable'
  if (statusCode === 409) return 'conflict'
  if (statusCode >= 400 && statusCode < 500) return 'invalid'
  return 'internal'
}
