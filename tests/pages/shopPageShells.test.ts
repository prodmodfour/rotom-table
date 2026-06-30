import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const testDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(testDir, '../..')
const readSource = (relativePath: string): string => readFileSync(resolve(repoRoot, relativePath), 'utf8')

describe('shop page shells', () => {
  it('renders GM management and player shop library states from the shared /shops page', () => {
    const source = readSource('src/pages/shops/index.vue')

    expect(source).toContain("import AppNavigation from '~/components/AppNavigation.vue'")
    expect(source).toContain("import PlayerShopLibraryCard from '~/components/shops/PlayerShopLibraryCard.vue'")
    expect(source).toContain("import ShopLibraryCard from '~/components/shops/ShopLibraryCard.vue'")
    expect(source).toContain("import { useGmShopLibraryPage } from '~/composables/shops/useGmShopLibraryPage'")
    expect(source).toContain("import { usePlayerShopLibraryPage } from '~/composables/shops/usePlayerShopLibraryPage'")
    expect(source).toContain('const { isGm, isPlayer } = useAuth()')
    expect(source).toContain('const isPlayerShopLibraryEnabled = computed(() => isPlayer.value)')
    expect(source).toContain('useGmShopLibraryPage({ isGm })')
    expect(source).toContain('usePlayerShopLibraryPage({ isEnabled: isPlayerShopLibraryEnabled })')
    expect(source).toContain("title: 'Shops · Rotom Table'")
    expect(source).toContain('<AppNavigation />')
    expect(source).toContain('v-if="isGm"')
    expect(source).toContain('Browse every campaign shop table, including closed and hidden setup documents.')
    expect(source).toContain('@click="createShop"')
    expect(source).toContain("gmShopLibraryStatus === 'loading'")
    expect(source).toContain("gmShopLibraryStatus === 'error'")
    expect(source).toContain("gmShopLibraryStatus === 'empty'")
    expect(source).toContain('<ShopLibraryCard')
    expect(source).toContain('v-for="shop in shops"')
    expect(source).toContain('aria-label="Open shop library"')
    expect(source).toContain("playerShopLibraryStatus === 'loading'")
    expect(source).toContain("playerShopLibraryStatus === 'error'")
    expect(source).toContain("playerShopLibraryStatus === 'empty'")
    expect(source).toContain('No shops are currently open')
    expect(source).toContain('Open player-visible shopfronts will appear here when the GM opens them for players.')
    expect(source).toContain('<PlayerShopLibraryCard')
    expect(source).toContain('v-for="shop in playerShops"')
    expect(source).not.toContain('Return to shop shell')
    expect(source).not.toContain('SHOP_API_PATHS.save')
    expect(source).not.toContain('SHOP_API_PATHS.deleteShop')
  })

  it('adds a player-facing shopfront route shell without loading real shop data yet', () => {
    const source = readSource('src/pages/shops/[slug].vue')

    expect(source).toContain("import AppNavigation from '~/components/AppNavigation.vue'")
    expect(source).toContain("import { routeSlugParam } from '~/utils/routeParams'")
    expect(source).toContain("import { shopEditorPath, shopLibraryPath } from '~/utils/shopRoutes'")
    expect(source).toContain('const { isGm } = useAuth()')
    expect(source).toContain('const shopSlug = computed(() => routeSlugParam(route.params))')
    expect(source).toContain('<AppNavigation />')
    expect(source).toContain('Open GM editor shell')
    expect(source).toContain('No shop document is rendered yet')
    expect(source).not.toContain('SHOP_API_PATHS.load')
    expect(source).not.toContain('postJson')
  })

  it('adds a GM-only shop edit shell that redirects players away from the edit route', () => {
    const source = readSource('src/pages/shops/[slug]/edit.vue')

    expect(source).toContain("import AppNavigation from '~/components/AppNavigation.vue'")
    expect(source).toContain("import { routeSlugParam } from '~/utils/routeParams'")
    expect(source).toContain("import { shopfrontPath, shopLibraryPath } from '~/utils/shopRoutes'")
    expect(source).toContain('definePageMeta({')
    expect(source).toContain('middleware: (to) => {')
    expect(source).toContain('const { isPlayer } = useAuth()')
    expect(source).toContain('if (!isPlayer.value) return')
    expect(source).toContain('return navigateTo(slug ? shopfrontPath(slug) : shopLibraryPath(), { replace: true })')
    expect(source).toContain('const { isGm } = useAuth()')
    expect(source).toContain('GM access required')
    expect(source).toContain('No editable shop document is loaded yet')
    expect(source).not.toContain('SHOP_API_PATHS.save')
    expect(source).not.toContain('SHOP_API_PATHS.deleteShop')
    expect(source).not.toContain('postJson')
  })
})
