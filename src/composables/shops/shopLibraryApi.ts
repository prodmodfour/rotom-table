import type { ShopTableDocument } from '~/types/shop'

export interface ShopListResponse {
  readonly shops: readonly ShopTableDocument[]
}

export interface LoadShopResponse {
  readonly shop: ShopTableDocument
  readonly revision: number
  readonly updatedAt: number
}

export interface SaveShopResponse {
  readonly ok: true
  readonly changed: boolean
  readonly shop: ShopTableDocument
}

export interface DeleteShopResponse {
  readonly ok: true
  readonly shop: ShopTableDocument
}
