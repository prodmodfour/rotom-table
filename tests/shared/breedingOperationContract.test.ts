import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  BREEDING_OPERATION_COMMAND_KINDS,
  BreedingOperationContractValidationError,
  breedingConflictScopeKey,
  breedingScopesConflict,
  parseBreedingOperationCommandV1,
  parseBreedingOperationResultV1,
  type BreedingConflictScopeV1,
  type BreedingOperationCommandKind,
} from '../../shared/breeding/operations'
import {
  BreedingOperationIdCollisionError,
  BreedingOperationResultConflictError,
  areBreedingOperationCommandsSemanticallyEqual,
  assertBreedingOperationResultMatchesCommand,
  assertBreedingOperationTerminalResultsCompatible,
  breedingOperationReceiptDefinitionSha256,
  createBreedingOperationAcceptedV1,
  createBreedingOperationCommandHash,
  createBreedingOperationRejectedV1,
  decideBreedingOperationReplay,
  findBreedingScopeConflicts,
  parseAuthoritativeBreedingOperationResultV1,
} from '../../server/domain/breeding/operations'

const ROOT = resolve(import.meta.dirname, '../..')
const readJson = <T>(path: string): T => JSON.parse(readFileSync(resolve(ROOT, path), 'utf8')) as T
const sha256 = (value: Buffer | string): string => createHash('sha256').update(value).digest('hex')
const policy = readJson<Record<string, any>>('data/breeding-automation/operation-contract.json')
const ruleset = readJson<Record<string, any>>('data/breeding-automation/ruleset.json')
const op = (value: number): string => `breeding-operation:v1:${value.toString(16).padStart(32, '0')}`
const project = 'breeding-project:v1:11111111111111111111111111111111'
const egg = 'pokemon-egg:v1:22222222222222222222222222222222'
const consent = 'breeding-consent:v1:33333333333333333333333333333333'
const transferConsent = (value: number): string => `egg-transfer-consent:v1:${value.toString(16).padStart(32, '0')}`
const origin = 'pokemon-breeding-origin:v1:44444444444444444444444444444444'
const check = 'breeding-check:v1:55555555555555555555555555555555'
const option = (value: number): string => `option:v1:${value.toString(16).padStart(32, '0')}`
const actor = { profileId: 'profile-owner', selectedTrainerSlug: 'trainer-owner' }
const rulesetRef = { rulesetId: ruleset.rulesetId, definitionSha256: ruleset.definitionSha256 }
const projectScope = (revision: number | null = 0) => ({ kind: 'breeding-project', projectId: project, expectedRevision: revision })
const eggScope = (revision: number | null = 0) => ({ kind: 'pokemon-egg', eggId: egg, expectedRevision: revision })
const resolutions = { selectedOptionIds: [option(1)], requestedRollKinds: ['offspring-family', 'nature', 'ability', 'gender', 'hatch-duration', 'provider'] }
const destination = { kind: 'box', trainerSheetSlug: 'trainer-owner' }
const cases: Record<BreedingOperationCommandKind, { readonly payload: Record<string, unknown>, readonly scopes: readonly Record<string, unknown>[] }> = {
  'preview-breeding': {
    payload: { ownerTrainerSlug: 'trainer-owner', breederTrainerSlug: 'trainer-breeder', parentRefs: [{ pokemonSheetSlug: 'pokemon-parent-a', expectedSheetRevision: 2 }, { pokemonSheetSlug: 'pokemon-parent-b', expectedSheetRevision: 3 }], optionSnapshotDefinitionSha256: '1'.repeat(64) },
    scopes: [],
  },
  'create-breeding-project': {
    payload: { projectId: project, ownerTrainerSlug: 'trainer-owner', breederTrainerSlug: 'trainer-breeder', parentRefs: [{ pokemonSheetSlug: 'pokemon-parent-a', expectedSheetRevision: 2 }, { pokemonSheetSlug: 'pokemon-parent-b', expectedSheetRevision: 3 }], optionSnapshotDefinitionSha256: '1'.repeat(64), consentPolicy: 'same-owner-control' },
    scopes: [projectScope(null)],
  },
  'grant-breeding-consent': {
    payload: { projectId: project, consentId: consent, parentSheetSlug: 'pokemon-parent-a', parentSheetRevision: 2, consentScopes: ['own-parent-contribution-attribution', 'own-parent-safe-summary', 'project-participation'].sort(), expiresAtCampaignMinute: null },
    scopes: [projectScope(), { kind: 'parent-consent', consentId: consent, expectedRevision: null }],
  },
  'revoke-breeding-consent': { payload: { projectId: project, consentId: consent, reasonId: 'breeding.consent.revoked' }, scopes: [projectScope(), { kind: 'parent-consent', consentId: consent, expectedRevision: 0 }] },
  'advance-breeding-project-time': { payload: { projectId: project, throughClockRevision: 4, throughCampaignMinute: 200 }, scopes: [projectScope()] },
  'resolve-breeding-check': { payload: { projectId: project, checkRecordId: check }, scopes: [projectScope()] },
  'produce-egg': { payload: { projectId: project, eggId: egg, resolutions }, scopes: [projectScope(), eggScope(null)] },
  'cancel-breeding-project': { payload: { projectId: project, reasonId: 'breeding.project.cancelled' }, scopes: [projectScope()] },
  'create-source-egg': { payload: { eggId: egg, ownerTrainerSlug: 'trainer-owner', source: { kind: 'fossil', sourceId: 'fossil:helix', evidenceDefinitionSha256: '2'.repeat(64) }, speciesOptionId: option(2), resolutions }, scopes: [eggScope(null), { kind: 'trainer-sheet', sheetSlug: 'trainer-owner', expectedRevision: 8, fields: ['inventory'] }] },
  'transfer-egg': {
    payload: { eggId: egg, destinationTrainerSlug: 'trainer-recipient', consentEvidenceIds: [transferConsent(1), transferConsent(2)] },
    scopes: [
      eggScope(),
      { kind: 'egg-transfer-consent', consentId: transferConsent(1), expectedRevision: 0 },
      { kind: 'egg-transfer-consent', consentId: transferConsent(2), expectedRevision: 0 },
    ],
  },
  'advance-egg-incubation': { payload: { eggId: egg, throughClockRevision: 5, throughCampaignMinute: 300 }, scopes: [eggScope()] },
  'set-egg-incubation-pause': { payload: { eggId: egg, paused: true, reasonId: 'breeding.egg.paused' }, scopes: [eggScope()] },
  'apply-egg-warmer-capability': { payload: { eggId: egg, sourcePokemonSheetSlug: 'pokemon-fire', expectedSourcePokemonSheetRevision: 4, requestReductionRoll: true }, scopes: [eggScope()] },
  'mark-egg-ready': { payload: { eggId: egg, reasonId: 'breeding.egg.gm-ready' }, scopes: [eggScope()] },
  'begin-hatch': { payload: { eggId: egg, destination, requestSpecialRoll: true }, scopes: [eggScope()] },
  'resolve-hatch-special': { payload: { eggId: egg, adjudicationOptionId: option(3) }, scopes: [eggScope()] },
  'complete-hatch': {
    payload: { eggId: egg, originId: origin, destination },
    scopes: [
      eggScope(),
      { kind: 'trainer-sheet', sheetSlug: 'trainer-owner', expectedRevision: 8, fields: ['experience', 'roster'] },
      { kind: 'pokemon-sheet-allocation', namespace: 'pokemon' },
      { kind: 'species-acquisition', trainerSheetSlug: 'trainer-owner', speciesId: 'bulbasaur' },
    ],
  },
  'cancel-egg': { payload: { eggId: egg, reasonId: 'breeding.egg.cancelled' }, scopes: [eggScope()] },
  'advance-campaign-clock': { payload: { targetCampaignMinute: 500 }, scopes: [{ kind: 'campaign-clock', expectedRevision: 4 }, projectScope(), eggScope()] },
  'record-inheritance-learning': { payload: { originId: origin, eggId: egg, childSheetSlug: 'pokemon-child', checkpointLevels: [20, 30], selectedOptionIds: [option(4)] }, scopes: [{ kind: 'pokemon-sheet', sheetSlug: 'pokemon-child', expectedRevision: 9, fields: ['lineage', 'moves'] }] },
  'recover-breeding-operation': { payload: { targetOperationId: op(99), action: 'resume', reasonId: 'breeding.operation.resume' }, scopes: [{ kind: 'breeding-operation', targetOperationId: op(99) }] },
}
const command = (kind: BreedingOperationCommandKind, value = 1): Record<string, unknown> => ({ schemaVersion: 1, operationId: op(value), commandKind: kind, actor, ruleset: rulesetRef, scopes: cases[kind].scopes, payload: cases[kind].payload })
const accepted = (kind: BreedingOperationCommandKind, value = 1) => {
  const parsed = parseBreedingOperationCommandV1(command(kind, value))
  const commandHash = createBreedingOperationCommandHash(parsed)
  const outcomeKind = policy.definition.result.outcomeKinds[BREEDING_OPERATION_COMMAND_KINDS.indexOf(kind)]
  const changedScopes = kind === 'preview-breeding' ? [] : parsed.scopes
  const committedAtCampaignMinute = kind === 'preview-breeding' ? null : 600
  return createBreedingOperationAcceptedV1({ operationId: parsed.operationId, commandHash, commandKind: kind, outcomeKind, aggregateRefs: [], changedScopes, committedAtCampaignMinute })
}

describe('Breeding operation contract', () => {
  it('binds the complete command, scope, hash, conflict, and terminal-result policy', () => {
    expect(policy).toMatchObject({
      schemaVersion: 1,
      contractId: 'ptu-1.05-breeding-operation-contract-v1',
      rulesetId: ruleset.rulesetId,
      rulesetDefinitionSha256: ruleset.definitionSha256,
      sourceManifestSha256: sha256(readFileSync(resolve(ROOT, 'data/breeding-automation/source-manifest.json'))),
    })
    expect(policy.definitionSha256).toBe(sha256(stableJsonStringify(policy.definition)))
    expect(policy.definition.command.commandKinds).toEqual(BREEDING_OPERATION_COMMAND_KINDS)
    expect(policy.definition.authority).toMatchObject({ hashing: 'server-only', mapExecutorDependency: 'none' })
    expect(policy.definition.hash.material).toBe('entire-strictly-parsed-command-envelope')
  })

  it('strictly parses and freezes all 21 command kinds with canonical scopes', () => {
    for (const [index, kind] of BREEDING_OPERATION_COMMAND_KINDS.entries()) {
      const parsed = parseBreedingOperationCommandV1(command(kind, index + 1))
      expect(parsed.commandKind).toBe(kind)
      expect(parsed.operationId).toBe(op(index + 1))
      expect(Object.isFrozen(parsed)).toBe(true)
      expect(Object.isFrozen(parsed.scopes)).toBe(true)
      expect(parsed.scopes.map(breedingConflictScopeKey)).toEqual([...parsed.scopes.map(breedingConflictScopeKey)].sort())
    }
  })

  it('hashes the complete parsed semantic command and rejects operation-ID intent drift', () => {
    const original = command('produce-egg', 30)
    const reordered = { payload: structuredClone(original.payload), scopes: structuredClone(original.scopes), ruleset: structuredClone(original.ruleset), actor: structuredClone(original.actor), commandKind: original.commandKind, operationId: original.operationId, schemaVersion: original.schemaVersion }
    expect(areBreedingOperationCommandsSemanticallyEqual(original, reordered)).toBe(true)
    expect(createBreedingOperationCommandHash(original)).toMatch(/^[0-9a-f]{64}$/)
    expect(createBreedingOperationCommandHash(original)).toBe(createBreedingOperationCommandHash(reordered))
    const changed = structuredClone(original)
    ;(changed.payload as any).resolutions.selectedOptionIds = [option(9)]
    expect(createBreedingOperationCommandHash(changed)).not.toBe(createBreedingOperationCommandHash(original))
    const stored = accepted('produce-egg', 30)
    expect(decideBreedingOperationReplay({ command: original, existing: { operationId: stored.operationId, commandHash: stored.commandHash as any, result: stored } }).kind).toBe('exact-retry')
    expect(() => decideBreedingOperationReplay({ command: changed, existing: { operationId: stored.operationId, commandHash: stored.commandHash as any, result: stored } })).toThrow(BreedingOperationIdCollisionError)
  })

  it('rejects unknown fields, roll values, underdeclared or noncanonical scopes, and self-recovery', () => {
    const unknown = { ...command('create-breeding-project'), clientLegal: true }
    expect(() => parseBreedingOperationCommandV1(unknown)).toThrowError(expect.objectContaining({ code: 'breeding.operation.unknown-field' }))
    const rollValue = structuredClone(command('produce-egg'))
    ;(rollValue.payload as any).resolutions.rollTotal = 17
    expect(() => parseBreedingOperationCommandV1(rollValue)).toThrow(BreedingOperationContractValidationError)
    const underdeclared = { ...command('complete-hatch'), scopes: [eggScope()] }
    expect(() => parseBreedingOperationCommandV1(underdeclared)).toThrowError(expect.objectContaining({ code: 'breeding.operation.invalid-scope' }))
    const unsorted = { ...command('produce-egg'), scopes: [eggScope(null), projectScope()] }
    expect(() => parseBreedingOperationCommandV1(unsorted)).toThrowError(expect.objectContaining({ code: 'breeding.operation.invalid-invariant' }))
    const duplicated = { ...command('transfer-egg'), scopes: [eggScope(), eggScope()] }
    expect(() => parseBreedingOperationCommandV1(duplicated)).toThrow(BreedingOperationContractValidationError)
    const self = structuredClone(command('recover-breeding-operation', 42))
    ;(self.payload as any).targetOperationId = op(42)
    ;(self.scopes as any[])[0].targetOperationId = op(42)
    expect(() => parseBreedingOperationCommandV1(self)).toThrow(BreedingOperationContractValidationError)
    const mapScoped = structuredClone(command('transfer-egg'))
    ;(mapScoped.scopes as any[]).push({ kind: 'map', mapSlug: 'arena' })
    expect(() => parseBreedingOperationCommandV1(mapScoped)).toThrow(BreedingOperationContractValidationError)
  })

  it('creates self-hashed accepted and rejected terminal results bound to commands', () => {
    const result = accepted('complete-hatch', 50)
    expect(result).toMatchObject({ ok: true, commandKind: 'complete-hatch', outcomeKind: 'hatched', committedAtCampaignMinute: 600 })
    expect(result.receiptDefinitionSha256).toBe(breedingOperationReceiptDefinitionSha256({
      operationId: result.operationId,
      commandHash: result.commandHash as any,
      commandKind: result.commandKind,
      outcomeKind: result.outcomeKind,
      aggregateRefs: result.aggregateRefs,
      changedScopes: result.changedScopes,
      committedAtCampaignMinute: result.committedAtCampaignMinute,
    }))
    expect(parseAuthoritativeBreedingOperationResultV1(result)).toEqual(result)
    expect(assertBreedingOperationResultMatchesCommand(command('complete-hatch', 50), result)).toEqual(result)
    const parsedWire = parseBreedingOperationResultV1(structuredClone(result))
    expect(parsedWire.resultDefinitionSha256).toBe(result.resultDefinitionSha256)

    const parsedCommand = parseBreedingOperationCommandV1(command('transfer-egg', 51))
    const rejected = createBreedingOperationRejectedV1({
      operationId: parsedCommand.operationId,
      commandHash: createBreedingOperationCommandHash(parsedCommand),
      commandKind: parsedCommand.commandKind,
      reasonId: 'breeding.operation.stale-revision',
      currentAggregateRefs: [{ kind: 'pokemon-egg', id: egg, revision: 4 }],
      conflictingScopes: parsedCommand.scopes,
    })
    expect(rejected).toMatchObject({ ok: false, retryable: true, reasonId: 'breeding.operation.stale-revision' })
    expect(assertBreedingOperationResultMatchesCommand(parsedCommand, rejected)).toEqual(rejected)
  })

  it('rejects result tampering, mismatched scope claims, and divergent terminal writes', () => {
    const result = accepted('transfer-egg', 60)
    expect(() => parseAuthoritativeBreedingOperationResultV1({ ...result, resultDefinitionSha256: '0'.repeat(64) })).toThrow(BreedingOperationResultConflictError)
    const wrongOutcome = { ...result, outcomeKind: 'hatched' }
    expect(() => parseBreedingOperationResultV1(wrongOutcome)).toThrow(BreedingOperationContractValidationError)
    const foreignScope: BreedingConflictScopeV1 = { kind: 'pokemon-egg', eggId: 'pokemon-egg:v1:99999999999999999999999999999999' as any, expectedRevision: 0 }
    const foreignResult = createBreedingOperationAcceptedV1({
      operationId: result.operationId,
      commandHash: result.commandHash,
      commandKind: result.commandKind,
      outcomeKind: result.outcomeKind,
      aggregateRefs: [],
      changedScopes: [foreignScope],
      committedAtCampaignMinute: 600,
    })
    expect(() => assertBreedingOperationResultMatchesCommand(command('transfer-egg', 60), foreignResult)).toThrow(BreedingOperationResultConflictError)
    const changedTerminal = createBreedingOperationAcceptedV1({
      operationId: result.operationId,
      commandHash: result.commandHash,
      commandKind: result.commandKind,
      outcomeKind: result.outcomeKind,
      aggregateRefs: result.aggregateRefs,
      changedScopes: result.changedScopes,
      committedAtCampaignMinute: 601,
    })
    expect(() => assertBreedingOperationTerminalResultsCompatible(result, changedTerminal)).toThrow(BreedingOperationResultConflictError)
  })

  it('detects deterministic campaign-scope overlap without map or field-label inference', () => {
    const attempted = parseBreedingOperationCommandV1(command('complete-hatch', 70)).scopes
    const prior = accepted('transfer-egg', 71)
    const conflicts = findBreedingScopeConflicts({ attemptedScopes: attempted, recentAcceptedOperations: [{ operationId: prior.operationId, commandHash: prior.commandHash as any, commandKind: prior.commandKind, changedScopes: prior.changedScopes, result: prior }] })
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toMatchObject({ attemptedScope: { kind: 'pokemon-egg', eggId: egg }, conflictingScope: { kind: 'pokemon-egg', eggId: egg }, conflictingOperationId: op(71) })
    expect(breedingScopesConflict(
      { kind: 'trainer-sheet', sheetSlug: 'trainer-owner', expectedRevision: 1, fields: ['roster'] },
      { kind: 'trainer-sheet', sheetSlug: 'trainer-owner', expectedRevision: 9, fields: ['experience'] },
    )).toBe(true)
    expect(breedingScopesConflict(eggScope() as any, { kind: 'pokemon-egg', eggId: 'pokemon-egg:v1:99999999999999999999999999999999' as any, expectedRevision: 0 })).toBe(false)
  })

  it('rejects accessors, unsafe identities, malformed versions, and enriched arrays', () => {
    const accessor = command('transfer-egg')
    Object.defineProperty(accessor, 'actor', { enumerable: true, get: () => actor })
    expect(() => parseBreedingOperationCommandV1(accessor)).toThrow(BreedingOperationContractValidationError)
    expect(() => parseBreedingOperationCommandV1({ ...command('transfer-egg'), schemaVersion: 2 })).toThrow(BreedingOperationContractValidationError)
    const unsafe = structuredClone(command('transfer-egg'))
    ;(unsafe.actor as any).profileId = 'profile\nleak'
    expect(() => parseBreedingOperationCommandV1(unsafe)).toThrow(BreedingOperationContractValidationError)
    const enriched = structuredClone(command('transfer-egg'))
    ;(enriched.scopes as any).clientHint = true
    expect(() => parseBreedingOperationCommandV1(enriched)).toThrow(BreedingOperationContractValidationError)
  })
})
