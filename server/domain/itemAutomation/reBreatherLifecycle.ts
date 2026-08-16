import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  initialItemReBreatherState,
  materializeItemReBreatherState,
  parseItemReBreatherState,
  type ItemReBreatherStateV1,
} from '#shared/itemAutomation/guidedAdjudication'
import {
  parseSerializedEquipmentInventoryState,
  parseSheetEquipmentStateForOwner,
  type EquipmentOwnerKind,
  type SerializedEquipmentInventoryStateV1,
  type SheetEquipmentStateV1,
} from '#shared/itemAutomation/equipment'
import type { StrictJsonObject } from '#shared/automation/strictJson'
import type { CharacterSheet } from '~/types/characterSheet'
import type { InventoryEntry, TrainerSheet } from '~/types/trainerSheet'
import { equipmentGrantDefinitionFor } from './equipmentGrantRegistry'

export const RE_BREATHER_CANONICAL_ITEM_ID = 'Re-Breather' as const

const reviewedReBreather = (value: {
  readonly canonicalItemId: string
  readonly canonicalRecordSha256: string
  readonly equipmentDefinitionSha256: string | null
}): boolean => {
  const definition = equipmentGrantDefinitionFor(RE_BREATHER_CANONICAL_ITEM_ID)
  return Boolean(definition
    && value.canonicalItemId === definition.canonicalItemId
    && value.canonicalRecordSha256 === definition.canonicalRecordSha256
    && value.equipmentDefinitionSha256 === definition.equipmentDefinitionSha256)
}

/** Missing state on an exact reviewed legacy instance migrates to ready; malformed present state fails closed. */
export const currentReviewedReBreatherState = (input: {
  readonly serializedState: Readonly<Record<string, unknown>>
  readonly campaignMinute: number
}): ItemReBreatherStateV1 => materializeItemReBreatherState({
  state: input.serializedState.reBreather === undefined
    ? initialItemReBreatherState()
    : parseItemReBreatherState(input.serializedState.reBreather),
  campaignMinute: input.campaignMinute,
})

export const replaceEquippedReBreatherState = (input: {
  readonly equipmentState: SheetEquipmentStateV1
  readonly instanceId: string
  readonly expectedInstanceRevision: number
  readonly nextState: ItemReBreatherStateV1
}): SheetEquipmentStateV1 => {
  const index = input.equipmentState.instances.findIndex(instance => instance.instanceId === input.instanceId)
  if (index < 0) throw new Error('The exact equipped Re-Breather no longer exists.')
  const current = input.equipmentState.instances[index]!
  if (current.revision !== input.expectedInstanceRevision || !reviewedReBreather(current)) {
    throw new Error('The exact equipped Re-Breather authority changed.')
  }
  const instances = input.equipmentState.instances.map((instance, instanceIndex) => instanceIndex === index
    ? Object.freeze({
        ...instance,
        revision: instance.revision + 1,
        serializedState: Object.freeze({
          ...instance.serializedState,
          reBreather: parseItemReBreatherState(input.nextState) as unknown as StrictJsonObject,
        }),
      })
    : instance)
  return Object.freeze({
    ...input.equipmentState,
    revision: input.equipmentState.revision + 1,
    instances: Object.freeze(instances),
  })
}

const materializeEquipped = (input: {
  readonly ownerKind: EquipmentOwnerKind
  readonly ownerSlug: string
  readonly value: unknown
  readonly campaignMinute: number
}): { readonly state: SheetEquipmentStateV1, readonly changed: boolean } => {
  const state = parseSheetEquipmentStateForOwner(input.value, { kind: input.ownerKind, slug: input.ownerSlug })
  let changed = false
  const instances = state.instances.map((instance) => {
    if (!reviewedReBreather(instance)) return instance
    const before = instance.serializedState.reBreather === undefined
      ? initialItemReBreatherState()
      : parseItemReBreatherState(instance.serializedState.reBreather)
    const after = materializeItemReBreatherState({ state: before, campaignMinute: input.campaignMinute })
    if (instance.serializedState.reBreather !== undefined && stableJsonStringify(before) === stableJsonStringify(after)) return instance
    changed = true
    return Object.freeze({
      ...instance,
      revision: instance.revision + 1,
      serializedState: Object.freeze({ ...instance.serializedState, reBreather: after as unknown as StrictJsonObject }),
    })
  })
  return changed
    ? { state: Object.freeze({ ...state, revision: state.revision + 1, instances: Object.freeze(instances) }), changed: true }
    : { state, changed: false }
}

const materializeSerialized = (input: {
  readonly value: SerializedEquipmentInventoryStateV1
  readonly campaignMinute: number
}): { readonly value: SerializedEquipmentInventoryStateV1, readonly changed: boolean } => {
  const parsed = parseSerializedEquipmentInventoryState(input.value)
  if (!reviewedReBreather(parsed)) return { value: parsed, changed: false }
  const before = parsed.state.reBreather === undefined
    ? initialItemReBreatherState()
    : parseItemReBreatherState(parsed.state.reBreather)
  const after = materializeItemReBreatherState({ state: before, campaignMinute: input.campaignMinute })
  if (parsed.state.reBreather !== undefined && stableJsonStringify(before) === stableJsonStringify(after)) {
    return { value: parsed, changed: false }
  }
  return {
    value: Object.freeze({
      ...parsed,
      revision: parsed.revision + 1,
      state: Object.freeze({ ...parsed.state, reBreather: after as unknown as StrictJsonObject }),
    }),
    changed: true,
  }
}

const materializeInventory = (input: {
  readonly inventory: TrainerSheet['inventory']
  readonly campaignMinute: number
}): { readonly inventory: TrainerSheet['inventory'], readonly changed: boolean } => {
  if (!input.inventory) return { inventory: input.inventory, changed: false }
  let changed = false
  const result = Object.fromEntries(Object.entries(input.inventory).map(([section, rows]) => [
    section,
    Array.isArray(rows) ? rows.map((row: InventoryEntry) => {
      if (!row.serializedEquipment) return row
      const next = materializeSerialized({ value: row.serializedEquipment, campaignMinute: input.campaignMinute })
      if (!next.changed) return row
      changed = true
      return { ...row, serializedEquipment: next.value }
    }) : rows,
  ])) as TrainerSheet['inventory']
  return { inventory: changed ? result : input.inventory, changed }
}

/** Reconcile all exact reviewed Re-Breathers in one sheet at one authoritative campaign minute. */
export const reconcileSheetReBreathers = (input: {
  readonly kind: EquipmentOwnerKind
  readonly slug: string
  readonly sheet: CharacterSheet | TrainerSheet
  readonly campaignMinute: number
}): { readonly sheet: CharacterSheet | TrainerSheet, readonly changed: boolean } => {
  let changed = false
  let equipmentState = input.sheet.equipmentState
  if (equipmentState !== undefined) {
    const next = materializeEquipped({
      ownerKind: input.kind,
      ownerSlug: input.slug,
      value: equipmentState,
      campaignMinute: input.campaignMinute,
    })
    equipmentState = next.state
    changed ||= next.changed
  }
  if (input.kind === 'trainer') {
    const trainer = input.sheet as TrainerSheet
    const inventory = materializeInventory({ inventory: trainer.inventory, campaignMinute: input.campaignMinute })
    changed ||= inventory.changed
    return {
      sheet: changed ? { ...trainer, equipmentState, inventory: inventory.inventory } : trainer,
      changed,
    }
  }
  const pokemon = input.sheet as CharacterSheet
  return { sheet: changed ? { ...pokemon, equipmentState } : pokemon, changed }
}
