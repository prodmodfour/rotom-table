import { createHash } from 'node:crypto'
import modifierInventoryJson from '../../../data/breeding-automation/modifier-inventory.json'
import abilitiesJson from '../../../data/reference/abilities.json'
import capabilitiesJson from '../../../data/reference/capabilities.json'
import itemsJson from '../../../data/reference/items.json'
import rulesJson from '../../../data/reference/rules.json'
import { stableJsonStringify } from '#shared/automation/stableJson'
import { cloneStrictJson, type StrictJsonObject } from '#shared/automation/strictJson'
import { abilityInstanceParameterValues } from '#shared/abilityAutomation/parameters'
import type { EffectiveCapabilitySet } from '#shared/capabilityAutomation/effective'
import {
  BREEDING_MODIFIER_PROVIDER_POLICIES,
  BREEDING_SERPENTS_MARK_PATTERN_IDS,
  parseBreedingModifierProviderEvidenceV1,
  parseBreedingModifierProviderHandoffV1,
  type BreedingModifierProviderEvidenceV1,
  type BreedingModifierProviderHandoffV1,
  type BreedingSerpentsMarkPatternId,
} from '#shared/breeding/modifierProviderHandoff'
import { parsePokemonEggDocumentV1 } from '#shared/breeding/egg'
import { parseBreedingDependencyEvidenceV1, type BreedingDependencyEvidenceV1 } from '#shared/breeding/readSets'
import type { CharacterSheet } from '~/types/characterSheet'
import type { InventoryEntry, TrainerSheet } from '~/types/trainerSheet'
import { projectAuthoritativeEffectiveAbilities } from '../abilityAutomation/effectiveAbilities'
import { resolveSheetAbilityInstances } from '../abilityAutomation/instanceParameters'
import {
  createBreedingProviderContributionSnapshotV1,
  createBreedingProviderSnapshotV1,
  parseAuthoritativeBreedingProviderContributionSnapshotV1,
} from './productionSnapshots'

export const BREEDING_MODIFIER_PROVIDER_HANDOFF_POLICY_ID = 'breeding-modifier-provider-handoff-v1' as const
export const BREEDING_MODIFIER_PROVIDER_INVENTORY_DEFINITION_SHA256 = '24bb20a9d61003f540f6b410df3b0919ee49233012e45ec2dd14bfc9ed5c2dd9' as const
export const BREEDING_EGG_WARMER_ITEM_PROVIDER_ID = 'item.egg-warmer' as const
export const BREEDING_EGG_WARMER_CAPABILITY_PROVIDER_ID = 'capability.egg-warmer' as const
export const BREEDING_SERPENTS_MARK_PROVIDER_ID = 'ability.serpents-mark' as const
export const BREEDING_PARENTAL_BOND_PROVIDER_ID = 'ability.parental-bond' as const
export const BREEDING_MARSUPIAL_PROVIDER_ID = 'capability.marsupial' as const
export const BREEDING_CHEMISTRY_SET_PROVIDER_ID = 'item.chemistry-set' as const
export const BREEDING_REANIMATION_MACHINE_PROVIDER_ID = 'item.reanimation-machine' as const
export const BREEDING_LOYALTY_RULE_PROVIDER_ID = 'rule.loyalty' as const
export const BREEDING_TUTOR_POINTS_RULE_PROVIDER_ID = 'rule.tutor-points' as const

export type BreedingModifierProviderHandoffAuthorityErrorCode =
  | 'breeding.modifier-provider-handoff.invalid-request'
  | 'breeding.modifier-provider-handoff.hash-mismatch'
  | 'breeding.modifier-provider-handoff.contract-drift'
  | 'breeding.modifier-provider-handoff.provider-ambiguous'
  | 'breeding.modifier-provider-handoff.provider-failure'
  | 'breeding.modifier-provider-handoff.provider-unavailable'
  | 'breeding.modifier-provider-handoff.stale-authority'

export class BreedingModifierProviderHandoffAuthorityError extends Error {
  readonly code: BreedingModifierProviderHandoffAuthorityErrorCode
  constructor(code: BreedingModifierProviderHandoffAuthorityErrorCode, message: string) {
    super(message)
    this.name = 'BreedingModifierProviderHandoffAuthorityError'
    this.code = code
  }
}

interface StoredSheetInput {
  readonly slug: unknown
  readonly revision: unknown
  readonly document: unknown
}
interface InventoryDefinition {
  readonly id: string
  readonly sourceKind: string
  readonly canonicalId: string
  readonly recordSha256: string
  readonly mechanicFieldsSha256: string
  readonly contributionIds: readonly string[]
  readonly snapshotCheckpoint: string
  readonly authorityOwner: string
  readonly clientAuthority: string
}
const inventory = modifierInventoryJson as unknown as {
  readonly definitionSha256: string
  readonly definition: { readonly entries: readonly InventoryDefinition[] }
}
const inventoryById = new Map(inventory.definition.entries.map(entry => [entry.id, entry]))
const SHA256 = /^[0-9a-f]{64}$/u
const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u
const compare = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0
const sha256 = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex')
export const BREEDING_MODIFIER_PROVIDER_HANDOFF_POLICY_DEFINITION = Object.freeze({
  schemaVersion: 1 as const,
  policyId: BREEDING_MODIFIER_PROVIDER_HANDOFF_POLICY_ID,
  inventoryDefinitionSha256: BREEDING_MODIFIER_PROVIDER_INVENTORY_DEFINITION_SHA256,
  providerPolicies: BREEDING_MODIFIER_PROVIDER_POLICIES,
  canonicalSources: Object.freeze(['data/reference/abilities.json','data/reference/capabilities.json','data/reference/items.json','data/reference/rules.json'] as const),
  storedSheetAuthority: 'exact-storage-slug-revision-and-document' as const,
  effectiveAuthority: 'current-effective-unsuppressed-unambiguous-synchronous-provider' as const,
  itemAuthority: 'exact-owner-inventory-row-quantity-backed-unit-custody' as const,
  randomness: 'persisted-command-and-target-bound-rolls-only' as const,
  clientAuthority: 'none' as const,
  downstreamReservations: Object.freeze({ fossil: 'BR-065' as const, babyTemplate: 'BR-067' as const, postHatchLearning: 'BR-068' as const }),
})
export const BREEDING_MODIFIER_PROVIDER_HANDOFF_POLICY_DEFINITION_SHA256 = sha256(BREEDING_MODIFIER_PROVIDER_HANDOFF_POLICY_DEFINITION)
const fail = (code: BreedingModifierProviderHandoffAuthorityErrorCode, message: string): never => {
  throw new BreedingModifierProviderHandoffAuthorityError(code, message)
}
const promiseLike = (value: unknown): value is PromiseLike<unknown> => (
  (typeof value === 'object' || typeof value === 'function') && value !== null
  && typeof (value as { readonly then?: unknown }).then === 'function'
)
const exact = (value: unknown, fields: readonly string[], label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    || Object.getOwnPropertySymbols(value).length > 0) {
    return fail('breeding.modifier-provider-handoff.invalid-request', `${label} must be a plain data object.`)
  }
  const row = value as Record<string, unknown>
  const allowed = new Set(fields)
  if (fields.some(field => !Object.hasOwn(row, field))
    || Object.getOwnPropertyNames(row).some(field => !allowed.has(field))) {
    return fail('breeding.modifier-provider-handoff.invalid-request', `${label} must contain exactly the declared fields.`)
  }
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(row, field)
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      fail('breeding.modifier-provider-handoff.invalid-request', `${label}.${field} must be an enumerable data field.`)
    }
  }
  return row
}
const strictArray = (value: unknown, maximum: number, label: string): readonly unknown[] => {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
    || value.length > maximum || Object.getOwnPropertySymbols(value).length > 0
    || Object.getOwnPropertyNames(value).length !== value.length + 1) {
    return fail('breeding.modifier-provider-handoff.invalid-request', `${label} must be one strict array of at most ${maximum} entries.`)
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      fail('breeding.modifier-provider-handoff.invalid-request', `${label}[${index}] must be an enumerable data entry.`)
    }
  }
  return value
}
const strictDocument = (value: unknown, label: string): StrictJsonObject => {
  const cloned = cloneStrictJson(value, label, {
    limits: { depth: 24, nodes: 200_000, objectFields: 10_000, arrayEntries: 10_000, stringLength: 100_000, objectKeyLength: 240 },
    rootLabel: label, valueLabel: label,
    failNotJson: (_path, detail) => fail('breeding.modifier-provider-handoff.invalid-request', `${label} ${detail}`),
    failLimit: (_path, detail) => fail('breeding.modifier-provider-handoff.invalid-request', detail),
  })
  if (!cloned || typeof cloned !== 'object' || Array.isArray(cloned)) return fail('breeding.modifier-provider-handoff.invalid-request', `${label} must be one strict JSON object.`)
  return cloned as StrictJsonObject
}
const storedSheet = (value: unknown, label: string): { readonly slug: string, readonly revision: number, readonly document: StrictJsonObject } => {
  const row = exact(value, ['slug','revision','document'], label)
  if (typeof row.slug !== 'string' || !STABLE_ID.test(row.slug) || !Number.isSafeInteger(row.revision)
    || (row.revision as number) < 0 || (row.revision as number) > 2_147_483_647) {
    return fail('breeding.modifier-provider-handoff.invalid-request', `${label} identity and revision must be bounded stable values.`)
  }
  const document = strictDocument(row.document, `${label}.document`)
  if (document.slug !== row.slug || (document.revision !== undefined && document.revision !== row.revision)) {
    return fail('breeding.modifier-provider-handoff.stale-authority', `${label} document identity or embedded revision disagrees with storage authority.`)
  }
  return Object.freeze({ slug: row.slug, revision: row.revision as number, document })
}
const minute = (value: unknown): number => Number.isSafeInteger(value) && (value as number) >= 0
  ? value as number
  : fail('breeding.modifier-provider-handoff.invalid-request', 'Campaign minute must be a nonnegative safe integer.')
const mechanicFields = (record: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(
  ['prerequisites','frequency','trigger','target','condition','effect','effects','text'].filter(field => Object.hasOwn(record, field)).map(field => [field, record[field]]),
)
const sourceRecord = (entry: InventoryDefinition): Record<string, unknown> | null => {
  const source = entry.sourceKind === 'ability' ? abilitiesJson
    : entry.sourceKind === 'capability' ? capabilitiesJson
      : entry.sourceKind === 'item' ? itemsJson
        : entry.sourceKind === 'rule' ? rulesJson : null
  return source ? (source as Readonly<Record<string, Record<string, unknown>>>)[entry.canonicalId] ?? null : null
}
const validateBoundary = (entryId: string): InventoryDefinition => {
  if (inventory.definitionSha256 !== BREEDING_MODIFIER_PROVIDER_INVENTORY_DEFINITION_SHA256) {
    return fail('breeding.modifier-provider-handoff.contract-drift', 'Breeding modifier inventory definition drifted.')
  }
  const policy = BREEDING_MODIFIER_PROVIDER_POLICIES.find(candidate => candidate.inventoryEntryId === entryId)
  const entry = inventoryById.get(entryId)
  const record = entry ? sourceRecord(entry) : null
  if (!policy || !entry || !record || entry.id !== entryId
    || entry.recordSha256 !== sha256(record) || entry.mechanicFieldsSha256 !== sha256(mechanicFields(record))
    || stableJsonStringify(entry.contributionIds) !== stableJsonStringify(policy.contributionIds)
    || entry.snapshotCheckpoint !== policy.checkpoint || entry.clientAuthority !== 'none') {
    return fail('breeding.modifier-provider-handoff.contract-drift', `${entryId} drifted from canonical reference or modifier inventory authority.`)
  }
  return entry
}
const authoritativeEvidence = (value: unknown, label: string): BreedingModifierProviderEvidenceV1 => {
  const parsed = parseBreedingModifierProviderEvidenceV1(value, label)
  const { definitionSha256: _definitionSha256, ...definition } = parsed
  if (parsed.definitionSha256 !== sha256(definition)) return fail('breeding.modifier-provider-handoff.hash-mismatch', `${label} definition hash is not authoritative.`)
  parseAuthoritativeBreedingProviderContributionSnapshotV1(parsed.contribution, `${label}.contribution`)
  return parsed
}
export const parseAuthoritativeBreedingModifierProviderHandoffV1 = (value: unknown, path = 'modifierProviderHandoff'): BreedingModifierProviderHandoffV1 => {
  const parsed = parseBreedingModifierProviderHandoffV1(value, path)
  parsed.evidence.forEach((entry, index) => authoritativeEvidence(entry, `${path}.evidence[${index}]`))
  const { definitionSha256: _definitionSha256, ...definition } = parsed
  if (parsed.definitionSha256 !== sha256(definition)) return fail('breeding.modifier-provider-handoff.hash-mismatch', `${path} definition hash is not authoritative.`)
  return parsed
}
const handoff = (input: {
  readonly checkpoint: BreedingDependencyEvidenceV1['checkpoint']
  readonly capturedAtCampaignMinute: number
  readonly evidence: readonly BreedingModifierProviderEvidenceV1[]
}): BreedingModifierProviderHandoffV1 => {
  const evidence = [...input.evidence].sort((left, right) => {
    const a = left.contribution; const b = right.contribution
    return compare(`${a.providerKind}\u0000${a.providerId}\u0000${a.subjectKind}\u0000${a.subjectId}\u0000${a.contributionId}`, `${b.providerKind}\u0000${b.providerId}\u0000${b.subjectKind}\u0000${b.subjectId}\u0000${b.contributionId}`)
  })
  const dependencies: BreedingDependencyEvidenceV1[] = []
  for (const contribution of evidence.map(entry => entry.contribution)) {
    if (dependencies.some(candidate => candidate.providerKind === contribution.providerKind && candidate.providerId === contribution.providerId
      && candidate.subjectKind === contribution.subjectKind && candidate.subjectId === contribution.subjectId)) continue
    dependencies.push(parseBreedingDependencyEvidenceV1({
      providerKind: contribution.providerKind,
      providerId: contribution.providerId,
      subjectKind: contribution.subjectKind,
      subjectId: contribution.subjectId,
      subjectRevision: contribution.subjectRevision,
      checkpoint: contribution.checkpoint,
      providerDefinitionSha256: contribution.providerDefinitionSha256,
      effectiveEvidenceSha256: contribution.effectiveEvidenceSha256,
    }))
  }
  dependencies.sort((left, right) => compare(`${left.providerKind}\u0000${left.providerId}\u0000${left.subjectKind}\u0000${left.subjectId}`, `${right.providerKind}\u0000${right.providerId}\u0000${right.subjectKind}\u0000${right.subjectId}`))
  const definition = Object.freeze({ schemaVersion: 1 as const, checkpoint: input.checkpoint, capturedAtCampaignMinute: input.capturedAtCampaignMinute, evidence: Object.freeze(evidence), dependencyEvidence: Object.freeze(dependencies) })
  return parseAuthoritativeBreedingModifierProviderHandoffV1({ ...definition, definitionSha256: sha256(definition) })
}
const evidence = (input: {
  readonly inventoryEntryId: string
  readonly contributionId: string
  readonly providerKind: 'ability' | 'capability' | 'item' | 'system'
  readonly providerId: string
  readonly subjectKind: 'campaign' | 'pokemon-egg' | 'pokemon-sheet' | 'trainer-sheet'
  readonly subjectId: string
  readonly subjectRevision: number | null
  readonly checkpoint: BreedingDependencyEvidenceV1['checkpoint']
  readonly value: Parameters<typeof createBreedingProviderContributionSnapshotV1>[0]['value']
  readonly providerDefinitionSha256: string
  readonly effectiveEvidenceSha256: string
}): BreedingModifierProviderEvidenceV1 => {
  const contribution = createBreedingProviderContributionSnapshotV1(input)
  const policy = BREEDING_MODIFIER_PROVIDER_POLICIES.find(candidate => candidate.inventoryEntryId === input.inventoryEntryId)!
  const definition = Object.freeze({ schemaVersion: 1 as const, disposition: policy.disposition, contribution })
  return authoritativeEvidence({ ...definition, definitionSha256: sha256(definition) }, 'modifierProviderEvidence')
}
const normalized = (value: string): string => value.normalize('NFKD').replace(/[\u0300-\u036f]/gu, '').replace(/[’‘]/gu, "'").trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-US')

export const createBreedingProviderSnapshotFromModifierHandoffV1 = (inputValue: unknown) => {
  const handoff = parseAuthoritativeBreedingModifierProviderHandoffV1(inputValue)
  if (handoff.checkpoint !== 'egg-acceptance' || handoff.evidence.some(entry => entry.disposition !== 'active-br-062')) {
    return fail('breeding.modifier-provider-handoff.provider-unavailable', 'Only active Egg-acceptance modifier evidence may enter a production snapshot.')
  }
  return createBreedingProviderSnapshotV1({ checkpoint: 'egg-acceptance', capturedAtCampaignMinute: handoff.capturedAtCampaignMinute, contributions: handoff.evidence.map(entry => entry.contribution) })
}

export const createBreedingSerpentsMarkHandoffV1 = (inputValue: {
  readonly parentSheets: readonly StoredSheetInput[]
  readonly capturedAtCampaignMinute: unknown
}): BreedingModifierProviderHandoffV1 => {
  const input = exact(inputValue, ['parentSheets','capturedAtCampaignMinute'], 'serpentsMarkHandoffInput')
  const parentRows = strictArray(input.parentSheets, 2, 'serpentsMarkHandoffInput.parentSheets')
  if (parentRows.length !== 2) return fail('breeding.modifier-provider-handoff.invalid-request', 'Serpent’s Mark resolution requires exactly two ordered current parent sheets.')
  const captured = minute(input.capturedAtCampaignMinute)
  const entry = validateBoundary('ability:Serpent’s Mark')
  const result: BreedingModifierProviderEvidenceV1[] = []
  for (let index = 0; index < parentRows.length; index += 1) {
    const parent = storedSheet(parentRows[index], `serpentsMarkHandoffInput.parentSheets[${index}]`)
    const sheet = parent.document as unknown as CharacterSheet
    const abilityRows = Array.isArray(sheet.abilities) ? sheet.abilities : []
    if (abilityRows.some(row => typeof row?.name === 'string' && normalized(row.name) === normalized('Serpent’s Mark') && row.name !== 'Serpent’s Mark')) {
      return fail('breeding.modifier-provider-handoff.provider-ambiguous', `Parent ${parent.slug} has a malformed relevant Ability identity.`)
    }
    let projection: ReturnType<typeof projectAuthoritativeEffectiveAbilities>
    try {
      projection = projectAuthoritativeEffectiveAbilities({
        baseAbilities: resolveSheetAbilityInstances(abilityRows),
        target: { placementId: `breeding-parent:${parent.slug}` },
        species: typeof sheet.species === 'string' ? sheet.species : null,
        effects: [],
      })
    }
    catch {
      return fail('breeding.modifier-provider-handoff.provider-failure', `Effective Ability resolution failed for parent ${parent.slug}.`)
    }
    const candidates = projection.filter(candidate => candidate.canonicalId === 'Serpent’s Mark')
    if (candidates.length === 0 || sheet.species !== 'Arbok') continue
    if (candidates.length !== 1 || !candidates[0]!.effective || candidates[0]!.parameterStatus !== 'ready' || !candidates[0]!.parameterData) {
      return fail('breeding.modifier-provider-handoff.provider-ambiguous', `Parent ${parent.slug} must have exactly one effective parameter-ready Serpent’s Mark instance.`)
    }
    const patternValues = abilityInstanceParameterValues(candidates[0]!.parameterData!, 'pattern')
    const pattern = patternValues.length === 1 ? patternValues[0] : null
    if (!pattern || !BREEDING_SERPENTS_MARK_PATTERN_IDS.includes(pattern as BreedingSerpentsMarkPatternId)) {
      return fail('breeding.modifier-provider-handoff.provider-unavailable', `Parent ${parent.slug} has no reviewed Serpent’s Mark pattern authority.`)
    }
    const effectiveEvidenceSha256 = sha256({
      schemaVersion: 1,
      parentIndex: index,
      parentSheetSlug: parent.slug,
      parentSheetRevision: parent.revision,
      parentSheetDefinitionSha256: sha256(parent.document),
      effectiveAbilities: projection,
      selectedInstanceId: candidates[0]!.instanceId,
      pattern,
      capturedAtCampaignMinute: captured,
    })
    result.push(evidence({
      inventoryEntryId: entry.id,
      contributionId: 'arbok-pattern-inheritance',
      providerKind: 'ability',
      providerId: BREEDING_SERPENTS_MARK_PROVIDER_ID,
      subjectKind: 'pokemon-sheet',
      subjectId: parent.slug,
      subjectRevision: parent.revision,
      checkpoint: 'egg-acceptance',
      value: { kind: 'canonical-id-set', values: [pattern] },
      providerDefinitionSha256: entry.recordSha256,
      effectiveEvidenceSha256,
    }))
  }
  return handoff({ checkpoint: 'egg-acceptance', capturedAtCampaignMinute: captured, evidence: result })
}

const inventoryEntries = (sheet: TrainerSheet): readonly InventoryEntry[] => Object.values(sheet.inventory ?? {}).flatMap(value => Array.isArray(value) ? value : [])
export const createBreedingEggWarmerItemHandoffV1 = (inputValue: {
  readonly egg: unknown
  readonly ownerTrainerSheet: StoredSheetInput
  readonly custody: unknown
  readonly capturedAtCampaignMinute: unknown
}): BreedingModifierProviderHandoffV1 => {
  const input = exact(inputValue, ['egg','ownerTrainerSheet','custody','capturedAtCampaignMinute'], 'eggWarmerItemHandoffInput')
  const egg = parsePokemonEggDocumentV1(input.egg)
  const trainer = storedSheet(input.ownerTrainerSheet, 'eggWarmerItemHandoffInput.ownerTrainerSheet')
  const custody = exact(input.custody, ['inventoryEntryId','unitOrdinal','assignedEggIds'], 'eggWarmerItemHandoffInput.custody')
  const assigned = strictArray(custody.assignedEggIds, 4, 'eggWarmerItemHandoffInput.custody.assignedEggIds')
  if (trainer.slug !== egg.ownerTrainerSlug || typeof custody.inventoryEntryId !== 'string' || !STABLE_ID.test(custody.inventoryEntryId)
    || !Number.isSafeInteger(custody.unitOrdinal) || (custody.unitOrdinal as number) < 0
    || assigned.length < 1 || assigned.some(value => typeof value !== 'string')
    || new Set(assigned).size !== assigned.length || !assigned.includes(egg.eggId)) {
    return fail('breeding.modifier-provider-handoff.stale-authority', 'Egg Warmer custody must bind this exact owner, one stable inventory row/unit, and one through four unique assigned Eggs including the target.')
  }
  const assignedEggIds = assigned as readonly string[]
  const matches = inventoryEntries(trainer.document as unknown as TrainerSheet).filter(row => row.id === custody.inventoryEntryId)
  const row = matches.length === 1 ? matches[0]! : null
  const quantity = row && Number.isSafeInteger(row.qty ?? 1) ? Number(row.qty ?? 1) : 0
  if (!row || row.name !== 'Egg Warmer' || quantity < 1 || (custody.unitOrdinal as number) >= quantity) {
    return fail('breeding.modifier-provider-handoff.provider-unavailable', 'Current exact Egg Warmer item custody is unavailable or ambiguous.')
  }
  const captured = minute(input.capturedAtCampaignMinute)
  const entry = validateBoundary('item:Egg Warmer')
  const effectiveEvidenceSha256 = sha256({
    schemaVersion: 1,
    trainerSheetSlug: trainer.slug,
    trainerSheetRevision: trainer.revision,
    trainerSheetDefinitionSha256: sha256(trainer.document),
    inventoryEntryId: custody.inventoryEntryId,
    unitOrdinal: custody.unitOrdinal,
    assignedEggIds: [...assignedEggIds].sort(compare),
    targetEggId: egg.eggId,
    targetEggRevision: egg.revision,
    capturedAtCampaignMinute: captured,
  })
  return handoff({ checkpoint: 'campaign-clock-segment', capturedAtCampaignMinute: captured, evidence: [
    evidence({ inventoryEntryId: entry.id, contributionId: 'egg-capacity-4', providerKind: 'item', providerId: BREEDING_EGG_WARMER_ITEM_PROVIDER_ID,
      subjectKind: 'trainer-sheet', subjectId: trainer.slug, subjectRevision: trainer.revision, checkpoint: 'campaign-clock-segment',
      value: { kind: 'integer', value: 4 }, providerDefinitionSha256: entry.recordSha256, effectiveEvidenceSha256 }),
    evidence({ inventoryEntryId: entry.id, contributionId: 'incubation-rate-times-2', providerKind: 'item', providerId: BREEDING_EGG_WARMER_ITEM_PROVIDER_ID,
      subjectKind: 'trainer-sheet', subjectId: trainer.slug, subjectRevision: trainer.revision, checkpoint: 'campaign-clock-segment',
      value: { kind: 'ratio', numerator: 2, denominator: 1 }, providerDefinitionSha256: entry.recordSha256, effectiveEvidenceSha256 }),
  ] })
}

export const createBreedingEggWarmerCapabilityHandoffV1 = (inputValue: {
  readonly egg: unknown
  readonly sourcePokemonSheet: StoredSheetInput
  readonly capturedAtCampaignMinute: unknown
  readonly resourceEvidenceDefinitionSha256: unknown
}, dependencies: {
  readonly resolveEffectiveCapabilities: (input: { readonly sourcePokemonSheetSlug: string, readonly sourcePokemonSheet: CharacterSheet }) => EffectiveCapabilitySet
}): BreedingModifierProviderHandoffV1 => {
  const input = exact(inputValue, ['egg','sourcePokemonSheet','capturedAtCampaignMinute','resourceEvidenceDefinitionSha256'], 'eggWarmerCapabilityHandoffInput')
  const egg = parsePokemonEggDocumentV1(input.egg)
  const source = storedSheet(input.sourcePokemonSheet, 'eggWarmerCapabilityHandoffInput.sourcePokemonSheet')
  const captured = minute(input.capturedAtCampaignMinute)
  if (typeof input.resourceEvidenceDefinitionSha256 !== 'string' || !SHA256.test(input.resourceEvidenceDefinitionSha256)
    || !dependencies || typeof dependencies.resolveEffectiveCapabilities !== 'function') {
    return fail('breeding.modifier-provider-handoff.invalid-request', 'Egg Warmer Capability requires one current server-owned resource and effective-Capability resolver.')
  }
  let raw: unknown
  try { raw = dependencies.resolveEffectiveCapabilities({ sourcePokemonSheetSlug: source.slug, sourcePokemonSheet: source.document as unknown as CharacterSheet }) }
  catch { return fail('breeding.modifier-provider-handoff.provider-failure', 'Effective Egg Warmer Capability resolution failed closed.') }
  if (promiseLike(raw)) return fail('breeding.modifier-provider-handoff.provider-failure', 'Effective Egg Warmer Capability resolution must be synchronous.')
  const projection = cloneStrictJson(raw, 'effectiveCapabilityProjection', {
    limits: { depth: 20, nodes: 100_000, objectFields: 5_000, arrayEntries: 5_000, stringLength: 10_000, objectKeyLength: 200 },
    rootLabel: 'Effective Capability projection', valueLabel: 'Effective Capability projection',
    failNotJson: (_path, detail) => fail('breeding.modifier-provider-handoff.provider-failure', `Effective Capability projection ${detail}`),
    failLimit: (_path, detail) => fail('breeding.modifier-provider-handoff.provider-failure', detail),
  }) as unknown as EffectiveCapabilitySet
  if (!projection || typeof projection !== 'object' || !Array.isArray(projection.instances) || !Array.isArray(projection.unresolved)) {
    return fail('breeding.modifier-provider-handoff.provider-failure', 'Effective Capability resolver returned an invalid projection.')
  }
  if (projection.unresolved.some(candidate => normalized(candidate.normalizedLabel ?? '') === normalized('Egg Warmer'))) {
    return fail('breeding.modifier-provider-handoff.provider-ambiguous', 'A relevant Egg Warmer Capability identity is unresolved.')
  }
  const candidates = projection.instances.filter(candidate => candidate.canonicalId === 'Egg Warmer' && candidate.effective)
  if (candidates.length !== 1 || candidates[0]!.suppressionReasons.length !== 0) {
    return fail('breeding.modifier-provider-handoff.provider-unavailable', 'Exactly one effective unsuppressed Egg Warmer Capability source is required.')
  }
  const entry = validateBoundary('capability:Egg Warmer')
  const effectiveEvidenceSha256 = sha256({
    schemaVersion: 1,
    sourcePokemonSheetSlug: source.slug,
    sourcePokemonSheetRevision: source.revision,
    sourcePokemonSheetDefinitionSha256: sha256(source.document),
    targetEggId: egg.eggId,
    targetEggRevision: egg.revision,
    effectiveCapabilityProjection: projection,
    selectedCapabilityInstanceId: candidates[0]!.instanceId,
    resourceEvidenceDefinitionSha256: input.resourceEvidenceDefinitionSha256,
    capturedAtCampaignMinute: captured,
  })
  return handoff({ checkpoint: 'incubation-operation', capturedAtCampaignMinute: captured, evidence: [evidence({
    inventoryEntryId: entry.id,
    contributionId: 'once-per-24-hours-hatch-reduction-d10',
    providerKind: 'capability',
    providerId: BREEDING_EGG_WARMER_CAPABILITY_PROVIDER_ID,
    subjectKind: 'pokemon-sheet',
    subjectId: source.slug,
    subjectRevision: source.revision,
    checkpoint: 'incubation-operation',
    value: { kind: 'flag', enabled: true },
    providerDefinitionSha256: entry.recordSha256,
    effectiveEvidenceSha256,
  })] })
}

export const createBreedingParentalBondHandoffV1 = (inputValue: {
  readonly sourcePokemonSheet: StoredSheetInput
  readonly capturedAtCampaignMinute: unknown
}): BreedingModifierProviderHandoffV1 => {
  const input = exact(inputValue, ['sourcePokemonSheet','capturedAtCampaignMinute'], 'parentalBondHandoffInput')
  const source = storedSheet(input.sourcePokemonSheet, 'parentalBondHandoffInput.sourcePokemonSheet')
  const captured = minute(input.capturedAtCampaignMinute)
  const sheet = source.document as unknown as CharacterSheet
  const abilityRows = Array.isArray(sheet.abilities) ? sheet.abilities : []
  if (abilityRows.some(row => typeof row?.name === 'string' && normalized(row.name) === normalized('Parental Bond') && row.name !== 'Parental Bond')) {
    return fail('breeding.modifier-provider-handoff.provider-ambiguous', 'Parental Bond has a malformed relevant Ability identity.')
  }
  let projection: ReturnType<typeof projectAuthoritativeEffectiveAbilities>
  try {
    projection = projectAuthoritativeEffectiveAbilities({
      baseAbilities: resolveSheetAbilityInstances(abilityRows),
      target: { placementId: `breeding-source:${source.slug}` },
      species: typeof sheet.species === 'string' ? sheet.species : null,
      effects: [],
    })
  }
  catch { return fail('breeding.modifier-provider-handoff.provider-failure', 'Effective Parental Bond resolution failed closed.') }
  const candidates = projection.filter(candidate => candidate.canonicalId === 'Parental Bond' && candidate.effective)
  if (sheet.species !== 'Kangaskhan' || candidates.length !== 1) {
    return fail('breeding.modifier-provider-handoff.provider-unavailable', 'Exactly one current effective unsuppressed Kangaskhan Parental Bond source is required.')
  }
  const entry = validateBoundary('ability:Parental Bond')
  const effectiveEvidenceSha256 = sha256({
    schemaVersion: 1,
    sourcePokemonSheetSlug: source.slug,
    sourcePokemonSheetRevision: source.revision,
    sourcePokemonSheetDefinitionSha256: sha256(source.document),
    effectiveAbilities: projection,
    selectedInstanceId: candidates[0]!.instanceId,
    capturedAtCampaignMinute: captured,
  })
  return handoff({ checkpoint: 'hatch-transaction', capturedAtCampaignMinute: captured, evidence: [evidence({
    inventoryEntryId: entry.id,
    contributionId: 'kangaskhan-baby-template-interaction',
    providerKind: 'ability',
    providerId: BREEDING_PARENTAL_BOND_PROVIDER_ID,
    subjectKind: 'pokemon-sheet',
    subjectId: source.slug,
    subjectRevision: source.revision,
    checkpoint: 'hatch-transaction',
    value: { kind: 'flag', enabled: true },
    providerDefinitionSha256: entry.recordSha256,
    effectiveEvidenceSha256,
  })] })
}

export const createBreedingMarsupialHandoffV1 = (inputValue: {
  readonly sourcePokemonSheet: StoredSheetInput
  readonly capturedAtCampaignMinute: unknown
}, dependencies: {
  readonly resolveEffectiveCapabilities: (input: { readonly sourcePokemonSheetSlug: string, readonly sourcePokemonSheet: CharacterSheet }) => EffectiveCapabilitySet
}): BreedingModifierProviderHandoffV1 => {
  const input = exact(inputValue, ['sourcePokemonSheet','capturedAtCampaignMinute'], 'marsupialHandoffInput')
  const source = storedSheet(input.sourcePokemonSheet, 'marsupialHandoffInput.sourcePokemonSheet')
  const captured = minute(input.capturedAtCampaignMinute)
  if (!dependencies || typeof dependencies.resolveEffectiveCapabilities !== 'function') {
    return fail('breeding.modifier-provider-handoff.invalid-request', 'Marsupial requires one server-owned effective-Capability resolver.')
  }
  let raw: unknown
  try { raw = dependencies.resolveEffectiveCapabilities({ sourcePokemonSheetSlug: source.slug, sourcePokemonSheet: source.document as unknown as CharacterSheet }) }
  catch { return fail('breeding.modifier-provider-handoff.provider-failure', 'Effective Marsupial Capability resolution failed closed.') }
  if (promiseLike(raw)) return fail('breeding.modifier-provider-handoff.provider-failure', 'Effective Marsupial Capability resolution must be synchronous.')
  const projection = cloneStrictJson(raw, 'effectiveMarsupialCapabilityProjection', {
    limits: { depth: 20, nodes: 100_000, objectFields: 5_000, arrayEntries: 5_000, stringLength: 10_000, objectKeyLength: 200 },
    rootLabel: 'Effective Marsupial Capability projection', valueLabel: 'Effective Marsupial Capability projection',
    failNotJson: (_path, detail) => fail('breeding.modifier-provider-handoff.provider-failure', `Effective Marsupial Capability projection ${detail}`),
    failLimit: (_path, detail) => fail('breeding.modifier-provider-handoff.provider-failure', detail),
  }) as unknown as EffectiveCapabilitySet
  if (!projection || typeof projection !== 'object' || !Array.isArray(projection.instances) || !Array.isArray(projection.unresolved)) {
    return fail('breeding.modifier-provider-handoff.provider-failure', 'Effective Capability resolver returned an invalid Marsupial projection.')
  }
  if (projection.unresolved.some(candidate => normalized(candidate.normalizedLabel ?? '') === normalized('Marsupial'))) {
    return fail('breeding.modifier-provider-handoff.provider-ambiguous', 'A relevant Marsupial Capability identity is unresolved.')
  }
  const candidates = projection.instances.filter(candidate => candidate.canonicalId === 'Marsupial' && candidate.effective)
  if ((source.document as unknown as CharacterSheet).species !== 'Kangaskhan' || candidates.length !== 1 || candidates[0]!.suppressionReasons.length !== 0) {
    return fail('breeding.modifier-provider-handoff.provider-unavailable', 'Exactly one current effective unsuppressed Kangaskhan Marsupial source is required.')
  }
  const entry = validateBoundary('capability:Marsupial')
  const effectiveEvidenceSha256 = sha256({
    schemaVersion: 1,
    sourcePokemonSheetSlug: source.slug,
    sourcePokemonSheetRevision: source.revision,
    sourcePokemonSheetDefinitionSha256: sha256(source.document),
    effectiveCapabilityProjection: projection,
    selectedCapabilityInstanceId: candidates[0]!.instanceId,
    capturedAtCampaignMinute: captured,
  })
  const contributionIds = ['kangaskhan-forced-baby-template-minus-5','mother-pouch-link','level-25-template-removal'] as const
  return handoff({ checkpoint: 'hatch-transaction', capturedAtCampaignMinute: captured, evidence: contributionIds.map(contributionId => evidence({
    inventoryEntryId: entry.id,
    contributionId,
    providerKind: 'capability',
    providerId: BREEDING_MARSUPIAL_PROVIDER_ID,
    subjectKind: 'pokemon-sheet',
    subjectId: source.slug,
    subjectRevision: source.revision,
    checkpoint: 'hatch-transaction',
    value: { kind: 'flag', enabled: true },
    providerDefinitionSha256: entry.recordSha256,
    effectiveEvidenceSha256,
  })) })
}

const createReservedBreedingToolHandoffV1 = (inputValue: {
  readonly egg: unknown
  readonly ownerTrainerSheet: StoredSheetInput
  readonly custody: unknown
  readonly capturedAtCampaignMinute: unknown
}, policy: {
  readonly inventoryEntryId: 'item:Chemistry Set' | 'item:Reanimation Machine'
  readonly canonicalName: 'Chemistry Set' | 'Reanimation Machine'
  readonly providerId: typeof BREEDING_CHEMISTRY_SET_PROVIDER_ID | typeof BREEDING_REANIMATION_MACHINE_PROVIDER_ID
  readonly contributionId: 'artificial-egg-required-tool' | 'fossil-reanimation-tool'
}): BreedingModifierProviderHandoffV1 => {
  const input = exact(inputValue, ['egg','ownerTrainerSheet','custody','capturedAtCampaignMinute'], 'reservedToolHandoffInput')
  const egg = parsePokemonEggDocumentV1(input.egg)
  const trainer = storedSheet(input.ownerTrainerSheet, 'reservedToolHandoffInput.ownerTrainerSheet')
  const custody = exact(input.custody, ['inventoryEntryId','unitOrdinal'], 'reservedToolHandoffInput.custody')
  if (trainer.slug !== egg.ownerTrainerSlug || typeof custody.inventoryEntryId !== 'string' || !STABLE_ID.test(custody.inventoryEntryId)
    || !Number.isSafeInteger(custody.unitOrdinal) || (custody.unitOrdinal as number) < 0) {
    return fail('breeding.modifier-provider-handoff.stale-authority', 'Tool custody must bind the exact current Egg owner and one stable inventory row/unit.')
  }
  const matches = inventoryEntries(trainer.document as unknown as TrainerSheet).filter(row => row.id === custody.inventoryEntryId)
  const row = matches.length === 1 ? matches[0]! : null
  const quantity = row && Number.isSafeInteger(row.qty ?? 1) ? Number(row.qty ?? 1) : 0
  if (!row || row.name !== policy.canonicalName || quantity < 1 || (custody.unitOrdinal as number) >= quantity) {
    return fail('breeding.modifier-provider-handoff.provider-unavailable', `Current exact ${policy.canonicalName} custody is unavailable or ambiguous.`)
  }
  const captured = minute(input.capturedAtCampaignMinute)
  const entry = validateBoundary(policy.inventoryEntryId)
  const effectiveEvidenceSha256 = sha256({
    schemaVersion: 1,
    trainerSheetSlug: trainer.slug,
    trainerSheetRevision: trainer.revision,
    trainerSheetDefinitionSha256: sha256(trainer.document),
    inventoryEntryId: custody.inventoryEntryId,
    unitOrdinal: custody.unitOrdinal,
    targetEggId: egg.eggId,
    targetEggRevision: egg.revision,
    capturedAtCampaignMinute: captured,
  })
  return handoff({ checkpoint: 'egg-acceptance', capturedAtCampaignMinute: captured, evidence: [evidence({
    inventoryEntryId: entry.id,
    contributionId: policy.contributionId,
    providerKind: 'item',
    providerId: policy.providerId,
    subjectKind: 'trainer-sheet',
    subjectId: trainer.slug,
    subjectRevision: trainer.revision,
    checkpoint: 'egg-acceptance',
    value: { kind: 'flag', enabled: true },
    providerDefinitionSha256: entry.recordSha256,
    effectiveEvidenceSha256,
  })] })
}

export const createBreedingChemistrySetHandoffV1 = (input: Parameters<typeof createReservedBreedingToolHandoffV1>[0]): BreedingModifierProviderHandoffV1 => (
  createReservedBreedingToolHandoffV1(input, {
    inventoryEntryId: 'item:Chemistry Set', canonicalName: 'Chemistry Set', providerId: BREEDING_CHEMISTRY_SET_PROVIDER_ID, contributionId: 'artificial-egg-required-tool',
  })
)
export const createBreedingReanimationMachineHandoffV1 = (input: Parameters<typeof createReservedBreedingToolHandoffV1>[0]): BreedingModifierProviderHandoffV1 => (
  createReservedBreedingToolHandoffV1(input, {
    inventoryEntryId: 'item:Reanimation Machine', canonicalName: 'Reanimation Machine', providerId: BREEDING_REANIMATION_MACHINE_PROVIDER_ID, contributionId: 'fossil-reanimation-tool',
  })
)

export const createBreedingCoreHatchRuleHandoffV1 = (inputValue: {
  readonly egg: unknown
  readonly capturedAtCampaignMinute: unknown
}): BreedingModifierProviderHandoffV1 => {
  const input = exact(inputValue, ['egg','capturedAtCampaignMinute'], 'coreHatchRuleHandoffInput')
  const egg = parsePokemonEggDocumentV1(input.egg)
  const captured = minute(input.capturedAtCampaignMinute)
  const policies = [{
    inventoryEntryId: 'rule:Loyalty' as const,
    contributionId: 'bounded-starting-loyalty-offer-rank-3',
    providerId: BREEDING_LOYALTY_RULE_PROVIDER_ID,
    value: { kind: 'integer' as const, value: 3 },
  }, {
    inventoryEntryId: 'rule:Tutor Points' as const,
    contributionId: 'hatch-starting-tutor-point-1',
    providerId: BREEDING_TUTOR_POINTS_RULE_PROVIDER_ID,
    value: { kind: 'integer' as const, value: 1 },
  }]
  return handoff({ checkpoint: 'hatch-transaction', capturedAtCampaignMinute: captured, evidence: policies.map(policy => {
    const entry = validateBoundary(policy.inventoryEntryId)
    return evidence({
      inventoryEntryId: entry.id,
      contributionId: policy.contributionId,
      providerKind: 'system',
      providerId: policy.providerId,
      subjectKind: 'pokemon-egg',
      subjectId: egg.eggId,
      subjectRevision: egg.revision,
      checkpoint: 'hatch-transaction',
      value: policy.value,
      providerDefinitionSha256: entry.recordSha256,
      effectiveEvidenceSha256: sha256({
        schemaVersion: 1,
        ruleId: entry.id,
        ruleRecordDefinitionSha256: entry.recordSha256,
        ruleMechanicFieldsDefinitionSha256: entry.mechanicFieldsSha256,
        targetEggId: egg.eggId,
        targetEggRevision: egg.revision,
        capturedAtCampaignMinute: captured,
      }),
    })
  }) })
}
