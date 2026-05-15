import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement } from '~/types/map'
import type { GridAnchor, SpawnedPokemon } from '~/types/pokemon'
import { getClearanceValue } from '~/utils/gridGeometry'
import { placementToSpawned, type SheetLookup } from '~/utils/placement'

export const POKEBALL_THROW_RANGE_SQUARES = 6

export interface TokenSendOutOption {
  pokemonSlug: string
  label: string
  species: string
  level: number
  spriteUrl: string | null
  preview: SpawnedPokemon
}

const uniqueNonEmptySlugs = (slugs: readonly string[] | undefined): string[] => {
  const seen = new Set<string>()
  const out: string[] = []

  for (const rawSlug of slugs ?? []) {
    const slug = rawSlug.trim()
    if (!slug || seen.has(slug)) continue
    seen.add(slug)
    out.push(slug)
  }

  return out
}

const pokemonOptionLabel = (sheet: CharacterSheet): string => {
  const nickname = sheet.nickname?.trim()
  const species = sheet.species?.trim()
  if (!nickname) return species || sheet.slug
  if (!species || nickname.toLowerCase() === species.toLowerCase()) return nickname
  return `${nickname} (${species})`
}

const previewPlacementForTeamPokemon = (
  trainerPlacement: Pick<SheetPlacement, 'id' | 'position'>,
  pokemonSlug: string,
): SheetPlacement => ({
  id: `sendout-preview:${trainerPlacement.id}:${pokemonSlug}`,
  sheetKind: 'pokemon',
  sheetSlug: pokemonSlug,
  position: trainerPlacement.position,
  turned: false,
})

export const buildTokenSendOutOptionsForPlacement = (
  placement: SheetPlacement,
  sheets: SheetLookup,
): TokenSendOutOption[] => {
  if (placement.sheetKind !== 'trainer') return []

  const trainerSheet = sheets.trainer.get(placement.sheetSlug)
  if (!trainerSheet) return []

  return uniqueNonEmptySlugs(trainerSheet.currentTeam).flatMap((pokemonSlug) => {
    const pokemonSheet = sheets.pokemon.get(pokemonSlug)
    if (!pokemonSheet) return []

    const preview = placementToSpawned(previewPlacementForTeamPokemon(placement, pokemonSlug), sheets)
    if (!preview) return []

    return [{
      pokemonSlug,
      label: pokemonOptionLabel(pokemonSheet),
      species: pokemonSheet.species,
      level: pokemonSheet.level,
      spriteUrl: preview.spriteUrl ?? null,
      preview,
    }]
  })
}

export const buildTokenSendOutOptionsByPlacementId = (
  placements: readonly SheetPlacement[],
  sheets: SheetLookup,
  canSendOut: boolean,
): Record<string, TokenSendOutOption[]> => {
  if (!canSendOut) return {}

  return Object.fromEntries(
    placements
      .map((placement) => [placement.id, buildTokenSendOutOptionsForPlacement(placement, sheets)] as const)
      .filter(([, options]) => options.length > 0),
  )
}

const gridAxisDistance = (
  leftStart: number,
  leftSize: number,
  rightStart: number,
  rightSize: number,
): number => {
  if (leftStart <= rightStart) {
    const gap = rightStart - (leftStart + leftSize)
    return gap >= 0 ? gap + 1 : 0
  }

  const gap = leftStart - (rightStart + rightSize)
  return gap >= 0 ? gap + 1 : 0
}

export const getSendOutThrowDistance = (options: {
  trainer: Pick<SpawnedPokemon, 'base' | 'clearance' | 'position'>
  pokemon: Pick<SpawnedPokemon, 'base' | 'clearance'>
  position: GridAnchor
}): number =>
  Math.max(
    gridAxisDistance(options.trainer.position.x, options.trainer.base, options.position.x, options.pokemon.base),
    gridAxisDistance(
      options.trainer.position.y,
      getClearanceValue(options.trainer),
      options.position.y,
      getClearanceValue(options.pokemon),
    ),
    gridAxisDistance(options.trainer.position.z, options.trainer.base, options.position.z, options.pokemon.base),
  )

export const isSendOutPositionWithinThrowRange = (options: {
  trainer: Pick<SpawnedPokemon, 'base' | 'clearance' | 'position'>
  pokemon: Pick<SpawnedPokemon, 'base' | 'clearance'>
  position: GridAnchor
  range?: number
}): boolean =>
  getSendOutThrowDistance(options) <= (options.range ?? POKEBALL_THROW_RANGE_SQUARES)
