import {
  BREEDING_BREEDER_MANDATED_SKILL_IDS,
  parseBreedingBreederAuthorityEvidenceV1,
  type BreedingBreederAuthorityEvidenceV1,
  type BreedingBreederMandatedSkillId,
} from './authorization'
import type { PokemonEducationRank } from './ledgers'
import {
  parseBreedingDependencyEvidenceV1,
  type BreedingDependencyEvidenceV1,
} from './readSets'

export const BREEDING_BREEDER_EDGE_HANDOFF_SCHEMA_VERSION = 1 as const
export const BREEDING_BREEDER_EDGE_HANDOFF_CAPABILITY_ID = 'breeding.v1' as const
export const BREEDING_BREEDER_EDGE_REQUEST_CONTRACT_ID = 'edge.breeder.request.v1' as const
export const BREEDING_BREEDER_EDGE_CONTRIBUTION_IDS = Object.freeze([
  'breeding-project-request',
  'breeder-dc12-timeline',
] as const)
export const BREEDING_BREEDER_EDGE_HANDOFF_CHECKPOINTS = Object.freeze([
  'project-preview',
  'project-creation',
  'project-check',
  'egg-acceptance',
] as const)
export type BreedingBreederEdgeHandoffCheckpoint = typeof BREEDING_BREEDER_EDGE_HANDOFF_CHECKPOINTS[number]

export interface BreedingBreederSkillApplicationV1 {
  readonly schemaVersion: 1
  readonly mandatedSkillId: BreedingBreederMandatedSkillId
  readonly sourceKind: 'canonical-edge' | 'dilettante-substitution'
  readonly sourceFeatureInstanceId: string | null
  readonly sourceFeatureContributionDefinitionSha256: string | null
  readonly rank: PokemonEducationRank
  readonly skillTotal: number
  readonly definitionSha256: string
}

export interface BreedingBreederEdgeHandoffV1 {
  readonly schemaVersion: 1
  readonly capabilityId: typeof BREEDING_BREEDER_EDGE_HANDOFF_CAPABILITY_ID
  readonly requestContractId: typeof BREEDING_BREEDER_EDGE_REQUEST_CONTRACT_ID
  readonly sourceContributionIds: typeof BREEDING_BREEDER_EDGE_CONTRIBUTION_IDS
  readonly checkpoint: BreedingBreederEdgeHandoffCheckpoint
  readonly breederAuthority: BreedingBreederAuthorityEvidenceV1
  readonly skillApplication: BreedingBreederSkillApplicationV1
  readonly dependencyEvidence: BreedingDependencyEvidenceV1
  readonly definitionSha256: string
}

export type BreedingBreederEdgeHandoffValidationCode =
  | 'breeding.breeder-edge-handoff.invalid-document'
  | 'breeding.breeder-edge-handoff.unknown-field'
  | 'breeding.breeder-edge-handoff.invalid-invariant'

export class BreedingBreederEdgeHandoffValidationError extends Error {
  readonly code: BreedingBreederEdgeHandoffValidationCode
  readonly path: string

  constructor(code: BreedingBreederEdgeHandoffValidationCode, path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'BreedingBreederEdgeHandoffValidationError'
    this.code = code
    this.path = path
  }
}

type UnknownRecord = Record<string, unknown>
const SHA256 = /^[0-9a-f]{64}$/u
const CHECKPOINTS = new Set<string>(BREEDING_BREEDER_EDGE_HANDOFF_CHECKPOINTS)
const MANDATED_SKILL_IDS = new Set<string>(BREEDING_BREEDER_MANDATED_SKILL_IDS)
const RANKS = new Set<string>(['Pathetic','Untrained','Novice','Adept','Expert','Master'])

const fail = (
  code: BreedingBreederEdgeHandoffValidationCode,
  path: string,
  message: string,
): never => { throw new BreedingBreederEdgeHandoffValidationError(code, path, message) }

const exact = (value: unknown, fields: readonly string[], path: string): UnknownRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    || Object.getOwnPropertySymbols(value).length > 0) {
    return fail('breeding.breeder-edge-handoff.invalid-document', path, 'must be a plain data object.')
  }
  const row = value as UnknownRecord
  const allowed = new Set(fields)
  if (fields.some(field => !Object.hasOwn(row, field))
    || Object.getOwnPropertyNames(row).some(field => !allowed.has(field))) {
    return fail('breeding.breeder-edge-handoff.unknown-field', path, 'must contain exactly the declared fields.')
  }
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(row, field)
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      return fail('breeding.breeder-edge-handoff.invalid-document', `${path}.${field}`, 'must be an enumerable data field.')
    }
  }
  return row
}

const hash = (value: unknown, path: string): string => typeof value === 'string' && SHA256.test(value) ? value : fail('breeding.breeder-edge-handoff.invalid-document', path, 'must be a lowercase SHA-256 value.')
const identifier = (value: unknown, path: string): string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/’' -]{0,239}$/u.test(value) ? value : fail('breeding.breeder-edge-handoff.invalid-document', path, 'must be a bounded stable identifier.')
const skillApplication = (value: unknown, path: string): BreedingBreederSkillApplicationV1 => {
  const row = exact(value, ['schemaVersion','mandatedSkillId','sourceKind','sourceFeatureInstanceId','sourceFeatureContributionDefinitionSha256','rank','skillTotal','definitionSha256'], path)
  if (row.schemaVersion !== 1 || typeof row.mandatedSkillId !== 'string' || !MANDATED_SKILL_IDS.has(row.mandatedSkillId) || typeof row.rank !== 'string' || !RANKS.has(row.rank)
    || !Number.isSafeInteger(row.skillTotal) || (row.skillTotal as number) < -30 || (row.skillTotal as number) > 100) return fail('breeding.breeder-edge-handoff.invalid-document', path, 'must be one bounded mandated Skill application.')
  if (row.sourceKind === 'canonical-edge') {
    if (row.mandatedSkillId !== 'pokemon-education' || row.sourceFeatureInstanceId !== null || row.sourceFeatureContributionDefinitionSha256 !== null) return fail('breeding.breeder-edge-handoff.invalid-invariant', path, 'canonical Edge Skill authority cannot carry Feature substitution evidence.')
  }
  else if (row.sourceKind === 'dilettante-substitution') {
    if ((row.mandatedSkillId !== 'general-education' && row.mandatedSkillId !== 'perception') || row.sourceFeatureInstanceId === null || row.sourceFeatureContributionDefinitionSha256 === null) return fail('breeding.breeder-edge-handoff.invalid-invariant', path, 'Dilettante must substitute General Education or Perception with exact Feature evidence.')
  }
  else return fail('breeding.breeder-edge-handoff.invalid-document', `${path}.sourceKind`, 'must be one closed Skill authority source.')
  return Object.freeze({ schemaVersion: 1, mandatedSkillId: row.mandatedSkillId as BreedingBreederMandatedSkillId, sourceKind: row.sourceKind, sourceFeatureInstanceId: row.sourceFeatureInstanceId === null ? null : identifier(row.sourceFeatureInstanceId, `${path}.sourceFeatureInstanceId`), sourceFeatureContributionDefinitionSha256: row.sourceFeatureContributionDefinitionSha256 === null ? null : hash(row.sourceFeatureContributionDefinitionSha256, `${path}.sourceFeatureContributionDefinitionSha256`), rank: row.rank as PokemonEducationRank, skillTotal: row.skillTotal as number, definitionSha256: hash(row.definitionSha256, `${path}.definitionSha256`) })
}
const exactContributions = (value: unknown, path: string): typeof BREEDING_BREEDER_EDGE_CONTRIBUTION_IDS => {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
    || Object.getOwnPropertySymbols(value).length > 0
    || Object.getOwnPropertyNames(value).length !== BREEDING_BREEDER_EDGE_CONTRIBUTION_IDS.length + 1
    || value.length !== BREEDING_BREEDER_EDGE_CONTRIBUTION_IDS.length
    || value.some((entry, index) => entry !== BREEDING_BREEDER_EDGE_CONTRIBUTION_IDS[index])) {
    return fail('breeding.breeder-edge-handoff.invalid-invariant', path, 'must contain the exact reviewed Breeder contribution IDs in canonical order.')
  }
  return BREEDING_BREEDER_EDGE_CONTRIBUTION_IDS
}

export const parseBreedingBreederEdgeHandoffV1 = (
  value: unknown,
  path = 'breederEdgeHandoff',
): BreedingBreederEdgeHandoffV1 => {
  const row = exact(value, [
    'schemaVersion',
    'capabilityId',
    'requestContractId',
    'sourceContributionIds',
    'checkpoint',
    'breederAuthority',
    'skillApplication',
    'dependencyEvidence',
    'definitionSha256',
  ], path)
  if (row.schemaVersion !== BREEDING_BREEDER_EDGE_HANDOFF_SCHEMA_VERSION
    || row.capabilityId !== BREEDING_BREEDER_EDGE_HANDOFF_CAPABILITY_ID
    || row.requestContractId !== BREEDING_BREEDER_EDGE_REQUEST_CONTRACT_ID
    || typeof row.checkpoint !== 'string' || !CHECKPOINTS.has(row.checkpoint)
    || typeof row.definitionSha256 !== 'string' || !SHA256.test(row.definitionSha256)) {
    return fail('breeding.breeder-edge-handoff.invalid-document', path, 'must be a canonical schema-v1 Breeder handoff.')
  }
  const sourceContributionIds = exactContributions(row.sourceContributionIds, `${path}.sourceContributionIds`)
  const breederAuthority = parseBreedingBreederAuthorityEvidenceV1(row.breederAuthority, `${path}.breederAuthority`)
  const application = skillApplication(row.skillApplication, `${path}.skillApplication`)
  const dependencyEvidence = parseBreedingDependencyEvidenceV1(row.dependencyEvidence, `${path}.dependencyEvidence`)
  if (application.rank !== breederAuthority.pokemonEducationRank || application.skillTotal !== breederAuthority.pokemonEducationSkillTotal || application.mandatedSkillId !== (breederAuthority.mandatedSkillId ?? 'pokemon-education')) return fail('breeding.breeder-edge-handoff.invalid-invariant', `${path}.skillApplication`, 'must bind the exact effective Skill, rank, and check total carried by Breeder authority.')
  if (dependencyEvidence.providerKind !== 'edge'
    || dependencyEvidence.providerId !== 'Breeder'
    || dependencyEvidence.subjectKind !== 'trainer-sheet'
    || dependencyEvidence.subjectId !== breederAuthority.breederTrainerSlug
    || dependencyEvidence.subjectRevision !== breederAuthority.breederTrainerRevision
    || dependencyEvidence.checkpoint !== row.checkpoint
    || dependencyEvidence.providerDefinitionSha256 !== breederAuthority.edgeRecordSha256
    || dependencyEvidence.effectiveEvidenceSha256 !== breederAuthority.effectiveEdgeProjectionSha256) {
    return fail('breeding.breeder-edge-handoff.invalid-invariant', `${path}.dependencyEvidence`, 'must exactly attest the bundled current Breeder authority.')
  }
  return Object.freeze({
    schemaVersion: 1,
    capabilityId: BREEDING_BREEDER_EDGE_HANDOFF_CAPABILITY_ID,
    requestContractId: BREEDING_BREEDER_EDGE_REQUEST_CONTRACT_ID,
    sourceContributionIds,
    checkpoint: row.checkpoint as BreedingBreederEdgeHandoffCheckpoint,
    breederAuthority,
    skillApplication: application,
    dependencyEvidence,
    definitionSha256: row.definitionSha256,
  })
}
