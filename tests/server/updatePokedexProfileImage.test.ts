import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const originalCampaignRoot = process.env.ROTOM_CAMPAIGN_ROOT
const onePixelPngDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII='

let tempRoot: string

const restoreCampaignRoot = (): void => {
  if (originalCampaignRoot === undefined) delete process.env.ROTOM_CAMPAIGN_ROOT
  else process.env.ROTOM_CAMPAIGN_ROOT = originalCampaignRoot
}

describe('updatePokedexProfileImageUseCase', () => {
  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'rotom-profile-image-'))
    process.env.ROTOM_CAMPAIGN_ROOT = tempRoot
    vi.resetModules()
  })

  afterEach(() => {
    restoreCampaignRoot()
    vi.resetModules()
    rmSync(tempRoot, { recursive: true, force: true })
  })

  it('writes a Pokémon profile image override under campaign assets', async () => {
    const { updatePokedexProfileImageUseCase } = await import('../../server/useCases/updatePokedexProfileImage')

    const result = updatePokedexProfileImageUseCase({
      slug: 'pikachu',
      imageDataUrl: onePixelPngDataUrl,
    })

    expect(result).toEqual({
      ok: true,
      path: 'assets/profile-sprites/pokemon/pikachu.png',
      species: 'Pikachu',
      profileImageSlug: 'pikachu',
      profileSpriteUrl: '/api/profile-sprites/pokemon/pikachu',
    })

    const writtenPath = join(tempRoot, 'assets/profile-sprites/pokemon/pikachu.png')
    expect(existsSync(writtenPath)).toBe(true)
    expect(readFileSync(writtenPath).subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  })

  it('uses the sprite-manifest slug for Pokédex form names', async () => {
    const { updatePokedexProfileImageUseCase } = await import('../../server/useCases/updatePokedexProfileImage')

    const result = updatePokedexProfileImageUseCase({
      slug: 'deoxys-attack-forme',
      imageDataUrl: onePixelPngDataUrl,
    })

    expect(result).toMatchObject({
      species: 'Deoxys Attack Forme',
      profileImageSlug: 'deoxys-attack',
      profileSpriteUrl: '/api/profile-sprites/pokemon/deoxys-attack',
    })
    expect(existsSync(join(tempRoot, 'assets/profile-sprites/pokemon/deoxys-attack.png'))).toBe(true)
  })

  it('rejects non-PNG image data', async () => {
    const { updatePokedexProfileImageUseCase, UpdatePokedexProfileImageUseCaseError } = await import('../../server/useCases/updatePokedexProfileImage')

    expect(() => updatePokedexProfileImageUseCase({
      slug: 'pikachu',
      imageDataUrl: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
    })).toThrow(UpdatePokedexProfileImageUseCaseError)
  })
})
