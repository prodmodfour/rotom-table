/**
 * Reactive store of every Pokémon + trainer character sheet, kept in
 * sync with the server via SSE.
 *
 * Bootstrapped from the static `import.meta.glob` data so the first
 * paint has full info; thereafter, save / rename / move / delete events
 * mutate the store so any component reading from it (map editor, sheet
 * list, etc.) stays current with cross-tab edits.
 *
 * Returned refs are reactive — placements can simply read
 * `pokemonBySlug.value.get(slug)` inside a `computed` and Vue will
 * track the dependency.
 */
import { reactive, ref } from 'vue'
import { characterSheets } from '~~/data/characterSheets'
import { trainerSheets } from '~~/data/trainerSheets'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import { sheetsChannel } from '#shared/realtime'
import type { SheetKind } from '#shared/sheets'
import { subscribeChannel } from './useRealtime'

interface LiveSheetsApi {
  pokemonBySlug: ReturnType<typeof ref<Map<string, CharacterSheet>>>
  trainerBySlug: ReturnType<typeof ref<Map<string, TrainerSheet>>>
}

let cached: LiveSheetsApi | null = null
let unsubscribe: (() => void) | null = null

const buildInitial = () => {
  const pokemon = new Map<string, CharacterSheet>()
  const trainer = new Map<string, TrainerSheet>()
  for (const sheet of characterSheets) pokemon.set(sheet.slug, sheet)
  for (const sheet of trainerSheets) trainer.set(sheet.slug, sheet)
  return { pokemon, trainer }
}

export const useLiveSheets = (): LiveSheetsApi => {
  if (cached) return cached

  const initial = buildInitial()
  // Use reactive() so per-key mutations propagate to consumers without
  // having to clone the whole Map on every event.
  const pokemonBySlug = ref<Map<string, CharacterSheet>>(reactive(initial.pokemon) as Map<string, CharacterSheet>)
  const trainerBySlug = ref<Map<string, TrainerSheet>>(reactive(initial.trainer) as Map<string, TrainerSheet>)

  cached = { pokemonBySlug, trainerBySlug }

  if (typeof window !== 'undefined') {
    const handler = (event: { type: string; data?: unknown }) => {
      const payload = event.data as
        | {
          kind?: SheetKind
          slug?: string
          oldSlug?: string
          newSlug?: string
          sheet?: CharacterSheet | TrainerSheet
        }
        | undefined
      if (!payload || !payload.kind) return
      const map = payload.kind === 'pokemon' ? pokemonBySlug.value : trainerBySlug.value
      if (event.type === 'deleted' && payload.slug) {
        map.delete(payload.slug)
      } else if (event.type === 'renamed' && payload.newSlug && payload.sheet) {
        if (payload.oldSlug) map.delete(payload.oldSlug)
        map.set(payload.newSlug, payload.sheet as CharacterSheet & TrainerSheet)
      } else if (event.type === 'updated' && payload.slug && payload.sheet) {
        // Replace the entry — placements re-derive their spawn data on
        // every read so simply swapping the object is enough.
        map.set(payload.slug, payload.sheet as CharacterSheet & TrainerSheet)
      }
    }
    unsubscribe = subscribeChannel(sheetsChannel, handler)
  }

  return cached
}

export const teardownLiveSheets = (): void => {
  if (unsubscribe) {
    unsubscribe()
    unsubscribe = null
  }
  cached = null
}
