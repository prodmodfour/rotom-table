import type * as THREE from 'three'
import type { CSS3DSprite } from 'three/examples/jsm/renderers/CSS3DRenderer.js'
import type { CombatStageMap } from '~/types/combatStages'
import type { MapHazardKind, MapVoxelV2 } from '~/types/map'
import type { SpriteAnimation, SpriteCrop } from '~/types/pokemon'

export interface WorldSpriteState {
  sprite: THREE.Sprite
  material: THREE.SpriteMaterial
  halo: THREE.Sprite
  haloMaterial: THREE.SpriteMaterial
  texture: THREE.Texture | null
  releaseTexture: (() => void) | null
  assetKey: string | null
  loadToken: number
  animationMeta: SpriteAnimation | null
  animationStartedAtMs: number
  currentFrame: number
  ghost: boolean
  invalid: boolean
}

export interface PokemonRenderObject {
  id: string
  sprite: THREE.Sprite
  spriteState: WorldSpriteState
  elevationBadge: CSS3DSprite
  hpBar: CSS3DSprite
  /**
   * Volume box wrapping the pokemon's footprint × clearance. Uses a
   * 6-material array so we can paint each face with the theme-aware
   * top/left/right brightness ramp.
   */
  volume: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial[]>
  edges: THREE.LineSegments
  proxy: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>
  /** Soft radial-gradient disc on the floor; the "planted on the ground" cue. */
  shadow: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>
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
  turned: boolean
  displayName: string
  level: number
  currentHp: number
  maxHp: number
  combatStages: CombatStageMap
  conditions: string[]
  tokenItems: string[]
  /** Eased 0→1 selection-lift factor; target flips on selection state. */
  liftFactor: number
  liftTarget: number
}

export interface VoxelGroup {
  key: string
  geometry: THREE.BoxGeometry
  materials: THREE.MeshBasicMaterial[]
  mesh: THREE.InstancedMesh
  voxels: MapVoxelV2[]
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
