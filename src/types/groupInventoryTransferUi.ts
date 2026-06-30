import type { GroupInventoryEntryId, GroupInventorySectionKey } from '~/types/groupInventory'
import type { TrainerInventory, TrainerSheet } from '~/types/trainerSheet'

export type GroupInventoryTransferDirection = 'group-to-trainer' | 'trainer-to-group'
export type GroupInventoryTransferStatus = 'idle' | 'loading' | 'success' | 'conflict' | 'error'
export type GroupInventoryTrainerLoadStatus = 'idle' | 'loading' | 'loaded' | 'error'

export interface GroupInventoryTransferTrainerOption {
  readonly slug: string
  readonly name: string
  readonly revision: number
  readonly inventory: TrainerInventory
  readonly sheet: TrainerSheet
  readonly playerProfileAccessible?: boolean
}

export interface GroupInventoryTransferToTrainerRequest {
  readonly trainerSlug: string
  readonly section: GroupInventorySectionKey
  readonly itemId: GroupInventoryEntryId
  readonly quantity: number
}

export interface GroupInventoryTransferToGroupRequest {
  readonly trainerSlug: string
  readonly section: GroupInventorySectionKey
  readonly trainerRowIndex: number
  readonly quantity: number
}
