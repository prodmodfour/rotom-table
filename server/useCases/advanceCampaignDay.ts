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
import { campaignPathLabel } from '../utils/campaignPaths'
import { readJsonFile } from '../utils/jsonFiles'
import {
  listSheetFiles,
  stripDerivedSheetFields,
  writeSheetFile,
} from '../utils/sheetStorage'
import type { SheetKind } from '#shared/sheets'

export interface AdvanceCampaignDayInput {
  clientId?: string
}

export interface AdvanceCampaignDayDependencies {
  listPokemonSheetPaths?: () => string[]
  listTrainerSheetPaths?: () => string[]
  readPokemonSheet?: (path: string) => CharacterSheet
  readTrainerSheet?: (path: string) => TrainerSheet
  writeSheet?: (path: string, sheet: Record<string, unknown>) => void
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

const sheetSlugFrom = (sheet: { slug?: unknown }, fallbackPath: string): string => {
  const slug = typeof sheet.slug === 'string' ? sheet.slug.trim() : ''
  if (slug) return slug
  const fileName = fallbackPath.split(/[\\/]/).pop() ?? ''
  return fileName.replace(/\.json$/i, '')
}

const processSheet = <TSheet extends { slug: string }>(
  kind: SheetKind,
  path: string,
  sheet: TSheet,
  applyNextDay: (sheet: TSheet) => SheetHealingMutationSummary,
  input: AdvanceCampaignDayInput,
  dependencies: Required<Pick<AdvanceCampaignDayDependencies, 'writeSheet' | 'relativePath'>>,
): ProcessSheetResult => {
  const slug = sheetSlugFrom(sheet, path)
  const beforeJson = stablePersistableSheetJson(sheet)
  const summary = applyNextDay(sheet)
  const afterSheet = stripDerivedSheetFields(sheet) as Record<string, unknown>
  const afterJson = stablePersistableSheetJson(afterSheet)
  if (beforeJson === afterJson) {
    return { updated: false, slug, path: dependencies.relativePath(path), summary }
  }

  dependencies.writeSheet(path, afterSheet)
  const data = { kind, slug, sheet: afterSheet }
  return {
    updated: true,
    slug,
    path: dependencies.relativePath(path),
    summary,
    events: [
      { channel: sheetChannel(kind, slug), type: 'updated', clientId: input.clientId, data },
      { channel: sheetsChannel, type: 'updated', clientId: input.clientId, data },
    ],
  }
}

export const advanceCampaignDayUseCase = (
  input: AdvanceCampaignDayInput = {},
  dependencies: AdvanceCampaignDayDependencies = {},
): AdvanceCampaignDayResult => {
  const listPokemonSheetPaths = dependencies.listPokemonSheetPaths ?? (() => listSheetFiles('pokemon'))
  const listTrainerSheetPaths = dependencies.listTrainerSheetPaths ?? (() => listSheetFiles('trainer'))
  const readPokemonSheet = dependencies.readPokemonSheet ?? ((path: string) => readJsonFile<CharacterSheet>(path))
  const readTrainerSheet = dependencies.readTrainerSheet ?? ((path: string) => readJsonFile<TrainerSheet>(path))
  const writeSheet = dependencies.writeSheet ?? writeSheetFile
  const relativePath = dependencies.relativePath ?? campaignPathLabel

  const pokemonPaths = listPokemonSheetPaths()
  const trainerPaths = listTrainerSheetPaths()
  const summary = emptyHealingMutationSummary()
  const events: Array<Omit<RealtimeEvent, 'timestamp'>> = []
  const updatedPaths: string[] = []
  let pokemonUpdated = 0
  let trainerUpdated = 0

  for (const path of pokemonPaths) {
    const result = processSheet(
      'pokemon',
      path,
      readPokemonSheet(path),
      applyPokemonNextDay,
      input,
      { writeSheet, relativePath },
    )
    addHealingMutationSummary(summary, result.summary)
    if (result.updated) {
      pokemonUpdated += 1
      updatedPaths.push(result.path)
      if (result.events) events.push(...result.events)
    }
  }

  for (const path of trainerPaths) {
    const result = processSheet(
      'trainer',
      path,
      readTrainerSheet(path),
      applyTrainerNextDay,
      input,
      { writeSheet, relativePath },
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
    totalSheets: pokemonPaths.length + trainerPaths.length,
    updatedSheets: pokemonUpdated + trainerUpdated,
    pokemonSheets: pokemonPaths.length,
    trainerSheets: trainerPaths.length,
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
