import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_PATCH_TYPE_VALUES,
  isLivePlayMapSlug,
  isLivePlayOpId,
  isLivePlayPatchType,
  type LivePlayPatch,
} from './livePlayCommands'
import { LIVE_PLAY_REALTIME_EVENT_TYPES } from './realtime'
import {
  EncounterPresentationValidationError,
  parseAcceptedEncounterPresentation,
  type AcceptedEncounterPresentation,
} from './encounterPresentation'

export interface LivePlayRealtimeEventValidationIssue {
  readonly path: string
  readonly message: string
}

export interface LivePlayAcceptedRealtimeEvent {
  readonly channel: `map:${string}`
  readonly type: typeof LIVE_PLAY_REALTIME_EVENT_TYPES.COMMAND_ACCEPTED
  readonly mapSlug: string
  readonly opId: string
  readonly revision: number
  readonly previousRevision: number
  readonly patches: readonly LivePlayPatch[]
  readonly presentation?: AcceptedEncounterPresentation
  readonly clientId?: string
  readonly timestamp: number
}

export type ParseAcceptedLivePlayRealtimeEventResult =
  | {
      readonly valid: true
      readonly event: LivePlayAcceptedRealtimeEvent
    }
  | {
      readonly valid: false
      readonly issues: readonly LivePlayRealtimeEventValidationIssue[]
    }

type UnknownRecord = Record<string, unknown>
type MutableIssueList = LivePlayRealtimeEventValidationIssue[]

const hasOwn = (record: UnknownRecord, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(record, key)

const isPlainObject = (value: unknown): value is UnknownRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const isSafeNonNegativeInteger = (value: unknown): value is number => (
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
)

const addIssue = (issues: MutableIssueList, path: string, message: string): void => {
  issues.push({ path, message })
}

const detach = <TValue>(value: TValue): TValue => {
  if (Array.isArray(value)) return value.map((item) => detach(item)) as TValue
  if (typeof value === 'object' && value !== null) {
    const copy: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      copy[key] = detach(child)
    }
    return copy as TValue
  }
  return value
}

const validatePatch = (
  patch: unknown,
  index: number,
  eventMapSlug: string | null,
  eventRevision: number | null,
  issues: MutableIssueList,
): void => {
  const path = `patches[${index}]`
  if (!isPlainObject(patch)) {
    addIssue(issues, path, `${path} must be a plain object.`)
    return
  }

  if (patch.schemaVersion !== LIVE_PLAY_COMMAND_SCHEMA_VERSION) {
    addIssue(
      issues,
      `${path}.schemaVersion`,
      `${path}.schemaVersion must be ${LIVE_PLAY_COMMAND_SCHEMA_VERSION}.`,
    )
  }

  if (!isLivePlayPatchType(patch.type)) {
    addIssue(
      issues,
      `${path}.type`,
      `${path}.type must be one of ${LIVE_PLAY_PATCH_TYPE_VALUES.join(', ')}.`,
    )
  }

  if (!isLivePlayMapSlug(patch.mapSlug)) {
    addIssue(issues, `${path}.mapSlug`, `${path}.mapSlug must be a valid live-play map slug.`)
  } else if (eventMapSlug !== null && patch.mapSlug !== eventMapSlug) {
    addIssue(issues, `${path}.mapSlug`, `${path}.mapSlug must match event.mapSlug.`)
  }

  if (!isSafeNonNegativeInteger(patch.revision)) {
    addIssue(issues, `${path}.revision`, `${path}.revision must be a safe non-negative integer revision.`)
  } else if (eventRevision !== null && patch.revision !== eventRevision) {
    addIssue(issues, `${path}.revision`, `${path}.revision must match event.revision.`)
  }

  if (!Array.isArray(patch.scopes)) {
    addIssue(issues, `${path}.scopes`, `${path}.scopes must be an array.`)
  }

  if (!hasOwn(patch, 'payload') || patch.payload === undefined) {
    addIssue(issues, `${path}.payload`, `${path}.payload must be present.`)
  }
}

export const parseAcceptedLivePlayRealtimeEvent = (
  value: unknown,
): ParseAcceptedLivePlayRealtimeEventResult => {
  const issues: MutableIssueList = []

  if (!isPlainObject(value)) {
    return {
      valid: false,
      issues: [{ path: '$', message: 'Accepted live-play realtime event must be a plain object.' }],
    }
  }

  if (value.type !== LIVE_PLAY_REALTIME_EVENT_TYPES.COMMAND_ACCEPTED) {
    addIssue(
      issues,
      'type',
      `type must be ${LIVE_PLAY_REALTIME_EVENT_TYPES.COMMAND_ACCEPTED}.`,
    )
  }

  const mapSlug = typeof value.mapSlug === 'string' ? value.mapSlug : null
  if (!isLivePlayMapSlug(value.mapSlug)) {
    addIssue(issues, 'mapSlug', 'mapSlug must be a valid live-play map slug.')
  }

  const expectedChannel = mapSlug === null ? null : `map:${mapSlug}`
  if (typeof value.channel !== 'string') {
    addIssue(issues, 'channel', 'channel must be a string.')
  } else if (expectedChannel !== null && value.channel !== expectedChannel) {
    addIssue(issues, 'channel', 'channel must match map:<mapSlug>.')
  }

  if (!isLivePlayOpId(value.opId)) {
    addIssue(issues, 'opId', 'opId must be a valid live-play operation ID.')
  }

  const previousRevision = isSafeNonNegativeInteger(value.previousRevision) ? value.previousRevision : null
  const revision = isSafeNonNegativeInteger(value.revision) ? value.revision : null

  if (previousRevision === null) {
    addIssue(issues, 'previousRevision', 'previousRevision must be a safe non-negative integer revision.')
  }
  if (revision === null) {
    addIssue(issues, 'revision', 'revision must be a safe non-negative integer revision.')
  }
  if (previousRevision !== null && revision !== null && revision <= previousRevision) {
    addIssue(issues, 'revision', 'revision must be newer than previousRevision.')
  }

  if (!isSafeNonNegativeInteger(value.timestamp)) {
    addIssue(issues, 'timestamp', 'timestamp must be a safe non-negative integer timestamp.')
  }

  if (hasOwn(value, 'clientId') && value.clientId !== undefined && typeof value.clientId !== 'string') {
    addIssue(issues, 'clientId', 'clientId must be a string when present.')
  }

  let presentation: AcceptedEncounterPresentation | undefined
  if (hasOwn(value, 'presentation') && value.presentation !== undefined) {
    try {
      presentation = parseAcceptedEncounterPresentation(value.presentation)
      if (
        presentation.mapSlug !== value.mapSlug
        || presentation.operationId !== value.opId
        || presentation.previousRevision !== previousRevision
        || presentation.revision !== revision
      ) {
        addIssue(issues, 'presentation', 'presentation identity and revisions must match the accepted event.')
      }
    }
    catch (error) {
      addIssue(
        issues,
        'presentation',
        error instanceof EncounterPresentationValidationError
          ? error.message
          : 'presentation must satisfy the accepted encounter contract.',
      )
    }
  }

  if (!Array.isArray(value.patches)) {
    addIssue(issues, 'patches', 'patches must be a non-empty array.')
  } else if (value.patches.length === 0) {
    addIssue(issues, 'patches', 'patches must be a non-empty array.')
  } else {
    value.patches.forEach((patch, index) => validatePatch(
      patch,
      index,
      isLivePlayMapSlug(value.mapSlug) ? value.mapSlug : null,
      revision,
      issues,
    ))
  }

  if (issues.length > 0) return { valid: false, issues }

  return {
    valid: true,
    event: {
      channel: value.channel as `map:${string}`,
      type: LIVE_PLAY_REALTIME_EVENT_TYPES.COMMAND_ACCEPTED,
      mapSlug: value.mapSlug as string,
      opId: value.opId as string,
      revision: value.revision as number,
      previousRevision: value.previousRevision as number,
      patches: detach(value.patches as LivePlayPatch[]),
      ...(presentation === undefined ? {} : { presentation }),
      ...(typeof value.clientId === 'string' ? { clientId: value.clientId } : {}),
      timestamp: value.timestamp as number,
    },
  }
}
