export const ENCOUNTER_DOCUMENT_SCHEMA_VERSION = 1 as const

export const ENCOUNTER_RECIPE_IDS = [
  'trainer-duel',
  'wild-pack',
  'ambush',
  'swarm',
  'boss',
  'hunt-capture',
  'chase-ready',
  'blank',
] as const
export type EncounterRecipeId = typeof ENCOUNTER_RECIPE_IDS[number]

export const ENCOUNTER_DOCUMENT_LIMITS = Object.freeze({
  hiddenParticipants: 512,
  castRoles: 512,
  reserves: 512,
  waves: 64,
  membersPerWave: 512,
  objectives: 64,
  clocks: 64,
  phases: 32,
  labelChars: 200,
  storyChars: 4_000,
  notesChars: 20_000,
})

export interface EncounterDocumentCastRole {
  readonly participantId: string
  readonly role: 'boss' | 'leader' | 'standard' | 'minion' | 'support'
}

export interface EncounterDocumentReserve {
  readonly reserveId: string
  readonly sheetKind: 'pokemon' | 'trainer'
  readonly sheetSlug: string
  readonly displayName: string
  readonly sideId: string | null
  readonly ownerParticipantId: string | null
  readonly visibility: 'public' | 'gm'
  readonly status: 'ready' | 'deployed' | 'withdrawn'
  readonly placementId: string | null
}

export interface EncounterDocumentWave {
  readonly waveId: string
  readonly label: string
  readonly status: 'planned' | 'ready' | 'deployed' | 'completed'
  readonly participantIds: readonly string[]
  readonly reserveIds: readonly string[]
  readonly revealOnDeploy: boolean
}

export interface EncounterDocumentObjective {
  readonly objectiveId: string
  readonly label: string
  readonly visibility: 'public' | 'gm'
  readonly status: 'active' | 'completed' | 'failed'
  readonly progress: number | null
  readonly maximum: number | null
}

export interface EncounterDocumentClock {
  readonly clockId: string
  readonly label: string
  readonly visibility: 'public' | 'gm'
  readonly status: 'active' | 'paused' | 'completed'
  readonly progress: number
  readonly maximum: number
}

export interface EncounterDocumentPhase {
  readonly phaseId: string
  readonly label: string
  readonly visibility: 'public' | 'gm'
  readonly status: 'upcoming' | 'active' | 'completed'
  readonly summary: string | null
}

export interface EncounterDocument {
  readonly schemaVersion: typeof ENCOUNTER_DOCUMENT_SCHEMA_VERSION
  readonly encounterId: string
  readonly revision: number
  readonly name: string
  readonly linkedMapSlug: string
  readonly lifecycle: 'draft' | 'active' | 'paused' | 'completed' | 'archived'
  readonly recipe: EncounterRecipeId
  readonly presentation: {
    readonly stage: 'standard' | 'boss' | 'chase'
    readonly tactical: 'on-demand' | 'split'
  }
  readonly hiddenParticipantIds: readonly string[]
  readonly castRoles: readonly EncounterDocumentCastRole[]
  readonly reserves: readonly EncounterDocumentReserve[]
  readonly waves: readonly EncounterDocumentWave[]
  readonly objectives: readonly EncounterDocumentObjective[]
  readonly clocks: readonly EncounterDocumentClock[]
  readonly phases: readonly EncounterDocumentPhase[]
  readonly activePhaseId: string | null
  readonly stakes: {
    readonly public: string | null
    readonly gm: string | null
  }
  readonly notes: string | null
  readonly createdAt: number
  readonly updatedAt: number
}

export class EncounterDocumentValidationError extends Error {
  constructor(readonly path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'EncounterDocumentValidationError'
  }
}

function fail(path: string, message: string): never { throw new EncounterDocumentValidationError(path, message) }
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const exactKeys = (value: Record<string, unknown>, expected: readonly string[], path: string): void => {
  const allowed = new Set(expected)
  const unknown = Object.keys(value).filter(key => !allowed.has(key))
  const missing = expected.filter(key => !Object.prototype.hasOwnProperty.call(value, key))
  if (unknown.length || missing.length) fail(path, `must contain exactly ${expected.join(', ')}`)
}
const id = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(value)) fail(path, 'must be a stable bounded ID')
  return value
}
const text = (value: unknown, path: string, maximum: number = ENCOUNTER_DOCUMENT_LIMITS.labelChars): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    fail(path, `must be non-empty text of at most ${maximum} characters`)
  }
  return value.trim()
}
const optionalText = (value: unknown, path: string, maximum: number): string | null => value === null ? null : text(value, path, maximum)
const integer = (value: unknown, path: string): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) fail(path, 'must be a non-negative safe integer')
  return Number(value)
}
const oneOf = <T extends string>(value: unknown, values: readonly T[], path: string): T => {
  if (typeof value !== 'string' || !values.includes(value as T)) fail(path, `must be one of ${values.join(', ')}`)
  return value as T
}
const nullableId = (value: unknown, path: string): string | null => value === null ? null : id(value, path)
const unique = (values: readonly string[], path: string): void => {
  if (new Set(values).size !== values.length) fail(path, 'must not contain duplicate identities')
}
const idArray = (value: unknown, path: string, limit: number): readonly string[] => {
  if (!Array.isArray(value) || value.length > limit) fail(path, `must be an array with at most ${limit} entries`)
  const result = value.map((entry, index) => id(entry, `${path}[${index}]`))
  unique(result, path)
  return Object.freeze(result)
}

const parseCastRole = (value: unknown, path: string): EncounterDocumentCastRole => {
  if (!isRecord(value)) fail(path, 'must be an object')
  exactKeys(value, ['participantId', 'role'], path)
  return Object.freeze({
    participantId: id(value.participantId, `${path}.participantId`),
    role: oneOf(value.role, ['boss', 'leader', 'standard', 'minion', 'support'] as const, `${path}.role`),
  })
}

const parseReserve = (value: unknown, path: string): EncounterDocumentReserve => {
  if (!isRecord(value)) fail(path, 'must be an object')
  exactKeys(value, ['reserveId', 'sheetKind', 'sheetSlug', 'displayName', 'sideId', 'ownerParticipantId', 'visibility', 'status', 'placementId'], path)
  const status = oneOf(value.status, ['ready', 'deployed', 'withdrawn'] as const, `${path}.status`)
  const placementId = nullableId(value.placementId, `${path}.placementId`)
  if ((status === 'deployed') !== (placementId !== null)) fail(path, 'deployed reserves require one placementId and other states require null')
  return Object.freeze({
    reserveId: id(value.reserveId, `${path}.reserveId`),
    sheetKind: oneOf(value.sheetKind, ['pokemon', 'trainer'] as const, `${path}.sheetKind`),
    sheetSlug: id(value.sheetSlug, `${path}.sheetSlug`),
    displayName: text(value.displayName, `${path}.displayName`),
    sideId: nullableId(value.sideId, `${path}.sideId`),
    ownerParticipantId: nullableId(value.ownerParticipantId, `${path}.ownerParticipantId`),
    visibility: oneOf(value.visibility, ['public', 'gm'] as const, `${path}.visibility`),
    status,
    placementId,
  })
}

const parseWave = (value: unknown, path: string): EncounterDocumentWave => {
  if (!isRecord(value)) fail(path, 'must be an object')
  exactKeys(value, ['waveId', 'label', 'status', 'participantIds', 'reserveIds', 'revealOnDeploy'], path)
  if (typeof value.revealOnDeploy !== 'boolean') fail(`${path}.revealOnDeploy`, 'must be a boolean')
  return Object.freeze({
    waveId: id(value.waveId, `${path}.waveId`),
    label: text(value.label, `${path}.label`),
    status: oneOf(value.status, ['planned', 'ready', 'deployed', 'completed'] as const, `${path}.status`),
    participantIds: idArray(value.participantIds, `${path}.participantIds`, ENCOUNTER_DOCUMENT_LIMITS.membersPerWave),
    reserveIds: idArray(value.reserveIds, `${path}.reserveIds`, ENCOUNTER_DOCUMENT_LIMITS.membersPerWave),
    revealOnDeploy: value.revealOnDeploy,
  })
}

const parseObjective = (value: unknown, path: string): EncounterDocumentObjective => {
  if (!isRecord(value)) fail(path, 'must be an object')
  exactKeys(value, ['objectiveId', 'label', 'visibility', 'status', 'progress', 'maximum'], path)
  const progress = value.progress === null ? null : integer(value.progress, `${path}.progress`)
  const maximum = value.maximum === null ? null : integer(value.maximum, `${path}.maximum`)
  if ((progress === null) !== (maximum === null) || (progress !== null && maximum !== null && (maximum < 1 || progress > maximum))) {
    fail(path, 'progress and maximum must both be null or form a bounded progress pair')
  }
  return Object.freeze({
    objectiveId: id(value.objectiveId, `${path}.objectiveId`),
    label: text(value.label, `${path}.label`),
    visibility: oneOf(value.visibility, ['public', 'gm'] as const, `${path}.visibility`),
    status: oneOf(value.status, ['active', 'completed', 'failed'] as const, `${path}.status`),
    progress,
    maximum,
  })
}

const parseClock = (value: unknown, path: string): EncounterDocumentClock => {
  if (!isRecord(value)) fail(path, 'must be an object')
  exactKeys(value, ['clockId', 'label', 'visibility', 'status', 'progress', 'maximum'], path)
  const progress = integer(value.progress, `${path}.progress`)
  const maximum = integer(value.maximum, `${path}.maximum`)
  if (maximum < 1 || progress > maximum) fail(path, 'must form a bounded progress pair')
  return Object.freeze({
    clockId: id(value.clockId, `${path}.clockId`),
    label: text(value.label, `${path}.label`),
    visibility: oneOf(value.visibility, ['public', 'gm'] as const, `${path}.visibility`),
    status: oneOf(value.status, ['active', 'paused', 'completed'] as const, `${path}.status`),
    progress,
    maximum,
  })
}

const parsePhase = (value: unknown, path: string): EncounterDocumentPhase => {
  if (!isRecord(value)) fail(path, 'must be an object')
  exactKeys(value, ['phaseId', 'label', 'visibility', 'status', 'summary'], path)
  return Object.freeze({
    phaseId: id(value.phaseId, `${path}.phaseId`),
    label: text(value.label, `${path}.label`),
    visibility: oneOf(value.visibility, ['public', 'gm'] as const, `${path}.visibility`),
    status: oneOf(value.status, ['upcoming', 'active', 'completed'] as const, `${path}.status`),
    summary: optionalText(value.summary, `${path}.summary`, ENCOUNTER_DOCUMENT_LIMITS.storyChars),
  })
}

const parseBoundedObjects = <T>(value: unknown, path: string, limit: number, parse: (entry: unknown, path: string) => T): readonly T[] => {
  if (!Array.isArray(value) || value.length > limit) fail(path, `must be an array with at most ${limit} entries`)
  return Object.freeze(value.map((entry, index) => parse(entry, `${path}[${index}]`)))
}

export const parseEncounterDocument = (value: unknown): EncounterDocument => {
  if (!isRecord(value)) fail('encounter', 'must be an object')
  exactKeys(value, [
    'schemaVersion', 'encounterId', 'revision', 'name', 'linkedMapSlug', 'lifecycle', 'recipe', 'presentation',
    'hiddenParticipantIds', 'castRoles', 'reserves', 'waves', 'objectives', 'clocks', 'phases', 'activePhaseId',
    'stakes', 'notes', 'createdAt', 'updatedAt',
  ], 'encounter')
  if (value.schemaVersion !== ENCOUNTER_DOCUMENT_SCHEMA_VERSION) fail('encounter.schemaVersion', 'is unsupported')
  if (!isRecord(value.presentation)) fail('encounter.presentation', 'must be an object')
  exactKeys(value.presentation, ['stage', 'tactical'], 'encounter.presentation')
  const castRoles = parseBoundedObjects(value.castRoles, 'encounter.castRoles', ENCOUNTER_DOCUMENT_LIMITS.castRoles, parseCastRole)
  const reserves = parseBoundedObjects(value.reserves, 'encounter.reserves', ENCOUNTER_DOCUMENT_LIMITS.reserves, parseReserve)
  const waves = parseBoundedObjects(value.waves, 'encounter.waves', ENCOUNTER_DOCUMENT_LIMITS.waves, parseWave)
  const objectives = parseBoundedObjects(value.objectives, 'encounter.objectives', ENCOUNTER_DOCUMENT_LIMITS.objectives, parseObjective)
  const clocks = parseBoundedObjects(value.clocks, 'encounter.clocks', ENCOUNTER_DOCUMENT_LIMITS.clocks, parseClock)
  const phases = parseBoundedObjects(value.phases, 'encounter.phases', ENCOUNTER_DOCUMENT_LIMITS.phases, parsePhase)
  unique(castRoles.map(entry => entry.participantId), 'encounter.castRoles')
  unique(reserves.map(entry => entry.reserveId), 'encounter.reserves')
  unique(waves.map(entry => entry.waveId), 'encounter.waves')
  unique(objectives.map(entry => entry.objectiveId), 'encounter.objectives')
  unique(clocks.map(entry => entry.clockId), 'encounter.clocks')
  unique(phases.map(entry => entry.phaseId), 'encounter.phases')
  const reserveIds = new Set(reserves.map(entry => entry.reserveId))
  for (const wave of waves) if (!wave.reserveIds.every(reserveId => reserveIds.has(reserveId))) fail(`encounter.waves.${wave.waveId}`, 'references an unknown reserve')
  const activePhaseId = nullableId(value.activePhaseId, 'encounter.activePhaseId')
  if (activePhaseId !== null && !phases.some(phase => phase.phaseId === activePhaseId && phase.status === 'active')) {
    fail('encounter.activePhaseId', 'must reference the active phase')
  }
  if (!isRecord(value.stakes)) fail('encounter.stakes', 'must be an object')
  exactKeys(value.stakes, ['public', 'gm'], 'encounter.stakes')
  const createdAt = integer(value.createdAt, 'encounter.createdAt')
  const updatedAt = integer(value.updatedAt, 'encounter.updatedAt')
  if (updatedAt < createdAt) fail('encounter.updatedAt', 'must not precede createdAt')
  return Object.freeze({
    schemaVersion: ENCOUNTER_DOCUMENT_SCHEMA_VERSION,
    encounterId: id(value.encounterId, 'encounter.encounterId'),
    revision: integer(value.revision, 'encounter.revision'),
    name: text(value.name, 'encounter.name'),
    linkedMapSlug: id(value.linkedMapSlug, 'encounter.linkedMapSlug'),
    lifecycle: oneOf(value.lifecycle, ['draft', 'active', 'paused', 'completed', 'archived'] as const, 'encounter.lifecycle'),
    recipe: oneOf(value.recipe, ENCOUNTER_RECIPE_IDS, 'encounter.recipe'),
    presentation: Object.freeze({
      stage: oneOf(value.presentation.stage, ['standard', 'boss', 'chase'] as const, 'encounter.presentation.stage'),
      tactical: oneOf(value.presentation.tactical, ['on-demand', 'split'] as const, 'encounter.presentation.tactical'),
    }),
    hiddenParticipantIds: idArray(value.hiddenParticipantIds, 'encounter.hiddenParticipantIds', ENCOUNTER_DOCUMENT_LIMITS.hiddenParticipants),
    castRoles,
    reserves,
    waves,
    objectives,
    clocks,
    phases,
    activePhaseId,
    stakes: Object.freeze({
      public: optionalText(value.stakes.public, 'encounter.stakes.public', ENCOUNTER_DOCUMENT_LIMITS.storyChars),
      gm: optionalText(value.stakes.gm, 'encounter.stakes.gm', ENCOUNTER_DOCUMENT_LIMITS.storyChars),
    }),
    notes: optionalText(value.notes, 'encounter.notes', ENCOUNTER_DOCUMENT_LIMITS.notesChars),
    createdAt,
    updatedAt,
  })
}

export const createEncounterDocument = (input: {
  readonly encounterId: string
  readonly name: string
  readonly linkedMapSlug: string
  readonly recipe?: EncounterRecipeId
  readonly now?: number
}): EncounterDocument => parseEncounterDocument({
  schemaVersion: ENCOUNTER_DOCUMENT_SCHEMA_VERSION,
  encounterId: input.encounterId,
  revision: 0,
  name: input.name,
  linkedMapSlug: input.linkedMapSlug,
  lifecycle: 'draft',
  recipe: input.recipe ?? 'blank',
  presentation: {
    stage: input.recipe === 'boss' ? 'boss' : input.recipe === 'chase-ready' ? 'chase' : 'standard',
    tactical: input.recipe === 'chase-ready' ? 'split' : 'on-demand',
  },
  hiddenParticipantIds: [],
  castRoles: [],
  reserves: [],
  waves: [],
  objectives: [],
  clocks: [],
  phases: [],
  activePhaseId: null,
  stakes: { public: null, gm: null },
  notes: null,
  createdAt: input.now ?? Date.now(),
  updatedAt: input.now ?? Date.now(),
})
