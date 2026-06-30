import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const testDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(testDir, '../..')
const readSource = (relativePath: string): string => readFileSync(resolve(repoRoot, relativePath), 'utf8')

describe('shop page shells', () => {
  it('adds a shared shops library shell with loading, empty, and error states but no mutations', () => {
    const source = readSource('src/pages/shops/index.vue')

    expect(source).toContain("import AppNavigation from '~/components/AppNavigation.vue'")
    expect(source).toContain('type ShopLibraryShellStatus = \'loading\' | \'empty\' | \'error\'')
    expect(source).toContain('const { isGm } = useAuth()')
    expect(source).toContain("title: 'Shops · Rotom Table'")
    expect(source).toContain('<AppNavigation />')
    expect(source).toContain("shopLibraryStatus === 'loading'")
    expect(source).toContain("shopLibraryStatus === 'error'")
    expect(source).toContain('shopLibraryErrorMessage')
    expect(source).toContain('No shop tables are displayed yet')
    expect(source).toContain('No shops are currently displayed')
    expect(source).not.toContain('postJson')
    expect(source).not.toContain('SHOP_API_PATHS.create')
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
