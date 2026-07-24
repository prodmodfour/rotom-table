import {
  AA075_ILLUSION_MARK_PREFIX,
  aa075ActiveIllusionStateId,
} from '#shared/abilityAutomation/aa075'
import type { TabletopMap } from '~/types/map'
import type { SpawnedPokemon } from '~/types/pokemon'
import { getVoxelMaterialDefinition } from '~/utils/mapMaterials'

const objectMarkCell = (markId: string): { readonly x: number; readonly y: number; readonly z: number } | null => {
  const prefix = `${AA075_ILLUSION_MARK_PREFIX}object.`
  if (!markId.startsWith(prefix)) return null
  const coordinates = markId.slice(prefix.length).split('.').map(Number)
  if (coordinates.length !== 3 || coordinates.some(value => !Number.isSafeInteger(value) || value < 0)) return null
  return { x: coordinates[0]!, y: coordinates[1]!, z: coordinates[2]! }
}

const objectSpriteDataUrl = (input: { readonly color: string; readonly label: string }): string => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><path fill="${input.color}" stroke="#111827" stroke-width="5" d="M64 7 116 34v60L64 121 12 94V34z"/><path fill="#fff" fill-opacity=".18" d="M64 7v58L12 34z"/><path fill="#000" fill-opacity=".18" d="M64 65v56l52-27V34z"/><title>${input.label}</title></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

/** Renderer-only Illusion projection; no copied field is consumed by mechanics. */
export const projectEncounterIllusionAppearances = (input: {
  readonly tokens: readonly SpawnedPokemon[]
  readonly map: Pick<TabletopMap, 'encounterState' | 'voxels'>
}): SpawnedPokemon[] => input.tokens.map((token) => {
  const stateId = aa075ActiveIllusionStateId(input.map.encounterState?.effects, token.id)
  const mark = stateId
    ? input.map.encounterState?.abilityOwnedState?.entries.find(entry => (
        entry.stateId === stateId
        && entry.ownerPlacementId === token.id
        && entry.canonicalId === 'Illusion'
        && entry.payload.kind === 'mark'
        && entry.payload.markId.startsWith(AA075_ILLUSION_MARK_PREFIX)
      ))
    : null
  if (!mark || mark.payload.kind !== 'mark') return token
  const target = mark.targetPlacementIds[0]
    ? input.tokens.find(candidate => candidate.id === mark.targetPlacementIds[0])
    : null
  if (target) return {
    ...token,
    species: target.species,
    slug: target.slug,
    spriteUrl: target.spriteUrl,
    profileSpriteUrl: target.profileSpriteUrl,
    backSpriteUrl: target.backSpriteUrl,
    spriteAnimation: target.spriteAnimation,
    backSpriteAnimation: target.backSpriteAnimation,
    spriteCrop: target.spriteCrop,
  }

  const cell = objectMarkCell(mark.payload.markId)
  const voxel = cell
    ? input.map.voxels.find(candidate => (
        candidate.x === cell.x && candidate.y === cell.y && candidate.z === cell.z
      ))
    : null
  if (!voxel) return token
  const material = getVoxelMaterialDefinition(voxel)
  const spriteUrl = objectSpriteDataUrl({ color: material.color ?? '#66717f', label: material.displayName })
  return {
    ...token,
    species: material.displayName,
    slug: `illusion-object-${material.id}`,
    spriteUrl,
    profileSpriteUrl: spriteUrl,
    backSpriteUrl: spriteUrl,
    spriteAnimation: undefined,
    backSpriteAnimation: undefined,
    spriteCrop: undefined,
  }
})
