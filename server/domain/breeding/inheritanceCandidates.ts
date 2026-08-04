import { createHash } from 'node:crypto'
import inheritancePolicyJson from '../../../data/breeding-automation/inheritance-candidate-policy.json'
import { stableJsonStringify } from '#shared/automation/stableJson'
import type { BreedingMoveId, BreedingSpeciesId } from '#shared/breeding/ids'
import {
  BREEDING_CANONICAL_ID_DEFINITION_SHA256,
  canonicalBreedingMoveIdentity,
  canonicalBreedingSpeciesIdentity,
} from './canonicalIds'
import type { BreedingOffspringResolutionResult } from './offspringResolution'
import {
  COMPILED_BREEDING_REGISTRY_DEFINITION_SHA256,
  compiledBreedingSpeciesSpec,
} from './registry'

export const BREEDING_INHERITANCE_CANDIDATE_POLICY_DEFINITION_SHA256 = inheritancePolicyJson.definitionSha256
export const BREEDING_INHERITANCE_LIMITS = Object.freeze({
  effectiveMovesPerParent: 64,
  evidenceRowsPerMove: 16,
  candidates: 256,
})
export const BREEDING_INHERITANCE_PATHWAYS = Object.freeze([
  'child-egg-move',
  'child-machine-compatible',
] as const)
export type BreedingInheritancePathwayId = typeof BREEDING_INHERITANCE_PATHWAYS[number]
export const BREEDING_EFFECTIVE_MOVE_SOURCE_KINDS = Object.freeze([
  'sheet-known-move',
  'permanent-move-grant',
  'effective-provider',
] as const)
export type BreedingEffectiveMoveSourceKind = typeof BREEDING_EFFECTIVE_MOVE_SOURCE_KINDS[number]

export interface BreedingEffectiveMoveEvidence {
  readonly evidenceId: string
  readonly sourceKind: BreedingEffectiveMoveSourceKind
  readonly sourceId: string
  readonly sourceDefinitionSha256: string
}
export interface BreedingEffectiveKnownMoveSnapshot {
  readonly moveId: BreedingMoveId
  readonly evidence: readonly BreedingEffectiveMoveEvidence[]
}
export interface BreedingInheritanceParentSnapshotDefinition {
  readonly schemaVersion: 1
  readonly parentRef: string
  readonly speciesId: BreedingSpeciesId
  readonly sourceSheetSha256: string
  readonly effectiveKnownMoves: readonly BreedingEffectiveKnownMoveSnapshot[]
}
export interface BreedingInheritanceParentSnapshot extends BreedingInheritanceParentSnapshotDefinition {
  readonly definitionSha256: string
}
export interface BreedingInheritanceCandidateSource {
  readonly parentIndex: 0 | 1
  readonly parentRef: string
  readonly parentSpeciesId: BreedingSpeciesId
  readonly pathwayId: BreedingInheritancePathwayId
  readonly knownMoveEvidence: readonly BreedingEffectiveMoveEvidence[]
}
export interface BreedingInheritanceCandidate {
  readonly moveId: BreedingMoveId
  readonly sources: readonly BreedingInheritanceCandidateSource[]
}
export type BreedingInheritanceCandidateReasonId =
  | 'breeding.inheritance.offspring-unavailable'
  | 'breeding.inheritance.parent-snapshot-invalid'
  | 'breeding.inheritance.parent-spec-unavailable'
  | 'breeding.inheritance.parent-family-inconsistent'
  | 'breeding.inheritance.unknown-move-id'
  | 'breeding.inheritance.limit-exceeded'
  | 'breeding.inheritance.provenance-conflict'
  | 'breeding.inheritance.candidate-limit-exceeded'
export interface BuildBreedingInheritanceCandidatesInput {
  readonly offspring: BreedingOffspringResolutionResult
  readonly parentSnapshots: readonly [BreedingInheritanceParentSnapshot, BreedingInheritanceParentSnapshot]
}
export interface ResolvedBreedingInheritanceCandidates {
  readonly status: 'resolved'
  readonly reasonIds: readonly []
  readonly offspringSpeciesId: BreedingSpeciesId
  readonly offspringSpecDefinitionSha256: string
  readonly parentSnapshotDefinitionSha256s: readonly [string, string]
  readonly candidates: readonly BreedingInheritanceCandidate[]
  readonly candidateSetDefinitionSha256: string
  readonly compiledRegistryDefinitionSha256: string
  readonly canonicalIdDefinitionSha256: string
  readonly policyDefinitionSha256: string
}
export interface UnavailableBreedingInheritanceCandidates {
  readonly status: 'unavailable'
  readonly reasonIds: readonly BreedingInheritanceCandidateReasonId[]
  readonly offspringSpeciesId: BreedingSpeciesId | null
  readonly offspringSpecDefinitionSha256: string | null
  readonly parentSnapshotDefinitionSha256s: null
  readonly candidates: readonly []
  readonly candidateSetDefinitionSha256: null
  readonly compiledRegistryDefinitionSha256: string
  readonly canonicalIdDefinitionSha256: string
  readonly policyDefinitionSha256: string
}
export type BreedingInheritanceCandidatesResult =
  | ResolvedBreedingInheritanceCandidates
  | UnavailableBreedingInheritanceCandidates

export type BreedingInheritanceSnapshotValidationCode =
  | 'invalid'
  | 'unknown-move-id'
  | 'limit-exceeded'
  | 'provenance-conflict'
export class BreedingInheritanceSnapshotValidationError extends Error {
  readonly code: BreedingInheritanceSnapshotValidationCode
  readonly path: string
  constructor(code: BreedingInheritanceSnapshotValidationCode, path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'BreedingInheritanceSnapshotValidationError'
    this.code = code
    this.path = path
  }
}

type UnknownRecord = Record<string, unknown>
const SHA256 = /^[0-9a-f]{64}$/
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/
const SOURCE_KINDS = new Set<string>(BREEDING_EFFECTIVE_MOVE_SOURCE_KINDS)
const REASONS = inheritancePolicyJson.definition.reasonIds as readonly BreedingInheritanceCandidateReasonId[]
const reasonOrder = new Map(REASONS.map((reason, index) => [reason, index]))
const hash = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex')
const deepFreeze = <Value>(value: Value): Value => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) deepFreeze((value as Record<string, unknown>)[key])
  return Object.freeze(value)
}
const fail = (code: BreedingInheritanceSnapshotValidationCode, path: string, message: string): never => {
  throw new BreedingInheritanceSnapshotValidationError(code, path, message)
}
const record = (value: unknown, path: string): UnknownRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('invalid', path, 'must be an object.')
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return fail('invalid', path, 'must be a plain object.')
  return value as UnknownRecord
}
const exact = (value: unknown, fields: readonly string[], path: string): UnknownRecord => {
  const result = record(value, path)
  const expected = new Set(fields)
  if (Object.keys(result).length !== fields.length || fields.some(field => !Object.hasOwn(result, field))
    || Object.keys(result).some(field => !expected.has(field))) return fail('invalid', path, 'has an invalid shape.')
  return result
}
const identifier = (value: unknown, path: string): string => (
  typeof value === 'string' && IDENTIFIER.test(value) ? value : fail('invalid', path, 'must be a bounded identifier.')
)
const sha256 = (value: unknown, path: string): string => (
  typeof value === 'string' && SHA256.test(value) ? value : fail('invalid', path, 'must be a SHA-256 value.')
)
const evidence = (value: unknown, path: string): BreedingEffectiveMoveEvidence => {
  const row = exact(value, ['evidenceId', 'sourceKind', 'sourceId', 'sourceDefinitionSha256'], path)
  if (typeof row.sourceKind !== 'string' || !SOURCE_KINDS.has(row.sourceKind)) {
    return fail('invalid', `${path}.sourceKind`, 'is not a registered effective Move source kind.')
  }
  return Object.freeze({
    evidenceId: identifier(row.evidenceId, `${path}.evidenceId`),
    sourceKind: row.sourceKind as BreedingEffectiveMoveSourceKind,
    sourceId: identifier(row.sourceId, `${path}.sourceId`),
    sourceDefinitionSha256: sha256(row.sourceDefinitionSha256, `${path}.sourceDefinitionSha256`),
  })
}
const knownMove = (value: unknown, path: string): BreedingEffectiveKnownMoveSnapshot => {
  const row = exact(value, ['moveId', 'evidence'], path)
  const identity = canonicalBreedingMoveIdentity(row.moveId)
  if (!identity) return fail('unknown-move-id', `${path}.moveId`, 'is not a canonical Move ID.')
  if (!Array.isArray(row.evidence) || row.evidence.length < 1) return fail('invalid', `${path}.evidence`, 'must not be empty.')
  if (row.evidence.length > BREEDING_INHERITANCE_LIMITS.evidenceRowsPerMove) {
    return fail('limit-exceeded', `${path}.evidence`, 'contains too many provenance rows.')
  }
  const parsed = row.evidence.map((entry, index) => evidence(entry, `${path}.evidence[${index}]`))
  for (let index = 1; index < parsed.length; index += 1) {
    if (parsed[index - 1]!.evidenceId >= parsed[index]!.evidenceId) {
      return fail('provenance-conflict', `${path}.evidence`, 'must contain unique evidence IDs in strict code-point order.')
    }
  }
  return Object.freeze({ moveId: identity.id, evidence: Object.freeze(parsed) })
}

export const breedingInheritanceParentSnapshotDefinitionSha256 = (
  definition: BreedingInheritanceParentSnapshotDefinition,
): string => hash(definition)

/** Create a detached, sorted, self-hashed server-owned effective Move snapshot. */
export const createBreedingInheritanceParentSnapshot = (
  definition: BreedingInheritanceParentSnapshotDefinition,
): BreedingInheritanceParentSnapshot => {
  const sortedDefinition = {
    ...definition,
    effectiveKnownMoves: definition.effectiveKnownMoves
      .map(move => ({ ...move, evidence: [...move.evidence].sort((left, right) => left.evidenceId < right.evidenceId ? -1 : left.evidenceId > right.evidenceId ? 1 : 0) }))
      .sort((left, right) => left.moveId < right.moveId ? -1 : left.moveId > right.moveId ? 1 : 0),
  }
  return parseBreedingInheritanceParentSnapshot({
    ...sortedDefinition,
    definitionSha256: hash(sortedDefinition),
  })
}

/** Parse, detach, self-hash-check, and deeply freeze one effective Move snapshot. */
export const parseBreedingInheritanceParentSnapshot = (
  value: unknown,
  path = 'parentSnapshot',
): BreedingInheritanceParentSnapshot => {
  const row = exact(value, ['schemaVersion', 'parentRef', 'speciesId', 'sourceSheetSha256', 'effectiveKnownMoves', 'definitionSha256'], path)
  if (row.schemaVersion !== 1) fail('invalid', `${path}.schemaVersion`, 'must be 1.')
  const species = canonicalBreedingSpeciesIdentity(row.speciesId)
  if (!species) fail('invalid', `${path}.speciesId`, 'must be a canonical Species ID.')
  if (!Array.isArray(row.effectiveKnownMoves)) fail('invalid', `${path}.effectiveKnownMoves`, 'must be an array.')
  if (row.effectiveKnownMoves.length > BREEDING_INHERITANCE_LIMITS.effectiveMovesPerParent) {
    fail('limit-exceeded', `${path}.effectiveKnownMoves`, 'contains too many effective Moves.')
  }
  const moves = row.effectiveKnownMoves.map((entry, index) => knownMove(entry, `${path}.effectiveKnownMoves[${index}]`))
  for (let index = 1; index < moves.length; index += 1) {
    if (moves[index - 1]!.moveId >= moves[index]!.moveId) {
      fail('provenance-conflict', `${path}.effectiveKnownMoves`, 'must contain unique Move IDs in strict code-point order.')
    }
  }
  const definition: BreedingInheritanceParentSnapshotDefinition = {
    schemaVersion: 1,
    parentRef: identifier(row.parentRef, `${path}.parentRef`),
    speciesId: species.id,
    sourceSheetSha256: sha256(row.sourceSheetSha256, `${path}.sourceSheetSha256`),
    effectiveKnownMoves: Object.freeze(moves),
  }
  const expectedHash = sha256(row.definitionSha256, `${path}.definitionSha256`)
  if (hash(definition) !== expectedHash) fail('invalid', `${path}.definitionSha256`, 'does not match the snapshot definition.')
  return deepFreeze({ ...definition, definitionSha256: expectedHash })
}

const unavailable = (
  reasons: Iterable<BreedingInheritanceCandidateReasonId>,
  offspringSpeciesId: BreedingSpeciesId | null,
  offspringSpecDefinitionSha256: string | null,
): UnavailableBreedingInheritanceCandidates => Object.freeze({
  status: 'unavailable',
  reasonIds: Object.freeze([...new Set(reasons)].sort((left, right) => reasonOrder.get(left)! - reasonOrder.get(right)!)),
  offspringSpeciesId,
  offspringSpecDefinitionSha256,
  parentSnapshotDefinitionSha256s: null,
  candidates: Object.freeze([]),
  candidateSetDefinitionSha256: null,
  compiledRegistryDefinitionSha256: COMPILED_BREEDING_REGISTRY_DEFINITION_SHA256,
  canonicalIdDefinitionSha256: BREEDING_CANONICAL_ID_DEFINITION_SHA256,
  policyDefinitionSha256: BREEDING_INHERITANCE_CANDIDATE_POLICY_DEFINITION_SHA256,
})
const reasonForValidation = (error: BreedingInheritanceSnapshotValidationError): BreedingInheritanceCandidateReasonId => {
  if (error.code === 'unknown-move-id') return 'breeding.inheritance.unknown-move-id'
  if (error.code === 'limit-exceeded') return 'breeding.inheritance.limit-exceeded'
  if (error.code === 'provenance-conflict') return 'breeding.inheritance.provenance-conflict'
  return 'breeding.inheritance.parent-snapshot-invalid'
}

export const buildBreedingInheritanceCandidates = (
  input: BuildBreedingInheritanceCandidatesInput,
): BreedingInheritanceCandidatesResult => {
  const reasons: BreedingInheritanceCandidateReasonId[] = []
  const offspringSpeciesId = input.offspring.status === 'resolved'
    && input.offspring.compiledRegistryDefinitionSha256 === COMPILED_BREEDING_REGISTRY_DEFINITION_SHA256
    ? input.offspring.offspringSpeciesId
    : null
  const childSpec = offspringSpeciesId ? compiledBreedingSpeciesSpec(offspringSpeciesId) : null
  if (!childSpec) reasons.push('breeding.inheritance.offspring-unavailable')

  const parents: BreedingInheritanceParentSnapshot[] = []
  for (let index = 0; index < 2; index += 1) {
    try {
      parents.push(parseBreedingInheritanceParentSnapshot(input.parentSnapshots?.[index], `parentSnapshots[${index}]`))
    }
    catch (error) {
      reasons.push(error instanceof BreedingInheritanceSnapshotValidationError
        ? reasonForValidation(error)
        : 'breeding.inheritance.parent-snapshot-invalid')
    }
  }
  if (parents.length === 2 && parents[0]!.parentRef === parents[1]!.parentRef) {
    reasons.push('breeding.inheritance.parent-snapshot-invalid')
  }
  const parentSpecs = parents.map(parent => compiledBreedingSpeciesSpec(parent.speciesId))
  if (parents.length === 2 && parentSpecs.some(spec => !spec)) reasons.push('breeding.inheritance.parent-spec-unavailable')
  if (childSpec && input.offspring.status === 'resolved' && parents.length === 2 && parentSpecs.every(Boolean)) {
    const selectedIndex = input.offspring.selectedParentIndex
    const selectedFamilyMatches = selectedIndex === null
      ? parentSpecs.some(spec => spec!.familyId === input.offspring.selectedFamilyId)
      : parentSpecs[selectedIndex]!.familyId === input.offspring.selectedFamilyId
    if (childSpec.familyId !== input.offspring.selectedFamilyId || !selectedFamilyMatches) {
      reasons.push('breeding.inheritance.parent-family-inconsistent')
    }
  }
  if (reasons.length > 0 || !childSpec || parents.length !== 2) {
    return unavailable(reasons, offspringSpeciesId, childSpec?.definitionSha256 ?? null)
  }

  const eggMoves = new Set(childSpec.eggMoveIds)
  const machineMoves = new Set(childSpec.machineCompatibleMoveIds)
  const candidateMap = new Map<BreedingMoveId, BreedingInheritanceCandidateSource[]>()
  parents.forEach((parent, parentIndex) => {
    for (const move of parent.effectiveKnownMoves) {
      const pathways: BreedingInheritancePathwayId[] = []
      if (eggMoves.has(move.moveId)) pathways.push('child-egg-move')
      if (machineMoves.has(move.moveId)) pathways.push('child-machine-compatible')
      for (const pathwayId of pathways) {
        const sources = candidateMap.get(move.moveId) ?? []
        sources.push(Object.freeze({
          parentIndex: parentIndex as 0 | 1,
          parentRef: parent.parentRef,
          parentSpeciesId: parent.speciesId,
          pathwayId,
          knownMoveEvidence: move.evidence,
        }))
        candidateMap.set(move.moveId, sources)
      }
    }
  })
  if (candidateMap.size > BREEDING_INHERITANCE_LIMITS.candidates) {
    return unavailable(['breeding.inheritance.candidate-limit-exceeded'], offspringSpeciesId, childSpec.definitionSha256)
  }
  const candidates: BreedingInheritanceCandidate[] = [...candidateMap.entries()]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([moveId, sources]) => Object.freeze({ moveId, sources: Object.freeze(sources) }))
  const frozenCandidates = deepFreeze(candidates)
  return Object.freeze({
    status: 'resolved',
    reasonIds: Object.freeze([]),
    offspringSpeciesId: childSpec.speciesId,
    offspringSpecDefinitionSha256: childSpec.definitionSha256,
    parentSnapshotDefinitionSha256s: Object.freeze([
      parents[0]!.definitionSha256,
      parents[1]!.definitionSha256,
    ]) as readonly [string, string],
    candidates: frozenCandidates,
    candidateSetDefinitionSha256: hash(frozenCandidates),
    compiledRegistryDefinitionSha256: COMPILED_BREEDING_REGISTRY_DEFINITION_SHA256,
    canonicalIdDefinitionSha256: BREEDING_CANONICAL_ID_DEFINITION_SHA256,
    policyDefinitionSha256: BREEDING_INHERITANCE_CANDIDATE_POLICY_DEFINITION_SHA256,
  })
}
