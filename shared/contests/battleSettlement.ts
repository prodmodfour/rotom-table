import { createHash } from 'node:crypto'
import { stableJsonStringify } from '../automation/stableJson'

export const BATTLE_CONTEST_SETTLEMENT_COORDINATION_SCHEMA_VERSION = 1 as const

export interface BattleContestSettlementSheetWriteV1 {
  readonly kind: 'trainer' | 'pokemon'
  readonly slug: string
  readonly revision: number
  readonly definitionSha256: string
}

interface BattleContestSettlementCoordinationCommonV1 {
  readonly schemaVersion: typeof BATTLE_CONTEST_SETTLEMENT_COORDINATION_SCHEMA_VERSION
  readonly status: 'prepared' | 'accepted'
  readonly contestId: string
  readonly battleContestLinkId: string
  readonly encounterId: string
  readonly mapSlug: string
  readonly encounterSettlementId: string
  readonly encounterSettlementOperationId: string
  readonly expectedEncounterSettlementRevision: number
  readonly encounterPlanDefinitionSha256: string
  readonly contestRewardDefinitionSha256: string
  readonly preparedByContestOperationId: string
  readonly acceptedByContestOperationId: string | null
  readonly encounterResultDefinitionSha256: string | null
  readonly encounterSettlementRevision: number | null
  readonly encounterDocumentRevision: number | null
  readonly encounterMapRevision: number | null
  readonly contestSheetWrites: readonly BattleContestSettlementSheetWriteV1[]
  /** Hash of every field above. It is the immutable combined-boundary receipt identity. */
  readonly combinedDefinitionSha256: string
}

export type BattleContestSettlementCoordinationV1 = BattleContestSettlementCoordinationCommonV1

export class BattleContestSettlementCoordinationError extends Error {
  constructor(readonly path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'BattleContestSettlementCoordinationError'
  }
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,239}$/
const HASH = /^[a-f0-9]{64}$/
const fail = (path: string, message: string): never => {
  throw new BattleContestSettlementCoordinationError(path, message)
}
const isObject = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)
const exact = (value: Record<string, unknown>, fields: readonly string[], path: string): void => {
  const actual = Object.keys(value).sort(), expected = [...fields].sort()
  if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index])) {
    fail(path, `must contain exactly ${expected.join(', ')}.`)
  }
}
const id = (value: unknown, path: string): string => (
  typeof value === 'string' && ID.test(value) ? value : fail(path, 'must be one bounded stable identity.')
)
const hash = (value: unknown, path: string): string => (
  typeof value === 'string' && HASH.test(value) ? value : fail(path, 'must be one lowercase SHA-256 digest.')
)
const revision = (value: unknown, path: string): number => (
  Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : fail(path, 'must be a safe non-negative integer.')
)
const nullableRevision = (value: unknown, path: string): number | null => value === null ? null : revision(value, path)
const nullableId = (value: unknown, path: string): string | null => value === null ? null : id(value, path)
const nullableHash = (value: unknown, path: string): string | null => value === null ? null : hash(value, path)

export const battleContestSettlementDefinitionSha256 = (value: unknown): string => createHash('sha256')
  .update(stableJsonStringify(value, {
    path: 'battleContestSettlement',
    limits: {
      maxDepth: 32,
      maxNodes: 100_000,
      maxObjectFields: 1_000,
      maxArrayEntries: 10_000,
      maxStringLength: 32_768,
    },
  }))
  .digest('hex')

const withoutCombinedHash = (
  value: Omit<BattleContestSettlementCoordinationV1, 'combinedDefinitionSha256'>,
): Omit<BattleContestSettlementCoordinationV1, 'combinedDefinitionSha256'> => value

const combinedHash = (
  value: Omit<BattleContestSettlementCoordinationV1, 'combinedDefinitionSha256'>,
): string => battleContestSettlementDefinitionSha256(withoutCombinedHash(value))

export const createPreparedBattleContestSettlementCoordination = (input: {
  readonly contestId: string
  readonly battleContestLinkId: string
  readonly encounterId: string
  readonly mapSlug: string
  readonly encounterSettlementId: string
  readonly encounterSettlementOperationId: string
  readonly expectedEncounterSettlementRevision: number
  readonly encounterPlanDefinitionSha256: string
  readonly contestRewardDefinitionSha256: string
  readonly preparedByContestOperationId: string
}): BattleContestSettlementCoordinationV1 => {
  const base: Omit<BattleContestSettlementCoordinationV1, 'combinedDefinitionSha256'> = Object.freeze({
    schemaVersion: BATTLE_CONTEST_SETTLEMENT_COORDINATION_SCHEMA_VERSION,
    status: 'prepared',
    contestId: id(input.contestId, 'coordination.contestId'),
    battleContestLinkId: id(input.battleContestLinkId, 'coordination.battleContestLinkId'),
    encounterId: id(input.encounterId, 'coordination.encounterId'),
    mapSlug: id(input.mapSlug, 'coordination.mapSlug'),
    encounterSettlementId: id(input.encounterSettlementId, 'coordination.encounterSettlementId'),
    encounterSettlementOperationId: id(input.encounterSettlementOperationId, 'coordination.encounterSettlementOperationId'),
    expectedEncounterSettlementRevision: revision(input.expectedEncounterSettlementRevision, 'coordination.expectedEncounterSettlementRevision'),
    encounterPlanDefinitionSha256: hash(input.encounterPlanDefinitionSha256, 'coordination.encounterPlanDefinitionSha256'),
    contestRewardDefinitionSha256: hash(input.contestRewardDefinitionSha256, 'coordination.contestRewardDefinitionSha256'),
    preparedByContestOperationId: id(input.preparedByContestOperationId, 'coordination.preparedByContestOperationId'),
    acceptedByContestOperationId: null,
    encounterResultDefinitionSha256: null,
    encounterSettlementRevision: null,
    encounterDocumentRevision: null,
    encounterMapRevision: null,
    contestSheetWrites: Object.freeze([]),
  })
  return Object.freeze({ ...base, combinedDefinitionSha256: combinedHash(base) })
}

export const acceptBattleContestSettlementCoordination = (input: {
  readonly prepared: BattleContestSettlementCoordinationV1
  readonly acceptedByContestOperationId: string
  readonly encounterResultDefinitionSha256: string
  readonly encounterSettlementRevision: number
  readonly encounterDocumentRevision: number
  readonly encounterMapRevision: number | null
  readonly contestSheetWrites: readonly BattleContestSettlementSheetWriteV1[]
}): BattleContestSettlementCoordinationV1 => {
  const prepared = parseBattleContestSettlementCoordination(input.prepared)
  if (prepared.status !== 'prepared') fail('coordination.status', 'must be prepared before acceptance.')
  const writes = input.contestSheetWrites.map((write, index) => Object.freeze({
    kind: write.kind === 'trainer' || write.kind === 'pokemon'
      ? write.kind
      : fail(`coordination.contestSheetWrites[${index}].kind`, 'must be trainer or pokemon.'),
    slug: id(write.slug, `coordination.contestSheetWrites[${index}].slug`),
    revision: revision(write.revision, `coordination.contestSheetWrites[${index}].revision`),
    definitionSha256: hash(write.definitionSha256, `coordination.contestSheetWrites[${index}].definitionSha256`),
  })).sort((left, right) => `${left.kind}:${left.slug}`.localeCompare(`${right.kind}:${right.slug}`))
  if (writes.length < 1 || writes.length > 16 || new Set(writes.map(write => `${write.kind}:${write.slug}`)).size !== writes.length) {
    fail('coordination.contestSheetWrites', 'must contain 1 through 16 unique final Contest sheet writes.')
  }
  const { combinedDefinitionSha256: _preparedHash, ...preparedBase } = prepared
  const base: Omit<BattleContestSettlementCoordinationV1, 'combinedDefinitionSha256'> = Object.freeze({
    ...preparedBase,
    status: 'accepted',
    acceptedByContestOperationId: id(input.acceptedByContestOperationId, 'coordination.acceptedByContestOperationId'),
    encounterResultDefinitionSha256: hash(input.encounterResultDefinitionSha256, 'coordination.encounterResultDefinitionSha256'),
    encounterSettlementRevision: revision(input.encounterSettlementRevision, 'coordination.encounterSettlementRevision'),
    encounterDocumentRevision: revision(input.encounterDocumentRevision, 'coordination.encounterDocumentRevision'),
    encounterMapRevision: input.encounterMapRevision === null ? null : revision(input.encounterMapRevision, 'coordination.encounterMapRevision'),
    contestSheetWrites: Object.freeze(writes),
  })
  return Object.freeze({ ...base, combinedDefinitionSha256: combinedHash(base) })
}

export const parseBattleContestSettlementCoordination = (value: unknown): BattleContestSettlementCoordinationV1 => {
  const row = isObject(value) ? value : fail('coordination', 'must be an object.')
  exact(row, [
    'schemaVersion', 'status', 'contestId', 'battleContestLinkId', 'encounterId', 'mapSlug',
    'encounterSettlementId', 'encounterSettlementOperationId', 'expectedEncounterSettlementRevision',
    'encounterPlanDefinitionSha256', 'contestRewardDefinitionSha256', 'preparedByContestOperationId',
    'acceptedByContestOperationId', 'encounterResultDefinitionSha256', 'encounterSettlementRevision',
    'encounterDocumentRevision', 'encounterMapRevision', 'contestSheetWrites', 'combinedDefinitionSha256',
  ], 'coordination')
  if (row.schemaVersion !== BATTLE_CONTEST_SETTLEMENT_COORDINATION_SCHEMA_VERSION) {
    fail('coordination.schemaVersion', `must equal ${BATTLE_CONTEST_SETTLEMENT_COORDINATION_SCHEMA_VERSION}.`)
  }
  if (row.status !== 'prepared' && row.status !== 'accepted') fail('coordination.status', 'must be prepared or accepted.')
  const status = row.status as 'prepared' | 'accepted'
  const rawWrites = Array.isArray(row.contestSheetWrites)
    ? row.contestSheetWrites
    : fail('coordination.contestSheetWrites', 'must be an array.')
  if (rawWrites.length > 16) fail('coordination.contestSheetWrites', 'must contain at most 16 writes.')
  const writes = rawWrites.map((raw, index) => {
    const path = `coordination.contestSheetWrites[${index}]`, write = isObject(raw) ? raw : fail(path, 'must be an object.')
    exact(write, ['kind', 'slug', 'revision', 'definitionSha256'], path)
    if (write.kind !== 'trainer' && write.kind !== 'pokemon') fail(`${path}.kind`, 'must be trainer or pokemon.')
    const kind = write.kind as 'trainer' | 'pokemon'
    return Object.freeze({
      kind,
      slug: id(write.slug, `${path}.slug`),
      revision: revision(write.revision, `${path}.revision`),
      definitionSha256: hash(write.definitionSha256, `${path}.definitionSha256`),
    })
  })
  if (new Set(writes.map(write => `${write.kind}:${write.slug}`)).size !== writes.length) {
    fail('coordination.contestSheetWrites', 'must contain unique sheet identities.')
  }
  const parsed: Omit<BattleContestSettlementCoordinationV1, 'combinedDefinitionSha256'> = Object.freeze({
    schemaVersion: BATTLE_CONTEST_SETTLEMENT_COORDINATION_SCHEMA_VERSION,
    status,
    contestId: id(row.contestId, 'coordination.contestId'),
    battleContestLinkId: id(row.battleContestLinkId, 'coordination.battleContestLinkId'),
    encounterId: id(row.encounterId, 'coordination.encounterId'),
    mapSlug: id(row.mapSlug, 'coordination.mapSlug'),
    encounterSettlementId: id(row.encounterSettlementId, 'coordination.encounterSettlementId'),
    encounterSettlementOperationId: id(row.encounterSettlementOperationId, 'coordination.encounterSettlementOperationId'),
    expectedEncounterSettlementRevision: revision(row.expectedEncounterSettlementRevision, 'coordination.expectedEncounterSettlementRevision'),
    encounterPlanDefinitionSha256: hash(row.encounterPlanDefinitionSha256, 'coordination.encounterPlanDefinitionSha256'),
    contestRewardDefinitionSha256: hash(row.contestRewardDefinitionSha256, 'coordination.contestRewardDefinitionSha256'),
    preparedByContestOperationId: id(row.preparedByContestOperationId, 'coordination.preparedByContestOperationId'),
    acceptedByContestOperationId: nullableId(row.acceptedByContestOperationId, 'coordination.acceptedByContestOperationId'),
    encounterResultDefinitionSha256: nullableHash(row.encounterResultDefinitionSha256, 'coordination.encounterResultDefinitionSha256'),
    encounterSettlementRevision: nullableRevision(row.encounterSettlementRevision, 'coordination.encounterSettlementRevision'),
    encounterDocumentRevision: nullableRevision(row.encounterDocumentRevision, 'coordination.encounterDocumentRevision'),
    encounterMapRevision: nullableRevision(row.encounterMapRevision, 'coordination.encounterMapRevision'),
    contestSheetWrites: Object.freeze(writes),
  })
  const terminalValues = [
    parsed.acceptedByContestOperationId,
    parsed.encounterResultDefinitionSha256,
    parsed.encounterSettlementRevision,
    parsed.encounterDocumentRevision,
  ]
  if (parsed.status === 'prepared') {
    if (terminalValues.some(entry => entry !== null) || parsed.encounterMapRevision !== null || parsed.contestSheetWrites.length !== 0) {
      fail('coordination', 'prepared evidence cannot retain accepted result or sheet-write authority.')
    }
  }
  else if (terminalValues.some(entry => entry === null) || parsed.contestSheetWrites.length < 1) {
    fail('coordination', 'accepted evidence requires exact result revisions and final Contest sheet writes.')
  }
  const expectedHash = combinedHash(parsed)
  const actualHash = hash(row.combinedDefinitionSha256, 'coordination.combinedDefinitionSha256')
  if (actualHash !== expectedHash) fail('coordination.combinedDefinitionSha256', 'does not match the exact combined settlement evidence.')
  return Object.freeze({ ...parsed, combinedDefinitionSha256: actualHash })
}
