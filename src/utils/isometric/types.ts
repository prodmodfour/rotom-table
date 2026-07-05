import type * as THREE from 'three'
import type { CSS3DSprite } from 'three/examples/jsm/renderers/CSS3DRenderer.js'
import type { CombatStageMap } from '~/types/combatStages'
import type { TokenCombatStageGlass } from '~/utils/isometric/tokenCombatStageGlass'
import type { MapHazardKind, MapVoxelV2 } from '~/types/map'
import type { SpriteAnimation, SpriteCrop } from '~/types/pokemon'
import type { TokenFacingDirection } from '~/types/tokenFacing'
import type { TokenRenderGeometryLeases } from '~/utils/isometric/tokenGeometryCache'
import type { WorldSpriteIsoLightingRuntime } from '~/utils/isometric/worldSpriteIsoLighting'

export interface WorldSpriteState {
  sprite: THREE.Sprite
  material: THREE.SpriteMaterial
  halo: THREE.Sprite
  haloMaterial: THREE.SpriteMaterial
  haloColor: number
  texture: THREE.Texture | null
  releaseTexture: (() => void) | null
  assetKey: string | null
  loadToken: number
  textureLoading: boolean
  animationMeta: SpriteAnimation | null
  animationStartedAtMs: number
  currentFrame: number
  textureRepeat: THREE.Vector2
  textureOffset: THREE.Vector2
  mirroredX: boolean
  /** Mutable shader uniform state for sprite-local fake lighting; absent on ghost/preview sprites. */
  isoLighting: WorldSpriteIsoLightingRuntime | null
  onTextureLoadComplete: (() => void) | null
  ghost: boolean
  invalid: boolean
}

/**
 * Cosmetic layer semantics for a rendered Pokémon token:
 * - sprite: the Pokémon art plus sprite-owned halo, always the primary read;
 * - contact shadow: the persistent floor/planted cue, independent from the cage;
 * - cage volume/edges: tactical footprint and clearance affordances;
 * - sprite isometric shading: sprite-local fake lighting that must remain separate from cage visibility.
 */
export type PokemonTokenCosmeticLayer =
  | 'sprite'
  | 'contact-shadow'
  | 'cage'
  | 'sprite-isometric-shading'

export type PokemonTacticalCageTargetingRole = 'candidate' | 'selected'

/**
 * Visual-only targeting request for tactical cage affordances. Targeting
 * reticles and hit labels remain authoritative; this only restores a subtle
 * token-footprint cue while the persistent idle cage stays hidden.
 */
export interface PokemonTacticalCageTargetingState {
  role: PokemonTacticalCageTargetingRole
  /** Acting user's accent when available, not the target token owner's accent. */
  accentColor?: string
}

export interface PokemonRenderObject {
  id: string
  sprite: THREE.Sprite
  spriteState: WorldSpriteState
  elevationBadge: CSS3DSprite
  hpBar: CSS3DSprite
  combatStageGlass: TokenCombatStageGlass
  /**
   * Tactical volume wrapping the Pokémon footprint × clearance. Uses a
   * 6-material array so footprint/clearance affordances keep a readable
   * top/left/right brightness ramp when a cage state is requested.
   */
  volume: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial[]>
  edges: THREE.LineSegments
  /** Renderer-owned tactical cage affordance state; layer visibility still gates whether it can render. */
  cageVisible: boolean
  proxy: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>
  /** Soft radial-gradient disc on the floor; the "planted on the ground" cue. */
  shadow: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>
  /** Optional ref-counted geometry leases for renderer-owned shared token boxes. */
  geometryLeases?: TokenRenderGeometryLeases
  currentCenter: THREE.Vector3
  targetCenter: THREE.Vector3
  width: number
  height: number
  base: number
  clearance: number
  elevation: number
  spriteUrl: string
  backSpriteUrl?: string
  spriteAnimation?: SpriteAnimation
  backSpriteAnimation?: SpriteAnimation
  spriteCrop?: SpriteCrop
  facing: TokenFacingDirection
  turned: boolean
  displayName: string
  level: number
  currentHp: number
  temporaryHp?: number
  maxHp: number
  fullMaxHp?: number
  injuries?: number
  combatStages: CombatStageMap
  conditions: string[]
  tokenItems: string[]
  accentColor?: string
  /** Eased 0→1 selection-lift factor; target flips on selection state. */
  liftFactor: number
  liftTarget: number
}

export interface VoxelGroup {
  key: string
  /** Renderer-owned shared unit box geometry; individual buckets own only their materials. */
  geometry: THREE.BoxGeometry
  materials: THREE.MeshBasicMaterial[]
  mesh: THREE.InstancedMesh
  voxels: MapVoxelV2[]
  /** Output-relevant render traits and voxel positions used to skip unchanged bucket rebuilds. */
  semanticSignature: string
}

export interface BuildTarget {
  action: 'place' | 'remove'
  cell: { x: number; y: number; z: number }
  valid: boolean
}

export interface HazardTarget {
  action: 'place' | 'remove'
  cell: { x: number; y: number; z: number }
  kind?: MapHazardKind
  valid: boolean
}
