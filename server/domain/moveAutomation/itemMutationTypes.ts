import type { EncounterEffectDuration } from '#shared/moveAutomation/encounterEffects'
import type {
  MoveItemGroupInventoryOwnerReference,
  MoveItemMapOwnerReference,
  MoveItemPokemonSheetOwnerReference,
  MoveItemReference,
  MoveItemTrainerEquipmentSlot,
  MoveItemTrainerInventorySection,
  MoveItemTrainerSheetOwnerReference,
} from '#shared/moveAutomation/items'
import type { MapGroundItemPosition } from '#shared/moveAutomation/groundItems'
import type { CharacterSheet } from '~/types/characterSheet'
import type { GroupInventoryDocument } from '~/types/groupInventory'
import type { TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import type {
  MoveSheetStateField,
  MoveStateChangePlan,
} from './plan'

export const MOVE_ITEM_MUTATION_KINDS = [
  'equip',
  'unequip',
  'transfer',
  'swap',
  'decrement',
  'consume',
  'destroy',
  'restore-consumed',
  'reuse-consumed',
  'item-suppress',
  'store-digestion-buff',
  'digest-buff',
  'ground-item-add',
  'ground-item-remove',
] as const

export const MOVE_ITEM_QUANTITY_POLICIES = [
  'conserve',
  'decrement',
  'consume',
  'destroy',
  'restore-consumed',
] as const

export const MOVE_ITEM_MUTATION_LIMITS = Object.freeze({
  operations: 64,
  consumptions: 64,
  identifierChars: 200,
  reasonCodeChars: 200,
})

export type MoveItemMutationKind = (typeof MOVE_ITEM_MUTATION_KINDS)[number]
export type MoveItemQuantityPolicy = (typeof MOVE_ITEM_QUANTITY_POLICIES)[number]

export interface MoveItemPokemonHeldDestination {
  readonly kind: 'pokemon-held'
  readonly owner: MoveItemPokemonSheetOwnerReference
}

export interface MoveItemTrainerEquipmentSlotDestination {
  readonly kind: 'trainer-equipment-slot'
  readonly owner: MoveItemTrainerSheetOwnerReference
  readonly slot: MoveItemTrainerEquipmentSlot
}

export interface MoveItemTrainerInventoryRowDestination {
  readonly kind: 'trainer-inventory-row'
  readonly owner: MoveItemTrainerSheetOwnerReference
  /** Stable identity retained on newly written trainer rows. */
  readonly itemId: string
  readonly section: MoveItemTrainerInventorySection
}

export interface MoveItemGroupInventoryRowDestination {
  readonly kind: 'group-inventory-row'
  readonly owner: MoveItemGroupInventoryOwnerReference
  readonly itemId: string
  readonly section: MoveItemTrainerInventorySection
}

export interface MoveItemMapGroundDestination {
  readonly kind: 'map-ground-item'
  readonly owner: MoveItemMapOwnerReference
  readonly itemId: string
  readonly position: MapGroundItemPosition
  readonly sideId: string | null
  readonly ownerPlacementId: string | null
}

export type MoveItemEquippedDestination =
  | MoveItemPokemonHeldDestination
  | MoveItemTrainerEquipmentSlotDestination

export type MoveItemInventoryDestination =
  | MoveItemTrainerInventoryRowDestination
  | MoveItemGroupInventoryRowDestination

export type MoveItemNonGroundDestination =
  | MoveItemEquippedDestination
  | MoveItemInventoryDestination

export type MoveItemDestination =
  | MoveItemNonGroundDestination
  | MoveItemMapGroundDestination

interface MoveItemMutationBase<Kind extends MoveItemMutationKind> {
  /** Stable reviewed effect-operation identity, never a client-authored patch ID. */
  readonly id: string
  readonly kind: Kind
  readonly reasonCode: string
}

export interface MoveItemEquipMutation extends MoveItemMutationBase<'equip'> {
  readonly source: MoveItemReference
  readonly destination: MoveItemEquippedDestination
  readonly quantity: 1
}

export interface MoveItemUnequipMutation extends MoveItemMutationBase<'unequip'> {
  readonly source: MoveItemReference
  readonly destination: MoveItemInventoryDestination
  readonly quantity: 1
}

export interface MoveItemTransferMutation extends MoveItemMutationBase<'transfer'> {
  readonly source: MoveItemReference
  readonly destination: MoveItemNonGroundDestination
  readonly quantity: number
}

export interface MoveItemSwapMutation extends MoveItemMutationBase<'swap'> {
  readonly left: MoveItemReference
  readonly right: MoveItemReference
}

export interface MoveItemDecrementMutation extends MoveItemMutationBase<'decrement'> {
  readonly source: MoveItemReference
  readonly quantity: number
}

export interface MoveItemConsumeMutation extends MoveItemMutationBase<'consume'> {
  readonly source: MoveItemReference
  readonly quantity: number
  /** Durable identity used by a later reviewed restore-consumed operation. */
  readonly consumptionId: string
}

export interface MoveItemDestroyMutation extends MoveItemMutationBase<'destroy'> {
  readonly source: MoveItemReference
  readonly quantity: number
}

export interface MoveItemRestoreConsumedMutation
  extends MoveItemMutationBase<'restore-consumed'> {
  /** Resolves only against private server-owned consumed-item records. */
  readonly consumptionId: string
  readonly destination: MoveItemDestination
}

/** Reuse a consumed item's reviewed effect without recreating physical quantity. */
export interface MoveItemReuseConsumedMutation
  extends MoveItemMutationBase<'reuse-consumed'> {
  readonly consumptionId: string
}

export interface MoveItemSuppressionTarget {
  readonly placementId: string
  readonly itemBindingIds: readonly string[]
}

export interface MoveItemSuppressMutation
  extends MoveItemMutationBase<'item-suppress'> {
  readonly effectId: string
  readonly sourceMoveId: string
  readonly sourcePlacementId: string
  readonly targets: readonly MoveItemSuppressionTarget[]
  readonly scope: 'all-equipped' | 'item-bindings'
  readonly blocksUse: boolean
  readonly blocksBenefit: boolean
  readonly duration: EncounterEffectDuration
  readonly replacement: 'replace-by-source' | 'independent'
}

export interface MoveItemDigestionBuffDestination {
  readonly kind: 'digestion-buff'
  readonly owner: MoveItemPokemonSheetOwnerReference | MoveItemTrainerSheetOwnerReference
}

export interface MoveItemStoreDigestionBuffMutation
  extends MoveItemMutationBase<'store-digestion-buff'> {
  readonly source: MoveItemReference
  readonly destination: MoveItemDigestionBuffDestination
  readonly quantity: 1
  readonly consumptionId: string
}

export interface MoveItemDigestBuffMutation
  extends MoveItemMutationBase<'digest-buff'> {
  readonly owner: MoveItemPokemonSheetOwnerReference | MoveItemTrainerSheetOwnerReference
  readonly canonicalItemIds: readonly string[] | null
  /** Optional one-based occurrence selected from the bounded authoritative storage list. */
  readonly storageSlot?: number
  /** Reviewed Harvest result bound to this exact authoritative trade. */
  readonly harvest?: {
    readonly result: 'heads' | 'tails' | 'sunny'
    readonly retainBuff: boolean
    readonly rollId: string | null
  }
  /** Reviewed provenance for the scene-local trade marker committed with the item use. */
  readonly sourceMoveId: string
  readonly sourcePlacementId: string
}

export interface MoveItemGroundAddMutation
  extends MoveItemMutationBase<'ground-item-add'> {
  readonly source: MoveItemReference
  readonly destination: MoveItemMapGroundDestination
  readonly quantity: number
}

export interface MoveItemGroundRemoveMutation
  extends MoveItemMutationBase<'ground-item-remove'> {
  readonly source: MoveItemReference
  readonly destination: MoveItemNonGroundDestination
  readonly quantity: number
}

export type MoveItemMutation =
  | MoveItemEquipMutation
  | MoveItemUnequipMutation
  | MoveItemTransferMutation
  | MoveItemSwapMutation
  | MoveItemDecrementMutation
  | MoveItemConsumeMutation
  | MoveItemDestroyMutation
  | MoveItemRestoreConsumedMutation
  | MoveItemReuseConsumedMutation
  | MoveItemSuppressMutation
  | MoveItemStoreDigestionBuffMutation
  | MoveItemDigestBuffMutation
  | MoveItemGroundAddMutation
  | MoveItemGroundRemoveMutation

/** Private durable evidence that an explicit consume operation removed quantity. */
export interface MoveConsumedItemRecord {
  readonly consumptionId: string
  readonly sourceOperationId: string
  readonly source: MoveItemReference
  readonly canonicalItemId: string
  readonly quantity: number
}

export type MoveItemMutationResourceScope =
  | {
      readonly kind: 'map'
      readonly slug: string
      readonly expectedRevision: number
    }
  | {
      readonly kind: 'sheet'
      readonly sheetKind: 'pokemon' | 'trainer'
      readonly slug: string
      readonly expectedRevision: number
    }
  | {
      readonly kind: 'group-inventory'
      readonly slug: string
      readonly expectedRevision: number
    }

export interface MoveItemQuantityEffect {
  readonly canonicalItemId: string
  readonly delta: number
}

export interface MoveItemMutationOperationResult {
  readonly operationId: string
  readonly kind: MoveItemMutationKind
  readonly quantityPolicy: MoveItemQuantityPolicy
  readonly quantityEffects: readonly MoveItemQuantityEffect[]
  readonly resourceScopes: readonly MoveItemMutationResourceScope[]
  readonly consumptionId: string | null
}

export interface MoveItemSheetResourceReduction {
  readonly kind: 'sheet'
  readonly sheetKind: 'pokemon' | 'trainer'
  readonly slug: string
  readonly expectedRevision: number
  readonly previous: CharacterSheet | TrainerSheet
  readonly current: CharacterSheet | TrainerSheet
  readonly changedFields: readonly Extract<
    MoveSheetStateField,
    'items' | 'inventory' | 'equipmentSlots' | 'digestion' | 'abilityUsage' | 'berryStorage'
  >[]
  readonly operationIds: readonly string[]
  readonly reasonCodes: readonly string[]
  readonly firstOperationOrder: number
}

export interface MoveItemGroupInventoryResourceReduction {
  readonly kind: 'group-inventory'
  readonly slug: string
  readonly expectedRevision: number
  readonly previous: GroupInventoryDocument
  readonly current: GroupInventoryDocument
  readonly operationIds: readonly string[]
  readonly reasonCodes: readonly string[]
  readonly firstOperationOrder: number
}

export interface MoveItemMapResourceReduction {
  readonly kind: 'map'
  readonly slug: string
  readonly expectedRevision: number
  readonly previous: TabletopMap
  readonly current: TabletopMap
  readonly operationIds: readonly string[]
  readonly reasonCodes: readonly string[]
  readonly firstOperationOrder: number
}

export type MoveItemMutationResourceReduction =
  | MoveItemSheetResourceReduction
  | MoveItemGroupInventoryResourceReduction
  | MoveItemMapResourceReduction

export interface ReducedMoveItemMutations {
  readonly resources: readonly MoveItemMutationResourceReduction[]
  readonly operationResults: readonly MoveItemMutationOperationResult[]
  readonly consumedItems: readonly MoveConsumedItemRecord[]
  readonly availableConsumedItems: readonly MoveConsumedItemRecord[]
}

export interface MoveItemSheetWritePlan {
  readonly kind: 'pokemon' | 'trainer'
  readonly slug: string
  readonly expectedRevision: number
  readonly revision: number
  readonly previousSheet: CharacterSheet | TrainerSheet
  readonly nextSheet: CharacterSheet | TrainerSheet
  readonly changedFields: MoveItemSheetResourceReduction['changedFields']
}

export interface MoveItemGroupInventoryWritePlan {
  readonly slug: string
  readonly expectedRevision: number
  readonly revision: number
  readonly previousDocument: GroupInventoryDocument
  readonly nextDocument: GroupInventoryDocument
}

export interface PlannedMoveItemMutations {
  readonly previousMap: TabletopMap
  readonly nextMap: TabletopMap
  readonly stateChanges: MoveStateChangePlan
  readonly sheetWrites: readonly MoveItemSheetWritePlan[]
  readonly groupInventoryWrites: readonly MoveItemGroupInventoryWritePlan[]
  readonly operationResults: readonly MoveItemMutationOperationResult[]
  readonly consumedItems: readonly MoveConsumedItemRecord[]
  readonly availableConsumedItems: readonly MoveConsumedItemRecord[]
}

export type MoveItemMutationErrorCode =
  | 'invalid-operation'
  | 'operation-limit-exceeded'
  | 'duplicate-operation-id'
  | 'invalid-destination'
  | 'resource-missing'
  | 'revision-conflict'
  | 'item-missing'
  | 'item-mismatch'
  | 'invalid-quantity'
  | 'insufficient-quantity'
  | 'destination-occupied'
  | 'destination-conflict'
  | 'unsupported-location'
  | 'duplicate-consumption'
  | 'consumption-missing'
  | 'quantity-conservation-violation'
  | 'map-position-invalid'

export class MoveItemMutationError extends Error {
  readonly code: MoveItemMutationErrorCode

  constructor(code: MoveItemMutationErrorCode, message: string) {
    super(message)
    this.name = 'MoveItemMutationError'
    this.code = code
  }
}
