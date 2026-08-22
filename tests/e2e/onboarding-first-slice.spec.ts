import { expect, test, type BrowserContext, type Page } from '@playwright/test'

const BASE_URL = 'http://127.0.0.1:3017'

const authenticate = async (context: BrowserContext, role: 'gm' | 'player'): Promise<void> => {
  await context.addCookies([{ name: 'rotom-role', value: role, url: BASE_URL, sameSite: 'Lax' }])
}

const PLAYER_NAME = `Slice Player ${Date.now().toString(36)}`

const clickAdd = async (page: Page, label: string, times: number): Promise<void> => {
  const button = page.getByRole('button', { name: label })
  for (let index = 0; index < times; index += 1) {
    await button.click()
  }
}

test.describe('guided onboarding first playable slice', () => {
  test('GM opens a slot, the player builds and submits, the GM approves an atomically linked package', async ({ browser }) => {
    test.setTimeout(300_000)

    /* ---------------- GM: publish policy ---------------- */
    const gmContext = await browser.newContext()
    await authenticate(gmContext, 'gm')
    const gm = await gmContext.newPage()

    await gm.goto('/onboarding/policy')
    await expect(gm.getByRole('heading', { name: 'Campaign onboarding policy' })).toBeVisible()
    await gm.getByLabel('Policy name').fill('First slice campaign')
    await gm.getByRole('button', { name: /Publish version/ }).click()
    await expect(gm.getByText(/Published a new policy version/)).toBeVisible()

    /* ---------------- GM: open a slot with a fresh profile ---------------- */
    await gm.goto('/onboarding')
    await expect(gm.getByRole('heading', { name: 'Onboarding queue' })).toBeVisible()
    await gm.getByLabel('New profile name').fill(PLAYER_NAME)
    await gm.getByRole('button', { name: 'Open onboarding slot' }).click()
    await expect(gm.getByText(PLAYER_NAME).first()).toBeVisible()

    /* ---------------- Player: resume and build ---------------- */
    const profiles = await gm.request.get('/api/player-profiles/list')
    const profileList = await profiles.json() as { profiles: { id: string, displayName: string }[] }
    const profile = profileList.profiles.find(candidate => candidate.displayName === PLAYER_NAME)
    expect(profile).toBeTruthy()

    const playerContext = await browser.newContext()
    await authenticate(playerContext, 'player')
    await playerContext.addInitScript(({ profileId, displayName }) => {
      window.localStorage.setItem('rotom:player-profile:selection', JSON.stringify({
        schemaVersion: 1,
        profileId,
        displayName,
        rememberedAt: new Date().toISOString(),
      }))
    }, { profileId: profile!.id, displayName: PLAYER_NAME })
    const player = await playerContext.newPage()

    await player.goto('/onboarding')
    await expect(player.getByRole('heading', { name: 'Your character' })).toBeVisible()
    await player.getByRole('link', { name: /Continue building/ }).click()
    await expect(player.getByRole('heading', { name: 'Trainer identity' })).toBeVisible()

    /* Identity */
    await player.getByLabel('Name *').fill('Rowan Vale')
    await player.getByLabel('Name *').blur()
    await expect(player.locator('.builder__top h1')).toContainText('Rowan Vale')

    /* Stats: hp+2 atk+1 def+2 satk+1 sdef+2 spd+2 */
    await player.getByRole('button', { name: 'Next: Stat points →' }).click()
    await clickAdd(player, 'Add point to HP', 2)
    await clickAdd(player, 'Add point to Attack', 1)
    await clickAdd(player, 'Add point to Defense', 2)
    await clickAdd(player, 'Add point to Sp. Attack', 1)
    await clickAdd(player, 'Add point to Sp. Defense', 2)
    await clickAdd(player, 'Add point to Speed', 2)
    await expect(player.getByText('0 left', { exact: false })).toBeVisible()

    /* Background: name + 1 adept, 1 novice, 3 pathetic */
    await player.getByRole('button', { name: /Next: Skill background/ }).click()
    await player.getByLabel('Background name *').fill('Ranch Hand')
    await player.getByLabel('Background name *').blur()
    await player.getByRole('button', { name: 'Pokémon Ed adept' }).click()
    await player.getByRole('button', { name: 'Command novice' }).click()
    await player.getByRole('button', { name: 'Charm pathetic' }).click()
    await player.getByRole('button', { name: 'Guile pathetic' }).click()
    await player.getByRole('button', { name: 'Intimidate pathetic' }).click()

    /* Training feature */
    await player.getByRole('button', { name: /Next: Training Feature/ }).click()
    await player.getByRole('button', { name: /Focused Training/ }).click()

    /* Edges */
    await player.getByRole('button', { name: /Next: Edges/ }).click()
    const searchEdges = player.getByPlaceholder('Search Edges…')
    await searchEdges.fill('Basic Skills')
    await player.getByRole('button', { name: 'Add', exact: true }).first().click()
    await player.getByLabel('Basic Skills skill').first().selectOption('athletics')
    await searchEdges.fill('Basic Skills')
    await player.getByRole('button', { name: 'Add', exact: true }).first().click()
    await player.getByLabel('Basic Skills skill').nth(1).selectOption('survival')
    await searchEdges.fill('Swimmer')
    await player.getByRole('button', { name: 'Add', exact: true }).first().click()
    await searchEdges.fill('Categoric')
    await player.getByRole('button', { name: 'Add', exact: true }).first().click()
    await player.getByLabel('Categoric Inclination category').selectOption('Body')
    await expect(player.getByText('0 slot(s) left')).toBeVisible()

    /* Features */
    await player.getByRole('button', { name: /Next: Features & classes/ }).click()
    const searchFeatures = player.getByPlaceholder('Search Features and classes…')
    for (const feature of ['Ace Trainer', 'Perseverance', 'Elite Trainer', 'Let Me Help You With That']) {
      await searchFeatures.fill(feature)
      await player.getByRole('button', { name: 'Add', exact: true }).first().click()
    }
    await expect(player.getByText('0 slot(s) left')).toBeVisible()

    /* Starter: species */
    await player.getByRole('button', { name: /Next: Starter 1: species/ }).click()
    await player.getByPlaceholder('Search species…').fill('Bulbasaur')
    await player.getByRole('button', { name: /Bulbasaur/ }).first().click()

    /* Starter: nature & identity */
    await player.getByRole('button', { name: /Next: Starter 1: nature & identity/ }).click()
    await player.getByLabel('Nickname').fill('Sprig')
    await player.getByLabel('Nature *').selectOption('Hardy')
    await player.getByRole('button', { name: /^Male/ }).click()

    /* Starter: ability */
    await player.getByRole('button', { name: /Next: Starter 1: ability/ }).click()
    await player.getByRole('button', { name: /Overgrow/ }).click()

    /* Starter: moves are auto-complete (2 available at Lv 5) */
    await player.getByRole('button', { name: /Next: Starter 1: moves/ }).click()
    await expect(player.getByText('All 2 are taken automatically.')).toBeVisible()

    /* Starter: stats hp+3 atk+1 def+1 satk+5 sdef+3 spd+2 */
    await player.getByRole('button', { name: /Next: Starter 1: stat points/ }).click()
    await clickAdd(player, 'Add point to HP', 3)
    await clickAdd(player, 'Add point to Attack', 1)
    await clickAdd(player, 'Add point to Defense', 1)
    await clickAdd(player, 'Add point to Sp. Attack', 5)
    await clickAdd(player, 'Add point to Sp. Defense', 3)
    await clickAdd(player, 'Add point to Speed', 2)
    await expect(player.getByText(/Max HP becomes/)).toContainText('39')

    /* Review and submit */
    await player.getByRole('button', { name: /Next: Review & submit/ }).click()
    await expect(player.getByRole('heading', { name: 'Review & submit' })).toBeVisible()
    await expect(player.getByText('Saved')).toBeVisible()
    const submitButton = player.getByRole('button', { name: 'Submit for GM review', exact: true })
    await expect(submitButton).toBeEnabled({ timeout: 15_000 })
    await submitButton.click()
    await expect(player.getByText(/waiting for the GM|Submitted/).first()).toBeVisible({ timeout: 15_000 })

    /* ---------------- GM: request changes (P9-054) ---------------- */
    await gm.goto('/onboarding')
    const queueRow = gm.locator('.onboarding-queue__row', { hasText: PLAYER_NAME })
    await expect(queueRow.getByText('Awaiting review', { exact: false })).toBeVisible({ timeout: 15_000 })
    await queueRow.getByRole('link', { name: 'Review' }).click()
    await expect(gm.getByRole('heading', { name: 'Review submission' })).toBeVisible()
    await expect(gm.getByText('Rowan Vale — submission #1')).toBeVisible()
    await gm.locator('details.review-changes > summary').click()
    await gm.getByRole('checkbox', { name: 'Flavor / tone' }).check()
    await gm.getByLabel('Comment to the player (optional)').fill('Give Sprig a bolder introduction.')
    await gm.getByLabel('GM-only note (never shown to the player)').fill('Secret pacing note.')
    await gm.getByRole('button', { name: 'Send change request' }).click()
    await gm.waitForURL('**/onboarding')

    /* Player sees the request (never the GM-only note), resubmits. */
    await player.reload()
    await expect(player.getByText(/requested changes/i).first()).toBeVisible({ timeout: 15_000 })
    await expect(player.getByText('Changes requested', { exact: false }).first()).toBeVisible()
    await expect(player.getByText('Give Sprig a bolder introduction.')).toBeVisible()
    await expect(player.getByText('Secret pacing note.')).toHaveCount(0)
    const resubmit = player.getByRole('button', { name: 'Resubmit for GM review', exact: true })
    await expect(resubmit).toBeEnabled()
    await resubmit.click()
    await expect(player.getByText(/waiting for the GM|Submitted/).first()).toBeVisible({ timeout: 15_000 })

    /* ---------------- GM: bounded correction + acknowledgement (P9-055) ---------------- */
    await gm.goto('/onboarding')
    await gm.locator('.onboarding-queue__row', { hasText: PLAYER_NAME }).getByRole('link', { name: 'Review' }).click()
    await expect(gm.getByText('Rowan Vale — submission #2')).toBeVisible({ timeout: 15_000 })
    await gm.getByLabel('Scope').selectOption('pokemon-nickname')
    await gm.getByLabel('New value').fill('Thistle')
    await gm.getByLabel('Rationale (shown to the player)').fill('Sprig collides with an NPC companion.')
    await gm.getByRole('button', { name: 'Apply correction' }).click()
    await expect(gm.getByText(/await the player's acknowledgement/)).toBeVisible({ timeout: 15_000 })
    await expect(gm.getByRole('button', { name: 'Approve & create package' })).toBeDisabled()

    await player.reload()
    await expect(player.getByText(/GM correction/).first()).toBeVisible({ timeout: 15_000 })
    await expect(player.getByText(/Sprig collides with an NPC companion/)).toBeVisible()
    await player.getByRole('button', { name: 'Acknowledge this correction' }).click()
    await expect(player.getByText('Acknowledged').first()).toBeVisible({ timeout: 15_000 })

    /* ---------------- GM: approve the corrected submission ---------------- */
    await gm.reload()
    await expect(gm.getByText('Rowan Vale — submission #3')).toBeVisible({ timeout: 15_000 })
    await expect(gm.getByText(/Thistle · Bulbasaur/)).toBeVisible()
    await expect(gm.getByText('No issues.', { exact: false })).toBeVisible()
    await expect(gm.getByText(/Create trainer sheet/)).toBeVisible()
    await gm.getByRole('button', { name: 'Approve & create package' }).click()
    await expect(gm.getByRole('heading', { name: 'Package created' })).toBeVisible({ timeout: 20_000 })

    /* The committed sheets are ordinary library citizens. */
    await gm.getByRole('link', { name: 'Trainer sheet' }).click()
    await expect(gm.getByText('Rowan Vale').first()).toBeVisible({ timeout: 15_000 })

    /* ---------------- Player: ready state and owned sheets ---------------- */
    await player.goto('/onboarding')
    await expect(player.getByRole('heading', { name: 'Ready for play' })).toBeVisible({ timeout: 15_000 })

    /* Player profile now links the package; the trainer portal shows it. */
    const overview = await player.request.get(`/api/onboarding/overview?profileId=${profile!.id}`)
    const home = await overview.json() as { completion: { refs: { trainerSlug: string, pokemonSlugs: string[] } } | null }
    expect(home.completion).toBeTruthy()
    expect(home.completion!.refs.pokemonSlugs).toHaveLength(1)

    const profilesAfter = await gm.request.get('/api/player-profiles/list')
    const listAfter = await profilesAfter.json() as { profiles: { id: string, linkedCharacters: unknown[] }[] }
    const linked = listAfter.profiles.find(candidate => candidate.id === profile!.id)
    expect(linked?.linkedCharacters).toHaveLength(2)

    /* ---------------- Encounter handoff and first legal action (P9-060/P9-074/P9-080) ---------------- */
    const parseOk = async (response: import('@playwright/test').APIResponse): Promise<Record<string, any>> => {
      const text = await response.text()
      expect(response.ok(), `${response.status()} ${text}`).toBe(true)
      return JSON.parse(text) as Record<string, any>
    }

    const createdMap = await parseOk(await gm.request.post('/api/maps/create', {
      data: { name: `Slice Arena ${Date.now().toString(36)}`, dimensions: { x: 8, y: 2, z: 8 } },
    }))
    const arena = createdMap.map as Record<string, any>
    await parseOk(await gm.request.post('/api/maps/interaction-mode', {
      data: { slug: arena.slug, interactionMode: 'setup-edit' },
    }))
    await parseOk(await gm.request.post('/api/maps/save', {
      data: {
        slug: arena.slug,
        expectedRevision: arena.revision,
        interactionMode: 'setup-edit',
        map: {
          ...arena,
          playerVisible: true,
          activeScene: { name: 'First bout', startedAt: Date.now() },
          encounterState: {
            ...(arena.encounterState ?? {}),
            sides: {
              heroes: { id: 'heroes', label: 'Heroes', status: 'active', color: '#34d399' },
              wild: { id: 'wild', label: 'Wild', status: 'active', color: '#ef4444' },
            },
          },
        },
      },
    }))

    /* GM places the onboarded party through the explicit join workflow UI. */
    await gm.goto('/onboarding')
    const joinPanel = gm.getByLabel('Send a party to an encounter', { exact: false })
    await expect(gm.getByRole('heading', { name: 'Send a party to an encounter' })).toBeVisible({ timeout: 15_000 })
    const joinForm = gm.locator('.party-join')
    await joinForm.getByRole('combobox', { name: 'Party', exact: true }).selectOption(String(home.completion!.refs.trainerSlug))
    await joinForm.getByRole('combobox', { name: 'Battlefield', exact: true }).selectOption(arena.slug)
    await joinForm.getByRole('combobox', { name: 'Side', exact: true }).selectOption('heroes')
    await gm.getByRole('button', { name: 'Place party' }).click()
    await expect(gm.getByText(/Placed 2 participant/)).toBeVisible({ timeout: 15_000 })
    void joinPanel

    /* Switch to live play; the player performs a legal first action. */
    await parseOk(await gm.request.post('/api/maps/interaction-mode', {
      data: { slug: arena.slug, interactionMode: 'live-play' },
    }))
    const loadedArena = await parseOk(await gm.request.get(`/api/maps/load?slug=${arena.slug}`))
    const arenaRevision = Number((loadedArena.map as Record<string, any>).revision)
    const pokemonSlug = String(home.completion!.refs.pokemonSlugs[0])
    const placementId = `onboarded-pokemon-${pokemonSlug}`

    const firstAction = await parseOk(await player.request.post('/api/maps/tokens/move', {
      data: {
        schemaVersion: 1,
        opId: `op_slice_first_action_${Date.now().toString(36)}`,
        mapSlug: arena.slug,
        baseRevision: arenaRevision,
        type: 'moveToken',
        scopes: [{ kind: 'token', placementId, field: 'position' }],
        payload: { placementId, position: { x: 4, y: 0, z: 4 } },
        profileId: profile!.id,
      },
    }))
    expect(firstAction.ok, JSON.stringify(firstAction)).toBe(true)

    /* Campaign dashboard reflects the ready state for the player (P9-080). */
    await player.goto('/campaign')
    await expect(player.getByText(/complete and ready for play/i)).toBeVisible({ timeout: 15_000 })

    await gmContext.close()
    await playerContext.close()
  })
})
