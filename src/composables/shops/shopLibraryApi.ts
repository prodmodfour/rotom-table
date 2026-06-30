import type { ShopTableDocument } from '~/types/shop'

export interface ShopListResponse {
  readonly shops: readonly ShopTableDocument[]
}
