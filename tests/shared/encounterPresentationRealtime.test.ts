import { describe, expect, it } from 'vitest'
import { parseAbilityAutomationAcceptedRealtimePayload } from '../../shared/abilityAutomation/realtime'
import { parseAcceptedLivePlayRealtimeEvent } from '../../shared/livePlayRealtimeEvents'
import { acceptedEncounterPresentationFromLivePlayCommand } from '../../server/domain/encounterPresentation/acceptedAdapters'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  LIVE_PLAY_PATCH_TYPES,
  createLivePlayAcceptedResult,
  type LivePlayCommandEnvelope,
  type LivePlayPatch,
} from '../../shared/livePlayCommands'

const command = {
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  opId: 'op_realtime1',
  mapSlug: 'arena',
  baseRevision: 1,
  type: LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN,
  scopes: [{ kind: 'token', placementId: 'actor:one', field: 'position' }],
  payload: { placementId: 'actor:one', position: { x: 2, y: 0, z: 2 } },
} as LivePlayCommandEnvelope
const patch = {
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  type: LIVE_PLAY_PATCH_TYPES.TOKEN_POSITION,
  mapSlug: 'arena',
  revision: 2,
  scopes: command.scopes,
  payload: { placementId: 'actor:one', position: { x: 2, y: 0, z: 2 } },
} as LivePlayPatch
const result = createLivePlayAcceptedResult({
  opId: command.opId,
  mapSlug: command.mapSlug,
  previousRevision: 1,
  revision: 2,
  patches: [patch],
})
const presentation = acceptedEncounterPresentationFromLivePlayCommand({ command, result, occurredAt: 50 })

const event = () => ({
  channel: 'map:arena',
  type: 'live-play-command-accepted',
  mapSlug: 'arena',
  opId: command.opId,
  previousRevision: 1,
  revision: 2,
  patches: [patch],
  presentation,
  timestamp: 51,
})

describe('generic accepted realtime validation', () => {
  it('accepts matching generic presentation and detaches the event', () => {
    const parsed = parseAcceptedLivePlayRealtimeEvent(event())
    expect(parsed.valid).toBe(true)
    if (!parsed.valid) return
    expect(parsed.event.presentation?.presentationId).toBe(presentation.presentationId)
  })

  it('fails closed when presentation operation, map, or revisions do not match the event', () => {
    const parsed = parseAcceptedLivePlayRealtimeEvent({
      ...event(),
      opId: 'op_different1',
    })
    expect(parsed.valid).toBe(false)
    if (parsed.valid) return
    expect(parsed.issues.some(issue => issue.path === 'presentation')).toBe(true)
  })

  it('continues to parse pre-contract durable rows without generic presentation', () => {
    const { presentation: _legacyMissing, ...legacy } = event()
    expect(parseAcceptedLivePlayRealtimeEvent(legacy).valid).toBe(true)
  })

  it('strictly binds native Ability presentation to its public realtime revisions', () => {
    expect(parseAbilityAutomationAcceptedRealtimePayload({
      schemaVersion: 1,
      mapSlug: 'arena',
      previousRevision: 1,
      revision: 2,
      status: 'committed',
      presentation,
    }).valid).toBe(true)
    expect(parseAbilityAutomationAcceptedRealtimePayload({
      schemaVersion: 1,
      mapSlug: 'arena',
      previousRevision: 1,
      revision: 3,
      status: 'committed',
      presentation,
    }).valid).toBe(false)
    expect(parseAbilityAutomationAcceptedRealtimePayload({
      schemaVersion: 1,
      mapSlug: 'arena',
      previousRevision: 1,
      revision: 2,
      status: 'committed',
      presentation,
      hiddenOptions: ['must fail closed'],
    }).valid).toBe(false)
  })
})
