import { slugify, sanitizeFolderPath, validateSlug } from '#shared/paths'
import type { SheetKind } from '#shared/sheets'
import { DEFAULT_POKEMON_CAUGHT_BALL } from '~/utils/sheets/pokemonCaughtBall'
import { pickRandomTrainerSpriteUrl } from './trainerSprites'

export const validateRuntimeSheetSlug = (slug: string): string => validateSlug(slug, 'sheet slug')

export const runtimeSheetNameFieldForKind = (kind: SheetKind): 'nickname' | 'name' => (
  kind === 'pokemon' ? 'nickname' : 'name'
)

export const runtimeSheetNameSlug = (name: string): string => slugify(name)

export const isRuntimePlayerFolderPath = (folder: string): boolean => (
  folder.split('/')[0]?.toLowerCase() === 'players'
)

export interface BuildDefaultRuntimeSheetOptions {
  readonly playerAccessible?: boolean
  readonly now?: number
}

export const buildDefaultRuntimeSheet = (
  kind: SheetKind,
  slugInput: string,
  options: BuildDefaultRuntimeSheetOptions = {},
): Record<string, unknown> => {
  const slug = validateRuntimeSheetSlug(slugInput)
  const player = options.playerAccessible === true
  const base = {
    revision: 0,
    slug,
    player,
    ...(options.now === undefined ? {} : { updatedAt: options.now }),
  }

  if (kind === 'pokemon') {
    return {
      ...base,
      nickname: 'New Pokémon',
      species: '',
      level: 1,
      caughtBall: DEFAULT_POKEMON_CAUGHT_BALL,
    }
  }

  const portraitUrl = pickRandomTrainerSpriteUrl()
  return {
    ...base,
    name: 'New Trainer',
    level: 1,
    ...(portraitUrl ? { portraitUrl } : {}),
  }
}

export const normalizeRuntimeSheetFolder = (folder: unknown, allowEmpty = true): string => (
  sanitizeFolderPath(String(folder ?? ''), { allowEmpty, label: 'folder' })
)
