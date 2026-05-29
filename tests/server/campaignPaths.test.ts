import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const ORIGINAL_CAMPAIGN_ROOT = process.env.ROTOM_CAMPAIGN_ROOT

const restoreEnv = () => {
  if (ORIGINAL_CAMPAIGN_ROOT === undefined) {
    delete process.env.ROTOM_CAMPAIGN_ROOT
  } else {
    process.env.ROTOM_CAMPAIGN_ROOT = ORIGINAL_CAMPAIGN_ROOT
  }
}

describe('campaign path configuration', () => {
  afterEach(() => {
    restoreEnv()
    vi.resetModules()
  })

  it('defaults campaign-owned paths to the app checkout', async () => {
    delete process.env.ROTOM_CAMPAIGN_ROOT
    vi.resetModules()

    const paths = await import('../../server/utils/campaignPaths')

    expect(paths.CAMPAIGN_ROOT).toBe(resolve(process.cwd()))
    expect(paths.CAMPAIGN_MAPS_ROOT).toBe(resolve(process.cwd(), 'data/maps'))
    expect(paths.CAMPAIGN_ENCOUNTER_TABLES_ROOT).toBe(resolve(process.cwd(), 'encounter_tables'))
  })

  it('resolves relative ROTOM_CAMPAIGN_ROOT values from the app checkout', async () => {
    process.env.ROTOM_CAMPAIGN_ROOT = '../helix-campaign'
    vi.resetModules()

    const paths = await import('../../server/utils/campaignPaths')
    const campaignRoot = resolve(process.cwd(), '../helix-campaign')

    expect(paths.CAMPAIGN_ROOT).toBe(campaignRoot)
    expect(paths.CAMPAIGN_TRAINER_SHEETS_ROOT).toBe(resolve(campaignRoot, 'data/trainers'))
    expect(paths.campaignPathLabel(resolve(campaignRoot, 'data/maps/atrium.json'))).toBe('data/maps/atrium.json')
  })

  it('expands home-relative ROTOM_CAMPAIGN_ROOT values', async () => {
    process.env.ROTOM_CAMPAIGN_ROOT = '~/helix-campaign'
    vi.resetModules()

    const paths = await import('../../server/utils/campaignPaths')

    expect(paths.CAMPAIGN_ROOT).toBe(resolve(homedir(), 'helix-campaign'))
  })

  it('resolves absolute ROTOM_CAMPAIGN_ROOT values as-is', async () => {
    const campaignRoot = resolve(process.cwd(), 'tmp/example-campaign')
    process.env.ROTOM_CAMPAIGN_ROOT = campaignRoot
    vi.resetModules()

    const paths = await import('../../server/utils/campaignPaths')

    expect(paths.CAMPAIGN_ROOT).toBe(campaignRoot)
    expect(paths.CAMPAIGN_POKEMON_SHEETS_ROOT).toBe(resolve(campaignRoot, 'data/sheets'))
    expect(paths.CAMPAIGN_ROOT_IS_EXTERNAL).toBe(true)
  })
})
