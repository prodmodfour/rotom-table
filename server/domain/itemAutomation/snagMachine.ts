import { createHash } from 'node:crypto'
import { findItem } from '~~/data/ptuReference'
import { itemInventoryInstanceId, type ItemInventorySection } from '#shared/itemAutomation/inventory'
import {
  parseSnagMachineState,
  snagConvertedUnitsForBallRow,
  type SnagMachineStateV1,
} from '#shared/itemAutomation/snagMachine'
import { buildTrainerPokeballOptions, type TokenPokeballOption } from '~/utils/pokeballCapture'
import type { InventoryEntry, TrainerSheet } from '~/types/trainerSheet'

const INVENTORY_SECTIONS = [
  'keyItems', 'pokemonItems', 'medicalKit', 'pokeBalls', 'foodStuff', 'equipment',
] as const satisfies readonly ItemInventorySection[]

const safeProjectionId = (...parts: readonly string[]): string => createHash('sha256')
  .update(parts.join('\u0000'))
  .digest('hex')
  .slice(0, 32)

export interface LargeSnagMachineInventorySource {
  readonly section: ItemInventorySection
  readonly rowIndex: number
  readonly row: InventoryEntry
  readonly sourceInstanceId: string
  readonly publicSourceId: string
}

export interface SnagBallInventoryChoice {
  readonly option: TokenPokeballOption
  readonly publicOptionId: string
  readonly availableUnconvertedUnits: number
}

const inventoryQuantity = (row: InventoryEntry): number => {
  const quantity = row.qty ?? 1
  return Number.isSafeInteger(quantity) && Number(quantity) > 0 ? Number(quantity) : 0
}

export const currentTrainerSnagMachineState = (sheet: TrainerSheet): SnagMachineStateV1 => (
  parseSnagMachineState(sheet.serverPrivate?.snagMachine)
)

/**
 * A stable ordinary inventory row is the reviewed Large/immovable variant.
 * Portable machines are serialized whole items and can contribute only while
 * equipped in the Accessory slot; this prevents unequipping one to impersonate
 * a Large machine.
 */
export const largeSnagMachineInventorySources = (sheet: TrainerSheet): readonly LargeSnagMachineInventorySource[] => {
  const sources: LargeSnagMachineInventorySource[] = []
  for (const section of INVENTORY_SECTIONS) {
    for (const [rowIndex, row] of (sheet.inventory?.[section] ?? []).entries()) {
      const rowId = row.id?.trim()
      if (!rowId || row.serializedEquipment || inventoryQuantity(row) < 1
        || findItem(row.name)?.name !== 'Snag Machine') continue
      sources.push(Object.freeze({
        section,
        rowIndex,
        row,
        sourceInstanceId: itemInventoryInstanceId({
          containerKind: 'trainer', containerSlug: sheet.slug, section, rowId,
        }),
        publicSourceId: `snag-machine-source:v1:${safeProjectionId(sheet.slug, section, String(rowIndex))}`,
      }))
    }
  }
  return Object.freeze(sources)
}

export const resolveLargeSnagMachineInventorySource = (input: {
  readonly sheet: TrainerSheet
  readonly sourceInstanceId: string
}): LargeSnagMachineInventorySource | null => largeSnagMachineInventorySources(input.sheet)
  .find(source => source.sourceInstanceId === input.sourceInstanceId) ?? null

export const snagBallInventoryChoices = (sheet: TrainerSheet): readonly SnagBallInventoryChoice[] => {
  const state = currentTrainerSnagMachineState(sheet)
  return Object.freeze(buildTrainerPokeballOptions(sheet).flatMap((option, index) => {
    const available = option.quantity - snagConvertedUnitsForBallRow(state, option.sourceInstanceId)
    if (available < 1) return []
    return [Object.freeze({
      option,
      publicOptionId: `snag-ball-option:v1:${safeProjectionId(
        sheet.slug, option.source.section, String(index), option.name,
      )}`,
      availableUnconvertedUnits: available,
    })]
  }))
}

export const resolveSnagBallInventoryChoice = (input: {
  readonly sheet: TrainerSheet
  readonly publicOptionId?: string | null
  readonly sourceInstanceId?: string | null
}): SnagBallInventoryChoice | null => {
  const choices = snagBallInventoryChoices(input.sheet)
  if (input.publicOptionId) return choices.find(choice => choice.publicOptionId === input.publicOptionId) ?? null
  if (input.sourceInstanceId) return choices.find(choice => choice.option.sourceInstanceId === input.sourceInstanceId) ?? null
  return null
}
