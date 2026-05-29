import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  type Dirent,
} from 'node:fs'
import { resolve } from 'node:path'
import { slugify } from '#shared/paths'
import {
  PLAYER_PROFILE_ID_PREFIX,
  PLAYER_PROFILE_SCHEMA_VERSION,
  normalizeLinkedCharacterRefs,
  normalizePlayerProfile,
  parsePlayerProfileDisplayName,
  parsePlayerProfileId,
  type PlayerProfile,
  type PlayerProfileDisplayName,
  type PlayerProfileId,
} from '#shared/playerProfiles'
import { CAMPAIGN_PLAYER_PROFILES_ROOT } from './campaignPaths'
import { joinSafeUnderRoot } from './fsPaths'

export const PLAYER_PROFILE_STORAGE_ROOT = CAMPAIGN_PLAYER_PROFILES_ROOT
export const PLAYER_PROFILE_FILE_EXTENSION = '.json'
export const PLAYER_PROFILE_ID_BODY_MIN_LENGTH = 8
export const PLAYER_PROFILE_ID_BODY_MAX_LENGTH = 64
export const PLAYER_PROFILE_ID_ALLOCATION_LIMIT = 10_000

export interface PlayerProfileStorageOptions {
  readonly rootDir?: string
}

export interface CreatePlayerProfileInput {
  readonly displayName: unknown
  readonly linkedCharacters?: unknown
}

export interface UpdatePlayerProfileInput {
  readonly displayName?: unknown
  readonly linkedCharacters?: unknown
}

type UnknownRecord = Record<string, unknown>

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const hasOwn = <TKey extends PropertyKey>(
  value: object,
  key: TKey,
): value is object & Record<TKey, unknown> => Object.prototype.hasOwnProperty.call(value, key)

const compareStrings = (left: string, right: string): number => {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

const messageFromError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const isNodeErrorCode = (error: unknown, code: string): boolean =>
  isRecord(error) && error.code === code

const storageRoot = (options: PlayerProfileStorageOptions = {}): string =>
  resolve(options.rootDir ?? PLAYER_PROFILE_STORAGE_ROOT)

const profileFileNameFor = (profileId: PlayerProfileId): string =>
  `${profileId}${PLAYER_PROFILE_FILE_EXTENSION}`

const profileIdFromFileName = (fileName: string): PlayerProfileId => {
  if (!fileName.endsWith(PLAYER_PROFILE_FILE_EXTENSION)) {
    throw new Error(`Player profile file "${fileName}" must be a JSON file`)
  }

  return parsePlayerProfileId(
    fileName.slice(0, -PLAYER_PROFILE_FILE_EXTENSION.length),
    `player profile file "${fileName}" id`,
  )
}

const sortPlayerProfiles = (profiles: readonly PlayerProfile[]): PlayerProfile[] =>
  [...profiles].sort((left, right) => (
    compareStrings(left.displayName, right.displayName) || compareStrings(left.id, right.id)
  ))

const idBodyBaseFromDisplayName = (displayName: PlayerProfileDisplayName): string => {
  const body = slugify(displayName) || 'player'
  return body.slice(0, PLAYER_PROFILE_ID_BODY_MAX_LENGTH).padEnd(
    PLAYER_PROFILE_ID_BODY_MIN_LENGTH,
    '0',
  )
}

const idBodyForAttempt = (base: string, attempt: number): string => {
  const suffix = attempt === 0 ? '' : `-${attempt}`
  const baseLength = PLAYER_PROFILE_ID_BODY_MAX_LENGTH - suffix.length
  const candidate = `${base.slice(0, baseLength)}${suffix}`
  return candidate.length >= PLAYER_PROFILE_ID_BODY_MIN_LENGTH
    ? candidate
    : candidate.padEnd(PLAYER_PROFILE_ID_BODY_MIN_LENGTH, '0')
}

const assertProfileMatchesExpectedId = (
  profile: PlayerProfile,
  expectedId: PlayerProfileId,
  sourceLabel: string,
): void => {
  if (profile.id !== expectedId) {
    throw new Error(
      `Player profile ${sourceLabel} id mismatch: expected ${expectedId}, found ${profile.id}`,
    )
  }
}

const parseStoredProfileJson = (
  raw: string,
  sourceLabel: string,
  expectedId: PlayerProfileId,
): PlayerProfile => {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch (error) {
    throw new Error(`Player profile ${sourceLabel} is not valid JSON: ${messageFromError(error)}`)
  }

  let profile: PlayerProfile
  try {
    profile = normalizePlayerProfile(parsed, `playerProfile ${sourceLabel}`)
  } catch (error) {
    throw new Error(`Player profile ${sourceLabel} is malformed: ${messageFromError(error)}`)
  }

  assertProfileMatchesExpectedId(profile, expectedId, sourceLabel)
  return profile
}

const readStoredProfileFile = (
  filePath: string,
  expectedId: PlayerProfileId,
  sourceLabel: string,
): PlayerProfile => parseStoredProfileJson(readFileSync(filePath, 'utf8'), sourceLabel, expectedId)

const serializePlayerProfile = (profile: PlayerProfile): string => {
  const normalized = normalizePlayerProfile(profile)
  const json = JSON.stringify(normalized, null, 2)
  if (json === undefined) throw new Error('Player profile could not be serialized to JSON')
  return `${json}\n`
}

const writeProfileFile = (
  profile: PlayerProfile,
  options: PlayerProfileStorageOptions,
  flag: 'w' | 'wx',
): void => {
  const filePath = playerProfileFilePathFor(profile.id, options)
  mkdirSync(storageRoot(options), { recursive: true })
  writeFileSync(filePath, serializePlayerProfile(profile), {
    encoding: 'utf8',
    mode: 0o600,
    flag,
  })
}

export const playerProfileFilePathFor = (
  profileIdInput: unknown,
  options: PlayerProfileStorageOptions = {},
): string => {
  const profileId = parsePlayerProfileId(profileIdInput)
  return joinSafeUnderRoot(storageRoot(options), '', profileFileNameFor(profileId))
}

export const allocatePlayerProfileId = (
  displayNameInput: unknown,
  options: PlayerProfileStorageOptions = {},
): PlayerProfileId => {
  const displayName = parsePlayerProfileDisplayName(displayNameInput)
  const bodyBase = idBodyBaseFromDisplayName(displayName)

  for (let attempt = 0; attempt < PLAYER_PROFILE_ID_ALLOCATION_LIMIT; attempt += 1) {
    const candidate = parsePlayerProfileId(`${PLAYER_PROFILE_ID_PREFIX}${idBodyForAttempt(bodyBase, attempt)}`)
    if (!existsSync(playerProfileFilePathFor(candidate, options))) return candidate
  }

  throw new Error(`Could not allocate a free player profile id for ${displayName}`)
}

export const readPlayerProfile = (
  profileIdInput: unknown,
  options: PlayerProfileStorageOptions = {},
): PlayerProfile | null => {
  const profileId = parsePlayerProfileId(profileIdInput)
  const filePath = playerProfileFilePathFor(profileId, options)

  try {
    return readStoredProfileFile(filePath, profileId, profileId)
  } catch (error) {
    if (isNodeErrorCode(error, 'ENOENT')) return null
    throw error
  }
}

export const listPlayerProfiles = (
  options: PlayerProfileStorageOptions = {},
): PlayerProfile[] => {
  const root = storageRoot(options)
  let entries: Dirent[]

  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch (error) {
    if (isNodeErrorCode(error, 'ENOENT')) return []
    throw error
  }

  const profiles: PlayerProfile[] = []
  const seenIds = new Set<PlayerProfileId>()

  for (const entry of entries) {
    if (!entry.isFile() || entry.name.startsWith('.') || !entry.name.endsWith(PLAYER_PROFILE_FILE_EXTENSION)) {
      continue
    }

    const expectedId = profileIdFromFileName(entry.name)
    const filePath = joinSafeUnderRoot(root, '', entry.name)
    const profile = readStoredProfileFile(filePath, expectedId, entry.name)

    if (seenIds.has(profile.id)) {
      throw new Error(`Duplicate player profile id ${profile.id} in storage`)
    }
    seenIds.add(profile.id)
    profiles.push(profile)
  }

  return sortPlayerProfiles(profiles)
}

export const createPlayerProfile = (
  input: CreatePlayerProfileInput,
  options: PlayerProfileStorageOptions = {},
): PlayerProfile => {
  if (!isRecord(input)) {
    throw new Error('Player profile create input must be an object')
  }

  const displayName = parsePlayerProfileDisplayName(input.displayName)
  const linkedCharacters = input.linkedCharacters === undefined
    ? []
    : normalizeLinkedCharacterRefs(input.linkedCharacters)
  const profile = normalizePlayerProfile({
    schemaVersion: PLAYER_PROFILE_SCHEMA_VERSION,
    id: allocatePlayerProfileId(displayName, options),
    displayName,
    linkedCharacters,
  })

  try {
    writeProfileFile(profile, options, 'wx')
  } catch (error) {
    if (isNodeErrorCode(error, 'EEXIST')) {
      throw new Error(`Player profile ${profile.id} already exists`)
    }
    throw error
  }

  return profile
}

export const updatePlayerProfile = (
  profileIdInput: unknown,
  input: UpdatePlayerProfileInput,
  options: PlayerProfileStorageOptions = {},
): PlayerProfile | null => {
  if (!isRecord(input)) {
    throw new Error('Player profile update input must be an object')
  }

  const profileId = parsePlayerProfileId(profileIdInput)
  const existing = readPlayerProfile(profileId, options)
  if (!existing) return null

  const displayName = hasOwn(input, 'displayName')
    ? parsePlayerProfileDisplayName(input.displayName)
    : existing.displayName
  const linkedCharacters = hasOwn(input, 'linkedCharacters')
    ? normalizeLinkedCharacterRefs(input.linkedCharacters)
    : existing.linkedCharacters
  const updated = normalizePlayerProfile({
    schemaVersion: PLAYER_PROFILE_SCHEMA_VERSION,
    id: existing.id,
    displayName,
    linkedCharacters,
  })

  writeProfileFile(updated, options, 'w')
  return updated
}
