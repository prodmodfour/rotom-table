#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = process.cwd()

const readIds = (rootDir, file, regex) => {
  const text = readFileSync(resolve(rootDir, file), 'utf8')
  const ids = new Set()
  let match
  regex.lastIndex = 0
  while ((match = regex.exec(text))) ids.add(match[1])
  return ids
}

const addToMapSet = (map, id, pack) => {
  if (!id || !pack) return
  let set = map.get(id)
  if (!set) {
    set = new Set()
    map.set(id, set)
  }
  set.add(pack)
}

const readLocalAssetRegistry = (rootDir) => {
  const registry = {
    materialIds: new Set(),
    decalIds: new Set(),
    propIds: new Set(),
    doorIds: new Set(),
    iconIds: new Set(),
    propVariants: new Map(),
    assetPacksByKind: {
      materials: new Map(),
      decals: new Map(),
      props: new Map(),
      doors: new Map(),
      icons: new Map(),
    },
    localAssetPackIds: new Set(),
    manifestErrors: [],
  }

  // Offline fallback definitions remain valid when a manifest is missing.
  for (const id of readIds(rootDir, 'utils/mapMaterials.ts', /mat\('([^']+)'/g)) {
    registry.materialIds.add(id)
    addToMapSet(registry.assetPacksByKind.materials, id, 'airship')
  }
  for (const id of readIds(rootDir, 'utils/mapAssets.ts', /decal\('([^']+)'/g)) {
    registry.decalIds.add(id)
    addToMapSet(registry.assetPacksByKind.decals, id, 'airship')
  }
  for (const id of readIds(rootDir, 'utils/mapAssets.ts', /prop\('([^']+)'/g)) {
    registry.propIds.add(id)
    addToMapSet(registry.assetPacksByKind.props, id, 'airship')
  }
  for (const id of readIds(rootDir, 'utils/mapAssets.ts', /door\('([^']+)'/g)) {
    registry.doorIds.add(id)
    addToMapSet(registry.assetPacksByKind.doors, id, 'airship')
  }

  const assetRoot = resolve(rootDir, 'public/assets/map')
  if (!existsSync(assetRoot)) return registry

  for (const entry of readdirSync(assetRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const dirPack = entry.name
    registry.localAssetPackIds.add(dirPack)
    const manifestPath = resolve(assetRoot, dirPack, 'manifest.json')
    if (!existsSync(manifestPath)) continue
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      const packId = typeof manifest.id === 'string' && manifest.id.trim() ? manifest.id.trim() : dirPack
      registry.localAssetPackIds.add(packId)

      for (const id of Object.keys(manifest.materials ?? {})) {
        registry.materialIds.add(id)
        addToMapSet(registry.assetPacksByKind.materials, id, packId)
        addToMapSet(registry.assetPacksByKind.materials, id, dirPack)
      }
      for (const id of Object.keys(manifest.decals ?? {})) {
        registry.decalIds.add(id)
        addToMapSet(registry.assetPacksByKind.decals, id, packId)
        addToMapSet(registry.assetPacksByKind.decals, id, dirPack)
      }
      for (const id of Object.keys(manifest.icons ?? {})) {
        registry.iconIds.add(id)
        registry.decalIds.add(id)
        addToMapSet(registry.assetPacksByKind.icons, id, packId)
        addToMapSet(registry.assetPacksByKind.icons, id, dirPack)
        addToMapSet(registry.assetPacksByKind.decals, id, packId)
        addToMapSet(registry.assetPacksByKind.decals, id, dirPack)
      }
      for (const [id, prop] of Object.entries(manifest.props ?? {})) {
        registry.propIds.add(id)
        addToMapSet(registry.assetPacksByKind.props, id, packId)
        addToMapSet(registry.assetPacksByKind.props, id, dirPack)
        if (Array.isArray(prop?.variants)) {
          const variants = new Set(prop.variants.map((variant) => variant?.id).filter((value) => typeof value === 'string' && value.trim()))
          if (variants.size) registry.propVariants.set(id, variants)
        }
      }
      for (const id of Object.keys(manifest.doors ?? {})) {
        registry.doorIds.add(id)
        addToMapSet(registry.assetPacksByKind.doors, id, packId)
        addToMapSet(registry.assetPacksByKind.doors, id, dirPack)
      }
    } catch (err) {
      registry.manifestErrors.push(`${manifestPath}: could not parse manifest JSON: ${err.message}`)
    }
  }
  return registry
}

export const createRegistry = (rootDir = root) => readLocalAssetRegistry(rootDir)

const defaultRegistry = createRegistry(root)

const isObj = (value) => value && typeof value === 'object' && !Array.isArray(value)
const isNum = (value) => typeof value === 'number' && Number.isFinite(value)
const id = (value) => typeof value === 'string' && value.trim().length > 0
const hex = (value) => value == null || (typeof value === 'string' && /^#?[0-9a-fA-F]{6}$/.test(value))
const knownList = (set) => Array.from(set).sort((a, b) => a.localeCompare(b)).join(', ')

const checkPositive = (errors, label, value) => {
  if (!isNum(value) || value <= 0) errors.push(`${label} must be a positive number`)
}

const validateScaleObject = (errors, label, scale, requiredAxes, optionalAxes = []) => {
  if (!isObj(scale)) return errors.push(`${label} must be an object with positive ${requiredAxes.join('/')} values`)
  for (const axis of requiredAxes) checkPositive(errors, `${label}.${axis}`, scale[axis])
  for (const axis of optionalAxes) {
    if (scale[axis] != null) checkPositive(errors, `${label}.${axis}`, scale[axis])
  }
}

const validateAnchor = (errors, label, p, dims, integer = false, checkBounds = true) => {
  if (!isObj(p)) return errors.push(`${label} must be an object with x/y/z ${integer ? 'integer' : 'number'} values`)
  for (const axis of ['x', 'y', 'z']) {
    if (!isNum(p[axis]) || (integer && !Number.isInteger(p[axis]))) errors.push(`${label}.${axis} must be a ${integer ? 'integer' : 'number'}`)
  }
  if (!checkBounds) return
  if (isNum(p.x) && (p.x < 0 || p.x >= dims.x)) errors.push(`${label}.x=${p.x} outside dimensions.x 0..${dims.x - 1}`)
  if (isNum(p.y) && (p.y < 0 || p.y >= dims.y)) errors.push(`${label}.y=${p.y} outside dimensions.y 0..${dims.y - 1}`)
  if (isNum(p.z) && (p.z < 0 || p.z >= dims.z)) errors.push(`${label}.z=${p.z} outside dimensions.z 0..${dims.z - 1}`)
}

const validateAssetPacks = (errors, map, file, registry) => {
  const usesRuntimeAssets =
    (Array.isArray(map.decals) && map.decals.length > 0) ||
    (Array.isArray(map.props) && map.props.length > 0) ||
    (Array.isArray(map.doors) && map.doors.length > 0)

  if (map.assetPacks == null) {
    if (usesRuntimeAssets) errors.push('assetPacks is required when decals/props/doors are used; use local manifest pack ids such as ["airship", "nature", "facility"]')
    return []
  }

  if (!Array.isArray(map.assetPacks)) {
    errors.push('assetPacks must be an array of local pack ids, e.g. ["airship", "nature"]')
    return []
  }

  const seen = new Set()
  map.assetPacks.forEach((pack, i) => {
    if (!id(pack)) return errors.push(`assetPacks[${i}] must be a non-empty string`)
    if (seen.has(pack)) errors.push(`assetPacks has duplicate entry "${pack}"`)
    seen.add(pack)
    if (!registry.localAssetPackIds.has(pack)) {
      errors.push(`assetPacks[${i}] unknown local pack "${pack}"; known local packs: ${knownList(registry.localAssetPackIds) || '(none found under public/assets/map)'}`)
    }
  })

  if (file.includes('airship-habitat-atrium-v2') && !map.assetPacks.includes('airship')) {
    errors.push('demo map airship-habitat-atrium-v2 must include assetPacks: ["airship"]')
  }

  return map.assetPacks
}

const selectedPackAllows = (registry, kind, assetId, selectedPacks) => {
  if (!selectedPacks?.length) return true
  const packs = registry.assetPacksByKind[kind]?.get(assetId)
  if (!packs || packs.size === 0) return true
  return selectedPacks.some((pack) => packs.has(pack))
}

const selectedPackError = (registry, kind, assetId, selectedPacks) => {
  const packs = registry.assetPacksByKind[kind]?.get(assetId)
  return `${kind.slice(0, -1)} "${assetId}" is provided by pack(s) ${knownList(packs ?? new Set())}, but map assetPacks is ${JSON.stringify(selectedPacks)}`
}

export const validateMap = (map, file = '<memory>', registry = defaultRegistry) => {
  const errors = []
  if (!isObj(map)) return [`${file}: root must be an object`]
  for (const err of registry.manifestErrors ?? []) errors.push(err)

  if (map.schemaVersion !== 2) errors.push('schemaVersion must be 2 (the app can normalize v1 at load time, but this validator checks authored v2 JSON)')
  if (!/^[a-z0-9-]+$/.test(String(map.slug ?? ''))) errors.push('slug is required and must match /^[a-z0-9-]+$/')
  if (!id(map.name)) errors.push('name is required and must be a non-empty string')

  const dims = map.dimensions
  let dimsOk = true
  if (!isObj(dims)) {
    errors.push('dimensions must be an object with integer x/y/z values')
    dimsOk = false
  } else {
    for (const axis of ['x', 'y', 'z']) {
      if (!Number.isInteger(dims[axis]) || dims[axis] < 1 || dims[axis] > 200) {
        errors.push(`dimensions.${axis} must be an integer 1..200`)
        dimsOk = false
      }
    }
  }
  const safeDims = dimsOk ? dims : { x: 1, y: 1, z: 1 }

  const selectedPacks = validateAssetPacks(errors, map, file, registry)

  const seenIds = new Map()
  const checkUniqueId = (label, item) => {
    if (!id(item.id)) errors.push(`${label}.id is required and must be a non-empty string`)
    else if (seenIds.has(item.id)) errors.push(`duplicate object id "${item.id}" at ${label}; first used by ${seenIds.get(item.id)}`)
    else seenIds.set(item.id, label)
  }

  if (!Array.isArray(map.voxels)) errors.push('voxels must be an array')
  else {
    const seenVoxels = new Set()
    map.voxels.forEach((v, i) => {
      if (!isObj(v)) return errors.push(`voxels[${i}] must be an object`)
      validateAnchor(errors, `voxels[${i}]`, v, safeDims, true, dimsOk)
      if (Number.isInteger(v.x) && Number.isInteger(v.y) && Number.isInteger(v.z)) {
        const key = `${v.x},${v.y},${v.z}`
        if (seenVoxels.has(key)) errors.push(`duplicate voxel position ${key}; remove one voxel or merge its material/color into the other`)
        seenVoxels.add(key)
      }
      if (!id(v.materialId)) errors.push(`voxels[${i}].materialId is required`)
      else if (!registry.materialIds.has(v.materialId)) errors.push(`voxels[${i}].materialId "${v.materialId}" is unknown; choose a material from local asset pack manifests`)
      else if (!selectedPackAllows(registry, 'materials', v.materialId, selectedPacks)) errors.push(`voxels[${i}].materialId ${selectedPackError(registry, 'materials', v.materialId, selectedPacks)}`)
      if (!hex(v.color)) errors.push(`voxels[${i}].color must be #rrggbb`)
    })
  }

  if (!Array.isArray(map.placements)) errors.push('placements must be an array')
  else map.placements.forEach((p, i) => {
    if (!isObj(p)) return errors.push(`placements[${i}] must be an object`)
    checkUniqueId(`placements[${i}]`, p)
    if (!['pokemon', 'trainer'].includes(p.sheetKind)) errors.push(`placements[${i}].sheetKind must be "pokemon" or "trainer"`)
    if (!id(p.sheetSlug)) errors.push(`placements[${i}].sheetSlug is required`)
    validateAnchor(errors, `placements[${i}].position`, p.position, safeDims, true, dimsOk)
  })

  for (const [field, registrySet, foreignKey, packKind] of [['decals', registry.decalIds, 'decalId', 'decals'], ['props', registry.propIds, 'propId', 'props'], ['doors', registry.doorIds, 'doorId', 'doors']]) {
    if (map[field] == null) continue
    if (!Array.isArray(map[field])) { errors.push(`${field} must be an array`); continue }
    map[field].forEach((item, i) => {
      if (!isObj(item)) return errors.push(`${field}[${i}] must be an object`)
      checkUniqueId(`${field}[${i}]`, item)
      if (!id(item[foreignKey])) errors.push(`${field}[${i}].${foreignKey} is required`)
      else if (!registrySet.has(item[foreignKey])) errors.push(`${field}[${i}].${foreignKey} "${item[foreignKey]}" is unknown; choose one from local asset pack manifests`)
      else if (!selectedPackAllows(registry, packKind, item[foreignKey], selectedPacks)) errors.push(`${field}[${i}].${foreignKey} ${selectedPackError(registry, packKind, item[foreignKey], selectedPacks)}`)
      validateAnchor(errors, `${field}[${i}].position`, item.position, safeDims, false, dimsOk)

      if (field === 'decals') {
        if (!['floor', 'ceiling', 'north', 'south', 'east', 'west'].includes(item.surface)) errors.push(`decals[${i}].surface must be one of floor/ceiling/north/south/east/west`)
        if (item.scale != null) validateScaleObject(errors, `decals[${i}].scale`, item.scale, ['x', 'z'], ['y'])
        if (item.opacity != null && (!isNum(item.opacity) || item.opacity < 0 || item.opacity > 1)) errors.push(`decals[${i}].opacity must be 0..1`)
        if (!hex(item.tint)) errors.push(`decals[${i}].tint must be #rrggbb`)
      }

      if (field === 'props') {
        if (item.variant != null) {
          if (!id(item.variant)) errors.push(`props[${i}].variant must be a non-empty string`)
          else {
            const variants = registry.propVariants.get(item.propId)
            if (!variants?.has(item.variant)) errors.push(`props[${i}].variant "${item.variant}" is not defined for propId "${item.propId}"`)
          }
        }
        if (item.scale != null) {
          if (typeof item.scale === 'number') checkPositive(errors, `props[${i}].scale`, item.scale)
          else validateScaleObject(errors, `props[${i}].scale`, item.scale, ['x', 'y', 'z'])
        }
        if (item.footprint != null) validateScaleObject(errors, `props[${i}].footprint`, item.footprint, ['x', 'z'])
        if (item.height != null) checkPositive(errors, `props[${i}].height`, item.height)
        if (item.anchor != null && !['center', 'bottom-center', 'grid-cell'].includes(item.anchor)) errors.push(`props[${i}].anchor invalid`)
      }

      if (field === 'doors') {
        if (item.state != null && !['open', 'closed', 'locked'].includes(item.state)) errors.push(`doors[${i}].state must be open, closed, or locked`)
        if (item.width != null) checkPositive(errors, `doors[${i}].width`, item.width)
        if (item.height != null) checkPositive(errors, `doors[${i}].height`, item.height)
      }
    })
  }

  const zoneIds = new Set()
  if (map.zones != null) {
    if (!Array.isArray(map.zones)) errors.push('zones must be an array')
    else map.zones.forEach((z, i) => {
      if (!isObj(z)) return errors.push(`zones[${i}] must be an object`)
      checkUniqueId(`zones[${i}]`, z)
      if (id(z.id)) zoneIds.add(z.id)
      if (!id(z.name)) errors.push(`zones[${i}].name is required`)
      const b = z.bounds
      if (!isObj(b)) errors.push(`zones[${i}].bounds is required`)
      else {
        for (const k of ['x1', 'z1', 'x2', 'z2']) if (!isNum(b[k])) errors.push(`zones[${i}].bounds.${k} must be a number`)
        for (const k of ['y1', 'y2']) if (b[k] != null && !isNum(b[k])) errors.push(`zones[${i}].bounds.${k} must be a number when present`)
        if (isNum(b.x1) && isNum(b.x2) && !(b.x1 < b.x2)) errors.push(`zones[${i}].bounds.x1 must be < x2`)
        if (isNum(b.z1) && isNum(b.z2) && !(b.z1 < b.z2)) errors.push(`zones[${i}].bounds.z1 must be < z2`)
        if (isNum(b.y1) && isNum(b.y2) && !(b.y1 < b.y2)) errors.push(`zones[${i}].bounds.y1 must be < y2`)
        if (dimsOk) {
          if (isNum(b.x1) && b.x1 < 0) errors.push(`zones[${i}].bounds.x1=${b.x1} outside dimensions.x`)
          if (isNum(b.x2) && b.x2 > safeDims.x) errors.push(`zones[${i}].bounds.x2=${b.x2} outside dimensions.x ${safeDims.x}`)
          if (isNum(b.z1) && b.z1 < 0) errors.push(`zones[${i}].bounds.z1=${b.z1} outside dimensions.z`)
          if (isNum(b.z2) && b.z2 > safeDims.z) errors.push(`zones[${i}].bounds.z2=${b.z2} outside dimensions.z ${safeDims.z}`)
          if (isNum(b.y1) && (b.y1 < 0 || b.y1 >= safeDims.y)) errors.push(`zones[${i}].bounds.y1=${b.y1} outside dimensions.y 0..${safeDims.y - 1}`)
          if (isNum(b.y2) && (b.y2 < 0 || b.y2 > safeDims.y)) errors.push(`zones[${i}].bounds.y2=${b.y2} outside dimensions.y 0..${safeDims.y}`)
        }
      }
      for (const key of ['icon', 'cornerMarker']) {
        if (z[key] != null) {
          if (!id(z[key])) errors.push(`zones[${i}].${key} must be a decal id string`)
          else if (!registry.decalIds.has(z[key])) errors.push(`zones[${i}].${key} "${z[key]}" is not a known decal id`)
          else if (!selectedPackAllows(registry, 'decals', z[key], selectedPacks)) errors.push(`zones[${i}].${key} ${selectedPackError(registry, 'decals', z[key], selectedPacks)}`)
        }
      }
      if (z.floorWashOpacity != null && (!isNum(z.floorWashOpacity) || z.floorWashOpacity < 0 || z.floorWashOpacity > 1)) errors.push(`zones[${i}].floorWashOpacity must be 0..1`)
      if (!hex(z.tint)) errors.push(`zones[${i}].tint must be #rrggbb`)
      if (!hex(z.ambientLight)) errors.push(`zones[${i}].ambientLight must be #rrggbb`)
    })
  }

  if (map.lights != null) {
    if (!Array.isArray(map.lights)) errors.push('lights must be an array')
    else map.lights.forEach((l, i) => {
      if (!isObj(l)) return errors.push(`lights[${i}] must be an object`)
      checkUniqueId(`lights[${i}]`, l)
      if (!['ambient', 'point', 'emissive', 'zone'].includes(l.kind)) errors.push(`lights[${i}].kind must be ambient, point, emissive, or zone`)
      if (l.position != null) validateAnchor(errors, `lights[${i}].position`, l.position, safeDims, false, dimsOk)
      if (!hex(l.color)) errors.push(`lights[${i}].color must be #rrggbb`)
      if (l.kind === 'zone' && !id(l.zoneId)) errors.push(`lights[${i}].zoneId is required when kind is "zone"`)
      if (l.zoneId != null) {
        if (!id(l.zoneId)) errors.push(`lights[${i}].zoneId must be a zone id string`)
        else if (!zoneIds.has(l.zoneId)) errors.push(`lights[${i}].zoneId "${l.zoneId}" does not match any zones[].id`)
      }
    })
  }

  return errors.map((e) => `${file}: ${e}`)
}

export const validateMapFile = (file, registry = defaultRegistry) => {
  let map
  try {
    map = JSON.parse(readFileSync(file, 'utf8'))
  } catch (err) {
    return { ok: false, errors: [`${file}: could not parse JSON: ${err.message}`] }
  }
  const errors = validateMap(map, file, registry)
  return { ok: errors.length === 0, errors }
}

const runCli = () => {
  const args = process.argv.slice(2)
  if (!args.length || args.includes('-h') || args.includes('--help')) {
    console.log('Usage: node scripts/validate-map-v2.mjs <map.json> [more.json...]')
    console.log('Tip: npm run validate:map -- data/maps/ranger_ark/airship-habitat-atrium-v2.json')
    process.exit(args.length ? 0 : 1)
  }

  let failed = false
  const registry = createRegistry(root)
  for (const file of args) {
    const result = validateMapFile(file, registry)
    if (!result.ok) {
      failed = true
      for (const e of result.errors) console.error(e)
      console.error(`${file}: ${result.errors.length} validation error(s); see docs/maps-v2.md troubleshooting notes`)
    } else {
      console.log(`${file}: ok`)
    }
  }
  process.exit(failed ? 1 : 0)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runCli()
}
