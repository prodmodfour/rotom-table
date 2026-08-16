import { createHash } from 'node:crypto'
import type { AuthRole } from '#shared/auth'
import {
  GROUP_INVENTORY_ITEM_ACTION_LIMITS,
  GROUP_INVENTORY_ITEM_ACTION_SCHEMA_VERSION,
  parseGroupInventoryItemActionProjection,
  type GroupInventoryItemActionProjectionV1,
} from '#shared/itemAutomation/groupInventoryItemActions'
import { itemInventoryInstanceId } from '#shared/itemAutomation/inventory'
import { SHEET_ITEM_ACTION_LIMITS } from '#shared/itemAutomation/sheetActions'
import { validateSlug } from '#shared/paths'
import type { PlayerProfile } from '#shared/playerProfiles'
import type { CharacterSheet } from '~/types/characterSheet'
import type { GroupInventoryDocument } from '~/types/groupInventory'
import type { TrainerSheet } from '~/types/trainerSheet'
import { projectGroupInventoryItemActions } from '../domain/itemAutomation/sheetActionOffers'
import { authorizeGroupInventoryItemUseActor } from '../policies/groupInventoryItemUsePolicy'
import { createSqliteCampaignClockRepository, type CampaignClockRepository } from '../storage/campaignClockRepository'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import { createSqliteGroupInventoryRepository, type GroupInventoryRepository } from '../storage/groupInventoryRepository'
import { createSqliteItemOperationRepository, type ItemOperationRepository } from '../storage/itemOperationRepository'
import { createSqliteSheetRepository, type PersistedSheet, type SheetRepository } from '../storage/sheetRepository'
import { UseCaseHttpError } from '../utils/useCaseErrors'
import { itemActionSheetDocument, linkedItemActionPokemonSlugs } from './loadSheetItemActions'

export class LoadGroupInventoryItemActionsUseCaseError extends UseCaseHttpError<400 | 403 | 404 | 409> {}

export interface LoadGroupInventoryItemActionsInput {
  readonly role: AuthRole
  readonly playerProfile?: PlayerProfile | null
  readonly groupSlug: unknown
  /** Public opaque choice. Omit to select the first current authorised actor. */
  readonly actorSelectionId?: unknown
  /** Server-only reauthorization seam used by an already issued private command. */
  readonly actorSlug?: string
}

export interface LoadGroupInventoryItemActionsDependencies {
  readonly database?: RotomDatabase
  readonly groupInventoryRepository?: Pick<GroupInventoryRepository, 'getOrCreate'> & { readonly database?: RotomDatabase }
  readonly sheetRepository?: Pick<SheetRepository<Record<string, unknown>>, 'list' | 'getByRef'> & { readonly database?: RotomDatabase }
  readonly itemOperationRepository?: Pick<ItemOperationRepository, 'reservedQuantity'> & { readonly database?: RotomDatabase }
  readonly campaignClockRepository?: Pick<CampaignClockRepository, 'get'> & { readonly database?: RotomDatabase }
  readonly now?: () => number
}

export interface GroupInventoryItemActionAuthority {
  readonly projection: GroupInventoryItemActionProjectionV1
  readonly groupInventory: GroupInventoryDocument
  readonly trainerSheet: TrainerSheet | null
  readonly pokemonSheets: readonly CharacterSheet[]
  readonly trainerSheets: readonly TrainerSheet[]
  readonly actorSelectionId: string | null
  readonly targetLimitExceeded: boolean
}

const ACTOR_SELECTION_PATTERN = /^group-item-actor:v1:[a-f0-9]{32}$/u
const fail = (statusCode: 400 | 403 | 404 | 409, message: string): never => {
  throw new LoadGroupInventoryItemActionsUseCaseError(statusCode, message)
}
const normalizeSlug = (value: unknown): string => {
  try { return validateSlug(value, 'group inventory slug') }
  catch (error) { return fail(400, (error as Error).message) }
}
const actorLabel = (trainer: TrainerSheet): string => trainer.name?.trim() || 'Trainer'
const actorSelectionIdentity = (input: {
  readonly groupSlug: string
  readonly groupRevision: number
  readonly trainerSlug: string
  readonly trainerRevision: number
}): string => `group-item-actor:v1:${createHash('sha256').update([
  'group-item-actor', input.groupSlug, String(input.groupRevision),
  input.trainerSlug, String(input.trainerRevision),
].join('\u001f')).digest('hex').slice(0, 32)}`
const safeRevision = (value: unknown, label: string): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) return fail(409, `${label} has an invalid revision.`)
  return Number(value)
}
const databaseFor = (dependencies: LoadGroupInventoryItemActionsDependencies): RotomDatabase => {
  const candidates = [
    dependencies.database,
    dependencies.groupInventoryRepository?.database,
    dependencies.sheetRepository?.database,
    dependencies.itemOperationRepository?.database,
    dependencies.campaignClockRepository?.database,
  ].filter(Boolean) as RotomDatabase[]
  const database = candidates[0] ?? getRotomDatabase()
  if (candidates.some(candidate => candidate !== database)) {
    throw new Error('Group item action repositories must use one RotomDatabase.')
  }
  return database
}

export const loadGroupInventoryItemActionAuthority = (
  input: LoadGroupInventoryItemActionsInput,
  dependencies: LoadGroupInventoryItemActionsDependencies = {},
): GroupInventoryItemActionAuthority => {
  if (input.actorSelectionId !== undefined && input.actorSlug !== undefined) {
    return fail(400, 'Choose a public group item actor or use the server reauthorization seam, not both.')
  }
  if (input.role === 'player' && !input.playerProfile) {
    return fail(403, 'Choose a player profile before using shared inventory for a linked Trainer.')
  }
  if (input.actorSelectionId !== undefined
    && (typeof input.actorSelectionId !== 'string' || !ACTOR_SELECTION_PATTERN.test(input.actorSelectionId))) {
    return fail(400, 'Shared item actor selection is invalid.')
  }
  const database = databaseFor(dependencies)
  const groups = dependencies.groupInventoryRepository ?? createSqliteGroupInventoryRepository(database)
  const sheets = dependencies.sheetRepository ?? createSqliteSheetRepository<Record<string, unknown>>(database)
  const operations = dependencies.itemOperationRepository ?? createSqliteItemOperationRepository({ database })
  const clock = dependencies.campaignClockRepository ?? createSqliteCampaignClockRepository(database)
  const groupInventory = groups.getOrCreate({ slug: normalizeSlug(input.groupSlug) }).document
  const groupRevision = safeRevision(groupInventory.revision, 'Group inventory')

  const trainers = sheets.list('trainer').flatMap((stored) => {
    const authorization = authorizeGroupInventoryItemUseActor({
      role: input.role,
      playerProfile: input.playerProfile,
      trainerSlug: stored.slug,
    })
    const persisted: PersistedSheet = {
      kind: stored.kind,
      slug: stored.slug,
      revision: stored.revision,
      updatedAt: stored.updatedAt,
      sheet: stored.document,
    }
    return authorization.ok ? [itemActionSheetDocument<TrainerSheet>(persisted)] : []
  }).sort((left, right) => actorLabel(left).localeCompare(actorLabel(right)) || left.slug.localeCompare(right.slug))
  if (trainers.length > GROUP_INVENTORY_ITEM_ACTION_LIMITS.actors) {
    return fail(409, `Shared item use supports at most ${GROUP_INVENTORY_ITEM_ACTION_LIMITS.actors} authorised Trainer actors.`)
  }
  const actorRows = trainers.map(trainer => ({
    trainer,
    actorSelectionId: actorSelectionIdentity({
      groupSlug: groupInventory.slug,
      groupRevision,
      trainerSlug: trainer.slug,
      trainerRevision: safeRevision(trainer.revision ?? 0, 'Trainer actor'),
    }),
  }))
  let selected = input.actorSlug !== undefined
    ? actorRows.find(row => row.trainer.slug === input.actorSlug) ?? null
    : input.actorSelectionId !== undefined
      ? actorRows.find(row => row.actorSelectionId === input.actorSelectionId) ?? null
      : actorRows[0] ?? null
  if ((input.actorSelectionId !== undefined || input.actorSlug !== undefined) && !selected) {
    const actorExists = input.actorSlug !== undefined && Boolean(sheets.getByRef('trainer', input.actorSlug))
    return fail(actorExists ? 403 : 409, actorExists
      ? 'The authenticated principal is no longer delegated to this shared item actor.'
      : 'The selected shared item actor is stale or unavailable.')
  }

  const trainerSheet = selected?.trainer ?? null
  const pokemonSheets = trainerSheet ? linkedItemActionPokemonSlugs(trainerSheet).flatMap((slug) => {
    const stored = sheets.getByRef('pokemon', slug)
    return stored ? [itemActionSheetDocument<CharacterSheet>(stored)] : []
  }) : []
  const targetLimitExceeded = Boolean(trainerSheet
    && pokemonSheets.length + 1 > SHEET_ITEM_ACTION_LIMITS.targetsPerOffer)
  const generatedAt = (dependencies.now ?? Date.now)()
  const campaignClock = clock.get()
  let offers = trainerSheet ? projectGroupInventoryItemActions({
    groupInventory,
    trainerSheet,
    pokemonSheets,
    trainerSheets: [trainerSheet],
    generatedAt,
    campaignMinute: campaignClock.campaignMinute,
    targetLimitExceeded,
    gmAuthority: input.role === 'gm',
    reservedQuantity: source => operations.reservedQuantity(itemInventoryInstanceId(source)),
  }) : Object.freeze([])

  let projection: GroupInventoryItemActionProjectionV1
  try {
    projection = parseGroupInventoryItemActionProjection({
      schemaVersion: GROUP_INVENTORY_ITEM_ACTION_SCHEMA_VERSION,
      groupSlug: groupInventory.slug,
      groupRevision,
      generatedAt,
      selectedActorSelectionId: selected?.actorSelectionId ?? null,
      actors: actorRows.map(row => ({
        actorSelectionId: row.actorSelectionId,
        label: actorLabel(row.trainer),
        revision: safeRevision(row.trainer.revision ?? 0, 'Trainer actor'),
        selected: row.actorSelectionId === selected?.actorSelectionId,
      })),
      offers,
    })
  }
  catch (error) {
    return fail(409, error instanceof Error ? error.message : 'Shared item actions could not be projected safely.')
  }
  return Object.freeze({
    projection,
    groupInventory,
    trainerSheet,
    pokemonSheets: Object.freeze(pokemonSheets),
    trainerSheets: Object.freeze(trainerSheet ? [trainerSheet] : []),
    actorSelectionId: selected?.actorSelectionId ?? null,
    targetLimitExceeded,
  })
}

export const loadGroupInventoryItemActionsUseCase = (
  input: LoadGroupInventoryItemActionsInput,
  dependencies: LoadGroupInventoryItemActionsDependencies = {},
): GroupInventoryItemActionProjectionV1 => loadGroupInventoryItemActionAuthority(input, dependencies).projection
