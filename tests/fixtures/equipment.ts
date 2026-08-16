import { createHash } from 'node:crypto'
import type { StrictJsonObject } from '#shared/automation/strictJson'
import {
  createEmptySheetEquipmentState,
  parseSheetEquipmentStateForOwner,
  type EquipmentOwnerKind,
  type EquipmentSlotId,
  type SheetEquipmentStateV1,
} from '#shared/itemAutomation/equipment'
import { itemInventoryInstanceId, type ItemInventorySection } from '#shared/itemAutomation/inventory'
import { resolveCanonicalItemId } from '~~/server/domain/itemAutomation/registry'
import { resolveMoveAutomationItemRuleIdentity } from '~~/server/domain/moveAutomation/itemRuleData'
import {
  equipmentCanonicalItemIdForName,
  equipmentConfigurationDefinitionSha256,
  equipmentDefinitionFor,
  equipmentDefinitionSha256,
} from '~~/server/domain/itemAutomation/equipmentDefinitionRegistry'

const digest = (value: string, length: number): string => createHash('sha256').update(value).digest('hex').slice(0, length)

export const activeEquipmentState = (input: {
  readonly ownerKind: EquipmentOwnerKind
  readonly ownerSlug: string
  readonly slotId: EquipmentSlotId
  readonly additionalSlotIds?: readonly EquipmentSlotId[]
  readonly canonicalItemId: string
  readonly sourceTrainerSlug?: string
  readonly sourceSection?: ItemInventorySection
  readonly sourceRevision?: number
  readonly configuration?: {
    readonly configurationId: string
    readonly values: StrictJsonObject
  }
}): SheetEquipmentStateV1 => {
  const base = createEmptySheetEquipmentState({ ownerKind: input.ownerKind, ownerSlug: input.ownerSlug })
  const occupiedSlotIds = new Set([input.slotId, ...(input.additionalSlotIds ?? [])])
  const moveIdentity = resolveMoveAutomationItemRuleIdentity(input.canonicalItemId)
  const canonicalItemId = equipmentCanonicalItemIdForName(moveIdentity?.canonicalItemName ?? input.canonicalItemId)
    ?? resolveCanonicalItemId(input.canonicalItemId)
    ?? input.canonicalItemId
  const configuredPlate = input.canonicalItemId.toLowerCase().replace(/[^a-z0-9]+/g, '-').match(/^([a-z]+)-(?:type-)?plate$/)
  const inferredConfiguration = !input.configuration && canonicalItemId === 'Type Plate' && configuredPlate
    ? {
        configurationId: 'equipment.type-plate.v1',
        values: { typeId: configuredPlate[1]![0]!.toUpperCase() + configuredPlate[1]!.slice(1) },
      }
    : null
  const configuration = input.configuration ?? inferredConfiguration
  const seed = `${input.ownerKind}:${input.ownerSlug}:${[...occupiedSlotIds].sort().join(',')}:${canonicalItemId}:${JSON.stringify(configuration?.values ?? null)}`
  const instanceId = `equipped-item:v1:${digest(seed, 32)}`
  const rowId = `fixture-equipment-${digest(seed, 20)}`
  const sourceTrainerSlug = input.sourceTrainerSlug ?? (input.ownerKind === 'trainer' ? input.ownerSlug : 'fixture-trainer')
  const sourceSection = input.sourceSection ?? 'equipment'
  const definition = equipmentDefinitionFor(canonicalItemId)
  return parseSheetEquipmentStateForOwner({
    ...base,
    slots: base.slots.map(slot => ({
      ...slot,
      instanceId: occupiedSlotIds.has(slot.slotId) ? instanceId : null,
    })),
    instances: [{
      instanceId,
      revision: 0,
      canonicalItemId,
      canonicalRecordSha256: definition?.canonicalRecordSha256
        ?? digest(`record:${canonicalItemId}`, 64),
      equipmentDefinitionSha256: definition
        ? equipmentDefinitionSha256(canonicalItemId)
        : digest(`definition:${canonicalItemId}`, 64),
      source: {
        kind: 'inventory',
        containerKind: 'trainer',
        containerSlug: sourceTrainerSlug,
        section: sourceSection,
        rowId,
        sourceInstanceId: itemInventoryInstanceId({
          containerKind: 'trainer', containerSlug: sourceTrainerSlug, section: sourceSection, rowId,
        }),
        sourceRevision: input.sourceRevision ?? 0,
        quantity: 1,
      },
      configuration: configuration ? {
        schemaVersion: 1,
        configurationId: configuration.configurationId,
        definitionSha256: equipmentConfigurationDefinitionSha256(canonicalItemId)!,
        values: configuration.values,
      } : null,
      activity: { status: 'active', reasons: [] },
      equippedByOperationId: `equipment-operation:v1:${digest(seed, 32)}`,
      equippedAt: 0,
    }],
    unresolved: [],
  }, { kind: input.ownerKind, slug: input.ownerSlug })
}

export const activePokemonHeldEquipmentState = (input: {
  readonly ownerSlug: string
  readonly canonicalItemIds: readonly string[]
}): SheetEquipmentStateV1 => {
  if (input.canonicalItemIds.length > 2) throw new Error('A Pokémon fixture may hold at most two structured items.')
  const states = input.canonicalItemIds.map((canonicalItemId, index) => activeEquipmentState({
    ownerKind: 'pokemon',
    ownerSlug: input.ownerSlug,
    slotId: index === 0 ? 'held' : 'held-secondary',
    canonicalItemId,
  }))
  const base = createEmptySheetEquipmentState({ ownerKind: 'pokemon', ownerSlug: input.ownerSlug })
  return parseSheetEquipmentStateForOwner({
    ...base,
    slots: base.slots.map((slot, index) => ({
      ...slot,
      instanceId: states[index]?.instances[0]?.instanceId ?? null,
    })),
    instances: states.flatMap(state => state.instances),
  }, { kind: 'pokemon', slug: input.ownerSlug })
}
