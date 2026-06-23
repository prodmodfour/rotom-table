import { sheetChannel, sheetsChannel, type RealtimeEvent } from '#shared/realtime'
import type { CampaignNextDayResult } from '#shared/campaign'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import { stablePersistableSheetJson } from '~/utils/sheets/persistence'
import {
  addHealingMutationSummary,
  applyPokemonNextDay,
  applyTrainerNextDay,
  emptyHealingMutationSummary,
  type SheetHealingMutationSummary,
} from '~/utils/sheets/healing'
import { sqliteSheetRepository, type SheetRepository, type StoredSheetDocument } from '../storage/sheetRepository'
import type { SheetKind } from '#shared/sheets'
import { logicalSheetResourcePath } from '../utils/runtimeResourcePaths'

export interface AdvanceCampaignDayInput {
  clientId?: string
}

export interface AdvanceCampaignDayDependencies {
  sheetRepository?: Pick<SheetRepository<Record<string, unknown>>, 'list' | 'applyLivePlayUpdate' | 'getByRef'>
  listPokemonSheets?: () => StoredSheetDocument<Record<string, unknown>>[]
  listTrainerSheets?: () => StoredSheetDocument<Record<string, unknown>>[]
  now?: () => number
  /** @deprecated Runtime campaign-day updates use SQLite sheets. */
  listPokemonSheetPaths?: () => string[]
  /** @deprecated Runtime campaign-day updates use SQLite sheets. */
  listTrainerSheetPaths?: () => string[]
  /** @deprecated Runtime campaign-day updates use SQLite sheets. */
  readPokemonSheet?: (path: string) => CharacterSheet
  /** @deprecated Runtime campaign-day updates use SQLite sheets. */
  readTrainerSheet?: (path: string) => TrainerSheet
  /** @deprecated Runtime campaign-day updates use SQLite sheets. */
  writeSheet?: (path: string, sheet: Record<string, unknown>) => void
  /** @deprecated Runtime campaign-day updates use logical SQLite resource paths. */
  relativePath?: (path: string) => string
}

export interface AdvanceCampaignDayResult extends CampaignNextDayResult {
  events: Array<Omit<RealtimeEvent, 'timestamp'>>
  paths: string[]
}

interface ProcessSheetResult {
  updated: boolean
  slug: string
  path: string
  summary: SheetHealingMutationSummary
  events?: Array<Omit<RealtimeEvent, 'timestamp'>>
}

const processSheet = <TSheet extends { slug: string }>(
  kind: SheetKind,
  stored: StoredSheetDocument<Record<string, unknown>>,
  applyNextDay: (sheet: TSheet) => SheetHealingMutationSummary,
  input: AdvanceCampaignDayInput,
  dependencies: Required<Pick<AdvanceCampaignDayDependencies, 'sheetRepository' | 'now'>>,
): ProcessSheetResult => {
  const sheet = {
    ...stored.document,
    slug: stored.slug,
    revision: stored.revision,
    updatedAt: stored.updatedAt,
  } as unknown as TSheet & Record<string, unknown>
  const beforeJson = stablePersistableSheetJson(sheet)
  const summary = applyNextDay(sheet as TSheet)
  const afterJson = stablePersistableSheetJson(sheet)
  const path = logicalSheetResourcePath(kind, sheet)
  if (beforeJson === afterJson) {
    return { updated: false, slug: stored.slug, path, summary }
  }

  const updatedAt = dependencies.now()
  const nextSheet = { ...sheet, updatedAt }
  const updateResult = dependencies.sheetRepository.applyLivePlayUpdate({
    kind,
    slug: stored.slug,
    expectedRevision: stored.revision,
    nextSheet,
  })
  if (updateResult === 'stale') throw new Error(`${kind} sheet ${stored.slug} changed during campaign-day advancement`)
  const persisted = dependencies.sheetRepository.getByRef(kind, stored.slug)
  if (!persisted) throw new Error(`${kind} sheet ${stored.slug} not found after campaign-day advancement`)

  const data = { kind, slug: stored.slug, sheet: persisted.sheet }
  return {
    updated: true,
    slug: stored.slug,
    path: logicalSheetResourcePath(kind, persisted.sheet),
    summary,
    events: [
      { channel: sheetChannel(kind, stored.slug), type: 'updated', clientId: input.clientId, data },
      { channel: sheetsChannel, type: 'updated', clientId: input.clientId, data },
    ],
  }
}

export const advanceCampaignDayUseCase = (
  input: AdvanceCampaignDayInput = {},
  dependencies: AdvanceCampaignDayDependencies = {},
): AdvanceCampaignDayResult => {
  const sheetRepository = dependencies.sheetRepository ?? (sqliteSheetRepository as Pick<SheetRepository<Record<string, unknown>>, 'list' | 'applyLivePlayUpdate' | 'getByRef'>)
  const listPokemonSheets = dependencies.listPokemonSheets ?? (() => [...sheetRepository.list('pokemon')] as StoredSheetDocument<Record<string, unknown>>[])
  const listTrainerSheets = dependencies.listTrainerSheets ?? (() => [...sheetRepository.list('trainer')] as StoredSheetDocument<Record<string, unknown>>[])
  const now = dependencies.now ?? Date.now

  const pokemonSheets = listPokemonSheets()
  const trainerSheets = listTrainerSheets()
  const summary = emptyHealingMutationSummary()
  const events: Array<Omit<RealtimeEvent, 'timestamp'>> = []
  const updatedPaths: string[] = []
  let pokemonUpdated = 0
  let trainerUpdated = 0

  for (const stored of pokemonSheets) {
    const result = processSheet(
      'pokemon',
      stored,
      applyPokemonNextDay as (sheet: CharacterSheet) => SheetHealingMutationSummary,
      input,
      { sheetRepository, now },
    )
    addHealingMutationSummary(summary, result.summary)
    if (result.updated) {
      pokemonUpdated += 1
      updatedPaths.push(result.path)
      if (result.events) events.push(...result.events)
    }
  }

  for (const stored of trainerSheets) {
    const result = processSheet(
      'trainer',
      stored,
      applyTrainerNextDay as (sheet: TrainerSheet) => SheetHealingMutationSummary,
      input,
      { sheetRepository, now },
    )
    addHealingMutationSummary(summary, result.summary)
    if (result.updated) {
      trainerUpdated += 1
      updatedPaths.push(result.path)
      if (result.events) events.push(...result.events)
    }
  }

  return {
    ok: true,
    totalSheets: pokemonSheets.length + trainerSheets.length,
    updatedSheets: pokemonUpdated + trainerUpdated,
    pokemonSheets: pokemonSheets.length,
    trainerSheets: trainerSheets.length,
    pokemonUpdated,
    trainerUpdated,
    hitPointsRestored: summary.hitPointsRestored,
    injuriesHealed: summary.injuriesHealed,
    dailyMoveUsesCleared: summary.dailyMoveUsesCleared,
    dailyMoveEntriesCleared: summary.dailyMoveEntriesCleared,
    conditionsCleared: summary.conditionsCleared,
    trainerApRestored: summary.trainerApRestored,
    events,
    paths: updatedPaths,
  }
}
