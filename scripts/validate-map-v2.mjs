#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const args = process.argv.slice(2)
if (!args.length || args.includes('-h') || args.includes('--help')) {
  console.log('Usage: node scripts/validate-map-v2.mjs <map.json> [more.json...]')
  process.exit(args.length ? 0 : 1)
}

const root = process.cwd()
const readIds = (file, regex) => {
  const text = readFileSync(resolve(root, file), 'utf8')
  const ids = new Set()
  let match
  while ((match = regex.exec(text))) ids.add(match[1])
  return ids
}

const materialIds = readIds('utils/mapMaterials.ts', /mat\('([^']+)'/g)
const decalIds = readIds('utils/mapAssets.ts', /decal\('([^']+)'/g)
const propIds = readIds('utils/mapAssets.ts', /prop\('([^']+)'/g)
const doorIds = readIds('utils/mapAssets.ts', /door\('([^']+)'/g)

const isObj = (value) => value && typeof value === 'object' && !Array.isArray(value)
const isNum = (value) => typeof value === 'number' && Number.isFinite(value)
const id = (value) => typeof value === 'string' && value.trim().length > 0
const hex = (value) => value == null || (typeof value === 'string' && /^#?[0-9a-fA-F]{6}$/.test(value))

const validateAnchor = (errors, label, p, dims, integer = false) => {
  if (!isObj(p)) return errors.push(`${label} must be an object`)
  for (const axis of ['x', 'y', 'z']) {
    if (!isNum(p[axis]) || (integer && !Number.isInteger(p[axis]))) errors.push(`${label}.${axis} must be a ${integer ? 'integer' : 'number'}`)
  }
  if (isNum(p.x) && (p.x < 0 || p.x >= dims.x)) errors.push(`${label}.x outside dimensions`)
  if (isNum(p.y) && (p.y < 0 || p.y >= dims.y)) errors.push(`${label}.y outside dimensions`)
  if (isNum(p.z) && (p.z < 0 || p.z >= dims.z)) errors.push(`${label}.z outside dimensions`)
}

const validateMap = (map, file) => {
  const errors = []
  if (!isObj(map)) return [`${file}: root must be an object`]
  if (map.schemaVersion !== 2) errors.push('schemaVersion must be 2')
  if (!/^[a-z0-9-]+$/.test(String(map.slug ?? ''))) errors.push('slug must match /^[a-z0-9-]+$/')
  if (!id(map.name)) errors.push('name is required')
  const dims = map.dimensions
  if (!isObj(dims)) errors.push('dimensions must be an object')
  else for (const axis of ['x', 'y', 'z']) {
    if (!Number.isInteger(dims[axis]) || dims[axis] < 1 || dims[axis] > 200) errors.push(`dimensions.${axis} must be integer 1..200`)
  }
  const safeDims = isObj(dims) ? dims : { x: 1, y: 1, z: 1 }
  const seenIds = new Set()
  const checkUniqueId = (label, item) => {
    if (!id(item.id)) errors.push(`${label} missing id`)
    else if (seenIds.has(item.id)) errors.push(`duplicate id: ${item.id}`)
    else seenIds.add(item.id)
  }

  if (!Array.isArray(map.voxels)) errors.push('voxels must be an array')
  else {
    const seenVoxels = new Set()
    map.voxels.forEach((v, i) => {
      if (!isObj(v)) return errors.push(`voxels[${i}] must be an object`)
      validateAnchor(errors, `voxels[${i}]`, v, safeDims, true)
      const key = `${v.x},${v.y},${v.z}`
      if (seenVoxels.has(key)) errors.push(`duplicate voxel at ${key}`)
      seenVoxels.add(key)
      if (!materialIds.has(v.materialId)) errors.push(`voxels[${i}] unknown materialId "${v.materialId}"`)
      if (!hex(v.color)) errors.push(`voxels[${i}].color must be #rrggbb`)
    })
  }

  if (!Array.isArray(map.placements)) errors.push('placements must be an array')
  else map.placements.forEach((p, i) => {
    if (!isObj(p)) return errors.push(`placements[${i}] must be an object`)
    checkUniqueId(`placements[${i}]`, p)
    if (!['pokemon', 'trainer'].includes(p.sheetKind)) errors.push(`placements[${i}].sheetKind invalid`)
    if (!id(p.sheetSlug)) errors.push(`placements[${i}].sheetSlug required`)
    validateAnchor(errors, `placements[${i}].position`, p.position, safeDims, true)
  })

  for (const [field, registry, foreignKey] of [['decals', decalIds, 'decalId'], ['props', propIds, 'propId'], ['doors', doorIds, 'doorId']]) {
    if (map[field] == null) continue
    if (!Array.isArray(map[field])) { errors.push(`${field} must be an array`); continue }
    map[field].forEach((item, i) => {
      if (!isObj(item)) return errors.push(`${field}[${i}] must be an object`)
      checkUniqueId(`${field}[${i}]`, item)
      if (!registry.has(item[foreignKey])) errors.push(`${field}[${i}] unknown ${foreignKey} "${item[foreignKey]}"`)
      validateAnchor(errors, `${field}[${i}].position`, item.position, safeDims, false)
      if (field === 'decals') {
        if (!['floor', 'ceiling', 'north', 'south', 'east', 'west'].includes(item.surface)) errors.push(`decals[${i}].surface invalid`)
        if (item.opacity != null && (!isNum(item.opacity) || item.opacity < 0 || item.opacity > 1)) errors.push(`decals[${i}].opacity must be 0..1`)
        if (!hex(item.tint)) errors.push(`decals[${i}].tint must be #rrggbb`)
      }
      if (field === 'doors' && item.state != null && !['open', 'closed', 'locked'].includes(item.state)) errors.push(`doors[${i}].state invalid`)
    })
  }

  if (map.zones != null) {
    if (!Array.isArray(map.zones)) errors.push('zones must be an array')
    else map.zones.forEach((z, i) => {
      if (!isObj(z)) return errors.push(`zones[${i}] must be an object`)
      checkUniqueId(`zones[${i}]`, z)
      if (!id(z.name)) errors.push(`zones[${i}].name required`)
      const b = z.bounds
      if (!isObj(b)) errors.push(`zones[${i}].bounds required`)
      else {
        for (const k of ['x1', 'z1', 'x2', 'z2']) if (!isNum(b[k])) errors.push(`zones[${i}].bounds.${k} must be number`)
        if (isNum(b.x1) && isNum(b.x2) && !(b.x1 < b.x2)) errors.push(`zones[${i}].bounds x1 must be < x2`)
        if (isNum(b.z1) && isNum(b.z2) && !(b.z1 < b.z2)) errors.push(`zones[${i}].bounds z1 must be < z2`)
        if (isNum(b.x1) && (b.x1 < 0 || b.x2 > safeDims.x)) errors.push(`zones[${i}].bounds x outside dimensions`)
        if (isNum(b.z1) && (b.z1 < 0 || b.z2 > safeDims.z)) errors.push(`zones[${i}].bounds z outside dimensions`)
        if (b.y1 != null && (b.y1 < 0 || b.y1 >= safeDims.y)) errors.push(`zones[${i}].bounds y1 outside dimensions`)
        if (b.y2 != null && (b.y2 < 0 || b.y2 > safeDims.y)) errors.push(`zones[${i}].bounds y2 outside dimensions`)
      }
      if (z.icon != null && !decalIds.has(z.icon)) errors.push(`zones[${i}] unknown icon decal "${z.icon}"`)
      if (!hex(z.tint)) errors.push(`zones[${i}].tint must be #rrggbb`)
    })
  }

  if (map.lights != null) {
    if (!Array.isArray(map.lights)) errors.push('lights must be an array')
    else map.lights.forEach((l, i) => {
      if (!isObj(l)) return errors.push(`lights[${i}] must be an object`)
      checkUniqueId(`lights[${i}]`, l)
      if (!['ambient', 'point', 'emissive', 'zone'].includes(l.kind)) errors.push(`lights[${i}].kind invalid`)
      if (l.position) validateAnchor(errors, `lights[${i}].position`, l.position, safeDims, false)
      if (!hex(l.color)) errors.push(`lights[${i}].color must be #rrggbb`)
    })
  }

  return errors.map((e) => `${file}: ${e}`)
}

let failed = false
for (const file of args) {
  let map
  try { map = JSON.parse(readFileSync(file, 'utf8')) } catch (err) {
    console.error(`${file}: ${err.message}`)
    failed = true
    continue
  }
  const errors = validateMap(map, file)
  if (errors.length) {
    failed = true
    for (const e of errors) console.error(e)
  } else {
    console.log(`${file}: ok`)
  }
}
process.exit(failed ? 1 : 0)
