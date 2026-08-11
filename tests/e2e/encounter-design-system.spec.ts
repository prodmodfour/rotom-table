import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

// Package-pinned Chromium still has bounded glyph antialiasing variance across
// Linux CI hosts. Keep tolerance well below a material visual/layout change.
const MAX_RASTER_DIFF_PIXEL_RATIO = 0.002

const openGallery = async (page: import('@playwright/test').Page) => {
  await page.context().addCookies([{
    name: 'rotom-role',
    value: 'gm',
    url: 'http://127.0.0.1:3017',
    sameSite: 'Lax',
  }])
  await page.goto('/design-system/encounter')
  await expect(page.getByRole('heading', { name: 'Living field terminal primitives' })).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
}

test('gallery renders versioned contexts, states, densities, and primitive anatomy', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openGallery(page)

  await expect(page.locator('[data-rt-context="field-guide"]')).not.toHaveCount(0)
  await expect(page.locator('[data-rt-context="workshop"]')).not.toHaveCount(0)
  await expect(page.locator('[data-rt-context="live-encounter"]')).not.toHaveCount(0)
  await expect(page.locator('[data-rt-density]')).toHaveCount(3)
  await expect(page.locator('#states .gallery-state')).toHaveCount(8)
  await expect(page.getByText('Unavailable: Used on the previous turn.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Static can activate' })).toBeVisible()

  await expect(page.locator('#tokens')).toHaveScreenshot('encounter-tokens-and-themes.png', {
    animations: 'disabled',
    maxDiffPixelRatio: MAX_RASTER_DIFF_PIXEL_RATIO,
  })
  await expect(page.locator('#components')).toHaveScreenshot('encounter-component-primitives.png', {
    animations: 'disabled',
    maxDiffPixelRatio: MAX_RASTER_DIFF_PIXEL_RATIO,
  })
  await expect(page.locator('#states')).toHaveScreenshot('encounter-visual-states.png', {
    animations: 'disabled',
    maxDiffPixelRatio: MAX_RASTER_DIFF_PIXEL_RATIO,
  })
})

test('gallery has no serious accessibility violations and native keyboard paths remain visible', async ({ page }) => {
  test.setTimeout(90_000)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openGallery(page)

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze()
  expect(results.violations.filter(violation => ['serious', 'critical'].includes(violation.impact ?? ''))).toEqual([])

  const firstGalleryLink = page.getByRole('link', { name: 'Tokens' })
  await firstGalleryLink.focus()
  await expect(firstGalleryLink).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Contexts' })).toBeFocused()

  const inspect = page.getByRole('button', { name: 'Inspect Luxray' })
  await inspect.focus()
  await expect(inspect).toBeFocused()
  const box = await inspect.boundingBox()
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(44)
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(36)
})
