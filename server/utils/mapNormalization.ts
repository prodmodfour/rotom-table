import type { GridDimensions, MapHazardV2, MapVoxelV2, SheetPlacement, TabletopMapV2 } from '~/types/map'
import { normalizeMapSceneState } from '~/utils/mapSceneState'
import {
  EncounterStateValidationError,
  createEmptyEncounterState,
  encounterStateHasSide,
  isEncounterSideId,
  parseEncounterState,
  type EncounterState,
} from '#shared/moveAutomation/encounterState'
import { SLUG_RE } from '#shared/paths'
import { normalizeRevision } from '#shared/sessionRevisions'
import { normalizeMapFieldEffects } from '~/utils/mapFieldEffects'
import { normalizeMapHazard } from '~/utils/mapHazards'
import { normalizeMaterialId } from '~/utils/mapMaterials'
import { normalizeMapMoveUsage } from '~/utils/moveUsage'
import { normalizeMapShopInterfaces } from '~/utils/mapShopInterfaces'
import { normalizeMapTemporaryHitPointsState } from '~/utils/mapTemporaryHitPoints'

export interface NormalizeMapDocumentOptions {
  /** Human-readable source label used in validation errors. */
  sourceLabel?: string
  /** Folder derived by the storage boundary from the document path. */
  folder?: string
}

const defaultSourceLabel = 'document'

const invalidMapDocument = (sourceLabel: string, message: string): never => {
  throw new Error(`Map ${sourceLabel} is invalid: ${message}`)
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value))

const expectRecord = (value: unknown, sourceLabel: string, message: string): Record<string, unknown> => {
  if (!isRecord(value)) invalidMapDocument(sourceLabel, message)
  return value as Record<string, unknown>
}

const normalizeMapDimensionsForEditor = (value: unknown, sourceLabel: string): GridDimensions => {
  const record = expectRecord(value, sourceLabel, 'dimensions must be an object with integer x/y/z values')
  const out = {} as GridDimensions
  for (const axis of ['x', 'y', 'z'] as const) {
    const n = record[axis]
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 200) {
      invalidMapDocument(sourceLabel, `dimensions.${axis} must be an integer 1..200`)
    }
    out[axis] = n as number
  }
  return out
}

export const normalizeMapGroundLevelY = (value: unknown, height: number): number => {
  const h = Number(height)
  const max = Number.isFinite(h) ? Math.max(0, Math.floor(h) - 1) : 0
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.min(max, Math.max(0, Math.round(n)))
}

const normalizeVoxelForEditor = (value: unknown, index: number, sourceLabel: string): MapVoxelV2 => {
  const record = expectRecord(value, sourceLabel, `voxels[${index}] must be an object`)
  for (const axis of ['x', 'y', 'z'] as const) {
    if (typeof record[axis] !== 'number' || !Number.isInteger(record[axis])) {
      invalidMapDocument(sourceLabel, `voxels[${index}].${axis} must be an integer`)
    }
  }
  if (typeof record.materialId !== 'string' || !record.materialId.trim()) {
    invalidMapDocument(sourceLabel, `voxels[${index}].materialId must be a non-empty string`)
  }
  const out: MapVoxelV2 = {
    x: record.x as number,
    y: record.y as number,
    z: record.z as number,
    materialId: normalizeMaterialId(record.materialId as string),
  }
  if (typeof record.color === 'string') out.color = record.color
  if (typeof record.ghost === 'boolean') out.ghost = record.ghost
  if (typeof record.blocksMovement === 'boolean') out.blocksMovement = record.blocksMovement
  if (typeof record.blocksSight === 'boolean') out.blocksSight = record.blocksSight
  if (Array.isArray(record.tags)) out.tags = record.tags.filter((tag: unknown): tag is string => typeof tag === 'string')
  return out
}

const normalizeHazardForEditor = (value: unknown, index: number, sourceLabel: string): MapHazardV2 => {
  const hazard = normalizeMapHazard(value)
  if (!hazard) invalidMapDocument(sourceLabel, `hazards[${index}] must be an object with integer x/y/z and valid kind`)
  return hazard as MapHazardV2
}

const normalizeMapEncounterState = (value: unknown, sourceLabel: string): EncounterState => {
  if (value === undefined) return createEmptyEncounterState()
  try {
    return parseEncounterState(value)
  } catch (error) {
    if (error instanceof EncounterStateValidationError) {
      invalidMapDocument(sourceLabel, error.message)
    }
    throw error
  }
}

const normalizePlacementForEditor = (
  value: unknown,
  index: number,
  sourceLabel: string,
  encounterState: EncounterState,
): SheetPlacement => {
  const record = expectRecord(value, sourceLabel, `placements[${index}] must be an object`)
  const sideId = record.sideId
  if (sideId !== undefined && !isEncounterSideId(sideId)) {
    invalidMapDocument(
      sourceLabel,
      `placements[${index}].sideId must be a lowercase alphanumeric/hyphen encounter side ID`,
    )
  }
  if (isEncounterSideId(sideId) && !encounterStateHasSide(encounterState, sideId)) {
    invalidMapDocument(
      sourceLabel,
      `placements[${index}].sideId references unknown encounter side ${sideId}`,
    )
  }

  const placement = { ...record } as unknown as SheetPlacement
  if (sideId === undefined) delete (placement as unknown as Record<string, unknown>).sideId
  return placement
}

export const normalizeMapDocument = (
  json: unknown,
  options: NormalizeMapDocumentOptions = {},
): TabletopMapV2 => {
  const sourceLabel = options.sourceLabel ?? defaultSourceLabel
  const record = expectRecord(json, sourceLabel, 'root must be an object')
  if (record.schemaVersion !== 2) invalidMapDocument(sourceLabel, 'schemaVersion must be 2')
  if (!SLUG_RE.test(String(record.slug ?? ''))) invalidMapDocument(sourceLabel, 'slug must match /^[a-z0-9-]+$/')
  if (typeof record.name !== 'string' || !record.name.trim()) invalidMapDocument(sourceLabel, 'name must be a non-empty string')
  const dimensions = normalizeMapDimensionsForEditor(record.dimensions, sourceLabel)

  const initiative = record.initiative && typeof record.initiative === 'object'
    ? record.initiative as TabletopMapV2['initiative']
    : { activeId: null, round: 1 }

  const voxelValues = Array.isArray(record.voxels)
    ? record.voxels as unknown[]
    : invalidMapDocument(sourceLabel, 'voxels must be an array')
  const voxels = voxelValues
    .map((voxel: unknown, index: number) => normalizeVoxelForEditor(voxel, index, sourceLabel))
  const hazards = Array.isArray(record.hazards)
    ? (record.hazards as unknown[]).map((hazard: unknown, index: number) => normalizeHazardForEditor(hazard, index, sourceLabel))
    : []

  const activeScene = normalizeMapSceneState(record.activeScene)
  const temporaryHitPoints = normalizeMapTemporaryHitPointsState(record.temporaryHitPoints, activeScene)
  const encounterState = normalizeMapEncounterState(record.encounterState, sourceLabel)
  const placements = Array.isArray(record.placements)
    ? (record.placements as unknown[]).map((placement, index) => (
        normalizePlacementForEditor(placement, index, sourceLabel, encounterState)
      ))
    : []

  return {
    schemaVersion: 2,
    revision: normalizeRevision(record.revision),
    slug: record.slug as string,
    name: record.name as string,
    folder: typeof options.folder === 'string'
      ? options.folder
      : (typeof record.folder === 'string' ? record.folder : ''),
    dimensions,
    groundLevelY: normalizeMapGroundLevelY(record.groundLevelY, dimensions.y),
    playerVisible: record.playerVisible === true,
    shopInterfaces: normalizeMapShopInterfaces(record.shopInterfaces),
    voxels,
    hazards,
    fieldEffects: normalizeMapFieldEffects(record.fieldEffects),
    placements,
    lights: Array.isArray(record.lights) ? record.lights as TabletopMapV2['lights'] : [],
    initiative,
    ...(activeScene ? { activeScene } : {}),
    ...(temporaryHitPoints ? { temporaryHitPoints } : {}),
    moveUsage: normalizeMapMoveUsage(record.moveUsage),
    encounterState,
    metadata: record.metadata as TabletopMapV2['metadata'],
    createdAt: record.createdAt as TabletopMapV2['createdAt'],
    updatedAt: record.updatedAt as TabletopMapV2['updatedAt'],
  }
}
