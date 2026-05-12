import type { Ref } from 'vue'
import { pokedexPathForSpecies, sheetPathForPlacement } from '~/composables/map-editor/useTokenControls'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'

interface BooleanPlacementGuard {
  (id: string): boolean
}

export type MapTokenPathResolver = (path: string) => string
export type MapTokenHrefOpener = (href: string) => void

export interface UseMapTokenNavigationOptions {
  map: Ref<TabletopMap | null>
  pokemonBySlug: Ref<Map<string, CharacterSheet> | undefined>
  canControlPlacement: BooleanPlacementGuard
  placementById: (id: string) => SheetPlacement | null
  resolvePath?: MapTokenPathResolver
  openHref?: MapTokenHrefOpener
}

const defaultResolvePath: MapTokenPathResolver = (path) => path

export const openHrefInNewWindow: MapTokenHrefOpener = (href) => {
  if (typeof window === 'undefined') return
  window.open(href, '_blank', 'noopener')
}

export const resolvePlacementSheetHref = (
  placement: Pick<SheetPlacement, 'sheetKind' | 'sheetSlug'>,
  resolvePath: MapTokenPathResolver = defaultResolvePath,
): string => resolvePath(sheetPathForPlacement(placement))

export const resolvePlacementPokedexHref = (
  placement: Pick<SheetPlacement, 'sheetKind' | 'sheetSlug'>,
  pokemonBySlug: Map<string, CharacterSheet> | undefined,
  resolvePath: MapTokenPathResolver = defaultResolvePath,
): string | null => {
  if (placement.sheetKind !== 'pokemon') return null
  const species = pokemonBySlug?.get(placement.sheetSlug)?.species
  const path = pokedexPathForSpecies(species)
  return path ? resolvePath(path) : null
}

export const useMapTokenNavigation = ({
  map,
  pokemonBySlug,
  canControlPlacement,
  placementById,
  resolvePath = defaultResolvePath,
  openHref = openHrefInNewWindow,
}: UseMapTokenNavigationOptions) => {
  const placementForControlledToken = (id: string): SheetPlacement | null => {
    if (!map.value || !canControlPlacement(id)) return null
    return placementById(id)
  }

  const viewSheet = (id: string): boolean => {
    const placement = placementForControlledToken(id)
    if (!placement) return false
    openHref(resolvePlacementSheetHref(placement, resolvePath))
    return true
  }

  const viewPokedex = (id: string): boolean => {
    const placement = placementForControlledToken(id)
    if (!placement) return false
    const href = resolvePlacementPokedexHref(placement, pokemonBySlug.value, resolvePath)
    if (!href) return false
    openHref(href)
    return true
  }

  return {
    viewSheet,
    viewPokedex,
  }
}
