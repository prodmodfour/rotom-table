import { describe, expect, it, vi } from 'vitest'
import { projectAbilityAutomationObservation } from '#shared/abilityAutomation/observability'
import {
  abilityAutomationObservationReasonForError,
  emitAbilityAutomationObservation,
} from '~~/server/utils/abilityAutomationObservability'

describe('ability automation aggregate observability', () => {
  it('emits only closed aggregate buckets with no mechanic or principal identity fields', () => {
    const sink = vi.fn()
    const observation = emitAbilityAutomationObservation({
      event: 'declaration-offered',
      durationMs: 73,
      declarationCount: 2,
      optionCount: 37,
    }, sink)

    expect(observation).toEqual({
      schemaVersion: 1,
      event: 'declaration-offered',
      reasonFamily: 'none',
      duration: '50-249ms',
      declarations: '2-4',
      options: '17-64',
      outstandingWindows: '0',
    })
    expect(Object.keys(observation).sort()).toEqual([
      'declarations', 'duration', 'event', 'options', 'outstandingWindows',
      'reasonFamily', 'schemaVersion',
    ])
    expect(JSON.stringify(observation)).not.toMatch(
      /ability|canonical|actor|mapSlug|responder|optionId|roll|trace|operationId/i,
    )
    expect(sink).toHaveBeenCalledWith(observation)
  })

  it('uses bounded denial families and cannot become a private error oracle', () => {
    expect(abilityAutomationObservationReasonForError({ statusCode: 400, statusMessage: 'secret' })).toBe('invalid')
    expect(abilityAutomationObservationReasonForError({ statusCode: 403, statusMessage: 'secret' })).toBe('unauthorized')
    expect(abilityAutomationObservationReasonForError({ statusCode: 404, statusMessage: 'secret' })).toBe('unavailable')
    expect(abilityAutomationObservationReasonForError({ statusCode: 409, statusMessage: 'secret' })).toBe('conflict')
    expect(abilityAutomationObservationReasonForError(new Error('secret'))).toBe('internal')

    expect(projectAbilityAutomationObservation({
      event: 'request-rejected', reasonFamily: 'unauthorized', durationMs: 1,
    })).toMatchObject({ event: 'request-rejected', reasonFamily: 'unauthorized' })
  })

  it('rejects unbounded values and inconsistent labels while telemetry sink failure stays non-authoritative', () => {
    expect(() => projectAbilityAutomationObservation({
      event: 'request-rejected', durationMs: 1,
    })).toThrow(/require a bounded reason family/)
    expect(() => projectAbilityAutomationObservation({
      event: 'resolution-committed', reasonFamily: 'conflict', durationMs: 1,
    })).toThrow(/cannot carry a rejection reason/)
    expect(() => projectAbilityAutomationObservation({
      event: 'resolution-pending', durationMs: Number.POSITIVE_INFINITY,
    })).toThrow(/duration must be bounded/)
    expect(() => projectAbilityAutomationObservation({
      event: 'resolution-pending', durationMs: 1, outstandingWindowCount: -1,
    })).toThrow(/counts must be bounded/)

    expect(() => emitAbilityAutomationObservation({
      event: 'resolution-committed', durationMs: 1,
    }, () => { throw new Error('telemetry unavailable') })).not.toThrow()
  })
})
