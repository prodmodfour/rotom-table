import type { GridAnchor, GridDimensions } from '~/types/map'
import {
  MOVE_VFX_KIND,
  type MoveAnimationEvent,
  type MoveAnimationEventByKind,
  type MoveVfxKind,
} from '~/types/moveAnimation'
import type { SpawnedPokemon } from '~/types/pokemon'
import {
  MOVE_VFX_TONE,
  moveVfxColorForTone,
  moveVfxColorForType,
  type MoveVfxPaletteEntry,
} from '~/utils/moveAnimationPalette'
import { MOVE_VFX_DEFAULT_DURATIONS_MS } from '~/utils/isometric/moveVfxTiming'

type OptionalRuntimeMoveAnimationFields<T extends MoveAnimationEvent> = Omit<T, 'id' | 'createdAtMs'>
  & Partial<Pick<T, 'id' | 'createdAtMs'>>

export type MoveVfxDebugPreviewEvent = {
  [Kind in MoveVfxKind]: OptionalRuntimeMoveAnimationFields<MoveAnimationEventByKind[Kind]>
}[MoveVfxKind]

export interface MoveVfxDebugPreviewOption {
  readonly kind: MoveVfxKind
  readonly label: string
  readonly description: string
}

export const MOVE_VFX_DEBUG_PREVIEW_OPTIONS = [
  {
    kind: MOVE_VFX_KIND.projectile,
    label: 'Projectile',
    description: 'Type-coloured launch from the selected token toward a target anchor.',
  },
  {
    kind: MOVE_VFX_KIND.beam,
    label: 'Beam',
    description: 'Short straight-line energy link with a target-end accent.',
  },
  {
    kind: MOVE_VFX_KIND.arc,
    label: 'Arc / lob',
    description: 'Bounded arcing projectile toward the target anchor.',
  },
  {
    kind: MOVE_VFX_KIND.meleeLunge,
    label: 'Melee lunge',
    description: 'Contact cue that lunges visually without moving placement.',
  },
  {
    kind: MOVE_VFX_KIND.selfPulse,
    label: 'Self aura',
    description: 'Aura pulse centred on the selected token.',
  },
  {
    kind: MOVE_VFX_KIND.targetFlash,
    label: 'Target flash',
    description: 'Hit flash around the target anchor with optional VFX-only shake.',
  },
  {
    kind: MOVE_VFX_KIND.impactRing,
    label: 'Impact ring',
    description: 'Expanding impact ring at the target anchor.',
  },
  {
    kind: MOVE_VFX_KIND.areaPulse,
    label: 'Area pulse',
    description: 'Pulse over synthetic cells near the selected token.',
  },
  {
    kind: MOVE_VFX_KIND.radialBurst,
    label: 'Radial burst',
    description: 'Burst accent expanding from the selected token through nearby cells.',
  },
  {
    kind: MOVE_VFX_KIND.lineSweep,
    label: 'Line sweep',
    description: 'Directional sweep through synthetic cells east of the selected token.',
  },
  {
    kind: MOVE_VFX_KIND.coneSweep,
    label: 'Cone sweep',
    description: 'Directional cone sweep through synthetic cells east of the selected token.',
  },
  {
    kind: MOVE_VFX_KIND.dash,
    label: 'Dash / pass',
    description: 'Afterimage path cue toward a synthetic destination.',
  },
  {
    kind: MOVE_VFX_KIND.miss,
    label: 'Miss puff',
    description: 'Neutral understated miss puff near the target anchor.',
  },
  {
    kind: MOVE_VFX_KIND.crit,
    label: 'Crit burst',
    description: 'Critical-hit accent at the target anchor.',
  },
  {
    kind: MOVE_VFX_KIND.status,
    label: 'Status cloud',
    description: 'Generic status cloud at the target anchor.',
  },
  {
    kind: MOVE_VFX_KIND.healing,
    label: 'Healing pulse',
    description: 'Semantic healing pulse at the target anchor.',
  },
  {
    kind: MOVE_VFX_KIND.buffDebuff,
    label: 'Buff particles',
    description: 'Semantic buff particles at the target anchor.',
  },
  {
    kind: MOVE_VFX_KIND.badge,
    label: 'Badge',
    description: 'Opt-in CSS3D label above the target anchor.',
  },
] as const satisfies readonly MoveVfxDebugPreviewOption[]

export const MOVE_VFX_DEBUG_ALL_PREVIEW_STAGGER_MS = 220

export const MOVE_VFX_DEBUG_HARNESS_QUERY_KEY = 'debug'

export const MOVE_VFX_DEBUG_HARNESS_QUERY_VALUES = [
  'move-vfx',
  'move-vfx-harness',
  'vfx',
] as const

export type MoveVfxDebugHarnessQueryValue = typeof MOVE_VFX_DEBUG_HARNESS_QUERY_VALUES[number]

export type MoveVfxDebugHarnessQuerySource =
  | string
  | URLSearchParams
  | Record<string, unknown>
  | null
  | undefined

export interface MoveVfxDebugHarnessLocationLike {
  readonly search?: string | null
}

export interface MoveVfxDebugHarnessFlagOptions {
  /** Explicit query source, such as Nuxt route.query or window.location.search. */
  readonly query?: MoveVfxDebugHarnessQuerySource
  /** Injectable client location for callers that do not already have route query state. */
  readonly location?: MoveVfxDebugHarnessLocationLike | null
  /** Injectable environment gate for tests and SSR-safe callers. Defaults to the Vite/Nuxt dev flag. */
  readonly isDev?: boolean
  /** Keep the harness dev-safe by default; opt in only for local visual review builds. */
  readonly allowProduction?: boolean
}

export type MoveVfxDebugPreviewKind = MoveVfxKind | 'all'

type MoveVfxDebugPreviewToken = Readonly<Pick<SpawnedPokemon, 'id' | 'position' | 'species' | 'defenderTypes'>>

export interface CreateMoveVfxDebugPreviewEventsOptions {
  /** Primitive to preview, or `all` for a staggered pass through every supported preview option. */
  readonly kind: MoveVfxDebugPreviewKind
  /** Current map selection. No selection returns no events so the harness cannot invent a user token. */
  readonly selectedId: string | null | undefined
  /** Current runtime token snapshots from the map page; never mutated or persisted. */
  readonly tokens: readonly MoveVfxDebugPreviewToken[]
  /** Optional selected-token permission allow-list; a selected token outside it returns no preview events. */
  readonly controllablePlacementIds?: readonly string[]
  /** Optional map bounds for choosing synthetic target, path, and area cells. */
  readonly dimensions?: GridDimensions | null
  /** Optional base offset for the first synthetic event. */
  readonly startOffsetMs?: number
  /** Optional stagger used only by `kind: 'all'`. */
  readonly staggerMs?: number
}

interface ImportMetaDebugHarnessEnvironment {
  readonly dev?: boolean
  readonly env?: {
    readonly DEV?: unknown
    readonly MODE?: unknown
  }
}

interface ProcessDebugHarnessEnvironment {
  readonly dev?: unknown
  readonly env?: {
    readonly NODE_ENV?: unknown
  }
}

interface DebugPreviewContext {
  readonly user: MoveVfxDebugPreviewToken
  readonly targetToken: MoveVfxDebugPreviewToken | null
  readonly targetCell: GridAnchor
  readonly areaCells: readonly GridAnchor[]
  readonly lineCells: readonly GridAnchor[]
  readonly coneCells: readonly GridAnchor[]
  readonly pathCells: readonly GridAnchor[]
}

interface DebugPreviewBaseFields {
  readonly moveName: string
  readonly userId: string
  readonly durationMs: number
  readonly palette: MoveVfxPaletteEntry
  readonly startOffsetMs?: number
}

interface MoveVfxDebugTargetMetadata {
  readonly targetId?: string
  readonly targetCell: GridAnchor
}

const DEBUG_TOKEN_SEPARATOR = /[\s,]+/
const DEBUG_QUERY_KEYS = new Set([
  MOVE_VFX_DEBUG_HARNESS_QUERY_KEY,
  `${MOVE_VFX_DEBUG_HARNESS_QUERY_KEY}[]`,
])
const DEBUG_QUERY_VALUES = new Set<string>(MOVE_VFX_DEBUG_HARNESS_QUERY_VALUES)

const defaultIsDevEnvironment = (): boolean => {
  const meta = import.meta as ImportMetaDebugHarnessEnvironment
  const processDebug = globalThis.process as ProcessDebugHarnessEnvironment | undefined

  return (
    meta.dev === true
    || meta.env?.DEV === true
    || meta.env?.DEV === 'true'
    || meta.env?.MODE === 'development'
    || processDebug?.dev === true
    || processDebug?.env?.NODE_ENV === 'development'
  )
}

const normalizeDebugToken = (value: string): string => value.trim().toLowerCase()

const splitDebugTokens = (value: string): string[] => (
  value
    .split(DEBUG_TOKEN_SEPARATOR)
    .map(normalizeDebugToken)
    .filter(Boolean)
)

const appendStringValues = (values: string[], value: unknown): void => {
  if (Array.isArray(value)) {
    for (const item of value) appendStringValues(values, item)
    return
  }

  if (typeof value === 'string') values.push(value)
}

const queryStringToSearchParams = (query: string): URLSearchParams => {
  const trimmed = query.trim()
  const withoutHash = trimmed.includes('#') ? trimmed.slice(0, trimmed.indexOf('#')) : trimmed
  const queryStartIndex = withoutHash.indexOf('?')
  const search = queryStartIndex >= 0 ? withoutHash.slice(queryStartIndex + 1) : withoutHash.replace(/^\?/, '')

  return new URLSearchParams(search)
}

const collectDebugQueryValues = (query: MoveVfxDebugHarnessQuerySource): string[] => {
  if (!query) return []

  if (typeof query === 'string') {
    return collectDebugQueryValues(queryStringToSearchParams(query))
  }

  const values: string[] = []

  if (query instanceof URLSearchParams) {
    for (const key of DEBUG_QUERY_KEYS) values.push(...query.getAll(key))
    return values
  }

  for (const [key, value] of Object.entries(query)) {
    if (DEBUG_QUERY_KEYS.has(key)) appendStringValues(values, value)
  }

  return values
}

const readGlobalLocationSearch = (): string => {
  const location = globalThis.location as MoveVfxDebugHarnessLocationLike | undefined

  return typeof location?.search === 'string' ? location.search : ''
}

export const hasMoveVfxDebugHarnessQueryFlag = (query: MoveVfxDebugHarnessQuerySource): boolean => (
  collectDebugQueryValues(query).some((value) => splitDebugTokens(value).some((token) => DEBUG_QUERY_VALUES.has(token)))
)

/**
 * Client-safe gate for the map VFX preview harness. It stays hidden unless an
 * explicit debug query requests it and the app is running in a dev environment.
 */
export const isMoveVfxDebugHarnessEnabled = ({
  query,
  location,
  isDev = defaultIsDevEnvironment(),
  allowProduction = false,
}: MoveVfxDebugHarnessFlagOptions = {}): boolean => {
  const requested = hasMoveVfxDebugHarnessQueryFlag(query ?? location?.search ?? readGlobalLocationSearch())

  if (!requested) return false

  return allowProduction || isDev
}

const finiteNonNegativeMs = (value: unknown, fallback = 0): number => (
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback
)

const isFiniteAnchor = (value: GridAnchor | null | undefined): value is GridAnchor => (
  Boolean(value)
  && Number.isFinite(value?.x)
  && Number.isFinite(value?.y)
  && Number.isFinite(value?.z)
)

const cloneAnchor = (anchor: GridAnchor): GridAnchor => ({
  x: anchor.x,
  y: anchor.y,
  z: anchor.z,
})

const clampCoordinate = (value: number, size: number | undefined): number => {
  const rounded = Number.isFinite(value) ? Math.round(value) : 0
  if (!Number.isFinite(size) || size === undefined || size <= 0) return rounded

  return Math.max(0, Math.min(size - 1, rounded))
}

const clampAnchorToDimensions = (
  anchor: GridAnchor,
  dimensions: GridDimensions | null | undefined,
): GridAnchor => ({
  x: clampCoordinate(anchor.x, dimensions?.x),
  y: clampCoordinate(anchor.y, dimensions?.y),
  z: clampCoordinate(anchor.z, dimensions?.z),
})

const offsetAnchor = (
  origin: GridAnchor,
  dimensions: GridDimensions | null | undefined,
  dx: number,
  dz: number,
  dy = 0,
): GridAnchor => clampAnchorToDimensions({
  x: origin.x + dx,
  y: origin.y + dy,
  z: origin.z + dz,
}, dimensions)

const anchorKey = (anchor: GridAnchor): string => `${anchor.x}:${anchor.y}:${anchor.z}`

const isSameAnchor = (left: GridAnchor, right: GridAnchor): boolean => (
  left.x === right.x && left.y === right.y && left.z === right.z
)

const uniqueAnchors = (anchors: readonly GridAnchor[]): readonly GridAnchor[] => {
  const seen = new Set<string>()
  const result: GridAnchor[] = []

  for (const anchor of anchors) {
    if (!isFiniteAnchor(anchor)) continue
    const key = anchorKey(anchor)
    if (seen.has(key)) continue

    seen.add(key)
    result.push(cloneAnchor(anchor))
  }

  return result
}

const firstDistinctOffsetAnchor = (
  origin: GridAnchor,
  dimensions: GridDimensions | null | undefined,
  offsets: readonly (readonly [dx: number, dz: number, dy?: number])[],
): GridAnchor => {
  for (const [dx, dz, dy] of offsets) {
    const candidate = offsetAnchor(origin, dimensions, dx, dz, dy ?? 0)
    if (!isSameAnchor(candidate, origin)) return candidate
  }

  return cloneAnchor(origin)
}

const selectedDebugToken = (
  tokens: readonly MoveVfxDebugPreviewToken[],
  selectedId: string | null | undefined,
  controllablePlacementIds?: readonly string[],
): MoveVfxDebugPreviewToken | null => {
  if (!selectedId) return null
  if (controllablePlacementIds && !controllablePlacementIds.includes(selectedId)) return null
  return tokens.find((token) => token.id === selectedId && isFiniteAnchor(token.position)) ?? null
}

const debugTargetMetadata = (context: DebugPreviewContext): MoveVfxDebugTargetMetadata => ({
  ...(context.targetToken ? { targetId: context.targetToken.id } : {}),
  targetCell: cloneAnchor(context.targetToken?.position ?? context.targetCell),
})

const createDebugAreaCells = (
  origin: GridAnchor,
  dimensions: GridDimensions | null | undefined,
): readonly GridAnchor[] => uniqueAnchors([
  cloneAnchor(origin),
  offsetAnchor(origin, dimensions, 1, 0),
  offsetAnchor(origin, dimensions, 0, 1),
  offsetAnchor(origin, dimensions, 1, 1),
  offsetAnchor(origin, dimensions, 2, 0),
  offsetAnchor(origin, dimensions, 0, 2),
])

const createDebugLineCells = (
  origin: GridAnchor,
  dimensions: GridDimensions | null | undefined,
): readonly GridAnchor[] => uniqueAnchors([
  offsetAnchor(origin, dimensions, 1, 0),
  offsetAnchor(origin, dimensions, 2, 0),
  offsetAnchor(origin, dimensions, 3, 0),
])

const createDebugConeCells = (
  origin: GridAnchor,
  dimensions: GridDimensions | null | undefined,
): readonly GridAnchor[] => uniqueAnchors([
  offsetAnchor(origin, dimensions, 1, 0),
  offsetAnchor(origin, dimensions, 1, -1),
  offsetAnchor(origin, dimensions, 1, 1),
  offsetAnchor(origin, dimensions, 2, 0),
  offsetAnchor(origin, dimensions, 2, -1),
  offsetAnchor(origin, dimensions, 2, 1),
])

const createDebugPathCells = (
  origin: GridAnchor,
  targetCell: GridAnchor,
  dimensions: GridDimensions | null | undefined,
): readonly GridAnchor[] => {
  const midCell = clampAnchorToDimensions({
    x: Math.round((origin.x + targetCell.x) / 2),
    y: Math.round((origin.y + targetCell.y) / 2),
    z: Math.round((origin.z + targetCell.z) / 2),
  }, dimensions)

  return uniqueAnchors([origin, midCell, targetCell])
}

const createDebugPreviewContext = (
  user: MoveVfxDebugPreviewToken,
  tokens: readonly MoveVfxDebugPreviewToken[],
  dimensions: GridDimensions | null | undefined,
): DebugPreviewContext => {
  const origin = clampAnchorToDimensions(user.position, dimensions)
  const targetToken = tokens.find((token) => token.id !== user.id && isFiniteAnchor(token.position)) ?? null
  const syntheticTargetCell = firstDistinctOffsetAnchor(origin, dimensions, [
    [2, 0],
    [0, 2],
    [-2, 0],
    [0, -2],
    [1, 1],
    [-1, -1],
  ])
  const targetCell = targetToken ? clampAnchorToDimensions(targetToken.position, dimensions) : syntheticTargetCell

  return {
    user,
    targetToken,
    targetCell,
    areaCells: createDebugAreaCells(origin, dimensions),
    lineCells: createDebugLineCells(origin, dimensions),
    coneCells: createDebugConeCells(origin, dimensions),
    pathCells: createDebugPathCells(origin, targetCell, dimensions),
  }
}

const optionForKind = (kind: MoveVfxKind): MoveVfxDebugPreviewOption => (
  MOVE_VFX_DEBUG_PREVIEW_OPTIONS.find((option) => option.kind === kind)
  ?? { kind, label: kind, description: 'Synthetic move VFX preview.' }
)

const durationForKind = (kind: MoveVfxKind): number => {
  switch (kind) {
    case MOVE_VFX_KIND.targetFlash:
    case MOVE_VFX_KIND.impactRing:
    case MOVE_VFX_KIND.miss:
    case MOVE_VFX_KIND.crit:
    case MOVE_VFX_KIND.badge:
      return MOVE_VFX_DEFAULT_DURATIONS_MS.quick
    case MOVE_VFX_KIND.radialBurst:
    case MOVE_VFX_KIND.lineSweep:
    case MOVE_VFX_KIND.coneSweep:
    case MOVE_VFX_KIND.dash:
      return MOVE_VFX_DEFAULT_DURATIONS_MS.long
    default:
      return MOVE_VFX_DEFAULT_DURATIONS_MS.normal
  }
}

const paletteForKind = (
  kind: MoveVfxKind,
  user: MoveVfxDebugPreviewToken,
): MoveVfxPaletteEntry => {
  switch (kind) {
    case MOVE_VFX_KIND.healing:
      return moveVfxColorForTone(MOVE_VFX_TONE.healing)
    case MOVE_VFX_KIND.status:
      return moveVfxColorForTone(MOVE_VFX_TONE.status)
    case MOVE_VFX_KIND.buffDebuff:
      return moveVfxColorForTone(MOVE_VFX_TONE.buff)
    case MOVE_VFX_KIND.miss:
      return moveVfxColorForTone(MOVE_VFX_TONE.miss)
    case MOVE_VFX_KIND.crit:
      return moveVfxColorForTone(MOVE_VFX_TONE.crit)
    default:
      return moveVfxColorForType(user.defenderTypes[0] ?? 'Electric')
  }
}

const createDebugBaseFields = (
  kind: MoveVfxKind,
  user: MoveVfxDebugPreviewToken,
  startOffsetMs: number,
): DebugPreviewBaseFields => ({
  moveName: `Debug ${optionForKind(kind).label}`,
  userId: user.id,
  durationMs: durationForKind(kind),
  palette: paletteForKind(kind, user),
  ...(startOffsetMs > 0 ? { startOffsetMs } : {}),
})

const createMoveVfxDebugPreviewEvent = (
  kind: MoveVfxKind,
  context: DebugPreviewContext,
  startOffsetMs: number,
): MoveVfxDebugPreviewEvent => {
  const base = createDebugBaseFields(kind, context.user, startOffsetMs)
  const originCell = cloneAnchor(context.user.position)
  const targetMetadata = debugTargetMetadata(context)

  switch (kind) {
    case MOVE_VFX_KIND.projectile:
      return {
        ...base,
        kind,
        originCell,
        ...targetMetadata,
      }
    case MOVE_VFX_KIND.beam:
      return {
        ...base,
        kind,
        originCell,
        ...targetMetadata,
        impact: true,
      }
    case MOVE_VFX_KIND.arc:
      return {
        ...base,
        kind,
        originCell,
        ...targetMetadata,
        arcHeight: 1.2,
      }
    case MOVE_VFX_KIND.meleeLunge:
      return {
        ...base,
        kind,
        originCell,
        ...targetMetadata,
      }
    case MOVE_VFX_KIND.selfPulse:
      return {
        ...base,
        kind,
        originCell,
        tone: MOVE_VFX_TONE.neutral,
      }
    case MOVE_VFX_KIND.targetFlash:
      return {
        ...base,
        kind,
        ...targetMetadata,
        tone: 'hit',
        shake: true,
      }
    case MOVE_VFX_KIND.impactRing:
      return {
        ...base,
        kind,
        ...targetMetadata,
        tone: 'damage',
      }
    case MOVE_VFX_KIND.areaPulse:
      return {
        ...base,
        kind,
        areaOrigin: originCell,
        areaCells: context.areaCells,
      }
    case MOVE_VFX_KIND.radialBurst:
      return {
        ...base,
        kind,
        originCell,
        areaOrigin: originCell,
        areaCells: context.areaCells,
      }
    case MOVE_VFX_KIND.lineSweep:
      return {
        ...base,
        kind,
        originCell,
        areaOrigin: originCell,
        areaCells: context.lineCells,
        areaDirection: 'east',
      }
    case MOVE_VFX_KIND.coneSweep:
      return {
        ...base,
        kind,
        originCell,
        areaOrigin: originCell,
        areaCells: context.coneCells,
        areaDirection: 'east',
      }
    case MOVE_VFX_KIND.dash:
      return {
        ...base,
        kind,
        originCell,
        destinationCell: cloneAnchor(context.targetCell),
        pathCells: context.pathCells,
      }
    case MOVE_VFX_KIND.miss:
      return {
        ...base,
        kind,
        ...targetMetadata,
      }
    case MOVE_VFX_KIND.crit:
      return {
        ...base,
        kind,
        ...targetMetadata,
      }
    case MOVE_VFX_KIND.status:
      return {
        ...base,
        kind,
        ...targetMetadata,
        conditionName: 'Poisoned',
        conditionNames: ['Poisoned'],
      }
    case MOVE_VFX_KIND.healing:
      return {
        ...base,
        kind,
        ...targetMetadata,
      }
    case MOVE_VFX_KIND.buffDebuff:
      return {
        ...base,
        kind,
        ...targetMetadata,
        tone: 'buff',
        direction: 'buff',
      }
    case MOVE_VFX_KIND.badge:
      return {
        ...base,
        kind,
        originCell,
        ...targetMetadata,
        label: 'Debug',
        tone: MOVE_VFX_TONE.neutral,
      }
  }
}

export const createMoveVfxDebugPreviewEvents = ({
  kind,
  selectedId,
  tokens,
  controllablePlacementIds,
  dimensions,
  startOffsetMs,
  staggerMs = MOVE_VFX_DEBUG_ALL_PREVIEW_STAGGER_MS,
}: CreateMoveVfxDebugPreviewEventsOptions): readonly MoveVfxDebugPreviewEvent[] => {
  const user = selectedDebugToken(tokens, selectedId, controllablePlacementIds)
  if (!user) return []

  const context = createDebugPreviewContext(user, tokens, dimensions)
  const baseOffsetMs = finiteNonNegativeMs(startOffsetMs)
  const selectedKinds = kind === 'all'
    ? MOVE_VFX_DEBUG_PREVIEW_OPTIONS.map((option) => option.kind)
    : [kind]
  const safeStaggerMs = finiteNonNegativeMs(staggerMs, MOVE_VFX_DEBUG_ALL_PREVIEW_STAGGER_MS)

  return selectedKinds.map((selectedKind, index) => createMoveVfxDebugPreviewEvent(
    selectedKind,
    context,
    baseOffsetMs + (kind === 'all' ? index * safeStaggerMs : 0),
  ))
}
