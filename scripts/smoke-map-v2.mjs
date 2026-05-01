#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { createRegistry, validateMap } from './validate-map-v2.mjs'

const demoPath = 'data/maps/ranger_ark/airship-habitat-atrium-v2.json'
const phase2DemoPath = 'data/maps/ranger_ark/airship-habitat-atrium-phase2-demo.json'
const registry = createRegistry(process.cwd())
const failures = []

const assert = (condition, message) => {
  if (!condition) failures.push(message)
}

const errorsFor = (map, label) => validateMap(map, label, registry)
const hasError = (map, label, needle) => errorsFor(map, label).some((error) => error.includes(needle))
const clone = (value) => JSON.parse(JSON.stringify(value))

let demo
try {
  demo = JSON.parse(readFileSync(demoPath, 'utf8'))
  assert(Boolean(demo && typeof demo === 'object'), 'v2 map JSON parses to an object')
} catch (err) {
  failures.push(`v2 map JSON parses: ${err.message}`)
  demo = null
}

const baseMap = {
  schemaVersion: 2,
  slug: 'smoke-map-v2',
  name: 'Smoke Map V2',
  dimensions: { x: 6, y: 4, z: 6 },
  assetPacks: ['airship'],
  voxels: [
    { x: 0, y: 0, z: 0, materialId: 'airship_floor_metal' },
    { x: 1, y: 0, z: 0, materialId: 'reinforced_glass' },
  ],
  placements: [
    { id: 'placement-smoke', sheetKind: 'pokemon', sheetSlug: 'missing-ok-for-map-validation', position: { x: 1, y: 1, z: 1 } },
  ],
  decals: [
    { id: 'decal-smoke', decalId: 'ranger_insignia', surface: 'floor', position: { x: 2, y: 0, z: 2 }, scale: { x: 1, z: 1 } },
  ],
  props: [
    { id: 'prop-smoke', propId: 'console', variant: 'blue', position: { x: 3, y: 1, z: 3 }, scale: 1 },
  ],
  doors: [
    { id: 'door-smoke', doorId: 'glass_habitat_gate', position: { x: 4, y: 1, z: 2 }, state: 'closed', width: 1, height: 2 },
  ],
  zones: [
    { id: 'zone-smoke', name: 'Smoke Zone', bounds: { x1: 0, z1: 0, x2: 4, z2: 4 }, icon: 'pawprints', tint: '#6fb33f' },
  ],
  lights: [
    { id: 'light-smoke', kind: 'zone', zoneId: 'zone-smoke', color: '#ffffff' },
  ],
}

assert(errorsFor(baseMap, 'base').length === 0, 'baseline smoke map passes validation')

{
  const missing = [
    ['schemaVersion', 'schemaVersion must be 2'],
    ['name', 'name is required'],
    ['dimensions', 'dimensions must be an object'],
    ['voxels', 'voxels must be an array'],
    ['placements', 'placements must be an array'],
  ]
  for (const [field, needle] of missing) {
    const map = clone(baseMap)
    delete map[field]
    assert(hasError(map, `missing-${field}`, needle), `required fields exist: missing ${field} is rejected`)
  }
}

{
  const map = clone(baseMap)
  map.voxels[0].materialId = 'not_a_material'
  assert(hasError(map, 'unknown-material', 'materialId "not_a_material" is unknown'), 'unknown material IDs are rejected')
}

{
  const map = clone(baseMap)
  map.decals[0].decalId = 'not_a_decal'
  assert(hasError(map, 'unknown-decal', 'decalId "not_a_decal" is unknown'), 'unknown decal IDs are rejected')
}

{
  const map = clone(baseMap)
  map.props[0].propId = 'not_a_prop'
  assert(hasError(map, 'unknown-prop', 'propId "not_a_prop" is unknown'), 'unknown prop IDs are rejected')
}

{
  const map = clone(baseMap)
  map.doors[0].doorId = 'not_a_door'
  assert(hasError(map, 'unknown-door', 'doorId "not_a_door" is unknown'), 'unknown door IDs are rejected')
}

{
  const map = clone(baseMap)
  map.props[0].variant = 'red'
  assert(hasError(map, 'bad-prop-variant', 'variant "red" is not defined for propId "console"'), 'unknown prop variants are rejected')
}

{
  const map = clone(baseMap)
  map.placements[0].position.x = 99
  assert(hasError(map, 'out-of-bounds', 'position.x=99 outside dimensions.x'), 'positions outside dimensions are rejected')
}

{
  const map = clone(baseMap)
  map.voxels.push({ ...map.voxels[0] })
  assert(hasError(map, 'duplicate-voxel', 'duplicate voxel position 0,0,0'), 'duplicate voxel positions are rejected')
}

{
  const map = clone(baseMap)
  map.props[0].id = map.decals[0].id
  assert(hasError(map, 'duplicate-object-id', 'duplicate object id'), 'duplicate object IDs are rejected')
}

{
  const map = clone(baseMap)
  map.props[0].scale = 0
  assert(hasError(map, 'bad-prop-scale', 'props[0].scale must be a positive number'), 'non-positive prop scale is rejected')
}

{
  const map = clone(baseMap)
  map.decals[0].scale.x = -1
  assert(hasError(map, 'bad-decal-scale', 'decals[0].scale.x must be a positive number'), 'non-positive decal scale is rejected')
}

{
  const map = clone(baseMap)
  map.doors[0].height = 0
  assert(hasError(map, 'bad-door-height', 'doors[0].height must be a positive number'), 'non-positive door height is rejected')
}

{
  const map = clone(baseMap)
  map.zones[0].bounds.x2 = 99
  assert(hasError(map, 'bad-zone-bounds', 'bounds.x2=99 outside dimensions.x'), 'zone bounds outside dimensions are rejected')
}

{
  const map = clone(baseMap)
  map.zones[0].icon = 'not_a_decal'
  assert(hasError(map, 'bad-zone-icon', 'icon "not_a_decal" is not a known decal id'), 'zone icons must reference known decal IDs')
}

{
  const map = clone(baseMap)
  map.lights[0].zoneId = 'missing-zone'
  assert(hasError(map, 'bad-light-zone', 'zoneId "missing-zone" does not match any zones[].id'), 'light zoneId must reference an existing zone')
}

{
  const map = clone(baseMap)
  map.assetPacks = ['missing-pack']
  assert(hasError(map, 'bad-asset-pack', 'unknown local pack "missing-pack"'), 'assetPacks must reference known local packs')
}

if (demo) {
  const demoErrors = errorsFor(demo, demoPath)
  assert(demoErrors.length === 0, `demo map passes validation (${demoErrors.join('; ')})`)
}

try {
  const phase2Demo = JSON.parse(readFileSync(phase2DemoPath, 'utf8'))
  const phase2Errors = errorsFor(phase2Demo, phase2DemoPath)
  assert(phase2Errors.length === 0, `phase2 demo map passes validation (${phase2Errors.join('; ')})`)
  assert(phase2Demo.assetPacks?.includes('nature') && phase2Demo.assetPacks?.includes('facility'), 'phase2 demo declares nature and facility asset packs')
  assert(phase2Demo.props?.some((prop) => prop.variant), 'phase2 demo contains exact prop variants')
} catch (err) {
  failures.push(`phase2 demo map parses: ${err.message}`)
}

if (failures.length) {
  console.error(`map-v2 smoke failed: ${failures.length} failure(s)`)
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('map-v2 smoke: ok')
