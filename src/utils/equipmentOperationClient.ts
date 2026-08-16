import equipmentDefinitionsJson from '~~/data/complete-play-loop/equipment-definitions.v1.json'
import { parseEquipmentDefinitionDocument } from '#shared/itemAutomation/equipmentDefinitions'
import type {
  EquipmentSlotId,
  SheetEquipmentProjectionV1,
  SheetEquipmentStateV1,
} from '#shared/itemAutomation/equipment'

const document = parseEquipmentDefinitionDocument(equipmentDefinitionsJson)
const definitions = new Map(document.definitions.map(definition => [definition.canonicalItemId, definition]))

const randomHex32 = (): string => {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    const value = globalThis.crypto.randomUUID().replaceAll('-', '').toLowerCase()
    if (/^[a-f0-9]{32}$/u.test(value)) return value
  }
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16))
    return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('')
  }
  throw new Error('Secure browser randomness is required for equipment operations.')
}

export const createEquipmentOperationId = (): string => `equipment-operation:v1:${randomHex32()}`

export const trainerEquipmentSlotOption = (input: {
  readonly canonicalItemId: string
  readonly authority: SheetEquipmentStateV1 | SheetEquipmentProjectionV1 | null | undefined
}): readonly EquipmentSlotId[] | null => {
  const definition = definitions.get(input.canonicalItemId)
  if (!definition || definition.configuration) return null
  const rule = definition.ownerRules.find(candidate => candidate.ownerKind === 'trainer')
  if (!rule || !input.authority) return null
  if ('unresolved' in input.authority) {
    const unresolved = new Set(input.authority.unresolved.map(issue => issue.slotId))
    return rule.slotOptions.find(option => option.every(slotId =>
      !unresolved.has(slotId)
      && input.authority!.slots.find(slot => slot.slotId === slotId)?.instanceId === null)) ?? null
  }
  // Player projections intentionally hide issue locations, so any unresolved
  // legacy claim blocks client slot selection until a fresh GM review.
  if (input.authority.unresolvedCount > 0) return null
  return rule.slotOptions.find(option => option.every(slotId =>
    input.authority!.slots.find(slot => slot.slotId === slotId)?.instanceId === null)) ?? null
}
