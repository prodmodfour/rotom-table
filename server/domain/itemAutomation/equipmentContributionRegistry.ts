import { createHash } from 'node:crypto'
import contributionJson from '~~/data/complete-play-loop/equipment-contributions.v1.json'
import equipmentDefinitionJson from '~~/data/complete-play-loop/equipment-definitions.v1.json'
import itemsJson from '~~/data/reference/items.json'
import { stableJsonStringify } from '~~/shared/automation/stableJson'
import {
  parseEquipmentContributionDocument,
  type EquipmentContributionDefinitionV1,
  type EquipmentContributionDocumentV1,
} from '~~/shared/itemAutomation/equipmentContributions'
import {
  equipmentDefinitionFor,
  equipmentDefinitionSha256,
} from './equipmentDefinitionRegistry'

const EQUIPMENT_CATEGORIES = new Set([
  'Held Item', 'Weapon', 'Hand Equipment', 'Head Equipment',
  'Body Equipment', 'Feet Equipment', 'Accessory Item',
])

const sha256 = (value: unknown): string => createHash('sha256')
  .update(stableJsonStringify(value, {
    path: 'equipmentContribution',
    limits: {
      maxDepth: 16,
      maxNodes: 30_000,
      maxObjectFields: 64,
      maxArrayEntries: 512,
      maxStringLength: 2_000,
    },
  }))
  .digest('hex')

const rawFileSha256 = (value: unknown): string => createHash('sha256')
  .update(`${JSON.stringify(value, null, 2)}\n`)
  .digest('hex')

const document = parseEquipmentContributionDocument(contributionJson)
const itemRecords = itemsJson as Record<string, {
  readonly categories?: readonly string[]
}>
const expectedIds = Object.entries(itemRecords)
  .filter(([, item]) => item.categories?.some(category => EQUIPMENT_CATEGORIES.has(category)))
  .map(([canonicalItemId]) => canonicalItemId)
const expectedIdSet = new Set(expectedIds)

if (document.catalogSha256 !== rawFileSha256(itemsJson)) {
  throw new Error('Equipment contribution definitions are stale against the canonical item catalog.')
}
if (document.equipmentDefinitionsSha256 !== rawFileSha256(equipmentDefinitionJson)) {
  throw new Error('Equipment contribution definitions are stale against reviewed compatibility definitions.')
}
if (document.definitionCount !== expectedIds.length
  || document.definitions.some(definition => !expectedIdSet.has(definition.canonicalItemId))) {
  throw new Error('Reviewed equipment contributions do not classify the exact canonical equipment catalog.')
}

const definitions = new Map<string, EquipmentContributionDefinitionV1>()
for (const definition of document.definitions) {
  const item = itemRecords[definition.canonicalItemId]
  const equipment = equipmentDefinitionFor(definition.canonicalItemId)
  const equipmentHash = equipmentDefinitionSha256(definition.canonicalItemId)
  if (!item || !equipment || !equipmentHash
    || sha256(item) !== definition.canonicalRecordSha256
    || equipment.canonicalRecordSha256 !== definition.canonicalRecordSha256
    || equipmentHash !== definition.equipmentDefinitionSha256) {
    throw new Error(`Equipment contribution ${definition.canonicalItemId} is stale against canonical authority.`)
  }
  definitions.set(definition.canonicalItemId, definition)
}
if (definitions.size !== expectedIds.length) {
  throw new Error('Reviewed equipment contribution definitions contain duplicate or missing identities.')
}

export const equipmentContributionDocument = (): EquipmentContributionDocumentV1 => document

export const equipmentContributionDefinitions = (): readonly EquipmentContributionDefinitionV1[] => document.definitions

export const equipmentContributionDefinitionFor = (
  canonicalItemId: string,
): EquipmentContributionDefinitionV1 | null => definitions.get(canonicalItemId) ?? null
