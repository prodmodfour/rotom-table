import { describe, expect, it } from 'vitest'
import {
  SHOPFRONT_ROUTE_PATH,
  SHOP_EDITOR_ROUTE_PATH,
  SHOP_LIBRARY_PATH,
  isShopEditorPath,
  isShopPath,
  shopEditorPath,
  shopLibraryPath,
  shopfrontPath,
} from '~/utils/shopRoutes'

describe('shop route helpers', () => {
  it('exposes canonical shop route constants and builders', () => {
    expect(SHOP_LIBRARY_PATH).toBe('/shops')
    expect(SHOPFRONT_ROUTE_PATH).toBe('/shops/[slug]')
    expect(SHOP_EDITOR_ROUTE_PATH).toBe('/shops/[slug]/edit')
    expect(shopLibraryPath()).toBe('/shops')
    expect(shopfrontPath('viridian-mart')).toBe('/shops/viridian-mart')
    expect(shopEditorPath('viridian-mart')).toBe('/shops/viridian-mart/edit')
    expect(shopfrontPath('space shop')).toBe('/shops/space%20shop')
    expect(shopEditorPath('space/shop')).toBe('/shops/space%2Fshop/edit')
  })

  it('recognizes shop pages without matching similarly named routes', () => {
    expect(isShopPath('/shops')).toBe(true)
    expect(isShopPath('/shops/viridian-mart')).toBe(true)
    expect(isShopPath('/shops/viridian-mart/edit')).toBe(true)
    expect(isShopPath('/shops/viridian-mart?tab=stock')).toBe(true)
    expect(isShopPath('/shops/viridian-mart/edit#entries')).toBe(true)
    expect(isShopPath('/shops-tools')).toBe(false)
    expect(isShopPath('/maps/shops')).toBe(false)
  })

  it('recognizes GM edit route shape separately from player shopfront routes', () => {
    expect(isShopEditorPath('/shops/viridian-mart/edit')).toBe(true)
    expect(isShopEditorPath('/shops/viridian-mart/edit?tab=entries')).toBe(true)
    expect(isShopEditorPath('/shops/viridian-mart/edit#stock')).toBe(true)
    expect(isShopEditorPath('/shops/viridian-mart')).toBe(false)
    expect(isShopEditorPath('/shops')).toBe(false)
    expect(isShopEditorPath('/shops/edit')).toBe(false)
    expect(isShopEditorPath('/shops/viridian-mart/edit/history')).toBe(false)
    expect(isShopEditorPath('/shops-tools/viridian-mart/edit')).toBe(false)
  })
})
