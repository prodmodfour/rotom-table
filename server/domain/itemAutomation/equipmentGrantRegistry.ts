import { createHash } from 'node:crypto'
import grantJson from '~~/data/complete-play-loop/equipment-grants.v1.json'
import equipmentDefinitionJson from '~~/data/complete-play-loop/equipment-definitions.v1.json'
import itemsJson from '~~/data/reference/items.json'
import abilitiesJson from '~~/data/reference/abilities.json'
import { stableJsonStringify } from '~~/shared/automation/stableJson'
import { parseCapabilityLabel } from '~~/shared/capabilityAutomation/catalog'
import { capabilityWeaponMove } from '~~/shared/capabilityAutomation/weaponMoves'
import {
  parseEquipmentGrantDocument,
  type EquipmentGrantDefinitionV1,
  type EquipmentGrantDocumentV1,
} from '~~/shared/itemAutomation/equipmentGrants'
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
    path: 'equipmentGrant',
    limits: { maxDepth: 16, maxNodes: 30_000, maxObjectFields: 64, maxArrayEntries: 512, maxStringLength: 2_000 },
  }))
  .digest('hex')
const rawFileSha256 = (value: unknown): string => createHash('sha256')
  .update(`${JSON.stringify(value, null, 2)}\n`)
  .digest('hex')

const document = parseEquipmentGrantDocument(grantJson)
const itemRecords = itemsJson as Record<string, { readonly categories?: readonly string[] }>
const expectedIds = Object.entries(itemRecords)
  .filter(([, item]) => item.categories?.some(category => EQUIPMENT_CATEGORIES.has(category)))
  .map(([canonicalItemId]) => canonicalItemId)
const expectedIdSet = new Set(expectedIds)
if (document.catalogSha256 !== rawFileSha256(itemsJson)) {
  throw new Error('Equipment grants are stale against the canonical item catalog.')
}
if (document.equipmentDefinitionsSha256 !== rawFileSha256(equipmentDefinitionJson)) {
  throw new Error('Equipment grants are stale against reviewed compatibility definitions.')
}
if (document.definitionCount !== expectedIds.length
  || document.definitions.some(definition => !expectedIdSet.has(definition.canonicalItemId))) {
  throw new Error('Reviewed equipment grants do not classify the exact canonical equipment catalog.')
}
const abilityIds = new Set(Object.keys(abilitiesJson))
const definitions = new Map<string, EquipmentGrantDefinitionV1>()
for (const definition of document.definitions) {
  const item = itemRecords[definition.canonicalItemId]
  const equipment = equipmentDefinitionFor(definition.canonicalItemId)
  const equipmentHash = equipmentDefinitionSha256(definition.canonicalItemId)
  if (!item || !equipment || !equipmentHash
    || sha256(item) !== definition.canonicalRecordSha256
    || equipment.canonicalRecordSha256 !== definition.canonicalRecordSha256
    || equipmentHash !== definition.equipmentDefinitionSha256) {
    throw new Error(`Equipment grants for ${definition.canonicalItemId} are stale against canonical authority.`)
  }
  for (const grant of definition.grants) {
    if (grant.kind === 'move') {
      const native = capabilityWeaponMove(grant.canonicalId) !== null
      if ((grant.executionStatus === 'native') !== native) {
        throw new Error(`Equipment Move grant ${grant.grantId} has incorrect executable-definition status.`)
      }
    }
    else if (grant.kind === 'capability') {
      const parsed = parseCapabilityLabel(grant.parameterLabel ?? grant.canonicalId)
      if (parsed.canonicalId !== grant.canonicalId) {
        throw new Error(`Equipment Capability grant ${grant.grantId} is not canonical.`)
      }
    }
    else if (grant.kind === 'ability' && !abilityIds.has(grant.canonicalId)) {
      throw new Error(`Equipment Ability grant ${grant.grantId} is not canonical.`)
    }
  }
  definitions.set(definition.canonicalItemId, definition)
}
if (definitions.size !== expectedIds.length) throw new Error('Reviewed equipment grants contain duplicate or missing identities.')

export const equipmentGrantDocument = (): EquipmentGrantDocumentV1 => document
export const equipmentGrantDefinitions = (): readonly EquipmentGrantDefinitionV1[] => document.definitions
export const equipmentGrantDefinitionFor = (canonicalItemId: string): EquipmentGrantDefinitionV1 | null => (
  definitions.get(canonicalItemId) ?? null
)
export const equipmentGrantDefinitionSha256 = (canonicalItemId: string): string | null => {
  const definition = equipmentGrantDefinitionFor(canonicalItemId)
  return definition ? sha256(definition) : null
}
