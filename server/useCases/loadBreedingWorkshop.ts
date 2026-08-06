import type { AuthRole } from '#shared/auth'
import {
  BREEDING_WORKSHOP_CONTEXT_PAGE_LIMIT,
  parseBreedingWorkshopQueryV1,
  type BreedingWorkshopOwnershipContextV1,
  type BreedingWorkshopProjectionV1,
} from '#shared/breeding/workshop'
import {
  normalizePlayerProfile,
  type PlayerProfile,
} from '#shared/playerProfiles'
import { createBreedingWorkshopProjectionV1 } from '../domain/breeding/workshop'
import { createSqliteBreedingProjectRepository } from '../storage/breedingProjectRepository'
import { createSqliteCampaignClockRepository } from '../storage/campaignClockRepository'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import { createSqlitePokemonEggRepository } from '../storage/pokemonEggRepository'
import {
  createSqliteSheetRepository,
  type PersistedSheet,
  type SheetRepository,
} from '../storage/sheetRepository'
import { UseCaseHttpError } from '../utils/useCaseErrors'

export class LoadBreedingWorkshopError extends UseCaseHttpError<400 | 403 | 409> {}

type WorkshopSheetRepository = Pick<
  SheetRepository<Record<string, unknown>>,
  'getByRef' | 'list'
> & { readonly database?: RotomDatabase }
type WorkshopProjectRepository = Pick<
  ReturnType<typeof createSqliteBreedingProjectRepository>,
  'listByOwner'
> & { readonly database?: RotomDatabase }
type WorkshopEggRepository = Pick<
  ReturnType<typeof createSqlitePokemonEggRepository>,
  'listByOwner'
> & { readonly database?: RotomDatabase }
type WorkshopClockRepository = Pick<
  ReturnType<typeof createSqliteCampaignClockRepository>,
  'get'
> & { readonly database?: RotomDatabase }

export interface LoadBreedingWorkshopInput {
  readonly role: AuthRole
  readonly playerProfile: unknown | null
  readonly query: unknown
}

export interface LoadBreedingWorkshopDependencies {
  readonly database?: RotomDatabase
  readonly sheetRepository?: WorkshopSheetRepository
  readonly projectRepository?: WorkshopProjectRepository
  readonly eggRepository?: WorkshopEggRepository
  readonly clockRepository?: WorkshopClockRepository
}

const MAX_AUTHORIZED_TRAINERS = 4096
const FORMAT_CONTROLS = /[\u200b-\u200f\u202a-\u202e\u2066-\u2069]/gu
const CONTROLS = /[\u0000-\u001f\u007f]/gu
const compare = (left: string, right: string): number => (
  left < right ? -1 : left > right ? 1 : 0
)
const fail = (status: 400 | 403 | 409, message: string): never => {
  throw new LoadBreedingWorkshopError(status, message)
}
const plainRecord = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  if ((prototype !== Object.prototype && prototype !== null)
    || Object.getOwnPropertySymbols(value).length > 0) return false
  return Object.getOwnPropertyNames(value).every((field) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, field)
    return descriptor?.enumerable === true && 'value' in descriptor
  })
}
const strictDenseArray = (
  value: unknown,
  maximumLength: number,
  label: string,
): readonly unknown[] => {
  if (!Array.isArray(value)
    || Object.getPrototypeOf(value) !== Array.prototype
    || value.length > maximumLength
    || Object.getOwnPropertySymbols(value).length > 0
    || Object.getOwnPropertyNames(value).length !== value.length + 1) {
    return fail(409, `${label} is malformed`)
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      return fail(409, `${label} is malformed`)
    }
  }
  return value
}
const strictProfile = (value: unknown): PlayerProfile => {
  if (!plainRecord(value)
    || Object.keys(value).sort(compare).join('\0')
      !== ['displayName', 'id', 'linkedCharacters', 'schemaVersion'].sort(compare).join('\0')
    || !Array.isArray(value.linkedCharacters)
    || Object.getPrototypeOf(value.linkedCharacters) !== Array.prototype
    || value.linkedCharacters.length > 128
    || Object.getOwnPropertySymbols(value.linkedCharacters).length > 0
    || Object.getOwnPropertyNames(value.linkedCharacters).length
      !== value.linkedCharacters.length + 1) {
    return fail(400, 'Selected player Profile authority is malformed')
  }
  for (let index = 0; index < value.linkedCharacters.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value.linkedCharacters, String(index))
    if (!descriptor?.enumerable || !('value' in descriptor)
      || !plainRecord(descriptor.value)
      || Object.keys(descriptor.value).sort(compare).join('\0')
        !== ['sheetKind', 'sheetSlug'].sort(compare).join('\0')) {
      return fail(400, 'Selected player Profile authority is malformed')
    }
  }
  try {
    return normalizePlayerProfile(value)
  }
  catch {
    return fail(400, 'Selected player Profile authority is malformed')
  }
}
const safeDisplayName = (value: unknown, fallback: string): string => {
  const raw = typeof value === 'string' ? value : ''
  const cleaned = raw.normalize('NFKC')
    .replace(FORMAT_CONTROLS, '')
    .replace(CONTROLS, ' ')
    .replace(/[<>]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
  return Array.from(cleaned || fallback)
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0
      return codePoint < 0xD800 || codePoint > 0xDFFF
    })
    .slice(0, 120)
    .join('')
    .trim() || fallback
}
const assertRepositoryDatabase = (
  database: RotomDatabase,
  repository: { readonly database?: RotomDatabase },
  label: string,
): void => {
  if (repository.database && repository.database !== database) {
    fail(409, `${label} must use the Workshop database connection`)
  }
}
const validateTrainer = (trainer: PersistedSheet, expectedSlug: string): PersistedSheet => {
  if (trainer.kind !== 'trainer'
    || trainer.slug !== expectedSlug
    || !plainRecord(trainer.sheet)
    || trainer.sheet.slug !== expectedSlug
    || trainer.sheet.revision !== trainer.revision
    || !Number.isSafeInteger(trainer.revision)
    || trainer.revision < 0) {
    return fail(409, 'Trainer ownership context is malformed')
  }
  return trainer
}

/**
 * Lists only current server-authorized Trainer ownership contexts. It exposes
 * bounded activity booleans, never aggregate IDs, mechanics, evidence, or
 * cross-owner facts.
 */
export const loadBreedingWorkshop = (
  input: LoadBreedingWorkshopInput,
  dependencies: LoadBreedingWorkshopDependencies = {},
): BreedingWorkshopProjectionV1 => {
  if (!plainRecord(input)
    || Object.keys(input).sort(compare).join('\0')
      !== ['playerProfile', 'query', 'role'].sort(compare).join('\0')) {
    return fail(400, 'Breeding Workshop request is malformed')
  }
  if (input.role !== 'gm' && input.role !== 'player') {
    return fail(403, 'Breeding Workshop requires an authenticated campaign role')
  }
  const query = (() => {
    try {
      return parseBreedingWorkshopQueryV1(input.query)
    }
    catch {
      return fail(400, 'Breeding Workshop query is malformed')
    }
  })()
  const database = dependencies.database ?? getRotomDatabase()
  const sheets = dependencies.sheetRepository
    ?? createSqliteSheetRepository<Record<string, unknown>>(database)
  const projects = dependencies.projectRepository
    ?? createSqliteBreedingProjectRepository(database)
  const eggs = dependencies.eggRepository ?? createSqlitePokemonEggRepository(database)
  const clock = dependencies.clockRepository ?? createSqliteCampaignClockRepository(database)
  assertRepositoryDatabase(database, sheets, 'Sheet repository')
  assertRepositoryDatabase(database, projects, 'Project repository')
  assertRepositoryDatabase(database, eggs, 'Egg repository')
  assertRepositoryDatabase(database, clock, 'Campaign clock repository')

  const campaignMinute = clock.get().campaignMinute
  if (!Number.isSafeInteger(campaignMinute) || campaignMinute < 0) {
    return fail(409, 'Campaign clock authority is malformed')
  }

  if (input.role === 'player' && input.playerProfile === null) {
    return createBreedingWorkshopProjectionV1({
      audience: 'owner',
      generatedAtCampaignMinute: campaignMinute,
      profileSelectionRequired: true,
      ownershipCursor: null,
      nextOwnershipCursor: null,
      ownershipContexts: Object.freeze([]),
      selectedOwnershipContext: null,
      emptyState: 'profile-required',
    })
  }
  if (input.role === 'gm' && input.playerProfile !== null) {
    return fail(400, 'GM Workshop requests cannot adopt a player Profile')
  }

  const profile = input.role === 'player' ? strictProfile(input.playerProfile) : null
  const authorizedTrainerSlugs = (() => {
    if (profile) {
      return profile.linkedCharacters
        .filter(link => link.sheetKind === 'trainer')
        .map(link => link.sheetSlug)
        .sort(compare)
    }
    const rows = strictDenseArray(
      sheets.list('trainer'),
      MAX_AUTHORIZED_TRAINERS,
      'Trainer ownership directory',
    )
    const slugs = rows.map((row) => {
      if (!plainRecord(row) || row.kind !== 'trainer' || typeof row.slug !== 'string') {
        return fail(409, 'Trainer ownership directory is malformed')
      }
      return row.slug
    }).sort(compare)
    if (new Set(slugs).size !== slugs.length) {
      return fail(409, 'Trainer ownership directory contains duplicate identities')
    }
    return slugs
  })()

  const selectedSlug = query.trainerSheetSlug ?? authorizedTrainerSlugs[0] ?? null
  if (selectedSlug !== null && !authorizedTrainerSlugs.includes(selectedSlug)) {
    return fail(403, 'Requested Breeding Workshop ownership context is unavailable')
  }

  const contextFor = (trainerSlug: string): BreedingWorkshopOwnershipContextV1 => {
    const stored = sheets.getByRef('trainer', trainerSlug)
    if (!stored) {
      if (input.role === 'gm') return fail(409, 'Trainer ownership directory changed during projection')
      return Object.freeze({
        trainerSheetSlug: trainerSlug,
        trainerRevision: null,
        displayName: trainerSlug,
        availability: 'unavailable' as const,
        unavailableReasonId: 'breeding.workshop.trainer-unavailable' as const,
        hasProjects: false,
        hasEggs: false,
      })
    }
    const trainer = validateTrainer(stored, trainerSlug)
    const ownerProjects = strictDenseArray(
      projects.listByOwner(trainerSlug, 1),
      1,
      'Breeding Project activity result',
    )
    const ownerEggs = strictDenseArray(
      eggs.listByOwner(trainerSlug, 1),
      1,
      'Pokémon Egg activity result',
    )
    return Object.freeze({
      trainerSheetSlug: trainerSlug,
      trainerRevision: trainer.revision,
      displayName: safeDisplayName(trainer.sheet.name, trainerSlug),
      availability: 'available' as const,
      unavailableReasonId: null,
      hasProjects: ownerProjects.length === 1,
      hasEggs: ownerEggs.length === 1,
    })
  }

  const afterCursor = authorizedTrainerSlugs.filter(slug => (
    query.ownershipCursor === null || slug > query.ownershipCursor
  ))
  const pageSlugs = afterCursor.slice(0, BREEDING_WORKSHOP_CONTEXT_PAGE_LIMIT)
  const hasNextPage = afterCursor.length > BREEDING_WORKSHOP_CONTEXT_PAGE_LIMIT
  const contexts = Object.freeze(pageSlugs.map(contextFor))
  const selected = selectedSlug === null ? null : contextFor(selectedSlug)
  const emptyState = selected === null
    ? 'no-authorized-trainers' as const
    : selected.availability === 'unavailable'
      ? 'selected-context-unavailable' as const
      : !selected.hasProjects && !selected.hasEggs
        ? 'selected-context-empty' as const
        : null

  return createBreedingWorkshopProjectionV1({
    audience: input.role === 'gm' ? 'gm' : 'owner',
    generatedAtCampaignMinute: campaignMinute,
    profileSelectionRequired: false,
    ownershipCursor: query.ownershipCursor,
    nextOwnershipCursor: hasNextPage ? contexts.at(-1)!.trainerSheetSlug : null,
    ownershipContexts: contexts,
    selectedOwnershipContext: selected,
    emptyState,
  })
}
