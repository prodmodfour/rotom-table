/**
 * POST /api/maps/save
 *
 * Persists a full map JSON in place. The map's on-disk path is
 * located by walking ``data/maps/`` for ``<slug>.json``. The slug must
 * match ``body.map.slug``.
 *
 * Request body: `{ slug: string, map: TabletopMap, clientId?: string }`
 * Response:     `{ ok: true, path: string, map: TabletopMap }`
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join as joinPath, resolve as resolvePath } from 'node:path'
import { createError, defineEventHandler, readBody } from 'h3'
import { publishRealtime } from '../../utils/realtime'
import { requireAuthRole } from '../../utils/auth'
import {
  PROJECT_ROOT,
  SLUG_RE,
  findMapFile,
  folderFromPath,
  normalizeMapGroundLevelY,
  readMapFile,
  summarizeMap,
  writeMapFile,
} from '../../utils/mapStorage'
import { normalizeMapFieldEffects } from '~/utils/mapFieldEffects'
import type { GridAnchor, SheetPlacement, TabletopMap } from '~/types/map'

interface SaveBody {
  slug?: string
  map?: TabletopMap
  clientId?: string
}

type SheetKind = SheetPlacement['sheetKind']

const sheetRootFor = (kind: SheetKind): string =>
  resolvePath(PROJECT_ROOT, kind === 'pokemon' ? 'data/sheets' : 'data/trainers')

const findSheetFile = (root: string, fileName: string): string | null => {
  const stack: string[] = [root]
  while (stack.length) {
    const dir = stack.pop()!
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const full = joinPath(dir, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else if (entry.isFile() && entry.name === fileName) return full
    }
  }
  return null
}

const findSheetFileBySlug = (root: string, slug: string): string | null => {
  const stack: string[] = [root]
  while (stack.length) {
    const dir = stack.pop()!
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const full = joinPath(dir, entry.name)
      if (entry.isDirectory()) {
        stack.push(full)
        continue
      }
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue
      try {
        const parsed = JSON.parse(readFileSync(full, 'utf8')) as { slug?: unknown }
        if (parsed?.slug === slug) return full
      } catch {
        // Ignore malformed sheets while walking.
      }
    }
  }
  return null
}

const sheetIsPlayerControlled = (kind: SheetKind, slug: string): boolean => {
  const root = sheetRootFor(kind)
  const path = findSheetFile(root, `${slug}.json`) ?? findSheetFileBySlug(root, slug)
  if (!path) return false
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { player?: unknown }
    return parsed.player === true
  } catch {
    return false
  }
}

const clampAnchor = (value: unknown, fallback: GridAnchor, map: TabletopMap): GridAnchor => {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<Record<keyof GridAnchor, unknown>>
    : {}
  const clampAxis = (axis: keyof GridAnchor, max: number) => {
    const n = Number(record[axis])
    if (!Number.isFinite(n)) return fallback[axis]
    return Math.min(Math.max(0, Math.floor(max) - 1), Math.max(0, Math.round(n)))
  }
  return {
    x: clampAxis('x', map.dimensions?.x ?? 1),
    y: clampAxis('y', map.dimensions?.y ?? 1),
    z: clampAxis('z', map.dimensions?.z ?? 1),
  }
}

const mergePlayerPlacementEdits = (existing: TabletopMap, incoming: TabletopMap): SheetPlacement[] => {
  const incomingById = new Map(
    (Array.isArray(incoming.placements) ? incoming.placements : []).map((placement) => [placement.id, placement]),
  )

  return (existing.placements ?? []).map((placement) => {
    if (!sheetIsPlayerControlled(placement.sheetKind, placement.sheetSlug)) return placement
    const next = incomingById.get(placement.id)
    if (!next || next.sheetKind !== placement.sheetKind || next.sheetSlug !== placement.sheetSlug) {
      return placement
    }
    return {
      ...placement,
      position: clampAnchor(next.position, placement.position, existing),
      turned: typeof next.turned === 'boolean' ? next.turned : placement.turned,
    }
  })
}

const mapForPlayerSave = (existing: TabletopMap, incoming: TabletopMap): TabletopMap => ({
  ...existing,
  placements: mergePlayerPlacementEdits(existing, incoming),
})

export default defineEventHandler(async (event) => {
  const role = requireAuthRole(event)
  const body = await readBody<SaveBody>(event)
  const slug = String(body?.slug ?? '')
  if (!SLUG_RE.test(slug)) {
    throw createError({ statusCode: 400, statusMessage: 'slug must match /^[a-z0-9-]+$/' })
  }
  const map = body?.map
  if (!map || typeof map !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'map must be an object' })
  }
  if (map.slug !== slug) {
    throw createError({
      statusCode: 400,
      statusMessage: `map.slug "${map.slug}" must match request slug "${slug}"`,
    })
  }

  const path = findMapFile(slug)
  if (!path) {
    throw createError({ statusCode: 404, statusMessage: `Map ${slug}.json not found` })
  }

  const existing = readMapFile(path)
  if (role === 'player' && existing.playerVisible !== true) {
    throw createError({ statusCode: 403, statusMessage: 'Map is not player visible' })
  }

  const source = role === 'player' ? mapForPlayerSave(existing, map) : map
  const initiative = source.initiative && typeof source.initiative === 'object'
    ? source.initiative
    : { activeId: null, round: 1 }

  const persisted: TabletopMap = {
    schemaVersion: 2,
    slug: source.slug,
    name: source.name,
    folder: folderFromPath(path),
    dimensions: source.dimensions,
    groundLevelY: normalizeMapGroundLevelY(source.groundLevelY, source.dimensions?.y ?? 1),
    playerVisible: source.playerVisible === true,
    voxels: Array.isArray(source.voxels) ? source.voxels : [],
    hazards: Array.isArray(source.hazards) ? source.hazards : [],
    fieldEffects: normalizeMapFieldEffects(source.fieldEffects),
    placements: Array.isArray(source.placements) ? source.placements : [],
    lights: Array.isArray(source.lights) ? source.lights : [],
    initiative,
    metadata: source.metadata,
    createdAt: source.createdAt,
    updatedAt: Date.now(),
  }
  writeMapFile(path, persisted)

  publishRealtime({
    channel: `map:${slug}`,
    type: 'updated',
    clientId: body?.clientId,
    data: persisted,
  })
  publishRealtime({
    channel: 'maps',
    type: 'updated',
    clientId: body?.clientId,
    data: summarizeMap(persisted),
  })

  return {
    ok: true as const,
    path: path.slice(PROJECT_ROOT.length + 1),
    map: persisted,
  }
})
