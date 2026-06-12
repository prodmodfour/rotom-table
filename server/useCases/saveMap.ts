import { UseCaseHttpError } from '../utils/useCaseErrors'
import { MAP_INTERACTION_MODES, type MapInteractionMode } from '#shared/mapInteractionMode'
import type { RealtimeEvent } from '#shared/realtime'
import { normalizeRevision, nextRevision } from '#shared/sessionRevisions'
import { normalizeMapFieldEffects } from '~/utils/mapFieldEffects'
import { normalizeMapMoveUsage } from '~/utils/moveUsage'
import type { AuthRole } from '#shared/auth'
import type { TabletopMap } from '~/types/map'
import { campaignPathLabel } from '../utils/campaignPaths'
import { findMapFile, readMapFile, writeMapFile } from '../utils/mapStorage'
import { folderFromPath } from '../utils/mapPaths'
import { mapDocumentUpdatedRealtimeEvents } from '../utils/mapRealtimeEvents'
import { normalizeMapGroundLevelY } from '../utils/mapNormalization'

export class SaveMapUseCaseError extends UseCaseHttpError<400 | 403 | 404> {}

export interface SaveMapInput {
  role: AuthRole
  slug: string
  map: TabletopMap
  clientId?: string
  interactionMode: MapInteractionMode
}

export interface SaveMapDependencies {
  findMapPath?: (slug: string) => string | null
  readMap?: (filePath: string) => TabletopMap
  writeMap?: (filePath: string, map: TabletopMap) => void
  relativePath?: (filePath: string) => string
  now?: () => number
}

export interface SaveMapResult {
  ok: true
  path: string
  map: TabletopMap
  events: Array<Omit<RealtimeEvent, 'timestamp'>>
}

export interface ToPersistedMapOptions {
  revision?: number
  advanceRevision?: boolean
}

export const toPersistedMap = (
  source: TabletopMap,
  filePath: string,
  updatedAt: number,
  options: ToPersistedMapOptions = {},
): TabletopMap => {
  const initiative = source.initiative && typeof source.initiative === 'object'
    ? source.initiative
    : { activeId: null, round: 1 }

  return {
    schemaVersion: 2,
    revision: options.revision ?? (options.advanceRevision
      ? nextRevision(normalizeRevision(source.revision))
      : normalizeRevision(source.revision)),
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

  if (input.interactionMode !== MAP_INTERACTION_MODES.SETUP_EDIT) {
    throw new SaveMapUseCaseError(403, 'Whole-map saves are setup/edit-only; live play uses commands')
  }
  if (input.role !== 'gm') {
    throw new SaveMapUseCaseError(403, 'Player whole-map saves are not allowed; live play uses commands')
  }

  const findMapPath = dependencies.findMapPath ?? findMapFile
  const readMap = dependencies.readMap ?? readMapFile
  const writeMap = dependencies.writeMap ?? writeMapFile
  const relativePath = dependencies.relativePath ?? campaignPathLabel

  const filePath = findMapPath(input.slug)
  if (!filePath) throw new SaveMapUseCaseError(404, `Map ${input.slug}.json not found`)

  const existing = readMap(filePath)
  const sourceWithMoveUsage = Object.prototype.hasOwnProperty.call(input.map, 'moveUsage') || !existing.moveUsage
    ? input.map
    : { ...input.map, moveUsage: existing.moveUsage }

  const persisted = toPersistedMap(sourceWithMoveUsage, filePath, dependencies.now?.() ?? Date.now(), {
    revision: Object.prototype.hasOwnProperty.call(sourceWithMoveUsage, 'revision')
      ? normalizeRevision(sourceWithMoveUsage.revision)
      : normalizeRevision(existing.revision),
  })
  writeMap(filePath, persisted)

  return {
    ok: true,
    path: relativePath(filePath),
    map: persisted,
    events: mapDocumentUpdatedRealtimeEvents(persisted, input.clientId),
  }
}
