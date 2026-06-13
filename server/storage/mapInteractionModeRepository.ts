import { validateSlug } from '#shared/paths'
import {
  DEFAULT_MAP_INTERACTION_MODE,
  isMapInteractionMode,
  type MapInteractionMode,
} from '#shared/mapInteractionMode'
import { getRotomDatabase, type RotomDatabase } from './database'
import { parseStoredTimestamp } from './documentJson'

export interface StoredMapInteractionMode {
  readonly slug: string
  readonly interactionMode: MapInteractionMode
  readonly updatedAt: number
}

export interface SaveMapInteractionModeInput {
  readonly slug: string
  readonly interactionMode: MapInteractionMode
  readonly updatedAt: number
}

export interface MapInteractionModeRepository {
  get(slug: string): StoredMapInteractionMode
  set(input: SaveMapInteractionModeInput): StoredMapInteractionMode
  delete(slug: string): boolean
}

interface MapInteractionModeRow {
  readonly slug: unknown
  readonly interaction_mode: unknown
  readonly updated_at: unknown
}

const defaultState = (slug: string): StoredMapInteractionMode => ({
  slug,
  interactionMode: DEFAULT_MAP_INTERACTION_MODE,
  updatedAt: 0,
})

const rowToMapInteractionMode = (row: MapInteractionModeRow | undefined, slug: string): StoredMapInteractionMode => {
  const parsedSlug = validateSlug(slug, 'map slug')
  if (!row) return defaultState(parsedSlug)
  if (typeof row.slug !== 'string') throw new Error('map_interaction_modes.slug must be a string')
  if (row.slug !== parsedSlug) throw new Error(`map_interaction_modes row slug ${row.slug} must match ${parsedSlug}`)
  if (!isMapInteractionMode(row.interaction_mode)) {
    throw new Error(`map_interaction_modes.interaction_mode for ${parsedSlug} must be setup-edit or live-play`)
  }
  return {
    slug: parsedSlug,
    interactionMode: row.interaction_mode,
    updatedAt: parseStoredTimestamp(row.updated_at, `map interaction mode ${parsedSlug} updated_at`),
  }
}

const normalizeInput = (input: SaveMapInteractionModeInput): SaveMapInteractionModeInput => {
  if (!isMapInteractionMode(input.interactionMode)) {
    throw new Error('map interaction mode must be setup-edit or live-play')
  }
  return {
    slug: validateSlug(input.slug, 'map slug'),
    interactionMode: input.interactionMode,
    updatedAt: parseStoredTimestamp(input.updatedAt, 'map interaction mode updatedAt'),
  }
}

export const createSqliteMapInteractionModeRepository = (
  database: RotomDatabase = getRotomDatabase(),
): MapInteractionModeRepository => {
  const get = (slug: string): StoredMapInteractionMode => {
    const parsedSlug = validateSlug(slug, 'map slug')
    const row = database.connection.prepare(`
      SELECT slug, interaction_mode, updated_at
      FROM map_interaction_modes
      WHERE slug = ?
    `).get(parsedSlug) as unknown as MapInteractionModeRow | undefined
    return rowToMapInteractionMode(row, parsedSlug)
  }

  const set = (input: SaveMapInteractionModeInput): StoredMapInteractionMode => database.withTransaction(() => {
    const normalized = normalizeInput(input)
    database.connection.prepare(`
      INSERT INTO map_interaction_modes (slug, interaction_mode, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(slug) DO UPDATE SET
        interaction_mode = excluded.interaction_mode,
        updated_at = excluded.updated_at
    `).run(normalized.slug, normalized.interactionMode, normalized.updatedAt)
    return { ...normalized }
  })

  const remove = (slug: string): boolean => database.withTransaction(() => {
    const parsedSlug = validateSlug(slug, 'map slug')
    const result = database.connection.prepare('DELETE FROM map_interaction_modes WHERE slug = ?').run(parsedSlug)
    return Number(result.changes) > 0
  })

  return { get, set, delete: remove }
}

const defaultMapInteractionModeRepository = (): MapInteractionModeRepository =>
  createSqliteMapInteractionModeRepository(getRotomDatabase())

export const sqliteMapInteractionModeRepository: MapInteractionModeRepository = {
  get: (slug) => defaultMapInteractionModeRepository().get(slug),
  set: (input) => defaultMapInteractionModeRepository().set(input),
  delete: (slug) => defaultMapInteractionModeRepository().delete(slug),
}
