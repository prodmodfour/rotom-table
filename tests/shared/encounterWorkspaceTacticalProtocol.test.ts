import { describe, expect, it } from 'vitest'
import {
  ENCOUNTER_TACTICAL_MESSAGE_CHANNEL,
  ENCOUNTER_TACTICAL_TARGET_LIMIT,
  createEncounterTacticalAdoptionMessage,
  createEncounterTacticalChildMessage,
  parseEncounterTacticalAdoptionMessage,
  parseEncounterTacticalChildMessage,
} from '../../shared/encounterWorkspace/tacticalProtocol'

describe('encounter tactical same-origin protocol payloads', () => {
  it('round-trips bounded revision-bound adoption without mechanics payloads', () => {
    const message = createEncounterTacticalAdoptionMessage({
      mapSlug: 'arena',
      mapRevision: 7,
      selectedParticipantId: 'actor:one',
      actionOfferId: 'offer:one',
      selectedTargetIds: ['target:one'],
    })
    expect(parseEncounterTacticalAdoptionMessage(message)).toEqual(message)
    expect(message).not.toHaveProperty('command')
    expect(message).not.toHaveProperty('sheet')
    expect(Object.isFrozen(message)).toBe(true)
  })

  it('fails closed for unknown fields, stale shapes, duplicate targets, and oversized handoff', () => {
    const base = createEncounterTacticalAdoptionMessage({
      mapSlug: 'arena', mapRevision: 7, selectedParticipantId: null, actionOfferId: null, selectedTargetIds: [],
    })
    expect(parseEncounterTacticalAdoptionMessage({ ...base, mechanics: 'execute' })).toBeNull()
    expect(parseEncounterTacticalAdoptionMessage({ ...base, mapRevision: -1 })).toBeNull()
    expect(parseEncounterTacticalAdoptionMessage({ ...base, selectedTargetIds: ['same', 'same'] })).toBeNull()
    expect(() => createEncounterTacticalAdoptionMessage({
      mapSlug: 'arena',
      mapRevision: 7,
      selectedParticipantId: null,
      actionOfferId: null,
      selectedTargetIds: Array.from({ length: ENCOUNTER_TACTICAL_TARGET_LIMIT + 1 }, (_, index) => `target:${index}`),
    })).toThrow('exceed')
  })

  it('accepts only closed ready, revision, selection, and close messages', () => {
    const ready = createEncounterTacticalChildMessage({ type: 'ready', mapSlug: 'arena', mapRevision: 7 })
    const selection = createEncounterTacticalChildMessage({ type: 'selection', mapSlug: 'arena', participantId: 'target:one' })
    expect(ready).toEqual({ channel: ENCOUNTER_TACTICAL_MESSAGE_CHANNEL, type: 'ready', mapSlug: 'arena', mapRevision: 7 })
    expect(parseEncounterTacticalChildMessage(selection)).toEqual(selection)
    expect(parseEncounterTacticalChildMessage({ ...ready, internalTrace: 'secret' })).toBeNull()
    expect(parseEncounterTacticalChildMessage({ ...selection, participantId: '' })).toBeNull()
    expect(parseEncounterTacticalChildMessage({ channel: ENCOUNTER_TACTICAL_MESSAGE_CHANNEL, type: 'execute', mapSlug: 'arena' })).toBeNull()
  })
})
