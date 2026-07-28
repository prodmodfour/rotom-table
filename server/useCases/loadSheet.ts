import type { AuthRole } from '#shared/auth'
import type { PlayerProfile } from '#shared/playerProfiles'
import type { SheetKind } from '#shared/sheets'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import {
  playerCanAccessSheet,
  playerProfileCanAccessSheet,
  type PlayerProfileLinkedTrainerSheet,
} from '../policies/playerProfilePolicy'
import { projectAbilityAutomationSheetForPlayer } from '../domain/abilityAutomation/clientStateProjection'
import { redactSheetForPlayer } from '../utils/sheetPrivacy'
import { UseCaseHttpError } from '../utils/useCaseErrors'
import { sqliteSheetRepository, type SheetRepository, type PersistedSheet } from '../storage/sheetRepository'

export class LoadSheetUseCaseError extends UseCaseHttpError<403 | 404> {}

export type LoadedSheet = CharacterSheet | TrainerSheet

export type PlayerSheetLoadAccessPredicate = (
  kind: SheetKind,
  slug: string,
  sheet: LoadedSheet,
) => boolean

export interface LoadSheetInput {
  role: AuthRole
  kind: SheetKind
  slug: string
  playerProfile?: PlayerProfile | null
  canAccessPlayerSheet?: PlayerSheetLoadAccessPredicate
}

export interface LoadSheetDependencies {
  sheetRepository?: Pick<SheetRepository<Record<string, unknown>>, 'getByRef' | 'list'>
  listTrainerSheets?: () => Iterable<PlayerProfileLinkedTrainerSheet>
}

export interface LoadSheetResult {
  kind: SheetKind
  slug: string
  sheet: LoadedSheet
}

const persistedToLoadedSheet = (persisted: PersistedSheet): LoadedSheet => persisted.sheet as unknown as LoadedSheet

export const loadSheetUseCase = (
  input: LoadSheetInput,
  dependencies: LoadSheetDependencies = {},
): LoadSheetResult => {
  const sheetRepository = dependencies.sheetRepository ?? sqliteSheetRepository
  const listTrainerSheets = dependencies.listTrainerSheets
    ?? (() => sheetRepository.list('trainer').map((stored) => ({
      ...(stored.document as Record<string, unknown>),
      slug: stored.slug,
      revision: stored.revision,
    } as PlayerProfileLinkedTrainerSheet)))
  const persisted = sheetRepository.getByRef(input.kind, input.slug)
  const result = persisted ? { sheet: persistedToLoadedSheet(persisted) } : null

  if (!result) throw new LoadSheetUseCaseError(404, `Sheet ${input.slug}.json not found`)
  const linkedTrainerSheets = input.kind === 'pokemon' ? [...listTrainerSheets()] : undefined
  if (
    input.role === 'player' &&
    !playerCanAccessSheet({
      kind: input.kind,
      slug: input.slug,
      sheet: result.sheet,
      playerProfile: input.playerProfile,
      canAccessPlayerSheet: input.canAccessPlayerSheet,
      linkedTrainerSheets,
    })
  ) {
    throw new LoadSheetUseCaseError(
      403,
      'Sheet is not marked as player accessible or linked to the selected player profile',
    )
  }

  return {
    kind: input.kind,
    slug: input.slug,
    sheet: input.role === 'player'
      ? projectAbilityAutomationSheetForPlayer(
          redactSheetForPlayer(input.kind, result.sheet),
          playerProfileCanAccessSheet(
            input.playerProfile,
            input.kind,
            input.slug,
            { linkedTrainerSheets },
          ),
        )
      : result.sheet,
  }
}
