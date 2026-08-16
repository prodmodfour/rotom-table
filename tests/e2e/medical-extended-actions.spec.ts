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

test('Bandages application projects active treatment status in liveplay without private evidence', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  await authenticateGm(page)

  const pokemonCreated = await parseOk(await page.request.post('/api/sheets/create', {
    data: { kind: 'pokemon', folder: '' },
  }))
  const pokemonSlug = String(pokemonCreated.slug)
  const pokemonLoaded = await parseOk(await page.request.get(`/api/sheets/load?kind=pokemon&slug=${pokemonSlug}`))
  const pokemon = pokemonLoaded.sheet as Record<string, any>
  await parseOk(await page.request.post('/api/sheets/save', {
    data: {
      kind: 'pokemon', slug: pokemonSlug, expectedRevision: pokemon.revision,
      interactionMode: 'setup-edit',
      sheet: {
        ...pokemon,
        nickname: 'Volt', species: 'Pikachu', level: 10,
        stats: { ...(pokemon.stats ?? {}), hp: { ...((pokemon.stats ?? {}).hp ?? {}), added: 0 } },
        combat: { ...(pokemon.combat ?? {}), currentHp: 1, injuries: 2, conditions: [] },
      },
    },
  }))

  const trainerCreated = await parseOk(await page.request.post('/api/sheets/create', {
    data: { kind: 'trainer', folder: '' },
  }))
  const trainerSlug = String(trainerCreated.slug)
  const trainerLoaded = await parseOk(await page.request.get(`/api/sheets/load?kind=trainer&slug=${trainerSlug}`))
  const trainer = trainerLoaded.sheet as Record<string, any>
  const savedTrainer = await parseOk(await page.request.post('/api/sheets/save', {
    data: {
      kind: 'trainer', slug: trainerSlug, expectedRevision: trainer.revision,
      interactionMode: 'setup-edit',
      sheet: {
        ...trainer,
        name: 'Rook', level: 10, currentTeam: [pokemonSlug], ap: { max: 7 },
        inventory: {
          ...(trainer.inventory ?? {}),
          medicalKit: [{ id: `bandages-${randomBytes(8).toString('hex')}`, name: 'Bandages', qty: 1 }],
        },
      },
    },
  }))
  const trainerRevision = Number((savedTrainer.sheet as Record<string, any>).revision)

  const actions = await parseOk(await page.request.get(`/api/items/sheet-actions?trainerSlug=${trainerSlug}`))
  const offer = (actions.offers as Record<string, any>[]).find(candidate => candidate.source?.canonicalId === 'Bandages')
  expect(offer).toBeTruthy()
  const target = (offer!.targeting.options as Record<string, any>[]).find(candidate => candidate.label === 'Volt')
  expect(target?.enabled).toBe(true)

  const activityId = id('item-activity:v1:')
  const start = await parseOk(await page.request.post('/api/items/extended-actions', {
    data: {
      command: {
        schemaVersion: 1,
        kind: 'start',
        operationId: id('item-activity-operation:v1:'),
        activityId,
        settlementOperationId: id('sheet-item:v1:'),
        trainerSlug,
        trainerRevision,
        offerId: offer!.offerId,
        targetIds: [target!.targetId],
      },
      clientId: 'playwright-medical-status',
    },
  }))
  expect(start.result).toMatchObject({ status: 'in-progress', revision: 0 })

  const completeCommand = {
    schemaVersion: 1,
    kind: 'complete',
    operationId: id('item-activity-operation:v1:'),
    activityId,
    expectedRevision: 0,
  }
  const completed = await parseOk(await page.request.post('/api/items/extended-actions', {
    data: { command: completeCommand, clientId: 'playwright-medical-status' },
  }))
  expect(completed.result).toMatchObject({
    status: 'completed', exactReplay: false,
    itemResult: { status: 'accepted', canonicalItemId: 'Bandages', exactReplay: false },
  })
  const replayed = await parseOk(await page.request.post('/api/items/extended-actions', {
    data: { command: completeCommand, clientId: 'playwright-medical-status' },
  }))
  expect(replayed.result).toMatchObject({
    status: 'completed', exactReplay: true,
    itemResult: { status: 'accepted', canonicalItemId: 'Bandages', exactReplay: true },
  })

  const reloaded = await parseOk(await page.request.get(`/api/sheets/load?kind=pokemon&slug=${pokemonSlug}`))
  expect(reloaded.sheet.itemMedicalTreatmentProjection).toHaveLength(1)
  expect(reloaded.sheet.itemMedicalTreatmentProjection?.[0]).toMatchObject({
    itemLabel: 'Bandages', status: 'active', elapsedMinutes: 0, remainingMinutes: 360,
  })

  await page.goto(`/sheets/${pokemonSlug}`)
  await expect(page.getByRole('button', { name: 'Healing' })).toBeVisible()
  await page.getByRole('button', { name: 'Healing' }).click()
  const status = page.getByLabel('Bandages active')
  await expect(status).toBeVisible()
  await expect(status).toContainText('Minute 0 → 360')
  await expect(status).toContainText('0 of 360 minutes')
  await expect(status).toContainText('0 / 12')
  await expect(status).toContainText('Any HP loss stops this treatment.')
  await expect(status.locator('button')).toHaveCount(0)
  await expect(status).not.toContainText('equipped-item:v1:')
  await expect(status).not.toContainText('sheet-item:v1:')
  await expect(status).not.toContainText('canonicalDefinitionSha256')

  const progress = status.locator('progress')
  await expect(progress).toHaveAttribute('value', '0')
  await expect(progress).toHaveAttribute('max', '360')
  const columns = await status.locator('.medical-treatment__facts').evaluate(element => getComputedStyle(element).gridTemplateColumns)
  if (testInfo.project.name.includes('mobile')) expect(columns.trim().split(/\s+/)).toHaveLength(1)
  else expect(columns.trim().split(/\s+/)).toHaveLength(2)
  const bounds = await status.boundingBox()
  expect(bounds).not.toBeNull()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(await page.evaluate(() => window.innerWidth))

  const accessibility = await new AxeBuilder({ page }).include('.medical-treatment').analyze()
  expect(accessibility.violations).toEqual([])
  await testInfo.attach('bandages-treatment-status', {
    body: await status.screenshot({ animations: 'disabled' }),
    contentType: 'image/png',
  })
})

test('First Aid activity reconnects, fails stale completion, and exact-replays safe interruption', async ({ page }) => {
  test.setTimeout(90_000)
  await authenticateGm(page)

  const pokemonCreated = await parseOk(await page.request.post('/api/sheets/create', {
    data: { kind: 'pokemon', folder: '' },
  }))
  const pokemonSlug = String(pokemonCreated.slug)
  const pokemonLoaded = await parseOk(await page.request.get(`/api/sheets/load?kind=pokemon&slug=${pokemonSlug}`))
  const pokemon = pokemonLoaded.sheet as Record<string, any>
  await parseOk(await page.request.post('/api/sheets/save', {
    data: {
      kind: 'pokemon', slug: pokemonSlug, expectedRevision: pokemon.revision,
      interactionMode: 'setup-edit',
      sheet: {
        ...pokemon,
        nickname: 'Mend', species: 'Pikachu', level: 10,
        combat: { ...(pokemon.combat ?? {}), currentHp: 1, injuries: 1, conditions: ['Burned'] },
      },
    },
  }))

  const trainerCreated = await parseOk(await page.request.post('/api/sheets/create', {
    data: { kind: 'trainer', folder: '' },
  }))
  const trainerSlug = String(trainerCreated.slug)
  const trainerLoaded = await parseOk(await page.request.get(`/api/sheets/load?kind=trainer&slug=${trainerSlug}`))
  const trainer = trainerLoaded.sheet as Record<string, any>
  const sourceId = `first-aid-${randomBytes(8).toString('hex')}`
  const savedTrainer = await parseOk(await page.request.post('/api/sheets/save', {
    data: {
      kind: 'trainer', slug: trainerSlug, expectedRevision: trainer.revision,
      interactionMode: 'setup-edit',
      sheet: {
        ...trainer,
        name: 'Iris', level: 10, currentTeam: [pokemonSlug],
        inventory: {
          ...(trainer.inventory ?? {}),
          medicalKit: [{ id: sourceId, name: 'First Aid Kit', qty: 1 }],
        },
      },
    },
  }))
  const trainerRevision = Number((savedTrainer.sheet as Record<string, any>).revision)

  const actions = await parseOk(await page.request.get(`/api/items/sheet-actions?trainerSlug=${trainerSlug}`))
  const offer = (actions.offers as Record<string, any>[]).find(candidate => candidate.source?.canonicalId === 'First Aid Kit')
  expect(offer).toBeTruthy()
  const target = (offer!.targeting.options as Record<string, any>[]).find(candidate => candidate.label === 'Mend')
  expect(target?.enabled).toBe(true)

  const activityId = id('item-activity:v1:')
  const startCommand = {
    schemaVersion: 1,
    kind: 'start',
    operationId: id('item-activity-operation:v1:'),
    activityId,
    settlementOperationId: id('sheet-item:v1:'),
    trainerSlug,
    trainerRevision,
    offerId: offer!.offerId,
    targetIds: [target!.targetId],
  }
  const started = await parseOk(await page.request.post('/api/items/extended-actions', {
    data: { command: startCommand, clientId: 'playwright-medical-recovery' },
  }))
  expect(started.result).toMatchObject({ status: 'in-progress', revision: 0, exactReplay: false })
  const startReplay = await parseOk(await page.request.post('/api/items/extended-actions', {
    data: { command: startCommand, clientId: 'playwright-medical-recovery' },
  }))
  expect(startReplay.result).toMatchObject({ status: 'in-progress', revision: 0, exactReplay: true })

  await page.goto(`/sheets/trainers/${trainerSlug}`)
  await page.getByRole('button', { name: 'Inventory', exact: true }).click()
  const inProgress = page.getByRole('heading', { name: 'Treatment in progress' })
  await expect(inProgress).toBeVisible()
  await expect(page.locator('.extended-treatment')).toContainText('No mechanics applied')
  await page.reload()
  await page.getByRole('button', { name: 'Inventory', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Treatment in progress' })).toBeVisible()

  const staleCompletion = await page.request.post('/api/items/extended-actions', {
    data: {
      command: {
        schemaVersion: 1,
        kind: 'complete',
        operationId: id('item-activity-operation:v1:'),
        activityId,
        expectedRevision: 1,
      },
      clientId: 'playwright-medical-recovery',
    },
  })
  expect(staleCompletion.status()).toBe(409)
  expect(await staleCompletion.text()).toContain('changed')
  const durable = await parseOk(await page.request.get(`/api/items/extended-actions?trainerSlug=${trainerSlug}`))
  expect((durable as unknown as Record<string, any>[]).find(row => row.activityId === activityId))
    .toMatchObject({ status: 'in-progress', revision: 0 })

  const interruptCommand = {
    schemaVersion: 1,
    kind: 'interrupt',
    operationId: id('item-activity-operation:v1:'),
    activityId,
    expectedRevision: 0,
    reason: 'user-cancelled',
  }
  const interrupted = await parseOk(await page.request.post('/api/items/extended-actions', {
    data: { command: interruptCommand, clientId: 'playwright-medical-recovery' },
  }))
  expect(interrupted.result).toMatchObject({ status: 'interrupted', revision: 1, exactReplay: false, itemResult: null })
  const interruptReplay = await parseOk(await page.request.post('/api/items/extended-actions', {
    data: { command: interruptCommand, clientId: 'playwright-medical-recovery' },
  }))
  expect(interruptReplay.result).toMatchObject({ status: 'interrupted', revision: 1, exactReplay: true, itemResult: null })

  const finalTrainer = await parseOk(await page.request.get(`/api/sheets/load?kind=trainer&slug=${trainerSlug}`))
  const finalPokemon = await parseOk(await page.request.get(`/api/sheets/load?kind=pokemon&slug=${pokemonSlug}`))
  expect(finalTrainer.sheet.inventory.medicalKit).toEqual([{ id: sourceId, name: 'First Aid Kit', qty: 1 }])
  expect(finalTrainer.sheet.featureApState).toBeUndefined()
  expect(finalPokemon.sheet.combat).toMatchObject({ currentHp: 1, injuries: 1, conditions: ['Burned'] })

  await page.reload()
  await page.getByRole('button', { name: 'Inventory', exact: true }).click()
  const terminal = page.locator('.extended-treatment')
  await expect(page.getByRole('heading', { name: 'Treatment interrupted' })).toBeVisible()
  await expect(terminal).toContainText('before any item mechanics')
  await expect(terminal).not.toContainText('sheet-item:v1:')
  await expect(terminal).not.toContainText(sourceId)
  const accessibility = await new AxeBuilder({ page }).include('.extended-treatment').analyze()
  expect(accessibility.violations).toEqual([])
})
