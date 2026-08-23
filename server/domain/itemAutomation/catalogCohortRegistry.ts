import { createHash } from 'node:crypto'
import itemsJson from '~~/data/reference/items.json'
import cohortRegistryJson from '~~/data/complete-play-loop/item-catalog-cohorts.v1.json'
import equipmentGrantJson from '~~/data/complete-play-loop/equipment-grants.v1.json'
import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  parseItemCatalogCohortRegistryV1,
  type ItemCatalogCohortMemberV1,
  type ItemCatalogCohortRegistryV1,
  type ItemCatalogCohortV1,
} from '#shared/itemAutomation/catalogCohorts'
import { equipmentGrantDefinitionFor } from './equipmentGrantRegistry'

export interface CanonicalItemCatalogCohortDecision {
  readonly cohort: ItemCatalogCohortV1
  readonly member: ItemCatalogCohortMemberV1
}

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')
const recordSha256 = (value: unknown): string => sha256(stableJsonStringify(value))
const rawFileSha256 = (value: unknown): string => sha256(`${JSON.stringify(value, null, 2)}\n`)
const effectSha256 = (value: unknown): string => sha256(
  Array.isArray(value) && value.every(entry => typeof entry === 'string')
    ? value.join('\n')
    : '',
)

const buildRegistry = (): {
  readonly document: ItemCatalogCohortRegistryV1
  readonly decisions: ReadonlyMap<string, CanonicalItemCatalogCohortDecision>
} => {
  const document = parseItemCatalogCohortRegistryV1(cohortRegistryJson)
  if (recordSha256(document.cohorts) !== document.registrySha256) {
    throw new Error('Canonical item cohort registry failed its complete cohort fingerprint.')
  }
  if (document.equipmentGrantsSha256 !== rawFileSha256(equipmentGrantJson)) {
    throw new Error('Canonical item cohort registry is stale against equipment action final states.')
  }
  const canonical = itemsJson as Record<string, {
    readonly name?: unknown
    readonly effects?: unknown
  }>
  if (Object.keys(canonical).length !== document.itemCount) {
    throw new Error('Canonical item cohort registry no longer covers the complete item catalog.')
  }
  const decisions = new Map<string, CanonicalItemCatalogCohortDecision>()
  for (const cohort of document.cohorts) {
    for (const member of cohort.members) {
      const item = canonical[member.canonicalId]
      if (!item || item.name !== member.canonicalId) {
        throw new Error(`Canonical item cohort ${cohort.cohortId} lost ${member.canonicalId}.`)
      }
      const expectedActionFinalStates = (equipmentGrantDefinitionFor(member.canonicalId)?.grants ?? [])
        .flatMap(grant => grant.kind === 'action'
          ? [{ actionId: grant.actionId, finalState: grant.finalState }]
          : [])
      if (recordSha256(item) !== member.recordSha256
        || effectSha256(item.effects) !== member.effectSha256
        || stableJsonStringify(member.actionFinalStates) !== stableJsonStringify(expectedActionFinalStates)) {
        throw new Error(`Canonical item cohort ${cohort.cohortId} drifted for ${member.canonicalId}.`)
      }
      if (decisions.has(member.canonicalId)) {
        throw new Error(`Canonical item cohort registry assigned ${member.canonicalId} more than once.`)
      }
      decisions.set(member.canonicalId, Object.freeze({ cohort, member }))
    }
  }
  for (const canonicalId of Object.keys(canonical)) {
    if (!decisions.has(canonicalId)) {
      throw new Error(`Canonical item cohort registry did not assign ${canonicalId}.`)
    }
  }
  return Object.freeze({ document, decisions })
}

const registry = buildRegistry()

/**
 * Reviewed catalog coverage only. A cohort decision never grants mechanics;
 * owning ItemSpec, equipment, exploration, breeding, capture, or guided
 * providers must independently reauthorize every runtime action.
 */
export const canonicalItemCatalogCohortRegistry = registry.document

export const canonicalItemCatalogCohortDecision = (
  canonicalId: string,
): CanonicalItemCatalogCohortDecision | null => registry.decisions.get(canonicalId) ?? null

export const requireCanonicalItemCatalogCohortDecision = (
  canonicalId: string,
): CanonicalItemCatalogCohortDecision => {
  const decision = canonicalItemCatalogCohortDecision(canonicalId)
  if (!decision) throw new Error(`Canonical item ${canonicalId} has no reviewed cohort decision.`)
  return decision
}

export const listCanonicalItemCatalogCohortDecisions = (): readonly CanonicalItemCatalogCohortDecision[] => (
  Object.freeze(canonicalItemCatalogCohortRegistry.cohorts.flatMap(cohort => (
    cohort.members.map(member => registry.decisions.get(member.canonicalId)!)
  )))
)
