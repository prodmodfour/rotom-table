import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

export const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'))

export const hashString = (input) => {
  let hash = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

export const random01 = (seed) => hashString(seed) / 0xffffffff

const walkJson = (dir, out = []) => {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walkJson(full, out)
    else if (entry.isFile() && entry.name.endsWith('.json')) out.push(full)
  }
  return out
}

export const loadBrushes = (rootDir = process.cwd()) => {
  const brushes = new Map()
  for (const file of walkJson(resolve(rootDir, 'data/map-brushes'))) {
    const json = readJson(file)
    for (const [id, brush] of Object.entries(json.brushes ?? {})) brushes.set(id, { id, ...brush })
  }
  return brushes
}

export const loadPrefabs = (rootDir = process.cwd()) => {
  const prefabs = new Map()
  for (const file of walkJson(resolve(rootDir, 'data/map-prefabs'))) {
    const json = readJson(file)
    if (json.id) prefabs.set(json.id, json)
  }
  return prefabs
}

const clone = (value) => JSON.parse(JSON.stringify(value))
const voxelKey = (x, y, z) => `${x},${y},${z}`
const clampInt = (value) => Math.trunc(Number(value))
const normRotation = (rotation = 0) => ((Math.round(rotation / 90) % 4) + 4) % 4

export const createMapAccumulator = (plan) => ({
  schemaVersion: 2,
  slug: plan.slug,
  name: plan.name,
  dimensions: plan.dimensions,
  assetPacks: plan.assetPacks ?? ['airship'],
  voxels: [],
  placements: clone(plan.placements ?? []),
  decals: [],
  props: [],
  zones: [],
  doors: [],
  lights: clone(plan.lights ?? []),
  createdAt: plan.createdAt,
  updatedAt: plan.updatedAt,
  metadata: {
    ...(plan.metadata ?? {}),
    generatedFromPlan: plan.planPath ?? undefined,
    generatedBy: 'scripts/generate-map-from-plan.mjs',
  },
  _voxelMap: new Map(),
})

export const addVoxel = (acc, voxel) => {
  const x = clampInt(voxel.x)
  const y = clampInt(voxel.y)
  const z = clampInt(voxel.z)
  if (x < 0 || y < 0 || z < 0 || x >= acc.dimensions.x || y >= acc.dimensions.y || z >= acc.dimensions.z) return
  const out = { ...voxel, x, y, z }
  const key = voxelKey(x, y, z)
  acc._voxelMap.set(key, out)
}

const pushIfInBounds = (acc, listName, item) => {
  const p = item.position
  if (p && (p.x < 0 || p.x >= acc.dimensions.x || p.y < 0 || p.y >= acc.dimensions.y || p.z < 0 || p.z >= acc.dimensions.z)) return
  acc[listName].push(item)
}

export const addShell = (acc, shell = {}) => {
  const floorMaterial = shell.floorMaterial ?? 'airship_floor_plating'
  const wallMaterial = shell.wallMaterial ?? 'airship_wall_bulkhead'
  const hullMaterial = shell.hullMaterial ?? 'airship_hull_dark'
  const wallHeight = shell.wallHeight ?? 2
  for (let x = 0; x < acc.dimensions.x; x += 1) {
    for (let z = 0; z < acc.dimensions.z; z += 1) {
      const edge = x === 0 || z === 0 || x === acc.dimensions.x - 1 || z === acc.dimensions.z - 1
      addVoxel(acc, { x, y: 0, z, materialId: edge ? hullMaterial : floorMaterial })
      if (edge) {
        for (let y = 1; y <= wallHeight; y += 1) addVoxel(acc, { x, y, z, materialId: wallMaterial })
      }
    }
  }
}

export const paintRegion = (acc, region) => {
  const material = region.materialId
  const y = region.y ?? 0
  for (let x = region.bounds.x1; x < region.bounds.x2; x += 1) {
    for (let z = region.bounds.z1; z < region.bounds.z2; z += 1) addVoxel(acc, { x, y, z, materialId: material, ...(region.voxel ?? {}) })
  }
}

const isEdgeCell = (x, z, b) => x === b.x1 || z === b.z1 || x === b.x2 - 1 || z === b.z2 - 1
const insideInset = (x, z, b, inset) => x >= b.x1 + inset && z >= b.z1 + inset && x < b.x2 - inset && z < b.z2 - inset

export const paintBrushRegion = (acc, zonePlan, brush) => {
  const b = zonePlan.bounds
  const y = b.y1 ?? zonePlan.y ?? 0
  const mats = brush.materials ?? {}
  const primary = mats.primary ?? 'meadow_grass'
  const secondary = mats.secondary ?? primary
  const water = mats.water
  const waterInset = zonePlan.waterInset ?? brush.waterInset ?? null

  for (let x = b.x1; x < b.x2; x += 1) {
    for (let z = b.z1; z < b.z2; z += 1) {
      const edge = isEdgeCell(x, z, b)
      const n = random01(`${zonePlan.id}:${brush.id}:mat:${x}:${z}`)
      let materialId = edge || n < 0.16 ? secondary : primary
      const voxel = { x, y, z, materialId }
      if (water && waterInset != null && insideInset(x, z, b, waterInset)) {
        const deep = random01(`${zonePlan.id}:deep:${x}:${z}`) < 0.28 && (b.x2 - b.x1) > 5 && (b.z2 - b.z1) > 5
        voxel.materialId = deep ? 'deep_water' : water
        if (!deep) voxel.blocksMovement = false
      }
      addVoxel(acc, voxel)
    }
  }

  acc.zones.push({
    id: zonePlan.id,
    name: zonePlan.name ?? brush.displayName ?? brush.id,
    bounds: { x1: b.x1, y1: y, z1: b.z1, x2: b.x2, y2: (b.y2 ?? y + 1), z2: b.z2 },
    theme: zonePlan.brush,
    icon: zonePlan.icon ?? brush.icon,
    tint: zonePlan.tint ?? brush.tint,
    borderStyle: zonePlan.borderStyle ?? 'soft',
    floorWashOpacity: zonePlan.floorWashOpacity ?? brush.floorWashOpacity,
    cornerMarker: zonePlan.cornerMarker ?? brush.cornerMarker,
    tags: [...new Set([...(brush.tags ?? []), ...(zonePlan.tags ?? [])])],
  })

  const edgeDecal = zonePlan.edgeDecal ?? brush.edgeDecals?.[0]
  if (edgeDecal) {
    const cx = (b.x1 + b.x2) / 2
    const cz = (b.z1 + b.z2) / 2
    const width = b.x2 - b.x1
    const depth = b.z2 - b.z1
    const sides = [
      ['north', cx, b.z1 + 0.32, 0, width],
      ['south', cx, b.z2 - 0.32, 180, width],
      ['west', b.x1 + 0.32, cz, 90, depth],
      ['east', b.x2 - 0.32, cz, -90, depth],
    ]
    for (const [side, x, z, rotation, len] of sides) {
      acc.decals.push({
        id: `decal-${zonePlan.id}-${side}`,
        decalId: edgeDecal,
        surface: 'floor',
        position: { x, y, z },
        rotation,
        scale: { x: Math.max(1, Math.min(4, len / 2)), z: 0.55 },
        opacity: 0.42,
        tags: ['brush-edge', zonePlan.brush],
      })
    }
  }

  for (const decalId of brush.thematicDecals ?? []) {
    const count = Math.max(1, Math.floor(((b.x2 - b.x1) * (b.z2 - b.z1)) / 80))
    for (let i = 0; i < count; i += 1) {
      const rx = random01(`${zonePlan.id}:${decalId}:x:${i}`)
      const rz = random01(`${zonePlan.id}:${decalId}:z:${i}`)
      acc.decals.push({
        id: `decal-${zonePlan.id}-${decalId}-${i}`,
        decalId,
        surface: 'floor',
        position: { x: b.x1 + 1 + rx * Math.max(1, b.x2 - b.x1 - 2), y, z: b.z1 + 1 + rz * Math.max(1, b.z2 - b.z1 - 2) },
        rotation: Math.round(random01(`${zonePlan.id}:${decalId}:rot:${i}`) * 360),
        scale: { x: 1.1, z: 1.1 },
        opacity: 0.42,
        tags: ['brush-decal', zonePlan.brush],
      })
    }
  }

  const occupiedScatter = new Set()
  for (const scatter of brush.scatterProps ?? []) {
    const density = Math.max(0, Number(scatter.density ?? 0))
    for (let x = b.x1; x < b.x2; x += 1) {
      for (let z = b.z1; z < b.z2; z += 1) {
        const key = `${x},${z}`
        if (occupiedScatter.has(key)) continue
        if (isEdgeCell(x, z, b) && random01(`${zonePlan.id}:edge-skip:${x}:${z}`) < 0.55) continue
        if (random01(`${zonePlan.id}:${scatter.propId}:${x}:${z}`) >= density) continue
        occupiedScatter.add(key)
        const placement = {
          id: `prop-${zonePlan.id}-${scatter.propId}-${x}-${z}`,
          propId: scatter.propId,
          position: { x, y: y + 1, z },
          rotation: Math.round(random01(`${zonePlan.id}:${scatter.propId}:rot:${x}:${z}`) * 4) * 90,
          blocksMovement: scatter.blocksMovement,
          tags: ['brush-scatter', zonePlan.brush],
        }
        if (scatter.variant) placement.variant = scatter.variant
        acc.props.push(placement)
      }
    }
  }
}

const rotateCell = (x, z, dims, rotation, mirror = false) => {
  const w = dims.x
  const d = dims.z
  let lx = mirror ? w - 1 - x : x
  let lz = z
  switch (normRotation(rotation)) {
    case 1: return { x: d - 1 - lz, z: lx }
    case 2: return { x: w - 1 - lx, z: d - 1 - lz }
    case 3: return { x: lz, z: w - 1 - lx }
    default: return { x: lx, z: lz }
  }
}

const rotatePoint = (x, z, dims, rotation, mirror = false) => {
  const w = dims.x
  const d = dims.z
  let lx = mirror ? w - x : x
  let lz = z
  switch (normRotation(rotation)) {
    case 1: return { x: d - lz, z: lx }
    case 2: return { x: w - lx, z: d - lz }
    case 3: return { x: lz, z: w - lx }
    default: return { x: lx, z: lz }
  }
}

const transformPlacementPosition = (position, prefab, placement, cell = false) => {
  const local = cell
    ? rotateCell(position.x, position.z, prefab.dimensions, placement.rotation ?? 0, placement.mirror)
    : rotatePoint(position.x, position.z, prefab.dimensions, placement.rotation ?? 0, placement.mirror)
  return {
    x: placement.position.x + local.x,
    y: placement.position.y + position.y,
    z: placement.position.z + local.z,
  }
}

export const expandPrefabPlacement = (acc, placement, prefab) => {
  const prefix = placement.id
  for (const voxel of prefab.voxels ?? []) {
    const p = transformPlacementPosition(voxel, prefab, placement, true)
    addVoxel(acc, { ...voxel, ...p })
  }
  for (const decal of prefab.decals ?? []) {
    const p = transformPlacementPosition(decal.position, prefab, placement, false)
    pushIfInBounds(acc, 'decals', {
      ...clone(decal),
      id: `${prefix}-${decal.id}`,
      position: p,
      rotation: (decal.rotation ?? 0) + (placement.rotation ?? 0),
      tags: [...new Set([...(decal.tags ?? []), 'prefab', prefab.id])],
    })
  }
  for (const prop of prefab.props ?? []) {
    const p = transformPlacementPosition(prop.position, prefab, placement, true)
    pushIfInBounds(acc, 'props', {
      ...clone(prop),
      id: `${prefix}-${prop.id}`,
      position: p,
      rotation: (prop.rotation ?? 0) + (placement.rotation ?? 0),
      tags: [...new Set([...(prop.tags ?? []), 'prefab', prefab.id])],
    })
  }
  for (const door of prefab.doors ?? []) {
    const p = transformPlacementPosition(door.position, prefab, placement, false)
    pushIfInBounds(acc, 'doors', {
      ...clone(door),
      id: `${prefix}-${door.id}`,
      position: p,
      rotation: (door.rotation ?? 0) + (placement.rotation ?? 0),
      tags: [...new Set([...(door.tags ?? []), 'prefab', prefab.id])],
    })
  }
  for (const zone of prefab.zones ?? []) {
    const corners = [
      rotatePoint(zone.bounds.x1, zone.bounds.z1, prefab.dimensions, placement.rotation ?? 0, placement.mirror),
      rotatePoint(zone.bounds.x2, zone.bounds.z1, prefab.dimensions, placement.rotation ?? 0, placement.mirror),
      rotatePoint(zone.bounds.x1, zone.bounds.z2, prefab.dimensions, placement.rotation ?? 0, placement.mirror),
      rotatePoint(zone.bounds.x2, zone.bounds.z2, prefab.dimensions, placement.rotation ?? 0, placement.mirror),
    ]
    const xs = corners.map((c) => placement.position.x + c.x)
    const zs = corners.map((c) => placement.position.z + c.z)
    acc.zones.push({
      ...clone(zone),
      id: `${prefix}-${zone.id}`,
      bounds: {
        ...zone.bounds,
        x1: Math.min(...xs),
        x2: Math.max(...xs),
        y1: placement.position.y + (zone.bounds.y1 ?? 0),
        y2: placement.position.y + (zone.bounds.y2 ?? 1),
        z1: Math.min(...zs),
        z2: Math.max(...zs),
      },
      tags: [...new Set([...(zone.tags ?? []), 'prefab', prefab.id])],
    })
  }
}

export const addGlassBarrier = (acc, barrier) => {
  const materialId = barrier.materialId ?? 'reinforced_glass'
  const y1 = barrier.y ?? 1
  const y2 = y1 + (barrier.height ?? 2)
  const x1 = Math.min(barrier.x1, barrier.x2)
  const x2 = Math.max(barrier.x1, barrier.x2)
  const z1 = Math.min(barrier.z1, barrier.z2)
  const z2 = Math.max(barrier.z1, barrier.z2)
  for (let x = x1; x <= x2; x += 1) {
    for (let z = z1; z <= z2; z += 1) {
      if (barrier.openings?.some((o) => x >= o.x1 && x <= o.x2 && z >= o.z1 && z <= o.z2)) continue
      for (let y = y1; y < y2; y += 1) addVoxel(acc, { x, y, z, materialId, blocksMovement: true, blocksSight: false, tags: ['generated-glass-barrier'] })
    }
  }
}

export const finalizeMap = (acc) => {
  acc.voxels = Array.from(acc._voxelMap.values()).sort((a, b) => a.y - b.y || a.z - b.z || a.x - b.x)
  delete acc._voxelMap
  // Keep generation deterministic: plans may provide timestamps, otherwise
  // generated fixtures use 0 instead of changing on every run.
  acc.createdAt ??= 0
  acc.updatedAt ??= acc.createdAt
  return acc
}

export const generateMapFromPlan = (plan, rootDir = process.cwd()) => {
  const brushes = loadBrushes(rootDir)
  const prefabs = loadPrefabs(rootDir)
  const acc = createMapAccumulator(plan)

  if (plan.shell !== false) addShell(acc, typeof plan.shell === 'object' ? plan.shell : {})
  for (const region of plan.baseRegions ?? []) paintRegion(acc, region)
  for (const zone of plan.zones ?? []) {
    const brush = brushes.get(zone.brush)
    if (!brush) throw new Error(`unknown brush "${zone.brush}" for zone ${zone.id}`)
    paintBrushRegion(acc, zone, brush)
  }
  for (const barrier of plan.glassBarriers ?? []) addGlassBarrier(acc, barrier)
  for (const prefabPlacement of plan.prefabs ?? []) {
    const prefab = prefabs.get(prefabPlacement.prefabId)
    if (!prefab) throw new Error(`unknown prefab "${prefabPlacement.prefabId}" for placement ${prefabPlacement.id}`)
    expandPrefabPlacement(acc, prefabPlacement, prefab)
  }
  for (const decal of plan.decals ?? []) acc.decals.push(clone(decal))
  for (const prop of plan.props ?? []) acc.props.push(clone(prop))
  for (const door of plan.doors ?? []) acc.doors.push(clone(door))
  return finalizeMap(acc)
}

export const writeGeneratedMap = (map, outFile) => {
  const abs = resolve(process.cwd(), outFile)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, JSON.stringify(map, null, 2) + '\n', 'utf8')
}
