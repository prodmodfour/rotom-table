import type { DoorState, MaterialDefinition, PropPlacement } from '~/types/map'
import { MATERIAL_BY_ID, registerMaterialDefinitions } from './mapMaterials'

export interface AssetPackSource {
  name: string
  url: string
  license: string
  notes?: string
}

export interface TextureAtlasRegion {
  texture: string
  x: number
  y: number
  width: number
  height: number
}

export interface AssetVariantDefinition {
  id: string
  displayName?: string
  texture?: string
  path?: string
  weight?: number
  width?: number
  height?: number
  tags?: string[]
  atlas?: TextureAtlasRegion
}

export interface DecalDefinition {
  id: string
  packId?: string
  displayName: string
  texture: string
  defaultScale?: { x: number; z: number }
  tags?: string[]
  variants?: AssetVariantDefinition[]
  atlas?: TextureAtlasRegion
  sources?: AssetPackSource[]
}

export interface PropDefinition {
  id: string
  packId?: string
  displayName: string
  texture: string
  footprint: { x: number; z: number }
  height: number
  width?: number
  anchor?: 'center' | 'bottom-center' | 'grid-cell'
  blocksMovementDefault?: boolean
  blocksSightDefault?: boolean
  interactableDefault?: boolean
  transparent?: boolean
  tags?: string[]
  variants?: AssetVariantDefinition[]
  atlas?: TextureAtlasRegion
  sources?: AssetPackSource[]
}

export interface DoorDefinition {
  id: string
  packId?: string
  displayName: string
  style?: string
  color: string
  accent?: string
  transparent?: boolean
  opacity?: number
  defaultWidth: number
  defaultHeight: number
  blocksMovementDefault?: boolean
  tags?: string[]
  sources?: AssetPackSource[]
}

export interface IconDefinition extends DecalDefinition {}

export interface AssetPackManifest {
  id: string
  displayName?: string
  version?: number
  sources?: AssetPackSource[]
  materials?: Record<string, Partial<MaterialDefinition> & { path?: string; proceduralTexture?: boolean }>
  decals?: Record<string, Partial<DecalDefinition> & { path?: string }>
  props?: Record<string, Partial<PropDefinition> & { path?: string }>
  doors?: Record<string, Partial<DoorDefinition> & { procedural?: string }>
  icons?: Record<string, Partial<IconDefinition> & { path?: string }>
}

export interface RegisteredAssetPack {
  id: string
  displayName: string
  version: number
  baseUrl: string
  sources: AssetPackSource[]
  manifest: AssetPackManifest
}

export interface MapAssetRegistrySnapshot {
  packs: ReadonlyMap<string, RegisteredAssetPack>
  materials: ReadonlyMap<string, MaterialDefinition>
  decals: ReadonlyMap<string, DecalDefinition>
  props: ReadonlyMap<string, PropDefinition>
  doors: ReadonlyMap<string, DoorDefinition>
  icons: ReadonlyMap<string, IconDefinition>
  revision: number
}

const publicAsset = (pack: string, path: string) => `/assets/map/${pack}/${path}`
const airshipAsset = (path: string) => publicAsset('airship', path)

const titleCaseId = (id: string): string =>
  id
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')

const decal = (id: string, displayName: string, tags: string[] = [], scale = { x: 1, z: 1 }): DecalDefinition => ({
  id,
  packId: 'airship',
  displayName,
  texture: airshipAsset(`decals/${id}.svg`),
  defaultScale: scale,
  tags,
})

const prop = (
  id: string,
  displayName: string,
  footprint: { x: number; z: number },
  height: number,
  tags: string[] = [],
  options: Partial<Omit<PropDefinition, 'id' | 'displayName' | 'texture' | 'footprint' | 'height' | 'tags'>> = {},
): PropDefinition => ({
  id,
  packId: 'airship',
  displayName,
  texture: airshipAsset(`props/${id}.svg`),
  footprint,
  height,
  width: Math.max(footprint.x, footprint.z),
  anchor: 'bottom-center',
  blocksMovementDefault: true,
  blocksSightDefault: false,
  tags,
  ...options,
})

const door = (
  id: string,
  displayName: string,
  color: string,
  accent: string,
  tags: string[] = [],
  options: Partial<Omit<DoorDefinition, 'id' | 'displayName' | 'color' | 'accent' | 'tags'>> = {},
): DoorDefinition => ({
  id,
  packId: 'airship',
  displayName,
  style: 'procedural-door',
  color,
  accent,
  defaultWidth: 2,
  defaultHeight: 2.4,
  blocksMovementDefault: true,
  tags,
  ...options,
})

export const DECAL_DEFINITIONS: readonly DecalDefinition[] = [
  decal('arrow', 'Directional Arrow', ['wayfinding'], { x: 1.2, z: 1.2 }),
  decal('hazard_stripes', 'Hazard Stripes', ['hazard', 'warning'], { x: 2, z: 1 }),
  decal('medical_cross', 'Medical Cross', ['medical'], { x: 1.2, z: 1.2 }),
  decal('snowflake', 'Snowflake Icon', ['ice', 'snow'], { x: 1.1, z: 1.1 }),
  decal('flame', 'Flame Icon', ['thermal', 'fire'], { x: 1.1, z: 1.1 }),
  decal('lightning', 'Lightning Icon', ['electric'], { x: 1.1, z: 1.1 }),
  decal('toxic', 'Biosecure Toxic Icon', ['poison', 'biosecure'], { x: 1.1, z: 1.1 }),
  decal('water_ripple', 'Water Ripple', ['water'], { x: 1.4, z: 1.4 }),
  decal('shoreline_trim', 'Shoreline Trim', ['water', 'edge'], { x: 1.8, z: 0.6 }),
  decal('ranger_insignia', 'Ranger Insignia', ['ranger', 'identity'], { x: 2.2, z: 2.2 }),
  decal('cargo_lift_outline', 'Cargo Lift Outline', ['cargo', 'lift'], { x: 3, z: 3 }),
  decal('decon_chevrons', 'Decontamination Chevrons', ['medical', 'biosecure'], { x: 2.2, z: 1 }),
  decal('staff_only', 'Staff Only Marking', ['staff', 'warning'], { x: 2.4, z: 0.8 }),
  decal('pawprints', 'Pawprints', ['habitat', 'pokemon'], { x: 1.6, z: 1 }),
  decal('egg_icon', 'Egg / Nursery Icon', ['nursery', 'egg'], { x: 1.2, z: 1.2 }),
  decal('quiet_moon', 'Quiet Nook Moon', ['quiet', 'rest'], { x: 1.2, z: 1.2 }),
  decal('observation_ring_mark', 'Observation Ring Mark', ['observation'], { x: 1.5, z: 1.5 }),
] as const

export const PROP_DEFINITIONS: readonly PropDefinition[] = [
  prop('berry_bush', 'Berry Bush', { x: 1, z: 1 }, 1.2, ['habitat', 'plant'], { blocksMovementDefault: false }),
  prop('small_tree', 'Small Tree', { x: 1, z: 1 }, 2.4, ['habitat', 'plant', 'tree']),
  prop('large_tree_cluster', 'Large Tree Cluster', { x: 2, z: 2 }, 3.8, ['habitat', 'plant', 'tree'], { blocksSightDefault: true }),
  prop('reed_patch', 'Reed Patch', { x: 1, z: 1 }, 1.6, ['habitat', 'wetland', 'plant'], { blocksMovementDefault: false }),
  prop('lily_pad', 'Lily Pad', { x: 1, z: 1 }, 0.25, ['habitat', 'water'], { blocksMovementDefault: false }),
  prop('rock_pile', 'Rock Pile', { x: 1, z: 1 }, 0.9, ['habitat', 'stone']),
  prop('burrow_entrance', 'Burrow Entrance', { x: 1, z: 1 }, 0.9, ['habitat', 'burrow'], { interactableDefault: true }),
  prop('cave_den', 'Cave Den', { x: 2, z: 1 }, 1.7, ['habitat', 'cave'], { interactableDefault: true, blocksSightDefault: true }),
  prop('perch_pole', 'Perch Pole', { x: 1, z: 1 }, 2.7, ['habitat', 'aviary'], { blocksMovementDefault: false }),
  prop('perch_tower', 'Perch Tower', { x: 1, z: 1 }, 4.2, ['habitat', 'aviary'], { blocksMovementDefault: true }),
  prop('nest_box', 'Nest Box', { x: 1, z: 1 }, 1.2, ['habitat', 'aviary', 'nursery']),
  prop('feeding_trough', 'Feeding Trough', { x: 2, z: 1 }, 0.8, ['habitat', 'food'], { blocksMovementDefault: false }),
  prop('egg_warmer', 'Egg Warmer / Nursery Pad', { x: 1, z: 1 }, 0.7, ['habitat', 'nursery', 'egg'], { blocksMovementDefault: false, interactableDefault: true }),
  prop('ice_crystal', 'Ice Crystal', { x: 1, z: 1 }, 1.8, ['habitat', 'ice'], { transparent: true }),
  prop('snow_mound', 'Snow Mound', { x: 1, z: 1 }, 0.7, ['habitat', 'snow'], { blocksMovementDefault: false }),
  prop('sand_scrub', 'Sand Scrub Plant', { x: 1, z: 1 }, 1.1, ['habitat', 'sand', 'scrub'], { blocksMovementDefault: false }),
  prop('thermal_vent', 'Thermal Vent', { x: 1, z: 1 }, 1.1, ['habitat', 'thermal'], { blocksMovementDefault: false }),
  prop('heat_rock', 'Heat Rock', { x: 1, z: 1 }, 0.8, ['habitat', 'thermal']),
  prop('charging_pylon', 'Charging Pylon', { x: 1, z: 1 }, 2.5, ['airship', 'electric', 'tech'], { interactableDefault: true }),
  prop('magnetic_coil', 'Magnetic Coil', { x: 1, z: 1 }, 1.4, ['airship', 'electric', 'tech']),
  prop('poison_scrubber', 'Poison Scrubber / Filtration Vent', { x: 1, z: 1 }, 1.8, ['airship', 'poison', 'biosecure'], { interactableDefault: true }),
  prop('console', 'Console', { x: 1, z: 1 }, 1.4, ['airship', 'command', 'tech'], { interactableDefault: true }),
  prop('wall_monitor', 'Wall Monitor', { x: 1, z: 1 }, 1.6, ['airship', 'wall', 'tech'], { blocksMovementDefault: false }),
  prop('pipe_bundle', 'Pipe Bundle', { x: 2, z: 1 }, 1.0, ['airship', 'engineering']),
  prop('vent_grille', 'Vent Grille', { x: 1, z: 1 }, 0.45, ['airship', 'vent'], { blocksMovementDefault: false }),
  prop('cargo_crate', 'Cargo Crate', { x: 1, z: 1 }, 1.1, ['airship', 'cargo']),
  prop('railing', 'Railing', { x: 2, z: 1 }, 1.1, ['airship', 'barrier'], { blocksMovementDefault: true }),
  prop('bulkhead_door_frame', 'Bulkhead Door Frame', { x: 2, z: 1 }, 2.7, ['airship', 'door']),
  prop('medical_bed', 'Medical Bed / Treatment Pad', { x: 2, z: 1 }, 0.9, ['airship', 'medical'], { interactableDefault: true }),
  prop('decon_sprayer', 'Decon Sprayer', { x: 1, z: 1 }, 1.9, ['airship', 'medical', 'biosecure'], { interactableDefault: true }),
  prop('warning_beacon', 'Warning Beacon', { x: 1, z: 1 }, 1.2, ['airship', 'warning'], { blocksMovementDefault: false }),
] as const

export const DOOR_DEFINITIONS: readonly DoorDefinition[] = [
  door('sliding_bulkhead_door', 'Sliding Bulkhead Door', '#4f5b66', '#f9c74f', ['airship', 'bulkhead']),
  door('habitat_gate', 'Habitat Gate', '#4a7c59', '#b7efc5', ['habitat', 'gate']),
  door('medical_airlock', 'Medical Airlock', '#d9f1f2', '#3aa6b9', ['medical', 'airlock']),
  door('engineering_hatch', 'Engineering Hatch', '#5e6570', '#f3722c', ['engineering', 'hatch']),
  door('cargo_lift_gate', 'Cargo Lift Gate', '#5b646e', '#f9c74f', ['cargo', 'lift'], { defaultWidth: 3 }),
  door('glass_habitat_gate', 'Glass Habitat Gate', '#8fd5ff', '#ffffff', ['glass', 'habitat'], { transparent: true, opacity: 0.38 }),
  door('biosecure_quarantine_door', 'Biosecure Quarantine Door', '#5f7d42', '#b5e48c', ['poison', 'biosecure', 'quarantine']),
] as const

const manifestPacks = new Map<string, RegisteredAssetPack>()
export const DECAL_BY_ID = new Map<string, DecalDefinition>(DECAL_DEFINITIONS.map((definition) => [definition.id, definition]))
export const PROP_BY_ID = new Map<string, PropDefinition>(PROP_DEFINITIONS.map((definition) => [definition.id, definition]))
export const DOOR_BY_ID = new Map<string, DoorDefinition>(DOOR_DEFINITIONS.map((definition) => [definition.id, definition]))
export const ICON_BY_ID = new Map<string, IconDefinition>()
const manifestLoadPromises = new Map<string, Promise<AssetPackManifest | null>>()
let registryRevision = 0

const isAbsoluteAssetUrl = (path: string) =>
  /^(?:https?:|data:|blob:|\/)/i.test(path)

const joinAssetPath = (baseUrl: string, path: string) => {
  if (isAbsoluteAssetUrl(path)) return path
  return `${baseUrl.replace(/\/$/, '')}/${path.replace(/^\.\//, '').replace(/^\/+/, '')}`
}

const normalizeSources = (sources: unknown): AssetPackSource[] => {
  if (!Array.isArray(sources)) return []
  return sources
    .filter((source): source is AssetPackSource => Boolean(source && typeof source === 'object'))
    .map((source) => ({
      name: String((source as AssetPackSource).name ?? 'Unknown source'),
      url: String((source as AssetPackSource).url ?? 'local://unknown'),
      license: String((source as AssetPackSource).license ?? 'unspecified'),
      notes: (source as AssetPackSource).notes,
    }))
}

const normalizeVariant = (
  variant: AssetVariantDefinition,
  baseUrl: string,
): AssetVariantDefinition => {
  const texture = variant.texture ?? variant.path
  return {
    ...variant,
    texture: texture ? joinAssetPath(baseUrl, texture) : undefined,
    weight: Number.isFinite(variant.weight) && Number(variant.weight) > 0 ? Number(variant.weight) : 1,
  }
}

const normalizeVariants = (
  variants: unknown,
  baseUrl: string,
): AssetVariantDefinition[] | undefined => {
  if (!Array.isArray(variants)) return undefined
  const out = variants
    .filter((variant): variant is AssetVariantDefinition => Boolean(variant && typeof variant === 'object' && typeof (variant as AssetVariantDefinition).id === 'string'))
    .map((variant) => normalizeVariant(variant, baseUrl))
  return out.length ? out : undefined
}

const normalizeMaterialDefinitions = (
  packId: string,
  baseUrl: string,
  rawMaterials: AssetPackManifest['materials'],
): MaterialDefinition[] => {
  if (!rawMaterials) return []
  const out: MaterialDefinition[] = []
  for (const [id, raw] of Object.entries(rawMaterials)) {
    const texture = raw.texture ?? raw.path
    out.push({
      ...raw,
      id,
      displayName: raw.displayName ?? titleCaseId(id),
      texture: texture ? joinAssetPath(baseUrl, texture) : raw.texture,
      tags: raw.tags ?? [packId],
    })
  }
  return out
}

const mergeDecalDefinition = (
  id: string,
  packId: string,
  baseUrl: string,
  raw: Partial<DecalDefinition> & { path?: string },
  sources: AssetPackSource[],
): DecalDefinition => {
  const existing = DECAL_BY_ID.get(id)
  const texture = raw.texture ?? raw.path ?? existing?.texture ?? `decals/${id}.svg`
  return {
    ...(existing ?? {}),
    ...raw,
    id,
    packId,
    displayName: raw.displayName ?? existing?.displayName ?? titleCaseId(id),
    texture: joinAssetPath(baseUrl, texture),
    defaultScale: raw.defaultScale ?? existing?.defaultScale ?? { x: 1, z: 1 },
    tags: raw.tags ?? existing?.tags ?? [packId],
    variants: normalizeVariants(raw.variants, baseUrl) ?? existing?.variants,
    sources,
  }
}

const mergePropDefinition = (
  id: string,
  packId: string,
  baseUrl: string,
  raw: Partial<PropDefinition> & { path?: string },
  sources: AssetPackSource[],
): PropDefinition => {
  const existing = PROP_BY_ID.get(id)
  const texture = raw.texture ?? raw.path ?? existing?.texture ?? `props/${id}.svg`
  const footprint = raw.footprint ?? existing?.footprint ?? { x: 1, z: 1 }
  return {
    ...(existing ?? {}),
    ...raw,
    id,
    packId,
    displayName: raw.displayName ?? existing?.displayName ?? titleCaseId(id),
    texture: joinAssetPath(baseUrl, texture),
    footprint,
    height: raw.height ?? existing?.height ?? 1,
    width: raw.width ?? existing?.width ?? Math.max(footprint.x, footprint.z),
    anchor: raw.anchor ?? existing?.anchor ?? 'bottom-center',
    blocksMovementDefault: raw.blocksMovementDefault ?? existing?.blocksMovementDefault ?? false,
    blocksSightDefault: raw.blocksSightDefault ?? existing?.blocksSightDefault ?? false,
    interactableDefault: raw.interactableDefault ?? existing?.interactableDefault ?? false,
    tags: raw.tags ?? existing?.tags ?? [packId],
    variants: normalizeVariants(raw.variants, baseUrl) ?? existing?.variants,
    sources,
  }
}

const mergeDoorDefinition = (
  id: string,
  packId: string,
  raw: Partial<DoorDefinition> & { procedural?: string },
  sources: AssetPackSource[],
): DoorDefinition => {
  const existing = DOOR_BY_ID.get(id)
  return {
    ...(existing ?? {}),
    ...raw,
    id,
    packId,
    displayName: raw.displayName ?? existing?.displayName ?? titleCaseId(id),
    style: raw.style ?? raw.procedural ?? existing?.style ?? 'procedural-door',
    color: raw.color ?? existing?.color ?? '#4f5b66',
    accent: raw.accent ?? existing?.accent,
    defaultWidth: raw.defaultWidth ?? existing?.defaultWidth ?? 1,
    defaultHeight: raw.defaultHeight ?? existing?.defaultHeight ?? 2,
    blocksMovementDefault: raw.blocksMovementDefault ?? existing?.blocksMovementDefault ?? true,
    tags: raw.tags ?? existing?.tags ?? [packId],
    sources,
  }
}

export const registerAssetPackManifest = (
  manifest: AssetPackManifest,
  baseUrl = `/assets/map/${manifest.id}`,
): RegisteredAssetPack | null => {
  if (!manifest || typeof manifest.id !== 'string' || !manifest.id.trim()) return null
  const id = manifest.id.trim()
  const sources = normalizeSources(manifest.sources)
  const pack: RegisteredAssetPack = {
    id,
    displayName: manifest.displayName ?? titleCaseId(id),
    version: manifest.version ?? 1,
    baseUrl,
    sources,
    manifest,
  }
  manifestPacks.set(id, pack)

  const materials = normalizeMaterialDefinitions(id, baseUrl, manifest.materials)
  registerMaterialDefinitions(materials)

  for (const [assetId, raw] of Object.entries(manifest.decals ?? {})) {
    DECAL_BY_ID.set(assetId, mergeDecalDefinition(assetId, id, baseUrl, raw, sources))
  }
  for (const [assetId, raw] of Object.entries(manifest.icons ?? {})) {
    const icon = mergeDecalDefinition(assetId, id, baseUrl, raw, sources)
    ICON_BY_ID.set(assetId, icon)
    // Icons can also be used as subtle zone/floor decals.
    if (!DECAL_BY_ID.has(assetId)) DECAL_BY_ID.set(assetId, icon)
  }
  for (const [assetId, raw] of Object.entries(manifest.props ?? {})) {
    PROP_BY_ID.set(assetId, mergePropDefinition(assetId, id, baseUrl, raw, sources))
  }
  for (const [assetId, raw] of Object.entries(manifest.doors ?? {})) {
    DOOR_BY_ID.set(assetId, mergeDoorDefinition(assetId, id, raw, sources))
  }

  registryRevision += 1
  return pack
}

export const getMapAssetRegistryRevision = () => registryRevision

export const getMapAssetRegistry = (): MapAssetRegistrySnapshot => ({
  packs: manifestPacks,
  materials: MATERIAL_BY_ID,
  decals: DECAL_BY_ID,
  props: PROP_BY_ID,
  doors: DOOR_BY_ID,
  icons: ICON_BY_ID,
  revision: registryRevision,
})

export const loadAssetPackManifest = async (packId: string): Promise<AssetPackManifest | null> => {
  const normalized = packId.trim()
  if (!normalized) return null
  const cached = manifestLoadPromises.get(normalized)
  if (cached) return cached

  const promise = (async () => {
    if (typeof window === 'undefined' || typeof fetch === 'undefined') return null
    const url = `/assets/map/${encodeURIComponent(normalized)}/manifest.json`
    try {
      const response = await fetch(url, { cache: 'force-cache' })
      if (!response.ok) {
        console.warn(`[map-assets] asset pack manifest ${normalized} returned ${response.status}`)
        return null
      }
      const manifest = await response.json() as AssetPackManifest
      registerAssetPackManifest(manifest, `/assets/map/${normalized}`)
      return manifest
    } catch (error) {
      console.warn(`[map-assets] failed to load asset pack manifest ${normalized}`, error)
      return null
    }
  })()

  manifestLoadPromises.set(normalized, promise)
  return promise
}

export const loadMapAssetPacks = async (packIds: readonly string[] | undefined): Promise<void> => {
  const ids = Array.from(new Set((packIds?.length ? packIds : ['airship']).filter(Boolean)))
  await Promise.all(ids.map((id) => loadAssetPackManifest(id)))
}

export const getDecalDefinition = (id: string): DecalDefinition | null => DECAL_BY_ID.get(id) ?? null
export const getPropDefinition = (id: string): PropDefinition | null => PROP_BY_ID.get(id) ?? null
export const getDoorDefinition = (id: string): DoorDefinition | null => DOOR_BY_ID.get(id) ?? null
export const getIconDefinition = (id: string): IconDefinition | null => ICON_BY_ID.get(id) ?? null

const hashString = (input: string): number => {
  let hash = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

export const selectPropVariant = (
  definition: PropDefinition,
  placement?: Pick<PropPlacement, 'id' | 'propId' | 'variant'>,
): AssetVariantDefinition | null => {
  const variants = definition.variants ?? []
  if (!variants.length) return null

  if (placement?.variant) {
    return variants.find((variant) => variant.id === placement.variant) ?? null
  }

  const total = variants.reduce((sum, variant) => sum + Math.max(0, variant.weight ?? 1), 0)
  if (total <= 0) return variants[0] ?? null

  const seed = placement ? `${placement.id}:${placement.propId}` : definition.id
  let pick = (hashString(seed) / 0xffffffff) * total
  for (const variant of variants) {
    pick -= Math.max(0, variant.weight ?? 1)
    if (pick <= 0) return variant
  }
  return variants[variants.length - 1] ?? null
}

export const getPropTexture = (
  definition: PropDefinition,
  placement?: Pick<PropPlacement, 'id' | 'propId' | 'variant'>,
): string => selectPropVariant(definition, placement)?.texture ?? definition.texture

export const propHasVariant = (definition: PropDefinition, variantId: string): boolean =>
  Boolean(definition.variants?.some((variant) => variant.id === variantId))

export const doorStateTint = (state: DoorState | undefined): number => {
  switch (state) {
    case 'open': return 0x8ec07c
    case 'locked': return 0xfb4934
    default: return 0xfabd2f
  }
}
