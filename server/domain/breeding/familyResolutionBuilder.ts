import { createHash } from 'node:crypto'
import canonicalIdsJson from '../../../data/breeding-automation/canonical-ids.json'
import compilerDefinitionJson from '../../../data/breeding-automation/compiler-definition.json'
import evolutionTargetsJson from '../../../data/breeding-automation/evolution-target-adjudications.json'
import familyPolicyJson from '../../../data/breeding-automation/family-graph-policy.json'
import familyResolutionDefinitionJson from '../../../data/breeding-automation/family-resolution-definition.json'
import formAdjudicationsJson from '../../../data/breeding-automation/form-adjudications.json'
import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  parseBreedingFamilySpecV1,
  type BreedingFamilyEvolutionEdgeV1,
  type BreedingFamilyFormPolicyV1,
  type BreedingFamilySpecV1,
  type BreedingFormKindId,
} from '#shared/breeding/specs'
import {
  breedingFamilyIdForRoot,
  type BreedingFamilyId,
  type BreedingSpeciesId,
} from '#shared/breeding/ids'
import { BREEDING_CANONICAL_SPECIES } from './canonicalIds'
import { BREEDING_SPEC_IDENTITY_REGISTRY } from './specSchemaContext'

export type BreedingFamilyInventoryStatus =
  | 'resolved-family'
  | 'excluded-sparse-source'
  | 'excluded-unresolved-target'
  | 'excluded-form-policy'
  | 'excluded-stage-conflict'
  | 'excluded-graph-invalid'
  | 'excluded-no-family-evidence'

export interface BreedingFamilyResolutionInventoryRow {
  readonly speciesId: BreedingSpeciesId
  readonly sourceIndex: number
  readonly formKindId: BreedingFormKindId
  readonly status: BreedingFamilyInventoryStatus
  readonly familyId: BreedingFamilyId | null
  readonly familyRootSpeciesId: BreedingSpeciesId | null
  readonly reasonIds: readonly string[]
  readonly sourceEvidenceHashes: readonly string[]
}
export interface BreedingFamilyResolutionSetV1 {
  readonly schemaVersion: 1
  readonly resolutionSetId: 'ptu-1.05-breeding-family-resolutions-v1'
  readonly rulesetId: string
  readonly compilerDefinitionSha256: string
  readonly resolutionDefinitionSha256: string
  readonly definitionSha256: string
  readonly definition: {
    readonly status: 'reviewed-complete'
    readonly familySpecs: readonly BreedingFamilySpecV1[]
    readonly policies: {
      readonly missingResolution: 'fail-closed-exclude'
      readonly runtimeDerivation: 'forbidden'
      readonly nextOwnerTicket: 'BR-013'
    }
  }
}
export interface BreedingFamilyResolutionInventoryV1 {
  readonly schemaVersion: 1
  readonly inventoryId: 'ptu-1.05-breeding-family-resolution-inventory-v1'
  readonly resolutionDefinitionSha256: string
  readonly resolutionSetDefinitionSha256: string
  readonly definitionSha256: string
  readonly definition: {
    readonly rows: readonly BreedingFamilyResolutionInventoryRow[]
    readonly summary: Readonly<Record<string, number>>
  }
}
export interface BuildBreedingFamilyResolutionsResult {
  readonly resolutionSet: BreedingFamilyResolutionSetV1
  readonly inventory: BreedingFamilyResolutionInventoryV1
}

interface FormRow {
  readonly speciesId: BreedingSpeciesId
  readonly sourceIndex: number
  readonly sourceRecordSha256: string
  readonly formKindId: BreedingFormKindId
  readonly disposition: 'family-eligible' | 'not-breedable-form' | 'source-gap'
}
interface Sequence {
  readonly ownerSpeciesId: BreedingSpeciesId
  readonly entries: readonly { readonly speciesId: BreedingSpeciesId, readonly stage: number }[]
}

const POKEDEX_SHA256 = familyResolutionDefinitionJson.definition.inputs.pokedexSha256
const CANONICAL_ID_DEFINITION_SHA256 = canonicalIdsJson.definitionSha256
const FAMILY_POLICY_DEFINITION_SHA256 = familyPolicyJson.definitionSha256
const COMPILER_DEFINITION_SHA256 = compilerDefinitionJson.definitionSha256
const EVOLUTION_TARGET_DEFINITION_SHA256 = evolutionTargetsJson.definitionSha256
const FORM_ADJUDICATION_DEFINITION_SHA256 = formAdjudicationsJson.definitionSha256
const RESOLUTION_DEFINITION_SHA256 = familyResolutionDefinitionJson.definitionSha256
const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')
const hashDefinition = (value: unknown): string => sha256(stableJsonStringify(value))
const compare = (left: string, right: string): number => left === right ? 0 : left < right ? -1 : 1
const sourceIdentityById = new Map(BREEDING_CANONICAL_SPECIES.map(row => [row.id, row]))
const sourceIdentityByName = new Map(BREEDING_CANONICAL_SPECIES.map(row => [row.sourceName, row]))
const formBySpeciesId = new Map(
  (formAdjudicationsJson.definition.rows as readonly FormRow[]).map(row => [row.speciesId, row]),
)
const targetAdjudications = new Map(
  evolutionTargetsJson.definition.entries.map(row => [row.sourceValue, row]),
)

class DisjointSet {
  private readonly parent = new Map<BreedingSpeciesId, BreedingSpeciesId>()
  add(value: BreedingSpeciesId): void { if (!this.parent.has(value)) this.parent.set(value, value) }
  find(value: BreedingSpeciesId): BreedingSpeciesId {
    const parent = this.parent.get(value)
    if (!parent) { this.add(value); return value }
    if (parent === value) return value
    const root = this.find(parent)
    this.parent.set(value, root)
    return root
  }
  union(left: BreedingSpeciesId, right: BreedingSpeciesId): void {
    const leftRoot = this.find(left)
    const rightRoot = this.find(right)
    if (leftRoot === rightRoot) return
    if (leftRoot < rightRoot) this.parent.set(rightRoot, leftRoot)
    else this.parent.set(leftRoot, rightRoot)
  }
  values(): readonly BreedingSpeciesId[] { return [...this.parent.keys()] }
}

const isPlainRecord = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

export const buildBreedingFamilyResolutions = (source: unknown): BuildBreedingFamilyResolutionsResult => {
  if (!Array.isArray(source) || source.length !== BREEDING_CANONICAL_SPECIES.length) {
    throw new Error('Family resolution source must contain every canonical Pokédex row.')
  }
  if (formBySpeciesId.size !== BREEDING_CANONICAL_SPECIES.length) {
    throw new Error('Form adjudications must contain every canonical Species ID exactly once.')
  }

  const initialStatus = new Map<BreedingSpeciesId, Exclude<BreedingFamilyInventoryStatus, 'resolved-family'>>()
  const sequences: Sequence[] = []
  for (const identity of BREEDING_CANONICAL_SPECIES) {
    const raw = source[identity.sourceIndex]
    const form = formBySpeciesId.get(identity.id)
    if (!isPlainRecord(raw)
      || hashDefinition(raw) !== identity.sourceRecordSha256
      || !form
      || form.sourceIndex !== identity.sourceIndex
      || form.sourceRecordSha256 !== identity.sourceRecordSha256) {
      throw new Error('Family resolution source or form-adjudication provenance drifted.')
    }
    if (form.disposition !== 'family-eligible') {
      initialStatus.set(identity.id, 'excluded-form-policy')
      continue
    }
    if (!Array.isArray(raw.evolutions) || raw.evolutions.length < 1) {
      initialStatus.set(identity.id, 'excluded-sparse-source')
      continue
    }
    const entries: Array<{ speciesId: BreedingSpeciesId, stage: number }> = []
    let unresolved = false
    for (const rawEntry of raw.evolutions) {
      if (!isPlainRecord(rawEntry)
        || !Number.isSafeInteger(rawEntry.stage)
        || (rawEntry.stage as number) < 1
        || (rawEntry.stage as number) > 3
        || typeof rawEntry.species !== 'string') {
        unresolved = true
        break
      }
      const adjudication = targetAdjudications.get(rawEntry.species)
      const target = sourceIdentityByName.get(rawEntry.species)
        ?? (adjudication?.status === 'resolved' && adjudication.speciesId
          ? sourceIdentityById.get(adjudication.speciesId as BreedingSpeciesId)
          : undefined)
      if (!target || formBySpeciesId.get(target.id)?.disposition !== 'family-eligible') {
        unresolved = true
        break
      }
      entries.push({ speciesId: target.id, stage: rawEntry.stage as number })
    }
    const unique = [...new Map(entries.map(entry => [`${entry.stage}:${entry.speciesId}`, entry])).values()]
      .sort((left, right) => left.stage - right.stage || compare(left.speciesId, right.speciesId))
    if (unresolved) {
      initialStatus.set(identity.id, 'excluded-unresolved-target')
      continue
    }
    if (!unique.some(entry => entry.speciesId === identity.id)) {
      initialStatus.set(identity.id, 'excluded-no-family-evidence')
      continue
    }
    sequences.push(Object.freeze({ ownerSpeciesId: identity.id, entries: Object.freeze(unique) }))
  }

  const disjoint = new DisjointSet()
  const stageEvidence = new Map<BreedingSpeciesId, Set<number>>()
  const edgePairs = new Set<string>()
  for (const sequence of sequences) {
    const members = [...new Set(sequence.entries.map(entry => entry.speciesId))]
    members.forEach(member => disjoint.add(member))
    for (let index = 1; index < members.length; index += 1) disjoint.union(members[0]!, members[index]!)
    for (const entry of sequence.entries) {
      const stages = stageEvidence.get(entry.speciesId) ?? new Set<number>()
      stages.add(entry.stage)
      stageEvidence.set(entry.speciesId, stages)
    }
    const byStage = new Map<number, BreedingSpeciesId[]>()
    for (const entry of sequence.entries) {
      const values = byStage.get(entry.stage) ?? []
      values.push(entry.speciesId)
      byStage.set(entry.stage, values)
    }
    const stages = [...byStage.keys()].sort((left, right) => left - right)
    for (let index = 0; index < stages.length - 1; index += 1) {
      const fromStage = stages[index]!
      const toStage = stages[index + 1]!
      if (toStage !== fromStage + 1) continue
      const from = [...new Set(byStage.get(fromStage)!)].sort(compare)
      const to = [...new Set(byStage.get(toStage)!)].sort(compare)
      if (from.length !== 1) continue
      for (const target of to) edgePairs.add(`${from[0]}\u0000${target}`)
    }
  }

  const components = new Map<BreedingSpeciesId, BreedingSpeciesId[]>()
  for (const member of disjoint.values()) {
    const root = disjoint.find(member)
    const values = components.get(root) ?? []
    values.push(member)
    components.set(root, values)
  }

  const familySpecs: BreedingFamilySpecV1[] = []
  const resolvedBySpecies = new Map<BreedingSpeciesId, BreedingFamilySpecV1>()
  const componentFailure = new Map<BreedingSpeciesId, 'excluded-stage-conflict' | 'excluded-graph-invalid'>()
  for (const membersUnsorted of components.values()) {
    const members = [...membersUnsorted].sort(compare)
    const memberSet = new Set(members)
    if (members.some(member => (stageEvidence.get(member)?.size ?? 0) !== 1)) {
      members.forEach(member => componentFailure.set(member, 'excluded-stage-conflict'))
      continue
    }
    const stageByMember = new Map(members.map(member => [member, [...stageEvidence.get(member)!][0]!]))
    const pairs = [...edgePairs]
      .map(pair => pair.split('\u0000') as [BreedingSpeciesId, BreedingSpeciesId])
      .filter(([from, to]) => memberSet.has(from) && memberSet.has(to))
    if (pairs.some(([from, to]) => stageByMember.get(to) !== stageByMember.get(from)! + 1)) {
      members.forEach(member => componentFailure.set(member, 'excluded-stage-conflict'))
      continue
    }
    const outgoing = new Map<BreedingSpeciesId, number>()
    const incoming = new Map<BreedingSpeciesId, number>()
    for (const [from, to] of pairs) {
      outgoing.set(from, (outgoing.get(from) ?? 0) + 1)
      incoming.set(to, (incoming.get(to) ?? 0) + 1)
    }
    const roots = members.filter(member => (incoming.get(member) ?? 0) === 0)
    if (roots.length !== 1 || stageByMember.get(roots[0]!) !== 1) {
      members.forEach(member => componentFailure.set(member, 'excluded-graph-invalid'))
      continue
    }
    const familyRootSpeciesId = roots[0]!
    const reachable = new Set<BreedingSpeciesId>([familyRootSpeciesId])
    let changed = true
    while (changed) {
      changed = false
      for (const [from, to] of pairs) {
        if (reachable.has(from) && !reachable.has(to)) { reachable.add(to); changed = true }
      }
    }
    if (reachable.size !== members.length) {
      members.forEach(member => componentFailure.set(member, 'excluded-graph-invalid'))
      continue
    }
    const evolutionEdges: BreedingFamilyEvolutionEdgeV1[] = pairs
      .map(([fromSpeciesId, toSpeciesId]) => Object.freeze({
        fromSpeciesId,
        toSpeciesId,
        kind: (outgoing.get(fromSpeciesId) ?? 0) > 1 ? 'branch-evolves-to' as const : 'evolves-to' as const,
      }))
      .sort((left, right) => compare(
        `${left.fromSpeciesId}\u0000${left.toSpeciesId}\u0000${left.kind}`,
        `${right.fromSpeciesId}\u0000${right.toSpeciesId}\u0000${right.kind}`,
      ))
    const formPolicies: BreedingFamilyFormPolicyV1[] = members.map(speciesId => Object.freeze({
      speciesId,
      formKindId: formBySpeciesId.get(speciesId)!.formKindId,
      formPolicyId: speciesId === familyRootSpeciesId ? 'own-form-root' as const : 'base-family-root' as const,
    }))
    const sourceHashes = Object.freeze([
      POKEDEX_SHA256,
      COMPILER_DEFINITION_SHA256,
      CANONICAL_ID_DEFINITION_SHA256,
      FAMILY_POLICY_DEFINITION_SHA256,
      EVOLUTION_TARGET_DEFINITION_SHA256,
      FORM_ADJUDICATION_DEFINITION_SHA256,
      RESOLUTION_DEFINITION_SHA256,
    ].sort(compare))
    const definition = Object.freeze({
      schemaVersion: 1 as const,
      familyId: breedingFamilyIdForRoot(familyRootSpeciesId),
      familyRootSpeciesId,
      offspringRootSpeciesId: familyRootSpeciesId,
      memberSpeciesIds: Object.freeze(members),
      evolutionEdges: Object.freeze(evolutionEdges),
      formPolicies: Object.freeze(formPolicies),
      sourceHashes,
    })
    const family = parseBreedingFamilySpecV1(
      { ...definition, definitionSha256: hashDefinition(definition) },
      BREEDING_SPEC_IDENTITY_REGISTRY,
    )
    familySpecs.push(family)
    members.forEach(member => resolvedBySpecies.set(member, family))
  }
  familySpecs.sort((left, right) => compare(left.familyId, right.familyId))

  const resolutionDefinition = Object.freeze({
    status: 'reviewed-complete' as const,
    familySpecs: Object.freeze(familySpecs),
    policies: Object.freeze({
      missingResolution: 'fail-closed-exclude' as const,
      runtimeDerivation: 'forbidden' as const,
      nextOwnerTicket: 'BR-013' as const,
    }),
  })
  const resolutionSet: BreedingFamilyResolutionSetV1 = Object.freeze({
    schemaVersion: 1,
    resolutionSetId: 'ptu-1.05-breeding-family-resolutions-v1',
    rulesetId: compilerDefinitionJson.rulesetId,
    compilerDefinitionSha256: COMPILER_DEFINITION_SHA256,
    resolutionDefinitionSha256: RESOLUTION_DEFINITION_SHA256,
    definitionSha256: hashDefinition(resolutionDefinition),
    definition: resolutionDefinition,
  })

  const rows: BreedingFamilyResolutionInventoryRow[] = BREEDING_CANONICAL_SPECIES.map(identity => {
    const form = formBySpeciesId.get(identity.id)!
    const family = resolvedBySpecies.get(identity.id)
    const status: BreedingFamilyInventoryStatus = family
      ? 'resolved-family'
      : componentFailure.get(identity.id) ?? initialStatus.get(identity.id) ?? 'excluded-no-family-evidence'
    const reasonIds = status === 'resolved-family' ? [] : [status]
    return Object.freeze({
      speciesId: identity.id,
      sourceIndex: identity.sourceIndex,
      formKindId: form.formKindId,
      status,
      familyId: family?.familyId ?? null,
      familyRootSpeciesId: family?.familyRootSpeciesId ?? null,
      reasonIds: Object.freeze(reasonIds),
      sourceEvidenceHashes: Object.freeze([
        identity.sourceRecordSha256,
        EVOLUTION_TARGET_DEFINITION_SHA256,
        FORM_ADJUDICATION_DEFINITION_SHA256,
        RESOLUTION_DEFINITION_SHA256,
      ].sort(compare)),
    })
  }).sort((left, right) => compare(left.speciesId, right.speciesId))
  const statusCounts = Object.fromEntries(
    familyResolutionDefinitionJson.definition.inventoryStatuses.map(status => [status, rows.filter(row => row.status === status).length]),
  )
  const summary = Object.freeze({
    speciesCount: rows.length,
    resolvedSpeciesCount: rows.filter(row => row.status === 'resolved-family').length,
    excludedSpeciesCount: rows.filter(row => row.status !== 'resolved-family').length,
    familyCount: familySpecs.length,
    branchFamilyCount: familySpecs.filter(family => family.evolutionEdges.some(edge => edge.kind === 'branch-evolves-to')).length,
    regionalFormMemberCount: rows.filter(row => row.status === 'resolved-family' && row.formKindId === 'regional-form').length,
    sexFormMemberCount: rows.filter(row => row.status === 'resolved-family' && row.formKindId === 'sex-form').length,
    sizeFormMemberCount: rows.filter(row => row.status === 'resolved-family' && row.formKindId === 'size-form').length,
    maximumFamilySize: Math.max(0, ...familySpecs.map(family => family.memberSpeciesIds.length)),
    ...statusCounts,
  })
  const inventoryDefinition = Object.freeze({ rows: Object.freeze(rows), summary })
  const inventory: BreedingFamilyResolutionInventoryV1 = Object.freeze({
    schemaVersion: 1,
    inventoryId: 'ptu-1.05-breeding-family-resolution-inventory-v1',
    resolutionDefinitionSha256: RESOLUTION_DEFINITION_SHA256,
    resolutionSetDefinitionSha256: resolutionSet.definitionSha256,
    definitionSha256: hashDefinition(inventoryDefinition),
    definition: inventoryDefinition,
  })
  return Object.freeze({ resolutionSet, inventory })
}
