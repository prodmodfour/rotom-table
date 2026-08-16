import { randomBytes } from 'node:crypto'
import { expect, test, type APIResponse, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { itemInventoryInstanceId } from '#shared/itemAutomation/inventory'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'

const parseOk = async (response: APIResponse): Promise<Record<string, any>> => {
  const text = await response.text()
  expect(response.ok(), `${response.status()} ${text}`).toBe(true)
  return JSON.parse(text) as Record<string, any>
}
const unique = (prefix: string): string => `${prefix}-${randomBytes(6).toString('hex')}`
const operationId = (): string => `equipment-operation:v1:${randomBytes(16).toString('hex')}`
const authenticateGm = async (page: Page): Promise<void> => {
  await page.context().addCookies([{
    name: 'rotom-role', value: 'gm', url: 'http://127.0.0.1:3017', sameSite: 'Lax',
  }])
}

const createPokemon = async (page: Page, nickname: string): Promise<string> => {
  const created = await parseOk(await page.request.post('/api/sheets/create', { data: { kind: 'pokemon', folder: '' } }))
  const slug = String(created.slug)
  const loaded = await parseOk(await page.request.get(`/api/sheets/load?kind=pokemon&slug=${slug}`))
  await parseOk(await page.request.post('/api/sheets/save', {
    data: {
      kind: 'pokemon', slug, expectedRevision: loaded.sheet.revision, interactionMode: 'setup-edit',
      sheet: {
        ...loaded.sheet,
        nickname, species: 'Charizard', level: 40, types: ['Fire', 'Flying'],
        abilities: [{ name: 'Blaze' }], movelist: [{ name: 'Ember' }],
        stats: {
          hp: { added: 2 }, atk: { added: 3 }, def: { added: 2 },
          satk: { added: 4 }, sdef: { added: 2 }, spd: { added: 3 },
        },
        combat: { currentHp: 72 },
      },
    },
  }))
  return slug
}

const createTrainer = async (page: Page, pokemonSlug: string, name: string) => {
  const ringRowId = unique('mega-ring-row')
  const stoneRowId = unique('mega-stone-row')
  const created = await parseOk(await page.request.post('/api/sheets/create', { data: { kind: 'trainer', folder: '' } }))
  const slug = String(created.slug)
  const loaded = await parseOk(await page.request.get(`/api/sheets/load?kind=trainer&slug=${slug}`))
  await parseOk(await page.request.post('/api/sheets/save', {
    data: {
      kind: 'trainer', slug, expectedRevision: loaded.sheet.revision, interactionMode: 'setup-edit',
      sheet: {
        ...loaded.sheet,
        name, level: 20, currentHp: 60, currentTeam: [pokemonSlug],
        inventory: {
          ...(loaded.sheet.inventory ?? {}),
          equipment: [{ id: ringRowId, name: 'Mega Ring', qty: 1 }],
          pokemonItems: [{ id: stoneRowId, name: 'Mega Stone', qty: 1 }],
        },
      },
    },
  }))
  return { slug, ringRowId, stoneRowId }
}

const equipSources = async (page: Page, input: {
  trainerSlug: string
  pokemonSlug: string
  ringRowId: string
  stoneRowId: string
}) => {
  let trainer = (await parseOk(await page.request.get(
    `/api/sheets/load?kind=trainer&slug=${input.trainerSlug}`,
  ))).sheet
  let pokemon = (await parseOk(await page.request.get(
    `/api/sheets/load?kind=pokemon&slug=${input.pokemonSlug}`,
  ))).sheet
  await parseOk(await page.request.post('/api/equipment/operations', {
    data: { command: {
      schemaVersion: 1, operationId: operationId(), commandKind: 'equip', actorProfileId: null,
      source: {
        kind: 'inventory', containerKind: 'trainer', containerSlug: input.trainerSlug,
        section: 'equipment', rowId: input.ringRowId,
        sourceInstanceId: itemInventoryInstanceId({
          containerKind: 'trainer', containerSlug: input.trainerSlug,
          section: 'equipment', rowId: input.ringRowId,
        }),
        expectedRevision: trainer.revision,
      },
      destination: {
        kind: 'equipment', ownerKind: 'trainer', ownerSlug: input.trainerSlug,
        slotIds: ['accessory'], expectedSheetRevision: trainer.revision,
        expectedEquipmentRevision: trainer.equipmentState?.revision ?? 0,
      },
      replacedInstanceId: null, swapReturnDestination: null, configuration: null,
    } },
  }))
  trainer = (await parseOk(await page.request.get(
    `/api/sheets/load?kind=trainer&slug=${input.trainerSlug}`,
  ))).sheet
  pokemon = (await parseOk(await page.request.get(
    `/api/sheets/load?kind=pokemon&slug=${input.pokemonSlug}`,
  ))).sheet
  await parseOk(await page.request.post('/api/equipment/operations', {
    data: { command: {
      schemaVersion: 1, operationId: operationId(), commandKind: 'give', actorProfileId: null,
      source: {
        kind: 'inventory', containerKind: 'trainer', containerSlug: input.trainerSlug,
        section: 'pokemonItems', rowId: input.stoneRowId,
        sourceInstanceId: itemInventoryInstanceId({
          containerKind: 'trainer', containerSlug: input.trainerSlug,
          section: 'pokemonItems', rowId: input.stoneRowId,
        }),
        expectedRevision: trainer.revision,
      },
      destination: {
        kind: 'equipment', ownerKind: 'pokemon', ownerSlug: input.pokemonSlug,
        slotIds: ['held'], expectedSheetRevision: pokemon.revision,
        expectedEquipmentRevision: pokemon.equipmentState?.revision ?? 0,
      },
      replacedInstanceId: null, swapReturnDestination: null,
      configuration: {
        schemaVersion: 1, configurationId: 'equipment.mega-stone.v1',
        values: { baseSpeciesId: 'Charizard', megaFormSpeciesId: 'mega-charizard-x' },
      },
    } },
  }))
}

const createLiveMap = async (page: Page, input: {
  trainerSlug: string
  pokemonSlug: string
  trainerPlacementId: string
  pokemonPlacementId: string
}) => {
  const created = await parseOk(await page.request.post('/api/maps/create', {
    data: { name: unique('Mega Arena'), dimensions: { x: 8, y: 2, z: 8 } },
  }))
  const map = created.map as Record<string, any>
  const slug = String(map.slug)
  await parseOk(await page.request.post('/api/maps/interaction-mode', {
    data: { slug, interactionMode: 'setup-edit' },
  }))
  const saved = await parseOk(await page.request.post('/api/maps/save', {
    data: {
      slug, interactionMode: 'setup-edit', expectedRevision: map.revision,
      map: {
        ...map,
        playerVisible: true,
        placements: [{
          id: input.trainerPlacementId, sheetKind: 'trainer', sheetSlug: input.trainerSlug,
          position: { x: 2, y: 0, z: 2 }, sideId: 'heroes', initiative: 14,
        }, {
          id: input.pokemonPlacementId, sheetKind: 'pokemon', sheetSlug: input.pokemonSlug,
          position: { x: 3, y: 0, z: 2 }, sideId: 'heroes', initiative: 13,
        }],
        activeScene: { name: 'Finale', startedAt: Date.now() },
        initiative: { activeId: input.trainerPlacementId, round: 2 },
        encounterState: {
          ...createEmptyEncounterState(),
          sides: {
            heroes: { id: 'heroes', label: 'Heroes', status: 'active', color: '#3ba7bf' },
          },
        },
      },
    },
  }))
  await parseOk(await page.request.post('/api/maps/interaction-mode', {
    data: { slug, interactionMode: 'live-play' },
  }))
  return { slug, revision: saved.map?.revision ?? saved.revision }
}

test('Mega Evolution previews, accepts once, converges, and reverses at Scene end', async ({ page, browser }, testInfo) => {
  test.setTimeout(150_000)
  await authenticateGm(page)
  const nickname = unique('Emberwing')
  const trainerName = unique('Alex')
  const pokemonSlug = await createPokemon(page, nickname)
  const trainer = await createTrainer(page, pokemonSlug, trainerName)
  const profileName = unique('Mega Player')
  const createdProfile = await parseOk(await page.request.post('/api/player-profiles/create', {
    data: { displayName: profileName },
  }))
  await parseOk(await page.request.post('/api/player-profiles/update', {
    data: {
      profileId: createdProfile.profile.id,
      displayName: profileName,
      linkedCharacters: [
        { sheetKind: 'trainer', sheetSlug: trainer.slug },
        { sheetKind: 'pokemon', sheetSlug: pokemonSlug },
      ],
    },
  }))
  await equipSources(page, {
    trainerSlug: trainer.slug, pokemonSlug,
    ringRowId: trainer.ringRowId, stoneRowId: trainer.stoneRowId,
  })
  const trainerPlacementId = unique('mega-trainer-token')
  const pokemonPlacementId = unique('mega-charizard-token')
  const live = await createLiveMap(page, {
    trainerSlug: trainer.slug, pokemonSlug, trainerPlacementId, pokemonPlacementId,
  })

  const playerContext = await browser.newContext()
  const player = await playerContext.newPage()
  await player.goto('/login')
  await player.getByRole('button', { name: /Player Login/ }).click()
  await player.getByRole('button', { name: new RegExp(profileName) }).click()
  await expect(player).toHaveURL(/\/maps(?:\?|$)/)

  await Promise.all([page.goto(`/play/${live.slug}`), player.goto(`/play/${live.slug}`)])
  await Promise.all([
    expect(page.getByRole('navigation', { name: 'Encounter workspace' })).toBeVisible(),
    expect(player.getByRole('navigation', { name: 'Encounter workspace' })).toBeVisible(),
  ])
  await page.getByRole('button', { name: 'Inventory', exact: true }).click()
  const chooseMega = page.getByRole('button', { name: /Mega Evolve, Swift Action.*available/i })
  await expect(chooseMega).toBeVisible()
  await chooseMega.click()

  const decision = page.locator('.encounter-decision-layer')
  await expect(decision.getByRole('heading', { name: 'Mega Evolve' })).toBeVisible()
  await expect(decision).toContainText('Scene transformation')
  await expect(decision).toContainText('Charizard')
  await expect(decision).toContainText('Mega Charizard X')
  await expect(decision).toContainText('Fire / Flying')
  await expect(decision).toContainText('Fire / Dragon')
  await expect(decision).toContainText('Tough Claws')
  await expect(decision).toContainText('Attack')
  await expect(decision).toContainText('+5')
  await expect(decision).toContainText('HP does not change')
  await expect(decision).toContainText('Reverts automatically when the Scene ends')
  await expect(decision).toContainText('No change until accepted')
  const accessibility = await new AxeBuilder({ page }).include('.encounter-decision-layer').analyze()
  expect(accessibility.violations).toEqual([])
  const previewColumns = await decision.locator('.encounter-decision-layer__form-preview').evaluate(element => (
    getComputedStyle(element).gridTemplateColumns
  ))
  if (testInfo.project.name.includes('mobile')) expect(previewColumns.trim().split(/\s+/)).toHaveLength(1)
  else expect(previewColumns.trim().split(/\s+/).length).toBe(2)
  await testInfo.attach('mega-evolution-preview', {
    body: await decision.screenshot({ animations: 'disabled' }), contentType: 'image/png',
  })

  const before = await parseOk(await page.request.get(`/api/maps/live-state?slug=${live.slug}`))
  expect(before.map.encounterState?.itemFormChanges).toBeUndefined()
  const beforePokemon = await parseOk(await page.request.get(`/api/sheets/load?kind=pokemon&slug=${pokemonSlug}`))
  expect(beforePokemon.sheet).toMatchObject({ species: 'Charizard', combat: { currentHp: 72 } })

  await decision.getByRole('button', { name: 'Mega Evolve', exact: true }).click()
  await expect(page.getByText(new RegExp(`${nickname} became Mega Charizard X for this Scene`))).toBeVisible()
  const activeFormTokenName = new RegExp(`${nickname} Mega Charizard X`)
  await Promise.all([
    expect(page.getByRole('button', { name: activeFormTokenName })).toBeVisible(),
    expect(player.getByRole('button', { name: activeFormTokenName })).toBeVisible({ timeout: 20_000 }),
  ])
  const accepted = await parseOk(await page.request.get(`/api/maps/live-state?slug=${live.slug}`))
  expect(accepted.map.encounterState.itemFormChanges.entries).toEqual([
    expect.objectContaining({
      placementId: pokemonPlacementId, pokemonSheetSlug: pokemonSlug,
      trainerSheetSlug: trainer.slug, formId: 'mega-charizard-x', abilityId: 'Tough Claws',
      duration: expect.objectContaining({ kind: 'scene' }),
    }),
  ])
  expect(accepted.map.encounterState.turnResources[trainerPlacementId].actions.swift.spent).toBe(1)
  expect(accepted.map.placements.find((row: any) => row.id === pokemonPlacementId).initiative).toBe(13)
  const acceptedPokemon = await parseOk(await page.request.get(`/api/sheets/load?kind=pokemon&slug=${pokemonSlug}`))
  expect(acceptedPokemon.sheet).toMatchObject({ species: 'Charizard', combat: { currentHp: 72 } })
  const playerSnapshot = await parseOk(await player.request.get(`/api/maps/live-state?slug=${live.slug}`))
  const playerSnapshotJson = JSON.stringify(playerSnapshot)
  expect(playerSnapshot.map.encounterState?.itemFormChanges).toBeUndefined()
  expect(playerSnapshot.mapRevision).toBe(accepted.mapRevision)
  expect(JSON.stringify(playerSnapshot.encounterPresentation)).toContain('Mega Charizard X')
  expect(playerSnapshotJson).not.toContain('ringInstanceId')
  expect(playerSnapshotJson).not.toContain('stoneInstanceId')
  expect(playerSnapshotJson).not.toContain('sourceOperationId')
  expect(playerSnapshotJson).not.toContain('canonicalRecordSha256')

  await player.reload()
  await expect(player.getByRole('navigation', { name: 'Encounter workspace' })).toBeVisible()
  await expect(player.getByRole('button', { name: activeFormTokenName })).toBeVisible()

  await parseOk(await page.request.post('/api/maps/scene/set', { data: {
    schemaVersion: 1,
    opId: `op_${randomBytes(10).toString('hex')}`,
    mapSlug: live.slug,
    baseRevision: accepted.mapRevision,
    type: 'setScene',
    scopes: [{ kind: 'map', lane: 'scene' }],
    payload: { name: null },
  } }))
  await Promise.all([
    expect(page.getByText('Mega Charizard X', { exact: true })).toHaveCount(0),
    expect(player.getByText('Mega Charizard X', { exact: true })).toHaveCount(0),
  ])
  const ended = await parseOk(await page.request.get(`/api/maps/live-state?slug=${live.slug}`))
  expect(ended.map.activeScene).toBeUndefined()
  expect(ended.map.encounterState.itemFormChanges.entries).toEqual([])
  expect(JSON.stringify(ended.encounterPresentation)).not.toContain('ringInstanceId')
  expect(JSON.stringify(ended.encounterPresentation)).not.toContain('stoneInstanceId')
  expect(JSON.stringify(ended.encounterPresentation)).not.toContain('sourceOperationId')
  await playerContext.close()
})
