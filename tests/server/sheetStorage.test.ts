import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildDefaultSheet,
  findSheetFileBySlugInRoot,
  findSheetFileInRoot,
  isPlayerFolderPath,
  stripDerivedSheetFields,
  withDerivedSheetFolder,
} from '../../server/utils/sheetStorage'
import { pickRandomTrainerSpriteUrl } from '../../server/utils/trainerSprites'

describe('sheet storage helpers', () => {
  it('finds sheets by filename and by top-level slug fallback', () => {
    const root = mkdtempSync(join(tmpdir(), 'rotom-sheets-'))
    mkdirSync(join(root, 'nested'), { recursive: true })
    const filenameMatch = join(root, 'nested', 'bolt-pikachu.json')
    const slugFallback = join(root, 'nested', 'snake_case_filename.json')
    writeFileSync(filenameMatch, JSON.stringify({ slug: 'bolt-pikachu' }), 'utf8')
    writeFileSync(slugFallback, JSON.stringify({ slug: 'kebab-case-slug' }), 'utf8')

    expect(findSheetFileInRoot(root, 'bolt-pikachu')).toBe(filenameMatch)
    expect(findSheetFileInRoot(root, 'kebab-case-slug')).toBeNull()
    expect(findSheetFileBySlugInRoot(root, 'kebab-case-slug')).toBe(slugFallback)
  })

  it('derives runtime folder fields from sheet file paths', () => {
    const sheet = { slug: 'new-trainer-1', name: 'New Trainer', level: 1 }
    const withFolder = withDerivedSheetFolder(
      'trainer',
      join(process.cwd(), 'data/trainers/players/Hassan/new-trainer-1.json'),
      sheet,
    )

    expect(withFolder).toEqual({
      revision: 0,
      slug: 'new-trainer-1',
      name: 'New Trainer',
      level: 1,
      folder: 'players/Hassan',
    })
    expect(sheet).toEqual({ slug: 'new-trainer-1', name: 'New Trainer', level: 1 })
  })

  it('strips derived runtime fields without mutating the input sheet', () => {
    const sheet = {
      slug: 'example',
      folder: 'party/a',
      level: 5,
      sessionPlayerAccessible: true,
      playerProfileAccessible: true,
    }
    const persisted = stripDerivedSheetFields(sheet)

    expect(persisted).toEqual({ slug: 'example', level: 5 })
    expect(sheet).toEqual({
      slug: 'example',
      folder: 'party/a',
      level: 5,
      sessionPlayerAccessible: true,
      playerProfileAccessible: true,
    })
  })

  it('picks a random trainer sprite URL from available sprite options', () => {
    const sprites = [
      { spriteUrl: '/trainer-sprites/a.png' },
      { spriteUrl: '/trainer-sprites/b.png' },
      { spriteUrl: '/trainer-sprites/c.png' },
    ]

    expect(pickRandomTrainerSpriteUrl(sprites, () => 0)).toBe('/trainer-sprites/a.png')
    expect(pickRandomTrainerSpriteUrl(sprites, () => 0.5)).toBe('/trainer-sprites/b.png')
    expect(pickRandomTrainerSpriteUrl(sprites, () => 0.999)).toBe('/trainer-sprites/c.png')
  })

  it('builds default Pokémon sheets without a selected species', () => {
    expect(buildDefaultSheet('pokemon', 'new-pokemon')).toMatchObject({
      revision: 0,
      slug: 'new-pokemon',
      nickname: 'New Pokémon',
      species: '',
      level: 1,
      caughtBall: 'Basic Ball',
      player: false,
    })
  })

  it('includes a trainer portrait URL on newly built default trainer sheets', () => {
    const sheet = buildDefaultSheet('trainer', 'new-trainer')

    expect(sheet).toMatchObject({
      revision: 0,
      slug: 'new-trainer',
      name: 'New Trainer',
      level: 1,
      player: false,
    })
    expect(sheet.portraitUrl).toEqual(expect.stringMatching(/^\/trainer-sprites\//))
  })

  it('can mark newly built sheets as player-accessible', () => {
    expect(buildDefaultSheet('pokemon', 'new-pokemon', { playerAccessible: true })).toMatchObject({
      slug: 'new-pokemon',
      player: true,
    })
    expect(buildDefaultSheet('trainer', 'new-trainer', { playerAccessible: true })).toMatchObject({
      slug: 'new-trainer',
      player: true,
    })
  })

  it('treats sheets created under the top-level players folder as player-accessible', () => {
    expect(isPlayerFolderPath('players')).toBe(true)
    expect(isPlayerFolderPath('players/Hassan')).toBe(true)
    expect(isPlayerFolderPath('Players/Hassan')).toBe(true)
    expect(isPlayerFolderPath('npcs/players')).toBe(false)
    expect(isPlayerFolderPath('')).toBe(false)
  })
})
