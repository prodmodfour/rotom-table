import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  BREEDING_REFERENCE_SOURCE_IDS,
  BreedingReadSetValidationError,
  parseBreedingOperationReadSetV1,
  parseBreedingReadResourceV1,
  parseBreedingReferenceVersionSnapshotV1,
  type BreedingDependencyEvidenceV1,
  type BreedingReadPurpose,
  type BreedingReadResourceKind,
  type BreedingReadResourceV1,
} from '../../shared/breeding/readSets'
import { parseBreedingOperationCommandV1 } from '../../shared/breeding/operations'
import {
  BreedingReadSetAuthorityError,
  assertBreedingOperationReadSetExactReplay,
  breedingOperationReadSetDefinitionSha256,
  createBreedingOperationReadSetV1,
  createBreedingReferenceVersionSnapshotV1,
  parseAuthoritativeBreedingOperationReadSetV1,
  parseAuthoritativeBreedingReferenceVersionSnapshotV1,
  validateBreedingOperationReadSetCompleteness,
  validateBreedingOperationReadSetFreshness,
} from '../../server/domain/breeding/readSets'
import { createBreedingOperationCommandHash } from '../../server/domain/breeding/operations'

const ROOT = resolve(import.meta.dirname, '../..')
const readJson = <T>(path: string): T => JSON.parse(readFileSync(resolve(ROOT, path), 'utf8')) as T
const sha256 = (value: Buffer | string): string => createHash('sha256').update(value).digest('hex')
const policy = readJson<Record<string, any>>('data/breeding-automation/read-set-contract.json')
const ruleset = readJson<Record<string, any>>('data/breeding-automation/ruleset.json')
const op = (value: number): string => `breeding-operation:v1:${value.toString(16).padStart(32, '0')}`
const readSetId = (value: number): string => `breeding-read-set:v1:${value.toString(16).padStart(32, '0')}`
const projectId = 'breeding-project:v1:11111111111111111111111111111111'
const optionSnapshotHash = '1'.repeat(64)
const sourcePaths: Readonly<Record<string, string>> = {
  abilities: 'data/reference/abilities.json',
  capabilities: 'data/reference/capabilities.json',
  conditions: 'data/reference/conditions.json',
  edges: 'data/reference/edges.json',
  features: 'data/reference/features.json',
  items: 'data/reference/items.json',
  maneuvers: 'data/reference/maneuvers.json',
  moves: 'data/reference/moves.json',
  'poke-edges': 'data/reference/poke-edges.json',
  pokedex: 'data/reference/pokedex.json',
  'pokemon-experience-chart': 'data/reference/pokemonExperienceChart.json',
  rules: 'data/reference/rules.json',
  'stat-rankings': 'data/reference/stat-rankings.json',
}
const artifact = (name: string) => readJson<Record<string, any>>(`data/breeding-automation/${name}.json`)
const referenceVersions = () => createBreedingReferenceVersionSnapshotV1({
  schemaVersion: 1,
  rulesetId: ruleset.rulesetId,
  rulesetDefinitionSha256: ruleset.definitionSha256,
  sourceManifestSha256: sha256(readFileSync(resolve(ROOT, 'data/breeding-automation/source-manifest.json'))),
  semanticRegistryDefinitionSha256: artifact('semantic-registry').definitionSha256,
  compiledRegistryDefinitionSha256: artifact('compiled-registry').definitionSha256,
  canonicalIdsDefinitionSha256: artifact('canonical-ids').definitionSha256,
  campaignOptionSnapshotDefinitionSha256: optionSnapshotHash,
  referenceSources: BREEDING_REFERENCE_SOURCE_IDS.map(sourceId => ({ sourceId, contentSha256: sha256(readFileSync(resolve(ROOT, sourcePaths[sourceId]!))) })),
  contractDefinitionHashes: [
    ['breeding-authorization-contract', 'authorization-contract'],
    ['breeding-ledger-contract', 'ledger-contract'],
    ['breeding-lineage-contract', 'lineage-contract'],
    ['breeding-operation-contract', 'operation-contract'],
    ['breeding-project-contract', 'project-contract'],
    ['breeding-read-set-contract', 'read-set-contract'],
    ['breeding-security-policy', 'security-policy'],
    ['pokemon-egg-contract', 'egg-contract'],
  ].map(([contractId, file]) => ({ contractId: contractId!, definitionSha256: artifact(file!).definitionSha256 })),
})
const resource = (resourceKind: BreedingReadResourceKind, resourceId: string, input: {
  readonly existence?: 'present' | 'absent'
  readonly revision?: number | null
  readonly observedCampaignMinute?: number | null
  readonly purposes: readonly BreedingReadPurpose[]
}): BreedingReadResourceV1 => {
  const existence = input.existence ?? 'present'
  return parseBreedingReadResourceV1({
    resourceKind,
    resourceId,
    existence,
    revision: existence === 'absent' ? null : (input.revision ?? null),
    definitionSha256: existence === 'absent' ? null : sha256(`${resourceKind}:${resourceId}:${input.revision ?? 'immutable'}`),
    observedCampaignMinute: resourceKind === 'campaign-clock' && existence === 'present' ? (input.observedCampaignMinute ?? 100) : null,
    purposes: [...input.purposes].sort(),
  })
}
const providerEvidence = (effectiveHash = '4'.repeat(64)): BreedingDependencyEvidenceV1 => ({
  providerKind: 'edge',
  providerId: 'breeder',
  subjectKind: 'trainer-sheet',
  subjectId: 'trainer-breeder',
  subjectRevision: 6,
  checkpoint: 'project-preview',
  providerDefinitionSha256: '2'.repeat(64),
  effectiveEvidenceSha256: effectiveHash,
})
const dependencyEvidence = (provider = providerEvidence()): readonly BreedingDependencyEvidenceV1[] => {
  const resolved = [provider]
  return [
    {
      providerKind: 'system',
      providerId: 'breeding-effective-dependency-set-v1',
      subjectKind: 'campaign',
      subjectId: 'campaign',
      subjectRevision: null,
      checkpoint: 'authorization',
      providerDefinitionSha256: policy.definitionSha256,
      effectiveEvidenceSha256: sha256(stableJsonStringify(resolved)),
    },
    ...resolved,
  ]
}
const previewCommand = (value = 1) => parseBreedingOperationCommandV1({
  schemaVersion: 1,
  operationId: op(value),
  commandKind: 'preview-breeding',
  actor: { profileId: 'profile-owner', selectedTrainerSlug: 'trainer-owner' },
  ruleset: { rulesetId: ruleset.rulesetId, definitionSha256: ruleset.definitionSha256 },
  scopes: [],
  payload: {
    ownerTrainerSlug: 'trainer-owner',
    breederTrainerSlug: 'trainer-breeder',
    parentRefs: [
      { pokemonSheetSlug: 'pokemon-parent-a', expectedSheetRevision: 2 },
      { pokemonSheetSlug: 'pokemon-parent-b', expectedSheetRevision: 3 },
    ],
    optionSnapshotDefinitionSha256: optionSnapshotHash,
  },
})
const previewResources = (): readonly BreedingReadResourceV1[] => [
  resource('campaign-clock', 'campaign-clock', { revision: 4, observedCampaignMinute: 100, purposes: ['campaign-time'] }),
  resource('trainer-sheet', 'trainer-owner', { revision: 5, purposes: ['authorization'] }),
  resource('trainer-sheet', 'trainer-breeder', { revision: 6, purposes: ['mechanics'] }),
  resource('pokemon-sheet', 'pokemon-parent-a', { revision: 2, purposes: ['snapshot'] }),
  resource('pokemon-sheet', 'pokemon-parent-b', { revision: 3, purposes: ['snapshot'] }),
]
const readSet = (value = 1) => {
  const command = previewCommand(value)
  return createBreedingOperationReadSetV1({
    readSetId: readSetId(value) as any,
    operationId: command.operationId,
    commandSha256: createBreedingOperationCommandHash(command),
    commandKind: command.commandKind,
    capturedAtCampaignMinute: 100,
    resources: previewResources(),
    referenceVersions: referenceVersions(),
    dependencyEvidence: dependencyEvidence(),
    writeExpectations: command.scopes,
  })
}

describe('Breeding operation read-set contract', () => {
  it('hash-binds the complete source, revision, reference, dependency, and freshness policy', () => {
    expect(policy).toMatchObject({
      schemaVersion: 1,
      contractId: 'ptu-1.05-breeding-operation-read-set-v1',
      rulesetId: ruleset.rulesetId,
      rulesetDefinitionSha256: ruleset.definitionSha256,
      sourceManifestSha256: sha256(readFileSync(resolve(ROOT, 'data/breeding-automation/source-manifest.json'))),
    })
    expect(policy.definitionSha256).toBe(sha256(stableJsonStringify(policy.definition)))
    expect(policy.definition.referenceVersions.authoritativeReferenceSources).toEqual(BREEDING_REFERENCE_SOURCE_IDS)
    expect(policy.definition.authority).toMatchObject({ clientReadSet: 'never-authoritative', campaignClock: 'only-time-source', mapEncounterDependency: 'none' })
  })

  it('captures all thirteen app-owned reference versions and required contract definitions', () => {
    const snapshot = referenceVersions()
    expect(snapshot.referenceSources).toHaveLength(13)
    expect(snapshot.contractDefinitionHashes.map(entry => entry.contractId)).toContain('breeding-read-set-contract')
    expect(parseAuthoritativeBreedingReferenceVersionSnapshotV1(snapshot)).toEqual(snapshot)
    expect(Object.isFrozen(snapshot.referenceSources)).toBe(true)
    expect(() => parseBreedingReferenceVersionSnapshotV1({ ...snapshot, referenceSources: snapshot.referenceSources.slice(1) })).toThrow(BreedingReadSetValidationError)
    expect(() => parseAuthoritativeBreedingReferenceVersionSnapshotV1({ ...snapshot, rulesetDefinitionSha256: '9'.repeat(64) })).toThrowError(expect.objectContaining({ code: 'breeding.read-set.hash-mismatch' }))
  })

  it('builds a canonical, self-hashed preview read set bound to the full command', () => {
    const command = previewCommand()
    const captured = readSet()
    expect(validateBreedingOperationReadSetCompleteness(command, captured)).toEqual(captured)
    expect(parseAuthoritativeBreedingOperationReadSetV1(captured)).toEqual(captured)
    expect(assertBreedingOperationReadSetExactReplay(captured, structuredClone(captured))).toEqual(captured)
    expect(captured.definitionSha256).toBe(breedingOperationReadSetDefinitionSha256(captured))
    expect(captured.resources.map(entry => `${entry.resourceKind}:${entry.resourceId}`)).toEqual([...captured.resources.map(entry => `${entry.resourceKind}:${entry.resourceId}`)].sort())
    expect(captured.capturedAtCampaignMinute).toBe(captured.resources.find(entry => entry.resourceKind === 'campaign-clock')?.observedCampaignMinute)
  })

  it('requires exact write expectations, parent revisions, campaign time, and command intent', () => {
    const command = previewCommand()
    const captured = readSet()
    const changedActor = structuredClone(command)
    ;(changedActor.actor as any).profileId = 'profile-other'
    expect(() => validateBreedingOperationReadSetCompleteness(changedActor, captured)).toThrowError(expect.objectContaining({ code: 'breeding.read-set.command-mismatch' }))
    const missingParent = createBreedingOperationReadSetV1({ ...captured, resources: captured.resources.filter(entry => entry.resourceId !== 'pokemon-parent-b') } as any)
    expect(() => validateBreedingOperationReadSetCompleteness(command, missingParent)).toThrowError(expect.objectContaining({ code: 'breeding.read-set.incomplete' }))
    const wrongMinute = createBreedingOperationReadSetV1({ ...captured, capturedAtCampaignMinute: 101 } as any)
    expect(() => validateBreedingOperationReadSetCompleteness(command, wrongMinute)).toThrowError(expect.objectContaining({ code: 'breeding.read-set.incomplete' }))
  })

  it('captures absence and expected revision evidence for project creation', () => {
    const preview = previewCommand(2)
    const command = parseBreedingOperationCommandV1({
      ...preview,
      commandKind: 'create-breeding-project',
      scopes: [{ kind: 'breeding-project', projectId, expectedRevision: null }],
      payload: { ...preview.payload, projectId, consentPolicy: 'same-owner-control' },
    })
    const projectAbsence = resource('breeding-project', projectId, { existence: 'absent', purposes: ['conflict'] })
    const captured = createBreedingOperationReadSetV1({
      readSetId: readSetId(2) as any,
      operationId: command.operationId,
      commandSha256: createBreedingOperationCommandHash(command),
      commandKind: command.commandKind,
      capturedAtCampaignMinute: 100,
      resources: [...previewResources(), projectAbsence],
      referenceVersions: referenceVersions(),
      dependencyEvidence: dependencyEvidence(),
      writeExpectations: command.scopes,
    })
    expect(validateBreedingOperationReadSetCompleteness(command, captured)).toEqual(captured)
    expect(projectAbsence).toMatchObject({ existence: 'absent', revision: null, definitionSha256: null })
    expect(() => parseBreedingReadResourceV1({ ...projectAbsence, revision: 0 })).toThrow(BreedingReadSetValidationError)
  })

  it('detects resource, reference, and effective-provider drift before commit', () => {
    const captured = readSet(3)
    expect(validateBreedingOperationReadSetFreshness(captured, { resources: captured.resources, referenceVersions: captured.referenceVersions, dependencyEvidence: captured.dependencyEvidence })).toEqual({ ok: true })
    const resources = structuredClone(captured.resources)
    const parent = resources.find(entry => entry.resourceId === 'pokemon-parent-a')!
    parent.revision = 3
    const changedReference = createBreedingReferenceVersionSnapshotV1({ ...captured.referenceVersions, campaignOptionSnapshotDefinitionSha256: '8'.repeat(64) } as any)
    const changedDependencies = dependencyEvidence(providerEvidence('7'.repeat(64)))
    const stale = validateBreedingOperationReadSetFreshness(captured, { resources, referenceVersions: changedReference, dependencyEvidence: changedDependencies })
    expect(stale).toMatchObject({ ok: false })
    if (!stale.ok) expect(stale.reasons.map(reason => reason.reasonId)).toEqual([
      'breeding.read-set.dependency-changed',
      'breeding.read-set.reference-changed',
      'breeding.read-set.revision-changed',
    ])
  })

  it('rejects omitted resolver attestations, tampered hashes, enrichment, and accessors', () => {
    const captured = readSet(4)
    expect(() => createBreedingOperationReadSetV1({ ...captured, dependencyEvidence: [providerEvidence()] } as any)).toThrowError(expect.objectContaining({ code: 'breeding.read-set.incomplete' }))
    expect(() => parseAuthoritativeBreedingOperationReadSetV1({ ...captured, definitionSha256: '0'.repeat(64) })).toThrow(BreedingReadSetAuthorityError)
    const changed = createBreedingOperationReadSetV1({ ...captured, capturedAtCampaignMinute: 101, resources: captured.resources.map(entry => entry.resourceKind === 'campaign-clock' ? { ...entry, observedCampaignMinute: 101 } : entry) } as any)
    expect(() => assertBreedingOperationReadSetExactReplay(captured, changed)).toThrowError(expect.objectContaining({ code: 'breeding.read-set.identity-collision' }))
    expect(() => parseBreedingOperationReadSetV1({ ...captured, clientFresh: true })).toThrowError(expect.objectContaining({ code: 'breeding.read-set.unknown-field' }))
    const accessor = structuredClone(captured)
    Object.defineProperty(accessor, 'complete', { enumerable: true, get: () => true })
    expect(() => parseBreedingOperationReadSetV1(accessor)).toThrow(BreedingReadSetValidationError)
  })
})
