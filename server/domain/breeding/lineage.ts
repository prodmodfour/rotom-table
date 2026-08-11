import { createHash } from 'node:crypto'
import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  parseBreederSnapshotV1,
  parseBreedingParentSnapshotV1,
  parsePokemonEggDocumentV1,
  parsePokemonEggOffspringBlueprintV1,
  type BreederSnapshotV1,
  type BreedingParentSnapshotV1,
  type PokemonEggDocumentV1,
  type PokemonEggInheritanceCandidateV1,
  type PokemonEggOffspringBlueprintV1,
} from '#shared/breeding/egg'
import {
  BREEDING_INHERITANCE_CHECKPOINT_LEVELS,
  parseBreedingInheritanceLearningRecordV1,
  parsePokemonBreedingOriginV1,
  type BreedingInheritanceLearningRecordV1,
  type PokemonBreedingOriginV1,
} from '#shared/breeding/lineage'
import type { PokemonBreedingOriginId } from '#shared/breeding/ids'

export type BreedingParentSnapshotDefinitionV1 = Omit<BreedingParentSnapshotV1, 'definitionSha256'>
export type BreederSnapshotDefinitionV1 = Omit<BreederSnapshotV1, 'definitionSha256'>
export type PokemonEggOffspringBlueprintDefinitionV1 = Omit<PokemonEggOffspringBlueprintV1, 'definitionSha256' | 'providerTraits'> & {
  readonly providerTraits?: PokemonEggOffspringBlueprintV1['providerTraits']
}
export type BreedingInheritanceLearningRecordDefinitionV1 = Omit<BreedingInheritanceLearningRecordV1, 'definitionSha256'>
export type PokemonBreedingLineageDefinitionV1 = Omit<PokemonBreedingOriginV1, 'inheritanceLearningRecords' | 'lineageDefinitionSha256'>

export type AuthoritativeBreedingLineageValidationCode =
  | 'breeding.lineage.hash-mismatch'
  | 'breeding.lineage.egg-mismatch'
  | 'breeding.lineage.invalid-successor'
export class AuthoritativeBreedingLineageValidationError extends Error {
  readonly code: AuthoritativeBreedingLineageValidationCode
  readonly path: string
  constructor(code: AuthoritativeBreedingLineageValidationCode, path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'AuthoritativeBreedingLineageValidationError'
    this.code = code
    this.path = path
  }
}
const fail = (code: AuthoritativeBreedingLineageValidationCode, path: string, message: string): never => {
  throw new AuthoritativeBreedingLineageValidationError(code, path, message)
}
const hash = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex')
const same = (left: unknown, right: unknown): boolean => stableJsonStringify(left) === stableJsonStringify(right)
const withoutDefinitionHash = <Value extends { readonly definitionSha256: string }>(value: Value): Omit<Value, 'definitionSha256'> => {
  const { definitionSha256: _definitionSha256, ...definition } = value
  return definition
}
const effectiveMoveSnapshotDefinition = (parent: BreedingParentSnapshotV1) => ({
  schemaVersion: 1 as const,
  parentRef: parent.pokemonSheetSlug,
  speciesId: parent.speciesId,
  sourceSheetSha256: parent.sourceSheetSha256,
  effectiveKnownMoves: parent.effectiveKnownMoves,
})

export const breedingParentSnapshotDefinitionSha256 = (definition: BreedingParentSnapshotDefinitionV1): string => hash(definition)
export const breederSnapshotDefinitionSha256 = (definition: BreederSnapshotDefinitionV1): string => hash(definition)
export const pokemonEggOffspringBlueprintDefinitionSha256 = (definition: PokemonEggOffspringBlueprintDefinitionV1): string => hash(definition)
export const breedingInheritanceCandidateDefinitionSha256 = (candidate: PokemonEggInheritanceCandidateV1): string => hash(candidate)
export const breedingInheritanceCandidateSetDefinitionSha256 = (candidates: readonly PokemonEggInheritanceCandidateV1[]): string => hash(candidates)
export const breedingInheritanceLearningRecordDefinitionSha256 = (definition: BreedingInheritanceLearningRecordDefinitionV1): string => hash(definition)
export const pokemonBreedingLineageDefinitionSha256 = (definition: PokemonBreedingLineageDefinitionV1): string => hash(definition)
export const pokemonEggDocumentDefinitionSha256 = (egg: PokemonEggDocumentV1): string => hash(egg)

/** Parse an Egg and verify every nested snapshot/blueprint self-hash server-side. */
export const parseAuthoritativePokemonEggDocumentV1 = (value: unknown, path = 'pokemonEgg'): PokemonEggDocumentV1 => {
  const egg = parsePokemonEggDocumentV1(value, path)
  for (let index = 0; index < egg.parents.length; index += 1) parseAuthoritativeBreedingParentSnapshotV1(egg.parents[index], `${path}.parents[${index}]`)
  if (egg.breeder) parseAuthoritativeBreederSnapshotV1(egg.breeder, `${path}.breeder`)
  if (egg.source.kind === 'gm' && 'provenance' in egg.source) {
    const { definitionSha256: _definitionSha256, ...definition } = egg.source.provenance
    if (hash(definition) !== egg.source.provenance.definitionSha256) {
      fail('breeding.lineage.hash-mismatch', `${path}.source.provenance.definitionSha256`, 'does not match the typed GM source provenance.')
    }
  }
  parseAuthoritativePokemonEggOffspringBlueprintV1(egg.offspring, `${path}.offspring`)
  return egg
}

/** Create a canonical parent snapshot with a complete effective-Move snapshot and both self-hashes. */
export const createBreedingParentSnapshotV1 = (
  value: Omit<BreedingParentSnapshotV1, 'effectiveMoveSnapshotDefinitionSha256' | 'definitionSha256'>,
): BreedingParentSnapshotV1 => {
  const moveSnapshotHash = hash({
    schemaVersion: 1,
    parentRef: value.pokemonSheetSlug,
    speciesId: value.speciesId,
    sourceSheetSha256: value.sourceSheetSha256,
    effectiveKnownMoves: value.effectiveKnownMoves,
  })
  const definition = { ...value, effectiveMoveSnapshotDefinitionSha256: moveSnapshotHash }
  return parseAuthoritativeBreedingParentSnapshotV1({ ...definition, definitionSha256: hash(definition) })
}
export const parseAuthoritativeBreedingParentSnapshotV1 = (value: unknown, path = 'breedingParentSnapshot'): BreedingParentSnapshotV1 => {
  const parent = parseBreedingParentSnapshotV1(value, path)
  if (hash(effectiveMoveSnapshotDefinition(parent)) !== parent.effectiveMoveSnapshotDefinitionSha256) fail('breeding.lineage.hash-mismatch', `${path}.effectiveMoveSnapshotDefinitionSha256`, 'does not match the frozen effective known Move snapshot.')
  if (hash(withoutDefinitionHash(parent)) !== parent.definitionSha256) fail('breeding.lineage.hash-mismatch', `${path}.definitionSha256`, 'does not match the parent snapshot definition.')
  return parent
}
export const createBreederSnapshotV1 = (value: BreederSnapshotDefinitionV1): BreederSnapshotV1 => (
  parseAuthoritativeBreederSnapshotV1({ ...value, definitionSha256: hash(value) })
)
export const parseAuthoritativeBreederSnapshotV1 = (value: unknown, path = 'breederSnapshot'): BreederSnapshotV1 => {
  const breeder = parseBreederSnapshotV1(value, path)
  if (breeder === null) return fail('breeding.lineage.hash-mismatch', path, 'cannot be null.')
  if (hash(withoutDefinitionHash(breeder)) !== breeder.definitionSha256) fail('breeding.lineage.hash-mismatch', `${path}.definitionSha256`, 'does not match the Breeder snapshot definition.')
  return breeder
}
export const createPokemonEggOffspringBlueprintV1 = (value: PokemonEggOffspringBlueprintDefinitionV1): PokemonEggOffspringBlueprintV1 => {
  const definition = { ...value, providerTraits: value.providerTraits ?? { serpentsMark: null, fossilRestoration: null, prehistoricBond: null } }
  return parseAuthoritativePokemonEggOffspringBlueprintV1({ ...definition, definitionSha256: hash(definition) })
}
export const parseAuthoritativePokemonEggOffspringBlueprintV1 = (value: unknown, path = 'offspringBlueprint'): PokemonEggOffspringBlueprintV1 => {
  const offspring = parsePokemonEggOffspringBlueprintV1(value, path)
  if (hash(withoutDefinitionHash(offspring)) !== offspring.definitionSha256) fail('breeding.lineage.hash-mismatch', `${path}.definitionSha256`, 'does not match the offspring blueprint definition.')
  return offspring
}
export const createBreedingInheritanceLearningRecordV1 = (
  value: BreedingInheritanceLearningRecordDefinitionV1,
): BreedingInheritanceLearningRecordV1 => parseAuthoritativeBreedingInheritanceLearningRecordV1({ ...value, definitionSha256: hash(value) })
export const parseAuthoritativeBreedingInheritanceLearningRecordV1 = (
  value: unknown,
  path = 'inheritanceLearningRecord',
): BreedingInheritanceLearningRecordV1 => {
  const learning = parseBreedingInheritanceLearningRecordV1(value, path)
  if (hash(withoutDefinitionHash(learning)) !== learning.definitionSha256) fail('breeding.lineage.hash-mismatch', `${path}.definitionSha256`, 'does not match the inheritance-learning record definition.')
  return learning
}

const lineageDefinition = (origin: PokemonBreedingOriginV1): PokemonBreedingLineageDefinitionV1 => {
  const { inheritanceLearningRecords: _records, lineageDefinitionSha256: _lineageHash, ...definition } = origin
  return definition
}
export const parseAuthoritativePokemonBreedingOriginV1 = (value: unknown, path = 'pokemonBreedingOrigin'): PokemonBreedingOriginV1 => {
  const origin = parsePokemonBreedingOriginV1(value, path)
  if (hash(lineageDefinition(origin)) !== origin.lineageDefinitionSha256) fail('breeding.lineage.hash-mismatch', `${path}.lineageDefinitionSha256`, 'does not match the immutable lineage definition.')
  for (let index = 0; index < origin.parents.length; index += 1) parseAuthoritativeBreedingParentSnapshotV1(origin.parents[index], `${path}.parents[${index}]`)
  if (origin.breeder) parseAuthoritativeBreederSnapshotV1(origin.breeder, `${path}.breeder`)
  parseAuthoritativePokemonEggOffspringBlueprintV1(origin.offspring, `${path}.offspring`)
  const candidateHashes = new Map(origin.offspring.inheritanceCandidates.map(candidate => [candidate.moveId, breedingInheritanceCandidateDefinitionSha256(candidate)]))
  const candidateSetHash = breedingInheritanceCandidateSetDefinitionSha256(origin.offspring.inheritanceCandidates)
  for (let index = 0; index < origin.inheritanceLearningRecords.length; index += 1) {
    const learning = parseAuthoritativeBreedingInheritanceLearningRecordV1(origin.inheritanceLearningRecords[index], `${path}.inheritanceLearningRecords[${index}]`)
    if (learning.recordedAtCampaignMinute < origin.hatchedAtCampaignMinute) fail('breeding.lineage.invalid-successor', `${path}.inheritanceLearningRecords[${index}].recordedAtCampaignMinute`, 'cannot predate hatching.')
    if (learning.outcome.kind === 'learned') {
      if (candidateHashes.get(learning.outcome.moveId) !== learning.outcome.candidateDefinitionSha256) fail('breeding.lineage.hash-mismatch', `${path}.inheritanceLearningRecords[${index}].outcome.candidateDefinitionSha256`, 'does not match the frozen candidate.')
    }
    else if (learning.outcome.kind === 'empty-no-candidate' && learning.outcome.candidateSetDefinitionSha256 !== candidateSetHash) {
      fail('breeding.lineage.hash-mismatch', `${path}.inheritanceLearningRecords[${index}].outcome.candidateSetDefinitionSha256`, 'does not match the frozen candidate set.')
    }
  }
  return origin
}

/** Build the exact child-retained origin from one already-planned hatched Egg revision. */
export const createPokemonBreedingOriginFromHatchedEgg = (input: {
  readonly originId: PokemonBreedingOriginId
  readonly egg: PokemonEggDocumentV1
  readonly initialInheritanceLearningRecords?: readonly BreedingInheritanceLearningRecordV1[]
}): PokemonBreedingOriginV1 => {
  const egg = parseAuthoritativePokemonEggDocumentV1(input.egg)
  if (egg.status !== 'hatched' || !egg.childSheetSlug || !egg.hatchOperationId || (egg.special.state !== 'normal' && egg.special.state !== 'resolved')) {
    return fail('breeding.lineage.egg-mismatch', 'egg.status', 'must be the planned hatched Egg revision with a child, hatch operation, and terminal special result.')
  }
  const definition: PokemonBreedingLineageDefinitionV1 = {
    schemaVersion: 1,
    originId: input.originId,
    eggId: egg.eggId,
    sourceEggRevision: egg.revision,
    sourceEggDocumentSha256: hash(egg),
    source: egg.source,
    ruleset: egg.ruleset,
    definitionHashes: egg.definitionHashes,
    parents: egg.parents,
    breeder: egg.breeder,
    offspring: egg.offspring,
    special: egg.special,
    ownerTrainerSlugAtHatch: egg.ownerTrainerSlug,
    childSheetSlug: egg.childSheetSlug,
    hatchedAtCampaignMinute: egg.updatedAtCampaignMinute,
    hatchOperationId: egg.hatchOperationId,
    settlementOperationId: egg.lastOperationId,
  }
  return parseAuthoritativePokemonBreedingOriginV1({
    ...definition,
    inheritanceLearningRecords: input.initialInheritanceLearningRecords ?? [],
    lineageDefinitionSha256: hash(definition),
  })
}

/** Verify that child lineage is an exact projection of its immutable settled Egg source. */
export const validatePokemonBreedingOriginAgainstHatchedEgg = (
  originValue: unknown,
  eggValue: unknown,
): PokemonBreedingOriginV1 => {
  const origin = parseAuthoritativePokemonBreedingOriginV1(originValue)
  const egg = parseAuthoritativePokemonEggDocumentV1(eggValue)
  if (egg.status !== 'hatched' || origin.sourceEggDocumentSha256 !== hash(egg) || origin.sourceEggRevision !== egg.revision
    || origin.eggId !== egg.eggId || origin.childSheetSlug !== egg.childSheetSlug || origin.ownerTrainerSlugAtHatch !== egg.ownerTrainerSlug
    || origin.hatchedAtCampaignMinute !== egg.updatedAtCampaignMinute || origin.hatchOperationId !== egg.hatchOperationId
    || origin.settlementOperationId !== egg.lastOperationId || !same(origin.source, egg.source) || !same(origin.ruleset, egg.ruleset)
    || !same(origin.definitionHashes, egg.definitionHashes) || !same(origin.parents, egg.parents) || !same(origin.breeder, egg.breeder)
    || !same(origin.offspring, egg.offspring) || !same(origin.special, egg.special)) {
    fail('breeding.lineage.egg-mismatch', 'pokemonBreedingOrigin', 'does not exactly match the settled source Egg.')
  }
  return origin
}

/** Append exactly the next canonical checkpoint while retaining immutable lineage facts. */
export const appendBreedingInheritanceLearningRecord = (
  originValue: unknown,
  learningValue: unknown,
): PokemonBreedingOriginV1 => {
  const origin = parseAuthoritativePokemonBreedingOriginV1(originValue)
  const learning = parseAuthoritativeBreedingInheritanceLearningRecordV1(learningValue)
  const expectedCheckpoint = BREEDING_INHERITANCE_CHECKPOINT_LEVELS[origin.inheritanceLearningRecords.length]
  if (expectedCheckpoint === undefined || learning.checkpointLevel !== expectedCheckpoint) fail('breeding.lineage.invalid-successor', 'learning.checkpointLevel', 'must be the next unrecorded canonical checkpoint.')
  if (learning.originId !== origin.originId || learning.eggId !== origin.eggId || learning.childSheetSlug !== origin.childSheetSlug) fail('breeding.lineage.invalid-successor', 'learning', 'must bind the current origin, Egg, and child sheet.')
  if (origin.inheritanceLearningRecords.some(record => record.learningRecordId === learning.learningRecordId)) fail('breeding.lineage.invalid-successor', 'learning.learningRecordId', 'must be new.')
  const priorSameOperationIndex = origin.inheritanceLearningRecords.findIndex(record => record.operationId === learning.operationId)
  if (priorSameOperationIndex >= 0 && priorSameOperationIndex !== origin.inheritanceLearningRecords.length - 1) fail('breeding.lineage.invalid-successor', 'learning.operationId', 'may extend only the immediately preceding checkpoint batch.')
  return parseAuthoritativePokemonBreedingOriginV1({
    ...origin,
    inheritanceLearningRecords: [...origin.inheritanceLearningRecords, learning],
  })
}
