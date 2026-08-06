import { createHash } from 'node:crypto'
import { stableJsonStringify } from '#shared/automation/stableJson'
import { parsePokemonEggDocumentV1 } from '#shared/breeding/egg'
import {
  parseBreedingParentSourceChangeEvidenceV1,
  parseBreedingParentSourceChangeImpactV1,
  type BreedingParentSourceChangeCheckpointV1,
  type BreedingParentSourceChangeEvidenceV1,
  type BreedingParentSourceChangeImpactV1,
  type BreedingParentSourceFactV1,
} from '#shared/breeding/parentSourceChange'
import {
  BREEDING_PROJECT_TERMINAL_STATUSES,
  parseBreedingProjectDocumentV1,
} from '#shared/breeding/project'

export const BREEDING_PARENT_SOURCE_CHANGE_POLICY = Object.freeze({
  schemaVersion: 1 as const,
  policyId: 'breeding-parent-source-change-policy-v1' as const,
  changeKinds: Object.freeze([
    'evolution', 'trade', 'rename', 'folder-move', 'deletion', 'retraining', 'source-reference-update',
  ] as const),
  project: Object.freeze({
    refreshablePreCheckStatuses: Object.freeze([
      'draft', 'awaiting-parent-consent', 'initial-time-in-progress', 'check-ready',
    ] as const),
    refreshableChanges: Object.freeze(['evolution', 'folder-move', 'retraining'] as const),
    refreshAuthority: 'explicit-interruption-preserves-credit-and-renews-current-consent' as const,
    identityChanges: 'rename-trade-deletion-require-cancel-or-reviewed-migration' as const,
    postCheckChanges: 'no-parent-refresh-cancel-or-reviewed-migration' as const,
    sourceReferenceUpdates: 'no-silent-reinterpretation-reviewed-migration-required' as const,
    mutationByAssessment: 'none' as const,
  }),
  acceptedEgg: Object.freeze({
    parentSnapshots: 'immutable-authority' as const,
    offspringBlueprint: 'unchanged' as const,
    providerTraits: 'unchanged' as const,
    incubation: 'preserve-current-explicit-state' as const,
    hatchEligibility: 'preserve-status-derived-eligibility' as const,
    liveParentLookupRequired: false as const,
    mutationByAssessment: 'none' as const,
  }),
  authority: Object.freeze({
    facts: 'exact-server-observed-storage-owned-documents-and-reference-snapshots' as const,
    clientAuthority: 'none' as const,
    staleMalformedAmbiguousOrEnriched: 'fail-closed' as const,
  }),
})

const sha256 = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex')
export const BREEDING_PARENT_SOURCE_CHANGE_POLICY_DEFINITION_SHA256 = sha256(BREEDING_PARENT_SOURCE_CHANGE_POLICY)

export type BreedingParentSourceChangeAuthorityErrorCode =
  | 'breeding.parent-change.invalid-evidence'
  | 'breeding.parent-change.hash-mismatch'
  | 'breeding.parent-change.source-mismatch'
  | 'breeding.parent-change.stale-authority'
  | 'breeding.parent-change.unavailable'

export class BreedingParentSourceChangeAuthorityError extends Error {
  readonly code: BreedingParentSourceChangeAuthorityErrorCode
  readonly path: string

  constructor(code: BreedingParentSourceChangeAuthorityErrorCode, path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'BreedingParentSourceChangeAuthorityError'
    this.code = code
    this.path = path
  }
}

const fail = (code: BreedingParentSourceChangeAuthorityErrorCode, path: string, message: string): never => {
  throw new BreedingParentSourceChangeAuthorityError(code, path, message)
}
const minute = (value: unknown, path: string): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    return fail('breeding.parent-change.stale-authority', path, 'must be a nonnegative safe campaign minute.')
  }
  return value as number
}
const withoutDefinitionHash = <Value extends { readonly definitionSha256: string }>(value: Value): Omit<Value, 'definitionSha256'> => {
  const { definitionSha256: _definitionSha256, ...definition } = value
  return definition
}

export const createBreedingParentSourceChangeEvidenceV1 = (input: Omit<BreedingParentSourceChangeEvidenceV1, 'schemaVersion' | 'authority' | 'clientAuthority' | 'definitionSha256'>): BreedingParentSourceChangeEvidenceV1 => {
  const definition = {
    schemaVersion: 1 as const,
    changeId: input.changeId,
    changeKind: input.changeKind,
    prior: input.prior,
    next: input.next,
    observedAtCampaignMinute: input.observedAtCampaignMinute,
    authority: 'server-observed-current-storage-and-reference-snapshots' as const,
    clientAuthority: 'none' as const,
  }
  return parseAuthoritativeBreedingParentSourceChangeEvidenceV1({
    ...definition,
    definitionSha256: sha256(definition),
  })
}

export const parseAuthoritativeBreedingParentSourceChangeEvidenceV1 = (value: unknown): BreedingParentSourceChangeEvidenceV1 => {
  let parsed: BreedingParentSourceChangeEvidenceV1
  try { parsed = parseBreedingParentSourceChangeEvidenceV1(value) }
  catch (error) {
    return fail('breeding.parent-change.invalid-evidence', 'change', error instanceof Error ? error.message : 'must be valid evidence.')
  }
  if (sha256(withoutDefinitionHash(parsed)) !== parsed.definitionSha256) {
    return fail('breeding.parent-change.hash-mismatch', 'change.definitionSha256', 'must bind the exact canonical change evidence.')
  }
  return parsed
}

export const parseAuthoritativeBreedingParentSourceChangeImpactV1 = (value: unknown): BreedingParentSourceChangeImpactV1 => {
  let parsed: BreedingParentSourceChangeImpactV1
  try { parsed = parseBreedingParentSourceChangeImpactV1(value) }
  catch (error) {
    return fail('breeding.parent-change.invalid-evidence', 'impact', error instanceof Error ? error.message : 'must be a valid impact.')
  }
  if (sha256(withoutDefinitionHash(parsed)) !== parsed.definitionSha256) {
    return fail('breeding.parent-change.hash-mismatch', 'impact.definitionSha256', 'must bind the exact canonical impact.')
  }
  return parsed
}

const createImpact = (input: Omit<BreedingParentSourceChangeImpactV1, 'schemaVersion' | 'definitionSha256'>): BreedingParentSourceChangeImpactV1 => {
  const definition = { schemaVersion: 1 as const, ...input }
  return parseAuthoritativeBreedingParentSourceChangeImpactV1({ ...definition, definitionSha256: sha256(definition) })
}

const projectParentIndex = (
  project: ReturnType<typeof parseBreedingProjectDocumentV1>,
  change: BreedingParentSourceChangeEvidenceV1,
): 0 | 1 => {
  const index = project.parentRefs.findIndex(parent => (
    parent.pokemonSheetSlug === change.prior.pokemonSheetSlug
    && parent.ownerTrainerSlug === change.prior.ownerTrainerSlug
    && parent.expectedSheetRevision === change.prior.sheetRevision
  ))
  if (index !== 0 && index !== 1) {
    return fail('breeding.parent-change.source-mismatch', 'change.prior', 'must exactly match one command-ordered Project parent checkpoint.')
  }
  return index
}

const projectCheckpoint = (
  project: ReturnType<typeof parseBreedingProjectDocumentV1>,
  change: BreedingParentSourceChangeEvidenceV1,
): BreedingParentSourceChangeCheckpointV1 => {
  if (project.status === 'egg-produced') return 'project-settled-with-egg'
  if ((BREEDING_PROJECT_TERMINAL_STATUSES as readonly string[]).includes(project.status)) return 'project-terminal'
  if (project.status === 'additional-time-in-progress' || project.status === 'ready-to-produce') return 'project-post-check'
  if (!['draft', 'awaiting-parent-consent', 'initial-time-in-progress', 'check-ready'].includes(project.status)) {
    return fail('breeding.parent-change.unavailable', 'project.status', 'has no closed parent-change checkpoint policy.')
  }
  return ['evolution', 'folder-move', 'retraining'].includes(change.changeKind)
    ? 'project-pre-check'
    : 'project-pre-check-unrefreshable'
}

const impactValues = (checkpoint: BreedingParentSourceChangeCheckpointV1): Pick<BreedingParentSourceChangeImpactV1,
  'disposition' | 'aggregateMutation' | 'creditedProgress' | 'consent' | 'acceptedSnapshot'
  | 'incubation' | 'hatchEligibility' | 'reasonId'> => {
  if (checkpoint === 'project-pre-check') return {
    disposition: 'interrupt-refresh-and-revalidate', aggregateMutation: 'none',
    creditedProgress: 'preserve-no-new-credit', consent: 'renew-current-parent-revision-required',
    acceptedSnapshot: 'not-yet-created', incubation: 'not-applicable', hatchEligibility: 'not-applicable',
    reasonId: 'breeding.parent-change.pre-check-refresh-required',
  }
  if (checkpoint === 'project-pre-check-unrefreshable' || checkpoint === 'project-post-check') return {
    disposition: 'block-until-cancel-or-reviewed-migration', aggregateMutation: 'none',
    creditedProgress: 'preserve-no-new-credit', consent: 'cannot-substitute-for-new-project',
    acceptedSnapshot: 'not-yet-created', incubation: 'not-applicable', hatchEligibility: 'not-applicable',
    reasonId: 'breeding.parent-change.active-project-blocked',
  }
  if (checkpoint === 'project-settled-with-egg') return {
    disposition: 'preserve-settled-project', aggregateMutation: 'none',
    creditedProgress: 'preserve-complete', consent: 'unchanged-audit-only',
    acceptedSnapshot: 'immutable-preserved', incubation: 'not-applicable', hatchEligibility: 'not-applicable',
    reasonId: 'breeding.parent-change.settled-project-preserved',
  }
  if (checkpoint === 'project-terminal') return {
    disposition: 'preserve-terminal-project', aggregateMutation: 'none',
    creditedProgress: 'not-applicable', consent: 'unchanged-audit-only',
    acceptedSnapshot: 'not-applicable', incubation: 'not-applicable', hatchEligibility: 'not-applicable',
    reasonId: 'breeding.parent-change.terminal-project-preserved',
  }
  return {
    disposition: 'preserve-immutable-egg', aggregateMutation: 'none',
    creditedProgress: 'preserve-complete', consent: 'unchanged-audit-only',
    acceptedSnapshot: 'immutable-preserved', incubation: 'preserve-current-explicit-state',
    hatchEligibility: 'preserve-status-derived-eligibility',
    reasonId: 'breeding.parent-change.accepted-egg-preserved',
  }
}

export const evaluateBreedingProjectParentSourceChangeV1 = (input: {
  readonly project: unknown
  readonly change: unknown
  readonly evaluatedAtCampaignMinute: unknown
}): BreedingParentSourceChangeImpactV1 => {
  const project = parseBreedingProjectDocumentV1(input.project)
  const change = parseAuthoritativeBreedingParentSourceChangeEvidenceV1(input.change)
  const evaluatedAt = minute(input.evaluatedAtCampaignMinute, 'evaluatedAtCampaignMinute')
  if (evaluatedAt < change.observedAtCampaignMinute || evaluatedAt < project.updatedAtCampaignMinute) {
    return fail('breeding.parent-change.stale-authority', 'evaluatedAtCampaignMinute', 'cannot predate the change or Project checkpoint.')
  }
  const parentIndex = projectParentIndex(project, change)
  const checkpoint = projectCheckpoint(project, change)
  if (checkpoint === 'project-settled-with-egg' && project.producedEggId === null) {
    return fail('breeding.parent-change.unavailable', 'project.producedEggId', 'settled Egg production must retain its accepted Egg identity.')
  }
  return createImpact({
    changeId: change.changeId,
    changeDefinitionSha256: change.definitionSha256,
    changeKind: change.changeKind,
    aggregateKind: 'breeding-project',
    aggregateId: project.projectId,
    aggregateRevision: project.revision,
    parentIndex,
    checkpoint,
    ...impactValues(checkpoint),
    evaluatedAtCampaignMinute: evaluatedAt,
  })
}

const eggParentIndex = (
  egg: ReturnType<typeof parsePokemonEggDocumentV1>,
  prior: BreedingParentSourceFactV1,
): 0 | 1 => {
  const index = egg.parents.findIndex(parent => (
    parent.pokemonSheetSlug === prior.pokemonSheetSlug
    && parent.sheetRevision === prior.sheetRevision
    && parent.ownerTrainerSlug === prior.ownerTrainerSlug
    && parent.speciesId === prior.speciesId
    && parent.sourceSheetSha256 === prior.sourceSheetSha256
  ))
  if (index !== 0 && index !== 1) {
    return fail('breeding.parent-change.source-mismatch', 'change.prior', 'must exactly match one immutable accepted Egg parent snapshot.')
  }
  return index
}

export const evaluateAcceptedEggParentSourceChangeV1 = (input: {
  readonly egg: unknown
  readonly change: unknown
  readonly evaluatedAtCampaignMinute: unknown
}): BreedingParentSourceChangeImpactV1 => {
  const egg = parsePokemonEggDocumentV1(input.egg)
  const change = parseAuthoritativeBreedingParentSourceChangeEvidenceV1(input.change)
  const evaluatedAt = minute(input.evaluatedAtCampaignMinute, 'evaluatedAtCampaignMinute')
  if (egg.source.kind !== 'breeding' || egg.parents.length !== 2) {
    return fail('breeding.parent-change.unavailable', 'egg.parents', 'only an accepted breeding Egg has two parent snapshots.')
  }
  if (evaluatedAt < change.observedAtCampaignMinute || evaluatedAt < egg.updatedAtCampaignMinute) {
    return fail('breeding.parent-change.stale-authority', 'evaluatedAtCampaignMinute', 'cannot predate the change or Egg checkpoint.')
  }
  const parentIndex = eggParentIndex(egg, change.prior)
  const checkpoint = 'accepted-egg' as const
  return createImpact({
    changeId: change.changeId,
    changeDefinitionSha256: change.definitionSha256,
    changeKind: change.changeKind,
    aggregateKind: 'pokemon-egg',
    aggregateId: egg.eggId,
    aggregateRevision: egg.revision,
    parentIndex,
    checkpoint,
    ...impactValues(checkpoint),
    evaluatedAtCampaignMinute: evaluatedAt,
  })
}
