import { createHash } from 'node:crypto'
import providerJson from '~~/data/complete-play-loop/equipment-event-providers.v1.json'
import equipmentDefinitionJson from '~~/data/complete-play-loop/equipment-definitions.v1.json'
import itemsJson from '~~/data/reference/items.json'
import movesJson from '~~/data/reference/moves.json'
import conditionsJson from '~~/data/reference/conditions.json'
import { stableJsonStringify } from '~~/shared/automation/stableJson'
import {
  parseEquipmentEventProviderDocument,
  type EquipmentEventProviderDefinitionV1,
  type EquipmentEventProviderDocumentV1,
} from '~~/shared/itemAutomation/equipmentEventProviders'
import { equipmentDefinitionFor, equipmentDefinitionSha256 } from './equipmentDefinitionRegistry'

const EQUIPMENT_CATEGORIES = new Set([
  'Held Item', 'Weapon', 'Hand Equipment', 'Head Equipment',
  'Body Equipment', 'Feet Equipment', 'Accessory Item',
])
const sha256 = (value: unknown): string => createHash('sha256')
  .update(stableJsonStringify(value, {
    path: 'equipmentEventProvider',
    limits: { maxDepth: 16, maxNodes: 30_000, maxObjectFields: 64, maxArrayEntries: 512, maxStringLength: 2_000 },
  }))
  .digest('hex')
const rawFileSha256 = (value: unknown): string => createHash('sha256')
  .update(`${JSON.stringify(value, null, 2)}\n`)
  .digest('hex')

const document = parseEquipmentEventProviderDocument(providerJson)
const itemRecords = itemsJson as Record<string, { readonly categories?: readonly string[] }>
const moveIds = new Set(Object.keys(movesJson))
const conditionIds = new Set(Object.keys(conditionsJson))
const expectedIds = Object.entries(itemRecords)
  .filter(([, item]) => item.categories?.some(category => EQUIPMENT_CATEGORIES.has(category)))
  .map(([canonicalItemId]) => canonicalItemId)
const expectedIdSet = new Set(expectedIds)
if (document.catalogSha256 !== rawFileSha256(itemsJson)) {
  throw new Error('Equipment event providers are stale against the canonical item catalog.')
}
if (document.equipmentDefinitionsSha256 !== rawFileSha256(equipmentDefinitionJson)) {
  throw new Error('Equipment event providers are stale against reviewed compatibility definitions.')
}
if (document.definitionCount !== expectedIds.length
  || document.definitions.some(definition => !expectedIdSet.has(definition.canonicalItemId))) {
  throw new Error('Reviewed equipment event providers do not classify the exact equipment catalog.')
}
const definitions = new Map<string, EquipmentEventProviderDefinitionV1>()
for (const definition of document.definitions) {
  const item = itemRecords[definition.canonicalItemId]
  const equipment = equipmentDefinitionFor(definition.canonicalItemId)
  const equipmentHash = equipmentDefinitionSha256(definition.canonicalItemId)
  if (!item || !equipment || !equipmentHash
    || sha256(item) !== definition.canonicalRecordSha256
    || equipment.canonicalRecordSha256 !== definition.canonicalRecordSha256
    || equipmentHash !== definition.equipmentDefinitionSha256) {
    throw new Error(`Equipment event providers for ${definition.canonicalItemId} are stale against canonical authority.`)
  }
  for (const provider of definition.providers) {
    const moveIdsToCheck = provider.predicate.kind === 'move'
      ? provider.predicate.canonicalMoveIds
      : provider.predicate.kind === 'strike'
        ? provider.predicate.canonicalMoveIds ?? []
        : provider.predicate.kind === 'condition'
          ? provider.predicate.sourceMoveIds
          : []
    if (moveIdsToCheck.some(id => !moveIds.has(id))) {
      throw new Error(`Equipment event provider ${provider.providerId} references an unknown canonical Move.`)
    }
    const conditionIdsToCheck = [
      ...(provider.predicate.kind === 'condition' ? provider.predicate.conditionIds : []),
      ...(['apply-condition', 'prevent-condition', 'apply-readied-shield'].includes(provider.effect.kind)
        ? [(provider.effect as { readonly conditionId: string }).conditionId]
        : []),
    ]
    if (conditionIdsToCheck.some(id => !conditionIds.has(id))) {
      throw new Error(`Equipment event provider ${provider.providerId} references an unknown canonical Condition.`)
    }
    if (provider.eventKind !== provider.predicate.kind) {
      throw new Error(`Equipment event provider ${provider.providerId} has mismatched typed event authority.`)
    }
  }
  definitions.set(definition.canonicalItemId, definition)
}
if (definitions.size !== expectedIds.length) {
  throw new Error('Reviewed equipment event providers contain duplicate or missing identities.')
}

export const equipmentEventProviderDocument = (): EquipmentEventProviderDocumentV1 => document
export const equipmentEventProviderDefinitions = (): readonly EquipmentEventProviderDefinitionV1[] => document.definitions
export const equipmentEventProviderDefinitionFor = (
  canonicalItemId: string,
): EquipmentEventProviderDefinitionV1 | null => definitions.get(canonicalItemId) ?? null
export const equipmentEventProviderDefinitionSha256 = (canonicalItemId: string): string | null => {
  const definition = definitions.get(canonicalItemId)
  return definition ? sha256(definition) : null
}
