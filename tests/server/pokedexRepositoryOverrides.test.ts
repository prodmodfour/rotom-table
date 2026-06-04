import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PokedexRecord } from '~/types/pokemon'

const originalCampaignRoot = process.env.ROTOM_CAMPAIGN_ROOT
const appPokedexPath = resolve(process.cwd(), 'data/reference/pokedex.json')

let tempRoot: string

const restoreCampaignRoot = (): void => {
  if (originalCampaignRoot === undefined) delete process.env.ROTOM_CAMPAIGN_ROOT
  else process.env.ROTOM_CAMPAIGN_ROOT = originalCampaignRoot
}

describe('Pokédex campaign reference overrides', () => {
  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'rotom-pokedex-overrides-'))
    process.env.ROTOM_CAMPAIGN_ROOT = tempRoot
    vi.resetModules()
  })

  afterEach(() => {
    restoreCampaignRoot()
    vi.resetModules()
    rmSync(tempRoot, { recursive: true, force: true })
  })

  it('writes GM Pokédex maintenance to the campaign override diff instead of app reference JSON', async () => {
    const appReferenceBefore = readFileSync(appPokedexPath, 'utf8')
    const repository = await import('../../server/utils/pokedexRepository')

    const currentEntry = repository.findPokedexEntryDetail('pikachu')
    expect(currentEntry).not.toBeNull()

    const updatedRecord: PokedexRecord = {
      ...(currentEntry as PokedexRecord),
      source_gen: 'campaign-override-test',
    }
    const result = repository.replacePokedexEntryBySlug('pikachu', updatedRecord)

    expect(result).toMatchObject({
      path: 'data/reference-overrides/pokedex.json',
      entry: expect.objectContaining({
        species: 'Pikachu',
        source_gen: 'campaign-override-test',
      }),
    })
    expect(readFileSync(appPokedexPath, 'utf8')).toBe(appReferenceBefore)

    const overridePath = join(tempRoot, 'data/reference-overrides/pokedex.json')
    const overrideFile = JSON.parse(readFileSync(overridePath, 'utf8')) as {
      version: number
      entries: Record<string, PokedexRecord>
    }

    expect(overrideFile.version).toBe(1)
    expect(overrideFile.entries.pikachu).toMatchObject({
      species: 'Pikachu',
      source_gen: 'campaign-override-test',
    })
    expect(repository.findPokedexEntryDetail('pikachu')).toMatchObject({
      species: 'Pikachu',
      source_gen: 'campaign-override-test',
    })
  })

  it('removes a campaign override entry when the persisted record matches the app reference again', async () => {
    const repository = await import('../../server/utils/pokedexRepository')
    const baseEntry = repository.findPokedexEntryDetail('pikachu')
    expect(baseEntry).not.toBeNull()

    repository.replacePokedexEntryBySlug('pikachu', {
      ...(baseEntry as PokedexRecord),
      source_gen: 'campaign-override-test',
    })
    repository.replacePokedexEntryBySlug('pikachu', baseEntry as PokedexRecord)

    const overridePath = join(tempRoot, 'data/reference-overrides/pokedex.json')
    expect(existsSync(overridePath)).toBe(true)

    const overrideFile = JSON.parse(readFileSync(overridePath, 'utf8')) as {
      entries: Record<string, PokedexRecord>
    }
    expect(overrideFile.entries).not.toHaveProperty('pikachu')
    expect(repository.findPokedexEntryDetail('pikachu')).toMatchObject({
      species: 'Pikachu',
      source_gen: baseEntry!.source_gen,
    })
  })
})
