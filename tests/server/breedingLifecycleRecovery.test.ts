import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import authorityJson from '../fixtures/breeding/egg-production-cross-owner-authority-v1.json'
import { stableJsonStringify } from '#shared/automation/stableJson'
import type { PlayerProfile } from '#shared/playerProfiles'
import { BREEDING_CONSENT_SCOPES, parseBreedingOperationCommandV1 } from '../../shared/breeding/operations'
import { parseBreedingReadResourceV1 } from '../../shared/breeding/readSets'
import {
  authorizeBreedingLifecycleControlV1,
  createBreedingActorAuthorityV1,
  createBreedingGmOverrideEvidenceV1,
  createBreedingTrainerControlEvidenceV1,
} from '../../server/domain/breeding/authorization'
import { breedingOperationRecoveryResourceDefinitionSha256 } from '../../server/domain/breeding/lifecycleRecovery'
import { createBreedingConsentRecordV1, isBreedingConsentCurrentlyUsable } from '../../server/domain/breeding/ledgers'
import { createBreedingOperationAcceptedV1, createBreedingOperationCommandHash, createBreedingOperationRejectedV1 } from '../../server/domain/breeding/operations'
import { createBreedingOperationReadSetV1 } from '../../server/domain/breeding/readSets'
import { createSqliteBreedingConsentRepository } from '../../server/storage/breedingConsentRepository'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteBreedingOperationRepository, type BreedingOperationLedgerRecord } from '../../server/storage/breedingOperationRepository'
import { createSqliteBreedingProjectRepository } from '../../server/storage/breedingProjectRepository'
import { manageBreedingLifecycle } from '../../server/useCases/manageBreedingLifecycleRecovery'
import { loadBreedingRecoveryReconnectSnapshot, recoverBreedingOperation } from '../../server/useCases/recoverBreedingOperation'

const authority = authorityJson as any
const PROJECT_ID = authority.project.projectId as string
const CONSENT_ID = authority.consentEvidence[0].consentId as string
const security = (await import('../../data/breeding-automation/security-policy.json')).default as any
const op = (value: number): string => `breeding-operation:v1:${value.toString(16).padStart(32, '0')}`
const readSetId = (value: number): string => `breeding-read-set:v1:${value.toString(16).padStart(32, '0')}`
const overrideId = (value: number): string => `breeding-override:v1:${value.toString(16).padStart(32, '0')}`
const sha = (value: unknown): string => createHash('sha256').update(typeof value === 'string' ? value : stableJsonStringify(value)).digest('hex')
const OWNER_DOCUMENT = { slug: 'trainer-owner', folder: '' }
const OTHER_DOCUMENT = { slug: 'trainer-other', folder: '' }
const OWNER_AUTH_DOCUMENT = { ...OWNER_DOCUMENT, revision: 5, updatedAt: 600 }
const OTHER_AUTH_DOCUMENT = { ...OTHER_DOCUMENT, revision: 7, updatedAt: 600 }
const ownerProfile: PlayerProfile = { schemaVersion: 1, id: 'profile_owner_0001' as any, displayName: 'Owner' as any, linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: 'trainer-owner' }] }
const otherProfile: PlayerProfile = { schemaVersion: 1, id: 'profile_other_0001' as any, displayName: 'Other' as any, linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: 'trainer-other' }] }
const resource = (resourceKind: string, resourceId: string, revision: number | null, definitionSha256: string | null, purposes: readonly string[], observedCampaignMinute: number | null = null) => parseBreedingReadResourceV1({ resourceKind, resourceId, existence: definitionSha256 === null ? 'absent' : 'present', revision, definitionSha256, observedCampaignMinute, purposes: [...purposes].sort() })
const dependencies = () => [{ providerKind: 'system' as const, providerId: 'breeding-effective-dependency-set-v1', subjectKind: 'campaign' as const, subjectId: 'campaign', subjectRevision: null, checkpoint: 'authorization' as const, providerDefinitionSha256: security.definitionSha256 as string, effectiveEvidenceSha256: sha([]) }]
const clockHash = (revision: number, campaignMinute: number, lastOperationId: string | null = op(8)) => sha({ schemaVersion: 1, revision, campaignMinute, lastOperationId })
const baseCommand = (operationId: string, kind: 'cancel-breeding-project' | 'revoke-breeding-consent', reasonId: string, actor: { profileId: string, selectedTrainerSlug: string | null }, revision = 2) => parseBreedingOperationCommandV1({
  schemaVersion: 1, operationId, commandKind: kind, actor, ruleset: authority.project.ruleset,
  scopes: kind === 'cancel-breeding-project'
    ? [{ kind: 'breeding-project', projectId: PROJECT_ID, expectedRevision: revision }]
    : [{ kind: 'breeding-project', projectId: PROJECT_ID, expectedRevision: revision }, { kind: 'parent-consent', consentId: CONSENT_ID, expectedRevision: 0 }],
  payload: kind === 'cancel-breeding-project' ? { projectId: PROJECT_ID, reasonId } : { projectId: PROJECT_ID, consentId: CONSENT_ID, reasonId },
})
const previewTargetCommand = () => parseBreedingOperationCommandV1({
  schemaVersion: 1, operationId: op(50), commandKind: 'preview-breeding', actor: { profileId: 'profile_owner_0001', selectedTrainerSlug: 'trainer-owner' }, ruleset: authority.project.ruleset, scopes: [],
  payload: { ownerTrainerSlug: 'trainer-owner', breederTrainerSlug: 'trainer-breeder', parentRefs: [{ pokemonSheetSlug: 'pokemon-parent-a', expectedSheetRevision: 2 }, { pokemonSheetSlug: 'pokemon-parent-b', expectedSheetRevision: 3 }], optionSnapshotDefinitionSha256: authority.project.projectCreationOptionSnapshotSha256 },
})
const seedOperation = (database: RotomDatabase, command: ReturnType<typeof parseBreedingOperationCommandV1>, minute: number, accepted = false): BreedingOperationLedgerRecord => database.withTransaction(() => {
  const repository = createSqliteBreedingOperationRepository(database); repository.reserve(command, minute); const hash = createBreedingOperationCommandHash(command)
  const result = accepted ? createBreedingOperationAcceptedV1({ operationId: command.operationId, commandHash: hash, commandKind: command.commandKind, outcomeKind: command.commandKind === 'preview-breeding' ? 'previewed' : 'project-cancelled', aggregateRefs: [], changedScopes: [], committedAtCampaignMinute: command.commandKind === 'preview-breeding' ? null : minute }) : createBreedingOperationRejectedV1({ operationId: command.operationId, commandHash: hash, commandKind: command.commandKind, reasonId: 'breeding.operation.invalid', currentAggregateRefs: [], conflictingScopes: [] })
  return repository.settle(command, result, minute).record
})
const seedConsent = (database: RotomDatabase, expiresAt = 700) => {
  const command = parseBreedingOperationCommandV1({ schemaVersion: 1, operationId: op(21), commandKind: 'grant-breeding-consent', actor: { profileId: 'profile_other_0001', selectedTrainerSlug: 'trainer-other' }, ruleset: authority.project.ruleset, scopes: [{ kind: 'breeding-project', projectId: PROJECT_ID, expectedRevision: 2 }, { kind: 'parent-consent', consentId: CONSENT_ID, expectedRevision: null }], payload: { projectId: PROJECT_ID, consentId: CONSENT_ID, parentSheetSlug: 'pokemon-parent-b', parentSheetRevision: 3, consentScopes: [...BREEDING_CONSENT_SCOPES].sort(), expiresAtCampaignMinute: expiresAt } })
  const record = createBreedingConsentRecordV1({ schemaVersion: 1, consentId: CONSENT_ID as any, projectId: PROJECT_ID as any, parentSheetSlug: 'pokemon-parent-b', parentSheetRevision: 3, ownerTrainerSlug: 'trainer-other', consentingProfileId: 'profile_other_0001', scopes: [...BREEDING_CONSENT_SCOPES].sort() as any, grantedAtCampaignMinute: 500, expiresAtCampaignMinute: expiresAt, grantOperationId: command.operationId, grantCommandSha256: createBreedingOperationCommandHash(command) })
  database.withTransaction(() => {
    const operations = createSqliteBreedingOperationRepository(database); operations.reserve(command, 500)
    operations.settle(command, createBreedingOperationAcceptedV1({ operationId: command.operationId, commandHash: createBreedingOperationCommandHash(command), commandKind: command.commandKind, outcomeKind: 'consent-granted', aggregateRefs: [{ kind: 'breeding-project', id: PROJECT_ID, revision: 2 }, { kind: 'parent-consent', id: CONSENT_ID, revision: 0 }], changedScopes: command.scopes, committedAtCampaignMinute: 500 }), 500)
    createSqliteBreedingConsentRepository(database).insert(record)
  })
  return record
}
const seed = (path = ':memory:', minute = 600): { database: RotomDatabase, consent: ReturnType<typeof seedConsent> } => {
  const database = openRotomDatabase({ path, enableWal: path !== ':memory:' })
  const seedCommand = baseCommand(op(8), 'cancel-breeding-project', 'breeding.project-terminal.cancelled', { profileId: 'profile_owner_0001', selectedTrainerSlug: 'trainer-owner' }, 1)
  seedOperation(database, seedCommand, 500)
  database.withTransaction(() => {
    database.connection.prepare(`INSERT INTO breeding_projects (project_id,document_json,revision,status,owner_trainer_slug,breeder_trainer_slug,parent_a_slug,parent_b_slug,produced_egg_id,last_operation_id,created_at_campaign_minute,updated_at_campaign_minute) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(PROJECT_ID, stableJsonStringify(authority.project), authority.project.revision, authority.project.status, authority.project.ownerTrainerSlug, authority.project.breederTrainerSlug, authority.project.parentRefs[0].pokemonSheetSlug, authority.project.parentRefs[1].pokemonSheetSlug, null, authority.project.lastOperationId, authority.project.createdAtCampaignMinute, authority.project.updatedAtCampaignMinute)
    database.connection.prepare('UPDATE campaign_clock SET revision=?, campaign_minute=?, last_operation_id=? WHERE singleton=1').run(minute === 600 ? 3 : 4, minute, op(8))
    database.connection.prepare('INSERT INTO sheets (kind,slug,document_json,revision,updated_at) VALUES (?, ?, ?, ?, ?)').run('trainer', 'trainer-owner', stableJsonStringify(OWNER_DOCUMENT), 5, minute)
    database.connection.prepare('INSERT INTO sheets (kind,slug,document_json,revision,updated_at) VALUES (?, ?, ?, ?, ?)').run('trainer', 'trainer-other', stableJsonStringify(OTHER_DOCUMENT), 7, minute)
  })
  return { database, consent: seedConsent(database) }
}
const lifecycleReadSet = (command: ReturnType<typeof baseCommand>, project: any, minute: number, consent: any | null, trainer: 'owner' | 'other' | null, includeExpiredConsent = false) => createBreedingOperationReadSetV1({
  readSetId: readSetId(Number.parseInt(command.operationId.slice(-4), 16) || 1) as any, operationId: command.operationId, commandSha256: createBreedingOperationCommandHash(command), commandKind: command.commandKind, capturedAtCampaignMinute: minute,
  resources: [
    resource('campaign-clock', 'campaign-clock', minute === 600 ? 3 : 4, clockHash(minute === 600 ? 3 : 4, minute), ['campaign-time'], minute),
    resource('breeding-project', PROJECT_ID, project.revision, sha(project), ['conflict', 'mechanics']),
    ...(consent && (command.commandKind === 'revoke-breeding-consent' || includeExpiredConsent) ? [resource('parent-consent', CONSENT_ID, consent.revision, consent.definitionSha256, command.commandKind === 'revoke-breeding-consent' ? ['conflict', 'consent'] : ['consent'])] : []),
    ...(trainer === 'owner' ? [resource('trainer-sheet', 'trainer-owner', 5, sha(OWNER_AUTH_DOCUMENT), ['authorization'])] : trainer === 'other' ? [resource('trainer-sheet', 'trainer-other', 7, sha(OTHER_AUTH_DOCUMENT), ['authorization'])] : []),
  ], referenceVersions: authority.readSet.referenceVersions, dependencyEvidence: dependencies(), writeExpectations: command.scopes,
})
const playerAuthority = (command: ReturnType<typeof baseCommand>, readSet: ReturnType<typeof lifecycleReadSet>, project: any, consent: any | null, owner: 'owner' | 'other') => {
  const profile = owner === 'owner' ? ownerProfile : otherProfile; const slug = owner === 'owner' ? 'trainer-owner' : 'trainer-other'; const revision = owner === 'owner' ? 5 : 7; const document = owner === 'owner' ? OWNER_AUTH_DOCUMENT : OTHER_AUTH_DOCUMENT
  const actor = createBreedingActorAuthorityV1({ role: 'player', command, authenticatedPrincipalSha256: 'a'.repeat(64), authenticationPolicyDefinitionSha256: 'b'.repeat(64), profile, evaluatedAtCampaignMinute: readSet.capturedAtCampaignMinute })
  const control = createBreedingTrainerControlEvidenceV1({ profile, trainerSheetSlug: slug, trainerSheetRevision: revision, trainerSheetDefinitionSha256: sha(document), evaluatedAtCampaignMinute: readSet.capturedAtCampaignMinute })
  const receipt = authorizeBreedingLifecycleControlV1({ command, readSet, actorAuthority: actor, trainerControl: control, project, consent, gmOverrides: [], securityPolicyDefinitionSha256: security.definitionSha256 })
  return { actor, control, receipt, overrides: [] }
}
const gmAuthority = (command: ReturnType<typeof parseBreedingOperationCommandV1>, readSet: any, project: any | null, targetOperationId = command.operationId) => {
  const actor = createBreedingActorAuthorityV1({ role: 'gm', command, authenticatedPrincipalSha256: 'c'.repeat(64), authenticationPolicyDefinitionSha256: 'b'.repeat(64), profile: null, evaluatedAtCampaignMinute: readSet.capturedAtCampaignMinute })
  const override = createBreedingGmOverrideEvidenceV1({ overrideId: overrideId(Number.parseInt(command.operationId.slice(-4), 16) || 1) as any, command, actorAuthority: actor, overrideKind: command.commandKind === 'cancel-breeding-project' && command.payload.reasonId === 'breeding.project-terminal.cancelled' ? 'owner-control' : 'operation-recovery', target: command.commandKind === 'cancel-breeding-project' && command.payload.reasonId === 'breeding.project-terminal.cancelled' ? { kind: 'trainer-sheet', trainerSheetSlug: project.ownerTrainerSlug } : { kind: 'breeding-operation', operationId: targetOperationId }, reasonId: 'breeding.override.operation-recovery', createdAtCampaignMinute: readSet.capturedAtCampaignMinute, securityPolicyDefinitionSha256: security.definitionSha256 })
  const receipt = authorizeBreedingLifecycleControlV1({ command, readSet, actorAuthority: actor, trainerControl: null, project, consent: null, gmOverrides: [override], securityPolicyDefinitionSha256: security.definitionSha256 })
  return { actor, control: null, receipt, overrides: [override] }
}
const lifecycleRequest = (command: any, readSet: any, auth: any, audience: 'gm' | 'owner' | 'participating-owner') => ({ command, readSet, authorizationReceipt: auth.receipt, actorAuthority: auth.actor, trainerControl: auth.control, gmOverrides: auth.overrides, audience })
const lifecycleOptions = (database: RotomDatabase, extra: Record<string, unknown> = {}) => ({ database, campaignProjectionKey: 'campaign-secret-key-with-at-least-32-bytes', realtimeTimestamp: 1_700_000_000_000, ...extra })
const pendingPreview = (database: RotomDatabase) => {
  const command = previewTargetCommand(); database.withTransaction(() => createSqliteBreedingOperationRepository(database).reserve(command, 600)); return command
}
const recoveryAuthority = (database: RotomDatabase, target: ReturnType<typeof previewTargetCommand>, action: 'inspect' | 'resume' | 'abandon' | 'retry-publication', operation = 60) => {
  const targetRecord = createSqliteBreedingOperationRepository(database).get(target.operationId)!
  const command = parseBreedingOperationCommandV1({ schemaVersion: 1, operationId: op(operation), commandKind: 'recover-breeding-operation', actor: { profileId: 'gm-principal', selectedTrainerSlug: null }, ruleset: authority.project.ruleset, scopes: [{ kind: 'breeding-operation', targetOperationId: target.operationId }], payload: { targetOperationId: target.operationId, action, reasonId: 'breeding.recovery.operator-request' } })
  const readSet = createBreedingOperationReadSetV1({ readSetId: readSetId(operation) as any, operationId: command.operationId, commandSha256: createBreedingOperationCommandHash(command), commandKind: command.commandKind, capturedAtCampaignMinute: 600, resources: [resource('campaign-clock', 'campaign-clock', 3, clockHash(3, 600), ['campaign-time'], 600), resource('breeding-operation', target.operationId, null, breedingOperationRecoveryResourceDefinitionSha256(targetRecord), ['conflict', 'idempotency'])], referenceVersions: authority.readSet.referenceVersions, dependencyEvidence: dependencies(), writeExpectations: command.scopes })
  const auth = gmAuthority(command, readSet, null, target.operationId)
  return { command, readSet, auth, request: { command, readSet, authorizationReceipt: auth.receipt, actorAuthority: auth.actor, gmOverrides: auth.overrides } }
}

const settlePreview = (database: RotomDatabase, target: BreedingOperationLedgerRecord): void => database.withTransaction(() => {
  createSqliteBreedingOperationRepository(database).settle(target.command, createBreedingOperationAcceptedV1({ operationId: target.operationId, commandHash: target.commandHash, commandKind: 'preview-breeding', outcomeKind: 'previewed', aggregateRefs: [], changedScopes: [], committedAtCampaignMinute: null }), 600)
})

describe('Breeding cancellation, consent expiry/revocation, reconnect, and recovery', () => {
  it('cancels an active Project atomically, publishes bounded refreshes, and exact-retries without another revision or event', () => {
    const { database, consent } = seed(); const project = createSqliteBreedingProjectRepository(database).get(PROJECT_ID)!
    const command = baseCommand(op(30), 'cancel-breeding-project', 'breeding.project-terminal.cancelled', { profileId: 'profile_owner_0001', selectedTrainerSlug: 'trainer-owner' })
    const readSet = lifecycleReadSet(command, project, 600, null, 'owner'); const auth = playerAuthority(command, readSet, project, null, 'owner')
    expect(auth.receipt).toMatchObject({ authorized: true })
    const first = manageBreedingLifecycle(lifecycleRequest(command, readSet, auth, 'owner'), lifecycleOptions(database))
    expect(first.execution.record.result).toMatchObject({ ok: true, outcomeKind: 'project-cancelled' }); expect(first.project).toMatchObject({ revision: 3, status: 'cancelled', terminal: { reasonId: 'breeding.project-terminal.cancelled', atCampaignMinute: 600, operationId: command.operationId } })
    expect(first.execution.committedRealtimeEvents).toHaveLength(5); expect(JSON.stringify(first.projection)).not.toMatch(/pokemon-parent|trainer-other|profile_|definition|sha256|roll|species|nature/iu)
    const retry = manageBreedingLifecycle(lifecycleRequest(command, readSet, auth, 'owner'), lifecycleOptions(database))
    expect(retry.execution.kind).toBe('exact-retry'); expect(retry.project?.revision).toBe(3); expect(retry.execution.committedRealtimeEvents).toEqual([]); expect(retry.projection).toEqual(first.projection)

    const revoke = baseCommand(op(36), 'revoke-breeding-consent', 'breeding.consent.revoked', { profileId: 'profile_other_0001', selectedTrainerSlug: 'trainer-other' }, 3)
    const revokeReadSet = lifecycleReadSet(revoke, first.project, 600, consent, 'other'); const revokeAuth = playerAuthority(revoke, revokeReadSet, first.project, consent, 'other')
    const postSettlement = manageBreedingLifecycle(lifecycleRequest(revoke, revokeReadSet, revokeAuth, 'participating-owner'), lifecycleOptions(database))
    expect(postSettlement.project).toMatchObject({ revision: 3, status: 'cancelled' }); expect(postSettlement.consent?.status).toBe('revoked'); expect(postSettlement.execution.committedRealtimeEvents).toEqual([])
  })

  it('revokes positive cross-owner consent and checkpoints the active Project in one rollback-safe transaction', () => {
    const { database, consent } = seed(); const project = createSqliteBreedingProjectRepository(database).get(PROJECT_ID)!
    const command = baseCommand(op(31), 'revoke-breeding-consent', 'breeding.consent.revoked', { profileId: 'profile_other_0001', selectedTrainerSlug: 'trainer-other' })
    const readSet = lifecycleReadSet(command, project, 600, consent, 'other'); const auth = playerAuthority(command, readSet, project, consent, 'other')
    expect(() => manageBreedingLifecycle(lifecycleRequest(command, readSet, auth, 'participating-owner'), lifecycleOptions(database, { beforeSettle: () => { throw new Error('rollback') } }))).toThrow('rollback')
    expect(createSqliteBreedingConsentRepository(database).get(CONSENT_ID)?.status).toBe('active'); expect(createSqliteBreedingProjectRepository(database).get(PROJECT_ID)?.revision).toBe(2); expect((database.connection.prepare('SELECT COUNT(*) AS count FROM realtime_events').get() as any).count).toBe(0)
    const recovered = manageBreedingLifecycle(lifecycleRequest(command, readSet, auth, 'participating-owner'), lifecycleOptions(database, { resumePending: true }))
    expect(recovered.execution.record.result).toMatchObject({ ok: true, outcomeKind: 'consent-revoked' }); expect(recovered.consent).toMatchObject({ revision: 1, status: 'revoked', settlementOperationId: command.operationId }); expect(recovered.project).toMatchObject({ revision: 3, status: 'ready-to-produce' }); expect(recovered.execution.committedRealtimeEvents).toHaveLength(5)
    expect(isBreedingConsentCurrentlyUsable(recovered.consent, { projectId: PROJECT_ID, parentSheetSlug: 'pokemon-parent-b', parentSheetRevision: 3, ownerTrainerSlug: 'trainer-other', consentingProfileId: 'profile_other_0001', atCampaignMinute: 600 })).toBe(false)
  })

  it('expires a Project exactly at consent equality and supports audited GM abandonment without treating override as consent', () => {
    const expired = seed(':memory:', 700); const project = createSqliteBreedingProjectRepository(expired.database).get(PROJECT_ID)!
    const command = baseCommand(op(32), 'cancel-breeding-project', 'breeding.project-terminal.consent-expired', { profileId: 'gm-principal', selectedTrainerSlug: null })
    const readSet = lifecycleReadSet(command, project, 700, expired.consent, null, true); const auth = gmAuthority(command, readSet, project)
    const result = manageBreedingLifecycle(lifecycleRequest(command, readSet, auth, 'gm'), lifecycleOptions(expired.database))
    expect(result.project).toMatchObject({ revision: 3, status: 'expired', terminal: { reasonId: 'breeding.project-terminal.consent-expired' } }); expect(createSqliteBreedingConsentRepository(expired.database).get(CONSENT_ID)?.status).toBe('active')
    expect(isBreedingConsentCurrentlyUsable(expired.consent, { projectId: PROJECT_ID, parentSheetSlug: 'pokemon-parent-b', parentSheetRevision: 3, ownerTrainerSlug: 'trainer-other', consentingProfileId: 'profile_other_0001', atCampaignMinute: 700 })).toBe(false)

    const abandoned = seed(); const abandonedProject = createSqliteBreedingProjectRepository(abandoned.database).get(PROJECT_ID)!
    const abandon = baseCommand(op(33), 'cancel-breeding-project', 'breeding.project-terminal.abandoned', { profileId: 'gm-principal', selectedTrainerSlug: null })
    const abandonReadSet = lifecycleReadSet(abandon, abandonedProject, 600, null, null); const abandonAuth = gmAuthority(abandon, abandonReadSet, abandonedProject)
    expect(manageBreedingLifecycle(lifecycleRequest(abandon, abandonReadSet, abandonAuth, 'gm'), lifecycleOptions(abandoned.database)).project?.status).toBe('abandoned')
  })

  it('fails closed on unauthorized lifecycle reasons, stale clocks, enriched authority, and accessor-backed requests before mutation', () => {
    const { database, consent } = seed(); const project = createSqliteBreedingProjectRepository(database).get(PROJECT_ID)!
    const unauthorized = baseCommand(op(34), 'cancel-breeding-project', 'breeding.project-terminal.abandoned', { profileId: 'profile_owner_0001', selectedTrainerSlug: 'trainer-owner' })
    const readSet = lifecycleReadSet(unauthorized, project, 600, null, 'owner'); const auth = playerAuthority(unauthorized, readSet, project, null, 'owner')
    expect(auth.receipt.authorized).toBe(false); expect(() => manageBreedingLifecycle(lifecycleRequest(unauthorized, readSet, auth, 'owner'), lifecycleOptions(database))).toThrowError(expect.objectContaining({ code: 'breeding.lifecycle-recovery.invalid-authority' }))
    const revoke = baseCommand(op(35), 'revoke-breeding-consent', 'breeding.consent.revoked', { profileId: 'profile_other_0001', selectedTrainerSlug: 'trainer-other' }); const revokeReadSet = lifecycleReadSet(revoke, project, 600, consent, 'other'); const revokeAuth = playerAuthority(revoke, revokeReadSet, project, consent, 'other')
    database.connection.prepare('UPDATE campaign_clock SET revision=4,campaign_minute=601 WHERE singleton=1').run()
    expect(manageBreedingLifecycle(lifecycleRequest(revoke, revokeReadSet, revokeAuth, 'participating-owner'), lifecycleOptions(database)).execution.record.result).toMatchObject({ ok: false, reasonId: 'breeding.operation.stale-revision' }); expect(createSqliteBreedingConsentRepository(database).get(CONSENT_ID)?.status).toBe('active')
    const enriched = { ...lifecycleRequest(revoke, revokeReadSet, revokeAuth, 'participating-owner'), mapId: 'forbidden' }; expect(() => manageBreedingLifecycle(enriched as any, lifecycleOptions(database))).toThrow()
    const accessor = { ...lifecycleRequest(revoke, revokeReadSet, revokeAuth, 'participating-owner') } as any; Object.defineProperty(accessor, 'command', { enumerable: true, get: () => revoke }); expect(() => manageBreedingLifecycle(accessor, lifecycleOptions(database))).toThrow()
  })

  it('inspects and abandons pending operations without exposing command payloads or deleting phase-one audit state', () => {
    const inspected = seed(); const target = pendingPreview(inspected.database); const inspect = recoveryAuthority(inspected.database, target, 'inspect', 60)
    const inspectedResult = recoverBreedingOperation(inspect.request, { database: inspected.database })
    expect(inspectedResult.execution.record.result).toMatchObject({ ok: true, outcomeKind: 'operation-recovered' }); expect(createSqliteBreedingOperationRepository(inspected.database).get(target.operationId)?.status).toBe('pending'); expect(JSON.stringify(inspectedResult.projection)).not.toMatch(/payload|commandHash|readSet|receipt|scope/iu)

    const abandoned = seed(); const abandonedTarget = pendingPreview(abandoned.database); const abandon = recoveryAuthority(abandoned.database, abandonedTarget, 'abandon', 61)
    const result = recoverBreedingOperation(abandon.request, { database: abandoned.database })
    expect(result.projection).toMatchObject({ executionStatus: 'accepted', disposition: 'abandoned', targetTerminal: true }); expect(createSqliteBreedingOperationRepository(abandoned.database).get(abandonedTarget.operationId)?.result).toMatchObject({ ok: false, reasonId: 'breeding.operation.abandoned' })
  })

  it('resumes through the exact target dispatcher and converges after a crash between target settlement and recovery audit', () => {
    const normal = seed(); const target = pendingPreview(normal.database); const resume = recoveryAuthority(normal.database, target, 'resume', 62); const dispatcher = vi.fn((record: BreedingOperationLedgerRecord) => settlePreview(normal.database, record))
    const result = recoverBreedingOperation(resume.request, { database: normal.database, resumeTarget: dispatcher })
    expect(dispatcher).toHaveBeenCalledOnce(); expect(result.projection).toMatchObject({ disposition: 'resumed', targetTerminal: true }); expect(createSqliteBreedingOperationRepository(normal.database).get(target.operationId)?.status).toBe('accepted')

    const crashed = seed(); const crashedTarget = pendingPreview(crashed.database); const crashedResume = recoveryAuthority(crashed.database, crashedTarget, 'resume', 63)
    expect(() => recoverBreedingOperation(crashedResume.request, { database: crashed.database, resumeTarget: record => { settlePreview(crashed.database, record); throw new Error('crash-after-target') } })).toThrow('crash-after-target')
    expect(createSqliteBreedingOperationRepository(crashed.database).get(crashedResume.command.operationId)?.status).toBe('pending'); expect(createSqliteBreedingOperationRepository(crashed.database).get(crashedTarget.operationId)?.status).toBe('accepted')
    const recovered = recoverBreedingOperation(crashedResume.request, { database: crashed.database, resumePending: true, resumeTarget: vi.fn() })
    expect(recovered.projection).toMatchObject({ executionStatus: 'accepted', disposition: 'resumed' })
  })

  it('retries publication only from a terminal durable target and audits callback failure through explicit pending recovery', () => {
    const { database } = seed(); const target = previewTargetCommand(); seedOperation(database, target, 600, true)
    const retry = recoveryAuthority(database, target, 'retry-publication', 65); const publisher = vi.fn()
    const result = recoverBreedingOperation(retry.request, { database, retryPublication: publisher })
    expect(publisher).toHaveBeenCalledOnce(); expect(publisher.mock.calls[0]![0]).toMatchObject({ operationId: target.operationId, status: 'accepted' }); expect(result.projection).toMatchObject({ disposition: 'publication-retry-requested', targetTerminal: true })

    const failedTarget = parseBreedingOperationCommandV1({ ...previewTargetCommand(), operationId: op(52) }); seedOperation(database, failedTarget, 600, true)
    const failedRetry = recoveryAuthority(database, failedTarget, 'retry-publication', 66)
    expect(() => recoverBreedingOperation(failedRetry.request, { database, retryPublication: () => { throw new Error('publisher-offline') } })).toThrow('publisher-offline')
    expect(createSqliteBreedingOperationRepository(database).get(failedRetry.command.operationId)?.status).toBe('pending')
    const recovered = recoverBreedingOperation(failedRetry.request, { database, resumePending: true, retryPublication: vi.fn() })
    expect(recovered.projection.disposition).toBe('publication-retry-requested')
  })

  it('loads a bounded GM-only reconnect snapshot and preserves pending recovery facts across restart', () => {
    const directory = mkdtempSync(join(tmpdir(), 'breeding-recovery-')); const path = join(directory, 'campaign.sqlite')
    try {
      const first = seed(path); const target = pendingPreview(first.database); const recovery = recoveryAuthority(first.database, target, 'resume', 64)
      const pending = recoverBreedingOperation(recovery.request, { database: first.database, resumeTarget: vi.fn() })
      expect(pending.execution.record.status).toBe('rejected')
      const anotherTarget = parseBreedingOperationCommandV1({ ...previewTargetCommand(), operationId: op(51) }); first.database.withTransaction(() => createSqliteBreedingOperationRepository(first.database).reserve(anotherTarget, 600))
      first.database.close()
      const reopened = openRotomDatabase({ path, enableWal: true })
      const snapshot = loadBreedingRecoveryReconnectSnapshot(recovery.auth.actor, { database: reopened, validateCurrentGmAuthority: actor => actor.role === 'gm' })
      expect(snapshot.pendingOperations.some(value => value.operationId === target.operationId)).toBe(true); expect(snapshot.pendingOperations.some(value => value.operationId === anotherTarget.operationId)).toBe(true); expect(snapshot.pendingOperations.every(value => value.persistedRollCount <= 32)).toBe(true)
      expect(() => loadBreedingRecoveryReconnectSnapshot(createBreedingActorAuthorityV1({ role: 'player', command: baseCommand(op(70), 'cancel-breeding-project', 'breeding.project-terminal.cancelled', { profileId: 'profile_owner_0001', selectedTrainerSlug: 'trainer-owner' }), authenticatedPrincipalSha256: 'a'.repeat(64), authenticationPolicyDefinitionSha256: 'b'.repeat(64), profile: ownerProfile, evaluatedAtCampaignMinute: 600 }), { database: reopened, validateCurrentGmAuthority: () => true })).toThrowError(expect.objectContaining({ code: 'breeding.lifecycle-recovery.invalid-authority' }))
      reopened.close()
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })
})
