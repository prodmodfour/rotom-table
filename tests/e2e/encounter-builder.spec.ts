import { expect, test, type APIResponse, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { createEmptyEncounterState } from '../../shared/moveAutomation/encounterState'

const authenticateGm = async (page: Page): Promise<void> => {
  await page.context().addCookies([{
    name: 'rotom-role', value: 'gm', url: 'http://127.0.0.1:3017', sameSite: 'Lax',
  }])
}
const parseOk = async (response: APIResponse): Promise<Record<string, any>> => {
  const text = await response.text()
  expect(response.ok(), `${response.status()} ${text}`).toBe(true)
  return JSON.parse(text) as Record<string, any>
}

test('GM authors, privately launches, discovers, and exports one atomic reviewed encounter', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  await authenticateGm(page)
  const key = `builder-${testInfo.project.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${Date.now().toString(36)}`
  const tableCreated = await parseOk(await page.request.post('/api/encounters/create', {
    data: { folder: 'builder-acceptance', name: `Builder Pond ${key}` },
  }))
  const tableEntry = tableCreated.entry as Record<string, any>
  await parseOk(await page.request.post('/api/encounters/save', {
    data: {
      region: tableEntry.region,
      key: tableEntry.key,
      table: { name: `Builder Pond ${key}`, min_level: 5, max_level: 5, entries: [{ weight: 100, species: 'Bulbasaur' }] },
    },
  }))

  const mapName = `Builder Arena ${key}`
  const created = await parseOk(await page.request.post('/api/maps/create', {
    data: { name: mapName, dimensions: { x: 8, y: 2, z: 8 } },
  }))
  const map = created.map as Record<string, any>
  const mapSlug = String(map.slug)
  await parseOk(await page.request.post('/api/maps/interaction-mode', {
    data: { slug: mapSlug, interactionMode: 'setup-edit' },
  }))
  await parseOk(await page.request.post('/api/maps/save', {
    data: {
      slug: mapSlug,
      map: {
        ...map,
        playerVisible: true,
        initiative: { activeId: null, round: 0 },
        encounterState: {
          ...createEmptyEncounterState(),
          sides: { wild: { id: 'wild', label: 'Wild', status: 'active', color: '#9a6047' } },
        },
      },
      interactionMode: 'setup-edit',
      expectedRevision: map.revision,
    },
  }))

  await page.goto(`/encounters/new?map=${encodeURIComponent(mapSlug)}&region=${encodeURIComponent(String(tableEntry.region))}&table=${encodeURIComponent(String(tableEntry.key))}`)
  await expect(page.getByRole('heading', { name: 'Encounter Builder' })).toBeVisible()
  await expect(page.locator('[data-rt-context="workshop"]')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Reroll unlocked' })).toBeEnabled()
  await expect(page.locator('.encounter-builder__cast li').first()).toBeVisible()
  await page.locator('input[type="radio"][value="blank"]').check()
  const encounterName = `Hidden Bulbasaur ${key}`
  await page.getByLabel('Encounter name').fill(encounterName)
  const encounterIdInput = page.getByLabel('Encounter route')
  await expect(encounterIdInput).toHaveValue(new RegExp(`hidden-bulbasaur-${key}$`))
  const encounterId = await encounterIdInput.inputValue()
  await page.getByRole('combobox', { name: 'Battlefield', exact: true }).selectOption(mapSlug)
  await page.getByRole('combobox', { name: 'Encounter table', exact: true }).selectOption(String(tableEntry.key))
  await page.getByLabel('Cast count').fill('1')
  await page.getByRole('button', { name: 'Reroll unlocked' }).click()

  const castRow = page.locator('.encounter-builder__cast li').first()
  await expect(castRow).toBeVisible()
  await castRow.getByLabel('Species').fill('Bulbasaur')
  await castRow.getByLabel('Level').fill('5')
  await castRow.getByLabel('Side').selectOption('wild')
  await castRow.getByLabel('Role').selectOption('leader')
  await castRow.getByLabel('Hidden at launch').check()
  await page.getByLabel('Public stakes').fill('Protect the moonlit pond.')
  await page.getByLabel('GM stakes').fill('The target flees when the bell rings.')
  await page.getByLabel('GM notes').fill('Private builder acceptance note.')

  const accessibility = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze()
  expect(accessibility.violations.filter(value => ['serious', 'critical'].includes(value.impact ?? ''))).toEqual([])

  const launch = page.getByRole('button', { name: 'Launch encounter' })
  await expect(launch).toBeEnabled()
  await launch.click()
  await expect(page).toHaveURL(new RegExp(`/play/${encounterId}(?:\\?|$)`), { timeout: 60_000 })
  await expect(page.getByText(encounterName).first()).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Bulbasaur', level: 1 })).toBeVisible()

  const gmWorkspace = await parseOk(await page.request.get(`/api/encounter-workspace/load?slug=${encodeURIComponent(encounterId)}`))
  expect(gmWorkspace.source).toMatchObject({ encounterId, mapSlug, encounterRevision: 0 })
  expect(gmWorkspace.participants).toHaveLength(1)
  expect(gmWorkspace.participants[0]).toMatchObject({ hidden: true, roleLabel: 'Leader' })
  const publicWorkspace = await parseOk(await page.request.get(`/api/encounter-workspace/load?slug=${encodeURIComponent(encounterId)}&audience=public`))
  expect(publicWorkspace.participants).toEqual([])
  expect(JSON.stringify(publicWorkspace)).not.toContain('Private builder acceptance note.')
  expect(JSON.stringify(publicWorkspace)).not.toContain('The target flees')

  const mode = await parseOk(await page.request.get(`/api/maps/interaction-mode?slug=${encodeURIComponent(mapSlug)}`))
  expect(mode.interactionMode).toBe('live-play')

  const backupResponse = await page.request.get(`/api/encounter-documents/export?encounterId=${encodeURIComponent(encounterId)}`)
  const backup = await parseOk(backupResponse)
  expect(backupResponse.headers()['content-disposition']).toContain(`${encounterId}.encounter.json`)
  expect(backupResponse.headers()['cache-control']).toContain('no-store')
  expect(backup).toMatchObject({
    schemaVersion: 1,
    format: 'rotom-table.encounter-document',
    document: {
      encounterId,
      linkedMapSlug: mapSlug,
      hiddenParticipantIds: [gmWorkspace.participants[0].participantId],
      stakes: { public: 'Protect the moonlit pond.', gm: 'The target flees when the bell rings.' },
      notes: 'Private builder acceptance note.',
    },
  })
  expect(backup.documentSha256).toMatch(/^[a-f0-9]{64}$/)

  await page.goto('/play')
  const libraryCard = page.getByRole('article').filter({ hasText: encounterName })
  await expect(libraryCard).toBeVisible()
  await expect(libraryCard).toContainText('blank')
  await expect(page.getByRole('article').filter({ hasText: mapName })).toHaveCount(0)
})
