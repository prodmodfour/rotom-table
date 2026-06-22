import pokedexData from '~~/data/reference/pokedex.json'
import type { CharacterSheet } from '~/types/characterSheet'
import type { PokedexRecord } from '~/types/pokemon'
import { pokemonCatalogBySpecies } from '~~/data/pokemonCatalog'
import { toPokedexSlug } from '~/utils/pokedex/searchFieldValues'
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

const pokedexRecords = pokedexData as PokedexRecord[]

const pokedexBySpecies = new Map<string, PokedexRecord>(
  pokedexRecords.map((entry) => [entry.species, entry]),
)

const pokedexBySpeciesSlug = new Map<string, PokedexRecord>()
for (const entry of pokedexRecords) {
  const slug = toPokedexSlug(entry.species)
  if (slug && !pokedexBySpeciesSlug.has(slug)) pokedexBySpeciesSlug.set(slug, entry)
}

export const getPokedexEntry = (species: string): PokedexRecord | null => {
  const exactEntry = pokedexBySpecies.get(species)
  if (exactEntry) return exactEntry

  const slug = toPokedexSlug(species)
  return slug ? pokedexBySpeciesSlug.get(slug) ?? null : null
}

export const getSpriteUrl = (species: string): string | null =>
  pokemonCatalogBySpecies.get(species)?.spriteUrl ?? null
