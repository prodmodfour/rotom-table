import pokedexData from '~~/data/reference/pokedex.json'
import type { CharacterSheet } from '~/types/characterSheet'
import type { PokedexRecord } from '~/types/pokemon'
import { pokemonCatalogBySpecies } from '~~/data/pokemonCatalog'
import { folderFromGlobKey } from '~/utils/sheetFolders'

// ---------------------------------------------------------------------------
// Auto-discover every JSON sheet under ``data/sheets`` (recursively). Drop a
// new file there and it'll appear on the index page without any wiring.
//
// Subdirectories under ``data/sheets/`` become *folders* on the index, e.g.
// ``data/sheets/team-alpha/bolt-pikachu.json`` is grouped under
// ``"team-alpha"``. A sheet may set ``folder`` explicitly to override the
// auto-derived value.
// ---------------------------------------------------------------------------

const sheetModules = import.meta.glob<{ default: CharacterSheet }>(
  './sheets/**/*.json',
  { eager: true },
)

export const characterSheets: CharacterSheet[] = Object.entries(sheetModules)
  .map(([key, mod]) => {
    const sheet = mod.default
    return {
      ...sheet,
      // Honour an explicit folder override; otherwise derive from the path.
      folder: sheet.folder ?? folderFromGlobKey(key, 'sheets'),
    }
  })
  .sort((a, b) => {
    // Sort by folder first (so groups are stable), then by nickname.
    const folderCmp = (a.folder ?? '').localeCompare(b.folder ?? '')
    if (folderCmp !== 0) return folderCmp
    return a.nickname.localeCompare(b.nickname)
  })

export const characterSheetsBySlug = new Map(characterSheets.map((sheet) => [sheet.slug, sheet]))

// ---------------------------------------------------------------------------
// Species/catalog lookups so UI and sheet resolvers can layer personal sheet
// data over the app-owned PTU species reference data.
// ---------------------------------------------------------------------------

const pokedexBySpecies = new Map<string, PokedexRecord>(
  (pokedexData as PokedexRecord[]).map((entry) => [entry.species, entry]),
)

export const getPokedexEntry = (species: string): PokedexRecord | null =>
  pokedexBySpecies.get(species) ?? null

export const getSpriteUrl = (species: string): string | null =>
  pokemonCatalogBySpecies.get(species)?.spriteUrl ?? null
