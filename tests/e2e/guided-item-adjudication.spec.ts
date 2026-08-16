import { randomBytes } from 'node:crypto'
import { expect, test, type APIResponse, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

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
const id = (prefix: string): string => `${prefix}${randomBytes(16).toString('hex')}`

test('Poultices stay inert until one bounded GM outcome settles from the responsive Campaign queue', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  await authenticateGm(page)

  const pokemonCreated = await parseOk(await page.request.post('/api/sheets/create', { data: { kind: 'pokemon', folder: '' } }))
  const pokemonSlug = String(pokemonCreated.slug)
  const pokemonLoaded = await parseOk(await page.request.get(`/api/sheets/load?kind=pokemon&slug=${pokemonSlug}`))
  const savedPokemon = await parseOk(await page.request.post('/api/sheets/save', {
    data: {
      kind: 'pokemon', slug: pokemonSlug, expectedRevision: pokemonLoaded.sheet.revision, interactionMode: 'setup-edit',
      sheet: {
        ...pokemonLoaded.sheet,
        nickname: 'Sprig', species: 'Bulbasaur', level: 10, loyalty: 3,
        stats: { ...(pokemonLoaded.sheet.stats ?? {}), hp: { ...((pokemonLoaded.sheet.stats ?? {}).hp ?? {}), added: 0 } },
        combat: { ...(pokemonLoaded.sheet.combat ?? {}), currentHp: 1, injuries: 1, conditions: [] },
      },
    },
  }))
  const initialHp = Number(savedPokemon.sheet.combat.currentHp)

  const trainerCreated = await parseOk(await page.request.post('/api/sheets/create', { data: { kind: 'trainer', folder: '' } }))
  const trainerSlug = String(trainerCreated.slug)
  const trainerLoaded = await parseOk(await page.request.get(`/api/sheets/load?kind=trainer&slug=${trainerSlug}`))
  const rowId = `poultices-${randomBytes(8).toString('hex')}`
  const savedTrainer = await parseOk(await page.request.post('/api/sheets/save', {
    data: {
      kind: 'trainer', slug: trainerSlug, expectedRevision: trainerLoaded.sheet.revision, interactionMode: 'setup-edit',
      sheet: {
        ...trainerLoaded.sheet,
        name: 'Rook', level: 10, currentTeam: [pokemonSlug],
        inventory: { ...(trainerLoaded.sheet.inventory ?? {}), medicalKit: [{ id: rowId, name: 'Poultices', qty: 1 }] },
      },
    },
  }))
  const trainerRevision = Number(savedTrainer.sheet.revision)
  const actions = await parseOk(await page.request.get(`/api/items/sheet-actions?trainerSlug=${trainerSlug}`))
  const offer = (actions.offers as Record<string, any>[]).find(candidate => candidate.source?.canonicalId === 'Poultices')
  expect(offer).toBeTruthy()
  const target = (offer!.targeting.options as Record<string, any>[]).find(candidate => candidate.label === 'Sprig')
  expect(target?.enabled).toBe(true)

  const activityId = id('item-activity:v1:')
  const started = await parseOk(await page.request.post('/api/items/extended-actions', {
    data: {
      command: {
        schemaVersion: 1, kind: 'start', operationId: id('item-activity-operation:v1:'), activityId,
        settlementOperationId: id('sheet-item:v1:'), trainerSlug, trainerRevision,
        offerId: offer!.offerId, targetIds: [target!.targetId],
      },
      clientId: 'playwright-guided-poultices',
    },
  }))
  expect(started.result).toMatchObject({ status: 'in-progress', revision: 0 })
  const completed = await parseOk(await page.request.post('/api/items/extended-actions', {
    data: {
      command: { schemaVersion: 1, kind: 'complete', operationId: id('item-activity-operation:v1:'), activityId, expectedRevision: 0 },
      clientId: 'playwright-guided-poultices',
    },
  }))
  expect(completed.result).toMatchObject({ status: 'completed', itemResult: { status: 'pending', canonicalItemId: 'Poultices' } })

  const beforeTrainer = await parseOk(await page.request.get(`/api/sheets/load?kind=trainer&slug=${trainerSlug}`))
  const beforePokemon = await parseOk(await page.request.get(`/api/sheets/load?kind=pokemon&slug=${pokemonSlug}`))
  expect(beforeTrainer.sheet.inventory.medicalKit.find((row: any) => row.id === rowId)?.qty).toBe(1)
  expect(beforePokemon.sheet.combat.currentHp).toBe(initialHp)
  expect(beforePokemon.sheet.loyalty).toBe(3)
  expect(beforePokemon.sheet.itemMedicalTreatmentProjection ?? []).toHaveLength(0)

  await page.goto('/campaign')
  const workshop = page.getByRole('region', { name: 'Guided item adjudication' })
  await expect(workshop).toBeVisible()
  await expect(workshop).toContainText('1 pending')
  await expect(workshop).toContainText('Poultices')
  await expect(workshop).toContainText('Item reserved')
  await expect(workshop.getByText('Record use; no Loyalty Rank change', { exact: true })).toBeVisible()
  await expect(workshop.getByText('Lower Loyalty by 1')).toBeVisible()
  await expect(workshop).toContainText('No deterministic effect, Loyalty change, action cost, or inventory consumption occurs until the GM accepts.')
  await expect(workshop).not.toContainText(activityId)
  await expect(workshop).not.toContainText(rowId)
  await expect(workshop).not.toContainText('sha256')

  const layoutColumns = await workshop.locator('.guided-workshop__layout').evaluate(element => getComputedStyle(element).gridTemplateColumns)
  if (testInfo.project.name.includes('mobile')) expect(layoutColumns.trim().split(/\s+/)).toHaveLength(1)
  else expect(layoutColumns.trim().split(/\s+/)).toHaveLength(2)
  const bounds = await workshop.boundingBox()
  expect(bounds).not.toBeNull()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(await page.evaluate(() => window.innerWidth))
  expect((await new AxeBuilder({ page }).include('.guided-workshop').analyze()).violations).toEqual([])

  await expect(workshop.getByRole('radio').first()).toBeChecked()
  await workshop.getByRole('button', { name: 'Accept record use; no loyalty rank change outcome' }).click()
  await expect(workshop).toContainText('No guided item decisions are waiting.')

  const afterTrainer = await parseOk(await page.request.get(`/api/sheets/load?kind=trainer&slug=${trainerSlug}`))
  const afterPokemon = await parseOk(await page.request.get(`/api/sheets/load?kind=pokemon&slug=${pokemonSlug}`))
  expect(afterTrainer.sheet.inventory.medicalKit.find((row: any) => row.id === rowId)).toBeUndefined()
  expect(afterPokemon.sheet.loyalty).toBe(3)
  expect(afterPokemon.sheet.itemMedicalTreatmentProjection).toHaveLength(1)
  await testInfo.attach('guided-item-adjudication', {
    body: await workshop.screenshot({ animations: 'disabled' }), contentType: 'image/png',
  })
})
