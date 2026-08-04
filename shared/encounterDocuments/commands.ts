import {
  ENCOUNTER_DOCUMENT_LIMITS,
  parseEncounterDocument,
  type EncounterDocument,
  type EncounterDocumentObjective,
  type EncounterDocumentClock,
  type EncounterDocumentPhase,
  type EncounterDocumentReserve,
  type EncounterDocumentWave,
} from './model'

export const ENCOUNTER_DIRECTOR_COMMAND_SCHEMA_VERSION = 1 as const

interface EncounterDirectorCommandBase {
  readonly schemaVersion: typeof ENCOUNTER_DIRECTOR_COMMAND_SCHEMA_VERSION
  readonly commandId: string
  readonly encounterId: string
  readonly baseRevision: number
}

export type EncounterDirectorCommand =
  | (EncounterDirectorCommandBase & {
      readonly type: 'set-participant-visibility'
      readonly payload: { readonly participantId: string, readonly visibility: 'hidden' | 'revealed' }
    })
  | (EncounterDirectorCommandBase & {
      readonly type: 'upsert-reserve'
      readonly payload: { readonly reserve: EncounterDocumentReserve }
    })
  | (EncounterDirectorCommandBase & {
      readonly type: 'remove-reserve'
      readonly payload: { readonly reserveId: string }
    })
  | (EncounterDirectorCommandBase & {
      readonly type: 'upsert-wave'
      readonly payload: { readonly wave: EncounterDocumentWave }
    })
  | (EncounterDirectorCommandBase & {
      readonly type: 'set-wave-status'
      readonly payload: { readonly waveId: string, readonly status: EncounterDocumentWave['status'] }
    })
  | (EncounterDirectorCommandBase & {
      readonly type: 'upsert-objective'
      readonly payload: { readonly objective: EncounterDocumentObjective }
    })
  | (EncounterDirectorCommandBase & {
      readonly type: 'remove-objective'
      readonly payload: { readonly objectiveId: string }
    })
  | (EncounterDirectorCommandBase & {
      readonly type: 'upsert-clock'
      readonly payload: { readonly clock: EncounterDocumentClock }
    })
  | (EncounterDirectorCommandBase & {
      readonly type: 'remove-clock'
      readonly payload: { readonly clockId: string }
    })
  | (EncounterDirectorCommandBase & {
      readonly type: 'upsert-phase'
      readonly payload: { readonly phase: EncounterDocumentPhase }
    })
  | (EncounterDirectorCommandBase & {
      readonly type: 'activate-phase'
      readonly payload: { readonly phaseId: string }
    })
  | (EncounterDirectorCommandBase & {
      readonly type: 'set-story'
      readonly payload: {
        readonly name: string
        readonly lifecycle: EncounterDocument['lifecycle']
        readonly publicStakes: string | null
        readonly gmStakes: string | null
        readonly notes: string | null
      }
    })

export class EncounterDirectorCommandError extends Error {
  constructor(
    readonly code: 'invalid-command' | 'stale-revision' | 'identity-mismatch' | 'not-found' | 'limit-exceeded',
    message: string,
  ) {
    super(message)
    this.name = 'EncounterDirectorCommandError'
  }
}

function fail(code: EncounterDirectorCommandError['code'], message: string): never { throw new EncounterDirectorCommandError(code, message) }
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const exact = (value: Record<string, unknown>, keys: readonly string[], label: string): void => {
  const expected = new Set(keys)
  if (Object.keys(value).length !== expected.size || Object.keys(value).some(key => !expected.has(key))) {
    fail('invalid-command', `${label} has unsupported or missing fields.`)
  }
}
const stableId = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(value)) fail('invalid-command', `${label} must be a stable ID.`)
  return value
}
const revision = (value: unknown): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) fail('invalid-command', 'baseRevision must be a non-negative safe integer.')
  return Number(value)
}

/** Strictly parse the closed Director command envelope; nested rows are validated by final document parsing. */
export const parseEncounterDirectorCommand = (value: unknown): EncounterDirectorCommand => {
  if (!isRecord(value)) fail('invalid-command', 'Director command must be an object.')
  exact(value, ['schemaVersion', 'commandId', 'encounterId', 'baseRevision', 'type', 'payload'], 'Director command')
  if (value.schemaVersion !== ENCOUNTER_DIRECTOR_COMMAND_SCHEMA_VERSION || !isRecord(value.payload)) {
    fail('invalid-command', 'Director command schema or payload is invalid.')
  }
  const base = {
    schemaVersion: ENCOUNTER_DIRECTOR_COMMAND_SCHEMA_VERSION,
    commandId: stableId(value.commandId, 'commandId'),
    encounterId: stableId(value.encounterId, 'encounterId'),
    baseRevision: revision(value.baseRevision),
  } as const
  const payload = value.payload
  if (value.type === 'set-participant-visibility') {
    exact(payload, ['participantId', 'visibility'], 'visibility payload')
    if (payload.visibility !== 'hidden' && payload.visibility !== 'revealed') fail('invalid-command', 'visibility is invalid.')
    return { ...base, type: value.type, payload: { participantId: stableId(payload.participantId, 'participantId'), visibility: payload.visibility } }
  }
  if (value.type === 'upsert-reserve') {
    exact(payload, ['reserve'], 'reserve payload')
    if (!isRecord(payload.reserve)) fail('invalid-command', 'reserve must be an object.')
    return { ...base, type: value.type, payload: { reserve: payload.reserve as unknown as EncounterDocumentReserve } }
  }
  if (value.type === 'remove-reserve') {
    exact(payload, ['reserveId'], 'remove reserve payload')
    return { ...base, type: value.type, payload: { reserveId: stableId(payload.reserveId, 'reserveId') } }
  }
  if (value.type === 'upsert-wave') {
    exact(payload, ['wave'], 'wave payload')
    if (!isRecord(payload.wave)) fail('invalid-command', 'wave must be an object.')
    return { ...base, type: value.type, payload: { wave: payload.wave as unknown as EncounterDocumentWave } }
  }
  if (value.type === 'set-wave-status') {
    exact(payload, ['waveId', 'status'], 'wave status payload')
    if (!['planned', 'ready', 'deployed', 'completed'].includes(String(payload.status))) fail('invalid-command', 'wave status is invalid.')
    return { ...base, type: value.type, payload: { waveId: stableId(payload.waveId, 'waveId'), status: payload.status as EncounterDocumentWave['status'] } }
  }
  if (value.type === 'upsert-objective') {
    exact(payload, ['objective'], 'objective payload')
    if (!isRecord(payload.objective)) fail('invalid-command', 'objective must be an object.')
    return { ...base, type: value.type, payload: { objective: payload.objective as unknown as EncounterDocumentObjective } }
  }
  if (value.type === 'remove-objective') {
    exact(payload, ['objectiveId'], 'remove objective payload')
    return { ...base, type: value.type, payload: { objectiveId: stableId(payload.objectiveId, 'objectiveId') } }
  }
  if (value.type === 'upsert-clock') {
    exact(payload, ['clock'], 'clock payload')
    if (!isRecord(payload.clock)) fail('invalid-command', 'clock must be an object.')
    return { ...base, type: value.type, payload: { clock: payload.clock as unknown as EncounterDocumentClock } }
  }
  if (value.type === 'remove-clock') {
    exact(payload, ['clockId'], 'remove clock payload')
    return { ...base, type: value.type, payload: { clockId: stableId(payload.clockId, 'clockId') } }
  }
  if (value.type === 'upsert-phase') {
    exact(payload, ['phase'], 'phase payload')
    if (!isRecord(payload.phase)) fail('invalid-command', 'phase must be an object.')
    return { ...base, type: value.type, payload: { phase: payload.phase as unknown as EncounterDocumentPhase } }
  }
  if (value.type === 'activate-phase') {
    exact(payload, ['phaseId'], 'activate phase payload')
    return { ...base, type: value.type, payload: { phaseId: stableId(payload.phaseId, 'phaseId') } }
  }
  if (value.type === 'set-story') {
    exact(payload, ['name', 'lifecycle', 'publicStakes', 'gmStakes', 'notes'], 'story payload')
    if (typeof payload.name !== 'string' || !['draft', 'active', 'paused', 'completed', 'archived'].includes(String(payload.lifecycle))
      || (payload.publicStakes !== null && typeof payload.publicStakes !== 'string')
      || (payload.gmStakes !== null && typeof payload.gmStakes !== 'string')
      || (payload.notes !== null && typeof payload.notes !== 'string')) fail('invalid-command', 'story payload values are invalid.')
    return {
      ...base,
      type: value.type,
      payload: {
        name: payload.name,
        lifecycle: payload.lifecycle as EncounterDocument['lifecycle'],
        publicStakes: payload.publicStakes as string | null,
        gmStakes: payload.gmStakes as string | null,
        notes: payload.notes as string | null,
      },
    }
  }
  return fail('invalid-command', `Unsupported Director command ${String(value.type)}.`)
}

const upsert = <T>(values: readonly T[], value: T, identity: (entry: T) => string): readonly T[] => {
  const target = identity(value)
  const index = values.findIndex(entry => identity(entry) === target)
  return index < 0 ? [...values, value] : values.map((entry, entryIndex) => entryIndex === index ? value : entry)
}

export const applyEncounterDirectorCommand = (input: {
  readonly document: EncounterDocument
  readonly command: EncounterDirectorCommand
  readonly now?: number
}): EncounterDocument => {
  const { document, command } = input
  if (command.encounterId !== document.encounterId) fail('identity-mismatch', 'Director command belongs to another encounter.')
  if (command.baseRevision !== document.revision) fail('stale-revision', `Encounter changed; expected revision ${command.baseRevision}, current revision ${document.revision}.`)
  const next: Record<string, unknown> = { ...document }
  if (command.type === 'set-participant-visibility') {
    const hidden = new Set(document.hiddenParticipantIds)
    if (command.payload.visibility === 'hidden') hidden.add(command.payload.participantId)
    else hidden.delete(command.payload.participantId)
    if (hidden.size > ENCOUNTER_DOCUMENT_LIMITS.hiddenParticipants) fail('limit-exceeded', 'Hidden participant limit exceeded.')
    next.hiddenParticipantIds = [...hidden].sort((left, right) => left.localeCompare(right))
  }
  else if (command.type === 'upsert-reserve') next.reserves = upsert(document.reserves, command.payload.reserve, reserve => reserve.reserveId)
  else if (command.type === 'remove-reserve') {
    if (!document.reserves.some(reserve => reserve.reserveId === command.payload.reserveId)) fail('not-found', 'Reserve was not found.')
    if (document.waves.some(wave => wave.reserveIds.includes(command.payload.reserveId))) fail('invalid-command', 'Remove the reserve from its waves first.')
    next.reserves = document.reserves.filter(reserve => reserve.reserveId !== command.payload.reserveId)
  }
  else if (command.type === 'upsert-wave') next.waves = upsert(document.waves, command.payload.wave, wave => wave.waveId)
  else if (command.type === 'set-wave-status') {
    const wave = document.waves.find(entry => entry.waveId === command.payload.waveId) ?? fail('not-found', 'Wave was not found.')
    next.waves = document.waves.map(entry => entry.waveId === wave.waveId ? { ...entry, status: command.payload.status } : entry)
    if (command.payload.status === 'deployed' && wave.revealOnDeploy) {
      const reveal = new Set(wave.participantIds)
      next.hiddenParticipantIds = document.hiddenParticipantIds.filter(participantId => !reveal.has(participantId))
    }
  }
  else if (command.type === 'upsert-objective') next.objectives = upsert(document.objectives, command.payload.objective, objective => objective.objectiveId)
  else if (command.type === 'remove-objective') {
    if (!document.objectives.some(objective => objective.objectiveId === command.payload.objectiveId)) fail('not-found', 'Objective was not found.')
    next.objectives = document.objectives.filter(objective => objective.objectiveId !== command.payload.objectiveId)
  }
  else if (command.type === 'upsert-clock') next.clocks = upsert(document.clocks, command.payload.clock, clock => clock.clockId)
  else if (command.type === 'remove-clock') {
    if (!document.clocks.some(clock => clock.clockId === command.payload.clockId)) fail('not-found', 'Clock was not found.')
    next.clocks = document.clocks.filter(clock => clock.clockId !== command.payload.clockId)
  }
  else if (command.type === 'upsert-phase') next.phases = upsert(document.phases, command.payload.phase, phase => phase.phaseId)
  else if (command.type === 'activate-phase') {
    if (!document.phases.some(phase => phase.phaseId === command.payload.phaseId)) fail('not-found', 'Phase was not found.')
    next.phases = document.phases.map(phase => ({
      ...phase,
      status: phase.phaseId === command.payload.phaseId ? 'active' : phase.status === 'active' ? 'completed' : phase.status,
    }))
    next.activePhaseId = command.payload.phaseId
  }
  else if (command.type === 'set-story') {
    next.name = command.payload.name
    next.lifecycle = command.payload.lifecycle
    next.stakes = { public: command.payload.publicStakes, gm: command.payload.gmStakes }
    next.notes = command.payload.notes
  }
  next.revision = document.revision + 1
  next.updatedAt = input.now ?? Date.now()
  try {
    return parseEncounterDocument(next)
  }
  catch (error) {
    fail('invalid-command', error instanceof Error ? error.message : 'Director command produced an invalid encounter.')
  }
}
