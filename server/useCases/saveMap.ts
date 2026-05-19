import { UseCaseHttpError } from '../utils/useCaseErrors'
import { mapChannel, mapsChannel, type RealtimeEvent } from '#shared/realtime'
import { normalizeMapFieldEffects } from '~/utils/mapFieldEffects'
import { normalizeMapMoveUsage } from '~/utils/moveUsage'
import type { AuthRole } from '#shared/auth'
import type { TabletopMap } from '~/types/map'
import { relativeToProjectRoot } from '../utils/fsPaths'
import { findMapFile, readMapFile, writeMapFile } from '../utils/mapStorage'
import { folderFromPath } from '../utils/mapPaths'
import { summarizeMap } from '../utils/mapSummaries'
import { normalizeMapGroundLevelY } from '../utils/mapNormalization'
import { sheetIsPlayerAccessible } from '../utils/sheetStorage'
import {
  applyPlayerMapSavePolicy,
  canSaveMap,
  type SheetAccessPredicate,
} from '../policies/mapPolicy'

export class SaveMapUseCaseError extends UseCaseHttpError<400 | 403 | 404> {}

export interface SaveMapInput {
  role: AuthRole
  slug: string
  map: TabletopMap
  clientId?: string
}

export interface SaveMapDependencies {
  canControlSheet?: SheetAccessPredicate
  now?: () => number
}

export interface SaveMapResult {
  ok: true
  path: string
  map: TabletopMap
  events: Array<Omit<RealtimeEvent, 'timestamp'>>
}

export const toPersistedMap = (
  source: TabletopMap,
  filePath: string,
  updatedAt: number,
): TabletopMap => {
  const initiative = source.initiative && typeof source.initiative === 'object'
    ? source.initiative
    : { activeId: null, round: 1 }

  return {
    schemaVersion: 2,
    slug: source.slug,
    name: source.name,
    folder: folderFromPath(filePath),
    dimensions: source.dimensions,
    groundLevelY: normalizeMapGroundLevelY(source.groundLevelY, source.dimensions?.y ?? 1),
    playerVisible: source.playerVisible === true,
    voxels: Array.isArray(source.voxels) ? source.voxels : [],
    hazards: Array.isArray(source.hazards) ? source.hazards : [],
    fieldEffects: normalizeMapFieldEffects(source.fieldEffects),
    placements: Array.isArray(source.placements) ? source.placements : [],
    lights: Array.isArray(source.lights) ? source.lights : [],
    initiative,
    moveUsage: normalizeMapMoveUsage(source.moveUsage),
    metadata: source.metadata,
    createdAt: source.createdAt,
    updatedAt,
  }
}

export const saveMapUseCase = (
  input: SaveMapInput,
  dependencies: SaveMapDependencies = {},
): SaveMapResult => {
  if (input.map.slug !== input.slug) {
    throw new SaveMapUseCaseError(
      400,
      `map.slug "${input.map.slug}" must match request slug "${input.slug}"`,
    )
  }

  const filePath = findMapFile(input.slug)
  if (!filePath) throw new SaveMapUseCaseError(404, `Map ${input.slug}.json not found`)

  const existing = readMapFile(filePath)
  if (!canSaveMap(input.role, existing)) {
    throw new SaveMapUseCaseError(403, 'Map is not player visible')
  }

  const source = input.role === 'player'
    ? applyPlayerMapSavePolicy(
      existing,
      input.map,
      dependencies.canControlSheet ?? sheetIsPlayerAccessible,
    )
    : input.map
  const sourceWithMoveUsage = Object.prototype.hasOwnProperty.call(source, 'moveUsage') || !existing.moveUsage
    ? source
    : { ...source, moveUsage: existing.moveUsage }

  const persisted = toPersistedMap(sourceWithMoveUsage, filePath, dependencies.now?.() ?? Date.now())
  writeMapFile(filePath, persisted)

  return {
    ok: true,
    path: relativeToProjectRoot(filePath),
    map: persisted,
    events: [
      {
        channel: mapChannel(input.slug),
        type: 'updated',
        clientId: input.clientId,
        data: persisted,
      },
      {
        channel: mapsChannel,
        type: 'updated',
        clientId: input.clientId,
        data: summarizeMap(persisted),
      },
    ],
  }
}
