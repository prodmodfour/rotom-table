import { createHash } from 'node:crypto'
import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  BREEDING_ARCHIVE_MAXIMUM_BYTES,
  type BreedingArchiveId,
  type BreedingArchiveRecordKind,
  type BreedingArchiveRecordV1,
  type BreedingArchiveRestoreReceiptV1,
  type BreedingArchiveV1,
} from '#shared/breeding/archives'
import type { BreedingActorAuthorityV1 } from '#shared/breeding/authorization'
import type { BreedingReferenceVersionSnapshotV1 } from '#shared/breeding/readSets'
import {
  createBreedingArchiveRestoreReceiptV1,
  createBreedingArchiveV1,
  parseAuthoritativeBreedingArchiveImportRequestV1,
  parseAuthoritativeBreedingArchiveV1,
  validateBreedingArchiveImportV1,
  validateBreedingCampaignBackupIntegrityV1,
} from '../domain/breeding/archives'
import { parseAuthoritativeBreedingActorAuthorityV1 } from '../domain/breeding/authorization'
import { parseAuthoritativeBreedingReferenceVersionSnapshotV1 } from '../domain/breeding/readSets'
import {
  createSqliteBreedingArchiveRepository,
  type BreedingArchiveRepository,
} from '../storage/breedingArchiveRepository'
import {
  createSqliteBreedingArchiveStateRepository,
  type BreedingArchiveRecordCollection,
  type BreedingArchiveStateRepository,
} from '../storage/breedingArchiveStateRepository'
import { createSqliteCampaignClockRepository } from '../storage/campaignClockRepository'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import { BreedingRepositoryCorruptionError } from '../storage/breedingRepositorySupport'

export const BREEDING_INTEGRITY_DIAGNOSTIC_MAXIMUM = 10_000 as const

export type BreedingArchiveManagerErrorCode =
  | 'breeding.archive-manager.unauthorized'
  | 'breeding.archive-manager.nested-boundary'
  | 'breeding.archive-manager.async-hook'
  | 'breeding.archive-manager.stale-authority'
  | 'breeding.archive-manager.stale-checkpoint'
  | 'breeding.archive-manager.nonempty-target'
  | 'breeding.archive-manager.invalid-envelope'
  | 'breeding.archive-manager.oversized-envelope'

export class BreedingArchiveManagerError extends Error {
  readonly code: BreedingArchiveManagerErrorCode
  constructor(code: BreedingArchiveManagerErrorCode, message: string) {
    super(message)
    this.name = 'BreedingArchiveManagerError'
    this.code = code
  }
}

export type BreedingIntegrityDiagnosticSeverity = 'error' | 'warning'
export type BreedingIntegrityDiagnosticCode =
  | 'breeding.integrity.sqlite'
  | 'breeding.integrity.foreign-key'
  | 'breeding.integrity.corrupt-authority-row'
  | 'breeding.integrity.pending-operation'
  | 'breeding.integrity.missing-owner-trainer'
  | 'breeding.integrity.missing-breeder-trainer'
  | 'breeding.integrity.missing-parent-pokemon'
  | 'breeding.integrity.missing-child-pokemon'
  | 'breeding.integrity.missing-origin'
  | 'breeding.integrity.orphan-origin'
  | 'breeding.integrity.orphan-transfer-consent'
  | 'breeding.integrity.orphan-source-settlement'
  | 'breeding.integrity.orphan-gm-override'
  | 'breeding.integrity.missing-acquisition-trainer'
  | 'breeding.integrity.legacy-map-egg-metadata'

export interface BreedingIntegrityDiagnosticV1 {
  readonly code: BreedingIntegrityDiagnosticCode
  readonly severity: BreedingIntegrityDiagnosticSeverity
  readonly resourceKind: string
  readonly resourceId: string
  readonly relatedResourceId: string | null
}
export interface BreedingIntegrityReportV1 {
  readonly schemaVersion: 1
  readonly campaignIdentitySha256: string
  readonly checkedAtCampaignMinute: number
  readonly healthy: boolean
  readonly backupReady: boolean
  readonly diagnostics: readonly BreedingIntegrityDiagnosticV1[]
  readonly tableCounts: Readonly<Record<string, number>>
  readonly definitionSha256: string
}

export interface BreedingArchiveManagerDependencies {
  readonly database?: RotomDatabase
  readonly authorizeGm: (actor: BreedingActorAuthorityV1) => boolean
  readonly authorizeOwnerExport: (
    actor: BreedingActorAuthorityV1,
    records: Readonly<Partial<Record<BreedingArchiveRecordKind, readonly unknown[]>>>,
  ) => boolean
  readonly validateRecordDependencies: (
    kind: BreedingArchiveRecordKind,
    record: BreedingArchiveRecordV1,
  ) => boolean
}

interface ArchiveIdentityInput {
  readonly archiveId: BreedingArchiveId
  readonly campaignIdentitySha256: string
  readonly rulesetId: string
  readonly rulesetDefinitionSha256: string
  readonly referenceVersions: BreedingReferenceVersionSnapshotV1
  readonly actorAuthority: unknown
}
export interface CreateCampaignBackupInput extends ArchiveIdentityInput {
  readonly beforePersist?: () => void
}
export interface CreateGmAuditInput extends ArchiveIdentityInput {
  readonly beforePersist?: () => void
}
export interface CreateOwnerPortableArchiveInput extends ArchiveIdentityInput {
  readonly records: Readonly<Partial<Record<BreedingArchiveRecordKind, readonly unknown[]>>>
  readonly beforePersist?: () => void
}
export interface RestoreBreedingCampaignInput {
  readonly envelope: string | Uint8Array
  readonly request: unknown
  readonly actorAuthority: unknown
  readonly currentReferenceVersions: unknown
  readonly currentCheckpointArchiveId: BreedingArchiveId | string | null
  readonly beforeReplace?: () => void
  readonly afterReplaceBeforeReceipt?: () => void
}
export interface RestoreBreedingCampaignResult {
  readonly kind: 'restored' | 'validated' | 'exact-replay'
  readonly archive: BreedingArchiveV1
  readonly receipt: BreedingArchiveRestoreReceiptV1
}
export interface RunBreedingIntegrityDiagnosticsInput {
  readonly campaignIdentitySha256: string
  readonly actorAuthority: unknown
}

export interface BreedingArchiveManager {
  readonly database: RotomDatabase
  readonly archiveRepository: BreedingArchiveRepository
  readonly stateRepository: BreedingArchiveStateRepository
  parseEnvelope(envelope: string | Uint8Array): BreedingArchiveV1
  createCampaignBackup(input: CreateCampaignBackupInput): BreedingArchiveV1
  createGmAudit(input: CreateGmAuditInput): BreedingArchiveV1
  createOwnerPortableArchive(input: CreateOwnerPortableArchiveInput): BreedingArchiveV1
  restoreCampaign(input: RestoreBreedingCampaignInput): RestoreBreedingCampaignResult
  runIntegrityDiagnostics(input: RunBreedingIntegrityDiagnosticsInput): BreedingIntegrityReportV1
}

const SHA256 = /^[0-9a-f]{64}$/u
const hash = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex')
const strictHash = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    throw new BreedingArchiveManagerError(
      'breeding.archive-manager.invalid-envelope',
      `${label} must be a lowercase SHA-256 digest.`,
    )
  }
  return value
}
const isPromiseLike = (value: unknown): value is PromiseLike<unknown> => (
  typeof value === 'object' && value !== null && 'then' in value
)
const runSynchronousHook = (hook: (() => void) | undefined): void => {
  if (!hook) return
  const result = hook()
  if (isPromiseLike(result)) {
    throw new BreedingArchiveManagerError(
      'breeding.archive-manager.async-hook',
      'Archive transaction hooks must be synchronous.',
    )
  }
}
const withImmediateTransaction = <Value>(database: RotomDatabase, execute: () => Value): Value => {
  if (database.connection.isTransaction) {
    throw new BreedingArchiveManagerError(
      'breeding.archive-manager.nested-boundary',
      'Breeding archive operations must own their top-level SQLite transaction.',
    )
  }
  database.connection.exec('BEGIN IMMEDIATE')
  try {
    const value = execute()
    if (isPromiseLike(value)) {
      throw new BreedingArchiveManagerError(
        'breeding.archive-manager.async-hook',
        'Breeding archive transaction execution must be synchronous.',
      )
    }
    database.connection.exec('COMMIT')
    return value
  }
  catch (error) {
    if (database.connection.isTransaction) database.connection.exec('ROLLBACK')
    throw error
  }
}
const authorizeCurrentGm = (input: {
  readonly actorAuthority: unknown
  readonly minute: number
  readonly authorizeGm: (actor: BreedingActorAuthorityV1) => boolean
}): BreedingActorAuthorityV1 => {
  const actor = parseAuthoritativeBreedingActorAuthorityV1(input.actorAuthority)
  const authorized = input.authorizeGm(actor)
  if (isPromiseLike(authorized)) {
    throw new BreedingArchiveManagerError(
      'breeding.archive-manager.async-hook',
      'GM authorization must be synchronous.',
    )
  }
  if (actor.role !== 'gm' || authorized !== true) {
    throw new BreedingArchiveManagerError(
      'breeding.archive-manager.unauthorized',
      'Breeding campaign archives and diagnostics require current authenticated GM authority.',
    )
  }
  if (actor.evaluatedAtCampaignMinute !== input.minute) {
    throw new BreedingArchiveManagerError(
      'breeding.archive-manager.stale-authority',
      'GM authority must be evaluated at the exact current campaign minute.',
    )
  }
  return actor
}
const freeze = <Value>(value: Value): Value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child)
    Object.freeze(value)
  }
  return value
}
const archiveEnvelopeText = (envelope: string | Uint8Array): string => {
  const byteLength = typeof envelope === 'string'
    ? Buffer.byteLength(envelope, 'utf8')
    : envelope.byteLength
  if (byteLength > BREEDING_ARCHIVE_MAXIMUM_BYTES) {
    throw new BreedingArchiveManagerError(
      'breeding.archive-manager.oversized-envelope',
      'Breeding archive envelope cannot exceed 64 MiB.',
    )
  }
  if (typeof envelope === 'string') return envelope
  try { return new TextDecoder('utf-8', { fatal: true }).decode(envelope) }
  catch {
    throw new BreedingArchiveManagerError(
      'breeding.archive-manager.invalid-envelope',
      'Breeding archive envelope must contain valid UTF-8 JSON.',
    )
  }
}
const parseEnvelope = (envelope: string | Uint8Array): BreedingArchiveV1 => {
  const text = archiveEnvelopeText(envelope)
  let decoded: unknown
  try { decoded = JSON.parse(text) }
  catch {
    throw new BreedingArchiveManagerError(
      'breeding.archive-manager.invalid-envelope',
      'Breeding archive envelope must contain strict JSON.',
    )
  }
  return parseAuthoritativeBreedingArchiveV1(decoded)
}
const createArchive = (input: ArchiveIdentityInput & {
  readonly purpose: 'campaign-backup' | 'gm-audit'
  readonly minute: number
  readonly records: BreedingArchiveRecordCollection
}): BreedingArchiveV1 => createBreedingArchiveV1({
  archiveId: input.archiveId,
  purpose: input.purpose,
  campaignIdentitySha256: strictHash(input.campaignIdentitySha256, 'campaignIdentitySha256'),
  createdAtCampaignMinute: input.minute,
  rulesetId: input.rulesetId,
  rulesetDefinitionSha256: input.rulesetDefinitionSha256,
  referenceVersions: parseAuthoritativeBreedingReferenceVersionSnapshotV1(input.referenceVersions),
  records: input.records,
})

interface ForeignKeyCheckRow {
  readonly table: unknown
  readonly rowid: unknown
  readonly parent: unknown
  readonly fkid: unknown
}
interface IntegrityCheckRow { readonly integrity_check: unknown }
interface ProjectLinkRow {
  readonly project_id: unknown
  readonly owner_trainer_slug: unknown
  readonly breeder_trainer_slug: unknown
  readonly parent_a_slug: unknown
  readonly parent_b_slug: unknown
}
interface EggLinkRow {
  readonly egg_id: unknown
  readonly owner_trainer_slug: unknown
  readonly status: unknown
  readonly child_sheet_slug: unknown
}
interface OriginLinkRow {
  readonly origin_id: unknown
  readonly egg_id: unknown
  readonly child_sheet_slug: unknown
}
interface TransferConsentLinkRow {
  readonly consent_id: unknown
  readonly egg_id: unknown
  readonly role: unknown
  readonly counterpart_consent_id: unknown
}
interface SourceSettlementLinkRow {
  readonly operation_id: unknown
  readonly trainer_sheet_slug: unknown
  readonly species_id: unknown
}
interface GmOverrideLinkRow {
  readonly override_id: unknown
  readonly operation_id: unknown
}
const rowText = (value: unknown): string => typeof value === 'string' ? value : String(value)

export const createBreedingArchiveManager = (
  dependencies: BreedingArchiveManagerDependencies,
): BreedingArchiveManager => {
  const database = dependencies.database ?? getRotomDatabase()
  const archiveRepository = createSqliteBreedingArchiveRepository(database)
  const stateRepository = createSqliteBreedingArchiveStateRepository(database)
  const clockRepository = createSqliteCampaignClockRepository(database)

  const exportAuthorityArchive = (
    input: CreateCampaignBackupInput | CreateGmAuditInput,
    purpose: 'campaign-backup' | 'gm-audit',
  ): BreedingArchiveV1 => withImmediateTransaction(database, () => {
    const clock = clockRepository.get()
    authorizeCurrentGm({
      actorAuthority: input.actorAuthority,
      minute: clock.campaignMinute,
      authorizeGm: dependencies.authorizeGm,
    })
    const records = stateRepository.readRecords({ purpose })
    const archive = createArchive({ ...input, purpose, minute: clock.campaignMinute, records })
    if (purpose === 'campaign-backup') validateBreedingCampaignBackupIntegrityV1(archive)
    runSynchronousHook(input.beforePersist)
    return archiveRepository.insertArchive(archive).value
  })

  const createCampaignBackup = (input: CreateCampaignBackupInput): BreedingArchiveV1 => (
    exportAuthorityArchive(input, 'campaign-backup')
  )
  const createGmAudit = (input: CreateGmAuditInput): BreedingArchiveV1 => (
    exportAuthorityArchive(input, 'gm-audit')
  )
  const createOwnerPortableArchive = (
    input: CreateOwnerPortableArchiveInput,
  ): BreedingArchiveV1 => withImmediateTransaction(database, () => {
    const clock = clockRepository.get()
    const actor = parseAuthoritativeBreedingActorAuthorityV1(input.actorAuthority)
    if (actor.evaluatedAtCampaignMinute !== clock.campaignMinute) {
      throw new BreedingArchiveManagerError(
        'breeding.archive-manager.stale-authority',
        'Owner export authority must be evaluated at the exact current campaign minute.',
      )
    }
    const archive = createBreedingArchiveV1({
      archiveId: input.archiveId,
      purpose: 'owner-portable',
      campaignIdentitySha256: strictHash(input.campaignIdentitySha256, 'campaignIdentitySha256'),
      createdAtCampaignMinute: clock.campaignMinute,
      rulesetId: input.rulesetId,
      rulesetDefinitionSha256: input.rulesetDefinitionSha256,
      referenceVersions: parseAuthoritativeBreedingReferenceVersionSnapshotV1(input.referenceVersions),
      records: input.records,
    })
    const canonicalRecordLists: Partial<Record<BreedingArchiveRecordKind, unknown[]>> = {}
    for (const chunk of archive.chunks) {
      const values = canonicalRecordLists[chunk.recordKind] ?? []
      values.push(...chunk.records)
      canonicalRecordLists[chunk.recordKind] = values
    }
    const canonicalRecords = Object.freeze(Object.fromEntries(Object.entries(canonicalRecordLists)
      .map(([kind, values]) => [kind, Object.freeze(values)]))) as Readonly<Partial<
        Record<BreedingArchiveRecordKind, readonly unknown[]>
      >>
    const authorized = dependencies.authorizeOwnerExport(actor, canonicalRecords)
    if (isPromiseLike(authorized)) {
      throw new BreedingArchiveManagerError(
        'breeding.archive-manager.async-hook',
        'Owner export authorization must be synchronous.',
      )
    }
    if (authorized !== true) {
      throw new BreedingArchiveManagerError(
        'breeding.archive-manager.unauthorized',
        'Owner-portable archive requires current server-projected owner authority.',
      )
    }
    runSynchronousHook(input.beforePersist)
    return archiveRepository.insertArchive(archive).value
  })

  const verifyCurrentCheckpoint = (input: {
    readonly archiveId: BreedingArchiveId | string
    readonly campaignIdentitySha256: string
    readonly references: BreedingReferenceVersionSnapshotV1
  }): BreedingArchiveV1 => {
    const checkpoint = archiveRepository.getArchive(input.archiveId)
    if (!checkpoint || checkpoint.purpose !== 'campaign-backup'
      || checkpoint.campaignIdentitySha256 !== input.campaignIdentitySha256) {
      throw new BreedingArchiveManagerError(
        'breeding.archive-manager.stale-checkpoint',
        'Replacement requires the exact current campaign-backup checkpoint.',
      )
    }
    const clock = clockRepository.get()
    if (clock.campaignMinute !== checkpoint.createdAtCampaignMinute) {
      throw new BreedingArchiveManagerError(
        'breeding.archive-manager.stale-checkpoint',
        'Campaign time advanced after the replacement checkpoint.',
      )
    }
    const records = stateRepository.readRecords({ purpose: 'campaign-backup' })
    const observed = createBreedingArchiveV1({
      archiveId: checkpoint.archiveId,
      purpose: checkpoint.purpose,
      campaignIdentitySha256: checkpoint.campaignIdentitySha256,
      createdAtCampaignMinute: clock.campaignMinute,
      rulesetId: checkpoint.rulesetId,
      rulesetDefinitionSha256: checkpoint.rulesetDefinitionSha256,
      referenceVersions: input.references,
      records,
    })
    validateBreedingCampaignBackupIntegrityV1(observed)
    if (observed.archiveDefinitionSha256 !== checkpoint.archiveDefinitionSha256) {
      throw new BreedingArchiveManagerError(
        'breeding.archive-manager.stale-checkpoint',
        'Campaign authority changed after the replacement checkpoint.',
      )
    }
    return checkpoint
  }

  const restoreCampaign = (input: RestoreBreedingCampaignInput): RestoreBreedingCampaignResult => {
    const archive = parseEnvelope(input.envelope)
    const request = parseAuthoritativeBreedingArchiveImportRequestV1(input.request)
    const actor = parseAuthoritativeBreedingActorAuthorityV1(input.actorAuthority)
    const references = parseAuthoritativeBreedingReferenceVersionSnapshotV1(input.currentReferenceVersions)
    return withImmediateTransaction(database, () => {
      const existingReceipt = archiveRepository.getRestoreReceipt(request.requestId)
      if (existingReceipt) {
        authorizeCurrentGm({
          actorAuthority: actor,
          minute: clockRepository.get().campaignMinute,
          authorizeGm: dependencies.authorizeGm,
        })
        const existingRequest = archiveRepository.getImportRequest(request.requestId)
        const existingArchive = archiveRepository.getArchive(archive.archiveId)
        if (stableJsonStringify(existingRequest) !== stableJsonStringify(request)
          || stableJsonStringify(existingArchive) !== stableJsonStringify(archive)) {
          // Preserve the strict repository collision while rolling back every attempted write.
          archiveRepository.insertArchive(archive)
          archiveRepository.insertImportRequest(request)
          throw new BreedingArchiveManagerError(
            'breeding.archive-manager.stale-checkpoint',
            'Restore replay identities are already bound to different facts.',
          )
        }
        return freeze({ kind: 'exact-replay', archive: existingArchive!, receipt: existingReceipt })
      }

      const requestActor = authorizeCurrentGm({
        actorAuthority: actor,
        minute: request.requestedAtCampaignMinute,
        authorizeGm: dependencies.authorizeGm,
      })
      if (request.actorAuthorityDefinitionSha256 !== requestActor.definitionSha256) {
        throw new BreedingArchiveManagerError(
          'breeding.archive-manager.unauthorized',
          'Restore request must bind the exact authenticated GM authority at creation.',
        )
      }

      const clock = clockRepository.get()
      strictHash(request.targetCampaignIdentitySha256, 'targetCampaignIdentitySha256')

      let currentArchiveDefinitionSha256: string | null = null
      if (request.mode === 'replace-campaign') {
        if (request.requestedAtCampaignMinute !== clock.campaignMinute) {
          throw new BreedingArchiveManagerError(
            'breeding.archive-manager.stale-authority',
            'Replacement authority must be evaluated at the target campaign checkpoint minute.',
          )
        }
        if (input.currentCheckpointArchiveId === null) {
          throw new BreedingArchiveManagerError(
            'breeding.archive-manager.stale-checkpoint',
            'Replacement requires a current checkpoint archive identity.',
          )
        }
        currentArchiveDefinitionSha256 = verifyCurrentCheckpoint({
          archiveId: input.currentCheckpointArchiveId,
          campaignIdentitySha256: request.targetCampaignIdentitySha256,
          references,
        }).archiveDefinitionSha256
      }
      else if (request.mode === 'restore-new-campaign' && stateRepository.hasCampaignAuthority()) {
        throw new BreedingArchiveManagerError(
          'breeding.archive-manager.nonempty-target',
          'New-campaign restore requires an empty authoritative Breeding target.',
        )
      }

      const validated = validateBreedingArchiveImportV1({
        archive,
        request,
        actorAuthority: actor,
        currentReferenceVersions: references,
        currentArchiveDefinitionSha256,
        validateRecordDependencies: (kind, record) => {
          const valid = dependencies.validateRecordDependencies(kind, record)
          if (isPromiseLike(valid)) {
            throw new BreedingArchiveManagerError(
              'breeding.archive-manager.async-hook',
              'Archive dependency validation must be synchronous.',
            )
          }
          return valid === true
        },
      })
      archiveRepository.insertArchive(validated.archive)
      archiveRepository.insertImportRequest(validated.request)
      runSynchronousHook(input.beforeReplace)
      if (request.mode !== 'validate-only') stateRepository.replaceWithCampaignBackup(validated.archive)
      runSynchronousHook(input.afterReplaceBeforeReceipt)
      const receipt = createBreedingArchiveRestoreReceiptV1({
        requestId: request.requestId,
        archiveId: archive.archiveId,
        archiveDefinitionSha256: archive.archiveDefinitionSha256,
        accepted: true,
        reasonId: 'breeding.archive.accepted',
        recordCounts: validated.recordCounts,
        committedAtCampaignMinute: request.requestedAtCampaignMinute,
        resultingArchiveDefinitionSha256: archive.archiveDefinitionSha256,
      })
      const storedReceipt = archiveRepository.insertRestoreReceipt(receipt).value
      return freeze({
        kind: request.mode === 'validate-only' ? 'validated' : 'restored',
        archive: validated.archive,
        receipt: storedReceipt,
      })
    })
  }

  const runIntegrityDiagnostics = (
    input: RunBreedingIntegrityDiagnosticsInput,
  ): BreedingIntegrityReportV1 => withImmediateTransaction(database, () => {
    const campaignIdentitySha256 = strictHash(input.campaignIdentitySha256, 'campaignIdentitySha256')
    const clock = clockRepository.get()
    authorizeCurrentGm({
      actorAuthority: input.actorAuthority,
      minute: clock.campaignMinute,
      authorizeGm: dependencies.authorizeGm,
    })
    const values: BreedingIntegrityDiagnosticV1[] = []
    const add = (
      code: BreedingIntegrityDiagnosticCode,
      severity: BreedingIntegrityDiagnosticSeverity,
      resourceKind: string,
      resourceId: string,
      relatedResourceId: string | null = null,
    ): void => {
      if (values.length >= BREEDING_INTEGRITY_DIAGNOSTIC_MAXIMUM) return
      values.push(freeze({ code, severity, resourceKind, resourceId, relatedResourceId }))
    }

    const integrityRows = database.connection.prepare('PRAGMA integrity_check').all() as unknown as IntegrityCheckRow[]
    for (const row of integrityRows) if (row.integrity_check !== 'ok') {
      add('breeding.integrity.sqlite', 'error', 'sqlite', rowText(row.integrity_check))
    }
    const foreignKeys = database.connection.prepare('PRAGMA foreign_key_check').all() as unknown as ForeignKeyCheckRow[]
    for (const row of foreignKeys) add(
      'breeding.integrity.foreign-key',
      'error',
      rowText(row.table),
      rowText(row.rowid),
      `${rowText(row.parent)}/${rowText(row.fkid)}`,
    )

    try { stateRepository.readRecords({ purpose: 'gm-audit' }) }
    catch (error) {
      if (error instanceof BreedingRepositoryCorruptionError) add(
        'breeding.integrity.corrupt-authority-row',
        'error', error.table, error.identity, error.field,
      )
      else throw error
    }

    const hasSheet = (kind: 'trainer' | 'pokemon', slug: string): boolean => Boolean(database.connection.prepare(`
      SELECT 1 FROM sheets WHERE kind = ? AND slug = ?
    `).get(kind, slug))
    const projectRows = database.connection.prepare(`
      SELECT project_id, owner_trainer_slug, breeder_trainer_slug, parent_a_slug, parent_b_slug
      FROM breeding_projects ORDER BY project_id
    `).all() as unknown as ProjectLinkRow[]
    for (const row of projectRows) {
      const id = rowText(row.project_id)
      const owner = rowText(row.owner_trainer_slug)
      const breeder = rowText(row.breeder_trainer_slug)
      if (!hasSheet('trainer', owner)) add('breeding.integrity.missing-owner-trainer', 'error', 'breeding-project', id, owner)
      if (!hasSheet('trainer', breeder)) add('breeding.integrity.missing-breeder-trainer', 'error', 'breeding-project', id, breeder)
      for (const parent of [rowText(row.parent_a_slug), rowText(row.parent_b_slug)]) {
        if (!hasSheet('pokemon', parent)) add('breeding.integrity.missing-parent-pokemon', 'error', 'breeding-project', id, parent)
      }
    }

    const eggRows = database.connection.prepare(`
      SELECT egg_id, owner_trainer_slug, status, child_sheet_slug
      FROM pokemon_eggs ORDER BY egg_id
    `).all() as unknown as EggLinkRow[]
    for (const row of eggRows) {
      const id = rowText(row.egg_id)
      const owner = rowText(row.owner_trainer_slug)
      if (!hasSheet('trainer', owner)) add('breeding.integrity.missing-owner-trainer', 'error', 'pokemon-egg', id, owner)
      if (row.status === 'hatched') {
        const child = rowText(row.child_sheet_slug)
        if (!hasSheet('pokemon', child)) add('breeding.integrity.missing-child-pokemon', 'error', 'pokemon-egg', id, child)
        if (!database.connection.prepare('SELECT 1 FROM pokemon_breeding_origins WHERE egg_id = ?').get(id)) {
          add('breeding.integrity.missing-origin', 'error', 'pokemon-egg', id, child)
        }
      }
    }

    const originRows = database.connection.prepare(`
      SELECT origin_id, egg_id, child_sheet_slug
      FROM pokemon_breeding_origins ORDER BY origin_id
    `).all() as unknown as OriginLinkRow[]
    for (const row of originRows) {
      const id = rowText(row.origin_id)
      const egg = rowText(row.egg_id)
      const child = rowText(row.child_sheet_slug)
      const linked = database.connection.prepare(`
        SELECT 1 FROM pokemon_eggs
        WHERE egg_id = ? AND status = 'hatched' AND child_sheet_slug = ?
      `).get(egg, child)
      if (!linked) add('breeding.integrity.orphan-origin', 'error', 'pokemon-breeding-origin', id, egg)
      if (!hasSheet('pokemon', child)) add('breeding.integrity.missing-child-pokemon', 'error', 'pokemon-breeding-origin', id, child)
    }

    const transferConsentRows = database.connection.prepare(`
      SELECT consent_id, egg_id, role,
             json_extract(document_json, '$.counterpartConsentId') AS counterpart_consent_id
      FROM pokemon_egg_transfer_consents
      ORDER BY consent_id
    `).all() as unknown as TransferConsentLinkRow[]
    for (const row of transferConsentRows) {
      const id = rowText(row.consent_id)
      const egg = rowText(row.egg_id)
      const eggExists = database.connection.prepare('SELECT 1 FROM pokemon_eggs WHERE egg_id = ?').get(egg)
      if (!eggExists) add('breeding.integrity.orphan-transfer-consent', 'error', 'egg-transfer-consent', id, egg)
      if (row.role === 'recipient-acceptance') {
        const counterpart = rowText(row.counterpart_consent_id)
        const sourceExists = database.connection.prepare(`
          SELECT 1 FROM pokemon_egg_transfer_consents
          WHERE consent_id = ? AND role = 'source-gift' AND egg_id = ?
        `).get(counterpart, egg)
        if (!sourceExists) add('breeding.integrity.orphan-transfer-consent', 'error', 'egg-transfer-consent', id, counterpart)
      }
    }

    const sourceSettlementRows = database.connection.prepare(`
      SELECT operation_id, trainer_sheet_slug, species_id
      FROM trainer_species_acquisition_source_operations
      ORDER BY operation_id
    `).all() as unknown as SourceSettlementLinkRow[]
    for (const row of sourceSettlementRows) {
      const id = rowText(row.operation_id)
      const trainer = rowText(row.trainer_sheet_slug)
      const species = rowText(row.species_id)
      const acquisitionExists = database.connection.prepare(`
        SELECT 1 FROM trainer_species_acquisitions
        WHERE trainer_sheet_slug = ? AND species_id = ?
      `).get(trainer, species)
      if (!acquisitionExists) add(
        'breeding.integrity.orphan-source-settlement',
        'error', 'species-acquisition-source-settlement', id, `${trainer}/${species}`,
      )
    }

    const overrideRows = database.connection.prepare(`
      SELECT override_id, operation_id FROM breeding_gm_overrides ORDER BY override_id
    `).all() as unknown as GmOverrideLinkRow[]
    for (const row of overrideRows) {
      const id = rowText(row.override_id)
      const operation = rowText(row.operation_id)
      if (!database.connection.prepare('SELECT 1 FROM breeding_operations WHERE operation_id = ?').get(operation)) {
        add('breeding.integrity.orphan-gm-override', 'error', 'breeding-gm-override', id, operation)
      }
    }

    const acquisitions = database.connection.prepare(`
      SELECT trainer_sheet_slug, species_id
      FROM trainer_species_acquisitions
      ORDER BY trainer_sheet_slug, species_id
    `).all() as unknown as Array<{ trainer_sheet_slug: unknown, species_id: unknown }>
    for (const row of acquisitions) {
      const trainer = rowText(row.trainer_sheet_slug)
      if (!hasSheet('trainer', trainer)) add(
        'breeding.integrity.missing-acquisition-trainer',
        'error', 'trainer-species-acquisition', `${trainer}/${rowText(row.species_id)}`, trainer,
      )
    }

    const pending = database.connection.prepare(`
      SELECT operation_id FROM breeding_operations
      WHERE status = 'pending' ORDER BY operation_id
    `).all() as unknown as Array<{ operation_id: unknown }>
    for (const row of pending) add(
      'breeding.integrity.pending-operation',
      'warning', 'breeding-operation', rowText(row.operation_id), null,
    )

    const maps = database.connection.prepare(`
      SELECT slug FROM maps
      WHERE json_type(document_json, '$.metadata.capabilityEggs') IS NOT NULL
         OR json_type(document_json, '$.metadata.hatchHours') IS NOT NULL
      ORDER BY slug
    `).all() as unknown as Array<{ slug: unknown }>
    for (const row of maps) add(
      'breeding.integrity.legacy-map-egg-metadata',
      'warning', 'legacy-map-quarantine', rowText(row.slug), null,
    )

    const diagnostics = Object.freeze(values.sort((left, right) => {
      const leftKey = `${left.code}\u0000${left.resourceKind}\u0000${left.resourceId}\u0000${left.relatedResourceId ?? ''}`
      const rightKey = `${right.code}\u0000${right.resourceKind}\u0000${right.resourceId}\u0000${right.relatedResourceId ?? ''}`
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0
    }))
    const definition = {
      schemaVersion: 1 as const,
      campaignIdentitySha256,
      checkedAtCampaignMinute: clock.campaignMinute,
      healthy: diagnostics.every(value => value.severity !== 'error'),
      backupReady: diagnostics.every(value => value.severity !== 'error'
        && value.code !== 'breeding.integrity.pending-operation'),
      diagnostics,
      tableCounts: stateRepository.tableCounts(),
    }
    return freeze({ ...definition, definitionSha256: hash(definition) })
  })

  return Object.freeze({
    database,
    archiveRepository,
    stateRepository,
    parseEnvelope,
    createCampaignBackup,
    createGmAudit,
    createOwnerPortableArchive,
    restoreCampaign,
    runIntegrityDiagnostics,
  })
}
