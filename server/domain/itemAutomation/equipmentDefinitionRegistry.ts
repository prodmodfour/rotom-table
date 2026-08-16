import { createHash } from 'node:crypto'
import equipmentDefinitionsJson from '~~/data/complete-play-loop/equipment-definitions.v1.json'
import itemsJson from '~~/data/reference/items.json'
import { stableJsonStringify } from '~~/shared/automation/stableJson'
import { createItemIdentityRegistry } from '~~/shared/itemAutomation/identity'
import {
  parseEquipmentDefinitionDocument,
  type EquipmentConfigurationDefinitionV1,
  type EquipmentDefinitionDocumentV1,
  type EquipmentDefinitionV1,
} from '~~/shared/itemAutomation/equipmentDefinitions'

const EQUIPMENT_CATEGORIES = new Set([
  'Held Item', 'Weapon', 'Hand Equipment', 'Head Equipment',
  'Body Equipment', 'Feet Equipment', 'Accessory Item',
])

const sha256 = (value: unknown): string => createHash('sha256')
  .update(stableJsonStringify(value, {
    path: 'equipmentDefinition',
    limits: {
      maxDepth: 16,
      maxNodes: 20_000,
      maxObjectFields: 64,
      maxArrayEntries: 512,
      maxStringLength: 2_000,
    },
  }))
  .digest('hex')

const document = parseEquipmentDefinitionDocument(equipmentDefinitionsJson)
const itemRecords = itemsJson as Record<string, {
  readonly name?: string
  readonly aliases?: readonly string[]
  readonly categories?: readonly string[]
}>
const identityRegistry = createItemIdentityRegistry(Object.entries(itemRecords).map(([canonicalId, item]) => ({
  canonicalId,
  aliases: item.aliases ?? [],
})))

const expectedIds = Object.entries(itemRecords)
  .filter(([, item]) => item.categories?.some(category => EQUIPMENT_CATEGORIES.has(category)))
  .map(([canonicalItemId]) => canonicalItemId)
const expectedIdSet = new Set(expectedIds)
if (document.definitionCount !== expectedIds.length
  || document.definitions.some(definition => !expectedIdSet.has(definition.canonicalItemId))) {
  throw new Error('Reviewed equipment definitions do not cover the exact canonical equipment catalog.')
}

const definitions = new Map<string, EquipmentDefinitionV1>()
const definitionHashes = new Map<string, string>()
const configurationHashes = new Map<string, string>()
for (const definition of document.definitions) {
  const record = itemRecords[definition.canonicalItemId]
  if (!record || sha256(record) !== definition.canonicalRecordSha256) {
    throw new Error(`Equipment definition ${definition.canonicalItemId} is stale against canonical item data.`)
  }
  definitions.set(definition.canonicalItemId, definition)
  definitionHashes.set(definition.canonicalItemId, sha256(definition))
  if (definition.configuration) {
    configurationHashes.set(definition.canonicalItemId, sha256(definition.configuration))
  }
}
if (definitions.size !== expectedIds.length) {
  throw new Error('Reviewed equipment definitions contain duplicate or missing canonical identities.')
}

export const equipmentDefinitionDocument = (): EquipmentDefinitionDocumentV1 => document

export const equipmentDefinitions = (): readonly EquipmentDefinitionV1[] => document.definitions

export const equipmentDefinitionFor = (canonicalItemId: string): EquipmentDefinitionV1 | null =>
  definitions.get(canonicalItemId) ?? null

export const equipmentCanonicalItemIdForName = (displayName: string): string | null => {
  const canonicalId = identityRegistry.resolve(displayName)
  return canonicalId && definitions.has(canonicalId) ? canonicalId : null
}

export const equipmentDefinitionSha256 = (canonicalItemId: string): string | null =>
  definitionHashes.get(canonicalItemId) ?? null

export const equipmentConfigurationDefinitionSha256 = (canonicalItemId: string): string | null =>
  configurationHashes.get(canonicalItemId) ?? null

export const equipmentConfigurationDefinitionFor = (
  canonicalItemId: string,
): EquipmentConfigurationDefinitionV1 | null => definitions.get(canonicalItemId)?.configuration ?? null
