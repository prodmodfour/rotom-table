import type { CharacterSheet } from '~/types/characterSheet'
import type { PokedexRecord } from '~/types/pokemon'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import pokedexData from '../../../../data/reference/pokedex.json'
import { computeFullMaxHp, resolveStats } from '~/utils/sheets/pokemonDerived'
import { gridFootprintCells } from '~/utils/gridGeometry'
import { getVoxelMaterialDefinition } from '~/utils/mapMaterials'
import { projectAuthoritativeEffectiveAbilities } from '../effectiveAbilities'
import { resolveSheetAndEdgeAbilityInstances } from '../../edgeAutomation/permanentGrants'
import { authoritativeAbilityOwnerIsConscious } from '../effectiveRuntimeAbilities'
import {
  ABILITY_AUTOMATION_RUNTIME_REGISTRY,
  type AbilityAutomationRuntimeRegistry,
} from '../registry'
import { createMoveAutomationWeatherResolver } from '../../moveAutomation/weather'
import { queryBattlefieldZones } from '../../moveAutomation/battlefieldZones'

const POKEDEX_BY_SPECIES = new Map(
  (pokedexData as readonly PokedexRecord[]).map(record => [record.species.trim().toLowerCase(), record]),
)

const INITIATIVE_ABILITIES = Object.freeze([
  'Sand Rush', 'Slush Rush', 'Surge Surfer', 'Swift Swim',
] as const)

const projectedStageDelta = (
  abilities: ReadonlySet<string>,
  delta: number,
): number => delta
  * (abilities.has('Contrary') ? -1 : 1)
  * (abilities.has('Simple') ? 2 : 1)

interface InitiativeAbilityInput {
  readonly map: TabletopMap
  readonly placement: SheetPlacement
  readonly sheet: CharacterSheet
  /** Test/recovery seam; production callers use the manifest-selected registry. */
  readonly abilityRuntimeRegistry?: AbilityAutomationRuntimeRegistry
}

const effectiveAbilityIds = (input: InitiativeAbilityInput): ReadonlySet<string> => {
  if (!authoritativeAbilityOwnerIsConscious(input.sheet)) return new Set<string>()
  return new Set(projectAuthoritativeEffectiveAbilities({
    baseAbilities: resolveSheetAndEdgeAbilityInstances(input.sheet),
    target: {
      placementId: input.placement.id,
      ...(input.placement.sideId ? { sideId: input.placement.sideId } : {}),
      position: input.placement.position,
    },
    effects: input.map.encounterState?.effects ?? [],
    transformationSnapshots: input.map.encounterState?.abilityTransformations,
  }).filter(ability => {
    const runtime = (input.abilityRuntimeRegistry ?? ABILITY_AUTOMATION_RUNTIME_REGISTRY)
      .resolve(ability.canonicalId)
    return ability.effective && runtime !== null
      && (ability.definitionHash === null || ability.definitionHash === runtime.definitionHash)
  }).map(ability => ability.canonicalId))
}

const tokenFootprint = (input: InitiativeAbilityInput) => {
  const species = (pokedexData as readonly PokedexRecord[]).find(entry => (
    entry.species.trim().toLowerCase() === input.sheet.species.trim().toLowerCase()
  ))
  return gridFootprintCells(input.placement.position, {
    base: species?.base ?? 1,
    clearance: species?.clearance ?? 1,
  })
}

/** Effective condition ability names plus stage/stat projections used by Initiative. */
export const aa085to100InitiativeProjection = (input: InitiativeAbilityInput): {
  readonly effectiveAbilityIds: readonly string[]
  readonly speedCombatStageOffset: number
  readonly baseSpeedOffset: number
  readonly baseSpeedMultiplier: number
} => {
  const effective = effectiveAbilityIds(input)
  const occupiedCells = tokenFootprint(input)
  const inWater = effective.has('Wave Rider') && input.map.voxels.some(voxel => (
    (voxel.tags?.includes('water') === true
      || getVoxelMaterialDefinition(voxel).tags?.includes('water') === true)
    && occupiedCells.some(cell => cell.x === voxel.x && cell.z === voxel.z
      && (cell.y === voxel.y || cell.y - 1 === voxel.y))
  ))
  const holdingItem = Boolean(input.sheet.items?.held?.trim())
  const entryEffect = input.map.encounterState?.effects.find(effect => (
    effect.tags.includes('encounter-entry')
    && effect.affected.placementIds.includes(input.placement.id)
    && effect.suppression.sources.length === 0
  ))
  const currentRound = input.map.initiative?.round
    ?? input.map.encounterState?.history.currentRound ?? 1
  const slowStart = effective.has('Slow Start') && (
    entryEffect ? currentRound - entryEffect.createdRound < 3 : currentRound <= 3
  )
  const sourceSpecies = POKEDEX_BY_SPECIES.get(input.sheet.species.trim().toLowerCase()) ?? null
  const effects = input.map.encounterState?.effects ?? []
  const activeFormTag = (tag: string): boolean => effects.some(effect => (
    effect.tags.includes(tag)
    && effect.affected.placementIds.includes(input.placement.id)
    && effect.suppression.sources.length === 0
    && (effect.duration.remaining === null || effect.duration.remaining > 0)
  ))
  const schoolingMaximum = Math.max(1, computeFullMaxHp(
    input.sheet,
    resolveStats(input.sheet).find(stat => stat.key === 'hp')?.total ?? 0,
  ))
  const schoolingTemporaryHp = input.map.temporaryHitPoints?.byPlacementId[input.placement.id] ?? 0
  const targetSpecies = effective.has('Schooling')
    && activeFormTag('aa088-schooling')
    && ((input.sheet.combat?.currentHp ?? schoolingMaximum) * 2 >= schoolingMaximum
      || schoolingTemporaryHp > 0)
    ? 'Wishiwashi Schooling'
    : effective.has('Schooling') && input.sheet.species.trim().toLowerCase().includes('wishiwashi')
      ? 'Wishiwashi Solo'
      : effective.has('Shields Down')
        && ((input.sheet.combat?.currentHp ?? schoolingMaximum) * 2 <= schoolingMaximum
          || activeFormTag('aa089-shields-down-core'))
        ? 'Minior Core'
        : effective.has('Shields Down') && input.sheet.species.trim().toLowerCase().includes('minior')
          ? 'Minior Meteor'
          : activeFormTag('aa100-zen-mode')
            ? 'Darmanitan Zen Mode'
            : activeFormTag('aa100-zen-snowed')
              ? 'Darmanitan Galar Zen Mode'
              : input.sheet.species.trim().toLowerCase().includes('darmanitan')
                && (effective.has('Zen Mode') || effective.has('Zen Snowed'))
                ? effective.has('Zen Snowed') ? 'Darmanitan Galar Standard Mode' : 'Darmanitan'
                : null
  const targetForm = targetSpecies ? POKEDEX_BY_SPECIES.get(targetSpecies.toLowerCase()) ?? null : null
  const baseSpeedOffset = sourceSpecies && targetForm
    ? (targetForm.base_stats?.spd ?? sourceSpecies.base_stats?.spd ?? 0)
      - (sourceSpecies.base_stats?.spd ?? 0)
    : 0
  return Object.freeze({
    effectiveAbilityIds: Object.freeze([...effective]),
    speedCombatStageOffset: (effective.has('Unburden') && !holdingItem ? 2 : 0)
      + (inWater ? projectedStageDelta(effective, 4) : 0),
    baseSpeedOffset,
    baseSpeedMultiplier: slowStart ? 0.5 : 1,
  })
}

/** Server-authoritative weather/terrain-or-low-HP Initiative doubling. */
export const aa085to100InitiativeMultiplier = (input: InitiativeAbilityInput): 1 | 2 => {
  const effective = effectiveAbilityIds(input)
  if (!INITIATIVE_ABILITIES.some(ability => effective.has(ability))) return 1

  const hpTotal = resolveStats(input.sheet).find(stat => stat.key === 'hp')?.total ?? 0
  const maximumHp = Math.max(1, computeFullMaxHp(input.sheet, hpTotal))
  const currentHp = Math.max(0, Math.floor(input.sheet.combat?.currentHp ?? maximumHp))
  const lowHp = currentHp * 2 < maximumHp
  const occupiedCells = tokenFootprint(input)
  const weather = new Set(createMoveAutomationWeatherResolver(input.map, {
    subjectPlacementId: input.placement.id,
    subjectOccupiedCells: occupiedCells,
    ...(effective.has('Water Bubble') ? {
      virtualWeatherKind: 'rainy' as const,
      virtualWeatherSourceId: `ability.water-bubble:${input.placement.id}`,
    } : {}),
  }).active().map(entry => entry.kind))
  const terrain = new Set(queryBattlefieldZones(input.map, {
    kind: 'placement',
    placementId: input.placement.id,
    sideId: input.placement.sideId ?? null,
    occupiedCells,
  }, { kinds: ['terrain'] }).flatMap(zone => (
    zone.kind === 'terrain' ? [zone.payload.terrainId] : []
  )))
  return lowHp
    || (effective.has('Sand Rush') && weather.has('sandstorm'))
    || (effective.has('Slush Rush') && weather.has('hail'))
    || (effective.has('Swift Swim') && weather.has('rainy'))
    || (effective.has('Surge Surfer') && terrain.has('electric'))
    ? 2 : 1
}
