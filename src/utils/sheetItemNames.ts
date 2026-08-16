import { TRAINER_EQUIPMENT_SLOTS } from '~/utils/sheets/trainerInventorySections'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'

const EMPTY_ITEM_LABELS = new Set(['-', '—', 'none', 'n/a', 'na'])

export const splitSheetItemNames = (value: string | null | undefined): string[] => {
  if (!value?.trim()) return []
  return value
    .split(/\s*(?:[,;]|\s+[+&|/]\s+)\s*/g)
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && !EMPTY_ITEM_LABELS.has(item.toLowerCase()))
}

const activeEquipmentNames = (
  sheet: CharacterSheet | TrainerSheet,
  ownerKind: 'pokemon' | 'trainer',
  slotIds: ReadonlySet<string>,
): string[] => {
  const authority = sheet.equipmentState ?? sheet.equipmentProjection
  if (!authority || authority.owner.kind !== ownerKind || authority.owner.slug !== sheet.slug) return []
  const instances = new Map(authority.instances.map(instance => [instance.instanceId, instance]))
  return authority.slots.flatMap((slot) => {
    if (!slotIds.has(slot.slotId) || !slot.instanceId) return []
    const instance = instances.get(slot.instanceId)
    return instance?.activity.status === 'active' ? [instance.canonicalItemId] : []
  }).filter((name, index, names) => names.indexOf(name) === index)
}

export const pokemonHeldItemNames = (sheet: CharacterSheet): string[] =>
  activeEquipmentNames(sheet, 'pokemon', new Set(['held', 'held-secondary']))

export interface TrainerEquippedItemNameOptions {
  /** Magic Room suppresses only Accessory-slot equipment for Trainers. */
  readonly includeAccessory?: boolean
}

export const trainerEquippedItemNames = (
  sheet: TrainerSheet,
  options: TrainerEquippedItemNameOptions = {},
): string[] => {
  const includeAccessory = options.includeAccessory ?? true
  return activeEquipmentNames(
    sheet,
    'trainer',
    new Set(TRAINER_EQUIPMENT_SLOTS
      .filter(slot => includeAccessory || slot.key !== 'accessory')
      .map(slot => slot.key)),
  )
}
