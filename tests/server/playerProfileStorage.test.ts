import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  PLAYER_PROFILE_SCHEMA_VERSION,
  parsePlayerProfileDisplayName,
  parsePlayerProfileId,
  type PlayerProfile,
} from '#shared/playerProfiles'
import {
  allocatePlayerProfileId,
  createPlayerProfile,
  listPlayerProfiles,
  playerProfileFilePathFor,
  readPlayerProfile,
  updatePlayerProfile,
} from '~~/server/utils/playerProfileStorage'

let roots: string[] = []

const tempRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'rotom-player-profiles-'))
  roots.push(root)
  return root
}

const writeProfile = (root: string, profile: PlayerProfile, fileName = `${profile.id}.json`): void => {
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, fileName), `${JSON.stringify(profile, null, 2)}\n`, 'utf8')
}

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
  roots = []
})

describe('player profile storage', () => {
  it('creates persistent profiles with safe stable IDs and lists them deterministically', () => {
    const rootDir = join(tempRoot(), 'profiles')

    expect(listPlayerProfiles({ rootDir })).toEqual([])
    expect(allocatePlayerProfileId('A', { rootDir })).toBe('profile_a0000000')

    const misty = createPlayerProfile({ displayName: 'Misty Water' }, { rootDir })
    const ash = createPlayerProfile({ displayName: 'Ash' }, { rootDir })
    const secondMisty = createPlayerProfile({ displayName: 'Misty Water' }, { rootDir })

    expect(misty).toEqual({
      schemaVersion: PLAYER_PROFILE_SCHEMA_VERSION,
      id: 'profile_misty-water',
      displayName: 'Misty Water',
      linkedCharacters: [],
    })
    expect(ash.id).toBe('profile_ash00000')
    expect(secondMisty.id).toBe('profile_misty-water-1')
    expect(listPlayerProfiles({ rootDir })).toEqual([ash, misty, secondMisty])
    expect(readPlayerProfile(misty.id, { rootDir })).toEqual(misty)

    const filePath = playerProfileFilePathFor(misty.id, { rootDir })
    const raw = readFileSync(filePath, 'utf8')
    expect(existsSync(filePath)).toBe(true)
    expect(raw.endsWith('\n')).toBe(true)
    expect(JSON.parse(raw)).toEqual(misty)
  })

  it('updates display names and linked characters without changing the persistent profile id', () => {
    const rootDir = tempRoot()
    const profile = createPlayerProfile({ displayName: 'Brock' }, { rootDir })

    const updated = updatePlayerProfile(profile.id, {
      displayName: 'Brock Stone',
      linkedCharacters: [
        { sheetKind: 'trainer', sheetSlug: 'brock' },
        { sheetKind: 'pokemon', sheetSlug: 'geodude' },
      ],
    }, { rootDir })

    expect(updated).toEqual({
      schemaVersion: PLAYER_PROFILE_SCHEMA_VERSION,
      id: profile.id,
      displayName: 'Brock Stone',
      linkedCharacters: [
        { sheetKind: 'pokemon', sheetSlug: 'geodude' },
        { sheetKind: 'trainer', sheetSlug: 'brock' },
      ],
    })
    expect(readPlayerProfile(profile.id, { rootDir })).toEqual(updated)
    expect(updatePlayerProfile(parsePlayerProfileId('profile_missing1'), {
      displayName: 'Missing',
    }, { rootDir })).toBeNull()
  })

  it('rejects malformed create and update payloads without overwriting stored profiles', () => {
    const rootDir = tempRoot()
    const profile = createPlayerProfile({ displayName: 'Erika' }, { rootDir })

    expect(() => createPlayerProfile({ displayName: ' Erika' }, { rootDir })).toThrow(
      'displayName must be',
    )
    expect(() => updatePlayerProfile(profile.id, {
      linkedCharacters: [
        { sheetKind: 'pokemon', sheetSlug: 'tangela' },
        { sheetKind: 'pokemon', sheetSlug: 'tangela' },
      ],
    }, { rootDir })).toThrow('linkedCharacters must not contain duplicate character ref')
    expect(() => updatePlayerProfile(profile.id, null as never, { rootDir })).toThrow(
      'Player profile update input must be an object',
    )
    expect(readPlayerProfile(profile.id, { rootDir })).toEqual(profile)
  })

  it('rejects invalid JSON and file/profile id mismatches in storage', () => {
    const invalidJsonRoot = tempRoot()
    mkdirSync(invalidJsonRoot, { recursive: true })
    writeFileSync(join(invalidJsonRoot, 'profile_broken01.json'), '{', 'utf8')

    expect(() => readPlayerProfile('profile_broken01', { rootDir: invalidJsonRoot })).toThrow(
      'is not valid JSON',
    )

    const mismatchRoot = tempRoot()
    writeProfile(mismatchRoot, {
      schemaVersion: PLAYER_PROFILE_SCHEMA_VERSION,
      id: parsePlayerProfileId('profile_other000'),
      displayName: parsePlayerProfileDisplayName('Other'),
      linkedCharacters: [],
    }, 'profile_mismatch.json')

    expect(() => listPlayerProfiles({ rootDir: mismatchRoot })).toThrow('id mismatch')
  })

  it('rejects malformed profile documents and invalid profile file names during list', () => {
    const malformedRoot = tempRoot()
    writeFileSync(join(malformedRoot, 'profile_badfile1.json'), JSON.stringify({
      schemaVersion: PLAYER_PROFILE_SCHEMA_VERSION,
      id: 'profile_badfile1',
      displayName: ' Bad',
      linkedCharacters: [],
    }), 'utf8')

    expect(() => listPlayerProfiles({ rootDir: malformedRoot })).toThrow('is malformed')

    const invalidNameRoot = tempRoot()
    writeFileSync(join(invalidNameRoot, 'not-a-profile.json'), '{}', 'utf8')

    expect(() => listPlayerProfiles({ rootDir: invalidNameRoot })).toThrow(
      'player profile file "not-a-profile.json" id must match',
    )
  })
})
